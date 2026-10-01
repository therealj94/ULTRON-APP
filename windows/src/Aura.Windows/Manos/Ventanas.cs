using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using Aura.Windows.Core;

namespace Aura.Windows.Manos;

internal sealed record VentanaAbierta(IntPtr Handle, string Titulo, string Proceso);

/// <summary>Las ventanas abiertas: cambiar a una, minimizar, maximizar, restaurar o pedirle que se cierre (la app pregunta si guarda).</summary>
internal static class Ventanas
{
    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();

    /// <summary>Ventanas de primer nivel visibles, con título, que no son herramientas ni de AURA.</summary>
    public static List<VentanaAbierta> Abiertas()
    {
        var lista = new List<VentanaAbierta>();
        EnumWindows((h, _) =>
        {
            if (!IsWindowVisible(h) || GetWindow(h, 4) != IntPtr.Zero) return true; // con dueño: diálogos, no ventanas
            if ((GetWindowLong(h, -20) & 0x80) != 0) return true; // WS_EX_TOOLWINDOW
            var sb = new StringBuilder(256); GetWindowText(h, sb, 256);
            if (sb.Length == 0) return true;
            GetWindowThreadProcessId(h, out var pid);
            if (pid == Environment.ProcessId) return true;
            string proc = "";
            try { using var p = Process.GetProcessById((int)pid); proc = p.ProcessName; } catch { }
            if (proc is "ApplicationFrameHost" && sb.ToString() is "Microsoft Text Input Application") return true;
            lista.Add(new VentanaAbierta(h, sb.ToString(), proc));
            return true;
        }, IntPtr.Zero);
        return lista;
    }

    static readonly Dictionary<string, string[]> Procesos = new()
    {
        ["word"] = new[] { "winword" }, ["excel"] = new[] { "excel" }, ["powerpoint"] = new[] { "powerpnt" }, ["outlook"] = new[] { "outlook", "olk" },
        ["chrome"] = new[] { "chrome" }, ["edge"] = new[] { "msedge" }, ["navegador"] = new[] { "chrome", "msedge", "firefox", "brave", "opera" }, ["browser"] = new[] { "chrome", "msedge", "firefox", "brave", "opera" },
        ["bloc de notas"] = new[] { "notepad" }, ["notepad"] = new[] { "notepad" }, ["explorador"] = new[] { "explorer" }, ["file explorer"] = new[] { "explorer" },
        ["calculadora"] = new[] { "calculatorapp", "calc" }, ["calculator"] = new[] { "calculatorapp", "calc" }, ["teams"] = new[] { "ms-teams", "teams" },
        ["spotify"] = new[] { "spotify" }, ["whatsapp"] = new[] { "whatsapp" }, ["zoom"] = new[] { "zoom" }, ["visual studio code"] = new[] { "code" }, ["vs code"] = new[] { "code" },
    };

    /// <summary>La ventana que calza con lo dicho (por el programa o por el título), o null.</summary>
    public static VentanaAbierta? Buscar(string dicho)
    {
        var q = LayaLigera.Normalizar(dicho);
        if (q.Length < 2) return null;
        var todas = Abiertas();
        if (Procesos.TryGetValue(q, out var procs))
            foreach (var p in procs) { var v = todas.FirstOrDefault(x => x.Proceso.Equals(p, StringComparison.OrdinalIgnoreCase)); if (v != null) return v; }
        return todas.FirstOrDefault(x => LayaLigera.Normalizar(x.Proceso) == q)
            ?? todas.FirstOrDefault(x => (" " + LayaLigera.Normalizar(x.Titulo) + " ").Contains(" " + q + " ", StringComparison.Ordinal));
    }

    public static void AlFrente(IntPtr h)
    {
        if (IsIconic(h)) ShowWindow(h, 9);
        keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero);
        if (!SetForegroundWindow(h)) throw new InvalidOperationException("Windows no me dejó traer esa ventana al frente.");
    }

    public static void Minimizar(IntPtr h) => ShowWindow(h, 6);
    public static void Maximizar(IntPtr h) { ShowWindow(h, 3); SetForegroundWindow(h); }
    public static void Restaurar(IntPtr h) { ShowWindow(h, 9); SetForegroundWindow(h); }
    public enum Cierre { Cerrada, PreguntaGuardar, SigueAbierta }

    /// <summary>
    /// Pide que se cierre y COMPRUEBA que ya no está (las de la bandeja, como Spotify, se esconden: también cuenta).
    /// Si la app pregunta «¿guardar cambios?», se dice eso; si sigue abierta sin preguntar, se pide otra vez.
    /// </summary>
    public static async Task<Cierre> CerrarVerificado(IntPtr h)
    {
        GetWindowThreadProcessId(h, out var pid);
        bool Ida() => !IsWindow(h) || !IsWindowVisible(h);
        Cerrar(h);
        if (await Verificar.Esperar(Ida, 3000, 150)) return Cierre.Cerrada;
        if (DialogoDe(pid)) return Cierre.PreguntaGuardar;
        Cerrar(h);
        if (await Verificar.Esperar(Ida, 2000, 150)) return Cierre.Cerrada;
        return DialogoDe(pid) ? Cierre.PreguntaGuardar : Cierre.SigueAbierta;
    }

    /// <summary>¿Esa app tiene abierto un diálogo (una ventana visible con dueño, como «¿Guardar los cambios?»)?</summary>
    static bool DialogoDe(uint pid)
    {
        bool hay = false;
        EnumWindows((w, _) =>
        {
            if (!IsWindowVisible(w) || GetWindow(w, 4) == IntPtr.Zero) return true;
            GetWindowThreadProcessId(w, out var p);
            if (p != pid) return true;
            hay = true;
            return false;
        }, IntPtr.Zero);
        return hay;
    }

    /// <summary>Al frente y comprobado (Windows a veces no deja a la primera): hasta tres intentos.</summary>
    public static async Task<bool> AlFrenteVerificado(IntPtr h) => await Verificar.Reintentar(async _ =>
    {
        try { AlFrente(h); } catch (InvalidOperationException) { }
        return await Verificar.Esperar(() => GetForegroundWindow() == h, 600, 100);
    }, 3) > 0;

    /// <summary>Le PIDE a la ventana que se cierre (WM_CLOSE): si hay algo sin guardar, la app pregunta.</summary>
    public static void Cerrar(IntPtr h) { if (!PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero)) throw new InvalidOperationException("La ventana no aceptó cerrarse."); }
}
