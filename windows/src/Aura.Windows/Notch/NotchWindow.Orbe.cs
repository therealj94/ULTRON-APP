using System;
using System.Windows;
using Aura.Windows.Core;

namespace Aura.Windows.Notch;

/// <summary>
/// La cara de AU-RA en el notch: el orbe de partículas (OrbeView) en vez del avatar 3D renderizado. Uno solo, que
/// se pone encima de la cara de la capa que se ve (escucha, piensa, aviso, confirma, panel) y se funde con ella;
/// al hablar, el notch abre su escenario: el orbe arriba y, debajo, la frase que suena formada con sus partículas.
/// Lo mueve el estado REAL de AURA (lo que muestra el notch), el nivel real del altavoz y el texto de cada frase.
/// Claudio, ANT-ONIO y el Guardián siguen con su cara. Sin orbe (no hay WebView2, falló WebGL, tardó más de 10 s),
/// los AvatarView de siempre siguen ahí y el notch es el de antes.
/// </summary>
public partial class NotchWindow
{
    /// <summary>El alto del notch cuando AU-RA habla con el orbe: el orbe arriba y dos renglones de palabras abajo.</summary>
    const double AltoEscenario = 200;
    OrbeView? orbe;
    bool orbePreparado, carasEscondidas, enEscena;

    /// <summary>El orbe está listo y es la cara que toca (la de AU-RA).</summary>
    bool OrbeVisible => orbe is { Listo: true } && ajustes.Avatar == "aura";

    /// <summary>Las caras de AU-RA que el orbe reemplaza (AvatarChico no se ve: en reposo la cara es la marca).</summary>
    AvatarView[] CarasDeAura => new[] { AvatarEscucha, AvatarPiensa, AvatarHabla, AvatarAviso, AvatarConfirma, AvatarPanel };

    /// <summary>Una vez, ya armado el notch (nunca en las pruebas de render: allí se fotografía el notch de siempre).</summary>
    void PrepararOrbe()
    {
        if (soloRender) return;
        orbePreparado = true;
        // El estado del panel y la cara del aviso cambian sin cambiar de capa: el orbe los sigue igual.
        AvatarPanel.EstadoCambio += ActualizarOrbe;
        AvatarAviso.EstadoCambio += ActualizarOrbe;
        CrearOrbeSiToca();
    }

    /// <summary>La WebView del orbe se arma la primera vez que la cara es AU-RA (con otro avatar, ni se carga).</summary>
    void CrearOrbeSiToca()
    {
        if (!orbePreparado || orbe != null || ajustes.Avatar != "aura") return;
        orbe = new OrbeView(ajustes.EfectosDeSonido, AvatarView.MenosMovimientoPedido);
        // Dentro de la silueta (la recorta y se funde con su capa), debajo del filo grabado y de la cámara. En un lienzo
        // propio: mientras la silueta crece, el Grid recortaría al orbe a su tamaño de ese momento; el lienzo no.
        var lienzo = new System.Windows.Controls.Canvas();
        lienzo.Children.Add(orbe);
        int i = Contenido.Children.IndexOf(Filo);
        Contenido.Children.Insert(i < 0 ? Contenido.Children.Count : i, lienzo);
        // Listo o caído: cambia la cara que se ve y el alto de «habla» (escenario o el de siempre).
        orbe.CambioDisponible += () => { ActualizarOrbe(); Aplicar(); };
        // Deslizarlo hacia el borde del notch recoge el panel (como la isla).
        orbe.Deslizo += dir =>
        {
            if (modo == Modo.Panel && dir == (lugar.Borde == BordeNotch.Abajo ? "abajo" : "arriba")) AbrirPanel(false);
        };
    }

    /// <summary>La cara del orbe según lo que el notch muestra ahora: el estado real de AURA.</summary>
    string CaraDelOrbe() => modo switch
    {
        Modo.Escucha or Modo.Confirma => "LISTENING",
        Modo.Piensa => "THINKING",
        Modo.Habla => "SPEAKING",
        Modo.Aviso => ProtocoloOrbe.Cara(AvatarAviso.Estado),
        Modo.Panel => ProtocoloOrbe.Cara(AvatarPanel.Estado),
        // Reposo y música: el orbe no se ve (la cara es la marca); queda en reposo, sin sonido de cambio.
        _ => "IDLE",
    };

