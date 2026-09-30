using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Aura.Windows.Core;

namespace Aura.Windows.Notch;

/// <summary>Lo que corre el CI de Windows: capturas reales de cada estado y la conversación contra un servidor simulado.</summary>
internal static class Pruebas
{
    public static void Renderizar(string carpeta)
    {
        try { NotchWindow.RenderizarEstados(carpeta); Application.Current.Shutdown(0); }
        catch (Exception ex) { Directory.CreateDirectory(carpeta); File.WriteAllText(Path.Combine(carpeta, "render-error.txt"), ex.ToString()); Application.Current.Shutdown(1); }
    }

    public static async Task Asistente(string salida)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(salida)!);
        try { var r = await NotchWindow.ProbarAsistente(); File.WriteAllText(salida, JsonSerializer.Serialize(r)); Application.Current.Shutdown(0); }
        catch (Exception ex) { File.WriteAllText(salida, JsonSerializer.Serialize(new { ok = false, error = ex.ToString() })); Application.Current.Shutdown(1); }
    }
}

public partial class NotchWindow
{
    internal static void RenderizarEstados(string carpeta)
    {
        Directory.CreateDirectory(carpeta);
        var w = new NotchWindow(true) { Left = -4000, Top = 0 };
        w.Show();
        void Foto(string nombre)
        {
            w.Aplicar();
            w.UpdateLayout();
            var h = Math.Max(150, w.alto.Valor + 40);
            const double escala = 2;
            var rtb = new RenderTargetBitmap((int)(AnchoVentana * escala), (int)(h * escala), 96 * escala, 96 * escala, PixelFormats.Pbgra32);
            // Fondo como el escritorio de Windows de la referencia: azul, para ver la silueta negra.
            var fondo = new DrawingVisual();
            using (var dc = fondo.RenderOpen())
                dc.DrawRectangle(new LinearGradientBrush(Color.FromRgb(0x0A, 0x5F, 0xC8), Color.FromRgb(0x05, 0x3A, 0x8C), 90), null, new Rect(0, 0, AnchoVentana, h));
            rtb.Render(fondo);
            rtb.Render(w.Raiz);
            var enc = new PngBitmapEncoder(); enc.Frames.Add(BitmapFrame.Create(rtb));
            using var f = File.Create(Path.Combine(carpeta, nombre + ".png"));
            enc.Save(f);
        }
        foreach (var avatar in new[] { "aura", "claudio" })
        {
            w.AplicarAvatar(avatar, false);
            w.escuchando = w.pensando = w.hablandoAhora = w.panelAbierto = false; w.propuesta = null; w.avisoActual = null; w.raton = false;
            w.modo = Modo.Reposo; Foto($"{avatar}-01-reposo");
            w.raton = true; Foto($"{avatar}-02-raton"); w.raton = false;
            w.escuchando = true; w.BarrasEscucha.Nivel = 0.7; w.modo = w.ModoQueToca(); Foto($"{avatar}-03-escucha"); w.escuchando = false;
            w.pensando = true; w.TextoPiensa.Text = "¿Qué tengo pendiente para mañana?"; w.modo = w.ModoQueToca(); Foto($"{avatar}-04-piensa"); w.pensando = false;
            w.hablandoAhora = true; w.Subtitulo.Text = "Mañana tienes la junta a las diez y el informe de ventas pendiente."; w.AvatarHabla.Boca = 0.8; w.BarrasHabla.Nivel = 0.8; w.modo = w.ModoQueToca(); Foto($"{avatar}-05-habla"); w.hablandoAhora = false;
            w.avisoActual = new Aviso("Recordatorio", "Tomar agua y estirar las piernas", "");
            w.TituloAviso.Text = w.avisoActual.Titulo; w.CuerpoAviso.Text = w.avisoActual.Cuerpo; w.modo = w.ModoQueToca(); Foto($"{avatar}-06-aviso"); w.avisoActual = null;
            w.propuesta = new Propuesta("¿Lo escribo en Documento1 - Word?", "Estimado licenciado: le confirmo la reunión del jueves a las diez…", DateTime.Now.AddSeconds(30), () => Task.CompletedTask);
            w.TituloConfirma.Text = w.propuesta.Titulo; w.CuerpoConfirma.Text = w.propuesta.Cuerpo; w.modo = w.ModoQueToca(); Foto($"{avatar}-07-confirma"); w.propuesta = null;
        }
        w.panelAbierto = true; w.Height = w.AltoPanel + 48; w.modo = w.ModoQueToca();
        w.AgregarMensaje("Tú", "Redáctame un correo corto para confirmar la reunión del jueves.");
        w.AgregarMensaje("AU-RA", "Listo. Te dejé el borrador en el panel: saludo, confirmación de la reunión del jueves a las diez y una despedida cordial. ¿Lo escribo en Word?");
        Foto("claudio-08-panel");
        w.AplicarAvatar("aura", false); Foto("aura-08-panel");
        w.PestanaBorrador.IsChecked = true; w.Borrador.Text = "Estimado licenciado:\n\nLe confirmo la reunión del jueves a las 10:00.\n\nSaludos cordiales,\nJosé"; Foto("aura-09-borrador");
        w.PestanaAcciones.IsChecked = true; Foto("aura-10-acciones");
        // Regresión: la silueta tiene orejas (más ancha arriba que el cuerpo) y esquinas redondas abajo.
        var g = Silueta(100, 236, 36, 13, Oreja).Bounds;
        if (Math.Abs(g.Width - (236 + 2 * Oreja)) > 0.5 || Math.Abs(g.Height - 36) > 0.5) throw new InvalidOperationException("La silueta del notch no tiene la forma esperada: " + g);
        w.Close();
    }

