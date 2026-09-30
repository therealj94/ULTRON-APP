using System.Globalization;
using System.Text;

namespace Aura.Windows.Core;

/// <summary>Un evento del calendario, ya en hora local.</summary>
public sealed record Evento(string Titulo, DateTime Inicio, DateTime Fin, string Lugar, bool TodoElDia);

/// <summary>
/// Lee un calendario iCal (la «dirección secreta en formato iCal» de Google Calendar, Outlook o iCloud):
/// sin claves ni OAuth, solo la URL privada que la persona pega en Ajustes. Entiende eventos con zona
/// horaria, en UTC, de todo el día y las repeticiones comunes (diaria, semanal con días, mensual,
/// anual, con COUNT/UNTIL/INTERVAL y fechas excluidas).
/// </summary>
public static class Ical
{
    static IEnumerable<string> Desplegar(string ics)
    {
        var lineas = ics.Replace("\r\n", "\n").Split('\n');
        var actual = new StringBuilder();
        foreach (var l in lineas)
        {
            if ((l.StartsWith(' ') || l.StartsWith('\t')) && actual.Length > 0) { actual.Append(l, 1, l.Length - 1); continue; }
            if (actual.Length > 0) yield return actual.ToString();
            actual.Clear().Append(l);
        }
        if (actual.Length > 0) yield return actual.ToString();
    }

    static string Texto(string v) => v.Replace("\\n", "\n").Replace("\\N", "\n").Replace("\\,", ",").Replace("\\;", ";").Replace("\\\\", "\\").Trim();

