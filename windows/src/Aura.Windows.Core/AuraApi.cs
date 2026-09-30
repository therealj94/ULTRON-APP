using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Aura.Windows.Core;

/// <summary>Un turno de la conversación, como lo guarda la app (rol usuario | ultron).</summary>
public sealed record Turno(string Rol, string Texto);

/// <summary>Lo que devolvió el cerebro al terminar.</summary>
public sealed record Respuesta(string Texto, string Voz, string Emocion, string? Error = null, long Ms = 0, string? Via = null);

/// <summary>Audio de la voz del avatar (ElevenLabs en el servidor) y sus tiempos por letra si los hubo.</summary>
public sealed record Audio(byte[] Bytes, string Tipo, string Motor, string? Alineacion);

public sealed class AuraError : Exception
{
    public HttpStatusCode? Estado { get; }
    public AuraError(string mensaje, HttpStatusCode? estado = null) : base(mensaje) => Estado = estado;
}

/// <summary>
/// El MISMO servidor de la app AU-RA: cerebro Qwen (/api/turno/stream), voz de cada avatar con
/// ElevenLabs (/api/tts), oído (/api/stt), ojos (/api/vision/analyze) y Laya «windows»
/// (/api/windows/intencion). La sesión es la de la cuenta (POST /api/ultron/entrar); con ella la
/// memoria y el perfil son los de la persona. Sin sesión, conversar sigue funcionando (decisión de la
/// junta) y Laya del nodo no.
/// </summary>
public sealed class AuraApi : IDisposable
{
    public const string ServidorPorDefecto = "https://aura-fp.onrender.com";
    readonly HttpClient http;
    public Uri Base { get; }
    public string? Token { get; set; }
    /// <summary>Si el servidor rechaza el token, se pide uno nuevo con las credenciales guardadas (una vez).</summary>
    public Func<CancellationToken, Task<string?>>? Renovar { get; set; }

