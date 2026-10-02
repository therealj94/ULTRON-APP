using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;

namespace Aura.Windows.Core;

/// <summary>
/// «Oye AURA» / «Hey AURA» en el equipo, sin red: la misma cadena que openWakeWord (Apache-2.0,
/// github.com/dscripka/openWakeWord), en C#. Cada 80 ms de audio (1280 muestras a 16 kHz):
///   1. melspectrogram.onnx → 8 cuadros de 32 bandas (con la transformación x/10 + 2);
///   2. embedding_model.onnx (el speech_embedding de Google) sobre los últimos 76 cuadros → 96 números;
///   3. el modelo de la palabra (entrenado para «hey aura» / «oye aura») sobre los últimos 16 → 0..1.
/// No guarda ni manda audio: solo dice qué tan seguro está de haber oído la palabra.
/// </summary>
public sealed class PalabraClave : IDisposable
{
    public const int Muestreo = 16000;
    public const int Trozo = 1280;
    const int Contexto = 160 * 3;
    const int VentanaMel = 76, Bandas = 32, MaxMel = 970, Rasgos = 96, MaxRasgos = 120;

    readonly InferenceSession mel, emb, palabra;
    readonly string entradaMel, entradaEmb, entradaPalabra;
    readonly int cuadrosPalabra;
    readonly List<short> crudo = new();
    readonly List<short> resto = new();
    readonly List<float[]> cuadros = new();
    readonly List<float[]> rasgos = new();
    int predicciones;

    /// <param name="carpeta">Donde están melspectrogram.onnx y embedding_model.onnx.</param>
    /// <param name="modelo">El .onnx de la palabra (hey_aura.onnx).</param>
    public PalabraClave(string carpeta, string modelo)
    {
        // onnxruntime.dll de la carpeta de AURA, por ruta completa, antes del primer uso (MotorOnnx, H05).
        MotorOnnx.Preparar();
        var o = new SessionOptions { IntraOpNumThreads = 1, InterOpNumThreads = 1, GraphOptimizationLevel = GraphOptimizationLevel.ORT_ENABLE_ALL };
        mel = new InferenceSession(Path.Combine(carpeta, "melspectrogram.onnx"), o);
        emb = new InferenceSession(Path.Combine(carpeta, "embedding_model.onnx"), o);
        palabra = new InferenceSession(modelo, o);
        entradaMel = mel.InputMetadata.Keys.First();
        entradaEmb = emb.InputMetadata.Keys.First();
        entradaPalabra = palabra.InputMetadata.Keys.First();
        var forma = palabra.InputMetadata[entradaPalabra].Dimensions;
        cuadrosPalabra = forma.Length >= 2 && forma[1] > 0 ? forma[1] : 16;
        Reiniciar();
    }

    /// <summary>Vuelve a empezar (como openWakeWord: mel con unos, rasgos de un ruido suave).</summary>
    public void Reiniciar()
    {
        crudo.Clear(); resto.Clear(); cuadros.Clear(); rasgos.Clear(); predicciones = 0;
        for (int i = 0; i < VentanaMel; i++) { var f = new float[Bandas]; Array.Fill(f, 1f); cuadros.Add(f); }
        var r = new Random(1234);
        var ruido = new short[Muestreo * 4];
        for (int i = 0; i < ruido.Length; i++) ruido[i] = (short)r.Next(-1000, 1000);
        var m = Mel(ruido);
        for (int i = 0; i + VentanaMel <= m.Count; i += 8) rasgos.Add(Embedding(m, i));
    }

    /// <summary>
    /// Mete audio (PCM 16 bits mono a 16 kHz, de cualquier largo). Devuelve la puntuación más alta de los
    /// trozos de 80 ms que se completaron (0 si ninguno).
    /// </summary>
    public float Alimentar(ReadOnlySpan<short> pcm)
    {
        float max = 0;
        foreach (var s in pcm)
        {
            resto.Add(s);
            if (resto.Count < Trozo) continue;
            max = Math.Max(max, Paso(resto));
            resto.Clear();
        }
        return max;
    }

    float Paso(List<short> trozo)
    {
        crudo.AddRange(trozo);
        if (crudo.Count > Muestreo * 10) crudo.RemoveRange(0, crudo.Count - Muestreo * 10);
        var n = Math.Min(crudo.Count, Trozo + Contexto);
        var ventana = new short[n];
        crudo.CopyTo(crudo.Count - n, ventana, 0, n);
        cuadros.AddRange(Mel(ventana));
        if (cuadros.Count > MaxMel) cuadros.RemoveRange(0, cuadros.Count - MaxMel);
        rasgos.Add(Embedding(cuadros, cuadros.Count - VentanaMel));
        if (rasgos.Count > MaxRasgos) rasgos.RemoveRange(0, rasgos.Count - MaxRasgos);
        var p = Predecir();
        // Como openWakeWord: las primeras predicciones (con rasgos de arranque) no cuentan.
        return predicciones++ < 5 ? 0 : p;
    }

    List<float[]> Mel(short[] audio)
    {
        var t = new DenseTensor<float>(new[] { 1, audio.Length });
        for (int i = 0; i < audio.Length; i++) t[0, i] = audio[i];
        using var r = mel.Run(new[] { NamedOnnxValue.CreateFromTensor(entradaMel, t) });
        var o = r.First().AsTensor<float>();
        var d = o.Dimensions;
        int nCuadros = d[^2], nBandas = d[^1];
        var plano = o.ToArray();
        var salida = new List<float[]>(nCuadros);
        for (int c = 0; c < nCuadros; c++)
        {
            var f = new float[nBandas];
            for (int b = 0; b < nBandas; b++) f[b] = plano[c * nBandas + b] / 10f + 2f;
            salida.Add(f);
        }
        return salida;
    }

    float[] Embedding(List<float[]> m, int desde)
    {
        var t = new DenseTensor<float>(new[] { 1, VentanaMel, Bandas, 1 });
        for (int c = 0; c < VentanaMel; c++)
            for (int b = 0; b < Bandas; b++) t[0, c, b, 0] = m[desde + c][b];
        using var r = emb.Run(new[] { NamedOnnxValue.CreateFromTensor(entradaEmb, t) });
        return r.First().AsTensor<float>().ToArray()[..Rasgos];
    }

    float Predecir()
    {
        var t = new DenseTensor<float>(new[] { 1, cuadrosPalabra, Rasgos });
        int desde = rasgos.Count - cuadrosPalabra;
        for (int c = 0; c < cuadrosPalabra; c++)
            for (int k = 0; k < Rasgos; k++) t[0, c, k] = rasgos[desde + c][k];
        using var r = palabra.Run(new[] { NamedOnnxValue.CreateFromTensor(entradaPalabra, t) });
        return r.First().AsTensor<float>().ToArray()[0];
    }

    /// <summary>Los últimos rasgos calculados (para comparar con openWakeWord en las pruebas).</summary>
    public float[][] UltimosRasgos(int n) => rasgos.Skip(Math.Max(0, rasgos.Count - n)).ToArray();
    public float[][] UltimosCuadros(int n) => cuadros.Skip(Math.Max(0, cuadros.Count - n)).ToArray();

    public void Dispose() { mel.Dispose(); emb.Dispose(); palabra.Dispose(); }
}
