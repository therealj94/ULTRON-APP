namespace Aura.Windows.Core;

/// <summary>Lo que pasó con un bloque de audio.</summary>
public enum EventoVoz { Nada, Empezo, Fin, Ruido, Canso }

/// <summary>
/// El detector de voz por energía del oído (Voz/Oido.cs), sin el micrófono adentro, para probarlo.
/// Bloques de 20 ms: decide cuándo empieza una frase (120 ms de voz; 260 ms si AURA habla) y cuándo
/// termina (SilencioFinMs de silencio).
///
/// El piso de ruido baja rápido con el silencio y sube despacio siempre, también con lo que parece voz.
/// Antes solo aprendía del silencio, y si el ruido de un cuarto (ventilador, aire, calle) pasaba del
/// umbral desde el arranque nunca lo aprendía: frases de 25 s de puro ruido, una tras otra, al
/// transcriptor. Ahora una frase que llega al tope sin una pausa es ruido: se tira (EventoVoz.Ruido) y el
/// piso salta a su nivel, así que pasa una vez como mucho y nunca llega al transcriptor.
/// </summary>
public sealed class DetectorVoz
{
    public const int MsBloque = 20;
    public const int TopeFraseMs = 25000;

    public int SilencioFinMs { get; set; } = 750;
    public bool ModoInterrupcion { get; set; }
    public double NivelAltavoz { get; set; }
    public bool Continuo { get; set; } = true;
    public int EsperaMaxMs { get; set; } = 8000;

    public double Piso { get; private set; } = 0.004;
    public bool Hablando { get; private set; }

    int msVoz, msSilencio, msTotal, msEsperando;
    double sumaFrase; int bloquesFrase;

    public void Reiniciar() { Hablando = false; msVoz = msSilencio = msTotal = msEsperando = 0; sumaFrase = 0; bloquesFrase = 0; }

    public double Umbral()
    {
        double u = Math.Max(0.012, Piso * (ModoInterrupcion ? 7 : 3.2));
        if (ModoInterrupcion) u = Math.Max(Math.Max(u, 0.05), NivelAltavoz * 0.22);
        return u;
    }

    /// <summary>Un bloque de 20 ms con su energía (RMS, 0–1).</summary>
    public EventoVoz Bloque(double rms)
    {
        double umbral = Umbral();
        // Ya hablando, el final de la frase suele bajar («…en Spotify»): con menos umbral no se corta la cola.
        bool voz = rms > (Hablando && !ModoInterrupcion ? umbral * 0.6 : umbral);
        // Baja rápido con el silencio. Sube despacio: entre frases (~4 s) aprende un ruido que no se va;
        // durante una frase casi nada (~40 s), para que una voz larga no se suba el umbral a sí misma.
        if (rms < Piso) Piso = Piso * 0.9 + rms * 0.1;
        else { double k = Hablando ? 0.0005 : 0.005; Piso = Piso * (1 - k) + rms * k; }
        if (!Hablando)
        {
            msVoz = voz ? msVoz + MsBloque : Math.Max(0, msVoz - MsBloque);
            msEsperando += MsBloque;
            if (msVoz >= (ModoInterrupcion ? 260 : 120))
            {
                Hablando = true; msSilencio = 0; msTotal = 0; sumaFrase = 0; bloquesFrase = 0;
                return EventoVoz.Empezo;
            }
            if (!Continuo && msEsperando > EsperaMaxMs) { msEsperando = int.MinValue / 2; return EventoVoz.Canso; } // avisa UNA vez
            return EventoVoz.Nada;
        }
        msTotal += MsBloque;
        sumaFrase += rms; bloquesFrase++;
        msSilencio = voz ? 0 : msSilencio + MsBloque;
        if (msSilencio >= SilencioFinMs) { Hablando = false; msVoz = 0; msEsperando = 0; return EventoVoz.Fin; }
        if (msTotal >= TopeFraseMs)
        {
            // Nadie habla 25 s sin una pausa: era ruido. El piso salta a su nivel para no repetirlo.
            Piso = Math.Max(Piso, sumaFrase / Math.Max(1, bloquesFrase) * 0.8);
            Hablando = false; msVoz = 0; msEsperando = 0;
            return EventoVoz.Ruido;
        }
        return EventoVoz.Nada;
    }
}
