using System.Globalization;
using System.Text;

namespace Aura.Windows.Core;

/// <summary>Un evento del calendario, ya en hora local.</summary>
public sealed record Evento(string Titulo, DateTime Inicio, DateTime Fin, string Lugar, bool TodoElDia);

/// <summary>
/// Lee un calendario iCal (la «dirección secreta en formato iCal» de Google Calendar, Outlook o iCloud):
/// sin claves ni OAuth, solo la URL privada que la persona pega en Ajustes.
/// Entiende: zonas horarias (las repeticiones se calculan EN la zona del evento y luego se pasan a la
/// local, así el cambio de horario de cada país cae bien), UTC, eventos de todo el día, repeticiones
/// diarias, semanales (con días), mensuales (día del mes, «2.º martes», «último viernes») y anuales, con
/// COUNT/UNTIL/INTERVAL, fechas excluidas, ocurrencias movidas (RECURRENCE-ID) y eventos cancelados.
/// Las alarmas (VALARM) no se confunden con el evento.
/// </summary>
public static class Ical
{
    static IEnumerable<string> Desplegar(string ics)
    {
        var actual = new StringBuilder();
        foreach (var l in ics.Replace("\r\n", "\n").Split('\n'))
        {
            if ((l.StartsWith(' ') || l.StartsWith('\t')) && actual.Length > 0) { actual.Append(l, 1, l.Length - 1); continue; }
            if (actual.Length > 0) yield return actual.ToString();
            actual.Clear().Append(l);
        }
        if (actual.Length > 0) yield return actual.ToString();
    }

    static string Texto(string v) => v.Replace("\\n", "\n").Replace("\\N", "\n").Replace("\\,", ",").Replace("\\;", ";").Replace("\\\\", "\\").Trim();

    /// <summary>Una fecha tal como viene: la hora de reloj EN su zona (null = flotante), si es UTC y si es de todo el día.</summary>
    public readonly record struct Momento(DateTime Reloj, TimeZoneInfo? Zona, bool Dia)
    {
        /// <summary>La misma hora de reloj en otra fecha (para repeticiones), convertida a la zona local.</summary>
        public DateTime ALocal(DateTime reloj, TimeZoneInfo local)
        {
            if (Dia || Zona == null) return reloj;
            try { return TimeZoneInfo.ConvertTime(DateTime.SpecifyKind(reloj, DateTimeKind.Unspecified), Zona, local); }
            catch (ArgumentException) { return reloj; } // una hora que no existe en esa zona (el salto de horario)
        }
    }

