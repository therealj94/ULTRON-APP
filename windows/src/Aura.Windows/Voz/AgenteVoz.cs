using System;
using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Aura.Windows.Core;
using NAudio.Wave;

namespace Aura.Windows.Voz;

/// <summary>
/// La conversación por voz con el agente de ElevenLabs (el mismo camino que la llamada del teléfono):
/// el micrófono va en vivo por WebSocket y vuelve la voz de AURA mientras el cerebro escribe. ElevenLabs
/// decide cuándo terminaste de hablar, entiende la frase y deja que la interrumpas; el cerebro es el de
/// AU-RA (/api/voz/llm) y las manos de la PC llegan aparte, por el canal (CanalPc).
///
/// Sin cancelación de eco en el micrófono de Windows, mientras AURA habla lo que entra más bajo que su
/// propia voz se manda como silencio: su voz no la interrumpe; la tuya, más fuerte y cerca, sí.
///
/// Colas ACOTADAS (auditoría 1-oct, H09): el micrófono va por una cola de ~1 s que tira lo más viejo si la red
/// no da abasto (antes, sin límite: con la red lenta se acumulaba audio viejo); la voz que llega espera en una
/// cola de pocos segundos con generación (ColaBoca) y el reproductor tiene un búfer corto. Al interrumpir o
/// mandarla callar se tira todo lo pendiente y lo que llegue tarde de esa respuesta: nunca suena audio viejo.
/// </summary>
internal sealed class AgenteVoz : IDisposable
{
    const int MsBloque = 50;
    /// <summary>Cuánto audio del micrófono puede esperar a la red (20 bloques de 50 ms = 1 s); más, se tira lo más viejo.</summary>
    const int BloquesEnCola = 20;
    /// <summary>El búfer del reproductor: corto, para que «detener» no deje nada sonando.</summary>
    static readonly TimeSpan BuferBoca = TimeSpan.FromSeconds(3);
    /// <summary>Lo más que espera de la voz antes del reproductor (una respuesta larga que llega más rápido de lo que suena).</summary>
    const int SegundosEnEspera = 30;
    ClientWebSocket? ws;
    WaveInEvent? mic;
    WaveOutEvent? salida;
    BufferedWaveProvider? boca;
    ColaBoca? espera;
    CancellationTokenSource? corte;
    ColaEnvio<string>? envios;
    Timer? relojBoca;
    FormatoAudio entrada = FormatoAudio.Pcm16k, sale = FormatoAudio.Pcm16k;
    int interrumpidoHasta = -1;
    volatile bool hablando;
    double nivelVoz;
    /// <summary>Cuándo sonó por última vez: la cola de su voz (y el eco del cuarto) sigue unos ms después.</summary>
    DateTime ultimoSonido = DateTime.MinValue;
    /// <summary>La persona la mandó callar: el resto de ESTA respuesta no suena (la próxima frase suya lo quita).</summary>
    volatile bool callada;
    readonly object candado = new();
    readonly TaskCompletionSource<AgenteListo> listo = new(TaskCreationOptions.RunContinuationsAsynchronously);

    public bool Abierto => terminado == 0 && ws?.State == WebSocketState.Open && corte is { IsCancellationRequested: false };
    public string ConversacionId { get; private set; } = "";
    /// <summary>El micrófono no manda nada (silenciado): la conversación sigue abierta.</summary>
    public bool Mudo { get; set; }

    public event Action<string>? TuDijiste;
    public event Action<AgenteRespuesta>? Respuesta;
    public event Action? Interrumpida;
    /// <summary>Empieza o deja de sonar la voz de AURA.</summary>
    public event Action<bool>? Hablando;
    /// <summary>Nivel del micrófono (0..1) para las barras.</summary>
    public event Action<double>? NivelMic;
    /// <summary>Nivel de la voz de AURA (0..1) para la boca.</summary>
    public event Action<double>? NivelBoca;
    /// <summary>Se cerró (con el porqué si no fue a pedido).</summary>
    public event Action<string?>? Cerrada;

