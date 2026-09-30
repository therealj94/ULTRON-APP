using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Speech.Recognition;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Threading;
using Aura.Windows.Core;
using Forms = System.Windows.Forms;
namespace Aura.Windows;
public partial class MainWindow : Window
{
    readonly ApprovalGate gate = new();
    readonly Forms.NotifyIcon tray;
    readonly DispatcherTimer expiration = new() { Interval = TimeSpan.FromSeconds(1) };
    Guid approval;
    SpeechRecognitionEngine? speech;
    long voiceGeneration;
    bool expanded;
    bool hotkeys;
    HwndSource? source;
    [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr h, int id, uint modifiers, uint key);
    [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr h, int id);
    public MainWindow() {
        InitializeComponent();
        tray = new Forms.NotifyIcon { Icon = System.Drawing.SystemIcons.Application, Text = "AURA Windows · local", Visible = true };
        tray.DoubleClick += (_, _) => Dispatcher.Invoke(() => Expand(true));
        var menu = new Forms.ContextMenuStrip();
        menu.Items.Add("Abrir AURA", null, (_, _) => Dispatcher.Invoke(() => Expand(true)));
        menu.Items.Add("Pausar acciones", null, (_, _) => Dispatcher.Invoke(PauseAll));
        menu.Items.Add("Salir", null, (_, _) => Dispatcher.Invoke(Close)); tray.ContextMenuStrip = menu;
        SourceInitialized += (_, _) => {
            source = HwndSource.FromHwnd(new WindowInteropHelper(this).Handle); source.AddHook(Hook);
            bool open = RegisterHotKey(source.Handle, 1, 0x4003, 0x20);
            bool stop = RegisterHotKey(source.Handle, 2, 0x4003, 0x1B);
            hotkeys = open && stop;
            if (!hotkeys) Status.Text = "Algún atajo está ocupado. Usa la bandeja para abrir o pausar AURA.";
            Position();
        };
        expiration.Tick += (_, _) => Position(); expiration.Start();
        Closed += (_, _) => { expiration.Stop(); StopVoice(); tray.Dispose(); if(source != null) { UnregisterHotKey(source.Handle, 1); UnregisterHotKey(source.Handle, 2); source.RemoveHook(Hook); } };
    }
    IntPtr Hook(IntPtr h, int msg, IntPtr w, IntPtr l, ref bool handled) {
        if (msg == 0x0312) { if (w.ToInt32() == 1) Expand(!expanded || !IsVisible); else if (w.ToInt32() == 2) PauseAll(); handled = true; }
        return IntPtr.Zero;
    }
    void Position() {
        // WPF work area is expressed in device-independent pixels on the primary display.
        var area = SystemParameters.WorkArea;
        MaxHeight = Math.Max(100, area.Height);
        Panel.MaxHeight = Math.Max(60, area.Height - 110);
        Left = area.Left + (area.Width - Width) / 2; Top = area.Top;
    }
    void Expand(bool yes) { expanded = yes; Panel.Visibility = yes ? Visibility.Visible : Visibility.Collapsed; Height = yes ? 680 : 92; Show(); Position(); if(yes) { Activate(); Input.Focus(); } }
    void Toggle(object s, RoutedEventArgs e) => Expand(!expanded);
    void HidePanel(object s, RoutedEventArgs e) { gate.Cancel(); Confirm.Visibility = Visibility.Collapsed; StopVoice(); Hide(); }
    void Quick(object s, RoutedEventArgs e) { Input.Text = (string)((Button)s).Tag; Prepare(s,e); }
    void Prepare(object s, RoutedEventArgs e) {
        gate.Cancel(); Confirm.Visibility = Visibility.Collapsed;
        var command = Commands.Parse(Input.Text);
        if (command.Kind == ActionKind.Pause) { PauseAll(); return; }
        if (gate.Paused) { Status.Text = "Acciones pausadas. Pulsa Reanudar."; return; }
        if (command.Kind == ActionKind.None) { Status.Text = "Orden no reconocida. Usa los ejemplos. No hay un modelo Laya Windows conectado todavía."; return; }
        approval = gate.Propose(command);
        Status.Text = $"Acción: {command.Kind}\n{command.Value}\nConfirmación válida durante 30 segundos. Revisa el destino antes de continuar.";
        Confirm.Visibility = Visibility.Visible;
    }
    void Execute(object s, RoutedEventArgs e) {
        Confirm.Visibility = Visibility.Collapsed;
        var command = gate.Consume(approval);
        if (command == null) { Status.Text = "La confirmación caducó o se canceló. Prepara la acción otra vez."; return; }
        try {
            string system = Environment.GetFolderPath(Environment.SpecialFolder.System);
            switch(command.Kind) {
                case ActionKind.OpenNotepad: Process.Start(new ProcessStartInfo(Path.Combine(system,"notepad.exe")) { UseShellExecute = true }); break;
                case ActionKind.OpenCalculator: Process.Start(new ProcessStartInfo(Path.Combine(system,"calc.exe")) { UseShellExecute = true }); break;
                case ActionKind.OpenExplorer: Process.Start(new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows),"explorer.exe")) { UseShellExecute = true }); break;
                case ActionKind.OpenDocuments: Open(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments)); break;
                case ActionKind.OpenSettings: Open("ms-settings:"); break;
                case ActionKind.SearchWeb: Open("https://www.bing.com/search?q=" + Uri.EscapeDataString(command.Value)); break;
                case ActionKind.OpenUrl: if (!Commands.SafeHttps(command.Value)) throw new InvalidOperationException("URL no permitida"); Open(command.Value); break;
                case ActionKind.Draft: Draft.Text = command.Value; break;
                default: throw new InvalidOperationException("Acción no permitida");
            }
            Status.Text = command.Kind == ActionKind.Draft ? "Borrador preparado localmente; puedes editarlo, copiarlo o guardarlo." : "Solicitud enviada a Windows. Comprueba la aplicación de destino.";
        } catch(Exception ex) { Status.Text = "No se completó: " + ex.Message; }
    }
    static void Open(string target) => Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
    void PauseAll() { gate.Pause(); Confirm.Visibility = Visibility.Collapsed; StopVoice(); State.Text = "WINDOWS · PAUSADO"; Status.Text = "Acciones y micrófono pausados. No se cierran programas ya abiertos."; }
    void Pause(object s, RoutedEventArgs e) => PauseAll();
    void Resume(object s, RoutedEventArgs e) { gate.Resume(); State.Text = "WINDOWS · LOCAL"; Status.Text = "Listo para una nueva orden."; }
    void Copy(object s, RoutedEventArgs e) { if(gate.Paused) return; try { Clipboard.SetText(Draft.Text); Status.Text = "Borrador copiado al portapapeles de Windows."; } catch(Exception ex) { Status.Text = ex.Message; } }
    void Save(object s, RoutedEventArgs e) {
        if (gate.Paused) return;
        var dialog = new Microsoft.Win32.SaveFileDialog { Filter = "Texto UTF-8 (*.txt)|*.txt|Markdown (*.md)|*.md", FileName = "AURA-borrador.txt", AddExtension = true };
        if(dialog.ShowDialog(this) != true) return;
        try { using var stream = new FileStream(dialog.FileName, FileMode.CreateNew, FileAccess.Write); using var writer = new StreamWriter(stream); writer.Write(Draft.Text); Status.Text = "Archivo nuevo guardado. No se sobrescriben archivos existentes."; }
        catch(Exception ex) { Status.Text = "No se guardó: " + ex.Message; }
    }
    void Voice(object s, RoutedEventArgs e) {
        Expand(true);
        if (gate.Paused) { Status.Text = "Reanuda las acciones para usar la voz."; return; }
        if(speech != null) { StopVoice(); return; }
        try {
            var installed = SpeechRecognitionEngine.InstalledRecognizers().FirstOrDefault(r => r.Culture.TwoLetterISOLanguageName == "es");
            if(installed == null) { Status.Text = "Instala reconocimiento de voz en español en Windows. Puedes escribir mientras tanto."; return; }
            long generation = ++voiceGeneration;
            speech = new SpeechRecognitionEngine(installed); speech.SetInputToDefaultAudioDevice(); speech.LoadGrammar(new DictationGrammar());
            speech.InitialSilenceTimeout = TimeSpan.FromSeconds(8); speech.BabbleTimeout = TimeSpan.FromSeconds(12);
            speech.SpeechRecognized += (_, args) => Dispatcher.BeginInvoke(new Action(() => { if(generation == voiceGeneration && !gate.Paused && speech != null) { Input.Text = args.Result.Text; Status.Text = "Transcripción lista. Revísala y pulsa Preparar acción."; } }));
            speech.RecognizeCompleted += (_, _) => Dispatcher.BeginInvoke(new Action(() => { if(generation == voiceGeneration) StopVoice(); }));
            State.Text = "MICRÓFONO · ESCUCHANDO"; speech.RecognizeAsync(RecognizeMode.Single);
        } catch(Exception ex) { StopVoice(); Status.Text = "Voz no disponible: " + ex.Message; }
    }
    void StopVoice() { voiceGeneration++; var old = speech; speech = null; if(old != null) { try { old.RecognizeAsyncCancel(); old.Dispose(); } catch(InvalidOperationException) {} } State.Text = gate.Paused ? "WINDOWS · PAUSADO" : "WINDOWS · LOCAL"; }
    void Quit(object s, RoutedEventArgs e) => Close();
}
