using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Aura.Windows.Core;

namespace Aura.Windows.Manos;

/// <summary>
/// Una cuenta conectada con OAuth (Spotify, Google, Microsoft): entrar por el navegador, renovar el
/// token sola y pedir a su API. El token vive cifrado con DPAPI en los ajustes; cada renovación se
/// guarda (Spotify y Microsoft cambian el refresh token al renovar).
/// </summary>
internal sealed class Conexion : IDisposable
{
    public ProveedorConfig Config { get; }
    TokenOauth token;
    readonly Action<TokenOauth> guardar;
    readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(20) };
    readonly SemaphoreSlim renovando = new(1, 1);
    public string Cuenta => token.Cuenta;

    public Conexion(ProveedorConfig config, TokenOauth token, Action<TokenOauth> guardar)
    {
        Config = config; this.token = token; this.guardar = guardar;
        http.DefaultRequestHeaders.UserAgent.ParseAdd("AURA-Windows/1.3");
    }

    // ───────────── entrar ─────────────

    /// <summary>La página de éxito/fallo que ve la persona en el navegador al volver.</summary>
    static string Pagina(bool ok, string texto) =>
        "<!doctype html><meta charset=utf-8><title>AURA</title><body style=\"background:#0a0a0c;color:#fff;font-family:Segoe UI,sans-serif;display:grid;place-items:center;height:90vh\">"
        + $"<div style=\"text-align:center\"><div style=\"font-size:44px\">{(ok ? "✓" : "✕")}</div><h2>{WebUtility.HtmlEncode(texto)}</h2><p style=\"color:#999\">Ya puedes cerrar esta pestaña y volver a AURA.</p></div>";

    /// <summary>
    /// Abre el navegador en la página del servicio y espera la vuelta en 127.0.0.1:43821 (solo este
    /// equipo; un socket propio, sin HttpListener, que en Windows pediría permisos de administrador).
    /// `abrir` es quién abre la URL (el navegador; en las pruebas, un cliente HTTP).
    /// </summary>
    public static async Task<TokenOauth> Entrar(ProveedorConfig c, Func<string, Task>? abrir = null, CancellationToken ct = default, Action<string>? alAbrir = null)
    {
        if (string.IsNullOrWhiteSpace(c.ClientId)) throw new InvalidOperationException($"Falta el Client ID de {c.Nombre} (Ajustes → Conexiones, o ponlo en el servidor).");
        var (verificador, reto) = Oauth.Pkce();
        var estado = Oauth.Estado();
        TcpListener escucha;
        try { escucha = new TcpListener(IPAddress.Loopback, Oauth.Puerto); escucha.Start(); }
        catch (SocketException) { throw new InvalidOperationException($"El puerto {Oauth.Puerto} está ocupado (¿otra ventana de conexión abierta?). Ciérrala y vuelve a intentar."); }
        string codigo;
        using (var limite = CancellationTokenSource.CreateLinkedTokenSource(ct))
        {
            limite.CancelAfter(TimeSpan.FromMinutes(5));
            try
            {
                var url = Oauth.UrlAutorizar(c, reto, estado);
                alAbrir?.Invoke(url);
                if (abrir != null) _ = abrir(url);
                else Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
                while (true)
                {
                    using var cli = await escucha.AcceptTcpClientAsync(limite.Token);
                    using var st = cli.GetStream();
                    st.ReadTimeout = 5000;
                    var buf = new byte[8192]; int n = 0;
                    while (n < buf.Length)
                    {
                        int r = await st.ReadAsync(buf.AsMemory(n), limite.Token);
                        if (r <= 0) break;
                        n += r;
                        if (Encoding.ASCII.GetString(buf, 0, n).Contains("\r\n\r\n")) break;
                    }
                    var linea = Encoding.ASCII.GetString(buf, 0, n).Split("\r\n")[0].Split(' ');
                    if (linea.Length < 2 || !linea[1].StartsWith("/callback", StringComparison.Ordinal))
                    {
                        // favicon u otra cosa del navegador: no es la vuelta
                        await Responder(st, 404, "", limite.Token);
                        continue;
                    }
                    try
                    {
                        codigo = Oauth.CodigoDe(linea[1], estado);
                        await Responder(st, 200, Pagina(true, $"{c.Nombre} quedó conectado"), limite.Token);
                        break;
                    }
                    catch (InvalidOperationException ex)
                    {
                        await Responder(st, 400, Pagina(false, ex.Message), limite.Token);
                        throw;
                    }
                }
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                throw new InvalidOperationException("Pasaron 5 minutos sin volver del navegador. Vuelve a intentarlo.");
            }
            finally { escucha.Stop(); }
        }
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
        var t = await PedirToken(http, c, Oauth.Canje(c, codigo, verificador), null, ct);
        if (string.IsNullOrEmpty(t.Renovar)) throw new InvalidOperationException($"{c.Nombre} no dio permiso duradero (sin refresh token). Vuelve a conectar.");
        // Con qué cuenta se entró, para mostrarlo en Ajustes (si falla, no importa).
        try
        {
            var yo = c.Id switch { Proveedor.Google => "https://openidconnect.googleapis.com/v1/userinfo", Proveedor.Microsoft => c.Api + "/v1.0/me", _ => c.Api + "/v1/me" };
            if (c.Id == Proveedor.Google && !c.Api.Contains("googleapis.com")) yo = c.Api + "/oauth2/v3/userinfo";
            using var req = new HttpRequestMessage(HttpMethod.Get, yo);
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", t.Acceso);
            using var r = await http.SendAsync(req, ct);
            if (r.IsSuccessStatusCode) t = t with { Cuenta = LectorApis.Cuenta(await r.Content.ReadAsStringAsync(ct)) };
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException) { }
        return t;
    }

    static async Task Responder(NetworkStream st, int codigo, string html, CancellationToken ct)
    {
        var cuerpo = Encoding.UTF8.GetBytes(html);
        var cab = Encoding.ASCII.GetBytes($"HTTP/1.1 {codigo} {(codigo == 200 ? "OK" : codigo == 404 ? "Not Found" : "Bad Request")}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {cuerpo.Length}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n");
        await st.WriteAsync(cab, ct); await st.WriteAsync(cuerpo, ct);
    }

    static async Task<TokenOauth> PedirToken(HttpClient http, ProveedorConfig c, Dictionary<string, string> form, TokenOauth? anterior, CancellationToken ct)
    {
        using var r = await http.PostAsync(c.TokenUrl, new FormUrlEncodedContent(form), ct);
        var cuerpo = await r.Content.ReadAsStringAsync(ct);
        try { return Oauth.LeerToken(cuerpo, anterior, DateTimeOffset.UtcNow); }
        catch (System.Text.Json.JsonException) { throw new InvalidOperationException($"{c.Nombre} contestó algo raro al pedir el token ({(int)r.StatusCode})."); }
    }

    // ───────────── usar ─────────────

    /// <summary>
    /// Un token vivo: si venció, o si la API rechazó `rechazado`, se renueva UNA vez aunque lo pidan varios
    /// a la vez (el segundo en llegar ve que ya cambió y usa el nuevo).
    /// </summary>
    async Task<string> Acceso(CancellationToken ct, string? rechazado = null)
    {
        bool Sirve() => rechazado != null ? token.Acceso != rechazado : !token.Vencido(DateTimeOffset.UtcNow);
        if (rechazado == null && Sirve()) return token.Acceso;
        await renovando.WaitAsync(ct);
        try
        {
            if (Sirve()) return token.Acceso;
            try { token = await PedirToken(http, Config, Oauth.Renovacion(Config, token.Renovar), token, ct); }
            catch (InvalidOperationException ex) when (ex.Message.StartsWith("invalid_grant"))
            {
                throw new InvalidOperationException($"{Config.Nombre} ya no acepta el permiso (lo quitaste o venció). Vuelve a conectar en Ajustes → Conexiones.");
            }
            guardar(token);
            return token.Acceso;
        }
        finally { renovando.Release(); }
    }

    /// <summary>Un pedido a la API con el token; si contesta 401, renueva y reintenta una vez.</summary>
    public async Task<(int Estado, string Cuerpo)> Pedir(HttpMethod metodo, string url, string? json = null, IDictionary<string, string>? cabeceras = null, CancellationToken ct = default)
    {
        string? usado = null;
        for (int intento = 0; ; intento++)
        {
            using var req = new HttpRequestMessage(metodo, url);
            usado = await Acceso(ct, intento > 0 ? usado : null);
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", usado);
            if (cabeceras != null) foreach (var (k, v) in cabeceras) req.Headers.TryAddWithoutValidation(k, v);
            if (json != null) req.Content = new StringContent(json, Encoding.UTF8, "application/json");
            using var r = await http.SendAsync(req, ct);
            var cuerpo = await r.Content.ReadAsStringAsync(ct);
            if (r.StatusCode == HttpStatusCode.Unauthorized && intento == 0) continue;
            return ((int)r.StatusCode, cuerpo);
        }
    }

    public async Task<string> Json(string url, IDictionary<string, string>? cabeceras = null, CancellationToken ct = default)
    {
        var (e, c) = await Pedir(HttpMethod.Get, url, null, cabeceras, ct);
        if (e is >= 200 and < 300) return c;
        throw new InvalidOperationException(e switch
        {
            401 => $"{Config.Nombre} no aceptó el permiso. Vuelve a conectar en Ajustes → Conexiones.",
            403 => $"{Config.Nombre} no dio permiso para esto ({Resumen(c)}). Revisa que la API esté habilitada y vuelve a conectar.",
            429 => $"{Config.Nombre} pide esperar un momento (demasiados pedidos).",
            _ => $"{Config.Nombre} contestó {e}: {Resumen(c)}",
        });
    }

    static string Resumen(string cuerpo) => cuerpo.Length > 160 ? cuerpo[..160] + "…" : cuerpo;

    public void Dispose() { http.Dispose(); renovando.Dispose(); }
}

