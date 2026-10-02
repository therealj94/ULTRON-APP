using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Media;
using System.Windows.Threading;
using Aura.Windows.Core;
using Aura.Windows.Voz;

namespace Aura.Windows.Notch;

/// <summary>
/// La conversación: ESCUCHAR (el oído del servidor) → ENTENDER (reglas, Laya ligera, Laya del nodo) →
/// HACER una mano o PREGUNTAR al cerebro (Qwen, el mismo de la app) → HABLAR con la voz del avatar
/// (ElevenLabs en el servidor), frase por frase mientras el cerebro sigue escribiendo. Hablarle
/// mientras habla la interrumpe; en manos libres vuelve a escuchar sola al terminar.
/// </summary>
public partial class NotchWindow
{
    internal Ajustes ajustes = new();
    AuraApi? api;
    readonly Oido oido = new();
    readonly Altavoz altavoz = new();
    readonly Despertador despertador = new();
    /// <summary>¿Suena algo en la PC (cualquier app)? Para que el despertar se ponga exigente con todo, no solo con Spotify.</summary>
    readonly SonidoDelEquipo sonidoEquipo = new();
    /// <summary>Cuándo AURA terminó de hablar: el eco de la sala todavía suena un momento y no debe despertarla.</summary>
    DateTime finVozAura = DateTime.MinValue;
    static readonly TimeSpan GraciaTrasHablar = TimeSpan.FromMilliseconds(1500);
    readonly CortadorFrases cortador = new();
    readonly List<Turno> historial = new();
    readonly DispatcherTimer relojRecordatorios = new() { Interval = TimeSpan.FromSeconds(5) };
    CancellationTokenSource? turno, voz;
    bool escuchando, pensando, hablandoAhora, panelAbierto, pausado, continuo, turnoEnCurso;
    long generacion;
    int vaciasSeguidas;
    readonly SemaphoreSlim renovando = new(1, 1);
    DateTime noRenovarHasta;
    string ultimaRespuesta = "";
    string emocionActual = "neutral";
    bool microSilenciado;
    /// <summary>La persona pidió hablar (tecla, clic, «Oye AURA» de Windows): la próxima frase cuenta sin decir el nombre.</summary>
    bool llamadaExplicita;
    /// <summary>«Oye AURA» llegó a media frase: la orden viene en esa misma frase, se deja terminar y se hace.</summary>
    bool despertarAlTerminar;
    DateTime ultimaCharla = DateTime.MinValue;
    /// <summary>
    /// Las métricas por turno (auditoría 1-oct, H08): cada turno con id y reloj propios, cada etapa por separado
    /// y siempre cerrado (ok, cancelado, fallo, silencio…). Solo números en el registro.
    /// </summary>
    readonly MetricasVoz metricas = new(l => Centro.Registro.Anotar("voz-turno", l));

