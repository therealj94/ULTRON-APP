using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Automation;

namespace Aura.Windows.Manos;

/// <summary>Lo que se leyó de la pantalla: de qué ventana, el texto y cómo se leyó (uia, ocr o los dos).</summary>
internal sealed record Lectura(string Titulo, string Proceso, string Texto, string Via);

/// <summary>
/// Leer la pantalla SIN mandar imágenes a nadie: primero el texto real de la ventana con UI Automation
/// (lo que la app le dice a los lectores de pantalla), y si eso trae poco, el OCR de Windows sobre
/// la ventana, en este equipo. Lo que sale es TEXTO; al cerebro solo va eso. Los campos de contraseña
/// nunca se leen.
/// </summary>
internal static class Pantalla
{
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }

    /// <summary>La última ventana de trabajo que tuvo el foco (no la de AURA). La actualiza el notch.</summary>
    public static IntPtr UltimaAjena { get; private set; }

    public static void Recordar(IntPtr propia)
    {
        var fg = GetForegroundWindow();
        if (fg == IntPtr.Zero || fg == propia) return;
        GetWindowThreadProcessId(fg, out var pid);
        if (pid == Environment.ProcessId) return;
        UltimaAjena = fg;
    }

    /// <summary>La ventana sobre la que se trabaja: la del foco si no es AURA; si no, la última ajena.</summary>
    public static IntPtr Objetivo(IntPtr propia)
    {
        Recordar(propia);
        var h = UltimaAjena;
        return h != IntPtr.Zero && IsWindow(h) && IsWindowVisible(h) && !IsIconic(h) ? h : IntPtr.Zero;
    }

    static readonly HashSet<ControlType> ConTexto = new()
    {
        ControlType.Text, ControlType.Edit, ControlType.Document, ControlType.Button, ControlType.Hyperlink, ControlType.ListItem,
        ControlType.DataItem, ControlType.TabItem, ControlType.MenuItem, ControlType.TreeItem, ControlType.Header, ControlType.HeaderItem,
        ControlType.CheckBox, ControlType.RadioButton, ControlType.ComboBox, ControlType.TitleBar, ControlType.StatusBar, ControlType.Group,
    };

    /// <summary>Texto de la ventana con UI Automation (tope de nodos y de tiempo: una app enorme no congela a AURA).</summary>
    public static string TextoUia(IntPtr ventana, int maxNodos = 2500, int maxMs = 1500, int maxLetras = 9000)
    {
        var sb = new StringBuilder();
        var vistos = new HashSet<string>();
        var reloj = Stopwatch.StartNew();
        var cola = new Queue<AutomationElement>();
        try { cola.Enqueue(AutomationElement.FromHandle(ventana)); } catch { return ""; }
        var walker = TreeWalker.ControlViewWalker;
        int nodos = 0;
        while (cola.Count > 0 && nodos < maxNodos && reloj.ElapsedMilliseconds < maxMs && sb.Length < maxLetras)
        {
            var e = cola.Dequeue(); nodos++;
            try
            {
                var c = e.Current;
                if (c.IsOffscreen && c.ControlType != ControlType.Document) { /* fuera de la vista: igual se recorren sus hijos */ }
                else if (!c.IsPassword && ConTexto.Contains(c.ControlType))
                {
                    string texto = c.Name ?? "";
                    if ((c.ControlType == ControlType.Document || c.ControlType == ControlType.Edit))
                    {
                        if (e.TryGetCurrentPattern(TextPattern.Pattern, out var tp)) texto = ((TextPattern)tp).DocumentRange.GetText(Math.Max(0, maxLetras - sb.Length));
                        else if (e.TryGetCurrentPattern(ValuePattern.Pattern, out var vp)) texto = ((ValuePattern)vp).Current.Value;
                    }
                    texto = texto.Trim();
                    if (texto.Length > 0 && vistos.Add(texto)) sb.AppendLine(texto.Length > 3000 ? texto[..3000] : texto);
                }
                if (c.ControlType == ControlType.Document) continue; // su texto ya vino entero
                for (var h = walker.GetFirstChild(e); h != null; h = walker.GetNextSibling(h)) cola.Enqueue(h);
            }
            catch (ElementNotAvailableException) { }
            catch (InvalidOperationException) { }
        }
        var s = sb.ToString();
        return s.Length > maxLetras ? s[..maxLetras] : s;
    }

    static Bitmap CapturarVentana(IntPtr ventana)
    {
        GetWindowRect(ventana, out var r);
        int w = Math.Max(1, r.Right - r.Left), h = Math.Max(1, r.Bottom - r.Top);
        var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        using var g = Graphics.FromImage(bmp);
        g.CopyFromScreen(r.Left, r.Top, 0, 0, new Size(w, h), CopyPixelOperation.SourceCopy);
        return bmp;
    }

    /// <summary>OCR de Windows sobre una imagen, en este equipo (idiomas del perfil; si no, español o inglés).</summary>
    public static async Task<string> Ocr(Bitmap bmp)
    {
        var motor = global::Windows.Media.Ocr.OcrEngine.TryCreateFromUserProfileLanguages()
                    ?? global::Windows.Media.Ocr.OcrEngine.TryCreateFromLanguage(new global::Windows.Globalization.Language("es"))
                    ?? global::Windows.Media.Ocr.OcrEngine.TryCreateFromLanguage(new global::Windows.Globalization.Language("en"));
        if (motor == null) throw new InvalidOperationException("Windows no tiene un idioma de OCR instalado.");
        // El OCR tiene un tamaño máximo; una pantalla 4K se reduce.
        double f = Math.Min(1, (double)global::Windows.Media.Ocr.OcrEngine.MaxImageDimension / Math.Max(bmp.Width, bmp.Height));
        using var chica = f < 1 ? new Bitmap(bmp, new Size((int)(bmp.Width * f), (int)(bmp.Height * f))) : new Bitmap(bmp);
        using var ms = new MemoryStream();
        chica.Save(ms, ImageFormat.Png);
        using var ras = new global::Windows.Storage.Streams.InMemoryRandomAccessStream();
        await ras.WriteAsync(global::System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions.AsBuffer(ms.ToArray()));
        ras.Seek(0);
        var dec = await global::Windows.Graphics.Imaging.BitmapDecoder.CreateAsync(ras);
        using var sb = await dec.GetSoftwareBitmapAsync(global::Windows.Graphics.Imaging.BitmapPixelFormat.Bgra8, global::Windows.Graphics.Imaging.BitmapAlphaMode.Premultiplied);
        var res = await motor.RecognizeAsync(sb);
        return string.Join("\n", res.Lines.Select(l => l.Text));
    }

    /// <summary>Lee la ventana de trabajo: UI Automation y, si trae poco, OCR. Todo en este equipo.</summary>
    public static async Task<Lectura> Leer(IntPtr propia)
    {
        var h = Objetivo(propia);
        if (h == IntPtr.Zero) throw new InvalidOperationException("No encuentro la ventana en la que estás trabajando. Haz clic en ella y vuelve a pedírmelo.");
        GetWindowThreadProcessId(h, out var pid);
        string proceso = "", titulo = "";
        try { using var p = Process.GetProcessById((int)pid); proceso = p.ProcessName; } catch { }
        try { titulo = AutomationElement.FromHandle(h).Current.Name ?? ""; } catch { }
        var uia = await Task.Run(() => TextoUia(h));
        if (uia.Length >= 200) return new Lectura(titulo, proceso, uia, "uia");
        string ocr = "";
        try { using var bmp = CapturarVentana(h); ocr = await Ocr(bmp); }
        catch (Exception) when (uia.Length > 0) { }
        var texto = (uia + "\n" + ocr).Trim();
        return new Lectura(titulo, proceso, texto, uia.Length > 0 && ocr.Length > 0 ? "uia+ocr" : ocr.Length > 0 ? "ocr" : "uia");
    }
}
