using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using Aura.Windows.Core;

namespace Aura.Windows;

/// <summary>
/// --onnx-self-test: el .exe PUBLICADO (o el instalado) carga el modelo propio «Hey AURA» con ONNX Runtime y lo
/// corre sobre audio sintético (silencio y ruido; nada de micrófono). Falla si ORT no carga, si onnxruntime.dll no
/// sale de la carpeta de AURA o si falta una pieza del runtime de C++ junto al .exe (auditoría 1-oct, H05: en un
/// equipo real fallaba «NativeMethods» y nadie lo veía porque el CI solo probaba las clases del Core).
/// </summary>
internal static class OnnxSelfTest
{
    public static Task Run(string salida)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(salida)!);
        var carpeta = AppContext.BaseDirectory;
        try
        {
            MotorOnnx.Preparar();
            var modelos = Path.Combine(carpeta, "Modelos");
            float silencio = 0, ruido = 0;
            using (var pc = new PalabraClave(modelos, Path.Combine(modelos, "hey_aura.onnx")))
            {
                for (int i = 0; i < 25; i++) silencio = Math.Max(silencio, pc.Alimentar(new short[PalabraClave.Trozo]));
                var r = new Random(7);
                for (int i = 0; i < 25; i++)
                {
                    var b = new short[PalabraClave.Trozo];
                    for (int k = 0; k < b.Length; k++) b[k] = (short)r.Next(-3000, 3000);
                    ruido = Math.Max(ruido, pc.Alimentar(b));
                }
            }
            // Qué copias quedaron cargadas de verdad en el proceso.
            var modulos = Process.GetCurrentProcess().Modules.Cast<ProcessModule>()
                .Where(m => m.ModuleName.StartsWith("onnxruntime", StringComparison.OrdinalIgnoreCase) || MotorOnnx.RuntimeCpp.Contains(m.ModuleName.ToLowerInvariant()))
                .ToDictionary(m => m.ModuleName.ToLowerInvariant(), m => m.FileName ?? "", StringComparer.OrdinalIgnoreCase);
            var ort = modulos.TryGetValue("onnxruntime.dll", out var o) ? o : "";
            var desdeAura = ort.Length > 0 && string.Equals(Path.GetDirectoryName(ort)?.TrimEnd('\\'), carpeta.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
            var faltan = new[] { "onnxruntime.dll" }.Concat(MotorOnnx.RuntimeCpp).Where(p => !File.Exists(Path.Combine(carpeta, p))).ToArray();
            var problemas = new System.Collections.Generic.List<string>();
            if (!desdeAura) problemas.Add("onnxruntime.dll no se cargó desde la carpeta de AURA: " + ort);
            if (faltan.Length > 0) problemas.Add("faltan junto al .exe: " + string.Join(", ", faltan));
            if (silencio >= 0.5f) problemas.Add($"el silencio dio {silencio:0.00}");
            bool ok = problemas.Count == 0;
            File.WriteAllText(salida, JsonSerializer.Serialize(new
            {
                ok, version = MotorOnnx.VersionNativa(), paquete = MotorOnnx.VersionPaquete, desdeAura, modulos,
                silencio, ruido, problemas, falloCarga = MotorOnnx.FalloCarga,
            }, new JsonSerializerOptions { WriteIndented = true }));
            Application.Current.Shutdown(ok ? 0 : 1);
        }
        catch (Exception ex)
        {
            File.WriteAllText(salida, JsonSerializer.Serialize(new { ok = false, error = MotorOnnx.Diagnostico(ex, carpeta) }, new JsonSerializerOptions { WriteIndented = true }));
            Application.Current.Shutdown(1);
        }
        return Task.CompletedTask;
    }
}