/// <summary>Spotify por su API: busca y pone lo pedido en el dispositivo de la persona.</summary>
internal static class SpotifyWeb
{
    /// <summary>
    /// Pone la canción, el artista o la playlist. Si no hay dispositivo activo, usa el primero que haya;
    /// si no hay ninguno, abre la app de Spotify y reintenta. Devuelve qué puso. Controlar la
    /// reproducción desde otra app es solo para Spotify Premium (lo dice claro si no).
    /// </summary>
    public static async Task<string> Poner(Conexion c, string pedido, CancellationToken ct = default)
    {
        var b = await c.Json($"{c.Config.Api}/v1/search?type=track,artist,playlist&limit=3&q={Uri.EscapeDataString(pedido)}", ct: ct);
        if (LectorApis.SpotifyElegir(b, pedido) is not { } eleccion) throw new InvalidOperationException($"Spotify no encontró «{pedido}».");
        if (!System.Text.RegularExpressions.Regex.IsMatch(eleccion.Uri, @"^spotify:[a-z]+:[A-Za-z0-9]+$")) throw new InvalidOperationException("Spotify devolvió algo raro.");
        var cuerpo = eleccion.Contexto ? System.Text.Json.JsonSerializer.Serialize(new { context_uri = eleccion.Uri })
                                       : System.Text.Json.JsonSerializer.Serialize(new { uris = new[] { eleccion.Uri } });
        for (int intento = 0; intento < 3; intento++)
        {
            var (e, r) = await c.Pedir(HttpMethod.Put, $"{c.Config.Api}/v1/me/player/play", cuerpo, ct: ct);
            if (e is >= 200 and < 300) return eleccion.Descripcion;
            var motivo = LectorApis.SpotifyMotivo(r);
            if (e == 403 || motivo == "PREMIUM_REQUIRED")
            {
                Abrir(eleccion.Uri);
                throw new InvalidOperationException($"Te abrí {eleccion.Descripcion} en Spotify: poner música desde otra app es solo con Premium.");
            }
            if (e != 404) throw new InvalidOperationException($"Spotify contestó {e} al poner la música.");
            // Sin dispositivo activo: el primero disponible; si no hay ninguno, abrir la app y esperar a que aparezca.
            var disp = LectorApis.SpotifyDispositivos(await c.Json($"{c.Config.Api}/v1/me/player/devices", ct: ct));
            if (disp.Count > 0)
            {
                var (e2, _) = await c.Pedir(HttpMethod.Put, $"{c.Config.Api}/v1/me/player/play?device_id={Uri.EscapeDataString(disp[0].Id)}", cuerpo, ct: ct);
                if (e2 is >= 200 and < 300) return eleccion.Descripcion;
            }
            else if (intento == 0) { Abrir("spotify:"); }
            await Task.Delay(TimeSpan.FromSeconds(intento == 0 ? 4 : 3), ct);
        }
        Abrir(eleccion.Uri);
        throw new InvalidOperationException($"Te abrí {eleccion.Descripcion} en Spotify; dale play ahí (no encontré un dispositivo listo).");
    }

