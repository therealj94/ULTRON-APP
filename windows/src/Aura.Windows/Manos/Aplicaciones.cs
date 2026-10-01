using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Aura.Windows.Core;

namespace Aura.Windows.Manos;

internal sealed record AppInstalada(string Nombre, string Destino, bool DeTienda);

/// <summary>
/// Las aplicaciones de ESTE equipo: los accesos del menú Inicio y las apps de la Tienda
/// (shell:AppsFolder). «Abre Word» busca aquí; si no está instalada, AURA lo dice y no inventa.
/// </summary>
internal static class Aplicaciones
{
    static List<AppInstalada> todas = new();
    public static IReadOnlyList<AppInstalada> Todas => todas;

    /// <summary>Nombres que la gente dice y lo que Windows tiene (en español o en inglés).</summary>
    static readonly Dictionary<string, string[]> Alias = new()
    {
        ["bloc de notas"] = new[] { "notepad", "bloc de notas" }, ["notepad"] = new[] { "notepad", "bloc de notas" },
        ["calculadora"] = new[] { "calculator", "calculadora" }, ["calculator"] = new[] { "calculator", "calculadora" },
        ["explorador"] = new[] { "file explorer", "explorador de archivos" }, ["explorador de archivos"] = new[] { "file explorer", "explorador de archivos" }, ["file explorer"] = new[] { "file explorer", "explorador de archivos" },
        ["configuracion"] = new[] { "settings", "configuracion" }, ["settings"] = new[] { "settings", "configuracion" },
        ["word"] = new[] { "word" }, ["excel"] = new[] { "excel" }, ["powerpoint"] = new[] { "powerpoint" }, ["outlook"] = new[] { "outlook" },
        ["correo"] = new[] { "outlook", "mail", "correo" }, ["mail"] = new[] { "outlook", "mail", "correo" },
        ["calendario"] = new[] { "calendar", "calendario", "outlook" }, ["calendar"] = new[] { "calendar", "calendario", "outlook" },
        ["camara"] = new[] { "camera", "camara" }, ["the camera app"] = new[] { "camera", "camara" }, ["reloj"] = new[] { "clock", "reloj", "alarms" },
        ["fotos"] = new[] { "photos", "fotos" }, ["tienda de microsoft"] = new[] { "microsoft store" }, ["tienda"] = new[] { "microsoft store" },
        ["administrador de tareas"] = new[] { "task manager", "administrador de tareas" }, ["task manager"] = new[] { "task manager", "administrador de tareas" },
        ["terminal"] = new[] { "terminal", "windows terminal", "command prompt", "simbolo del sistema" }, ["panel de control"] = new[] { "control panel", "panel de control" },
        ["reproductor multimedia"] = new[] { "media player", "reproductor multimedia" }, ["visual studio code"] = new[] { "visual studio code" }, ["vs code"] = new[] { "visual studio code" },
        ["edge"] = new[] { "microsoft edge", "edge" }, ["chrome"] = new[] { "google chrome", "chrome" },
    };

    /// <summary>Lo que Windows abre aunque no tenga acceso en Inicio.</summary>
    static readonly Dictionary<string, string> Sistema = new()
    {
        ["notepad"] = "notepad.exe", ["calculator"] = "calc.exe", ["file explorer"] = "explorer.exe", ["settings"] = "ms-settings:",
        ["task manager"] = "taskmgr.exe", ["control panel"] = "control.exe", ["paint"] = "mspaint.exe", ["camera"] = "microsoft.windows.camera:",
        ["clock"] = "ms-clock:", ["photos"] = "ms-photos:", ["microsoft store"] = "ms-windows-store:", ["terminal"] = "wt.exe",
        ["microsoft edge"] = "microsoft-edge:", ["media player"] = "mswindowsmusic:",
    };

    static Task? indexado;

    /// <summary>Lee las apps de este equipo (al arrancar, en segundo plano).</summary>
    public static Task Indexar() => indexado = IndexarAhora();

    /// <summary>
    /// «Abre Spotify» antes de que termine de indexar (al arrancar), o una app recién instalada: se espera el índice
    /// y, si sigue sin estar, se rehace una vez. Antes la primera vez decía «no la encontré» y la segunda sí.
    /// </summary>
    public static async Task<AppInstalada?> BuscarConIndice(string dicho)
    {
        if (indexado is { IsCompleted: false } t)
        {
            try { await t; } catch { }
            if (Buscar(dicho) is { } ya) return ya;
        }
        try { await Indexar(); } catch { }
        return Buscar(dicho);
    }

