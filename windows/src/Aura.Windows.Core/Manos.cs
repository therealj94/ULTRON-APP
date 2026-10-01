using System.Globalization;
using System.Text.RegularExpressions;

namespace Aura.Windows.Core;

/// <summary>Las manos de AURA en Windows. Son las etiquetas de Laya «windows» (grupo win) sin el prefijo.</summary>
public enum Mano
{
    Ninguna, AbrirApp, AbrirCarpeta, BuscarWeb, AbrirWeb, Escribir, Redactar, VerPantalla, Captura,
    VolumenSubir, VolumenBajar, Silenciar, MultimediaPausa, MultimediaSiguiente, MultimediaAnterior,
    Recordar, Callar, Pausa, AbrirChat, Ocultar, Avatar, Escritorio, Bloquear,
    // Nativas 1.1: controles por nombre (UI Automation), ventanas, información del equipo, portapapeles y archivos.
    Pulsar, QueHay, Ventana, Info, Portapapeles, AbrirArchivo,
    // 1.2: música (lo que suena en Spotify, YouTube Music o el navegador), correo y agenda.
    Musica, Correo, Agenda,
    // 1.4: las notificaciones de las demás apps (solo por reglas: Laya no tiene esta etiqueta todavía).
    Notificaciones,
    // 2.0: la cartera de Veta Wallet (solo lectura) y los atajos del equipo (solo por reglas).
    Cartera, Atajo,
    // 2.0: PULSE2CHAT por voz (llamar, videollamar, mandar un mensaje).
    Pulse,
    // 2.0: apagar el micrófono por voz («deja de escuchar»).
    Dormir,
    // 2.1 (ManosMas.cs, solo por reglas): volumen exacto, apps abiertas, teclas repetidas y atajos de Windows,
    // archivos y carpetas, herramientas del sistema, una página en un navegador, el texto de la pantalla y dos órdenes en una frase.
    VolumenA, Apps, Teclas, Archivos, Herramienta, Navegador, TextoPantalla, Varias
}

/// <summary>Lo que se va a hacer: la mano, su parámetro (qué app, qué búsqueda, qué texto…) y de dónde salió.</summary>
public sealed record Pedido(Mano Mano, string Valor = "", TimeSpan? Cuando = null, string Origen = "reglas", double P = 1)
{
    public static readonly Pedido Nada = new(Mano.Ninguna, Origen: "nadie", P: 0);

    /// <summary>Las que tienen efecto fuera de AURA y no se deshacen solas esperan el «sí».</summary>
    /// <summary>
    /// Lo que no se deshace solo espera el «sí»: escribir en otra ventana, bloquear, cerrar TODO. Cerrar una
    /// ventana va de una: si hay algo sin guardar, la propia app pregunta.
    /// Pulsar un control se confirma cuando su nombre suena a algo con efecto (Enviar, Eliminar, Pagar…);
    /// eso lo decide Controles.EsDelicado en el .exe, con el nombre real del control.
    /// </summary>
    public bool PideConfirmacion => Mano is Mano.Escribir or Mano.Bloquear || Mano == Mano.Ventana && Valor == "cerrar|todo"
        || Mano == Mano.Apps && (Valor == "cerrar-todas|" || Valor.StartsWith("forzar|", StringComparison.Ordinal)) || Mano == Mano.Archivos && Valor == "vaciar-papelera";
}

/// <summary>Una decisión de Laya en el nodo (vía /api/windows/intencion).</summary>
public sealed record DecisionNodo(string? Etiqueta, double P, bool Seguro);

/// <summary>
/// Qué pidió la persona, en este orden: REGLAS (exactas, sin duda) → LAYA LIGERA (dentro del .exe,
/// solo si está segura) → LAYA DEL NODO (si está conectada y segura) → nadie: va al cerebro (Qwen).
/// Una mano sin su parámetro («abre» sin decir qué) tampoco se hace: la contesta el cerebro.
/// </summary>
public static class Intencion
{
    public static Mano DeEtiqueta(string? etiqueta) => etiqueta switch
    {
        "win_abrir_app" => Mano.AbrirApp, "win_abrir_carpeta" => Mano.AbrirCarpeta, "win_buscar_web" => Mano.BuscarWeb,
        "win_abrir_web" => Mano.AbrirWeb, "win_escribir" => Mano.Escribir, "win_redactar" => Mano.Redactar,
        "win_ver_pantalla" => Mano.VerPantalla, "win_captura" => Mano.Captura, "win_volumen_subir" => Mano.VolumenSubir,
        "win_volumen_bajar" => Mano.VolumenBajar, "win_silenciar" => Mano.Silenciar, "win_multimedia_pausa" => Mano.MultimediaPausa,
        "win_multimedia_siguiente" => Mano.MultimediaSiguiente, "win_recordar" => Mano.Recordar, "win_callar" => Mano.Callar,
        "win_pausa" => Mano.Pausa, "win_abrir_chat" => Mano.AbrirChat, "win_ocultar" => Mano.Ocultar, "win_avatar" => Mano.Avatar,
        "win_escritorio" => Mano.Escritorio, "win_bloquear" => Mano.Bloquear, "win_pulsar" => Mano.Pulsar, "win_que_hay" => Mano.QueHay,
        "win_ventana" => Mano.Ventana, "win_info" => Mano.Info, "win_portapapeles" => Mano.Portapapeles, "win_abrir_archivo" => Mano.AbrirArchivo,
        "win_musica" => Mano.Musica, "win_correo" => Mano.Correo, "win_agenda" => Mano.Agenda,
        _ => Mano.Ninguna
    };

    public static Pedido PorReglas(string texto) => PorReglas(texto, true);

    static Pedido PorReglas(string texto, bool cadena)
    {
        var t = Parametros.Limpiar(texto);
        if (t.Length == 0 || t.Length > 400) return Pedido.Nada;
        // «abre el bloc de notas y escribe hola»: dos órdenes, cada una entendida sola (ManosMas.Encadenadas).
        if (cadena && ManosMas.Encadenadas(texto, x => PorReglas(x, false)) is { } varias) return varias;
        // Las manos 2.1 van primero: son frases exactas que antes caían en otra regla («pon el volumen al 30»).
        if (ManosMas.Pedir(t, texto) is { } mas) return mas;
        // Lo que se PREGUNTA al equipo (hora, batería, disco, red) se contesta aquí, sin red: va antes que el filtro de preguntas.
        if (Parametros.Info(t) is { } info) return new(Mano.Info, info);
        if (Parametros.Musica(texto) is { } musica) return new(Mano.Musica, musica);
        if (Parametros.Notificaciones(t) is { } avisos) return new(Mano.Notificaciones, avisos);
        if (Parametros.Cartera(t) is { } cartera) return new(Mano.Cartera, cartera);
        if (Parametros.Pulse(texto) is { } pulse) return new(Mano.Pulse, pulse);
        if (Parametros.Atajo(t) is { } atajo) return new(Mano.Atajo, atajo);
        if (Parametros.Correo(t) is { } correo) return new(Mano.Correo, correo);
        if (Parametros.Agenda(t) is { } agenda) return new(Mano.Agenda, agenda);
        if (Parametros.QueHay.IsMatch(t)) return new(Mano.QueHay);
        if (Parametros.Portapapeles.IsMatch(t)) return new(Mano.Portapapeles, texto.Trim());
        if (Parametros.EsNegacion(t)) return Pedido.Nada;
        if (Parametros.Dormir.IsMatch(t)) return new(Mano.Dormir);
        if (Parametros.Callar.IsMatch(t)) return new(Mano.Callar);
        if (Parametros.PausaTodo.IsMatch(t)) return new(Mano.Pausa);
        if (Parametros.SubirVolumen.IsMatch(t)) return new(Mano.VolumenSubir);
        if (Parametros.BajarVolumen.IsMatch(t)) return new(Mano.VolumenBajar);
        if (Parametros.Mute.IsMatch(t)) return new(Mano.Silenciar);
        if (Parametros.Anterior.IsMatch(t)) return new(Mano.MultimediaAnterior);
        if (Parametros.Siguiente.IsMatch(t)) return new(Mano.MultimediaSiguiente);
        if (Parametros.PlayPausa.IsMatch(t)) return new(Mano.MultimediaPausa, Parametros.SentidoPlay(t));
        if (Parametros.Captura.IsMatch(t)) return new(Mano.Captura);
        if (Parametros.VerPantalla.IsMatch(t)) return new(Mano.VerPantalla);
        if (Parametros.Escritorio.IsMatch(t)) return new(Mano.Escritorio);
        if (Parametros.Bloquear.IsMatch(t)) return new(Mano.Bloquear);
        if (Parametros.Recordatorio.IsMatch(t) && Parametros.Tiempo(t) is { } cuando)
            return new(Mano.Recordar, Parametros.TareaDeRecordatorio(texto), cuando);
        if (Parametros.Archivo(texto) is { } archivo) return new(Mano.AbrirArchivo, archivo);
        if (Parametros.Control(texto) is { } control) return new(Mano.Pulsar, control);
        if (Parametros.Ventana(texto) is { } ventana)
            return Parametros.Avatar(ventana) is { } avv && ventana.StartsWith("cambiar|", StringComparison.Ordinal) && Parametros.Avatares.ContainsKey(LayaLigera.Normalizar(ventana[8..]))
                ? new(Mano.Avatar, avv) : new(Mano.Ventana, ventana);
        // «escribe hola», «teclea: nos vemos mañana»: en la ventana donde estás. «Escribe un correo a…» es redactar (el cerebro).
        if (Parametros.EscribirDirecto.IsMatch(t) && Parametros.TextoAEscribir(texto) is { Length: > 0 } escrito) return new(Mano.Escribir, escrito);
        var busca = Parametros.Busqueda(texto);
        if (busca != null) return new(Mano.BuscarWeb, busca);
        var abrir = Parametros.ObjetoDeAbrir(texto);
        if (abrir != null)
        {
            if (Parametros.DominioEn(texto) is { } dominio) return new(Mano.AbrirWeb, dominio);
            if (Parametros.Carpeta(abrir) is { } carpeta) return new(Mano.AbrirCarpeta, carpeta);
            if (Parametros.Sitio(abrir) is { } sitio) return new(Mano.AbrirWeb, sitio);
            if (Parametros.Avatar(abrir) is { } _ && Parametros.CambioAvatar.IsMatch(t)) return new(Mano.Avatar, Parametros.Avatar(abrir)!);
            if (Parametros.PanelChat.IsMatch(abrir)) return new(Mano.AbrirChat);
            return new(Mano.AbrirApp, abrir);
        }
        if (Parametros.CambioAvatar.IsMatch(t) && Parametros.Avatar(t) is { } av) return new(Mano.Avatar, av);
        return Pedido.Nada;
    }

