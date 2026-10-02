using System;
using System.Text.Json;

namespace Aura.Windows.Core;

/// <summary>Lo que el orbe le cuenta al .exe (window.chrome.webview.postMessage).</summary>
public enum TipoMensajeOrbe { Ninguno, Listo, Fallo, Tocar, Deslizar, Estado, Fin }

/// <summary>Un mensaje del orbe ya leído: su tipo y su dato (motivo del fallo, zona tocada, «arriba»/«abajo», estado).</summary>
public sealed record MensajeOrbe(TipoMensajeOrbe Tipo, string Dato = "");

/// <summary>
/// La cara de AURA en Windows: el orbe de partículas que José aprobó (src/14-orbe/orbe.html, la fuente de verdad;
/// el .csproj la publica tal cual como OrbeAssets/orbe.html). Aquí, puro y probable: qué se le manda (estado, boca,
/// decir, callar, sonido), cómo se le pasan las opciones antes de cargar y cómo se lee lo que contesta.
/// La voz la pone Windows (ElevenLabs o la de Windows): el orbe NUNCA habla (tts:false), solo forma las palabras.
/// </summary>
public static class ProtocoloOrbe
{
    /// <summary>El host virtual de la carpeta OrbeAssets (como centro.aura.local para el Centro).</summary>
    public const string Host = "orbe.aura.local";
    public static readonly Uri Origen = new("https://" + Host);
    /// <summary>La única página que se deja navegar en la WebView del orbe.</summary>
    public const string Pagina = "https://" + Host + "/orbe.html";
    /// <summary>Si en este tiempo no dice «listo», el notch se queda con el avatar de siempre (nunca un hueco).</summary>
    public static readonly TimeSpan EsperaListo = TimeSpan.FromSeconds(10);
    /// <summary>Lo más largo que se le pide formar de una vez (la caja de la propia página también corta en 400).</summary>
    public const int MaxTexto = 400;
    /// <summary>Un mensaje del orbe más grande que esto no es del orbe.</summary>
    public const int MaxMensaje = 4096;
    /// <summary>
    /// El ZoomFactor de la WebView: la página se arma para una pantalla grande (letra de 26 px o más), y en el notch
    /// cabe en la mitad. A 0.5, el escenario de 470 × 200 del notch es para la página uno de 940 × 400: el orbe arriba
    /// y dos renglones de palabras abajo, con letra de 15 px en pantalla.
    /// </summary>
    public const double Zoom = 0.5;
    /// <summary>
    /// «Cara»: la página pone el orbe al 36 % del alto (si es más alta que ancha) y las palabras debajo. Con el lienzo
    /// a 1/(2·0.36) ≈ 139 % del alto del hueco, el orbe queda centrado en un hueco cuadrado del notch y las palabras
    /// caen fuera de la vista.
    /// </summary>
    public const double AltoCaraVh = 139;

    /// <summary>Del estado del avatar del notch (idle, listening, thinking, speaking, happy, worried) a la cara del orbe.</summary>
    public static string Cara(string? estado) => estado switch
    {
        "listening" => "LISTENING",
        "thinking" => "THINKING",
        "speaking" => "SPEAKING",
        // Feliz (lo hizo, un aviso alegre): la onda serena y el destello de «listo».
        "happy" => "HAPPY",
        // Buscar / leer la pantalla: el globo que escanea.
        "scan" => "SCAN",
        // Preocupado no tiene cara propia en el orbe: reposo (sin sonido de cambio).
        _ => "IDLE",
    };

    public static string Estado(string cara) => Json(new { tipo = "estado", face = cara });

    /// <summary>0..1: cuánto suena la voz ahora mismo (dos decimales bastan).</summary>
    public static string Boca(double n) => Json(new { tipo = "boca", n = Nivel(n) });

    /// <summary>
    /// Forma <paramref name="texto"/> con partículas. Con <paramref name="segundos"/> (lo que dura el audio de esa frase)
    /// las palabras salen a su ritmo; sin él, la página reparte por sílabas. null si no hay nada que decir.
    /// </summary>
    public static string? Decir(string? texto, double? segundos = null)
    {
        var t = Recortar(texto);
        if (t.Length == 0) return null;
        return segundos is double s && double.IsFinite(s) && s >= 0.3 && s <= 120
            ? Json(new { tipo = "decir", texto = t, dur = Math.Round(s, 2), tts = false })
            : Json(new { tipo = "decir", texto = t, tts = false });
    }

    /// <summary>Se deshacen las palabras y el orbe se recoge (AURA se calló o la interrumpieron).</summary>
    public static string Callar() => Json(new { tipo = "callar" });

    /// <summary>Los efectos de sonido del orbe (Ajustes → Efectos de sonido).</summary>
    public static string Sonido(bool activo) => Json(new { tipo = "sonido", activo });

    /// <summary>
    /// El script que corre ANTES que la página (AddScriptToExecuteOnDocumentCreated): sus opciones (sin panel de
    /// prueba, sin voz propia, efectos según el ajuste) y <c>window.__orbeMarco(cara)</c>, que cambia entre la «cara»
    /// (el orbe centrado en un hueco cuadrado) y el escenario (orbe y palabras) sin tocar el archivo del orbe.
    /// </summary>
    public static string Preparacion(bool sonidos) =>
        "window.__orbeOpciones=" + Json(new { clean = true, tts = false, sfx = sonidos }) + ";" +
        "window.__orbeMarco=function(cara){var d=document,r=d.documentElement;if(!r)return;" +
        "if(!d.getElementById('aura-marco')){var s=d.createElement('style');s.id='aura-marco';" +
        "s.textContent='html.aura-cara #stage{flex:none!important;height:" + AltoCaraVh.ToString(System.Globalization.CultureInfo.InvariantCulture) + "vh!important}';" +
        "(d.head||r).appendChild(s);}" +
        "r.classList.toggle('aura-cara',!!cara);window.dispatchEvent(new Event('resize'));};";

