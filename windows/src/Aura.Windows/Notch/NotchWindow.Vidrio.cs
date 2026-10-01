using System;
using System.Windows;
using System.Windows.Media;

namespace Aura.Windows.Notch;

/// <summary>
/// El notch de vidrio: un relleno oscuro translúcido (se adivina lo que hay detrás), un reflejo claro
/// arriba y un filo de luz en los bordes. Todo en WPF: el desenfoque de DWM (acrílico) en una ventana con
/// AllowsTransparency difumina el rectángulo entero de la ventana, no la silueta, así que no se usa.
/// Lo que lleva texto (habla, avisos, confirmar, el panel) se vuelve más opaco para leerse sobre cualquier fondo.
/// </summary>
public partial class NotchWindow
{
    /// <summary>Límites de Ajustes.Transparencia: 0.55 deja ver bastante el fondo; 1 es el negro sólido de siempre.</summary>
    internal const double VidrioMin = 0.55, VidrioMax = 1;
    LinearGradientBrush? rellenoVidrio;
    Brush? bordeSolido;
    static readonly LinearGradientBrush BordeVidrio = CrearBordeVidrio();
    double alfaPintado = -1;

    static LinearGradientBrush CrearBordeVidrio()
    {
        // Arriba no se ve (pega con el borde de la pantalla); a los lados y abajo, un filo fino de luz.
        var b = new LinearGradientBrush { StartPoint = new Point(0, 0), EndPoint = new Point(0, 1) };
        b.GradientStops.Add(new GradientStop(Color.FromArgb(0x00, 0xFF, 0xFF, 0xFF), 0));
        b.GradientStops.Add(new GradientStop(Color.FromArgb(0x14, 0xFF, 0xFF, 0xFF), 0.4));
        b.GradientStops.Add(new GradientStop(Color.FromArgb(0x33, 0xFF, 0xFF, 0xFF), 1));
        b.Freeze();
        return b;
    }

    /// <summary>Cuánto tapa el fondo cada modo: el reposo es el más translúcido; lo que tiene texto, más opaco.</summary>
    double OpacidadDe(Modo m)
    {
        var t = Math.Clamp(ajustes.Transparencia, VidrioMin, VidrioMax);
        return m switch
        {
            Modo.Reposo => t,
            Modo.Escucha or Modo.Piensa or Modo.Musica => t + (1 - t) * 0.35,
            Modo.Habla or Modo.Aviso => t + (1 - t) * 0.6,
            Modo.Confirma => t + (1 - t) * 0.7,
            Modo.Panel => Math.Max(t, 0.95),
            _ => t,
        };
    }

    /// <summary>Se llama en cada fotograma: la opacidad sigue a las capas (que ya se funden con sus resortes), sin saltos.</summary>
    void PintarVidrio()
    {
        double suma = 0, peso = 0;
        foreach (var (m, (_, op)) in capas) { var o = Math.Clamp(op.Valor, 0, 1); suma += o * OpacidadDe(m); peso += o; }
        var a = peso > 0.01 ? suma / peso : OpacidadDe(modo);
        if (Math.Abs(a - alfaPintado) < 0.004) return;
        alfaPintado = a;
        bordeSolido ??= Forma.Stroke;
        if (a >= 0.995)
        {
            // Sólido: el notch negro de antes, tal cual.
            Forma.Fill = Brushes.Black; Forma.Stroke = bordeSolido; Reflejo.Opacity = 0;
            return;
        }
        if (rellenoVidrio == null)
        {
            rellenoVidrio = new LinearGradientBrush { StartPoint = new Point(0, 0), EndPoint = new Point(0, 1) };
            rellenoVidrio.GradientStops.Add(new GradientStop(Colors.Black, 0));
            rellenoVidrio.GradientStops.Add(new GradientStop(Colors.Black, 1));
        }
        // Cuanto más opaco, más se acerca al negro puro (con 1 queda igual que el sólido).
        var k = Math.Clamp((a - VidrioMin) / (VidrioMax - VidrioMin), 0, 1);
        static byte Canal(double v, double k) => (byte)Math.Round(v * (1 - k));
        static byte Alfa(double v) => (byte)Math.Round(Math.Clamp(v, 0, 1) * 255);
        rellenoVidrio.GradientStops[0].Color = Color.FromArgb(Alfa(a - 0.05), Canal(0x10, k), Canal(0x10, k), Canal(0x14, k));
        rellenoVidrio.GradientStops[1].Color = Color.FromArgb(Alfa(a + 0.06), Canal(0x0A, k), Canal(0x0A, k), Canal(0x0E, k));
        Forma.Fill = rellenoVidrio;
        Forma.Stroke = BordeVidrio;
        Reflejo.Opacity = 0.3 + 0.7 * (1 - k);
    }

    /// <summary>Cambió el ajuste: se repinta ya (aunque el notch esté quieto).</summary>
    internal void AplicarVidrio()
    {
        alfaPintado = -1;
        PintarVidrio();
    }
}
