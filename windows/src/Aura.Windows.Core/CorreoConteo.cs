using System.Collections.Concurrent;

namespace Aura.Windows.Core;

/// <summary>
/// Qué correos son NUEVOS en cada revisión de un buzón (auditoría del 1-oct, H10). Uno por cuenta, y
/// sobrevive a que el buzón se vuelva a crear (reconectar, cambiar un ajuste, una caída de red): lo que
/// llegó mientras tanto se anuncia al volver, agrupado, en vez de perderse o repetirse.
///  · La primera revisión de una cuenta no anuncia nada (lo que ya estaba al arrancar no es «nuevo»).
///  · Si la revisión vino LLENA (tantas como se pidieron) y TODAS son nuevas, puede haber más sin ver:
///    se dice «al menos N», nunca un total inventado.
/// </summary>
public sealed class CursorCorreo
{
    static readonly ConcurrentDictionary<string, CursorCorreo> porCuenta = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>El cursor de esa cuenta (proveedor + dirección), el mismo cada vez.</summary>
    public static CursorCorreo De(string cuenta) => porCuenta.GetOrAdd(cuenta ?? "", _ => new CursorCorreo());

    /// <summary>Olvida todos los cursores (al cerrar la sesión de AURA).</summary>
    public static void OlvidarTodos() => porCuenta.Clear();

    readonly object candado = new();
    readonly HashSet<string> vistos = new();
    bool primera = true;

    public sealed record Revision(IReadOnlyList<Carta> Nuevas, bool AlMenos);

    /// <param name="cartas">Lo que devolvió el buzón (lo más nuevo primero, como mucho <paramref name="pedidas"/>).</param>
    public Revision Revisar(IReadOnlyList<Carta> cartas, int pedidas)
    {
        lock (candado)
        {
            var nuevas = cartas.Where(c => vistos.Add(c.Id)).OrderBy(c => c.Fecha).ToList();
            if (primera) { primera = false; return new Revision(Array.Empty<Carta>(), false); }
            bool alMenos = cartas.Count >= pedidas && nuevas.Count == cartas.Count && nuevas.Count > 0;
            if (vistos.Count > 2000) { vistos.Clear(); foreach (var c in cartas) vistos.Add(c.Id); }
            return new Revision(nuevas, alMenos);
        }
    }

    /// <summary>Los ids cambiaron de sentido (IMAP renumeró la bandeja): se vuelve a tomar la foto sin anunciar.</summary>
    public void Reiniciar() { lock (candado) { vistos.Clear(); primera = true; } }
}

/// <summary>Cómo se dice cuántos correos hay, sin prometer un total que no se contó.</summary>
public static class ConteoCorreo
{
    /// <summary>¿La lista pudo quedar cortada por el tope pedido?</summary>
    public static bool Tope(int recibidas, int pedidas) => recibidas >= pedidas && pedidas > 0;

    /// <summary>«7», «al menos 50» / «at least 50».</summary>
    public static string Cantidad(int n, bool alMenos, bool ingles) =>
        alMenos ? (ingles ? $"at least {n}" : $"al menos {n}") : n.ToString(System.Globalization.CultureInfo.InvariantCulture);

    /// <summary>El título corto del notch: «7 sin leer», «50+ sin leer».</summary>
    public static string Titulo(int n, bool alMenos, bool ingles) => $"{n}{(alMenos ? "+" : "")} {(ingles ? "unread" : "sin leer")}";

    /// <summary>
    /// El aviso de lo nuevo: uno solo aunque lleguen 25 juntos. Con uno, de quién y el asunto; con varios,
    /// cuántos (o «al menos» cuántos) y de quiénes.
    /// </summary>
    public static (string Titulo, string Cuerpo) Aviso(IReadOnlyList<Carta> nuevas, bool alMenos, bool ingles)
    {
        if (nuevas.Count == 0) return ("", "");
        if (nuevas.Count == 1 && !alMenos) return ((ingles ? "Email from " : "Correo de ") + nuevas[0].De, nuevas[0].Asunto);
        var quienes = nuevas.OrderByDescending(c => c.Fecha).Select(c => c.De).Where(d => d.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var lista = string.Join(", ", quienes.Take(3)) + (quienes.Count > 3 ? (ingles ? " and others" : " y más") : "");
        var n = nuevas.Count;
        var titulo = ingles ? (alMenos ? $"At least {n} new emails" : $"{n} new emails") : (alMenos ? $"Al menos {n} correos nuevos" : $"{n} correos nuevos");
        return (titulo, (ingles ? "From " : "De ") + lista);
    }
}
