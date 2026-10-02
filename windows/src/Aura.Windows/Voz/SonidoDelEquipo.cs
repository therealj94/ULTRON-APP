using System;
using System.Threading;
using NAudio.Wave;

namespace Aura.Windows.Voz;

/// <summary>
/// ¿Está sonando algo en la PC? Escucha la salida del equipo (WASAPI loopback, sin micrófono ni red) y guarda el
/// nivel de los últimos 2 s. Antes «hay música» solo lo sabía si el reproductor avisaba a Windows (controles de
/// medios): un video en el navegador, un juego o una llamada no contaban, y su audio despertaba a AURA
/// (1-oct, decenas de «Oye AURA» falsos). Con esto el despertar se pone exigente con CUALQUIER sonido del equipo.
/// Si el dispositivo de salida cambia o se cae, se vuelve a abrir solo.
/// </summary>
internal sealed class SonidoDelEquipo : IDisposable
{
    /// <summary>Nivel (RMS, 0..1) por encima del cual se considera que algo suena.</summary>
    public const float Umbral = 0.01f;
    const int VentanaMs = 2000;

    WasapiLoopbackCapture? captura;
    readonly object candado = new();
    // Nivel por trozo con su hora: se queda el máximo de la ventana.
    readonly System.Collections.Generic.Queue<(long ms, float rms)> trozos = new();
    bool apagado;
    Timer? reintento;

    public bool Sonando => Nivel() > Umbral;

    public float Nivel()
    {
        var ahora = Environment.TickCount64;
        lock (candado)
        {
            while (trozos.Count > 0 && ahora - trozos.Peek().ms > VentanaMs) trozos.Dequeue();
            float max = 0;
            foreach (var t in trozos) if (t.rms > max) max = t.rms;
            return max;
        }
    }

    public void Encender()
    {
        if (apagado || captura != null) return;
        try
        {
            var c = new WasapiLoopbackCapture();
            c.DataAvailable += (s, e) =>
            {
                if (!ReferenceEquals(s, captura) || e.BytesRecorded == 0) return;
                var rms = Rms(e.Buffer, e.BytesRecorded, c.WaveFormat);
                lock (candado)
                {
                    trozos.Enqueue((Environment.TickCount64, rms));
                    while (trozos.Count > 400) trozos.Dequeue();
                }
            };
            c.RecordingStopped += (s, e) =>
            {
                if (!ReferenceEquals(s, captura)) return;
                if (e.Exception != null) Centro.Registro.Anotar("despertar", "la salida de audio se detuvo: " + e.Exception.Message + " · la vuelvo a abrir");
                Reabrir();
            };
            captura = c;
            c.StartRecording();
        }
        catch (Exception ex)
        {
            Centro.Registro.Anotar("despertar", "no pude oír la salida del equipo (sigo sin eso): " + ex.Message);
            Reabrir();
        }
    }

    void Reabrir()
    {
        Cerrar();
        if (apagado) return;
        reintento?.Dispose();
        reintento = new Timer(_ => Encender(), null, TimeSpan.FromSeconds(3), Timeout.InfiniteTimeSpan);
    }

    void Cerrar()
    {
        var c = captura; captura = null;
        if (c == null) return;
        try { c.StopRecording(); } catch { }
        try { c.Dispose(); } catch { }
    }

    /// <summary>RMS de un trozo: el loopback llega en float 32 (lo normal) o en PCM 16.</summary>
    internal static float Rms(byte[] buf, int bytes, WaveFormat f)
    {
        double suma = 0; int n = 0;
        if (f.Encoding == WaveFormatEncoding.IeeeFloat || (f.Encoding == WaveFormatEncoding.Extensible && f.BitsPerSample == 32))
        {
            for (int i = 0; i + 4 <= bytes; i += 4) { var v = BitConverter.ToSingle(buf, i); suma += v * v; n++; }
        }
        else if (f.BitsPerSample == 16)
        {
            for (int i = 0; i + 2 <= bytes; i += 2) { var v = BitConverter.ToInt16(buf, i) / 32768.0; suma += v * v; n++; }
        }
        return n == 0 ? 0 : (float)Math.Sqrt(suma / n);
    }

    public void Dispose()
    {
        apagado = true;
        reintento?.Dispose();
        Cerrar();
    }
}
