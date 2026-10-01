using System.Globalization;
using System.Text.RegularExpressions;

namespace Aura.Windows.Core;

/// <summary>
/// Más manos (2.1): volumen exacto, apps abiertas (listar, cerrar todas las de una, forzar el cierre con «sí»),
/// teclas repetidas, escritorios virtuales, recortes y grabación, carpetas nuevas, papelera (con «sí»),
/// herramientas de Windows, abrir una página en un navegador concreto, copiar el texto de la pantalla,
/// más preguntas al equipo (CPU, RAM, IP, wifi, encendido, versión) y dos órdenes en una frase.
/// Todo por reglas exactas: lo que sale de la voz se valida aquí (números en rango, nombres limpios).
/// </summary>
public static class ManosMas
{
    const RegexOptions O = RegexOptions.Compiled | RegexOptions.CultureInvariant;

    /// <summary>Lo que entienden estas reglas, o null. `t` ya pasó por Parametros.Limpiar; `texto` es el original.</summary>
    public static Pedido? Pedir(string t, string texto)
    {
        if (Volumen(t) is { } v) return new(Mano.VolumenA, v);
        if (InfoMas(t) is { } i) return new(Mano.Info, i);
        if (Apps(t) is { } a) return new(Mano.Apps, a);
        if (TeclasRepetidas(t) is { } r) return new(Mano.Teclas, r);
        foreach (var (frase, combo) in Atajos) if (frase.IsMatch(t)) return new(Mano.Teclas, combo + "|1");
        if (Config(t) is { } c) return new(Mano.Atajo, "config|" + c);
        if (Archivos(t, texto) is { } f) return new(Mano.Archivos, f);
        if (Herramienta(t) is { } h) return new(Mano.Herramienta, h);
        if (Navegador(t, texto) is { } n) return new(Mano.Navegador, n);
        if (CopiarPantalla.IsMatch(t)) return new(Mano.TextoPantalla, "copiar");
        return null;
    }

    // ───────────── volumen exacto ─────────────

    static readonly Dictionary<string, int> Cifras = new()
    {
        ["cero"] = 0, ["diez"] = 10, ["quince"] = 15, ["veinte"] = 20, ["veinticinco"] = 25, ["treinta"] = 30, ["cuarenta"] = 40, ["cincuenta"] = 50,
        ["sesenta"] = 60, ["setenta"] = 70, ["ochenta"] = 80, ["noventa"] = 90, ["cien"] = 100, ["zero"] = 0, ["ten"] = 10, ["fifteen"] = 15,
        ["twenty"] = 20, ["thirty"] = 30, ["forty"] = 40, ["fifty"] = 50, ["sixty"] = 60, ["seventy"] = 70, ["eighty"] = 80, ["ninety"] = 90, ["hundred"] = 100,
        ["maximo"] = 100, ["tope"] = 100, ["max"] = 100, ["maximum"] = 100, ["full"] = 100, ["mitad"] = 50, ["half"] = 50, ["halfway"] = 50,
        ["minimo"] = 10, ["minimum"] = 10,
    };
    static readonly Regex VolumenRe = new(@"^(?:(?:pon(?:le|me)?|sube(?:le)?|baja(?:le)?|ajusta|deja|cambia|set|turn|put|adjust|change|bring)\s+(?:el |la |the )?(?:volumen|volume|sonido|audio)(?:\s+(?:up|down))?|(?:volumen|volume))\s+(?:al?|en|to|at)?\s*(?:la |the |a )?(?<n>\d{1,3}|[a-z]+)(?:\s*(?:%|por ciento|porciento|percent))?$", O);
    static readonly Regex VolumenCuanto = new(@"^(?:(?:a|en) cuanto (?:esta|tengo) el volumen|(?:que|cuanto) volumen tengo|como esta el volumen|(?:what s|whats|what is) the volume(?: at| level)?|how loud is it)$", O);

    /// <summary>«0»…«100», o «?» para decir a cuánto está. Null si no es eso o el número no tiene sentido.</summary>
    public static string? Volumen(string t)
    {
        if (VolumenCuanto.IsMatch(t)) return "?";
        var m = VolumenRe.Match(t);
        if (!m.Success) return null;
        var n = m.Groups["n"].Value;
        int v;
        if (int.TryParse(n, NumberStyles.None, CultureInfo.InvariantCulture, out var d)) v = d;
        else if (!Cifras.TryGetValue(n, out v)) return null;
        return v is >= 0 and <= 100 ? v.ToString(CultureInfo.InvariantCulture) : null;
    }

    // ───────────── más preguntas al equipo ─────────────

