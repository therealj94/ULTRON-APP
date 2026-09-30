using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using Aura.Windows.Core;
using Aura.Windows.Manos;

namespace Aura.Windows;

/// <summary>
/// Prueba de las notificaciones de otras apps en Windows de verdad: (1) una base con la misma forma que
/// la de Windows (Notification + NotificationHandler, en modo WAL como la real): lo que ya estaba no se
/// anuncia, lo nuevo sí, las filas sin texto o de otro tipo no se anuncian pero no traban; (2) una
/// notificación REAL de Windows lanzada desde PowerShell, leída de la base del sistema (si esta
/// máquina la tiene: informativo, no falla la prueba).
/// </summary>
internal static class AvisosSelfTest
{
    static string Toast(string a, string b) =>
        $"<toast><visual><binding template=\"ToastGeneric\"><text>{a}</text><text>{b}</text></binding></visual></toast>";

    public static async Task Run(string salida)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(salida)!);
        var r = new Dictionary<string, object?>();
        var dir = Path.Combine(Path.GetTempPath(), "aura-avisos-prueba");
        try
        {
            if (Directory.Exists(dir)) Directory.Delete(dir, true);
            Directory.CreateDirectory(dir);
            var db = Path.Combine(dir, "wpndatabase.db");
            using (var s = new Sqlite(db, soloLeer: false))
            {
                s.Ejecutar("PRAGMA journal_mode=WAL;");
                s.Ejecutar("CREATE TABLE NotificationHandler (RecordId INTEGER PRIMARY KEY, PrimaryId TEXT NOT NULL, HandlerType TEXT);");
                s.Ejecutar("CREATE TABLE Notification (Id INTEGER PRIMARY KEY, HandlerId INTEGER, Type TEXT, Payload BLOB, ArrivalTime INTEGER, ExpiryTime INTEGER);");
                s.Ejecutar("INSERT INTO NotificationHandler VALUES (1,'5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App','app'),(2,'MSTeams_8wekyb3d8bbwe!MSTeams','app'),(3,'Aura.Windows','app');");
                s.Ejecutar($"INSERT INTO Notification VALUES (1,1,'toast',CAST('{Toast("Vieja", "ya estaba")}' AS BLOB),{DateTime.Now.AddMinutes(-5).ToFileTime()},0);");
            }
            // Un escritor abierto todo el tiempo, como el servicio de notificaciones de Windows.
            using var escritor = new Sqlite(db, soloLeer: false);
            using var avisos = new AvisosDeApps(db);
            var llegadas = new List<AvisoApp>();
            avisos.Nuevo += a => { lock (llegadas) llegadas.Add(a); };
            avisos.Iniciar();
            await Task.Delay(2500);
            if (llegadas.Count != 0) throw new Exception("anunció la que ya estaba");
            var ahora = DateTime.Now.ToFileTime();
            escritor.Ejecutar($"INSERT INTO Notification VALUES (2,1,'toast',CAST('{Toast("Karla", "¿Vienes a la junta?")}' AS BLOB),{ahora},0);");
            escritor.Ejecutar($"INSERT INTO Notification VALUES (3,2,'tile',CAST('<tile/>' AS BLOB),{ahora},0);");
            escritor.Ejecutar($"INSERT INTO Notification VALUES (4,2,'toast',CAST('<toast><visual><binding template=\"ToastGeneric\"/></visual></toast>' AS BLOB),{ahora},0);");
            escritor.Ejecutar($"INSERT INTO Notification VALUES (5,3,'toast',CAST('{Toast("AURA", "no me avises a mí")}' AS BLOB),{ahora},0);");
            escritor.Ejecutar($"INSERT INTO Notification VALUES (6,2,'toast',CAST('{Toast("Reunión", "Empieza en 5 min")}' AS BLOB),{ahora},0);");
            for (int i = 0; i < 40 && llegadas.Count < 2; i++) await Task.Delay(200);
            await Task.Delay(2500); // que no aparezca nada más
            var vistas = llegadas.Select(a => $"{a.App}|{a.Titulo}|{a.Cuerpo}").ToList();
            if (!vistas.SequenceEqual(new[] { "WhatsApp|Karla|¿Vienes a la junta?", "Teams|Reunión|Empieza en 5 min" })) throw new Exception("llegaron: " + string.Join(" / ", vistas));
            var recientes = avisos.Recientes(10).Where(a => !AvisosApps.EsPropia(a.Aumid)).Select(a => a.Titulo).ToList();
            if (!recientes.SequenceEqual(new[] { "Reunión", "Karla", "Vieja" })) throw new Exception("recientes: " + string.Join(",", recientes));
            r["base_simulada"] = vistas;

            // 2) Una notificación real de Windows (informativo).
            var real = new AvisosDeApps();
            r["base_de_windows"] = real.Existe;
            if (real.Existe)
            {
                var marca = "AURA prueba " + Guid.NewGuid().ToString("N")[..6];
                var ps = "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null;" +
                         "$x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);" +
                         $"$t = $x.GetElementsByTagName('text'); $t.Item(0).AppendChild($x.CreateTextNode('{marca}')) > $null; $t.Item(1).AppendChild($x.CreateTextNode('desde el CI')) > $null;" +
                         "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show([Windows.UI.Notifications.ToastNotification]::new($x))";
                using (var p = Process.Start(new ProcessStartInfo("powershell.exe", $"-NoProfile -Command \"{ps}\"") { UseShellExecute = false, CreateNoWindow = true })!)
                    p.WaitForExit(20000);
                AvisoApp? hallada = null;
                string? error = null;
                for (int i = 0; i < 20 && hallada == null; i++)
                {
                    await Task.Delay(500);
                    try { hallada = real.Recientes(20).FirstOrDefault(a => a.Titulo == marca); } catch (Exception ex) { error = ex.Message; }
                }
                r["notificacion_real"] = hallada != null ? $"{hallada.App}: {hallada.Titulo} · {hallada.Cuerpo}" : "no apareció en la base (" + (error ?? "sin error") + ")";
            }
            r["ok"] = true;
            File.WriteAllText(salida, JsonSerializer.Serialize(r, new JsonSerializerOptions { WriteIndented = true }));
            Application.Current.Shutdown(0);
        }
        catch (Exception ex)
        {
            r["ok"] = false; r["error"] = ex.ToString();
            File.WriteAllText(salida, JsonSerializer.Serialize(r, new JsonSerializerOptions { WriteIndented = true }));
            Application.Current.Shutdown(1);
        }
    }
}
