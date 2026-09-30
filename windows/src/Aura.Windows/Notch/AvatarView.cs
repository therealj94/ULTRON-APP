using System;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;

namespace Aura.Windows.Notch;

/// <summary>
/// El avatar vivo del notch: AU-RA, Claudio y ANT-ONIO son sus modelos 3D de la app renderizados a
/// hojas de 24 fotogramas (windows/scripts/render-avatares.cjs); el Guardián son sus ojos celestes,
/// dibujados aquí. Estados: idle, listening, thinking, happy, worried, speaking. Al hablar, la boca
/// sigue el NIVEL real del audio (tres aperturas).
/// </summary>
internal sealed class AvatarView : FrameworkElement
{
    static readonly Dictionary<string, BitmapSource[]> Cache = new();
    static readonly string[] Clips = { "idle", "listening", "thinking", "happy", "worried", "speak0", "speak1", "speak2" };
    readonly DispatcherTimer reloj = new(DispatcherPriority.Render) { Interval = TimeSpan.FromMilliseconds(1000.0 / 30) };
    string avatar = "aura", estado = "idle";
    double boca, bocaSuave, t;
    int fotograma, direccion = 1;
    double acumulado;
    double parpadeo = 3;
    Point mirada;

    public AvatarView()
    {
        reloj.Tick += (_, _) => Avanzar();
        Loaded += (_, _) => reloj.Start();
        Unloaded += (_, _) => reloj.Stop();
        IsHitTestVisible = false;
        RenderOptions.SetBitmapScalingMode(this, BitmapScalingMode.HighQuality);
    }

    public string Avatar
    {
        get => avatar;
        set { if (avatar == value) return; avatar = value; fotograma = 0; InvalidateVisual(); }
    }

    /// <summary>idle | listening | thinking | happy | worried | speaking</summary>
    public string Estado
    {
        get => estado;
        set { if (estado == value) return; estado = value; InvalidateVisual(); }
    }

    /// <summary>0..1: cuánto suena la voz ahora mismo.</summary>
    public double Boca { get => boca; set => boca = Math.Clamp(value, 0, 1); }

    public bool Quieto { get; set; }

    static BitmapSource[] Hoja(string avatar, string clip)
    {
        var k = avatar + "/" + clip;
        if (Cache.TryGetValue(k, out var c)) return c;
        var bmp = new BitmapImage();
        bmp.BeginInit();
        bmp.UriSource = new Uri($"pack://application:,,,/AvatarAssets/{avatar}/{clip}.png");
        bmp.CacheOption = BitmapCacheOption.OnLoad;
        bmp.EndInit();
        bmp.Freeze();
        var cuadros = new BitmapSource[24];
        for (int i = 0; i < 24; i++) { var r = new CroppedBitmap(bmp, new Int32Rect(i % 6 * 192, i / 6 * 192, 192, 192)); r.Freeze(); cuadros[i] = r; }
        return Cache[k] = cuadros;
    }

    /// <summary>Carga de antemano las hojas del avatar (el primer cambio de estado no titubea).</summary>
    public static void Precargar(string avatar)
    {
        if (avatar == "ojos") return;
        foreach (var c in Clips) Hoja(avatar, c);
    }

    void Avanzar()
    {
        if (!IsVisible) return;
        const double dt = 1.0 / 30;
        t += dt;
        // La boca sube rápido y baja despacio, como una boca de verdad.
        bocaSuave += (boca - bocaSuave) * (boca > bocaSuave ? 0.6 : 0.25);
        if (!Quieto && SystemParameters.ClientAreaAnimation)
        {
            acumulado += dt;
            double paso = estado == "speaking" ? 1.0 / 14 : 1.0 / 10;
            while (acumulado >= paso)
            {
                acumulado -= paso;
                // Ida y vuelta: los clips no cierran en bucle perfecto; así no hay salto.
                fotograma += direccion;
                if (fotograma >= 23) { fotograma = 23; direccion = -1; }
                if (fotograma <= 0) { fotograma = 0; direccion = 1; }
            }
        }
        parpadeo -= dt;
        if (parpadeo < -0.14) parpadeo = 2.5 + (t * 7919 % 3);
        mirada = new Point(Math.Sin(t * 0.7) * 0.25, Math.Sin(t * 0.43) * 0.12);
        InvalidateVisual();
    }

    protected override void OnRender(DrawingContext dc)
    {
        var w = ActualWidth; var h = ActualHeight;
        if (w <= 0 || h <= 0) return;
        if (avatar == "ojos") { Guardian(dc, w, h); return; }
        string clip = estado switch
        {
            "speaking" => bocaSuave > 0.42 ? "speak2" : bocaSuave > 0.12 ? "speak1" : "speak0",
            "listening" or "thinking" or "happy" or "worried" => estado,
            _ => "idle",
        };
        try
        {
            var cuadros = Hoja(avatar, clip);
            var s = Math.Min(w, h);
            dc.DrawImage(cuadros[Math.Clamp(fotograma, 0, 23)], new Rect((w - s) / 2, (h - s) / 2, s, s));
        }
        catch { Guardian(dc, w, h); }
    }

    /// <summary>El Guardián: dos ojos celestes que miran, parpadean y laten con la voz.</summary>
    void Guardian(DrawingContext dc, double w, double h)
    {
        var s = Math.Min(w, h);
        var c = new Point(w / 2, h / 2);
        var cian = Color.FromRgb(0x5C, 0xE1, 0xFF);
        double abierto = parpadeo < 0 ? 0.12 : estado == "happy" ? 0.55 : estado == "thinking" ? 0.7 : 1;
        double latido = estado == "speaking" ? 1 + bocaSuave * 0.25 : estado == "listening" ? 1 + Math.Sin(t * 6) * 0.05 : 1;
        var halo = new RadialGradientBrush(Color.FromArgb(90, cian.R, cian.G, cian.B), Color.FromArgb(0, cian.R, cian.G, cian.B));
        foreach (var lado in new[] { -1, 1 })
        {
            var ojo = new Point(c.X + lado * s * 0.2 + mirada.X * s * 0.06, c.Y + mirada.Y * s * 0.05 - (estado == "thinking" ? s * 0.04 : 0));
            double rx = s * 0.13 * latido, ry = s * 0.17 * latido * abierto;
            dc.DrawEllipse(halo, null, ojo, rx * 2.2, Math.Max(ry, s * 0.05) * 2.2);
            dc.DrawEllipse(new SolidColorBrush(cian), null, ojo, rx, Math.Max(ry, s * 0.012));
            if (abierto > 0.3) dc.DrawEllipse(new SolidColorBrush(Color.FromArgb(230, 255, 255, 255)), null, new Point(ojo.X - rx * 0.3, ojo.Y - ry * 0.35), rx * 0.25, ry * 0.2);
        }
    }
}