    void Iniciar()
    {
        ajustes = soloRender ? new Ajustes() : Ajustes.Cargar();
        Centro.Registro.Detallado = ajustes.RegistroDetallado;
        AplicarAvatar(ajustes.Avatar, false);
        AvisoCuenta.Visibility = string.IsNullOrEmpty(ajustes.Token) ? Visibility.Visible : Visibility.Collapsed;
        if (soloRender) return;
        CrearApi();
        RecuperarBorrador();
        // Con verbos ambiguos («pon Spotify») solo cuenta una app que de verdad está instalada (nombre exacto o que empieza así).
        var comunes = Parametros.EsAppConocida;
        Parametros.EsAppConocida = o => comunes(o) || Manos.Aplicaciones.Buscar(o, 80) != null;
        _ = Manos.Aplicaciones.Indexar().ContinueWith(_ => Dispatcher.BeginInvoke(new Action(() => FiltrarApps(this, null!))));
        PintarRecordatorios();
        IniciarMusicaYCuentas();
        IniciarAvisosApps();
        relojRecordatorios.Tick += (_, _) =>
        {
            RevisarRecordatorios();
            RevisarAgente();
            // «Siempre atenta»: si algo cerró el micrófono (un aviso, una acción), vuelve a escuchar sola.
            if (ajustes.Escucha is "siempre" or "palabra" && !microSilenciado && !pausado && !escuchando && !hablandoAhora && !pensando && propuesta == null && !soloRender)
            { continuo = true; EmpezarAEscuchar(); }
        };
        relojRecordatorios.Start();

        oido.Nivel += n => Dispatcher.BeginInvoke(new Action(() => { BarrasEscucha.Nivel = n; if (escuchando) { EscalaAnillo.ScaleX = EscalaAnillo.ScaleY = 1 + n * 0.5; } }));
        oido.EmpezoAHablar += () => Dispatcher.BeginInvoke(new Action(AlEmpezarAHablar));
        // El momento real en que el oído cerró la frase (no cuando la interfaz lo atiende): el origen del turno.
        oido.Frase += wav => { var fin = System.Diagnostics.Stopwatch.GetTimestamp(); Dispatcher.BeginInvoke(new Action(() => _ = AlTerminarFrase(wav, fin))); };
        oido.SeCanso += () => Dispatcher.BeginInvoke(new Action(() => { if (oido.ModoInterrupcion) return; CerrarOido(); if (!hablandoAhora && !pensando) continuo = false; Recalcular(); }));
        oido.Fallo += m => Dispatcher.BeginInvoke(new Action(() => { CerrarOido(); continuo = false; Avisar(new Aviso("Micrófono", m, "", "worried", Segundos: 6)); Recalcular(); }));

        // Cuándo llegó el audio TTS y cuándo empezó a sonar de verdad (relleno aparte: no es respuesta). La primera
        // frase útil que suena cierra el turno como «ok».
        altavoz.AudioRecibido += (relleno, idTurno, cuando) => Dispatcher.BeginInvoke(new Action(() => metricas.Marcar(relleno ? EtapaVoz.RellenoTts : EtapaVoz.TtsRecibido, cuando, idTurno)));
        altavoz.Reproduciendo += (relleno, idTurno, cuando) => Dispatcher.BeginInvoke(new Action(() =>
        {
            metricas.Marcar(relleno ? EtapaVoz.RellenoSuena : EtapaVoz.InicioReproduccion, cuando, idTurno);
            if (!relleno) metricas.Cerrar("ok", cuando, idTurno);
        }));
        altavoz.Empezo += () => Dispatcher.BeginInvoke(new Action(() => { hablandoAhora = true; pensando = false; AvatarPanel.Estado = "speaking"; EstadoPanel.Text = Ingles ? "Speaking…" : "Hablando…"; AbrirOidoParaInterrumpir(); Recalcular(); }));
        altavoz.Frase += f => Dispatcher.BeginInvoke(new Action(() => Subtitulo.Text = Expresiones.Quitar(f).Trim()));
        altavoz.Nivel += n => { oido.NivelAltavoz = n; Dispatcher.BeginInvoke(new Action(() => { AvatarHabla.Boca = n; AvatarPanel.Boca = n; BarrasHabla.Nivel = n; if (modo == Modo.Habla) AnimarBrillo(0.2 + n * 0.5); })); };
        altavoz.Termino += () => Dispatcher.BeginInvoke(new Action(() =>
        {
            // Se calló todo sin que sonara una frase útil (solo el relleno, o la voz falló): el turno se cierra igual.
            if (!turnoEnCurso) metricas.Cerrar("sin voz útil");
            AlTerminarDeHablar();
        }));
        altavoz.Fallo += m => Dispatcher.BeginInvoke(new Action(() => Avisar(new Aviso("Voz", m, "", "worried"))));

        // Con música sonando (se muestre o no la tarjeta), despertar pide más: las canciones dicen «aura», «antonio»…
        // Y con CUALQUIER sonido de la PC (un video en el navegador, un juego, una llamada): antes solo contaba el
        // reproductor que avisa a Windows, y lo demás despertaba a AURA.
        sonidoEquipo.Encender();
        despertador.Exigente = () => cancion is { Sonando: true } || sonidoEquipo.Sonando;
        // Su propia voz («…soy AU-RA») no la despierta: mientras suena algo, la palabra de activación no cuenta.
        despertador.Desperto += () => Dispatcher.BeginInvoke(new Action(() =>
        {
            if (pausado || microSilenciado || pensando || hablandoAhora || altavoz.Ocupado) return;
            // Recién se calló: lo que oyó es su propia voz rebotando en la sala.
            if (DateTime.Now - finVozAura < GraciaTrasHablar) { Centro.Registro.Anotar("despertar", "ignorado: AURA acaba de hablar (eco)"); return; }
            Centro.Registro.Anotar("despertar", "Windows oyó «Oye AURA»");
            llamadaExplicita = true; ultimaCharla = DateTime.Now; continuo = ajustes.ManosLibres;
            if (!AgenteAbierto && !abriendoAgente) TextoEscucha.Text = T("Te escucho…", "Listening…");
            // «Oye AURA, abre Excel» de corrido: Windows la despierta a media frase. Antes se abría la conversación
            // y esa frase (con la orden) se tiraba: había que repetirla. Ahora se deja terminar y se hace.
            if (oido.Abierto && oido.OyendoFrase && !AgenteAbierto && !abriendoAgente)
            {
                despertarAlTerminar = true;
                Centro.Registro.Anotar("despertar", "a media frase: la dejo terminar");
                Recalcular();
                return;
            }
            _ = Despertar();
            Recalcular();
        }));
        AplicarEscucha();
        IniciarActualizaciones();
        // Primera vez (o sin sesión): se abre el Centro con la entrada y la guía; después AURA vive en el notch.
        if (string.IsNullOrEmpty(ajustes.Token) || !ajustes.PrimeraVezHecha)
            Dispatcher.BeginInvoke(new Action(() => AbrirCentro()), DispatcherPriority.ApplicationIdle);
        else Dispatcher.BeginInvoke(new Action(PrepararCentro), DispatcherPriority.ApplicationIdle);
        Centro.Registro.Anotar("inicio", $"AURA {typeof(NotchWindow).Assembly.GetName().Version} · escucha {ajustes.Escucha} · sesión {(string.IsNullOrEmpty(ajustes.Token) ? "no" : ajustes.Nivel)}");

        // El saludo al arrancar (idea de Coucou, MIT): según la hora, con tu nombre y cómo llamarla.
        var hora = DateTime.Now.Hour;
        var quien = ajustes.Nombre.Length > 0 ? ", " + ajustes.Nombre.Split(' ')[0] : "";
        var hola = hora < 12 ? T("Buenos días", "Good morning") : hora < 19 ? T("Buenas tardes", "Good afternoon") : T("Buenas noches", "Good evening");
        var como = ajustes.Escucha is "palabra" or "siempre"
            ? T("Di «Oye " + ajustes.NombreAvatar + "» · suelta un archivo aquí para preguntarme", "Say “Hey " + ajustes.NombreAvatar + "” · drop a file here to ask me")
            : T("Ctrl+Alt+Espacio para hablarme · tócame para abrir el chat", "Ctrl+Alt+Space to talk · click me to open the chat");
        Avisar(new Aviso(hola + quien, como, "", "happy", Segundos: 5));
        _ = ComprobarConexion();
    }

