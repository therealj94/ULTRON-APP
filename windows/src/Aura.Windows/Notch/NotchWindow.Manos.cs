using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Media;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using Aura.Windows.Core;
using Aura.Windows.Manos;

namespace Aura.Windows.Notch;

/// <summary>Algo que espera tu «sí» (escribir en otra ventana, bloquear), con su plazo.</summary>
internal sealed record Propuesta(string Titulo, string Cuerpo, DateTime Vence, Func<Task> Hacer);

/// <summary>
/// Las manos: cada pedido hace UNA cosa conocida y lo dice en el notch. Lo que no se deshace solo
/// (escribir en Word o el Bloc de notas, bloquear) espera tu «sí» por voz o con el botón, 30 s.
/// </summary>
public partial class NotchWindow
{
    Propuesta? propuesta;
    DispatcherTimer? relojPropuesta;
    DesktopTarget? destino;
    CancellationTokenSource? escribiendo;

    bool Ingles => ajustes.Idioma == "en";
    string T(string es, string en) => Ingles ? en : es;

    void Hecho(string titulo, string cuerpo, string icono, string? decir = null, string? boton = null, Action? accion = null, double segundos = 2.6)
    {
        Avisar(new Aviso(titulo, cuerpo, icono, "happy", boton, accion, segundos));
        if (decir != null) Contestar(decir);
        else if (continuo) EmpezarAEscuchar();
        AgregarMensaje(ajustes.NombreAvatar, titulo + (cuerpo.Length > 0 ? " · " + cuerpo : ""));
    }

    void NoPude(string motivo)
    {
        Avisar(new Aviso(T("No se pudo", "Couldn't do it"), motivo, "", "worried", Segundos: 5));
        Contestar(motivo, "preocupado");
        AgregarMensaje(ajustes.NombreAvatar, motivo);
    }

