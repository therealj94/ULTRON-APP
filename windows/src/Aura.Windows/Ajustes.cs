using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text.Json;
using Aura.Windows.Core;

namespace Aura.Windows;

/// <summary>Un recordatorio que vive en el notch (sobrevive a cerrar AURA).</summary>
internal sealed record Recordatorio(Guid Id, DateTime Cuando, string Tarea);

/// <summary>
/// Lo que AURA recuerda en este equipo: servidor, cuenta, avatar y voz. Cifrado con DPAPI para el
/// usuario de Windows (la clave de la cuenta y el token nunca quedan en claro en el disco).
/// </summary>
internal sealed class Ajustes
{
    public string Servidor { get; set; } = AuraApi.ServidorPorDefecto;
    public string Correo { get; set; } = "";
    public string Clave { get; set; } = "";
    public string Token { get; set; } = "";
    public string Nombre { get; set; } = "";
    /// <summary>aura | claudio | antonio | ojos (los mismos ids que la app; el servidor elige la voz).</summary>
    public string Avatar { get; set; } = "aura";
    public string Idioma { get; set; } = "es";
    /// <summary>Después de contestar, vuelve a escuchar sola (conversación continua).</summary>
    public bool ManosLibres { get; set; } = true;
    /// <summary>Instalar sola las versiones nuevas cuando no estás usando la PC (si no, avisa y esperas el botón).</summary>
    public bool ActualizarSolo { get; set; } = true;
    /// <summary>«Oye AURA» / «Hey AURA» la despierta (micrófono abierto con el indicador encendido).</summary>
    public bool PalabraActivacion { get; set; }
    /// <summary>Hablarle mientras habla la interrumpe.</summary>
    public bool Interrumpir { get; set; } = true;
    public bool ResponderConVoz { get; set; } = true;
    /// <summary>Se esconde sola cuando una app está en pantalla completa (juegos, videos).</summary>
    public bool OcultarEnPantallaCompleta { get; set; } = true;
    /// <summary>Hablar siempre con la voz de Windows (sin red). Si es false, se usa sola cuando el servidor no contesta.</summary>
    public bool VozDeWindows { get; set; }
    /// <summary>Oír siempre con el dictado de Windows (sin red). Si es false, se usa solo de respaldo.</summary>
    public bool OidoDeWindows { get; set; }
    /// <summary>Correo por IMAP (Gmail con contraseña de aplicación, Yahoo, iCloud…). Cifrado con DPAPI como todo lo demás.</summary>
    public string CorreoDireccion { get; set; } = "";
    public string CorreoClave { get; set; } = "";
    public bool AvisarCorreos { get; set; } = true;
    /// <summary>La «dirección secreta en formato iCal» del calendario (Google, Outlook, iCloud).</summary>
    public string AgendaUrl { get; set; } = "";
    /// <summary>Mostrar en el notch lo que suena (Spotify, YouTube Music, el navegador…).</summary>
    public bool MostrarMusica { get; set; } = true;
    /// <summary>Cuánto tapa el notch lo de atrás: 0.30 (mucho vidrio) a 1 (negro sólido, como antes). Ver VidrioNotch.</summary>
    public double Transparencia { get; set; } = VidrioNotch.PorDefecto;
    /// <summary>
    /// Cuentas conectadas con OAuth («spotify», «google», «microsoft»): el token de acceso y el de
    /// renovar, cifrados con DPAPI como todo lo demás. Nunca salen de este equipo.
    /// </summary>
    public Dictionary<string, TokenOauth> Conexiones { get; set; } = new();
    /// <summary>
    /// De quién son las conexiones, el correo IMAP y el calendario (el correo AURA, en minúsculas). Si entra otra
    /// identidad o se sale de la cuenta, se borran (DuenoCuentas).
    /// </summary>
    public string DuenoCuentas { get; set; } = "";
    /// <summary>Client ID propios (opcional): si están, ganan a los que da el servidor AU-RA.</summary>
    public string SpotifyClientId { get; set; } = "";
    public string GoogleClientId { get; set; } = "";
    public string GoogleClientSecret { get; set; } = "";
    public string MicrosoftClientId { get; set; } = "";
    /// <summary>Mostrar en el notch las notificaciones de las demás apps (WhatsApp, Teams, Outlook…).</summary>
    public bool AvisosDeApps { get; set; } = true;
    /// <summary>Solo decir de qué app es, sin el texto (para cuando hay gente mirando la pantalla).</summary>
    public bool AvisosPrivados { get; set; }
    /// <summary>Leerlas en voz alta al llegar.</summary>
    public bool AvisosEnVoz { get; set; }
    /// <summary>Apps cuyas notificaciones no salen en el notch (por nombre: «WhatsApp»).</summary>
    public List<string> AppsSilenciadas { get; set; } = new();
    /// <summary>Lo que dijo AU-RA de quién entró: rol, nivel («junta» o «miembro») y el Genesis ID.</summary>
    public string Rol { get; set; } = "";
    public string Nivel { get; set; } = "";
    public string Gid { get; set; } = "";
    /// <summary>true = entró con Genesis ID (sin clave guardada: al vencer la sesión se vuelve a entrar).</summary>
    public bool PorGenesis { get; set; }
    /// <summary>Ya vio la guía de la primera vez.</summary>
    public bool PrimeraVezHecha { get; set; }
    /// <summary>Cómo escucha: «pedir» (tecla o clic), «palabra» («Oye AURA», en la PC) o «siempre» (atenta mientras hay conversación).</summary>
    public string Escucha { get; set; } = "palabra";
    /// <summary>La dirección pública de Veta Wallet (0x…) para leer los saldos. Solo lectura: nunca mueve dinero.</summary>
    public string CarteraDireccion { get; set; } = "";
    public List<Recordatorio> Recordatorios { get; set; } = new();
    /// <summary>
    /// Cómo conversa por voz: «agente» (en vivo con ElevenLabs, como la llamada del teléfono: se le puede
    /// interrumpir y contesta más rápido) o «local» (el oído de siempre, frase por frase). Si la de en vivo
    /// no abre, usa la local sola.
    /// </summary>
    public string VozMotor { get; set; } = "agente";
    // ── Privacidad del registro de diagnóstico (auditoría 1-oct, H13) ──
    /// <summary>
    /// «Registro detallado»: aura.log guarda también lo que dijiste y los títulos de órdenes (saneados y
    /// recortados). Apagado de fábrica: solo metadatos (largos, tiempos, tipos).
    /// </summary>
    public bool RegistroDetallado { get; set; }