    void CrearApi()
    {
        CerrarAgente();
        api?.Dispose();
        // La caída pendiente sale recién ahora: al servidor que eligió la persona, no al de fábrica.
        Centro.Diagnostico.Servidor = ajustes.Servidor;
        Centro.Diagnostico.MandarCaidaPendiente();
        try { api = new AuraApi(ajustes.Servidor, string.IsNullOrEmpty(ajustes.Token) ? null : ajustes.Token) { Renovar = RenovarSesion, Aparato = ajustes.Aparato }; }
        catch (AuraError ex) { api = null; Avisar(new Aviso("Revisa el servidor", ex.Message, "", "worried")); }
        IniciarCanal();
    }

    /// <summary>
    /// Una sola renovación a la vez y, si falla, ninguna más en 2 minutos: una clave vieja no puede
    /// convertirse en una ráfaga de logins que bloquee la cuenta.
    /// </summary>
    async Task<string?> RenovarSesion(CancellationToken ct)
    {
        if (string.IsNullOrEmpty(ajustes.Correo) || string.IsNullOrEmpty(ajustes.Clave) || DateTime.UtcNow < noRenovarHasta) return null;
        var antes = ajustes.Token;
        await renovando.WaitAsync(ct);
        try
        {
            if (ajustes.Token != antes && !string.IsNullOrEmpty(ajustes.Token)) return ajustes.Token; // otra renovación ya lo hizo
            if (DateTime.UtcNow < noRenovarHasta) return null;
            using var otra = new AuraApi(ajustes.Servidor);
            var (token, nombre, _) = await otra.Entrar(ajustes.Correo, ajustes.Clave, ct);
            await Dispatcher.InvokeAsync(() => { ajustes.Token = token; if (nombre.Length > 0) ajustes.Nombre = nombre; try { ajustes.Guardar(); } catch { } });
            return token;
        }
        catch (OperationCanceledException) { throw; }
        catch { noRenovarHasta = DateTime.UtcNow.AddMinutes(2); return null; }
        finally { renovando.Release(); }
    }

    async Task ComprobarConexion()
    {
        bool ok = api != null && await api.Salud();
        PuntoEstado.Fill = new SolidColorBrush(pausado ? Color.FromRgb(0xFF, 0x9F, 0x0A) : ok ? Color.FromRgb(0x4C, 0xD9, 0x64) : Color.FromRgb(0x8E, 0x8E, 0x93));
        PuntoEstado.ToolTip = pausado ? "En pausa" : ok ? "Conectada a AU-RA" : "Sin conexión con el servidor";
        if (!ok && api != null) Avisar(new Aviso("Sin conexión", "No alcanzo el servidor AU-RA. Las manos de la computadora siguen funcionando.", "", "worried", Segundos: 6));
    }

    // ───────────────────────────── escuchar ─────────────────────────────

    internal void Microfono(object s, RoutedEventArgs e)
    {
        if (pausado) { Reanudar(); return; }
        if (microSilenciado) { microSilenciado = false; AplicarEscucha(); Avisar(new Aviso(T("Te escucho de nuevo", "Listening again"), "", "\uE720", "happy", Segundos: 1.6)); }
        // Con la conversación en vivo abierta, el micrófono del notch la cuelga.
        if (AgenteAbierto) { CerrarAgente(); return; }
        if (abriendoAgente) return;
        llamadaExplicita = true; ultimaCharla = DateTime.Now;
        if (escuchando && !hablandoAhora) { CerrarOido(); continuo = false; Recalcular(); return; }
        Callar();
        continuo = ajustes.ManosLibres;
        if (PuedeAgente) { _ = Despertar(); return; }
        EmpezarAEscuchar();
    }

    void EmpezarAEscuchar()
    {
        // La conversación en vivo tiene su propio micrófono: el oído de siempre no la duplica.
        // Silenciada por ti: ningún camino abre el micrófono hasta que lo vuelvas a tocar.
        if (pausado || microSilenciado || soloRender || AgenteAbierto || abriendoAgente) return;
        oido.ModoInterrupcion = false;
        // «Oye AURA» y «siempre atenta»: el micrófono no se cansa; cada frase se oye y solo se atiende si es para AURA.
        oido.Continuo = ajustes.Escucha is "siempre" or "palabra";
        oido.EsperaMaxMs = continuo ? 7000 : 9000;
        oido.Abrir();
        if (!oido.Abierto) return;
        escuchando = true;
        TextoEscucha.Text = propuesta != null ? (ajustes.Idioma == "en" ? "Say yes or no…" : "Dime sí o no…") : ajustes.Idioma == "en" ? "I'm listening…" : "Te escucho…";
        LuzMic.Opacity = 1; AnilloMic.Opacity = 0.9;
        AvatarPanel.Estado = "listening";
        EstadoPanel.Text = TextoEscucha.Text;
        Recalcular();
    }

    /// <summary>Mientras AURA habla, el oído queda en modo interrupción (más umbral: su propia voz no la corta).</summary>
    void AbrirOidoParaInterrumpir()
    {
        if (!ajustes.Interrumpir || pausado || microSilenciado || soloRender) return;
        oido.ModoInterrupcion = true;
        oido.Continuo = true;
        oido.Abrir();
        LuzMic.Opacity = oido.Abierto ? 1 : 0;
    }

    void CerrarOido()
    {
        oido.Cerrar();
        escuchando = false;
        LuzMic.Opacity = 0; AnilloMic.Opacity = 0;
        BarrasEscucha.Nivel = 0;
        if (!hablandoAhora && !pensando) { AvatarPanel.Estado = EstadoDeEmocion(emocionActual); EstadoPanel.Text = pausado ? "En pausa" : "Aquí contigo"; }
    }

