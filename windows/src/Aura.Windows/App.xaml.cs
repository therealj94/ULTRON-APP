using System.Linq;
using System;
using System.IO;
using System.Threading;
using System.Windows;
using Aura.Windows.Notch;

namespace Aura.Windows;

public partial class App : Application
{
    Mutex? unica;
    bool tengoCandado;
    readonly CancellationTokenSource fin = new();

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        // Pruebas del CI de Windows (ninguna toca micrófono, red de producción ni acciones del sistema, salvo la de escritura en un Bloc de notas propio).
        if (e.Args.Length == 2)
        {
            var salida = Path.GetFullPath(e.Args[1]);
            switch (e.Args[0])
            {
                case "--render-preview": Pruebas.Renderizar(salida); return;
                case "--assistant-self-test": _ = Pruebas.Asistente(salida); return;
                case "--desktop-self-test": _ = DesktopSelfTest.Run(salida); return;
                case "--gateway-self-test": _ = ProtocolSelfTest.Run(salida); return;
                case "--native-self-test": _ = NativoSelfTest.Run(salida); return;
                case "--conexiones-self-test": _ = ConexionesSelfTest.Run(salida); return;
                case "--avisos-self-test": _ = AvisosSelfTest.Run(salida); return;
                case "--centro-self-test": _ = CentroSelfTest.Run(salida); return;
                case "--anim-self-test": _ = Pruebas.Animacion(salida); return;
                case "--onnx-self-test": _ = OnnxSelfTest.Run(salida); return;
                case "--rtc-self-test":
                    Directory.CreateDirectory(Path.GetDirectoryName(salida)!);
                    MainWindow = new CallWindow(true, salida); MainWindow.Show(); return;
            }
        }
        // Relanzada tras una caída: la AURA que muere todavía tiene el candado unos instantes; se espera a que lo suelte.
        bool trasFallo = Array.IndexOf(e.Args, "--tras-fallo") >= 0;
        var pedido = trasFallo ? null : Centro.Protocolo.PedidoDe(e.Args);
        unica = new Mutex(false, @"Local\Aura.Windows.Notch");
        bool primera;
        try { primera = unica.WaitOne(trasFallo ? TimeSpan.FromSeconds(15) : TimeSpan.Zero); }
        catch (AbandonedMutexException) { primera = true; } // la anterior murió con el candado: ahora es nuestro
        tengoCandado = primera;
        if (!primera)
        {
            // Ya hay una AURA: le pasa el pedido (la vuelta de Genesis ID o «abrir el Centro») y se cierra.
            if (!trasFallo) Centro.Protocolo.Enviar(pedido ?? "--centro");
            Shutdown(); return;
        }
        Centro.Protocolo.Registrar();
        VigilarFallos();
        // La pantalla de arranque, en su propio hilo, antes de preparar el notch: aparece al instante y el notch se
        // arma detrás sin esperarla. Nunca tras una caída ni con un pedido (la vuelta del navegador, «abrir el Centro»);
        // la corta al entrar a Windows (--inicio, el acceso del instalador) o al volver de una actualización.
        Arranque.Arranque? arranque = null;
        if (!trasFallo && pedido == null)
        {
            bool corta = Array.IndexOf(e.Args, "--inicio") >= 0 || Array.IndexOf(e.Args, "--actualizada") >= 0;
            try { arranque = Arranque.Arranque.Mostrar(corta ? Arranque.TipoArranque.Corto : Arranque.TipoArranque.Completo); }
            catch (Exception ex) { Centro.Registro.Anotar("arranque", "sin pantalla de arranque: " + ex.Message); }
        }
        var notch = new NotchWindow();
        MainWindow = notch;
        Centro.Protocolo.Llego += p => notch.Dispatcher.BeginInvoke(new Action(() => notch.PedidoExterno(p)));
        Centro.Protocolo.Escuchar(fin.Token);
        if (arranque != null)
        {
            notch.Esconder();
            // Ya colocado, el notch le dice a la placa hacia dónde encogerse.
            notch.Loaded += (_, _) => notch.Dispatcher.BeginInvoke(new Action(() => { var (c, abajo) = notch.PuntoDeArranque(); arranque.FijarDestino(c, abajo); }), System.Windows.Threading.DispatcherPriority.Loaded);
            arranque.AlTerminar(() => notch.Dispatcher.BeginInvoke(new Action(notch.Revelar)));
            // Por si la pantalla de arranque no llegara a avisar: el notch aparece igual.
            var reserva = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromSeconds(4.5) };
            reserva.Tick += (_, _) => { reserva.Stop(); notch.Revelar(); };
            reserva.Start();
        }
        notch.Show();
        if (pedido != null) notch.Dispatcher.BeginInvoke(new Action(() => notch.PedidoExterno(pedido)), System.Windows.Threading.DispatcherPriority.ApplicationIdle);
    }

    /// <summary>
    /// Antes un error no atrapado cerraba AURA sin dejar rastro (1-oct 22:39: el registro calla 7 minutos). Ahora:
    /// en la ventana, se anota y AURA sigue; en otro hilo (el proceso muere igual), se anota y se vuelve a abrir
    /// sola, una vez cada 2 minutos como mucho para no entrar en bucle; una tarea olvidada solo se anota.
    /// </summary>
    void VigilarFallos()
    {
        DispatcherUnhandledException += (_, e) =>
        {
            Centro.Registro.Anotar("fallo", "en la ventana (sigo): " + Core.RegistroSeguro.Sanear(e.Exception.ToString()));
            Centro.Diagnostico.Reportar("error-js", "fallo en la ventana (AURA siguió)", Resumen(e.Exception));
            e.Handled = true;
        };
        AppDomain.CurrentDomain.UnhandledException += (_, e) =>
        {
            Centro.Registro.Anotar("fallo", "se cayó: " + Core.RegistroSeguro.Sanear(e.ExceptionObject?.ToString() ?? "?"));
            if (e.IsTerminating) { Centro.Diagnostico.DejarCaida(e.ExceptionObject is Exception x ? Resumen(x) : "?"); Relanzar(); }
        };
        System.Threading.Tasks.TaskScheduler.UnobservedTaskException += (_, e) =>
        {
            Centro.Registro.Anotar("fallo", "tarea sin atender: " + Core.RegistroSeguro.Sanear(e.Exception.GetBaseException().Message));
            e.SetObserved();
        };
    }

    /// <summary>Tipo, mensaje y dónde (las primeras líneas de la pila): lo justo para encontrarlo, sin datos.</summary>
    static string Resumen(Exception ex)
    {
        var b = ex.GetBaseException();
        var pila = string.Join(" | ", (b.StackTrace ?? "").Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Take(4));
        return $"{b.GetType().Name}: {b.Message} @ {pila}";
    }

    static void Relanzar()
    {
        try
        {
            var marca = Path.Combine(Centro.Registro.Carpeta, "ultimo-relanzar.txt");
            if (File.Exists(marca) && DateTime.UtcNow - File.GetLastWriteTimeUtc(marca) < TimeSpan.FromMinutes(2)) return;
            File.WriteAllText(marca, DateTime.UtcNow.ToString("o"));
            var exe = Environment.ProcessPath;
            if (exe != null) System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(exe, "--tras-fallo") { UseShellExecute = true });
        }
        catch { /* si ni eso se puede, queda el registro */ }
    }

    protected override void OnExit(ExitEventArgs e)
    {
        fin.Cancel();
        if (tengoCandado) try { unica?.ReleaseMutex(); } catch { }
        unica?.Dispose();
        base.OnExit(e);
    }
}