    /// <summary>El id de este equipo para el canal de AURA (no es secreto: elige a qué equipo va una orden).</summary>
    public string Aparato { get; set; } = NuevoAparato();

    // ── El notch: dónde vive y cuánto vidrio (bloque aparte) ──
    /// <summary>«arriba» o «abajo»: el borde del monitor al que va pegado.</summary>
    public string NotchBorde { get; set; } = "arriba";
    /// <summary>0 = a la izquierda, 0.5 = al centro, 1 = a la derecha.</summary>
    public double NotchFraccion { get; set; } = 0.5;
    /// <summary>El monitor (nombre de Windows, «\\.\DISPLAY2»); vacío = el principal.</summary>
    public string NotchMonitor { get; set; } = "";
    /// <summary>Menos movimiento: el avatar se queda quieto y el notch no anima (además del ajuste de Windows).</summary>
    public bool MenosMovimiento { get; set; }
    /// <summary>Los efectos de sonido del orbe de AU-RA (escucha, piensa, habla, listo, toque): cortos y bajitos. Encendidos de fábrica.</summary>
    public bool EfectosDeSonido { get; set; } = true;
    /// <summary>Versión de los ajustes del notch: 2 = el vidrio por defecto pasó de 0.72 a 0.5.</summary>
    public int NotchVersion { get; set; }
    /// <summary>
    /// «Continuar» (Fase 2): la última revisión que ESTA PC vio de cada objetivo (id → revisión). Si el servidor tiene una
    /// más nueva de un objetivo abierto, el notch ofrece «Continuar: …». Ver Core.Continuar.
    /// </summary>
    public Dictionary<string, long> RevisionesVistas { get; set; } = new();

    void ValidarNotch()
    {
        // Quien nunca tocó el vidrio (seguía en el 0.72 de antes) recibe el nuevo, más transparente.
        if (NotchVersion < 2 && Math.Abs(Transparencia - 0.72) < 1e-9) Transparencia = VidrioNotch.PorDefecto;
        NotchVersion = 2;
        Transparencia = VidrioNotch.Leer(Transparencia);
        NotchBorde = PosicionNotch.Nombre(PosicionNotch.LeerBorde(NotchBorde));
        NotchFraccion = PosicionNotch.LeerFraccion(NotchFraccion);
        NotchMonitor ??= "";
        if (NotchMonitor.Length > 64) NotchMonitor = "";
    }

    static string NuevoAparato() => "win-" + Guid.NewGuid().ToString("N")[..16];
    static bool AparatoValido(string? a) => a != null && System.Text.RegularExpressions.Regex.IsMatch(a, "^win-[0-9a-f]{16}$");

    static string Carpeta => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AuraWindows");
    static string Archivo => Path.Combine(Carpeta, "ajustes.bin");

    public static Ajustes Cargar()
    {
        try
        {
            if (!File.Exists(Archivo)) return new Ajustes();
            var bytes = ProtectedData.Unprotect(File.ReadAllBytes(Archivo), null, DataProtectionScope.CurrentUser);
            var a = JsonSerializer.Deserialize<Ajustes>(bytes) ?? new Ajustes();
            if (a.Avatar is not ("aura" or "claudio" or "antonio" or "ojos")) a.Avatar = "aura";
            if (a.Idioma is not ("es" or "en")) a.Idioma = "es";
            a.Conexiones ??= new();
            // Cuentas de versiones sin dueño: son de quien ya estaba dentro (sin sesión, de nadie: no se usan).
            a.DuenoCuentas = Core.DuenoCuentas.Migrar(a.DuenoCuentas, Core.DuenoCuentas.Identidad(a.Token, a.Correo));
            a.AppsSilenciadas ??= new();
            a.RevisionesVistas ??= new();
            if (a.Escucha is not ("pedir" or "palabra" or "siempre")) a.Escucha = a.PalabraActivacion ? "palabra" : "pedir";
            if (a.VozMotor is not ("agente" or "local")) a.VozMotor = "agente";
            a.ValidarNotch();
            if (!AparatoValido(a.Aparato)) a.Aparato = NuevoAparato();
            return a;
        }
        catch { return new Ajustes(); }
    }

    public void Guardar()
    {
        Directory.CreateDirectory(Carpeta);
        var bytes = ProtectedData.Protect(JsonSerializer.SerializeToUtf8Bytes(this), null, DataProtectionScope.CurrentUser);
        var tmp = Archivo + ".tmp";
        File.WriteAllBytes(tmp, bytes);
        File.Move(tmp, Archivo, true);
    }

    public string NombreAvatar => Avatar switch { "claudio" => "Claudio", "antonio" => "ANT-ONIO", "ojos" => Idioma == "en" ? "Guardian" : "Guardián", _ => "AU-RA" };
}
