using System;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Threading;
using Aura.Windows.Manos;

namespace Aura.Windows.Notch;

/// <summary>
/// Actualizar por el aire: mira la release cada 6 horas (la primera, al minuto y medio de abrir). Con una
/// versión nueva ya bajada y verificada, se instala sola cuando llevas un rato sin usar la PC (si está
/// activado en Ajustes) o te avisa en el notch con el botón «Actualizar».
/// </summary>
public partial class NotchWindow
{
    readonly Actualizador actualizador = new();
    readonly DispatcherTimer relojActualizar = new() { Interval = TimeSpan.FromSeconds(90) };
    string avisadaActualizacion = "";

    [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
    [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO i);

    static TimeSpan Inactivo()
    {
        var i = new LASTINPUTINFO { cbSize = (uint)Marshal.SizeOf<LASTINPUTINFO>() };
        return GetLastInputInfo(ref i) ? TimeSpan.FromMilliseconds(unchecked((uint)Environment.TickCount - i.dwTime)) : TimeSpan.Zero;
    }

    void IniciarActualizaciones()
    {
        if (soloRender) return;
        relojActualizar.Tick += async (_, _) =>
        {
            relojActualizar.Interval = actualizador.Lista ? TimeSpan.FromMinutes(10) : TimeSpan.FromHours(6);
            await BuscarActualizacion(false);
        };
        relojActualizar.Start();
    }

    async Task BuscarActualizacion(bool manual)
    {
        try
        {
            var f = actualizador.Lista ? actualizador.Nueva : await actualizador.Buscar();
            AvisarEstadoCentro();
            if (f == null || !actualizador.Lista)
            {
                if (manual) Avisar(new Aviso(T("AURA está al día", "AURA is up to date"), T($"Versión {Actualizador.MiVersion}.", $"Version {Actualizador.MiVersion}."), "", "happy", Segundos: 4));
                return;
            }
            // Sola: sin usar la PC hace 10 minutos y sin nada en curso (llamada, voz, confirmación).
            bool libre = propuesta == null && !escuchando && !pensando && !hablandoAhora && !turnoEnCurso;
            if (!manual && ajustes.ActualizarSolo && libre && Inactivo() > TimeSpan.FromMinutes(10)) { InstalarActualizacion(); return; }
            if (manual || avisadaActualizacion != f.Commit)
            {
                avisadaActualizacion = f.Commit;
                Avisar(new Aviso(T("Hay una AURA nueva", "A new AURA is ready"),
                    T("Ya está bajada y verificada. Tarda unos segundos y vuelvo sola.", "Downloaded and verified. Takes a few seconds."), "", "happy",
                    T("Actualizar", "Update"), () => InstalarActualizacion(), 12));
            }
        }
        catch (Exception ex)
        {
            Centro.Registro.Anotar("actualizar", ex.Message);
            if (manual) Avisar(new Aviso(T("No pude buscar la actualización", "Couldn't check for updates"), ex.Message, "", "worried", Segundos: 6));
        }
    }

    bool actualizando;

    /// <summary>
    /// Instala la versión nueva: si no estaba bajada, la baja primero (con aviso de cada paso); arranca el
    /// instalador verificado y AURA sale sola (sin preguntar por el borrador: se recupera igual al volver).
    /// Devuelve por qué no pudo, o null si ya está en marcha.
    /// </summary>
    internal async Task<string?> InstalarAhora()
    {
        if (actualizando) return null;
        try
        {
            if (!actualizador.Lista)
            {
                Avisar(new Aviso(T("Bajando la versión nueva…", "Downloading the new version…"), T("Tarda un minuto; te aviso.", "Takes a minute."), "\uE896", "happy", Segundos: 6));
                await actualizador.Buscar();
                if (actualizador.Nueva == null) return T("Ya tienes la última versión.", "You already have the latest version.");
                if (!actualizador.Lista) return T("No pude bajar la versión nueva. Revisa tu internet y vuelve a intentar.", "Couldn't download the new version.");
            }
            Centro.Registro.Anotar("actualizar", "arrancando el instalador");
            if (!actualizador.Instalar()) return T("El instalador bajado no pasó la verificación; lo vuelvo a bajar en la próxima búsqueda.", "The downloaded installer failed verification.");
            actualizando = true;
            Avisar(new Aviso(T("Actualizando AURA…", "Updating AURA…"), T("Me cierro y vuelvo sola en unos segundos.", "Closing and coming back in a few seconds."), "\uE895", "happy", Segundos: 3));
            // Salir sin preguntar por el borrador (queda guardado y se recupera al volver) y sin depender de nadie.
            await Task.Delay(1500);
            borradorSucio = false;
            Close();
            // Si algo impidiera cerrar, igual se sale: el instalador no puede reemplazar un AURA abierto.
            await Task.Delay(4000);
            Centro.Registro.Anotar("actualizar", "salida forzada para que el instalador siga");
            Environment.Exit(0);
            return null;
        }
        catch (Exception ex)
        {
            Centro.Registro.Anotar("actualizar", "falló: " + ex.Message);
            return ex.Message;
        }
    }

    bool InstalarActualizacion() { _ = InstalarAhora(); return true; }

    object EstadoActualizacion() => new
    {
        version = Actualizador.MiVersion,
        commit = Actualizador.MiCommit.Length >= 7 ? Actualizador.MiCommit[..7] : "",
        nueva = actualizador.Nueva?.Version,
        lista = actualizador.Lista,
        sola = ajustes.ActualizarSolo,
    };
}
