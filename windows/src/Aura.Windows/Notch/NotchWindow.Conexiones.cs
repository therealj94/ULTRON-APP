using System;
using System.Collections.Generic;
using System.Linq;
using Aura.Windows.Core;
using Aura.Windows.Manos;

namespace Aura.Windows.Notch;

/// <summary>
/// Las cuentas conectadas (Spotify, Google, Microsoft) vivas mientras corre AURA: cada una renueva su
/// token sola y lo guarda cifrado. Correo y agenda eligen la fuente en este orden: Google, Microsoft,
/// y si no hay ninguna conectada, IMAP / iCal.
/// </summary>
public partial class NotchWindow
{
    readonly Dictionary<Proveedor, Conexion> conexiones = new();

    Conexion? Conectada(Proveedor p) => conexiones.TryGetValue(p, out var c) ? c : null;

    void CrearConexiones()
    {
        foreach (var c in conexiones.Values) c.Dispose();
        conexiones.Clear();
        foreach (var p in new[] { Proveedor.Spotify, Proveedor.Google, Proveedor.Microsoft })
        {
            var clave = Servicios.Clave(p);
            if (!ajustes.Conexiones.TryGetValue(clave, out var token) || Servicios.Config(ajustes, p) is not { } cfg) continue;
            conexiones[p] = new Conexion(cfg, token, nuevo => Dispatcher.BeginInvoke(new Action(() =>
            {
                // Solo si sigue conectada (no la desconectaron mientras renovaba).
                if (!ajustes.Conexiones.ContainsKey(clave)) return;
                ajustes.Conexiones[clave] = nuevo;
                try { ajustes.Guardar(); } catch { }
            })));
        }
    }

    (Buzon? Buzon, AgendaCuenta? Agenda) FuentesDeCuentas()
    {
        Buzon? b = null; AgendaCuenta? ag = null;
        if (Conectada(Proveedor.Google) is { } g)
        {
            b = new BuzonApi(g.Cuenta.Length > 0 ? g.Cuenta : "Gmail", (max, ct) => GoogleWeb.NoLeidos(g, max, ct));
            ag = new AgendaCuenta("Google Calendar", (d, h, ct) => GoogleWeb.Eventos(g, d, h, ct));
        }
        if (Conectada(Proveedor.Microsoft) is { } m)
        {
            b ??= new BuzonApi(m.Cuenta.Length > 0 ? m.Cuenta : "Outlook", (max, ct) => GraphWeb.NoLeidos(m, max, ct));
            ag ??= new AgendaCuenta("Outlook", (d, h, ct) => GraphWeb.Eventos(m, d, h, ct));
        }
        return (b, ag);
    }
}
