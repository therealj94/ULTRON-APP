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

    readonly System.Collections.Generic.List<SpeechRecognitionEngine> extras = new();

    /// <summary>
    /// Enciende el reconocedor de Windows del idioma (y el de inglés, que entiende mejor «hey aura»). Es un
    /// ATAJO: aunque no haya ninguno instalado, «Oye AURA» igual funciona por el oído de AURA (la frase que
    /// empieza con su nombre). Devuelve null o la explicación si no hay reconocedor.
    /// </summary>
    public string? Encender(string idioma)
    {
        if (motor != null) return null;
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
        catch (Exception ex) { Apagar(); Centro.Registro.Anotar("despertar", ex.Message); return null; }
    }

    public void Apagar()
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
