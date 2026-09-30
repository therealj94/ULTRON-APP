using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using Aura.Windows.Core;

namespace Aura.Windows.Manos;

/// <summary>
/// Las manos que tocan Windows: carpetas, páginas, búsqueda, volumen y multimedia (teclas del
/// sistema), mostrar el escritorio, bloquear, capturas. Nada de consola ni comandos arbitrarios: cada
/// mano hace una sola cosa conocida.
/// </summary>
internal static class Escritorio
{
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll")] static extern bool LockWorkStation();

    public static string RutaCarpeta(string clave) => clave switch
    {
        "documentos" => Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
        "descargas" => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads"),
        "escritorio" => Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
        "imagenes" => Environment.GetFolderPath(Environment.SpecialFolder.MyPictures),
        "musica" => Environment.GetFolderPath(Environment.SpecialFolder.MyMusic),
        "videos" => Environment.GetFolderPath(Environment.SpecialFolder.MyVideos),
        "onedrive" => Environment.GetEnvironmentVariable("OneDrive") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "OneDrive"),
        "papelera" => "shell:RecycleBinFolder",
        _ => throw new InvalidOperationException("No conozco esa carpeta."),
    };

    public static string NombreCarpeta(string clave, string idioma) => (clave, idioma) switch
    {
        ("documentos", "en") => "Documents", ("descargas", "en") => "Downloads", ("escritorio", "en") => "Desktop", ("imagenes", "en") => "Pictures",
        ("musica", "en") => "Music", ("papelera", "en") => "Recycle Bin", ("imagenes", _) => "Imágenes", ("musica", _) => "Música",
        _ => char.ToUpperInvariant(clave[0]) + clave[1..],
    };

    public static void AbrirCarpeta(string clave)
    {
        var ruta = RutaCarpeta(clave);
        if (ruta.StartsWith("shell:", StringComparison.Ordinal)) { Process.Start(new ProcessStartInfo("explorer.exe", ruta) { UseShellExecute = true }); return; }
        if (!Directory.Exists(ruta)) throw new InvalidOperationException("Esa carpeta no existe en este equipo.");
        Process.Start(new ProcessStartInfo("explorer.exe", "\"" + ruta + "\"") { UseShellExecute = true });
    }

    public static void AbrirWeb(string url)
    {
        if (!Commands.SafeHttps(url)) throw new InvalidOperationException("Solo abro páginas HTTPS.");
        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
    }

    public static void Buscar(string q) => AbrirWeb("https://www.google.com/search?q=" + Uri.EscapeDataString(q));

    static void Tecla(byte vk, int veces = 1)
    {
        for (int i = 0; i < veces; i++) { keybd_event(vk, 0, 1, UIntPtr.Zero); keybd_event(vk, 0, 3, UIntPtr.Zero); }
    }

    public static void Volumen(bool subir, int pasos = 5) => Tecla(subir ? (byte)0xAF : (byte)0xAE, pasos);
    public static void Mute() => Tecla(0xAD);
    public static void PlayPausa() => Tecla(0xB3);
    public static void Siguiente() => Tecla(0xB0);
    public static void Anterior() => Tecla(0xB1);

    public static void MostrarEscritorio()
    {
        var tipo = Type.GetTypeFromProgID("Shell.Application") ?? throw new InvalidOperationException("Windows no permitió mostrar el escritorio.");
        dynamic shell = Activator.CreateInstance(tipo)!;
        shell.ToggleDesktop();
    }

    public static void Bloquear() { if (!LockWorkStation()) throw new InvalidOperationException("Windows no permitió bloquear."); }

    /// <summary>La pantalla donde está el notch (la principal), como imagen.</summary>
    public static Bitmap CapturarPantalla()
    {
        var b = System.Windows.Forms.Screen.PrimaryScreen!.Bounds;
        var bmp = new Bitmap(b.Width, b.Height, PixelFormat.Format24bppRgb);
        using var g = Graphics.FromImage(bmp);
        g.CopyFromScreen(b.Left, b.Top, 0, 0, b.Size, CopyPixelOperation.SourceCopy);
        return bmp;
    }

    /// <summary>Guarda una captura en Imágenes\Capturas de pantalla y devuelve la ruta.</summary>
    public static string GuardarCaptura()
    {
        using var bmp = CapturarPantalla();
        var carpeta = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyPictures), "Screenshots");
        Directory.CreateDirectory(carpeta);
        var ruta = Path.Combine(carpeta, $"AURA-{DateTime.Now:yyyyMMdd-HHmmss}.png");
        bmp.Save(ruta, ImageFormat.Png);
        return ruta;
    }

    /// <summary>JPEG de la pantalla, reducido a 1600 px de ancho como mucho (para los ojos del servidor).</summary>
    public static byte[] PantallaJpeg()
    {
        using var bmp = CapturarPantalla();
        double f = Math.Min(1, 1600.0 / bmp.Width);
        using var chica = new Bitmap(bmp, new Size((int)(bmp.Width * f), (int)(bmp.Height * f)));
        using var ms = new MemoryStream();
        var codec = ImageCodecInfo.GetImageEncoders().First(c => c.MimeType == "image/jpeg");
        using var p = new EncoderParameters(1);
        p.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 80L);
        chica.Save(ms, codec, p);
        return ms.ToArray();
    }
}