    /// <summary>Completa una mano que decidió Laya con su parámetro. Sin parámetro, nada.</summary>
    public static Pedido ConParametro(Mano mano, string texto, string origen, double p)
    {
        var t = Parametros.Limpiar(texto);
        switch (mano)
        {
            case Mano.Ninguna: return Pedido.Nada;
            case Mano.AbrirApp:
            case Mano.AbrirCarpeta:
            case Mano.AbrirWeb:
            {
                var o = Parametros.ObjetoDeAbrir(texto);
                // Laya ya decidió «abrir»: «necesito la calculadora», «quiero usar Excel».
                if (o == null && Regex.Match(t, @"^(?:necesito|ocupo|quiero|dame|i need|i want)\s+(?:(?:abrir|usar|el|la|los|las|un|una|open|use|the|a)\s+)*(?<o>[a-z0-9 .+-]{2,40})$") is { Success: true } nq) o = nq.Groups["o"].Value.Trim();
                if (o == null) return Pedido.Nada;
                if (Parametros.DominioEn(texto) is { } dom) return new(Mano.AbrirWeb, dom, null, origen, p);
                if (Parametros.Carpeta(o) is { } c) return new(Mano.AbrirCarpeta, c, null, origen, p);
                if (Parametros.Sitio(o) is { } s) return new(Mano.AbrirWeb, s, null, origen, p);
                return mano == Mano.AbrirApp ? new(Mano.AbrirApp, o, null, origen, p) : Pedido.Nada;
            }
            case Mano.BuscarWeb:
                return Parametros.Busqueda(texto, true) is { } q ? new(mano, q, null, origen, p) : Pedido.Nada;
            case Mano.Escribir:
                return new(mano, Parametros.TextoAEscribir(texto) ?? "", null, origen, p);
            case Mano.Redactar:
                return new(mano, texto.Trim(), null, origen, p);
            case Mano.Recordar:
                return Parametros.Tiempo(t) is { } cuando ? new(mano, Parametros.TareaDeRecordatorio(texto), cuando, origen, p) : Pedido.Nada;
            case Mano.Avatar:
                return Parametros.Avatar(t) is { } a ? new(mano, a, null, origen, p) : Pedido.Nada;
            case Mano.Pulsar:
                return Parametros.Control(texto, true) is { } c2 ? new(mano, c2, null, origen, p) : Pedido.Nada;
            case Mano.Ventana:
                return Parametros.Ventana(texto, true) is { } v2 ? new(mano, v2, null, origen, p) : Pedido.Nada;
            case Mano.Info:
                return Parametros.Info(t, true) is { } i2 ? new(mano, i2, null, origen, p) : Pedido.Nada;
            case Mano.AbrirArchivo:
                return Parametros.Archivo(texto, true) is { } a2 ? new(mano, a2, null, origen, p) : Pedido.Nada;
            case Mano.Portapapeles:
                return new(mano, texto.Trim(), null, origen, p);
            case Mano.Musica:
                return Parametros.Musica(texto, true) is { } m2 ? new(mano, m2, null, origen, p) : Pedido.Nada;
            case Mano.Correo:
                return new(mano, Parametros.Correo(t, true)!, null, origen, p);
            case Mano.Agenda:
                return new(mano, Parametros.Agenda(t, true)!, null, origen, p);
            case Mano.MultimediaSiguiente:
                return new(Parametros.Anterior.IsMatch(t) ? Mano.MultimediaAnterior : mano, "", null, origen, p);
            default:
                return new(mano, "", null, origen, p);
        }
    }

    /// <summary>
    /// Lo que la Laya LIGERA nunca decide sola (con efecto o molesto si se equivoca): eso solo por reglas
    /// exactas o por Laya del nodo. La ligera se queda con lo inofensivo (abrir, buscar, leer, contar…).
    /// </summary>
    public static readonly HashSet<Mano> SoloReglasONodo = new()
    { Mano.Avatar, Mano.Captura, Mano.Bloquear, Mano.Escribir, Mano.Pulsar, Mano.Ventana, Mano.Pausa, Mano.Escritorio, Mano.Silenciar };

    /// <summary>La decisión completa. `nodo` es opcional (sin conexión o sin sesión, null).</summary>
    public static async Task<Pedido> Decidir(string texto, Func<string, CancellationToken, Task<DecisionNodo?>>? nodo = null, CancellationToken ct = default)
    {
        var r = PorReglas(texto);
        if (r.Mano != Mano.Ninguna) return r;
        if (Parametros.EsNegacion(Parametros.Limpiar(texto))) return Pedido.Nada;
        var ligera = LayaLigera.Predecir(texto);
        if (ligera.Seguro && !SoloReglasONodo.Contains(DeEtiqueta(ligera.Etiqueta)))
        {
            var p = ConParametro(DeEtiqueta(ligera.Etiqueta), texto, "laya-ligera", ligera.P);
            if (p.Mano != Mano.Ninguna) return p;
        }
        if (nodo != null)
        {
            DecisionNodo? d = null;
            try { d = await nodo(texto, ct).ConfigureAwait(false); } catch (OperationCanceledException) { throw; } catch { }
            if (d is { Seguro: true })
            {
                var p = ConParametro(DeEtiqueta(d.Etiqueta), texto, "laya-nodo", d.P);
                if (p.Mano != Mano.Ninguna) return p;
            }
        }
        return Pedido.Nada;
    }
}

/// <summary>
/// Lo que el transcriptor «oye» en el ruido o en el silencio (frases de cierre de videos, subtítulos) y el
/// eco de la propia voz de AURA. Nada de eso es la persona hablando: no se atiende.
/// </summary>
public static class Fantasma
{
    static readonly System.Text.RegularExpressions.Regex Frases = new(
        @"^(?:(?:muchas )?gracias(?: por (?:ver|mirar|escuchar|su atencion|tu atencion|ver el video|vernos))?|hasta la proxima|hasta luego|nos vemos(?: en el (?:proximo|siguiente) (?:video|capitulo))?|chao|chau|adios|bye|suscribete(?: al canal)?|dale like|subtitulos?(?: realizados)? (?:por|de) .*|amara\.?org.*|musica|aplausos|risas|silencio|espera un momentito|un momentito|thank you(?: for watching)?|thanks for watching|see you next time|you|ok|okay|mm+|hmm+|eh+|ah+)$",
        System.Text.RegularExpressions.RegexOptions.Compiled | System.Text.RegularExpressions.RegexOptions.CultureInvariant);

    /// <summary>¿Es una alucinación del transcriptor o el eco de lo último que dijo AURA?</summary>
    public static bool Es(string texto, string? ultimoDicho = null)
    {
        var t = LayaLigera.Normalizar(texto).Trim();
        if (t.Length == 0) return true;
        if (Frases.IsMatch(t)) return true;
        if (!string.IsNullOrWhiteSpace(ultimoDicho) && t.Length >= 6)
        {
            var dicho = LayaLigera.Normalizar(ultimoDicho!);
            if (dicho.Contains(t)) return true;
        }
        return false;
    }
}

/// <summary>Las reglas que sacan el parámetro de la frase: qué app, qué carpeta, qué sitio, qué buscar, cuándo.</summary>
public static class Parametros
{
    const RegexOptions O = RegexOptions.Compiled | RegexOptions.CultureInvariant;

    static readonly Regex Cortesia = new(@"^(?:(?:oye|hey|ey|ok|okay|okey|a ver|eh|este|mira|mire|bueno|ya|porfa|por favor|please|um|uh|so|yo|alright|aura|claudio|antonio|guardian|can you|could you|puedes|podes|podrias)[\s,.!]+)+", O);
    static readonly Regex Cola = new(@"(?:[\s,]+(?:por favor|porfa|porfis|please|pls|pues|ahorita|gracias|thanks|thank you|dale|ya|si puedes|rapidito|now|right now|real quick|for me|ok))+[\s.!?]*$", O);
    public static readonly Regex Callar = new(@"^(?:callate|calla|callese|ya callate|silencio|shh+|chito|basta|suficiente|para de hablar|deja de hablar|no hables mas|ya no hables|stop talking|shut up|be quiet|quiet|hush|stop speaking|zip it|enough)$", O);
    public static readonly Regex PausaTodo = new(@"^(?:pausa|deten|para|frena|congela|detén|suspende|cancela)\s+(?:todo|todas las acciones|lo que estas haciendo)|^(?:pause|stop|freeze|halt|cancel)\s+(?:everything|all actions|it all)|^(?:modo pausa|pause mode|alto total|full stop|emergency stop)$", O);
    public static readonly Regex SubirVolumen = new(@"^(?:sube|subele|subi|subile|aumenta|ponle mas)(?:\s+(?:el|al|un poco|un poco el|tantito))?\s*(?:volumen|sonido|audio)?(?:\s+un poco)?$|^(?:mas volumen|mas fuerte|volumen mas alto|turn it up|volume up|louder|turn up the volume|raise the volume|increase (?:the )?volume|make it louder)$", O);
    public static readonly Regex BajarVolumen = new(@"^(?:baja|bajale|baji|bajile|disminuye|ponle menos)(?:\s+(?:el|al|un poco|un poco el|tantito))?\s*(?:volumen|sonido|audio)?(?:\s+un poco)?$|^(?:menos volumen|mas bajo|mas bajito|volumen mas bajo|no tan alto|turn it down|volume down|quieter|turn down the volume|lower the volume|decrease (?:the )?volume|make it quieter)$", O);
    public static readonly Regex Mute = new(@"^(?:mute|mutea|unmute|silencia (?:la computadora|la compu|el volumen|el sonido)|quita(?:le)? el (?:sonido|audio|mute)|pon(?:le)? (?:en )?mute|mute (?:the )?(?:sound|audio|computer|volume)|turn off the sound)$", O);
    // Con palabras de música siempre: «para» o «detente» solos son para AURA (callar / pausa), no para la canción.
    public static readonly Regex Siguiente = new(@"^(?:siguiente (?:cancion|tema|video)|pasa (?:la|esta) cancion|salta (?:esta|la) cancion|cambia (?:de|la) cancion|(?:(?:pon(?:me)?|pasa a|dame)\s+)?la (?:siguiente(?: cancion)?|que sigue)|la siguiente cancion|otra cancion|pasala|saltala|next (?:song|track|one)|skip (?:this )?(?:song|track)|skip(?: it)?)$", O);
    public static readonly Regex Anterior = new(@"^(?:(?:pon(?:me)?|pasa a|regresa a|regresame a|vuelve a|dame|play|otra vez)\s+)?(?:(?:la |el )?(?:cancion anterior|tema anterior|anterior cancion|cancion de antes)|la anterior|la de antes|previous (?:song|track)|go back a song|the previous (?:song|track))$|^(?:regresa|regresame|devuelve|retrocede)\s+(?:la|el|una|esta)\s+(?:cancion|tema|rola)$|^(?:regresala|regresalo|devuelvela|previous|una cancion (?:para )?atras)$", O);
    public static readonly Regex PlayPausa = new(@"^(?:pausa|pausala|pausalo|pause|pause it|reanuda|reanudala|continua|resume|pausa (?:la|el) (?:musica|cancion|video|reproduccion)|pon(?:le)? pausa|para (?:la musica|la cancion|el video)|deten (?:la musica|la cancion|el video)|quita la musica|apaga la musica|dale play|dale a play|dale al play|ponle play|pon play|play|reanuda (?:la musica|la cancion|el video)|continua (?:con )?(?:la cancion|la musica)|sigue (?:con )?(?:la musica|la cancion)|vuelve a poner la musica|pause (?:the )?(?:music|song|video|playback)|stop (?:the )?music|resume (?:the )?(?:music|playback)|play (?:the )?music|hit play)$", O);
    static readonly Regex PlayPausar = new(@"^(?:paus|pon(?:le)? pausa|para |deten|quita|apaga|stop)", O);
    static readonly Regex PlayReanudar = new(@"^(?:reanuda|continua|sigue|resume|dale|ponle play|pon play|play|vuelve a poner|hit play)", O);

