using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.ML.OnnxRuntime;

namespace Aura.Windows.Core;

/// <summary>
/// Dónde y cómo se carga ONNX Runtime (el motor del modelo propio «Hey AURA»).
///
/// Por qué existe (auditoría del 1-oct, H05): en el .exe de un solo archivo, onnxruntime.dll viajaba DENTRO
/// del .exe y se extraía a %TEMP% al usarse; además depende de MSVCP140(_1).dll y VCRUNTIME140(_1).dll (el
/// runtime de Visual C++), que .NET autocontenido NO trae. En un equipo sin ese runtime (o con uno viejo), o
/// con la copia vieja de onnxruntime.dll que Windows 11 tiene en System32, el primer uso fallaba con
/// «TypeInitializationException en Microsoft.ML.OnnxRuntime.NativeMethods» y quedaba solo el de Windows.
/// Ahora onnxruntime.dll y el runtime de C++ van AL LADO del .exe (publish.ps1 / el .csproj) y aquí se le
/// dice a .NET que cargue ESA copia, por ruta completa, antes que cualquier otra.
/// </summary>
public static class MotorOnnx
{
    static int preparado;

    /// <summary>Por qué falló la carga de la copia de la carpeta de AURA (si falló): va al diagnóstico.</summary>
    public static string? FalloCarga { get; private set; }

    /// <summary>De dónde se cargó onnxruntime.dll (null: por la búsqueda normal de .NET).</summary>
    public static string? RutaCargada { get; private set; }

    /// <summary>Lo que necesita onnxruntime.dll en Windows además de lo del sistema (el runtime de Visual C++).</summary>
    public static readonly string[] RuntimeCpp = { "msvcp140.dll", "msvcp140_1.dll", "vcruntime140.dll", "vcruntime140_1.dll" };

    /// <summary>Una vez por proceso, antes de crear la primera sesión.</summary>
    public static void Preparar(string? carpeta = null)
    {
        if (Interlocked.Exchange(ref preparado, 1) == 1) return;
        carpeta ??= AppContext.BaseDirectory;
        try { NativeLibrary.SetDllImportResolver(typeof(InferenceSession).Assembly, (nombre, _, _) => Resolver(nombre, carpeta)); }
        catch (InvalidOperationException) { /* ya había uno: se respeta */ }
    }

    static IntPtr Resolver(string nombre, string carpeta)
    {
        if (!OperatingSystem.IsWindows() || !nombre.StartsWith("onnxruntime", StringComparison.OrdinalIgnoreCase)) return IntPtr.Zero;
        var archivo = Path.Combine(carpeta, nombre.EndsWith(".dll", StringComparison.OrdinalIgnoreCase) ? nombre : nombre + ".dll");
        if (!File.Exists(archivo)) { FalloCarga = $"{Path.GetFileName(archivo)} no está junto a AURA"; return IntPtr.Zero; }
        try
        {
            var h = NativeLibrary.Load(archivo);
            RutaCargada = archivo;
            return h;
        }
        catch (Exception ex)
        {
            // Casi siempre: falta (o es viejo) el runtime de Visual C++. Se deja dicho y sigue la búsqueda normal.
            FalloCarga = ex.GetType().Name + ": " + ex.Message;
            return IntPtr.Zero;
        }
    }

    /// <summary>La versión de ONNX Runtime del paquete (la del .dll administrado; no carga lo nativo).</summary>
    public static string VersionPaquete =>
        typeof(InferenceSession).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion?.Split('+')[0]
        ?? typeof(InferenceSession).Assembly.GetName().Version?.ToString() ?? "?";

    /// <summary>La versión del motor nativo cargado (o el error, si no carga).</summary>
    public static string VersionNativa()
    {
        try { return OrtEnv.Instance().GetVersionString(); }
        catch (Exception ex) { return "no carga: " + ex.GetType().Name; }
    }

    /// <summary>Qué piezas del runtime de C++ hay junto a AURA (para el diagnóstico: «msvcp140_1.dll falta»).</summary>
    public static string PiezasJuntoAAura(string? carpeta = null)
    {
        carpeta ??= AppContext.BaseDirectory;
        var piezas = new[] { "onnxruntime.dll" }.Concat(RuntimeCpp);
        return string.Join(", ", piezas.Select(p => p + (File.Exists(Path.Combine(carpeta, p)) ? " ✓" : " falta")));
    }

    /// <summary>
    /// La cadena completa de una excepción (tipo, HRESULT y mensaje de cada nivel, hasta 8), saneada: así se
    /// ve la causa de verdad (DllNotFoundException, BadImageFormatException, «API version…») y no solo el
    /// «The type initializer threw an exception» de arriba.
    /// </summary>
    public static string CadenaDeErrores(Exception? ex, int maxNiveles = 8)
    {
        var sb = new StringBuilder();
        for (int i = 0; ex != null && i < maxNiveles; i++, ex = ex.InnerException)
        {
            if (i > 0) sb.Append(" ← ");
            sb.Append(ex.GetType().FullName).Append(" (0x").Append(ex.HResult.ToString("X8")).Append("): ").Append(ex.Message.Trim());
            if (ex is AggregateException ag && ag.InnerExceptions.Count > 1)
                sb.Append(" [+").Append(ag.InnerExceptions.Count - 1).Append(" más]");
        }
        return RegistroSeguro.Sanear(sb.ToString());
    }

    /// <summary>Todo lo que hace falta para saber por qué no arrancó, en una línea (sin datos personales).</summary>
    public static string Diagnostico(Exception ex, string? carpeta = null) =>
        $"{CadenaDeErrores(ex)} · ORT {VersionPaquete} · {Environment.OSVersion.VersionString} {RuntimeInformation.ProcessArchitecture}"
        + $" · junto a AURA: {PiezasJuntoAAura(carpeta)}" + (FalloCarga != null ? " · carga directa: " + RegistroSeguro.Sanear(FalloCarga) : "");
}