    static readonly (Regex Frase, string Que)[] Preguntas =
    {
        (new(@"^(?:(?:cuanto|como (?:va|esta)|que tanto)\s+(?:(?:uso|usa|carga|se usa)\s+(?:de\s+)?)?(?:el |la )?(?:cpu|procesador)(?:\s+.{0,30})?|(?:uso|carga) (?:de )?(?:la |el )?(?:cpu|procesador)|(?:what s|whats|what is|how s|how is) (?:the |my )?(?:cpu|processor)(?: usage| load| doing)?|(?:cpu|processor) (?:usage|load))$", O), "cpu"),
        (new(@"^(?:(?:cuanta|cuanto|como (?:va|esta)|que tanta)\s+(?:(?:uso|usa|carga|se usa)\s+(?:de\s+)?)?(?:la |el )?(?:memoria(?: ram)?|ram)(?:\s+.{0,30})?|(?:uso de )?(?:la )?memoria ram|uso de (?:la )?memoria|(?:how much|what s my|whats my|what is my) (?:ram|memory)(?:\s+.{0,30})?|(?:ram|memory) usage)$", O), "memoria"),
        (new(@"^(?:cual es mi (?:direccion )?ip(?: local)?|dime mi (?:direccion )?ip(?: local)?|(?:que|cual) ip tengo|mi (?:direccion )?ip|(?:what s|whats|what is) my (?:local )?ip(?: address)?|my ip(?: address)?)$", O), "ip"),
        (new(@"^(?:cuanto tiempo (?:lleva|tiene|ha estado|esta) (?:encendid[ao]|prendid[ao])(?: (?:la|el|mi) (?:compu|computadora|pc|equipo|laptop))?|hace cuanto (?:prendi|encendi|arranque|reinicie)(?: (?:la|el|mi) (?:compu|computadora|pc|equipo|laptop))?|how long has (?:my |the |this )?(?:pc|computer|laptop) been (?:on|running|up)|(?:system )?uptime)$", O), "encendido"),
        (new(@"^(?:que (?:version de )?windows tengo|que version de windows es(?: esta)?|cual es mi version de windows|(?:what|which) (?:version of )?windows (?:do i have|is this|am i (?:on|running))|windows version)$", O), "version"),
        (new(@"^(?:a que (?:wifi|wi fi|red(?: wifi)?) estoy conectad[oa]|en que (?:wifi|wi fi|red) estoy|(?:como se llama|cual es) (?:mi |el |la |esta )?(?:wifi|wi fi|red wifi|red)(?: a la que estoy conectad[oa])?|(?:what|which) (?:wifi|wi fi|network) am i (?:connected to|on)|(?:what s|whats|what is) my (?:wifi|wi fi)(?: name| network)?)$", O), "wifi"),
    };

    /// <summary>cpu | memoria | ip | encendido | version | wifi, o null (lo demás lo contesta Parametros.Info).</summary>
    public static string? InfoMas(string t)
    {
        foreach (var (frase, que) in Preguntas) if (frase.IsMatch(t)) return que;
        return null;
    }

    // ───────────── apps abiertas ─────────────

    static readonly Regex AppsLista = new(@"^(?:que (?:tengo abierto|hay abierto|esta abierto|(?:apps?|aplicaciones|programas|ventanas) (?:tengo abiert[oa]s|hay abiert[oa]s|estan abiert[oa]s))|(?:dime|lista|listame|muestrame|enumera|leeme) (?:las |los |mis )?(?:ventanas|apps|aplicaciones|programas) (?:abiert[oa]s|que tengo abiert[oa]s)|(?:what s|whats|what is) open|what (?:apps|windows|programs) (?:are|do i have) open|(?:list|show) (?:me )?(?:my |the )?open (?:apps|windows|programs))$", O);
    static readonly Regex CerrarTodo = new(@"^(?:(?:cierra|cerra|cierrame)\s+(?:todo|todas las ventanas|todas las apps|todos los programas|todas las aplicaciones)|close (?:everything|all windows|all apps|all programs|all the windows))$", O);
    static readonly Regex CerrarTodas = new(@"^(?:(?:cierra|cerra|cierrame)\s+(?:todas las ventanas de(?:l)?|todas las de(?:l)?|todos los|todas las)\s+(?<o>[a-z0-9][a-z0-9 .+-]{1,30}?)|close all(?: the)?(?: windows of| of)?\s+(?<o>[a-z0-9][a-z0-9 .+-]{1,30}?)(?:\s+windows)?)$", O);
    static readonly Regex Forzar = new(@"^(?:(?:cierra|cerra|termina|finaliza|close|quit)\s+(?:a la fuerza|forzosamente|forzado|por la fuerza)\s+(?:a\s+)?(?:el |la |the )?(?<o>[a-z0-9][a-z0-9 .+-]{1,30})|(?:cierra|cerra|close|quit)\s+(?:el |la |the )?(?<o>[a-z0-9][a-z0-9 .+-]{1,30}?)\s+(?:a la fuerza|forzosamente|por la fuerza|by force|forcefully)|(?:forza|fuerza|forzar|force)\s+(?:el )?(?:cierre|close|quit)\s+(?:de(?:l)?\s+|of\s+)?(?:la |el |the )?(?<o>[a-z0-9][a-z0-9 .+-]{1,30})|(?:mata(?:me)?|kill|force quit|force close|end task(?: for| of)?|finaliza la tarea de|termina el proceso de|mata el proceso de)\s+(?:el |la |the )?(?:proceso de |process |app |programa )?(?<o>[a-z0-9][a-z0-9 .+-]{1,30}))$", O);
    static readonly Regex NoEsApp = new(@"^(?:eso|esto|todo|pestanas|tabs|las pestanas|el tiempo|la musica|el sonido|el audio|la cancion|it|that|this|everything|time|the music)$", O);

