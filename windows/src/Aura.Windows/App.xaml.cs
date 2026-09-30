using System;
using System.IO;
using System.Threading;
using System.Windows;
using Aura.Windows.Notch;

namespace Aura.Windows;

public partial class App : Application
{
    Mutex? unica;

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
                case "--anim-self-test": _ = Pruebas.Animacion(salida); return;
                case "--rtc-self-test":
                    Directory.CreateDirectory(Path.GetDirectoryName(salida)!);
                    MainWindow = new CallWindow(true, salida); MainWindow.Show(); return;
            }
        }
        unica = new Mutex(true, @"Local\Aura.Windows.Notch", out bool primera);
        if (!primera) { Shutdown(); return; }
        MainWindow = new NotchWindow();
        MainWindow.Show();
    }

    protected override void OnExit(ExitEventArgs e) { unica?.Dispose(); base.OnExit(e); }
}