    /// <summary>Qué pide la frase de play/pausa: «pausar», «reanudar» o "" (alternar). Así «pausa» con la música ya en pausa no la vuelve a poner.</summary>
    public static string SentidoPlay(string limpio) => PlayPausar.IsMatch(limpio) ? "pausar" : PlayReanudar.IsMatch(limpio) ? "reanudar" : "";
    public static readonly Regex Captura = new(@"^(?:(?:toma(?:me|le)?|haz(?:me)?|saca(?:me|le)?|guarda(?:me)?|captura|take|grab|capture|save|snap|make)\s+(?:(?:una|un|a|la|the)\s+)?(?:foto (?:de|a) la pantalla|captura(?: de pantalla)?|pantallazo|screenshot|screen ?capture|la pantalla|the screen)(?:\s+.*)?|screenshot|pantallazo)$", O);
    public static readonly Regex VerPantalla = new(@"^(?:que ves(?: en (?:mi|la) pantalla)?|mira (?:mi|la) pantalla|lee (?:mi|la) pantalla|que hay en (?:mi|la) pantalla|revisa (?:mi|la) pantalla|analiza (?:mi|la) pantalla|what do you see(?: on (?:my|the) screen)?|look at (?:my|the) screen|read (?:my|the) screen|what is on (?:my|the) screen)$", O);
    public static readonly Regex Escritorio = new(@"^(?:minimiza todo|minimiza todas las ventanas|muestrame el escritorio|ve al escritorio|show (?:the|my) desktop|minimize (?:everything|all windows))$", O);
    public static readonly Regex Bloquear = new(@"^(?:bloquea (?:la computadora|la compu|la pc|la pantalla|el equipo|windows)|lock (?:the|my) (?:computer|pc|screen|workstation))$", O);
    // Imperativo al principio (o después del cuándo): «tengo un recordatorio a las 3 que no recuerdo» no crea nada.
    public static readonly Regex Recordatorio = new(@"^(?:(?:en|a las|a la|at|in)\s+[^,]{1,30}?,?\s+)?(?:recuerdame|recordame|avisame|acuerdame|hazme acordar|no me dejes olvidar|pon(?:me)?\s+(?:un|una)\s+(?:recordatorio|alarma|alerta|temporizador|timer)|recordatorio|temporizador|remind me|set (?:a|an) (?:reminder|alarm|timer)|alert me|ping me|don t let me forget|dont let me forget|nudge me|timer)\b", O);
    public static readonly Regex CambioAvatar = new(@"(?:cambia(?:te)?(?: el avatar)? (?:a|por)|ponme a|pasame a|quiero hablar con|que salga|switch to|change (?:the avatar )?to|avatar)", O);
    public static readonly Regex PanelChat = new(@"^(?:el |tu )?(?:chat|panel|conversacion|historial|ventana de aura)$", O);
    static readonly Regex Negacion = new(@"^(?:no|nunca|never|dont|do not|don t)\s+(?!(?:se oye|me oyes|me dejes olvidar|let me forget))", O);
    static readonly Regex Pregunta = new(@"^(?:como|cual|cuando|donde|por que|porque|que es|que significa|sabes|puedes ver|how|why|what is|which|can you really)\b", O);

    public static string Limpiar(string texto)
    {
        var t = LayaLigera.Normalizar(texto);
        for (int i = 0; i < 3; i++)
        {
            var antes = t;
            t = Cortesia.Replace(t, "").Trim();
            t = Cola.Replace(t, "").Trim();
            if (t == antes) break;
        }
        return t;
    }

    static readonly Regex SoloSi = new(@"^(?:si|sip|sii|dale|hazlo|hagalo|ok|okay|okey|vale|claro|claro que si|adelante|confirmo|va|de una|por supuesto|si por favor|si hazlo|si dale|yes|yep|yeah|sure|do it|go ahead|confirm|yes please|yes do it)$", O);
    static readonly Regex HayNo = new(@"\b(?:no|nel|nope|cancela|cancelalo|mejor no|para|espera|wait|stop|don t|dont|not|cancel)\b", O);

    /// <summary>La respuesta a una confirmación: true solo si la frase ENTERA es un sí sin ningún «no»; false si hay un no; null si es otra cosa.</summary>
    public static bool? Respuesta(string texto)
    {
        var t = Limpiar(texto);
        if (HayNo.IsMatch(t)) return false;
        if (SoloSi.IsMatch(t)) return true;
        return null;
    }

    public static bool EsNegacion(string limpio) => Negacion.IsMatch(limpio) || Pregunta.IsMatch(limpio);

    // Verbos de abrir, con lo que puede venir después («abre el/la/mi…»). En el texto ORIGINAL, sin tildes.
    // Verbos FIRMES: «abre X» es abrir aunque X no se conozca (el .exe dirá si no está instalada).
    static readonly Regex Abrir = new(@"^(?:abre(?:me)?|abrime|abri|abrir|inicia|arranca|ejecuta|lanzame|entra a|metete a|llevame a|open(?: up)?|launch|fire up|navigate to|visit|boot up)\s+(?<o>.+)$", O);
    // Verbos AMBIGUOS («pon atención», «vamos a hablar», «show me how…», «go to sleep»): solo si X es algo conocido.
    static readonly Regex AbrirAmbiguo = new(@"^(?:pon(?:me)?|prende|lanza|ve a|vamos a|muestrame|mostrame|ensename|sacame|start|run|bring up|pull up|go to|take me to|show me|load|head to|get me)\s+(?<o>.+)$", O);

    static readonly HashSet<string> AppsComunes = new(StringComparer.Ordinal)
    {
        "word", "excel", "powerpoint", "outlook", "teams", "chrome", "edge", "firefox", "spotify", "whatsapp", "zoom", "paint", "notepad", "bloc de notas",
        "calculadora", "calculator", "explorador", "explorador de archivos", "file explorer", "configuracion", "settings", "discord", "telegram", "notion",
        "onenote", "photoshop", "vlc", "steam", "obs", "canva", "terminal", "visual studio code", "vs code", "administrador de tareas", "task manager",
    };

    /// <summary>¿Es algo que se abre? El .exe lo conecta con las apps instaladas; por defecto, una lista de apps comunes.</summary>
    public static Func<string, bool> EsAppConocida { get; set; } = o => AppsComunes.Contains(o);
    static readonly Regex Articulo = new(@"^(?:(?:el|la|los|las|mi|mis|un|una|the|my|a|an)\s+)+", O);
    static readonly Regex Programa = new(@"^(?:(?:programa|aplicacion|app|pagina|pagina web|sitio|sitio web|web|carpeta|folder)\s+(?:de\s+|del\s+)?)", O);
    static readonly Regex ColaAbrir = new(@"\s+(?:en (?:el )?(?:navegador|chrome|edge|internet|el explorador|pantalla)|in (?:the )?(?:browser|chrome|explorer)|ahi|there|y (?:despues|luego).*|and (?:then )?.*)$", O);

    public static string? ObjetoDeAbrir(string texto)
    {
        var t = Limpiar(texto);
        var m = Abrir.Match(t);
        bool ambiguo = false;
        if (!m.Success) { m = AbrirAmbiguo.Match(t); ambiguo = true; }
        if (!m.Success) return null;
        var o = m.Groups["o"].Value.Trim();
        o = ColaAbrir.Replace(o, "").Trim();
        o = Articulo.Replace(o, "").Trim();
        o = Programa.Replace(o, "").Trim();
        o = Articulo.Replace(o, "").Trim();
        if (o.Length < 2 || o.Length > 60 || o.Split(' ').Length > 6) return null;
        // «pon la música»/«ponme a claudio» no son abrir; los decide otra regla o Laya.
        if (Regex.IsMatch(o, @"^(?:musica|cancion|play|pausa|volumen|a\s)")) return null;
        if (ambiguo && Carpeta(o) == null && Sitio(o) == null && DominioEn(texto) == null && !EsAppConocida(o)) return null;
        return o;
    }

    public static readonly IReadOnlyDictionary<string, string> Carpetas = new Dictionary<string, string>
    {
        ["documentos"] = "documentos", ["mis documentos"] = "documentos", ["documents"] = "documentos",
        ["descargas"] = "descargas", ["carpeta de descargas"] = "descargas", ["downloads"] = "descargas", ["downloads folder"] = "descargas",
        ["escritorio"] = "escritorio", ["desktop"] = "escritorio",
        ["imagenes"] = "imagenes", ["pictures"] = "imagenes", ["fotos"] = "imagenes", ["photos"] = "imagenes", ["carpeta de imagenes"] = "imagenes", ["pictures folder"] = "imagenes",
        ["musica"] = "musica", ["music"] = "musica", ["carpeta de musica"] = "musica", ["music folder"] = "musica",
        ["videos"] = "videos", ["onedrive"] = "onedrive", ["papelera"] = "papelera", ["recycle bin"] = "papelera",
    };

    public static string? Carpeta(string objeto)
    {
        var o = Articulo.Replace(LayaLigera.Normalizar(objeto), "").Trim();
        o = Regex.Replace(o, @"^carpeta\s+(?:de\s+)?", "");
        return Carpetas.TryGetValue(o, out var c) ? c : null;
    }

    public static readonly IReadOnlyDictionary<string, string> Sitios = new Dictionary<string, string>
    {
        ["youtube"] = "https://www.youtube.com", ["gmail"] = "https://mail.google.com", ["correo de gmail"] = "https://mail.google.com",
        ["facebook"] = "https://www.facebook.com", ["instagram"] = "https://www.instagram.com", ["netflix"] = "https://www.netflix.com",
        ["amazon"] = "https://www.amazon.com", ["wikipedia"] = "https://es.wikipedia.org", ["linkedin"] = "https://www.linkedin.com",
        ["tiktok"] = "https://www.tiktok.com", ["twitter"] = "https://x.com", ["x"] = "https://x.com", ["reddit"] = "https://www.reddit.com",
        ["google drive"] = "https://drive.google.com", ["drive"] = "https://drive.google.com", ["google maps"] = "https://maps.google.com",
        ["maps"] = "https://maps.google.com", ["chatgpt"] = "https://chatgpt.com", ["github"] = "https://github.com",
        ["outlook com"] = "https://outlook.live.com", ["whatsapp web"] = "https://web.whatsapp.com", ["google"] = "https://www.google.com",
        ["mercado libre"] = "https://www.mercadolibre.com", ["canva"] = "https://www.canva.com",
    };