    /// <summary>
    /// «Menos movimiento» de Ajustes: la página ya baja el movimiento con el de Windows (prefers-reduced-motion); con el
    /// de AURA se le hace creer lo mismo (los parámetros de Emulation.setEmulatedMedia, que reemplaza todo lo emulado:
    /// la lista vacía lo quita y vuelve a mandar lo que diga Windows).
    /// </summary>
    public static string Quietud(bool quieto) => quieto
        ? Json(new { features = new[] { new { name = "prefers-reduced-motion", value = "reduce" } } })
        : Json(new { features = Array.Empty<object>() });

    /// <summary>El script que pone la «cara» (true) o el escenario con palabras (false).</summary>
    public static string Marco(bool cara) => "window.__orbeMarco&&window.__orbeMarco(" + (cara ? "true" : "false") + ")";

    /// <summary>
    /// Lee un mensaje del orbe (el JSON de WebMessageAsJson). Lo que no se reconoce, o no tiene la forma esperada,
    /// es Ninguno: la página nunca decide nada más que esto.
    /// </summary>
    public static MensajeOrbe Leer(string? json)
    {
        var nada = new MensajeOrbe(TipoMensajeOrbe.Ninguno);
        if (string.IsNullOrEmpty(json) || json.Length > MaxMensaje) return nada;
        try
        {
            using var doc = JsonDocument.Parse(json);
            var m = doc.RootElement;
            if (m.ValueKind != JsonValueKind.Object) return nada;
            string Txt(string k) => m.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";
            switch (Txt("tipo"))
            {
                case "listo": return new(TipoMensajeOrbe.Listo);
                case "fallo": return new(TipoMensajeOrbe.Fallo, Corto(Txt("motivo")));
                case "tocar": return new(TipoMensajeOrbe.Tocar, Corto(Txt("zona")));
                case "deslizar": return Txt("dir") is "arriba" or "abajo" ? new(TipoMensajeOrbe.Deslizar, Txt("dir")) : nada;
            }
            switch (Txt("type"))
            {
                // Perdió el contexto WebGL: la página se recarga sola y vuelve a decir «listo».
                case "aura-fallo": return new(TipoMensajeOrbe.Fallo, Corto(Txt("motivo")));
                case "aura-state": return Txt("state") is "idle" or "listening" or "thinking" or "searching" or "speaking" or "done" ? new(TipoMensajeOrbe.Estado, Txt("state")) : nada;
                // Terminó de formar (y deshacer) una frase: la página pasa sola a «escucha»; el notch le repite el real.
                case "aura-end": return new(TipoMensajeOrbe.Fin);
            }
            return nada;
        }
        catch (JsonException) { return nada; }
    }

    static double Nivel(double n) => Math.Round(Math.Clamp(double.IsFinite(n) ? n : 0, 0, 1), 2);

    /// <summary>Espacios juntos, sin controles y a lo más <see cref="MaxTexto"/> letras (cortando en una palabra).</summary>
    static string Recortar(string? texto)
    {
        if (string.IsNullOrWhiteSpace(texto)) return "";
        var b = new System.Text.StringBuilder(Math.Min(texto.Length, MaxTexto + 1));
        bool espacio = false;
        foreach (var c in texto.Trim())
        {
            if (char.IsWhiteSpace(c) || char.IsControl(c)) { espacio = true; continue; }
            if (espacio && b.Length > 0) b.Append(' ');
            espacio = false;
            b.Append(c);
            if (b.Length > MaxTexto) break;
        }
        if (b.Length <= MaxTexto) return b.ToString();
        var s = b.ToString(0, MaxTexto);
        int corte = s.LastIndexOf(' ');
        return (corte > MaxTexto / 2 ? s[..corte] : s).TrimEnd() + "…";
    }

    static string Corto(string s) => s.Length > 120 ? s[..120] : s;

    static string Json<T>(T valor) => JsonSerializer.Serialize(valor);
}

/// <summary>
/// La boca va a 50 lecturas por segundo desde el altavoz; al orbe le bastan ~30 y solo si cambia. El silencio (0)
/// pasa siempre, para que la boca se cierre aunque llegue pegado al último nivel.
/// </summary>
public sealed class LimitadorBoca
{
    readonly TimeSpan cada;
    double ultimo = -1;
    TimeSpan cuando;
    bool hubo;

    public LimitadorBoca(TimeSpan? cada = null) { this.cada = cada ?? TimeSpan.FromMilliseconds(33); }

    /// <summary>¿Se manda este nivel ahora? <paramref name="valor"/>: el nivel redondeado a dos decimales.</summary>
    public bool Pasa(double nivel, TimeSpan ahora, out double valor)
    {
        valor = Math.Round(Math.Clamp(double.IsFinite(nivel) ? nivel : 0, 0, 1), 2);
        if (hubo && valor == ultimo) return false;
        if (hubo && valor > 0 && ahora - cuando < cada) return false;
        hubo = true; ultimo = valor; cuando = ahora;
        return true;
    }

    /// <summary>Olvida lo último mandado (el orbe se recargó: hay que volver a contarle).</summary>
    public void Reiniciar() { hubo = false; ultimo = -1; }
}
