using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Aura.Windows.Core;
using MailKit;
using MailKit.Net.Imap;
using MailKit.Search;
using MimeKit;

namespace Aura.Windows.Manos;

/// <summary>
/// Un buzón, sea por IMAP, Gmail u Outlook: los no leídos y la vigilancia que avisa en el notch de los
/// NUEVOS (lo que ya estaba al arrancar no se anuncia; se recuerda qué ids ya se vieron).
/// </summary>
internal abstract class Buzon : IDisposable
{
    CancellationTokenSource? vigia;
    readonly HashSet<string> vistos = new();
    bool primera = true;
    public event Action<Carta>? Nuevo;
    public event Action<string>? Fallo;
    public abstract string Direccion { get; }
    public abstract Task<List<Carta>> NoLeidos(int max = 10, CancellationToken ct = default);

    /// <summary>Prueba la conexión: el número de no leídos, o una excepción con el motivo.</summary>
    public async Task<int> Probar(CancellationToken ct = default) => (await NoLeidos(50, ct)).Count;

    /// <summary>Los ids cambiaron de sentido (IMAP renumeró la bandeja): se vuelve a tomar la foto sin anunciar.</summary>
    protected void Reiniciar() { lock (vistos) { vistos.Clear(); primera = true; } }

    /// <summary>Revisa cada minuto y avisa de lo NUEVO.</summary>
    public void Vigilar()
    {
        vigia?.Cancel();
        var cts = vigia = new CancellationTokenSource();
        _ = Task.Run(async () =>
        {
            int fallos = 0;
            while (!cts.IsCancellationRequested)
            {
                try
                {
                    var cartas = await NoLeidos(10, cts.Token);
                    List<Carta> nuevas;
                    lock (vistos)
                    {
                        nuevas = cartas.Where(x => vistos.Add(x.Id)).OrderBy(x => x.Fecha).ToList();
                        if (primera) { nuevas.Clear(); primera = false; }
                        if (vistos.Count > 2000) { vistos.Clear(); foreach (var x in cartas) vistos.Add(x.Id); }
                    }
                    foreach (var carta in nuevas) Nuevo?.Invoke(carta);
                    fallos = 0;
                }
                catch (OperationCanceledException) when (cts.IsCancellationRequested) { break; }
                catch (Exception ex) { if (++fallos == 3) Fallo?.Invoke(ex is OperationCanceledException ? "El correo no respondió a tiempo." : ex.Message); }
                try { await Task.Delay(TimeSpan.FromSeconds(fallos > 0 ? Math.Min(600, 60 * fallos) : 60), cts.Token); } catch { break; }
            }
        });
    }

    public virtual void Dispose() => vigia?.Cancel();
}

/// <summary>Gmail u Outlook por su API (con la cuenta conectada en Ajustes → Conexiones).</summary>
internal sealed class BuzonApi : Buzon
{
    readonly Func<int, CancellationToken, Task<List<Carta>>> leer;
    readonly string direccion;
    public BuzonApi(string direccion, Func<int, CancellationToken, Task<List<Carta>>> leer) { this.direccion = direccion; this.leer = leer; }
    public override string Direccion => direccion;
    public override Task<List<Carta>> NoLeidos(int max = 10, CancellationToken ct = default) => leer(max, ct);
}

/// <summary>
/// El correo por IMAP, desde este equipo: Gmail (con «contraseña de aplicación»), Yahoo, iCloud y
/// cualquier servidor IMAP. Revisa cada minuto los no leídos de la bandeja y avisa en el notch de los
/// NUEVOS. Solo lee (la bandeja se abre en modo lectura: nada se marca como leído ni se borra). Los
/// correos no salen de la PC salvo que pidas «resume mis correos» (entonces va el texto al cerebro).
/// </summary>
internal sealed class Correo : Buzon
{
    readonly string direccion, clave, servidor;
    readonly int puerto;
    uint validez;
    public override string Direccion => direccion;

    public Correo(string direccion, string clave, string? servidor = null)
    {
        this.direccion = direccion.Trim();
        (this.servidor, puerto) = servidor is { Length: > 0 } ? (servidor, 993) : Servidor(this.direccion);
        // La contraseña de aplicación de Google viene en grupos de 4 con espacios; otras claves pueden llevarlos.
        this.clave = this.servidor.Contains("gmail", StringComparison.OrdinalIgnoreCase) ? clave.Replace(" ", "") : clave;
    }

    /// <summary>El servidor IMAP de los proveedores comunes, por el dominio de la dirección.</summary>
    public static (string, int) Servidor(string direccion)
    {
        var d = direccion.Split('@').LastOrDefault()?.ToLowerInvariant() ?? "";
        return d switch
        {
            "gmail.com" or "googlemail.com" => ("imap.gmail.com", 993),
            "yahoo.com" or "yahoo.es" or "ymail.com" => ("imap.mail.yahoo.com", 993),
            "icloud.com" or "me.com" or "mac.com" => ("imap.mail.me.com", 993),
            "outlook.com" or "hotmail.com" or "live.com" or "msn.com" => ("outlook.office365.com", 993),
            _ => ("imap." + d, 993),
        };
    }

    async Task<ImapClient> Conectar(CancellationToken ct)
    {
        var c = new ImapClient { Timeout = 15000 };
        await c.ConnectAsync(servidor, puerto, MailKit.Security.SecureSocketOptions.SslOnConnect, ct);
        try { await c.AuthenticateAsync(direccion, clave, ct); }
        catch (MailKit.Security.AuthenticationException)
        {
            c.Dispose();
            throw new InvalidOperationException(servidor.Contains("gmail")
                ? "Gmail no aceptó la clave. Usa una «contraseña de aplicación» (Cuenta de Google → Seguridad → Verificación en 2 pasos → Contraseñas de aplicaciones)."
                : servidor.Contains("office365") ? "Outlook ya no acepta contraseñas por IMAP: conéctalo con «Conectar Microsoft» en Ajustes → Conexiones."
                : "El servidor de correo no aceptó la dirección o la clave.");
        }
        return c;
    }

