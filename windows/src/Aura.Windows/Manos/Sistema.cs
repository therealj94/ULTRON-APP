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

    static string Gb(long bytes) => (bytes / 1024d / 1024 / 1024).ToString("0.#", CultureInfo.InvariantCulture);

    public static string Info(string que, string idioma)
    {
        bool en = idioma == "en";
        var cultura = CultureInfo.GetCultureInfo(en ? "en-US" : "es-HN");
        var ahora = DateTime.Now;
        switch (que)
        {
            case "hora": return en ? $"It's {ahora.ToString("h:mm tt", cultura)}." : $"Son las {ahora.ToString("h:mm tt", cultura).Replace("a. m.", "de la mañana").Replace("p. m.", ahora.Hour >= 19 ? "de la noche" : "de la tarde")}.";
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
                bool internet;
                try { using var ping = new Ping(); internet = ping.Send("1.1.1.1", 1500).Status == IPStatus.Success; } catch { internet = false; }
                var wifi = activas.FirstOrDefault(n => n.NetworkInterfaceType == NetworkInterfaceType.Wireless80211);
                var via = wifi != null ? "Wi-Fi" : en ? "cable" : "cable";
                return internet ? (en ? $"You're online by {via}." : $"Hay internet, por {via}.") : (en ? $"Connected by {via}, but internet doesn't answer." : $"Estás conectada por {via}, pero internet no responde.");
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

    static readonly string[] Ejecutables = { ".exe", ".msi", ".bat", ".cmd", ".ps1", ".vbs", ".js", ".jse", ".wsf", ".scr", ".com", ".lnk", ".jar", ".hta", ".cpl", ".msc", ".reg", ".appx", ".msix" };
    public static bool EsEjecutable(string ruta) => Ejecutables.Contains(Path.GetExtension(ruta).ToLowerInvariant());

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
