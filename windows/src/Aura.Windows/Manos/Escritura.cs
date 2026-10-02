using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Automation;
using Aura.Windows.Core;

namespace Aura.Windows.Manos;

/// <summary>
/// Escribir donde tienes el cursor, en CUALQUIER app (Bloc de notas, Word, el navegador, WhatsApp…), como
/// si tecleara una persona (SendInput Unicode). Escribir no es enviar: nunca aprieta Enter ni Tab (un salto
/// es Mayús+Enter, ver PlanEscritura). Cuidados: nunca en un campo de contraseña, nunca en AURA misma, y si
/// cambias de ventana o de control a mitad (o el campo se vuelve de contraseña) se detiene y dice cuánto alcanzó.
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
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int tecla);

    public IntPtr Ventana { get; }
    public string Titulo { get; }
    public string App { get; }
    readonly int proceso;
    /// <summary>El control exacto que tenía el cursor (null si la app no lo dice por UI Automation).</summary>
    public IdentidadFoco? Foco { get; }
    /// <summary>Se pudo fijar el control: si no, toda escritura pide el «sí».</summary>
    public bool FocoVerificado => Foco != null;
    public bool EsTerminal => PlanEscritura.EsTerminal(App);

    Escritura(IntPtr v, int pid, string titulo, string app, IdentidadFoco? foco) { Ventana = v; proceso = pid; Titulo = titulo; App = app; Foco = foco; }

    /// <summary>El control con el foco ahora mismo (null si UI Automation no contesta).</summary>
    static IdentidadFoco? LeerFoco()
    {
        try
        {
            var f = AutomationElement.FocusedElement;
            if (f == null) return null;
            var c = f.Current;
            return new IdentidadFoco(c.ProcessId, f.GetRuntimeId() ?? Array.Empty<int>(), c.AutomationId ?? "", c.IsPassword);
        }
        catch (Exception ex) when (ex is not OutOfMemoryException) { return null; }
    }

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
        var foco = LeerFoco();
        if (foco != null && foco.Proceso == pid && foco.EsClave)
            throw new InvalidOperationException("El cursor está en un campo de contraseña: ahí no escribo.");
        // Solo cuenta como verificado si el control es de esa misma app y tiene identidad estable.
        if (foco == null || foco.Proceso != pid || foco.RuntimeId.Length == 0) foco = null;
        return new Escritura(v, pid, sb.ToString(), app, foco);
    }

    /// <summary>
    /// ¿Sigue siendo el mismo destino? Misma ventana al frente, el MISMO control (no otro de la misma ventana)
    /// y no un campo de contraseña. Se llama justo antes de escribir (después del «sí») y mientras escribe.
    /// </summary>
    void Revalidar(int escritos)
    {
        if (GetForegroundWindow() != Ventana)
            throw new InvalidOperationException($"Cambiaste de ventana: me detuve después de {escritos} letras.");
        var ahora = LeerFoco();
        if (ahora != null && ahora.Proceso == proceso && ahora.EsClave)
            throw new InvalidOperationException($"El cursor quedó en un campo de contraseña: me detuve después de {escritos} letras.");
        if (Foco != null && !IdentidadFoco.Mismo(Foco, ahora))
            throw new InvalidOperationException($"El cursor cambió de lugar dentro de la ventana: me detuve después de {escritos} letras.");
    }

    static void SinModificadores()
    {
        // Con Ctrl, Alt o Windows apretados, cada letra sería un atajo.
        foreach (var k in new[] { 0x11, 0x12, 0x5B, 0x5C })
            if ((GetAsyncKeyState(k) & 0x8000) != 0) throw new InvalidOperationException("Hay una tecla Ctrl, Alt o Windows apretada: suéltala y vuelve a pedírmelo.");
    }

    static ENTRADA Entrada(EventoTecla t) => t.EsUnicode
        ? new() { tipo = 1, ki = new TECLA { scan = t.Letra, flags = 4u | (t.Soltar ? 2u : 0u) } }
        : new() { tipo = 1, ki = new TECLA { vk = t.Vk, flags = t.Soltar ? 2u : 0u } };

    /// <summary>Escribe el texto (sin Enter ni Tab). Devuelve cuántos caracteres escribió.</summary>
    public async Task<int> Escribir(string texto, CancellationToken ct)
    {
        if (texto.Length > 12000) throw new InvalidOperationException("Es muy largo para escribirlo tecla por tecla (más de 12.000 letras). Guárdalo como borrador y pégalo.");
        if (EsTerminal && PlanEscritura.TieneSaltos(texto))
            throw new InvalidOperationException("En una terminal no escribo varias líneas: un salto de línea ejecutaría el comando.");
        if (GetForegroundWindow() != Ventana) { SetForegroundWindow(Ventana); await Task.Delay(150, ct); }
        // Después del «sí» pudo cambiar todo: se vuelve a mirar antes de la primera letra.
        Revalidar(0);
        int escritos = 0, pasos = 0;
        foreach (var paso in PlanEscritura.Pasos(texto))
        {
            ct.ThrowIfCancellationRequested();
            bool salto = !paso[0].EsUnicode;
            if (GetForegroundWindow() != Ventana)
                throw new InvalidOperationException($"Cambiaste de ventana: me detuve después de {escritos} letras.");
            // El control y la contraseña: cada pocas letras y siempre antes de un salto de línea.
            if (salto || ++pasos % 4 == 0) Revalidar(escritos);
            SinModificadores();
            if (!PlanEscritura.Seguro(paso)) throw new InvalidOperationException("Esa escritura apretaría una tecla que envía o ejecuta; no la hago.");
            var e = Array.ConvertAll(paso, Entrada);
            if (SendInput((uint)e.Length, e, Marshal.SizeOf<ENTRADA>()) != e.Length)
                throw new InvalidOperationException("Windows no dejó escribir en esa ventana (¿es de administrador?).");
            escritos++;
            // Ritmo humano: las apps lentas (Word, el navegador) no pierden letras.
            if (escritos % 24 == 0) await Task.Delay(12, ct);
        }
        return escritos;
    }
}
