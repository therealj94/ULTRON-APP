using System;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Speech.Recognition;
using Aura.Windows.Core;
using NAudio.Wave;

namespace Aura.Windows.Voz;

/// <summary>
/// «Oye AURA» / «Hey AURA», sin red. Si está el modelo propio (Modelos/hey_aura.onnx, entrenado con
/// openWakeWord para «hey aura» y «oye aura»), lo usa: escucha en el equipo y nunca manda audio. Si no,
/// una gramática de pocas palabras con el reconocedor de Windows (SAPI), que se equivoca más.
/// </summary>
internal sealed class Despertador : IDisposable
{
    SpeechRecognitionEngine? motor;
    public event Action? Desperto;
    public bool Activo => motor != null || propio != null;

    readonly System.Collections.Generic.List<SpeechRecognitionEngine> extras = new();

    /// <summary>
    /// Verdadero mientras suena música (o algo que no es la persona): Windows oye «aura», «claudio» o «antonio» en
    /// las canciones y en el altavoz (1-oct 22:35–22:39: una activación falsa cada pocos segundos). Ahí se exige más.
    /// </summary>
    public Func<bool>? Exigente { get; set; }

    /// <summary>Frases de la gramática que existen solo para absorber lo que se parece a su nombre: no despiertan.</summary>
    internal static readonly System.Collections.Generic.HashSet<string> Senuelos = new(StringComparer.OrdinalIgnoreCase) { "oye laura" };

    /// <summary>
    /// Enciende el reconocedor de Windows del idioma (y el de inglés, que entiende mejor «hey aura»). Es un
    /// ATAJO: aunque no haya ninguno instalado, «Oye AURA» igual funciona por el oído de AURA (la frase que
    /// empieza con su nombre). Devuelve null o la explicación si no hay reconocedor.
    /// </summary>
    public string? Encender(string idioma)
    {
        // Los dos escuchan a la vez y cualquiera la despierta: el modelo propio (mejor con «hey aura») y el de
        // Windows (respaldo, y el único si no está el modelo). El propio no depende del idioma; el de Windows sí.
        if (propio == null) EncenderPropio();
        if (motor != null && idioma == idiomaEncendido) return null;
        if (motor != null) ApagarWindows();
        idiomaEncendido = idioma;
        try
        {
            var todos = SpeechRecognitionEngine.InstalledRecognizers();
            if (todos.Count == 0) return null; // sin reconocedor: queda el oído de AURA, no hace falta avisar
            var elegidos = todos.Where(r => r.Culture.TwoLetterISOLanguageName == idioma).Take(1)
                .Concat(todos.Where(r => r.Culture.TwoLetterISOLanguageName == "en").Take(1)).Distinct().ToList();
            if (elegidos.Count == 0) elegidos.Add(todos[0]);
            foreach (var info in elegidos)
            {
                var m = new SpeechRecognitionEngine(info);
                var frases = new Choices("oye aura", "hey aura", "ok aura", "hola aura", "ey aura", "aura", "oye laura",
                                         "oye claudio", "hey claudio", "oye antonio", "hey antonio", "oye guardián", "hey guardian");
                m.LoadGrammar(new Grammar(new GrammarBuilder(frases) { Culture = info.Culture }) { Name = "despertar" });
                m.SetInputToDefaultAudioDevice();
                m.SpeechRecognized += (_, e) =>
                {
                    Centro.Registro.Anotar("despertar", $"Windows ({info.Culture.Name}) oyó «{e.Result.Text}» con {e.Result.Confidence:0.00}");
                    // Los señuelos («oye laura») están en la gramática para que SAPI no los confunda con «oye aura»: nunca despiertan.
                    if (Senuelos.Contains(e.Result.Text)) return;
                    bool exigente = Exigente?.Invoke() == true;
                    // Con el modelo propio cuidando y algo sonando en la PC, Windows no decide: es el que se equivoca
                    // con las canciones y los videos (1-oct: «oye claudio» 0,83, «hey guardian» 0,86 desde la música).
                    if (propio != null && exigente) return;
                    var minimo = UmbralesDespertar.MinimoWindows(e.Result.Text, propio != null, exigente);
                    if (e.Result.Confidence < minimo) return;
                    // Una sola espera para todos: el de español y el de inglés oyen el mismo sonido a la vez.
                    if (DateTime.Now - ultimaVez < TimeSpan.FromSeconds(2)) return;
                    ultimaVez = DateTime.Now;
                    Desperto?.Invoke();
                };
                m.RecognizeAsync(RecognizeMode.Multiple);
                if (motor == null) motor = m; else extras.Add(m);
            }
            Centro.Registro.Anotar("despertar", "reconocedor de Windows: " + string.Join(", ", elegidos.Select(x => x.Culture.Name)));
            return null;
        }
        catch (Exception ex) { ApagarWindows(); Centro.Registro.Anotar("despertar", ex.Message); return null; }
    }

