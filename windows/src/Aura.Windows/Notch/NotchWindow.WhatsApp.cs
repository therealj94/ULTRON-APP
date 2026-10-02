using System;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using Aura.Windows.Centro;
using Aura.Windows.Core;

namespace Aura.Windows.Notch;

/// <summary>
/// El WhatsApp personal en el Centro (José, 2-oct: «una opción aparte de PULSE2CHAT»): la página pide y AURA
/// llama a /api/whatsapp/* con la sesión de AU-RA (la página no sale a la red ni ve el token). Solo la cuenta
/// dueña lo usa: el servidor contesta 403 a cualquier otra y «estado» dice permitido=false (la página ni lo muestra).
///
/// Lo que la persona escribió y tocó «Enviar» sale directo (eso ES su «sí»). Las fotos, audios y documentos en
/// grande vuelven en base64, con tope de 8 MB. Ver windows/centro/PUENTE.md.
/// </summary>
public partial class NotchWindow
{
    async Task<object?> ManejarWhatsApp(string metodo, JsonElement a)
    {
        if (api == null || string.IsNullOrEmpty(ajustes.Token)) throw new InvalidOperationException(T("Entra con tu cuenta de AU-RA para ver WhatsApp.", "Sign in to AU-RA to see WhatsApp."));
        try
        {
            switch (metodo)
            {
                case "whatsapp.estado":
                    return await api.WhatsApp(HttpMethod.Get, "api/whatsapp/estado");
                case "whatsapp.vincular":
                {
                    // Sin número: el QR (lo principal en Windows: se escanea con el teléfono). Con número: el código de 8 letras.
                    var tel = PuenteWhatsApp.Telefono(Texto(a, "telefono"));
                    object cuerpo = tel == null ? new { } : new { telefono = tel };
                    return await api.WhatsApp(HttpMethod.Post, "api/whatsapp/vincular", cuerpo, TimeSpan.FromSeconds(40));
                }
                case "whatsapp.desvincular":
                    return await api.WhatsApp(HttpMethod.Post, "api/whatsapp/desvincular");
                case "whatsapp.chats":
                    return await api.WhatsApp(HttpMethod.Get, PuenteWhatsApp.RutaChats(Texto(a, "buscar")));
                case "whatsapp.mensajes":
                {
                    long antes = a.ValueKind == JsonValueKind.Object && a.TryGetProperty("antes", out var x) && x.ValueKind == JsonValueKind.Number && x.TryGetInt64(out var ms) && ms > 0 ? ms : 0;
                    return await api.WhatsApp(HttpMethod.Get, PuenteWhatsApp.RutaMensajes(Texto(a, "chat"), antes));
                }
                case "whatsapp.enviar":
                {
                    var chat = PuenteWhatsApp.Chat(Texto(a, "chat"));
                    var texto = PuenteWhatsApp.Texto(Texto(a, "texto"));
                    Registro.Anotar("whatsapp", "enviar (" + texto.Length + " letras)");
                    return await api.WhatsApp(HttpMethod.Post, "api/whatsapp/enviar", new { chat, texto }, TimeSpan.FromSeconds(30));
                }
                case "whatsapp.leido":
                    return await api.WhatsApp(HttpMethod.Post, "api/whatsapp/leido", new { chat = PuenteWhatsApp.Chat(Texto(a, "chat")) });
                case "whatsapp.media":
                {
                    var ruta = PuenteWhatsApp.RutaMedia(Texto(a, "chat"), Texto(a, "id"));
                    var (bytes, tipo) = await api.WhatsAppMedia(ruta, PuenteWhatsApp.MediaMax);
                    return new { base64 = Convert.ToBase64String(bytes), mime = tipo };
                }
                default:
                    throw new InvalidOperationException("Método desconocido: " + metodo);
            }
        }
        // Los errores del servidor ya traen su texto para la persona. Como InvalidOperationException no se anotan
        // en el registro: la página sondea cada pocos segundos y un corte de red no debe llenarlo.
        catch (AuraError ex) { throw new InvalidOperationException(ex.Message); }
    }
}
