using System.Security.Cryptography;
using System.Text;

namespace Aura.Windows.Core;

/// <summary>
/// ENTRAR CON GENESIS ID, como la app: AURA no ve la contraseña de la wallet. Le pide a Veta Wallet un
/// PASE de Genesis ID (la persona lo autoriza allá) y la wallet vuelve a <c>ultronfp://sso?pase=…&amp;estado=…</c>,
/// que Windows le entrega a AURA (el esquema lo registra AURA para esta cuenta de Windows).
///
/// EL RETO (como PKCE): AURA inventa un verificador y manda solo su huella SHA-256; para canjear el pase
/// hace falta el verificador, que nunca sale de aquí. El <c>estado</c> descarta vueltas que no pidió
/// este equipo. El mismo pase abre la sesión de AU-RA y, una vez, el chat PULSE2CHAT.
/// </summary>
public static class GenesisSso
{
    public const string VueltaEsquema = "ultronfp://sso";
    public const string VueltaWeb = "https://aura-fp.onrender.com/sso";
    public const string WalletWebPorDefecto = "https://app.vetawallet.com/#sso-aura";

    static string B64Url(byte[] b) => Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    /// <summary>El verificador (queda aquí), su huella (viaja) y el estado de este pedido.</summary>
    public static (string Verificador, string Reto, string Estado) Nuevo()
    {
        var verificador = B64Url(RandomNumberGenerator.GetBytes(32));
        return (verificador, Reto(verificador), B64Url(RandomNumberGenerator.GetBytes(12)));
    }

    /// <summary>La huella del verificador: base64url(SHA-256 de sus caracteres ASCII), igual que la app.</summary>
    public static string Reto(string verificador) => B64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verificador)));

    /// <summary>La página de la wallet con el reto. Sin «vuelta»: la wallet vuelve a ultronfp://sso por omisión.</summary>
    public static string Url(string? walletWeb, string reto, string estado)
    {
        var baseUrl = walletWeb is { Length: > 0 } w && w.StartsWith("https://", StringComparison.Ordinal) ? w : WalletWebPorDefecto;
        return $"{baseUrl}{(baseUrl.Contains('?') ? "&" : "?")}reto={Uri.EscapeDataString(reto)}&estado={Uri.EscapeDataString(estado)}";
    }

    /// <summary>
    /// Lee pase, error y estado de la vuelta. El prefijo es EXACTO (después de «sso» solo ?, /, # o el fin):
    /// «ultronfp://ssoXYZ» o «https://aura-fp.onrender.com.otro/sso» no son una vuelta. Nunca lanza.
    /// </summary>
    public static (string? Pase, string? Error, string? Estado)? LeerVuelta(string? url)
    {
        var u = (url ?? "").Trim().Trim('"');
        string? prefijo = null;
        foreach (var p in new[] { VueltaEsquema, VueltaWeb })
            if (u.StartsWith(p, StringComparison.OrdinalIgnoreCase)) { prefijo = p; break; }
        if (prefijo == null) return null;
        if (u.Length > prefijo.Length && u[prefijo.Length] is not ('?' or '/' or '#')) return null;
        var i = u.IndexOf('?');
        string? pase = null, error = null, estado = null;
        if (i >= 0)
        {
            var q = u[(i + 1)..].Split('#')[0];
            foreach (var par in q.Split('&', StringSplitOptions.RemoveEmptyEntries))
            {
                var kv = par.Split('=', 2);
                string k, v;
                try { k = Uri.UnescapeDataString(kv[0]); v = kv.Length > 1 ? Uri.UnescapeDataString(kv[1].Replace('+', ' ')) : ""; }
                catch (UriFormatException) { continue; }
                if (k == "pase") pase = v; else if (k == "error") error = v; else if (k == "estado") estado = v;
            }
        }
        return (pase, error, estado);
    }

    /// <summary>Lo que dice la wallet cuando no dio el pase, en palabras de persona.</summary>
    public static string ExplicarError(string codigo, bool en = false) => codigo switch
    {
        "cancelado" => en ? "You cancelled it in the wallet." : "Cancelaste el permiso en la wallet.",
        "sin-gid" => en ? "Your wallet has no Genesis ID yet. Create it in Veta Wallet and try again." : "Tu wallet todavía no tiene Genesis ID. Créalo en Veta Wallet y vuelve a intentar.",
        "gid-pendiente" => en ? "Your Genesis ID is still being verified." : "Tu Genesis ID todavía se está verificando.",
        "no-vinculada" => en ? "That wallet isn't linked to a Genesis ID." : "Esa wallet no está vinculada a un Genesis ID.",
        "correo-sin-confirmar" => en ? "Confirm your email in Veta Wallet first." : "Primero confirma tu correo en Veta Wallet.",
        "limite" => en ? "Too many attempts; wait a minute." : "Demasiados intentos; espera un minuto.",
        "red" => en ? "The wallet had no connection." : "La wallet no tuvo conexión.",
        _ => (en ? "The wallet didn't give the pass: " : "La wallet no dio el pase: ") + codigo,
    };
}

/// <summary>Quién entró (lo que devuelve AU-RA al canjear el pase o la clave).</summary>
public sealed record Miembro(string Nombre, string Correo, string Rol, string Gid, string Nivel);