    // ───────────── el modelo propio (openWakeWord) ─────────────

    /// <summary>
    /// Lo mínimo para despertar (0..1). Con 0,9 (medido el 1-oct, modelo v3): 67 % de «oye aura» en español y 90 % de
    /// «hey aura» que no vio al entrenar, 0 % de frases parecidas y ~0,56 falsas por hora de audio general. Ahora
    /// 0,75 sostenido dos trozos seguidos (o 0,9 de una): ConfirmaPalabra, en Aura.Windows.Core, probado.
    /// </summary>
    public const float Umbral = ConfirmaPalabra.Umbral;
    /// <summary>Con música sonando: un trozo así de seguro.</summary>
    public const float UmbralConMusica = 0.97f;
    readonly ConfirmaPalabra confirma = new();
    PalabraClave? propio;
    WaveInEvent? micPropio;
    /// <summary>El hilo del micrófono usa el modelo mientras otro lo apaga: nunca a la vez (es memoria nativa).</summary>
    readonly object candadoPropio = new();
    string idiomaEncendido = "";
    DateTime ultimaVez = DateTime.MinValue;
    public bool UsaModeloPropio => propio != null;

    static string CarpetaModelos => Path.Combine(AppContext.BaseDirectory, "Modelos");

    bool EncenderPropio()
    {
        var modelo = Path.Combine(CarpetaModelos, "hey_aura.onnx");
        if (!File.Exists(modelo) || !File.Exists(Path.Combine(CarpetaModelos, "melspectrogram.onnx"))) return false;
        try
        {
            // onnxruntime.dll (y el runtime de C++) de la carpeta de AURA, por ruta completa: nunca otra copia.
            MotorOnnx.Preparar();
            var pc = new PalabraClave(CarpetaModelos, modelo);
            var mic = new WaveInEvent { WaveFormat = new WaveFormat(PalabraClave.Muestreo, 16, 1), BufferMilliseconds = 80, NumberOfBuffers = 4 };
            mic.DataAvailable += (s, e) =>
            {
                if (!ReferenceEquals(s, micPropio) || propio == null) return;
                var muestras = new short[e.BytesRecorded / 2];
                Buffer.BlockCopy(e.Buffer, 0, muestras, 0, muestras.Length * 2);
                Guardar(e.Buffer, e.BytesRecorded);
                float p;
                lock (candadoPropio)
                {
                    if (propio == null) return;
                    try { p = propio.Alimentar(muestras); } catch { return; }
                }
                Anotar(p);
                // Una vez por llamada: la misma palabra da varios trozos seguidos por encima del umbral.
                // Con música, el modelo propio también pide más: un trozo de 0,97 (las canciones traen palabras parecidas).
                bool cuenta = confirma.Alimentar(p) && (Exigente?.Invoke() != true || p >= UmbralConMusica);
                if (!cuenta || DateTime.Now - ultimaVez < TimeSpan.FromSeconds(2)) return;
                ultimaVez = DateTime.Now;
                Centro.Registro.Anotar("despertar", $"«Hey AURA» (modelo propio) con {p:0.00}");
                Desperto?.Invoke();
            };
            mic.RecordingStopped += (s, e) =>
            {
                if (!ReferenceEquals(s, micPropio)) return; // lo apagamos nosotros
                // Se desconectó el micrófono (audífonos, USB) o Windows lo soltó. Antes el modelo quedaba «encendido»
                // pero sordo y, como con él Windows no despierta con «aura», «Oye AURA» dejaba de funcionar hasta
                // reiniciar. Ahora se apaga y se vuelve a encender solo.
                Centro.Registro.Anotar("despertar", "el micrófono del modelo propio se detuvo" + (e.Exception != null ? ": " + e.Exception.Message : "") + " · lo vuelvo a abrir");
                ApagarPropio();
                reintento?.Dispose();
                reintento = new System.Threading.Timer(_ => { if (!apagado && propio == null) EncenderPropio(); }, null, TimeSpan.FromSeconds(2), System.Threading.Timeout.InfiniteTimeSpan);
            };
            propio = pc; micPropio = mic;
            mic.StartRecording();
            Centro.Registro.Anotar("despertar", $"modelo propio «hey aura» (en el equipo, sin red) · ONNX Runtime {MotorOnnx.VersionNativa()} (CPU)"
                + (MotorOnnx.RutaCargada != null ? " · desde la carpeta de AURA" : " · por la búsqueda de Windows"));
            return true;
        }
        catch (Exception ex)
        {
            ApagarPropio();
            // La cadena COMPLETA (no solo «The type initializer…»), con la versión y qué piezas hay junto a AURA.
            Centro.Registro.Anotar("despertar", "el modelo propio no arrancó: " + MotorOnnx.Diagnostico(ex) + " · sigo con el de Windows");
            return false;
        }
    }

