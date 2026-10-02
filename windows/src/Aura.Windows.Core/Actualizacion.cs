namespace Aura.Windows.Core;

/// <summary>
/// Las reglas de la actualización por el aire (auditoría del 1-oct, H07), sin red ni disco para poder probarlas:
///  · solo es «nueva» una versión ESTRICTAMENTE mayor que la que corre (2.0.120 &gt; 2.0.119): nunca se
///    instala una igual ni una anterior aunque la ficha lo pida (sin retrocesos);
///  · la instalación sola espera mientras haya algo en curso: voz, acciones, un borrador sin guardar o una
///    llamada de PULSE2CHAT.
/// </summary>
public static class Actualizacion
{
    /// <summary>«2.0.123», «2.0.123.0» o «v2.0.123+abc» → la versión; null si no se entiende.</summary>
    public static Version? Leer(string? texto)
    {
        if (string.IsNullOrWhiteSpace(texto)) return null;
        var t = texto.Trim().TrimStart('v', 'V');
        var corte = t.IndexOfAny(new[] { '+', '-', ' ' });
        if (corte >= 0) t = t[..corte];
        if (!Version.TryParse(t, out var v)) return null;
        // Lo que falta cuenta como 0 (2.0.5 == 2.0.5.0): Version da -1 en las partes ausentes.
        return new Version(v.Major, v.Minor, Math.Max(0, v.Build), Math.Max(0, v.Revision));
    }

    /// <summary>¿La versión publicada es más nueva que la mía? Si alguna no se entiende, no (no se arriesga).</summary>
    public static bool EsMasNueva(string? publicada, string? mia)
    {
        var p = Leer(publicada); var m = Leer(mia);
        return p != null && m != null && p > m;
    }

    /// <summary>Lo que está pasando en AURA cuando toca instalar sola.</summary>
    public sealed record Actividad(
        bool Voz = false,
        bool Acciones = false,
        bool BorradorSinGuardar = false,
        bool Llamada = false,
        bool Confirmacion = false,
        TimeSpan Inactivo = default);

    /// <summary>Lo que se pide sin usar la PC antes de instalar sola.</summary>
    public static readonly TimeSpan InactividadMinima = TimeSpan.FromMinutes(10);

    /// <summary>Por qué la instalación sola espera (null: puede instalar ya).</summary>
    public static string? MotivoParaEsperar(Actividad a)
    {
        if (a.Llamada) return "hay una llamada";
        if (a.Voz) return "hay una conversación de voz";
        if (a.Acciones) return "hay acciones en curso";
        if (a.Confirmacion) return "hay algo esperando tu «sí»";
        if (a.BorradorSinGuardar) return "hay un borrador sin guardar";
        if (a.Inactivo < InactividadMinima) return "estás usando la PC";
        return null;
    }
}
