using System.Net;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Aura.Windows.Core;

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Los objetivos con estado (Fase 2, server/objetivos.ts) y los trabajos (server/trabajos.ts) como los ve Windows.
// Los nombres son los del servidor (camelCase en el JSON; se leen sin distinguir mayúsculas). Todo con valores por
// omisión: un campo que falte no rompe la lista, se ve vacío.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/// <summary>Una opción de una decisión: qué es y qué pasa si la eliges.</summary>
public sealed record OpcionObjetivo
{
    public string Id { get; init; } = "";
    public string Etiqueta { get; init; } = "";
    public string Consecuencia { get; init; } = "";
}

/// <summary>Una pregunta del objetivo (a lo más tres opciones), ligada a la revisión en que se planteó.</summary>
public sealed record DecisionObjetivo
{
    public string Id { get; init; } = "";
    public string Pregunta { get; init; } = "";
    public IReadOnlyList<OpcionObjetivo> Opciones { get; init; } = Array.Empty<OpcionObjetivo>();
    public string? Elegida { get; init; }
    public long Version { get; init; }
    public string? Por { get; init; }
    public long? Cuando { get; init; }
    public string? Aparato { get; init; }
    public long Creada { get; init; }
    /// <summary>Todavía nadie la contestó.</summary>
    public bool Pendiente => string.IsNullOrEmpty(Elegida);
}

/// <summary>Un hecho del objetivo («qué pasó»), con la revisión en que pasó.</summary>
public sealed record EventoObjetivo
{
    public long Revision { get; init; }
    public long T { get; init; }
    public string Texto { get; init; } = "";
    public IReadOnlyList<string> Campos { get; init; } = Array.Empty<string>();
}

public sealed record EvidenciaObjetivo
{
    public string Tipo { get; init; } = "";
    public string Ref { get; init; } = "";
    public string Etiqueta { get; init; } = "";
    public long T { get; init; }
}

public sealed record CriterioObjetivo
{
    public string Id { get; init; } = "";
    public string Texto { get; init; } = "";
    public IReadOnlyList<EvidenciaObjetivo> Evidencias { get; init; } = Array.Empty<EvidenciaObjetivo>();
    public bool Cumplido => Evidencias.Count > 0;
}

public sealed record DocumentoObjetivo
{
    public string Id { get; init; } = "";
    public string Nombre { get; init; } = "";
    public long Version { get; init; }
    public bool Vigente { get; init; }
    public long Creado { get; init; }
}

/// <summary>El objetivo como lo da el servidor (VistaObjetivo de lib/objetivos.ts: sin la huella del dueño).</summary>
public sealed record ObjetivoVista
{
    public string Id { get; init; } = "";
    public string Proyecto { get; init; } = "";
    public string Titulo { get; init; } = "";
    public string Meta { get; init; } = "";
    /// <summary>abierto | esperando-decision | en-curso | esperando-recurso | incierto | completado | cancelado | fallido.</summary>
    public string Estado { get; init; } = "";
    public bool Pausado { get; init; }
    public long Revision { get; init; }
    public bool Terminal { get; init; }
    public int DecisionesPendientes { get; init; }
    public string SiguientePaso { get; init; } = "";
    public IReadOnlyList<CriterioObjetivo> CriterioCierre { get; init; } = Array.Empty<CriterioObjetivo>();
    public IReadOnlyList<DocumentoObjetivo> Documentos { get; init; } = Array.Empty<DocumentoObjetivo>();
    public IReadOnlyList<DecisionObjetivo> Decisiones { get; init; } = Array.Empty<DecisionObjetivo>();
    public IReadOnlyList<EventoObjetivo> Eventos { get; init; } = Array.Empty<EventoObjetivo>();
    public IReadOnlyList<string> Tareas { get; init; } = Array.Empty<string>();
    public IReadOnlyList<string> Permisos { get; init; } = Array.Empty<string>();
    public IReadOnlyList<string> Restricciones { get; init; } = Array.Empty<string>();
    public double? TopeCosto { get; init; }
    public long Creado { get; init; }
    public long Actualizado { get; init; }
    /// <summary>La primera pregunta sin contestar (la que se muestra con sus botones), o null.</summary>
    public DecisionObjetivo? DecisionPendiente => Decisiones.FirstOrDefault(d => d.Pendiente);
}

