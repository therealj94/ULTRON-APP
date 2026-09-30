using System;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Aura.Windows.Core;

namespace Aura.Windows.Notch;

/// <summary>Ajustes: la cuenta de AU-RA (la misma de la app), el avatar, el idioma y cómo conversa.</summary>
internal sealed class AjustesWindow : Window
{
    public Ajustes Resultado { get; private set; }
    /// <summary>El token al abrir: si cambió, fue por «Entrar» o «Cerrar sesión» aquí.</summary>
    public string TokenAlAbrir { get; }

    public AjustesWindow(Ajustes actual)
    {
        Resultado = JsonSerializer.Deserialize<Ajustes>(JsonSerializer.Serialize(actual))!;
        var a = Resultado;
        TokenAlAbrir = actual.Token;
        Title = "Ajustes · AURA"; Width = 520; SizeToContent = SizeToContent.Height; ResizeMode = ResizeMode.NoResize;
        WindowStartupLocation = WindowStartupLocation.CenterOwner;
        Background = new SolidColorBrush(Color.FromRgb(10, 10, 12)); Foreground = Brushes.White;
        FontFamily = (FontFamily)FindResource("Letra");
        var raiz = new StackPanel { Margin = new Thickness(26, 22, 26, 22) };
        var scroll = new ScrollViewer { Content = raiz, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, MaxHeight = SystemParameters.WorkArea.Height - 80 };
        Content = scroll;

        TextBlock Titulo(string t) => new() { Text = t, FontSize = 13, FontWeight = FontWeights.SemiBold, Margin = new Thickness(0, 18, 0, 8), Foreground = (Brush)FindResource("Acento") };
        TextBlock Nota(string t) => new() { Text = t, FontSize = 12, Foreground = (Brush)FindResource("Tenue"), TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 4, 0, 0) };
        Border Caja(UIElement c) => new() { Child = c, Background = (Brush)FindResource("Superficie"), CornerRadius = new CornerRadius(12), Padding = new Thickness(12, 9, 12, 9), Margin = new Thickness(0, 0, 0, 8) };

        raiz.Children.Add(new TextBlock { Text = "AURA para Windows", FontSize = 22, FontWeight = FontWeights.SemiBold });
        raiz.Children.Add(Nota("El mismo cerebro, las mismas voces y los mismos avatares que la app AU-RA."));

        raiz.Children.Add(Titulo("Tu cuenta"));
        var servidor = new TextBox { Text = a.Servidor }; raiz.Children.Add(Caja(servidor));
        var correo = new TextBox { Text = a.Correo }; raiz.Children.Add(Caja(correo));
        var clave = new PasswordBox { Password = a.Clave, Background = Brushes.Transparent, Foreground = Brushes.White, BorderThickness = new Thickness(0), CaretBrush = Brushes.White }; raiz.Children.Add(Caja(clave));
        var estado = Nota(string.IsNullOrEmpty(a.Token) ? "Sin sesión: conversar funciona; memoria, perfil y Laya del nodo necesitan tu cuenta." : $"Dentro como {(a.Nombre.Length > 0 ? a.Nombre : a.Correo)}.");
        var filaCuenta = new WrapPanel();
        var entrar = new Button { Content = "Entrar", Style = (Style)FindResource("PildoraAcento") };
        var salir = new Button { Content = "Cerrar sesión", Style = (Style)FindResource("Pildora") };
        filaCuenta.Children.Add(entrar); filaCuenta.Children.Add(salir);
        raiz.Children.Add(filaCuenta); raiz.Children.Add(estado);
        entrar.Click += async (_, _) =>
        {
            entrar.IsEnabled = false; estado.Text = "Entrando…";
            try
            {
                using var api = new AuraApi(servidor.Text.Trim());
                var (token, nombre, mail) = await api.Entrar(correo.Text, clave.Password);
                a.Servidor = api.Base.AbsoluteUri.TrimEnd('/'); a.Correo = mail; a.Clave = clave.Password; a.Token = token; a.Nombre = nombre;
                estado.Text = $"Listo: dentro como {(nombre.Length > 0 ? nombre : mail)}.";
            }
            catch (AuraError ex) { estado.Text = ex.Message; }
            finally { entrar.IsEnabled = true; }
        };
        salir.Click += (_, _) => { a.Token = ""; a.Clave = ""; clave.Password = ""; estado.Text = "Sesión cerrada en este equipo."; };

