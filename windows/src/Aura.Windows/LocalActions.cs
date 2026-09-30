using System;
using System.Diagnostics;
using System.IO;
using Aura.Windows.Core;
namespace Aura.Windows;
internal static class LocalActions
{
    public static void Execute(Command command) {
        if (!Commands.IsAllowed(command)) throw new InvalidOperationException("Esta acción no está permitida.");
        string system = Environment.GetFolderPath(Environment.SpecialFolder.System);
        string target = command.Kind switch {
            ActionKind.OpenNotepad => Path.Combine(system, "notepad.exe"),
            ActionKind.OpenCalculator => Path.Combine(system, "calc.exe"),
            ActionKind.OpenExplorer => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "explorer.exe"),
            ActionKind.OpenDocuments => Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
            ActionKind.OpenSettings => "ms-settings:",
            ActionKind.SearchWeb => "https://www.bing.com/search?q=" + Uri.EscapeDataString(command.Value),
            ActionKind.OpenUrl => command.Value,
            _ => throw new InvalidOperationException("La acción no abre una aplicación.")
        };
        if (string.IsNullOrWhiteSpace(target)) throw new InvalidOperationException("Windows no encontró el destino.");
        Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
    }
}