    static readonly Regex Dominio = new(@"^(?:https?://)?(?<d>[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9-]{1,63})*\.(?:com|org|net|hn|edu|gob|io|ai|app|dev|es|mx|co|info|tv)(?:\.[a-z]{2})?)(?<r>/\S*)?$", O);

    static readonly Regex DominioSuelto = new(@"(?<![@\w.-])(?:https?://)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9-]{1,63})*\.(?:com|org|net|hn|edu|gob|io|ai|app|dev|es|mx|co|info|tv)(?:\.[a-z]{2})?(?:/[^\s]*)?(?![\w-])", O);

    /// <summary>Un dominio escrito en la frase original («entra a sar.gob.hn»), como URL HTTPS segura.</summary>
    public static string? DominioEn(string texto)
    {
        var m = DominioSuelto.Match((texto ?? "").ToLowerInvariant());
        if (!m.Success) return null;
        var url = m.Value.StartsWith("http", StringComparison.Ordinal) ? m.Value.Replace("http://", "https://") : "https://" + m.Value;
        url = url.TrimEnd('.', ',', '!', '?');
        return Commands.SafeHttps(url) ? url : null;
    }

    public static string? Sitio(string objeto)
    {
        var crudo = objeto.Trim().ToLowerInvariant();
        var d = Dominio.Match(crudo.Replace(" punto ", ".").Replace(" dot ", ".").Replace(" ", ""));
        if (d.Success && crudo.Contains('.') || d.Success && (crudo.Contains(" punto ") || crudo.Contains(" dot ")))
        {
            var url = "https://" + d.Groups["d"].Value + d.Groups["r"].Value;
            return Commands.SafeHttps(url) ? url : null;
        }
        var o = Articulo.Replace(LayaLigera.Normalizar(objeto), "").Trim();
        o = Regex.Replace(o, @"^(?:pagina|sitio|web)\s+(?:de\s+)?", "");
        return Sitios.TryGetValue(o, out var s) ? s : null;
    }

    static readonly Regex Buscar = new(@"^(?:buscame|busca(?:me)?|busque|busca en (?:internet|google|la web|el navegador)|googlea|investiga|averigua(?:me)?|search(?: for| the web for| google for| the internet for)?|google|look up|look online for|web search)\s+(?<q>.+)$", O);
    static readonly Regex ColaBusqueda = new(@"\s+(?:en (?:internet|google|la web|linea)|online|on (?:the )?(?:internet|web|google))$", O);

    /// <summary>Qué buscar, del texto ORIGINAL (conserva tildes y mayúsculas). `laxa`: Laya ya dijo que es búsqueda.</summary>
    public static string? Busqueda(string texto, bool laxa = false)
    {
        var t = Limpiar(texto);
        var m = Buscar.Match(t);
        string? q = m.Success ? m.Groups["q"].Value : laxa ? Regex.Replace(t, @"^(?:\S+\s+){1}", "") : null;
        if (q == null) return null;
        q = ColaBusqueda.Replace(q, "").Trim();
        q = Regex.Replace(q, @"^(?:en (?:internet|google|la web)|on (?:the )?(?:internet|web))\s+", "").Trim();
        if (q.Length < 2 || q.Length > 200) return null;
        // La búsqueda con sus tildes: la misma porción del texto original si se encuentra.
        var original = BuscarEnOriginal(texto, q);
        return original ?? q;
    }

    internal static string? BuscarEnOriginal(string original, string normalizado)
    {
        // Cada palabra original puede normalizarse en varias («10:30» → «10 30»): se aplana y se recuerda de qué palabra vino.
        var palabras = original.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        var planas = new List<(string W, int I)>();
        for (int i = 0; i < palabras.Length; i++)
            foreach (var w in LayaLigera.Normalizar(palabras[i]).Split(' ', StringSplitOptions.RemoveEmptyEntries)) planas.Add((w, i));
        var objetivo = normalizado.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (objetivo.Length == 0) return null;
        for (int i = 0; i + objetivo.Length <= planas.Count; i++)
        {
            bool igual = true;
            for (int k = 0; k < objetivo.Length && igual; k++) igual = planas[i + k].W == objetivo[k];
            if (!igual) continue;
            int desde = planas[i].I, hasta = planas[i + objetivo.Length - 1].I;
            return string.Join(' ', palabras.Skip(desde).Take(hasta - desde + 1)).Trim(' ', ',', '.', '!', '?', '¿', '¡');
        }
        return null;
    }


    public static readonly Regex EscribirDirecto = new(@"^(?:escribe|escribi|teclea|type|write)\b(?!\s+(?:un|una|unos|unas|me un|me una|a|an|le|les|sobre|about|mi|my)\b)\s*[:,]?\s*\S", O);

    static readonly Regex Escribir = new(@"^(?:escribe(?:me|lo)?|escribi|teclea|dicta|anota|pon|pega|type|write|dictate|enter|key in|put|paste|insert)\b(?:\s+(?:esto|lo que te digo|this|what i say))?(?:\s+(?:en|in|into)\s+(?:el |la |the )?(?:bloc de notas|notepad|word|documento|document|doc|ventana(?: activa)?|active window|window))?(?:\s+(?:donde esta el cursor|where the cursor is))?\s*[:,]?\s*(?<x>.*)$", O);

    /// <summary>El texto literal a escribir, del original. Null: «escríbelo» (se escribe la última respuesta o el borrador).</summary>
    public static string? TextoAEscribir(string texto)
    {
        // «escribe: hola» sí; «a las 10:30» no es un separador.
        var dos = Regex.Match(texto, @"(?<!\d):(?!\d)");
        if (dos.Success && dos.Index < texto.Length - 1) return texto[(dos.Index + 1)..].Trim();
        var t = Limpiar(texto);
        var m = Escribir.Match(t);
        if (!m.Success) return null;
        var x = m.Groups["x"].Value.Trim();
        x = Regex.Replace(x, @"\s+(?:en|in|into)\s+(?:el |la |the )?(?:bloc de notas|notepad|word|documento|document|ventana)$", "").Trim();
        if (x.Length == 0 || Regex.IsMatch(x, @"^(?:eso|esto|lo|that|it|this|lo que (?:te dije|dijiste|me dijiste|escribiste)|tu respuesta|la respuesta|lo anterior|el borrador|what (?:you|i) (?:said|wrote)|your answer|the draft)$")) return null;
        return BuscarEnOriginal(texto, x) ?? x;
    }

    static readonly Dictionary<string, int> Numeros = new()
    {
        ["un"] = 1, ["una"] = 1, ["uno"] = 1, ["dos"] = 2, ["tres"] = 3, ["cuatro"] = 4, ["cinco"] = 5, ["seis"] = 6, ["siete"] = 7, ["ocho"] = 8,
        ["nueve"] = 9, ["diez"] = 10, ["once"] = 11, ["doce"] = 12, ["quince"] = 15, ["veinte"] = 20, ["treinta"] = 30, ["cuarenta"] = 40,
        ["cuarenta y cinco"] = 45, ["cincuenta"] = 50, ["sesenta"] = 60, ["a"] = 1, ["an"] = 1, ["one"] = 1, ["two"] = 2, ["three"] = 3,
        ["four"] = 4, ["five"] = 5, ["six"] = 6, ["seven"] = 7, ["eight"] = 8, ["nine"] = 9, ["ten"] = 10, ["eleven"] = 11, ["twelve"] = 12,
        ["fifteen"] = 15, ["twenty"] = 20, ["thirty"] = 30, ["forty"] = 40, ["forty five"] = 45, ["fifty"] = 50, ["sixty"] = 60,
    };
    static readonly Regex EnTanto = new(@"\b(?:en|in|de|por|for)\s+(?<n>\d{1,3}|(?:cuarenta y cinco|forty five|[a-z]+))\s+(?<u>segundos?|seconds?|minutos?|minutes?|mins?|horas?|hours?)\b", O);
    static readonly Regex MediaHora = new(@"\b(?:(?:en|de|por) media hora|for half an hour|in half an hour|in a half hour)\b", O);
    static readonly Regex Ratito = new(@"\b(?:en un ratito|in a bit|en un rato)\b", O);
    static readonly Regex ALas = new(@"\b(?:a las|a la|at)\s+(?<h>\d{1,2}|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|noon|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:[: ](?<m>\d{2}))?(?:\s+y\s+(?<f>media|cuarto))?(?:\s+(?<p>de la manana|de la tarde|de la noche|am|pm))?\b", O);

    /// <summary>Cuánto falta para el recordatorio, desde `ahora`. Null si la frase no dice cuándo.</summary>
    public static TimeSpan? Tiempo(string limpio, DateTime? ahora = null)
    {
        var t = LayaLigera.Normalizar(limpio);
        if (MediaHora.IsMatch(t)) return TimeSpan.FromMinutes(30);
        if (Ratito.IsMatch(t)) return TimeSpan.FromMinutes(5);
        var m = EnTanto.Match(t);
        // Con hora explícita manda la hora: «la reunión de dos horas a las 5» es a las 5.
        if (m.Success && !ALas.IsMatch(t))
        {
            var ns = m.Groups["n"].Value;
            if (!int.TryParse(ns, NumberStyles.None, CultureInfo.InvariantCulture, out var n) && !Numeros.TryGetValue(ns, out n)) return null;
            var u = m.Groups["u"].Value;
            var span = u.StartsWith("seg") || u.StartsWith("sec") ? TimeSpan.FromSeconds(n) : u.StartsWith("h") ? TimeSpan.FromHours(n) : TimeSpan.FromMinutes(n);
            return span > TimeSpan.Zero && span <= TimeSpan.FromHours(24) ? span : null;
        }
        var a = ALas.Match(t);
        if (!a.Success) return null;
        var hs = a.Groups["h"].Value;
        int h = hs == "noon" ? 12 : int.TryParse(hs, NumberStyles.None, CultureInfo.InvariantCulture, out var hh) ? hh : Numeros.TryGetValue(hs, out var hw) ? hw : -1;
        if (h < 0 || h > 23) return null;
        int min = a.Groups["m"].Success ? int.Parse(a.Groups["m"].Value, CultureInfo.InvariantCulture) : a.Groups["f"].Value == "media" ? 30 : a.Groups["f"].Value == "cuarto" ? 15 : 0;
        if (min > 59) return null;
        var p = a.Groups["p"].Value;
        var now = ahora ?? DateTime.Now;
        // «de la noche»: 12 es medianoche y de 1 a 4 es madrugada; de 5 a 11, noche.
        if (p is "de la noche" && h == 12) h = 0;
        else if (p is "de la noche" && h >= 1 && h <= 4) { }
        else if ((p is "de la tarde" or "de la noche" or "pm") && h < 12) h += 12;
        if ((p is "de la manana" or "am") && h == 12) h = 0;
        var objetivo = new DateTime(now.Year, now.Month, now.Day, h, min, 0);
        // «a las 5» sin decir tarde: la próxima vez que sean las 5 (si ya pasaron las 5 de la mañana, las 5 de la tarde).
        if (objetivo <= now && string.IsNullOrEmpty(p) && h < 12) objetivo = objetivo.AddHours(12);
        if (objetivo <= now) objetivo = objetivo.AddDays(1);
        return objetivo - now;
    }

