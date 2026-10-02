using System;
using System.Collections.Generic;
using System.Linq;

namespace Aura.Windows.Core;

/// <summary>Qué se hace con una orden del cerebro: no hacerla, hacerla o hacerla solo con el «sí».</summary>
public enum Veredicto { Rechazar, Hacer, Confirmar }

/// <summary>La clase de acción de una orden: lo que importa para saber si la persona la pidió.</summary>
public enum ClaseAccion { Ninguna, Abrir, Cerrar, Ventana, Musica, Volumen, Buscar, Escribir, Otra }

/// <summary>
/// La autorización TIPADA de una orden del cerebro («⟦hacer: cierra spotify⟧»). No basta con que las palabras se
/// parezcan: la orden se entiende con las mismas reglas (mano + objetivo), lo que dijo la persona también, y solo
/// pasa si la persona pidió una acción de la MISMA clase («pon música» → Música) y el objetivo de la orden está
/// en lo que dijo (o en sus frases de hace un momento), con tolerancia a lo mal oído («exel» → «excel»).
/// Lo destructivo (cerrar, forzar, escribir, teclas…) que no pediste literalmente espera el «sí».
/// </summary>
public static class AutorizarOrden
{
    /// <summary>Palabras que no nombran un objetivo: verbos, artículos, cortesía y comodines («ventana», «app»).</summary>
    static readonly HashSet<string> NoObjetivo = new(StringComparer.Ordinal)
    {
        // verbos
        "pon", "ponme", "pone", "poner", "abre", "abrir", "abreme", "abrela", "abrelo", "cierra", "cerrar", "cierrala", "cierralo", "cierrame",
        "minimiza", "maximiza", "restaura", "cambia", "cambiate", "escribe", "escribir", "escribeme", "teclea", "busca", "buscar", "buscame",
        "toma", "presiona", "pulsa", "dale", "sube", "subele", "baja", "bajale", "pausa", "pausar", "siguiente", "anterior", "reproduce",
        "reproduceme", "toca", "tocame", "play", "quita", "quitame", "mata", "forza", "fuerza", "termina", "inicia", "lanza", "ejecuta",
        "entra", "muestra", "muestrame", "haz", "hazme", "dame", "open", "close", "put", "search", "type", "press", "turn", "launch",
        "start", "kill", "quit", "switch", "show", "write", "silencia", "mute", "sigue", "salta",
        // palabras de relleno
        "the", "and", "with", "por", "favor", "porfa", "porfavor", "algo", "una", "uno", "unos", "unas", "los", "las", "del", "con", "que",
        "para", "mas", "menos", "todo", "esta", "este", "eso", "esa", "ese", "esto", "aqui", "ahi", "mis", "please", "this", "that", "for",
        "aura", "oye", "hey", "ahora", "rapido", "favorito",
        // comodines (no dicen CUÁL)
        "ventana", "window", "app", "aplicacion", "programa", "pagina", "sitio", "web", "cancion", "canciones", "musica", "tema", "song",
        "music", "volumen", "volume", "captura", "pantalla", "screenshot", "screen",
    };

    /// <summary>En una orden de música, el reproductor no es el objetivo («pon bad bunny en spotify»).</summary>
    static readonly HashSet<string> Reproductores = new(StringComparer.Ordinal) { "spotify", "youtube", "deezer", "apple", "amazon", "tidal", "soundcloud" };

    /// <summary>La clase de una orden ya entendida por las reglas.</summary>
    public static ClaseAccion Clase(Pedido p) => p.Mano switch
    {
        Mano.Ninguna => ClaseAccion.Ninguna,
        Mano.AbrirApp or Mano.AbrirCarpeta or Mano.AbrirWeb or Mano.AbrirArchivo or Mano.Navegador => ClaseAccion.Abrir,
        Mano.Ventana when p.Valor.StartsWith("cerrar", StringComparison.Ordinal) => ClaseAccion.Cerrar,
        Mano.Ventana when p.Valor.StartsWith("cambiar", StringComparison.Ordinal) => ClaseAccion.Abrir,
        Mano.Ventana => ClaseAccion.Ventana,
        Mano.Apps when p.Valor.StartsWith("cerrar", StringComparison.Ordinal) || p.Valor.StartsWith("forzar", StringComparison.Ordinal) => ClaseAccion.Cerrar,
        Mano.Musica or Mano.MultimediaPausa or Mano.MultimediaSiguiente or Mano.MultimediaAnterior => ClaseAccion.Musica,
        Mano.VolumenSubir or Mano.VolumenBajar or Mano.Silenciar or Mano.VolumenA => ClaseAccion.Volumen,
        Mano.BuscarWeb => ClaseAccion.Buscar,
        Mano.Escribir => ClaseAccion.Escribir,
        _ => ClaseAccion.Otra,
    };

