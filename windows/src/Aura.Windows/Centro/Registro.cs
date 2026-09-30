using System;
using System.IO;
using System.Text.RegularExpressions;

namespace Aura.Windows.Centro;

/// <summary>
/// El registro de diagnóstico (%LOCALAPPDATA%\AuraWindows\aura.log, 1 MB como mucho, rota a aura.1.log):
/// qué pasó y cuánto tardó cada paso (oír, entender, pensar, hablar, abrir…). Sin contraseñas ni tokens:
/// lo que parezca un secreto se tapa antes de escribir. Se copia desde Ajustes → Diagnóstico.
/// </summary>
internal static class Registro
{
    static readonly object candado = new();
    static readonly Regex Secreto = new(@"(?i)(bearer\s+|token[""'=:\s]+|clave[""'=:\s]+|password[""'=:\s]+|pase=|llave[""'=:\s]+)[^\s""'&,}]+");
    public static string Carpeta => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AuraWindows");
    public static string Archivo => Path.Combine(Carpeta, "aura.log");

    public static void Anotar(string categoria, string texto)
    {
        try
        {
            var linea = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} [{categoria}] {Secreto.Replace(texto, m => m.Groups[1].Value + "•••")}";
            lock (candado)
            {
                Directory.CreateDirectory(Carpeta);
                var f = new FileInfo(Archivo);
                if (f.Exists && f.Length > 1_000_000) File.Move(Archivo, Path.Combine(Carpeta, "aura.1.log"), true);
                File.AppendAllText(Archivo, linea + Environment.NewLine);
            }
        }
        catch { /* el registro nunca tumba a AURA */ }
    }

    /// <summary>Lo último del registro (para copiarlo desde Ajustes).</summary>
    public static string Ultimo(int lineas = 300)
    {
        try
        {
            lock (candado)
            {
                if (!File.Exists(Archivo)) return "";
                var todas = File.ReadAllLines(Archivo);
                return string.Join(Environment.NewLine, todas[Math.Max(0, todas.Length - lineas)..]);
            }
        }
        catch { return ""; }
    }
}
