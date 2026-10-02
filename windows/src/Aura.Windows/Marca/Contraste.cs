using System;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Animation;

namespace Aura.Windows.Marca;

/// <summary>
/// «Contraste» (windows/marca/DIRECCION.md): la paleta, la marca (el punzón con «AU» calado) y las letras IBM Plex,
/// en un solo lugar para el código. Todo va congelado: se puede usar desde el hilo de la pantalla de arranque.
/// Los mismos valores viven como recursos en App.xaml para el XAML.
/// </summary>
internal static class Contraste
{
    // ───────────── paleta ─────────────
    public static readonly Color Obsidiana = Color.FromRgb(0x0D, 0x0C, 0x0A);
    public static readonly Color Grafito = Color.FromRgb(0x17, 0x15, 0x12);
    public static readonly Color Grafito2 = Color.FromRgb(0x22, 0x1F, 0x1A);
    public static readonly Color OroCrudo = Color.FromRgb(0xB8, 0x91, 0x3F);
    public static readonly Color OroPulido = Color.FromRgb(0xE3, 0xC7, 0x7E);
    public static readonly Color Papel = Color.FromRgb(0xEC, 0xE5, 0xD6);
    public static readonly Color Ceniza = Color.FromRgb(0x8E, 0x87, 0x7A);
    public static readonly Color Cardenillo = Color.FromRgb(0x5E, 0x9C, 0x8C);
    public static readonly Color Lacre = Color.FromRgb(0xB5, 0x48, 0x2E);
    /// <summary>El filo neutro (separadores, bordes de campos): grafito un punto más claro.</summary>
    public static readonly Color Linea = Color.FromRgb(0x2E, 0x2A, 0x23);

    public static SolidColorBrush Pincel(Color c, double opacidad = 1)
    {
        var b = new SolidColorBrush(c) { Opacity = opacidad };
        b.Freeze();
        return b;
    }

    /// <summary>El tono intermedio entre dos colores (0 = a, 1 = b). Sirve para el acento «vivo» de cada avatar.</summary>
    public static Color Mezcla(Color a, Color b, double k)
    {
        k = Math.Clamp(k, 0, 1);
        byte M(byte x, byte y) => (byte)Math.Round(x + (y - x) * k);
        return Color.FromRgb(M(a.R, b.R), M(a.G, b.G), M(a.B, b.B));
    }

    // ───────────── la marca (geometria.txt, caja de 512) ─────────────
    public const string DatosPunzon = "M100 20H412L492 100V412L412 492H100L20 412V100Z";
    public const string DatosBisel = "M108 44H404L468 108V404L404 468H108L44 404V108Z";
    public const string DatosA = "M84 376L160 136H214L290 376H238L224 332H150L136 376ZM162 292H212L187 210Z";
    public const string DatosU = "M310 136H358V290Q358 334 380 334Q402 334 402 290V136H450V292Q450 382 380 382Q310 382 310 292Z";

    public static readonly Geometry Punzon = Congelar(Geometry.Parse(DatosPunzon));
    public static readonly Geometry Bisel = Congelar(Geometry.Parse(DatosBisel));
    /// <summary>«AU» (con el hueco del triángulo de la A): lo que queda calado en el punzón.</summary>
    public static readonly Geometry Letras = Congelar(Geometry.Parse("F1 " + DatosA + " " + DatosU));
    /// <summary>marca-tinta.svg: una sola tinta, «AU» calado (par-impar).</summary>
    public static readonly Geometry Tinta = Congelar(Geometry.Parse("F0 " + DatosPunzon + " " + DatosA + " " + DatosU));

    /// <summary>El oro del punzón (marca.svg, degradado en diagonal).</summary>
    public static readonly LinearGradientBrush OroMarca = Degradado(new Point(0, 0), new Point(1, 1),
        (0xEDD596, 0), (0xC99D48, .38), (0x9A7230, .72), (0xD6B262, 1));
    /// <summary>El fondo del calado: casi negro, más cálido abajo.</summary>
    public static readonly LinearGradientBrush Hueco = Degradado(new Point(0, 0), new Point(0, 1), (0x0E0B07, 0), (0x2A2114, 1));

    static Geometry Congelar(Geometry g) { g.Freeze(); return g; }

