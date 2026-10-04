using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using Aura.Windows.Core;
using Forms = System.Windows.Forms;

namespace Aura.Windows.Manos;

/// <summary>Lo que el equipo sabe de sí mismo (hora, batería, disco, red, memoria) y sus archivos. Sin red.</summary>
internal static class Sistema
{
    [StructLayout(LayoutKind.Sequential)]
    struct MEMORYSTATUSEX { public uint dwLength, dwMemoryLoad; public ulong ullTotalPhys, ullAvailPhys, ullTotalPageFile, ullAvailPageFile, ullTotalVirtual, ullAvailVirtual, ullAvailExtendedVirtual; }
    [DllImport("kernel32.dll")] static extern bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX m);

    [DllImport("kernel32.dll")] static extern bool GetSystemTimes(out long ocioso, out long nucleo, out long usuario);

    /// <summary>El uso del procesador (%) medido en medio segundo.</summary>
    static int Cpu()
    {
        GetSystemTimes(out var o1, out var k1, out var u1);
        System.Threading.Thread.Sleep(500);
        GetSystemTimes(out var o2, out var k2, out var u2);
        long total = (k2 - k1) + (u2 - u1), ocio = o2 - o1;
        return total <= 0 ? 0 : (int)Math.Clamp(Math.Round(100.0 * (total - ocio) / total), 0, 100);
    }

    /// <summary>El nombre del wifi conectado (netsh con argumentos fijos), o null.</summary>
    static string? Wifi()
    {
        try
        {
            using var p = Process.Start(new ProcessStartInfo("netsh.exe", "wlan show interfaces") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true })!;
            var salida = p.StandardOutput.ReadToEnd();
            p.WaitForExit(3000);
            var m = Regex.Match(salida, @"^\s*SSID\s*:\s*(.+?)\s*$", RegexOptions.Multiline);
            return m.Success && m.Groups[1].Value.Length > 0 ? m.Groups[1].Value : null;
        }
        catch { return null; }
    }

    static string Gb(long bytes) => (bytes / 1024d / 1024 / 1024).ToString("0.#", CultureInfo.InvariantCulture);

    public static string Info(string que, string idioma)
    {
        bool en = idioma == "en";
        var cultura = CultureInfo.GetCultureInfo(en ? "en-US" : "es-HN");
        var ahora = DateTime.Now;
        switch (que)
        {
            case "hora":
            {
                int h12 = ahora.Hour % 12 == 0 ? 12 : ahora.Hour % 12;
                if (en) return $"It's {h12}:{ahora.Minute:00} {(ahora.Hour < 12 ? "a.m." : "p.m.")}.";
                var parte = ahora.Hour < 12 ? "de la mañana" : ahora.Hour < 19 ? "de la tarde" : "de la noche";
                return $"{(h12 == 1 ? "Es la" : "Son las")} {h12}:{ahora.Minute:00} {parte}.";
            }
            case "fecha": return en ? $"Today is {ahora.ToString("dddd, MMMM d", cultura)}." : $"Hoy es {ahora.ToString("dddd d 'de' MMMM", cultura)}.";
            case "bateria":
            {
                var p = Forms.SystemInformation.PowerStatus;
                if (p.BatteryChargeStatus.HasFlag(Forms.BatteryChargeStatus.NoSystemBattery)) return en ? "This computer has no battery; it's on wall power." : "Esta computadora no tiene batería: está conectada a la corriente.";
                int pct = (int)Math.Round(p.BatteryLifePercent * 100);
                bool cargando = p.PowerLineStatus == Forms.PowerLineStatus.Online;
                var resto = p.BatteryLifeRemaining > 0 && !cargando ? TimeSpan.FromSeconds(p.BatteryLifeRemaining) : (TimeSpan?)null;
                return en ? $"Battery at {pct}%{(cargando ? ", charging" : "")}{(resto is { } r ? $", about {(int)r.TotalHours} h {r.Minutes} min left" : "")}."
                          : $"La batería está al {pct} %{(cargando ? ", cargando" : "")}{(resto is { } r2 ? $"; quedan unas {(int)r2.TotalHours} h {r2.Minutes} min" : "")}.";
            }
            case "disco":
            {
                var d = new DriveInfo(Path.GetPathRoot(Environment.SystemDirectory)!);
                return en ? $"Drive {d.Name.TrimEnd('\\')} has {Gb(d.AvailableFreeSpace)} GB free of {Gb(d.TotalSize)} GB."
                          : $"El disco {d.Name.TrimEnd('\\')} tiene {Gb(d.AvailableFreeSpace)} GB libres de {Gb(d.TotalSize)} GB.";
            }
            case "red":
            {
                var activas = NetworkInterface.GetAllNetworkInterfaces().Where(n => n.OperationalStatus == OperationalStatus.Up && n.NetworkInterfaceType is not (NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel)).ToList();
                if (activas.Count == 0) return en ? "No network connection." : "No hay conexión de red.";
                var via = activas.Any(n => n.NetworkInterfaceType == NetworkInterfaceType.Wireless80211) ? "Wi-Fi" : "cable";
                // La misma prueba que usa Windows (NCSI) por HTTP: el ping suele estar bloqueado en redes de empresa.
                bool internet;
                try
                {
                    using var http = new System.Net.Http.HttpClient { Timeout = TimeSpan.FromSeconds(3) };
                    internet = http.GetStringAsync("http://www.msftconnecttest.com/connecttest.txt").GetAwaiter().GetResult().Contains("Microsoft Connect Test");
                }
                catch { internet = false; }
                return internet ? (en ? $"You're online by {via}." : $"Hay internet, por {via}.") : (en ? $"Connected by {via}, but the internet doesn't answer." : $"Hay conexión por {via}, pero internet no responde.");
            }
            case "cpu": { var c = Cpu(); return en ? $"The processor is at {c}%." : $"El procesador está al {c} %."; }
            case "memoria":
            {
                var m = new MEMORYSTATUSEX { dwLength = (uint)Marshal.SizeOf<MEMORYSTATUSEX>() };
                GlobalMemoryStatusEx(ref m);
                long usada = (long)(m.ullTotalPhys - m.ullAvailPhys);
                return en ? $"Memory: {m.dwMemoryLoad}% in use ({Gb(usada)} of {Gb((long)m.ullTotalPhys)} GB)." : $"Memoria: {m.dwMemoryLoad} % en uso ({Gb(usada)} de {Gb((long)m.ullTotalPhys)} GB).";
            }
            case "ip":
            {
                var ips = NetworkInterface.GetAllNetworkInterfaces()
                    .Where(n => n.OperationalStatus == OperationalStatus.Up && n.NetworkInterfaceType is not (NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel))
                    .SelectMany(n => n.GetIPProperties().UnicastAddresses).Select(a => a.Address)
                    .Where(a => a.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork && !System.Net.IPAddress.IsLoopback(a)).Select(a => a.ToString()).Distinct().ToList();
                if (ips.Count == 0) return en ? "No network connection, so no IP address." : "No hay conexión de red: no tienes dirección IP.";
                return en ? $"Your local IP is {string.Join(", ", ips)}." : $"Tu IP local es {string.Join(", ", ips)}.";
            }
            case "encendido":
            {
                var t = TimeSpan.FromMilliseconds(Environment.TickCount64);
                return en ? $"The PC has been on for {(int)t.TotalDays} d {t.Hours} h {t.Minutes} min." : $"La computadora lleva encendida {(t.TotalDays >= 1 ? $"{(int)t.TotalDays} d " : "")}{t.Hours} h {t.Minutes} min.";
            }
            case "version":
            {
                string nombre = "Windows", edicion = "";
                try
                {
                    using var k = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion");
                    nombre = k?.GetValue("ProductName") as string ?? nombre;
                    edicion = k?.GetValue("DisplayVersion") as string ?? "";
                }
                catch { }
                // El registro dice «Windows 10» también en Windows 11: la compilación 22000 o más es 11.
                if (Environment.OSVersion.Version.Build >= 22000) nombre = nombre.Replace("Windows 10", "Windows 11");
                var v = $"{nombre}{(edicion.Length > 0 ? " " + edicion : "")} (build {Environment.OSVersion.Version.Build})";
                return en ? $"This PC runs {v}." : $"Esta computadora tiene {v}.";
            }
            case "wifi":
            {
                var w = Wifi();
                return w != null ? (en ? $"You're connected to the Wi-Fi “{w}”." : $"Estás conectado al wifi «{w}».") : (en ? "You're not connected to any Wi-Fi." : "No estás conectado a ningún wifi.");
            }
            default:
            {
                var m = new MEMORYSTATUSEX { dwLength = (uint)Marshal.SizeOf<MEMORYSTATUSEX>() };
                GlobalMemoryStatusEx(ref m);
                var partes = new List<string> { Info("bateria", idioma), Info("disco", idioma) };
                partes.Add(en ? $"Memory in use: {m.dwMemoryLoad}%." : $"Memoria en uso: {m.dwMemoryLoad} %.");
                return string.Join(" ", partes);
            }
        }
    }

    /// <summary>
    /// Lo que se abre sin preguntar: documentos, imágenes, audio y video comunes. Antes era al revés (una lista de
    /// ejecutables) y se colaban .url, .iso, .vhd, .appinstaller, .settingcontent-ms, .chm, .docm, .py…: una página
    /// deja «factura.iso» en Descargas y «abre lo último que descargué» lo abría sin preguntar (revisión 2-oct).
    /// </summary>
    static readonly HashSet<string> SinPreguntar = new(StringComparer.OrdinalIgnoreCase)
    {
        ".pdf", ".txt", ".md", ".csv", ".rtf", ".docx", ".xlsx", ".pptx", ".odt", ".ods", ".odp",
        ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".heic", ".svg",
        ".mp3", ".wav", ".m4a", ".flac", ".ogg", ".mp4", ".mov", ".mkv", ".webm", ".avi",
    };
    /// <summary>Todo lo que no es un documento común (programas, instaladores, accesos, imágenes de disco, macros) espera el «sí».</summary>
    public static bool PideConfirmar(string ruta) => !SinPreguntar.Contains(Path.GetExtension(ruta));

    static IEnumerable<string> Carpetas() => new[]
    {
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads"),
        Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
        Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
        Environment.GetEnvironmentVariable("OneDrive") ?? "",
    }.Where(Directory.Exists).Distinct();

    /// <summary>El archivo más nuevo de Descargas (sin descargas a medias).</summary>
    public static FileInfo? UltimaDescarga()
    {
        var d = new DirectoryInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads"));
        if (!d.Exists) return null;
        return d.EnumerateFiles().Where(f => f.Extension is not (".crdownload" or ".part" or ".tmp" or ".download") && !f.Attributes.HasFlag(FileAttributes.Hidden))
                .OrderByDescending(f => f.LastWriteTimeUtc).FirstOrDefault();
    }

    /// <summary>Archivos cuyo nombre calza con lo dicho, en Descargas, Escritorio, Documentos y OneDrive (tope de tiempo y cantidad).</summary>
    public static List<FileInfo> BuscarArchivos(string dicho, int max = 5)
    {
        var q = LayaLigera.Normalizar(Regex.Replace(dicho, @"^(?:el|la|los|las|mi|mis|the|my)\s+", "", RegexOptions.IgnoreCase));
        var palabras = q.Split(' ', StringSplitOptions.RemoveEmptyEntries).Where(w => w.Length > 2 && w is not ("del" or "las" or "los" or "the")).ToArray();
        if (palabras.Length == 0) return new();
        var reloj = Stopwatch.StartNew();
        var hallados = new List<(FileInfo F, int P)>();
        var opciones = new EnumerationOptions { RecurseSubdirectories = true, MaxRecursionDepth = 3, IgnoreInaccessible = true, AttributesToSkip = FileAttributes.Hidden | FileAttributes.System };
        foreach (var c in Carpetas())
        {
            int n = 0;
            foreach (var f in new DirectoryInfo(c).EnumerateFiles("*", opciones))
            {
                if (++n > 20000 || reloj.ElapsedMilliseconds > 2500) break;
                var nombre = LayaLigera.Normalizar(Path.GetFileNameWithoutExtension(f.Name));
                int p = palabras.Count(w => nombre.Contains(w, StringComparison.Ordinal));
                if (p == palabras.Length) hallados.Add((f, p * 10 + (nombre == q ? 50 : 0)));
            }
        }
        return hallados.OrderByDescending(x => x.P).ThenByDescending(x => x.F.LastWriteTimeUtc).Take(max).Select(x => x.F).ToList();
    }
}
