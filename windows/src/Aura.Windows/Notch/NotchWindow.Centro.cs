using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using Aura.Windows.Centro;
using Aura.Windows.Core;

namespace Aura.Windows.Notch;

/// <summary>
/// El puente del Centro (la ventana grande, WebView2) con AURA: entrar con Genesis ID como la app,
/// la sesión, los ajustes, el chat, el relevo de PULSE2CHAT (sin CORS, desde aquí), el cajón cifrado
/// y la llamada entrante en el notch. Ver windows/centro/PUENTE.md.
/// </summary>
public partial class NotchWindow
{
    CentroWindow? centro;
    TaskCompletionSource<string>? vueltaGenesis;
    string estadoGenesis = "";
    static readonly HttpClient relevoHttp = new() { Timeout = TimeSpan.FromSeconds(65) };
    const string RelevoBase = "https://cerebro.ordenscan.com/mensajes";
    static readonly Regex RutaRelevo = new("^/[a-z0-9/_-]{1,60}$");

    /// <summary>
    /// Arranca el Centro escondido (con sesión): así PULSE2CHAT escucha llamadas y mensajes aunque nunca lo
    /// abras. WebView2 necesita que la ventana exista; se muestra fuera de la vista y se esconde al cargar.
    /// </summary>
    internal void PrepararCentro()
    {
        if (soloRender || centro != null || string.IsNullOrEmpty(ajustes.Token)) return;
        centro = new CentroWindow(ManejarCentro) { ShowActivated = false, ShowInTaskbar = false, Left = -32000, Top = -32000, WindowStartupLocation = WindowStartupLocation.Manual };
        centro.Activated += (_, _) => { if (panelAbierto) AbrirPanel(false); };
        centro.Listo += () => Dispatcher.BeginInvoke(new Action(() =>
        {
            if (centro == null) return;
            centro.Hide();
            centro.ShowInTaskbar = true;
            centro.Left = (SystemParameters.WorkArea.Width - centro.Width) / 2; centro.Top = (SystemParameters.WorkArea.Height - centro.Height) / 2;
        }), DispatcherPriority.ApplicationIdle);
        centro.Show();
    }

    /// <summary>«llamada|voz|karla», «llamada|video|karla», «mensaje|karla|texto». Los mensajes esperan el «sí».</summary>
    void HacerPulse(string valor)
    {
        var p = valor.Split('|', 3);
        if (p.Length < 3) return;
        void Mandar(object accion) { if (centro == null) PrepararCentro(); centro?.Emitir("pulse.accion", accion); }
        if (p[0] == "llamada")
        {
            AbrirCentro("pulse");
            // La página tarda un momento en cargar si el Centro no estaba abierto.
            Dispatcher.BeginInvoke(new Action(() => Mandar(new { tipo = "llamada", video = p[1] == "video", con = p[2] })), DispatcherPriority.ApplicationIdle);
            Hecho(p[1] == "video" ? T("Videollamada", "Video call") : T("Llamando", "Calling"), p[2], "\uE717");
            return;
        }
        var con = p[1];
        var cuerpo = p[2];
        Proponer(new Propuesta(T($"¿Le mando a {con}?", $"Send to {con}?"), "«" + (cuerpo.Length > 140 ? cuerpo[..140] + "…" : cuerpo) + "»", DateTime.Now.AddSeconds(30),
            () => { Mandar(new { tipo = "mensaje", con, texto = cuerpo }); return Task.CompletedTask; }));
    }

    /// <summary>Abre (o trae al frente) el Centro.</summary>
    internal void AbrirCentro(string? seccion = null)
    {
        if (soloRender) return;
        if (centro == null)
        {
            centro = new CentroWindow(ManejarCentro);
            // Con el Centro al frente, el panel del notch se recoge: no lo tapa.
            centro.Activated += (_, _) => { if (panelAbierto) AbrirPanel(false); };
            centro.Mostrar(seccion);
            return;
        }
        centro.Mostrar(seccion);
    }

    void AbrirCentroClic(object s, RoutedEventArgs e) { e.Handled = true; AbrirCentro(); }