    void AlEmpezarAHablar()
    {
        if (!oido.Abierto) return; // llegó tarde, de un micrófono que ya se cerró
        if (hablandoAhora || pensando)
        {
            // Le hablaron encima: se calla ya y escucha (el audio ya viene grabando desde antes).
            generacion++;
            turno?.Cancel(); voz?.Cancel();
            altavoz.Detener();
            metricas.Cerrar("interrumpido");
            hablandoAhora = false; pensando = false; turnoEnCurso = false;
            oido.ModoInterrupcion = false;
        }
        escuchando = true;
        TextoEscucha.Text = ajustes.Idioma == "en" ? "Listening…" : "Te escucho…";
        Recalcular();
    }

    /// <summary>Con sonido de fondo, lo mínimo que el modelo propio tiene que haber oído para mandar una frase a transcribir.</summary>
    const float UmbralFraseConSonido = 0.3f;

    async Task AlTerminarFrase(byte[] wav, long finCaptura)
    {
        // Si «Oye AURA» llegó a media frase, esta es esa frase: con orden se hace; sola, se abre la conversación.
        bool despertarPedido = despertarAlTerminar;
        despertarAlTerminar = false;
        if (pausado) return;
        bool eraInterrupcion = oido.ModoInterrupcion;
        oido.Cerrar();
        escuchando = false; LuzMic.Opacity = 0; AnilloMic.Opacity = 0;
        // Sin conversación ni llamada explícita, una frase larguísima (la tele, una charla al lado) no se manda a transcribir:
        // «Oye AURA, …» cabe en 12 segundos.
        bool esperandoNombre = ajustes.Escucha is "siempre" or "palabra" && !llamadaExplicita && propuesta == null
                               && DateTime.Now - ultimaCharla > (ajustes.Escucha == "siempre" ? TimeSpan.FromMinutes(3) : TimeSpan.FromSeconds(90));
        if (esperandoNombre && !eraInterrupcion && wav.Length > 44 + 12 * 32000)
        {
            if (!microSilenciado && !pausado) EmpezarAEscuchar();
            return;
        }
        // Con algo sonando en la PC y el modelo propio cuidando: una frase que ni de lejos sonó a «hey aura» no se
        // manda a transcribir. Antes TODA frase de la música o del video iba a /api/stt y, si el texto empezaba con
        // «aura», «claudio» o «antonio», la despertaba (la otra puerta de las activaciones falsas del 1-oct).
        if (esperandoNombre && !eraInterrupcion && !despertarPedido && despertador.UsaModeloPropio && despertador.Exigente?.Invoke() == true)
        {
            var dura = TimeSpan.FromSeconds(Math.Max(0, wav.Length - 44) / 32000.0);
            var max = despertador.MaxDesde(DateTime.UtcNow - dura - TimeSpan.FromSeconds(1));
            if (max < UmbralFraseConSonido)
            {
                Centro.Registro.Anotar("despertar", $"frase con sonido de fondo sin «hey aura» ({max:0.00}): no la transcribo");
                if (!microSilenciado && !pausado) EmpezarAEscuchar();
                return;
            }
        }
        // Mientras solo se espera el nombre, el notch no cambia a «pensando»: no parpadea con cada ruido.
        if (!esperandoNombre) { pensando = true; TextoPiensa.Text = T("Te entendí, un momento…", "Got it, one moment…"); Recalcular(); }
        long g = ++generacion;
        string texto = "";
        string? error = null;
        // Un turno NUEVO, con su reloj, desde que el oído cerró la frase (incluye el silencio final del detector).
        var t = metricas.Nuevo("frases", "fin de captura", finCaptura);
        metricas.Marcar(EtapaVoz.FinCaptura, finCaptura, t.Id);
        try { texto = await Transcribir(wav); }
        catch (OperationCanceledException) { metricas.Cerrar("cancelado", turno: t.Id); return; }
        catch (Exception ex) { error = ex.Message; }
        if (g != generacion) { metricas.Cerrar("cancelado", turno: t.Id); return; }
        metricas.Marcar(EtapaVoz.SttRecibido, turno: t.Id);
        pensando = false;
        if (error != null) metricas.Cerrar("fallo stt", turno: t.Id);
        else if (texto.Length == 0) metricas.Cerrar("silencio", turno: t.Id);
        if (error != null) { continuo = false; Avisar(new Aviso(T("No pude oírte", "I couldn't hear you"), error, "", "worried", Segundos: 6)); Recalcular(); return; }
        if (texto.Length == 0 && despertarPedido) { _ = Despertar(); return; }
        if (texto.Length == 0)
        {
            // Ruido (la tele, el ventilador): después de dos vacías seguidas, deja de escuchar sola.
            if (ajustes.Escucha is "siempre" or "palabra" && !eraInterrupcion && !microSilenciado) { vaciasSeguidas = 0; EmpezarAEscuchar(); }
            else if (continuo && ++vaciasSeguidas < 2 && !eraInterrupcion) EmpezarAEscuchar();
            else { vaciasSeguidas = 0; continuo = false; if (!eraInterrupcion) Avisar(new Aviso(T("No alcancé a oírte", "I didn't catch that"), T("Inténtalo otra vez o escríbemelo.", "Try again or type it."), "", "worried", Segundos: 3)); Recalcular(); }
            return;
        }
        vaciasSeguidas = 0;
        // Lo que entendió: en el registro solo su largo; el texto (saneado), solo con «Registro detallado» (H13).
        Centro.Registro.AnotarDicho("oir", $"turno {t.Id}", texto);
        // «¡Hasta la próxima!», «Gracias por ver»…: el transcriptor inventando en el ruido, o el eco de AURA. No es la persona.
        if (propuesta == null && Fantasma.Es(texto, ultimaRespuesta))
        {
            Centro.Registro.Anotar("oir", "descartado: ruido o eco");
            metricas.Cerrar("descartado (eco o ruido)", turno: t.Id);
            pensando = false; Recalcular();
            if (!microSilenciado && !pausado && ajustes.Escucha is "siempre" or "palabra") EmpezarAEscuchar();
            return;
        }
        // Sin conversación en curso, solo se atiende lo que empieza por su nombre: «Oye AURA, abre Excel»
        // (en una frase) o «Oye AURA» sola (contesta «¿sí?» y escucha). En conversación, todo cuenta.
        bool enCharla = DateTime.Now - ultimaCharla < (ajustes.Escucha == "siempre" ? TimeSpan.FromMinutes(3) : TimeSpan.FromSeconds(90));
        if (ajustes.Escucha is "siempre" or "palabra" && !eraInterrupcion && propuesta == null && !llamadaExplicita)
        {
            if (Parametros.QuitarNombre(texto, out var resto))
            {
                Centro.Registro.Anotar("despertar", resto.Length == 0 ? "me llamaron" : "me llamaron con orden");
                if (resto.Length == 0)
                {
                    ultimaCharla = DateTime.Now; pensando = false;
                    if (!Contestar(T("¿Sí?", "Yes?"), "feliz")) metricas.Cerrar("llamada sin voz", turno: t.Id);
                    if (!hablandoAhora) EmpezarAEscuchar();
                    Recalcular();
                    return;
                }
                texto = resto;
            }
            else if (!enCharla)
            {
                metricas.Cerrar("no era para AURA", turno: t.Id);
                pensando = false; Recalcular();
                if (!microSilenciado && !pausado) EmpezarAEscuchar();
                return;
            }
        }
        // Si el reconocedor de Windows ya la despertó, la frase que llega todavía trae el nombre («Hola Aura, pon
        // bachata en Spotify»): se quita igual, o las reglas no la reconocen y se va al cerebro (8 s más).
        else if (Parametros.QuitarNombre(texto, out var sinNombre))
        {
            if (sinNombre.Length > 0) texto = sinNombre;
            // «Oye AURA» sola (la despertó Windows a media frase): la conversación en vivo, como siempre.
            else if (despertarPedido) { metricas.Cerrar("despertar", turno: t.Id); llamadaExplicita = false; ultimaCharla = DateTime.Now; _ = Despertar(); return; }
        }
        llamadaExplicita = false;
        ultimaCharla = DateTime.Now;
        await Procesar(texto, true);
    }