        raiz.Children.Add(Titulo("Avatar"));
        var avatares = new WrapPanel();
        foreach (var (id, nombre) in new[] { ("aura", "AU-RA"), ("claudio", "Claudio"), ("antonio", "ANT-ONIO"), ("ojos", "Guardián") })
        {
            var rb = new RadioButton { Content = nombre, GroupName = "av", IsChecked = a.Avatar == id, Style = (Style)FindResource("Pestana"), Margin = new Thickness(0, 0, 6, 0) };
            rb.Checked += (_, _) => a.Avatar = id;
            avatares.Children.Add(rb);
        }
        raiz.Children.Add(avatares);
        raiz.Children.Add(Nota("Cada uno habla con su voz de siempre (la elige el servidor)."));

        raiz.Children.Add(Titulo("Idioma"));
        var idiomas = new WrapPanel();
        foreach (var (id, nombre) in new[] { ("es", "Español"), ("en", "English") })
        {
            var rb = new RadioButton { Content = nombre, GroupName = "id", IsChecked = a.Idioma == id, Style = (Style)FindResource("Pestana"), Margin = new Thickness(0, 0, 6, 0) };
            rb.Checked += (_, _) => a.Idioma = id;
            idiomas.Children.Add(rb);
        }
        raiz.Children.Add(idiomas);

        raiz.Children.Add(Titulo("Conversación"));
        CheckBox Op(string t, bool v, Action<bool> set) { var c = new CheckBox { Content = t, IsChecked = v }; c.Checked += (_, _) => set(true); c.Unchecked += (_, _) => set(false); raiz.Children.Add(c); return c; }
        Op("Manos libres: al terminar de contestar, vuelve a escucharte", a.ManosLibres, v => a.ManosLibres = v);
        Op("Interrumpirla hablándole encima", a.Interrumpir, v => a.Interrumpir = v);
        Op("Contestar con voz", a.ResponderConVoz, v => a.ResponderConVoz = v);
        Op("«Oye AURA» la despierta (micrófono atento, con la luz naranja encendida)", a.PalabraActivacion, v => a.PalabraActivacion = v);
        Op("Apartarse con juegos o videos a pantalla completa", a.OcultarEnPantallaCompleta, v => a.OcultarEnPantallaCompleta = v);
        raiz.Children.Add(Titulo("Nativo (sin internet)"));
        Op("Hablar siempre con la voz de Windows", a.VozDeWindows, v => a.VozDeWindows = v);
        Op("Oír siempre con el dictado de Windows", a.OidoDeWindows, v => a.OidoDeWindows = v);
        raiz.Children.Add(Nota("Aunque estén apagadas, si el servidor no contesta AURA usa la voz y el oído de Windows solas. La pantalla se lee siempre en este equipo (UI Automation y OCR de Windows): al cerebro va solo texto, nunca imágenes."));
        raiz.Children.Add(Titulo("Llamadas y video (servicio aparte, opcional)"));
        ConnectionSettings llamadas; try { llamadas = ConnectionStore.Load(); } catch { llamadas = new(); }
        var urlLlamadas = new TextBox { Text = llamadas.Gateway }; raiz.Children.Add(Caja(urlLlamadas));
        var claveLlamadas = new PasswordBox { Password = llamadas.Token, Background = Brushes.Transparent, Foreground = Brushes.White, BorderThickness = new Thickness(0) }; raiz.Children.Add(Caja(claveLlamadas));
        raiz.Children.Add(Nota("Dirección y clave del servicio de llamadas de windows/gateway. Sin él, lo demás funciona igual."));
        raiz.Children.Add(Nota("Atajos: Ctrl+Alt+Espacio hablar · Ctrl+Alt+A abrir el chat · Ctrl+Alt+W elegir dónde escribir · Ctrl+Alt+Esc pausar todo."));

        var fin = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 20, 0, 0) };
        var cancelar = new Button { Content = "Cancelar", Style = (Style)FindResource("Pildora") };
        var guardar = new Button { Content = "Guardar", Style = (Style)FindResource("PildoraAcento") };
        cancelar.Click += (_, _) => DialogResult = false;
        guardar.Click += (_, _) =>
        {
            try { a.Servidor = AuraApi.Validar(servidor.Text).AbsoluteUri.TrimEnd('/'); }
            catch (AuraError ex) { estado.Text = ex.Message; return; }
            if (a.Correo != correo.Text.Trim().ToLowerInvariant()) { a.Correo = correo.Text.Trim().ToLowerInvariant(); a.Token = ""; }
            if (clave.Password.Length > 0) a.Clave = clave.Password;
            if (claveLlamadas.Password.Length > 0 || urlLlamadas.Text.Trim() != llamadas.Gateway)
            {
                try { ConnectionStore.Save(new ConnectionSettings(urlLlamadas.Text.Trim(), claveLlamadas.Password)); }
                catch (Exception ex) { estado.Text = "Llamadas: " + ex.Message; return; }
            }
            DialogResult = true;
        };
        fin.Children.Add(cancelar); fin.Children.Add(guardar);
        raiz.Children.Add(fin);
    }
}
