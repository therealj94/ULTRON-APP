using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using Aura.Windows.Manos;

namespace Aura.Windows.Notch;

/// <summary>El panel grande: conversación, acciones y borrador (recuperable, cifrado con DPAPI).</summary>
public partial class NotchWindow
{
    string borradorGuardado = "";
    bool borradorSucio;
    CallWindow? llamadas;
    static string RutaRecuperacion => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AuraWindows", "draft.bin");

    internal void AbrirPanel(bool si)
    {
        if (panelAbierto == si) return;
        panelAbierto = si;
        if (!si) GuardarRecuperacion();
        if (!soloRender) Activar(si);
        Recalcular();
    }

    void Recoger(object s, RoutedEventArgs e) => AbrirPanel(false);

    /// <summary>Una burbuja del chat. Devuelve el texto para ir llenándolo mientras llega.</summary>
    internal TextBlock AgregarMensaje(string quien, string texto)
    {
        Bienvenida.Visibility = Visibility.Collapsed;
        bool mio = quien == "Tú";
        var cuerpo = new TextBlock { Text = texto, TextWrapping = TextWrapping.Wrap, FontSize = 14, LineHeight = 20 };
        var pila = new StackPanel();
        if (!mio) pila.Children.Add(new TextBlock { Text = quien, FontSize = 11, FontWeight = FontWeights.SemiBold, Foreground = (Brush)FindResource("Acento"), Margin = new Thickness(0, 0, 0, 4) });
        pila.Children.Add(cuerpo);
        EspejarBurbuja(quien, cuerpo);
        if (!mio)
        {
            var fila = new WrapPanel { Margin = new Thickness(0, 8, 0, 0) };
            var usar = new Button { Content = "Al borrador", Style = (Style)FindResource("Pildora"), Padding = new Thickness(10, 4, 10, 4), FontSize = 11.5 };
            usar.Click += (_, _) => { if (cuerpo.Text.Length == 0) return; Borrador.Text = cuerpo.Text; PestanaBorrador.IsChecked = true; };
            var oir = new Button { Content = "Escuchar", Style = (Style)FindResource("Pildora"), Padding = new Thickness(10, 4, 10, 4), FontSize = 11.5 };
            oir.Click += (_, _) => { if (cuerpo.Text.Length == 0) return; Callar(); voz = new System.Threading.CancellationTokenSource(); var c = new Core.CortadorFrases(); foreach (var f in c.Agregar(cuerpo.Text)) Decir(f, "neutral", voz.Token); if (c.Resto() is { } r) Decir(r, "neutral", voz.Token); };
            var copiar = new Button { Content = "Copiar", Style = (Style)FindResource("Pildora"), Padding = new Thickness(10, 4, 10, 4), FontSize = 11.5 };
            copiar.Click += (_, _) => { try { Clipboard.SetText(cuerpo.Text); } catch { } };
            fila.Children.Add(usar); fila.Children.Add(oir); fila.Children.Add(copiar);
            pila.Children.Add(fila);
        }
        var burbuja = new Border
        {
            Child = pila, CornerRadius = new CornerRadius(18), Padding = new Thickness(14, 10, 14, 8),
            Background = mio ? (Brush)FindResource("AcentoSuave") : (Brush)FindResource("Superficie"),
            HorizontalAlignment = mio ? HorizontalAlignment.Right : HorizontalAlignment.Left,
            MaxWidth = 440, Margin = new Thickness(mio ? 40 : 0, 6, mio ? 0 : 30, 2),
        };
        Mensajes.Children.Add(burbuja);
        while (Mensajes.Children.Count > 61) Mensajes.Children.RemoveAt(1);
        Desplazar.ScrollToEnd();
        return cuerpo;
    }

    void EntradaTecla(object s, KeyEventArgs e)
    {
        Pista.Visibility = Entrada.Text.Length == 0 && e.Key != Key.Enter ? Visibility.Visible : Visibility.Collapsed;
        if (e.Key == Key.Enter && Keyboard.Modifiers != ModifierKeys.Shift) { e.Handled = true; EnviarClic(s, e); }
    }

    void EnviarClic(object s, RoutedEventArgs e)
    {
        var t = Entrada.Text.Trim();
        if (t.Length == 0) return;
        Entrada.Clear(); Pista.Visibility = Visibility.Visible;
        continuo = false;
        _ = Procesar(t, false);
    }

    void Sugerencia(object s, RoutedEventArgs e)
    {
        if (s is Button { Tag: string t }) { PestanaChat.IsChecked = true; continuo = false; _ = Procesar(t, false); }
    }

    void CambioPestana(object s, RoutedEventArgs e)
    {
        if (VistaChat == null) return;
        VistaChat.Visibility = PestanaChat.IsChecked == true ? Visibility.Visible : Visibility.Collapsed;
        VistaAcciones.Visibility = PestanaAcciones.IsChecked == true ? Visibility.Visible : Visibility.Collapsed;
        VistaBorrador.Visibility = PestanaBorrador.IsChecked == true ? Visibility.Visible : Visibility.Collapsed;
    }