    /// <summary>La conversación de punta a punta contra windows/gateway/fixture-aura.mjs (127.0.0.1:18788).</summary>
    internal static async Task<object> ProbarAsistente()
    {
        var w = new NotchWindow(true) { Left = -4000 };
        w.Show();
        w.api = new AuraApi("http://127.0.0.1:18788/");
        for (int i = 0; i < 30 && !await w.api.Salud(); i++) await Task.Delay(200);
        // 1) Cerebro: el turno en vivo llega por trozos, con emoción, y queda en el historial.
        await w.Procesar("Hola AURA, ¿cómo estás?", false);
        if (w.ultimaRespuesta != "Hola, José. Aquí estoy, lista para ayudarte." || w.historial.Count != 2 || w.emocionActual != "feliz")
            throw new Exception($"Turno incompleto: «{w.ultimaRespuesta}» · {w.historial.Count} · {w.emocionActual}");
        // 2) Voz: el audio del avatar llega del servidor (sin tocar el altavoz del CI).
        var audio = await w.api.Voz("Hola", "feliz", "aura", "es");
        if (audio.Bytes.Length < 100 || audio.Motor != "fixture") throw new Exception("Voz sin audio");
        // 3) Oído: un WAV de verdad (tono de 1 s) se transcribe.
        var pcm = new byte[32000];
        for (int i = 0; i < 16000; i++) { short v = (short)(Math.Sin(i * 2 * Math.PI * 220 / 16000) * 8000); pcm[i * 2] = (byte)v; pcm[i * 2 + 1] = (byte)(v >> 8); }
        var texto = await w.api.Oir(Voz.Oido.Wav(pcm), "es");
        if (texto != "abre la calculadora") throw new Exception("Oído: " + texto);
        // 4) Manos: reglas, Laya ligera y Laya del nodo deciden sin ejecutar nada aquí.
        var p1 = await Intencion.Decidir(texto, null);
        if (p1.Mano != Mano.AbrirApp || p1.Valor != "calculadora") throw new Exception("Reglas: " + p1);
        w.api.Token = "sesion-de-prueba";
        var p2 = await Intencion.Decidir("necesito una carta para el banco pidiendo mi estado de cuenta", w.api.Intencion);
        if (p2.Mano != Mano.Redactar) throw new Exception("Laya: " + p2);
        // 5) Pausa: nada conversa en pausa.
        w.PausarTodo();
        await w.Procesar("¿sigues ahí?", false);
        if (w.historial.Count != 2) throw new Exception("La pausa dejó conversar");
        w.Close();
        return new { ok = true, turno = true, emocion = w.emocionActual, voz = audio.Bytes.Length, oido = texto, reglas = p1.Mano.ToString(), laya = p2.Origen, pausa = true, servidor = "fixture (no es producción)" };
    }
}
