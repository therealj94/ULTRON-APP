using System;
using System.Diagnostics;
using System.Linq;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Automation;
namespace Aura.Windows;
internal sealed class DesktopTarget {
 public string Title {get;}
 readonly IntPtr window;readonly int processId;readonly DateTime start;readonly int[] runtimeId;readonly long captured=Stopwatch.GetTimestamp();readonly AutomationElement element;
 DesktopTarget(IntPtr window,int pid,DateTime start,AutomationElement element){this.window=window;processId=pid;this.start=start;this.element=element;runtimeId=element.GetRuntimeId();Title=AutomationElement.FromHandle(window).Current.Name;}
 [DllImport("user32.dll")]static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")]static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")]static extern uint SendInput(uint count,Input[] inputs,int size);
 [StructLayout(LayoutKind.Sequential)]struct Input {public uint type;public InputUnion data;}
 [StructLayout(LayoutKind.Explicit)]struct InputUnion {[FieldOffset(0)]public Keyboard keyboard;[FieldOffset(0)]public Mouse mouse;}
 [StructLayout(LayoutKind.Sequential)]struct Keyboard {public ushort vk,scan;public uint flags,time;public UIntPtr extra;}
 [StructLayout(LayoutKind.Sequential)]struct Mouse {public int x,y;public uint data,flags,time;public UIntPtr extra;}
 static void CheckEditable(AutomationElement item){
  var c=item.Current;if(c.IsPassword||!c.IsEnabled||c.IsOffscreen||!(c.ControlType==ControlType.Edit||c.ControlType==ControlType.Document))throw new InvalidOperationException("Selecciona un campo de texto editable y visible de Bloc de notas.");
  bool editable=false;
  if(item.TryGetCurrentPattern(ValuePattern.Pattern,out var v))editable=!((ValuePattern)v).Current.IsReadOnly;
  else if(item.TryGetCurrentPattern(TextPattern.Pattern,out var t))editable=((TextPattern)t).DocumentRange.GetAttributeValue(TextPattern.IsReadOnlyAttribute) is bool readOnly && !readOnly;
  if(!editable)throw new InvalidOperationException("Windows no permite verificar que este campo sea editable. Pega el borrador manualmente.");
 }
 public static DesktopTarget Capture(){
  var h=GetForegroundWindow();GetWindowThreadProcessId(h,out var id);using var p=Process.GetProcessById((int)id);
  if(!p.ProcessName.Equals("notepad",StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("Por ahora la escritura directa solo admite Bloc de notas. Haz clic en su área de texto y usa Ctrl+Alt+W.");
  string executable=Path.GetFullPath(p.MainModule?.FileName ?? "");
  string win=Environment.GetFolderPath(Environment.SpecialFolder.Windows);
  string store=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"WindowsApps","Microsoft.WindowsNotepad_");
  bool trusted=executable.Equals(Path.Combine(win,"System32","notepad.exe"),StringComparison.OrdinalIgnoreCase)||executable.Equals(Path.Combine(win,"notepad.exe"),StringComparison.OrdinalIgnoreCase)||executable.StartsWith(store,StringComparison.OrdinalIgnoreCase);
  if(!trusted)throw new InvalidOperationException("El destino no es una instalación reconocida de Bloc de notas de Windows.");
  var element=AutomationElement.FocusedElement;
  if(element.Current.ProcessId!=(int)id)throw new InvalidOperationException("El campo seleccionado pertenece a otra aplicación.");
  CheckEditable(element);return new(h,(int)id,p.StartTime,element);
 }
 public async Task Write(string text,CancellationToken cancellation){
  if(string.IsNullOrWhiteSpace(text)||text.Length>1000||text.Any(c=>char.IsControl(c)))throw new InvalidOperationException("Escritura directa: máximo 1.000 caracteres en un párrafo sin saltos de línea. Para documentos, guarda el borrador.");
  if(Stopwatch.GetElapsedTime(captured)>TimeSpan.FromSeconds(90))throw new InvalidOperationException("La selección venció. Selecciona de nuevo Bloc de notas.");
  using var p=Process.GetProcessById(processId);if(p.StartTime!=start)throw new InvalidOperationException("El proceso de destino cambió.");
  cancellation.ThrowIfCancellationRequested();CheckEditable(element);
  if(!SetForegroundWindow(window))throw new InvalidOperationException("No se pudo activar la ventana seleccionada.");
  element.SetFocus();await Task.Delay(120,cancellation);
  int written=0;
  foreach(var rune in text.EnumerateRunes()){
   cancellation.ThrowIfCancellationRequested();
   if(GetForegroundWindow()!=window||!AutomationElement.FocusedElement.GetRuntimeId().SequenceEqual(runtimeId))throw new InvalidOperationException($"El foco cambió. Escritura detenida después de {written} caracteres; revisa el destino.");
   CheckEditable(element);
   var events=rune.ToString().SelectMany(c=>new[]{new Input {type=1,data=new(){keyboard=new(){scan=c,flags=4}}},new Input {type=1,data=new(){keyboard=new(){scan=c,flags=6}}}}).ToArray();
   if(SendInput((uint)events.Length,events,Marshal.SizeOf<Input>())!=events.Length)throw new InvalidOperationException("Windows bloqueó la escritura. Puede haber texto parcial; revisa Bloc de notas.");
   written++;if(written%16==0)await Task.Delay(15,cancellation);
  }
 }
}