    /// <summary>Qué recordar: la frase sin el verbo y sin el cuándo. Vacío si no dijo qué (un temporizador).</summary>
    public static string TareaDeRecordatorio(string texto)
    {
        var t = Limpiar(texto);
        t = Regex.Replace(t, @"\b(?:recuerdame|recordame|avisame|acuerdame|hazme acordar(?: de)?|no me dejes olvidar|ponme|pon|agendame|remind me(?: to)?|set (?:a|an) (?:reminder|alarm|timer)(?: for| to)?|alert me(?: about)?|ping me(?: about)?|let me know(?: to)?|nudge me(?: to)?|una alarma|una alerta|un recordatorio|un timer|un temporizador|recordatorio|para|de|that|to|que tengo|about)\b", " ");
        t = EnTanto.Replace(t, " "); t = MediaHora.Replace(t, " "); t = Ratito.Replace(t, " "); t = ALas.Replace(t, " ");
        t = Regex.Replace(t, @"\s+", " ").Trim(' ', ':', ',');
        if (t.Length == 0) return "";
        return BuscarEnOriginal(texto, t) ?? t;
    }

    public static readonly IReadOnlyDictionary<string, string> Avatares = new Dictionary<string, string>
    {
        ["aura"] = "aura", ["la dorada"] = "aura", ["dorada"] = "aura", ["the golden one"] = "aura",
        ["claudio"] = "claudio", ["el zorro"] = "claudio", ["zorro"] = "claudio", ["the fox"] = "claudio", ["fox"] = "claudio",
        ["antonio"] = "antonio", ["ant onio"] = "antonio", ["hormiga"] = "antonio", ["la hormiga"] = "antonio", ["the ant"] = "antonio",
        ["guardian"] = "ojos", ["el guardian"] = "ojos", ["the guardian"] = "ojos", ["ojos"] = "ojos", ["los ojos"] = "ojos", ["the eyes"] = "ojos",
    };

    public static string? Avatar(string texto)
    {
        var t = " " + LayaLigera.Normalizar(texto) + " ";
        // El nombre al principio es a quién se habla («claudio, abre…»); cuenta el ÚLTIMO nombre dicho.
        string? elegido = null; int donde = -1;
        foreach (var (k, v) in Avatares)
        {
            var i = t.LastIndexOf(" " + k + " ", StringComparison.Ordinal);
            if (i > donde) { donde = i; elegido = v; }
        }
        return elegido;
    }

    // ───────────── nativas 1.1 ─────────────

    public static readonly Regex QueHay = new(@"^(?:que (?:botones|opciones|controles|pestanas|menus) (?:hay|tiene(?: esta ventana)?|ves)|que puedo (?:hacer|tocar|pulsar) aqui|lee(?:me)? los botones|dime los botones|what (?:buttons|options|controls|tabs) (?:are there|do you see|can i (?:press|click))|read (?:me )?the buttons|what can i click)$", O);
    public static readonly Regex Portapapeles = new(@"(?:lo que (?:copie|he copiado|tengo copiado)|el portapapeles|what i copied|my clipboard|the clipboard|lo copiado)", O);

    static readonly Regex Pulsa = new(@"^(?:dale (?:clic |click )?(?:a|en)|haz (?:clic|click|doble clic) (?:en|a|sobre)|pulsa(?:le)?(?: en)?|presiona(?:le)?|aprieta(?:le)?|clic(?:k)? (?:en|on)|click|press|tap(?: on)?|hit|selecciona|select)\s+(?<o>.+)$", O);
    static readonly Regex PestanaMenu = new(@"^(?:abre|abrime|ve a|open|go to)\s+(?:la |el |the )?(?:pestana|menu|tab|ficha)\s+(?:de |del )?(?<o>.+)$", O);
    static readonly Regex TipoControl = new(@"^(?:(?:el|la|los|las|the)\s+)?(?:boton|opcion|pestana|menu|enlace|casilla|button|option|tab|menu|link|checkbox)\s+(?:de\s+|del\s+)?", O);

    /// <summary>El nombre del control a pulsar («dale a Guardar» → «guardar»). `laxa`: Laya ya dijo que es pulsar.</summary>
    public static string? Control(string texto, bool laxa = false)
    {
        var t = Limpiar(texto);
        var m = PestanaMenu.Match(t);
        if (!m.Success) m = Pulsa.Match(t);
        if (!m.Success && laxa) m = Regex.Match(t, @"^\S+\s+(?:en\s+|a\s+)?(?<o>.+)$");
        if (!m.Success) return null;
        var o = TipoControl.Replace(m.Groups["o"].Value.Trim(), "").Trim();
        o = Regex.Replace(o, @"^(?:el|la|los|las|the)\s+", "").Trim();
        o = Regex.Replace(o, @"\s+(?:button|tab|menu|option|link|boton|pestana|opcion)$", "").Trim();
        if (o.Length < 2 || o.Length > 50 || o.Split(' ').Length > 5) return null;
        // «selecciona todo» es Ctrl+A en la app: también es un control con nombre en muchas; se deja.
        return BuscarEnOriginal(texto, o) ?? o;
    }

    static readonly Regex VentanaAccion = new(@"^(?:(?<a>minimiza|maximiza|cierra|cerra|restaura|minimize|maximize|close|restore)\s+(?:(?:esta|la|this|the)\s+)?(?:ventana|window)(?:\s+de\s+(?<o>.+))?|(?<a>cierra|cerra|close|minimiza|minimize|maximiza|maximize)\s+(?:el |la |the )?(?<o>[^\s].*))$", O);
    static readonly Regex VentanaCambiar = new(@"^(?:cambia(?:te)? a|pasa(?:me)? a|vuelve a|regresa a|trae(?:me)?|muestrame la ventana de|switch to|go back to|bring up the)\s+(?:la ventana de\s+|el |la |the )?(?<o>.+)$", O);

    /// <summary>«cerrar|word», «minimizar|», «cambiar|chrome»… o null.</summary>
    public static string? Ventana(string texto, bool laxa = false)
    {
        var t = Limpiar(texto);
        // «ciérrala», «minimízalo»: la ventana en la que estás.
        var p = Regex.Match(t, @"^(?<a>cierra|cerra|minimiza|maximiza|restaura)(?:la|lo)$");
        if (p.Success) { var a0 = p.Groups["a"].Value; return (a0.StartsWith("min") ? "minimizar" : a0.StartsWith("max") ? "maximizar" : a0.StartsWith("rest") ? "restaurar" : "cerrar") + "|"; }
        var m = VentanaAccion.Match(t);
        if (m.Success)
        {
            var a = m.Groups["a"].Value;
            var accion = a.StartsWith("min") ? "minimizar" : a.StartsWith("max") ? "maximizar" : a.StartsWith("rest") ? "restaurar" : "cerrar";
            var o = m.Groups["o"].Success ? m.Groups["o"].Value.Trim() : "";
            o = Regex.Replace(o, @"^(?:(?:esta|la|this|the)\s+)?(?:ventana|window)\s*(?:de\s+)?", "").Trim();
            // «cierra el chat» es el panel de AURA, no una ventana.
            if (PanelChat.IsMatch(o)) return null;
            if (o.Length > 40) return null;
            return accion + "|" + o;
        }
        var c = VentanaCambiar.Match(t);
        if (c.Success)
        {
            var o = c.Groups["o"].Value.Trim();
            if (o.Length < 2 || o.Length > 40 || o.Split(' ').Length > 4) return null;
            return "cambiar|" + o;
        }
        return laxa && ObjetoDeAbrir(texto) is { } ob ? "cambiar|" + ob : null;
    }

    static readonly Regex InfoHora = new(@"^(?:que hora es|que horas son|me dices la hora|dime la hora|la hora|what time is it|what s the time|tell me the time)$", O);
    static readonly Regex InfoFecha = new(@"^(?:que (?:dia|fecha) es(?: hoy)?|a cuanto estamos(?: hoy)?|que dia es manana|what (?:day|date) is (?:it|today)|what s the date(?: today)?|today s date)$", O);
    static readonly Regex InfoBateria = new(@"(?:bateria|battery|cargador|enchufad[ao]|plugged in)", O);
    static readonly Regex InfoDisco = new(@"(?:espacio (?:libre|en (?:el )?disco|queda)|cuanto espacio|disco (?:lleno|duro)|disk space|free space|storage left)", O);
    static readonly Regex InfoRed = new(@"(?:(?:estoy|estamos|esta la compu|tengo) (?:conectad[ao]s? a )?internet|hay internet|tengo wifi|como esta (?:el )?(?:wifi|internet)|(?:am i|are we) (?:connected|online)|is (?:the )?(?:wifi|internet) (?:working|on))", O);
    static readonly Regex InfoSistema = new(@"^(?:como esta (?:la compu|la computadora|el equipo|mi pc)|estado del (?:equipo|sistema)|how is my (?:pc|computer)|system status)$", O);

    /// <summary>hora | fecha | bateria | disco | red | sistema, o null.</summary>
    public static string? Info(string limpio, bool laxa = false)
    {
        var t = LayaLigera.Normalizar(limpio);
        if (InfoHora.IsMatch(t)) return "hora";
        if (InfoFecha.IsMatch(t)) return "fecha";
        if (InfoSistema.IsMatch(t)) return "sistema";
        bool pregunta = Regex.IsMatch(t, @"^(?:cuanta|cuanto|como|que|tengo|estoy|hay|me queda|queda|how|what|is|am|do i|are)\b");
        if ((pregunta || laxa) && InfoBateria.IsMatch(t)) return "bateria";
        if ((pregunta || laxa) && InfoDisco.IsMatch(t)) return "disco";
        if ((pregunta || laxa) && InfoRed.IsMatch(t)) return "red";
        return laxa ? "sistema" : null;
    }