    void CambiarAvatar(object s, RoutedEventArgs e)
    {
        var orden = new[] { "aura", "claudio", "antonio", "ojos" };
        var siguiente = orden[(Array.IndexOf(orden, ajustes.Avatar) + 1) % orden.Length];
        AplicarAvatar(siguiente);
        Avisar(new Aviso(ajustes.NombreAvatar, T("Ahora hablas conmigo", "You're talking to me now"), "", "happy", Segundos: 2.2));
    }

    void PausaBoton(object s, RoutedEventArgs e) { if (pausado) Reanudar(); else PausarTodo(); }

    void FiltrarApps(object s, TextChangedEventArgs? e)
    {
        var q = Core.LayaLigera.Normalizar(BuscarApp.Text);
        ListaApps.ItemsSource = Aplicaciones.Todas.Where(a => q.Length == 0 || Core.LayaLigera.Normalizar(a.Nombre).Contains(q)).Take(120).ToArray();
    }

    void AbrirAppLista(object s, MouseButtonEventArgs e)
    {
        if (pausado || ListaApps.SelectedItem is not AppInstalada app) return;
        try { Aplicaciones.Abrir(app); Avisar(new Aviso(T("Abriendo ", "Opening ") + app.Nombre, "", "", "happy", Segundos: 2)); }
        catch (Exception ex) { Avisar(new Aviso(T("No se pudo", "Couldn't do it"), ex.Message, "", "worried")); }
    }

    void AbrirLlamadas(object s, RoutedEventArgs e)
    {
        try { if (llamadas == null) { llamadas = new CallWindow(); llamadas.Closed += (_, _) => llamadas = null; } llamadas.Show(); llamadas.Activate(); }
        catch (Exception ex) { Avisar(new Aviso(T("Llamadas", "Calls"), ex.Message, "", "worried")); }
    }

    /// <summary>Ajustes vive en el Centro (con secciones y la explicación de cada opción).</summary>
    internal void AbrirAjustes(object s, RoutedEventArgs e) { e.Handled = true; AbrirCentro("ajustes"); }

    /// <summary>La ventana de ajustes vieja (1.x): queda para quien no tenga WebView2.</summary>
    internal void AbrirAjustesClasicos(object s, RoutedEventArgs e)
    {
        var v = new AjustesWindow(ajustes) { Owner = this };
        if (v.ShowDialog() != true) return;
        // Solo lo que se edita en la ventana: los recordatorios y un token renovado mientras estaba abierta se conservan.
        var r = v.Resultado;
        bool cambioCuenta = r.Correo != ajustes.Correo || r.Servidor != ajustes.Servidor || r.Token != v.TokenAlAbrir;
        ajustes.Servidor = r.Servidor; ajustes.Correo = r.Correo; ajustes.Avatar = r.Avatar; ajustes.Idioma = r.Idioma;
        if (r.Clave.Length > 0 || r.Token.Length == 0) ajustes.Clave = r.Clave;
        if (cambioCuenta) { ajustes.Token = r.Token; ajustes.Nombre = r.Nombre; }
        ajustes.ManosLibres = r.ManosLibres; ajustes.PalabraActivacion = r.PalabraActivacion; ajustes.Interrumpir = r.Interrumpir;
        ajustes.ResponderConVoz = r.ResponderConVoz; ajustes.OcultarEnPantallaCompleta = r.OcultarEnPantallaCompleta;
        ajustes.VozDeWindows = r.VozDeWindows; ajustes.OidoDeWindows = r.OidoDeWindows;
        bool cambioCuentas = r.CorreoDireccion != ajustes.CorreoDireccion || r.CorreoClave != ajustes.CorreoClave || r.AgendaUrl != ajustes.AgendaUrl;
        // Conexiones: solo las que se tocaron en la ventana (un token renovado mientras estaba abierta no se pisa).
        foreach (var clave in v.ConexionesTocadas)
            if (r.Conexiones.TryGetValue(clave, out var tk)) ajustes.Conexiones[clave] = tk; else ajustes.Conexiones.Remove(clave);
        bool cambioIds = r.SpotifyClientId != ajustes.SpotifyClientId || r.GoogleClientId != ajustes.GoogleClientId
                      || r.GoogleClientSecret != ajustes.GoogleClientSecret || r.MicrosoftClientId != ajustes.MicrosoftClientId;
        ajustes.SpotifyClientId = r.SpotifyClientId; ajustes.GoogleClientId = r.GoogleClientId;
        ajustes.GoogleClientSecret = r.GoogleClientSecret; ajustes.MicrosoftClientId = r.MicrosoftClientId;
        cambioCuentas |= v.ConexionesTocadas.Count > 0 || cambioIds;
        ajustes.CorreoDireccion = r.CorreoDireccion; ajustes.CorreoClave = r.CorreoClave; ajustes.AgendaUrl = r.AgendaUrl;
        ajustes.AvisarCorreos = r.AvisarCorreos; ajustes.MostrarMusica = r.MostrarMusica;
        bool cambioAvisos = r.AvisosDeApps != ajustes.AvisosDeApps;
        ajustes.AvisosDeApps = r.AvisosDeApps; ajustes.AvisosPrivados = r.AvisosPrivados; ajustes.AvisosEnVoz = r.AvisosEnVoz;
        ajustes.AppsSilenciadas = r.AppsSilenciadas;
        if (cambioCuentas) IniciarCuentas();
        if (cambioAvisos) IniciarAvisosApps();
        if (!ajustes.MostrarMusica) musicaVisible = false;
        AlCambiarMusica(cancion, false); // mostrar u ocultar la música al momento
        noRenovarHasta = DateTime.MinValue;
        try { ajustes.Guardar(); } catch (Exception ex) { Avisar(new Aviso(T("No guardé los ajustes", "Settings not saved"), ex.Message, "", "worried")); }
        Callar(true); // el turno en curso iba al servidor viejo
        CrearApi();
        AplicarAvatar(ajustes.Avatar);
        AvisoCuenta.Visibility = string.IsNullOrEmpty(ajustes.Token) ? Visibility.Visible : Visibility.Collapsed;
        despertador.Apagar();
        if (ajustes.PalabraActivacion && despertador.Encender(ajustes.Idioma) is { } err) Avisar(new Aviso(T("Palabra de activación", "Wake word"), err, "", "worried", Segundos: 7));
        historial.Clear();
        _ = ComprobarConexion();
    }

