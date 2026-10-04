using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;
using Aura.Windows.Core;
using Forms = System.Windows.Forms;

namespace Aura.Windows.Notch;

/// <summary>Lo que el notch está mostrando. Cada uno tiene su tamaño y su capa.</summary>
internal enum Modo { Reposo, Escucha, Piensa, Habla, Musica, Aviso, Confirma, Panel }

/// <summary>Un aviso de la isla: título, cuerpo, icono y (opcional) un botón.</summary>
internal sealed record Aviso(string Titulo, string Cuerpo, string Icono = "", string Cara = "happy", string? Boton = null, Action? Accion = null, double Segundos = 4.2);

/// <summary>
/// El notch de AURA para Windows. Una silueta negra pegada al borde de arriba (con las orejas cóncavas
/// y las esquinas de abajo redondas, como en la imagen de referencia) o, si lo arrastras, al de abajo
/// (la misma silueta reflejada, creciendo hacia arriba; ver NotchWindow.Posicion.cs), que crece y se encoge con
/// resortes, como la isla dinámica: reposo, escucha, piensa, habla, avisos, confirmaciones y el panel
/// completo. Todo el tamaño y la forma salen de tres resortes (ancho, alto, radio); cada capa se
/// funde con el suyo. La ventana es transparente: fuera de la silueta, los clics pasan de largo.
/// </summary>
public partial class NotchWindow : Window
{
    const double AnchoVentana = 640, Oreja = 10, AltoCompacto = 170;
    readonly bool soloRender;
    readonly Resorte ancho = new(236, 260, 25), alto = new(36, 260, 25), radio = new(13, 260, 25);
    // «brillo» (el nombre de siempre) es la presencia del filo grabado: entra y sale suave y sigue la voz.
    // Ya no es un resplandor: es la opacidad de una línea de 1 px (ver NotchWindow.Contraste.cs).
    readonly Resorte brillo = new(0, 200, 28);
    readonly Dictionary<Modo, (FrameworkElement Capa, Resorte Opacidad)> capas = new();
    readonly Stopwatch reloj = Stopwatch.StartNew();
    TimeSpan ultimo;
    bool animando, raton, oculto;
    Modo modo = Modo.Reposo;
    readonly Queue<Aviso> avisos = new();
    Aviso? avisoActual;
    DispatcherTimer? relojAviso;
    readonly DispatcherTimer vigia = new() { Interval = TimeSpan.FromSeconds(1.5) };
    Forms.NotifyIcon? bandeja;
    HwndSource? fuente;

