using System.Globalization;
using System.Text.RegularExpressions;

namespace Aura.Windows.Core;

/// <summary>Las manos de AURA en Windows. Son las etiquetas de Laya «windows» (grupo win) sin el prefijo.</summary>
public enum Mano
{
    Ninguna, AbrirApp, AbrirCarpeta, BuscarWeb, AbrirWeb, Escribir, Redactar, VerPantalla, Captura,
    VolumenSubir, VolumenBajar, Silenciar, MultimediaPausa, MultimediaSiguiente, MultimediaAnterior,
    Recordar, Callar, Pausa, AbrirChat, Ocultar, Avatar, Escritorio, Bloquear
}

/// <summary>Lo que se va a hacer: la mano, su parámetro (qué app, qué búsqueda, qué texto…) y de dónde salió.</summary>
public sealed record Pedido(Mano Mano, string Valor = "", TimeSpan? Cuando = null, string Origen = "reglas", double P = 1)
{
    public static readonly Pedido Nada = new(Mano.Ninguna, Origen: "nadie", P: 0);

    /// <summary>Las que tienen efecto fuera de AURA y no se deshacen solas esperan el «sí».</summary>
    public bool PideConfirmacion => Mano is Mano.Escribir or Mano.Bloquear;
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
        "win_escritorio" => Mano.Escritorio, "win_bloquear" => Mano.Bloquear, _ => Mano.Ninguna
    };

    public static Pedido PorReglas(string texto)
    {
        var t = Parametros.Limpiar(texto);
        if (t.Length == 0 || t.Length > 400) return Pedido.Nada;
        if (Parametros.EsNegacion(t)) return Pedido.Nada;
        if (Parametros.Callar.IsMatch(t)) return new(Mano.Callar);
        if (Parametros.PausaTodo.IsMatch(t)) return new(Mano.Pausa);
        if (Parametros.SubirVolumen.IsMatch(t)) return new(Mano.VolumenSubir);
        if (Parametros.BajarVolumen.IsMatch(t)) return new(Mano.VolumenBajar);
        if (Parametros.Mute.IsMatch(t)) return new(Mano.Silenciar);
        if (Parametros.Anterior.IsMatch(t)) return new(Mano.MultimediaAnterior);
        if (Parametros.Siguiente.IsMatch(t)) return new(Mano.MultimediaSiguiente);
        if (Parametros.PlayPausa.IsMatch(t)) return new(Mano.MultimediaPausa);
        if (Parametros.Captura.IsMatch(t)) return new(Mano.Captura);
        if (Parametros.VerPantalla.IsMatch(t)) return new(Mano.VerPantalla);
        if (Parametros.Escritorio.IsMatch(t)) return new(Mano.Escritorio);
        if (Parametros.Bloquear.IsMatch(t)) return new(Mano.Bloquear);
        if (Parametros.Recordatorio.IsMatch(t) && Parametros.Tiempo(t) is { } cuando)
            return new(Mano.Recordar, Parametros.TareaDeRecordatorio(texto), cuando);
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
            case Mano.MultimediaSiguiente:
                return new(Parametros.Anterior.IsMatch(t) ? Mano.MultimediaAnterior : mano, "", null, origen, p);
            default:
                return new(mano, "", null, origen, p);
        }
    }

    /// <summary>La decisión completa. `nodo` es opcional (sin conexión o sin sesión, null).</summary>
    public static async Task<Pedido> Decidir(string texto, Func<string, CancellationToken, Task<DecisionNodo?>>? nodo = null, CancellationToken ct = default)
    {
        var r = PorReglas(texto);
        if (r.Mano != Mano.Ninguna) return r;
        if (Parametros.EsNegacion(Parametros.Limpiar(texto))) return Pedido.Nada;
        var ligera = LayaLigera.Predecir(texto);
        if (ligera.Seguro)
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
    public static readonly Regex Siguiente = new(@"^(?:siguiente (?:cancion|tema|video)|pasa (?:la|esta) cancion|salta (?:esta|la) cancion|cambia (?:de|la) cancion|next (?:song|track)|skip (?:this )?(?:song|track)|skip)$", O);
    public static readonly Regex Anterior = new(@"(?:cancion anterior|tema anterior|previous (?:song|track)|go back a song|la anterior cancion)", O);
    public static readonly Regex PlayPausa = new(@"^(?:pausa (?:la|el) (?:musica|cancion|video|reproduccion)|para la musica|deten (?:la musica|el video)|dale play|ponle play|play|reanuda (?:la musica|el video)|continua (?:la cancion|la musica)|pause (?:the )?(?:music|song|video|playback)|resume (?:the )?(?:music|playback)|hit play)$", O);
    public static readonly Regex Captura = new(@"(?:captura de pantalla|pantallazo|screenshot|screen capture|captura la pantalla|haz una captura|toma una captura|capture the screen)", O);
    public static readonly Regex VerPantalla = new(@"^(?:que ves(?: en (?:mi|la) pantalla)?|mira (?:mi|la) pantalla|lee (?:mi|la) pantalla|que hay en (?:mi|la) pantalla|revisa (?:mi|la) pantalla|analiza (?:mi|la) pantalla|what do you see(?: on (?:my|the) screen)?|look at (?:my|the) screen|read (?:my|the) screen|what is on (?:my|the) screen)$", O);
    public static readonly Regex Escritorio = new(@"^(?:minimiza todo|minimiza todas las ventanas|muestrame el escritorio|ve al escritorio|show (?:the|my) desktop|minimize (?:everything|all windows))$", O);
    public static readonly Regex Bloquear = new(@"^(?:bloquea (?:la computadora|la compu|la pc|la pantalla|el equipo|windows)|lock (?:the|my) (?:computer|pc|screen|workstation))$", O);
    public static readonly Regex Recordatorio = new(@"(?:recuerdame|recordame|avisame|acuerdame|recordatorio|ponme una alarma|pon una alarma|pon una alerta|temporizador|timer|remind me|set a reminder|set an alarm|set a timer|alert me|ping me)", O);
    public static readonly Regex CambioAvatar = new(@"(?:cambia(?:te)?(?: el avatar)? (?:a|por)|ponme a|pasame a|quiero hablar con|que salga|switch to|change (?:the avatar )?to|avatar)", O);
    public static readonly Regex PanelChat = new(@"^(?:el |tu )?(?:chat|panel|conversacion|historial|ventana de aura)$", O);
    static readonly Regex Negacion = new(@"^(?:no|nunca|never|dont|do not|don t)\s+(?!(?:se oye|me oyes))", O);
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

    public static bool EsNegacion(string limpio) => Negacion.IsMatch(limpio) || Pregunta.IsMatch(limpio);

    // Verbos de abrir, con lo que puede venir después («abre el/la/mi…»). En el texto ORIGINAL, sin tildes.
    static readonly Regex Abrir = new(@"^(?:abre(?:me)?|abrime|abri|abrir|inicia|arranca|ejecuta|lanzame|lanza|prende|pon(?:me)?|entra a|metete a|ve a|vamos a|llevame a|muestrame|mostrame|ensename|sacame|open(?: up)?|launch|start|run|fire up|bring up|pull up|go to|take me to|show me|navigate to|visit|load|boot up|head to|get me)\s+(?<o>.+)$", O);
    static readonly Regex Articulo = new(@"^(?:(?:el|la|los|las|mi|mis|un|una|the|my|a|an)\s+)+", O);
    static readonly Regex Programa = new(@"^(?:(?:programa|aplicacion|app|pagina|pagina web|sitio|sitio web|web|carpeta|folder)\s+(?:de\s+|del\s+)?)", O);
    static readonly Regex ColaAbrir = new(@"\s+(?:en (?:el )?(?:navegador|chrome|edge|internet|el explorador|pantalla)|in (?:the )?(?:browser|chrome|explorer)|ahi|there|y (?:despues|luego).*|and (?:then )?.*)$", O);

    public static string? ObjetoDeAbrir(string texto)
    {
        var t = Limpiar(texto);
        var m = Abrir.Match(t);
        if (!m.Success) return null;
        var o = m.Groups["o"].Value.Trim();
        o = ColaAbrir.Replace(o, "").Trim();
        o = Articulo.Replace(o, "").Trim();
        o = Programa.Replace(o, "").Trim();
        o = Articulo.Replace(o, "").Trim();
        if (o.Length < 2 || o.Length > 60 || o.Split(' ').Length > 6) return null;
        // «pon la música»/«ponme a claudio» no son abrir; los decide otra regla o Laya.
        if (Regex.IsMatch(o, @"^(?:musica|cancion|play|pausa|volumen|a\s)")) return null;
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

    static string? BuscarEnOriginal(string original, string normalizado)
    {
        var palabras = original.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        var norm = palabras.Select(LayaLigera.Normalizar).ToArray();
        var objetivo = normalizado.Split(' ');
        for (int i = 0; i + objetivo.Length <= norm.Length; i++)
        {
            if (!objetivo.Select((w, k) => norm[i + k] == w).All(x => x)) continue;
            return string.Join(' ', palabras.Skip(i).Take(objetivo.Length)).Trim(' ', ',', '.', '!', '?', '¿', '¡');
        }
        return null;
    }

    static readonly Regex Escribir = new(@"^(?:escribe(?:me|lo)?|escribi|teclea|dicta|anota|pon|pega|type|write|dictate|enter|key in|put|paste|insert)\b(?:\s+(?:esto|lo que te digo|this|what i say))?(?:\s+(?:en|in|into)\s+(?:el |la |the )?(?:bloc de notas|notepad|word|documento|document|doc|ventana(?: activa)?|active window|window))?(?:\s+(?:donde esta el cursor|where the cursor is))?\s*[:,]?\s*(?<x>.*)$", O);

    /// <summary>El texto literal a escribir, del original. Null: «escríbelo» (se escribe la última respuesta o el borrador).</summary>
    public static string? TextoAEscribir(string texto)
    {
        var dos = texto.IndexOf(':');
        if (dos >= 0 && dos < texto.Length - 1) return texto[(dos + 1)..].Trim();
        var t = Limpiar(texto);
        var m = Escribir.Match(t);
        if (!m.Success) return null;
        var x = m.Groups["x"].Value.Trim();
        x = Regex.Replace(x, @"\s+(?:en|in|into)\s+(?:el |la |the )?(?:bloc de notas|notepad|word|documento|document|ventana)$", "").Trim();
        if (x.Length == 0 || Regex.IsMatch(x, @"^(?:eso|esto|lo|that|it|this)$")) return null;
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
        if (m.Success)
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
        if ((p is "de la tarde" or "de la noche" or "pm") && h < 12) h += 12;
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
}
