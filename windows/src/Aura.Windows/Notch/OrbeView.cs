using System;
using System.IO;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using Aura.Windows.Core;

namespace Aura.Windows.Notch;

/// <summary>
/// La cara de AURA: el orbe de partículas que forma con sus partículas las palabras que dice (src/14-orbe/orbe.html,
/// aprobado por José; viaja como OrbeAssets/orbe.html y se sirve como https://orbe.aura.local/). Va en una WebView2 de
/// composición: la normal (una ventana encima) no se dibuja en una ventana transparente como el notch, esta sí, y se
/// recorta con la silueta y se funde con la capa como cualquier otro elemento.
/// Hasta que la página dice «listo» (y si falla, o no lo dice en 10 s, o no hay WebView2 Runtime) el notch sigue con el
/// AvatarView de siempre: nunca queda un hueco. Lo que se le manda lo arma <see cref="ProtocoloOrbe"/>.
/// </summary>
internal sealed class OrbeView : Grid, IDisposable
{
    readonly WebView2CompositionControl web = new()
    {
        // Antes de la primera imagen, el negro del orbe (nunca el blanco de una página vacía).
        DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, 1, 2, 5),
        IsTabStop = false, Focusable = false,
    };
    readonly DispatcherTimer espera = new() { Interval = ProtocoloOrbe.EsperaListo };
    readonly TranslateTransform mover = new();
    readonly LimitadorBoca limitador = new();
    readonly System.Diagnostics.Stopwatch reloj = System.Diagnostics.Stopwatch.StartNew();
    // En un hueco del notch (no el escenario de «habla»): el orbe se funde en redondo con el vidrio.
    static readonly Brush Mascara = Congelado(new RadialGradientBrush(new GradientStopCollection
    {
        new GradientStop(Colors.White, 0), new GradientStop(Colors.White, 0.62), new GradientStop(Colors.Transparent, 1),
    }));
    readonly bool sonidosAlEmpezar;
    bool iniciado, desechado, escena, marcoPuesto, sonidos, quieto;
    string cara = "IDLE";

    /// <summary>Dijo «listo» y no ha fallado desde entonces: ya se puede mostrar en vez del avatar.</summary>
    public bool Listo { get; private set; }
    /// <summary>Falló para siempre (sin WebView2, sin WebGL, sin «listo» a tiempo): queda el avatar de siempre.</summary>
    public bool Fallo { get; private set; }
    /// <summary>Cambió <see cref="Listo"/> o <see cref="Fallo"/>: el notch decide qué cara se ve.</summary>
    public event Action? CambioDisponible;
    /// <summary>Lo deslizaron hacia «arriba» o «abajo» (con el dedo o el ratón).</summary>
    public event Action<string>? Deslizo;
    /// <summary>Terminó de formar y deshacer una frase.</summary>
    public event Action? TerminoFrase;

    public OrbeView(bool sonidos, bool quieto = false)
    {
        sonidosAlEmpezar = this.sonidos = sonidos;
        this.quieto = quieto;
        HorizontalAlignment = HorizontalAlignment.Left;
        VerticalAlignment = VerticalAlignment.Top;
        RenderTransform = mover;
        Width = Height = 64; // con tamaño desde el principio: la WebView no nace de 0 × 0
        Opacity = 0;
        Visibility = Visibility.Hidden;
        IsHitTestVisible = false;
        OpacityMask = Mascara;
        ClipToBounds = true;
        AutomationProperties.SetName(this, "AURA");
        Children.Add(web);
        Loaded += (_, _) => { if (!iniciado) { iniciado = true; _ = Iniciar(); } };
        espera.Tick += (_, _) => Fallar($"no dijo «listo» en {ProtocoloOrbe.EsperaListo.TotalSeconds:0} s");
    }

    async Task Iniciar()
    {
        espera.Start();
        try
        {
            var entorno = await Centro.EntornoWeb.Compartido();
            if (desechado || Fallo) return;
            await web.EnsureCoreWebView2Async(entorno);
            if (desechado || Fallo) return;
            var core = web.CoreWebView2;
            core.Settings.AreHostObjectsAllowed = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.IsPinchZoomEnabled = false;
            core.Settings.IsSwipeNavigationEnabled = false;
            core.Settings.IsGeneralAutofillEnabled = false;
            core.Settings.IsPasswordAutosaveEnabled = false;
            core.SetVirtualHostNameToFolderMapping(ProtocoloOrbe.Host, Path.Combine(AppContext.BaseDirectory, "OrbeAssets"), CoreWebView2HostResourceAccessKind.DenyCors);
            // Solo la página del orbe: nada de navegar a otro lado, abrir ventanas, descargar ni pedir permisos.
            core.NavigationStarting += (_, e) => { if (e.Uri != ProtocoloOrbe.Pagina) e.Cancel = true; };
            core.FrameNavigationStarting += (_, e) => e.Cancel = true;
            core.NewWindowRequested += (_, e) => e.Handled = true;
            core.DownloadStarting += (_, e) => e.Cancel = true;
            core.PermissionRequested += (_, e) => { e.State = CoreWebView2PermissionState.Deny; e.SavesInProfile = false; };
            core.WebMessageReceived += (_, e) => Recibir(e);
            core.ProcessFailed += (_, e) => Dispatcher.BeginInvoke(new Action(() => Fallar("WebView2: " + e.ProcessFailedKind)));
            core.NavigationCompleted += (_, e) => { if (!e.IsSuccess) { var porque = e.WebErrorStatus; Dispatcher.BeginInvoke(new Action(() => Fallar("no cargó (" + porque + ")"))); } };
            // Sus opciones ANTES de que corra la página: sin panel de prueba, sin voz propia y los efectos según Ajustes.
            await core.AddScriptToExecuteOnDocumentCreatedAsync(ProtocoloOrbe.Preparacion(sonidosAlEmpezar));
            if (desechado || Fallo) return;
            if (quieto) await AplicarQuietud(false);
            if (desechado || Fallo) return;
            web.ZoomFactor = ProtocoloOrbe.Zoom;
            core.Navigate(ProtocoloOrbe.Pagina);
        }
        catch (Exception ex)
        {
            // Sin WebView2 Runtime (o sin la carpeta OrbeAssets): el avatar de siempre, y queda anotado por qué.
            Fallar(ex.GetBaseException().Message);
        }
    }

    void Recibir(CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (desechado || !PuenteCentro.OrigenExacto(e.Source, ProtocoloOrbe.Origen)) return;
        string json;
        try { json = e.WebMessageAsJson; } catch { return; }
        var m = ProtocoloOrbe.Leer(json);
        switch (m.Tipo)
        {
            case TipoMensajeOrbe.Listo:
                espera.Stop();
                if (Fallo) return;
                Centro.Registro.Anotar("orbe", "listo");
                limitador.Reiniciar();
                marcoPuesto = false;
                // Lo que pasó mientras cargaba: el marco, la cara y los efectos de ahora.
                Marco();
                Mandar(ProtocoloOrbe.Sonido(sonidos));
                Mandar(ProtocoloOrbe.Estado(cara));
                if (!Listo) { Listo = true; CambioDisponible?.Invoke(); }
                break;
            case TipoMensajeOrbe.Fallo:
                // Perdió el contexto WebGL: la página se recarga sola. Mientras, el avatar; si no vuelve en 10 s, se queda el avatar.
                Centro.Registro.Anotar("orbe", "falló: " + m.Dato + " · el avatar de siempre mientras se recupera");
                if (Listo) { Listo = false; CambioDisponible?.Invoke(); }
                espera.Stop(); espera.Start();
                break;
            case TipoMensajeOrbe.Fin:
                // La página pasa sola a «escucha» tras una frase: se le repite la cara real.
                Mandar(ProtocoloOrbe.Estado(cara));
                TerminoFrase?.Invoke();
                break;
            case TipoMensajeOrbe.Deslizar:
                Deslizo?.Invoke(m.Dato);
                break;
            // «tocar»: la onda de luz y la gota de sonido las hace la página sola; «aura-state» solo confirma.
        }
    }

    void Fallar(string motivo)
    {
        espera.Stop();
        if (Fallo || desechado) return;
        Fallo = true;
        Listo = false;
        Centro.Registro.Anotar("orbe", "sin orbe (" + RegistroSeguro.Sanear(motivo) + "): el notch sigue con el avatar de siempre");
        Visibility = Visibility.Hidden;
        try { web.Dispose(); } catch { }
        Children.Clear();
        CambioDisponible?.Invoke();
    }

    void Mandar(string json)
    {
        if (desechado || Fallo) return;
        try { web.CoreWebView2?.PostWebMessageAsJson(json); }
        catch (Exception ex) when (ex is InvalidOperationException or ObjectDisposedException or System.Runtime.InteropServices.COMException) { }
    }

    void Marco()
    {
        if (desechado || Fallo || web.CoreWebView2 == null) return;
        marcoPuesto = true;
        try { _ = web.CoreWebView2.ExecuteScriptAsync(ProtocoloOrbe.Marco(!escena)); }
        catch (Exception ex) when (ex is InvalidOperationException or ObjectDisposedException or System.Runtime.InteropServices.COMException) { marcoPuesto = false; }
    }

    /// <summary>
    /// Dónde va (en coordenadas de su contenedor), de qué tamaño, si es el escenario de «habla» (orbe y palabras) o una
    /// cara en un hueco, y con qué opacidad (la de su capa). Cambiar de tamaño re-encuadra la página; moverse, no.
    /// </summary>
    public void Ubicar(double x, double y, double ancho, double alto, bool escenario, double opacidad)
    {
        if (Fallo) return;
        if (Math.Abs(Width - ancho) > 0.5) Width = ancho;
        if (Math.Abs(Height - alto) > 0.5) Height = alto;
        mover.X = x; mover.Y = y;
        Opacity = Math.Clamp(opacidad, 0, 1);
        // Escondido de verdad cuando no se ve: la WebView deja de dibujar y la página se pausa sola.
        var v = Listo && opacidad > 0.01 ? Visibility.Visible : Visibility.Hidden;
        if (Visibility != v) Visibility = v;
        if (escenario != escena || !marcoPuesto)
        {
            escena = escenario;
            OpacityMask = escena ? null : Mascara;
            if (Listo) Marco();
        }
    }

    /// <summary>Lo esconde sin moverlo (reposo, música, otro avatar).</summary>
    public void Esconder()
    {
        Opacity = 0;
        if (Visibility != Visibility.Hidden) Visibility = Visibility.Hidden;
    }

    /// <summary>La cara del orbe (IDLE, LISTENING, THINKING, SCAN, SPEAKING, HAPPY). Solo se manda si cambió.</summary>
    public void Cara(string nueva)
    {
        if (nueva == cara) return;
        cara = nueva;
        if (Listo) Mandar(ProtocoloOrbe.Estado(cara));
    }

    /// <summary>0..1: el nivel real de la voz que suena (unas 30 veces por segundo como mucho).</summary>
    public void Boca(double nivel)
    {
        if (!Listo) return;
        if (limitador.Pasa(nivel, reloj.Elapsed, out var n)) Mandar(ProtocoloOrbe.Boca(n));
    }

    /// <summary>Forma con partículas la frase que está sonando (la voz es de Windows: el orbe no habla).</summary>
    public void Decir(string texto, double? segundos)
    {
        if (!Listo) return;
        if (ProtocoloOrbe.Decir(texto, segundos) is { } json) Mandar(json);
    }

    /// <summary>Deshace las palabras: AURA se calló, la interrumpieron o ya no está en el escenario.</summary>
    public void Callar()
    {
        if (Listo) Mandar(ProtocoloOrbe.Callar());
    }

    /// <summary>Ajustes → Efectos de sonido.</summary>
    public void Sonidos(bool activos)
    {
        sonidos = activos;
        if (Listo) Mandar(ProtocoloOrbe.Sonido(activos));
    }

    /// <summary>
    /// «Menos movimiento» de Ajustes. La página lo lee al cargar: si cambia ya cargada, se le aplica y se recarga (vuelve
    /// a decir «listo» y recibe otra vez marco, cara y efectos).
    /// </summary>
    public void Quieto(bool si)
    {
        if (si == quieto) return;
        quieto = si;
        if (desechado || Fallo || web.CoreWebView2 == null) return; // si aún no cargó, Iniciar lo aplica antes de navegar
        _ = AplicarQuietud(true);
    }

    async Task AplicarQuietud(bool recargar)
    {
        try
        {
            await web.CoreWebView2.CallDevToolsProtocolMethodAsync("Emulation.setEmulatedMedia", ProtocoloOrbe.Quietud(quieto));
            if (!recargar || desechado || Fallo) return;
            espera.Stop(); espera.Start();
            web.CoreWebView2.Reload();
        }
        catch (Exception ex) { Centro.Registro.Anotar("orbe", "menos movimiento no se aplicó: " + ex.GetBaseException().Message); }
    }

    /// <summary>Prueba del CI (--orbe-self-test): una foto de lo que dibuja la página.</summary>
    internal async Task Fotografiar(string archivo)
    {
        using var f = File.Create(archivo);
        await web.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, f);
    }

    /// <summary>Prueba del CI: lo que devuelve un script en la página (JSON).</summary>
    internal Task<string> Evaluar(string script) => web.CoreWebView2.ExecuteScriptAsync(script);

    public void Dispose()
    {
        if (desechado) return;
        desechado = true;
        espera.Stop();
        Listo = false;
        try { web.Dispose(); } catch { }
    }

    static Brush Congelado(Brush b) { b.Freeze(); return b; }
}