    /// <summary>Lo que suena en la cuenta (null si nada).</summary>
    public static async Task<SpotifySonando?> Estado(Conexion c, CancellationToken ct = default)
    {
        var (e, cuerpo) = await c.Pedir(HttpMethod.Get, $"{c.Config.Api}/v1/me/player", ct: ct);
        if (e == 204 || cuerpo.Length == 0) return null;
        if (e is < 200 or >= 300) throw new InvalidOperationException(e == 403 ? "Spotify no dio permiso: tu correo tiene que estar en «User Management» de la app (y la cuenta dueña, en Premium)." : $"Spotify contestó {e}.");
        return LectorApis.SpotifyEstado(cuerpo);
    }

    public static async Task<List<SpotifyResultado>> Buscar(Conexion c, string q, CancellationToken ct = default) =>
        LectorApis.SpotifyResultados(await c.Json($"{c.Config.Api}/v1/search?type=track,artist,playlist&limit=8&q={Uri.EscapeDataString(q)}", ct: ct));

    /// <summary>Pone una canción (uri de track) o un contexto (artista, álbum, playlist) en el dispositivo activo o el primero.</summary>
    public static async Task PonerUri(Conexion c, string uri, CancellationToken ct = default)
    {
        if (!System.Text.RegularExpressions.Regex.IsMatch(uri, @"^spotify:(?:track|artist|album|playlist):[A-Za-z0-9]+$")) throw new InvalidOperationException("Eso no es algo de Spotify.");
        var cuerpo = uri.StartsWith("spotify:track:", StringComparison.Ordinal)
            ? System.Text.Json.JsonSerializer.Serialize(new { uris = new[] { uri } })
            : System.Text.Json.JsonSerializer.Serialize(new { context_uri = uri });
        await Reproducir(c, cuerpo, uri, ct);
    }

