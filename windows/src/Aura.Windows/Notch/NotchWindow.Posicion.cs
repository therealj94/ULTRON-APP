using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Input;
using System.Windows.Threading;
using Aura.Windows.Core;

namespace Aura.Windows.Notch;

/// <summary>
/// Dónde vive el notch: pegado al borde de arriba o al de abajo de cualquier monitor, de izquierda a derecha.
/// Se arrastra desde la píldora (no desde sus botones) y al soltarlo se pega al borde más cercano, con imán a
/// la izquierda, al centro y a la derecha. Nunca queda flotando en medio de la pantalla. Doble clic: vuelve
/// arriba al centro. Las cuentas están en Aura.Windows.Core.PosicionNotch (probadas en windows/tests).
/// La ventana se coloca en píxeles físicos (la app es PerMonitorV2): cada monitor con su área y su escala.
/// </summary>
public partial class NotchWindow
{
    /// <summary>Lo que se separa la oreja del canto del monitor, y el ancho de la píldora que manda al colocarla (DIP).</summary>
    const double MargenBorde = 8, AnchoReposoBase = 236, UmbralArrastre = 5;

    LugarNotch lugar = LugarNotch.DeFabrica;
    /// <summary>En coordenadas de la ventana (DIP): el centro de la píldora en reposo y los cantos del monitor.</summary>
    double centroVentana = AnchoVentana / 2, limiteIzq = 0, limiteDer = AnchoVentana;
    /// <summary>El alto útil del monitor del notch (DIP), para el panel.</summary>
    double altoUtil = SystemParameters.WorkArea.Height;
    string monitorActual = "", monitorColocado = "";
    Point? inicioArrastre;
    bool arrastrando, tragarClic;
    double agarre;
    DispatcherTimer? clicDiferido;

    // ───────────── Win32: monitores y posición física ─────────────

