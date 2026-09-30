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

    bool InstalarActualizacion()
    {
        if (!actualizador.Instalar()) return false;
        Avisar(new Aviso(T("Actualizando AURA…", "Updating AURA…"), T("Vuelvo en unos segundos.", "Back in a few seconds."), "", "happy", Segundos: 3));
        // El instalador cierra AURA de todos modos; salir antes deja todo guardado y en orden.
        var t = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1.5) };
        t.Tick += (_, _) => { t.Stop(); Close(); };
        t.Start();
        return true;
    }

    object EstadoActualizacion() => new
    {
        version = Actualizador.MiVersion,
        commit = Actualizador.MiCommit.Length >= 7 ? Actualizador.MiCommit[..7] : "",
        nueva = actualizador.Nueva?.Version,
        lista = actualizador.Lista,
        sola = ajustes.ActualizarSolo,
    };
}
