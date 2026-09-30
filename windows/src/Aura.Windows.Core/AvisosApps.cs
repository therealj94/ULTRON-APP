using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace Aura.Windows.Core;

/// <summary>Una notificación de otra app (WhatsApp, Teams, Outlook, Chrome…), ya leída.</summary>
public sealed record AvisoApp(long Id, string Aumid, string App, string Titulo, string Cuerpo, string Sitio, DateTimeOffset Llegada);

/// <summary>
/// Las notificaciones de las demás apps, como las muestra Windows. Cada una llega como un «toast» en
/// XML (&lt;toast&gt;&lt;visual&gt;&lt;binding&gt;&lt;text&gt;…) con el id de la app que la mandó (AUMID). Aquí se
/// entiende el XML y se le pone nombre a la app; leerlas del equipo lo hace el .exe.
/// </summary>
public static class AvisosApps
{
    /// <summary>El toast → título, cuerpo y sitio (en las notificaciones web: «web.whatsapp.com»). Null si no trae texto.</summary>
    public static AvisoApp? Leer(long id, string aumid, string xml, long llegadaFileTime)
    {
        XDocument doc;
        try { doc = XDocument.Parse(xml.Trim('\0', ' ', '\r', '\n', '﻿')); }
        catch (System.Xml.XmlException) { return null; }
        var raiz = doc.Root;
        if (raiz == null || !raiz.Name.LocalName.Equals("toast", StringComparison.OrdinalIgnoreCase)) return null;
        // El primer binding (ToastGeneric o ToastText02…): sus <text> en orden; el de «attribution» es el sitio.
        var binding = raiz.Descendants().FirstOrDefault(e => e.Name.LocalName == "binding");
        if (binding == null) return null;
        var textos = binding.Elements().Where(e => e.Name.LocalName == "text").ToList();
        var sitio = Limpio(textos.FirstOrDefault(t => (string?)t.Attribute("placement") == "attribution")?.Value);
        var lineas = textos.Where(t => (string?)t.Attribute("placement") != "attribution")
                           .Select(t => Limpio(t.Value)).Where(t => t.Length > 0).ToList();
        if (lineas.Count == 0) return null;
        var titulo = lineas[0];
        var cuerpo = string.Join(" · ", lineas.Skip(1));
        if (cuerpo.Length > 400) cuerpo = cuerpo[..400] + "…";
        var cuando = llegadaFileTime > 0 ? DateTimeOffset.FromFileTime(llegadaFileTime) : DateTimeOffset.Now;
        return new AvisoApp(id, aumid, NombreApp(aumid), titulo.Length > 160 ? titulo[..160] + "…" : titulo, cuerpo, sitio, cuando);
    }

    static string Limpio(string? t) => Regex.Replace(t ?? "", @"\s+", " ").Trim();

    static readonly (string Clave, string Nombre)[] Conocidas =
    {
        ("whatsapp", "WhatsApp"), ("teams", "Teams"), ("outlook", "Outlook"), ("telegram", "Telegram"), ("slack", "Slack"),
        ("discord", "Discord"), ("signal", "Signal"), ("messenger", "Messenger"), ("instagram", "Instagram"), ("skype", "Skype"),
        ("zoom", "Zoom"), ("spotify", "Spotify"), ("msedge", "Edge"), ("chrome", "Chrome"), ("firefox", "Firefox"), ("brave", "Brave"),
        ("opera", "Opera"), ("windowscommunicationsapps", "Correo"), ("windowscalendar", "Calendario"), ("securityhealth", "Seguridad de Windows"),
        ("windows.defender", "Seguridad de Windows"), ("immersivecontrolpanel", "Configuración"), ("windows.systemtoast", "Windows"),
        ("yourphone", "Enlace Móvil"), ("phonelink", "Enlace Móvil"), ("onedrive", "OneDrive"), ("steam", "Steam"), ("notion", "Notion"),
        ("gmail", "Gmail"), ("linkedin", "LinkedIn"), ("facebook", "Facebook"),
    };

    /// <summary>
    /// «5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App» → «WhatsApp»; «Microsoft.Office.OUTLOOK.EXE.15» → «Outlook»;
    /// uno desconocido → la parte con nombre («Contoso.Ventas_abc!App» → «Ventas»).
    /// </summary>
    public static string NombreApp(string aumid)
    {
        var a = aumid.ToLowerInvariant();
        foreach (var (clave, nombre) in Conocidas) if (a.Contains(clave)) return nombre;
        var s = aumid.Split('!')[0].Split('_')[0];
        s = s.Replace('\\', '.').Replace('/', '.');
        var partes = s.Split('.', StringSplitOptions.RemoveEmptyEntries)
                      .Where(p => !Regex.IsMatch(p, @"^(?:exe|app|microsoft|windows|com|[0-9a-f]{6,}|[0-9]+|\{.*\})$", RegexOptions.IgnoreCase)).ToList();
        var n = partes.LastOrDefault() ?? "App";
        n = Regex.Replace(n, @"(?:Desktop|App|Win(?:dows)?)$", "", RegexOptions.IgnoreCase);
        return n.Length == 0 ? "App" : char.ToUpperInvariant(n[0]) + n[1..];
    }

    /// <summary>AURA no se avisa a sí misma.</summary>
    public static bool EsPropia(string aumid) => aumid.Contains("Aura.Windows", StringComparison.OrdinalIgnoreCase) || aumid.Contains("AURA", StringComparison.Ordinal);

    /// <summary>Cómo se dice: «WhatsApp: Karla, ¿vienes a la junta?».</summary>
    public static string Decir(AvisoApp a) => $"{a.App}: {a.Titulo}{(a.Cuerpo.Length > 0 ? ", " + a.Cuerpo : "")}";
}