    /// <summary>Los últimos no leídos (lo más nuevo primero).</summary>
    public override async Task<List<Carta>> NoLeidos(int max = 10, CancellationToken ct = default)
    {
        using var c = await Conectar(ct);
        var bandeja = c.Inbox;
        await bandeja.OpenAsync(FolderAccess.ReadOnly, ct);
        // Si el servidor renumeró la bandeja (UIDVALIDITY), los números viejos ya no sirven: se vuelve a empezar sin anunciar todo.
        if (bandeja.UidValidity != validez) { if (validez != 0) Reiniciar(); validez = bandeja.UidValidity; }
        var ids = await bandeja.SearchAsync(SearchQuery.NotSeen.And(SearchQuery.DeliveredAfter(DateTime.Now.AddDays(-14))), ct);
        var ultimos = ids.OrderByDescending(i => i.Id).Take(max).ToList();
        var lista = new List<Carta>();
        if (ultimos.Count > 0)
        {
            foreach (var r in await bandeja.FetchAsync(ultimos, MessageSummaryItems.Envelope | MessageSummaryItems.UniqueId | MessageSummaryItems.PreviewText, ct))
            {
                var de = r.Envelope.From.Mailboxes.FirstOrDefault();
                lista.Add(new Carta(r.UniqueId.Id.ToString(System.Globalization.CultureInfo.InvariantCulture), de?.Name is { Length: > 0 } n ? n : de?.Address ?? "", r.Envelope.Subject ?? "(sin asunto)", (r.PreviewText ?? "").Trim(), r.Envelope.Date ?? DateTimeOffset.Now));
            }
        }
        await c.DisconnectAsync(true, ct);
        return lista.OrderByDescending(x => x.Fecha).ToList();
    }
}


/// <summary>
/// La agenda: desde la URL privada iCal, o desde Google Calendar / Outlook con la cuenta conectada.
/// Avisa 10 min antes de cada evento.
/// </summary>
internal sealed class AgendaCuenta : IDisposable
{
    readonly Func<DateTime, DateTime, CancellationToken, Task<List<Evento>>> fuente;
    readonly HttpClient? http;
    public string Nombre { get; }
    List<Evento> eventos = new();
    readonly HashSet<string> avisados = new();
    CancellationTokenSource? vigia;
    public event Action<Evento>? Pronto;
    public event Action<string>? Fallo;

    public AgendaCuenta(string url)
    {
        http = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
        Nombre = "iCal";
        url = url.Trim();
        if (url.StartsWith("webcal://", StringComparison.OrdinalIgnoreCase) || url.StartsWith("webcals://", StringComparison.OrdinalIgnoreCase))
            url = "https://" + url[(url.IndexOf("://", StringComparison.Ordinal) + 3)..];
        if (!Commands.SafeHttps(url)) throw new InvalidOperationException("La dirección del calendario tiene que ser https (o webcal).");
        var h = http;
        fuente = async (desde, hasta, ct) =>
        {
            var ics = await h.GetStringAsync(url, ct);
            if (!ics.Contains("BEGIN:VCALENDAR")) throw new InvalidOperationException("Esa dirección no es un calendario iCal.");
            return Ical.Eventos(ics, desde, hasta);
        };
    }

    /// <summary>Google Calendar u Outlook por su API.</summary>
    public AgendaCuenta(string nombre, Func<DateTime, DateTime, CancellationToken, Task<List<Evento>>> fuente) { Nombre = nombre; this.fuente = fuente; }

    public async Task<List<Evento>> Cargar(CancellationToken ct = default)
    {
        eventos = await fuente(DateTime.Now.Date.AddDays(-1), DateTime.Now.Date.AddDays(15), ct);
        return eventos;
    }

    public List<Evento> Entre(DateTime desde, DateTime hasta) => eventos.Where(e => e.Fin > desde && e.Inicio < hasta).ToList();

    public void Vigilar()
    {
        vigia?.Cancel();
        var cts = vigia = new CancellationTokenSource();
        _ = Task.Run(async () =>
        {
            var recargar = DateTime.MinValue;
            int fallos = 0;
            while (!cts.IsCancellationRequested)
            {
                try
                {
                    if (DateTime.Now >= recargar) { await Cargar(cts.Token); recargar = DateTime.Now.AddMinutes(15); fallos = 0; }
                    foreach (var e in eventos.Where(e => !e.TodoElDia && e.Inicio > DateTime.Now && e.Inicio - DateTime.Now <= TimeSpan.FromMinutes(10)))
                        if (avisados.Add(e.Titulo + e.Inicio.Ticks)) Pronto?.Invoke(e);
                }
                catch (OperationCanceledException) when (cts.IsCancellationRequested) { break; }
                catch (Exception ex)
                {
                    // Un corte de red pasajero no merece aviso; tres seguidos, sí (una vez).
                    if (++fallos == 3) Fallo?.Invoke(ex is OperationCanceledException ? "El calendario no respondió a tiempo." : ex.Message);
                    recargar = DateTime.Now.AddMinutes(fallos < 3 ? 2 : 15);
                }
                try { await Task.Delay(TimeSpan.FromSeconds(30), cts.Token); } catch { break; }
            }
        });
    }

    public void Dispose() { vigia?.Cancel(); http?.Dispose(); }
}
