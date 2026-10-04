using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Aura.Windows.Manos;

/// <summary>
/// Actualización por el aire: el CI publica en la release «aura-windows» el instalador y su ficha
/// (aura-windows.json: commit, versión y SHA-256). AURA la mira de vez en cuando; si el commit es otro,
/// baja el instalador, comprueba el SHA-256 y lo deja listo. Instalar = correrlo en silencio (Inno Setup
/// cierra AURA, reemplaza y la vuelve a abrir). Solo desde el GitHub del proyecto, siempre por HTTPS.
/// Solo hacia adelante: la versión publicada tiene que ser MAYOR que la que corre (Core.Actualizacion).
///
/// TODO (auditoría 1-oct, H07) firma de código: el SHA-256 viene de la misma release que el instalador, así que
/// detecta corrupción pero no autentica al editor. Cuando haya certificado (secretos AURA_SIGN_PFX y
/// AURA_SIGN_PFX_PASSWORD; el CI ya firma si existen, ver windows/scripts/sign.ps1), exigir aquí además una firma
/// Authenticode válida (WinVerifyTrust) con el editor esperado antes de correr el instalador.
/// </summary>
internal sealed class Actualizador
{
    const string Base = "https://github.com/therealj94/ULTRON-APP/releases/download/aura-windows/";
    static readonly HttpClient http = new(new HttpClientHandler { AllowAutoRedirect = true }) { Timeout = TimeSpan.FromMinutes(10) };

    internal sealed record Ficha(string Commit, string Version, string Sha256);

    public static string MiVersion => typeof(Actualizador).Assembly.GetName().Version?.ToString(3) ?? "0.0.0";

    /// <summary>El commit con el que se armó este .exe (el SDK lo pone tras el «+» de la versión informativa).</summary>
    public static string MiCommit
    {
        get
        {
            var v = typeof(Actualizador).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "";
            var i = v.IndexOf('+');
            return i >= 0 ? v[(i + 1)..].Trim().ToLowerInvariant() : "";
        }
    }

    public static string Carpeta => Path.Combine(Centro.Registro.Carpeta, "actualizacion");
    string Instalador => Path.Combine(Carpeta, "AURA-Windows-Setup-x64.exe");

    public Ficha? Nueva { get; private set; }
    public bool Lista { get; private set; }
    /// <summary>El commit de la última ficha rechazada por no ser más nueva (para anotarlo una sola vez).</summary>
    string rechazada = "";
    readonly SemaphoreSlim uno = new(1, 1);

    /// <summary>¿Hay una versión distinta a la mía publicada? Si la hay, la baja y la verifica.</summary>
    public async Task<Ficha?> Buscar(CancellationToken ct = default)
    {
        if (!await uno.WaitAsync(0, ct)) return Nueva;
        try
        {
            var json = await http.GetStringAsync(Base + "aura-windows.json", ct);
            using var d = JsonDocument.Parse(json);
            var r = d.RootElement;
            var f = new Ficha(
                (r.TryGetProperty("commit", out var c) ? c.GetString() ?? "" : "").Trim().ToLowerInvariant(),
                r.TryGetProperty("version", out var v) ? v.GetString() ?? "" : "",
                (r.TryGetProperty("sha256", out var s) ? s.GetString() ?? "" : "").Trim().ToLowerInvariant());
            if (f.Commit.Length < 7 || f.Sha256.Length != 64) throw new InvalidDataException("ficha incompleta");
            var mio = MiCommit;
            // Sin commit propio (un .exe armado a mano) no se actualiza solo: no sabríamos si es más nuevo.
            if (mio.Length == 0 || f.Commit.StartsWith(mio) || mio.StartsWith(f.Commit)) { Nueva = null; Lista = false; Limpiar(); return null; }
            // Solo hacia ADELANTE (auditoría 1-oct, H07): una ficha con versión igual, menor o ilegible no se instala
            // aunque el commit sea otro (una release vieja republicada, un manifiesto equivocado o manipulado).
            if (!Core.Actualizacion.EsMasNueva(f.Version, MiVersion))
            {
                if (rechazada != f.Commit) { rechazada = f.Commit; Centro.Registro.Anotar("actualizar", $"la publicada ({f.Version}) no es más nueva que esta ({MiVersion}): no se instala"); }
                Nueva = null; Lista = false; Limpiar(); return null;
            }
            Nueva = f;
            Lista = File.Exists(Instalador) && await Sha(Instalador, ct) == f.Sha256;
            if (!Lista)
            {
                Directory.CreateDirectory(Carpeta);
                var tmp = Instalador + ".bajando";
                using (var resp = await http.GetAsync(Base + "AURA-Windows-Setup-x64.exe", HttpCompletionOption.ResponseHeadersRead, ct))
                {
                    resp.EnsureSuccessStatusCode();
                    await using var o = File.Create(tmp);
                    await resp.Content.CopyToAsync(o, ct);
                }
                if (await Sha(tmp, ct) != f.Sha256) { File.Delete(tmp); throw new InvalidDataException("el instalador bajado no coincide con su SHA-256"); }
                File.Move(tmp, Instalador, true);
                Lista = true;
            }
            Centro.Registro.Anotar("actualizar", $"nueva {f.Version} ({f.Commit[..7]}) lista");
            return f;
        }
        finally { uno.Release(); }
    }