    [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr h, int id, uint mods, uint vk);
    [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr h, int id);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
    [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr h, int i, int v);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int n);
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }

    public NotchWindow() : this(false) { }

    internal NotchWindow(bool soloRender)
    {
        this.soloRender = soloRender;
        InitializeComponent();
        PrepararContraste();
        capas[Modo.Reposo] = (CapaReposo, new Resorte(1, 420, 40));
        capas[Modo.Escucha] = (CapaEscucha, new Resorte(0, 420, 40));
        capas[Modo.Piensa] = (CapaPiensa, new Resorte(0, 420, 40));
        capas[Modo.Habla] = (CapaHabla, new Resorte(0, 420, 40));
        capas[Modo.Musica] = (CapaMusica, new Resorte(0, 420, 40));
        capas[Modo.Aviso] = (CapaAviso, new Resorte(0, 420, 40));
        capas[Modo.Confirma] = (CapaConfirma, new Resorte(0, 420, 40));
        capas[Modo.Panel] = (CapaPanel, new Resorte(0, 380, 38));
        foreach (var (capa, _) in capas.Values) { capa.HorizontalAlignment = HorizontalAlignment.Center; capa.VerticalAlignment = VerticalAlignment.Top; capa.RenderTransform = new TranslateTransform(); }
        Contenido.MouseLeftButtonUp += ClicForma;
        MouseEnter += (_, _) => { raton = true; Recalcular(); };
        MouseLeave += (_, _) => { raton = false; Recalcular(); };
        // Clic en otra ventana: el panel se recoge solo (salvo que estés hablando, escribiendo o haya algo que confirmar).
        Deactivated += (_, _) =>
        {
            if (panelAbierto && propuesta == null && !escuchando && !pensando && !hablandoAhora && Entrada.Text.Length == 0)
                AbrirPanel(false);
        };
        Width = AnchoVentana; Height = AltoCompacto;
        AvatarPanel.Tocable = true;
        PrepararSoltar();
        PrepararArrastre();
        Iniciar();
        CargarLugar();
        if (soloRender) { Aplicar(); Dibujar(); return; }
        // La cara de AU-RA: el orbe de partículas (NotchWindow.Orbe.cs). Si no llega a estar listo, el avatar de siempre.
        PrepararOrbe();

        SourceInitialized += (_, _) =>
        {
            fuente = HwndSource.FromHwnd(new WindowInteropHelper(this).Handle);
            fuente.AddHook(Gancho);
            // Sin Alt+Tab, y sin robar el foco al hacer clic (la app donde trabajas sigue activa).
            SetWindowLong(fuente.Handle, -20, GetWindowLong(fuente.Handle, -20) | 0x80 | 0x08000000);
            bool ok = RegisterHotKey(fuente.Handle, 1, 0x4003, 0x20) & RegisterHotKey(fuente.Handle, 2, 0x4003, 0x1B)
                    & RegisterHotKey(fuente.Handle, 3, 0x4003, 0x57) & RegisterHotKey(fuente.Handle, 4, 0x4003, 0x41)
                    & RegisterHotKey(fuente.Handle, 5, 0x4003, 0x43);
            if (!ok) Avisar(new Aviso("Un atajo está ocupado", "Otra app usa Ctrl+Alt+Espacio, W, A, C o Esc. Toca el notch o usa la bandeja.", "", "worried"));
            Ubicar();
        };
        Loaded += (_, _) => { Ubicar(); Aplicar(); Dibujar(); };
        CrearBandeja();
        vigia.Tick += (_, _) => Vigilar();
        vigia.Start();
        Closing += AlCerrar;
        // Windows bloqueado: AURA deja de oír y de hablar hasta que desbloquees (NotchWindow.Asistente.cs).
        Microsoft.Win32.SystemEvents.SessionSwitch += AlCambiarSesion;
    }

    // ───────────────────────────── forma y animación ─────────────────────────────

    (double W, double H, double R) Tamano(Modo m) => m switch
    {
        // Con música sonando el reposo se ensancha para su portada y sus barritas, como la isla; con el ratón
        // encima, más todavía para los controles (anterior, play/pausa, siguiente) sin tapar la cámara.
        Modo.Reposo => raton ? (MusicaALaMano ? 500 : 370, 42, 15) : (MusicaSonando ? 290 : 236, 36, 13),
        Modo.Musica => (450, 94, 28),
        Modo.Escucha => (360, 58, 21),
        Modo.Piensa => (340, 58, 21),
        // Con el orbe, «habla» abre su escenario: el orbe arriba y la frase formada con sus partículas debajo.
        Modo.Habla => OrbeVisible ? (470, AltoEscenario, 30) : (470, 80, 26),
        Modo.Aviso => (450, 84, 28),
        Modo.Confirma => (480, 118, 28),
        Modo.Panel => (560, AltoPanel, 30),
        _ => (236, 36, 13),
    };

    /// <summary>El alto del panel: lo que quepa en el monitor del notch (abajo deja sitio para que la ventana no se salga por arriba).</summary>
    double AltoPanel => Math.Max(420, Math.Min(760, altoUtil - (lugar.Borde == BordeNotch.Abajo ? 56 : 24)));

    /// <summary>Qué modo toca ahora, por prioridad: confirmar &gt; panel &gt; aviso &gt; escucha &gt; piensa &gt; habla &gt; reposo.</summary>
    Modo ModoQueToca()
    {
        if (propuesta != null) return Modo.Confirma;
        if (panelAbierto) return Modo.Panel;
        if (avisoActual != null) return Modo.Aviso;
        // En la conversación en vivo el micrófono queda abierto todo el rato: con el orbe, mientras AURA contesta se ve que
        // habla (su escenario, con las palabras); con los demás avatares, como siempre, la capa de escucha.
        if (escuchando && !(hablandoAhora && AgenteAbierto && OrbeVisible)) return Modo.Escucha;
        if (pensando) return Modo.Piensa;
        if (hablandoAhora) return Modo.Habla;
        if (musicaVisible) return Modo.Musica;
        return Modo.Reposo;
    }

    void Recalcular()
    {
        var nuevo = ModoQueToca();
        if (nuevo != modo)
        {
            // La ventana crece ANTES de animar hacia el panel (o la confirmación sobre el panel).
            if ((nuevo == Modo.Panel || panelAbierto) && !soloRender && Height < AltoPanel + 48) FijarAlto(AltoPanel + 48);
            modo = nuevo;
        }
        Aplicar();
    }

    /// <summary>Pone los objetivos de los resortes y el tamaño fijo de cada capa (así no se re-mide nada al animar).</summary>
    void Aplicar()
    {
        var (w, h, r) = Tamano(modo);
        ancho.Objetivo = w; alto.Objetivo = h; radio.Objetivo = r;
        foreach (var (m, (capa, op)) in capas)
        {
            var (cw, ch, _) = Tamano(m);
            capa.Width = cw; capa.Height = ch;
            op.Objetivo = m == modo ? 1 : 0;
            capa.IsHitTestVisible = m == modo;
        }
        // En reposo con el ratón encima: su nombre, el Centro y el micrófono, escalonados. El micrófono silenciado
        // se ve SIEMPRE (tachado, en lacre): nunca quedas sin saber si te oye.
        Templar();
        AparecerControles();
        PintarMusicaChica();
        // La «cámara» solo arriba al centro (imita el notch de la cámara); la luz del micrófono se ve siempre.
        bool abajo = lugar.Borde == BordeNotch.Abajo;
        var camara = lugar.EsDeFabrica && monitorActual.Length == 0 ? Visibility.Visible : Visibility.Collapsed;
        PuntoCamara.Visibility = LenteCamara.Visibility = camara;
        LuzMic.Margin = new Thickness(camara == Visibility.Visible ? 10 : 0, 2, 0, 0);
        double hueco = modo == Modo.Reposo && !raton ? 13 : 14;
        Camara.VerticalAlignment = abajo ? VerticalAlignment.Bottom : VerticalAlignment.Top;
        Camara.Margin = abajo ? new Thickness(0, 0, 0, hueco) : new Thickness(0, hueco, 0, 0);
        brillo.Objetivo = FiloDeModo();
        PintarFilo();
        // Una capa más alta que la ventana compacta (el escenario del orbe): la ventana crece antes de animar.
        if (!soloRender && !panelAbierto && h + 48 > Height) FijarAlto(h + 48);
        ActualizarOrbe();
        if (soloRender && !pruebaAnimacion) { BarrasEscucha.Asentar(); BarrasHabla.Asentar(); ancho.Saltar(w); alto.Saltar(h); radio.Saltar(r); brillo.Saltar(brillo.Objetivo); foreach (var (m, (_, op)) in capas) op.Saltar(m == modo ? 1 : 0); Dibujar(); return; }
        if (!animando) { animando = true; ultimo = reloj.Elapsed; CompositionTarget.Rendering += Fotograma; }
    }

    /// <summary>El filo sigue la voz sin saltos: cambia su objetivo y deja que el resorte lo lleve.</summary>
    void AnimarBrillo(double v)
    {
        brillo.Objetivo = Math.Clamp(v, 0, 1);
        if (!animando && !soloRender) { animando = true; ultimo = reloj.Elapsed; CompositionTarget.Rendering += Fotograma; }
    }

    void Fotograma(object? s, EventArgs e)
    {
        var ahora = reloj.Elapsed;
        double dt = (ahora - ultimo).TotalSeconds; ultimo = ahora;
        medidor?.Fotograma(ahora);
        // Movimiento reducido: directo al final, sin animar (la prueba de fluidez anima siempre, para medir los resortes).
        bool saltar = !pruebaAnimacion && MenosMovimiento;
        if (saltar) { ancho.Saltar(ancho.Objetivo); alto.Saltar(alto.Objetivo); radio.Saltar(radio.Objetivo); brillo.Saltar(brillo.Objetivo); }
        else { ancho.Paso(dt); alto.Paso(dt); radio.Paso(dt); brillo.Paso(dt); }
        bool quieto = ancho.Quieto && alto.Quieto && radio.Quieto && Math.Abs(brillo.Valor - brillo.Objetivo) < 0.005;
        foreach (var (_, op) in capas.Values) { if (saltar) op.Saltar(op.Objetivo); else op.Paso(dt); quieto &= op.Quieto; }
        Dibujar();
        medidor?.Dibujado();
        if (quieto)
        {
            CompositionTarget.Rendering -= Fotograma; animando = false;
            medidor?.Pausa(); // el tiempo quieto no es un fotograma lento
            double queda = Math.Max(AltoCompacto, alto.Objetivo + 48);
            if (!panelAbierto && Height > queda + 1) FijarAlto(queda);
        }
    }

    /// <summary>
    /// La silueta de la imagen de referencia: orejas cóncavas arriba, lados rectos, esquinas de abajo redondas.
    /// Con <paramref name="abajo"/>, la misma reflejada: pegada al borde de abajo de un lienzo de alto
    /// <paramref name="lienzo"/>, con las orejas cóncavas hacia arriba.
    /// </summary>
    internal static Geometry Silueta(double x0, double w, double h, double r, double e, bool abajo = false, double lienzo = 0)
    {
        r = Math.Min(r, Math.Min(w / 2, h - e));
        Point P(double x, double y) => new(x, abajo ? lienzo - y : y);
        var giro = abajo ? SweepDirection.Counterclockwise : SweepDirection.Clockwise;
        var contra = abajo ? SweepDirection.Clockwise : SweepDirection.Counterclockwise;
        var g = new StreamGeometry();
        using (var c = g.Open())
        {
            c.BeginFigure(P(x0 - e, 0), true, true);
            c.ArcTo(P(x0, e), new Size(e, e), 0, false, giro, true, true);
            c.LineTo(P(x0, h - r), true, true);
            c.ArcTo(P(x0 + r, h), new Size(r, r), 0, false, contra, true, true);
            c.LineTo(P(x0 + w - r, h), true, true);
            c.ArcTo(P(x0 + w, h - r), new Size(r, r), 0, false, contra, true, true);
            c.LineTo(P(x0 + w, e), true, true);
            c.ArcTo(P(x0 + w + e, 0), new Size(e, e), 0, false, giro, true, true);
        }
        g.Freeze();
        return g;
    }

    void Dibujar()
    {
        double w = ancho.Valor, h = alto.Valor, r = radio.Valor;
        Filo.Opacity = Math.Clamp(brillo.Valor, 0, 1);
        // En su sitio; si crece cerca de un lado del monitor, se corre hacia dentro para quedar entera.
        double x0 = PosicionNotch.CentroVisible(centroVentana, w, limiteIzq, limiteDer, Oreja, MargenBorde) - w / 2;
        bool abajo = lugar.Borde == BordeNotch.Abajo;
        double lienzo = double.IsFinite(Height) ? Height : AltoCompacto;
        Forma.Data = Reflejo.Data = Silueta(x0, w, h, r, Oreja, abajo, lienzo);
        PintarVidrio();
        Canvas.SetLeft(Contenido, x0); Canvas.SetTop(Contenido, abajo ? lienzo - h : 0);
        Contenido.Width = w; Contenido.Height = h;
        // Las esquinas del lado pegado al borde quedan fuera del recorte (ese lado es recto).
        var clip = new RectangleGeometry(abajo ? new Rect(0, 0, w, h + r) : new Rect(0, -r, w, h + r), r, r); clip.Freeze();
        Contenido.Clip = clip;
        double entra = abajo ? 8 : -8, sale = abajo ? -6 : 6;
        foreach (var (m, (capa, op)) in capas)
        {
            capa.Opacity = Math.Clamp(op.Valor, 0, 1);
            capa.Visibility = op.Valor < 0.01 && m != modo ? Visibility.Hidden : Visibility.Visible;
            ((TranslateTransform)capa.RenderTransform).Y = MenosMovimiento ? 0 : (1 - Math.Clamp(op.Valor, 0, 1)) * (m == modo ? entra : sale);
        }
        ColocarOrbe();
    }

    /// <summary>
    /// Solo el panel toma el foco (para escribir en el chat). Al abrirlo se recuerda la ventana de trabajo y
    /// al cerrarlo se le devuelve: tu app nunca se queda sin foco por culpa del notch.
    /// </summary>
    internal void Activar(bool si)
    {
        if (fuente == null) return;
        int ex = GetWindowLong(fuente.Handle, -20);
        SetWindowLong(fuente.Handle, -20, si ? ex & ~0x08000000 : ex | 0x08000000);
        if (si) { Manos.Pantalla.Recordar(fuente.Handle); Activate(); Dispatcher.BeginInvoke(new Action(() => Entrada.Focus()), DispatcherPriority.Input); }
        else if (IsActive && Manos.Pantalla.UltimaAjena != IntPtr.Zero) { try { Manos.Ventanas.AlFrente(Manos.Pantalla.UltimaAjena); } catch { } }
    }

    // ───────────────────────────── avisos ─────────────────────────────

    internal void Avisar(Aviso a)
    {
        avisos.Enqueue(a);
        if (avisoActual == null) SiguienteAviso();
    }

    void SiguienteAviso()
    {
        relojAviso?.Stop();
        if (avisos.Count == 0) { avisoActual = null; Recalcular(); return; }
        var a = avisoActual = avisos.Dequeue();
        TituloAviso.Text = a.Titulo; CuerpoAviso.Text = a.Cuerpo; IconoAviso.Codigo = a.Icono; AvatarAviso.Estado = a.Cara;
        CuerpoAviso.Visibility = string.IsNullOrWhiteSpace(a.Cuerpo) ? Visibility.Collapsed : Visibility.Visible;
        BotonAviso.Visibility = a.Boton != null ? Visibility.Visible : Visibility.Collapsed;
        BotonAviso.Content = a.Boton;
        Recalcular();
        GolpeDeAviso();
        if (soloRender) return;
        relojAviso = new DispatcherTimer { Interval = TimeSpan.FromSeconds(a.Segundos) };
        relojAviso.Tick += (_, _) => { if (raton && modo == Modo.Aviso) return; SiguienteAviso(); };
        relojAviso.Start();
    }

    void AccionAviso(object s, RoutedEventArgs e)
    {
        var a = avisoActual;
        SiguienteAviso();
        try { a?.Accion?.Invoke(); } catch (Exception ex) { Avisar(new Aviso("No se pudo", ex.Message, "", "worried")); }
        e.Handled = true;
    }

    // ───────────────────────────── ratón, teclas, bandeja ─────────────────────────────

    void EntraRaton(object s, MouseEventArgs e) { }
    void SaleRaton(object s, MouseEventArgs e) { }

    void ClicForma(object s, MouseButtonEventArgs e)
    {
        if (arrastrando || modo == Modo.Panel || modo == Modo.Confirma) return;
        if (modo == Modo.Aviso && avisoActual?.Accion != null) { AccionAviso(s, e); return; }
        // Movido de su sitio, el clic espera un instante por si es doble clic (vuelve arriba al centro).
        if (SePuedeArrastrar && DiferirClic(ClicPildora)) return;
        ClicPildora();
    }

    void ClicPildora()
    {
        if (modo == Modo.Panel || modo == Modo.Confirma) return;
        // Con música: el primer toque abre su tarjeta; el segundo, el chat.
        if (modo == Modo.Reposo && MusicaSonando && !musicaVisible) { MostrarTarjetaMusica(6); return; }
        if (modo == Modo.Musica) { musicaVisible = false; }
        if (modo == Modo.Aviso) SiguienteAviso();
        AbrirPanel(true);
    }

    void MenuForma(object s, MouseButtonEventArgs e) => bandeja?.ContextMenuStrip?.Show(Forms.Cursor.Position);

    void Teclas(object s, KeyEventArgs e)
    {
        if (e.Key == Key.Escape) { if (propuesta != null) _ = Responder(false); else AbrirPanel(false); e.Handled = true; }
    }

    IntPtr Gancho(IntPtr h, int msg, IntPtr w, IntPtr l, ref bool manejado)
    {
        if (msg == 0x0312)
        {
            switch (w.ToInt32())
            {
                case 1: if (fuente != null) Manos.Pantalla.Recordar(fuente.Handle); Microfono(this, new RoutedEventArgs()); break;
                case 2: PausarTodo(); break;
                case 3: ElegirDestino(); break;
                case 4: AbrirPanel(!panelAbierto); break;
                case 5: AbrirCentro(); break;
            }
            manejado = true;
        }
        if (msg is 0x007E or 0x02E0) Dispatcher.BeginInvoke(new Action(Ubicar)); // cambió la pantalla o el DPI
        return IntPtr.Zero;
    }

    void CrearBandeja()
    {
        bandeja = new Forms.NotifyIcon { Icon = System.Drawing.Icon.ExtractAssociatedIcon(Environment.ProcessPath!) ?? System.Drawing.SystemIcons.Application, Text = "AURA", Visible = true };
        bandeja.MouseClick += (_, e) => { if (e.Button == Forms.MouseButtons.Left) Dispatcher.Invoke(() => AbrirPanel(!panelAbierto)); };
        var menu = new Forms.ContextMenuStrip();
        // Los atajos van a la derecha, en Plex Mono (los dibuja MenuBandeja); el texto, solo.
        Forms.ToolStripMenuItem Item(string texto, string atajo, Action hacer)
        {
            var i = new Forms.ToolStripMenuItem(texto, null, (_, _) => Dispatcher.Invoke(hacer)) { ShortcutKeyDisplayString = atajo };
            menu.Items.Add(i);
            return i;
        }
        Item("Abrir el Centro", "Ctrl+Alt+C", () => AbrirCentro());
        Item("Chat rápido en el notch", "Ctrl+Alt+A", () => AbrirPanel(true));
        Item("Hablar", "Ctrl+Alt+Espacio", () => Microfono(this, new RoutedEventArgs()));
        Item("Pausar todo", "Ctrl+Alt+Esc", () => PausarTodo());
        Item("Ajustes", "", () => AbrirCentro("ajustes"));
        menu.Items.Add(new Forms.ToolStripSeparator());
        Item("Cerrar AURA por completo", "", () => SalirDelTodo()).Tag = "peligro";
        MenuBandeja.Vestir(menu);
        bandeja.ContextMenuStrip = menu;
    }

    /// <summary>Con un juego o un video a pantalla completa, el notch se aparta (salvo que esté hablando o avisando).</summary>
    void Vigilar()
    {
        if (fuente != null) Manos.Pantalla.Recordar(fuente.Handle);
        if (fuente == null || !ajustes.OcultarEnPantallaCompleta) { Mostrar(true); return; }
        var fg = GetForegroundWindow();
        bool completa = false;
        if (fg != IntPtr.Zero && fg != fuente.Handle && GetWindowRect(fg, out var r))
        {
            var sb = new System.Text.StringBuilder(64); GetClassName(fg, sb, 64);
            var clase = sb.ToString();
            // El monitor donde está el notch (no siempre el principal).
            var pb = Forms.Screen.PrimaryScreen!.Bounds;
            var pantalla = AreaDelNotch() ?? new RECT { Left = pb.Left, Top = pb.Top, Right = pb.Right, Bottom = pb.Bottom };
            completa = clase is not ("Progman" or "WorkerW" or "Shell_TrayWnd") && r.Left <= pantalla.Left && r.Top <= pantalla.Top && r.Right >= pantalla.Right && r.Bottom >= pantalla.Bottom;
        }
        Mostrar(!completa || modo != Modo.Reposo);
    }

    void Mostrar(bool si)
    {
        if (si == !oculto) return;
        oculto = !si;
        Raiz.Opacity = si ? 1 : 0;
        Raiz.IsHitTestVisible = si;
    }

    /// <summary>
    /// Cerrar AURA de verdad (bandeja, notch y Centro: «Cerrar AURA por completo»). Antes «Salir» podía dejar el
    /// proceso vivo y escondido: si un paso de la limpieza fallaba, el cierre se cortaba ahí, o un hilo de audio o
    /// de red seguía corriendo; y como AURA es una sola, volver a abrirla no hacía nada (le pasaba el pedido a la
    /// que quedó escondida). Ahora cada paso va por separado y, si en 5 s el proceso no terminó, se termina igual.
    /// </summary>
    internal void SalirDelTodo(bool sinPreguntar = false)
    {
        if (sinPreguntar) borradorSucio = false;
        saliendo = true;
        Close();
    }

    bool saliendo, cerrado;

    void AlCerrar(object? s, CancelEventArgs e)
    {
        if (cerrado) return;
        if (!GuardarAntesDeSalir()) { e.Cancel = true; saliendo = false; return; }
        cerrado = true;
        // El reloj de seguridad va primero: pase lo que pase en la limpieza, el proceso termina.
        if (!soloRender)
            new System.Threading.Thread(() => { System.Threading.Thread.Sleep(5000); Centro.Registro.Anotar("salir", "la limpieza no terminó en 5 s: salida forzada"); Environment.Exit(0); }) { IsBackground = true }.Start();
        Centro.Registro.Anotar("salir", "cerrando AURA por completo");
        Seguro(() => CompositionTarget.Rendering -= Fotograma);
        Seguro(() => { if (!soloRender) Microsoft.Win32.SystemEvents.SessionSwitch -= AlCambiarSesion; });
        Seguro(() => { vigia.Stop(); relojAviso?.Stop(); });
        Seguro(() => { if (AgenteAbierto || abriendoAgente) CerrarAgente(); });
        Seguro(Terminar);
        Seguro(() => { if (fuente != null) { for (int i = 1; i <= 5; i++) UnregisterHotKey(fuente.Handle, i); fuente.RemoveHook(Gancho); } });
        Seguro(() => { if (bandeja != null) { bandeja.Visible = false; bandeja.Dispose(); } });
        // En las pruebas del CI la que termina es la prueba (con su resultado escrito), no la ventana.
        if (!soloRender) Application.Current.Shutdown();
    }

    /// <summary>Un paso de la limpieza al cerrar: si falla se anota y se sigue con el siguiente.</summary>
    static void Seguro(Action paso)
    {
        try { paso(); }
        catch (Exception ex) { Centro.Registro.Anotar("salir", "un paso falló (sigo): " + ex.GetBaseException().Message); }
    }
}
