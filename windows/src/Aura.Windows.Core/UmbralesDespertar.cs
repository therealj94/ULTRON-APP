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