    static async Task Reproducir(Conexion c, string cuerpo, string uri, CancellationToken ct)
    {
        for (int intento = 0; intento < 3; intento++)
        {
            var (e, r) = await c.Pedir(HttpMethod.Put, $"{c.Config.Api}/v1/me/player/play", cuerpo, ct: ct);
            if (e is >= 200 and < 300) return;
            if (e == 403 || LectorApis.SpotifyMotivo(r) == "PREMIUM_REQUIRED") { Abrir(uri); throw new InvalidOperationException("Te la abrí en Spotify: controlarlo desde otra app es solo con Premium."); }
            if (e != 404) throw new InvalidOperationException($"Spotify contestó {e} al poner la música.");
            var disp = LectorApis.SpotifyDispositivos(await c.Json($"{c.Config.Api}/v1/me/player/devices", ct: ct));
            if (disp.Count > 0)
            {
                var (e2, _) = await c.Pedir(HttpMethod.Put, $"{c.Config.Api}/v1/me/player/play?device_id={Uri.EscapeDataString(disp[0].Id)}", cuerpo, ct: ct);
                if (e2 is >= 200 and < 300) return;
            }
            else if (intento == 0) Abrir("spotify:");
            await Task.Delay(TimeSpan.FromSeconds(intento == 0 ? 4 : 3), ct);
        }
        Abrir(uri);
        throw new InvalidOperationException("Te la abrí en Spotify; dale play ahí (no encontré un dispositivo listo).");
    }

