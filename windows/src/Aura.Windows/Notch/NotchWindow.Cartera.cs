using System;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Aura.Windows.Core;
using Aura.Windows.Manos;

namespace Aura.Windows.Notch;

/// <summary>La cartera en el notch («¿cuánto ORIGEN tengo?») y en el Centro. Solo lectura.</summary>
public partial class NotchWindow
{
    async Task HacerCartera(string valor)
    {
        if (!CarteraVeta.EsDireccion(ajustes.CarteraDireccion))
        {
            NoPude(T("Todavía no conozco tu cartera. Abre el Centro → Cartera y pega tu dirección de Veta Wallet (solo para leer saldos).", "I don't know your wallet yet. Open the Center → Wallet and paste your Veta Wallet address (read-only)."));
            AbrirCentro("cartera");
            return;
        }
        pensando = true; TextoPiensa.Text = T("Revisando tu cartera…", "Checking your wallet…"); Recalcular();
        try
        {
            var saldos = await Cartera.Saldos(ajustes.CarteraDireccion);
            pensando = false;
            var dicho = CarteraVeta.Decir(saldos, valor == "todo" ? null : valor, Ingles);
            var total = saldos.Sum(s => s.ValorUsd ?? 0);
            Hecho(valor == "todo" ? T("Tu cartera", "Your wallet") : valor, valor == "todo" ? $"≈ US$ {total:#,0.##}" : dicho, "", dicho, T("Ver", "View"), () => AbrirCentro("cartera"), 6);
        }
        catch (Exception ex) when (ex is InvalidOperationException or System.Net.Http.HttpRequestException or TaskCanceledException) { NoPude(ex.Message); }
    }

    async Task<object?> ManejarCartera(string metodo, JsonElement a)
    {
        switch (metodo)
        {
            case "cartera.direccion":
                ajustes.CarteraDireccion = Cartera.ValidarDireccion(Texto(a, "direccion"));
                GuardarAjustes(); AvisarEstadoCentro();
                return ajustes.CarteraDireccion;
            case "cartera.saldos":
            {
                if (!CarteraVeta.EsDireccion(ajustes.CarteraDireccion)) return new { direccion = "", saldos = Array.Empty<object>(), total = 0m };
                var saldos = await Cartera.Saldos(ajustes.CarteraDireccion, Bool(a, "forzar") == true);
                return new
                {
                    direccion = ajustes.CarteraDireccion,
                    total = saldos.Sum(s => s.ValorUsd ?? 0),
                    saldos = saldos.Select(s => new { simbolo = s.Simbolo, cantidad = s.Cantidad, precio = s.PrecioUsd, usd = s.ValorUsd }),
                    actualizado = DateTime.Now.ToString("HH:mm"),
                };
            }
            case "cartera.abrirWallet":
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("https://app.vetawallet.com/") { UseShellExecute = true });
                return true;
            default: throw new InvalidOperationException("Método desconocido: " + metodo);
        }
    }
}

public partial class NotchWindow
{
    static readonly System.Collections.Generic.Dictionary<string, (string Es, string En)> NombresAtajo = new()
    {
        ["CTRL+C"] = ("Copiado", "Copied"), ["CTRL+V"] = ("Pegado", "Pasted"), ["CTRL+X"] = ("Cortado", "Cut"), ["CTRL+Z"] = ("Deshecho", "Undone"),
        ["CTRL+Y"] = ("Rehecho", "Redone"), ["CTRL+A"] = ("Todo seleccionado", "All selected"), ["CTRL+S"] = ("Guardado", "Saved"),
        ["CTRL+T"] = ("Pestaña nueva", "New tab"), ["CTRL+W"] = ("Pestaña cerrada", "Tab closed"), ["F5"] = ("Recargada", "Reloaded"),
    };

    /// <summary>Atajos del equipo. Las teclas van a la ventana donde trabajas (no al notch ni al Centro).</summary>
    async void HacerAtajo(string valor)
    {
        var partes = valor.Split('|', 2);
        var arg = partes.Length > 1 ? partes[1] : "";
        try
        {
            switch (partes[0])
            {
                case "teclas":
                    // Si el panel o el Centro tienen el foco, primero vuelve la ventana de trabajo.
                    if ((IsActive || centro?.IsActive == true) && Manos.Pantalla.UltimaAjena != IntPtr.Zero) { Manos.Ventanas.AlFrente(Manos.Pantalla.UltimaAjena); await Task.Delay(180); }
                    Manos.Teclado.Combinacion(arg);
                    var nombre = NombresAtajo.TryGetValue(arg, out var n) ? T(n.Es, n.En) : arg.Replace("+", " + ");
                    Hecho(nombre, "", ""); // sin voz: un atajo no necesita que AURA hable
                    break;
                case "config":
                    Manos.Teclado.Configuracion(arg);
                    Hecho(T("Configuración de Windows", "Windows Settings"), arg, "");
                    break;
                case "brillo":
                {
                    var nuevo = await Manos.Teclado.Brillo(arg);
                    Hecho(T($"Brillo al {nuevo} %", $"Brightness {nuevo}%"), "", "");
                    break;
                }
                case "tema":
                    Manos.Teclado.Tema(arg == "oscuro");
                    Hecho(arg == "oscuro" ? T("Modo oscuro", "Dark mode") : T("Modo claro", "Light mode"), "", "");
                    break;
            }
            Centro.Registro.Anotar("atajo", valor);
        }
        catch (Exception ex) { NoPude(ex.Message); }
    }
}