    internal async Task Hacer(Pedido p, string texto, bool hablado)
    {
        if (pausado) return;
        try
        {
            switch (p.Mano)
            {
                case Mano.AbrirApp:
                {
                    var app = Aplicaciones.Buscar(p.Valor);
                    if (app == null)
                    {
                        if (Parametros.Sitio(p.Valor) is { } web) { Escritorio.AbrirWeb(web); Hecho(T("Abriendo ", "Opening ") + p.Valor, web, "", T("Listo, abro " + p.Valor + ".", "Opening " + p.Valor + ".")); }
                        else NoPude(T($"No encontré «{p.Valor}» en esta computadora.", $"I couldn't find “{p.Valor}” on this PC."));
                        break;
                    }
                    Aplicaciones.Abrir(app);
                    Hecho(T("Abriendo ", "Opening ") + app.Nombre, "", "", T("Listo, abro " + app.Nombre + ".", "Opening " + app.Nombre + "."));
                    break;
                }
                case Mano.AbrirCarpeta:
                    Escritorio.AbrirCarpeta(p.Valor);
                    Hecho(T("Abriendo ", "Opening ") + Escritorio.NombreCarpeta(p.Valor, ajustes.Idioma), "", "", T("Ahí está.", "Here it is."));
                    break;
                case Mano.AbrirWeb:
                    Escritorio.AbrirWeb(p.Valor);
                    Hecho(T("Abriendo la página", "Opening the page"), new Uri(p.Valor).Host, "", T("Listo.", "Done."));
                    break;
                case Mano.BuscarWeb:
                    Escritorio.Buscar(p.Valor);
                    Hecho(T("Buscando", "Searching"), p.Valor, "", T("Te lo busco.", "Searching for it."));
                    break;
                case Mano.VolumenSubir: Escritorio.Volumen(true, Parametros.Limpiar(texto).Contains("poco") ? 2 : 5); Hecho(T("Volumen arriba", "Volume up"), "", ""); break;
                case Mano.VolumenBajar: Escritorio.Volumen(false, Parametros.Limpiar(texto).Contains("poco") ? 2 : 5); Hecho(T("Volumen abajo", "Volume down"), "", ""); break;
                case Mano.Silenciar: Escritorio.Mute(); Hecho(T("Sonido", "Sound"), T("Silencio activado o quitado", "Mute toggled"), ""); break;
                case Mano.MultimediaPausa: Escritorio.PlayPausa(); Hecho(T("Música", "Media"), T("Play / pausa", "Play / pause"), ""); break;
                case Mano.MultimediaSiguiente: Escritorio.Siguiente(); Hecho(T("Siguiente", "Next"), "", ""); break;
                case Mano.MultimediaAnterior: Escritorio.Anterior(); Hecho(T("Anterior", "Previous"), "", ""); break;
                case Mano.Escritorio: Escritorio.MostrarEscritorio(); Hecho(T("Escritorio", "Desktop"), "", ""); break;
                case Mano.Captura:
                {
                    var ruta = Escritorio.GuardarCaptura();
                    Hecho(T("Captura guardada", "Screenshot saved"), Path.GetFileName(ruta), "", T("Listo, guardé la captura.", "Screenshot saved."),
                        T("Abrir", "Open"), () => Process.Start(new ProcessStartInfo(ruta) { UseShellExecute = true }), 6);
                    break;
                }
                case Mano.VerPantalla: await VerPantalla(texto); break;
                case Mano.Recordar: Recordar(p); break;
                case Mano.Callar: Callar(true); break;
                case Mano.Pausa: PausarTodo(); break;
                case Mano.AbrirChat: AbrirPanel(true); break;
                case Mano.Ocultar: AbrirPanel(false); break;
                case Mano.Avatar:
                    AplicarAvatar(p.Valor);
                    Hecho(ajustes.NombreAvatar, T("Ahora hablas conmigo", "You're talking to me now"), "", T("Hola, soy " + ajustes.NombreAvatar + ". Aquí estoy.", "Hi, I'm " + ajustes.NombreAvatar + ". I'm here."));
                    break;
                case Mano.Redactar: await Redactar(texto); break;
                case Mano.Escribir: PrepararEscritura(p.Valor); break;
                case Mano.Bloquear:
                    Proponer(new Propuesta(T("¿Bloqueo la computadora?", "Lock the computer?"), T("Tendrás que entrar con tu clave de Windows.", "You'll need your Windows password."), DateTime.Now.AddSeconds(30), () => { Escritorio.Bloquear(); return Task.CompletedTask; }));
                    break;
                default: await Conversar(texto, hablado); break;
            }
        }
        catch (Exception ex) { NoPude(ex.Message); }
    }

    async Task VerPantalla(string pregunta)
    {
        if (api == null) { NoPude(T("Conecta AURA en Ajustes para que pueda ver.", "Connect AURA in Settings so I can see.")); return; }
        pensando = true; TextoPiensa.Text = T("Mirando tu pantalla…", "Looking at your screen…"); AvatarPanel.Estado = "thinking"; Recalcular();
        long g = ++generacion;
        string resumen;
        try
        {
            var jpeg = await Task.Run(Escritorio.PantallaJpeg);
            var prompt = T($"La persona te pregunta: «{pregunta}». Mira la captura de su pantalla de Windows y respóndele en español, en 2 a 4 frases, claro y útil (qué está abierto, qué dice, qué le recomiendas). No leas datos sensibles en voz alta.",
                           $"The person asks: “{pregunta}”. Look at this screenshot of their Windows screen and answer in English, 2 to 4 sentences, clear and useful. Don't read sensitive data aloud.");
            resumen = await api.Ver(jpeg, prompt);
        }
        catch (AuraError ex) { if (g == generacion) { pensando = false; NoPude(ex.Message); Recalcular(); } return; }
        if (g != generacion) return;
        pensando = false;
        if (resumen.Length == 0) { NoPude(T("No pude ver bien la pantalla ahora.", "I couldn't see the screen right now.")); Recalcular(); return; }
        ultimaRespuesta = resumen;
        AgregarMensaje(ajustes.NombreAvatar, resumen);
        historial.Add(new Turno("usuario", pregunta)); historial.Add(new Turno("ultron", resumen));
        voz = new CancellationTokenSource();
        var cortes = new CortadorFrases();
        foreach (var f in cortes.Agregar(resumen)) Decir(f, "curioso", voz.Token);
        if (cortes.Resto() is { } r) Decir(r, "curioso", voz.Token);
        if (!ajustes.ResponderConVoz) Avisar(new Aviso(T("Tu pantalla", "Your screen"), resumen, "", "thinking", T("Ver", "View"), () => AbrirPanel(true), 9));
        Recalcular();
    }

