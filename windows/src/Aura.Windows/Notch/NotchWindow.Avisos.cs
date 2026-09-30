using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using Aura.Windows.Core;
using Aura.Windows.Manos;

namespace Aura.Windows.Notch;

/// <summary>
/// Las notificaciones de las demás apps en el notch, como la isla: la app, quién y qué dice, con
/// «Abrir». Se pueden silenciar por app («silencia las notificaciones de WhatsApp»), ocultar el texto
/// (solo la app) o leerlas en voz alta. Nada sale del equipo: solo se leen para mostrarlas.
/// </summary>
public partial class NotchWindow
{
    AvisosDeApps? avisosApps;

    static readonly string[] AppsDeChat = { "WhatsApp", "Teams", "Telegram", "Slack", "Discord", "Signal", "Messenger", "Instagram", "Skype", "Enlace Móvil" };
    static readonly string[] AppsDeCorreo = { "Outlook", "Correo", "Gmail" };

    static string IconoDe(AvisoApp a) => AppsDeChat.Contains(a.App) ? "" : AppsDeCorreo.Contains(a.App) ? "" : a.App == "Calendario" ? "" : "";

    bool Silenciada(string app) => ajustes.AppsSilenciadas.Any(x => string.Equals(x, app, StringComparison.OrdinalIgnoreCase));

    void IniciarAvisosApps()
    {
        avisosApps?.Dispose(); avisosApps = null;
        if (!ajustes.AvisosDeApps) return;
        var a = new AvisosDeApps();
        if (!a.Existe) return; // Windows sin su base de notificaciones (p. ej. una sesión de servicio)
        a.Nuevo += av => Dispatcher.BeginInvoke(new Action(() => MostrarAvisoApp(av)));
        a.Fallo += m => Dispatcher.BeginInvoke(new Action(() => Avisar(new Aviso(T("Notificaciones", "Notifications"), m, "", "worried", Segundos: 6))));
        a.Iniciar();
        avisosApps = a;
    }

    void MostrarAvisoApp(AvisoApp a)
    {
        if (pausado || !ajustes.AvisosDeApps || Silenciada(a.App)) return;
        var titulo = a.App + (a.Sitio.Length > 0 ? " · " + a.Sitio : "");
        var cuerpo = ajustes.AvisosPrivados ? T("Nueva notificación", "New notification") : a.Titulo + (a.Cuerpo.Length > 0 ? ": " + a.Cuerpo : "");
        Avisar(new Aviso(titulo, cuerpo, IconoDe(a), "happy", T("Abrir", "Open"), () => AbrirApp(a), 6));
        if (ajustes.AvisosEnVoz && !ajustes.AvisosPrivados && !hablandoAhora && !escuchando)
            Contestar(AvisosApps.Decir(a));
    }

    /// <summary>Abre la app que mandó la notificación (por su id de Windows); si no se puede, no pasa nada.</summary>
    static void AbrirApp(AvisoApp a)
    {
        if (a.Aumid.Length == 0 || a.Aumid.IndexOfAny(new[] { '"', '\r', '\n' }) >= 0) return;
        try { Process.Start(new ProcessStartInfo("explorer.exe", "\"shell:AppsFolder\\" + a.Aumid + "\"") { UseShellExecute = false }); }
        catch { }
    }

    /// <summary>«leer», «ultima», «silenciar|app», «activar|app».</summary>
    async Task HacerNotificaciones(string valor)
    {
        var partes = valor.Split('|', 2);
        if (partes[0] is "silenciar" or "activar")
        {
            var dicho = partes.Length > 1 ? partes[1] : "";
            // El nombre como lo muestra AURA («whatsapp» → «WhatsApp»), si ya llegó alguna de esa app.
            List<AvisoApp> recientes = new();
            if (avisosApps != null) try { recientes = await Task.Run(() => avisosApps.Recientes(50)); } catch { }
            var app = recientes.Select(x => x.App).FirstOrDefault(x => LayaLigera.Normalizar(x) == LayaLigera.Normalizar(dicho))
                      ?? AvisosApps.NombreApp(dicho);
            if (partes[0] == "silenciar") { if (!Silenciada(app)) ajustes.AppsSilenciadas.Add(app); }
            else ajustes.AppsSilenciadas.RemoveAll(x => string.Equals(x, app, StringComparison.OrdinalIgnoreCase));
            try { ajustes.Guardar(); } catch { }
            Hecho(partes[0] == "silenciar" ? T($"{app} en silencio", $"{app} muted") : T($"{app} de vuelta", $"{app} unmuted"), "", "",
                  partes[0] == "silenciar" ? T($"Listo, ya no te muestro las de {app}.", $"Done, no more {app} notifications.") : T($"Listo, vuelvo a mostrarte las de {app}.", $"Done, {app} notifications are back."));
            return;
        }
        if (avisosApps == null)
        {
            NoPude(ajustes.AvisosDeApps ? T("Este Windows no me deja ver sus notificaciones.", "This Windows doesn't let me see its notifications.")
                                        : T("Las notificaciones de otras apps están apagadas en Ajustes.", "Other apps' notifications are off in Settings."));
            return;
        }
        List<AvisoApp> lista;
        try { lista = (await Task.Run(() => avisosApps.Recientes(30))).Where(x => !AvisosApps.EsPropia(x.Aumid) && !Silenciada(x.App)).ToList(); }
        catch (Exception ex) { NoPude(ex.Message); return; }
        if (partes[0] == "ultima")
        {
            if (lista.Count == 0) { Hecho(T("Sin notificaciones", "No notifications"), "", "", T("No tienes notificaciones.", "You have no notifications.")); return; }
            var u = lista[0];
            Hecho(u.App, u.Titulo + (u.Cuerpo.Length > 0 ? ": " + u.Cuerpo : ""), IconoDe(u), AvisosApps.Decir(u) + ".", T("Abrir", "Open"), () => AbrirApp(u), 6);
            return;
        }
        // Las de las últimas 12 horas.
        var hoy = lista.Where(x => x.Llegada > DateTimeOffset.Now.AddHours(-12)).Take(10).ToList();
        if (hoy.Count == 0) { Hecho(T("Sin notificaciones", "No notifications"), "", "", T("No te ha llegado nada en las últimas horas.", "Nothing new in the last few hours.")); return; }
        AgregarMensaje(ajustes.NombreAvatar, string.Join("\n", hoy.Select(x => $"• {x.Llegada.LocalDateTime:h:mm} {AvisosApps.Decir(x)}")));
        var porApp = hoy.GroupBy(x => x.App).Select(g => g.Count() == 1 ? g.Key : $"{g.Count()} de {g.Key}");
        var dichas = string.Join(". ", hoy.Take(3).Select(AvisosApps.Decir));
        Hecho(T($"{hoy.Count} notificaciones", $"{hoy.Count} notifications"), string.Join(", ", porApp), "",
              T($"Tienes {hoy.Count}: {string.Join(", ", porApp)}. {dichas}.", $"You have {hoy.Count}: {string.Join(", ", porApp)}. {dichas}."), segundos: 6);
    }
}