    /// <summary>Corre el instalador verificado en silencio. Él cierra AURA, la reemplaza y la vuelve a abrir.</summary>
    public bool Instalar()
    {
        if (!Lista || Nueva == null || !File.Exists(Instalador)) return false;
        if (!Core.Actualizacion.EsMasNueva(Nueva.Version, MiVersion)) { Lista = false; return false; }
        // Se verifica otra vez justo antes de correrlo (nadie lo cambió en el disco mientras esperaba).
        if (Sha(Instalador, default).GetAwaiter().GetResult() != Nueva.Sha256) { Lista = false; return false; }
        Centro.Registro.Anotar("actualizar", "instalando " + Nueva.Version);
        try { File.WriteAllText(Esperada, Nueva.Version); File.Delete(LogInstalacion); } catch { }
        // /ESPERAR=1: el instalador espera a que esta AURA suelte su candado (se cierra del todo) antes de copiar.
        // Antes arrancaba con AURA todavía abierta, Inno encontraba sus archivos en uso y en modo silencioso
        // abortaba sin decir nada (2-oct: «no actualiza desde la app»). /LOG deja cómo terminó para leerlo al volver.
        var psi = new ProcessStartInfo(Instalador) { UseShellExecute = false };
        foreach (var a in new[] { "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CLOSEAPPLICATIONS", "/FORCECLOSEAPPLICATIONS", "/RELANZAR=1", "/ESPERAR=1", "/LOG=" + LogInstalacion })
            psi.ArgumentList.Add(a);
        Process.Start(psi);
        return true;
    }

    /// <summary>Cómo terminó la última instalación (lo escribe Inno con /LOG). Fuera de la carpeta que se limpia.</summary>
    public static string LogInstalacion => Path.Combine(Centro.Registro.Carpeta, "ultima-instalacion.log");
    /// <summary>La versión que se estaba instalando: al volver se compara con la que corre.</summary>
    static string Esperada => Path.Combine(Centro.Registro.Carpeta, "instalando-version.txt");

    /// <summary>
    /// Al abrir: si había una instalación en marcha, dice cómo terminó (null si no había ninguna). Con la versión
    /// esperada corriendo, salió bien; si no, el motivo sale del log de Inno.
    /// </summary>
    public static (bool ok, string detalle)? ResultadoUltimaInstalacion()
    {
        try
        {
            if (!File.Exists(Esperada)) return null;
            var esperada = File.ReadAllText(Esperada).Trim();
            File.Delete(Esperada);
            if (!Core.Actualizacion.EsMasNueva(esperada, MiVersion)) return (true, $"quedó {MiVersion}");
            var log = File.Exists(LogInstalacion) ? File.ReadAllLines(LogInstalacion) : Array.Empty<string>();
            var motivo = log.LastOrDefault(l => l.Contains("rror", StringComparison.Ordinal) || l.Contains("abort", StringComparison.OrdinalIgnoreCase) || l.Contains("failed", StringComparison.OrdinalIgnoreCase))
                         ?? (log.Length == 0 ? "el instalador no dejó registro (no arrancó)" : log[^1]);
            return (false, $"seguía {MiVersion}, se esperaba {esperada}: {motivo.Trim()}");
        }
        catch (Exception ex) { return (false, "no pude leer el resultado: " + ex.Message); }
    }

    /// <summary>Borra instaladores viejos (ya instalados) para no ocupar disco.</summary>
    public static void Limpiar()
    {
        try { if (Directory.Exists(Carpeta)) foreach (var f in Directory.GetFiles(Carpeta)) File.Delete(f); } catch { }
    }

    static async Task<string> Sha(string ruta, CancellationToken ct)
    {
        await using var s = File.OpenRead(ruta);
        return Convert.ToHexString(await SHA256.HashDataAsync(s, ct)).ToLowerInvariant();
    }
}