    /// <summary>Un documento: lo escribe el cerebro, va al borrador y AURA solo dice que está listo.</summary>
    async Task Redactar(string texto)
    {
        var r = await Conversar(texto, false, redactar: true);
        if (r == null || r.Texto.Length == 0) return;
        if (Borrador.Text.Length > 0 && Borrador.Text != r.Texto) Borrador.AppendText("\n\n────────\n\n" + r.Texto); else Borrador.Text = r.Texto;
        GuardarRecuperacion();
        PestanaBorrador.IsChecked = true;
        AbrirPanel(true);
        Hecho(T("Borrador listo", "Draft ready"), T("Revísalo, cópialo o dime «escríbelo en Word».", "Review it, copy it or say “type it in Word”."), "",
            T("Te dejé el borrador listo. Si quieres, lo escribo en Word.", "Your draft is ready. I can type it into Word if you want."));
    }

    /// <summary>Escribir en la ventana de trabajo (Word o Bloc de notas): se toma el destino YA (el notch no roba el foco) y se confirma.</summary>
    void PrepararEscritura(string valor)
    {
        var texto = valor.Length > 0 ? valor : Borrador.Text.Length > 0 ? Borrador.Text : ultimaRespuesta;
        if (string.IsNullOrWhiteSpace(texto)) { NoPude(T("No tengo nada que escribir todavía. Dime qué escribo o pídeme un borrador.", "I have nothing to type yet. Tell me what to write or ask for a draft.")); return; }
        try { destino ??= DesktopTarget.Capture(); }
        catch (Exception ex) { NoPude(ex.Message); return; }
        var sel = destino;
        Proponer(new Propuesta(T("¿Lo escribo en ", "Type it into ") + sel.Title + "?", texto.Length > 140 ? texto[..140] + "…" : texto, DateTime.Now.AddSeconds(30), async () =>
        {
            destino = null;
            escribiendo = new CancellationTokenSource();
            try { await sel.Write(texto, escribiendo.Token); Hecho(T("Escrito", "Typed"), sel.Title, "", T("Listo, ya está escrito.", "Done, it's typed.")); }
            finally { escribiendo.Dispose(); escribiendo = null; }
        }));
    }

    /// <summary>Ctrl+Alt+W: esta ventana (Word o Bloc de notas) es el destino de la próxima escritura.</summary>
    internal void ElegirDestino()
    {
        if (pausado) return;
        try { destino = DesktopTarget.Capture(); DestinoTexto.Text = T("Destino: ", "Target: ") + destino.Title; Avisar(new Aviso(T("Destino elegido", "Target selected"), destino.Title, "", "happy")); }
        catch (Exception ex) { destino = null; Avisar(new Aviso(T("Elige Word o el Bloc de notas", "Pick Word or Notepad"), ex.Message, "", "worried", Segundos: 6)); }
    }