/// <summary>GET /api/objetivos → { objetivos[], completo, noLeidos }.</summary>
public sealed record ListaObjetivos
{
    public IReadOnlyList<ObjetivoVista> Objetivos { get; init; } = Array.Empty<ObjetivoVista>();
    public bool Completo { get; init; } = true;
    public int NoLeidos { get; init; }
}

public sealed record EventoCambio
{
    public long Revision { get; init; }
    public long T { get; init; }
    public string Texto { get; init; } = "";
}

/// <summary>GET /api/objetivos/:id/cambios?desde=N: lo nuevo después de N; con <see cref="Resync"/>, el objetivo entero.</summary>
public sealed record CambiosObjetivo
{
    public long Revision { get; init; }
    public long Desde { get; init; }
    public bool Resync { get; init; }
    public IReadOnlyList<EventoCambio> Eventos { get; init; } = Array.Empty<EventoCambio>();
    public Dictionary<string, JsonElement> Campos { get; init; } = new();
    public ObjetivoVista? Objetivo { get; init; }
}

/// <summary>Un 409: otro aparato (u otra cosa) cambió el objetivo. Trae la revisión y el objetivo de ahora.</summary>
public sealed record ConflictoObjetivo
{
    /// <summary>revision | ya-decidida | decision-vieja | terminal | sin-evidencia…</summary>
    public string Codigo { get; init; } = "";
    [JsonPropertyName("error")] public string Mensaje { get; init; } = "";
    public long? Revision { get; init; }
    public ObjetivoVista? Objetivo { get; init; }
}

/// <summary>
/// Lo que devuelve decidir, pausar, reanudar o cancelar: el objetivo nuevo, o el conflicto (409) como un valor y no
/// como una excepción (el aparato que llegó tarde se pone al día con <see cref="ConflictoObjetivo.Objetivo"/>).
/// </summary>
public sealed record ResultadoObjetivo
{
    public ObjetivoVista? Objetivo { get; init; }
    public ConflictoObjetivo? Conflicto { get; init; }
    public bool Repetida { get; init; }
    public bool SinCambio { get; init; }
    public bool Ok => Conflicto == null;
    /// <summary>El objetivo como quedó, haya o no conflicto (puede faltar en un 409 sin objetivo).</summary>
    public ObjetivoVista? Actual => Objetivo ?? Conflicto?.Objetivo;
}

// ───────────── trabajos (GET /api/trabajos: TaskSnapshot de lib/tareas-durables.ts, en inglés) ─────────────

public sealed record OpcionTarea
{
    public string Id { get; init; } = "";
    public string Label { get; init; } = "";
    public string Effect { get; init; } = "";
    public string Risk { get; init; } = "";
}

public sealed record DecisionTarea
{
    public string Id { get; init; } = "";
    public string Question { get; init; } = "";
    public string Why { get; init; } = "";
    public IReadOnlyList<OpcionTarea> Options { get; init; } = Array.Empty<OpcionTarea>();
    public bool Expired { get; init; }
    public bool Postponed { get; init; }
}

public sealed record ProgresoTarea
{
    public double Done { get; init; }
    public double Total { get; init; }
    public string Unit { get; init; } = "";
}

public sealed record TareaVista
{
    public string Id { get; init; } = "";
    public string State { get; init; } = "";
    public bool Terminal { get; init; }
    public string Source { get; init; } = "";
    public string Title { get; init; } = "";
    public string Objective { get; init; } = "";
    public string? CurrentStep { get; init; }
    public ProgresoTarea? Progress { get; init; }
    public bool? AwaitingInput { get; init; }
    public DecisionTarea? Decision { get; init; }
    public string UpdatedAt { get; init; } = "";
    public string? NextCheckAt { get; init; }
    public string? GoalId { get; init; }
}

public sealed record ListaTrabajos
{
    public IReadOnlyList<TareaVista> Tareas { get; init; } = Array.Empty<TareaVista>();
    public bool Completo { get; init; } = true;
    public string? Aviso { get; init; }
}

/// <summary>Leer el JSON del contrato. Lo que no se entiende es un AuraError con texto para la persona, nunca otra cosa.</summary>
public static class ObjetivosJson
{
    public static readonly JsonSerializerOptions Opciones = new(JsonSerializerDefaults.Web) { NumberHandling = JsonNumberHandling.AllowReadingFromString };

