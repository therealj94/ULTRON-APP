using System.IO;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;

namespace Aura.Windows.Centro;

/// <summary>
/// El entorno de WebView2 de AURA (el perfil «Centro», con el audio sin esperar un clic): uno solo para el Centro y
/// para el orbe del notch, así comparten un único grupo de procesos de Edge en vez de dos. Si no se pudo crear (sin
/// WebView2 Runtime), el siguiente pedido lo vuelve a intentar: quizá ya lo instalaron.
/// </summary>
internal static class EntornoWeb
{
    static Task<CoreWebView2Environment>? tarea;

    /// <summary>Solo desde el hilo de la ventana (como todo WebView2).</summary>
    public static Task<CoreWebView2Environment> Compartido()
    {
        if (tarea == null || tarea.IsFaulted || tarea.IsCanceled)
            tarea = CoreWebView2Environment.CreateAsync(null, Path.Combine(Registro.Carpeta, "Centro"),
                new CoreWebView2EnvironmentOptions("--autoplay-policy=no-user-gesture-required"));
        return tarea;
    }
}