    // ───────────────────────────── borrador ─────────────────────────────

    void BorradorCambio(object s, TextChangedEventArgs e) => borradorSucio = true;

    void RecuperarBorrador()
    {
        try
        {
            if (!File.Exists(RutaRecuperacion)) return;
            Borrador.Text = Encoding.UTF8.GetString(ProtectedData.Unprotect(File.ReadAllBytes(RutaRecuperacion), null, DataProtectionScope.CurrentUser));
            borradorGuardado = Borrador.Text; borradorSucio = false;
        }
        catch { }
    }

    void GuardarRecuperacion()
    {
        if (soloRender || Borrador.Text == borradorGuardado) return;
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(RutaRecuperacion)!);
            File.WriteAllBytes(RutaRecuperacion + ".tmp", ProtectedData.Protect(Encoding.UTF8.GetBytes(Borrador.Text), null, DataProtectionScope.CurrentUser));
            File.Move(RutaRecuperacion + ".tmp", RutaRecuperacion, true);
            borradorGuardado = Borrador.Text;
        }
        catch { }
    }

    void CopiarBorrador(object s, RoutedEventArgs e)
    {
        if (Borrador.Text.Length == 0) return;
        try { Clipboard.SetText(Borrador.Text); Avisar(new Aviso(T("Copiado", "Copied"), "", "", "happy", Segundos: 1.6)); } catch { }
    }

    void GuardarBorrador(object s, RoutedEventArgs e) => GuardarArchivo();

    bool GuardarArchivo()
    {
        if (Borrador.Text.Length == 0) return true;
        var d = new Microsoft.Win32.SaveFileDialog { Filter = "Texto (*.txt)|*.txt|Markdown (*.md)|*.md", FileName = "AURA-borrador.txt", AddExtension = true, OverwritePrompt = false };
        if (d.ShowDialog(this) != true) return false;
        try
        {
            using (var f = new FileStream(d.FileName, FileMode.CreateNew, FileAccess.Write)) using (var w = new StreamWriter(f)) w.Write(Borrador.Text);
            borradorSucio = false;
            Avisar(new Aviso(T("Guardado", "Saved"), Path.GetFileName(d.FileName), "", "happy", Segundos: 2.4));
            return true;
        }
        catch (IOException) { Avisar(new Aviso(T("No guardé", "Not saved"), T("Ese archivo ya existe; elige otro nombre.", "That file exists; pick another name."), "", "worried")); return false; }
    }

    void EscribirBorrador(object s, RoutedEventArgs e)
    {
        _ = PrepararEscritura(Borrador.Text);
    }

    bool GuardarAntesDeSalir()
    {
        GuardarRecuperacion();
        if (soloRender || !borradorSucio || Borrador.Text.Length == 0) return true;
        var r = MessageBox.Show(this, T("¿Guardar el borrador como archivo antes de salir?\n(Igual lo recupero la próxima vez.)", "Save the draft as a file before quitting?\n(I'll still recover it next time.)"), "AURA", MessageBoxButton.YesNoCancel, MessageBoxImage.Question);
        if (r == MessageBoxResult.Cancel) return false;
        return r != MessageBoxResult.Yes || GuardarArchivo();
    }
}
