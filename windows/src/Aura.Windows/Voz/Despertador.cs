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
                    // «aura» sola pide más seguridad (se parece a otras palabras); con «oye/hey» basta menos.
                    var minimo = e.Result.Text == "aura" ? 0.75f : 0.55f;
                    if (e.Result.Confidence >= minimo) Desperto?.Invoke();
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
            var pc = new PalabraClave(CarpetaModelos, modelo);
            var mic = new WaveInEvent { WaveFormat = new WaveFormat(PalabraClave.Muestreo, 16, 1), BufferMilliseconds = 80, NumberOfBuffers = 4 };
            mic.DataAvailable += (s, e) =>
            {
                if (!ReferenceEquals(s, micPropio) || propio == null) return;
                var muestras = new short[e.BytesRecorded / 2];
                Buffer.BlockCopy(e.Buffer, 0, muestras, 0, muestras.Length * 2);
                float p;
                lock (candadoPropio)
                {
                    if (propio == null) return;
                    try { p = propio.Alimentar(muestras); } catch { return; }
                }
                // Una vez por llamada: la misma palabra da varios trozos seguidos por encima del umbral.
                if (!confirma.Alimentar(p) || DateTime.Now - ultimaVez < TimeSpan.FromSeconds(2)) return;
                ultimaVez = DateTime.Now;
                Centro.Registro.Anotar("despertar", $"«Hey AURA» (modelo propio) con {p:0.00}");
                Desperto?.Invoke();
            };
            mic.RecordingStopped += (_, e) => { if (e.Exception != null) Centro.Registro.Anotar("despertar", "el micrófono se detuvo: " + e.Exception.Message); };
            propio = pc; micPropio = mic;
            mic.StartRecording();
            Centro.Registro.Anotar("despertar", "modelo propio «hey aura» (en el equipo, sin red)");
            return true;
        }
        catch (Exception ex)
        {
            ApagarPropio();
            Centro.Registro.Anotar("despertar", "el modelo propio no arrancó: " + ex.Message + " · sigo con el de Windows");
            return false;
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

    public void Dispose() => Apagar();
}
