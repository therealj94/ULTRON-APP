using System;
using System.Globalization;
using System.Linq;
using System.Speech.Recognition;

namespace Aura.Windows.Voz;

/// <summary>
/// «Oye AURA» / «Hey AURA»: una gramática de pocas palabras con el reconocedor de Windows, sin red.
/// Solo reconoce esas frases (no dicta nada) y solo corre si la persona lo activó en Ajustes.
/// Si Windows no tiene un reconocedor instalado, lo dice y no hace nada.
/// </summary>
internal sealed class Despertador : IDisposable
{
    SpeechRecognitionEngine? motor;
    public event Action? Desperto;
    public bool Activo => motor != null;

    public string? Encender(string idioma)
    {
        if (motor != null) return null;
        try
        {
            var todos = SpeechRecognitionEngine.InstalledRecognizers();
            var info = todos.FirstOrDefault(r => r.Culture.TwoLetterISOLanguageName == idioma) ?? todos.FirstOrDefault();
            if (info == null) return "Windows no tiene reconocimiento de voz instalado: la palabra de activación no está disponible. Usa Ctrl+Alt+Espacio.";
            var m = new SpeechRecognitionEngine(info);
            var frases = new Choices("oye aura", "hey aura", "ok aura", "oye claudio", "hey claudio", "oye antonio", "hey antonio", "oye guardián", "hey guardian");
            m.LoadGrammar(new Grammar(new GrammarBuilder(frases) { Culture = info.Culture }) { Name = "despertar" });
            m.SetInputToDefaultAudioDevice();
            m.SpeechRecognized += (_, e) => { if (e.Result.Confidence >= 0.72f) Desperto?.Invoke(); };
            m.RecognizeAsync(RecognizeMode.Multiple);
            motor = m;
            return null;
        }
        catch (Exception ex) { Apagar(); return "No pude activar la palabra de activación: " + ex.Message; }
    }

    public void Apagar()
    {
        var m = motor; motor = null;
        if (m == null) return;
        try { m.RecognizeAsyncCancel(); } catch { }
        m.Dispose();
    }

    public void Dispose() => Apagar();
}