    void ActualizarOrbe()
    {
        if (orbe == null) return;
        orbe.Cara(CaraDelOrbe());
        ColocarOrbe();
    }

    /// <summary>
    /// Pone el orbe sobre la cara que se ve ahora (o lo esconde) y esconde los avatares que reemplaza. Corre en cada
    /// fotograma del notch (Dibujar): sigue el deslizamiento y la opacidad de su capa.
    /// </summary>
    void ColocarOrbe()
    {
        if (orbe == null) return;
        // «Menos movimiento» de Ajustes (el de Windows la página ya lo ve sola).
        orbe.Quieto(AvatarView.MenosMovimientoPedido);
        bool visible = OrbeVisible;
        if (visible != carasEscondidas)
        {
            carasEscondidas = visible;
            // Escondidos, no quitados: siguen marcando el hueco y vuelven solos si el orbe cae.
            foreach (var c in CarasDeAura) c.Visibility = visible ? Visibility.Hidden : Visibility.Visible;
        }
        // Al hablar, el escenario reemplaza también el subtítulo y la onda: las palabras salen del orbe.
        bool escena = visible && modo == Modo.Habla;
        var textos = escena ? Visibility.Hidden : Visibility.Visible;
        if (TextosHabla.Visibility != textos) TextosHabla.Visibility = BarrasHabla.Visibility = textos;
        // Salió del escenario (se calló, la interrumpieron, se abrió el panel): las palabras vuelven al orbe.
        if (enEscena && !escena) orbe.Callar();
        enEscena = escena;
        FrameworkElement? sitio = !visible ? null : modo switch
        {
            Modo.Escucha => AvatarEscucha,
            Modo.Piensa => AvatarPiensa,
            Modo.Habla => CapaHabla,
            Modo.Aviso => AvatarAviso,
            Modo.Confirma => AvatarConfirma,
            Modo.Panel => AvatarPanel,
            _ => null,
        };
        if (sitio == null) { orbe.Esconder(); return; }
        Point p;
        try { p = sitio.TransformToAncestor(Contenido).Transform(new Point(0, 0)); }
        catch (InvalidOperationException) { orbe.Esconder(); return; } // todavía sin acomodar
        double w = escena ? CapaHabla.Width : sitio.ActualWidth, h = escena ? CapaHabla.Height : sitio.ActualHeight;
        if (!(w > 1 && h > 1)) { orbe.Esconder(); return; }
        orbe.Ubicar(p.X, p.Y, w, h, escena, capas[modo].Opacidad.Valor);
        // En el panel se deja tocar (la onda y la gota de la página) y deslizar; en lo demás, el clic es del notch.
        orbe.IsHitTestVisible = modo == Modo.Panel;
    }

    /// <summary>
    /// ¿Se verían las palabras? Solo en el escenario de «habla» (o justo antes: la frase llega un instante antes de
    /// que suene y el notch pase a «habla»). Con el panel, un aviso o una confirmación delante, no se forman.
    /// </summary>
    bool PalabrasALaVista => !panelAbierto && propuesta == null && avisoActual == null && (!escuchando || AgenteAbierto);

    /// <summary>El nivel real de la voz que suena (altavoz o conversación en vivo).</summary>
    void BocaOrbe(double nivel) => orbe?.Boca(nivel);

    /// <summary>La frase que empieza a sonar, formada con partículas (con lo que dura su audio, si se sabe).</summary>
    void DecirOrbe(string texto, double? segundos)
    {
        if (orbe == null || !OrbeVisible || !PalabrasALaVista || pausadaPorBloqueo) return;
        orbe.Decir(texto, segundos);
    }

    /// <summary>Ajustes → Efectos de sonido (los del orbe: escucha, piensa, habla, listo, toque).</summary>
    void SonidosOrbe() => orbe?.Sonidos(ajustes.EfectosDeSonido);
}
