using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Automation;
namespace Aura.Windows;
internal static class DesktopSelfTest {
 [DllImport("user32.dll")]static extern bool SetForegroundWindow(IntPtr h);
 public static async Task Run(string output){
  Process? process=null;Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(output))!);
  try{
   if(Process.GetProcessesByName("notepad").Length!=0)throw new Exception("Test requires an isolated desktop with no existing Notepad process");
   string file=Path.Combine(Path.GetDirectoryName(Path.GetFullPath(output))!,"test-document.txt");File.WriteAllText(file,"");
   var info=new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"notepad.exe")) {UseShellExecute=false};info.ArgumentList.Add(file);
   process=Process.Start(info) ?? throw new Exception("Notepad did not launch");
   AutomationElement? edit=null;
   for(int i=0;i<40;i++){
    await Task.Delay(250);process.Refresh();if(process.HasExited)throw new Exception("Notepad forwarded to another process; refusing to control an unowned process");
    if(process.MainWindowHandle==IntPtr.Zero)continue;
    var root=AutomationElement.FromHandle(process.MainWindowHandle);
    edit=root.FindFirst(TreeScope.Descendants,new OrCondition(new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Edit),new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Document)));
    if(edit!=null)break;
   }
   if(edit==null)throw new Exception("No editable control in Notepad");
   if(!SetForegroundWindow(process.MainWindowHandle))throw new Exception("Runner cannot foreground Notepad");edit.SetFocus();await Task.Delay(300);
   var target=DesktopTarget.Capture();const string expected="AURA Windows prueba Unicode: José y Roatán\r\nSegunda línea con acentos: acción.";
   await target.Write(expected,CancellationToken.None);await Task.Delay(300);
   string actual=edit.TryGetCurrentPattern(ValuePattern.Pattern,out var value)?((ValuePattern)value).Current.Value:((TextPattern)edit.GetCurrentPattern(TextPattern.Pattern)).DocumentRange.GetText(-1);
   if(!actual.Replace("\r\n","\n").Contains(expected.Replace("\r\n","\n"),StringComparison.Ordinal))throw new Exception("Written content mismatch");
   File.WriteAllText(output,JsonSerializer.Serialize(new{ok=true,notepad=true,unicode=true,verifiedBy="UI Automation readback"}));
   Application.Current.Shutdown(0);
  }catch(Exception ex){File.WriteAllText(output,JsonSerializer.Serialize(new{ok=false,error=ex.Message}));Application.Current.Shutdown(1);}
  finally{if(process!=null){try{if(!process.HasExited)process.Kill();}catch{}process.Dispose();}}
 }
}
