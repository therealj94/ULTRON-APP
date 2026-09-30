using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Aura.Windows.Core;

/// <summary>Un correo, lo justo para avisar y leer: de quién, asunto, un trozo y cuándo (IMAP, Gmail u Outlook).</summary>
public sealed record Carta(string Id, string De, string Asunto, string Resumen, DateTimeOffset Fecha);

public enum Proveedor { Spotify, Google, Microsoft }

/// <summary>
/// Cómo se entra a un servicio con OAuth 2 desde una app de escritorio: el navegador de la persona abre
/// la página del servicio, ella acepta y el servicio vuelve a http://127.0.0.1:43821/callback, donde
/// AURA escucha solo en este equipo. Con PKCE (RFC 7636): no hace falta secreto (Google lo pide igual
/// para «apps de escritorio», pero su propia guía dice que ahí no es secreto).
/// </summary>
public sealed record ProveedorConfig(Proveedor Id, string Nombre, string Autorizar, string TokenUrl, string Alcances,
                                     string ClientId, string? ClientSecret, IReadOnlyDictionary<string, string> Extra, string Api);

/// <summary>Lo que se guarda (cifrado con DPAPI) de una cuenta conectada.</summary>
public sealed record TokenOauth(string Acceso, string Renovar, DateTimeOffset Vence, string Cuenta = "")
{
    /// <summary>Se renueva un minuto antes de vencer (un pedido en vuelo no llega con el token muerto).</summary>
    public bool Vencido(DateTimeOffset ahora) => ahora >= Vence - TimeSpan.FromMinutes(1);
}

public static class Oauth
{
    public const int Puerto = 43821;
    public static string Redireccion => $"http://127.0.0.1:{Puerto}/callback";

    static readonly IReadOnlyDictionary<string, string> Nada = new Dictionary<string, string>();

    public static ProveedorConfig Spotify(string clientId, string auth = "https://accounts.spotify.com", string api = "https://api.spotify.com") =>
        new(Proveedor.Spotify, "Spotify", auth + "/authorize", auth + "/api/token",
            "user-read-playback-state user-modify-playback-state user-read-currently-playing user-read-email", clientId, null, Nada, api);

    /// <summary>Gmail (solo leer), Calendar (solo leer) y YouTube (buscar la canción exacta para YouTube Music).</summary>
    public static ProveedorConfig Google(string clientId, string? secreto, string auth = "https://accounts.google.com/o/oauth2/v2/auth",
                                         string token = "https://oauth2.googleapis.com/token", string api = "https://www.googleapis.com") =>
        new(Proveedor.Google, "Google", auth, token,
            "openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/youtube.readonly",
            clientId, secreto, new Dictionary<string, string> { ["access_type"] = "offline", ["prompt"] = "consent" }, api);

    /// <summary>Outlook, Hotmail, Live y Microsoft 365: correo y calendario por Microsoft Graph (solo leer).</summary>
    public static ProveedorConfig Microsoft(string clientId, string auth = "https://login.microsoftonline.com/common/oauth2/v2.0",
                                            string api = "https://graph.microsoft.com") =>
        new(Proveedor.Microsoft, "Microsoft", auth + "/authorize", auth + "/token", "offline_access User.Read Mail.Read Calendars.Read",
            clientId, null, new Dictionary<string, string> { ["prompt"] = "select_account" }, api);

    static string B64Url(byte[] b) => Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    /// <summary>El verificador (secreto de esta entrada) y su reto S256 (lo único que viaja al abrir la página).</summary>
    public static (string Verificador, string Reto) Pkce()
    {
        var v = B64Url(RandomNumberGenerator.GetBytes(48));
        return (v, B64Url(SHA256.HashData(Encoding.ASCII.GetBytes(v))));
    }

    public static string Estado() => B64Url(RandomNumberGenerator.GetBytes(18));

    public static string UrlAutorizar(ProveedorConfig c, string reto, string estado, string? redireccion = null)
    {
        var q = new Dictionary<string, string>
        {
            ["client_id"] = c.ClientId, ["response_type"] = "code", ["redirect_uri"] = redireccion ?? Redireccion,
            ["scope"] = c.Alcances, ["state"] = estado, ["code_challenge"] = reto, ["code_challenge_method"] = "S256",
        };
        foreach (var (k, v) in c.Extra) q[k] = v;
        return c.Autorizar + (c.Autorizar.Contains('?') ? "&" : "?") + string.Join("&", q.Select(p => p.Key + "=" + Uri.EscapeDataString(p.Value)));
    }

