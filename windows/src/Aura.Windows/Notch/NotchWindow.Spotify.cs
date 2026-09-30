using System;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Aura.Windows.Core;
using Aura.Windows.Manos;

namespace Aura.Windows.Notch;

/// <summary>El reproductor de Spotify del Centro y conectar/desconectar cuentas desde ahí.</summary>
public partial class NotchWindow
{
    Conexion SpotifyONada() => Conectada(Proveedor.Spotify)
        ?? throw new InvalidOperationException(T("Conecta Spotify primero (Ajustes → Conexiones).", "Connect Spotify first (Settings → Connections)."));

    async Task<object?> ManejarSpotify(string metodo, JsonElement a)
    {
        switch (metodo)
        {
            case "spotify.estado":
            {
                var c = Conectada(Proveedor.Spotify);
                // Sin cuenta: lo que Windows ve sonar (cualquier app) sigue sirviendo para la tarjeta.
                if (c == null) return new { conectado = false, local = cancion == null ? null : new { titulo = cancion.Titulo, artista = cancion.Artista, app = cancion.App, sonando = cancion.Sonando } };
                var s = await SpotifyWeb.Estado(c);
                return new { conectado = true, cuenta = c.Cuenta, sonando = s };
            }
            case "spotify.buscar":
            {
                var q = Texto(a, "q").Trim();
                if (q.Length < 2) return Array.Empty<object>();
                return await SpotifyWeb.Buscar(SpotifyONada(), q.Length > 100 ? q[..100] : q);
            }
            case "spotify.poner": await SpotifyWeb.PonerUri(SpotifyONada(), Texto(a, "uri")); return true;
            case "spotify.control": await SpotifyWeb.Control(SpotifyONada(), Texto(a, "accion")); return true;
            case "spotify.dispositivos": return (await SpotifyWeb.Dispositivos(SpotifyONada())).Select(d => new { id = d.Id, nombre = d.Nombre, activo = d.Activo });
            case "spotify.transferir": await SpotifyWeb.Transferir(SpotifyONada(), Texto(a, "id")); return true;
            default: throw new InvalidOperationException("Método desconocido: " + metodo);
        }
    }

    /// <summary>Conectar (o desconectar) Spotify, Google o Microsoft desde el Centro.</summary>
    async Task<object?> ManejarConexion(string metodo, string servicio)
    {
        var prov = servicio switch { "spotify" => Proveedor.Spotify, "google" => Proveedor.Google, "microsoft" => Proveedor.Microsoft, _ => throw new InvalidOperationException("Servicio desconocido.") };
        var clave = Servicios.Clave(prov);
        if (metodo == "desconectar")
        {
            ajustes.Conexiones.Remove(clave);
            GuardarAjustes(); IniciarCuentas(); AvisarEstadoCentro();
            Centro.Registro.Anotar("conexion", clave + " desconectada");
            return true;
        }
        // El Client ID: el propio (Avanzado) o el que puso el servidor AU-RA en Render.
        if (Servicios.Config(ajustes, prov) == null)
        {
            if (api == null || string.IsNullOrEmpty(api.Token)) throw new InvalidOperationException(T("Primero entra con tu cuenta AU-RA: de ahí sale el permiso de la app.", "Sign in to AU-RA first: the app permission comes from there."));
            var ids = await api.ClientesOauth();
            if (prov == Proveedor.Spotify && ids.Spotify != null) ajustes.SpotifyClientId = ids.Spotify;
            if (prov == Proveedor.Google && ids.Google != null) { ajustes.GoogleClientId = ids.Google; ajustes.GoogleClientSecret = ids.GoogleSecreto ?? ""; }
            if (prov == Proveedor.Microsoft && ids.Microsoft != null) ajustes.MicrosoftClientId = ids.Microsoft;
        }
        var cfg = Servicios.Config(ajustes, prov)
            ?? throw new InvalidOperationException(T($"AU-RA todavía no tiene la app de {servicio} registrada (falta su Client ID en el servidor).", $"AU-RA doesn't have the {servicio} app registered yet (missing Client ID on the server)."));
        Centro.Registro.Anotar("conexion", $"conectando {clave}");
        TokenOauth token;
        try { token = await Conexion.Entrar(cfg); }
        catch (InvalidOperationException ex)
        {
            Centro.Registro.Anotar("conexion", $"{clave} falló: {ex.Message}");
            throw new InvalidOperationException(Explicar(prov, ex.Message));
        }
        ajustes.Conexiones[clave] = token;
        GuardarAjustes(); IniciarCuentas(); AvisarEstadoCentro();
        Centro.Registro.Anotar("conexion", $"{clave} conectada");
        return new { cuenta = token.Cuenta };
    }

    /// <summary>Los errores de cada servicio, en lo que hay que hacer.</summary>
    string Explicar(Proveedor p, string m)
    {
        var l = m.ToLowerInvariant();
        if (l.Contains("redirect")) return T($"El servicio no reconoce la dirección de vuelta. En su panel de desarrollador registra exactamente: {Oauth.Redireccion}", $"The service doesn't know the return address. Register exactly: {Oauth.Redireccion}");
        if (p == Proveedor.Spotify && (l.Contains("invalid_client") || l.Contains("client"))) return T("Spotify no reconoce la app (Client ID). Revisa que esté bien puesto en Render.", "Spotify doesn't recognize the app (Client ID).");
        if (l.Contains("access_denied") || l.Contains("cancelaste")) return T("Cancelaste el permiso en el navegador.", "You cancelled in the browser.");
        if (p == Proveedor.Spotify && (l.Contains("user") || l.Contains("403"))) return T("Spotify no deja entrar a esa cuenta: agrégala en «User Management» de la app (modo de desarrollo, hasta 25 cuentas).", "Spotify won't let that account in: add it under “User Management”.");
        return m;
    }
}