    public AuraApi(string servidor, string? token = null, HttpMessageHandler? handler = null)
    {
        Base = Validar(servidor);
        Token = token;
        http = new HttpClient(handler ?? new SocketsHttpHandler { AllowAutoRedirect = false, PooledConnectionLifetime = TimeSpan.FromMinutes(5), ConnectTimeout = TimeSpan.FromSeconds(8) })
        { BaseAddress = Base, Timeout = Timeout.InfiniteTimeSpan };
        http.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("AURA-Windows", "1.0"));
    }

    public static Uri Validar(string valor)
    {
        if (!Uri.TryCreate((valor ?? "").Trim(), UriKind.Absolute, out var u) || (u.Scheme != "https" && !(u.Scheme == "http" && u.IsLoopback)) || u.UserInfo.Length > 0 || u.Query.Length > 0 || u.Fragment.Length > 0)
            throw new AuraError("Usa la dirección HTTPS de tu servidor AURA (HTTP solo en este equipo).");
        return new Uri(u.AbsoluteUri.TrimEnd('/') + "/");
    }

    HttpRequestMessage Pedido(HttpMethod m, string ruta, object? cuerpo = null, string? aceptar = null)
    {
        var r = new HttpRequestMessage(m, ruta.TrimStart('/'));
        if (cuerpo != null) r.Content = new StringContent(JsonSerializer.Serialize(cuerpo), Encoding.UTF8, "application/json");
        if (!string.IsNullOrEmpty(Token)) r.Headers.TryAddWithoutValidation("x-ultron-sesion", Token);
        r.Headers.TryAddWithoutValidation("x-aura-origen", "windows");
        r.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue(aceptar ?? "application/json"));
        return r;
    }

    async Task<HttpResponseMessage> Enviar(Func<HttpRequestMessage> crear, CancellationToken ct, TimeSpan tope, HttpCompletionOption modo = HttpCompletionOption.ResponseContentRead, bool renovar = true)
    {
        // Un solo reloj para todo, reintento incluido: nada de esperas sin tope.
        using var reloj = CancellationTokenSource.CreateLinkedTokenSource(ct);
        reloj.CancelAfter(tope);
        async Task<HttpResponseMessage> Una()
        {
            try { return await http.SendAsync(crear(), modo, reloj.Token).ConfigureAwait(false); }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested) { throw new AuraError("El servidor AURA tardó demasiado."); }
            catch (HttpRequestException) { throw new AuraError("Sin conexión con el servidor AURA."); }
            catch (ObjectDisposedException) { throw new OperationCanceledException(ct); }
        }
        var r = await Una().ConfigureAwait(false);
        if (r.StatusCode == HttpStatusCode.Unauthorized && renovar && Renovar != null)
        {
            r.Dispose();
            Token = await Renovar(reloj.Token).ConfigureAwait(false);
            if (string.IsNullOrEmpty(Token)) throw new AuraError("Tu sesión venció. Entra otra vez en Ajustes.", HttpStatusCode.Unauthorized);
            r = await Una().ConfigureAwait(false);
        }
        if (!r.IsSuccessStatusCode)
        {
            var estado = r.StatusCode;
            string msg = "";
            try { using var j = JsonDocument.Parse(await r.Content.ReadAsStringAsync(ct).ConfigureAwait(false)); msg = j.RootElement.TryGetProperty("error", out var e) ? e.GetString() ?? "" : ""; } catch { }
            r.Dispose();
            throw new AuraError(estado switch
            {
                HttpStatusCode.Unauthorized => "Entra con tu cuenta en Ajustes.",
                HttpStatusCode.TooManyRequests => string.IsNullOrEmpty(msg) ? "Vas muy rápido. Dame un minuto." : msg,
                HttpStatusCode.ServiceUnavailable => string.IsNullOrEmpty(msg) ? "Ese servicio no está disponible ahora." : msg,
                _ => string.IsNullOrEmpty(msg) ? $"El servidor respondió {(int)estado}." : msg,
            }, estado);
        }
        return r;
    }

    /// <summary>El cuerpo JSON de la respuesta; si no es JSON (un portal cautivo, una página de error), un AuraError y no otra cosa.</summary>
    static async Task<JsonDocument> Json(HttpResponseMessage r, CancellationToken ct)
    {
        try { return JsonDocument.Parse(await r.Content.ReadAsStringAsync(ct).ConfigureAwait(false)); }
        catch (JsonException) { throw new AuraError("El servidor respondió algo que no entiendo. ¿Hay un portal de wifi o un proxy en medio?"); }
    }

    public async Task<(string Token, string Nombre, string Correo)> Entrar(string correo, string clave, CancellationToken ct = default)
    {
        using var r = await Enviar(() => Pedido(HttpMethod.Post, "api/ultron/entrar", new { correo = correo.Trim().ToLowerInvariant(), clave }), ct, TimeSpan.FromSeconds(20), renovar: false).ConfigureAwait(false);
        using var j = await Json(r, ct).ConfigureAwait(false);
        var raiz = j.RootElement;
        var token = raiz.TryGetProperty("token", out var t) ? t.GetString() : null;
        if (string.IsNullOrEmpty(token)) throw new AuraError("El servidor no devolvió una sesión.");
        var quien = raiz.TryGetProperty("miembro", out var m) ? m : raiz.TryGetProperty("user", out var u) ? u : default;
        string nombre = quien.ValueKind == JsonValueKind.Object && quien.TryGetProperty("nombre", out var n) ? n.GetString() ?? "" : "";
        string mail = quien.ValueKind == JsonValueKind.Object && quien.TryGetProperty("correo", out var c) ? c.GetString() ?? correo : correo;
        Token = token;
        return (token!, nombre, mail);
    }

    /// <summary>La web de la wallet para pedir el pase (la da el servidor; si no contesta, la de siempre).</summary>
    public async Task<string> WalletWeb(CancellationToken ct = default)
    {
        try
        {
            using var r = await Enviar(() => Pedido(HttpMethod.Get, "api/genesis/config"), ct, TimeSpan.FromSeconds(8), renovar: false).ConfigureAwait(false);
            using var j = await Json(r, ct).ConfigureAwait(false);
            if (j.RootElement.TryGetProperty("walletWeb", out var w) && w.GetString() is { } web && web.StartsWith("https://", StringComparison.Ordinal)) return web;
        }
        catch (AuraError) { }
        return GenesisSso.WalletWebPorDefecto;
    }

    static Miembro LeerMiembro(JsonElement raiz, string correoPorOmision = "")
    {
        var m = raiz.TryGetProperty("miembro", out var x) ? x : raiz.TryGetProperty("user", out var u) ? u : default;
        string S(string k) => m.ValueKind == JsonValueKind.Object && m.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";
        var correo = S("correo"); if (correo.Length == 0) correo = correoPorOmision;
        var rol = S("rol");
        var nivel = S("nivel"); if (nivel.Length == 0) nivel = rol.Contains("Junta", StringComparison.OrdinalIgnoreCase) ? "junta" : "miembro";
        return new Miembro(S("nombre"), correo, rol, S("gid"), nivel);
    }

    /// <summary>Canjea el pase de Genesis ID por la sesión de AU-RA (el pase se gasta aquí una vez).</summary>
    public async Task<(string Token, Miembro Miembro, string? NombreGenesis)> EntrarGenesis(string pase, string verificador, CancellationToken ct = default)
    {
        using var r = await Enviar(() => Pedido(HttpMethod.Post, "api/genesis/entrar", new { pase, verificador }), ct, TimeSpan.FromSeconds(25), renovar: false).ConfigureAwait(false);
        using var j = await Json(r, ct).ConfigureAwait(false);
        var raiz = j.RootElement;
        var token = raiz.TryGetProperty("token", out var t) ? t.GetString() : null;
        if (string.IsNullOrEmpty(token)) throw new AuraError("AU-RA no devolvió una sesión.");
        Token = token;
        string? nombreGenesis = raiz.TryGetProperty("genesis", out var g) && g.ValueKind == JsonValueKind.Object && g.TryGetProperty("nombre", out var gn) ? gn.GetString() : null;
        return (token!, LeerMiembro(raiz), nombreGenesis);
    }

    /// <summary>Quién es la sesión actual (null si venció o no hay).</summary>
    public async Task<Miembro?> Sesion(CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(Token)) return null;
        try
        {
            using var r = await Enviar(() => Pedido(HttpMethod.Get, "api/ultron/sesion"), ct, TimeSpan.FromSeconds(10), renovar: false).ConfigureAwait(false);
            using var j = await Json(r, ct).ConfigureAwait(false);
            if (j.RootElement.TryGetProperty("authenticated", out var a) && a.ValueKind == JsonValueKind.False) return null;
            return LeerMiembro(j.RootElement);
        }
        catch (AuraError) { return null; }
    }

    /// <summary>Cierra la sesión en el servidor (el token deja de servir).</summary>
    public async Task Salir(CancellationToken ct = default)
    {
        try { using var r = await Enviar(() => Pedido(HttpMethod.Post, "api/ultron/salir", new { }), ct, TimeSpan.FromSeconds(8), renovar: false).ConfigureAwait(false); }
        catch (AuraError) { }
        Token = null;
    }

    public async Task<bool> Salud(CancellationToken ct = default)
    {
        try { using var r = await Enviar(() => Pedido(HttpMethod.Get, "api/health"), ct, TimeSpan.FromSeconds(10)).ConfigureAwait(false); return true; }
        catch (AuraError) { return false; }
    }

    /// <summary>
    /// Un turno con el cerebro, en vivo. `alTrozo` recibe cada trozo PARA DECIR (con sus [risa]…);
    /// `alEmocion` llega antes del primer trozo. Cancelar corta el turno en el servidor también.
    /// </summary>
    public async Task<Respuesta> Turno(string mensaje, IReadOnlyList<Turno> historial, string usuario, string avatar, string idioma, bool hablado,
        Action<string> alTrozo, Action<string>? alEmocion = null, Action<string>? alReemplazo = null, CancellationToken ct = default, string? imagen = null)
    {
        var cuerpo = new Dictionary<string, object?>
        {
            ["message"] = mensaje, ["mode"] = "CONOCER", ["usuario"] = usuario,
            ["historial"] = historial.TakeLast(10).Select(h => new { rol = h.Rol, texto = h.Texto }).ToArray(),
            ["memoria"] = Array.Empty<string>(), ["avatar"] = avatar, ["idioma"] = idioma,
        };
        if (hablado) cuerpo["hablado"] = true;
        if (imagen != null) cuerpo["image"] = imagen;
        using var r = await Enviar(() => Pedido(HttpMethod.Post, "api/turno/stream", cuerpo, "text/event-stream"), ct, TimeSpan.FromSeconds(imagen != null ? 80 : 75), HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false);
        await using var s = await r.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
        var sse = new LectorSse();
        var dicho = new StringBuilder();
        string emocion = "neutral"; bool conEmocion = false;
        Respuesta? fin = null;
        var buf = new byte[8192];
        var dec = Encoding.UTF8.GetDecoder();
        var chars = new char[8192];
        using var reloj = CancellationTokenSource.CreateLinkedTokenSource(ct);
        reloj.CancelAfter(TimeSpan.FromSeconds(imagen != null ? 80 : 75));
        while (true)
        {
            int n;
            try { n = await s.ReadAsync(buf, reloj.Token).ConfigureAwait(false); }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested) { break; }
            catch (IOException) when (!ct.IsCancellationRequested) { break; }
            if (n == 0) break;
            int c = dec.GetChars(buf, 0, n, chars, 0);
            foreach (var (ev, datos) in sse.Leer(new string(chars, 0, c)))
            {
                JsonElement d;
                try { using var j = JsonDocument.Parse(datos); d = j.RootElement.Clone(); } catch { continue; }
                switch (ev)
                {
                    case "emocion":
                        if (!conEmocion && d.TryGetProperty("emocion", out var e)) { emocion = e.GetString() ?? "neutral"; conEmocion = true; alEmocion?.Invoke(emocion); }
                        break;
                    case "delta":
                        var trozo = d.TryGetProperty("voz", out var v) ? v.GetString() : d.TryGetProperty("text", out var tx) ? tx.GetString() : null;
                        if (!string.IsNullOrEmpty(trozo))
                        {
                            if (dicho.Length == 0) { var (emo, resto) = Expresiones.PelarEtiqueta(trozo); if (emo != null && !conEmocion) { emocion = emo; conEmocion = true; alEmocion?.Invoke(emo); } trozo = resto; }
                            if (trozo.Length == 0) break;
                            dicho.Append(trozo); alTrozo(trozo);
                        }
                        break;
                    case "replace":
                        var nuevo = d.TryGetProperty("voz", out var rv) ? rv.GetString() : d.TryGetProperty("text", out var rt) ? rt.GetString() : null;
                        if (nuevo != null) { dicho.Clear().Append(nuevo); alReemplazo?.Invoke(nuevo); }
                        break;
                    case "done":
                        if (d.TryGetProperty("emocion", out var de) && !conEmocion) { emocion = de.GetString() ?? emocion; alEmocion?.Invoke(emocion); }
                        var voz = d.TryGetProperty("voz", out var dv) ? dv.GetString() ?? "" : dicho.ToString();
                        var texto = d.TryGetProperty("reply", out var dr) ? dr.GetString() ?? "" : Expresiones.Quitar(voz);
                        fin = new Respuesta(Expresiones.Quitar(Expresiones.PelarEtiqueta(texto).Resto).Trim(), Expresiones.PelarEtiqueta(voz).Resto.Trim(), emocion,
                            null, d.TryGetProperty("ms", out var ms) && ms.TryGetInt64(out var msv) ? msv : 0, d.TryGetProperty("via", out var via) ? via.GetString() : null);
                        break;
                    case "error":
                        var err = d.TryGetProperty("error", out var de2) ? de2.GetString() ?? "error" : "error";
                        fin = new Respuesta(Expresiones.Quitar(dicho.ToString()).Trim(), dicho.ToString().Trim(), emocion, err);
                        break;
                }
            }
        }
        ct.ThrowIfCancellationRequested();
        if (fin != null) return fin;
        var todo = dicho.ToString().Trim();
        if (todo.Length == 0) throw new AuraError("El cerebro no contestó. Intenta otra vez.");
        return new Respuesta(Expresiones.Quitar(todo).Trim(), todo, emocion, "incompleto");
    }

    /// <summary>La voz del avatar para un texto (con sus [risa]…); la elige el servidor por avatar e idioma.</summary>
    public async Task<Audio> Voz(string texto, string emocion, string avatar, string idioma, CancellationToken ct = default)
    {
        using var r = await Enviar(() => Pedido(HttpMethod.Post, "api/tts", new { text = texto, emocion, performance = "speak", avatar, idioma, tiempos = "1" }, "audio/*"), ct, TimeSpan.FromSeconds(30)).ConfigureAwait(false);
        var bytes = await r.Content.ReadAsByteArrayAsync(ct).ConfigureAwait(false);
        string motor = r.Headers.TryGetValues("X-Ultron-TTS", out var m) ? m.FirstOrDefault() ?? "" : "";
        string? al = r.Headers.TryGetValues("X-Ultron-Alineacion", out var a) ? a.FirstOrDefault() : null;
        return new Audio(bytes, r.Content.Headers.ContentType?.MediaType ?? "audio/mpeg", motor, al);
    }

    /// <summary>Lo que se dijo (WAV 16 kHz mono) en texto, con el oído del servidor (Whisper/Scribe).</summary>
    public async Task<string> Oir(byte[] wav, string idioma, CancellationToken ct = default)
    {
        var b64 = "data:audio/wav;base64," + Convert.ToBase64String(wav);
        using var r = await Enviar(() => Pedido(HttpMethod.Post, "api/stt", new { audioBase64 = b64, mimeType = "audio/wav", language = idioma }), ct, TimeSpan.FromSeconds(18)).ConfigureAwait(false);
        using var j = await Json(r, ct).ConfigureAwait(false);
        return j.RootElement.TryGetProperty("text", out var t) ? (t.GetString() ?? "").Trim() : "";
    }

    /// <summary>Qué hay en una imagen (la pantalla), con los ojos del servidor.</summary>
    public async Task<string> Ver(byte[] jpeg, string pregunta, CancellationToken ct = default)
    {
        var cuerpo = new { mediaType = "image/jpeg", fileName = "pantalla.jpg", base64Data = "data:image/jpeg;base64," + Convert.ToBase64String(jpeg), prompt = pregunta };
        using var r = await Enviar(() => Pedido(HttpMethod.Post, "api/vision/analyze", cuerpo), ct, TimeSpan.FromSeconds(45)).ConfigureAwait(false);
        using var j = await Json(r, ct).ConfigureAwait(false);
        return j.RootElement.TryGetProperty("summary", out var s) ? (s.GetString() ?? "").Trim() : "";
    }

    /// <summary>Hasta cuándo no se le pregunta al nodo (no tiene el modelo «windows», no contesta o tardó).</summary>
    DateTime nodoApagadoHasta = DateTime.MinValue;
    public bool NodoDisponible => !string.IsNullOrEmpty(Token) && DateTime.UtcNow >= nodoApagadoHasta;

    /// <summary>
    /// Laya «windows» en el nodo. Null si no hay sesión, no hay Laya o tardó. Si el nodo no tiene el modelo
    /// (o falla), no se le vuelve a preguntar en 5 minutos: así cada frase no paga una espera inútil.
    /// </summary>
    public async Task<DecisionNodo?> Intencion(string texto, CancellationToken ct = default)
    {
        if (!NodoDisponible) return null;
        try
        {
            // Sin renovar la sesión: Laya es un atajo; un login por cada frase podría bloquear la cuenta.
            using var r = await Enviar(() => Pedido(HttpMethod.Post, "api/windows/intencion", new { texto }), ct, TimeSpan.FromMilliseconds(1100), renovar: false).ConfigureAwait(false);
            using var j = await Json(r, ct).ConfigureAwait(false);
            var raiz = j.RootElement;
            var et = raiz.TryGetProperty("etiqueta", out var e) && e.ValueKind == JsonValueKind.String ? e.GetString() : null;
            var motivo = raiz.TryGetProperty("motivo", out var m) && m.ValueKind == JsonValueKind.String ? m.GetString() ?? "" : "";
            if (et == null && motivo != "ok") nodoApagadoHasta = DateTime.UtcNow.AddMinutes(5);
            return new DecisionNodo(et, raiz.TryGetProperty("p", out var p) ? p.GetDouble() : 0, raiz.TryGetProperty("seguro", out var s) && s.GetBoolean());
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested) { nodoApagadoHasta = DateTime.UtcNow.AddMinutes(2); return null; }
        catch (AuraError) { nodoApagadoHasta = DateTime.UtcNow.AddMinutes(2); return null; }
        catch (Exception e) when (e is InvalidOperationException or KeyNotFoundException or FormatException) { return null; }
    }

    /// <summary>Los Client ID de Spotify, Google y Microsoft que puso el servidor (con sesión). Null en lo que falta.</summary>
    public async Task<(string? Spotify, string? Google, string? GoogleSecreto, string? Microsoft)> ClientesOauth(CancellationToken ct = default)
    {
        using var r = await Enviar(() => Pedido(HttpMethod.Get, "api/windows/conexiones", null), ct, TimeSpan.FromSeconds(15)).ConfigureAwait(false);
        using var j = await Json(r, ct).ConfigureAwait(false);
        static string? Id(JsonElement raiz, string servicio, string campo = "clientId") =>
            raiz.TryGetProperty(servicio, out var s) && s.ValueKind == JsonValueKind.Object && s.TryGetProperty(campo, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        var raiz = j.RootElement;
        return (Id(raiz, "spotify"), Id(raiz, "google"), Id(raiz, "google", "clientSecret"), Id(raiz, "microsoft"));
    }

    public void Dispose() => http.Dispose();
}