    static readonly Regex UltimaDescarga = new(@"(?:ultim[oa] (?:archivo |cosa )?(?:que )?(?:descargue|baje|descargado|bajado)|ultima descarga|lo ultimo que (?:descargue|baje)|last (?:download|downloaded file|file i downloaded)|my latest download)", O);
    static readonly Regex AbrirArchivoRe = new(@"^(?:abre(?:me)?|abrime|busca(?:me)?|encuentra(?:me)?|open|find)\s+(?:el |mi |la |the |my )?(?:archivo|documento|file|document|pdf|excel|word)\s+(?:de |del |que se llama |llamado |called |named )?(?<o>.+)$", O);

    /// <summary>«ultimo-descargado» o el nombre del archivo a buscar en Descargas, Documentos y Escritorio.</summary>
    public static string? Archivo(string texto, bool laxa = false)
    {
        var t = Limpiar(texto);
        if (UltimaDescarga.IsMatch(t)) return "ultimo-descargado";
        var m = AbrirArchivoRe.Match(t);
        if (!m.Success) return null;
        var o = m.Groups["o"].Value.Trim();
        if (o.Length < 2 || o.Length > 80) return null;
        return BuscarEnOriginal(texto, o) ?? o;
    }

    // ───────────── 1.2: música, correo y agenda ─────────────

    static readonly Regex QueSuena = new(@"^(?:que (?:esta sonando|suena|cancion es esta|cancion es|cancion esta sonando|musica es esta|estoy escuchando)|quien canta (?:esta cancion|esto)|como se llama esta cancion|what s playing|what is playing|what song is this|who sings this|what am i listening to)$", O);
    static readonly Regex PonMusica = new(@"^(?:pon(?:me)?|reproduce|toca|tocame|busca|play|put on|search)\s+(?:(?:la |el |una |un |a |the |some )?(?:cancion|canciones|musica|tema|song|songs|music|album|playlist|lista)\s+(?:de\s+|del\s+|by\s+)?)?(?<q>.+?)\s+(?:en|on|in)\s+(?<app>spotify|youtube music|youtube|yt music)$", O);
    static readonly Regex MusicaSinMas = new(@"^(?:pon(?:me)?|reproduce|toca|tocame|play|put on)\s+(?:algo de |un poco de |some |la |el )?(?:musica|music|mi musica|my music)$", O);
    static readonly Regex PonAlgo = new(@"^(?:pon(?:me)?|reproduce|toca(?:me)?|play|put on)\s+(?<q>.+)$", O);
    static readonly Regex NoEsMusica = new(@"\b(?:alarma|recordatorio|volumen|brillo|modo|tema|nota|timer|temporizador|pantalla|ventana|mute|pausa|atencion|cuidado|luz|hora|fecha|cursor|escritorio|foco|wifi|bluetooth|reloj|fondo|contrasena|clave|mensaje|correo)\b", O);
    static readonly Regex PonCancion = new(@"^(?:pon(?:me)?|ponle|reproduce(?:me)?|tocame|play|put on|quiero (?:escuchar|oir)|(?:pon(?:me)?|ponle) a sonar)\s+(?<q>.+)$", O);
    static readonly Regex NoEsMusicaTampoco = new(@"^(?:esto|eso|aqui|ahi|esta|este|la |el |los |las |un |una |mas |menos |a [a-z]+(?:ar|er|ir)\b)|\b(?:despertador|pelicula|video|serie|canal|subtitulos|idioma|cronometro|contador|aviso|boton|enlace|link|archivo|carpeta|word|excel|powerpoint|chrome|edge|calculadora|notas?|bloc|pausa|silencio|nombre|numero|precio|dolar|lempira)\b", O);
    static readonly Regex PonMusicaSinApp = new(@"^(?:pon(?:me)?|reproduce|tocame|play|put on)\s+(?:(?:la |el |una |un |a |the |some )?(?:cancion|canciones|musica|tema|song|songs|music|album|playlist)\s+(?:de\s+|del\s+|by\s+)?)(?<q>.+)$", O);

    /// <summary>«que-suena», «spotify|busqueda», «ytmusic|busqueda», «buscar|busqueda» (la app de música de siempre), o null.</summary>
    public static string? Musica(string texto, bool laxa = false)
    {
        var t = Limpiar(texto);
        if (QueSuena.IsMatch(t)) return "que-suena";
        var m = PonMusica.Match(t);
        // «busca X en youtube» es una búsqueda web (videos), no música: solo «busca … en spotify / youtube music» lo es.
        if (m.Success && Regex.IsMatch(t, @"^(?:busca|search)\b") && m.Groups["app"].Value == "youtube") return laxa ? "que-suena" : null;
        if (m.Success)
        {
            var q = Regex.Replace(m.Groups["q"].Value.Trim(), @"^(?:some|algo de|un poco de|musica de|music by|a)\s+", "");
            if (q.Length < 2 || q.Length > 100) return null;
            var app = m.Groups["app"].Value.StartsWith("spotify") ? "spotify" : "ytmusic";
            return app + "|" + (BuscarEnOriginal(texto, q) ?? q);
        }
        // «pon música», «reproduce algo de música»: lo que estaba sonando (o Spotify) sigue.
        if (MusicaSinMas.IsMatch(t)) return "reanudar|";
        m = PonMusicaSinApp.Match(t);
        if (m.Success)
        {
            var q = Regex.Replace(m.Groups["q"].Value.Trim(), @"^a\s+", "");
            return q.Length is >= 2 and <= 100 ? "buscar|" + (BuscarEnOriginal(texto, q) ?? q) : null;
        }
        // «Pon The Verve», «quiero escuchar Bohemian Rhapsody», «reprodúceme Bitter Sweet Symphony» (José, 1-oct): sin «en
        // Spotify» igual es música; antes se iba al cerebro (segundos más, y a veces decía que la ponía sin ponerla).
        // Solo con verbos de música y nada que suene a otra cosa («pon la alarma», «pon el volumen», «pon esto…»).
        if (PonCancion.Match(t) is { Success: true } pc && !NoEsMusica.IsMatch(pc.Groups["q"].Value) && !NoEsMusicaTampoco.IsMatch(pc.Groups["q"].Value))
        {
            var q = Regex.Replace(pc.Groups["q"].Value.Trim(), @"^(?:algo de|un poco de|a|some)\s+", "");
            if (q.Length is >= 3 and <= 100 && MusicaPedida.Claves(q).Count > 0) return "buscar|" + (BuscarEnOriginal(texto, q) ?? q);
        }
        // Laya ya sabe que es música: «pon bad bunny», «tócame algo de Shakira» → buscarlo y ponerlo (no «qué suena»).
        if (laxa && PonAlgo.Match(t) is { Success: true } pa && !NoEsMusica.IsMatch(pa.Groups["q"].Value))
        {
            var q = Regex.Replace(pa.Groups["q"].Value.Trim(), @"^(?:algo de|un poco de|a|some)\s+", "");
            if (q.Length is >= 2 and <= 100) return "buscar|" + (BuscarEnOriginal(texto, q) ?? q);
        }
        return laxa ? "que-suena" : null;
    }

    static readonly Regex CorreoDe = new(@"^(?:leeme|lee|revisa|hay|tengo|busca|read|check|any) (?:(?:el|los|un|algun|mis|my|the) )?(?:ultimo )?(?:correos?|emails?|mails?|mensajes? de correo) (?:nuevos? )?(?:de|del|from) (?<de>[a-z0-9 ._-]{2,40})$", O);
    static readonly Regex CorreoRe = new(@"^(?:(?:tengo|hay) (?:correos?|emails?|mails?|mensajes? de correo)(?: nuevos?)?|(?:leeme|lee|revisa|revisame|checa|abre) (?:mis |el |los |mi )?(?:correos?|emails?|mails?|bandeja(?: de entrada)?)(?: nuevos?)?|(?:que|cuantos) correos (?:tengo|hay|me llegaron)|me llego (?:algun )?correo|(?:resume|resumeme|resumen de) (?:mis |el |los )?(?:correos?|emails?|bandeja)|lee(?:me)? el ultimo correo|(?:check|read|summarize) (?:my )?(?:emails?|mail|inbox)|(?:any|do i have) new (?:emails?|mail)|read (?:me )?the last email|how many emails do i have)$", O);

    /// <summary>«leer», «resumir» o «contar», o null.</summary>
    public static string? Correo(string limpio, bool laxa = false)
    {
        var t = LayaLigera.Normalizar(limpio);
        if (CorreoDe.Match(t) is { Success: true } md) return "de|" + md.Groups["de"].Value.Trim();
        if (!CorreoRe.IsMatch(t)) return laxa ? "leer" : null;
        if (Regex.IsMatch(t, @"(?:resume|resumeme|resumen|summarize)")) return "resumir";
        if (Regex.IsMatch(t, @"^(?:tengo|hay|cuantos|me llego|any|do i have|how many)")) return "contar";
        return "leer";
    }

    static readonly Regex AgendaRe = new(@"^(?:que tengo (?:hoy|manana|esta semana|pendiente hoy|en la agenda|agendado)(?: en (?:la|mi) (?:agenda|calendario))?|que tengo en (?:la|mi) (?:agenda|calendario)(?: (?:hoy|manana|esta semana|para hoy|para manana))?|(?:como esta |revisa |leeme |dime )?(?:mi|la) agenda(?: de (?:hoy|manana|la semana))?|(?:cual es |cuando es )?(?:mi )?(?:proxima|siguiente) (?:reunion|cita|junta|evento)|tengo (?:reuniones|citas|juntas|eventos) (?:hoy|manana)|que hay en mi (?:calendario|agenda)(?: hoy| manana)?|what s on my calendar(?: today| tomorrow)?|what do i have (?:today|tomorrow|this week)|my (?:schedule|agenda)(?: today| tomorrow)?|when is my next (?:meeting|appointment)|next meeting)$", O);

    /// <summary>«hoy», «manana», «semana» o «proximo», o null.</summary>
    public static string? Agenda(string limpio, bool laxa = false)
    {
        var t = LayaLigera.Normalizar(limpio);
        if (!AgendaRe.IsMatch(t)) return laxa ? "hoy" : null;
        if (Regex.IsMatch(t, @"(?:proxima|siguiente|next)")) return "proximo";
        if (Regex.IsMatch(t, @"(?:manana|tomorrow)")) return "manana";
        if (Regex.IsMatch(t, @"(?:semana|week)")) return "semana";
        return "hoy";
    }

    static readonly Regex AvisosLeer = new(@"^(?:(?:que|cuales) notificaciones (?:tengo|hay|me llegaron)|(?:tengo|hay) (?:alguna )?notificaciones?(?: nuevas?)?|(?:leeme|lee|dime|muestrame|revisa) (?:las |mis )?notificaciones|que me llego|que me ha llegado|(?:what|which) notifications (?:do i have|did i get)|(?:read|show) (?:me )?(?:my )?notifications|any (?:new )?notifications|what did i get)$", O);
    static readonly Regex AvisoUltimo = new(@"^(?:(?:leeme|lee|dime|repite|repiteme) la ultima notificacion|que decia (?:la|esa) notificacion|read (?:me )?the last notification|what did that notification say)$", O);
    static readonly Regex AvisosSilenciar = new(@"^(?:silencia|calla|oculta|apaga|quita|bloquea) (?:las )?notificaciones de (?<app>.{2,40})|no me (?:muestres|ensenes|avises de) (?:las (?:notificaciones )?de )?(?<app>.{2,40})|mute (?:notifications from |the )?(?<app>.{2,40}?)(?: notifications)?$", O);
    static readonly Regex AvisosActivar = new(@"^(?:vuelve a mostrar(?:me)?|muestrame otra vez|activa|reactiva) (?:las )?notificaciones de (?<app>.{2,40})|unmute (?:notifications from )?(?<app>.{2,40}?)(?: notifications)?$", O);