    /// <summary>Una fecha iCal («20260930T150000Z», «20260930T150000» con TZID, «20260930» de todo el día) en hora local.</summary>
    public static (DateTime Local, bool Dia)? Fecha(string parametros, string valor, TimeZoneInfo? zonaLocal = null)
    {
        zonaLocal ??= TimeZoneInfo.Local;
        valor = valor.Trim();
        if (valor.Length == 8 && DateTime.TryParseExact(valor, "yyyyMMdd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)) return (d, true);
        bool utc = valor.EndsWith('Z');
        if (!DateTime.TryParseExact(valor.TrimEnd('Z'), "yyyyMMdd'T'HHmmss", CultureInfo.InvariantCulture, DateTimeStyles.None, out var t)) return null;
        if (utc) return (TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(t, DateTimeKind.Utc), zonaLocal), false);
        var tzid = parametros.Split(';').Select(p => p.Split('=', 2)).FirstOrDefault(p => p.Length == 2 && p[0].Equals("TZID", StringComparison.OrdinalIgnoreCase))?[1].Trim('"');
        if (tzid != null)
        {
            try
            {
                var zona = TimeZoneInfo.FindSystemTimeZoneById(tzid);
                return (TimeZoneInfo.ConvertTime(DateTime.SpecifyKind(t, DateTimeKind.Unspecified), zona, zonaLocal), false);
            }
            catch (Exception e) when (e is TimeZoneNotFoundException or InvalidTimeZoneException) { }
        }
        return (t, false); // «flotante»: la hora del reloj de quien lo mira
    }

    sealed class Crudo
    {
        public string Titulo = "", Lugar = "", Regla = "";
        public (DateTime Local, bool Dia)? Inicio, Fin;
        public TimeSpan? Duracion;
        public HashSet<DateTime> Excluidas = new();
    }

    /// <summary>Los eventos (con sus repeticiones) que caen entre `desde` y `hasta`, ordenados.</summary>
    public static List<Evento> Eventos(string ics, DateTime desde, DateTime hasta, TimeZoneInfo? zonaLocal = null)
    {
        var crudos = new List<Crudo>();
        Crudo? c = null;
        foreach (var linea in Desplegar(ics))
        {
            if (linea == "BEGIN:VEVENT") { c = new Crudo(); continue; }
            if (linea == "END:VEVENT") { if (c != null) crudos.Add(c); c = null; continue; }
            if (c == null) continue;
            var dos = linea.IndexOf(':');
            if (dos <= 0) continue;
            var nombreYParams = linea[..dos];
            var valor = linea[(dos + 1)..];
            var pc = nombreYParams.IndexOf(';');
            var nombre = (pc < 0 ? nombreYParams : nombreYParams[..pc]).ToUpperInvariant();
            var parametros = pc < 0 ? "" : nombreYParams[(pc + 1)..];
            switch (nombre)
            {
                case "SUMMARY": c.Titulo = Texto(valor); break;
                case "LOCATION": c.Lugar = Texto(valor); break;
                case "DTSTART": c.Inicio = Fecha(parametros, valor, zonaLocal); break;
                case "DTEND": c.Fin = Fecha(parametros, valor, zonaLocal); break;
                case "DURATION": c.Duracion = Duracion(valor); break;
                case "RRULE": c.Regla = valor; break;
                case "EXDATE":
                    foreach (var v in valor.Split(','))
                        if (Fecha(parametros, v, zonaLocal) is { } ex) c.Excluidas.Add(ex.Local);
                    break;
            }
        }
        var salida = new List<Evento>();
        foreach (var e in crudos)
        {
            if (e.Inicio is not { } ini) continue;
            var dur = e.Fin is { } fin ? fin.Local - ini.Local : e.Duracion ?? (ini.Dia ? TimeSpan.FromDays(1) : TimeSpan.FromHours(1));
            foreach (var inicio in Repeticiones(ini.Local, e.Regla, hasta))
            {
                if (e.Excluidas.Contains(inicio)) continue;
                if (inicio + dur <= desde || inicio >= hasta) continue;
                salida.Add(new Evento(e.Titulo.Length > 0 ? e.Titulo : "(sin título)", inicio, inicio + dur, e.Lugar, ini.Dia));
            }
        }
        return salida.OrderBy(x => x.Inicio).ToList();
    }

    static TimeSpan? Duracion(string v)
    {
        try { return System.Xml.XmlConvert.ToTimeSpan(v.Trim()); } catch { return null; }
    }

    static readonly string[] Dias = { "SU", "MO", "TU", "WE", "TH", "FR", "SA" };

    /// <summary>Las fechas de inicio de una regla RRULE (hasta `hasta`, con un tope de 3000 para no colgarse).</summary>
    public static IEnumerable<DateTime> Repeticiones(DateTime inicio, string regla, DateTime hasta)
    {
        if (string.IsNullOrWhiteSpace(regla)) { yield return inicio; yield break; }
        var p = regla.Split(';').Select(x => x.Split('=', 2)).Where(x => x.Length == 2).ToDictionary(x => x[0].ToUpperInvariant(), x => x[1]);
        var frec = p.GetValueOrDefault("FREQ", "");
        int intervalo = int.TryParse(p.GetValueOrDefault("INTERVAL", "1"), out var iv) && iv > 0 ? iv : 1;
        int? cuenta = int.TryParse(p.GetValueOrDefault("COUNT", ""), out var cn) ? cn : null;
        DateTime? until = p.TryGetValue("UNTIL", out var u) && Fecha("", u) is { } uu ? uu.Local : null;
        var limite = until is { } ul && ul < hasta ? ul : hasta;
        var dias = p.TryGetValue("BYDAY", out var bd) ? bd.Split(',').Select(d => Array.IndexOf(Dias, d[^2..])).Where(i => i >= 0).ToHashSet() : null;
        int emitidas = 0, vueltas = 0;
        var cursor = inicio;
        while (cursor <= limite && vueltas++ < 3000)
        {
            if (frec == "WEEKLY" && dias is { Count: > 0 })
            {
                var lunes = cursor.AddDays(-(((int)cursor.DayOfWeek + 6) % 7));
                for (int k = 0; k < 7; k++)
                {
                    var d = lunes.AddDays(k);
                    if (d < inicio || !dias.Contains((int)d.DayOfWeek)) continue;
                    if (d > limite || cuenta is { } c1 && emitidas >= c1) yield break;
                    emitidas++; yield return d;
                }
                cursor = lunes.AddDays(7 * intervalo).Add(inicio.TimeOfDay);
                continue;
            }
            if (cuenta is { } c2 && emitidas >= c2) yield break;
            emitidas++; yield return cursor;
            cursor = frec switch
            {
                "DAILY" => cursor.AddDays(intervalo),
                "WEEKLY" => cursor.AddDays(7 * intervalo),
                "MONTHLY" => cursor.AddMonths(intervalo),
                "YEARLY" => cursor.AddYears(intervalo),
                _ => limite.AddTicks(1),
            };
        }
    }

    /// <summary>Cómo se dice un evento: «a las 3:00 PM, Junta directiva (Sala 2)».</summary>
    public static string Decir(Evento e, string idioma)
    {
        var en = idioma == "en";
        var hora = e.TodoElDia ? (en ? "all day" : "todo el día") : (en ? "at " : "a las ") + e.Inicio.ToString("h:mm tt", CultureInfo.InvariantCulture).Replace("AM", en ? "AM" : "de la mañana").Replace("PM", en ? "PM" : (e.Inicio.Hour >= 19 ? "de la noche" : "de la tarde"));
        return $"{hora}, {e.Titulo}{(e.Lugar.Length > 0 ? $" ({e.Lugar})" : "")}";
    }
}
