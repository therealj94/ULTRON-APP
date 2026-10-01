using System.Text.Json;
using System.Text.Json.Nodes;

namespace Aura.Windows.Core;

/// <summary>Lo que llega por el WebSocket del agente de voz de ElevenLabs, ya entendido.</summary>
public abstract record EventoAgente;
/// <summary>La conversación abrió: su id y el formato del audio que manda y que espera.</summary>
public sealed record AgenteListo(string ConversacionId, FormatoAudio Salida, FormatoAudio Entrada) : EventoAgente;
/// <summary>Un trozo de la voz de AURA, ya en PCM de 16 bits mono.</summary>
public sealed record AgenteAudio(byte[] Pcm, int EventoId) : EventoAgente;
/// <summary>Lo que entendió que dijo la persona (la frase cerrada).</summary>
public sealed record AgenteTuDijiste(string Texto) : EventoAgente;
/// <summary>Lo que AURA va a decir (el texto de la respuesta). Corrección: lo que de verdad alcanzó a decir antes de que la cortaran.</summary>
public sealed record AgenteRespuesta(string Texto, bool Correccion = false) : EventoAgente;
/// <summary>La persona la interrumpió: el audio de antes de ese evento ya no se toca.</summary>
public sealed record AgenteInterrumpido(int EventoId) : EventoAgente;
/// <summary>Hay que contestar con un pong (o ElevenLabs corta).</summary>
public sealed record AgentePing(int EventoId, int Ms) : EventoAgente;

/// <summary>pcm_16000, pcm_22050, pcm_44100… o ulaw_8000 (μ-law).</summary>
public sealed record FormatoAudio(int Muestreo, bool Ulaw)
{
    public static readonly FormatoAudio Pcm16k = new(16000, false);

    public static FormatoAudio Leer(string? formato)
    {
        var f = (formato ?? "").Trim().ToLowerInvariant();
        var partes = f.Split('_');
        if (partes.Length == 2 && int.TryParse(partes[1], out var hz) && hz is >= 8000 and <= 48000)
        {
            if (partes[0] == "pcm") return new FormatoAudio(hz, false);
            if (partes[0] == "ulaw") return new FormatoAudio(hz, true);
        }
        return Pcm16k;
    }
}

/// <summary>
/// El protocolo del WebSocket de los agentes de ElevenLabs (conversación por voz). AURA para Windows
/// habla por aquí: manda el micrófono en PCM de 16 kHz y recibe la voz, lo que entendió y lo que va a
/// decir. ElevenLabs decide cuándo terminaste de hablar y cuándo la interrumpiste; el cerebro sigue
/// siendo el nuestro (el agente llama a /api/voz/llm con el pase que va como variable dinámica).
/// Sin red ni WPF adentro: se prueba en windows/tests.
/// </summary>
public static class AgenteProtocolo
{
    /// <summary>El primer mensaje: el pase de la conversación (vuelve al servidor en cada turno).</summary>
    public static string Inicio(string pase) => new JsonObject
    {
        ["type"] = "conversation_initiation_client_data",
        ["dynamic_variables"] = new JsonObject { ["pase"] = pase },
    }.ToJsonString();

    /// <summary>Un trozo del micrófono (PCM de 16 bits mono al muestreo que pidió el agente).</summary>
    public static string Audio(ReadOnlySpan<byte> pcm) => "{\"user_audio_chunk\":\"" + Convert.ToBase64String(pcm) + "\"}";

    public static string Pong(int eventoId) => "{\"type\":\"pong\",\"event_id\":" + eventoId + "}";

    /// <summary>Un mensaje del agente, entendido; null si no es uno que AURA use.</summary>
    public static EventoAgente? Leer(string json, FormatoAudio? salida = null)
    {
        JsonElement r;
        try { using var d = JsonDocument.Parse(json); r = d.RootElement.Clone(); }
        catch (JsonException) { return null; }
        if (r.ValueKind != JsonValueKind.Object) return null;
        string Tipo() => r.TryGetProperty("type", out var t) && t.ValueKind == JsonValueKind.String ? t.GetString() ?? "" : "";
        JsonElement Sub(string k) => r.TryGetProperty(k, out var s) && s.ValueKind == JsonValueKind.Object ? s : default;
        static string S(JsonElement o, string k) => o.ValueKind == JsonValueKind.Object && o.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";
        static int N(JsonElement o, string k) => o.ValueKind == JsonValueKind.Object && o.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var n) ? n : 0;
        switch (Tipo())
        {
            case "conversation_initiation_metadata":
            {
                var e = Sub("conversation_initiation_metadata_event");
                return new AgenteListo(S(e, "conversation_id"), FormatoAudio.Leer(S(e, "agent_output_audio_format")), FormatoAudio.Leer(S(e, "user_input_audio_format")));
            }
            case "audio":
            {
                var e = Sub("audio_event");
                var b64 = S(e, "audio_base_64");
                if (b64.Length == 0) return null;
                byte[] crudo;
                try { crudo = Convert.FromBase64String(b64); } catch (FormatException) { return null; }
                return new AgenteAudio((salida?.Ulaw ?? false) ? DeUlaw(crudo) : crudo, N(e, "event_id"));
            }
            case "user_transcript":
            {
                var t = S(Sub("user_transcription_event"), "user_transcript").Trim();
                return t.Length > 0 ? new AgenteTuDijiste(t) : null;
            }
            case "agent_response":
            {
                var t = S(Sub("agent_response_event"), "agent_response").Trim();
                return t.Length > 0 ? new AgenteRespuesta(t) : null;
            }
            case "agent_response_correction":
            {
                // La respuesta se cortó (la interrumpieron): lo que de verdad alcanzó a decir.
                var t = S(Sub("agent_response_correction_event"), "corrected_agent_response").Trim();
                return t.Length > 0 ? new AgenteRespuesta(t, true) : null;
            }
            case "interruption":
                return new AgenteInterrumpido(N(Sub("interruption_event"), "event_id"));
            case "ping":
            {
                var e = Sub("ping_event");
                return new AgentePing(N(e, "event_id"), N(e, "ping_ms"));
            }
            default:
                return null;
        }
    }

    /// <summary>μ-law (G.711) a PCM de 16 bits.</summary>
    public static byte[] DeUlaw(byte[] ulaw)
    {
        var o = new byte[ulaw.Length * 2];
        for (int i = 0; i < ulaw.Length; i++)
        {
            int u = ~ulaw[i] & 0xFF;
            int t = ((u & 0x0F) << 3) + 0x84;
            t <<= (u & 0x70) >> 4;
            short v = (short)((u & 0x80) != 0 ? 0x84 - t : t - 0x84);
            o[2 * i] = (byte)(v & 0xFF);
            o[2 * i + 1] = (byte)((v >> 8) & 0xFF);
        }
        return o;
    }

    /// <summary>La energía (RMS, 0–1) de un trozo PCM de 16 bits.</summary>
    public static double Rms(ReadOnlySpan<byte> pcm)
    {
        int n = pcm.Length / 2;
        if (n == 0) return 0;
        double suma = 0;
        for (int i = 0; i + 1 < pcm.Length; i += 2) { double v = (short)(pcm[i] | (pcm[i + 1] << 8)) / 32768.0; suma += v * v; }
        return Math.Sqrt(suma / n);
    }
}
