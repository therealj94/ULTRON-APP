using System;
using System.Collections.Generic;
using System.IO;
using Aura.Windows.Core;
using NAudio.Wave;

namespace Aura.Windows.Voz;

/// <summary>
/// El oído de AURA: el micrófono a 16 kHz mono con un detector de voz por energía (piso de ruido que se
/// adapta). Entrega la FRASE completa (WAV) cuando la persona termina de hablar; el servidor la
/// transcribe (Whisper/Scribe). Mientras AURA habla, el umbral sube (el altavoz no la interrumpe) y
/// una voz sostenida por encima de eso es una interrupción.
/// El micrófono SOLO está abierto cuando `Abierto` es true, y el notch lo muestra.
/// </summary>
internal sealed class Oido : IDisposable
{
    const int Muestreo = 16000;
    const int MsBloque = DetectorVoz.MsBloque;
    WaveInEvent? mic;
    readonly List<byte> frase = new();
    readonly Queue<byte[]> previo = new();
    /// <summary>Cuándo empieza y termina una frase, y el piso de ruido (Aura.Windows.Core, probado).</summary>
    readonly DetectorVoz det = new() { Continuo = false };

    public bool Abierto => mic != null;
    /// <summary>Está oyendo una frase ahora mismo (empezó a hablar y todavía no termina).</summary>
    public bool OyendoFrase => mic != null && det.Hablando;
    /// <summary>Esperando voz: después de este tiempo sin que nadie hable, se cierra (salvo en continuo).</summary>
    public int EsperaMaxMs { get => det.EsperaMaxMs; set => det.EsperaMaxMs = value; }
    public bool Continuo { get => det.Continuo; set => det.Continuo = value; }
    /// <summary>AURA está hablando: más umbral, y lo que pase es una interrupción.</summary>
    public bool ModoInterrupcion { get => det.ModoInterrupcion; set => det.ModoInterrupcion = value; }
    public int SilencioFinMs { get => det.SilencioFinMs; set => det.SilencioFinMs = value; }
    /// <summary>Cuánto suena AURA ahora (0..1): su propia voz que vuelve por el micrófono no es una interrupción.</summary>
    public double NivelAltavoz { get => det.NivelAltavoz; set => det.NivelAltavoz = value; }

    public event Action<double>? Nivel;
    public event Action? EmpezoAHablar;
    public event Action<byte[]>? Frase;
    public event Action? SeCanso;
    public event Action<string>? Fallo;

    public void Abrir()
    {
        if (mic != null) { Reiniciar(); return; }
        try
        {
            mic = new WaveInEvent { WaveFormat = new WaveFormat(Muestreo, 16, 1), BufferMilliseconds = MsBloque, NumberOfBuffers = 4 };
            var este = mic;
            mic.DataAvailable += AlLlegar;
            // Solo cuenta el fallo del micrófono ACTUAL: uno viejo que muere tarde no cierra el nuevo.
            mic.RecordingStopped += (_, e) => { if (e.Exception != null && ReferenceEquals(este, mic)) Fallo?.Invoke("El micrófono se detuvo: " + e.Exception.Message); };
            Reiniciar();
            mic.StartRecording();
        }
        catch (Exception ex)
        {
            Cerrar();
            Fallo?.Invoke(WaveInEvent.DeviceCount == 0 ? "No encontré un micrófono. Conecta uno o revisa Configuración → Privacidad → Micrófono." : "No pude abrir el micrófono: " + ex.Message);
        }
    }

    void Reiniciar() { lock (frase) { frase.Clear(); previo.Clear(); det.Reiniciar(); } }

    public void Cerrar()
    {
        var m = mic; mic = null;
        if (m == null) return;
        m.DataAvailable -= AlLlegar;
        try { m.StopRecording(); } catch { }
        m.Dispose();
        Reiniciar();
    }

    void AlLlegar(object? s, WaveInEventArgs e)
    {
        if (!ReferenceEquals(s, mic)) return;
        double suma = 0; int n = e.BytesRecorded / 2;
        for (int i = 0; i < e.BytesRecorded - 1; i += 2) { double v = BitConverter.ToInt16(e.Buffer, i) / 32768.0; suma += v * v; }
        double rms = n > 0 ? Math.Sqrt(suma / n) : 0;
        Nivel?.Invoke(Math.Min(1, rms * 9));
        var bloque = new byte[e.BytesRecorded];
        Buffer.BlockCopy(e.Buffer, 0, bloque, 0, e.BytesRecorded);
        byte[]? lista = null; bool empezo = false, canso = false;
        lock (frase)
        {
            bool yaHablando = det.Hablando;
            switch (det.Bloque(rms))
            {
                case EventoVoz.Empezo:
                    empezo = true;
                    foreach (var b in previo) frase.AddRange(b); // 400 ms antes de la primera sílaba
                    previo.Clear();
                    frase.AddRange(bloque);
                    break;
                case EventoVoz.Fin:
                    frase.AddRange(bloque);
                    lista = Wav(Normalizar(frase.ToArray()));
                    frase.Clear();
                    break;
                case EventoVoz.Ruido:
                    // 25 s sin una pausa: ruido del cuarto. No va al transcriptor.
                    frase.Clear();
                    break;
                case EventoVoz.Canso:
                    canso = true;
                    goto default;
                default:
                    if (yaHablando) frase.AddRange(bloque);
                    else { previo.Enqueue(bloque); while (previo.Count > 20) previo.Dequeue(); }
                    break;
            }
        }
        if (empezo) EmpezoAHablar?.Invoke();
        if (lista != null && lista.Length > 44 + Muestreo / 2) Frase?.Invoke(lista); // menos de 0,25 s de audio no es una frase
        if (canso) SeCanso?.Invoke();
    }

    /// <summary>
    /// Sube el volumen de la frase para que el pico quede cerca de -3 dB (máximo ×8): el micrófono de una laptop
    /// a un metro llega muy bajo y el transcriptor se equivoca más. Nunca la satura; si ya viene fuerte, no la toca.
    /// </summary>
    public static byte[] Normalizar(byte[] pcm)
    {
        int pico = 1;
        for (int i = 0; i + 1 < pcm.Length; i += 2) pico = Math.Max(pico, Math.Abs((int)BitConverter.ToInt16(pcm, i)));
        double g = Math.Min(8.0, 0.7 * short.MaxValue / pico);
        if (g <= 1.15) return pcm;
        var o = new byte[pcm.Length];
        for (int i = 0; i + 1 < pcm.Length; i += 2)
        {
            int v = (int)Math.Round(BitConverter.ToInt16(pcm, i) * g);
            v = Math.Clamp(v, short.MinValue, short.MaxValue);
            o[i] = (byte)(v & 0xFF); o[i + 1] = (byte)((v >> 8) & 0xFF);
        }
        return o;
    }

    public static byte[] Wav(byte[] pcm)
    {
        using var ms = new MemoryStream();
        using (var w = new WaveFileWriter(ms, new WaveFormat(Muestreo, 16, 1))) w.Write(pcm, 0, pcm.Length);
        return ms.ToArray();
    }

    public void Dispose() => Cerrar();
}