    /// <summary>«lista», «cerrar-todas|» (todas las ventanas, con «sí»), «cerrar-todas|excel» o «forzar|chrome» (con «sí»).</summary>
    public static string? Apps(string t)
    {
        if (AppsLista.IsMatch(t)) return "lista";
        if (CerrarTodo.IsMatch(t)) return "cerrar-todas|";
        if (Forzar.Match(t) is { Success: true } f && NombreApp(f.Groups["o"].Value) is { } fo) return "forzar|" + fo;
        if (CerrarTodas.Match(t) is { Success: true } c && NombreApp(c.Groups["o"].Value) is { } co && co is not ("ventanas" or "windows" or "apps" or "programas")) return "cerrar-todas|" + co;
        return null;
    }

    /// <summary>Un nombre de app dicho: letras, números y poco más; hasta 3 palabras. Null si no sirve.</summary>
    public static string? NombreApp(string dicho)
    {
        var o = Regex.Replace(LayaLigera.Normalizar(dicho), @"^(?:(?:el|la|los|las|the|app|programa|aplicacion)\s+)+", "").Trim();
        o = Regex.Replace(o, @"\s+(?:app|windows|ventanas)$", "").Trim();
        if (o.Length is < 2 or > 30 || o.Split(' ').Length > 3 || NoEsApp.IsMatch(o)) return null;
        return Regex.IsMatch(o, @"^[a-z0-9][a-z0-9 .+-]*$") ? o : null;
    }

    /// <summary>Procesos que AURA nunca cierra a la fuerza: Windows mismo (y su escritorio).</summary>
    public static readonly HashSet<string> ProcesosProtegidos = new(StringComparer.OrdinalIgnoreCase)
    {
        "system", "idle", "csrss", "smss", "wininit", "winlogon", "services", "lsass", "lsaiso", "svchost", "dwm", "explorer", "fontdrvhost",
        "sihost", "ctfmon", "conhost", "registry", "memory compression", "secure system", "taskhostw", "runtimebroker", "searchhost",
        "startmenuexperiencehost", "shellexperiencehost", "textinputhost", "audiodg", "spoolsv", "msmpeng", "securityhealthservice", "aura", "aura.windows",
    };

    // ───────────── teclas: repetidas y atajos de Windows ─────────────

    static readonly Dictionary<string, int> Veces = new()
    {
        ["dos"] = 2, ["tres"] = 3, ["cuatro"] = 4, ["cinco"] = 5, ["seis"] = 6, ["siete"] = 7, ["ocho"] = 8, ["nueve"] = 9, ["diez"] = 10,
        ["two"] = 2, ["three"] = 3, ["four"] = 4, ["five"] = 5, ["six"] = 6, ["seven"] = 7, ["eight"] = 8, ["nine"] = 9, ["ten"] = 10, ["twice"] = 2, ["thrice"] = 3,
    };
    static readonly Regex Repetir = new(@"^(?:presiona|pulsa|oprime|aprieta|dale(?: a)?|press|hit|tap)\s+(?:la tecla |the key |el )?(?<k>[a-z0-9 ]{1,30}?)\s+(?:(?<n>\d{1,2}|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|two|three|four|five|six|seven|eight|nine|ten)\s+(?:veces|times)|(?<n>twice|thrice))$", O);

    /// <summary>«presiona tab tres veces» → «TAB|3». Hasta 20 veces; las combinaciones peligrosas no (TeclasDe).</summary>
    public static string? TeclasRepetidas(string t)
    {
        var m = Repetir.Match(t);
        if (!m.Success) return null;
        var ns = m.Groups["n"].Value;
        if (!int.TryParse(ns, NumberStyles.None, CultureInfo.InvariantCulture, out var n) && !Veces.TryGetValue(ns, out n)) return null;
        if (n is < 1 or > 20) return null;
        var combo = Parametros.TeclasDe(m.Groups["k"].Value);
        return combo == null ? null : combo + "|" + n.ToString(CultureInfo.InvariantCulture);
    }

