using System;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Shapes;
using System.Windows.Threading;
using Aura.Windows.Marca;

namespace Aura.Windows.Arranque;

/// <summary>Qué pantalla de arranque toca: la completa (abierta a mano) o la corta (al entrar a Windows, tras actualizar).</summary>
internal enum TipoArranque { Completo, Corto }

/// <summary>
/// La pantalla de arranque corre en su propio hilo (con su propio Dispatcher): mientras el notch se prepara en el
/// hilo de la app, el golpe no se traba, y el notch no espera a nadie. Al terminar avisa una sola vez
/// (<see cref="AlTerminar"/>) para que el notch aparezca donde se encogió la placa.
/// </summary>
internal sealed class Arranque
{
    readonly object candado = new();
    Action? alTerminar;
    bool terminado;
    Point? destino;
    bool destinoAbajo;

    Arranque() { }

    /// <summary>Abre la pantalla de arranque en su hilo y vuelve enseguida.</summary>
    public static Arranque Mostrar(TipoArranque tipo)
    {
        var a = new Arranque();
        var hilo = new Thread(() => a.Correr(tipo)) { IsBackground = true, Name = "AURA arranque" };
        hilo.SetApartmentState(ApartmentState.STA);
        hilo.Start();
        return a;
    }

    void Correr(TipoArranque tipo)
    {
        try
        {
            var d = Dispatcher.CurrentDispatcher;
            // Un error aquí no puede tumbar AURA: se anota, se cierra la placa y el notch aparece igual.
            d.UnhandledException += (_, e) =>
            {
                e.Handled = true;
                Anotar(e.Exception);
                Terminar();
                d.BeginInvokeShutdown(DispatcherPriority.Normal);
            };
            var v = new ArranqueWindow(tipo, this);
            v.Closed += (_, _) => { Terminar(); d.BeginInvokeShutdown(DispatcherPriority.Background); };
            v.Show();
            Dispatcher.Run();
        }
        catch (Exception ex) { Anotar(ex); }
        finally { Terminar(); }
    }

    static void Anotar(Exception ex)
    {
        try { Centro.Registro.Anotar("arranque", "la pantalla de arranque falló (sigo sin ella): " + ex.GetBaseException().Message); } catch { }
    }

    /// <summary>Dónde quedó el notch (centro de la píldora, en DIP de pantalla). Lo pone el hilo de la app.</summary>
    public void FijarDestino(Point centro, bool abajo)
    {
        lock (candado) { destino = centro; destinoAbajo = abajo; }
    }

    internal (Point? Punto, bool Abajo) Destino { get { lock (candado) return (destino, destinoAbajo); } }

    /// <summary>Lo que hay que hacer cuando la placa llega al notch. Si ya llegó, se hace ya (en el hilo que llama).</summary>
    public void AlTerminar(Action a)
    {
        bool ya;
        lock (candado) { ya = terminado; if (!ya) alTerminar = a; }
        if (ya) a();
    }

    internal void Terminar()
    {
        Action? a;
        lock (candado) { if (terminado) return; terminado = true; a = alTerminar; alTerminar = null; }
        try { a?.Invoke(); } catch (Exception ex) { Anotar(ex); }
    }
}

/// <summary>
/// «El golpe» (DIRECCION.md, «La pantalla de arranque»): la placa de obsidiana, el punzón que llega desde el fondo,
/// el golpe (destello de 70 ms y sacudida de 2 px; el «AU» queda calado), el canto estriado que gira 18° y se
/// detiene, «AU·RA FP» con el tracking cerrándose, el filo grabado, la firma, y todo se encoge hacia el notch.
/// ≈ 2,2 s; la corta ≈ 0,9 s; con movimiento reducido, la marca quieta 600 ms y un fundido.
/// Clic, Esc o cualquier tecla la saltan. Todo es transform/opacidad; nada se recalcula por fotograma.
/// </summary>
internal sealed class ArranqueWindow : Window
{
    const double AnchoVentana = 560, LadoMarca = 172, LadoPunzon = 124;
    readonly Arranque dueno;
    readonly TipoArranque tipo;
    readonly bool quieto = !SystemParameters.ClientAreaAnimation;