    void Proponer(Propuesta p)
    {
        propuesta = p;
        TituloConfirma.Text = p.Titulo; CuerpoConfirma.Text = p.Cuerpo;
        relojPropuesta?.Stop();
        relojPropuesta = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(100) };
        relojPropuesta.Tick += (_, _) =>
        {
            var falta = (p.Vence - DateTime.Now).TotalSeconds;
            CuentaAtras.Width = Math.Max(0, falta / 30 * (CuentaAtras.Parent is FrameworkElement f ? f.ActualWidth : 300));
            if (falta <= 0) { _ = Responder(false, T("Se venció la confirmación.", "The confirmation expired.")); }
        };
        relojPropuesta.Start();
        Recalcular();
        Contestar(p.Titulo + " " + T("Dime sí o no.", "Say yes or no."), "curioso");
    }

    internal async Task Responder(bool si, string? motivo = null)
    {
        var p = propuesta;
        propuesta = null; relojPropuesta?.Stop();
        Recalcular();
        if (p == null) return;
        if (!si || pausado || DateTime.Now > p.Vence) { destino = null; Avisar(new Aviso(T("No lo hice", "Didn't do it"), motivo ?? T("Cancelado.", "Cancelled."), "", "idle", Segundos: 2.4)); return; }
        try { await p.Hacer(); }
        catch (Exception ex) { NoPude(ex.Message); }
    }

    void SiConfirma(object s, RoutedEventArgs e) => _ = Responder(true);
    void NoConfirma(object s, RoutedEventArgs e) => _ = Responder(false);

    // ───────────────────────────── recordatorios ─────────────────────────────

    void Recordar(Pedido p)
    {
        var cuando = DateTime.Now + (p.Cuando ?? TimeSpan.FromMinutes(5));
        var tarea = p.Valor.Length > 0 ? p.Valor : T("Se cumplió el tiempo", "Time's up");
        ajustes.Recordatorios.Add(new Recordatorio(Guid.NewGuid(), cuando, tarea));
        try { ajustes.Guardar(); } catch { }
        PintarRecordatorios();
        var hora = cuando.ToString(cuando.Date == DateTime.Today ? "HH:mm" : "ddd HH:mm");
        Hecho(T("Te aviso a las ", "I'll remind you at ") + hora, tarea, "", T($"Listo, te aviso a las {hora}.", $"Got it, I'll remind you at {hora}."));
    }

    void RevisarRecordatorios()
    {
        var vencidos = ajustes.Recordatorios.Where(r => r.Cuando <= DateTime.Now).ToList();
        if (vencidos.Count == 0) return;
        foreach (var r in vencidos)
        {
            ajustes.Recordatorios.Remove(r);
            SystemSounds.Asterisk.Play();
            Avisar(new Aviso(T("Recordatorio", "Reminder"), r.Tarea, "", "happy", T("Listo", "Done"), () => { }, 12));
            if (!pausado) Contestar(T("Te recuerdo: ", "Reminder: ") + r.Tarea);
        }
        try { ajustes.Guardar(); } catch { }
        PintarRecordatorios();
    }

    void PintarRecordatorios()
    {
        ListaRecordatorios.Children.Clear();
        foreach (var r in ajustes.Recordatorios.OrderBy(r => r.Cuando))
        {
            var fila = new Grid { Margin = new Thickness(0, 0, 0, 6) };
            fila.ColumnDefinitions.Add(new ColumnDefinition());
            fila.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            fila.Children.Add(new TextBlock { Text = r.Cuando.ToString("ddd HH:mm") + " · " + r.Tarea, TextWrapping = TextWrapping.Wrap, VerticalAlignment = VerticalAlignment.Center });
            var quitar = new Button { Content = "", Style = (Style)FindResource("Icono"), ToolTip = T("Quitar", "Remove") };
            var id = r.Id;
            quitar.Click += (_, _) => { ajustes.Recordatorios.RemoveAll(x => x.Id == id); try { ajustes.Guardar(); } catch { } PintarRecordatorios(); };
            Grid.SetColumn(quitar, 1);
            fila.Children.Add(quitar);
            ListaRecordatorios.Children.Add(fila);
        }
        SinRecordatorios.Visibility = ajustes.Recordatorios.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
    }
}