    /// <summary>Conecta, manda el pase y espera a que el agente diga sus formatos de audio (o falla).</summary>
    public async Task Abrir(PermisoAgente permiso, CancellationToken ct, Func<byte[]?>? previo = null)
    {
        if (ws != null) throw new InvalidOperationException("La conversación ya está abierta.");
        corte = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var c = corte.Token;
        ws = new ClientWebSocket();
        ws.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);
        using (var tope = CancellationTokenSource.CreateLinkedTokenSource(c))
        {
            tope.CancelAfter(TimeSpan.FromSeconds(10));
            await ws.ConnectAsync(new Uri(permiso.Url), tope.Token).ConfigureAwait(false);
        }
        envios = new ColaEnvio<string>(BloquesEnCola);
        _ = Task.Run(() => BucleEnvio(c));
        Mandar(AgenteProtocolo.Inicio(permiso.Pase));
        _ = Task.Run(() => BucleRecibir(c));
        var hola = await listo.Task.WaitAsync(TimeSpan.FromSeconds(8), c).ConfigureAwait(false);
        if (hola.Entrada.Ulaw) throw new IOException("El agente pide audio μ-law y este equipo manda PCM.");
        ConversacionId = hola.ConversacionId;
        // Si se cerró mientras llegaba el saludo (o justo ahora), no se abren aparatos que nadie apagaría.
        lock (candado)
        {
            if (terminado == 1 || c.IsCancellationRequested) throw new OperationCanceledException("La conversación se cerró al abrir.");
            AbrirBoca();
            // Lo que dijiste mientras conectaba (el micrófono del despertador lo guardó): va antes que el micrófono en vivo.
            if (previo?.Invoke() is { Length: > 0 } pcm && entrada.Muestreo == PalabraClave.Muestreo)
                for (int i = 0; i < pcm.Length; i += TrozoPrevio)
                    envios?.Audio(AgenteProtocolo.Audio(new ReadOnlySpan<byte>(pcm, i, Math.Min(TrozoPrevio, pcm.Length - i))));
            AbrirMicrofono();
        }
    }

    /// <summary>De a 250 ms (16 kHz, 16 bits): pocos trozos, para no desbordar la cola del micrófono.</summary>
    const int TrozoPrevio = PalabraClave.Muestreo * 2 / 4;

    /// <summary>Calla lo que está diciendo YA (sin colgar): se tira lo que suena y lo pendiente. Su próxima respuesta vuelve a sonar.</summary>
    public void CallarVoz()
    {
        callada = true;
        CortarVoz();
    }

    /// <summary>Tira la voz pendiente (y la que llegue tarde de esta respuesta) y vacía el reproductor.</summary>
    void CortarVoz()
    {
        // Con el mismo candado que Alimentar: un trozo sacado justo antes no puede volver a entrar después.
        lock (candadoBoca)
        {
            espera?.Cortar();
            try { boca?.ClearBuffer(); } catch { }
        }
    }

    void Mandar(string json) => envios?.Control(json);

    /// <summary>Profundidad de la cola del micrófono (para el registro al cerrar).</summary>
    public string MetricasCola => envios is { } e ? $"cola mic: máx {e.ProfundidadMaxima}/{e.CapacidadAudio} bloques, {e.Descartados} tirados por viejos; voz tirada por tope: {espera?.BytesDescartados ?? vozTirada} bytes" : "";
    long vozTirada;

    /// <summary>Lo que de verdad pasó en la PC, a la conversación: si <paramref name="hablar"/>, el agente lo dice; si no, lo sabe.</summary>
    public void AvisarPc(string texto, bool hablar) { if (Abierto) Mandar(AgenteProtocolo.AvisoPc(texto, hablar)); }

    async Task BucleEnvio(CancellationToken ct)
    {
        try
        {
            while (await envios!.Siguiente(ct).ConfigureAwait(false) is { } m)
            {
                if (ws?.State != WebSocketState.Open) break;
                await ws.SendAsync(Encoding.UTF8.GetBytes(m), WebSocketMessageType.Text, true, ct).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) { Terminar("Se cortó la conversación: " + ex.Message); }
    }

    async Task BucleRecibir(CancellationToken ct)
    {
        var trozo = new byte[16 * 1024];
        using var mensaje = new MemoryStream();
        string? motivo = null;
        try
        {
            while (!ct.IsCancellationRequested && ws?.State == WebSocketState.Open)
            {
                var r = await ws.ReceiveAsync(trozo, ct).ConfigureAwait(false);
                if (r.MessageType == WebSocketMessageType.Close)
                {
                    motivo = ws.CloseStatus is WebSocketCloseStatus.NormalClosure ? null : "ElevenLabs cerró la conversación" + (string.IsNullOrEmpty(ws.CloseStatusDescription) ? "." : ": " + ws.CloseStatusDescription);
                    break;
                }
                mensaje.Write(trozo, 0, r.Count);
                if (mensaje.Length > 4 * 1024 * 1024) { motivo = "Mensaje demasiado grande."; break; }
                if (!r.EndOfMessage) continue;
                var json = Encoding.UTF8.GetString(mensaje.GetBuffer(), 0, (int)mensaje.Length);
                mensaje.SetLength(0);
                if (r.MessageType == WebSocketMessageType.Text) Atender(AgenteProtocolo.Leer(json, sale));
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) { motivo = "Se cortó la conversación: " + ex.Message; }
        listo.TrySetException(new IOException(motivo ?? "El agente no contestó."));
        Terminar(motivo);
    }

    void Atender(EventoAgente? e)
    {
        switch (e)
        {
            case AgenteListo l:
                sale = l.Salida; entrada = l.Entrada;
                listo.TrySetResult(l);
                break;
            case AgenteAudio a when a.EventoId > interrumpidoHasta && !callada:
                if (espera is { } cola) { cola.Agregar(a.Pcm, cola.Generacion); Alimentar(); }
                nivelVoz = Math.Max(nivelVoz, Math.Min(1, AgenteProtocolo.Rms(a.Pcm) * 6));
                break;
            case AgenteInterrumpido i:
                // Lo que ya estaba en camino de antes de la interrupción no suena.
                interrumpidoHasta = Math.Max(interrumpidoHasta, i.EventoId);
                CortarVoz();
                Interrumpida?.Invoke();
                break;
            case AgentePing p:
                Mandar(AgenteProtocolo.Pong(p.EventoId));
                break;
            case AgenteTuDijiste t:
                callada = false;
                TuDijiste?.Invoke(t.Texto);
                break;
            case AgenteRespuesta r:
                Respuesta?.Invoke(r);
                break;
        }
    }

    void AbrirBoca()
    {
        var formato = new WaveFormat(sale.Muestreo, 16, 1);
        boca = new BufferedWaveProvider(formato) { BufferDuration = BuferBoca, DiscardOnBufferOverflow = true, ReadFully = true };
        espera = new ColaBoca((long)formato.AverageBytesPerSecond * SegundosEnEspera);
        salida = new WaveOutEvent { DesiredLatency = 120 };
        // Se desconectaron los parlantes o audífonos: antes la conversación seguía abierta y AURA quedaba muda.
        var esta = salida;
        salida.PlaybackStopped += (_, e) => { if (e.Exception != null && ReferenceEquals(esta, salida)) Terminar("La salida de audio se detuvo: " + e.Exception.Message); };
        salida.Init(boca);
        salida.Play();
        // Cada 80 ms: ¿suena algo? y el nivel para la boca del avatar (baja solo entre trozos).
        relojBoca = new Timer(_ =>
        {
            try
            {
                Alimentar();
                var b = boca; // Terminar lo pone en null desde otro hilo
                var suena = b != null && b.BufferedDuration > TimeSpan.FromMilliseconds(40);
                if (suena) ultimoSonido = DateTime.UtcNow;
                if (suena != hablando) { hablando = suena; Hablando?.Invoke(suena); }
                nivelVoz = suena ? nivelVoz * 0.85 : 0;
                NivelBoca?.Invoke(nivelVoz);
            }
            catch { /* un tic tardío después de cerrar no tumba nada */ }
        }, null, 80, 80);
    }

    /// <summary>Pasa la voz que espera al reproductor sin pasarse de su búfer corto (desde la red o el reloj de 80 ms).</summary>
    void Alimentar()
    {
        lock (candadoBoca)
        {
            var b = boca; var e = espera;
            if (b == null || e == null) return;
            var libre = b.BufferLength - b.BufferedBytes;
            // De a bloques enteros de muestra (2 bytes): nunca medio número.
            libre -= libre % 2;
            if (libre <= 0) return;
            if (e.Sacar(libre) is { Length: > 0 } pcm) b.AddSamples(pcm, 0, pcm.Length);
        }
    }

    readonly object candadoBoca = new();

    void AbrirMicrofono()
    {
        mic = new WaveInEvent { WaveFormat = new WaveFormat(entrada.Muestreo, 16, 1), BufferMilliseconds = MsBloque, NumberOfBuffers = 4 };
        mic.DataAvailable += (s, e) =>
        {
            if (!ReferenceEquals(s, mic) || corte?.IsCancellationRequested != false) return;
            var pcm = new ReadOnlySpan<byte>(e.Buffer, 0, e.BytesRecorded);
            double rms = AgenteProtocolo.Rms(pcm);
            NivelMic?.Invoke(Math.Min(1, rms * 9));
            // Mudo, o AURA hablando (o recién terminando: la cola en el altavoz y el eco del cuarto) y esto suena
            // más bajo que su voz: silencio (el tiempo sigue corriendo). La tuya, cerca y más fuerte, pasa.
            bool cola = DateTime.UtcNow - ultimoSonido < TimeSpan.FromMilliseconds(500);
            bool tapar = Mudo || ((hablando || cola) && rms < Math.Max(0.05, nivelVoz * 0.12));
            // Audio: acotado (si la red no da abasto, se tira lo más viejo); el control (pong, avisos) nunca se tira.
            envios?.Audio(AgenteProtocolo.Audio(tapar ? new byte[e.BytesRecorded] : pcm));
        };
        mic.RecordingStopped += (_, e) => { if (e.Exception != null) Terminar("El micrófono se detuvo: " + e.Exception.Message); };
        mic.StartRecording();
    }

    int terminado;
    void Terminar(string? motivo)
    {
        lock (candado) { if (Interlocked.Exchange(ref terminado, 1) == 1) return; }
        envios?.VaciarAudio();
        envios?.Completar();
        relojBoca?.Dispose(); relojBoca = null;
        var m = mic; mic = null;
        if (m != null) { try { m.StopRecording(); } catch { } m.Dispose(); }
        var o = salida; salida = null;
        if (o != null) { try { o.Stop(); } catch { } o.Dispose(); }
        vozTirada = espera?.BytesDescartados ?? 0;
        espera?.Cortar();
        boca = null; espera = null;
        if (hablando) { hablando = false; Hablando?.Invoke(false); }
        var w = ws;
        if (w != null)
        {
            // Primero se despide (cierre limpio) y después se corta lo que quede esperando.
            _ = Task.Run(async () =>
            {
                try
                {
                    if (w.State == WebSocketState.Open)
                    {
                        using var t = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                        await w.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "", t.Token).ConfigureAwait(false);
                    }
                }
                catch { }
                finally { try { corte?.Cancel(); } catch { } w.Dispose(); }
            });
        }
        else { try { corte?.Cancel(); } catch { } }
        Cerrada?.Invoke(motivo);
    }

    /// <summary>Cuelga (a pedido: sin motivo).</summary>
    public void Cerrar() => Terminar(null);

    public void Dispose() => Cerrar();
}
