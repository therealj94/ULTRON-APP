using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Threading;
using Aura.Windows.Core;

namespace Aura.Windows.Notch;

/// <summary>
/// Fase 2 en Windows: los objetivos con estado (server/objetivos.ts) y los trabajos.
///  · «Continuar»: al arrancar, al volver del bloqueo o de la suspensión, y al pasar el ratón o tocar el notch, si un
///    objetivo abierto tiene una revisión más nueva que la última que ESTA PC vio (Ajustes.RevisionesVistas), el notch
///    ofrece «Continuar: título — qué cambió»; el botón abre su hoja en el Centro (sección «Trabajos»).
///  · El puente del Centro para la lista «Trabajos» y la hoja: decidir con revisionVista; un 409 se pone al día solo y
///    dice «Cambió desde otro aparato».
///  · «Leyendo tu pantalla»: el indicador del notch mientras Manos/Pantalla lee una ventana (privacidad).
/// La voz («continúa», «¿en qué quedamos?») no necesita nada aquí: el turno normal ya lleva el contexto del objetivo.
/// </summary>
public partial class NotchWindow
{
    /// <summary>Lo que ya se ofreció en esta sesión (id → revisión): la misma novedad no vuelve a salir cada vez que pasas el ratón.</summary>
    readonly Dictionary<string, long> continuarMostradas = new();
    DateTime ultimaRevisionContinuar = DateTime.MinValue;
    bool revisandoContinuar;
    /// <summary>La hoja que el Centro debe abrir apenas pida la lista (si la página aún cargaba cuando se tocó «Ver»).</summary>
    string? objetivoPorAbrir;
    DispatcherTimer? relojLectura;
    Action<bool>? alLeerPantalla;