    public static Dictionary<string, string> Canje(ProveedorConfig c, string codigo, string verificador, string? redireccion = null)
    {
        var f = new Dictionary<string, string>
        {
            ["grant_type"] = "authorization_code", ["code"] = codigo, ["redirect_uri"] = redireccion ?? Redireccion,
            ["client_id"] = c.ClientId, ["code_verifier"] = verificador,
        };
        if (!string.IsNullOrEmpty(c.ClientSecret)) f["client_secret"] = c.ClientSecret!;
        return f;
    }

    public static Dictionary<string, string> Renovacion(ProveedorConfig c, string renovar)
    {
        var f = new Dictionary<string, string> { ["grant_type"] = "refresh_token", ["refresh_token"] = renovar, ["client_id"] = c.ClientId };
        if (!string.IsNullOrEmpty(c.ClientSecret)) f["client_secret"] = c.ClientSecret!;
        if (c.Id == Proveedor.Microsoft) f["scope"] = c.Alcances; // Microsoft pide los alcances también al renovar
        return f;
    }

    /// <summary>
    /// La respuesta del servicio de tokens. Si al renovar no manda un refresh token nuevo, se conserva el
    /// anterior (Google no lo rota; Spotify y Microsoft sí, y entonces el viejo deja de servir).
    /// </summary>
    public static TokenOauth LeerToken(string json, TokenOauth? anterior, DateTimeOffset ahora)
    {
        using var d = JsonDocument.Parse(json);
        var r = d.RootElement;
        if (r.TryGetProperty("error", out var e))
        {
            var desc = r.TryGetProperty("error_description", out var ed) ? ed.GetString() : null;
            throw new InvalidOperationException(e.ValueKind == JsonValueKind.String ? $"{e.GetString()}{(desc is { Length: > 0 } ? ": " + desc : "")}" : "el servicio rechazó la entrada");
        }
        var acceso = r.TryGetProperty("access_token", out var a) ? a.GetString() : null;
        if (string.IsNullOrEmpty(acceso)) throw new InvalidOperationException("el servicio no devolvió un token de acceso");
        var renovar = r.TryGetProperty("refresh_token", out var rt) && rt.GetString() is { Length: > 0 } nuevo ? nuevo : anterior?.Renovar ?? "";
        var segundos = r.TryGetProperty("expires_in", out var ex) && ex.TryGetInt32(out var s) ? s : 3600;
        return new TokenOauth(acceso!, renovar, ahora.AddSeconds(Math.Clamp(segundos, 60, 86400)), anterior?.Cuenta ?? "");
    }

    /// <summary>Los parámetros de «/callback?code=…&amp;state=…» (lo que el navegador trae de vuelta).</summary>
    public static Dictionary<string, string> Query(string ruta)
    {
        var q = new Dictionary<string, string>();
        var i = ruta.IndexOf('?');
        if (i < 0) return q;
        foreach (var par in ruta[(i + 1)..].Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var kv = par.Split('=', 2);
            q[Uri.UnescapeDataString(kv[0].Replace('+', ' '))] = kv.Length > 1 ? Uri.UnescapeDataString(kv[1].Replace('+', ' ')) : "";
        }
        return q;
    }

    /// <summary>
    /// Lo que volvió del navegador: el código, o un error claro. El estado tiene que ser el mismo que se
    /// mandó (si no, otra página intentó colarse en el inicio de sesión).
    /// </summary>
    public static string CodigoDe(string ruta, string estado)
    {
        var q = Query(ruta);
        if (q.TryGetValue("error", out var err))
            throw new InvalidOperationException(err == "access_denied" ? "Cancelaste el permiso en el navegador." : "El servicio dijo: " + err + (q.TryGetValue("error_description", out var d) ? " (" + d + ")" : ""));
        if (!q.TryGetValue("state", out var st) || !CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(st), Encoding.UTF8.GetBytes(estado)))
            throw new InvalidOperationException("La respuesta del navegador no coincide con esta entrada; vuelve a intentarlo.");
        if (!q.TryGetValue("code", out var code) || code.Length == 0) throw new InvalidOperationException("El navegador volvió sin código.");
        return code;
    }
}

