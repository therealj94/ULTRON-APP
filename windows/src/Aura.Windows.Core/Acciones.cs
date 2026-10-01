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

    /// <summary>«hacer: cierra spotify» → «cierra spotify». Solo órdenes cortas, de una línea.</summary>
    static string? Orden(string marca)
    {
        var m = Regex.Match(marca.Trim(), @"^(?:hacer|do)\s*:\s*(?<o>[^\r\n]{2,160})$", RegexOptions.IgnoreCase);
        return m.Success ? m.Groups["o"].Value.Trim().TrimEnd('.', '!') : null;
    }
}