    /// <summary>Atajos de Windows y del navegador que no estaban: escritorios virtuales, monitores, recortes, emojis…</summary>
    static readonly (Regex Frase, string Teclas)[] Atajos =
    {
        (new(@"^(?:(?:crea(?:me)?|abre(?:me)?|haz(?:me)?|agrega|anade)\s+(?:un |otro )?(?:nuevo )?escritorio virtual(?: nuevo)?|(?:crea(?:me)?|agrega|anade)\s+(?:un |otro )?(?:nuevo )?escritorio(?: nuevo)?|nuevo escritorio(?: virtual)?|(?:create|open|add) (?:a |another )?new (?:virtual )?desktop|new (?:virtual )?desktop)$", O), "CTRL+WIN+D"),
        (new(@"^(?:(?:ve|pasa(?:me)?|cambia(?:te)?|muevete|vete|llevame)\s+al?\s+(?:siguiente escritorio|escritorio (?:siguiente|de la derecha))|siguiente escritorio(?: virtual)?|(?:go to |switch to )?(?:the )?next (?:virtual )?desktop)$", O), "CTRL+WIN+RIGHT"),
        (new(@"^(?:(?:ve|pasa(?:me)?|cambia(?:te)?|muevete|vete|regresa|vuelve|llevame)\s+al?\s+(?:escritorio (?:anterior|de la izquierda))|escritorio (?:virtual )?anterior|(?:go to |switch to |go back to )?(?:the )?previous (?:virtual )?desktop)$", O), "CTRL+WIN+LEFT"),
        (new(@"^(?:cierra (?:este |el )?escritorio virtual|cierra este escritorio|close (?:this |the )?virtual desktop|close this desktop)$", O), "CTRL+WIN+F4"),
        (new(@"^(?:(?:mueve|pasa|manda|lleva|pon)(?:la|lo)?\s+(?:la |esta )?(?:ventana\s+)?(?:a|al|en)\s+(?:la |el )?(?:otra pantalla|otro monitor|segunda pantalla|segundo monitor|pantalla de la derecha|monitor de la derecha)|move (?:the |this )?window to (?:the )?(?:other|next|second|right) (?:monitor|screen|display))$", O), "WIN+SHIFT+RIGHT"),
        (new(@"^(?:(?:mueve|pasa|manda|lleva|pon)(?:la|lo)?\s+(?:la |esta )?(?:ventana\s+)?(?:a|al|en)\s+(?:la |el )?(?:pantalla de la izquierda|monitor de la izquierda|primera pantalla|primer monitor|pantalla principal|monitor principal)|move (?:the |this )?window to (?:the )?(?:left|first|main|primary) (?:monitor|screen|display))$", O), "WIN+SHIFT+LEFT"),
        (new(@"^(?:(?:haz|toma|saca)(?:me|le)?\s+(?:un |una )?(?:recorte(?: de pantalla)?|captura de (?:una parte|un area|una region|una zona|un pedazo|parte)(?: de la pantalla)?)|recorta (?:la pantalla|una parte de la pantalla|un pedazo de la pantalla)|recorte de pantalla|(?:take |make )?(?:a )?(?:screen snip|partial screenshot)|(?:take a )?screenshot of (?:a |an )?(?:region|area|part of the screen)|snip(?: the screen)?)$", O), "WIN+SHIFT+S"),
        (new(@"^(?:(?:graba(?:me)?|empieza a grabar|comienza a grabar|inicia (?:la )?grabacion de)\s+(?:la |mi |esta )?(?:pantalla|ventana)|deja de grabar(?: la pantalla)?|(?:para|deten|termina) la grabacion|(?:record|start recording) (?:the |my |this )?(?:screen|window)|stop (?:the )?(?:screen )?recording)$", O), "WIN+ALT+R"),
        (new(@"^(?:(?:abre|muestrame|ensename)\s+(?:el )?historial del portapapeles|historial del portapapeles|(?:open |show )?(?:me )?(?:the |my )?clipboard history)$", O), "WIN+V"),
        (new(@"^(?:(?:abre|muestrame|ensename|pon)\s+(?:el |los )?(?:panel de |teclado de |selector de )?emojis?|panel de emojis?|(?:open (?:the )?)?emoji (?:panel|picker|keyboard))$", O), "WIN+PERIOD"),
        (new(@"^(?:(?:abre|muestrame|ensename)\s+(?:el )?(?:centro de notificaciones|centro de actividades)|centro de notificaciones|open (?:the )?(?:notification|action) center)$", O), "WIN+N"),
        (new(@"^(?:(?:abre|muestrame)\s+(?:la |las )?(?:configuracion rapida|configuraciones rapidas|ajustes rapidos)|configuracion rapida|ajustes rapidos|(?:open )?(?:the )?quick settings)$", O), "WIN+A"),
        (new(@"^(?:abre (?:la )?busqueda de windows|busca en windows|abre el buscador de windows|(?:open )?windows search)$", O), "WIN+S"),
        (new(@"^(?:(?:abre|abreme)\s+(?:una )?(?:ventana|pestana) (?:de )?(?:incognito|privada)|modo incognito|(?:open (?:an? |a new )?)?(?:incognito|private|inprivate) (?:window|tab)|go incognito)$", O), "CTRL+SHIFT+N"),
        (new(@"^(?:(?:abre|abreme)\s+(?:una )?(?:ventana nueva|nueva ventana)|nueva ventana|(?:open (?:a )?)?new window)$", O), "CTRL+N"),
        (new(@"^(?:agrega(?:lo|la)? a (?:favoritos|marcadores)|guarda(?:la)? (?:en|la pagina en) (?:favoritos|marcadores)|(?:pon|agrega) (?:esta pagina )?en favoritos|bookmark(?: this| it| this page)?|add (?:this )?to (?:bookmarks|favorites))$", O), "CTRL+D"),
        (new(@"^(?:(?:abre|muestrame) el historial(?: del navegador| de navegacion)?|historial del navegador|(?:open|show) (?:me )?(?:the |my )?(?:browser )?history)$", O), "CTRL+H"),
        (new(@"^(?:(?:abre|muestrame) el explorador de archivos en (?:otra|una nueva) ventana|explorador nuevo)$", O), "WIN+E"),
    };

