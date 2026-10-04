namespace Aura.Windows.Core;

/// <summary>
/// Lo que la conversación en vivo manda por el WebSocket (auditoría del 1-oct, H09). Dos colas:
///  · CONTROL (inicio, pong, avisos de la PC): pocos, nunca se tiran y salen primero;
///  · AUDIO del micrófono: ACOTADA. Si la red va lenta y se llena, se tira lo MÁS VIEJO (audio de hace
///    segundos ya no sirve para una conversación; lo último que dijiste, sí). Antes era una cola sin
///    límite: con la red lenta se acumulaba audio viejo sin fin.
/// </summary>
public sealed class ColaEnvio<T> where T : class
{
    readonly object candado = new();
    readonly Queue<T> control = new();
    readonly Queue<T> audio = new();
    readonly SemaphoreSlim hay = new(0);
    bool cerrada;

    /// <summary>Cuántos bloques de audio caben (con bloques de 50 ms, 20 = 1 s).</summary>
    public int CapacidadAudio { get; }
    /// <summary>Bloques de audio tirados por viejos desde que se abrió (métrica de profundidad).</summary>
    public long Descartados { get; private set; }
    /// <summary>Lo más hondo que llegó la cola de audio.</summary>
    public int ProfundidadMaxima { get; private set; }

    public ColaEnvio(int capacidadAudio) { CapacidadAudio = Math.Max(1, capacidadAudio); }

    public int ProfundidadAudio { get { lock (candado) return audio.Count; } }

    public bool Control(T m)
    {
        lock (candado)
        {
            if (cerrada) return false;
            control.Enqueue(m);
        }
        hay.Release();
        return true;
    }

    /// <summary>Encola un bloque de audio. Devuelve false si para que cupiera se tiró el más viejo (o si está cerrada).</summary>
    public bool Audio(T m)
    {
        bool tiro = false;
        lock (candado)
        {
            if (cerrada) return false;
            if (audio.Count >= CapacidadAudio) { audio.Dequeue(); Descartados++; tiro = true; }
            audio.Enqueue(m);
            ProfundidadMaxima = Math.Max(ProfundidadMaxima, audio.Count);
        }
        hay.Release();
        return !tiro;
    }

    /// <summary>Tira el audio que espera (al interrumpir o cancelar): lo de antes ya no hay que mandarlo.</summary>
    public int VaciarAudio()
    {
        lock (candado) { var n = audio.Count; audio.Clear(); return n; }
    }

    /// <summary>
    /// El siguiente mensaje (control primero). null cuando se cerró y no queda nada. El semáforo es solo un
    /// timbre: un permiso de más (de un bloque que ya se tiró) solo hace mirar otra vez las colas.
    /// </summary>
    public async Task<T?> Siguiente(CancellationToken ct)
    {
        while (true)
        {
            lock (candado)
            {
                if (control.Count > 0) return control.Dequeue();
                if (audio.Count > 0) return audio.Dequeue();
                if (cerrada) return null;
            }
            await hay.WaitAsync(ct).ConfigureAwait(false);
        }
    }

    /// <summary>Ya no entra nada; el lector termina cuando se vacíe.</summary>
    public void Completar()
    {
        lock (candado) cerrada = true;
        hay.Release();
    }
}

/// <summary>
/// La voz de AURA en vivo antes de llegar al altavoz (H09). El reproductor tiene un búfer CORTO (unos
/// segundos); lo que llega más rápido que lo que suena espera aquí, con un tope. Cada respuesta tiene su
/// GENERACIÓN: al interrumpir o mandarla callar se cambia de generación y todo lo de antes se tira (nunca
/// suena audio viejo después de «detener»).
/// </summary>
public sealed class ColaBoca
{
    readonly object candado = new();
    readonly LinkedList<byte[]> trozos = new();
    long bytes;

    /// <summary>Lo más que espera, en bytes (más que eso: se tira lo más viejo y se cuenta).</summary>
    public long TopeBytes { get; }
    public long Generacion { get; private set; }
    public long BytesDescartados { get; private set; }

    public ColaBoca(long topeBytes) { TopeBytes = Math.Max(1, topeBytes); }

    public long Pendiente { get { lock (candado) return bytes; } }

    /// <summary>Agrega un trozo de la generación dada; si es de una generación vieja, se tira.</summary>
    public bool Agregar(byte[] pcm, long generacion)
    {
        lock (candado)
        {
            if (generacion != Generacion || pcm.Length == 0) return false;
            trozos.AddLast(pcm); bytes += pcm.Length;
            while (bytes > TopeBytes && trozos.First != null)
            {
                var viejo = trozos.First.Value; trozos.RemoveFirst();
                bytes -= viejo.Length; BytesDescartados += viejo.Length;
            }
            return true;
        }
    }

    /// <summary>Saca hasta <paramref name="max"/> bytes (en trozos enteros, salvo el primero si no cabe nada más).</summary>
    public byte[]? Sacar(int max)
    {
        lock (candado)
        {
            if (trozos.First == null || max <= 0) return null;
            var primero = trozos.First.Value;
            if (primero.Length > max)
            {
                var parte = primero[..max];
                trozos.First.Value = primero[max..];
                bytes -= max;
                return parte;
            }
            var salida = new List<byte>(Math.Min(max, (int)Math.Min(bytes, int.MaxValue)));
            while (trozos.First != null && salida.Count + trozos.First.Value.Length <= max)
            {
                salida.AddRange(trozos.First.Value);
                bytes -= trozos.First.Value.Length;
                trozos.RemoveFirst();
            }
            return salida.ToArray();
        }
    }

    /// <summary>Tira todo y pasa a otra generación: lo que siga llegando de la respuesta anterior no suena.</summary>
    public long Cortar()
    {
        lock (candado)
        {
            trozos.Clear(); bytes = 0;
            return ++Generacion;
        }
    }
}