    void PrepararObjetivos()
    {
        if (soloRender) return;
        // El indicador de lectura: la verdad es Pantalla.LeyendoAhora (los avisos pueden cruzarse entre hilos).
        alLeerPantalla = _ => Dispatcher.BeginInvoke(new Action(PintarLectura));
        Manos.Pantalla.Leyendo += alLeerPantalla;
        var reloj = relojLectura = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1.5) };
        reloj.Tick += (_, _) => { reloj.Stop(); if (!Manos.Pantalla.LeyendoAhora) MostrarLuzPantalla(false); };
        Microsoft.Win32.SystemEvents.PowerModeChanged += AlCambiarEnergia;
        // Al arrancar: después del saludo y de comprobar la conexión (la red y la sesión ya están).
        RevisarContinuarLuego("arranque", TimeSpan.FromSeconds(12));
    }

    void SoltarObjetivos()
    {
        if (soloRender) return;
        Microsoft.Win32.SystemEvents.PowerModeChanged -= AlCambiarEnergia;
        if (alLeerPantalla != null) Manos.Pantalla.Leyendo -= alLeerPantalla;
        relojLectura?.Stop();
    }

    /// <summary>Volvió de la suspensión: la red tarda un momento en volver; se mira después.</summary>
    void AlCambiarEnergia(object? s, Microsoft.Win32.PowerModeChangedEventArgs e)
    {
        if (e.Mode != Microsoft.Win32.PowerModes.Resume) return;
        Dispatcher.BeginInvoke(new Action(() => RevisarContinuarLuego("reanudar", TimeSpan.FromSeconds(8))));
    }

    void RevisarContinuarLuego(string motivo, TimeSpan espera)
    {
        if (soloRender) return;
        var t = new DispatcherTimer { Interval = espera };
        t.Tick += (_, _) => { t.Stop(); _ = RevisarContinuar(motivo, forzar: true); };
        t.Start();
    }

    /// <summary>
    /// Mira si hay un objetivo abierto con novedad para esta PC y, si hay, lo ofrece en el notch. Con tope: forzado (arranque,
    /// desbloqueo, suspensión) cada 20 s como mucho; por el ratón o un toque, cada 90 s. Nunca lanza.
    /// </summary>
    async Task RevisarContinuar(string motivo, bool forzar = false)
    {
        if (soloRender || api == null || string.IsNullOrEmpty(ajustes.Token) || pausado || revisandoContinuar) return;
        if (DateTime.UtcNow - ultimaRevisionContinuar < (forzar ? TimeSpan.FromSeconds(20) : TimeSpan.FromSeconds(90))) return;
        revisandoContinuar = true;
        ultimaRevisionContinuar = DateTime.UtcNow;
        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(20));
            var lista = await api.Objetivos(cts.Token);
            if (Continuar.Podar(ajustes.RevisionesVistas, lista.Objetivos, lista.Completo)) GuardarAjustes();
            // Arranque, desbloqueo y suspensión vuelven a ofrecer lo no abierto; el ratón y los toques, solo lo que no se ofreció ya.
            var o = Continuar.Elegir(lista.Objetivos, ajustes.RevisionesVistas, forzar ? null : continuarMostradas);
            if (o == null) return;
            var visto = Continuar.Vista(ajustes.RevisionesVistas, o.Id);
            CambiosObjetivo? cambios = null;
            // Lo nuevo desde lo que vio esta PC (nunca visto: el objetivo trae sus últimos hechos).
            if (visto > 0) { try { cambios = await api.CambiosObjetivo(o.Id, visto, cts.Token); } catch (AuraError) { } }
            if (pausado) return;
            continuarMostradas[o.Id] = o.Revision;
            MostrarContinuar(o, cambios);
            // Solo números en el registro: el título es de la persona.
            Centro.Registro.Anotar("continuar", $"{motivo}: novedad (revisión {visto} → {o.Revision}{(o.DecisionesPendientes > 0 ? ", espera decisión" : "")})");
        }
        catch (AuraError ex) { Centro.Registro.Anotar("continuar", motivo + ": " + ex.Message); }
        catch (OperationCanceledException) { }
        finally { revisandoContinuar = false; }
    }

    /// <summary>La píldora: «Continuar: título» y debajo qué cambió; el botón abre la hoja en el Centro.</summary>
    void MostrarContinuar(ObjetivoVista o, CambiosObjetivo? c)
    {
        var titulo = T("Continuar: ", "Continue: ") + Recortar(o.Titulo.Length > 0 ? o.Titulo : T("tu objetivo", "your goal"), 46);
        var decide = (c?.Objetivo ?? o).DecisionPendiente != null;
        Avisar(new Aviso(titulo, "— " + Continuar.QueCambio(o, c, Ingles, 110), "", decide ? "thinking" : "happy",
            decide ? T("Decidir", "Decide") : T("Ver", "View"), () => AbrirHojaObjetivo(o.Id), 9));
    }

    /// <summary>Abre el Centro en «Trabajos» con la hoja de ese objetivo.</summary>
    internal void AbrirHojaObjetivo(string id)
    {
        if (!Continuar.IdValido(id)) return;
        objetivoPorAbrir = id;
        AbrirCentro("trabajos");
        // Con el Centro ya cargado la página lo abre ya; si recién se crea, lo toma al pedir la lista (objetivoPorAbrir).
        Dispatcher.BeginInvoke(new Action(() => centro?.Emitir("objetivo.abrir", new { id })), DispatcherPriority.ApplicationIdle);
    }

    // ───────────── el puente del Centro: «Trabajos» y la hoja del objetivo ─────────────

    async Task<object?> ManejarTrabajos(string metodo, JsonElement a)
    {
        if (api == null || string.IsNullOrEmpty(ajustes.Token))
            throw new InvalidOperationException(T("Entra con tu cuenta de AU-RA para ver tus trabajos.", "Sign in to AU-RA to see your work."));
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var id = Texto(a, "id");
        switch (metodo)
        {
            case "trabajos.lista": return await ListaDeTrabajos(cts.Token);
            case "objetivos.abrir":
            {
                // Ya se abrió: la próxima lista no la vuelve a abrir (la persona puede haberla cerrado).
                if (objetivoPorAbrir == id) objetivoPorAbrir = null;
                var o = await api.Objetivo(id, cts.Token);
                var visto = Continuar.Vista(ajustes.RevisionesVistas, o.Id);
                CambiosObjetivo? c = null;
                if (visto > 0 && visto < o.Revision) { try { c = await api.CambiosObjetivo(o.Id, visto, cts.Token); } catch (AuraError) { } }
                var nuevos = c is { Resync: false } ? c.Eventos.Select(e => e.Texto).ToArray()
                    : o.Eventos.Where(e => e.Revision > visto).Select(e => e.Texto).ToArray();
                // La persona la está viendo: esta revisión ya la vio esta PC.
                Visto(o);
                return new { objetivo = ParaCentro(o), nuevos = visto > 0 ? nuevos : Array.Empty<string>() };
            }
            case "objetivos.decidir":
            {
                var r = await api.DecidirObjetivo(id, Texto(a, "decisionId"), Texto(a, "opcion"), Numero(a, "revisionVista") ?? 0, cts.Token);
                return await ResultadoParaCentro(id, r, cts.Token);
            }
            case "objetivos.control":
            {
                var r = await api.ControlObjetivo(id, Texto(a, "accion"), Numero(a, "revisionVista"), cts.Token);
                return await ResultadoParaCentro(id, r, cts.Token);
            }
            default: throw new InvalidOperationException("Método desconocido: " + metodo);
        }
    }

    static long? Numero(JsonElement a, string k) => a.ValueKind == JsonValueKind.Object && a.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out var n) ? n : null;

    void Visto(ObjetivoVista o)
    {
        if (Continuar.Marcar(ajustes.RevisionesVistas, o.Id, o.Revision)) GuardarAjustes();
        continuarMostradas[o.Id] = Math.Max(o.Revision, continuarMostradas.TryGetValue(o.Id, out var m) ? m : 0);
    }

    /// <summary>
    /// Decidir o un control: si salió, el objetivo nuevo; si fue un 409, el de ahora (el que trajo el 409 o, si no vino,
    /// uno leído de nuevo) y «Cambió desde otro aparato».
    /// </summary>
    async Task<object> ResultadoParaCentro(string id, ResultadoObjetivo r, CancellationToken ct)
    {
        var actual = r.Actual;
        if (actual == null) { try { actual = await api!.Objetivo(id, ct); } catch (AuraError) { } }
        if (actual != null) Visto(actual);
        if (!r.Ok) Centro.Registro.Anotar("objetivos", "409 " + r.Conflicto!.Codigo + ": me pongo al día");
        return new
        {
            ok = r.Ok,
            repetida = r.Repetida,
            sinCambio = r.SinCambio,
            conflicto = r.Conflicto == null ? null : new { codigo = r.Conflicto.Codigo, mensaje = T("Cambió desde otro aparato", "It changed from another device"), detalle = r.Conflicto.Mensaje },
            objetivo = actual == null ? null : ParaCentro(actual),
        };
    }

    async Task<object> ListaDeTrabajos(CancellationToken ct)
    {
        // Las dos a la vez; si una falla, se muestra la otra con su aviso (un fallo nunca es «no hay nada»).
        var objetivosT = api!.Objetivos(ct);
        var tareasT = api.Trabajos(ct);
        ListaObjetivos? lo = null; ListaTrabajos? lt = null; string? fallo = null;
        try { lo = await objetivosT; } catch (AuraError ex) { fallo = ex.Message; }
        try { lt = await tareasT; } catch (AuraError ex) { fallo ??= ex.Message; }
        if (lo == null && lt == null) throw new InvalidOperationException(fallo ?? T("No pude leer tus trabajos.", "I couldn't read your work."));
        if (lo != null && Continuar.Podar(ajustes.RevisionesVistas, lo.Objetivos, lo.Completo)) GuardarAjustes();
        var objetivos = (lo?.Objetivos ?? Array.Empty<ObjetivoVista>())
            .OrderBy(o => o.Terminal).ThenByDescending(o => o.DecisionPendiente != null).ThenByDescending(o => o.Actualizado).ToList();
        var titulos = objetivos.GroupBy(o => o.Id).ToDictionary(g => g.Key, g => g.First().Titulo);
        var tareas = (lt?.Tareas ?? Array.Empty<TareaVista>()).OrderBy(t => t.Terminal).ThenByDescending(t => t.UpdatedAt, StringComparer.Ordinal).Take(60)
            .Select(t => new
            {
                id = t.Id, titulo = t.Title.Length > 0 ? t.Title : t.Objective, estado = t.State, estadoTexto = Trabajos.EstadoTarea(t, Ingles), espera = Trabajos.EsperaTarea(t, Ingles),
                terminal = t.Terminal, actualizado = t.UpdatedAt,
                progreso = t.Progress is { Total: > 0 } p ? new { hechos = p.Done, total = p.Total, unidad = p.Unit } : null,
                objetivo = t.GoalId != null && titulos.TryGetValue(t.GoalId, out var ti) ? ti : null,
            }).ToArray();
        var avisos = new List<string>();
        if (fallo != null) avisos.Add(fallo);
        if (lo is { Completo: false }) avisos.Add(T($"No pude leer {lo.NoLeidos} de tus objetivos en este momento; no es que no existan.", $"I couldn't read {lo.NoLeidos} of your goals right now."));
        if (lt?.Aviso is { Length: > 0 } av) avisos.Add(av);
        var abrir = objetivoPorAbrir; objetivoPorAbrir = null;
        return new { objetivos = objetivos.Select(ParaCentro).ToArray(), tareas, aviso = avisos.Count > 0 ? string.Join(" ", avisos) : null, abrir };
    }

    /// <summary>El objetivo como lo pinta la página: con su estado y lo que espera en palabras, y si es nuevo para esta PC.</summary>
    object ParaCentro(ObjetivoVista o) => new
    {
        id = o.Id, titulo = o.Titulo, meta = o.Meta, proyecto = o.Proyecto, estado = o.Estado, estadoTexto = Trabajos.EstadoObjetivo(o, Ingles), espera = Trabajos.EsperaObjetivo(o, Ingles),
        pausado = o.Pausado, terminal = o.Terminal, revision = o.Revision, siguientePaso = o.SiguientePaso, actualizado = o.Actualizado,
        nuevo = Continuar.HayNovedad(o, ajustes.RevisionesVistas),
        decision = o.DecisionPendiente is { } d ? new { id = d.Id, pregunta = d.Pregunta, opciones = d.Opciones.Select(x => new { id = x.Id, etiqueta = x.Etiqueta, consecuencia = x.Consecuencia }).ToArray() } : null,
        criterios = o.CriterioCierre.Select(c => new { texto = c.Texto, cumplido = c.Cumplido }).ToArray(),
        documentos = o.Documentos.Where(x => x.Vigente).Select(x => new { nombre = x.Nombre, version = x.Version }).ToArray(),
        eventos = o.Eventos.TakeLast(10).Reverse().Select(e => new { revision = e.Revision, t = e.T, texto = e.Texto }).ToArray(),
    };

    // ───────────── «Leyendo tu pantalla» ─────────────

    /// <summary>
    /// Encendido mientras alguna lectura de ventana sigue en curso; al terminar queda 1,5 s más (una lectura de 80 ms
    /// también se ve) y se apaga. Se ve en cualquier modo del notch: va junto a la luz del micrófono.
    /// </summary>
    void PintarLectura()
    {
        if (relojLectura == null) return;
        if (Manos.Pantalla.LeyendoAhora) { relojLectura.Stop(); MostrarLuzPantalla(true); return; }
        relojLectura.Stop();
        relojLectura.Start();
    }

    bool LecturaVisible => LuzPantalla.Visibility == Visibility.Visible;

    void MostrarLuzPantalla(bool si)
    {
        var v = si ? Visibility.Visible : Visibility.Collapsed;
        if (LuzPantalla.Visibility == v) return;
        TextoLuzPantalla.Text = T("Leyendo tu pantalla", "Reading your screen");
        LuzPantalla.Visibility = v;
        Centro.Registro.Anotar("pantalla", si ? "leyendo una ventana: indicador encendido" : "lectura terminada: indicador apagado");
        Recalcular();
    }
}
