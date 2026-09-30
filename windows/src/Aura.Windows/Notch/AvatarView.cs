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
/// La mirada que sigue al cursor y las reacciones al tocarlo (salto, mareo al tercer toque, corazones
/// si lo acaricias con el ratón) están adaptadas de Coucou (github.com/Louis-CFM/coucou, licencia MIT,
/// © Louis-CFM), con nuestros avatares y sin sus recursos.
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
    string reaccion = ""; double reaccionT, encima; int toques; double ultimoToque = -9;

    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)] struct PUNTO { public int X, Y; }
    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool GetCursorPos(out PUNTO p);

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

    /// <summary>Se deja tocar: un toque lo hace saltar, tres seguidos lo marean y si lo acaricias salen corazones.</summary>
    public bool Tocable
    {
        get => IsHitTestVisible;
        set
        {
            IsHitTestVisible = value;
            Cursor = value ? System.Windows.Input.Cursors.Hand : null;
            MouseLeftButtonUp -= AlTocar;
            if (value) MouseLeftButtonUp += AlTocar;
        }
    }

    public event Action<string>? Reacciono;

    void AlTocar(object s, System.Windows.Input.MouseButtonEventArgs e)
    {
        toques = t - ultimoToque < 0.9 ? toques + 1 : 1;
        ultimoToque = t;
        Reaccionar(toques >= 3 ? "mareo" : "salto");
        if (toques >= 3) toques = 0;
        e.Handled = true;
    }

    /// <summary>salto | mareo | corazones</summary>
    public void Reaccionar(string cual)
    {
        reaccion = cual;
        reaccionT = cual switch { "mareo" => 2.2, "corazones" => 2.4, _ => 0.6 };
        Reacciono?.Invoke(cual);
    }

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
        // La mirada va hacia el cursor si anda cerca; si no, pasea sola.
        var objetivo = new Point(Math.Sin(t * 0.7) * 0.25, Math.Sin(t * 0.43) * 0.12);
        if (GetCursorPos(out var c) && PresentationSource.FromVisual(this) != null)
        {
            try
            {
                var local = PointFromScreen(new Point(c.X, c.Y));
                double dx = local.X - ActualWidth / 2, dy = local.Y - ActualHeight / 2, d = Math.Sqrt(dx * dx + dy * dy);
                if (d < 700) objetivo = new Point(Math.Clamp(dx / 180, -1, 1), Math.Clamp(dy / 140, -1, 1));
            }
            catch (InvalidOperationException) { }
        }
        mirada = new Point(mirada.X + (objetivo.X - mirada.X) * 0.18, mirada.Y + (objetivo.Y - mirada.Y) * 0.18);
        if (reaccionT > 0) { reaccionT -= dt; if (reaccionT <= 0) reaccion = ""; }
        // Acariciarlo (el ratón quieto encima dos segundos) lo pone feliz.
        if (IsHitTestVisible && IsMouseOver) { encima += dt; if (encima > 2 && reaccion == "") { Reaccionar("corazones"); encima = -3; } }
        else encima = 0;
        InvalidateVisual();
    }

    protected override void OnRender(DrawingContext dc)
    {
        var w = ActualWidth; var h = ActualHeight;
        if (w <= 0 || h <= 0) return;
        var s0 = Math.Min(w, h);
        double resto = reaccionT;
        double salto = reaccion == "salto" ? -Math.Abs(Math.Sin(resto / 0.6 * Math.PI)) * s0 * 0.12 : 0;
        double giro = reaccion == "mareo" ? Math.Sin(t * 14) * 9 * Math.Min(1, resto) : mirada.X * 3;
        dc.PushTransform(new TranslateTransform(mirada.X * s0 * 0.025, salto));
        dc.PushTransform(new RotateTransform(giro, w / 2, h * 0.85));
        Cuerpo(dc, w, h);
        dc.Pop(); dc.Pop();
        if (reaccion == "mareo") Estrellas(dc, w, h, resto);
        if (reaccion == "corazones") Corazones(dc, w, h, resto);
    }

    void Estrellas(DrawingContext dc, double w, double h, double resto)
    {
        var s = Math.Min(w, h);
        var oro = new SolidColorBrush(Color.FromArgb((byte)(220 * Math.Min(1, resto)), 0xF6, 0xD3, 0x65));
        for (int i = 0; i < 3; i++)
        {
            double a = t * 5 + i * Math.PI * 2 / 3;
            var p = new Point(w / 2 + Math.Cos(a) * s * 0.32, h * 0.14 + Math.Sin(a) * s * 0.07);
            Estrella(dc, oro, p, s * 0.06);
        }
    }

    static void Estrella(DrawingContext dc, Brush b, Point c, double r)
    {
        var g = new StreamGeometry();
        using (var x = g.Open())
        {
            for (int i = 0; i < 10; i++)
            {
                double a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 == 0 ? r : r * 0.45;
                var p = new Point(c.X + Math.Cos(a) * rr, c.Y + Math.Sin(a) * rr);
                if (i == 0) x.BeginFigure(p, true, true); else x.LineTo(p, true, false);
            }
        }
        g.Freeze();
        dc.DrawGeometry(b, null, g);
    }

    void Corazones(DrawingContext dc, double w, double h, double resto)
    {
        var s = Math.Min(w, h);
        double avance = 2.4 - resto;
        for (int i = 0; i < 3; i++)
        {
            double k = avance - i * 0.35;
            if (k < 0) continue;
            double subida = k / 2.0, alfa = Math.Max(0, 1 - subida);
            var c = new Point(w / 2 + (i - 1) * s * 0.26 + Math.Sin(k * 5 + i) * s * 0.04, h * 0.3 - subida * s * 0.45);
            double r = s * (0.07 + 0.02 * i);
            var g = Geometry.Parse($"M 0,0.3 C 0,-0.15 0.55,-0.2 0.5,0.2 C 0.45,0.5 0,0.75 0,1 C 0,0.75 -0.45,0.5 -0.5,0.2 C -0.55,-0.2 0,-0.15 0,0.3 Z");
            dc.PushTransform(new TranslateTransform(c.X, c.Y));
            dc.PushTransform(new ScaleTransform(r * 2, r * 2));
            dc.DrawGeometry(new SolidColorBrush(Color.FromArgb((byte)(230 * alfa), 0xFF, 0x6B, 0x8B)), null, g);
            dc.Pop(); dc.Pop();
        }
    }

    void Cuerpo(DrawingContext dc, double w, double h)
    {
        if (avatar == "ojos") { Guardian(dc, w, h); return; }
        string clip = reaccion == "mareo" ? "worried" : reaccion == "corazones" ? "happy" : estado switch
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
        double abierto = parpadeo < 0 ? 0.12 : reaccion == "corazones" || estado == "happy" ? 0.55 : estado == "thinking" ? 0.7 : 1;
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
