using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

namespace Aura.Windows.Voz;

/// <summary>
/// La boca de AURA: reproduce en orden las frases que le llegan (el audio de ElevenLabs que manda el
/// servidor), pidiendo la siguiente mientras suena la actual, y avisa del NIVEL del audio para que el
/// avatar mueva la boca y el notch dibuje sus barras. Detener corta ya, sin cola.
/// </summary>
internal sealed class Altavoz : IDisposable
{
    readonly object candado = new();
    readonly Queue<(Task<Core.Audio?> Audio, string Texto, bool Relleno, long Turno)> cola = new();
    CancellationTokenSource corte = new();
    Task? bucle;
    WaveOutEvent? salida;
    long generacion;

    public event Action<double>? Nivel;
    /// <summary>
    /// Empezó a sonar de verdad: el dispositivo ya está pidiendo muestras (antes se avisaba ANTES de abrirlo,
    /// y la métrica de «primera voz» contaba de menos: auditoría 1-oct, H08).
    /// </summary>
    public event Action? Empezo;
    /// <summary>Llegó el audio TTS de una frase (relleno o no, de qué turno, Stopwatch.GetTimestamp() del momento).</summary>
    public event Action<bool, long, long>? AudioRecibido;
    /// <summary>Una frase empezó a sonar en el dispositivo (relleno o no, de qué turno, Stopwatch.GetTimestamp()).</summary>
    public event Action<bool, long, long>? Reproduciendo;
    /// <summary>Empieza a sonar esta frase (para el subtítulo).</summary>
    public event Action<string>? Frase;
    /// <summary>Se vació la cola y ya no suena nada.</summary>
    public event Action? Termino;
    public event Action<string>? Fallo;
    public bool Sonando { get; private set; }
    /// <summary>Suena algo o hay frases esperando su audio.</summary>
    public bool Ocupado { get { lock (candado) return cola.Count > 0 || bucle is { IsCompleted: false }; } }

    /// <summary>Encola el audio de una frase (la tarea ya está pidiéndolo). <paramref name="relleno"/>: «A ver…», no cuenta como respuesta.</summary>
    public void Encolar(Task<Core.Audio?> audio, string texto, bool relleno = false, long turno = 0)
    {
        lock (candado)
        {
            cola.Enqueue((audio, texto, relleno, turno));
            if (bucle == null || bucle.IsCompleted) { var gen = generacion; var ct = corte.Token; bucle = Task.Run(() => Reproducir(gen, ct)); }
        }
    }

    async Task Reproducir(long gen, CancellationToken ct)
    {
        bool avisado = false;
        while (!ct.IsCancellationRequested)
        {
            (Task<Core.Audio?> Audio, string Texto, bool Relleno, long Turno) siguiente;
            lock (candado)
            {
                if (cola.Count == 0) { bucle = null; break; }
                siguiente = cola.Dequeue();
            }
            Core.Audio? audio;
            try { audio = await siguiente.Audio.ConfigureAwait(false); }
            catch (OperationCanceledException) { continue; }
            catch (Exception ex) { Fallo?.Invoke(ex.Message); continue; }
            if (audio == null || audio.Bytes.Length < 100 || ct.IsCancellationRequested) continue;
            AudioRecibido?.Invoke(siguiente.Relleno, siguiente.Turno, Stopwatch.GetTimestamp());
            Frase?.Invoke(siguiente.Texto);
            var actual = siguiente;
            void AlSonar()
            {
                if (ct.IsCancellationRequested) return;
                Reproduciendo?.Invoke(actual.Relleno, actual.Turno, Stopwatch.GetTimestamp());
                if (!avisado) { avisado = true; Sonando = true; Empezo?.Invoke(); }
            }
            try { await Sonar(audio, ct, AlSonar).ConfigureAwait(false); }
            catch (OperationCanceledException) { }
            catch (Exception ex) { Fallo?.Invoke("No pude reproducir la voz: " + ex.Message); }
        }
        Nivel?.Invoke(0);
        if (gen == Interlocked.Read(ref generacion)) { Sonando = false; Termino?.Invoke(); }
    }

    async Task Sonar(Core.Audio audio, CancellationToken ct, Action alSonar)
    {
        using var ms = new MemoryStream(audio.Bytes);
        using WaveStream lector = audio.Tipo.Contains("wav") ? new WaveFileReader(ms) : new StreamMediaFoundationReader(ms);
        var medidor = new MeteringSampleProvider(lector.ToSampleProvider(), Math.Max(1, lector.WaveFormat.SampleRate / 50));
        int primera = 0;
        medidor.StreamVolume += (_, e) => { if (Interlocked.Exchange(ref primera, 1) == 0) alSonar(); float m = 0; foreach (var v in e.MaxSampleValues) m = Math.Max(m, v); Nivel?.Invoke(Math.Min(1, m * 1.4)); };
        var fin = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var o = new WaveOutEvent { DesiredLatency = 120 };
        lock (candado) salida = o;
        o.PlaybackStopped += (_, _) => fin.TrySetResult();
        o.Init(medidor);
        o.Play();
        using (ct.Register(() => { try { o.Stop(); } catch { } }))
            await fin.Task.ConfigureAwait(false);
        lock (candado) if (ReferenceEquals(salida, o)) salida = null;
        o.Dispose();
        ct.ThrowIfCancellationRequested();
    }

    /// <summary>Calla ya: corta lo que suena y descarta la cola.</summary>
    public void Detener()
    {
        lock (candado)
        {
            Interlocked.Increment(ref generacion);
            corte.Cancel();
            corte = new CancellationTokenSource();
            cola.Clear();
            try { salida?.Stop(); } catch { }
            bucle = null;
        }
        if (Sonando) { Sonando = false; Nivel?.Invoke(0); }
    }

    public void Dispose() { Detener(); corte.Dispose(); }
}
