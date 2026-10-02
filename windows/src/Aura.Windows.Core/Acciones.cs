using System;
using System.Collections.Generic;
using System.Text;
using System.Text.RegularExpressions;

namespace Aura.Windows.Core;

/// <summary>
/// Las manos que pide el cerebro. En Windows el cerebro sabe que AURA tiene manos en la PC: cuando la
/// persona pide algo con palabras que las reglas no reconocen («cierra eso de Spotify»), el cerebro
/// contesta corto y agrega una línea «⟦hacer: cierra spotify⟧» con la orden en palabras simples. Este
/// filtro la quita del texto (no se ve ni se dice) mientras llega por trozos y la entrega completa para
/// que las reglas la ejecuten al instante.
/// </summary>
public sealed class FiltroAcciones
{
    const char Abre = '⟦', Cierra = '⟧';
    readonly StringBuilder dentro = new();
    bool abierto;
    public List<string> Ordenes { get; } = new();

    /// <summary>Devuelve la parte del trozo que se puede mostrar y decir; las órdenes completas quedan en <see cref="Ordenes"/>.</summary>
    public string Agregar(string trozo, Action<string>? alCompletar = null)
    {
        var visible = new StringBuilder();
        foreach (var c in trozo)
        {
            if (!abierto)
            {
                if (c == Abre) { abierto = true; dentro.Clear(); }
                else visible.Append(c);
                continue;
            }
            if (c == Cierra)
            {
                abierto = false;
                if (Orden(dentro.ToString()) is { } o) { Ordenes.Add(o); alCompletar?.Invoke(o); }
                dentro.Clear();
            }
            else if (dentro.Length < 300) dentro.Append(c);
        }
        return visible.ToString();
    }

    /// <summary>El texto sin ninguna marca (para el texto final del turno).</summary>
    public static string Quitar(string texto) => Regex.Replace(texto ?? "", @"⟦[^⟧]*⟧?", "").Replace("  ", " ").Trim();

    /// <summary>
    /// ¿La orden del cerebro sale de lo que dijo la persona? Ya no por parecido de palabras: por autorización
    /// tipada (<see cref="AutorizarOrden"/>), la misma clase de acción y el mismo objetivo. Verdadero también
    /// cuando la orden pasaría solo con el «sí».
    /// </summary>
    public static bool Coherente(string orden, string dicho) => AutorizarOrden.Autorizar(orden, dicho) != Veredicto.Rechazar;

    /// <summary>
    /// La misma palabra mal oída o mal escrita: «exel» y «excel», «spotifai» y «spotify». El cerebro corrige lo que
    /// el micrófono entendió mal, y eso no es «traer algo que no dijiste». Una letra de diferencia (dos en palabras
    /// largas), y solo con palabras de cuatro letras o más: «word» y «ward» sí, «rock» y «pop» no.
    /// </summary>
    public static bool Parecidas(string a, string b)
    {
        if (a.Length < 4 || b.Length < 4) return false;
        int tope = Math.Max(a.Length, b.Length) >= 7 ? 2 : 1;
        if (Math.Abs(a.Length - b.Length) > tope) return false;
        var previo = new int[b.Length + 1];
        var actual = new int[b.Length + 1];
        for (int j = 0; j <= b.Length; j++) previo[j] = j;
        for (int i = 1; i <= a.Length; i++)
        {
            actual[0] = i;
            int menor = actual[0];
            for (int j = 1; j <= b.Length; j++)
            {
                actual[j] = Math.Min(Math.Min(actual[j - 1] + 1, previo[j] + 1), previo[j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1));
                menor = Math.Min(menor, actual[j]);
            }
            if (menor > tope) return false;
            (previo, actual) = (actual, previo);
        }
        return previo[b.Length] <= tope;
    }

    /// <summary>«hacer: cierra spotify» → «cierra spotify». Solo órdenes cortas, de una línea.</summary>
    static string? Orden(string marca)
    {
        var m = Regex.Match(marca.Trim(), @"^(?:hacer|do)\s*:\s*(?<o>[^\r\n]{2,160})$", RegexOptions.IgnoreCase);
        return m.Success ? m.Groups["o"].Value.Trim().TrimEnd('.', '!') : null;
    }
}
