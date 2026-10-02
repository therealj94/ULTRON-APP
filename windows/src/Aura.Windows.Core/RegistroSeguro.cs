using System.Text.RegularExpressions;

namespace Aura.Windows.Core;

/// <summary>
/// Lo que se puede escribir en el registro de diagnóstico (aura.log, texto plano en el disco). Por defecto
/// solo METADATOS: largos, tiempos, tipos («23 car.», «AbrirApp»). Lo que dijo la persona, los títulos de
/// órdenes o correos y los montos entran solo con «Registro detallado» (Ajustes → Privacidad, apagado de
/// fábrica). Y aun entonces, todo pasa por <see cref="Sanear"/>: correos, enlaces con parámetros, números
/// largos (tarjetas, teléfonos, cuentas) y lo que parezca una clave se tapan antes de escribir.
/// </summary>
public static class RegistroSeguro
{
    /// <summary>Lo más que se guarda de un texto con el registro detallado.</summary>
    public const int MaxDetalle = 140;

    static readonly Regex Secreto = new(@"(?i)(bearer\s+|token[""'=:\s]+|clave[""'=:\s]+|password[""'=:\s]+|contraseña[""'=:\s]+|pase=|llave[""'=:\s]+|secret[o]?[""'=:\s]+|api[_-]?key[""'=:\s]+|code=|state=)[^\s""'&,}]+", RegexOptions.Compiled);
    static readonly Regex Correo = new(@"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}", RegexOptions.Compiled);
    /// <summary>Un enlace: se queda el esquema, el servidor y la ruta; lo que va tras «?» o «#» (tokens, códigos) se tapa.</summary>
    static readonly Regex Enlace = new(@"(?i)\b((?:https?|wss?|ultronfp|webcals?)://[^\s?#""'<>]*)([?#][^\s""'<>]*)?", RegexOptions.Compiled);
    /// <summary>
    /// 7 o más cifras seguidas (con espacios, guiones o puntos entre medio): tarjeta, teléfono, cuenta. Una
    /// duración («1945411 ms») no es un dato personal: se deja, para que la métrica rara se vea.
    /// </summary>
    static readonly Regex Numeros = new(@"(?<![\w])\+?\d(?:[\s.\-]?\d){6,}(?![\w])(?!\s*ms\b)", RegexOptions.Compiled);
    /// <summary>Un token largo sin espacios (JWT, claves de API): 32+ letras/cifras seguidas.</summary>
    static readonly Regex Largo = new(@"\b[A-Za-z0-9_\-]{32,}(?:\.[A-Za-z0-9_\-]{8,}){0,2}\b", RegexOptions.Compiled);
    /// <summary>La carpeta del usuario de Windows («C:\Users\jordo\…»): se deja como %USERPROFILE%.</summary>
    static readonly Regex Perfil = new(@"(?i)\b[A-Z]:\\Users\\[^\\\s""']+", RegexOptions.Compiled);

    /// <summary>Tapa lo que nunca debe quedar en el disco en claro. Se aplica a TODA línea del registro.</summary>
    public static string Sanear(string? texto)
    {
        if (string.IsNullOrEmpty(texto)) return "";
        var t = Perfil.Replace(texto, "%USERPROFILE%");
        t = Secreto.Replace(t, m => m.Groups[1].Value + "•••");
        t = Enlace.Replace(t, m => m.Groups[1].Value + (m.Groups[2].Success ? "?•••" : ""));
        t = Correo.Replace(t, "«correo»");
        t = Largo.Replace(t, "«clave»");
        t = Numeros.Replace(t, "«número»");
        // Una línea por evento: los saltos de línea no parten el registro (ni falsean otra línea).
        return t.Replace('\r', ' ').Replace('\n', ' ');
    }

    /// <summary>
    /// Un texto de la persona (lo que dijo, una orden, un título) para el registro: por defecto solo su largo;
    /// con <paramref name="detallado"/>, el texto saneado y recortado.
    /// </summary>
    public static string Contenido(string? texto, bool detallado)
    {
        texto ??= "";
        if (!detallado) return $"{texto.Length} car.";
        var s = Sanear(texto);
        return "«" + (s.Length > MaxDetalle ? s[..MaxDetalle] + "…" : s) + "»";
    }
}
