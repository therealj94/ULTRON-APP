using System.Diagnostics;
using System.Globalization;
using System.Text;

namespace Aura.Windows.Core;

/// <summary>Las etapas de un turno de voz, en el orden en que deberían pasar.</summary>
public enum EtapaVoz
{
    /// <summary>El oído cerró tu frase (después del silencio final del detector) y la manda a transcribir.</summary>
    FinCaptura,
    /// <summary>Llegó la transcripción (del servidor o de Windows).</summary>
    SttRecibido,
    /// <summary>Se decidió qué hacer (reglas, Laya ligera, Laya del nodo).</summary>
    Intencion,
    /// <summary>Llegó el primer texto útil del cerebro.</summary>
    PrimerTexto,
    /// <summary>Llegó el audio del relleno («A ver…»): NO cuenta como respuesta.</summary>
    RellenoTts,
    /// <summary>Empezó a sonar el relleno.</summary>
    RellenoSuena,
    /// <summary>Llegó el audio TTS de la primera frase útil.</summary>
    TtsRecibido,
    /// <summary>El dispositivo empezó de verdad a reproducir la primera frase útil.</summary>
    InicioReproduccion,
}

/// <summary>
/// Un turno de voz medido (auditoría del 1-oct, H08): id único, SU PROPIO reloj monotónico (nunca uno
/// reutilizado), cada etapa una sola vez y relativa al origen, y un cierre explícito (ok, cancelado, fallo,
/// silencio…). En el registro solo van números: nunca lo que se dijo.
/// </summary>
public sealed class TurnoVoz
{
    /// <summary>Más que esto entre origen y cierre no es una latencia interpretable: se marca, no se borra.</summary>
    public static readonly TimeSpan MaximoCreible = TimeSpan.FromSeconds(60);

    readonly Func<long> reloj;
    readonly long origen;
    readonly Dictionary<EtapaVoz, long> etapas = new();
    readonly List<string> anomalias = new();

    public long Id { get; }
    /// <summary>«frases» (el oído de siempre), «vivo» (el agente de ElevenLabs) o «texto» (escrito).</summary>
    public string Ruta { get; }
    /// <summary>Desde dónde se cuenta (dicho tal cual en el registro: «fin de captura», «transcripción»…).</summary>
    public string Desde { get; }
    public string? Final { get; private set; }
    public bool Cerrado => Final != null;

    internal TurnoVoz(long id, string ruta, string desde, Func<long> reloj, long? origen = null)
    {
        Id = id; Ruta = ruta; Desde = desde; this.reloj = reloj;
        this.origen = origen ?? reloj();
    }

    static double Ms(long ticks) => ticks * 1000.0 / Stopwatch.Frequency;

    /// <summary>Anota una etapa (la primera vez cuenta; las siguientes se ignoran). <paramref name="cuando"/>: Stopwatch.GetTimestamp() del momento real.</summary>
    public bool Marcar(EtapaVoz etapa, long? cuando = null)
    {
        if (Cerrado || etapas.ContainsKey(etapa)) return false;
        var t = (cuando ?? reloj()) - origen;
        if (t < 0) { anomalias.Add($"{Nombre(etapa)} antes del origen"); t = 0; }
        etapas[etapa] = t;
        return true;
    }

    public double? MsDe(EtapaVoz etapa) => etapas.TryGetValue(etapa, out var t) ? Ms(t) : null;

    /// <summary>Cierra el turno y devuelve la línea del registro (solo números). Cerrar dos veces no hace nada (null).</summary>
    public string? Cerrar(string final, long? cuando = null)
    {
        if (Cerrado) return null;
        Final = final;
        var total = (cuando ?? reloj()) - origen;
        if (Ms(total) > MaximoCreible.TotalMilliseconds) anomalias.Add($"total > {MaximoCreible.TotalSeconds:0} s: no interpretable como latencia");
        // Fuera de orden (p. ej. «suena» antes de «llegó el audio»): el reloj de alguien está mal.
        long previo = -1; EtapaVoz? anterior = null;
        foreach (var e in Enum.GetValues<EtapaVoz>())
        {
            if (!etapas.TryGetValue(e, out var t)) continue;
            if (e is EtapaVoz.RellenoTts or EtapaVoz.RellenoSuena) continue; // el relleno va por su lado
            if (t < previo && anterior != null) anomalias.Add($"{Nombre(e)} antes que {Nombre(anterior.Value)}");
            previo = t; anterior = e;
        }
        if (final == "ok" && Ruta != "texto" && !etapas.ContainsKey(EtapaVoz.InicioReproduccion)) anomalias.Add("ok sin reproducción");
        return Linea(total);
    }

    string Linea(long total)
    {
        var c = CultureInfo.InvariantCulture;
        var sb = new StringBuilder();
        sb.Append(c, $"turno {Id} · {Ruta} · {Final} · desde {Desde}");
        foreach (var e in Enum.GetValues<EtapaVoz>())
            if (etapas.TryGetValue(e, out var t)) sb.Append(c, $" · {Nombre(e)} {Ms(t):0} ms");
        sb.Append(c, $" · total {Ms(total):0} ms");
        if (anomalias.Count > 0) sb.Append(" · ANOMALÍA: ").Append(string.Join("; ", anomalias));
        return sb.ToString();
    }

    public IReadOnlyList<string> Anomalias => anomalias;

    public static string Nombre(EtapaVoz e) => e switch
    {
        EtapaVoz.FinCaptura => "fin-captura",
        EtapaVoz.SttRecibido => "stt",
        EtapaVoz.Intencion => "intención",
        EtapaVoz.PrimerTexto => "primer-texto",
        EtapaVoz.RellenoTts => "relleno-tts",
        EtapaVoz.RellenoSuena => "relleno-suena",
        EtapaVoz.TtsRecibido => "tts-recibido",
        EtapaVoz.InicioReproduccion => "reproducción",
        _ => e.ToString(),
    };
}

/// <summary>
/// Lleva el turno abierto. Abrir uno nuevo cierra el anterior como «reemplazado» (antes, un cronómetro
/// que seguía corriendo se reutilizaba y salían 1.945.411 ms). Pensado para un solo hilo (el de la interfaz).
/// </summary>
public sealed class MetricasVoz
{
    readonly Func<long> reloj;
    readonly Action<string> anotar;
    long siguiente;

    public MetricasVoz(Action<string> anotar, Func<long>? reloj = null)
    {
        this.anotar = anotar;
        this.reloj = reloj ?? Stopwatch.GetTimestamp;
    }

    public TurnoVoz? Actual { get; private set; }

    /// <summary>Un turno nuevo con su propio reloj. <paramref name="origen"/>: Stopwatch.GetTimestamp() del momento real del origen.</summary>
    public TurnoVoz Nuevo(string ruta, string desde, long? origen = null)
    {
        Cerrar("reemplazado");
        return Actual = new TurnoVoz(++siguiente, ruta, desde, reloj, origen);
    }

    /// <summary>Anota la etapa en el turno abierto (si es el mismo id que se espera, cuando se da).</summary>
    public void Marcar(EtapaVoz etapa, long? cuando = null, long? turno = null)
    {
        if (Actual is { Cerrado: false } t && (turno == null || turno == t.Id)) t.Marcar(etapa, cuando);
    }

    /// <summary>Cierra el turno abierto (si hay) y lo escribe en el registro.</summary>
    public void Cerrar(string final, long? cuando = null, long? turno = null)
    {
        var t = Actual;
        if (t == null || (turno != null && turno != t.Id)) return;
        Actual = null;
        if (t.Cerrar(final, cuando) is { } linea) anotar(linea);
    }
}