    /// <summary>play, pausa, siguiente, anterior, volumen:N, posicion:MS, aleatorio:true|false.</summary>
    public static async Task Control(Conexion c, string accion, CancellationToken ct = default)
    {
        var partes = accion.Split(':', 2);
        (HttpMethod m, string ruta) = partes[0] switch
        {
            "play" => (HttpMethod.Put, "/v1/me/player/play"),
            "pausa" => (HttpMethod.Put, "/v1/me/player/pause"),
            "siguiente" => (HttpMethod.Post, "/v1/me/player/next"),
            "anterior" => (HttpMethod.Post, "/v1/me/player/previous"),
            "volumen" when int.TryParse(partes.ElementAtOrDefault(1), out var v) => (HttpMethod.Put, $"/v1/me/player/volume?volume_percent={Math.Clamp(v, 0, 100)}"),
            "posicion" when int.TryParse(partes.ElementAtOrDefault(1), out var p) => (HttpMethod.Put, $"/v1/me/player/seek?position_ms={Math.Max(0, p)}"),
            "aleatorio" => (HttpMethod.Put, $"/v1/me/player/shuffle?state={(partes.ElementAtOrDefault(1) == "true" ? "true" : "false")}"),
            _ => throw new InvalidOperationException("Acción de música desconocida."),
        };
        var (e, _) = await c.Pedir(m, c.Config.Api + ruta, m == HttpMethod.Put && partes[0] == "play" ? null : null, ct: ct);
        if (e is >= 200 and < 300) return;
        throw new InvalidOperationException(e == 404 ? "No hay un Spotify sonando en ningún dispositivo. Pon algo primero." : e == 403 ? "Controlar Spotify desde otra app es solo con Premium." : $"Spotify contestó {e}.");
    }

    public static async Task<List<(string Id, string Nombre, bool Activo)>> Dispositivos(Conexion c, CancellationToken ct = default) =>
        LectorApis.SpotifyDispositivos(await c.Json($"{c.Config.Api}/v1/me/player/devices", ct: ct));

    public static async Task Transferir(Conexion c, string id, CancellationToken ct = default)
    {
        var (e, _) = await c.Pedir(HttpMethod.Put, $"{c.Config.Api}/v1/me/player", System.Text.Json.JsonSerializer.Serialize(new { device_ids = new[] { id }, play = true }), ct: ct);
        if (e is < 200 or >= 300) throw new InvalidOperationException($"Spotify no cambió de dispositivo ({e}).");
    }

    static void Abrir(string uri)
    {
        if (!uri.StartsWith("spotify:", StringComparison.Ordinal)) return; // solo la app de Spotify, nunca otra cosa
        try { Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true }); }
        catch { Process.Start(new ProcessStartInfo("https://open.spotify.com/" + uri.Replace("spotify:", "").Replace(':', '/')) { UseShellExecute = true }); }
    }
}

