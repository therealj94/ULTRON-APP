using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using Aura.Windows.Core;

namespace Aura.Windows.Centro;

/// <summary>
/// La ventana grande de AURA: la página del Centro (CentroAssets) en WebView2, servida como
/// https://centro.aura.local/. Cerrarla solo la esconde: PULSE2CHAT sigue escuchando llamadas y AURA
/// sigue en el notch. Todo lo que la página pide pasa por <see cref="Manejar"/> (el puente).
/// </summary>
internal sealed class CentroWindow : Window
{
    public const string Origen = "https://centro.aura.local";
    /// <summary>¿Es de la página propia? Origen exacto (esquema, host y puerto), nunca por prefijo.</summary>
    static bool Propia(string? url) => PuenteCentro.OrigenExacto(url, PuenteCentro.Origen);
    readonly WebView2 web = new() { DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, 10, 10, 12) };
    readonly Func<string, JsonElement, Task<object?>> manejar;
    bool listo, cerrandoDeVerdad;
    public event Action? Listo;

    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref int valor, int tam);

    public CentroWindow(Func<string, JsonElement, Task<object?>> manejar)
    {
        this.manejar = manejar;
        Title = "AURA";
        Width = 1180; Height = 780; MinWidth = 880; MinHeight = 600;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        Background = new SolidColorBrush(Color.FromRgb(10, 10, 12));
        Content = web;
        try { Icon = System.Windows.Media.Imaging.BitmapFrame.Create(new Uri("pack://application:,,,/AvatarAssets/aura.ico")); } catch { }
        SourceInitialized += (_, _) =>
        {
            // Barra de título oscura (Windows 10 20H1+ y 11), a juego con el Centro.
            int si = 1; var h = new WindowInteropHelper(this).Handle;
            if (DwmSetWindowAttribute(h, 20, ref si, 4) != 0) DwmSetWindowAttribute(h, 19, ref si, 4);
        };
        Loaded += async (_, _) => await Iniciar();
        Closing += (_, e) => { if (!cerrandoDeVerdad) { e.Cancel = true; Hide(); } };
    }

    public void CerrarDeVerdad() { cerrandoDeVerdad = true; Close(); }

    async Task Iniciar()
    {
        try
        {
            var perfil = Path.Combine(Registro.Carpeta, "Centro");
            var entorno = await CoreWebView2Environment.CreateAsync(null, perfil, new CoreWebView2EnvironmentOptions("--autoplay-policy=no-user-gesture-required"));
            await web.EnsureCoreWebView2Async(entorno);
            var core = web.CoreWebView2;
            core.Settings.AreHostObjectsAllowed = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.AreDevToolsEnabled = Debugger.IsAttached;
            core.SetVirtualHostNameToFolderMapping("centro.aura.local", Path.Combine(AppContext.BaseDirectory, "CentroAssets"), CoreWebView2HostResourceAccessKind.DenyCors);
            // Solo la página propia navega aquí; cualquier enlace de afuera se abre en el navegador.
            core.NavigationStarting += (_, e) => { if (!Propia(e.Uri)) { e.Cancel = true; AbrirAfuera(e.Uri); } };
            // Tampoco dentro de un iframe: la página propia no los usa.
            core.FrameNavigationStarting += (_, e) => { if (!Propia(e.Uri)) e.Cancel = true; };
            core.NewWindowRequested += (_, e) => { e.Handled = true; AbrirAfuera(e.Uri); };
            // Micrófono y cámara: solo para la página propia (llamadas de PULSE2CHAT). Lo demás, no.
            core.PermissionRequested += (_, e) =>
            {
                bool propia = Propia(e.Uri) && Propia(web.CoreWebView2?.Source);
                e.State = propia && e.PermissionKind is CoreWebView2PermissionKind.Microphone or CoreWebView2PermissionKind.Camera
                    ? CoreWebView2PermissionState.Allow : CoreWebView2PermissionState.Deny;
                // Se decide cada vez: nada queda guardado en el perfil para otro origen.
                e.SavesInProfile = false;
            };
            core.WebMessageReceived += (_, e) => _ = Recibir(e);
            core.ProcessFailed += (_, e) => Registro.Anotar("centro", "WebView2 falló: " + e.ProcessFailedKind);
            core.Navigate(Origen + "/index.html");
            listo = true;
            Listo?.Invoke();
        }
        catch (Exception ex)
        {
            Registro.Anotar("centro", "no arrancó WebView2: " + ex.Message);
            Content = new System.Windows.Controls.TextBlock
            {
                Text = "El Centro necesita Microsoft Edge WebView2 Runtime.\nInstálalo desde https://go.microsoft.com/fwlink/p/?LinkId=2124703 y vuelve a abrir AURA.\n\n" + ex.Message,
                Foreground = Brushes.White, Margin = new Thickness(40), TextWrapping = TextWrapping.Wrap, FontSize = 15,
            };
        }
    }

    static void AbrirAfuera(string uri)
    {
        if (!Uri.TryCreate(uri, UriKind.Absolute, out var u) || u.Scheme is not ("https" or "http" or "mailto")) return;
        try { Process.Start(new ProcessStartInfo(u.AbsoluteUri) { UseShellExecute = true }); } catch { }
    }

    async Task Recibir(CoreWebView2WebMessageReceivedEventArgs e)
    {
        // Cada mensaje: del origen exacto, y la página principal también lo es (no un marco ajeno).
        if (!Propia(e.Source) || !Propia(web.CoreWebView2?.Source)) { Registro.Anotar("centro", "mensaje de otro origen, ignorado"); return; }
        int id = 0;
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var r = doc.RootElement;
            id = r.GetProperty("id").GetInt32();
            var metodo = r.GetProperty("metodo").GetString() ?? "";
            if (!PuenteCentro.MetodoPermitido(metodo)) throw new InvalidOperationException("Método desconocido: " + metodo);
            var args = r.TryGetProperty("args", out var a) ? a.Clone() : default;
            var valor = await manejar(metodo, args);
            Responder(new { id, ok = true, valor });
        }
        catch (Exception ex)
        {
            if (ex is not InvalidOperationException) Registro.Anotar("centro", ex.GetType().Name + ": " + ex.Message);
            Responder(new { id, ok = false, error = ex.Message });
        }
    }

    static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    void Responder(object o) { if (listo) Dispatcher.BeginInvoke(new Action(() => { try { web.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(o, Json)); } catch { } })); }

    /// <summary>Foto de la página (pruebas del CI): PNG en `archivo`.</summary>
    public async Task Fotografiar(string archivo)
    {
        using var f = File.Create(archivo);
        await web.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, f);
    }

    /// <summary>Corre JavaScript en la página (pruebas del CI) y devuelve el resultado en JSON.</summary>
    public Task<string> Ejecutar(string js) => web.CoreWebView2.ExecuteScriptAsync(js);

    /// <summary>Un evento a la página (estado, llamadas, chat…).</summary>
    public void Emitir(string evento, object? datos) => Responder(new { evento, datos });

    /// <summary>Trae el Centro al frente (y a una sección, si se pide).</summary>
    public void Mostrar(string? seccion = null)
    {
        // Si se abrió mientras se preparaba escondido, aún no tenía botón en la barra de tareas ni lugar en la
        // pantalla: minimizarla la hacía «desaparecer». Siempre con su botón y centrada en la pantalla.
        ShowInTaskbar = true;
        if (Left < -10000 || Top < -10000)
        {
            Left = (SystemParameters.WorkArea.Width - Width) / 2 + SystemParameters.WorkArea.Left;
            Top = (SystemParameters.WorkArea.Height - Height) / 2 + SystemParameters.WorkArea.Top;
        }
        if (!IsVisible) Show();
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
        Activate();
        if (seccion != null) Emitir("ir", seccion);
    }
}
