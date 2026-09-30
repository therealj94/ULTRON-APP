using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Aura.Windows.Core;

/// <summary>
/// Laya ligera para Windows: qué mano pidió la persona, decidido DENTRO del .exe, sin red, en
/// microsegundos. Traducción exacta de scripts/nodo-t4/laya/ligera/entrenar_ligera.py (rasgos,
/// FNV-1a, int8) con el léxico de entrenar_ligera_windows.py; los pesos están en LayaLigeraModelo.g.cs
/// y sus Muestras prueban que C# y Python dicen lo mismo (windows/tests).
/// Decide QUÉ mano; qué app, qué texto o a qué hora lo sacan las reglas (Parametros.cs).
/// </summary>
public static class LayaLigera
{
    public sealed record Prediccion(string Etiqueta, double P, bool Seguro);

    static readonly sbyte[] Pesos = Array.ConvertAll(Convert.FromBase64String(LayaLigeraModelo.PesosB64), b => unchecked((sbyte)b));
    static readonly Dictionary<string, List<string>> Exacta = CrearExacta();
    static readonly (string Prefijo, string Concepto)[] PrefijosOrdenados = LayaLigeraModelo.Prefijos
        .SelectMany(kv => kv.Value.Select(p => (p, kv.Key)))
        .OrderBy(x => -x.p.Length).ThenBy(x => x.p, StringComparer.Ordinal).ThenBy(x => x.Key, StringComparer.Ordinal)
        .ToArray();
    static readonly Regex NoAlfanumerico = new("[^a-z0-9]+", RegexOptions.Compiled);

    static Dictionary<string, List<string>> CrearExacta()
    {
        var d = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var (concepto, palabras) in LayaLigeraModelo.Exactas)
            foreach (var w in palabras)
            {
                if (!d.TryGetValue(w, out var l)) d[w] = l = new List<string>();
                if (!l.Contains(concepto)) l.Add(concepto);
            }
        return d;
    }

    public static string Normalizar(string? texto)
    {
        var t = (texto ?? "").Normalize(NormalizationForm.FormKD);
        var sb = new StringBuilder(t.Length);
        foreach (var c in t) if (c < '̀' || c > 'ͯ') sb.Append(c);
        return NoAlfanumerico.Replace(sb.ToString().ToLowerInvariant(), " ").Trim();
    }

    static List<string> Conceptos(string palabra)
    {
        var o = Exacta.TryGetValue(palabra, out var l) ? new List<string>(l) : new List<string>();
        foreach (var (p, c) in PrefijosOrdenados)
            if (palabra.Length >= p.Length && palabra.StartsWith(p, StringComparison.Ordinal) && !o.Contains(c)) o.Add(c);
        return o;
    }

    public static HashSet<string> Rasgos(string texto)
    {
        var w = Normalizar(texto).Split(' ').Take(40).Where(x => x.Length > 0).ToArray();
        var o = new HashSet<string>(StringComparer.Ordinal);
        if (w.Length == 0) return o;
        o.Add("n=" + Math.Min(w.Length, 12).ToString(CultureInfo.InvariantCulture));
        o.Add("s=" + w[0]);
        if (w.Length > 1) o.Add("s2=" + w[0] + "_" + w[1]);
        var previos = new List<string>();
        bool primero = true;
        for (int i = 0; i < w.Length; i++)
        {
            var x = w[i];
            o.Add("w=" + x);
            if (i + 1 < w.Length) o.Add("b=" + x + "_" + w[i + 1]);
            var p = "<" + x + ">";
            foreach (var n in new[] { 3, 4 })
                for (int j = 0; j + n <= p.Length; j++) o.Add("c=" + p.Substring(j, n));
            var cs = Conceptos(x);
            foreach (var c in cs)
            {
                o.Add("k=" + c);
                if (primero) o.Add("ks=" + c);
                foreach (var a in previos) o.Add("kb=" + a + "_" + c);
            }
            if (cs.Count > 0) { primero = false; previos = cs; }
        }
        return o;
    }

    public static uint Fnv1a(string s)
    {
        uint h = 0x811c9dc5;
        foreach (var b in Encoding.UTF8.GetBytes(s)) { h ^= b; h = unchecked(h * 0x01000193); }
        return h;
    }

    /// <summary>Probabilidad calibrada de cada etiqueta.</summary>
    public static double[] Probabilidades(string texto)
    {
        int k = LayaLigeraModelo.Etiquetas.Length, dim = LayaLigeraModelo.Dim;
        var idx = Rasgos(texto).Select(r => (int)(Fnv1a(r) % (uint)dim)).OrderBy(i => i).ToArray();
        double v = idx.Length > 0 ? 1.0 / Math.Sqrt(idx.Length) : 0;
        var z = new double[k];
        for (int e = 0; e < k; e++)
        {
            double s = 0;
            foreach (var i in idx) s += Pesos[i * k + e] * LayaLigeraModelo.Escala[e] / 127.0;
            z[e] = (s * v + LayaLigeraModelo.Sesgo[e]) / LayaLigeraModelo.Temperatura;
        }
        double max = z.Max(), suma = 0;
        for (int e = 0; e < k; e++) { z[e] = Math.Exp(z[e] - max); suma += z[e]; }
        for (int e = 0; e < k; e++) z[e] /= suma;
        return z;
    }

    public static Prediccion Predecir(string texto)
    {
        var p = Probabilidades(texto);
        int mejor = 0;
        for (int e = 1; e < p.Length; e++) if (p[e] > p[mejor]) mejor = e;
        var etiqueta = LayaLigeraModelo.Etiquetas[mejor];
        return new Prediccion(etiqueta, p[mejor], etiqueta != "win_ninguna" && p[mejor] >= LayaLigeraModelo.Umbral);
    }
}