/// <summary>Lee eventos SSE («event: x\ndata: {...}\n\n») de trozos que llegan partidos en cualquier sitio.</summary>
public sealed class LectorSse
{
    readonly StringBuilder pendiente = new();
    public IEnumerable<(string Evento, string Datos)> Leer(string trozo)
    {
        pendiente.Append(trozo.Replace("\r\n", "\n"));
        var salida = new List<(string, string)>();
        while (true)
        {
            var s = pendiente.ToString();
            var fin = s.IndexOf("\n\n", StringComparison.Ordinal);
            if (fin < 0) break;
            var bloque = s[..fin];
            pendiente.Remove(0, fin + 2);
            string ev = "message"; var datos = new StringBuilder();
            foreach (var linea in bloque.Split('\n'))
            {
                if (linea.StartsWith("event:", StringComparison.Ordinal)) ev = linea[6..].Trim();
                else if (linea.StartsWith("data:", StringComparison.Ordinal)) { if (datos.Length > 0) datos.Append('\n'); datos.Append(linea[5..].TrimStart()); }
            }
            if (datos.Length > 0) salida.Add((ev, datos.ToString()));
        }
        return salida;
    }
}

/// <summary>Las expresiones de voz ([risa], [suspiro]…) y la etiqueta de emoción inicial [EMO:x].</summary>
public static class Expresiones
{
    static readonly Regex Etiqueta = new(@"^\s*\[(?:EMO:)?(?<e>[a-záéíóú_]+)\]\s*", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    static readonly Regex Marcas = new(@"\[[^\]\n]{1,40}\]", RegexOptions.CultureInvariant);
    static readonly HashSet<string> Emociones = new(StringComparer.OrdinalIgnoreCase)
    { "neutral", "feliz", "risa", "sorpresa", "curioso", "pensando", "preocupado", "triste", "molesto", "cansado", "carino", "orgullo", "travieso", "canto", "oracion", "escepticismo", "alarma", "firme", "seco" };

    public static (string? Emocion, string Resto) PelarEtiqueta(string texto)
    {
        var m = Etiqueta.Match(texto ?? "");
        if (m.Success && Emociones.Contains(m.Groups["e"].Value)) return (m.Groups["e"].Value.ToLowerInvariant(), texto![m.Length..]);
        return (null, texto ?? "");
    }

    public static string Quitar(string texto) => Regex.Replace(Marcas.Replace(texto ?? "", ""), @"[ \t]{2,}", " ");
}

/// <summary>
/// Corta lo que va llegando del cerebro en frases para la voz: la primera sale apenas cierra (la voz
/// empieza antes de que termine de pensar); las demás, con un mínimo para no pedir audio palabra por
/// palabra. Igual idea que puntoDeCorte del servidor.
/// </summary>
public sealed class CortadorFrases
{
    readonly StringBuilder buf = new();
    bool primera = true;
    static readonly Regex Cierre = new(@"(?<=[.!?…:;])[""'»)\]]*\s+|\n+", RegexOptions.CultureInvariant);

    public IEnumerable<string> Agregar(string trozo)
    {
        buf.Append(trozo);
        var salida = new List<string>();
        while (true)
        {
            var s = buf.ToString();
            int minimo = primera ? 6 : 40;
            int corte = -1;
            foreach (Match m in Cierre.Matches(s))
                if (m.Index >= minimo) { corte = m.Index + m.Length; break; }
            if (corte < 0 && s.Length > 220)
            {
                var coma = s.LastIndexOf(", ", 200, StringComparison.Ordinal);
                if (coma > 40) corte = coma + 2;
            }
            if (corte < 0) break;
            var frase = s[..corte].Trim();
            buf.Remove(0, corte);
            if (frase.Length > 0) { salida.Add(frase); primera = false; }
        }
        return salida;
    }

    public string? Resto()
    {
        var s = buf.ToString().Trim();
        buf.Clear();
        return s.Length > 0 ? s : null;
    }

    public void Reiniciar() { buf.Clear(); primera = true; }
}