    static T Leer<T>(string json) where T : class
    {
        try { return JsonSerializer.Deserialize<T>(json, Opciones) ?? throw new JsonException("vacío"); }
        catch (Exception e) when (e is JsonException or NotSupportedException or InvalidOperationException) { throw new AuraError("El servidor respondió algo que no entiendo. ¿Hay un portal de wifi o un proxy en medio?"); }
    }

    internal sealed record ConObjetivo { public ObjetivoVista? Objetivo { get; init; } public bool Repetida { get; init; } public bool SinCambio { get; init; } }

    public static ListaObjetivos Lista(string json) => Leer<ListaObjetivos>(json);

    public static ObjetivoVista Uno(string json) => Leer<ConObjetivo>(json).Objetivo ?? throw new AuraError("El servidor no devolvió el objetivo.");

    public static CambiosObjetivo Cambios(string json) => Leer<CambiosObjetivo>(json);

    public static ListaTrabajos Trabajos(string json) => Leer<ListaTrabajos>(json);

    /// <summary>La respuesta de decidir o de un control: 2xx → el objetivo; 409 → el conflicto como valor.</summary>
    public static ResultadoObjetivo Resultado(HttpStatusCode estado, string json)
    {
        if (estado == HttpStatusCode.Conflict)
        {
            var c = Leer<ConflictoObjetivo>(string.IsNullOrWhiteSpace(json) ? "{}" : json);
            return new ResultadoObjetivo { Conflicto = c with { Codigo = c.Codigo.Length > 0 ? c.Codigo : "revision", Revision = c.Revision ?? c.Objetivo?.Revision } };
        }
        var r = Leer<ConObjetivo>(json);
        if (r.Objetivo == null) throw new AuraError("El servidor no devolvió el objetivo.");
        return new ResultadoObjetivo { Objetivo = r.Objetivo, Repetida = r.Repetida, SinCambio = r.SinCambio };
    }
}

/// <summary>
/// «Continuar»: qué objetivo abierto cambió desde la última revisión que ESTA PC vio (se guarda por objetivo en los
/// Ajustes) y cómo decirlo en una línea. Puro y probable: el notch solo lo pinta.
/// </summary>
public static class Continuar
{
    static readonly Regex IdObjetivo = new(@"^ob_[a-z0-9]{8,40}\z", RegexOptions.CultureInvariant);
    static readonly Regex IdDecision = new(@"^dob_[a-z0-9]{6,40}\z", RegexOptions.CultureInvariant);
    static readonly Regex IdOpcion = new(@"^[a-z0-9_-]{1,40}\z", RegexOptions.CultureInvariant);

    /// <summary>Los mismos ids que da el servidor (RE_ID_OBJETIVO): nada más arma una ruta.</summary>
    public static bool IdValido(string? id) => id != null && IdObjetivo.IsMatch(id);
    public static bool DecisionValida(string? id) => id != null && IdDecision.IsMatch(id);
    public static bool OpcionValida(string? id) => id != null && IdOpcion.IsMatch(id);
    public static bool ControlValido(string? c) => c is "pausar" or "reanudar" or "cancelar";

    /// <summary>Hasta cuántos objetivos recuerda la PC (los que ya no están en la lista se olvidan primero).</summary>
    public const int MaximoRecordados = 200;

    public static long Vista(IReadOnlyDictionary<string, long> vistas, string id) => vistas.TryGetValue(id, out var v) ? v : 0;

    /// <summary>Abierto y con una revisión más nueva que la última que esta PC vio (nunca visto = revisión 0).</summary>
    public static bool HayNovedad(ObjetivoVista o, IReadOnlyDictionary<string, long> vistas) =>
        !o.Terminal && IdValido(o.Id) && o.Revision > Vista(vistas, o.Id);

