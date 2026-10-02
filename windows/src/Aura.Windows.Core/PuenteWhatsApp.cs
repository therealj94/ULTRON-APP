using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace Aura.Windows.Core;

/// <summary>
/// Las reglas del WhatsApp personal en el Centro (puras y probables): qué chat, qué texto, qué número y qué
/// rutas de /api/whatsapp/* puede pedir la página por el puente. El servidor (server/whatsapp.ts) vuelve a
/// mirar todo y solo atiende a la cuenta dueña (WHATSAPP_DUENOS); aquí se corta antes lo que no tiene forma,
/// para que la página no pueda usar el puente como un cliente HTTP libre contra AU-RA.
/// </summary>
public static class PuenteWhatsApp
{
    /// <summary>Lo mismo que acepta el servidor: un mensaje de hasta 4000 letras.</summary>
    public const int TextoMax = 4000;

    /// <summary>Una foto, un audio o un documento en grande: hasta 8 MB (viaja en base64 por el puente).</summary>
    public const long MediaMax = 8L * 1024 * 1024;

    /// <summary>Las rutas de WhatsApp que existen (sin «api/whatsapp/» ni la consulta). Nada más pasa.</summary>
    public static readonly HashSet<string> Rutas = new(StringComparer.Ordinal)
    {
        "estado", "vincular", "desvincular", "chats", "mensajes", "enviar", "leido", "media",
    };

    // Un JID de WhatsApp: «50499998888@s.whatsapp.net», «120363…@g.us», «1234…@lid». Sin espacios, sin «/», sin «?».
    static readonly Regex Jid = new(@"^[0-9A-Za-z._:+-]{1,100}@[a-z0-9.-]{1,40}\z", RegexOptions.CultureInvariant);
    // El id de un mensaje (los de WhatsApp son hexadecimales; los del puente pueden traer «_» o «-»).
    static readonly Regex IdMensaje = new(@"^[A-Za-z0-9_.:-]{1,128}\z", RegexOptions.CultureInvariant);

    /// <summary>El chat pedido, o un error con su texto para la persona.</summary>
    public static string Chat(string? jid)
    {
        var j = (jid ?? "").Trim();
        if (j.Length == 0) throw new InvalidOperationException("Falta el chat.");
        if (!Jid.IsMatch(j)) throw new InvalidOperationException("Ese chat no es de WhatsApp.");
        return j;
    }

    /// <summary>El texto a enviar: con algo escrito y no más de 4000 letras (no se recorta: se avisa).</summary>
    public static string Texto(string? texto)
    {
        var t = texto ?? "";
        if (t.Trim().Length == 0) throw new InvalidOperationException("Escribe algo para enviar.");
        if (t.Length > TextoMax) throw new InvalidOperationException("El mensaje es muy largo (máximo 4000 letras).");
        return t;
    }

    /// <summary>El id de un mensaje con foto, audio o documento.</summary>
    public static string Mensaje(string? id)
    {
        var i = (id ?? "").Trim();
        if (!IdMensaje.IsMatch(i)) throw new InvalidOperationException("Ese mensaje no existe.");
        return i;
    }

    /// <summary>
    /// El número para «Vincular con número»: solo cifras, con el código de país (Honduras 504…). Vacío = QR (null).
    /// Ocho cifras solas son un número de Honduras: se le pone el 504 (la página ya lo hace; aquí por si acaso).
    /// </summary>
    public static string? Telefono(string? telefono)
    {
        var s = telefono ?? "";
        var cifras = new System.Text.StringBuilder();
        foreach (var c in s) if (c is >= '0' and <= '9') cifras.Append(c);
        if (cifras.Length == 0) return null;
        var n = cifras.ToString();
        if (n.Length == 8) n = "504" + n;
        if (n.Length is < 10 or > 15) throw new InvalidOperationException("Escribe el número con el código de país (Honduras: 504 y tus 8 cifras).");
        return n;
    }

    /// <summary>«api/whatsapp/chats», con la búsqueda (hasta 60 letras) si la hay.</summary>
    public static string RutaChats(string? buscar)
    {
        var q = (buscar ?? "").Trim();
        if (q.Length > 60) q = q[..60];
        return q.Length == 0 ? "api/whatsapp/chats" : "api/whatsapp/chats?buscar=" + Uri.EscapeDataString(q);
    }

    /// <summary>«api/whatsapp/mensajes?chat=…» y, para cargar lo de antes, «&amp;antes=ms».</summary>
    public static string RutaMensajes(string chat, long antes)
    {
        var r = "api/whatsapp/mensajes?chat=" + Uri.EscapeDataString(Chat(chat));
        return antes > 0 ? r + "&antes=" + antes.ToString(System.Globalization.CultureInfo.InvariantCulture) : r;
    }

    /// <summary>«api/whatsapp/media?chat=…&amp;id=…».</summary>
    public static string RutaMedia(string chat, string id) =>
        "api/whatsapp/media?chat=" + Uri.EscapeDataString(Chat(chat)) + "&id=" + Uri.EscapeDataString(Mensaje(id));

    /// <summary>¿Es una ruta de WhatsApp de la lista? («api/whatsapp/&lt;ruta&gt;» con o sin consulta; nunca otra cosa).</summary>
    public static bool RutaValida(string? ruta)
    {
        const string Prefijo = "api/whatsapp/";
        if (string.IsNullOrEmpty(ruta) || ruta.Length > 600 || !ruta.StartsWith(Prefijo, StringComparison.Ordinal)) return false;
        foreach (var c in ruta) if (char.IsWhiteSpace(c) || char.IsControl(c) || c is '\\' or '#') return false;
        var resto = ruta[Prefijo.Length..];
        var q = resto.IndexOf('?');
        var nombre = q < 0 ? resto : resto[..q];
        return Rutas.Contains(nombre);
    }
}
