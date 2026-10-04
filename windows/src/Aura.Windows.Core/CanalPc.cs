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
    /// <summary>Lee el SSE hasta que se corte; cada orden de la PC va a <paramref name="alOrden"/>. <paramref name="alLinea"/>: llegó algo (latido incluido).</summary>
    public static async Task Leer(TextReader r, Action<OrdenPc> alOrden, CancellationToken ct, Action? alLinea = null)
    {
        string evento = "";
        var datos = new StringBuilder();
        while (!ct.IsCancellationRequested)
        {
            var linea = await r.ReadLineAsync(ct).ConfigureAwait(false);
            if (linea == null) return;
            alLinea?.Invoke();
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
/// Las frases con las que las reglas de la PC ya actuaron. En la conversación por voz la frase se entiende
/// dos veces: las reglas la hacen al instante y el cerebro, que también la oyó, pide lo mismo con
/// «⟦hacer⟧» unos segundos después (con la frase dicha adjunta). Esa orden no se hace otra vez. Si dices
/// otra cosa parecida («sube el volumen» y luego «súbele más»), es otra frase y sí se hace. Un id de orden
/// que ya llegó tampoco se repite.
/// </summary>
public sealed class HechasRecientes
{
    readonly TimeProvider reloj;
    readonly List<(string Frase, DateTimeOffset Cuando)> hechas = new();
    readonly HashSet<string> ids = new();
    public TimeSpan Ventana { get; init; } = TimeSpan.FromSeconds(60);

    public HechasRecientes(TimeProvider? reloj = null) => this.reloj = reloj ?? TimeProvider.System;

    /// <summary>Las reglas hicieron algo con esta frase de la persona.</summary>
    public void Anotar(string dicho)
    {
        Limpiar();
        var f = LayaLigera.Normalizar(dicho);
        if (f.Length > 0) hechas.Add((f, reloj.GetUtcNow()));
    }

    /// <summary>
    /// Lo que las reglas intentaron con esa frase NO salió: se olvida, para que la orden del cerebro (que a veces
    /// entendió mejor: «abre exel» → «abre excel») sí se haga. Antes se anotaba antes de hacerla y el segundo
    /// intento se descartaba como «ya hecha».
    /// </summary>
    public void Olvidar(string dicho)
    {
        var f = LayaLigera.Normalizar(dicho);
        if (f.Length > 0) hechas.RemoveAll(h => h.Frase == f);
    }

    /// <summary>¿Esta orden del cerebro viene de una frase que las reglas ya hicieron (o su id ya llegó)?</summary>
    public bool Repetida(string? id, string dicho)
    {
        Limpiar();
        if (!string.IsNullOrEmpty(id) && !ids.Add(id)) return true;
        var f = LayaLigera.Normalizar(dicho);
        return f.Length > 0 && hechas.Any(h => h.Frase == f);
    }

    void Limpiar()
    {
        var ahora = reloj.GetUtcNow();
        hechas.RemoveAll(h => ahora - h.Cuando > Ventana);
        if (ids.Count > 200) ids.Clear();
    }
}
