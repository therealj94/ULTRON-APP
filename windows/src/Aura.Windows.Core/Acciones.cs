using System;
using System.Collections.Generic;
using System.Text;
using System.Text.RegularExpressions;

namespace Aura.Windows.Core;

/// <summary>
/// Las manos que pide el cerebro. En Windows el cerebro sabe que AURA tiene manos en la PC: cuando la
/// persona pide algo con palabras que las reglas no reconocen («cierra eso de Spotify»), el cerebro
/// contesta corto y agrega una línea «⟦hacer: cierra spotify⟧» con la orden en palabras simples. Este
/// filtro la quita del texto (no se ve ni se dice) mientras llega por trozos y la entrega completa para
/// que las reglas la ejecuten al instante.
/// </summary>
public sealed class FiltroAcciones
{
    const char Abre = '⟦', Cierra = '⟧';
    readonly StringBuilder dentro = new();
    bool abierto;
    public List<string> Ordenes { get; } = new();

    /// <summary>Devuelve la parte del trozo que se puede mostrar y decir; las órdenes completas quedan en <see cref="Ordenes"/>.</summary>
    public string Agregar(string trozo, Action<string>? alCompletar = null)
    {
        var visible = new StringBuilder();
        foreach (var c in trozo)
        {
            if (!abierto)
            {
                if (c == Abre) { abierto = true; dentro.Clear(); }
                else visible.Append(c);
                continue;
            }
            if (c == Cierra)
            {
                abierto = false;
                if (Orden(dentro.ToString()) is { } o) { Ordenes.Add(o); alCompletar?.Invoke(o); }
                dentro.Clear();
            }
            else if (dentro.Length < 300) dentro.Append(c);
        }
        return visible.ToString();
    }

    /// <summary>El texto sin ninguna marca (para el texto final del turno).</summary>
    public static string Quitar(string texto) => Regex.Replace(texto ?? "", @"⟦[^⟧]*⟧?", "").Replace("  ", " ").Trim();

    static readonly HashSet<string> Genericas = new(StringComparer.Ordinal)
    {
        "pon", "ponme", "pone", "abre", "abrir", "abreme", "cierra", "cerrar", "cierrala", "minimiza", "maximiza", "restaura", "cambia", "escribe",
        "busca", "buscar", "toma", "presiona", "sube", "subele", "baja", "bajale", "pausa", "siguiente", "anterior", "reproduce", "toca", "play",
        "open", "close", "put", "search", "type", "press", "turn", "volume", "song", "music", "window", "the", "and", "with",
        "cancion", "canciones", "musica", "tema", "spotify", "youtube", "google", "web", "ventana", "esta", "este", "eso", "app", "aplicacion",
        "volumen", "captura", "pantalla", "configuracion", "modo", "oscuro", "claro", "control", "tecla", "por", "favor", "algo", "sitio",
        "pagina", "una", "uno", "los", "las", "del", "con", "que", "para", "mas", "menos", "todo", "cuanto", "tengo", "origen",
    };

    /// <summary>
    /// ¿La orden del cerebro sale de lo que dijo la persona? El cerebro puede ordenar lo que pediste con otras
    /// palabras («ciérrame eso de Spotify» → «cierra spotify»), pero NO traer cosas que no dijiste: una canción
    /// de antes («pon bachata» → «pon Queen Bohemian Rhapsody»), otra app, otro texto. Toda palabra concreta de
    /// la orden (no un verbo ni «spotify», «ventana»…) tiene que estar en lo que dijiste.
    /// </summary>
    public static bool Coherente(string orden, string dicho)
    {
        var dichas = LayaLigera.Normalizar(dicho).Split(' ', StringSplitOptions.RemoveEmptyEntries);
        foreach (var w in LayaLigera.Normalizar(orden).Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            if (w.Length < 3 || Genericas.Contains(w)) continue;
            var raiz = w.Length > 5 ? w[..5] : w;
            bool esta = false;
            foreach (var d in dichas) if (d.StartsWith(raiz, StringComparison.Ordinal) || w.StartsWith(d.Length > 5 ? d[..5] : d, StringComparison.Ordinal) && d.Length >= 4) { esta = true; break; }
            if (!esta) return false;
        }
        return true;
    }

    /// <summary>«hacer: cierra spotify» → «cierra spotify». Solo órdenes cortas, de una línea.</summary>
    static string? Orden(string marca)
    {
        var m = Regex.Match(marca.Trim(), @"^(?:hacer|do)\s*:\s*(?<o>[^\r\n]{2,160})$", RegexOptions.IgnoreCase);
        return m.Success ? m.Groups["o"].Value.Trim().TrimEnd('.', '!') : null;
    }
}
