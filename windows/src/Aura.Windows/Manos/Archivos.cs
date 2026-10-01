using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using Aura.Windows.Core;

namespace Aura.Windows.Manos;

/// <summary>
/// Archivos y carpetas: crear una carpeta en un lugar conocido, mostrar un archivo en el Explorador, las
/// últimas descargas y vaciar la papelera (esto último solo después del «sí»). Nunca borra archivos tuyos.
/// </summary>
internal static class Archivos
{
    [StructLayout(LayoutKind.Sequential, Pack = 4)] struct SHQUERYRBINFO { public int cbSize; public long i64Size; public long i64NumItems; }
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern int SHQueryRecycleBin(string? raiz, ref SHQUERYRBINFO info);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern int SHEmptyRecycleBin(IntPtr ventana, string? raiz, uint flags);

    /// <summary>
    /// Crea `nombre` dentro de la carpeta conocida `lugar` (escritorio, documentos…). El nombre ya viene limpio
    /// (ManosMas.NombreCarpetaSeguro) y aun así se comprueba que la ruta final quede DENTRO de ese lugar.
    /// Devuelve la ruta y si ya existía.
    /// </summary>
    public static (string Ruta, bool YaEstaba) CrearCarpeta(string lugar, string nombre)
    {
        if (lugar == "papelera") throw new InvalidOperationException("En la papelera no se crean carpetas.");
        var limpio = ManosMas.NombreCarpetaSeguro(nombre) ?? throw new InvalidOperationException("Ese nombre de carpeta no sirve en Windows.");
        var baseDir = Path.GetFullPath(Escritorio.RutaCarpeta(lugar));
        if (!Directory.Exists(baseDir)) throw new InvalidOperationException("Esa carpeta no existe en este equipo.");
        var ruta = Path.GetFullPath(Path.Combine(baseDir, limpio));
        if (!string.Equals(Path.GetDirectoryName(ruta)?.TrimEnd('\\'), baseDir.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Ese nombre de carpeta no sirve.");
        if (Directory.Exists(ruta)) return (ruta, true);
        if (File.Exists(ruta)) throw new InvalidOperationException("Ya hay un archivo con ese nombre ahí.");
        Directory.CreateDirectory(ruta);
        return (ruta, false);
    }

    /// <summary>Abre el Explorador con el archivo seleccionado (la ruta sale de la búsqueda de AURA, no de la voz).</summary>
    public static void MostrarEnExplorador(string ruta)
    {
        if (!File.Exists(ruta) && !Directory.Exists(ruta)) throw new InvalidOperationException("Ese archivo ya no está.");
        Process.Start(new ProcessStartInfo("explorer.exe", "/select,\"" + ruta + "\"") { UseShellExecute = true });
    }

    /// <summary>Lo más nuevo de Descargas (sin descargas a medias ni ocultos).</summary>
    public static List<FileInfo> Recientes(int max = 5)
    {
        var d = new DirectoryInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads"));
        if (!d.Exists) return new();
        return d.EnumerateFiles().Where(f => f.Extension is not (".crdownload" or ".part" or ".tmp" or ".download") && !f.Attributes.HasFlag(FileAttributes.Hidden))
                .OrderByDescending(f => f.LastWriteTimeUtc).Take(max).ToList();
    }

    /// <summary>Cuántos elementos tiene la papelera y cuánto pesan.</summary>
    public static (long Elementos, long Bytes) Papelera()
    {
        var info = new SHQUERYRBINFO { cbSize = Marshal.SizeOf<SHQUERYRBINFO>() };
        return SHQueryRecycleBin(null, ref info) == 0 ? (info.i64NumItems, info.i64Size) : (-1, 0);
    }

    /// <summary>Vacía la papelera de todas las unidades (sin el diálogo de Windows: el «sí» ya lo diste en AURA).</summary>
    public static void VaciarPapelera()
    {
        // SHERB_NOCONFIRMATION | SHERB_NOPROGRESSUI | SHERB_NOSOUND
        int hr = SHEmptyRecycleBin(IntPtr.Zero, null, 0x1 | 0x2 | 0x4);
        if (hr != 0 && hr != unchecked((int)0x8000FFFF)) Marshal.ThrowExceptionForHR(hr); // E_UNEXPECTED: ya estaba vacía
    }
}
