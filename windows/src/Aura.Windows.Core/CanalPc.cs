using System.Text;
using System.Text.Json;

namespace Aura.Windows.Core;

/// <summary>Una orden del cerebro para las manos de esta PC, con la frase de la persona (para la guarda).</summary>
public sealed record OrdenPc(string Id, string Orden, string Dicho);

/// <summary>
/// El canal de AURA (/api/app/acciones, SSE) visto desde Windows: de todo lo que pasa por ahí solo
/// importa `event: pc`, las órdenes que el cerebro pidió en la conversación por voz (server/voz-agente.ts).
/// Las acciones del teléfono (sin `event:`) y los latidos (`: latido`) se ignoran.
/// </summary>
public static class CanalPc
{
    /// <summary>Lee el SSE hasta que se corte; cada orden de la PC va a <paramref name="alOrden"/>.</summary>
    public static async Task Leer(TextReader r, Action<OrdenPc> alOrden, CancellationToken ct)
    {
        string evento = "";
        var datos = new StringBuilder();
        while (!ct.IsCancellationRequested)
        {
            var linea = await r.ReadLineAsync(ct).ConfigureAwait(false);
            if (linea == null) return;
            if (linea.Length == 0)
            {
                if (evento == "pc" && Orden(datos.ToString()) is { } o) alOrden(o);
                evento = ""; datos.Clear();
                continue;
            }
            if (linea[0] == ':') continue;
            var i = linea.IndexOf(':');
            var campo = i < 0 ? linea : linea[..i];
            var valor = i < 0 ? "" : linea[(i + 1)..].TrimStart(' ');
            if (campo == "event") evento = valor;
            else if (campo == "data") { if (datos.Length > 0) datos.Append('\n'); datos.Append(valor); }
        }
    }

    /// <summary>El JSON de una orden ({ id, orden, dicho }), o null si no tiene forma.</summary>
    public static OrdenPc? Orden(string json)
    {
        try
        {
            using var d = JsonDocument.Parse(json);
            var r = d.RootElement;
            string S(string k) => r.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";
            var orden = S("orden").Trim();
            return orden.Length is >= 2 and <= 160 ? new OrdenPc(S("id"), orden, S("dicho")) : null;
        }
        catch (JsonException) { return null; }
    }
}

/// <summary>
/// Lo que AURA ya hizo hace un momento con las manos. En la conversación por voz la frase se entiende
/// dos veces: las reglas de la PC la hacen al instante y el cerebro, que también la oyó, pide lo mismo
/// con «⟦hacer⟧» un segundo después. La segunda no se hace (ni se repite un id ya visto).
/// </summary>
public sealed class HechasRecientes
{
    readonly TimeProvider reloj;
    readonly List<(string Firma, DateTimeOffset Cuando)> hechas = new();
    readonly HashSet<string> ids = new();
    public TimeSpan Ventana { get; init; } = TimeSpan.FromSeconds(15);

    public HechasRecientes(TimeProvider? reloj = null) => this.reloj = reloj ?? TimeProvider.System;

    static string Firma(Pedido p) => p.Mano + "|" + LayaLigera.Normalizar(p.Valor);

    public void Anotar(Pedido p)
    {
        Limpiar();
        if (p.Mano != Mano.Ninguna) hechas.Add((Firma(p), reloj.GetUtcNow()));
    }

    /// <summary>¿Ya se hizo esto hace un momento? (o esa orden ya llegó)</summary>
    public bool Repetida(Pedido p, string? id = null)
    {
        Limpiar();
        if (!string.IsNullOrEmpty(id) && !ids.Add(id)) return true;
        var f = Firma(p);
        return hechas.Any(h => h.Firma == f);
    }

    void Limpiar()
    {
        var ahora = reloj.GetUtcNow();
        hechas.RemoveAll(h => ahora - h.Cuando > Ventana);
        if (ids.Count > 200) ids.Clear();
    }
}
