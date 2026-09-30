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

/// <summary>Un correo, lo justo para avisar y leer: de quién, asunto, un trozo y cuándo.</summary>
internal sealed record Carta(uint Id, string De, string Asunto, string Resumen, DateTimeOffset Fecha);

/// <summary>
/// El correo por IMAP, desde este equipo: Gmail (con «contraseña de aplicación»), Yahoo, iCloud y
/// cualquier servidor IMAP. Revisa cada minuto los no leídos de la bandeja y avisa en el notch de los
/// NUEVOS. Solo lee (la bandeja se abre en modo lectura: nada se marca como leído ni se borra). Los
/// correos no salen de la PC salvo que pidas «resume mis correos» (entonces va el texto al cerebro).
/// </summary>
internal sealed class Correo : IDisposable
{
    readonly string direccion, clave, servidor;
    readonly int puerto;
    CancellationTokenSource? vigia;
    uint mayorVisto;
    bool primera = true;
    public event Action<Carta>? Nuevo;
    public event Action<string>? Fallo;
    public string Direccion => direccion;

    public Correo(string direccion, string clave, string? servidor = null)
    {
        this.direccion = direccion.Trim();
        this.clave = clave.Replace(" ", ""); // la contraseña de aplicación de Google viene en grupos de 4
        (this.servidor, puerto) = servidor is { Length: > 0 } ? (servidor, 993) : Servidor(this.direccion);
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
                : servidor.Contains("office365") ? "Outlook ya no acepta contraseñas por IMAP (pide inicio de sesión moderno). Por ahora usa Gmail, Yahoo o iCloud."
                : "El servidor de correo no aceptó la dirección o la clave.");
        }
        return c;
    }

    /// <summary>Los últimos no leídos (lo más nuevo primero).</summary>
    public async Task<List<Carta>> NoLeidos(int max = 10, CancellationToken ct = default)
    {
        using var c = await Conectar(ct);
        var bandeja = c.Inbox;
        await bandeja.OpenAsync(FolderAccess.ReadOnly, ct);
        var ids = await bandeja.SearchAsync(SearchQuery.NotSeen.And(SearchQuery.DeliveredAfter(DateTime.Now.AddDays(-14))), ct);
        var ultimos = ids.OrderByDescending(i => i.Id).Take(max).ToList();
        var lista = new List<Carta>();
        if (ultimos.Count > 0)
        {
            foreach (var r in await bandeja.FetchAsync(ultimos, MessageSummaryItems.Envelope | MessageSummaryItems.UniqueId | MessageSummaryItems.PreviewText, ct))
            {
                var de = r.Envelope.From.Mailboxes.FirstOrDefault();
                lista.Add(new Carta(r.UniqueId.Id, de?.Name is { Length: > 0 } n ? n : de?.Address ?? "", r.Envelope.Subject ?? "(sin asunto)", (r.PreviewText ?? "").Trim(), r.Envelope.Date ?? DateTimeOffset.Now));
            }
        }
        await c.DisconnectAsync(true, ct);
        return lista.OrderByDescending(x => x.Id).ToList();
    }

    /// <summary>Prueba la conexión: el número de no leídos, o una excepción con el motivo.</summary>
    public async Task<int> Probar(CancellationToken ct = default) => (await NoLeidos(50, ct)).Count;

    /// <summary>Revisa cada minuto y avisa de lo NUEVO (lo que ya estaba al arrancar no se anuncia).</summary>
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
                    foreach (var carta in cartas.Where(x => x.Id > mayorVisto).OrderBy(x => x.Id))
                        if (!primera) Nuevo?.Invoke(carta);
                    if (cartas.Count > 0) mayorVisto = Math.Max(mayorVisto, cartas.Max(x => x.Id));
                    primera = false; fallos = 0;
                }
                catch (OperationCanceledException) { break; }
                catch (Exception ex) { if (++fallos == 3) Fallo?.Invoke(ex.Message); }
                try { await Task.Delay(TimeSpan.FromSeconds(fallos > 0 ? Math.Min(600, 60 * fallos) : 60), cts.Token); } catch { break; }
            }
        });
    }

    public void Dispose() => vigia?.Cancel();
}

/// <summary>La agenda desde la URL privada iCal (Google Calendar, Outlook, iCloud): avisa 10 min antes.</summary>
internal sealed class AgendaCuenta : IDisposable
{
    readonly string url;
    readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(20) };
    List<Evento> eventos = new();
    readonly HashSet<string> avisados = new();
    CancellationTokenSource? vigia;
    public event Action<Evento>? Pronto;
    public event Action<string>? Fallo;

    public AgendaCuenta(string url)
    {
        if (!Commands.SafeHttps(url.Replace("webcal://", "https://"))) throw new InvalidOperationException("La dirección del calendario tiene que ser https (o webcal).");
        this.url = url.Replace("webcal://", "https://");
    }

    public async Task<List<Evento>> Cargar(CancellationToken ct = default)
    {
        var ics = await http.GetStringAsync(url, ct);
        if (!ics.Contains("BEGIN:VCALENDAR")) throw new InvalidOperationException("Esa dirección no es un calendario iCal.");
        eventos = Ical.Eventos(ics, DateTime.Now.Date.AddDays(-1), DateTime.Now.Date.AddDays(15));
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
            while (!cts.IsCancellationRequested)
            {
                try
                {
                    if (DateTime.Now >= recargar) { await Cargar(cts.Token); recargar = DateTime.Now.AddMinutes(15); }
                    foreach (var e in eventos.Where(e => !e.TodoElDia && e.Inicio > DateTime.Now && e.Inicio - DateTime.Now <= TimeSpan.FromMinutes(10)))
                        if (avisados.Add(e.Titulo + e.Inicio.Ticks)) Pronto?.Invoke(e);
                }
                catch (OperationCanceledException) { break; }
                catch (Exception ex) { Fallo?.Invoke(ex.Message); recargar = DateTime.Now.AddMinutes(15); }
                try { await Task.Delay(TimeSpan.FromSeconds(30), cts.Token); } catch { break; }
            }
        });
    }

    public void Dispose() { vigia?.Cancel(); http.Dispose(); }
}