    /// <summary>Lo que llega por ultronfp:// o «--centro» (de otro proceso, por la tubería).</summary>
    internal void PedidoExterno(string pedido)
    {
        Registro.Anotar("pedido", pedido.StartsWith("ultronfp", StringComparison.OrdinalIgnoreCase) ? "vuelta de la wallet" : pedido);
        if (pedido == "--centro") { AbrirCentro(); return; }
        if (GenesisSso.LeerVuelta(pedido) is { } v)
        {
            if (vueltaGenesis != null && v.Estado == estadoGenesis) vueltaGenesis.TrySetResult(pedido);
            else Avisar(new Aviso(T("Enlace de Genesis ID", "Genesis ID link"), T("Llegó una vuelta que AURA no pidió; la ignoré.", "A sign-in AURA didn't ask for arrived; ignored."), "", "worried", Segundos: 5));
            centro?.Mostrar();
        }
    }

    object EstadoCentro() => new
    {
        version = typeof(NotchWindow).Assembly.GetName().Version?.ToString(3) ?? "",
        sesion = string.IsNullOrEmpty(ajustes.Token) ? null : new { nombre = ajustes.Nombre, correo = ajustes.Correo, rol = ajustes.Rol, nivel = ajustes.Nivel, gid = ajustes.Gid },
        avatar = ajustes.Avatar,
        idioma = ajustes.Idioma,
        primeraVez = !ajustes.PrimeraVezHecha,
        conexiones = new Dictionary<string, string?>
        {
            ["spotify"] = ajustes.Conexiones.TryGetValue("spotify", out var s) ? (s.Cuenta.Length > 0 ? s.Cuenta : "conectado") : null,
            ["google"] = ajustes.Conexiones.TryGetValue("google", out var g) ? (g.Cuenta.Length > 0 ? g.Cuenta : "conectado") : null,
            ["microsoft"] = ajustes.Conexiones.TryGetValue("microsoft", out var m) ? (m.Cuenta.Length > 0 ? m.Cuenta : "conectado") : null,
        },
        cartera = new { direccion = ajustes.CarteraDireccion },
    };

    internal void AvisarEstadoCentro() => centro?.Emitir("estado", EstadoCentro());

    static string Texto(JsonElement a, string k) => a.ValueKind == JsonValueKind.Object && a.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";
    static bool? Bool(JsonElement a, string k) => a.ValueKind == JsonValueKind.Object && a.TryGetProperty(k, out var v) && v.ValueKind is JsonValueKind.True or JsonValueKind.False ? v.GetBoolean() : null;

    /// <summary>El puente: cada método del Centro. Corre en el hilo de la interfaz.</summary>
    async Task<object?> ManejarCentro(string metodo, JsonElement a)
    {
        switch (metodo)
        {
            case "estado": return EstadoCentro();
            case "entrar.genesis": return await EntrarGenesis(null);
            case "entrar.enlace": return await EntrarGenesis(Texto(a, "url"));
            case "entrar.clave": return await EntrarClave(Texto(a, "correo"), Texto(a, "clave"));
            case "salir": await SalirCuenta(); return true;
            case "primeraVez.terminar":
                ajustes.PrimeraVezHecha = true; GuardarAjustes(); return true;
            case "ajustes.leer": return AjustesParaCentro();
            case "ajustes.guardar": GuardarDesdeCentro(a); return AjustesParaCentro();
            case "ventana.recoger": centro?.Hide(); Avisar(new Aviso(ajustes.NombreAvatar, T("Aquí sigo, arriba. Ctrl+Alt+C abre el Centro.", "Still here. Ctrl+Alt+C opens the Center."), "", "happy", Segundos: 3)); return true;
            case "ventana.mostrar": AbrirCentro(Texto(a, "seccion") is { Length: > 0 } sec ? sec : null); return true;
            case "relevo": return await Relevo(Texto(a, "ruta"), a.TryGetProperty("cuerpo", out var c) ? c : default, a.TryGetProperty("ms", out var ms) && ms.TryGetInt32(out var m) ? m : 15000);
            case "relevo.archivo": return await RelevoArchivo(Texto(a, "id"));
            case "secreto.leer": return Secretos.Obtener(Texto(a, "clave"));
            case "secreto.guardar": Secretos.Guardar(Texto(a, "clave"), Texto(a, "valor")); return true;
            case "secreto.borrar": Secretos.Borrar(Texto(a, "clave")); return true;
            case "notch.timbre": Timbre(Texto(a, "de"), Texto(a, "nombre"), Bool(a, "video") == true); return true;
            case "notch.colgada" or "notch.timbreFin": if (propuesta?.Titulo.StartsWith("📞") == true) { propuesta = null; relojPropuesta?.Stop(); Recalcular(); } return true;
            case "notch.aviso": Avisar(new Aviso(Recortar(Texto(a, "titulo"), 60), Recortar(Texto(a, "cuerpo"), 120), "", "happy", T("Ver", "View"), () => AbrirCentro("pulse"), 6)); return true;
            case "chat.enviar":
            {
                var t = Texto(a, "texto").Trim();
                if (t.Length == 0) return false;
                _ = Procesar(t.Length > 4000 ? t[..4000] : t, false);
                return true;
            }
            case "chat.callar": Callar(); return true;
            case "chat.hablar":
                Microfono(this, new RoutedEventArgs()); return true;
            case "inicio.dia": return await ResumenDelDia();
            case "diagnostico.leer": return Registro.Ultimo(400);
            case "actualizar.estado": return EstadoActualizacion();
            case "actualizar.buscar": await BuscarActualizacion(true); return EstadoActualizacion();
            case "actualizar.instalar": { var motivo = await InstalarAhora(); return new { ok = motivo == null, motivo }; }
            case "diagnostico.carpeta": Process.Start(new ProcessStartInfo("explorer.exe", "\"" + Registro.Carpeta + "\"") { UseShellExecute = true }); return true;
            default:
                if (metodo.StartsWith("spotify.", StringComparison.Ordinal)) return await ManejarSpotify(metodo, a);
                if (metodo.StartsWith("cartera.", StringComparison.Ordinal)) return await ManejarCartera(metodo, a);
                if (metodo is "conectar" or "desconectar") return await ManejarConexion(metodo, Texto(a, "servicio"));
                throw new InvalidOperationException("Método desconocido: " + metodo);
        }
    }

