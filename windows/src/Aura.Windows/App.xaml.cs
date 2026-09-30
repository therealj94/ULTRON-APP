using System.Threading;
using System.Windows;
namespace Aura.Windows;
public partial class App : Application {
 private Mutex? singleton;
 protected override void OnStartup(StartupEventArgs e) {
  singleton = new Mutex(true, @"Local\Aura.Windows.Native", out bool first);
  if (!first) { Shutdown(); return; }
  base.OnStartup(e);
 }
 protected override void OnExit(ExitEventArgs e) { singleton?.Dispose(); base.OnExit(e); }
}