using System;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32;

namespace Aura.Windows.Centro;

/// <summary>
/// El enlace <c>ultronfp://</c> (la vuelta de Veta Wallet con el pase de Genesis ID) y los pedidos a la
/// AURA que ya está abierta. Windows abre «Aura.Windows.exe ultronfp://sso?…» como un proceso nuevo: ese
/// proceso le pasa el enlace a la instancia viva por una tubería con nombre y se cierra.
/// El esquema se registra para ESTA cuenta de Windows (HKCU), sin pedir administrador.
/// </summary>
internal static class Protocolo
{
    public const string Esquema = "ultronfp";
    static readonly string Tubo = "Aura.Windows.Pedidos." + Environment.UserName;
    /// <summary>Llegó un pedido (un enlace ultronfp:// o «--centro»). Viene de otro hilo.</summary>
    public static event Action<string>? Llego;

    public static void Registrar()
    {
        try
        {
            var exe = Environment.ProcessPath ?? Path.Combine(AppContext.BaseDirectory, "Aura.Windows.exe");
            using var k = Registry.CurrentUser.CreateSubKey($@"Software\Classes\{Esquema}");
            k.SetValue("", "URL:AURA (Genesis ID)");
            k.SetValue("URL Protocol", "");
            using (var ic = k.CreateSubKey("DefaultIcon")) ic.SetValue("", $"\"{exe}\",0");
            using var cmd = k.CreateSubKey(@"shell\open\command");
            cmd.SetValue("", $"\"{exe}\" \"%1\"");
        }
        catch (Exception ex) { Registro.Anotar("protocolo", "no se pudo registrar ultronfp://: " + ex.Message); }
    }

    /// <summary>Le pasa el pedido a la AURA abierta. Devuelve si lo recibió.</summary>
    public static bool Enviar(string pedido)
    {
        try
        {
            // Solo a la tubería de ESTE usuario: en una PC compartida, otro podría crearla antes y recibir la vuelta de Genesis ID.
            using var c = new NamedPipeClientStream(".", Tubo, PipeDirection.Out, PipeOptions.CurrentUserOnly);
            c.Connect(2500);
            var b = Encoding.UTF8.GetBytes(pedido.Length > 8000 ? pedido[..8000] : pedido);
            c.Write(b, 0, b.Length);
            return true;
        }
        catch { return false; }
    }

    public static void Escuchar(CancellationToken ct) => Task.Run(async () =>
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                using var s = new NamedPipeServerStream(Tubo, PipeDirection.In, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                await s.WaitForConnectionAsync(ct);
                using var ms = new MemoryStream();
                await s.CopyToAsync(ms, ct);
                var pedido = Encoding.UTF8.GetString(ms.ToArray()).Trim();
                if (pedido.Length > 0) Llego?.Invoke(pedido);
            }
            catch (OperationCanceledException) { return; }
            catch (Exception ex) { Registro.Anotar("protocolo", ex.Message); await Task.Delay(500); }
        }
    });

    /// <summary>El pedido de la línea de comandos: un enlace ultronfp:// o «--centro», o null.</summary>
    public static string? PedidoDe(string[] args)
    {
        foreach (var a in args)
        {
            if (a.StartsWith(Esquema + "://", StringComparison.OrdinalIgnoreCase)) return a;
            if (a == "--centro") return a;
        }
        return null;
    }
}
