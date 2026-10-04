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
    /// <summary>Sube con cada cambio de identidad AURA (entrar otra persona, salir): lo de antes deja de valer.</summary>
    readonly GeneracionCuentas generacionCuentas = new();

    Conexion? Conectada(Proveedor p) => conexiones.TryGetValue(p, out var c) ? c : null;

    /// <summary>Quién está dentro ahora («» sin sesión).</summary>
    string IdentidadAura => DuenoCuentas.Identidad(ajustes.Token, ajustes.Correo);

    /// <summary>¿Las cuentas guardadas son de quien está dentro? Si no, no se usan.</summary>
    bool CuentasSirven => DuenoCuentas.Sirven(ajustes.DuenoCuentas, IdentidadAura);

    void CrearConexiones()
    {
        foreach (var c in conexiones.Values) c.Dispose();
        conexiones.Clear();
        if (!CuentasSirven) return;
        long gen = generacionCuentas.Actual;
        var dueno = ajustes.DuenoCuentas;
        foreach (var p in new[] { Proveedor.Spotify, Proveedor.Google, Proveedor.Microsoft })
        {
            var clave = Servicios.Clave(p);
            if (!ajustes.Conexiones.TryGetValue(clave, out var token) || Servicios.Config(ajustes, p) is not { } cfg) continue;
            conexiones[p] = new Conexion(cfg, token, nuevo => Dispatcher.BeginInvoke(new Action(() =>
            {
                // Solo si sigue conectada y es de la MISMA identidad: una renovación tardía no reinserta la cuenta de antes.
                if (!DuenoCuentas.PuedeGuardar(gen, generacionCuentas.Actual, dueno, ajustes.DuenoCuentas, ajustes.Conexiones.ContainsKey(clave))) return;
                ajustes.Conexiones[clave] = nuevo;
                try { ajustes.Guardar(); } catch { }
            })));
        }
    }

    /// <summary>
    /// Cambió la identidad AURA (salió, o entró otra persona): se detienen correo, agenda y conexiones, se borran
    /// sus tokens y claves (OAuth, IMAP, iCal), lo que quedaba en memoria (avisos pendientes, la conversación, una
    /// confirmación) y las cuentas pasan a ser de `nueva` (vacías). Lo que esté en vuelo deja de valer (generación).
    /// </summary>
    void LimpiarCuentas(string nueva)
    {
        generacionCuentas.Nueva();
        correo?.Dispose(); correo = null;
        agenda?.Dispose(); agenda = null;
        foreach (var c in conexiones.Values) c.Dispose();
        conexiones.Clear();
        // Lo ya visto del correo era de la cuenta anterior: la nueva empieza sin cursor.
        Aura.Windows.Core.CursorCorreo.OlvidarTodos();
        bool habia = ajustes.Conexiones.Count > 0 || ajustes.CorreoDireccion.Length > 0 || ajustes.CorreoClave.Length > 0 || ajustes.AgendaUrl.Length > 0;
        ajustes.Conexiones.Clear();
        ajustes.CorreoDireccion = ""; ajustes.CorreoClave = ""; ajustes.AgendaUrl = "";
        ajustes.DuenoCuentas = DuenoCuentas.Normalizar(nueva);
        // Lo que se veía o esperaba de la cuenta anterior: asuntos en avisos, el resumen en la conversación, un «sí» pendiente.
        avisos.Clear(); SiguienteAviso();
        historial.Clear(); ultimaRespuesta = "";
        if (propuesta != null) { propuesta = null; relojPropuesta?.Stop(); Recalcular(); }
        GuardarAjustes();
        AvisarEstadoCentro();
        Centro.Registro.Anotar("cuentas", habia ? "cambió la identidad: cuentas detenidas y borradas" : "cambió la identidad");
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
