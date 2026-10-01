using System;
using System.Runtime.InteropServices;

namespace Aura.Windows.Manos;

/// <summary>
/// El volumen del equipo a un nivel exacto («pon el volumen al 30»), con la API de audio de Windows
/// (IAudioEndpointVolume del altavoz por defecto). Sin consola: COM directo.
/// </summary>
internal static class Audio
{
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class EnumeradorCom { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        int EnumAudioEndpoints(int flujo, int estado, out IntPtr dispositivos);
        int GetDefaultAudioEndpoint(int flujo, int rol, out IMMDevice dispositivo);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        int Activate(ref Guid iid, int contexto, IntPtr parametros, [MarshalAs(UnmanagedType.IUnknown)] out object interfaz);
    }

    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioEndpointVolume
    {
        int RegisterControlChangeNotify(IntPtr aviso);
        int UnregisterControlChangeNotify(IntPtr aviso);
        int GetChannelCount(out uint canales);
        int SetMasterVolumeLevel(float db, ref Guid contexto);
        int SetMasterVolumeLevelScalar(float nivel, ref Guid contexto);
        int GetMasterVolumeLevel(out float db);
        int GetMasterVolumeLevelScalar(out float nivel);
        int SetChannelVolumeLevel(uint canal, float db, ref Guid contexto);
        int SetChannelVolumeLevelScalar(uint canal, float nivel, ref Guid contexto);
        int GetChannelVolumeLevel(uint canal, out float db);
        int GetChannelVolumeLevelScalar(uint canal, out float nivel);
        int SetMute([MarshalAs(UnmanagedType.Bool)] bool mudo, ref Guid contexto);
        int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mudo);
    }

    static IAudioEndpointVolume Altavoz()
    {
        var enumerador = (IMMDeviceEnumerator)new EnumeradorCom();
        // eRender = 0, eMultimedia = 1
        if (enumerador.GetDefaultAudioEndpoint(0, 1, out var dispositivo) != 0 || dispositivo == null)
            throw new InvalidOperationException("No encuentro un altavoz o audífonos activos en Windows.");
        var iid = typeof(IAudioEndpointVolume).GUID;
        Marshal.ThrowExceptionForHR(dispositivo.Activate(ref iid, 23 /* CLSCTX_ALL */, IntPtr.Zero, out var o));
        return (IAudioEndpointVolume)o;
    }

    /// <summary>El volumen de 0 a 100 y si está en silencio.</summary>
    public static (int Nivel, bool Mudo) Leer()
    {
        var v = Altavoz();
        Marshal.ThrowExceptionForHR(v.GetMasterVolumeLevelScalar(out var nivel));
        Marshal.ThrowExceptionForHR(v.GetMute(out var mudo));
        return ((int)Math.Round(nivel * 100), mudo);
    }

    /// <summary>Pone el volumen en `nivel` (0–100). Con más de 0 también quita el silencio (si no, no se oiría nada).</summary>
    public static void Poner(int nivel)
    {
        nivel = Math.Clamp(nivel, 0, 100);
        var v = Altavoz();
        var ctx = Guid.Empty;
        Marshal.ThrowExceptionForHR(v.SetMasterVolumeLevelScalar(nivel / 100f, ref ctx));
        if (nivel > 0) Marshal.ThrowExceptionForHR(v.SetMute(false, ref ctx));
    }
}
