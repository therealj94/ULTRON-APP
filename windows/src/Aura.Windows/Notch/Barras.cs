using System;
using System.Windows;
using System.Windows.Media;
using System.Windows.Threading;
using Aura.Windows.Marca;

namespace Aura.Windows.Notch;

/// <summary>
/// Las barritas de la música en el reposo: finas (1,5 px), de canto recto, siguiendo el nivel. Sin pastillas gordas
/// de ecualizador. Dibujar no crea nada: rectángulos (structs) con el pincel del acento.
/// </summary>
internal sealed class Barras : FrameworkElement
{
    readonly DispatcherTimer reloj = new(DispatcherPriority.Render) { Interval = TimeSpan.FromMilliseconds(1000.0 / 40) };
    readonly double[] alturas = new double[5];
    readonly double[] fases = { 0.0, 1.7, 0.6, 2.4, 1.1 };
    double nivel, t;

    public Barras()
    {
        IsHitTestVisible = false;
        reloj.Tick += (_, _) => { if (!IsVisible) return; if (!AvatarView.MenosMovimiento) t += 0.025; Avanzar(); InvalidateVisual(); };
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
        const double ancho = 1.5;
        double hueco = (w - ancho * alturas.Length) / (alturas.Length - 1);
        for (int i = 0; i < alturas.Length; i++)
        {
            double bh = Math.Max(2, alturas[i] * h);
            dc.DrawRectangle(brocha, null, new Rect(i * (ancho + hueco), (h - bh) / 2, ancho, bh));
        }
    }
}

/// <summary>
/// La voz como onda grabada (DIRECCION.md, «Voz»): tres trazos finos de 1,5 px, como el buril sobre el metal,
/// que crecen con el nivel real del audio y se afinan hacia las puntas. En silencio, una sola línea quieta
/// (y entonces no se redibuja). Sirve para la voz de AURA (oro) y para la tuya al escuchar (cardenillo).
/// Dibujar no crea objetos: segmentos con plumas congeladas que solo se rehacen si cambia la tinta.
/// </summary>
internal sealed class Onda : FrameworkElement
{
    const int Tramos = 40;
    static readonly double[] Amplitudes = { 1, 0.62, 0.34 }, Frecuencias = { 2.4, 1.7, 3.1 }, Desfases = { 0, 2.1, 4.0 }, Opacidades = { 1, 0.5, 0.28 };
    readonly DispatcherTimer reloj = new(DispatcherPriority.Render) { Interval = TimeSpan.FromMilliseconds(1000.0 / 40) };
    readonly Pen?[] plumas = new Pen?[3];
    Color tintaPlumas;
    double nivel, suave, t;
    bool planaDibujada;

    public static readonly DependencyProperty TintaProperty = DependencyProperty.Register(nameof(Tinta), typeof(Brush), typeof(Onda),
        new FrameworkPropertyMetadata(null, FrameworkPropertyMetadataOptions.AffectsRender));
    /// <summary>La tinta de los trazos; sin ella, el acento del avatar.</summary>
    public Brush? Tinta { get => (Brush?)GetValue(TintaProperty); set => SetValue(TintaProperty, value); }

    public Onda()
    {
        IsHitTestVisible = false;
        reloj.Tick += (_, _) => Tic();
        Loaded += (_, _) => reloj.Start();
        Unloaded += (_, _) => reloj.Stop();
    }

    /// <summary>0..1: cuánto suena ahora.</summary>
    public double Nivel { get => nivel; set => nivel = Math.Clamp(value, 0, 1); }

    /// <summary>Sin transición: la onda ya en su nivel (las capturas del CI se toman sin que corra el reloj).</summary>
    public void Asentar() { suave = nivel; planaDibujada = false; InvalidateVisual(); }

    void Tic()
    {
        if (!IsVisible) return;
        // Sube rápido y baja despacio, como la aguja de un vúmetro.
        suave += (nivel - suave) * (nivel > suave ? 0.5 : 0.14);
        if (suave < 0.002 && nivel == 0) { suave = 0; if (planaDibujada) return; }
        if (!AvatarView.MenosMovimiento) t += 1.0 / 40;
        InvalidateVisual();
    }

    Pen Pluma(int i, Color c)
    {
        if (plumas[i] is { } p && c == tintaPlumas) return p;
        if (c != tintaPlumas) { Array.Clear(plumas); tintaPlumas = c; }
        var pincel = new SolidColorBrush(c) { Opacity = Opacidades[i] }; pincel.Freeze();
        p = new Pen(pincel, 1.5) { StartLineCap = PenLineCap.Round, EndLineCap = PenLineCap.Round, LineJoin = PenLineJoin.Round };
        p.Freeze();
        return plumas[i] = p;
    }

