using System.Collections.Generic;
using System.Windows;
using System.Windows.Media;

namespace Aura.Windows.Notch;

/// <summary>
/// Los íconos del notch dibujados como vectores propios (trazo redondo, 24×24): no dependen de que
/// Windows tenga Segoe Fluent Icons o MDL2. Se piden con el mismo código de glifo de siempre.
/// Trazo de grabado (Contraste): ~1,3 px en pantalla sea cual sea el tamaño, canto recto, esquinas vivas.
/// </summary>
internal sealed class Glifo : FrameworkElement
{
    static readonly Dictionary<string, Geometry> Formas = new();
    static readonly Dictionary<string, string> Datos = new()
    {
        [""] = "M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z M6 11a6 6 0 0 0 12 0 M12 17v4 M9 21h6",
        [""] = "M12 19V5 M6 11l6-6 6 6",
        [""] = "M12 9a3 3 0 1 0 .01 0Z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M4.9 4.9l2.1 2.1 M17 17l2.1 2.1 M4.9 19.1l2.1-2.1 M17 7l2.1-2.1",
        [""] = "M8 5v14 M16 5v14",
        [""] = "M7 5 19 12 7 19Z",
        [""] = "M6 15l6-6 6 6",
        [""] = "M12 4a4 4 0 1 0 .01 0Z M4 21a8 8 0 0 1 16 0",
        [""] = "M6 6 18 18 M18 6 6 18",
        [""] = "M5 12l5 5 9-10",
        [""] = "M12 3 22 20H2Z M12 9v5 M12 17v.5",
        [""] = "M12 3a9 9 0 1 0 .01 0Z M12 7v6 M12 16v.5",
        [""] = "M12 3a9 9 0 1 0 .01 0Z M3 12h18 M12 3c-4 5-4 13 0 18 M12 3c4 5 4 13 0 18",
        [""] = "M4 4h16v16H4Z M4 9h16",
        [""] = "M3 6h6l2 2h10v11H3Z",
        [""] = "M10 4a6 6 0 1 0 .01 0Z M14.5 14.5 20 20",
        [""] = "M4 9h4l5-4v14l-5-4H4Z M16 9a4 4 0 0 1 0 6 M18.5 6.5a8 8 0 0 1 0 11",
        [""] = "M4 9h4l5-4v14l-5-4H4Z M16 9a4 4 0 0 1 0 6 M18.5 6.5a8 8 0 0 1 0 11",
        [""] = "M4 9h4l5-4v14l-5-4H4Z M16 9a4 4 0 0 1 0 6",
        [""] = "M4 9h4l5-4v14l-5-4H4Z M16 9l5 6 M21 9l-5 6",
        [""] = "M6 5 15 12 6 19Z M18 5v14",
        [""] = "M18 5 9 12 18 19Z M6 5v14",
        [""] = "M3 4h18v12H3Z M8 20h8 M12 16v4",
        [""] = "M3 7h4l2-3h6l2 3h4v13H3Z M12 10a3.5 3.5 0 1 0 .01 0Z",
        [""] = "M12 3a9 9 0 1 0 .01 0Z M12 7v5l3 2",
        [""] = "M4 20l4-1 11-11-3-3L5 16Z",
        [""] = "M4 20l4-1 11-11-3-3L5 16Z M14 7l3 3",
        [""] = "M4 5h16v11h-9l-5 4v-4H4Z",
        [""] = "M2 12c3-6 17-6 20 0-3 6-17 6-20 0Z M12 9.5a2.5 2.5 0 1 0 .01 0Z",
        [""] = "M8 8h12v12H8Z M4 16V4h12",
        [""] = "M5 4h11l3 3v13H5Z M8 4v5h7V4 M8 20v-6h8v6",
        ["\uE83F"] = "M3 8h15v8H3Z M18 11h2v2h-2 M5 10h7v4H5Z",
        ["\uEDA2"] = "M4 6h16v12H4Z M4 13h16 M16 16h1",
        ["\uE701"] = "M2 9a15 15 0 0 1 20 0 M5.5 12.5a10 10 0 0 1 13 0 M9 16a5 5 0 0 1 6 0 M12 19.5v.5",
        ["\uE7C9"] = "M9 11V5a1.5 1.5 0 0 1 3 0v6 M12 10a1.5 1.5 0 0 1 3 0v1 M15 11a1.5 1.5 0 0 1 3 0v4a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-3l-2-4a1.5 1.5 0 0 1 2.5-1.5L9 15",
        ["\uE737"] = "M3 5h18v14H3Z M3 9h18",
        ["\uE8A5"] = "M6 3h8l4 4v14H6Z M14 3v4h4",
        ["\uE8D6"] = "M9 18V5l11-2v13 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z M20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
        ["\uE715"] = "M3 6h18v12H3Z M3 7l9 6 9-6",
        ["\uE787"] = "M4 6h16v14H4Z M4 10h16 M8 3v5 M16 3v5",
        // 2.0: micrófono tachado (silenciado) y la cuadrícula del Centro
        ["\uEC54"] = "M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z M6 11a6 6 0 0 0 12 0 M12 17v4 M9 21h6 M4 4 20 20",
        ["\uE8A9"] = "M4 4h7v7H4Z M13 4h7v7h-7Z M4 13h7v7H4Z M13 13h7v7h-7Z",
        ["\uE8C7"] = "M3 7h18v12H3Z M3 7l3-3h12l3 3 M16 13h2",
        ["\uE765"] = "M3 6h18v12H3Z M7 10h1 M11 10h1 M15 10h1 M8 14h8",
        ["\uE706"] = "M12 8a4 4 0 1 0 .01 0Z M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5 19 19 M5 19l1.5-1.5 M17.5 6.5 19 5",
        ["\uE793"] = "M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10Z",
        // 1.4: campana (notificaci\u00F3n de otra app) y globo de chat (WhatsApp, Teams, Telegram\u2026)
        ["\uEA8F"] = "M6 16V11a6 6 0 0 1 12 0v5l2 2H4Z M10 20a2 2 0 0 0 4 0",
        ["\uE8F2"] = "M4 5h16v11h-9l-5 4v-4H4Z M8 9.5h8 M8 12.5h5",
        [""] = "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z",
    };