    /// <summary>
    /// El que toca mostrar: con novedad y que no se haya mostrado ya en esa misma revisión (en esta sesión). Primero
    /// los que esperan una decisión tuya; después el que cambió más reciente.
    /// </summary>
    public static ObjetivoVista? Elegir(IEnumerable<ObjetivoVista> objetivos, IReadOnlyDictionary<string, long> vistas, IReadOnlyDictionary<string, long>? mostradas = null) =>
        objetivos.Where(o => HayNovedad(o, vistas) && !(mostradas != null && mostradas.TryGetValue(o.Id, out var m) && m >= o.Revision))
                 .OrderByDescending(o => o.DecisionesPendientes > 0)
                 .ThenByDescending(o => o.Actualizado)
                 .FirstOrDefault();

    /// <summary>Anota que la PC vio el objetivo en esa revisión. Solo sube (una lectura vieja no la hace retroceder). true si cambió.</summary>
    public static bool Marcar(IDictionary<string, long> vistas, string id, long revision)
    {
        if (!IdValido(id) || revision <= 0) return false;
        if (vistas.TryGetValue(id, out var v) && v >= revision) return false;
        vistas[id] = revision;
        return true;
    }

    /// <summary>
    /// Olvida los objetivos que ya no están (solo con la lista completa: una lectura a medias no borra nada) y deja a
    /// lo más <paramref name="maximo"/>. true si cambió algo.
    /// </summary>
    public static bool Podar(IDictionary<string, long> vistas, IEnumerable<ObjetivoVista> actuales, bool listaCompleta, int maximo = MaximoRecordados)
    {
        bool cambio = false;
        var ids = new HashSet<string>(actuales.Select(o => o.Id), StringComparer.Ordinal);
        foreach (var k in vistas.Keys.ToList())
            if (!IdValido(k) || (listaCompleta && !ids.Contains(k))) { vistas.Remove(k); cambio = true; }
        if (vistas.Count > maximo)
            foreach (var k in vistas.OrderBy(kv => ids.Contains(kv.Key)).ThenBy(kv => kv.Value).Take(vistas.Count - maximo).Select(kv => kv.Key).ToList())
            { vistas.Remove(k); cambio = true; }
        return cambio;
    }

    static string Corto(string s, int n) { s = Regex.Replace(s ?? "", @"\s+", " ").Trim(); return s.Length > n ? s[..(n - 1)].TrimEnd() + "…" : s; }

    /// <summary>
    /// «Qué cambió» en una línea: si espera tu decisión, la pregunta; si no, lo último que pasó después de lo que viste
    /// (con cuántas cosas más); y si no hay nada de eso, el siguiente paso.
    /// </summary>
    public static string QueCambio(ObjetivoVista o, CambiosObjetivo? c, bool ingles = false, int maximo = 120)
    {
        var actual = c?.Objetivo ?? o;
        if (actual.DecisionPendiente is { } d && d.Pregunta.Length > 0) return Corto((ingles ? "Your call: " : "Te toca decidir: ") + d.Pregunta, maximo);
        var eventos = c is { Resync: false } ? c.Eventos.Select(e => e.Texto).Where(t => t.Length > 0).ToList() : new List<string>();
        if (eventos.Count == 0)
        {
            long desde = c?.Desde ?? 0;
            eventos = actual.Eventos.Where(e => e.Revision > desde && e.Texto.Length > 0).Select(e => e.Texto).ToList();
        }
        if (eventos.Count > 0)
        {
            var ultimo = eventos[^1];
            var mas = eventos.Count - 1;
            var cola = mas > 0 ? (ingles ? $" (+{mas} more)" : $" (+{mas} más)") : "";
            return Corto(ultimo, Math.Max(10, maximo - cola.Length)) + cola;
        }
        if (actual.SiguientePaso.Length > 0) return Corto((ingles ? "Next: " : "Sigue: ") + actual.SiguientePaso, maximo);
        return ingles ? "There's something new" : "Hay novedades";
    }

    /// <summary>La línea de la píldora: «Continuar: título — qué cambió».</summary>
    public static string Pildora(ObjetivoVista o, CambiosObjetivo? c, bool ingles = false) =>
        (ingles ? "Continue: " : "Continuar: ") + Corto(o.Titulo.Length > 0 ? o.Titulo : (ingles ? "your goal" : "tu objetivo"), 60) + " — " + QueCambio(o, c, ingles, 90);
}