/// <summary>Google: Gmail, Calendar y YouTube (para abrir en YouTube Music la canción exacta).</summary>
internal static class GoogleWeb
{
    public static async Task<List<Carta>> NoLeidos(Conexion c, int max, CancellationToken ct)
    {
        var baseGmail = c.Config.Api.Contains("googleapis.com") ? "https://gmail.googleapis.com" : c.Config.Api;
        var ids = LectorApis.GmailIds(await c.Json($"{baseGmail}/gmail/v1/users/me/messages?maxResults={max}&q={Uri.EscapeDataString("is:unread in:inbox newer_than:14d")}", ct: ct));
        var tareas = ids.Select(async id => LectorApis.GmailMensaje(await c.Json(
            $"{baseGmail}/gmail/v1/users/me/messages/{Uri.EscapeDataString(id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject", ct: ct)));
        return (await Task.WhenAll(tareas)).OrderByDescending(x => x.Fecha).ToList();
    }

    public static async Task<List<Evento>> Eventos(Conexion c, DateTime desde, DateTime hasta, CancellationToken ct)
    {
        string F(DateTime d) => Uri.EscapeDataString(d.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'"));
        return LectorApis.GoogleEventos(await c.Json($"{c.Config.Api}/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=100&timeMin={F(desde)}&timeMax={F(hasta)}", ct: ct));
    }

    /// <summary>La primera canción de YouTube para lo pedido → https://music.youtube.com/watch?v=… (suena sola al abrir).</summary>
    public static async Task<(string Url, string Titulo)?> Cancion(Conexion c, string pedido, CancellationToken ct)
    {
        var j = await c.Json($"{c.Config.Api}/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=3&q={Uri.EscapeDataString(pedido)}", ct: ct);
        return LectorApis.YoutubePrimero(j) is { } v ? ("https://music.youtube.com/watch?v=" + Uri.EscapeDataString(v.Id), v.Titulo) : null;
    }
}

/// <summary>Microsoft Graph: correo y calendario de Outlook, Hotmail y Microsoft 365.</summary>
internal static class GraphWeb
{
    public static async Task<List<Carta>> NoLeidos(Conexion c, int max, CancellationToken ct)
    {
        // Graph pide que lo que va en $orderby aparezca primero en $filter.
        var desde = DateTime.UtcNow.AddDays(-14).ToString("yyyy-MM-dd'T'HH:mm:ss'Z'");
        var filtro = Uri.EscapeDataString($"receivedDateTime ge {desde} and isRead eq false");
        return LectorApis.GraphCorreos(await c.Json($"{c.Config.Api}/v1.0/me/mailFolders/inbox/messages?$filter={filtro}&$orderby=receivedDateTime%20desc&$top={max}&$select=id,from,subject,bodyPreview,receivedDateTime", ct: ct));
    }

    public static async Task<List<Evento>> Eventos(Conexion c, DateTime desde, DateTime hasta, CancellationToken ct)
    {
        string F(DateTime d) => Uri.EscapeDataString(d.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'"));
        var cab = new Dictionary<string, string> { ["Prefer"] = "outlook.timezone=\"UTC\"" };
        return LectorApis.GraphEventos(await c.Json($"{c.Config.Api}/v1.0/me/calendarView?startDateTime={F(desde)}&endDateTime={F(hasta)}&$top=100&$orderby=start/dateTime&$select=subject,start,end,location,isAllDay,isCancelled", cab, ct));
    }
}

/// <summary>Qué servicio va con qué clave en los ajustes y con qué Client ID.</summary>
internal static class Servicios
{
    public static string Clave(Proveedor p) => p switch { Proveedor.Spotify => "spotify", Proveedor.Google => "google", _ => "microsoft" };

    /// <summary>La configuración con el Client ID guardado en los ajustes (null si falta).</summary>
    public static ProveedorConfig? Config(Ajustes a, Proveedor p) => p switch
    {
        Proveedor.Spotify when a.SpotifyClientId.Length > 0 => Oauth.Spotify(a.SpotifyClientId),
        Proveedor.Google when a.GoogleClientId.Length > 0 => Oauth.Google(a.GoogleClientId, a.GoogleClientSecret.Length > 0 ? a.GoogleClientSecret : null),
        Proveedor.Microsoft when a.MicrosoftClientId.Length > 0 => Oauth.Microsoft(a.MicrosoftClientId),
        _ => null,
    };
}
