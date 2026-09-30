using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using Aura.Windows.Manos;
using Aura.Windows.Voz;

namespace Aura.Windows;

/// <summary>
/// Prueba de lo NATIVO en el CI de Windows, con apps de verdad: leer el Bloc de notas por UI Automation,
/// OCR de Windows sobre una imagen con texto, encontrar sus menús por nombre, las ventanas abiertas,
/// la información del equipo y la voz de Windows. Nada va a internet.
/// </summary>
internal static class NativoSelfTest
{
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);

    public static async Task Run(string salida)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(salida)!);
        var r = new Dictionary<string, object?>();
        Process? notepad = null;
        try
        {
            const string frase = "AURA lee la pantalla sin mandar imágenes: prueba nativa 2026";
            var archivo = Path.Combine(Path.GetDirectoryName(salida)!, "pantalla.txt");
            File.WriteAllText(archivo, frase);
            notepad = Process.Start(new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "notepad.exe"), "\"" + archivo + "\"") { UseShellExecute = false })!;
            for (int i = 0; i < 40 && notepad.MainWindowHandle == IntPtr.Zero; i++) { await Task.Delay(250); notepad.Refresh(); }
            if (notepad.MainWindowHandle == IntPtr.Zero) throw new Exception("El Bloc de notas no abrió una ventana");
            SetForegroundWindow(notepad.MainWindowHandle); await Task.Delay(500);

            // 1) Leer la pantalla con UI Automation (la ventana de trabajo, no AURA).
            var lectura = await Pantalla.Leer(IntPtr.Zero);
            r["uia_via"] = lectura.Via; r["uia_proceso"] = lectura.Proceso;
            if (!lectura.Texto.Contains("prueba nativa 2026")) throw new Exception("UI Automation no leyó el texto del Bloc de notas: " + lectura.Texto[..Math.Min(200, lectura.Texto.Length)]);
            r["uia"] = true;

            // 2) Controles por nombre y ventanas abiertas.
            var controles = Controles.Visibles(notepad.MainWindowHandle, false);
            r["controles"] = controles.Select(c => c.Nombre).Distinct().Take(12).ToArray();
            if (controles.Count == 0) throw new Exception("No se encontraron controles con nombre en el Bloc de notas");
            var primero = controles[0].Nombre;
            if (Controles.Buscar(notepad.MainWindowHandle, primero, false) == null) throw new Exception("No se encontró por nombre: " + primero);
            r["control_por_nombre"] = primero;
            r["delicado_enviar"] = Controles.EsDelicado("Enviar ahora") && !Controles.EsDelicado("Formato");
            if (Ventanas.Buscar("notepad") == null && Ventanas.Buscar("bloc de notas") == null) throw new Exception("Ventanas no encontró el Bloc de notas");
            r["ventanas"] = true;

            // 3) OCR de Windows sobre una imagen con texto (sin red).
            try
            {
                using var bmp = new Bitmap(900, 160);
                using (var g = Graphics.FromImage(bmp)) { g.Clear(Color.White); g.DrawString("AURA OCR 2026 Honduras", new Font("Arial", 40), Brushes.Black, 20, 40); }
                var ocr = await Pantalla.Ocr(bmp);
                r["ocr"] = ocr.Trim();
                r["ocr_ok"] = ocr.Contains("AURA") && ocr.Contains("2026");
            }
            catch (Exception ex) { r["ocr"] = "no disponible en este equipo: " + ex.Message; r["ocr_ok"] = null; }

            // 4) Lo que el equipo sabe de sí mismo.
            foreach (var q in new[] { "hora", "fecha", "bateria", "disco", "red", "sistema" })
            {
                var t = Sistema.Info(q, "es");
                if (string.IsNullOrWhiteSpace(t)) throw new Exception("Info vacía: " + q);
                r["info_" + q] = t;
            }

            // 5) La voz de Windows (si el equipo tiene voces instaladas).
            var audio = await VozLocal.Decir("Hola, soy AURA.", "es", "aura") ?? await VozLocal.Decir("Hi, I'm AURA.", "en", "aura");
            r["voz_windows"] = audio == null ? "sin voces instaladas" : $"{audio.Motor} · {audio.Bytes.Length} bytes";
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
        finally { try { if (notepad is { HasExited: false }) notepad.Kill(); } catch { } }
    }
}
