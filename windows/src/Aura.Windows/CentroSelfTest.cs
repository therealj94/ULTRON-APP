using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using Aura.Windows.Centro;

namespace Aura.Windows;

/// <summary>
/// Prueba del Centro en WebView2 de verdad (CI de Windows): carga la página con datos de muestra (sin
/// servidor ni cuentas reales), recorre la entrada, la guía y cada sección, y guarda una foto de cada una
/// para revisar el diseño. Falla si la página no carga, si hay errores de JavaScript o si falta una sección.
/// </summary>
internal static class CentroSelfTest
{
    static bool sesion, primeraVez = true;
    static readonly List<string> errores = new();

    static object Estado() => new
    {
        version = "prueba",
        sesion = sesion ? new { nombre = "José Ordóñez", correo = "jose@ordenglobal.org", rol = "Junta Directiva · Orden Global", nivel = "junta", gid = "GEN-0001-0001-1" } : null,
        avatar = "aura", idioma = "es", primeraVez,
        conexiones = new Dictionary<string, string?> { ["spotify"] = "jose@spotify.test", ["google"] = null, ["microsoft"] = null },
        cartera = new { direccion = "0x6Facc8Df79cEDc6C5065442ce27e915Aa3a26B9B" },
    };

    static async Task<object?> Manejar(string metodo, JsonElement a)
    {
        await Task.Delay(40);
        return metodo switch
        {
            "estado" => Estado(),
            "entrar.clave" or "entrar.genesis" => Hecho(() => sesion = true, new { miembro = new { nombre = "José Ordóñez", correo = "jose@ordenglobal.org" } }),
            "primeraVez.terminar" => Hecho(() => primeraVez = false, true),
            "ajustes.leer" => new { avatar = "aura", idioma = "es", escucha = "palabra", manosLibres = true, interrumpir = true, responderConVoz = true, ocultarEnPantallaCompleta = true,
                                   vozDeWindows = false, oidoDeWindows = false, avisosDeApps = true, avisosPrivados = false, avisosEnVoz = false, appsSilenciadas = new[] { "Teams" },
                                   avisarCorreos = true, mostrarMusica = true, correoDireccion = "", agendaUrl = "", tieneClaveCorreo = false, carteraDireccion = "0x6Facc8Df79cEDc6C5065442ce27e915Aa3a26B9B", servidor = "https://aura-fp.onrender.com",
                                   clientes = new { spotify = "", google = "", microsoft = "" }, transparencia = 0.5,
                                   notch = new { borde = "arriba", fraccion = 0.5, monitor = "", menosMovimiento = false } },
            "notch.monitores" => new object[] { new { id = @"\\.\DISPLAY1", nombre = "Pantalla 1 (principal) · 1920×1080", principal = true, actual = true }, new { id = @"\\.\DISPLAY2", nombre = "Pantalla 2 · 2560×1440", principal = false, actual = false } },
            "ajustes.guardar" => true,
            "cartera.saldos" => new { direccion = "0x6Facc8Df79cEDc6C5065442ce27e915Aa3a26B9B", total = 9214.37m, actualizado = "14:05", saldos = new object[] {
                new { simbolo = "ORIGEN", cantidad = 3200.5m, precio = 2.43m, usd = 7777.2m }, new { simbolo = "AUKA", cantidad = 0.34m, precio = 4167.4m, usd = 1416.9m },
                new { simbolo = "AGKA", cantidad = 0.33m, precio = 60.3m, usd = 20.27m }, new { simbolo = "LOVE", cantidad = 0m, precio = 0.1m, usd = 0m } } },
            "spotify.estado" => new { conectado = true, cuenta = "jose@spotify.test", sonando = new { uri = "spotify:track:1", titulo = "Vivir Mi Vida", artista = "Marc Anthony", album = "3.0", portada = "", sonando = true, progresoMs = 61000, duracionMs = 251000, dispositivo = "MI-PC", volumen = 70, aleatorio = false, repetir = "off" } },
            "spotify.buscar" => new object[] { new { tipo = "cancion", uri = "spotify:track:2", titulo = "Tití Me Preguntó", subtitulo = "Bad Bunny", imagen = "", duracionMs = 243000 }, new { tipo = "artista", uri = "spotify:artist:3", titulo = "Bad Bunny", subtitulo = "Artista", imagen = "", duracionMs = 0 } },
            "inicio.dia" => new { eventos = new object[] { new { hora = "3:00 PM", titulo = "Junta directiva" }, new { hora = "5:30 PM", titulo = "Llamada con Maple" } }, correos = 4, avisos = new[] { "WhatsApp: Karla", "Teams: Reunión" } },
            "relevo" => new { estado = 503, datos = (object?)null },
            "secreto.leer" => null,
            "secreto.guardar" or "secreto.borrar" or "notch.aviso" or "ventana.mostrar" => true,
            "diagnostico.leer" => "2026-10-01 14:00:00 [inicio] prueba",
            _ => null,
        };
    }

