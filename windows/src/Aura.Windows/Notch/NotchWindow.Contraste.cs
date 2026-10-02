using System;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Animation;
using Aura.Windows.Core;
using Aura.Windows.Marca;

namespace Aura.Windows.Notch;

/// <summary>
/// El movimiento del notch según «Contraste» (windows/marca/DIRECCION.md):
/// <list type="bullet">
/// <item>La silueta crece sin rebotes blandos (resortes con amortiguación crítica); con el ratón, decidida; al irse, más rápida.</item>
/// <item>El filo grabado: 1 px de oro que se traza desde el centro hacia afuera (ScaleX, 260 ms); cardenillo que respira al
/// escuchar; un único destello de 70 ms cuando llega un aviso. Reemplaza al resplandor permanente de antes.</item>
/// <item>Los controles del reposo aparecen escalonados (30 ms entre uno y otro) desde el centro; al irse, al revés y más rápido.</item>
/// <item>Al terminar la pantalla de arranque, el notch aparece con el golpe (1.04 → 1).</item>
/// </list>
/// Todo con transform/opacidad (Storyboards de WPF); en las capturas del CI y con movimiento reducido, directo al final.
/// </summary>
public partial class NotchWindow
{
    static readonly Brush FiloCardenillo = FiloDe(Contraste.Cardenillo);
    Brush filoOro = FiloDe(Contraste.OroCrudo);
    double escalaFiloObjetivo = -1;
    bool filoRespira, revelado = true;
    readonly Dictionary<FrameworkElement, double> visibles = new();

    /// <summary>Sin animar: las capturas del CI (que no dejan correr el reloj) y el movimiento reducido.</summary>
    bool SinAnimar => (soloRender && !pruebaAnimacion) || MenosMovimiento;

    /// <summary>El filo: transparente en las puntas (no toca las esquinas redondas), pleno en el centro.</summary>
    static Brush FiloDe(Color c)
    {
        var b = new LinearGradientBrush { StartPoint = new Point(0, 0), EndPoint = new Point(1, 0) };
        b.GradientStops.Add(new GradientStop(Color.FromArgb(0, c.R, c.G, c.B), 0));
        b.GradientStops.Add(new GradientStop(c, 0.16));
        b.GradientStops.Add(new GradientStop(c, 0.84));
        b.GradientStops.Add(new GradientStop(Color.FromArgb(0, c.R, c.G, c.B), 1));
        b.Freeze();
        return b;
    }

    void PrepararContraste()
    {
        foreach (var e in new FrameworkElement[] { NombreChico, BotonCentroChico, BotonSilencio, MicChico }) e.RenderTransform = new TranslateTransform();
        FiloLinea.Fill = filoOro;
    }

    /// <summary>El filo toma el metal del avatar (oro, cobre, plata…).</summary>
    void FiloDelAcento(Color c)
    {
        filoOro = FiloDe(c);
        if (!ReferenceEquals(FiloLinea.Fill, FiloCardenillo)) FiloLinea.Fill = filoOro;
    }

    /// <summary>
    /// Sin rebotes blandos: amortiguación crítica (c = 2√k). En reposo con el ratón, decidido; al irse el ratón (o al
    /// volver al reposo), más rápido todavía; entre los demás estados, firme.
    /// </summary>
    void Templar()
    {
        double k = modo == Modo.Reposo ? (raton ? 520 : 760) : 340, c = 2 * Math.Sqrt(k);
        foreach (var r in new[] { ancho, alto, radio }) { r.Rigidez = k; r.Amortiguacion = c; }
    }

    /// <summary>Qué tan presente está el filo en cada estado (lo lleva el resorte «brillo»).</summary>
    double FiloDeModo() => modo switch
    {
        Modo.Reposo => raton ? 0.85 : 0,
        Modo.Escucha => 1,
        Modo.Piensa => 0.55,
        Modo.Habla => 0.7,
        Modo.Aviso or Modo.Confirma => 0.9,
        _ => 0,
    };