    /// <summary>Para el Inicio del Centro: lo de hoy en la agenda, correos sin leer y los últimos avisos de las apps.</summary>
    async Task<object> ResumenDelDia()
    {
        object[] eventos = Array.Empty<object>();
        int? correos = null;
        string[] ultimos = Array.Empty<string>();
        if (agenda != null)
        {
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(8));
                await agenda.Cargar(cts.Token);
                var hoy = DateTime.Now;
                eventos = agenda.Entre(hoy, hoy.Date.AddDays(1)).Take(5)
                    .Select(e => (object)new { hora = e.TodoElDia ? T("todo el día", "all day") : e.Inicio.ToString("h:mm tt"), titulo = e.Titulo }).ToArray();
            }
            catch (Exception ex) when (ex is not OutOfMemoryException) { Registro.Anotar("inicio", "agenda: " + ex.Message); }
        }
        if (correo != null)
        {
            try { using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(8)); correos = (await correo.NoLeidos(30, cts.Token)).Count; }
            catch (Exception ex) when (ex is not OutOfMemoryException) { Registro.Anotar("inicio", "correo: " + ex.Message); }
        }
        if (avisosApps != null)
        {
            try { ultimos = (await Task.Run(() => avisosApps.Recientes(6))).Where(x => !AvisosApps.EsPropia(x.Aumid) && !Silenciada(x.App)).Take(3).Select(x => $"{x.App}: {x.Titulo}").ToArray(); }
            catch (Exception ex) when (ex is not OutOfMemoryException) { Registro.Anotar("inicio", "avisos: " + ex.Message); }
        }
        return new { eventos, correos, avisos = ultimos };
    }

    static string Recortar(string s, int n) => s.Length > n ? s[..n] + "…" : s;

    void GuardarAjustes() { try { ajustes.Guardar(); } catch (Exception ex) { Registro.Anotar("ajustes", ex.Message); } }

    // ───────────── entrar ─────────────

    async Task<object> EntrarGenesis(string? enlacePegado)
    {
        var apiEntrar = new AuraApi(ajustes.Servidor);
        string url;
        string verificador;
        if (enlacePegado != null)
        {
            // Un enlace pegado a mano solo vale para el pedido en curso (mismo estado).
            if (vueltaGenesis == null || GenesisSso.LeerVuelta(enlacePegado) is not { } v0 || v0.Estado != estadoGenesis)
                throw new InvalidOperationException(T("Ese enlace no es de este inicio de sesión. Toca «Entrar con Genesis ID» otra vez.", "That link isn't from this sign-in. Tap “Sign in with Genesis ID” again."));
            vueltaGenesis.TrySetResult(enlacePegado);
            return new { esperando = true };
        }
        var (ver, reto, est) = GenesisSso.Nuevo();
        verificador = ver;
        estadoGenesis = est;
        var espera = vueltaGenesis = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        var web = await apiEntrar.WalletWeb();
        Registro.Anotar("genesis", "pidiendo pase a la wallet");
        Process.Start(new ProcessStartInfo(GenesisSso.Url(web, reto, est)) { UseShellExecute = true });
        var gano = await Task.WhenAny(espera.Task, Task.Delay(TimeSpan.FromMinutes(5)));
        vueltaGenesis = null;
        if (gano != espera.Task) throw new InvalidOperationException(T("Pasaron 5 minutos sin volver de Veta Wallet. Vuelve a intentarlo.", "5 minutes passed without coming back from Veta Wallet. Try again."));
        url = espera.Task.Result;
        var vuelta = GenesisSso.LeerVuelta(url)!.Value;
        if (vuelta.Error is { Length: > 0 } err) throw new InvalidOperationException(GenesisSso.ExplicarError(err, Ingles));
        if (string.IsNullOrEmpty(vuelta.Pase)) throw new InvalidOperationException(T("La wallet volvió sin pase.", "The wallet came back without a pass."));
        try
        {
            var (token, miembro, nombreGenesis) = await apiEntrar.EntrarGenesis(vuelta.Pase!, verificador);
            FijarSesion(token, miembro, genesis: true);
            Registro.Anotar("genesis", $"dentro como {miembro.Nivel}");
            return new { miembro = new { nombre = miembro.Nombre, correo = miembro.Correo, rol = miembro.Rol, nivel = miembro.Nivel, gid = miembro.Gid }, genesis = nombreGenesis, pase = vuelta.Pase, verificador };
        }
        finally { apiEntrar.Dispose(); }
    }

    async Task<object> EntrarClave(string correo, string clave)
    {
        if (correo.Length < 3 || clave.Length == 0) throw new InvalidOperationException(T("Escribe tu correo y tu clave.", "Type your email and password."));
        using var apiEntrar = new AuraApi(ajustes.Servidor);
        var (token, nombre, mail) = await apiEntrar.Entrar(correo, clave);
        apiEntrar.Token = token;
        var quien = await apiEntrar.Sesion() ?? new Miembro(nombre, mail, "", "", "");
        ajustes.Clave = clave; // solo con clave: permite renovar la sesión sola, como la app
        FijarSesion(token, quien with { Nombre = quien.Nombre.Length > 0 ? quien.Nombre : nombre, Correo = quien.Correo.Length > 0 ? quien.Correo : mail }, genesis: false);
        return new { miembro = new { nombre = ajustes.Nombre, correo = ajustes.Correo, rol = ajustes.Rol, nivel = ajustes.Nivel } };
    }

    void FijarSesion(string token, Miembro m, bool genesis)
    {
        if (!string.Equals(ajustes.Correo, m.Correo, StringComparison.OrdinalIgnoreCase)) { Secretos.BorrarTodo(); ajustes.CarteraDireccion = ""; }
        ajustes.Token = token; ajustes.Correo = m.Correo; ajustes.Nombre = m.Nombre; ajustes.Rol = m.Rol; ajustes.Nivel = m.Nivel; ajustes.Gid = m.Gid;
        ajustes.PorGenesis = genesis;
        if (genesis) ajustes.Clave = "";
        GuardarAjustes();
        CrearApi();
        noRenovarHasta = DateTime.MinValue;
        AvisoCuenta.Visibility = Visibility.Collapsed;
        AvisarEstadoCentro();
        Avisar(new Aviso(T("Hola, ", "Hi, ") + (m.Nombre.Length > 0 ? m.Nombre.Split(' ')[0] : m.Correo), T("Ya estás dentro de AU-RA.", "You're signed in to AU-RA."), "", "happy", Segundos: 3));
    }

    async Task SalirCuenta()
    {
        if (api != null) await api.Salir();
        ajustes.Token = ""; ajustes.Clave = ""; ajustes.Nombre = ""; ajustes.Rol = ""; ajustes.Nivel = ""; ajustes.Gid = ""; ajustes.PorGenesis = false;
        Secretos.BorrarTodo();
        GuardarAjustes();
        CrearApi();
        AvisoCuenta.Visibility = Visibility.Visible;
        centro?.Emitir("salio", null);
    }

    // ───────────── ajustes desde el Centro ─────────────

    object AjustesParaCentro() => new
    {
        avatar = ajustes.Avatar, idioma = ajustes.Idioma, escucha = ajustes.Escucha, vozMotor = ajustes.VozMotor,
        manosLibres = ajustes.ManosLibres, interrumpir = ajustes.Interrumpir, responderConVoz = ajustes.ResponderConVoz,
        ocultarEnPantallaCompleta = ajustes.OcultarEnPantallaCompleta, vozDeWindows = ajustes.VozDeWindows, oidoDeWindows = ajustes.OidoDeWindows,
        avisosDeApps = ajustes.AvisosDeApps, avisosPrivados = ajustes.AvisosPrivados, avisosEnVoz = ajustes.AvisosEnVoz, appsSilenciadas = ajustes.AppsSilenciadas,
        avisarCorreos = ajustes.AvisarCorreos, mostrarMusica = ajustes.MostrarMusica, actualizarSolo = ajustes.ActualizarSolo,
        correoDireccion = ajustes.CorreoDireccion, agendaUrl = ajustes.AgendaUrl, tieneClaveCorreo = ajustes.CorreoClave.Length > 0,
        carteraDireccion = ajustes.CarteraDireccion, servidor = ajustes.Servidor,
        clientes = new { spotify = ajustes.SpotifyClientId, google = ajustes.GoogleClientId, microsoft = ajustes.MicrosoftClientId },
    };

    void GuardarDesdeCentro(JsonElement a)
    {
        if (a.ValueKind != JsonValueKind.Object) return;
        bool cuentas = false, avisos = false, escucha = false;
        foreach (var p in a.EnumerateObject())
        {
            switch (p.Name)
            {
                case "avatar" when p.Value.GetString() is "aura" or "claudio" or "antonio" or "ojos": AplicarAvatar(p.Value.GetString()!, false); break;
                case "idioma" when p.Value.GetString() is "es" or "en": ajustes.Idioma = p.Value.GetString()!; escucha = true; break;
                case "escucha" when p.Value.GetString() is "pedir" or "palabra" or "siempre": ajustes.Escucha = p.Value.GetString()!; escucha = true; break;
                case "manosLibres": ajustes.ManosLibres = p.Value.GetBoolean(); break;
                case "vozMotor" when p.Value.GetString() is "agente" or "local":
                    ajustes.VozMotor = p.Value.GetString()!; agenteFalloHasta = DateTime.MinValue;
                    if (ajustes.VozMotor == "local") CerrarAgente();
                    break;
                case "actualizarSolo": ajustes.ActualizarSolo = p.Value.GetBoolean(); break;
                case "interrumpir": ajustes.Interrumpir = p.Value.GetBoolean(); break;
                case "responderConVoz": ajustes.ResponderConVoz = p.Value.GetBoolean(); break;
                case "ocultarEnPantallaCompleta": ajustes.OcultarEnPantallaCompleta = p.Value.GetBoolean(); break;
                case "vozDeWindows": ajustes.VozDeWindows = p.Value.GetBoolean(); break;
                case "oidoDeWindows": ajustes.OidoDeWindows = p.Value.GetBoolean(); break;
                case "avisosDeApps": ajustes.AvisosDeApps = p.Value.GetBoolean(); avisos = true; break;
                case "avisosPrivados": ajustes.AvisosPrivados = p.Value.GetBoolean(); break;
                case "avisosEnVoz": ajustes.AvisosEnVoz = p.Value.GetBoolean(); break;
                case "appsSilenciadas": ajustes.AppsSilenciadas = p.Value.EnumerateArray().Select(x => x.GetString() ?? "").Where(x => x.Length > 0).Distinct().ToList(); break;
                case "avisarCorreos": ajustes.AvisarCorreos = p.Value.GetBoolean(); break;
                case "mostrarMusica": ajustes.MostrarMusica = p.Value.GetBoolean(); AlCambiarMusica(cancion, false); break;
                case "correoDireccion": ajustes.CorreoDireccion = (p.Value.GetString() ?? "").Trim(); cuentas = true; break;
                case "correoClave": ajustes.CorreoClave = p.Value.GetString() ?? ""; cuentas = true; break;
                case "agendaUrl": ajustes.AgendaUrl = (p.Value.GetString() ?? "").Trim(); cuentas = true; break;
                case "carteraDireccion": ajustes.CarteraDireccion = Manos.Cartera.ValidarDireccion(p.Value.GetString() ?? ""); break;
                case "servidor": ajustes.Servidor = AuraApi.Validar(p.Value.GetString() ?? "").AbsoluteUri.TrimEnd('/'); CrearApi(); break;
                case "clientes" when p.Value.ValueKind == JsonValueKind.Object:
                    ajustes.SpotifyClientId = Texto(p.Value, "spotify").Trim(); ajustes.GoogleClientId = Texto(p.Value, "google").Trim();
                    ajustes.MicrosoftClientId = Texto(p.Value, "microsoft").Trim(); if (Texto(p.Value, "googleSecreto") is { Length: > 0 } gs) ajustes.GoogleClientSecret = gs.Trim();
                    cuentas = true; break;
            }
        }
        GuardarAjustes();
        if (cuentas) IniciarCuentas();
        if (avisos) IniciarAvisosApps();
        if (escucha) AplicarEscucha();
        AvisarEstadoCentro();
    }

    // ───────────── PULSE2CHAT: el relevo desde aquí (sin CORS) ─────────────

    async Task<object> Relevo(string ruta, JsonElement cuerpo, int ms)
    {
        if (!RutaRelevo.IsMatch(ruta)) throw new InvalidOperationException("Ruta del relevo inválida.");
        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(Math.Clamp(ms, 1000, 60000)));
        using var req = new HttpRequestMessage(HttpMethod.Post, RelevoBase + ruta)
        {
            Content = new StringContent(cuerpo.ValueKind == JsonValueKind.Undefined ? "{}" : cuerpo.GetRawText(), Encoding.UTF8, "application/json"),
        };
        try
        {
            using var r = await relevoHttp.SendAsync(req, cts.Token);
            var texto = await r.Content.ReadAsStringAsync(cts.Token);
            JsonElement? datos = null;
            try { using var d = JsonDocument.Parse(texto.Length == 0 ? "{}" : texto); datos = d.RootElement.Clone(); } catch (JsonException) { }
            return new { estado = (int)r.StatusCode, datos };
        }
        catch (OperationCanceledException) { return new { estado = 0, datos = (object?)null, motivo = "plazo" }; }
        catch (HttpRequestException ex) { return new { estado = 0, datos = (object?)null, motivo = "sin-red: " + ex.Message }; }
    }

    async Task<object> RelevoArchivo(string id)
    {
        if (!Regex.IsMatch(id, "^[A-Za-z0-9_-]{4,80}$")) throw new InvalidOperationException("Archivo inválido.");
        using var r = await relevoHttp.GetAsync(RelevoBase + "/archivo/" + id);
        if (!r.IsSuccessStatusCode) throw new InvalidOperationException("El archivo no está (" + (int)r.StatusCode + ").");
        var b = await r.Content.ReadAsByteArrayAsync();
        if (b.Length > 15_000_000) throw new InvalidOperationException("El archivo es demasiado grande.");
        return new { base64 = Convert.ToBase64String(b), mime = r.Content.Headers.ContentType?.MediaType ?? "application/octet-stream" };
    }

    // ───────────── llamada entrante en el notch ─────────────

    void Timbre(string de, string nombre, bool video)
    {
        var quien = nombre.Length > 0 ? nombre : de;
        Proponer(new Propuesta("📞 " + (video ? T("Videollamada de ", "Video call from ") : T("Llamada de ", "Call from ")) + quien,
            T("Di «sí» para contestar o «no» para rechazar.", "Say “yes” to answer or “no” to decline."),
            DateTime.Now.AddSeconds(45),
            () => { AbrirCentro("pulse"); centro?.Emitir("llamada.accion", new { accion = "contestar" }); return Task.CompletedTask; },
            () => { centro?.Emitir("llamada.accion", new { accion = "rechazar" }); return Task.CompletedTask; }));
    }

    // ───────────── el chat del Centro ve lo mismo que el del notch ─────────────

    int siguienteBurbuja = 1;
    readonly Dictionary<TextBlock, int> burbujas = new();

    /// <summary>Se llama al crear cada burbuja: el Centro la recibe y la ve crecer mientras llega.</summary>
    void EspejarBurbuja(string quien, TextBlock cuerpo)
    {
        if (soloRender) return;
        int id = siguienteBurbuja++;
        burbujas[cuerpo] = id;
        centro?.Emitir("chat.mensaje", new { id, quien, texto = cuerpo.Text, mio = quien == "Tú" });
        var desc = DependencyPropertyDescriptor.FromProperty(TextBlock.TextProperty, typeof(TextBlock));
        desc.AddValueChanged(cuerpo, (_, _) => centro?.Emitir("chat.mensaje", new { id, quien, texto = cuerpo.Text, mio = quien == "Tú" }));
    }
}
