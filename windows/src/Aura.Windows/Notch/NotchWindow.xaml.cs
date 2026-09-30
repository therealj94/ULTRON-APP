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
/// y las esquinas de abajo redondas, como en la imagen de referencia) que crece y se encoge con
/// resortes, como la isla dinámica: reposo, escucha, piensa, habla, avisos, confirmaciones y el panel
/// completo. Todo el tamaño y la forma salen de tres resortes (ancho, alto, radio); cada capa se
/// funde con el suyo. La ventana es transparente: fuera de la silueta, los clics pasan de largo.
/// </summary>
public partial class NotchWindow : Window
{
    const double AnchoVentana = 640, Oreja = 10, AltoCompacto = 170;
    readonly bool soloRender;
    readonly Resorte ancho = new(236, 260, 25), alto = new(36, 260, 25), radio = new(13, 260, 25);
    // El brillo también entra y sale suave; sin brillo, el efecto se quita (una sombra invisible también cuesta dibujarla).
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
        Width = AnchoVentana; Height = AltoCompacto;
        AvatarPanel.Tocable = true;
        PrepararSoltar();
        Iniciar();
        if (soloRender) { Aplicar(); Dibujar(); return; }

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
    }

    // ───────────────────────────── forma y animación ─────────────────────────────

    (double W, double H, double R) Tamano(Modo m) => m switch
    {
        // Con música sonando el reposo se ensancha para su portada y sus barritas, como la isla.
        Modo.Reposo => raton ? (MusicaSonando ? 400 : 370, 42, 15) : (MusicaSonando ? 290 : 236, 36, 13),
        Modo.Musica => (450, 94, 28),
        Modo.Escucha => (360, 58, 21),
        Modo.Piensa => (340, 58, 21),
        Modo.Habla => (470, 80, 26),
        Modo.Aviso => (450, 84, 28),
        Modo.Confirma => (480, 118, 28),
        Modo.Panel => (560, AltoPanel, 30),
        _ => (236, 36, 13),
    };

    double AltoPanel => Math.Max(420, Math.Min(760, SystemParameters.WorkArea.Height - 24));

    /// <summary>Qué modo toca ahora, por prioridad: confirmar &gt; panel &gt; aviso &gt; escucha &gt; piensa &gt; habla &gt; reposo.</summary>
    Modo ModoQueToca()
    {
        if (propuesta != null) return Modo.Confirma;
        if (panelAbierto) return Modo.Panel;
        if (avisoActual != null) return Modo.Aviso;
        if (escuchando) return Modo.Escucha;
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
            if ((nuevo == Modo.Panel || panelAbierto) && !soloRender && Height < AltoPanel + 48) Height = AltoPanel + 48;
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
        // En reposo con el ratón encima: su nombre y el micrófono.
        NombreChico.Opacity = modo == Modo.Reposo && raton ? 1 : 0;
        MicChico.Opacity = modo == Modo.Reposo && raton ? 1 : 0;
        BotonCentroChico.Opacity = modo == Modo.Reposo && raton ? 1 : 0;
        // El micrófono silenciado se ve SIEMPRE (tachado, en rojo): nunca quedas sin saber si te oye.
        BotonSilencio.Opacity = modo == Modo.Reposo && (raton || microSilenciado) ? 1 : 0;
        Camara.Margin = new Thickness(0, modo == Modo.Reposo && !raton ? 13 : 14, 0, 0);
        brillo.Objetivo = modo switch { Modo.Escucha => 0.55, Modo.Habla => 0.35, Modo.Confirma => 0.45, Modo.Aviso => 0.3, Modo.Musica => 0.25, _ => 0 };
        if (soloRender && !pruebaAnimacion) { ancho.Saltar(w); alto.Saltar(h); radio.Saltar(r); brillo.Saltar(brillo.Objetivo); foreach (var (m, (_, op)) in capas) op.Saltar(m == modo ? 1 : 0); Dibujar(); return; }
        if (!animando) { animando = true; ultimo = reloj.Elapsed; CompositionTarget.Rendering += Fotograma; }
    }

    /// <summary>El brillo sigue la voz sin saltos: cambia su objetivo y deja que el resorte lo lleve.</summary>
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
        bool saltar = !pruebaAnimacion && !SystemParameters.ClientAreaAnimation;
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
            if (!panelAbierto && Height > AltoCompacto + 1) Height = AltoCompacto;
        }
    }

    /// <summary>La silueta de la imagen de referencia: orejas cóncavas arriba, lados rectos, esquinas de abajo redondas.</summary>
    internal static Geometry Silueta(double x0, double w, double h, double r, double e)
    {
        r = Math.Min(r, Math.Min(w / 2, h - e));
        var g = new StreamGeometry();
        using (var c = g.Open())
        {
            c.BeginFigure(new Point(x0 - e, 0), true, true);
            c.ArcTo(new Point(x0, e), new Size(e, e), 0, false, SweepDirection.Clockwise, true, true);
            c.LineTo(new Point(x0, h - r), true, true);
            c.ArcTo(new Point(x0 + r, h), new Size(r, r), 0, false, SweepDirection.Counterclockwise, true, true);
            c.LineTo(new Point(x0 + w - r, h), true, true);
            c.ArcTo(new Point(x0 + w, h - r), new Size(r, r), 0, false, SweepDirection.Counterclockwise, true, true);
            c.LineTo(new Point(x0 + w, e), true, true);
            c.ArcTo(new Point(x0 + w + e, 0), new Size(e, e), 0, false, SweepDirection.Clockwise, true, true);
        }
        g.Freeze();
        return g;
    }

    void Dibujar()
    {
        double w = ancho.Valor, h = alto.Valor, r = radio.Valor;
        var b = Math.Clamp(brillo.Valor, 0, 1);
        if (b < 0.01) { if (Forma.Effect != null) Forma.Effect = null; }
        else { if (Forma.Effect == null) Forma.Effect = Brillo; Brillo.Opacity = b; }
        double x0 = (AnchoVentana - w) / 2;
        Forma.Data = Silueta(x0, w, h, r, Oreja);
        Canvas.SetLeft(Contenido, x0); Canvas.SetTop(Contenido, 0);
        Contenido.Width = w; Contenido.Height = h;
        var clip = new RectangleGeometry(new Rect(0, -r, w, h + r), r, r); clip.Freeze();
        Contenido.Clip = clip;
        foreach (var (m, (capa, op)) in capas)
        {
            capa.Opacity = Math.Clamp(op.Valor, 0, 1);
            capa.Visibility = op.Valor < 0.01 && m != modo ? Visibility.Hidden : Visibility.Visible;
            ((TranslateTransform)capa.RenderTransform).Y = (1 - Math.Clamp(op.Valor, 0, 1)) * (m == modo ? -8 : 6);
        }
    }

    void Ubicar()
    {
        // Arriba al centro del monitor principal, pegado al borde (encima de la barra si la hubiera).
        Left = (SystemParameters.PrimaryScreenWidth - AnchoVentana) / 2;
        Top = 0;
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
        if (modo == Modo.Panel || modo == Modo.Confirma) return;
        if (modo == Modo.Aviso && avisoActual?.Accion != null) { AccionAviso(s, e); return; }
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
        menu.Items.Add("Abrir el Centro  (Ctrl+Alt+C)", null, (_, _) => Dispatcher.Invoke(() => AbrirCentro()));
        menu.Items.Add("Chat rápido en el notch  (Ctrl+Alt+A)", null, (_, _) => Dispatcher.Invoke(() => AbrirPanel(true)));
        menu.Items.Add("Hablar  (Ctrl+Alt+Espacio)", null, (_, _) => Dispatcher.Invoke(() => Microfono(this, new RoutedEventArgs())));
        menu.Items.Add("Pausar todo  (Ctrl+Alt+Esc)", null, (_, _) => Dispatcher.Invoke(PausarTodo));
        menu.Items.Add("Ajustes", null, (_, _) => Dispatcher.Invoke(() => AbrirCentro("ajustes")));
        menu.Items.Add(new Forms.ToolStripSeparator());
        menu.Items.Add("Salir", null, (_, _) => Dispatcher.Invoke(Close));
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
            var pantalla = Forms.Screen.PrimaryScreen!.Bounds;
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

    void AlCerrar(object? s, CancelEventArgs e)
    {
        if (!GuardarAntesDeSalir()) { e.Cancel = true; return; }
        CompositionTarget.Rendering -= Fotograma;
        vigia.Stop(); relojAviso?.Stop();
        Terminar();
        if (fuente != null) { for (int i = 1; i <= 5; i++) UnregisterHotKey(fuente.Handle, i); fuente.RemoveHook(Gancho); }
        if (bandeja != null) { bandeja.Visible = false; bandeja.Dispose(); }
        // En las pruebas del CI la que termina es la prueba (con su resultado escrito), no la ventana.
        if (!soloRender) Application.Current.Shutdown();
    }
}
