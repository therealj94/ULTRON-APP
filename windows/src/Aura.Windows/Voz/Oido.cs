using System;
using System.Collections.Generic;
using System.IO;
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
    const int MsBloque = 20;
    WaveInEvent? mic;
    readonly List<byte> frase = new();
    readonly Queue<byte[]> previo = new();
    double piso = 0.004;
    bool hablando;
    int msVoz, msSilencio, msTotal, msEsperando;

    public bool Abierto => mic != null;
    /// <summary>Esperando voz: después de este tiempo sin que nadie hable, se cierra (salvo en continuo).</summary>
    public int EsperaMaxMs { get; set; } = 8000;
    public bool Continuo { get; set; }
    /// <summary>AURA está hablando: más umbral, y lo que pase es una interrupción.</summary>
    public bool ModoInterrupcion { get; set; }
    public int SilencioFinMs { get; set; } = 750;
    /// <summary>Cuánto suena AURA ahora (0..1): su propia voz que vuelve por el micrófono no es una interrupción.</summary>
    public double NivelAltavoz { get; set; }

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

    void Reiniciar() { lock (frase) { frase.Clear(); previo.Clear(); hablando = false; msVoz = msSilencio = msTotal = msEsperando = 0; } }

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
            double umbral = Math.Max(0.012, piso * (ModoInterrupcion ? 7 : 3.2));
            if (ModoInterrupcion) umbral = Math.Max(Math.Max(umbral, 0.05), NivelAltavoz * 0.22);
            // Ya hablando, el final de la frase suele bajar («…en Spotify»): con menos umbral no se corta la cola.
            bool voz = rms > (hablando && !ModoInterrupcion ? umbral * 0.6 : umbral);
            if (!hablando)
            {
                // El piso solo aprende del silencio (y despacio): la voz no lo sube.
                if (!voz) piso = piso * 0.97 + rms * 0.03;
                previo.Enqueue(bloque);
                while (previo.Count > 20) previo.Dequeue(); // 400 ms antes de la primera sílaba
                msVoz = voz ? msVoz + MsBloque : Math.Max(0, msVoz - MsBloque);
                msEsperando += MsBloque;
                if (msVoz >= (ModoInterrupcion ? 260 : 120))
                {
                    hablando = true; empezo = true; msSilencio = 0; msTotal = 0;
                    foreach (var b in previo) frase.AddRange(b);
                    previo.Clear();
                }
                else if (!Continuo && msEsperando > EsperaMaxMs) { canso = true; msEsperando = int.MinValue / 2; } // avisa UNA vez
            }
            else
            {
                frase.AddRange(bloque);
                msTotal += MsBloque;
                msSilencio = voz ? 0 : msSilencio + MsBloque;
                if (msSilencio >= SilencioFinMs || msTotal >= 25000)
                {
                    lista = Wav(Normalizar(frase.ToArray()));
                    frase.Clear(); hablando = false; msVoz = 0; msEsperando = 0;
                }
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
