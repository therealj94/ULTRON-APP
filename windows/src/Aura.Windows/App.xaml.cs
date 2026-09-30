using System;
using System.IO;
using System.Threading;
using System.Windows;
namespace Aura.Windows;
public partial class App : Application {
 private Mutex? singleton;
 protected override void OnStartup(StartupEventArgs e) {
  base.OnStartup(e);
  if(e.Args.Length == 2 && e.Args[0] == "--rtc-self-test") {
   ShutdownMode = ShutdownMode.OnExplicitShutdown; Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(e.Args[1]))!);
   MainWindow = new CallWindow(true,Path.GetFullPath(e.Args[1]));MainWindow.Show();return;
  }
  if(e.Args.Length == 2 && e.Args[0] == "--render-preview") {
   ShutdownMode = ShutdownMode.OnExplicitShutdown;
   try { new MainWindow(true).RenderPreviews(Path.GetFullPath(e.Args[1])); Shutdown(0); }
   catch(Exception ex) { Directory.CreateDirectory(e.Args[1]); File.WriteAllText(Path.Combine(e.Args[1], "render-error.txt"), ex.ToString()); Shutdown(1); }
   return;
  }
  singleton = new Mutex(true, @"Local\Aura.Windows.Native", out bool first);
  if (!first) { Shutdown(); return; }
  MainWindow = new MainWindow(); MainWindow.Show();
 }
 protected override void OnExit(ExitEventArgs e) { singleton?.Dispose(); base.OnExit(e); }
}
