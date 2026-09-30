using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using GSMTC = global::Windows.Media.Control;

namespace Aura.Windows.Manos;

/// <summary>Lo que suena ahora, de la app que sea (Spotify, YouTube Music, el navegador…).</summary>
internal sealed record Cancion(string Titulo, string Artista, string App, bool Sonando, byte[]? Portada, TimeSpan Posicion, TimeSpan Duracion);

/// <summary>
/// La música, como en el notch de Apple: lo que suena en CUALQUIER app que se anuncie a Windows
/// (Spotify, YouTube Music, Chrome/Edge con YouTube, el reproductor…) por el control multimedia del
/// sistema, con portada, canción y artista, y sus botones (anterior, play/pausa, siguiente). Sin
/// cuentas ni claves: es lo mismo que muestra Windows en su panel de volumen.
/// </summary>
internal sealed class Musica : IDisposable
{
    GSMTC.GlobalSystemMediaTransportControlsSessionManager? gestor;
    GSMTC.GlobalSystemMediaTransportControlsSession? sesion;
    Cancion? ultima;
    int lectura; // cada lectura lleva número: si llega tarde una vieja, no pisa a la nueva
    public Cancion? Actual => ultima;
    /// <summary>Cambió la canción o su estado (llega desde otro hilo).</summary>
    public event Action<Cancion?, bool>? Cambio;

    public async Task Iniciar()
    {
        try
        {
            gestor = await GSMTC.GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
            gestor.CurrentSessionChanged += AlCambiarSesion;
            Enganchar(gestor.GetCurrentSession());
        }
        catch { gestor = null; } // Windows sin control multimedia: la música se maneja con las teclas de siempre.
    }

    void AlCambiarSesion(GSMTC.GlobalSystemMediaTransportControlsSessionManager g, GSMTC.CurrentSessionChangedEventArgs e) => Enganchar(g.GetCurrentSession());

    void Enganchar(GSMTC.GlobalSystemMediaTransportControlsSession? s)
    {
        if (sesion != null) { sesion.MediaPropertiesChanged -= AlCambiar; sesion.PlaybackInfoChanged -= AlCambiar; sesion.TimelinePropertiesChanged -= AlCambiar; }
        sesion = s;
        if (s != null) { s.MediaPropertiesChanged += AlCambiar; s.PlaybackInfoChanged += AlCambiar; s.TimelinePropertiesChanged += AlCambiar; }
        _ = Leer();
    }

    void AlCambiar(GSMTC.GlobalSystemMediaTransportControlsSession s, object e) => _ = Leer();
    DateTime leidaEn;

    async Task Leer()
    {
        var yo = Interlocked.Increment(ref lectura);
        var s = sesion;
        if (s == null) { var habia = ultima != null; ultima = null; if (habia) Cambio?.Invoke(null, true); return; }
        try
        {
            var props = await s.TryGetMediaPropertiesAsync();
            var info = s.GetPlaybackInfo();
            var linea = s.GetTimelineProperties();
            byte[]? portada = null;
            if (props.Thumbnail != null)
            {
                try
                {
                    using var ras = await props.Thumbnail.OpenReadAsync();
                    using var st = ras.AsStreamForRead();
                    using var ms = new MemoryStream();
                    await st.CopyToAsync(ms);
                    portada = ms.ToArray();
                }
                catch { }
            }
            if (yo != Volatile.Read(ref lectura)) return; // ya hay una lectura más nueva en camino
            bool sonando = info.PlaybackStatus == GSMTC.GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
            // La posición es la de LastUpdatedTime: se lleva a «ahora» si está sonando.
            var pos = linea.Position;
            var desde = DateTimeOffset.Now - linea.LastUpdatedTime;
            if (sonando && desde > TimeSpan.Zero && desde < TimeSpan.FromHours(1)) pos += desde;
            var c = new Cancion(props.Title ?? "", string.IsNullOrEmpty(props.Artist) ? props.AlbumArtist ?? "" : props.Artist, NombreApp(s.SourceAppUserModelId),
                sonando, portada, pos, linea.EndTime - linea.StartTime);
            bool nueva = ultima == null || ultima.Titulo != c.Titulo || ultima.Artista != c.Artista;
            // También cuenta si llegó la portada tarde o si se adelantó/atrasó la canción (más de 3 s de diferencia).
            bool distinta = nueva || ultima!.Sonando != c.Sonando || (ultima.Portada == null) != (c.Portada == null)
                         || c.Duracion != ultima.Duracion
                         || Math.Abs((c.Posicion - (ultima.Posicion + (ultima.Sonando ? DateTime.Now - leidaEn : TimeSpan.Zero))).TotalSeconds) > 3;
            leidaEn = DateTime.Now;
            ultima = c;
            if (distinta && c.Titulo.Length > 0) Cambio?.Invoke(c, nueva);
        }
        catch { }
    }

    static string NombreApp(string id)
    {
        var n = id.ToLowerInvariant();
        return n.Contains("spotify") ? "Spotify" : n.Contains("music.youtube") || n.Contains("youtube music") ? "YouTube Music" : n.Contains("chrome") ? "Chrome"
             : n.Contains("msedge") ? "Edge" : n.Contains("firefox") ? "Firefox" : n.Contains("zune") || n.Contains("media") ? "Reproductor" : Path.GetFileNameWithoutExtension(id);
    }

    public bool Hay => sesion != null;

    public async Task<bool> PlayPausa() { var s = sesion; return s != null && await s.TryTogglePlayPauseAsync(); }
    public async Task<bool> Siguiente() { var s = sesion; return s != null && await s.TrySkipNextAsync(); }
    public async Task<bool> Anterior() { var s = sesion; return s != null && await s.TrySkipPreviousAsync(); }

    /// <summary>Abre la búsqueda en Spotify (la app, si está; si no, la web) o en YouTube Music.</summary>
    public static string Buscar(string donde, string q)
    {
        if (donde == "spotify")
        {
            try { Process.Start(new ProcessStartInfo("spotify:search:" + Uri.EscapeDataString(q)) { UseShellExecute = true }); return "Spotify"; }
            catch { Process.Start(new ProcessStartInfo("https://open.spotify.com/search/" + Uri.EscapeDataString(q)) { UseShellExecute = true }); return "Spotify web"; }
        }
        Process.Start(new ProcessStartInfo("https://music.youtube.com/search?q=" + Uri.EscapeDataString(q)) { UseShellExecute = true });
        return "YouTube Music";
    }

    public void Dispose()
    {
        if (gestor != null) gestor.CurrentSessionChanged -= AlCambiarSesion;
        if (sesion != null) { sesion.MediaPropertiesChanged -= AlCambiar; sesion.PlaybackInfoChanged -= AlCambiar; sesion.TimelinePropertiesChanged -= AlCambiar; }
    }
}
