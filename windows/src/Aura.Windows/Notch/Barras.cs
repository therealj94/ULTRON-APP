using System;
using System.Windows;
using System.Windows.Media;
using System.Windows.Threading;

namespace Aura.Windows.Notch;

/// <summary>Las barras de la voz (la tuya al escuchar, la de AURA al hablar): siguen el nivel real del audio.</summary>
internal sealed class Barras : FrameworkElement
{
    readonly DispatcherTimer reloj = new(DispatcherPriority.Render) { Interval = TimeSpan.FromMilliseconds(1000.0 / 40) };
    readonly double[] alturas = new double[5];
    readonly double[] fases = { 0.0, 1.7, 0.6, 2.4, 1.1 };
    double nivel, t;

    public Barras()
    {
        IsHitTestVisible = false;
        reloj.Tick += (_, _) => { if (!IsVisible) return; t += 0.025; Avanzar(); InvalidateVisual(); };
        Loaded += (_, _) => reloj.Start();
        Unloaded += (_, _) => reloj.Stop();
    }

    /// <summary>0..1</summary>
    public double Nivel { get => nivel; set => nivel = Math.Clamp(value, 0, 1); }

    void Avanzar()
    {
        for (int i = 0; i < alturas.Length; i++)
        {
            // Cada barra con su vaivén, todas empujadas por el nivel; las del centro, más altas.
            double centro = 1 - Math.Abs(i - 2) * 0.18;
            double objetivo = 0.14 + nivel * centro * (0.65 + 0.35 * Math.Sin(t * 9 + fases[i]));
            alturas[i] += (objetivo - alturas[i]) * (objetivo > alturas[i] ? 0.55 : 0.2);
        }
    }

    protected override void OnRender(DrawingContext dc)
    {
        double w = ActualWidth, h = ActualHeight;
        if (w <= 0 || h <= 0) return;
        var brocha = (Brush)(TryFindResource("Acento") ?? Brushes.White);
        double ancho = Math.Min(4, w / (alturas.Length * 2));
        double hueco = (w - ancho * alturas.Length) / (alturas.Length - 1);
        for (int i = 0; i < alturas.Length; i++)
        {
            double bh = Math.Max(ancho, alturas[i] * h);
            dc.DrawRoundedRectangle(brocha, null, new Rect(i * (ancho + hueco), (h - bh) / 2, ancho, bh), ancho / 2, ancho / 2);
        }
    }
}

/// <summary>Tres puntos que respiran en ola mientras AURA piensa.</summary>
internal sealed class Puntos : FrameworkElement
{
    readonly DispatcherTimer reloj = new(DispatcherPriority.Render) { Interval = TimeSpan.FromMilliseconds(1000.0 / 30) };
    double t;

    public Puntos()
    {
        IsHitTestVisible = false;
        reloj.Tick += (_, _) => { if (!IsVisible) return; t += 1.0 / 30; InvalidateVisual(); };
        Loaded += (_, _) => reloj.Start();
        Unloaded += (_, _) => reloj.Stop();
    }

    protected override void OnRender(DrawingContext dc)
    {
        double w = ActualWidth, h = ActualHeight;
        if (w <= 0 || h <= 0) return;
        var acento = (TryFindResource("Acento") as SolidColorBrush)?.Color ?? Colors.White;
        for (int i = 0; i < 3; i++)
        {
            double f = (Math.Sin(t * 5 - i * 0.9) + 1) / 2;
            var b = new SolidColorBrush(Color.FromArgb((byte)(90 + 165 * f), acento.R, acento.G, acento.B));
            dc.DrawEllipse(b, null, new Point(w / 2 + (i - 1) * w / 3.2, h / 2 - f * h * 0.25), 3 + f * 1.2, 3 + f * 1.2);
        }
    }
}