    protected override void OnRender(DrawingContext dc)
    {
        double w = ActualWidth, h = ActualHeight;
        if (w <= 0 || h <= 0) return;
        var color = (Tinta as SolidColorBrush)?.Color ?? (TryFindResource("Acento") as SolidColorBrush)?.Color ?? Contraste.OroCrudo;
        double medio = h / 2, alto = suave * (h / 2 - 1);
        planaDibujada = alto < 0.05;
        if (planaDibujada) { dc.DrawLine(Pluma(0, color), new Point(1, medio), new Point(w - 1, medio)); return; }
        for (int k = Amplitudes.Length - 1; k >= 0; k--)
        {
            var pluma = Pluma(k, color);
            Point antes = default;
            for (int i = 0; i <= Tramos; i++)
            {
                double u = (double)i / Tramos;
                // Las puntas se afinan (como el trazo del buril al entrar y salir del metal).
                double sobre = Math.Pow(Math.Sin(Math.PI * u), 1.5);
                double y = medio + alto * Amplitudes[k] * sobre * Math.Sin(u * Math.PI * 2 * Frecuencias[k] + t * (5 + k) + Desfases[k]);
                var p = new Point(1 + u * (w - 2), y);
                if (i > 0) dc.DrawLine(pluma, antes, p);
                antes = p;
            }
        }
    }
}

/// <summary>
/// El canto estriado (DIRECCION.md, «Pensando»): las estrías del canto de una moneda que gira despacio, vistas de
/// frente; más juntas hacia los lados, más tenues donde el canto se aleja. Reemplaza a los tres puntos.
/// Dibujar no crea objetos: ocho plumas congeladas por intensidad, rehechas solo si cambia el acento.
/// </summary>
internal sealed class Canto : FrameworkElement
{
    const int Estrias = 44, Niveles = 8;
    readonly DispatcherTimer reloj = new(DispatcherPriority.Render) { Interval = TimeSpan.FromMilliseconds(1000.0 / 30) };
    readonly Pen?[] plumas = new Pen?[Niveles];
    Pen? borde;
    Color tintaPlumas;
    double giro;
    bool dibujadoQuieto;

    public Canto()
    {
        IsHitTestVisible = false;
        reloj.Tick += (_, _) =>
        {
            if (!IsVisible) { dibujadoQuieto = false; return; }
            if (AvatarView.MenosMovimiento) { if (dibujadoQuieto) return; dibujadoQuieto = true; }
            else giro += 0.55 / 30; // despacio: una estría cada ~0,26 s
            InvalidateVisual();
        };
        Loaded += (_, _) => reloj.Start();
        Unloaded += (_, _) => reloj.Stop();
    }

    void Plumas(Color c)
    {
        if (c == tintaPlumas && borde != null) return;
        tintaPlumas = c;
        for (int i = 0; i < Niveles; i++)
        {
            var b = new SolidColorBrush(c) { Opacity = 0.18 + 0.82 * i / (Niveles - 1) }; b.Freeze();
            var p = new Pen(b, 1) { StartLineCap = PenLineCap.Flat, EndLineCap = PenLineCap.Flat }; p.Freeze();
            plumas[i] = p;
        }
        var bb = new SolidColorBrush(c) { Opacity = 0.32 }; bb.Freeze();
        borde = new Pen(bb, 1); borde.Freeze();
    }

    protected override void OnRender(DrawingContext dc)
    {
        double w = ActualWidth, h = ActualHeight;
        if (w <= 0 || h <= 0) return;
        Plumas((TryFindResource("Acento") as SolidColorBrush)?.Color ?? Contraste.OroCrudo);
        // Los dos filos del canto.
        dc.DrawLine(borde, new Point(0, 0.5), new Point(w, 0.5));
        dc.DrawLine(borde, new Point(0, h - 0.5), new Point(w, h - 0.5));
        double r = w / 2;
        for (int i = 0; i < Estrias; i++)
        {
            double a = giro + i * Math.PI * 2 / Estrias;
            double frente = Math.Cos(a);
            if (frente <= 0.05) continue; // la mitad de atrás no se ve
            double x = r + r * Math.Sin(a);
            int nivel = Math.Clamp((int)(frente * Niveles), 0, Niveles - 1);
            dc.DrawLine(plumas[nivel], new Point(x, 2.5), new Point(x, h - 2.5));
        }
    }
}
