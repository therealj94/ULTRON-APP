using System;
using System.IO;
using Aura.Windows.Core;

namespace Aura.Windows.Centro;

/// <summary>
/// El registro de diagnóstico (%LOCALAPPDATA%\AuraWindows\aura.log, 1 MB como mucho, rota a aura.1.log):
/// qué pasó y cuánto tardó cada paso (oír, entender, pensar, hablar, abrir…). Es texto plano en el disco, así
/// que por defecto guarda METADATOS (largos, tiempos, tipos), no lo que dijiste ni los títulos de tus órdenes
/// (auditoría 1-oct, H13). Con «Registro detallado» (Ajustes → Privacidad, apagado de fábrica) también el
/// texto, recortado. Siempre, todo pasa por RegistroSeguro.Sanear: correos, enlaces con parámetros, números
/// largos (tarjetas, teléfonos) y lo que parezca un secreto se tapan antes de escribir. Se copia desde Ajustes.
/// </summary>
internal static class Registro
{
    static readonly object candado = new();
    public static string Carpeta => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AuraWindows");
    public static string Archivo => Path.Combine(Carpeta, "aura.log");

    /// <summary>«Registro detallado»: el texto de lo dicho/ordenado entra (saneado y recortado). Lo pone el notch desde los ajustes.</summary>
    public static bool Detallado { get; set; }

    public static void Anotar(string categoria, string texto)
    {
        try
        {
            var linea = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} [{categoria}] {RegistroSeguro.Sanear(texto)}";
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

    /// <summary>
    /// Un evento con texto de la persona (lo que dijo, una orden, un título, un monto): <paramref name="meta"/> va
    /// siempre; <paramref name="contenido"/> solo como su largo, salvo con el registro detallado.
    /// </summary>
    public static void AnotarDicho(string categoria, string meta, string? contenido) =>
        Anotar(categoria, (meta.Length > 0 ? meta + " · " : "") + RegistroSeguro.Contenido(contenido, Detallado));

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