    /// <summary>Clases que se reconocen por las palabras de la persona (aunque las reglas no entiendan la frase entera).</summary>
    static IEnumerable<ClaseAccion> ClasesPorPalabras(IEnumerable<string> palabras)
    {
        foreach (var w in palabras)
        {
            if (w.StartsWith("abr", StringComparison.Ordinal) && w != "abril" || w is "open" or "launch" or "inicia" or "iniciar" or "lanza" or "ejecuta" or "entra" or "entrar" or "cambia" or "cambiate" or "switch")
                yield return ClaseAccion.Abrir;
            if (w.StartsWith("cierr", StringComparison.Ordinal) || w.StartsWith("cerr", StringComparison.Ordinal) || w.StartsWith("quit", StringComparison.Ordinal)
                || w is "close" or "mata" or "matar" or "kill" or "forza" or "fuerza" or "forzar" or "termina" or "terminar")
                yield return ClaseAccion.Cerrar;
            if (w.StartsWith("minimiz", StringComparison.Ordinal) || w.StartsWith("maximiz", StringComparison.Ordinal) || w.StartsWith("restaur", StringComparison.Ordinal)
                || w is "minimize" or "maximize" or "restore")
                yield return ClaseAccion.Ventana;
            if (w is "pon" or "ponme" or "pone" or "poner" or "toca" or "tocame" or "play" or "musica" or "music" or "cancion" or "canciones" or "tema" or "song"
                or "pausa" or "pausar" or "siguiente" or "anterior" or "sigue" or "continua" or "reanuda" or "resume" or "next" or "previous" or "skip" or "salta"
                || w.StartsWith("reprodu", StringComparison.Ordinal) || w.StartsWith("escuch", StringComparison.Ordinal))
                yield return ClaseAccion.Musica;
            if (w is "volumen" or "volume" or "sube" or "subele" or "subir" or "baja" or "bajale" or "bajar" or "mute" or "louder" or "quieter" || w.StartsWith("silenci", StringComparison.Ordinal))
                yield return ClaseAccion.Volumen;
            if (w.StartsWith("busc", StringComparison.Ordinal) || w is "search" or "googlea" or "investiga")
                yield return ClaseAccion.Buscar;
            if (w.StartsWith("escrib", StringComparison.Ordinal) || w is "teclea" or "type" or "write" or "dicta")
                yield return ClaseAccion.Escribir;
        }
    }

    /// <summary>¿La palabra `w` (de la orden) está entre las dichas? Igual, mismo comienzo (plurales) o mal oída.</summary>
    static bool Aparece(string w, IEnumerable<string> dichas)
    {
        var raiz = w.Length > 5 ? w[..5] : w;
        foreach (var d in dichas)
            if (d == w || d.StartsWith(raiz, StringComparison.Ordinal) && (w.Length <= 5 || d.Length >= 5)
                || d.Length >= 4 && w.StartsWith(d.Length > 5 ? d[..5] : d, StringComparison.Ordinal) || FiltroAcciones.Parecidas(w, d))
                return true;
        return false;
    }

    static string[] Palabras(string texto) => LayaLigera.Normalizar(texto ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries);

    /// <summary>Las palabras de la orden que nombran su objetivo (la app, la canción, el texto…).</summary>
    public static List<string> Objetivo(string orden, Pedido p)
    {
        var musica = Clase(p) == ClaseAccion.Musica;
        return Palabras(orden).Where(w => w.Length >= 3 && !NoObjetivo.Contains(w) && !(musica && Reproductores.Contains(w))).Distinct().ToList();
    }

    /// <summary>Las clases de acción que expresó la persona: sus reglas, Laya ligera (si está segura) y sus verbos.</summary>
    public static HashSet<ClaseAccion> ClasesPedidas(string dicho)
    {
        var r = new HashSet<ClaseAccion>();
        var pd = Intencion.PorReglas(dicho);
        if (pd.Mano != Mano.Ninguna && pd.Mano != Mano.Varias) r.Add(Clase(pd));
        var ligera = LayaLigera.Predecir(dicho ?? "");
        if (ligera.Seguro && Intencion.DeEtiqueta(ligera.Etiqueta) is var m && m is not (Mano.Ninguna or Mano.Ventana)) r.Add(Clase(new Pedido(m)));
        foreach (var c in ClasesPorPalabras(Palabras(dicho ?? ""))) r.Add(c);
        r.Remove(ClaseAccion.Ninguna);
        return r;
    }

