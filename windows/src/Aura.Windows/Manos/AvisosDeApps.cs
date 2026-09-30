using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Aura.Windows.Core;

namespace Aura.Windows.Manos;

/// <summary>
/// SQLite mínimo sobre winsqlite3.dll, el que trae Windows 10/11: sin paquetes ni DLL propias.
/// Solo lo que hace falta para leer (y, en la prueba, crear) una base.
/// </summary>
internal sealed class Sqlite : IDisposable
{
    const string Dll = "winsqlite3.dll";
    [DllImport(Dll)] static extern int sqlite3_open_v2(byte[] nombre, out IntPtr db, int flags, IntPtr vfs);
    [DllImport(Dll)] static extern int sqlite3_close_v2(IntPtr db);
    [DllImport(Dll)] static extern int sqlite3_busy_timeout(IntPtr db, int ms);
    [DllImport(Dll, CharSet = CharSet.Unicode)] static extern int sqlite3_prepare16_v2(IntPtr db, string sql, int bytes, out IntPtr stmt, IntPtr cola);
    [DllImport(Dll)] static extern int sqlite3_bind_int64(IntPtr stmt, int i, long v);
    [DllImport(Dll)] static extern int sqlite3_step(IntPtr stmt);
    [DllImport(Dll)] static extern int sqlite3_finalize(IntPtr stmt);
    [DllImport(Dll)] static extern long sqlite3_column_int64(IntPtr stmt, int i);
    [DllImport(Dll)] static extern IntPtr sqlite3_column_blob(IntPtr stmt, int i);
    [DllImport(Dll)] static extern int sqlite3_column_bytes(IntPtr stmt, int i);
    [DllImport(Dll)] static extern IntPtr sqlite3_errmsg16(IntPtr db);
    [DllImport(Dll)] static extern int sqlite3_exec(IntPtr db, byte[] sql, IntPtr cb, IntPtr arg, out IntPtr err);

    const int Fila = 100, Hecho = 101;
    IntPtr db;

    public Sqlite(string ruta, bool soloLeer = true)
    {
        // SQLITE_OPEN_READONLY = 1; READWRITE|CREATE = 6
        int r = sqlite3_open_v2(Encoding.UTF8.GetBytes(ruta + "\0"), out db, soloLeer ? 1 : 6, IntPtr.Zero);
        if (r != 0) { var m = Error(); sqlite3_close_v2(db); db = IntPtr.Zero; throw new IOException($"SQLite no abrió la base ({r}): {m}"); }
        sqlite3_busy_timeout(db, 2000);
    }

    string Error() => db == IntPtr.Zero ? "" : Marshal.PtrToStringUni(sqlite3_errmsg16(db)) ?? "";

    public void Ejecutar(string sql)
    {
        if (sqlite3_exec(db, Encoding.UTF8.GetBytes(sql + "\0"), IntPtr.Zero, IntPtr.Zero, out _) != 0) throw new IOException("SQLite: " + Error());
    }

    /// <summary>Las filas de una consulta con parámetros enteros (?1, ?2…); `leer` recibe la sentencia y el índice de columna.</summary>
    public List<T> Filas<T>(string sql, long[] parametros, Func<Func<int, long>, Func<int, byte[]>, T> leer)
    {
        if (sqlite3_prepare16_v2(db, sql, -1, out var st, IntPtr.Zero) != 0) throw new IOException("SQLite: " + Error());
        var lista = new List<T>();
        try
        {
            for (int i = 0; i < parametros.Length; i++) sqlite3_bind_int64(st, i + 1, parametros[i]);
            while (true)
            {
                int r = sqlite3_step(st);
                if (r == Hecho) break;
                if (r != Fila) throw new IOException($"SQLite ({r}): " + Error());
                lista.Add(leer(c => sqlite3_column_int64(st, c), c =>
                {
                    int n = sqlite3_column_bytes(st, c);
                    var b = new byte[Math.Max(0, n)];
                    if (n > 0) Marshal.Copy(sqlite3_column_blob(st, c), b, 0, n);
                    return b;
                }));
            }
        }
        finally { sqlite3_finalize(st); }
        return lista;
    }

    public void Dispose() { if (db != IntPtr.Zero) { sqlite3_close_v2(db); db = IntPtr.Zero; } }
}

