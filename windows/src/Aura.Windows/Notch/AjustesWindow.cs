using System;
using System.Threading.Tasks;
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
    /// <summary>Las conexiones (spotify, google, microsoft) que se conectaron o desconectaron aquí.</summary>
    public System.Collections.Generic.HashSet<string> ConexionesTocadas { get; } = new();

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

        // ── El notch: transparencia y borde (la posición exacta se elige arrastrándolo) ──
        raiz.Children.Add(Titulo("Notch"));
        var cuanto = new TextBlock { FontSize = 12, Foreground = (Brush)FindResource("Tenue"), VerticalAlignment = VerticalAlignment.Center, Width = 120, TextAlignment = TextAlignment.Right };
        void DecirVidrio(double v) => cuanto.Text = v >= 0.995 ? "Sólido" : $"Transparencia {Math.Round((1 - v) * 100)} %";
        var vidrio = new Slider { Minimum = VidrioNotch.Min, Maximum = VidrioNotch.Max, Value = VidrioNotch.Leer(a.Transparencia), SmallChange = 0.01, LargeChange = 0.1, IsMoveToPointEnabled = true, Width = 300, VerticalAlignment = VerticalAlignment.Center, ToolTip = "Izquierda: más transparente · derecha: negro sólido" };
        System.Windows.Automation.AutomationProperties.SetName(vidrio, "Transparencia del notch");
        vidrio.ValueChanged += (_, e) => { a.Transparencia = Math.Round(e.NewValue, 2); DecirVidrio(e.NewValue); };
        DecirVidrio(vidrio.Value);
        var filaVidrio = new StackPanel { Orientation = Orientation.Horizontal };
        filaVidrio.Children.Add(vidrio); filaVidrio.Children.Add(cuanto);
        raiz.Children.Add(new TextBlock { Text = "Transparencia del notch", FontSize = 13 });
        raiz.Children.Add(filaVidrio);
        raiz.Children.Add(Nota("La píldora deja ver lo de atrás; al conversar, avisar o pedir tu «sí» se vuelve casi opaca para que el texto se lea."));
        var bordes = new WrapPanel { Margin = new Thickness(0, 8, 0, 0) };
        foreach (var (id, nombre) in new[] { ("arriba", "Arriba"), ("abajo", "Abajo") })
        {
            var rb = new RadioButton { Content = nombre, GroupName = "borde", IsChecked = a.NotchBorde == id, Style = (Style)FindResource("Pestana"), Margin = new Thickness(0, 0, 6, 0) };
            rb.Checked += (_, _) => a.NotchBorde = id;
            bordes.Children.Add(rb);
        }
        var centrar = new Button { Content = "Restablecer posición", Style = (Style)FindResource("Pildora"), ToolTip = "Arriba al centro del monitor principal" };
        centrar.Click += (_, _) => { a.NotchBorde = "arriba"; a.NotchFraccion = 0.5; a.NotchMonitor = ""; foreach (var x in bordes.Children) if (x is RadioButton r) r.IsChecked = (string)r.Content == "Arriba"; };
        bordes.Children.Add(centrar);
        raiz.Children.Add(bordes);
        raiz.Children.Add(Nota("Arrástralo desde la píldora por el borde de la pantalla (o a otro monitor); al soltarlo se pega a la izquierda, al centro o a la derecha. Doble clic: vuelve arriba al centro."));

        raiz.Children.Add(Titulo("Conversación"));
        CheckBox Op(string t, bool v, Action<bool> set) { var c = new CheckBox { Content = t, IsChecked = v }; c.Checked += (_, _) => set(true); c.Unchecked += (_, _) => set(false); raiz.Children.Add(c); return c; }
        Op("Manos libres: al terminar de contestar, vuelve a escucharte", a.ManosLibres, v => a.ManosLibres = v);
        Op("Interrumpirla hablándole encima", a.Interrumpir, v => a.Interrumpir = v);
        Op("Contestar con voz", a.ResponderConVoz, v => a.ResponderConVoz = v);
        Op("«Oye AURA» la despierta (micrófono atento, con la luz naranja encendida)", a.PalabraActivacion, v => a.PalabraActivacion = v);
        Op("Apartarse con juegos o videos a pantalla completa", a.OcultarEnPantallaCompleta, v => a.OcultarEnPantallaCompleta = v);
        Op("Menos movimiento (el avatar quieto, sin animaciones)", a.MenosMovimiento, v => a.MenosMovimiento = v);
        raiz.Children.Add(Titulo("Nativo (sin internet)"));
        Op("Hablar siempre con la voz de Windows", a.VozDeWindows, v => a.VozDeWindows = v);
        Op("Oír siempre con el dictado de Windows", a.OidoDeWindows, v => a.OidoDeWindows = v);
        raiz.Children.Add(Nota("Aunque estén apagadas, si el servidor no contesta AURA usa la voz y el oído de Windows solas. La pantalla se lee siempre en este equipo (UI Automation y OCR de Windows): al cerebro va solo texto, nunca imágenes."));
        raiz.Children.Add(Titulo("Conexiones: música, correo y agenda"));
        raiz.Children.Add(Nota("Se entra en el navegador, en la página del propio servicio: AURA nunca ve tu contraseña. El permiso queda cifrado en esta PC y lo quitas cuando quieras (aquí o en la cuenta del servicio)."));
        foreach (var (prov, nombre, para) in new[]
        {
            (Proveedor.Spotify, "Spotify", "Pone la canción, el artista o la playlist exacta que pidas (control desde AURA: Spotify Premium)."),
            (Proveedor.Google, "Google", "Gmail y Google Calendar (solo leer) y YouTube Music: la canción exacta, sonando."),
            (Proveedor.Microsoft, "Microsoft", "Outlook, Hotmail y Microsoft 365: correo y calendario (solo leer)."),
        })
        {
            var claveCx = Manos.Servicios.Clave(prov);
            var fila = new WrapPanel { Margin = new Thickness(0, 6, 0, 0) };
            var boton = new Button { Style = (Style)FindResource("PildoraAcento") };
            var quitar = new Button { Content = "Desconectar", Style = (Style)FindResource("Pildora") };
            var nota = Nota(para);
            void Pintar()
            {
                bool esta = a.Conexiones.TryGetValue(claveCx, out var tk);
                boton.Content = esta ? $"{nombre} ✓" : $"Conectar {nombre}";
                quitar.Visibility = esta ? Visibility.Visible : Visibility.Collapsed;
                nota.Text = esta ? $"Conectado{(tk!.Cuenta.Length > 0 ? " como " + tk.Cuenta : "")}. {para}" : para;
            }
            Pintar();
            boton.Click += async (_, _) =>
            {
                boton.IsEnabled = false; nota.Text = "Abriendo el navegador… acepta allí y vuelve.";
                try
                {
                    // El Client ID: el propio de «Avanzado» si lo hay; si no, el que puso el servidor AU-RA.
                    if (Manos.Servicios.Config(a, prov) == null && a.Token.Length > 0)
                    {
                        using var api = new AuraApi(a.Servidor, a.Token);
                        var ids = await api.ClientesOauth();
                        if (prov == Proveedor.Spotify && ids.Spotify != null) a.SpotifyClientId = ids.Spotify;
                        if (prov == Proveedor.Google && ids.Google != null) { a.GoogleClientId = ids.Google; a.GoogleClientSecret = ids.GoogleSecreto ?? ""; }
                        if (prov == Proveedor.Microsoft && ids.Microsoft != null) a.MicrosoftClientId = ids.Microsoft;
                    }
                    var cfg = Manos.Servicios.Config(a, prov)
                        ?? throw new InvalidOperationException(a.Token.Length == 0
                            ? "Primero entra con tu cuenta AU-RA (arriba): de ahí salen los permisos de la app. O pon un Client ID propio en «Avanzado»."
                            : $"El servidor AU-RA aún no tiene el Client ID de {nombre}. Hay que ponerlo en Render (ver README) o en «Avanzado».");
                    var token = await Manos.Conexion.Entrar(cfg);
                    a.Conexiones[claveCx] = token;
                    ConexionesTocadas.Add(claveCx);
                    Pintar();
                    Activate();
                }
                catch (Exception ex) when (ex is InvalidOperationException or AuraError or System.Net.Http.HttpRequestException or TaskCanceledException)
                {
                    nota.Text = ex.Message;
                }
                finally { boton.IsEnabled = true; }
            };
            quitar.Click += (_, _) => { a.Conexiones.Remove(claveCx); ConexionesTocadas.Add(claveCx); Pintar(); };
            fila.Children.Add(boton); fila.Children.Add(quitar);
            raiz.Children.Add(fila); raiz.Children.Add(nota);
        }
        var avanzado = new Expander { Header = "Avanzado: Client ID propios (opcional)", Foreground = Brushes.White, Margin = new Thickness(0, 10, 0, 0) };
        var avz = new StackPanel();
        TextBox Campo(string valor, string pista) { var t = new TextBox { Text = valor, ToolTip = pista }; avz.Children.Add(Nota(pista)); avz.Children.Add(Caja(t)); return t; }
        var idSpotify = Campo(a.SpotifyClientId, "Spotify Client ID");
        var idGoogle = Campo(a.GoogleClientId, "Google Client ID (app de escritorio)");
        var secGoogle = Campo(a.GoogleClientSecret, "Google Client secret (el de la app de escritorio)");
        var idMicrosoft = Campo(a.MicrosoftClientId, "Microsoft Application (client) ID");
        avz.Children.Add(Nota($"En cada servicio, registra como dirección de vuelta: {Oauth.Redireccion}"));
        avanzado.Content = avz;
        raiz.Children.Add(avanzado);
        void GuardarIds()
        {
            a.SpotifyClientId = idSpotify.Text.Trim(); a.GoogleClientId = idGoogle.Text.Trim();
            a.GoogleClientSecret = secGoogle.Text.Trim(); a.MicrosoftClientId = idMicrosoft.Text.Trim();
        }
        idSpotify.LostFocus += (_, _) => GuardarIds(); idGoogle.LostFocus += (_, _) => GuardarIds();
        secGoogle.LostFocus += (_, _) => GuardarIds(); idMicrosoft.LostFocus += (_, _) => GuardarIds();

        raiz.Children.Add(Titulo("Correo y agenda sin conectar cuenta (IMAP / iCal)"));
        var correoDir = new TextBox { Text = a.CorreoDireccion }; raiz.Children.Add(Caja(correoDir));
        var correoClave = new PasswordBox { Password = a.CorreoClave, Background = Brushes.Transparent, Foreground = Brushes.White, BorderThickness = new Thickness(0) }; raiz.Children.Add(Caja(correoClave));
        raiz.Children.Add(Nota("Gmail: usa una «contraseña de aplicación» (Cuenta de Google → Seguridad → Verificación en 2 pasos → Contraseñas de aplicaciones). También Yahoo, iCloud y otros IMAP. Solo se lee: nada se marca ni se borra."));
        var agendaUrl = new TextBox { Text = a.AgendaUrl }; raiz.Children.Add(Caja(agendaUrl));
        raiz.Children.Add(Nota("Calendario: en Google Calendar → Configuración del calendario → «Dirección secreta en formato iCal». Pégala aquí (no la compartas)."));
        var estadoCuentas = Nota("");
        var probar = new Button { Content = "Probar correo y agenda", Style = (Style)FindResource("Pildora"), HorizontalAlignment = HorizontalAlignment.Left };
        probar.Click += async (_, _) =>
        {
            probar.IsEnabled = false; estadoCuentas.Text = "Probando…";
            var partes = new System.Collections.Generic.List<string>();
            if (correoDir.Text.Contains('@'))
                try { using var c = new Manos.Correo(correoDir.Text, correoClave.Password); partes.Add($"Correo: {await c.Probar()} sin leer."); }
                catch (Exception ex) { partes.Add("Correo: " + ex.Message); }
            if (agendaUrl.Text.Trim().Length > 8)
                try { using var ag = new Manos.AgendaCuenta(agendaUrl.Text.Trim()); var evs = await ag.Cargar(); partes.Add($"Agenda: {System.Linq.Enumerable.Count(evs, x => x.Inicio.Date == DateTime.Today)} eventos hoy."); }
                catch (Exception ex) { partes.Add("Agenda: " + ex.Message); }
            estadoCuentas.Text = partes.Count > 0 ? string.Join(" ", partes) : "Escribe tu correo o la dirección del calendario.";
            probar.IsEnabled = true;
        };
        raiz.Children.Add(probar); raiz.Children.Add(estadoCuentas);
        Op("Avisarme de correos nuevos en el notch", a.AvisarCorreos, v => a.AvisarCorreos = v);
        Op("Mostrar lo que suena (Spotify, YouTube Music, el navegador)", a.MostrarMusica, v => a.MostrarMusica = v);

        raiz.Children.Add(Titulo("Notificaciones de otras apps"));
        Op("Mostrarlas en el notch (WhatsApp, Teams, Outlook, Chrome…)", a.AvisosDeApps, v => a.AvisosDeApps = v);
        Op("Solo decir de qué app es, sin el texto (privado)", a.AvisosPrivados, v => a.AvisosPrivados = v);
        Op("Leerlas en voz alta al llegar", a.AvisosEnVoz, v => a.AvisosEnVoz = v);
        var silenciadas = Nota("");
        void PintarSilenciadas() => silenciadas.Text = a.AppsSilenciadas.Count == 0
            ? "Ninguna app en silencio. Di «silencia las notificaciones de WhatsApp» para quitar una."
            : "En silencio: " + string.Join(", ", a.AppsSilenciadas) + ". Di «vuelve a mostrar las notificaciones de …» para devolverla.";
        PintarSilenciadas();
        raiz.Children.Add(silenciadas);
        if (a.AppsSilenciadas.Count > 0)
        {
            var todas = new Button { Content = "Quitar todos los silencios", Style = (Style)FindResource("Pildora"), HorizontalAlignment = HorizontalAlignment.Left };
            todas.Click += (_, _) => { a.AppsSilenciadas.Clear(); PintarSilenciadas(); todas.IsEnabled = false; };
            raiz.Children.Add(todas);
        }
        raiz.Children.Add(Nota("AURA lee las notificaciones que Windows ya guarda en esta PC, solo para mostrarlas; no salen del equipo. Es lo mismo que ves en el centro de notificaciones."));

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
            a.CorreoDireccion = correoDir.Text.Trim(); a.CorreoClave = correoClave.Password; a.AgendaUrl = agendaUrl.Text.Trim();
            GuardarIds();
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
