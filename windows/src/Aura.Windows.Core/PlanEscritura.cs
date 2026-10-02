using System;
using System.Collections.Generic;
using System.Text;

namespace Aura.Windows.Core;

/// <summary>Una tecla del plan: un carácter Unicode (`Vk` = 0) o una tecla virtual, apretada o soltada.</summary>
public readonly record struct EventoTecla(ushort Vk, char Letra, bool Soltar)
{
    public bool EsUnicode => Vk == 0;
}

/// <summary>
/// Escribir texto NO es enviar ni ejecutar. Esto convierte el texto en teclas sin ninguna tecla «ejecutiva»:
/// nunca Enter suelto ni Tab. Un salto de línea es Mayús+Enter (salto sin enviar en chats y Word), una
/// tabulación son espacios y los demás controles se quitan. Y decide cuándo hace falta el «sí».
/// </summary>
public static class PlanEscritura
{
    public const ushort VkMayus = 0x10, VkEnter = 0x0D, VkTab = 0x09;

    /// <summary>Hasta aquí, una línea sola se escribe sin preguntar (si el control está verificado).</summary>
    public const int CortoSinConfirmar = 120;

    /// <summary>Espacios por cada tabulación.</summary>
    public const string EspaciosPorTab = "    ";

    /// <summary>El texto ya limpio: saltos como '\n', tabulaciones como espacios y sin otros controles.</summary>
    public static string Normalizar(string texto)
    {
        var sb = new StringBuilder(texto.Length);
        var t = (texto ?? "").Replace("\r\n", "\n").Replace('\r', '\n');
        foreach (var c in t)
        {
            if (c == '\n') sb.Append('\n');
            else if (c == '\t') sb.Append(EspaciosPorTab);
            else if (c is '\u2028' or '\u2029') sb.Append('\n');
            else if (!char.IsControl(c)) sb.Append(c);
        }
        return sb.ToString();
    }

    public static bool TieneSaltos(string texto) => (texto ?? "").IndexOfAny(new[] { '\n', '\r', '\u2028', '\u2029' }) >= 0;

    /// <summary>
    /// ¿Hace falta el «sí»? Siempre que haya saltos de línea, que no sea una línea corta o que no se pudo fijar
    /// el control exacto donde se escribe (solo la ventana).
    /// </summary>
    public static bool RequiereConfirmacion(string texto, bool focoVerificado = true)
    {
        var t = Normalizar(texto ?? "");
        return !focoVerificado || TieneSaltos(texto ?? "") || t.Length > CortoSinConfirmar;
    }

    /// <summary>
    /// Las teclas, en orden, para un trozo del texto ya normalizado. Un salto: Mayús abajo, Enter abajo,
    /// Enter arriba, Mayús arriba. Una letra: su carácter Unicode (los pares sustitutos van tal cual).
    /// </summary>
    public static IEnumerable<EventoTecla[]> Pasos(string texto)
    {
        foreach (var c in Normalizar(texto))
        {
            if (c == '\n')
                yield return new[] { new EventoTecla(VkMayus, '\0', false), new EventoTecla(VkEnter, '\0', false), new EventoTecla(VkEnter, '\0', true), new EventoTecla(VkMayus, '\0', true) };
            else
                yield return new[] { new EventoTecla(0, c, false), new EventoTecla(0, c, true) };
        }
    }

    /// <summary>Todas las teclas en una lista (para pruebas).</summary>
    public static List<EventoTecla> Teclas(string texto)
    {
        var l = new List<EventoTecla>();
        foreach (var p in Pasos(texto)) l.AddRange(p);
        return l;
    }

    /// <summary>
    /// ¿El plan es seguro? Ningún Tab, ningún Enter sin Mayús apretada y ningún control como carácter Unicode.
    /// Escritura lo comprueba antes de mandar cada paso.
    /// </summary>
    public static bool Seguro(IEnumerable<EventoTecla> teclas)
    {
        bool mayus = false;
        foreach (var e in teclas)
        {
            if (e.EsUnicode) { if (char.IsControl(e.Letra)) return false; continue; }
            switch (e.Vk)
            {
                case VkMayus: mayus = !e.Soltar; break;
                case VkEnter: if (!mayus) return false; break;
                default: return false; // ni Tab ni ninguna otra tecla virtual
            }
        }
        return !mayus;
    }

    /// <summary>
    /// Las terminales (cmd, PowerShell, Windows Terminal…) ejecutan con Mayús+Enter igual que con Enter: ahí no
    /// se escribe nada con saltos de línea.
    /// </summary>
    public static bool EsTerminal(string? proceso) => (proceso ?? "").ToLowerInvariant() is
        "cmd" or "powershell" or "pwsh" or "windowsterminal" or "wt" or "openconsole" or "conhost" or "bash" or "wsl" or "wslhost"
        or "mintty" or "putty" or "kitty" or "alacritty" or "wezterm" or "wezterm-gui" or "hyper" or "tabby" or "mobaxterm" or "ssh";
}

/// <summary>
/// Qué control tenía el cursor cuando se tomó el destino: proceso, id de ejecución de UI Automation (cambia si
/// el foco pasa a otro control, aunque sea de la misma ventana) y su AutomationId.
/// </summary>
public sealed record IdentidadFoco(int Proceso, int[] RuntimeId, string AutomationId, bool EsClave)
{
    /// <summary>¿Es el mismo control? Mismo proceso, mismo id de ejecución y mismo AutomationId. Una clave nunca sirve.</summary>
    public static bool Mismo(IdentidadFoco? antes, IdentidadFoco? ahora)
    {
        if (antes == null || ahora == null || ahora.EsClave || antes.EsClave) return false;
        if (antes.RuntimeId.Length == 0 || antes.Proceso != ahora.Proceso) return false;
        if (!string.Equals(antes.AutomationId, ahora.AutomationId, StringComparison.Ordinal)) return false;
        return antes.RuntimeId.AsSpan().SequenceEqual(ahora.RuntimeId);
    }
}