    static Task IndexarAhora() => Task.Run(() =>
    {
        var lista = new List<AppInstalada>();
        foreach (var raiz in new[] { Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), Environment.GetFolderPath(Environment.SpecialFolder.CommonStartMenu) })
        {
            try
            {
                foreach (var f in Directory.EnumerateFiles(raiz, "*.lnk", SearchOption.AllDirectories).Take(1500))
                {
                    var n = Path.GetFileNameWithoutExtension(f);
                    if (n.Contains("uninstall", StringComparison.OrdinalIgnoreCase) || n.Contains("desinstal", StringComparison.OrdinalIgnoreCase)) continue;
                    lista.Add(new AppInstalada(n, f, false));
                }
            }
            catch { }
        }
        try
        {
            // Las apps de la Tienda (WhatsApp, Spotify, Calculadora…): shell:AppsFolder por COM.
            var tipo = Type.GetTypeFromProgID("Shell.Application");
            if (tipo != null)
            {
                dynamic shell = Activator.CreateInstance(tipo)!;
                dynamic carpeta = shell.NameSpace("shell:AppsFolder");
                if (carpeta != null)
                    foreach (dynamic item in carpeta.Items())
                    {
                        string nombre = item.Name, ruta = item.Path;
                        if (!string.IsNullOrWhiteSpace(nombre) && !string.IsNullOrWhiteSpace(ruta) && ruta.Contains('!')) lista.Add(new AppInstalada(nombre, ruta, true));
                    }
            }
        }
        catch { }
        todas = lista.GroupBy(a => LayaLigera.Normalizar(a.Nombre)).Select(g => g.OrderBy(a => a.DeTienda).First()).OrderBy(a => a.Nombre).ToList();
    });

    /// <summary>La app que mejor calza con lo que se dijo, o null. Nunca «la más parecida» si no se parece.</summary>
    public static AppInstalada? Buscar(string dicho, int minimo = 40)
    {
        var q = LayaLigera.Normalizar(dicho);
        if (q.Length < 2) return null;
        var candidatos = Alias.TryGetValue(q, out var a) ? a : new[] { q };
        AppInstalada? mejor = null; int puntos = 0;
        foreach (var app in todas)
        {
            var n = LayaLigera.Normalizar(app.Nombre);
            foreach (var c in candidatos)
            {
                int p = n == c ? 100 : n.StartsWith(c + " ", StringComparison.Ordinal) ? 80 : (" " + n + " ").Contains(" " + c + " ", StringComparison.Ordinal) ? 60 : n.Contains(c, StringComparison.Ordinal) && c.Length >= 4 ? 40 : 0;
                // «Word» no es «WordPad»: la palabra entera pesa más; y lo más corto gana a igualdad.
                if (p > puntos || p == puntos && p > 0 && mejor != null && n.Length < LayaLigera.Normalizar(mejor.Nombre).Length) { puntos = p; mejor = app; }
            }
        }
        if (mejor != null && puntos >= minimo) return mejor;
        foreach (var c in candidatos) if (Sistema.TryGetValue(c, out var s)) return new AppInstalada(dicho, s, false);
        return null;
    }

    /// <summary>
    /// Abre y COMPRUEBA: una ventana nueva, o la de esa app ya abierta (las de una sola instancia solo se traen al
    /// frente). Si no aparece, otra vez. José: «tiene que probar hasta lograrlo y no decir que sí y no».
    /// </summary>
    public static async Task<bool> AbrirVerificado(AppInstalada app)
    {
        var antes = new HashSet<IntPtr>(Ventanas.Abiertas().Select(v => v.Handle));
        bool Abierta() => Ventanas.Abiertas().Any(v => !antes.Contains(v.Handle)) || Ventanas.Buscar(app.Nombre) != null;
        return await Verificar.Reintentar(async intento =>
        {
            if (intento > 1 && Abierta()) return true;
            Abrir(app);
            return await Verificar.Esperar(Abierta, intento == 1 ? 6000 : 8000, 250);
        }) > 0;
    }

    public static void Abrir(AppInstalada app)
    {
        if (app.DeTienda) Process.Start(new ProcessStartInfo("explorer.exe", "shell:AppsFolder\\" + app.Destino) { UseShellExecute = true });
        else Process.Start(new ProcessStartInfo(app.Destino) { UseShellExecute = true });
    }
}
