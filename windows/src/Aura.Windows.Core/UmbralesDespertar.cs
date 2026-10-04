namespace Aura.Windows.Core;

/// <summary>Cuánta seguridad pide cada forma de despertar a AURA (probado en windows/tests).</summary>
public static class UmbralesDespertar
{
    /// <summary>
    /// Lo mínimo que pide el reconocedor de Windows (SAPI). El 1-oct, entre 22:35 y 22:39, SAPI «oyó» aura, oye claudio,
    /// hey guardian… cada pocos segundos con la música y el altavoz, y el de inglés con 0,8–0,95 de confianza: su
    /// número no distingue. Así que:
    ///  · con el modelo propio funcionando, todo lo que lleva «aura» lo decide el modelo (SAPI no cuenta) y los
    ///    otros nombres (Claudio, ANT-ONIO, Guardián) piden 0,9;
    ///  · con música sonando, SAPI pide 0,95 y «aura» sola nunca;
    ///  · sin modelo propio, «aura» sola 0,8 y con «oye/hey» 0,6 (como antes, un poco más estricto).
    /// </summary>
    public static float MinimoWindows(string frase, bool hayModeloPropio, bool exigente)
    {
        bool sola = frase.Equals("aura", StringComparison.OrdinalIgnoreCase);
        bool conAura = frase.Contains("aura", StringComparison.OrdinalIgnoreCase);
        if (hayModeloPropio && conAura) return float.PositiveInfinity;
        if (sola && exigente) return float.PositiveInfinity;
        if (exigente) return 0.95f;
        if (hayModeloPropio) return 0.9f;
        return sola ? 0.8f : 0.6f;
    }

}

/// <summary>
/// Qué audio sale del equipo según la escucha elegida (probado en windows/tests). «Oye AURA» (palabra) promete que
/// la palabra se reconoce AQUÍ, sin enviar audio: el micrófono puede quedar abierto (para no perder «Oye AURA, abre
/// Excel» dicho de corrido), pero una frase solo va al servidor a transcribirse si la despertó el detector local
/// (Voz/Despertador: el modelo propio o el reconocedor de Windows), si se pidió hablar (tecla, clic), mientras hay una
/// charla en curso o una pregunta esperando el «sí». Sin detector local, «palabra» no deja el micrófono abierto.
/// «Siempre atenta» manda cada frase (así lo dice Ajustes); «pedir» solo abre el micrófono cuando se pide.
/// </summary>
public static class PoliticaEscucha
{
    /// <summary>Cuánto dura una charla después de la última frase: con «Oye AURA», 90 s; con «siempre atenta», 3 min.</summary>
    public static TimeSpan Charla(string escucha) => escucha == "siempre" ? TimeSpan.FromMinutes(3) : TimeSpan.FromSeconds(90);

    /// <summary>¿El micrófono queda abierto esperando? «siempre», sí; «palabra», solo con un detector local encendido.</summary>
    public static bool OidoContinuo(string escucha, bool detectorLocal) => escucha == "siempre" || escucha == "palabra" && detectorLocal;

    /// <summary>
    /// ¿Esta frase se puede mandar al servidor a transcribir? Fuera de «palabra», sí (como siempre). Con «palabra»: solo
    /// si despertó el detector local, se pidió hablar, hay una pregunta esperando el «sí» o hay una charla en curso.
    /// </summary>
    public static bool MandarFrase(string escucha, bool despertoLocal, bool llamadaExplicita, bool hayPropuesta, TimeSpan desdeCharla)
    {
        if (escucha != "palabra") return true;
        return despertoLocal || llamadaExplicita || hayPropuesta || desdeCharla < Charla(escucha);
    }
}
