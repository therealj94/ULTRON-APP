using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Automation;

namespace Aura.Windows.Manos;

/// <summary>
/// Escribir donde tienes el cursor, en CUALQUIER app (Bloc de notas, Word, el navegador, WhatsApp…), como
/// si tecleara una persona (SendInput Unicode). Cuidados: nunca en un campo de contraseña, nunca en AURA
/// misma, y si cambias de ventana a mitad se detiene y dice cuánto alcanzó a escribir.
/// </summary>
internal sealed class Escritura
{
    [StructLayout(LayoutKind.Sequential)] struct ENTRADA { public uint tipo; public TECLA ki; public ulong relleno; }
    [StructLayout(LayoutKind.Sequential)] struct TECLA { public ushort vk; public ushort scan; public uint flags; public uint time; public IntPtr extra; }
    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, ENTRADA[] e, int tam);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);

    public IntPtr Ventana { get; }
    public string Titulo { get; }
    public string App { get; }

    Escritura(IntPtr v, string titulo, string app) { Ventana = v; Titulo = titulo; App = app; }

    /// <summary>
    /// El destino: la ventana al frente (o `preferida`, si AURA tenía el foco). Falla con una explicación si
    /// es AURA, si no hay ventana o si el cursor está en un campo de contraseña.
    /// </summary>
    public static async Task<Escritura> Tomar(IntPtr preferida)
    {
        var propia = Environment.ProcessId;
        var v = GetForegroundWindow();
        GetWindowThreadProcessId(v, out var pid);
        if ((v == IntPtr.Zero || pid == propia) && preferida != IntPtr.Zero)
        {
            SetForegroundWindow(preferida);
            await Task.Delay(220);
            v = GetForegroundWindow();
            GetWindowThreadProcessId(v, out pid);
        }
        if (v == IntPtr.Zero || pid == propia) throw new InvalidOperationException("Pon el cursor donde quieres que escriba (en otra app) y vuelve a pedírmelo.");
        string app;
        try { using var p = Process.GetProcessById(pid); app = p.ProcessName; } catch { app = "la app"; }
        var sb = new System.Text.StringBuilder(256);
        GetWindowText(v, sb, 256);
        try
        {
            var foco = AutomationElement.FocusedElement;
            if (foco != null && foco.Current.ProcessId == pid && foco.Current.IsPassword)
                throw new InvalidOperationException("El cursor está en un campo de contraseña: ahí no escribo.");
        }
        catch (ElementNotAvailableException) { }
        return new Escritura(v, sb.ToString(), app);
    }

    static ENTRADA Unicode(char c, bool soltar) => new() { tipo = 1, ki = new TECLA { scan = c, flags = 4u | (soltar ? 2u : 0u) } };
    static ENTRADA Tecla(ushort vk, bool soltar) => new() { tipo = 1, ki = new TECLA { vk = vk, flags = soltar ? 2u : 0u } };

    /// <summary>Escribe el texto. Devuelve cuántos caracteres escribió.</summary>
    public async Task<int> Escribir(string texto, CancellationToken ct)
    {
        if (texto.Length > 12000) throw new InvalidOperationException("Es muy largo para escribirlo tecla por tecla (más de 12.000 letras). Guárdalo como borrador y pégalo.");
        if (GetForegroundWindow() != Ventana) { SetForegroundWindow(Ventana); await Task.Delay(150, ct); }
        int escritos = 0;
        foreach (var c in texto.Replace("\r\n", "\n"))
        {
            ct.ThrowIfCancellationRequested();
            if (GetForegroundWindow() != Ventana)
                throw new InvalidOperationException($"Cambiaste de ventana: me detuve después de {escritos} letras.");
            ENTRADA[] e = c switch
            {
                '\n' => new[] { Tecla(0x0D, false), Tecla(0x0D, true) },
                '\t' => new[] { Tecla(0x09, false), Tecla(0x09, true) },
                _ when char.IsControl(c) => Array.Empty<ENTRADA>(),
                _ => new[] { Unicode(c, false), Unicode(c, true) },
            };
            if (e.Length > 0 && SendInput((uint)e.Length, e, Marshal.SizeOf<ENTRADA>()) != e.Length)
                throw new InvalidOperationException("Windows no dejó escribir en esa ventana (¿es de administrador?).");
            escritos++;
            // Ritmo humano: las apps lentas (Word, el navegador) no pierden letras.
            if (escritos % 24 == 0) await Task.Delay(12, ct);
        }
        return escritos;
    }
}