    static T Hecho<T>(Action a, T v) { a(); return v; }

    public static async Task Run(string carpeta)
    {
        Directory.CreateDirectory(carpeta);
        var r = new Dictionary<string, object?>();
        try
        {
            var w = new CentroWindow(Manejar) { Width = 1280, Height = 820 };
            var listo = new TaskCompletionSource();
            w.Listo += () => listo.TrySetResult();
            w.Show();
            await Task.WhenAny(listo.Task, Task.Delay(30000));
            if (!listo.Task.IsCompleted) throw new Exception("WebView2 no arrancó");
            await Task.Delay(1500);
            // Errores de JavaScript: se juntan en la página.
            await w.Ejecutar("window.__errores=[];addEventListener('error',e=>__errores.push(String(e.message)));addEventListener('unhandledrejection',e=>__errores.push(String(e.reason&&e.reason.message||e.reason)));");
            await Task.Delay(1800);
            await w.Fotografiar(Path.Combine(carpeta, "01-entrar.png"));
            // Entrar con clave (muestra) → la guía.
            await w.Ejecutar("document.querySelectorAll('.panel-entrar button')[1].click()");
            await Task.Delay(400);
            await w.Ejecutar("(()=>{const i=document.querySelectorAll('.panel-entrar input');i[0].value='jose@ordenglobal.org';i[1].value='x';document.querySelector('.panel-entrar form').requestSubmit();})()");
            await Task.Delay(2500);
            await w.Fotografiar(Path.Combine(carpeta, "02-guia.png"));
            for (int i = 0; i < 3; i++) { await w.Ejecutar("[...document.querySelectorAll('.panel-entrar .btn.acento')].pop().click()"); await Task.Delay(1200); }
            await Task.Delay(2000);
            var secciones = new[] { "inicio", "chat", "pulse", "musica", "cartera", "ajustes" };
            var faltan = new List<string>();
            for (int i = 0; i < secciones.Length; i++)
            {
                w.Emitir("ir", secciones[i]);
                await Task.Delay(2200);
                var hay = await w.Ejecutar("!!document.querySelector('main.contenido .vista')");
                if (hay != "true") faltan.Add(secciones[i]);
                await w.Fotografiar(Path.Combine(carpeta, $"{i + 3:00}-{secciones[i]}.png"));
            }
            // Chat: una respuesta que llega mientras se escribe.
            w.Emitir("ir", "chat");
            w.Emitir("chat.mensaje", new { id = 1, quien = "Tú", texto = "¿Cuánto ORIGEN tengo?", mio = true });
            w.Emitir("chat.mensaje", new { id = 2, quien = "AU-RA", texto = "Tienes 3,200.5 ORIGEN, unos 7,777 dólares.", mio = false });
            await Task.Delay(900);
            await w.Fotografiar(Path.Combine(carpeta, "09-chat-conversacion.png"));
            // Música: buscar.
            w.Emitir("ir", "musica");
            await Task.Delay(800);
            await w.Ejecutar("(()=>{const i=document.querySelector('input[type=search]');i.value='bad bunny';i.form.requestSubmit();})()");
            await Task.Delay(1500);
            await w.Fotografiar(Path.Combine(carpeta, "10-musica-busqueda.png"));
            var errs = await w.Ejecutar("JSON.stringify(window.__errores||[])");
            r["secciones"] = secciones;
            r["faltan"] = faltan;
            r["errores_js"] = JsonSerializer.Deserialize<string>(errs);
            if (faltan.Count > 0) throw new Exception("No se pintaron: " + string.Join(", ", faltan));
            r["ok"] = true;
            File.WriteAllText(Path.Combine(carpeta, "resultado.json"), JsonSerializer.Serialize(r, new JsonSerializerOptions { WriteIndented = true }));
            w.CerrarDeVerdad();
            Application.Current.Shutdown(0);
        }
        catch (Exception ex)
        {
            r["ok"] = false; r["error"] = ex.ToString();
            File.WriteAllText(Path.Combine(carpeta, "resultado.json"), JsonSerializer.Serialize(r, new JsonSerializerOptions { WriteIndented = true }));
            Application.Current.Shutdown(1);
        }
    }
}