    public static Momento? Leer(string parametros, string valor)
    {
        valor = valor.Trim();
        if (valor.Length == 8 && DateTime.TryParseExact(valor, "yyyyMMdd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)) return new Momento(d, null, true);
        bool utc = valor.EndsWith('Z');
        if (!DateTime.TryParseExact(valor.TrimEnd('Z'), "yyyyMMdd'T'HHmmss", CultureInfo.InvariantCulture, DateTimeStyles.None, out var t)) return null;
        if (utc) return new Momento(t, TimeZoneInfo.Utc, false);
        var tzid = parametros.Split(';').Select(p => p.Split('=', 2)).FirstOrDefault(p => p.Length == 2 && p[0].Equals("TZID", StringComparison.OrdinalIgnoreCase))?[1].Trim('"');
        if (tzid != null)
        {
            try { return new Momento(t, TimeZoneInfo.FindSystemTimeZoneById(tzid), false); }
            catch (Exception e) when (e is TimeZoneNotFoundException or InvalidTimeZoneException) { }
        }
        return new Momento(t, null, false); // «flotante»: la hora del reloj de quien lo mira
    }

    /// <summary>Compatibilidad: una fecha iCal directamente en hora local.</summary>
    public static (DateTime Local, bool Dia)? Fecha(string parametros, string valor, TimeZoneInfo? zonaLocal = null)
        => Leer(parametros, valor) is { } m ? (m.ALocal(m.Reloj, zonaLocal ?? TimeZoneInfo.Local), m.Dia) : null;

    sealed class Crudo
    {
        public string Uid = "", Titulo = "", Lugar = "", Regla = "", Estado = "";
        public Momento? Inicio, Fin, Recurrencia;
        public TimeSpan? Duracion;
        public List<DateTime> Excluidas = new();
    }

    /// <summary>Los eventos (con sus repeticiones) que caen entre `desde` y `hasta` (hora local), ordenados.</summary>
    public static List<Evento> Eventos(string ics, DateTime desde, DateTime hasta, TimeZoneInfo? zonaLocal = null)
    {
        var local = zonaLocal ?? TimeZoneInfo.Local;
        var crudos = new List<Crudo>();
        Crudo? c = null;
        int anidado = 0; // dentro de VALARM (u otro bloque) las propiedades no son del evento
        foreach (var linea in Desplegar(ics))
        {
            if (linea == "BEGIN:VEVENT") { c = new Crudo(); anidado = 0; continue; }
            if (linea == "END:VEVENT") { if (c != null) crudos.Add(c); c = null; continue; }
            if (c == null) continue;
            if (linea.StartsWith("BEGIN:", StringComparison.Ordinal)) { anidado++; continue; }
            if (linea.StartsWith("END:", StringComparison.Ordinal)) { anidado = Math.Max(0, anidado - 1); continue; }
            if (anidado > 0) continue;
            var dos = linea.IndexOf(':');
            if (dos <= 0) continue;
            var nombreYParams = linea[..dos];
            var valor = linea[(dos + 1)..];
            var pc = nombreYParams.IndexOf(';');
            var nombre = (pc < 0 ? nombreYParams : nombreYParams[..pc]).ToUpperInvariant();
            var parametros = pc < 0 ? "" : nombreYParams[(pc + 1)..];
            switch (nombre)
            {
                case "UID": c.Uid = valor.Trim(); break;
                case "SUMMARY": c.Titulo = Texto(valor); break;
                case "LOCATION": c.Lugar = Texto(valor); break;
                case "STATUS": c.Estado = valor.Trim().ToUpperInvariant(); break;
                case "DTSTART": c.Inicio = Leer(parametros, valor); break;
                case "DTEND": c.Fin = Leer(parametros, valor); break;
                case "DURATION": c.Duracion = Duracion(valor); break;
                case "RRULE": c.Regla = valor; break;
                case "RECURRENCE-ID": c.Recurrencia = Leer(parametros, valor); break;
                case "EXDATE":
                    foreach (var v in valor.Split(','))
                        if (Leer(parametros, v) is { } ex) c.Excluidas.Add(ex.ALocal(ex.Reloj, local));
                    break;
            }
        }
        // Ocurrencias movidas o canceladas de una serie: la serie no las repite en su hora original.
        var movidas = crudos.Where(x => x.Recurrencia != null && x.Uid.Length > 0)
                            .GroupBy(x => x.Uid).ToDictionary(g => g.Key, g => g.Select(x => x.Recurrencia!.Value.ALocal(x.Recurrencia!.Value.Reloj, local)).ToHashSet());
        var salida = new List<Evento>();
        foreach (var e in crudos)
        {
            try
            {
                if (e.Inicio is not { } ini || e.Estado == "CANCELLED") continue;
                var dur = e.Fin is { } fin ? fin.ALocal(fin.Reloj, local) - ini.ALocal(ini.Reloj, local) : e.Duracion ?? (ini.Dia ? TimeSpan.FromDays(1) : TimeSpan.FromHours(1));
                if (dur < TimeSpan.Zero) dur = TimeSpan.FromHours(1);
                var excluidas = e.Excluidas.ToHashSet();
                if (e.Recurrencia == null && movidas.TryGetValue(e.Uid, out var mov)) excluidas.UnionWith(mov);
                // Las repeticiones se calculan en la hora de reloj de SU zona y cada una se convierte.
                var hastaEnZona = hasta.AddDays(2);
                foreach (var reloj in Repeticiones(ini.Reloj, e.Recurrencia == null ? e.Regla : "", hastaEnZona, desde.AddDays(-2)))
                {
                    var inicio = ini.ALocal(reloj, local);
                    if (excluidas.Contains(inicio)) continue;
                    if (inicio + dur <= desde || inicio >= hasta) continue;
                    salida.Add(new Evento(e.Titulo.Length > 0 ? e.Titulo : "(sin título)", inicio, inicio + dur, e.Lugar, ini.Dia));
                }
            }
            catch (Exception ex) when (ex is ArgumentException or FormatException or OverflowException) { /* un evento raro no tumba el calendario */ }
        }
        return salida.OrderBy(x => x.Inicio).ToList();
    }

    static TimeSpan? Duracion(string v)
    {
        try { return System.Xml.XmlConvert.ToTimeSpan(v.Trim()); } catch { return null; }
    }

    static readonly string[] Dias = { "SU", "MO", "TU", "WE", "TH", "FR", "SA" };

    /// <summary>El n-ésimo día de la semana de un mes (n negativo: desde el final). Null si no existe.</summary>
    static DateTime? NEsimo(int anio, int mes, DayOfWeek dia, int n)
    {
        if (n > 0)
        {
            var d = new DateTime(anio, mes, 1);
            while (d.DayOfWeek != dia) d = d.AddDays(1);
            d = d.AddDays(7 * (n - 1));
            return d.Month == mes ? d : null;
        }
        var u = new DateTime(anio, mes, DateTime.DaysInMonth(anio, mes));
        while (u.DayOfWeek != dia) u = u.AddDays(-1);
        u = u.AddDays(7 * (n + 1));
        return u.Month == mes ? u : null;
    }

    /// <summary>
    /// Las fechas (hora de reloj de la zona del evento) de una regla RRULE hasta `hasta`. Sin COUNT, las
    /// series largas se adelantan hasta cerca de `desde` (una reunión diaria desde 2015 sigue apareciendo).
    /// </summary>
    public static IEnumerable<DateTime> Repeticiones(DateTime inicio, string regla, DateTime hasta, DateTime? desde = null)
    {
        if (string.IsNullOrWhiteSpace(regla)) { yield return inicio; yield break; }
        var p = regla.Split(';').Select(x => x.Split('=', 2)).Where(x => x.Length == 2).GroupBy(x => x[0].ToUpperInvariant()).ToDictionary(g => g.Key, g => g.First()[1]);
        var frec = p.GetValueOrDefault("FREQ", "");
        int intervalo = int.TryParse(p.GetValueOrDefault("INTERVAL", "1"), out var iv) && iv > 0 ? iv : 1;
        int? cuenta = int.TryParse(p.GetValueOrDefault("COUNT", ""), out var cn) && cn > 0 ? cn : null;
        DateTime? until = p.TryGetValue("UNTIL", out var u) && Leer("", u) is { } uu ? uu.Reloj : null;
        var limite = until is { } ul && ul < hasta ? ul : hasta;
        var porDia = (p.TryGetValue("BYDAY", out var bd) ? bd : "").Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Where(x => x.Length >= 2 && Array.IndexOf(Dias, x[^2..]) >= 0)
            .Select(x => (Dia: (DayOfWeek)Array.IndexOf(Dias, x[^2..]), N: int.TryParse(x[..^2], out var n) ? n : 0)).ToList();
        int? diaDelMes = int.TryParse(p.GetValueOrDefault("BYMONTHDAY", ""), out var dm) ? dm : null;
        var hora = inicio.TimeOfDay;
        int emitidas = 0;

        // Adelantar sin COUNT: se salta de un bloque de periodos completos hasta cerca de `desde`.
        long saltos = 0;
        if (cuenta == null && desde is { } ds && ds > inicio)
        {
            double periodoDias = frec switch { "DAILY" => intervalo, "WEEKLY" => 7 * intervalo, "MONTHLY" => 28 * intervalo, "YEARLY" => 365 * intervalo, _ => 0 };
            if (periodoDias > 0) saltos = Math.Max(0, (long)((ds - inicio).TotalDays / periodoDias) - 2);
        }

        for (long k = saltos; k < saltos + 5000; k++)
        {
            IEnumerable<DateTime> candidatas;
            switch (frec)
            {
                case "DAILY": candidatas = new[] { inicio.AddDays(k * intervalo) }; break;
                case "WEEKLY":
                {
                    var semana = inicio.Date.AddDays(-(((int)inicio.DayOfWeek + 6) % 7)).AddDays(7 * k * intervalo);
                    candidatas = porDia.Count == 0 ? new[] { inicio.AddDays(7 * k * intervalo) }
                        : Enumerable.Range(0, 7).Select(i => semana.AddDays(i)).Where(d => porDia.Any(x => x.Dia == d.DayOfWeek)).Select(d => d.Add(hora));
                    break;
                }
                case "MONTHLY":
                {
                    var mes = new DateTime(inicio.Year, inicio.Month, 1).AddMonths((int)(k * intervalo));
                    if (porDia.Count > 0)
                        candidatas = porDia.Select(x => x.N != 0 ? NEsimo(mes.Year, mes.Month, x.Dia, x.N)
                                                                  : (DateTime?)null).Where(d => d != null).Select(d => d!.Value.Add(hora));
                    else
                    {
                        int dia = diaDelMes ?? inicio.Day;
                        if (dia < 0) dia = DateTime.DaysInMonth(mes.Year, mes.Month) + dia + 1;
                        candidatas = dia >= 1 && dia <= DateTime.DaysInMonth(mes.Year, mes.Month) ? new[] { new DateTime(mes.Year, mes.Month, dia).Add(hora) } : Array.Empty<DateTime>();
                    }
                    break;
                }
                case "YEARLY":
                {
                    int anio = inicio.Year + (int)(k * intervalo);
                    candidatas = inicio.Day <= DateTime.DaysInMonth(anio, inicio.Month) ? new[] { new DateTime(anio, inicio.Month, inicio.Day).Add(hora) } : Array.Empty<DateTime>();
                    break;
                }
                default: yield return inicio; yield break;
            }
            bool pasado = false;
            foreach (var d in candidatas.OrderBy(x => x))
            {
                if (d < inicio) continue;
                if (d > limite) { pasado = true; break; }
                if (cuenta is { } c && emitidas >= c) yield break;
                emitidas++;
                yield return d;
            }
            if (pasado) yield break;
        }
    }

    /// <summary>Cómo se dice un evento: «a las 3:00 de la tarde, Junta directiva (Sala 2)».</summary>
    public static string Decir(Evento e, string idioma)
    {
        var en = idioma == "en";
        int h12 = e.Inicio.Hour % 12 == 0 ? 12 : e.Inicio.Hour % 12;
        var hora = e.TodoElDia ? (en ? "all day" : "todo el día")
            : en ? $"at {h12}:{e.Inicio.Minute:00} {(e.Inicio.Hour < 12 ? "a.m." : "p.m.")}"
            : $"a {(h12 == 1 ? "la" : "las")} {h12}:{e.Inicio.Minute:00} {(e.Inicio.Hour < 12 ? "de la mañana" : e.Inicio.Hour < 19 ? "de la tarde" : "de la noche")}";
        return $"{hora}, {e.Titulo}{(e.Lugar.Length > 0 ? $" ({e.Lugar})" : "")}";
    }
}