    [StructLayout(LayoutKind.Sequential)] struct PUNTO { public int X, Y; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct MONITORINFOEX { public int cbSize; public RECT rcMonitor, rcWork; public uint dwFlags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szDevice; }
    delegate bool MonitorEnumProc(IntPtr h, IntPtr hdc, IntPtr r, IntPtr dato);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(PUNTO p, uint flags);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr h, ref MONITORINFOEX mi);
    [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc f, IntPtr dato);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out PUNTO p);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr despuesDe, int x, int y, int w, int alto, uint flags);
    [DllImport("shcore.dll")] static extern int GetDpiForMonitor(IntPtr h, int tipo, out uint dpiX, out uint dpiY);

    /// <summary>Un monitor: su nombre de Windows, su rectángulo, su área de trabajo (sin la barra) y su escala.</summary>
    sealed record InfoMonitor(string Nombre, RECT Area, RECT Trabajo, double Escala, bool Principal);

    static InfoMonitor? LeerMonitor(IntPtr h)
    {
        var mi = new MONITORINFOEX { cbSize = Marshal.SizeOf<MONITORINFOEX>() };
        if (h == IntPtr.Zero || !GetMonitorInfo(h, ref mi)) return null;
        double escala = 1;
        try { if (GetDpiForMonitor(h, 0, out var dx, out _) == 0 && dx > 0) escala = dx / 96.0; } catch (DllNotFoundException) { } catch (EntryPointNotFoundException) { }
        return new InfoMonitor(mi.szDevice ?? "", mi.rcMonitor, mi.rcWork, escala, (mi.dwFlags & 1) != 0);
    }

    /// <summary>Todos los monitores, de izquierda a derecha.</summary>
    static List<InfoMonitor> Monitores()
    {
        var lista = new List<InfoMonitor>();
        EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (h, _, _, _) => { if (LeerMonitor(h) is { } m) lista.Add(m); return true; }, IntPtr.Zero);
        return lista.OrderBy(m => m.Area.Left).ThenBy(m => m.Area.Top).ToList();
    }

    static InfoMonitor? MonitorEn(PUNTO p) => LeerMonitor(MonitorFromPoint(p, 2));

    /// <summary>El monitor guardado; si ya no está conectado (o no hay ninguno guardado), el principal.</summary>
    InfoMonitor? MonitorDelNotch()
    {
        var todos = Monitores();
        return todos.FirstOrDefault(m => m.Nombre.Length > 0 && string.Equals(m.Nombre, monitorActual, StringComparison.OrdinalIgnoreCase))
            ?? todos.FirstOrDefault(m => m.Principal) ?? todos.FirstOrDefault();
    }

    /// <summary>El rectángulo del monitor donde está el notch ahora (para saber si una app está a pantalla completa ahí).</summary>
    RECT? AreaDelNotch() => fuente == null ? null : LeerMonitor(MonitorFromWindow(fuente.Handle, 2))?.Area;

    // ───────────── colocar ─────────────

    /// <summary>Con «menos movimiento» (el de Windows o el de Ajustes): sin resortes, sin mirada ni saltos del avatar.</summary>
    static bool MenosMovimiento => AvatarView.MenosMovimiento;

    /// <summary>Lee de Ajustes dónde vive el notch (y si pide menos movimiento).</summary>
    void CargarLugar()
    {
        AvatarView.MenosMovimientoPedido = ajustes.MenosMovimiento;
        lugar = new LugarNotch(PosicionNotch.LeerBorde(ajustes.NotchBorde), PosicionNotch.LeerFraccion(ajustes.NotchFraccion));
        monitorActual = ajustes.NotchMonitor ?? "";
    }

    /// <summary>Coloca la ventana en su monitor y su borde (también al cambiar de pantalla, de escala o de alto).</summary>
    void Ubicar()
    {
        if (soloRender || fuente == null) return;
        var mon = MonitorDelNotch();
        if (mon == null) { Left = (SystemParameters.PrimaryScreenWidth - AnchoVentana) / 2; Top = 0; return; }
        Colocar(mon, lugar);
    }

    /// <summary>Pone la ventana (en píxeles físicos) y le dice a Dibujar dónde queda la píldora dentro de ella.</summary>
    void Colocar(InfoMonitor mon, LugarNotch l)
    {
        double s = mon.Escala;
        RECT a = mon.Area, t = mon.Trabajo;
        double c = PosicionNotch.CentroReposo(l.Fraccion, a.Left, a.Right, AnchoReposoBase * s, Oreja * s, MargenBorde * s);
        double izq = PosicionNotch.IzquierdaVentana(c, a.Left, a.Right, AnchoVentana * s);
        double arriba = PosicionNotch.ArribaVentana(l.Borde, Math.Round(Height * s), a.Top, t.Bottom);
        SetWindowPos(fuente!.Handle, IntPtr.Zero, (int)Math.Round(izq), (int)Math.Round(arriba), 0, 0, 0x0001 | 0x0004 | 0x0010); // sin tamaño, sin orden, sin activar
        centroVentana = (c - izq) / s; limiteIzq = (a.Left - izq) / s; limiteDer = (a.Right - izq) / s;
        altoUtil = (t.Bottom - t.Top) / s;
        monitorColocado = mon.Nombre;
        bool cambioBorde = l.Borde != lugar.Borde;
        lugar = l;
        if (cambioBorde) AplicarVidrio();
        Aplicar();
        Dibujar();
    }

    /// <summary>
    /// Cambia el alto de la ventana. Pegado abajo, la ventana crece hacia arriba: primero se mueve y luego se
    /// estira, para que la píldora no salte.
    /// </summary>
    void FijarAlto(double alto)
    {
        if (Math.Abs(Height - alto) < 0.5) return;
        if (!soloRender && fuente != null && lugar.Borde == BordeNotch.Abajo && MonitorDelNotch() is { } mon)
        {
            double s = mon.Escala;
            double c = PosicionNotch.CentroReposo(lugar.Fraccion, mon.Area.Left, mon.Area.Right, AnchoReposoBase * s, Oreja * s, MargenBorde * s);
            double izq = PosicionNotch.IzquierdaVentana(c, mon.Area.Left, mon.Area.Right, AnchoVentana * s);
            double arriba = PosicionNotch.ArribaVentana(BordeNotch.Abajo, Math.Round(alto * s), mon.Area.Top, mon.Trabajo.Bottom);
            SetWindowPos(fuente.Handle, IntPtr.Zero, (int)Math.Round(izq), (int)Math.Round(arriba), (int)Math.Round(AnchoVentana * s), (int)Math.Round(alto * s), 0x0004 | 0x0010);
        }
        Height = alto;
        Dibujar();
    }

    /// <summary>Guarda el lugar y lo aplica (desde el arrastre, el Centro o el doble clic).</summary>
    internal void MoverNotch(LugarNotch l, string? monitor)
    {
        if (monitor != null) monitorActual = monitor;
        ajustes.NotchBorde = PosicionNotch.Nombre(l.Borde);
        ajustes.NotchFraccion = PosicionNotch.LeerFraccion(l.Fraccion);
        ajustes.NotchMonitor = monitorActual;
        if (!soloRender) GuardarAjustes();
        if (soloRender || fuente == null) { bool cambio = l.Borde != lugar.Borde; lugar = l; if (cambio) AplicarVidrio(); Aplicar(); Dibujar(); return; }
        var mon = MonitorDelNotch();
        if (mon != null) Colocar(mon, l);
    }

    /// <summary>Arriba al centro del monitor principal, como al instalar.</summary>
    internal void RestablecerPosicion() => MoverNotch(LugarNotch.DeFabrica, "");

    /// <summary>Para el Centro: los monitores conectados y cuál usa el notch.</summary>
    object MonitoresParaCentro()
    {
        var todos = Monitores();
        var actual = MonitorDelNotch()?.Nombre ?? "";
        return todos.Select((m, i) => new
        {
            id = m.Nombre,
            nombre = T($"Pantalla {i + 1}", $"Display {i + 1}") + (m.Principal ? T(" (principal)", " (main)") : "") + $" · {m.Area.Right - m.Area.Left}×{m.Area.Bottom - m.Area.Top}",
            principal = m.Principal,
            actual = string.Equals(m.Nombre, actual, StringComparison.OrdinalIgnoreCase),
        }).ToArray();
    }

    // ───────────── arrastrar ─────────────

    /// <summary>Se puede arrastrar desde la píldora (no desde el panel ni una confirmación, que tienen botones y texto).</summary>
    bool SePuedeArrastrar => modo is Modo.Reposo or Modo.Escucha or Modo.Piensa or Modo.Habla or Modo.Musica;

    void PrepararArrastre()
    {
        // Los botones manejan su propio clic (marcan el evento), así que aquí solo llega lo que es la píldora.
        Raiz.MouseLeftButtonDown += (_, e) =>
        {
            if (soloRender || !SePuedeArrastrar) return;
            if (e.ClickCount == 2)
            {
                // Doble clic: arriba al centro.
                clicDiferido?.Stop(); inicioArrastre = null;
                // El clic que suelta el doble clic no abre nada.
                if (!lugar.EsDeFabrica || monitorActual.Length > 0) { RestablecerPosicion(); tragarClic = true; }
                e.Handled = true;
                return;
            }
            inicioArrastre = GetCursorPos(out var p) ? new Point(p.X, p.Y) : null;
        };
        MouseMove += (_, e) =>
        {
            if (inicioArrastre is not { } ini || e.LeftButton != MouseButtonState.Pressed) { if (!arrastrando) inicioArrastre = null; return; }
            if (!GetCursorPos(out var p)) return;
            if (!arrastrando)
            {
                double escala = MonitorEn(p)?.Escala ?? 1;
                if (Math.Abs(p.X - ini.X) < UmbralArrastre * escala && Math.Abs(p.Y - ini.Y) < UmbralArrastre * escala) return;
                if (!CaptureMouse()) return;
                arrastrando = true;
                clicDiferido?.Stop();
                // Dónde se agarró la píldora (respecto a su centro), para que no salte bajo el cursor.
                var mon = MonitorDelNotch();
                double s = mon?.Escala ?? 1;
                agarre = mon == null ? 0 : ini.X - PosicionNotch.CentroReposo(lugar.Fraccion, mon.Area.Left, mon.Area.Right, AnchoReposoBase * s, Oreja * s, MargenBorde * s);
                Cursor = Cursors.SizeAll;
            }
            Arrastrar(p, guardar: false);
        };
        MouseLeftButtonUp += (_, e) =>
        {
            if (!arrastrando) { inicioArrastre = null; return; }
            e.Handled = true;
            TerminarArrastre();
        };
        LostMouseCapture += (_, _) => { if (arrastrando) TerminarArrastre(); };
    }

    /// <summary>El notch sigue al cursor por el borde más cercano del monitor que tiene debajo.</summary>
    void Arrastrar(PUNTO p, bool guardar)
    {
        var mon = MonitorEn(p);
        if (mon == null) return;
        double s = mon.Escala;
        var borde = PosicionNotch.BordeMasCercano(p.Y, mon.Area.Top, mon.Area.Bottom);
        double f = PosicionNotch.Fraccion(p.X - agarre, mon.Area.Left, mon.Area.Right, AnchoReposoBase * s, Oreja * s, MargenBorde * s, PosicionNotch.ImanPorDefecto * s);
        var l = new LugarNotch(borde, f);
        if (guardar) { MoverNotch(l, mon.Principal ? "" : mon.Nombre); return; }
        monitorActual = mon.Principal ? "" : mon.Nombre;
        if (l != lugar || !string.Equals(mon.Nombre, monitorColocado, StringComparison.OrdinalIgnoreCase)) Colocar(mon, l);
    }

    void TerminarArrastre()
    {
        arrastrando = false;
        inicioArrastre = null;
        Cursor = null;
        if (IsMouseCaptured) ReleaseMouseCapture();
        // Al soltar: se pega al borde y a la posición más cercanos, y se recuerda.
        if (GetCursorPos(out var p)) Arrastrar(p, guardar: true);
        AvisarEstadoCentro(); // el Centro abierto ve la posición nueva
    }

    /// <summary>
    /// Un clic en la píldora: si el notch está movido, se espera un instante por si es un doble clic (que lo
    /// devuelve arriba al centro); en su lugar de siempre, el clic va directo.
    /// </summary>
    bool DiferirClic(Action accion)
    {
        if (arrastrando) return true;
        if (tragarClic) { tragarClic = false; return true; }
        if (lugar.EsDeFabrica && monitorActual.Length == 0) return false;
        clicDiferido?.Stop();
        clicDiferido = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(Math.Min(400, System.Windows.Forms.SystemInformation.DoubleClickTime)) };
        clicDiferido.Tick += (_, _) => { clicDiferido?.Stop(); accion(); };
        clicDiferido.Start();
        return true;
    }
}