    readonly Grid placa = new();
    readonly ScaleTransform escalaPlaca = new(1, 1);
    readonly TranslateTransform movPlaca = new();
    readonly Border fondo;
    readonly TranslateTransform sacudida = new();
    readonly ScaleTransform llegada = new(1, 1, 256, 256);
    readonly Canvas cara = new() { Width = 512, Height = 512 };
    readonly Path letras, luzLetras, destello;
    readonly Path canto, bordesCanto;
    readonly RotateTransform giroCanto = new(0, LadoMarca / 2, LadoMarca / 2);
    readonly Rotulo nombre, fp, firma;
    readonly Rectangle filo;
    readonly ScaleTransform escalaFilo = new(0, 1);
    readonly double anchoPlaca, altoPlaca;
    bool saliendo;
    readonly DispatcherTimer limite = new() { Interval = TimeSpan.FromSeconds(4) };

    public ArranqueWindow(TipoArranque tipo, Arranque dueno)
    {
        this.tipo = tipo; this.dueno = dueno;
        Title = "AURA";
        WindowStyle = WindowStyle.None; AllowsTransparency = true; Background = Brushes.Transparent;
        ResizeMode = ResizeMode.NoResize; ShowInTaskbar = false; Topmost = true; ShowActivated = true;
        Focusable = true; UseLayoutRounding = false;
        // Una franja alta y angosta del monitor principal: de arriba abajo, para que la placa pueda encogerse hacia el
        // notch (arriba o abajo) sin salirse de la ventana; angosta para que la ventana transparente cueste poco.
        Width = AnchoVentana; Height = SystemParameters.PrimaryScreenHeight;
        Left = (SystemParameters.PrimaryScreenWidth - AnchoVentana) / 2; Top = 0;

        bool corto = tipo == TipoArranque.Corto;
        anchoPlaca = corto ? 300 : 440; altoPlaca = corto ? 300 : 420;

        var lienzo = new Canvas();
        Content = lienzo;

        placa.Width = anchoPlaca; placa.Height = altoPlaca;
        placa.RenderTransformOrigin = new Point(0.5, 0.5);
        placa.RenderTransform = new TransformGroup { Children = { escalaPlaca, movPlaca } };
        Canvas.SetLeft(placa, (AnchoVentana - anchoPlaca) / 2);
        Canvas.SetTop(placa, Math.Round(Height * 0.47 - altoPlaca / 2));
        lienzo.Children.Add(placa);

        // 1) Obsidiana con una viñeta muy leve y un filo neutro de 1 px.
        fondo = new Border
        {
            Background = Contraste.Pincel(Contraste.Obsidiana), CornerRadius = new CornerRadius(8),
            BorderBrush = Contraste.Pincel(Contraste.Linea), BorderThickness = new Thickness(1), Opacity = 0,
            Child = new Border
            {
                CornerRadius = new CornerRadius(8), IsHitTestVisible = false,
                Background = Vineta(),
            },
        };
        placa.Children.Add(fondo);

        var pila = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        placa.Children.Add(pila);

        // La marca: el canto estriado alrededor y el punzón al centro (geometria.txt, caja de 512).
        var marca = new Canvas { Width = LadoMarca, Height = LadoMarca, HorizontalAlignment = HorizontalAlignment.Center, RenderTransform = sacudida };
        pila.Children.Add(marca);
        canto = new Path { Data = Estrias(LadoMarca / 2, 73, 80, 144), Stroke = Contraste.Pincel(Contraste.OroCrudo), StrokeThickness = 1, Opacity = 0, RenderTransform = giroCanto };
        bordesCanto = new Path
        {
            Data = Bordes(LadoMarca / 2, 71.5, 81.5), Stroke = Contraste.Pincel(Contraste.OroCrudo, 0.35), StrokeThickness = 1, Opacity = 0, RenderTransform = giroCanto,
        };
        marca.Children.Add(bordesCanto); marca.Children.Add(canto);

        double k = LadoPunzon / 512, m = (LadoMarca - LadoPunzon) / 2;
        cara.RenderTransform = new TransformGroup { Children = { llegada, new ScaleTransform(k, k), new TranslateTransform(m, m) } };
        cara.Opacity = 0;
        cara.Children.Add(new Path { Data = Contraste.Punzon, Fill = Contraste.OroMarca });
        cara.Children.Add(new Path { Data = Contraste.Bisel, Stroke = Contraste.Pincel(Color.FromRgb(0x3B, 0x2C, 0x12), 0.55), StrokeThickness = 4 });
        // El calado: debajo del hueco, un filo de luz corrido abajo a la derecha (lo hundido recibe la luz del otro lado).
        luzLetras = new Path { Data = Contraste.Letras, Fill = Contraste.Pincel(Contraste.OroPulido, 0.5), Opacity = 0, RenderTransform = new TranslateTransform(3, 3) };
        letras = new Path { Data = Contraste.Letras, Fill = Contraste.Hueco, Opacity = 0 };
        destello = new Path { Data = Contraste.Punzon, Fill = Contraste.Pincel(Contraste.OroPulido), Opacity = 0 };
        cara.Children.Add(luzLetras); cara.Children.Add(letras); cara.Children.Add(destello);
        marca.Children.Add(cara);

        // «AU·RA FP», el filo grabado y la firma.
        var palabra = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 26, 0, 0) };
        nombre = new Rotulo { Texto = "AU·RA", Tamano = 28, Tracking = 0.40, Tinta = Contraste.Pincel(Contraste.Papel), Opacity = 0 };
        fp = new Rotulo { Texto = "FP", Mono = true, Tamano = 28 * 0.45, Tracking = 0.12, Tinta = Contraste.Pincel(Contraste.OroCrudo), Opacity = 0, Margin = new Thickness(8, 0, 0, 4), VerticalAlignment = VerticalAlignment.Bottom };
        palabra.Children.Add(nombre); palabra.Children.Add(fp);
        filo = new Rectangle
        {
            Height = 1, Width = 176, Margin = new Thickness(0, 12, 0, 0), HorizontalAlignment = HorizontalAlignment.Center,
            Fill = FiloOro(), RenderTransformOrigin = new Point(0.5, 0.5), RenderTransform = escalaFilo, SnapsToDevicePixels = true,
        };
        firma = new Rotulo { Texto = "POWERED BY ORDEN GLOBAL", Mono = true, Tamano = 11, Tracking = 0.18, Tinta = Contraste.Pincel(Contraste.Ceniza), Opacity = 0, Margin = new Thickness(0, 14, 0, 0), HorizontalAlignment = HorizontalAlignment.Center };
        if (!corto) { pila.Children.Add(palabra); pila.Children.Add(filo); pila.Children.Add(firma); }

        ContentRendered += (_, _) => Empezar();
        PreviewKeyDown += (_, e) => { e.Handled = true; Saltar(); };
        placa.MouseLeftButtonDown += (_, e) => { e.Handled = true; Saltar(); };
        limite.Tick += (_, _) => { limite.Stop(); Close(); };
        Closed += (_, _) => limite.Stop();
    }

    static Brush Vineta()
    {
        var b = new RadialGradientBrush { GradientOrigin = new Point(0.5, 0.42), Center = new Point(0.5, 0.42), RadiusX = 0.75, RadiusY = 0.75 };
        b.GradientStops.Add(new GradientStop(Color.FromArgb(0x00, 0, 0, 0), 0.45));
        b.GradientStops.Add(new GradientStop(Color.FromArgb(0x48, 0, 0, 0), 1));
        b.Freeze();
        return b;
    }

    static Brush FiloOro()
    {
        var b = new LinearGradientBrush { StartPoint = new Point(0, 0), EndPoint = new Point(1, 0) };
        b.GradientStops.Add(new GradientStop(Color.FromArgb(0, Contraste.OroCrudo.R, Contraste.OroCrudo.G, Contraste.OroCrudo.B), 0));
        b.GradientStops.Add(new GradientStop(Contraste.OroCrudo, 0.2));
        b.GradientStops.Add(new GradientStop(Contraste.OroCrudo, 0.8));
        b.GradientStops.Add(new GradientStop(Color.FromArgb(0, Contraste.OroCrudo.R, Contraste.OroCrudo.G, Contraste.OroCrudo.B), 1));
        b.Freeze();
        return b;
    }

    /// <summary>El canto estriado de una moneda: muchas estrías radiales cortas entre dos radios.</summary>
    static Geometry Estrias(double c, double r1, double r2, int n)
    {
        var g = new StreamGeometry();
        using (var x = g.Open())
        {
            for (int i = 0; i < n; i++)
            {
                double a = i * Math.PI * 2 / n, cos = Math.Cos(a), sin = Math.Sin(a);
                x.BeginFigure(new Point(c + cos * r1, c + sin * r1), false, false);
                x.LineTo(new Point(c + cos * r2, c + sin * r2), true, false);
            }
        }
        g.Freeze();
        return g;
    }

    static Geometry Bordes(double c, double r1, double r2)
    {
        var g = new GeometryGroup { Children = { new EllipseGeometry(new Point(c, c), r1, r1), new EllipseGeometry(new Point(c, c), r2, r2) } };
        g.Freeze();
        return g;
    }

    // ───────────── la línea de tiempo ─────────────

    /// <summary>Un tramo: quieto en <paramref name="desde"/> hasta <paramref name="inicio"/> ms, y de ahí a <paramref name="hasta"/> en <paramref name="dur"/> ms.</summary>
    static void Tramo(IAnimatable o, DependencyProperty p, double desde, double hasta, double inicio, double dur, KeySpline? curva = null)
    {
        var a = new DoubleAnimationUsingKeyFrames { FillBehavior = FillBehavior.HoldEnd };
        a.KeyFrames.Add(new DiscreteDoubleKeyFrame(desde, KeyTime.FromTimeSpan(TimeSpan.Zero)));
        if (inicio > 0) a.KeyFrames.Add(new LinearDoubleKeyFrame(desde, KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(inicio))));
        a.KeyFrames.Add(new SplineDoubleKeyFrame(hasta, KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(inicio + dur)), curva ?? Contraste.Golpe));
        a.Freeze();
        o.BeginAnimation(p, a);
    }

    /// <summary>Valores sueltos en el tiempo (ms → valor), en línea recta entre ellos: el destello y la sacudida.</summary>
    static void Puntos(IAnimatable o, DependencyProperty p, params (double Ms, double Valor)[] puntos)
    {
        var a = new DoubleAnimationUsingKeyFrames { FillBehavior = FillBehavior.HoldEnd };
        a.KeyFrames.Add(new DiscreteDoubleKeyFrame(puntos[0].Valor, KeyTime.FromTimeSpan(TimeSpan.Zero)));
        foreach (var (ms, v) in puntos) a.KeyFrames.Add(new LinearDoubleKeyFrame(v, KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(ms))));
        a.Freeze();
        o.BeginAnimation(p, a);
    }

    void Despues(double ms, Action hacer)
    {
        var t = new DispatcherTimer(DispatcherPriority.Render) { Interval = TimeSpan.FromMilliseconds(ms) };
        t.Tick += (_, _) => { t.Stop(); hacer(); };
        t.Start();
    }

    void Empezar()
    {
        try { Activate(); Focus(); } catch { }
        limite.Start();
        if (quieto) { Quieta(); return; }
        // La corta (al entrar a Windows): solo la llegada del punzón, el golpe y el encogerse (pasos 2, 3 y 7).
        bool corto = tipo == TipoArranque.Corto;
        double golpe = corto ? 440 : 520;
        Tramo(fondo, OpacityProperty, 0, 1, 0, corto ? 80 : 120, Contraste.Salida);
        // 2) El punzón llega desde el fondo: 1.12 → 1 y se enciende, 380 ms.
        double llega = golpe - 60 - 380;
        Tramo(cara, OpacityProperty, 0, 1, llega, 240, Contraste.Salida);
        // (la escala de la llegada va en la misma animación que la del golpe, ver Golpe)
        // 3) El golpe: el punzón se planta (1.04 → 1), un destello de oro pulido de 70 ms y una sacudida de 2 px; el «AU» queda calado.
        Golpe(golpe, llega);
        if (!corto)
        {
            // 4) El canto: aparece con el golpe, gira 18° y se detiene (600 ms, ease-out).
            Tramo(canto, OpacityProperty, 0, 0.62, golpe, 200, Contraste.Salida);
            Tramo(bordesCanto, OpacityProperty, 0, 1, golpe, 200, Contraste.Salida);
            Tramo(giroCanto, RotateTransform.AngleProperty, 0, 18, golpe + 40, 600, Contraste.Golpe);
            // 5) «AU·RA FP»: el tracking se cierra de +40 % a +12 % (420 ms); debajo se graba el filo.
            Tramo(nombre, OpacityProperty, 0, 1, 900, 220, Contraste.Salida);
            Tramo(nombre, Rotulo.TrackingProperty, 0.40, 0.12, 900, 420);
            Tramo(fp, OpacityProperty, 0, 1, 1080, 240, Contraste.Salida);
            Tramo(escalaFilo, ScaleTransform.ScaleXProperty, 0, 1, 1200, 280);
            // 6) La firma, 200 ms.
            Tramo(firma, OpacityProperty, 0, 1, 1400, 200, Contraste.Salida);
        }
        // 7) Se encoge hacia el notch.
        Despues(corto ? 580 : 1880, Salir);
    }

    void Golpe(double t, double llega)
    {
        var escala = new DoubleAnimationUsingKeyFrames { FillBehavior = FillBehavior.HoldEnd };
        escala.KeyFrames.Add(new DiscreteDoubleKeyFrame(1.12, KeyTime.FromTimeSpan(TimeSpan.Zero)));
        escala.KeyFrames.Add(new LinearDoubleKeyFrame(1.12, KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(llega))));
        escala.KeyFrames.Add(new SplineDoubleKeyFrame(1, KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(llega + 380)), Contraste.Golpe));
        escala.KeyFrames.Add(new LinearDoubleKeyFrame(1, KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(t))));
        escala.KeyFrames.Add(new DiscreteDoubleKeyFrame(1.04, KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(t + 1))));
        escala.KeyFrames.Add(new SplineDoubleKeyFrame(1, KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(t + 200)), Contraste.Golpe));
        escala.Freeze();
        llegada.BeginAnimation(ScaleTransform.ScaleXProperty, escala);
        llegada.BeginAnimation(ScaleTransform.ScaleYProperty, escala);
        Puntos(destello, OpacityProperty, (0, 0), (t, 0), (t + 12, 0.85), (t + 70, 0));
        Puntos(sacudida, TranslateTransform.XProperty, (0, 0), (t, 0), (t + 20, 2), (t + 45, -2), (t + 70, 1.2), (t + 95, -0.6), (t + 120, 0));
        Puntos(letras, OpacityProperty, (0, 0), (t, 0), (t + 1, 1));
        Puntos(luzLetras, OpacityProperty, (0, 0), (t, 0), (t + 1, 1));
    }

    /// <summary>Movimiento reducido: la marca entera, quieta, 600 ms; luego un fundido.</summary>
    void Quieta()
    {
        fondo.Opacity = cara.Opacity = letras.Opacity = luzLetras.Opacity = 1;
        canto.Opacity = 0.62; bordesCanto.Opacity = 1;
        nombre.Opacity = fp.Opacity = firma.Opacity = 1; nombre.Tracking = 0.12; escalaFilo.ScaleX = 1;
        Despues(600, () =>
        {
            saliendo = true;
            dueno.Terminar();
            Tramo(placa, OpacityProperty, 1, 0, 0, 200, Contraste.Salida);
            Despues(220, Close);
        });
    }

    void Saltar()
    {
        if (saliendo) { Close(); return; }
        if (quieto) { saliendo = true; dueno.Terminar(); Close(); return; }
        Salir();
    }

    /// <summary>7) Todo se encoge hacia el notch (arriba al centro, o donde esté) en 320 ms y aparece el notch.</summary>
    void Salir()
    {
        if (saliendo) return;
        saliendo = true;
        var (punto, abajo) = dueno.Destino;
        // En coordenadas de esta ventana; si el notch quedó fuera de la franja (otro monitor, muy a un lado), se va
        // hacia el canto más cercano: el notch aparece igual en su sitio.
        double dx = punto is { } p0 ? p0.X - Left : AnchoVentana / 2;
        double dy = punto is { } p1 ? p1.Y - Top : 18;
        dx = Math.Clamp(dx, 24, AnchoVentana - 24);
        dy = Math.Clamp(dy, abajo ? 0 : 18, Height - 18);
        double cx = Canvas.GetLeft(placa) + anchoPlaca / 2, cy = Canvas.GetTop(placa) + altoPlaca / 2;
        var curva = new KeySpline(0.5, 0, 0.2, 1); curva.Freeze();
        double escalaFinal = 36 / altoPlaca;
        Contraste.Ir(escalaPlaca, ScaleTransform.ScaleXProperty, escalaFinal, 320, 0, curva);
        Contraste.Ir(escalaPlaca, ScaleTransform.ScaleYProperty, escalaFinal, 320, 0, curva);
        Contraste.Ir(movPlaca, TranslateTransform.XProperty, dx - cx, 320, 0, curva);
        Contraste.Ir(movPlaca, TranslateTransform.YProperty, dy - cy, 320, 0, curva);
        Contraste.Ir(placa, OpacityProperty, 0, 140, 180, Contraste.Salida);
        // El notch empieza a aparecer cuando la placa ya casi llegó: se funden en el mismo lugar.
        Despues(200, dueno.Terminar);
        Despues(330, Close);
    }
}
