using System;
using System.Collections.Generic;
using System.Linq;

namespace Aura.Windows.Core;

/// <summary>
/// ¿ESTO ES LO QUE PEDISTE? José (1-oct): «le pedí Bohemian y la puso; luego le pedí The Verve y me volvió a poner
/// Bohemian». En Spotify de escritorio AURA abre la búsqueda y le da al primer botón «Reproducir…» que ve; si la
/// búsqueda nueva aún no cargó, ese botón era el de la búsqueda anterior. Ahora solo cuenta un botón (o lo que suena)
/// que nombre algo de lo pedido: una palabra con sustancia (no «the», «de», «canción», «spotify»…).
/// </summary>
public static class MusicaPedida
{
    static readonly HashSet<string> Vacias = new(StringComparer.Ordinal)
    {
        "the", "and", "los", "las", "del", "con", "una", "uno", "por", "que", "para", "les", "des",
        "cancion", "canciones", "musica", "tema", "temas", "spotify", "youtube", "music", "song", "songs", "pon", "ponme",
        "play", "reproduce", "reproducir", "algo", "favor", "porfa", "disco", "album", "playlist", "lista", "artista", "grupo",
    };

    /// <summary>Las palabras que identifican lo pedido («the verve» → «verve»).</summary>
    public static List<string> Claves(string pedido) =>
        LayaLigera.Normalizar(pedido).Split(' ', StringSplitOptions.RemoveEmptyEntries).Where(w => w.Length >= 3 && !Vacias.Contains(w)).Distinct().ToList();

    /// <summary>¿El texto (un botón «Reproducir X», la canción que suena) nombra lo pedido? Sin claves, no se puede saber: sí.</summary>
    public static bool Menciona(string texto, string pedido)
    {
        var claves = Claves(pedido);
        if (claves.Count == 0) return true;
        var palabras = LayaLigera.Normalizar(texto).Split(' ', StringSplitOptions.RemoveEmptyEntries);
        foreach (var c in claves)
            foreach (var p in palabras)
                if (p == c || (c.Length >= 5 && p.StartsWith(c[..5], StringComparison.Ordinal)) || FiltroAcciones.Parecidas(p, c)) return true;
        return false;
    }
}
