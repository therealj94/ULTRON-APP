using System;
using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Channels;
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
/// </summary>
internal sealed class AgenteVoz : IDisposable
{
    const int MsBloque = 50;
    ClientWebSocket? ws;
    WaveInEvent? mic;
    WaveOutEvent? salida;
    BufferedWaveProvider? boca;
    CancellationTokenSource? corte;
    Channel<string>? envios;
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
    public async Task Abrir(PermisoAgente permiso, CancellationToken ct)
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
        envios = Channel.CreateUnbounded<string>(new UnboundedChannelOptions { SingleReader = true });
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
            AbrirMicrofono();
        }
    }

    /// <summary>Calla lo que está diciendo (sin colgar). Su próxima respuesta vuelve a sonar.</summary>
    public void CallarVoz()
    {
        callada = true;
        try { boca?.ClearBuffer(); } catch { }
    }

    void Mandar(string json) => envios?.Writer.TryWrite(json);

    async Task BucleEnvio(CancellationToken ct)
    {
        try
        {
            await foreach (var m in envios!.Reader.ReadAllAsync(ct).ConfigureAwait(false))
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
                boca?.AddSamples(a.Pcm, 0, a.Pcm.Length);
                nivelVoz = Math.Max(nivelVoz, Math.Min(1, AgenteProtocolo.Rms(a.Pcm) * 6));
                break;
            case AgenteInterrumpido i:
                // Lo que ya estaba en camino de antes de la interrupción no suena.
                interrumpidoHasta = Math.Max(interrumpidoHasta, i.EventoId);
                boca?.ClearBuffer();
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
        boca = new BufferedWaveProvider(new WaveFormat(sale.Muestreo, 16, 1)) { BufferDuration = TimeSpan.FromSeconds(60), DiscardOnBufferOverflow = true, ReadFully = true };
        salida = new WaveOutEvent { DesiredLatency = 120 };
        salida.Init(boca);
        salida.Play();
        // Cada 80 ms: ¿suena algo? y el nivel para la boca del avatar (baja solo entre trozos).
        relojBoca = new Timer(_ =>
        {
            try
            {
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
            Mandar(AgenteProtocolo.Audio(tapar ? new byte[e.BytesRecorded] : pcm));
        };
        mic.RecordingStopped += (_, e) => { if (e.Exception != null) Terminar("El micrófono se detuvo: " + e.Exception.Message); };
        mic.StartRecording();
    }

    int terminado;
    void Terminar(string? motivo)
    {
        lock (candado) { if (Interlocked.Exchange(ref terminado, 1) == 1) return; }
        envios?.Writer.TryComplete();
        relojBoca?.Dispose(); relojBoca = null;
        var m = mic; mic = null;
        if (m != null) { try { m.StopRecording(); } catch { } m.Dispose(); }
        var o = salida; salida = null;
        if (o != null) { try { o.Stop(); } catch { } o.Dispose(); }
        boca = null;
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