    public static readonly DependencyProperty CodigoProperty = DependencyProperty.Register(nameof(Codigo), typeof(object), typeof(Glifo),
        new FrameworkPropertyMetadata(null, FrameworkPropertyMetadataOptions.AffectsRender));
    public static readonly DependencyProperty PincelProperty = DependencyProperty.Register(nameof(Pincel), typeof(Brush), typeof(Glifo),
        new FrameworkPropertyMetadata(Brushes.White, FrameworkPropertyMetadataOptions.AffectsRender));

    public object? Codigo { get => GetValue(CodigoProperty); set => SetValue(CodigoProperty, value); }
    public Brush Pincel { get => (Brush)GetValue(PincelProperty); set => SetValue(PincelProperty, value); }

    public Glifo() { IsHitTestVisible = false; Width = 16; Height = 16; }

    static Geometry? Forma(string codigo)
    {
        if (Formas.TryGetValue(codigo, out var g)) return g;
        if (!Datos.TryGetValue(codigo, out var d)) return null;
        g = Geometry.Parse(d); g.Freeze();
        return Formas[codigo] = g;
    }

    protected override void OnRender(DrawingContext dc)
    {
        if (Codigo is not string c || Forma(c) is not { } g) return;
        double s = System.Math.Min(ActualWidth, ActualHeight) / 24.0;
        dc.PushTransform(new TranslateTransform((ActualWidth - 24 * s) / 2, (ActualHeight - 24 * s) / 2));
        dc.PushTransform(new ScaleTransform(s, s));
        dc.DrawGeometry(null, new Pen(Pincel, System.Math.Clamp(1.3 / s, 1.4, 2.4)) { StartLineCap = PenLineCap.Square, EndLineCap = PenLineCap.Square, LineJoin = PenLineJoin.Miter, MiterLimit = 4 }, g);
        dc.Pop(); dc.Pop();
    }
}