    /// <summary>¿La clase de la orden la pidió la persona? «Otra» exige la misma mano exacta por reglas o Laya.</summary>
    static bool MismaClase(Pedido po, string dicho, HashSet<ClaseAccion> pedidas)
    {
        var c = Clase(po);
        if (c == ClaseAccion.Ninguna) return false;
        if (c != ClaseAccion.Otra) return pedidas.Contains(c);
        var pd = Intencion.PorReglas(dicho);
        if (pd.Mano == po.Mano) return true;
        var ligera = LayaLigera.Predecir(dicho ?? "");
        return ligera.Seguro && Intencion.DeEtiqueta(ligera.Etiqueta) == po.Mano;
    }

    /// <summary>Lo que no se deshace solo (o puede enviar algo) y no debe hacerse sin que lo pidas tal cual.</summary>
    public static bool Destructiva(Pedido p) => Clase(p) is ClaseAccion.Cerrar or ClaseAccion.Escribir
        || p.Mano is Mano.Teclas or Mano.Atajo or Mano.Archivos or Mano.Pulsar or Mano.Bloquear or Mano.Pulse or Mano.Varias;

    /// <summary>¿La persona lo pidió literalmente? Sus palabras, por las reglas, dan la misma mano y el mismo objetivo.</summary>
    public static bool Literal(Pedido po, string dicho)
    {
        var pd = Intencion.PorReglas(dicho);
        if (pd.Mano != po.Mano) return false;
        var a = LayaLigera.Normalizar(po.Valor); var b = LayaLigera.Normalizar(pd.Valor);
        if (a == b) return true;
        var pa = Palabras(po.Valor).Where(w => w.Length >= 3).ToList();
        var pb = Palabras(pd.Valor).Where(w => w.Length >= 3).ToList();
        return pa.Count > 0 && pb.Count > 0 && pa.All(w => Aparece(w, pb)) && pb.All(w => Aparece(w, pa));
    }

    /// <summary>
    /// La decisión. `orden`: lo que pidió el cerebro. `dicho`: lo que dijo la persona en este turno. `contexto`:
    /// sus frases de hace un momento (solo lo que ella dijo, no lo que contestó AURA), donde también puede estar el
    /// objetivo («abre excel» … «ciérralo»). La CLASE de la acción tiene que salir de este turno.
    /// </summary>
    public static Veredicto Autorizar(string orden, string dicho, IEnumerable<string>? contexto = null)
    {
        var po = Intencion.PorReglas(orden ?? "");
        if (po.Mano == Mano.Ninguna || string.IsNullOrWhiteSpace(dicho)) return Veredicto.Rechazar;
        // Dos órdenes en una: cada una tiene que pasar sola.
        if (po.Mano == Mano.Varias)
        {
            var partes = po.Valor.Split(ManosMas.Separador, 2);
            if (partes.Length != 2) return Veredicto.Rechazar;
            var v1 = Autorizar(partes[0], dicho, contexto); var v2 = Autorizar(partes[1], dicho, contexto);
            if (v1 == Veredicto.Rechazar || v2 == Veredicto.Rechazar) return Veredicto.Rechazar;
            return v1 == Veredicto.Confirmar || v2 == Veredicto.Confirmar ? Veredicto.Confirmar : Veredicto.Hacer;
        }
        if (!MismaClase(po, dicho, ClasesPedidas(dicho))) return Veredicto.Rechazar;
        var dichas = Palabras(dicho).ToList();
        if (contexto != null) foreach (var c in contexto.TakeLast(4)) dichas.AddRange(Palabras(c));
        foreach (var w in Objetivo(orden!, po)) if (!Aparece(w, dichas)) return Veredicto.Rechazar;
        // Lo que AURA ya confirma por su cuenta (bloquear, forzar, cerrar todas, vaciar la papelera) no se pregunta dos veces.
        if (Destructiva(po) && !Literal(po, dicho) && !(po.PideConfirmacion && po.Mano != Mano.Escribir)) return Veredicto.Confirmar;
        return Veredicto.Hacer;
    }
}