    /// <summary>Un turno al hilo de la conversación (los últimos 8 intercambios viajan al cerebro).</summary>
    void Recordar(string dicho, string respuesta)
    {
        historial.Add(new Turno("usuario", dicho));
        historial.Add(new Turno("ultron", respuesta));
        while (historial.Count > 24) historial.RemoveRange(0, 2);
    }

    /// <summary>El oído del servidor (Whisper/Scribe) o, sin él, el dictado de Windows. Si se eligió, siempre el de Windows.</summary>
    async Task<string> Transcribir(byte[] wav)
    {
        if (!ajustes.OidoDeWindows && api != null)
        {
            try { return await api.Oir(wav, ajustes.Idioma); }
            catch (AuraError) { /* sin red o sin servidor: el de Windows */ }
        }
        return await VozLocal.Oir(wav, ajustes.Idioma);
    }

    // ───────────────────────────── entender y contestar ─────────────────────────────


    /// <summary>¿La frase le habla a AURA? Su nombre (o el del avatar) en las primeras palabras.</summary>
    bool LaNombra(string texto)
    {
        var t = LayaLigera.Normalizar(texto);
        var primeras = string.Join(' ', t.Split(' ', StringSplitOptions.RemoveEmptyEntries).Take(4));
        return Regex.IsMatch(primeras, @"\b(?:aura|au ra|laura|claudio|antonio|anton|guardian)\b");
    }

    /// <summary>Cómo escucha: «pedir» (tecla o clic), «palabra» («Oye AURA», en la PC) o «siempre». El silencio del notch manda sobre todo.</summary>
    internal void AplicarEscucha()
    {
        if (soloRender) return;
        // El despertador queda encendido mientras haga falta (no se rehace cada vez: cargar el modelo cuesta).
        if (microSilenciado || pausado || ajustes.Escucha is not ("palabra" or "siempre")) despertador.Apagar();
        BotonSilencio.Foreground = microSilenciado ? new SolidColorBrush(Color.FromRgb(0xFF, 0x6B, 0x6B)) : (Brush)FindResource("Texto");
        BotonSilencio.ToolTip = microSilenciado ? T("Micrófono silenciado. Tócalo para que AURA vuelva a escucharte.", "Microphone muted. Tap to let AURA listen again.")
                                                : T("Silenciar el micrófono: AURA deja de escucharte hasta que lo vuelvas a tocar", "Mute: AURA stops listening until you tap again");
        if (microSilenciado || pausado) { CerrarAgente(); if (!hablandoAhora) CerrarOido(); Recalcular(); return; }
        if (ajustes.Escucha is "palabra" or "siempre")
        {
            var e = despertador.Encender(ajustes.Idioma);
            if (e != null && ajustes.Escucha == "palabra") Avisar(new Aviso(T("Palabra de activación", "Wake word"), e, "", "worried", Segundos: 7));
        }
        if (ajustes.Escucha is "siempre" or "palabra" && !escuchando && !hablandoAhora && !pensando) { continuo = true; EmpezarAEscuchar(); }
        Recalcular();
    }