/// <summary>Lee las respuestas de Gmail, Google Calendar, YouTube, Microsoft Graph y Spotify (sin red: se prueba en Linux).</summary>
public static class LectorApis
{
    static string S(JsonElement e, string p) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(p, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";
    static JsonElement O(JsonElement e, string p) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(p, out var v) ? v : default;
    static IEnumerable<JsonElement> A(JsonElement e, string p) => O(e, p) is { ValueKind: JsonValueKind.Array } a ? a.EnumerateArray() : Enumerable.Empty<JsonElement>();

    /// <summary>«Karla Pérez &lt;karla@x.com&gt;» → «Karla Pérez»; sin nombre, la dirección.</summary>
    public static string Remitente(string from)
    {
        from = from.Trim();
        var i = from.IndexOf('<');
        var nombre = (i >= 0 ? from[..i] : from).Trim().Trim('"').Trim();
        if (nombre.Length > 0 && !(i < 0 && nombre.Contains('@'))) return nombre;
        return i >= 0 ? from[(i + 1)..].TrimEnd('>').Trim() : from;
    }

    public static List<string> GmailIds(string json)
    {
        using var d = JsonDocument.Parse(json);
        return A(d.RootElement, "messages").Select(m => S(m, "id")).Where(x => x.Length > 0).ToList();
    }

    public static Carta GmailMensaje(string json)
    {
        using var d = JsonDocument.Parse(json);
        var r = d.RootElement;
        var cab = A(O(r, "payload"), "headers").ToDictionary(h => S(h, "name").ToLowerInvariant(), h => S(h, "value"), StringComparer.Ordinal);
        var fecha = long.TryParse(S(r, "internalDate"), out var ms) ? DateTimeOffset.FromUnixTimeMilliseconds(ms) : DateTimeOffset.Now;
        return new Carta(S(r, "id"), Remitente(cab.GetValueOrDefault("from", "")), cab.GetValueOrDefault("subject", "") is { Length: > 0 } a ? a : "(sin asunto)",
                         System.Net.WebUtility.HtmlDecode(S(r, "snippet")).Trim(), fecha);
    }

    public static List<Carta> GraphCorreos(string json)
    {
        using var d = JsonDocument.Parse(json);
        return A(d.RootElement, "value").Select(m =>
        {
            var de = O(O(m, "from"), "emailAddress");
            var nombre = S(de, "name") is { Length: > 0 } n ? n : S(de, "address");
            var fecha = DateTimeOffset.TryParse(S(m, "receivedDateTime"), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var f) ? f : DateTimeOffset.Now;
            return new Carta(S(m, "id"), nombre, S(m, "subject") is { Length: > 0 } a ? a : "(sin asunto)", S(m, "bodyPreview").Trim(), fecha);
        }).ToList();
    }

    /// <summary>Google Calendar (singleEvents=true: las repeticiones ya vienen desplegadas por Google).</summary>
    public static List<Evento> GoogleEventos(string json, TimeZoneInfo? local = null)
    {
        local ??= TimeZoneInfo.Local;
        using var d = JsonDocument.Parse(json);
        var lista = new List<Evento>();
        foreach (var e in A(d.RootElement, "items"))
        {
            if (S(e, "status") == "cancelled") continue;
            var ini = O(e, "start"); var fin = O(e, "end");
            if (S(ini, "date") is { Length: > 0 } dia && DateTime.TryParse(dia, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d0))
            {
                var d1 = DateTime.TryParse(S(fin, "date"), CultureInfo.InvariantCulture, DateTimeStyles.None, out var x) ? x : d0.AddDays(1);
                lista.Add(new Evento(Titulo(S(e, "summary")), d0, d1, S(e, "location"), true));
            }
            else if (DateTimeOffset.TryParse(S(ini, "dateTime"), CultureInfo.InvariantCulture, DateTimeStyles.None, out var i0))
            {
                var i1 = DateTimeOffset.TryParse(S(fin, "dateTime"), CultureInfo.InvariantCulture, DateTimeStyles.None, out var y) ? y : i0.AddHours(1);
                lista.Add(new Evento(Titulo(S(e, "summary")), TimeZoneInfo.ConvertTime(i0, local).DateTime, TimeZoneInfo.ConvertTime(i1, local).DateTime, S(e, "location"), false));
            }
        }
        return lista.OrderBy(x => x.Inicio).ToList();
    }

    /// <summary>Microsoft Graph calendarView pedido con Prefer: outlook.timezone="UTC".</summary>
    public static List<Evento> GraphEventos(string json, TimeZoneInfo? local = null)
    {
        local ??= TimeZoneInfo.Local;
        using var d = JsonDocument.Parse(json);
        var lista = new List<Evento>();
        foreach (var e in A(d.RootElement, "value"))
        {
            if (O(e, "isCancelled") is { ValueKind: JsonValueKind.True }) continue;
            bool todo = O(e, "isAllDay") is { ValueKind: JsonValueKind.True };
            if (!DateTime.TryParse(S(O(e, "start"), "dateTime"), CultureInfo.InvariantCulture, DateTimeStyles.None, out var i0)) continue;
            var i1 = DateTime.TryParse(S(O(e, "end"), "dateTime"), CultureInfo.InvariantCulture, DateTimeStyles.None, out var y) ? y : i0.AddHours(1);
            var lugar = S(O(e, "location"), "displayName");
            if (todo) lista.Add(new Evento(Titulo(S(e, "subject")), i0.Date, i1.Date, lugar, true));
            else lista.Add(new Evento(Titulo(S(e, "subject")), TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(i0, DateTimeKind.Utc), local),
                                      TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(i1, DateTimeKind.Utc), local), lugar, false));
        }
        return lista.OrderBy(x => x.Inicio).ToList();
    }

    static string Titulo(string t) => t.Trim().Length > 0 ? t.Trim() : "(sin título)";

    /// <summary>
    /// De una búsqueda de Spotify (type=track,artist,playlist), qué poner: si lo dicho ES el nombre de un
    /// artista, su música (context_uri del artista); si pidió una playlist, la playlist; si no, la canción.
    /// </summary>
    public static (string Uri, bool Contexto, string Descripcion)? SpotifyElegir(string json, string pedido)
    {
        using var d = JsonDocument.Parse(json);
        var r = d.RootElement;
        var q = LayaLigera.Normalizar(pedido);
        bool quierePlaylist = System.Text.RegularExpressions.Regex.IsMatch(q, @"\b(?:playlist|lista)\b");
        var artista = A(O(r, "artists"), "items").FirstOrDefault(a => a.ValueKind == JsonValueKind.Object);
        var pista = A(O(r, "tracks"), "items").FirstOrDefault(t => t.ValueKind == JsonValueKind.Object);
        var lista = A(O(r, "playlists"), "items").FirstOrDefault(t => t.ValueKind == JsonValueKind.Object);
        if (quierePlaylist && S(lista, "uri").Length > 0) return (S(lista, "uri"), true, S(lista, "name"));
        if (S(artista, "uri").Length > 0 && LayaLigera.Normalizar(S(artista, "name")) == System.Text.RegularExpressions.Regex.Replace(q, @"^(?:musica de|canciones de|algo de|lo mejor de)\s+", ""))
            return (S(artista, "uri"), true, S(artista, "name"));
        if (S(pista, "uri").Length > 0)
        {
            var art = A(pista, "artists").Select(a => S(a, "name")).FirstOrDefault(x => x.Length > 0);
            return (S(pista, "uri"), false, art is null ? S(pista, "name") : $"{S(pista, "name")}, de {art}");
        }
        if (S(artista, "uri").Length > 0) return (S(artista, "uri"), true, S(artista, "name"));
        if (S(lista, "uri").Length > 0) return (S(lista, "uri"), true, S(lista, "name"));
        return null;
    }

    public static List<(string Id, string Nombre, bool Activo)> SpotifyDispositivos(string json)
    {
        using var d = JsonDocument.Parse(json);
        return A(d.RootElement, "devices").Where(x => S(x, "id").Length > 0 && O(x, "is_restricted").ValueKind != JsonValueKind.True)
            .Select(x => (S(x, "id"), S(x, "name"), O(x, "is_active").ValueKind == JsonValueKind.True)).ToList();
    }

    /// <summary>El «reason» de un error de Spotify (NO_ACTIVE_DEVICE, PREMIUM_REQUIRED…), o "".</summary>
    public static string SpotifyMotivo(string json)
    {
        try { using var d = JsonDocument.Parse(json); return S(O(d.RootElement, "error"), "reason"); } catch (JsonException) { return ""; }
    }

    public static (string Id, string Titulo)? YoutubePrimero(string json)
    {
        using var d = JsonDocument.Parse(json);
        foreach (var it in A(d.RootElement, "items"))
            if (S(O(it, "id"), "videoId") is { Length: > 0 } id)
                return (id, System.Net.WebUtility.HtmlDecode(S(O(it, "snippet"), "title")));
        return null;
    }

    /// <summary>La cuenta con la que se entró: «email» (Google), «mail»/«userPrincipalName» (Microsoft), «email»/«display_name» (Spotify).</summary>
    public static string Cuenta(string json)
    {
        using var d = JsonDocument.Parse(json);
        var r = d.RootElement;
        foreach (var p in new[] { "email", "mail", "userPrincipalName", "display_name" })
            if (S(r, p) is { Length: > 0 } v) return v;
        return "";
    }
}