    static readonly Dictionary<string, (string Es, string En)> NombresTeclas = new()
    {
        ["CTRL+WIN+D"] = ("Escritorio virtual nuevo", "New virtual desktop"), ["CTRL+WIN+RIGHT"] = ("Siguiente escritorio", "Next desktop"),
        ["CTRL+WIN+LEFT"] = ("Escritorio anterior", "Previous desktop"), ["CTRL+WIN+F4"] = ("Escritorio virtual cerrado", "Virtual desktop closed"),
        ["WIN+SHIFT+RIGHT"] = ("Ventana al otro monitor", "Window to the other monitor"), ["WIN+SHIFT+LEFT"] = ("Ventana al otro monitor", "Window to the other monitor"),
        ["WIN+SHIFT+S"] = ("Elige el área a recortar", "Pick the area to snip"), ["WIN+ALT+R"] = ("Grabación de pantalla (Xbox Game Bar)", "Screen recording (Xbox Game Bar)"),
        ["WIN+V"] = ("Historial del portapapeles", "Clipboard history"), ["WIN+PERIOD"] = ("Emojis", "Emoji"), ["WIN+N"] = ("Notificaciones", "Notifications"),
        ["WIN+A"] = ("Configuración rápida", "Quick settings"), ["WIN+S"] = ("Búsqueda de Windows", "Windows search"), ["CTRL+SHIFT+N"] = ("Ventana de incógnito", "Incognito window"),
        ["CTRL+N"] = ("Ventana nueva", "New window"), ["CTRL+D"] = ("Agregado a favoritos", "Bookmarked"), ["CTRL+H"] = ("Historial", "History"), ["WIN+E"] = ("Explorador de archivos", "File Explorer"),
    };

    /// <summary>Lo que se muestra en el notch al apretar `combo` (o la combinación tal cual).</summary>
    public static string NombreTeclas(string combo, int veces, bool ingles)
    {
        var n = NombresTeclas.TryGetValue(combo, out var x) ? (ingles ? x.En : x.Es) : combo.Replace("+", " + ");
        return veces > 1 ? $"{n} × {veces}" : n;
    }

    // ───────────── Configuración de Windows que faltaba ─────────────

