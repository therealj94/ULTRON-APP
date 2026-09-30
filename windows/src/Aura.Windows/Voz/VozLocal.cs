using System;
using System.IO;
using System.Linq;
using System.Speech.Recognition;
using System.Threading;
using System.Threading.Tasks;
using Aura.Windows.Core;

namespace Aura.Windows.Voz;

/// <summary>
/// La voz y el oído de Windows, sin red: respaldo cuando el servidor no contesta, o siempre si se elige
/// en Ajustes. Hablar usa las voces neuronales/OneCore de Windows (WinRT) y sale por el MISMO altavoz,
/// así la boca del avatar se mueve igual. Oír usa el dictado de Windows sobre la frase que ya grabó el
/// oído. No suena como ElevenLabs, pero nunca deja a AURA muda ni sorda.
/// </summary>
internal static class VozLocal
{
    /// <summary>La voz de Windows del idioma; hombre para Claudio, ANT-ONIO y el Guardián, mujer para AU-RA.</summary>
    static global::Windows.Media.SpeechSynthesis.VoiceInformation? Elegir(string idioma, string avatar)
    {
        var todas = global::Windows.Media.SpeechSynthesis.SpeechSynthesizer.AllVoices;
        var delIdioma = todas.Where(v => v.Language.StartsWith(idioma, StringComparison.OrdinalIgnoreCase)).ToList();
        if (delIdioma.Count == 0) return null;
        var genero = avatar == "aura" ? global::Windows.Media.SpeechSynthesis.VoiceGender.Female : global::Windows.Media.SpeechSynthesis.VoiceGender.Male;
        // Preferir las de Latinoamérica (es-MX) a las de España para el español.
        return delIdioma.OrderByDescending(v => v.Gender == genero).ThenByDescending(v => v.Language.Equals("es-MX", StringComparison.OrdinalIgnoreCase)).First();
    }

    public static bool HayVoz(string idioma) { try { return global::Windows.Media.SpeechSynthesis.SpeechSynthesizer.AllVoices.Any(v => v.Language.StartsWith(idioma, StringComparison.OrdinalIgnoreCase)); } catch { return false; } }

    /// <summary>La frase en WAV con la voz de Windows. Null si no hay voz del idioma.</summary>
    public static async Task<Audio?> Decir(string texto, string idioma, string avatar, CancellationToken ct = default)
    {
        var limpio = Expresiones.Quitar(texto).Trim();
        if (limpio.Length == 0) return null;
        var voz = Elegir(idioma, avatar) ?? Elegir(idioma == "es" ? "en" : "es", avatar);
        if (voz == null) return null;
        using var s = new global::Windows.Media.SpeechSynthesis.SpeechSynthesizer { Voice = voz };
        var stream = await s.SynthesizeTextToStreamAsync(limpio).AsTask(ct).ConfigureAwait(false);
        using var net = stream.AsStreamForRead();
        using var ms = new MemoryStream();
        await net.CopyToAsync(ms, ct).ConfigureAwait(false);
        return new Audio(ms.ToArray(), "audio/wav", "windows:" + voz.DisplayName, null);
    }

    /// <summary>Dictado de Windows sobre un WAV. Vacío si no entendió; excepción si no hay reconocedor del idioma.</summary>
    public static Task<string> Oir(byte[] wav, string idioma, CancellationToken ct = default) => Task.Run(() =>
    {
        var info = SpeechRecognitionEngine.InstalledRecognizers().FirstOrDefault(r => r.Culture.TwoLetterISOLanguageName == idioma)
                   ?? throw new InvalidOperationException(idioma == "en" ? "Windows has no English speech recognition installed." : "Windows no tiene reconocimiento de voz en español instalado (Configuración → Hora e idioma → Voz).");
        using var motor = new SpeechRecognitionEngine(info);
        motor.LoadGrammar(new DictationGrammar());
        using var ms = new MemoryStream(wav);
        motor.SetInputToWaveStream(ms);
        motor.InitialSilenceTimeout = TimeSpan.FromSeconds(3);
        motor.EndSilenceTimeout = TimeSpan.FromMilliseconds(600);
        var partes = new System.Collections.Generic.List<string>();
        while (!ct.IsCancellationRequested)
        {
            var r = motor.Recognize();
            if (r == null) break;
            partes.Add(r.Text);
        }
        return string.Join(" ", partes).Trim();
    }, ct);
}