    /// <summary>«leer», «ultima», «silenciar|whatsapp» o «activar|whatsapp», o null.</summary>
    public static string? Notificaciones(string limpio)
    {
        var t = LayaLigera.Normalizar(limpio);
        if (AvisoUltimo.IsMatch(t)) return "ultima";
        if (AvisosLeer.IsMatch(t)) return "leer";
        if (AvisosActivar.Match(t) is { Success: true } a) return "activar|" + a.Groups["app"].Value.Trim();
        if (AvisosSilenciar.Match(t) is { Success: true } m && !Regex.IsMatch(m.Groups["app"].Value, @"^(?:nada|eso|esto|mas)$")) return "silenciar|" + m.Groups["app"].Value.Trim();
        return null;
    }

    static readonly string Monedas = "origen|origenes|auka|agka|ondk|mnka|ibs|harv|aubex|asl|love|rest|sol|ait|agro|political";
    static readonly Regex CarteraRe = new(@"^(?:cuanto (?:dinero |plata |pisto )?(?:tengo|hay)(?: en (?:mi|la) (?:cartera|wallet|billetera|veta(?: wallet)?))?|cuanto (?<m>" + Monedas + @") (?:tengo|hay|me queda)|cuantos? (?<m>" + Monedas + @") tengo|(?:cual es |dime |revisa |muestrame )?(?:mi )?(?:saldo|balance)(?: de (?<m>" + Monedas + @"))?(?: en (?:veta|la wallet|mi cartera))?|(?:como esta|revisa|abre) mi (?:cartera|wallet|billetera)|que tengo en (?:mi|la) (?:cartera|wallet|billetera)|how much (?<m>" + Monedas + @") do i have|how much (?:money )?do i have(?: in my wallet)?|(?:what s|whats|what is) my balance|my (?:wallet )?balance|check my wallet)$", O);

    /// <summary>«todo» o el símbolo («ORIGEN»), o null.</summary>
    public static string? Cartera(string limpio)
    {
        var t = LayaLigera.Normalizar(limpio);
        var m = CarteraRe.Match(t);
        if (!m.Success) return null;
        var mon = m.Groups["m"].Value;
        return mon.Length == 0 ? "todo" : mon.StartsWith("origen") ? "ORIGEN" : mon.ToUpperInvariant();
    }

    // ───────────── 2.0: atajos del teclado, Configuración de Windows, brillo y tema ─────────────

    static readonly (Regex Frase, string Teclas)[] Atajos =
    {
        (new(@"^(?:copia(?:lo|la)?(?: eso| esto)?|copy(?: that| it| this)?)$", O), "CTRL+C"),
        (new(@"^(?:pega(?:lo|la)?(?: aqui)?|paste(?: it| here)?)$", O), "CTRL+V"),
        (new(@"^(?:corta(?:lo|la)?|cut(?: it| that)?)$", O), "CTRL+X"),
        (new(@"^(?:deshaz(?: eso)?|deshacer|undo(?: that)?)$", O), "CTRL+Z"),
        (new(@"^(?:rehaz(?: eso)?|rehacer|redo(?: that)?)$", O), "CTRL+Y"),
        (new(@"^(?:selecciona(?:lo)? todo|select all)$", O), "CTRL+A"),
        (new(@"^(?:guarda(?:lo|la)?|guarda (?:el|este) (?:archivo|documento)|guarda los cambios|save(?: it| the file| changes)?)$", O), "CTRL+S"),
        (new(@"^(?:imprime(?:lo|la)?|imprimir|print(?: it| this)?)$", O), "CTRL+P"),
        (new(@"^(?:busca en (?:la|esta) pagina|find on (?:the |this )?page)$", O), "CTRL+F"),
        (new(@"^(?:(?:abre (?:una )?)?(?:nueva pestana|pestana nueva)|new tab|open a new tab)$", O), "CTRL+T"),
        (new(@"^(?:cierra (?:la |esta )?pestana|close (?:the |this )?tab)$", O), "CTRL+W"),
        (new(@"^(?:(?:la )?siguiente pestana|pestana siguiente|next tab)$", O), "CTRL+TAB"),
        (new(@"^(?:(?:la )?pestana anterior|previous tab)$", O), "CTRL+SHIFT+TAB"),
        (new(@"^(?:reabre la pestana|abre la pestana que cerre|reopen (?:the )?(?:closed )?tab)$", O), "CTRL+SHIFT+T"),
        (new(@"^(?:recarga(?: la pagina)?|actualiza la pagina|refresh(?: the page)?|reload(?: the page)?)$", O), "F5"),
        (new(@"^(?:ve atras|pagina anterior|go back|back)$", O), "ALT+LEFT"),
        (new(@"^(?:ve adelante|pagina siguiente|go forward|forward)$", O), "ALT+RIGHT"),
        (new(@"^(?:cambia de ventana|la otra ventana|alt tab|switch windows)$", O), "ALT+TAB"),
        (new(@"^(?:(?:pon|manda|mueve) (?:la|esta) ventana a la izquierda|ventana a la izquierda|snap (?:the |this )?window left)$", O), "WIN+LEFT"),
        (new(@"^(?:(?:pon|manda|mueve) (?:la|esta) ventana a la derecha|ventana a la derecha|snap (?:the |this )?window right)$", O), "WIN+RIGHT"),
        (new(@"^(?:pantalla completa|ponlo en pantalla completa|full ?screen)$", O), "F11"),
        (new(@"^(?:baja la pagina|desplazate (?:hacia )?abajo|bajale a la pagina|scroll down|page down)$", O), "PAGEDOWN"),
        (new(@"^(?:sube la pagina|desplazate (?:hacia )?arriba|scroll up|page up)$", O), "PAGEUP"),
        (new(@"^(?:acerca(?:lo)?|mas grande(?: la letra)?|agranda(?: la letra)?|zoom in)$", O), "CTRL+PLUS"),
        (new(@"^(?:aleja(?:lo)?|mas pequeno|achica(?: la letra)?|zoom out)$", O), "CTRL+MINUS"),
        (new(@"^(?:tamano normal|zoom normal|reset zoom)$", O), "CTRL+0"),
        (new(@"^(?:(?:dale|presiona|pulsa) enter|enter|press enter)$", O), "ENTER"),
        (new(@"^(?:(?:presiona|pulsa) escape|escape|press escape)$", O), "ESC"),
        (new(@"^(?:abre el menu (?:de )?inicio|menu inicio|open (?:the )?start menu)$", O), "WIN"),
        (new(@"^(?:vista de tareas|todas las ventanas|task view)$", O), "WIN+TAB"),
    };

    static readonly Dictionary<string, string> TeclasDichas = new()
    {
        ["control"] = "CTRL", ["ctrl"] = "CTRL", ["control izquierdo"] = "CTRL", ["alt"] = "ALT", ["shift"] = "SHIFT", ["mayuscula"] = "SHIFT", ["mayusculas"] = "SHIFT",
        ["windows"] = "WIN", ["tecla windows"] = "WIN", ["win"] = "WIN", ["enter"] = "ENTER", ["intro"] = "ENTER", ["escape"] = "ESC", ["esc"] = "ESC",
        ["tab"] = "TAB", ["tabulador"] = "TAB", ["espacio"] = "SPACE", ["space"] = "SPACE", ["borrar"] = "BACKSPACE", ["retroceso"] = "BACKSPACE", ["backspace"] = "BACKSPACE",
        ["suprimir"] = "DELETE", ["delete"] = "DELETE", ["supr"] = "DELETE", ["inicio"] = "HOME", ["home"] = "HOME", ["fin"] = "END", ["end"] = "END",
        ["arriba"] = "UP", ["abajo"] = "DOWN", ["izquierda"] = "LEFT", ["derecha"] = "RIGHT", ["up"] = "UP", ["down"] = "DOWN", ["left"] = "LEFT", ["right"] = "RIGHT",
        ["mas"] = "PLUS", ["menos"] = "MINUS", ["plus"] = "PLUS", ["minus"] = "MINUS",
    };

    static readonly Regex Presiona = new(@"^(?:presiona|pulsa|oprime|aprieta|teclea|press|hit)\s+(?:la tecla |las teclas |el atajo |the key |keys )?(?<t>.{1,40})$", O);

    /// <summary>«presiona control shift s» → «CTRL+SHIFT+S». Null si no se entiende o es peligrosa (Alt+F4, Ctrl+Alt+Supr).</summary>
    public static string? TeclasDe(string dicho)
    {
        var partes = new List<string>();
        var t = Regex.Replace(dicho, @"\s*(?:\+|\by\b|\band\b|\bmas\b(?= [a-z]))\s*", " ").Trim();
        var palabras = t.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        for (int i = 0; i < palabras.Length; i++)
        {
            if (i + 1 < palabras.Length && TeclasDichas.TryGetValue(palabras[i] + " " + palabras[i + 1], out var doble)) { partes.Add(doble); i++; continue; }
            var p = palabras[i];
            if (TeclasDichas.TryGetValue(p, out var k)) partes.Add(k);
            else if (Regex.IsMatch(p, "^[a-z0-9]$")) partes.Add(p.ToUpperInvariant());
            else if (Regex.IsMatch(p, "^f(?:[1-9]|1[0-2])$")) partes.Add(p.ToUpperInvariant());
            else return null;
        }
        if (partes.Count == 0 || partes.Count > 4) return null;
        var combo = string.Join("+", partes.Distinct());
        if (combo is "ALT+F4" || (combo.Contains("CTRL") && combo.Contains("ALT") && combo.Contains("DELETE"))) return null;
        return combo;
    }