    static readonly (Regex Frase, string Pagina)[] Paginas =
    {
        (new(@"^(?:(?:activa|desactiva|prende|apaga|enciende|pon|quita|abre)\s+(?:la |el )?(?:luz nocturna|modo nocturno|filtro de luz azul)|luz nocturna|(?:turn on |turn off |enable |disable |open )?(?:the )?night light)$", O), "nightlight"),
        (new(@"^(?:(?:activa|desactiva|prende|apaga|pon|quita)\s+(?:el )?(?:modo )?(?:no molestar|concentracion|asistente de concentracion)|(?:modo )?no molestar|(?:turn on |turn off |enable |disable )?(?:do not disturb|focus assist|focus mode))$", O), "quiethours"),
        (new(@"^(?:(?:activa|desactiva|prende|apaga|abre)\s+(?:la |el )?(?:zona wifi|punto de acceso|hotspot|zona con cobertura inalambrica)(?: movil)?|(?:turn on |turn off |open )?(?:the )?(?:mobile )?hotspot)$", O), "network-mobilehotspot"),
        (new(@"^(?:(?:abre|activa|desactiva|conecta|desconecta)\s+(?:la |el )?vpn|(?:open |connect |disconnect )?(?:the )?vpn(?: settings)?)$", O), "network-vpn"),
        (new(@"^(?:(?:abre|cambia|muestrame)\s+(?:las )?(?:apps|aplicaciones) (?:predeterminadas|por defecto)|(?:open |change )?(?:the )?default apps)$", O), "defaultapps"),
        (new(@"^(?:(?:abre|muestrame|cambia)\s+(?:las )?(?:apps|aplicaciones|programas) (?:de inicio|que arrancan con windows|que inician con windows)|(?:open )?startup apps)$", O), "startupapps"),
        (new(@"^(?:(?:abre|muestrame)\s+(?:la )?informacion (?:de (?:la|mi) (?:compu|computadora|pc)|del equipo)|(?:open )?about (?:this|my) pc)$", O), "about"),
        (new(@"^(?:(?:abre|muestrame)\s+(?:el )?solucionador de problemas|(?:open )?(?:the )?troubleshooter)$", O), "troubleshoot"),
        (new(@"^(?:(?:abre|cambia)\s+(?:las )?opciones de inicio de sesion|(?:open )?sign in options)$", O), "signinoptions"),
    };

    /// <summary>La página de Configuración (ms-settings:…) para lo que Windows no deja cambiar directamente sin riesgo.</summary>
    public static string? Config(string t)
    {
        foreach (var (frase, pagina) in Paginas) if (frase.IsMatch(t)) return pagina;
        return null;
    }

    // ───────────── archivos y carpetas ─────────────

    static readonly string Lugares = "escritorio|documentos|descargas|imagenes|musica|videos|onedrive|desktop|documents|downloads|pictures|music";
    static readonly Regex CrearCarpeta = new(@"^(?:crea(?:me)?|haz(?:me)?|crear|create|make)\s+(?:(?:una|un|a)\s+)?(?:nueva\s+|new\s+)?(?:carpeta|folder)(?:\s+nueva)?\s+(?:(?:llamada|que se llame|con el nombre(?: de)?|de nombre|called|named)\s+)?(?<n>.+?)(?:\s+(?:en|on|in)\s+(?:(?:el|la|mis|mi|the|my)\s+)?(?:carpeta (?:de )?)?(?<d>" + Lugares + @")(?:\s+folder)?)?$", O);
    static readonly Regex CrearCarpetaEn = new(@"^(?:crea(?:me)?|haz(?:me)?|crear|create|make)\s+(?:(?:una|un|a)\s+)?(?:nueva\s+|new\s+)?(?:carpeta|folder)(?:\s+nueva)?\s+(?:en|on|in)\s+(?:(?:el|la|mis|mi|the|my)\s+)?(?<d>" + Lugares + @")\s+(?:llamada|que se llame|con el nombre(?: de)?|called|named)\s+(?<n>.+)$", O);
    static readonly Regex VaciarPapelera = new(@"^(?:vacia(?:me)?|limpia|vaciar|empty|clear)\s+(?:la |mi |the |my )?(?:papelera(?: de reciclaje)?|recycle bin|trash)$", O);
    static readonly Regex DondeArchivo = new(@"^(?:donde (?:esta|quedo|guarde)|muestrame donde esta|ensename donde esta|en que carpeta esta|where is|where s|show me where)\s+(?:el |mi |la |the |my )?(?:archivo|documento|file|document)\s+(?:de |del |que se llama |llamado |called |named )?(?<o>.+?)(?:\s+is)?$", O);
    static readonly Regex Descargas = new(@"^(?:que (?:descargue|he descargado|baje|he bajado)(?: hoy| ultimamente| recientemente)?|(?:muestrame|dime|leeme|lista(?:me)?)\s+(?:mis |las )?(?:descargas recientes|ultimas descargas)|what did i (?:just )?download|(?:show|list|read) (?:me )?(?:my )?(?:recent|latest) downloads)$", O);

    /// <summary>«carpeta|escritorio|Proyectos», «vaciar-papelera» (con «sí»), «mostrar|contrato» o «descargas-recientes».</summary>
    public static string? Archivos(string t, string texto)
    {
        if (VaciarPapelera.IsMatch(t)) return "vaciar-papelera";
        if (Descargas.IsMatch(t)) return "descargas-recientes";
        var c = CrearCarpetaEn.Match(t);
        if (!c.Success) c = CrearCarpeta.Match(t);
        if (c.Success)
        {
            var n = c.Groups["n"].Value.Trim();
            // «crea una carpeta en el escritorio» sin nombre, o «crea una carpeta nueva»: que lo diga el cerebro.
            if (Regex.IsMatch(n, @"^(?:(?:en|on|in)\s|(?:nueva|new|aqui|here)$)")) return null;
            var original = Parametros.BuscarEnOriginal(texto, n) ?? n;
            var nombre = NombreCarpetaSeguro(original);
            if (nombre == null) return null;
            var lugar = c.Groups["d"].Success ? Parametros.Carpeta(c.Groups["d"].Value) ?? "escritorio" : "escritorio";
            return "carpeta|" + lugar + "|" + nombre;
        }
        if (DondeArchivo.Match(t) is { Success: true } d)
        {
            var o = d.Groups["o"].Value.Trim();
            if (o.Length is >= 2 and <= 80) return "mostrar|" + (Parametros.BuscarEnOriginal(texto, o) ?? o);
        }
        return null;
    }