    /// <summary>El filo grabado: se traza (o se borra) solo cuando cambia de estado; al escuchar, respira.</summary>
    void PintarFilo()
    {
        bool abajo = lugar.Borde == BordeNotch.Abajo;
        Filo.VerticalAlignment = abajo ? VerticalAlignment.Top : VerticalAlignment.Bottom;
        double r = Tamano(modo).R;
        Filo.Margin = new Thickness(r * 0.6, 0, r * 0.6, 0);
        double escala = modo switch
        {
            Modo.Reposo => raton ? 1 : 0,
            Modo.Escucha or Modo.Piensa or Modo.Habla or Modo.Aviso or Modo.Confirma => 1,
            _ => 0,
        };
        var tinta = modo == Modo.Escucha ? FiloCardenillo : filoOro;
        if (!ReferenceEquals(FiloLinea.Fill, tinta)) FiloLinea.Fill = tinta;
        if (escala != escalaFiloObjetivo)
        {
            bool crece = escala > escalaFiloObjetivo;
            escalaFiloObjetivo = escala;
            if (SinAnimar) Contraste.Fijar(EscalaFilo, ScaleTransform.ScaleXProperty, escala);
            else Contraste.Ir(EscalaFilo, ScaleTransform.ScaleXProperty, escala, crece ? 260 : 160, 0, crece ? Contraste.Golpe : Contraste.Salida);
        }
        // La pátina: el filo cardenillo respira (.45 ↔ .9, 1,6 s la vuelta). Quieto, se queda en .8.
        bool respira = modo == Modo.Escucha && !SinAnimar;
        if (respira == filoRespira) { if (!respira) FiloLinea.Opacity = modo == Modo.Escucha ? 0.8 : 1; return; }
        filoRespira = respira;
        if (respira)
        {
            var a = new DoubleAnimation(0.45, 0.9, TimeSpan.FromMilliseconds(800)) { AutoReverse = true, RepeatBehavior = RepeatBehavior.Forever, EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut } };
            a.Freeze();
            FiloLinea.BeginAnimation(OpacityProperty, a);
        }
        else Contraste.Fijar(FiloLinea, OpacityProperty, modo == Modo.Escucha ? 0.8 : 1);
    }

    /// <summary>
    /// En reposo con el ratón: el nombre, el Centro, silenciar y el micrófono aparecen escalonados desde el centro
    /// (cada uno 30 ms después del anterior, deslizándose 6 px hacia su sitio); al irse el ratón, al revés y más rápido.
    /// El micrófono silenciado se ve SIEMPRE: nunca quedas sin saber si te oye.
    /// </summary>
    void AparecerControles()
    {
        bool encima = modo == Modo.Reposo && raton;
        Aparecer(BotonCentroChico, encima, 0, -1);
        Aparecer(NombreChico, encima, 1, 1);
        Aparecer(BotonSilencio, modo == Modo.Reposo && (raton || microSilenciado), 2, -1);
        Aparecer(MicChico, encima, 3, -1);
    }

    void Aparecer(FrameworkElement e, bool si, int orden, double lado)
    {
        double objetivo = si ? 1 : 0;
        if (visibles.TryGetValue(e, out var antes) && antes == objetivo) return;
        visibles[e] = objetivo;
        var mover = (TranslateTransform)e.RenderTransform;
        if (SinAnimar) { Contraste.Fijar(e, OpacityProperty, objetivo); Contraste.Fijar(mover, TranslateTransform.XProperty, 0); return; }
        if (si)
        {
            // Empieza cuando la silueta ya se está abriendo, desde el lado del centro.
            if (e.Opacity < 0.05) Contraste.Fijar(mover, TranslateTransform.XProperty, lado * 6);
            double espera = 40 + orden * 30;
            Contraste.Ir(e, OpacityProperty, 1, 200, espera);
            Contraste.Ir(mover, TranslateTransform.XProperty, 0, 240, espera);
        }
        else
        {
            double espera = (3 - orden) * 15;
            Contraste.Ir(e, OpacityProperty, 0, 110, espera, Contraste.Salida);
            Contraste.Ir(mover, TranslateTransform.XProperty, lado * 4, 110, espera, Contraste.Salida);
        }
    }

    /// <summary>Llega un aviso: su sello se planta (1.04 → 1, 200 ms) y el filo da un único destello de 70 ms.</summary>
    void GolpeDeAviso()
    {
        if (SinAnimar)
        {
            Contraste.Fijar(GolpeAviso, ScaleTransform.ScaleXProperty, 1); Contraste.Fijar(GolpeAviso, ScaleTransform.ScaleYProperty, 1);
            return;
        }
        Contraste.Fijar(GolpeAviso, ScaleTransform.ScaleXProperty, 1.04); Contraste.Fijar(GolpeAviso, ScaleTransform.ScaleYProperty, 1.04);
        Contraste.Ir(GolpeAviso, ScaleTransform.ScaleXProperty, 1, 200); Contraste.Ir(GolpeAviso, ScaleTransform.ScaleYProperty, 1, 200);
        var d = new DoubleAnimationUsingKeyFrames();
        d.KeyFrames.Add(new DiscreteDoubleKeyFrame(0, KeyTime.FromTimeSpan(TimeSpan.Zero)));
        d.KeyFrames.Add(new LinearDoubleKeyFrame(1, KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(10))));
        d.KeyFrames.Add(new LinearDoubleKeyFrame(0, KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(70))));
        d.Freeze();
        FiloDestello.BeginAnimation(OpacityProperty, d);
    }

    // ───────────── la pantalla de arranque ─────────────

    /// <summary>El notch arranca invisible detrás de la pantalla de arranque (ya escucha atajos y prepara todo).</summary>
    internal void Esconder() { revelado = false; Opacity = 0; }

    /// <summary>La placa del arranque llegó: el notch aparece en su sitio con el golpe.</summary>
    internal void Revelar()
    {
        if (revelado) return;
        revelado = true;
        if (MenosMovimiento) { Contraste.Fijar(this, OpacityProperty, 1); return; }
        bool abajo = lugar.Borde == BordeNotch.Abajo;
        double cx = PosicionNotch.CentroVisible(centroVentana, ancho.Valor, limiteIzq, limiteDer, Oreja, MargenBorde);
        var golpe = new ScaleTransform(1.04, 1.04, cx, abajo ? (double.IsFinite(Height) ? Height : AltoCompacto) : 0);
        Raiz.RenderTransform = golpe;
        Contraste.Ir(this, OpacityProperty, 1, 120, 0, Contraste.Salida);
        Contraste.Ir(golpe, ScaleTransform.ScaleXProperty, 1, 220);
        Contraste.Ir(golpe, ScaleTransform.ScaleYProperty, 1, 220);
    }

    /// <summary>El centro de la píldora en reposo, en DIP de pantalla: hacia ahí se encoge la placa del arranque.</summary>
    internal (Point Centro, bool Abajo) PuntoDeArranque()
    {
        bool abajo = lugar.Borde == BordeNotch.Abajo;
        double cx = PosicionNotch.CentroVisible(centroVentana, AnchoReposoBase, limiteIzq, limiteDer, Oreja, MargenBorde);
        double h = double.IsFinite(Height) ? Height : AltoCompacto;
        return (new Point(Left + cx, abajo ? Top + h - 18 : Top + 18), abajo);
    }
}