    System.Threading.Timer? reintento;
    bool apagado;

    // ───────────── lo último que oyó (para no perder lo dicho mientras se abre la voz en vivo) ─────────────
    // 3 s de audio del micrófono del modelo propio (16 kHz, 16 bits, mono), en anillo, con la hora de cada trozo.
    const int SegundosAnillo = 3;
    readonly System.Collections.Generic.Queue<(DateTime t, byte[] pcm)> anillo = new();
    int bytesAnillo;

    void Guardar(byte[] buf, int n)
    {
        var copia = new byte[n];
        Buffer.BlockCopy(buf, 0, copia, 0, n);
        lock (anillo)
        {
            anillo.Enqueue((DateTime.UtcNow, copia));
            bytesAnillo += n;
            while (bytesAnillo > SegundosAnillo * PalabraClave.Muestreo * 2 && anillo.Count > 0) bytesAnillo -= anillo.Dequeue().pcm.Length;
        }
    }

    /// <summary>
    /// El audio que oyó el micrófono desde `desdeUtc` (16 kHz, 16 bits, mono), o null sin modelo propio. «Oye AURA,
    /// pon música» de corrido: mientras la voz en vivo conecta (~1 s) nadie escuchaba y «pon música» se perdía.
    /// </summary>
    public byte[]? AudioDesde(DateTime desdeUtc)
    {
        if (propio == null) return null;
        lock (anillo)
        {
            var trozos = anillo.Where(x => x.t >= desdeUtc).Select(x => x.pcm).ToList();
            if (trozos.Count == 0) return null;
            var todo = new byte[trozos.Sum(x => x.Length)];
            int i = 0;
            foreach (var x in trozos) { Buffer.BlockCopy(x, 0, todo, i, x.Length); i += x.Length; }
            return todo;
        }
    }
    // Los puntajes recientes del modelo (con su hora): para saber si una frase sonó a «hey aura» aunque no despertó.
    readonly System.Collections.Generic.Queue<(DateTime t, float p)> recientes = new();

    void Anotar(float p)
    {
        lock (recientes)
        {
            recientes.Enqueue((DateTime.UtcNow, p));
            while (recientes.Count > 0 && DateTime.UtcNow - recientes.Peek().t > TimeSpan.FromSeconds(30)) recientes.Dequeue();
        }
    }

    /// <summary>El puntaje más alto del modelo propio desde `desde` (0 si no hay modelo o no oyó nada parecido).</summary>
    public float MaxDesde(DateTime desdeUtc)
    {
        lock (recientes)
        {
            float max = 0;
            foreach (var (t, p) in recientes) if (t >= desdeUtc && p > max) max = p;
            return max;
        }
    }

    void ApagarPropio()
    {
        var m = micPropio; micPropio = null;
        if (m != null) { try { m.StopRecording(); } catch { } m.Dispose(); }
        lock (candadoPropio)
        {
            var p = propio; propio = null;
            p?.Dispose();
        }
    }

    public void Apagar()
    {
        ApagarPropio();
        ApagarWindows();
    }

    void ApagarWindows()
    {
        var m = motor; motor = null;
        foreach (var x in extras) { try { x.RecognizeAsyncCancel(); } catch { } x.Dispose(); }
        extras.Clear();
        if (m == null) return;
        try { m.RecognizeAsyncCancel(); } catch { }
        m.Dispose();
    }

    public void Dispose() { apagado = true; reintento?.Dispose(); Apagar(); }
}
