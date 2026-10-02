using System;
using System.IO;
using System.Net.Http;
using System.Net.Http.Json;
using System.Threading.Tasks;
using Aura.Windows.Core;

namespace Aura.Windows.Centro;

/// <summary>
/// Lo que falla en la PC de alguien también llega al servidor (`/api/diag`, el mismo de la APK, visible en los
/// logs de Render): las caídas y cómo terminó una actualización. Antes solo quedaba en el aura.log de esa PC y
/// había que pedirlo (2-oct: «no actualiza desde la app» sin rastro). Va SOLO el tipo de evento, la versión y
/// un resumen saneado (RegistroSeguro.Sanear aquí y lib/diag-saneador.ts allá): nada de lo que dijiste, ni
/// correos, ni tokens. Sin sesión, como la APK (una app que se cae no siempre puede autenticarse).
/// Una caída que mata el proceso no alcanza a mandar nada: se deja escrita y se manda al volver a abrir.
/// </summary>
internal static class Diagnostico
{
    static readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(8) };
    /// <summary>Un id por arranque: une los reportes de una misma corrida en el log sin decir quién es.</summary>
    static readonly string corrida = Guid.NewGuid().ToString("N")[..12];
    static string Pendiente => Path.Combine(Registro.Carpeta, "fallo-pendiente.txt");
    static DateTime ultimo = DateTime.MinValue;

    /// <summary>El servidor configurado (solo https; si no, el de siempre).</summary>
    public static string Servidor { get; set; } = AuraApi.ServidorPorDefecto;

    /// <summary>Manda un reporte sin esperar. `tipo`: estado | crash-previo | error-js. Uno cada 20 s como mucho.</summary>
    public static void Reportar(string tipo, string nota, string? error = null)
    {
        if (DateTime.UtcNow - ultimo < TimeSpan.FromSeconds(20)) return;
        ultimo = DateTime.UtcNow;
        _ = Mandar(tipo, nota, error);
    }

    static async Task Mandar(string tipo, string nota, string? error)
    {
        try
        {
            var baseUri = Uri.TryCreate(Servidor, UriKind.Absolute, out var u) && u.Scheme == Uri.UriSchemeHttps ? u : new Uri(AuraApi.ServidorPorDefecto);
            var cuerpo = new
            {
                tipo,
                version = Manos.Actualizador.MiVersion,
                plataforma = "windows",
                dispositivo = Environment.OSVersion.Version.ToString(),
                sesion = corrida,
                nota = RegistroSeguro.Sanear(nota),
                error = error == null ? null : RegistroSeguro.Sanear(error),
                migas = Array.Empty<string>(),
            };
            using var r = await http.PostAsJsonAsync(new Uri(baseUri, "/api/diag"), cuerpo).ConfigureAwait(false);
        }
        catch { /* sin red: queda en el aura.log */ }
    }

    /// <summary>La caída que va a matar el proceso: se escribe ya (no hay tiempo de mandarla).</summary>
    public static void DejarCaida(string resumen)
    {
        try { File.WriteAllText(Pendiente, RegistroSeguro.Sanear(resumen.Length > 600 ? resumen[..600] : resumen)); } catch { }
    }

    /// <summary>Al abrir: si la vez anterior se cayó, se manda ahora.</summary>
    public static void MandarCaidaPendiente()
    {
        try
        {
            if (!File.Exists(Pendiente)) return;
            var texto = File.ReadAllText(Pendiente);
            File.Delete(Pendiente);
            Reportar("crash-previo", "AURA Windows se cayó la vez anterior", texto);
        }
        catch { }
    }
}
