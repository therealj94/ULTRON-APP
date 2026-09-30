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
    /// <summary>
    /// Cuentas conectadas con OAuth («spotify», «google», «microsoft»): el token de acceso y el de
    /// renovar, cifrados con DPAPI como todo lo demás. Nunca salen de este equipo.
    /// </summary>
    public Dictionary<string, TokenOauth> Conexiones { get; set; } = new();
    /// <summary>Client ID propios (opcional): si están, ganan a los que da el servidor AU-RA.</summary>
    public string SpotifyClientId { get; set; } = "";
    public string GoogleClientId { get; set; } = "";
    public string GoogleClientSecret { get; set; } = "";
    public string MicrosoftClientId { get; set; } = "";
    public List<Recordatorio> Recordatorios { get; set; } = new();

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
