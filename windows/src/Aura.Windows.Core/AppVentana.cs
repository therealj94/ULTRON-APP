using System;
using System.Collections.Generic;
using System.Linq;

namespace Aura.Windows.Core;

/// <summary>
/// ¿Esta ventana es de la app que se pidió abrir? (Codex en #112: antes contaba cualquier ventana nueva, y si
/// en esos segundos aparecía otra cosa, AURA decía que Excel había abierto sin que abriera.) Cuenta por el
/// programa (winword, powerpnt, msedge…) o por el título («Libro1 - Excel», «Configuración»).
/// </summary>
public static class AppVentana
{
    static readonly HashSet<string> Vacias = new(StringComparer.Ordinal) { "microsoft", "windows", "app", "the", "para", "google", "de", "del", "la", "el", "and" };

    static readonly Dictionary<string, string[]> Procesos = new(StringComparer.Ordinal)
    {
        ["word"] = new[] { "winword" }, ["excel"] = new[] { "excel" }, ["powerpoint"] = new[] { "powerpnt" }, ["outlook"] = new[] { "outlook", "olk" },
        ["edge"] = new[] { "msedge" }, ["chrome"] = new[] { "chrome" }, ["teams"] = new[] { "ms-teams", "teams" }, ["code"] = new[] { "code" },
        ["explorador"] = new[] { "explorer" }, ["explorer"] = new[] { "explorer" }, ["calculadora"] = new[] { "calculatorapp", "calc" }, ["calculator"] = new[] { "calculatorapp", "calc" },
        ["notepad"] = new[] { "notepad" }, ["bloc"] = new[] { "notepad" }, ["paint"] = new[] { "mspaint" }, ["terminal"] = new[] { "windowsterminal", "wt" },
        ["configuracion"] = new[] { "systemsettings" }, ["settings"] = new[] { "systemsettings" },
    };

    public static bool Es(string nombreApp, string titulo, string proceso)
    {
        var claves = LayaLigera.Normalizar(nombreApp).Split(' ', StringSplitOptions.RemoveEmptyEntries).Where(w => w.Length >= 3 && !Vacias.Contains(w)).ToList();
        if (claves.Count == 0) return false;
        var proc = LayaLigera.Normalizar(proceso).Replace(" ", "");
        var palabras = LayaLigera.Normalizar(titulo).Split(' ', StringSplitOptions.RemoveEmptyEntries);
        foreach (var c in claves)
        {
            if (proc.Length > 0 && (proc.Contains(c, StringComparison.Ordinal) || Procesos.TryGetValue(c, out var ps) && ps.Contains(proc))) return true;
            if (palabras.Contains(c)) return true;
        }
        return false;
    }
}