    static readonly Regex Reservados = new(@"^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    /// <summary>
    /// Un nombre de carpeta que no se sale de su lugar: sin separadores ni «..», sin caracteres que Windows no
    /// acepta, sin nombres reservados (CON, NUL…), sin puntos o espacios al final y de 1 a 60 letras. Null si no queda nada.
    /// </summary>
    public static string? NombreCarpetaSeguro(string dicho)
    {
        var s = (dicho ?? "").Trim().Trim('«', '»', '"', '\'', '“', '”');
        if (s.Contains("..")) return null;
        var sb = new System.Text.StringBuilder(s.Length);
        foreach (var ch in s) if (ch >= 32 && "<>:\"/\\|?*".IndexOf(ch) < 0) sb.Append(ch);
        s = Regex.Replace(sb.ToString(), @"\s+", " ").Trim().TrimEnd('.', ' ');
        if (s.Length is 0 or > 60 || s is "." || Reservados.IsMatch(s)) return null;
        return s;
    }

    // ───────────── herramientas de Windows ─────────────

    /// <summary>Herramientas del sistema: lo dicho → (clave, lo que se abre, nombre). Comandos fijos: nada de la voz llega a ellos.</summary>
    public static readonly IReadOnlyList<(string[] Dichos, string Clave, string Abrir, string Es, string En)> Herramientas = new (string[], string, string, string, string)[]
    {
        (new[] { "administrador de dispositivos", "device manager" }, "dispositivos", "devmgmt.msc", "Administrador de dispositivos", "Device Manager"),
        (new[] { "administracion de discos", "administrador de discos", "disk management" }, "discos", "diskmgmt.msc", "Administración de discos", "Disk Management"),
        (new[] { "liberador de espacio", "liberador de espacio en disco", "limpieza de disco", "disk cleanup" }, "limpieza", "cleanmgr.exe", "Liberador de espacio", "Disk Cleanup"),
        (new[] { "informacion del sistema", "system information" }, "msinfo", "msinfo32.exe", "Información del sistema", "System Information"),
        (new[] { "monitor de recursos", "resource monitor" }, "recursos", "resmon.exe", "Monitor de recursos", "Resource Monitor"),
        (new[] { "monitor de rendimiento", "performance monitor" }, "rendimiento", "perfmon.exe", "Monitor de rendimiento", "Performance Monitor"),
        (new[] { "visor de eventos", "event viewer" }, "eventos", "eventvwr.msc", "Visor de eventos", "Event Viewer"),
        (new[] { "servicios de windows", "windows services" }, "servicios", "services.msc", "Servicios", "Services"),
        (new[] { "teclado en pantalla", "teclado virtual", "on screen keyboard" }, "osk", "osk.exe", "Teclado en pantalla", "On-Screen Keyboard"),
        (new[] { "lupa", "lupa de windows", "magnifier" }, "lupa", "magnify.exe", "Lupa", "Magnifier"),
        (new[] { "conexiones de red", "adaptadores de red", "network connections", "network adapters" }, "adaptadores", "ncpa.cpl", "Conexiones de red", "Network Connections"),
        (new[] { "programas y caracteristicas", "desinstalar programas", "desinstalar un programa", "uninstall a program", "programs and features" }, "programas", "appwiz.cpl", "Programas y características", "Programs and Features"),
        (new[] { "opciones de energia", "power options" }, "energia", "powercfg.cpl", "Opciones de energía", "Power Options"),
        (new[] { "propiedades del sistema", "system properties" }, "sistema", "sysdm.cpl", "Propiedades del sistema", "System Properties"),
        (new[] { "dispositivos de sonido", "panel de sonido", "sound control panel" }, "sonido", "mmsys.cpl", "Sonido", "Sound"),
    };
    static readonly Regex AbrirHerramienta = new(@"^(?:abre(?:me)?|abrime|inicia|ejecuta|lanza|muestrame|ve a|open|launch|start|run|show me|go to|bring up)\s+(?:(?:el|la|los|las|the|my)\s+)?(?<o>.{3,50})$", O);

    /// <summary>La clave de la herramienta («dispositivos», «limpieza»…), o null.</summary>
    public static string? Herramienta(string t)
    {
        var m = AbrirHerramienta.Match(t);
        if (!m.Success) return null;
        var o = m.Groups["o"].Value.Trim();
        foreach (var h in Herramientas) if (h.Dichos.Contains(o)) return h.Clave;
        return null;
    }

    // ───────────── una página en un navegador concreto ─────────────

    /// <summary>Navegadores que se pueden pedir por nombre → su programa (registrado en App Paths por su instalador).</summary>
    public static readonly IReadOnlyDictionary<string, string> Navegadores = new Dictionary<string, string>
    {
        ["chrome"] = "chrome.exe", ["google chrome"] = "chrome.exe", ["edge"] = "msedge.exe", ["microsoft edge"] = "msedge.exe",
        ["firefox"] = "firefox.exe", ["brave"] = "brave.exe", ["opera"] = "opera.exe",
    };
    static readonly Regex AbrirEn = new(@"^(?:abre(?:me)?|abrime|open|entra a|ve a|go to|visit|load)\s+(?<o>.+?)\s+(?:en|in|con|with|using)\s+(?:el |the )?(?<b>google chrome|chrome|microsoft edge|edge|firefox|brave|opera)$", O);

    /// <summary>«chrome.exe|https://www.youtube.com», o null (solo HTTPS seguro, y solo navegadores conocidos).</summary>
    public static string? Navegador(string t, string texto)
    {
        var m = AbrirEn.Match(t);
        if (!m.Success) return null;
        var o = m.Groups["o"].Value.Trim();
        var url = Parametros.DominioEn(texto) ?? Parametros.Sitio(o);
        if (url == null || !Commands.SafeHttps(url)) return null;
        return Navegadores[m.Groups["b"].Value] + "|" + url;
    }

    // ───────────── el texto de la pantalla al portapapeles ─────────────

    static readonly Regex CopiarPantalla = new(@"^(?:copia(?:me)? (?:el |todo el )?texto (?:de (?:la|esta|mi) (?:pantalla|ventana)|que (?:hay|ves|sale) en (?:la |mi )?pantalla)|copy (?:the |all the )?text (?:from|on) (?:the |this |my )?(?:screen|window))$", O);

    // ───────────── dos órdenes en una frase ─────────────

    static readonly Regex Union = new(@"(?:\s*,\s*|\s+)(?:y\s+(?:luego|despu[eé]s|tambi[eé]n|ya)|y|and\s+then|and|luego|despu[eé]s|then)\s+", RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);
    /// <summary>La primera de dos órdenes no puede llevar texto libre (lo que se escribe o se manda puede tener «y»).</summary>
    static readonly HashSet<Mano> NoVanPrimero = new() { Mano.Escribir, Mano.Redactar, Mano.Pulse, Mano.Recordar, Mano.Portapapeles, Mano.VerPantalla, Mano.Varias };
    static readonly HashSet<Mano> NoVanSegundo = new() { Mano.Redactar, Mano.Portapapeles, Mano.VerPantalla, Mano.Varias };
    /// <summary>El separador de las órdenes en el valor de Mano.Varias.</summary>
    public const char Separador = '\u001F';

    /// <summary>
    /// «abre el bloc de notas y escribe hola»: dos órdenes que las reglas entienden SOLAS, una tras otra (cada una
    /// con sus confirmaciones). «abre word y excel»: la segunda hereda el «abre» si es algo conocido. Null si no.
    /// </summary>
    public static Pedido? Encadenadas(string texto, Func<string, Pedido> una)
    {
        if (texto.Length > 300) return null;
        foreach (Match m in Union.Matches(texto))
        {
            var izq = texto[..m.Index].Trim(' ', ',', '.');
            var der = texto[(m.Index + m.Length)..].Trim(' ', ',', '.', '!', '?');
            if (izq.Length < 3 || der.Length < 2) continue;
            var a = una(izq);
            if (a.Mano == Mano.Ninguna || NoVanPrimero.Contains(a.Mano)) continue;
            var b = una(der);
            if (b.Mano == Mano.Ninguna && a.Mano is Mano.AbrirApp or Mano.AbrirWeb or Mano.AbrirCarpeta && der.Split(' ', StringSplitOptions.RemoveEmptyEntries).Length <= 4)
            {
                var o = LayaLigera.Normalizar(Regex.Replace(der, @"^(?:el|la|los|las|the|my|mi)\s+", "", RegexOptions.IgnoreCase));
                if (Parametros.EsAppConocida(o) || Parametros.Carpeta(o) != null || Parametros.Sitio(o) != null)
                {
                    der = "abre " + der;
                    b = una(der);
                }
            }
            if (b.Mano == Mano.Ninguna || NoVanSegundo.Contains(b.Mano)) continue;
            return new Pedido(Mano.Varias, izq + Separador + der);
        }
        return null;
    }
}