/// <summary>
/// Las notificaciones de las demás apps (WhatsApp, Teams, Outlook, Chrome…) para el notch.
///
/// La API oficial de Windows para esto (UserNotificationListener) solo la pueden usar apps empaquetadas
/// de la Tienda. AURA es un .exe normal, así que lee la base donde Windows guarda las notificaciones de
/// esta cuenta (%LOCALAPPDATA%\Microsoft\Windows\Notifications\wpndatabase.db), SOLO PARA LEER y sin
/// sacar nada del equipo. Si Windows la tiene bloqueada, lee una copia temporal que borra al terminar.
/// </summary>
internal sealed class AvisosDeApps : IDisposable
{
    public static string RutaDeWindows => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "Windows", "Notifications", "wpndatabase.db");

    const string Consulta = "SELECT n.Id, n.ArrivalTime, n.Payload, CAST(IFNULL(h.PrimaryId,'') AS BLOB) FROM Notification n " +
                            "LEFT JOIN NotificationHandler h ON h.RecordId = n.HandlerId WHERE n.Type = 'toast' AND n.Id > ?1 ORDER BY n.Id LIMIT ?2";
    const string Ultimas = "SELECT n.Id, n.ArrivalTime, n.Payload, CAST(IFNULL(h.PrimaryId,'') AS BLOB) FROM Notification n " +
                           "LEFT JOIN NotificationHandler h ON h.RecordId = n.HandlerId WHERE n.Type = 'toast' ORDER BY n.Id DESC LIMIT ?1";

    readonly string ruta;
    long ultimo = -1;
    CancellationTokenSource? vigia;
    public event Action<AvisoApp>? Nuevo;
    public event Action<string>? Fallo;

    public AvisosDeApps(string? ruta = null) => this.ruta = ruta ?? RutaDeWindows;
    public bool Existe => File.Exists(ruta);

    static string Texto(byte[] b)
    {
        if (b.Length >= 2 && b[0] == 0xFF && b[1] == 0xFE) return Encoding.Unicode.GetString(b, 2, b.Length - 2);
        if (b.Length >= 2 && b[1] == 0 && b[0] == '<') return Encoding.Unicode.GetString(b);
        return Encoding.UTF8.GetString(b);
    }

    static AvisoApp? Fila(Func<int, long> num, Func<int, byte[]> blob) =>
        AvisosApps.Leer(num(0), Texto(blob(3)), Texto(blob(2)), num(1));

    /// <summary>Consulta la base; si Windows no la deja abrir en vivo, sobre una copia (base + registro WAL).</summary>
    T Leer<T>(Func<Sqlite, T> hacer)
    {
        try { using var s = new Sqlite(ruta); return hacer(s); }
        catch (IOException)
        {
            var dir = Path.Combine(Path.GetTempPath(), "aura-avisos-" + Environment.ProcessId);
            Directory.CreateDirectory(dir);
            try
            {
                foreach (var ext in new[] { "", "-wal", "-shm" })
                {
                    var origen = ruta + ext;
                    if (!File.Exists(origen)) continue;
                    using var de = new FileStream(origen, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                    using var a = new FileStream(Path.Combine(dir, "wpn.db" + ext), FileMode.Create, FileAccess.Write);
                    de.CopyTo(a);
                }
                using var s = new Sqlite(Path.Combine(dir, "wpn.db"));
                return hacer(s);
            }
            finally { try { Directory.Delete(dir, true); } catch { } }
        }
    }

    public long MayorId() => Leer(s => s.Filas("SELECT IFNULL(MAX(Id),0) FROM Notification", Array.Empty<long>(), (n, _) => n(0)))[0];

    /// <summary>Las filas después de `id`, con su id aunque no traigan texto (así el puntero avanza por todas).</summary>
    public List<(long Id, AvisoApp? Aviso)> Despues(long id, int max = 50) =>
        Leer(s => s.Filas(Consulta, new[] { id, (long)max }, (n, b) => (n(0), Fila(n, b))));

    /// <summary>Las últimas `n` (lo más nuevo primero), aunque hayan llegado antes de abrir AURA.</summary>
    public List<AvisoApp> Recientes(int n = 10) =>
        Leer(s => s.Filas(Ultimas, new[] { (long)n }, Fila)).FindAll(a => a != null)!;

    /// <summary>Revisa cada 2 segundos y avisa de las NUEVAS (las que ya estaban al arrancar no se anuncian).</summary>
    public void Iniciar()
    {
        vigia?.Cancel();
        var cts = vigia = new CancellationTokenSource();
        _ = Task.Run(async () =>
        {
            int fallos = 0;
            while (!cts.IsCancellationRequested)
            {
                try
                {
                    if (ultimo < 0) ultimo = MayorId();
                    else
                        foreach (var (id, a) in Despues(ultimo))
                        {
                            ultimo = Math.Max(ultimo, id);
                            if (a != null && !AvisosApps.EsPropia(a.Aumid)) Nuevo?.Invoke(a);
                        }
                    fallos = 0;
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or DllNotFoundException or EntryPointNotFoundException)
                {
                    if (++fallos == 3) Fallo?.Invoke(ex is DllNotFoundException ? "Este Windows no trae SQLite (winsqlite3)." : "No pude leer las notificaciones de Windows: " + ex.Message);
                }
                try { await Task.Delay(fallos >= 3 ? TimeSpan.FromSeconds(30) : TimeSpan.FromSeconds(2), cts.Token); } catch { break; }
            }
        });
    }

    public void Dispose() => vigia?.Cancel();
}
