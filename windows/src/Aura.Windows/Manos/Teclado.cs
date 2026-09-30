using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using Microsoft.Win32;

namespace Aura.Windows.Manos;

/// <summary>
/// Más control del equipo: combinaciones de teclas en la ventana donde trabajas («guárdalo», «nueva
/// pestaña», «presiona control shift s»), páginas de Configuración de Windows, brillo y modo oscuro.
/// </summary>
internal static class Teclado
{
    [StructLayout(LayoutKind.Sequential)] struct ENTRADA { public uint tipo; public TECLA ki; public ulong relleno; }
    [StructLayout(LayoutKind.Sequential)] struct TECLA { public ushort vk; public ushort scan; public uint flags; public uint time; public IntPtr extra; }
    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, ENTRADA[] e, int tam);

    static readonly Dictionary<string, ushort> Vk = new()
    {
        ["CTRL"] = 0x11, ["ALT"] = 0x12, ["SHIFT"] = 0x10, ["WIN"] = 0x5B, ["ENTER"] = 0x0D, ["ESC"] = 0x1B, ["TAB"] = 0x09, ["SPACE"] = 0x20,
        ["BACKSPACE"] = 0x08, ["DELETE"] = 0x2E, ["HOME"] = 0x24, ["END"] = 0x23, ["PAGEUP"] = 0x21, ["PAGEDOWN"] = 0x22,
        ["LEFT"] = 0x25, ["UP"] = 0x26, ["RIGHT"] = 0x27, ["DOWN"] = 0x28, ["PLUS"] = 0xBB, ["MINUS"] = 0xBD,
    };
    static readonly HashSet<ushort> Extendidas = new() { 0x2E, 0x24, 0x23, 0x21, 0x22, 0x25, 0x26, 0x27, 0x28, 0x5B };

    static ushort CodigoDe(string t)
    {
        if (Vk.TryGetValue(t, out var v)) return v;
        if (t.Length == 1 && char.IsLetterOrDigit(t[0])) return (ushort)char.ToUpperInvariant(t[0]);
        if (t.StartsWith('F') && int.TryParse(t[1..], out var f) && f is >= 1 and <= 12) return (ushort)(0x6F + f);
        throw new InvalidOperationException("No conozco la tecla " + t);
    }

    static ENTRADA Tecla(ushort vk, bool soltar) => new()
    {
        tipo = 1,
        ki = new TECLA { vk = vk, flags = (soltar ? 2u : 0u) | (Extendidas.Contains(vk) ? 1u : 0u) },
    };

    /// <summary>Aprieta la combinación («CTRL+SHIFT+S»): baja todas en orden y las suelta al revés.</summary>
    public static void Combinacion(string combo)
    {
        var codigos = new List<ushort>();
        foreach (var t in combo.Split('+', StringSplitOptions.RemoveEmptyEntries)) codigos.Add(CodigoDe(t.Trim()));
        var e = new List<ENTRADA>();
        foreach (var c in codigos) e.Add(Tecla(c, false));
        for (int i = codigos.Count - 1; i >= 0; i--) e.Add(Tecla(codigos[i], true));
        var arr = e.ToArray();
        if (SendInput((uint)arr.Length, arr, Marshal.SizeOf<ENTRADA>()) != arr.Length)
            throw new InvalidOperationException("Windows no dejó enviar las teclas (¿una ventana de administrador al frente?).");
    }

    /// <summary>Configuración de Windows en la página pedida («network-wifi», «bluetooth»…).</summary>
    public static void Configuracion(string pagina) =>
        Process.Start(new ProcessStartInfo("ms-settings:" + pagina) { UseShellExecute = true });

    /// <summary>Brillo de la pantalla de la laptop (WMI). En monitores externos Windows no lo deja cambiar.</summary>
    public static async Task<int> Brillo(string valor)
    {
        string ps(string cmd) => $"-NoProfile -NonInteractive -Command \"{cmd}\"";
        async Task<string> Correr(string args)
        {
            var p = Process.Start(new ProcessStartInfo("powershell.exe", args) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true })!;
            var salida = await p.StandardOutput.ReadToEndAsync();
            await p.WaitForExitAsync();
            return salida.Trim();
        }
        var actualTxt = await Correr(ps("(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1).CurrentBrightness"));
        if (!int.TryParse(actualTxt, out var actual)) throw new InvalidOperationException("Esta pantalla no deja cambiar el brillo desde Windows (pasa con monitores externos). Usa los botones del monitor.");
        int nuevo = valor switch { "+" => actual + 15, "-" => actual - 15, _ => int.TryParse(valor, out var n) ? n : actual };
        nuevo = Math.Clamp(nuevo, 5, 100);
        await Correr(ps($"(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods | Select-Object -First 1) | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{{Timeout=1;Brightness={nuevo}}} | Out-Null"));
        return nuevo;
    }

    /// <summary>Modo oscuro o claro de Windows y de las apps (se deshace diciendo el contrario).</summary>
    public static void Tema(bool oscuro)
    {
        using var k = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
        k.SetValue("AppsUseLightTheme", oscuro ? 0 : 1, RegistryValueKind.DWord);
        k.SetValue("SystemUsesLightTheme", oscuro ? 0 : 1, RegistryValueKind.DWord);
    }
}
