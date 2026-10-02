using System;
using System.Windows;
using System.Windows.Media;
using Aura.Windows.Core;

namespace Aura.Windows.Notch;

/// <summary>
/// El notch de vidrio: un relleno de obsidiana translúcido (se adivina lo que hay detrás), un reflejo claro
/// arriba y un filo de luz en los bordes. Todo en WPF: el desenfoque de DWM (acrílico) en una ventana con
/// AllowsTransparency difumina el rectángulo entero de la ventana, no la silueta, así que no se usa.
/// Lo que lleva texto (habla, avisos, confirmar, el panel) nunca baja de 0.9 para leerse sobre cualquier fondo;
/// la píldora (reposo, escucha, música) usa el valor de Ajustes («Transparencia del notch»).
/// </summary>
public partial class NotchWindow
{
    /// <summary>Límites de Ajustes.Transparencia: 0.30 deja ver mucho el fondo; 1 es el negro sólido de siempre.</summary>
    internal const double VidrioMin = VidrioNotch.Min, VidrioMax = VidrioNotch.Max;
    LinearGradientBrush? rellenoVidrio;
    Brush? bordeSolido, bordeSolidoAbajo, reflejoArriba, reflejoAbajo;
    static readonly LinearGradientBrush BordeVidrio = CrearBordeVidrio();
    static readonly Brush BordeVidrioAbajo = Volteado(BordeVidrio);
    // Sólido: obsidiana pegada a la pantalla y grafito hacia el canto libre (Contraste: «Grafito, el notch en reposo»).
    static readonly LinearGradientBrush RellenoSolido = CrearRellenoSolido();
    static readonly Brush RellenoSolidoAbajo = Volteado(RellenoSolido);

    static LinearGradientBrush CrearRellenoSolido()
    {
        var b = new LinearGradientBrush { StartPoint = new Point(0, 0), EndPoint = new Point(0, 1) };
        b.GradientStops.Add(new GradientStop(Marca.Contraste.Obsidiana, 0.3));
        b.GradientStops.Add(new GradientStop(Marca.Contraste.Grafito, 1));
        b.Freeze();
        return b;
    }
    double alfaPintado = -1;
    bool vidrioAbajo;

    static LinearGradientBrush CrearBordeVidrio()
    {
        // Arriba no se ve (pega con el borde de la pantalla); a los lados y abajo, un filo fino, cálido (papel, no blanco).
        var b = new LinearGradientBrush { StartPoint = new Point(0, 0), EndPoint = new Point(0, 1) };
        b.GradientStops.Add(new GradientStop(Color.FromArgb(0x00, 0xEC, 0xE5, 0xD6), 0));
        b.GradientStops.Add(new GradientStop(Color.FromArgb(0x10, 0xEC, 0xE5, 0xD6), 0.4));
        b.GradientStops.Add(new GradientStop(Color.FromArgb(0x26, 0xEC, 0xE5, 0xD6), 1));
        b.Freeze();
        return b;
    }

    /// <summary>El mismo degradado de abajo hacia arriba (para el notch pegado al borde de abajo).</summary>
    static Brush Volteado(Brush b)
    {
        if (b is not LinearGradientBrush l) return b;
        var c = l.Clone();
        (c.StartPoint, c.EndPoint) = (l.EndPoint, l.StartPoint);
        c.Freeze();
        return c;
    }

    /// <summary>Cuánto tapa el fondo cada modo: la píldora usa el ajuste; lo que tiene texto nunca baja de 0.9.</summary>
    double OpacidadDe(Modo m) => VidrioNotch.Opacidad(ajustes.Transparencia, m switch
    {
        Modo.Reposo => raton ? CapaVidrio.ReposoConRaton : CapaVidrio.Reposo,
        Modo.Escucha or Modo.Piensa => CapaVidrio.Escucha,
        Modo.Musica => CapaVidrio.Musica,
        Modo.Habla or Modo.Aviso => CapaVidrio.Lectura,
        Modo.Confirma => CapaVidrio.Confirmar,
        Modo.Panel => CapaVidrio.Panel,
        _ => CapaVidrio.Reposo,
    });

    /// <summary>Se llama en cada fotograma: la opacidad sigue a las capas (que ya se funden con sus resortes), sin saltos.</summary>
    void PintarVidrio()
    {
        double suma = 0, peso = 0;
        foreach (var (m, (_, op)) in capas) { var o = Math.Clamp(op.Valor, 0, 1); suma += o * OpacidadDe(m); peso += o; }
        var a = peso > 0.01 ? suma / peso : OpacidadDe(modo);
        if (Math.Abs(a - alfaPintado) < 0.004) return;
        alfaPintado = a;
        bordeSolido ??= Forma.Stroke;
        bordeSolidoAbajo ??= Volteado(bordeSolido);
        reflejoArriba ??= Reflejo.Fill;
        reflejoAbajo ??= Volteado(reflejoArriba);
        bool abajo = lugar.Borde == BordeNotch.Abajo;
        Reflejo.Fill = abajo ? reflejoAbajo : reflejoArriba;
        if (a >= 0.995)
        {
            // Sólido: obsidiana a grafito.
            Forma.Fill = abajo ? RellenoSolidoAbajo : RellenoSolido; Forma.Stroke = abajo ? bordeSolidoAbajo : bordeSolido; Reflejo.Opacity = 0;
            return;
        }
        if (rellenoVidrio == null)
        {
            rellenoVidrio = new LinearGradientBrush { StartPoint = new Point(0, 0), EndPoint = new Point(0, 1) };
            rellenoVidrio.GradientStops.Add(new GradientStop(Colors.Black, 0));
            rellenoVidrio.GradientStops.Add(new GradientStop(Colors.Black, 1));
        }
        // Cuanto más opaco, más se acerca a la obsidiana (con 1 queda igual que el sólido).
        var k = Math.Clamp((a - VidrioMin) / (VidrioMax - VidrioMin), 0, 1);
        static byte Alfa(double v) => (byte)Math.Round(Math.Clamp(v, 0, 1) * 255);
        // Pegado abajo, el degradado va al revés (siempre empieza en el canto pegado a la pantalla).
        if (vidrioAbajo != abajo) { vidrioAbajo = abajo; (rellenoVidrio.StartPoint, rellenoVidrio.EndPoint) = abajo ? (new Point(0, 1), new Point(0, 0)) : (new Point(0, 0), new Point(0, 1)); }
        // Tonos cálidos (obsidiana, grafito), nunca el gris azulado de un vidrio esmerilado.
        static byte Tono(double vidrio, double solido, double k) => (byte)Math.Round(vidrio + (solido - vidrio) * k);
        rellenoVidrio.GradientStops[0].Color = Color.FromArgb(Alfa(a - 0.05), Tono(0x14, 0x0D, k), Tono(0x12, 0x0C, k), Tono(0x0F, 0x0A, k));
        rellenoVidrio.GradientStops[1].Color = Color.FromArgb(Alfa(a + 0.06), Tono(0x0D, 0x17, k), Tono(0x0C, 0x15, k), Tono(0x0A, 0x12, k));
        Forma.Fill = rellenoVidrio;
        Forma.Stroke = abajo ? BordeVidrioAbajo : BordeVidrio;
        Reflejo.Opacity = 0.3 + 0.7 * (1 - k);
    }

    /// <summary>Cambió el ajuste: se repinta ya (aunque el notch esté quieto).</summary>
    internal void AplicarVidrio()
    {
        alfaPintado = -1;
        PintarVidrio();
    }
}
