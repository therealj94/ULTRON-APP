using System;
using System.Globalization;
using System.Windows;
using System.Windows.Media;

namespace Aura.Windows.Marca;

/// <summary>
/// Un rótulo estampado: mayúsculas con tracking (el espacio entre letras), como lo grabado en un lingote.
/// WPF no tiene tracking en TextBlock; aquí cada letra se coloca con su avance más el tracking (en fracción del
/// tamaño: 0.12 = +12 %). El tracking se puede animar (la pantalla de arranque lo cierra de +40 % a +12 %).
/// Si la fuente no tuviera alguna letra, se dibuja como texto normal (sin tracking) con la familia de respaldo.
/// </summary>
internal sealed class Rotulo : FrameworkElement
{
    public static readonly DependencyProperty TextoProperty = DependencyProperty.Register(nameof(Texto), typeof(string), typeof(Rotulo),
        new FrameworkPropertyMetadata("", FrameworkPropertyMetadataOptions.AffectsMeasure | FrameworkPropertyMetadataOptions.AffectsRender, (d, _) => ((Rotulo)d).Olvidar()));
    public static readonly DependencyProperty TamanoProperty = DependencyProperty.Register(nameof(Tamano), typeof(double), typeof(Rotulo),
        new FrameworkPropertyMetadata(11.0, FrameworkPropertyMetadataOptions.AffectsMeasure | FrameworkPropertyMetadataOptions.AffectsRender, (d, _) => ((Rotulo)d).Olvidar()));
    public static readonly DependencyProperty TrackingProperty = DependencyProperty.Register(nameof(Tracking), typeof(double), typeof(Rotulo),
        new FrameworkPropertyMetadata(0.1, FrameworkPropertyMetadataOptions.AffectsMeasure | FrameworkPropertyMetadataOptions.AffectsRender));
    public static readonly DependencyProperty TintaProperty = DependencyProperty.Register(nameof(Tinta), typeof(Brush), typeof(Rotulo),
        new FrameworkPropertyMetadata(Brushes.White, FrameworkPropertyMetadataOptions.AffectsRender));
    public static readonly DependencyProperty MonoProperty = DependencyProperty.Register(nameof(Mono), typeof(bool), typeof(Rotulo),
        new FrameworkPropertyMetadata(false, FrameworkPropertyMetadataOptions.AffectsMeasure | FrameworkPropertyMetadataOptions.AffectsRender, (d, _) => ((Rotulo)d).Olvidar()));
    public static readonly DependencyProperty MayusculasProperty = DependencyProperty.Register(nameof(Mayusculas), typeof(bool), typeof(Rotulo),
        new FrameworkPropertyMetadata(true, FrameworkPropertyMetadataOptions.AffectsMeasure | FrameworkPropertyMetadataOptions.AffectsRender, (d, _) => ((Rotulo)d).Olvidar()));

    public string Texto { get => (string)GetValue(TextoProperty); set => SetValue(TextoProperty, value); }
    /// <summary>Tamaño de la letra (DIP).</summary>
    public double Tamano { get => (double)GetValue(TamanoProperty); set => SetValue(TamanoProperty, value); }
    /// <summary>Espacio extra entre letras, en fracción del tamaño.</summary>
    public double Tracking { get => (double)GetValue(TrackingProperty); set => SetValue(TrackingProperty, value); }
    public Brush Tinta { get => (Brush)GetValue(TintaProperty); set => SetValue(TintaProperty, value); }
    /// <summary>Plex Mono (Regular) en vez de Plex Sans Condensed SemiBold.</summary>
    public bool Mono { get => (bool)GetValue(MonoProperty); set => SetValue(MonoProperty, value); }
    public bool Mayusculas { get => (bool)GetValue(MayusculasProperty); set => SetValue(MayusculasProperty, value); }

    // Lo que no cambia al animar el tracking: las letras y sus avances naturales.
    GlyphTypeface? tipo;
    ushort[]? glifos;
    double[]? avances;
    string? cadena;
    bool sinGlifos;

    public Rotulo() { IsHitTestVisible = false; SnapsToDevicePixels = true; }

    void Olvidar() { glifos = null; avances = null; cadena = null; sinGlifos = false; }

    string Cadena() => cadena ??= Mayusculas ? (Texto ?? "").ToUpper(CultureInfo.GetCultureInfo("es")) : Texto ?? "";

    bool Preparar()
    {
        if (glifos != null) return true;
        if (sinGlifos) return false;
        var s = Cadena();
        var fam = Mono ? Contraste.MonoSola : Contraste.CondensadaSola;
        var peso = Mono ? FontWeights.Normal : FontWeights.SemiBold;
        if (!new Typeface(fam, FontStyles.Normal, peso, FontStretches.Normal).TryGetGlyphTypeface(out var gt)) { sinGlifos = true; return false; }
        var g = new ushort[s.Length]; var a = new double[s.Length];
        for (int i = 0; i < s.Length; i++)
        {
            if (!gt.CharacterToGlyphMap.TryGetValue(s[i], out var idx)) { sinGlifos = true; return false; }
            g[i] = idx; a[i] = gt.AdvanceWidths[idx];
        }
        tipo = gt; glifos = g; avances = a;
        return true;
    }

    FormattedText Respaldo()
    {
        var fam = Mono ? Contraste.Mono : Contraste.Condensada;
        return new FormattedText(Cadena(), CultureInfo.CurrentUICulture, FlowDirection.LeftToRight,
            new Typeface(fam, FontStyles.Normal, Mono ? FontWeights.Normal : FontWeights.SemiBold, FontStretches.Normal),
            Tamano, Tinta, VisualTreeHelper.GetDpi(this).PixelsPerDip);
    }

    double Ancho()
    {
        double w = 0, extra = Tracking * Tamano;
        for (int i = 0; i < avances!.Length; i++) w += avances[i] * Tamano + (i < avances.Length - 1 ? extra : 0);
        return Math.Max(0, w);
    }

    protected override Size MeasureOverride(Size disponible)
    {
        if (Cadena().Length == 0) return default;
        if (!Preparar()) { var f = Respaldo(); return new Size(f.WidthIncludingTrailingWhitespace, f.Height); }
        return new Size(Ancho(), tipo!.Height * Tamano);
    }

    protected override void OnRender(DrawingContext dc)
    {
        if (Cadena().Length == 0) return;
        if (!Preparar()) { dc.DrawText(Respaldo(), new Point(Math.Max(0, (ActualWidth - DesiredSize.Width) / 2), 0)); return; }
        double extra = Tracking * Tamano;
        // Un arreglo nuevo por dibujo: el GlyphRun anterior se queda con el suyo.
        var colocados = new double[avances!.Length];
        for (int i = 0; i < avances.Length; i++) colocados[i] = avances[i] * Tamano + (i < avances.Length - 1 ? extra : 0);
        // Centrado en su caja: al cerrar el tracking, las letras se juntan hacia el centro.
        double x = Math.Max(0, (ActualWidth - Ancho()) / 2);
        var corrida = new GlyphRun(tipo, 0, false, Tamano, (float)VisualTreeHelper.GetDpi(this).PixelsPerDip, glifos, new Point(x, tipo!.Baseline * Tamano),
            colocados, null, null, null, null, null, null);
        dc.DrawGlyphRun(Tinta, corrida);
    }
}
