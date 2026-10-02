using System.Threading;

namespace Aura.Windows.Core;

/// <summary>
/// Las cuentas conectadas (Google, Microsoft, Spotify), el correo IMAP y el calendario iCal son de UNA identidad
/// AURA: la que estaba dentro cuando se conectaron. Si entra otra persona (o se sale), no se usan: se borran. DPAPI
/// separa usuarios de Windows, no identidades AURA en la misma cuenta de Windows.
/// </summary>
public static class DuenoCuentas
{
    /// <summary>El correo como clave de identidad: sin espacios y en minúsculas.</summary>
    public static string Normalizar(string? correo) => (correo ?? "").Trim().ToLowerInvariant();

    /// <summary>Quién está dentro ahora: el correo de la sesión, o «» sin sesión.</summary>
    public static string Identidad(string? token, string? correo) => string.IsNullOrEmpty(token) ? "" : Normalizar(correo);

    /// <summary>¿Las cuentas guardadas (de `dueno`) sirven para `identidad`? Solo con sesión y si son de ella.</summary>
    public static bool Sirven(string? dueno, string? identidad)
    {
        var d = Normalizar(dueno); var i = Normalizar(identidad);
        return i.Length > 0 && d == i;
    }

    /// <summary>
    /// Solo AL ARRANCAR: las cuentas de antes de esta versión no tenían dueño; si hay sesión, son de quien ya
    /// estaba dentro (las conectó ella). Sin sesión no se adopta nada. Al ENTRAR nunca se adopta: lo que no
    /// tiene dueño (o es de otra persona) se borra.
    /// </summary>
    public static string Migrar(string? dueno, string? identidad)
    {
        var d = Normalizar(dueno); var i = Normalizar(identidad);
        return d.Length == 0 ? i : d;
    }

    /// <summary>¿Al entrar `identidad` hay que borrar las cuentas guardadas? Siempre que no sean suyas.</summary>
    public static bool HayQueLimpiar(string? dueno, string? identidad) => !Sirven(dueno, identidad);

    /// <summary>
    /// ¿Se puede guardar algo que llegó tarde (un token renovado, una conexión que terminó en el navegador)?
    /// Solo si no cambió la identidad mientras tanto (misma generación y mismo dueño) y la cuenta sigue conectada.
    /// </summary>
    public static bool PuedeGuardar(long generacionAlEmpezar, long generacionAhora, string? duenoAlEmpezar, string? duenoAhora, bool sigueConectada)
        => sigueConectada && generacionAlEmpezar == generacionAhora && Normalizar(duenoAlEmpezar).Length > 0 && Normalizar(duenoAlEmpezar) == Normalizar(duenoAhora);
}

/// <summary>Un contador que sube con cada cambio de identidad: lo que empezó antes ya no es vigente.</summary>
public sealed class GeneracionCuentas
{
    long actual;
    public long Actual => Interlocked.Read(ref actual);
    public long Nueva() => Interlocked.Increment(ref actual);
    public bool Vigente(long g) => g == Actual;
}
