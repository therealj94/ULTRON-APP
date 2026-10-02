using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Aura.Windows.Notch;

namespace Aura.Windows;

/// <summary>
/// --orbe-self-test: la cara de AU-RA (el orbe, OrbeView) en una ventana transparente como el notch, con el .exe
/// PUBLICADO (OrbeAssets/orbe.html al lado). Si el equipo puede (WebView2 y WebGL), dice «listo», se le pone la cara
/// de «escucha» y luego el escenario de «habla» con una frase y su boca, y se guardan las fotos. Si no puede, tiene que
/// rendirse a tiempo (10 s) para que el notch vuelva al avatar de siempre: eso también pasa la prueba, dicho en el
/// resultado. Falla si falta el archivo, si se queda colgado sin decidir (el notch quedaría sin cara) o si la página no
/// hace lo que se le pide.
/// </summary>
internal static class OrbeSelfTest
{
    public static async Task Run(string carpeta)
    {
        Directory.CreateDirectory(carpeta);
        var r = new Dictionary<string, object?>();
        var problemas = new List<string>();
        void Escribir() => File.WriteAllText(Path.Combine(carpeta, "resultado.json"), JsonSerializer.Serialize(r, new JsonSerializerOptions { WriteIndented = true }));
        try
        {
            var html = Path.Combine(AppContext.BaseDirectory, "OrbeAssets", "orbe.html");
            r["orbe_html"] = File.Exists(html);
            if (!File.Exists(html)) throw new Exception("Falta OrbeAssets/orbe.html junto al .exe");
            var raiz = new Grid { Background = Brushes.Transparent };
            var w = new Window
            {
                Title = "AURA · orbe", WindowStyle = WindowStyle.None, AllowsTransparency = true, Background = Brushes.Transparent,
                ResizeMode = ResizeMode.NoResize, ShowInTaskbar = false, Width = 520, Height = 260, Left = 40, Top = 40, Content = raiz,
            };
            var orbe = new OrbeView(false);
            raiz.Children.Add(orbe);
            var decidio = new TaskCompletionSource<bool>();
            orbe.CambioDisponible += () => { if (orbe.Listo) decidio.TrySetResult(true); else if (orbe.Fallo) decidio.TrySetResult(false); };
            var crono = Stopwatch.StartNew();
            w.Show();
            var gano = await Task.WhenAny(decidio.Task, Task.Delay(TimeSpan.FromSeconds(15)));
            r["ms_hasta_decidir"] = crono.ElapsedMilliseconds;
            if (gano != decidio.Task) throw new Exception("Ni «listo» ni respaldo en 15 s: el notch se quedaría sin cara");
            r["listo"] = decidio.Task.Result;
            if (!decidio.Task.Result)
            {
                // Sin WebGL o sin WebView2 en este equipo: se rindió a tiempo y el notch se queda con el avatar de siempre.
                r["respaldo"] = "el avatar de siempre (el motivo queda en aura.log)";
                r["ok"] = true;
                Escribir();
                Application.Current.Shutdown(0);
                return;
            }
            // La cara en un hueco del panel (64 × 64), escuchando.
            orbe.Ubicar(0, 0, 64, 64, false, 1);
            orbe.Cara("LISTENING");
            await Task.Delay(1800);
            await orbe.Fotografiar(Path.Combine(carpeta, "01-cara-escucha.png"));
            var cara = await Leer(orbe);
            r["cara"] = cara;
            if (cara.GetProperty("estado").GetString() != "listening") problemas.Add("la cara de escucha no llegó a la página");
            if (!cara.GetProperty("marcoCara").GetBoolean()) problemas.Add("el marco «cara» no se puso");
            // El escenario de «habla» (470 × 200, como el notch): la frase formada con partículas, al ritmo de su audio.
            orbe.Ubicar(0, 0, 470, 200, true, 1);
            orbe.Cara("SPEAKING");
            orbe.Decir("Mañana tienes la junta a las diez y el informe de ventas pendiente.", 3.5);
            for (int i = 0; i < 40; i++) { orbe.Boca(0.3 + 0.4 * Math.Abs(Math.Sin(i * 0.7))); await Task.Delay(100); }
            await orbe.Fotografiar(Path.Combine(carpeta, "02-habla-palabras.png"));
            var habla = await Leer(orbe);
            r["habla"] = habla;
            if (habla.GetProperty("estado").GetString() != "speaking") problemas.Add("la cara de habla no llegó a la página");
            if (habla.GetProperty("marcoCara").GetBoolean()) problemas.Add("el escenario sigue con el marco «cara»");
            if (habla.GetProperty("palabras").GetInt32() != 13 || habla.GetProperty("mostradas").GetInt32() < 1) problemas.Add("las palabras no se formaron");
            if (habla.GetProperty("tts").GetBoolean()) problemas.Add("el orbe iba a hablar con voz propia");
            // Callar: las palabras vuelven al orbe.
            orbe.Callar();
            orbe.Cara("IDLE");
            await Task.Delay(2500);
            await orbe.Fotografiar(Path.Combine(carpeta, "03-callada.png"));
            var callada = await Leer(orbe);
            r["callada"] = callada;
            if (callada.GetProperty("estado").GetString() != "idle") problemas.Add("no volvió a reposo");
            r["problemas"] = problemas;
            r["ok"] = problemas.Count == 0;
            Escribir();
            orbe.Dispose();
            w.Close();
            Application.Current.Shutdown(problemas.Count == 0 ? 0 : 1);
        }
        catch (Exception ex)
        {
            r["ok"] = false; r["error"] = ex.ToString(); r["problemas"] = problemas;
            Escribir();
            Application.Current.Shutdown(1);
        }
    }

    /// <summary>Lo que la página dice de sí misma: estado, frase en curso, opciones, marco y calidad.</summary>
    static async Task<JsonElement> Leer(OrbeView orbe)
    {
        var json = await orbe.Evaluar("JSON.stringify({estado: window.AuraFace.state, palabras: (window.AuraFace.speech||{}).words||0, mostradas: (window.AuraFace.speech||{}).shown||0," +
                                      " tts: window.__orbeOpciones && window.__orbeOpciones.tts !== false, marcoCara: document.documentElement.classList.contains('aura-cara')," +
                                      " lienzo: [document.getElementById('c').width, document.getElementById('c').height], dpr: devicePixelRatio, stats: window.AuraFace.stats})");
        return JsonSerializer.Deserialize<JsonElement>(JsonSerializer.Deserialize<string>(json) ?? "{}");
    }
}