    static LinearGradientBrush Degradado(Point a, Point b, params (int Rgb, double Pos)[] paradas)
    {
        var g = new LinearGradientBrush { StartPoint = a, EndPoint = b };
        foreach (var (rgb, pos) in paradas)
            g.GradientStops.Add(new GradientStop(Color.FromRgb((byte)(rgb >> 16), (byte)(rgb >> 8), (byte)rgb), pos));
        g.Freeze();
        return g;
    }

    // ───────────── letras (IBM Plex, dentro del .exe) ─────────────
    const string Carpeta = "pack://application:,,,/Aura.Windows;component/Fuentes/";

    /// <summary>Plex Sans: todo el texto de lectura. Con Segoe UI detrás por si la fuente no cargara.</summary>
    public static FontFamily Sans => sans ??= new FontFamily(new Uri(Carpeta), "./#IBM Plex Sans, Segoe UI");
    /// <summary>Plex Sans Condensed (SemiBold, mayúsculas): rótulos, «AU·RA».</summary>
    public static FontFamily Condensada => condensada ??= new FontFamily(new Uri(Carpeta), "./#IBM Plex Sans Condensed, Segoe UI");
    /// <summary>Plex Mono: cifras, horas, versiones y atajos.</summary>
    public static FontFamily Mono => mono ??= new FontFamily(new Uri(Carpeta), "./#IBM Plex Mono, Consolas");
    /// <summary>Las mismas, sin respaldo: para leer sus glifos (el tracking de Rotulo).</summary>
    public static FontFamily CondensadaSola => condensadaSola ??= new FontFamily(new Uri(Carpeta), "./#IBM Plex Sans Condensed");
    public static FontFamily MonoSola => monoSola ??= new FontFamily(new Uri(Carpeta), "./#IBM Plex Mono");
    public static FontFamily SansSola => sansSola ??= new FontFamily(new Uri(Carpeta), "./#IBM Plex Sans");
    static FontFamily? sans, condensada, mono, condensadaSola, monoSola, sansSola;

    // ───────────── movimiento ─────────────

    /// <summary>El «golpe»: cubic-bezier(.2,.9,.1,1). Decidido, sin rebote.</summary>
    public static readonly KeySpline Golpe = CongelarCurva(new KeySpline(0.2, 0.9, 0.1, 1));
    /// <summary>Para lo que se va: sale rápido y sin titubeo.</summary>
    public static readonly KeySpline Salida = CongelarCurva(new KeySpline(0.4, 0, 0.2, 1));

    static KeySpline CongelarCurva(KeySpline k) { k.Freeze(); return k; }

    /// <summary>
    /// Lleva una propiedad de su valor actual a <paramref name="hasta"/> con la curva del golpe, tras <paramref name="retrasoMs"/>.
    /// El retraso es un primer tramo quieto en el valor de ahora (no un BeginTime): así la propiedad nunca salta a su
    /// valor base mientras espera su turno.
    /// </summary>
    public static void Ir(DependencyObject o, DependencyProperty p, double hasta, double ms, double retrasoMs = 0, KeySpline? curva = null)
    {
        if (o is not IAnimatable a) return;
        double desde = (double)o.GetValue(p);
        var anim = new DoubleAnimationUsingKeyFrames { FillBehavior = FillBehavior.HoldEnd };
        anim.KeyFrames.Add(new DiscreteDoubleKeyFrame(desde, KeyTime.FromTimeSpan(TimeSpan.Zero)));
        if (retrasoMs > 0) anim.KeyFrames.Add(new LinearDoubleKeyFrame(desde, KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(retrasoMs))));
        anim.KeyFrames.Add(new SplineDoubleKeyFrame(hasta, KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(retrasoMs + Math.Max(1, ms))), curva ?? Golpe));
        anim.Freeze();
        a.BeginAnimation(p, anim, HandoffBehavior.SnapshotAndReplace);
    }

    /// <summary>Sin animar: quita la animación que hubiera y deja el valor fijo.</summary>
    public static void Fijar(DependencyObject o, DependencyProperty p, double valor)
    {
        if (o is IAnimatable a) a.BeginAnimation(p, null);
        o.SetValue(p, valor);
    }
}