/// <summary>Cómo está y qué espera cada objetivo o tarea, en palabras de persona (la lista «Trabajos» del Centro).</summary>
public static class Trabajos
{
    public static string EstadoObjetivo(ObjetivoVista o, bool ingles = false)
    {
        if (o.Pausado && !o.Terminal) return ingles ? "Paused" : "En pausa";
        return o.Estado switch
        {
            "abierto" => ingles ? "Open" : "Abierto",
            "esperando-decision" => ingles ? "Waiting for you" : "Espera tu decisión",
            "en-curso" => ingles ? "In progress" : "En curso",
            "esperando-recurso" => ingles ? "Waiting" : "Esperando",
            "incierto" => ingles ? "Needs checking" : "Hay que comprobar",
            "completado" => ingles ? "Done" : "Completado",
            "cancelado" => ingles ? "Cancelled" : "Cancelado",
            "fallido" => ingles ? "Failed" : "Falló",
            _ => o.Estado,
        };
    }

    /// <summary>Lo que el objetivo está esperando para avanzar (vacío si terminó).</summary>
    public static string EsperaObjetivo(ObjetivoVista o, bool ingles = false)
    {
        if (o.Terminal) return "";
        if (o.Pausado) return ingles ? "That you resume it" : "Que lo reanudes";
        if (o.DecisionPendiente is { } d) return (ingles ? "Your decision: " : "Tu decisión: ") + d.Pregunta;
        return o.Estado switch
        {
            "esperando-recurso" => (ingles ? "A resource" : "Un recurso") + (o.SiguientePaso.Length > 0 ? ": " + o.SiguientePaso : ""),
            "incierto" => ingles ? "Checking how it ended up" : "Comprobar cómo quedó",
            _ => o.SiguientePaso.Length > 0 ? o.SiguientePaso : (ingles ? "Nothing: AURA is on it" : "Nada: AURA sigue en ello"),
        };
    }

    public static string EstadoTarea(TareaVista t, bool ingles = false) => t.State switch
    {
        "created" or "planning" => ingles ? "Planning" : "Planeando",
        "queued" => ingles ? "Queued" : "En cola",
        "waiting_resource" => ingles ? "Waiting" : "Esperando",
        "awaiting_approval" => t.AwaitingInput == true ? (ingles ? "Waiting for you" : "Espera que sigas") : (ingles ? "Needs approval" : "Espera tu aprobación"),
        "running" => ingles ? "Working" : "Trabajando",
        "pausing" or "paused" => ingles ? "Paused" : "En pausa",
        "takeover_requested" or "human_control" => ingles ? "You're in control" : "La tienes tú",
        "reconciling" or "verifying" => ingles ? "Checking" : "Comprobando",
        "completed" => ingles ? "Done" : "Hecha",
        "respondida" => ingles ? "Answered" : "Respondida",
        "partial" => ingles ? "Partly done" : "A medias",
        "failed" => ingles ? "Failed" : "Falló",
        "blocked" => ingles ? "Blocked" : "Bloqueada",
        "cancelling" or "cancelled" => ingles ? "Cancelled" : "Cancelada",
        _ => t.State,
    };

    public static string EsperaTarea(TareaVista t, bool ingles = false)
    {
        if (t.Terminal) return "";
        if (t.Decision is { } d && d.Question.Length > 0) return (ingles ? "Your decision: " : "Tu decisión: ") + d.Question;
        var paso = string.IsNullOrWhiteSpace(t.CurrentStep) ? "" : t.CurrentStep!.Trim();
        return t.State switch
        {
            "awaiting_approval" => t.AwaitingInput == true ? (ingles ? "That you continue the conversation" : "Que sigas la conversación") : (ingles ? "Your approval" : "Tu aprobación"),
            "waiting_resource" => (ingles ? "A resource" : "Un recurso") + (paso.Length > 0 ? ": " + paso : ""),
            "paused" or "pausing" => ingles ? "That you resume it" : "Que la reanudes",
            "blocked" => (ingles ? "Unblocking" : "Desbloquearse") + (paso.Length > 0 ? ": " + paso : ""),
            "queued" or "created" or "planning" => ingles ? "Its turn" : "Su turno",
            "takeover_requested" or "human_control" => ingles ? "That you hand it back" : "Que la devuelvas",
            _ => paso.Length > 0 ? paso : (ingles ? "Nothing: AURA is on it" : "Nada: AURA sigue en ello"),
        };
    }
}