    void SilencioClic(object s, RoutedEventArgs e)
    {
        e.Handled = true;
        microSilenciado = !microSilenciado;
        if (microSilenciado) { continuo = false; if (!hablandoAhora) CerrarOido(); }
        AplicarEscucha();
        Avisar(new Aviso(microSilenciado ? T("Micrófono silenciado", "Microphone muted") : T("Te escucho de nuevo", "Listening again"),
            microSilenciado ? T("No te oigo hasta que vuelvas a tocar el micrófono.", "I won't hear you until you tap the mic again.") : "", microSilenciado ? "\uEC54" : "\uE720", "idle", Segundos: 2.4));
        Centro.Registro.Anotar("microfono", microSilenciado ? "silenciado" : "activo");
    }

    internal async Task Procesar(string texto, bool hablado)
    {
        texto = texto.Trim();
        if (texto.Length == 0 || pausado) return;
        // Escrito (chat del notch o del Centro): un turno propio desde que llegó el texto. Hablado: el de AlTerminarFrase.
        var t = metricas.Actual is { Cerrado: false } abierto && hablado ? abierto : metricas.Nuevo(hablado ? "frases" : "texto", hablado ? "transcripción" : "texto recibido");
        if (propuesta != null)
        {
            // Solo un «sí» limpio confirma; cualquier «no» en la frase cancela («sí, pero mejor no» no bloquea nada).
            switch (Parametros.Respuesta(texto))
            {
                case true: await Responder(true); if (!altavoz.Ocupado) metricas.Cerrar("confirmación", turno: t.Id); return;
                case false: await Responder(false); if (!altavoz.Ocupado) metricas.Cerrar("confirmación", turno: t.Id); return;
            }
        }
        AgregarMensaje("Tú", texto);
        long g = ++generacion;
        Pedido pedido;
        var antesDeEntender = System.Diagnostics.Stopwatch.GetTimestamp();
        try { pedido = await Intencion.Decidir(texto, api != null && api.NodoDisponible ? api.Intencion : null); }
        catch { pedido = Pedido.Nada; }
        metricas.Marcar(EtapaVoz.Intencion, turno: t.Id);
        Centro.Registro.Anotar("entender", $"turno {t.Id} · {System.Diagnostics.Stopwatch.GetElapsedTime(antesDeEntender).TotalMilliseconds:0} ms · {pedido.Mano} ({pedido.Origen})");
        if (g != generacion) { metricas.Cerrar("cancelado", turno: t.Id); return; }
        if (pedido.Mano != Mano.Ninguna)
        {
            await Hacer(pedido, texto, hablado);
            // Una acción sin voz (o con la voz apagada) también cierra su turno; si dijo algo, lo cierra el altavoz.
            if (!altavoz.Ocupado) metricas.Cerrar("acción", turno: t.Id);
            // Lo que hizo con las manos también es parte de la charla: si después dices «súbele» o «otra de él»,
            // el cerebro sabe de qué hablan.
            Recordar(texto, T($"[Hecho en la PC: {pedido.Mano} {pedido.Valor}]", $"[Done on the PC: {pedido.Mano} {pedido.Valor}]"));
            return;
        }
        if (await PreguntarArchivo(texto, hablado)) return;
        await Conversar(texto, hablado);
    }