    static readonly (Regex Frase, string Pagina)[] Configuraciones =
    {
        (new(@"(?:wifi|wi fi|red inalambrica|wireless)", O), "network-wifi"), (new(@"(?:bluetooth|dispositivos)", O), "bluetooth"),
        (new(@"(?:pantalla|monitor|resolucion|display|screen)", O), "display"), (new(@"(?:sonido|audio|sound|parlantes|bocinas)", O), "sound"),
        (new(@"(?:red|internet|network|ethernet)", O), "network-status"), (new(@"(?:energia|bateria|power|battery)", O), "powersleep"),
        (new(@"(?:actualizaciones|windows update|update)", O), "windowsupdate"), (new(@"(?:privacidad|privacy)", O), "privacy"),
        (new(@"(?:camara|camera)", O), "privacy-webcam"), (new(@"(?:microfono|microphone)", O), "privacy-microphone"),
        (new(@"(?:notificaciones|notifications)", O), "notifications"), (new(@"(?:fondo(?: de pantalla)?|wallpaper|background|personalizacion)", O), "personalization-background"),
        (new(@"(?:impresoras?|printers?)", O), "printers"), (new(@"(?:aplicaciones|apps|programas)", O), "appsfeatures"),
        (new(@"(?:almacenamiento|disco|storage)", O), "storagesense"), (new(@"(?:mouse|raton)", O), "mousetouchpad"),
        (new(@"(?:teclado|keyboard)", O), "typing"), (new(@"(?:idioma|language)", O), "regionlanguage"), (new(@"(?:hora|fecha|time|date)", O), "dateandtime"),
        (new(@"(?:cuentas?|accounts?|usuario)", O), "accounts"), (new(@"(?:proyectar|segunda pantalla|project)", O), "project"),
    };
    static readonly Regex AbreConfiguracion = new(@"^(?:abre|abreme|ve a|muestrame|open|go to|show me)\s+(?:la |las )?(?:configuracion|ajustes|opciones|settings)\s+(?:de(?:l| la| las| los)?\s+|for\s+|of\s+)?(?<q>.{2,30})$|^(?:open|show)\s+(?<q>.{2,30}?)\s+settings$", O);
    static readonly Regex Brillo = new(@"^(?:(?<d>sube|subele|aumenta|mas|turn up|increase|raise)\s+(?:el |the )?(?:brillo|brightness)|(?<d>baja|bajale|disminuye|menos|turn down|decrease|lower)\s+(?:el |the )?(?:brillo|brightness)|(?:pon |ponle |set )?(?:el |the )?(?:brillo|brightness)\s+(?:al?|to|en)\s+(?<n>\d{1,3})(?:\s*(?:%|por ciento|percent))?)$", O);

    /// <summary>«teclas|CTRL+S», «config|network-wifi», «brillo|+», «brillo|70», «tema|oscuro», o null.</summary>
    public static string? Atajo(string limpio)
    {
        var t = LayaLigera.Normalizar(limpio);
        foreach (var (frase, teclas) in Atajos) if (frase.IsMatch(t)) return "teclas|" + teclas;
        if (Presiona.Match(t) is { Success: true } p && TeclasDe(p.Groups["t"].Value) is { } combo) return "teclas|" + combo;
        if (AbreConfiguracion.Match(t) is { Success: true } c)
        {
            foreach (var (frase, pagina) in Configuraciones) if (frase.IsMatch(c.Groups["q"].Value)) return "config|" + pagina;
        }
        if (Regex.IsMatch(t, @"^(?:abre (?:la )?configuracion(?: de windows)?|open settings)$")) return "config|";
        // «activa el bluetooth», «apaga el wifi»: su página de Configuración, con el interruptor a la vista.
        var radio = Regex.Match(t, @"^(?:activa|desactiva|prende|apaga|enciende|conecta|desconecta|pon|quita|turn on|turn off|enable|disable)\s+(?:el |la |the )?(?<q>bluetooth|wifi|wi fi|modo avion|airplane mode)$");
        if (radio.Success) return "config|" + (radio.Groups["q"].Value.StartsWith("blue") ? "bluetooth" : radio.Groups["q"].Value.Contains("avi") || radio.Groups["q"].Value.StartsWith("air") ? "network-airplanemode" : "network-wifi");
        // Apagar, reiniciar, suspender la PC (siempre con confirmación, y con 30 s para arrepentirse).
        var energia = Regex.Match(t, @"^(?:(?<a>apaga|reinicia|suspende|hiberna|duerme|cierra (?:la )?sesion(?: de windows)?)(?:\s+(?:la |el |mi )?(?:computadora|compu|pc|equipo|laptop|maquina|ordenador))?|(?<a>shut down|restart|reboot|sleep|log off|sign out)(?:\s+(?:the |my )?(?:computer|pc|laptop))?)$");
        if (energia.Success && Regex.IsMatch(t, @"\b(?:computadora|compu|pc|equipo|laptop|maquina|ordenador|computer|sesion)\b|^(?:shut down|restart|reboot|log off|sign out)$"))
        {
            var a = energia.Groups["a"].Value;
            var cual = a.StartsWith("apaga") || a.StartsWith("shut") ? "apagar" : a.StartsWith("reinicia") || a is "restart" or "reboot" ? "reiniciar" : a.StartsWith("cierra") || a is "log off" or "sign out" ? "salir" : "suspender";
            return "energia|" + cual;
        }
        if (Brillo.Match(t) is { Success: true } b)
        {
            if (b.Groups["n"].Success) return "brillo|" + Math.Clamp(int.Parse(b.Groups["n"].Value), 0, 100);
            return "brillo|" + (Regex.IsMatch(b.Groups["d"].Value, "^(?:sube|subele|aumenta|mas|turn up|increase|raise)") ? "+" : "-");
        }
        var tema = Regex.Match(t, @"^(?:(?:pon|activa|cambia a|switch to|turn on)\s+(?:el )?)?(?:modo|tema)\s+(?<t>oscuro|claro)$|^(?:(?:switch to|turn on)\s+)?(?<t>dark|light) mode$");
        if (tema.Success) return "tema|" + (tema.Groups["t"].Value is "oscuro" or "dark" ? "oscuro" : "claro");
        return null;
    }

    static readonly Regex PulseLlamar = new(@"^(?:(?:llama(?:le)?|marcale|marca)\s+a|hazle una llamada a|(?:haz|hacer|hazme) una llamada (?:a|con)|call)\s+(?<c>[a-z][a-z .'-]{1,40})$", O);
    static readonly Regex PulseVideo = new(@"^(?:(?:hazle una |haz una |inicia una )?videollamada (?:a|con)|video ?llama(?:le)? a|(?:video ?call|facetime))\s+(?<c>[a-z][a-z .'-]{1,40})$", O);
    static readonly Regex PulseMensaje = new(@"^(?:mandale|enviale|escribele|mandale un mensaje a|enviale un mensaje a|escribele un mensaje a|manda(?:le)? un mensaje a|dile a)\s+(?:a\s+)?(?<c>[a-z][a-z'-]{1,20}(?: [a-z][a-z'-]{1,20})?)\s+(?:que|diciendo que|diciendole que|:)\s+(?<t>.{1,500})$|^(?:text|message|tell)\s+(?<c>[a-z][a-z'-]{1,20})\s+(?:that\s+)?(?<t>.{1,500})$", O);

    /// <summary>«llamada|voz|karla», «llamada|video|karla», «mensaje|karla|ya voy» (el texto como se dijo), o null.</summary>
    /// <summary>
    /// «Mándale 10 ORIGEN a Beto», «envíale 2.5 AUKA a Karla», «send 10 origen to Beto», «pásale a Beto 10 origen».
    /// La cantidad sale del texto original (la normalización parte «2.5» en «2 5»).
    /// </summary>
    static readonly Regex PulsePago = new(@"^(?:mandale|enviale|manda(?:le)?|envia(?:le)?|transfiere(?:le)?|pasale|pagale|deposita(?:le)?|send|transfer|pay)\s+(?:(?<m>\d+(?: \d+)*)\s+(?<s>" + Monedas + @")\s+(?:a|para|to)\s+(?<c>[a-z][a-z'-]{1,20}(?: [a-z][a-z'-]{1,20})?)|(?:a\s+)?(?<c>[a-z][a-z'-]{1,20}(?: [a-z][a-z'-]{1,20})?)\s+(?<m>\d+(?: \d+)*)\s+(?<s>" + Monedas + @"))$", O);

    public static string? Pulse(string texto)
    {
        var t = Limpiar(texto);
        var n = LayaLigera.Normalizar(t);
        if (PulsePago.Match(n) is { Success: true } pg
            && Regex.Match(texto, @"\d[\d.,]*\d|\d") is { Success: true } cifra && CarteraVeta.Monto(cifra.Value.TrimEnd('.', ',')) is { } monto)
        {
            var sim = CarteraVeta.Simbolo(pg.Groups["s"].Value) ?? "ORIGEN";
            return "pago|" + pg.Groups["c"].Value.Trim() + "|" + monto.ToString("0.##################", CultureInfo.InvariantCulture) + "|" + sim;
        }
        if (PulseVideo.Match(n) is { Success: true } v) return "llamada|video|" + v.Groups["c"].Value.Trim();
        if (PulseLlamar.Match(n) is { Success: true } l && !Regex.IsMatch(l.Groups["c"].Value, @"^(?:la atencion|atencion|me|el|la|un|una)\b")) return "llamada|voz|" + l.Groups["c"].Value.Trim();
        if (PulseMensaje.Match(n) is { Success: true } m)
        {
            var dicho = BuscarEnOriginal(texto, m.Groups["t"].Value) ?? m.Groups["t"].Value;
            return "mensaje|" + m.Groups["c"].Value.Trim() + "|" + dicho.Trim();
        }
        return null;
    }

    /// <summary>«Deja de escucharme»: apaga el micrófono (se vuelve a prender con el botón del notch o Ctrl+Alt+Espacio).</summary>
    public static readonly Regex Dormir = new(@"^(?:apagate|apaga(?:te)? el (?:microfono|mic)|deja de escuchar(?:me)?|ya no (?:me )?escuches|no me escuches|silenciate|silencia(?:te)? el microfono|mutea(?:te)? el microfono|duermete|a dormir|desactiva el (?:microfono|mic)|cierra el microfono|stop listening(?: to me)?|mute (?:yourself|the mic|the microphone)|turn off the (?:mic|microphone))$", O);

    static readonly Regex Despertar = new(@"^(?:(?:oye|hey|ey|ok|okay|hola|hi|hello|a ver|mira)\s+)?(?:aura|au ra|laura|a u r a|claudio|antonio|guardian)\b[\s,.:!?]*", O);

    /// <summary>
    /// La frase empieza por el nombre («Oye AURA, abre Excel»): true y lo que sigue sin el nombre («abre Excel»,
    /// o vacío si solo la llamaron). Así «Oye AURA» funciona sin reconocedor de Windows y en una sola frase.
    /// </summary>
    public static bool QuitarNombre(string texto, out string resto)
    {
        resto = texto;
        var n = LayaLigera.Normalizar(texto);
        var m = Despertar.Match(n);
        if (!m.Success) return false;
        // Cuántas palabras del original se comen el saludo y el nombre.
        int palabras = m.Value.Split(' ', StringSplitOptions.RemoveEmptyEntries).Length;
        var originales = texto.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
        resto = string.Join(' ', originales.Skip(palabras)).TrimStart(',', '.', ':', ';', '!', '?', ' ');
        return true;
    }
}
