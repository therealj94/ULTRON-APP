using System;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Speech.Recognition;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Aura.Windows.Core;
using Forms = System.Windows.Forms;
namespace Aura.Windows;
public partial class MainWindow : Window
{
    readonly ApprovalGate gate = new();
    readonly Forms.NotifyIcon? tray;
    readonly DispatcherTimer ticker = new() { Interval = TimeSpan.FromMilliseconds(500) };
    readonly bool renderOnly;
    Guid approval;
    SpeechRecognitionEngine? speech;
    long voiceGeneration;
    DateTimeOffset voiceDeadline;
    bool expanded, dirty;
    HwndSource? source;
    [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr h, int id, uint modifiers, uint key);
    [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr h, int id);
    public MainWindow(bool renderOnly = false) {
        this.renderOnly = renderOnly;
        InitializeComponent();
        if (renderOnly) return;
        tray = new Forms.NotifyIcon { Icon = System.Drawing.SystemIcons.Application, Text = "AURA Windows", Visible = true };
        tray.DoubleClick += (_, _) => Dispatcher.Invoke(() => Expand(true));
        var menu = new Forms.ContextMenuStrip();
        menu.Items.Add("Abrir AURA", null, (_, _) => Dispatcher.Invoke(() => Expand(true)));
        menu.Items.Add("Pausar acciones", null, (_, _) => Dispatcher.Invoke(PauseAll));
        menu.Items.Add("Salir", null, (_, _) => Dispatcher.Invoke(Close)); tray.ContextMenuStrip = menu;
        SourceInitialized += (_, _) => {
            source = HwndSource.FromHwnd(new WindowInteropHelper(this).Handle); source.AddHook(Hook);
            bool open = RegisterHotKey(source.Handle, 1, 0x4003, 0x20);
            bool stop = RegisterHotKey(source.Handle, 2, 0x4003, 0x1B);
            if (!open || !stop) SetStatus("Atajo ocupado", "Algún atajo está ocupado. Usa la bandeja para abrir o pausar AURA.");
            Position();
        };
        ticker.Tick += (_, _) => Tick(); ticker.Start();
        Closing += OnClosing;
        Closed += (_, _) => { ticker.Stop(); StopVoice(); tray.Dispose(); if(source != null) { UnregisterHotKey(source.Handle, 1); UnregisterHotKey(source.Handle, 2); source.RemoveHook(Hook); } };
    }
    void SetStatus(string title, string message) { StatusTitle.Text = title; Status.Text = message; }
    IntPtr Hook(IntPtr h, int msg, IntPtr w, IntPtr l, ref bool handled) {
        if (msg == 0x0312) { if (w.ToInt32() == 1) Expand(!expanded || !IsVisible); else if (w.ToInt32() == 2) PauseAll(); handled = true; }
        if (msg is 0x007E or 0x02E0) Dispatcher.BeginInvoke(new Action(Position));
        return IntPtr.Zero;
    }
    void Position() {
        var area = SystemParameters.WorkArea;
        Width = Math.Min(expanded ? 480 : 286, area.Width);
        Height = Math.Min(expanded ? 760 : 78, area.Height);
        Left = area.Left + (area.Width - Width) / 2; Top = area.Top;
    }
    void Tick() {
        if (ApprovalActions.Visibility == Visibility.Visible) {
            int seconds = gate.RemainingSeconds;
            if (seconds <= 0) { ClearApproval(); SetStatus("Confirmación vencida", "Prepara la acción otra vez para continuar."); }
            else Countdown.Text = $"Puedes confirmar durante {seconds} s.";
        }
        if (speech != null && DateTimeOffset.UtcNow >= voiceDeadline) { StopVoice(); SetStatus("Escucha finalizada", "Se alcanzó el límite de 20 segundos. Revisa el texto o activa el micrófono otra vez."); }
    }
    void Expand(bool yes) { expanded = yes; Panel.Visibility = StatusCard.Visibility = Footer.Visibility = yes ? Visibility.Visible : Visibility.Collapsed; Position(); Show(); if(yes && !renderOnly) { Activate(); Input.Focus(); } }
    void Toggle(object s, RoutedEventArgs e) { if(expanded) StopVoice(); Expand(!expanded); }
    void HidePanel(object s, RoutedEventArgs e) { ClearApproval(); StopVoice(); Hide(); }
    void Quick(object s, RoutedEventArgs e) { Input.Text = (string)((Button)s).Tag; Prepare(s,e); }
    void InputChanged(object s, TextChangedEventArgs e) {
        if (ApprovalActions == null || ApprovalActions.Visibility != Visibility.Visible) return;
        ClearApproval(); SetStatus("Orden actualizada", "Prepara de nuevo la acción para confirmar el texto actualizado.");
    }
    void DraftChanged(object s, TextChangedEventArgs e) => dirty = true;
    void ClearApproval() { gate.Cancel(); ApprovalActions.Visibility = Visibility.Collapsed; Countdown.Visibility = Visibility.Collapsed; }
    void Prepare(object s, RoutedEventArgs e) {
        ClearApproval();
        var command = Commands.Parse(Input.Text);
        if (command.Kind == ActionKind.Pause) { PauseAll(); return; }
        if (gate.Paused) { SetStatus("En pausa", "Pulsa Reanudar para preparar otra acción."); return; }
        if (command.Kind == ActionKind.None) { SetStatus("Necesito una orden más concreta", "Usa un botón, escribe «abre documentos», «busca: tu tema» o «borrador: tu texto». Esta versión reconoce un catálogo limitado."); return; }
        approval = gate.Propose(command);
        SetStatus("Revisa antes de continuar", Commands.Describe(command));
        Countdown.Text = "Puedes confirmar durante 30 s.";
        Countdown.Visibility = ApprovalActions.Visibility = Visibility.Visible;
    }
    void Execute(object s, RoutedEventArgs e) {
        var command = gate.Consume(approval);
        ClearApproval();
        if (command == null) { SetStatus("Confirmación no válida", "La acción caducó o se canceló. Prepárala otra vez."); return; }
        if (renderOnly) throw new InvalidOperationException("El render de prueba nunca ejecuta acciones.");
        try {
            if (command.Kind == ActionKind.Draft) {
                if (dirty && MessageBox.Show(this, "¿Reemplazar el borrador que tienes en el editor?", "AURA · Borrador", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
                if(gate.Paused) return;
                Draft.Text = command.Value; Workspace.SelectedIndex = 1;
                SetStatus("Borrador preparado", "Revisa el texto. Puedes copiarlo o guardarlo en un archivo nuevo.");
            } else { LocalActions.Execute(command); SetStatus("Solicitud enviada a Windows", "Comprueba la aplicación de destino. Puedes seguir trabajando aquí."); }
        } catch(Exception ex) { SetStatus("No se completó", ex.Message); }
    }
    void Cancel(object s, RoutedEventArgs e) { ClearApproval(); SetStatus("Acción cancelada", "No se ejecutó la propuesta. Puedes preparar otra."); }
    void PauseAll() { gate.Pause(); ClearApproval(); StopVoice(); UpdateControls(); SetStatus("AURA está en pausa", "Se cancelaron las propuestas y el micrófono. Los programas que ya abriste siguen abiertos."); }
    void TogglePause(object s, RoutedEventArgs e) { if(gate.Paused) { gate.Resume(); UpdateControls(); SetStatus("Lista para ayudarte", "Puedes preparar una nueva acción."); } else PauseAll(); }
    void UpdateControls() {
        State.Text = gate.Paused ? "Acciones pausadas" : speech != null ? "Escuchando…" : "Lista para ayudarte";
        PauseButton.Content = gate.Paused ? "Reanudar acciones" : "Pausar acciones";
        PrepareButton.IsEnabled = VoiceButton.IsEnabled = CopyButton.IsEnabled = SaveButton.IsEnabled = !gate.Paused;
        Eyes.Opacity = gate.Paused ? 0.35 : 1;
    }
    void Copy(object s, RoutedEventArgs e) {
        if(gate.Paused || string.IsNullOrEmpty(Draft.Text)) return;
        try { Clipboard.SetText(Draft.Text); SetStatus("Texto copiado", "El borrador está en el portapapeles de Windows."); }
        catch(Exception ex) { SetStatus("No se pudo copiar", ex.Message); }
    }
    void Save(object s, RoutedEventArgs e) => SaveDraft();
    bool SaveDraft() {
        if (gate.Paused || string.IsNullOrEmpty(Draft.Text)) return false;
        var dialog = new Microsoft.Win32.SaveFileDialog { Filter = "Texto UTF-8 (*.txt)|*.txt|Markdown (*.md)|*.md", FileName = "AURA-borrador.txt", AddExtension = true, OverwritePrompt = false };
        if(dialog.ShowDialog(this) != true || gate.Paused) return false;
        try {
            using(var stream = new FileStream(dialog.FileName, FileMode.CreateNew, FileAccess.Write))
            using(var writer = new StreamWriter(stream)) writer.Write(Draft.Text);
            dirty = false; SetStatus("Archivo guardado", "Se creó un archivo nuevo en la ubicación que elegiste."); return true;
        } catch(IOException) { SetStatus("No se guardó", "El archivo puede existir o no estar disponible. Elige otro nombre o ubicación."); }
        catch(Exception ex) { SetStatus("No se guardó", ex.Message); }
        return false;
    }
    void Voice(object s, RoutedEventArgs e) {
        Expand(true);
        if (gate.Paused) return;
        if(speech != null) { StopVoice(); SetStatus("Micrófono detenido", "Puedes continuar escribiendo."); return; }
        ClearApproval();
        try {
            var installed = SpeechRecognitionEngine.InstalledRecognizers().FirstOrDefault(r => r.Culture.TwoLetterISOLanguageName == "es");
            if(installed == null) { SetStatus("Voz en español no disponible", "Instala reconocimiento de voz en español en Windows. Puedes escribir mientras tanto."); return; }
            long generation = ++voiceGeneration;
            speech = new SpeechRecognitionEngine(installed); speech.SetInputToDefaultAudioDevice(); speech.LoadGrammar(new DictationGrammar());
            speech.InitialSilenceTimeout = TimeSpan.FromSeconds(8); speech.BabbleTimeout = TimeSpan.FromSeconds(12);
            speech.SpeechRecognized += (_, args) => Dispatcher.BeginInvoke(new Action(() => {
                if(generation == voiceGeneration && !gate.Paused && speech != null) { Input.Text = args.Result.Text; SetStatus("Transcripción lista", "Revísala y pulsa Preparar acción. Todavía no se ejecutó nada."); }
            }));
            speech.RecognizeCompleted += (_, _) => Dispatcher.BeginInvoke(new Action(() => { if(generation == voiceGeneration) StopVoice(); }));
            voiceDeadline = DateTimeOffset.UtcNow.AddSeconds(20); UpdateControls();
            SetStatus("Te escucho", "Habla una vez. Puedes detener el micrófono tocándolo de nuevo.");
            speech.RecognizeAsync(RecognizeMode.Single);
        } catch(Exception ex) { StopVoice(); SetStatus("Voz no disponible", ex.Message); }
    }
    void StopVoice() {
        voiceGeneration++;
        var old = speech; speech = null;
        if(old != null) { try { old.RecognizeAsyncCancel(); } catch(InvalidOperationException) {} finally { old.Dispose(); } }
        UpdateControls();
    }
    void OnClosing(object? s, CancelEventArgs e) {
        if(!dirty || string.IsNullOrEmpty(Draft.Text)) return;
        var choice = MessageBox.Show(this, "¿Guardar el borrador antes de salir?\nSí: guardar · No: descartar · Cancelar: volver", "AURA · Borrador sin guardar", MessageBoxButton.YesNoCancel, MessageBoxImage.Question);
        if(choice == MessageBoxResult.Cancel) e.Cancel = true;
        if(choice == MessageBoxResult.Yes) {
            if(gate.Paused) { e.Cancel = true; Expand(true); SetStatus("Reanuda para guardar", "El borrador sigue aquí. Reanuda las acciones y guárdalo antes de salir."); }
            else e.Cancel = !SaveDraft();
        }
    }
    void KeyDownHandler(object s, KeyEventArgs e) {
        if(e.Key == Key.Escape) { ClearApproval(); StopVoice(); Expand(false); e.Handled = true; }
        if(e.Key == Key.Enter && Keyboard.Modifiers == ModifierKeys.Control && Workspace.SelectedIndex == 0) { Prepare(s, e); e.Handled = true; }
    }
    void Quit(object s, RoutedEventArgs e) => Close();
    internal void RenderPreviews(string directory) {
        if(!renderOnly) throw new InvalidOperationException();
        Directory.CreateDirectory(directory);
        Show(); Capture(Path.Combine(directory, "01-notch.png"));
        Expand(true); Input.Text = "Abre la calculadora"; Prepare(this, new RoutedEventArgs());
        Capture(Path.Combine(directory, "02-accion.png"));
        // Regression: modifying a prepared command must invalidate its approval.
        var token = approval; Input.Text = "abre documentos";
        if (gate.Consume(token) != null || ApprovalActions.Visibility != Visibility.Collapsed) throw new InvalidOperationException("Edited command kept its approval");
        Draft.Text = "Ideas para hoy\n\n1. Preparar la propuesta del proyecto.\n2. Revisar los documentos pendientes.\n3. Definir las siguientes acciones.";
        Workspace.SelectedIndex = 1; SetStatus("Tu borrador, listo para revisar", "Edita el contenido y elige dónde guardarlo.");
        Capture(Path.Combine(directory, "03-borrador.png"));
        PauseAll(); Capture(Path.Combine(directory, "04-pausa.png"));
        if(PrepareButton.IsEnabled || CopyButton.IsEnabled || SaveButton.IsEnabled) throw new InvalidOperationException("Paused controls enabled");
        dirty = false; Close();
    }
    void Capture(string path) {
        UpdateLayout();
        if(Shell.ActualWidth <= 0 || Shell.ActualHeight <= 0) throw new InvalidOperationException("Empty WPF layout");
        var bitmap = new RenderTargetBitmap((int)Math.Ceiling(Shell.ActualWidth * 1.5), (int)Math.Ceiling(Shell.ActualHeight * 1.5), 144, 144, PixelFormats.Pbgra32);
        bitmap.Render(Shell); var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(bitmap));
        using var stream = File.Create(path); encoder.Save(stream);
    }
}