    /// <summary>Le pregunta al cerebro (Qwen, el mismo de la app) y habla la respuesta mientras llega.</summary>
    /// <param name="contexto">Lo que acompaña a la pregunta (el texto de la pantalla, lo copiado). Va al cerebro, no al historial.</param>
    internal async Task<Respuesta?> Conversar(string texto, bool hablado, bool redactar = false, string? contexto = null)
    {
        if (api == null) { NoPude(T("Conecta AURA en Ajustes para conversar.", "Connect AURA in Settings to chat.")); return null; }
        // Escribirle con la conversación en vivo abierta: se cuelga y contesta por el chat de siempre.
        if (AgenteAbierto) CerrarAgente();
        Callar(false, conservarTurno: true);
        long g = ++generacion;
        var idTurno = metricas.Actual?.Id ?? 0;
        var cts = turno = new CancellationTokenSource();
        var vcts = voz = new CancellationTokenSource();
        cortador.Reiniciar();
        pensando = true; turnoEnCurso = true;
        TextoPiensa.Text = texto;
        AvatarPanel.Estado = "thinking"; EstadoPanel.Text = ajustes.Idioma == "en" ? "Thinking…" : "Pensando…";
        Recalcular();
        var burbuja = redactar ? null : AgregarMensaje(ajustes.NombreAvatar, "");
        bool conVoz = ajustes.ResponderConVoz && !redactar && !soloRender;
        string emocion = "neutral";
        int dichas = 0;
        Respuesta? r = null;
        bool rellenoDicho = false;
        // El cerebro tarda (a veces 8–10 s hasta la primera palabra): si a los 1,8 s no ha dicho nada, AURA dice
        // algo corto para que se sepa que está en eso. Una sola vez por turno, solo con voz y si la hablaste.
        if (conVoz && hablado)
        {
            var relleno = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(1800) };
            relleno.Tick += (_, _) =>
            {
                relleno.Stop();
                if (g != generacion || dichas > 0 || vcts.IsCancellationRequested) return;
                var frases = Ingles ? new[] { "Let me see…", "One sec…", "Hmm, let me think…" } : new[] { "A ver…", "Dame un segundo…", "Mmm, déjame ver…" };
                rellenoDicho = Decir(frases[Random.Shared.Next(frases.Length)], "neutral", vcts.Token, relleno: true);
            };
            relleno.Start();
        }
        // Las manos que pide el cerebro (⟦hacer: …⟧): no se ven ni se dicen, y se hacen apenas llegan. Con texto
        // de otro lado delante (pantalla, archivo, portapapeles) no: ese texto podría traer órdenes escondidas.
        var filtro = new FiltroAcciones();
        bool conManos = contexto == null && !redactar;
        void Orden(string o) { if (conManos) _ = Dispatcher.BeginInvoke(new Action(() => _ = HacerOrdenDelCerebro(o, texto, hablado))); }
        try
        {
            r = await api.Turno(contexto == null ? texto : texto + "\n\n" + contexto, historial, ajustes.Nombre.Length > 0 ? ajustes.Nombre : Environment.UserName, ajustes.Avatar, ajustes.Idioma, hablado,
                alTrozo: trozo => Dispatcher.BeginInvoke(new Action(() =>
                {
                    if (g != generacion) return;
                    trozo = filtro.Agregar(trozo, Orden);
                    if (trozo.Length == 0) return;
                    metricas.Marcar(EtapaVoz.PrimerTexto, turno: idTurno);
                    if (burbuja != null) burbuja.Text += Expresiones.Quitar(trozo);
                    if (burbuja != null) Desplazar.ScrollToEnd();
                    if (conVoz) foreach (var f in cortador.Agregar(trozo)) { Decir(f, emocion, vcts.Token); dichas++; }
                })),
                alEmocion: e => Dispatcher.BeginInvoke(new Action(() => { if (g != generacion) return; emocion = e; emocionActual = e; AvatarPanel.Estado = hablandoAhora ? "speaking" : EstadoDeEmocion(e); })),
                alReemplazo: nuevo => Dispatcher.BeginInvoke(new Action(() => { if (g == generacion && burbuja != null) burbuja.Text = FiltroAcciones.Quitar(Expresiones.Quitar(nuevo)); })),
                ct: cts.Token);
        }
        catch (OperationCanceledException) { metricas.Cerrar("cancelado", turno: idTurno); return null; }
        catch (Exception ex)
        {
            // Cualquier fallo (red, proxy, un servidor cambiado a mitad): nunca queda pegado en «pensando».
            metricas.Cerrar("fallo cerebro", turno: idTurno);
            if (g != generacion) return null;
            pensando = false; turnoEnCurso = false; continuo = false;
            if (oido.ModoInterrupcion) CerrarOido();
            if (burbuja != null) burbuja.Text = ex.Message;
            Avisar(new Aviso(ajustes.Idioma == "en" ? "Couldn't reach AURA" : "No pude pensar ahora", ex.Message, "", "worried", Segundos: 6));
            Recalcular();
            return null;
        }
        if (g != generacion) return null;
        // Lo que quedó sin cerrar con punto también se dice.
        if (conVoz && cortador.Resto() is { } resto) { Decir(resto, emocion, vcts.Token); dichas++; }
        turnoEnCurso = false;
        // Si la marca llegó solo en el texto final (sin trozos), también cuenta.
        if (filtro.Ordenes.Count == 0) new FiltroAcciones().Agregar(r.Texto, Orden);
        r = r with { Texto = FiltroAcciones.Quitar(r.Texto) };
        if (burbuja != null && r.Texto.Length > 0) burbuja.Text = r.Texto;
        if (r.Error != null && r.Texto.Length == 0 && burbuja != null) burbuja.Text = r.Error;
        // Nunca una burbuja vacía: si no llegó nada, se quita.
        if (burbuja != null && string.IsNullOrWhiteSpace(burbuja.Text)) QuitarBurbuja(burbuja);
        ultimaRespuesta = r.Texto;
        Recordar(texto, r.Texto.Length > 4000 ? r.Texto[..4000] : r.Texto);
        emocionActual = r.Emocion;
        // Con voz, el altavoz decide cuándo termina (Empezo/Termino): así el notch no parpadea entre piensa y habla.
        // Si ya terminó de sonar todo antes de que el cerebro cerrara el turno, se cierra aquí.
        if (conVoz && (dichas > 0 || rellenoDicho) && !altavoz.Ocupado) AlTerminarDeHablar();
        if (!conVoz || dichas == 0)
        {
            metricas.Cerrar(conVoz ? "sin respuesta hablada" : "sin voz", turno: idTurno);
            pensando = false;
            if (!redactar && !panelAbierto && r.Texto.Length > 0 && !conVoz) Avisar(new Aviso(ajustes.NombreAvatar, r.Texto, "", EstadoDeEmocion(r.Emocion), "Ver", () => AbrirPanel(true), 8));
            AvatarPanel.Estado = EstadoDeEmocion(r.Emocion);
            if (!conVoz && continuo && !redactar) EmpezarAEscuchar();
        }
        Recalcular();
        return r;
    }

    /// <summary>
    /// Pide la voz de una frase (sin esperar) y la pone en la cola del altavoz: la del avatar (ElevenLabs,
    /// en el servidor) o, si se eligió o el servidor no contesta, la de Windows. Devuelve si encoló algo.
    /// </summary>
    internal bool Decir(string frase, string emocion = "neutral", CancellationToken ct = default, bool relleno = false)
    {
        if (!ajustes.ResponderConVoz || soloRender || string.IsNullOrWhiteSpace(frase)) return false;
        var a = api; var avatar = ajustes.Avatar; var idioma = ajustes.Idioma; bool local = ajustes.VozDeWindows || a == null;
        var tarea = Task.Run(async () =>
        {
            if (!local)
            {
                try { return (Audio?)await a!.Voz(frase, emocion, avatar, idioma, ct); }
                catch (OperationCanceledException) { return null; }
                catch (Exception) { /* sin servidor: la voz de Windows */ }
            }
            try { return await VozLocal.Decir(frase, idioma, avatar, ct); }
            catch (OperationCanceledException) { return null; }
            catch (Exception ex) { _ = Dispatcher.BeginInvoke(new Action(() => Avisar(new Aviso(T("Voz", "Voice"), ex.Message, "", "worried")))); return null; }
        });
        altavoz.Encolar(tarea, frase, relleno, metricas.Actual?.Id ?? 0);
        return true;
    }

    /// <summary>Una frase corta de AURA. Si estás hablando, no te pisa: queda en el notch. Devuelve si la dijo en voz.</summary>
    bool Contestar(string frase, string emocion = "feliz")
    {
        Subtitulo.Text = frase;
        // En la conversación en vivo habla el agente: lo de las manos queda escrito, sin otra voz encima.
        if (AgenteAbierto) return false;
        if (escuchando && !oido.ModoInterrupcion) return false;
        if (voz == null || voz.IsCancellationRequested) voz = new CancellationTokenSource();
        return Decir(frase, emocion, voz.Token);
    }

    void AlTerminarDeHablar()
    {
        hablandoAhora = false;
        finVozAura = DateTime.Now;
        AvatarHabla.Boca = AvatarPanel.Boca = 0;
        // Entre frases del mismo turno sigue «hablando»: el notch no parpadea mientras llega la siguiente.
        if (turnoEnCurso) { hablandoAhora = true; Recalcular(); return; }
        pensando = false;
        AvatarPanel.Estado = EstadoDeEmocion(emocionActual);
        oido.ModoInterrupcion = false;
        if (continuo && !pausado) EmpezarAEscuchar();
        else if (propuesta != null && !pausado) { continuo = false; EmpezarAEscuchar(); }
        else CerrarOido();
        Recalcular();
    }

    /// <summary>Calla la voz y corta el turno en curso (y cierra su métrica, salvo <paramref name="conservarTurno"/>: el que empieza a contestar).</summary>
    internal void Callar(bool terminarSesion = false, bool conservarTurno = false)
    {
        generacion++;
        turno?.Cancel(); voz?.Cancel(); voz = null;
        altavoz.Detener();
        if (!conservarTurno) metricas.Cerrar("cancelado");
        hablandoAhora = false; pensando = false; turnoEnCurso = false;
        if (terminarSesion) { continuo = false; CerrarAgente(); }
        else agente?.CallarVoz(); // «cállate» con la conversación en vivo: calla esta respuesta, sin colgar
        // El oído en modo interrupción era para ESTA voz: si ya no habla, se cierra.
        if (terminarSesion || oido.ModoInterrupcion) CerrarOido();
        Recalcular();
    }

    internal void PausarTodo()
    {
        Callar(true);
        propuesta = null; relojPropuesta?.Stop();
        escribiendo?.Cancel(); destino = null;
        pausado = true;
        BotonPausa.Content = "";
        PuntoEstado.Fill = new SolidColorBrush(Color.FromRgb(0xFF, 0x9F, 0x0A));
        EstadoPanel.Text = ajustes.Idioma == "en" ? "Paused" : "En pausa";
        Avisar(new Aviso(ajustes.Idioma == "en" ? "Paused" : "En pausa", ajustes.Idioma == "en" ? "Microphone, voice and actions stopped. Tap the mic to resume." : "Micrófono, voz y acciones detenidos. Toca el micrófono para seguir.", "", "worried", Segundos: 4));
    }

    void Reanudar()
    {
        pausado = false;
        BotonPausa.Content = "";
        EstadoPanel.Text = "Aquí contigo";
        _ = ComprobarConexion();
        Avisar(new Aviso(ajustes.Idioma == "en" ? "I'm back" : "Aquí estoy", "", "", "happy", Segundos: 1.8));
    }

    static string EstadoDeEmocion(string e) => e switch
    {
        "feliz" or "risa" or "carino" or "orgullo" or "travieso" or "canto" or "sorpresa" => "happy",
        "preocupado" or "triste" or "alarma" or "molesto" or "cansado" => "worried",
        "pensando" or "curioso" or "escepticismo" => "thinking",
        _ => "idle",
    };

    internal void AplicarAvatar(string id, bool guardar = true)
    {
        ajustes.Avatar = id;
        var color = id switch { "claudio" => Color.FromRgb(0xF4, 0xAD, 0x72), "antonio" => Color.FromRgb(0x45, 0xC9, 0xDE), "ojos" => Color.FromRgb(0x5C, 0xE1, 0xFF), _ => Color.FromRgb(0xD6, 0xB5, 0x6C) };
        Application.Current.Resources["Acento"] = new SolidColorBrush(color);
        Application.Current.Resources["AcentoSuave"] = new SolidColorBrush(Color.FromArgb(0x33, color.R, color.G, color.B));
        Brillo.Color = color;
        foreach (var a in new[] { AvatarChico, AvatarEscucha, AvatarPiensa, AvatarHabla, AvatarAviso, AvatarConfirma, AvatarPanel }) a.Avatar = id;
        AvatarView.Precargar(id);
        NombreChico.Text = NombreHabla.Text = NombrePanel.Text = ajustes.NombreAvatar;
        if (guardar && !soloRender) { try { ajustes.Guardar(); } catch { } }
    }

    void Terminar()
    {
        // Cada uno por separado: uno que falle no deja a los demás abiertos (ni el proceso vivo).
        Seguro(() => Callar(true));
        Seguro(() => canal?.Cancel());
        Seguro(GuardarRecuperacion);
        Seguro(despertador.Dispose); Seguro(sonidoEquipo.Dispose); Seguro(oido.Dispose); Seguro(altavoz.Dispose); Seguro(() => api?.Dispose());
        Seguro(() => centro?.CerrarDeVerdad());
        Seguro(() => llamadas?.Close());
        Seguro(musica.Dispose); Seguro(() => correo?.Dispose()); Seguro(() => agenda?.Dispose()); Seguro(() => avisosApps?.Dispose());
        Seguro(relojProgreso.Stop); Seguro(relojRecordatorios.Stop);
    }
}
