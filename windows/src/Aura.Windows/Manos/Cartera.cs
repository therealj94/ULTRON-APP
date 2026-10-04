using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Aura.Windows.Core;

namespace Aura.Windows.Manos;

/// <summary>
/// La cartera de Veta Wallet, solo lectura: saldos por RPC de la cadena de Orden Global y precios del oro y
/// la plata (CoinGecko, la misma fuente de la wallet). Sin contraseña, sin JWT, sin firmar nada.
/// </summary>
internal static class Cartera
{
    static readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(15) };
    static (DateTime En, decimal? Oro, decimal? Plata) precios;
    static (DateTime En, string Direccion, List<Saldo> Saldos)? ultimo;
    static DateTime listaUnicaEn = DateTime.MinValue;
    static Task? listaEnCurso;
    static readonly object candado = new();

    /// <summary>
    /// Trae la lista única de monedas cada cinco minutos (el contrato vigente de cada una, el v2 desde el corte).
    /// Si no responde se sigue con lo último que hubo, o con la copia de respaldo. Quien llega mientras otra petición
    /// está en curso espera esa misma, no arma su lote con la lista vieja.
    /// </summary>
    static Task ListaUnica()
    {
        lock (candado)
        {
            if (DateTime.UtcNow - listaUnicaEn < TimeSpan.FromMinutes(5)) return Task.CompletedTask;
            return listaEnCurso ??= Refrescar();
        }

        static async Task Refrescar()
        {
            var bien = false;
            try { bien = CarteraVeta.AplicarListaUnica(await http.GetStringAsync(CarteraVeta.ListaUnicaUrl)); }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException) { }
            lock (candado)
            {
                // Una respuesta buena dura cinco minutos; un fallo se reintenta al minuto.
                listaUnicaEn = bien ? DateTime.UtcNow : DateTime.UtcNow - TimeSpan.FromMinutes(4);
                listaEnCurso = null;
            }
        }
    }

    /// <summary>Las monedas que hoy se muestran (la lista única, o la copia de respaldo): el selector de enviar usa estas.</summary>
    public static async Task<string[]> Monedas(CancellationToken ct = default)
    {
        await ListaUnica().WaitAsync(ct);
        return CarteraVeta.Tokens.Select(t => t.Simbolo).ToArray();
    }

    /// <summary>Valida (o vacía) la dirección que pega la persona. Devuelve la dirección limpia.</summary>
    public static string ValidarDireccion(string d)
    {
        d = d.Trim();
        if (d.Length == 0) return "";
        if (!CarteraVeta.EsDireccion(d)) throw new InvalidOperationException("Esa no es una dirección de Veta Wallet (0x seguida de 40 letras y números). En Veta Wallet: Recibir → Copiar dirección.");
        return d;
    }

    static async Task<(decimal? Oro, decimal? Plata)> Precios(CancellationToken ct)
    {
        if (DateTime.UtcNow - precios.En < TimeSpan.FromMinutes(5)) return (precios.Oro, precios.Plata);
        try
        {
            var j = await http.GetStringAsync("https://api.coingecko.com/api/v3/simple/price?ids=pax-gold,kinesis-silver&vs_currencies=usd", ct);
            using var d = JsonDocument.Parse(j);
            decimal? Leer(string id) => d.RootElement.TryGetProperty(id, out var x) && x.TryGetProperty("usd", out var u) && u.TryGetDecimal(out var v) && v > 0 ? v : null;
            precios = (DateTime.UtcNow, Leer("pax-gold"), Leer("kinesis-silver"));
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException) { /* sin precio: se muestra «—», nunca uno inventado */ }
        return (precios.Oro, precios.Plata);
    }

    public static async Task<List<Saldo>> Saldos(string direccion, bool forzar = false, CancellationToken ct = default)
    {
        if (!CarteraVeta.EsDireccion(direccion)) throw new InvalidOperationException("Primero pon tu dirección de Veta Wallet en el Centro → Cartera.");
        if (!forzar && ultimo is { } u && u.Direccion == direccion && DateTime.UtcNow - u.En < TimeSpan.FromSeconds(30)) return u.Saldos;
        var precioTask = Precios(ct);
        await ListaUnica().WaitAsync(ct);
        var tokens = CarteraVeta.Tokens; // la misma lista para armar el lote y para leer la respuesta
        using var r = await http.PostAsync(CarteraVeta.Rpc, new StringContent(CarteraVeta.ArmarLote(direccion, tokens), Encoding.UTF8, "application/json"), ct);
        if (!r.IsSuccessStatusCode) throw new InvalidOperationException($"La red de Orden Global no contestó ({(int)r.StatusCode}). Intenta en un momento.");
        var hexes = CarteraVeta.LeerLote(await r.Content.ReadAsStringAsync(ct));
        var (oro, plata) = await precioTask;
        var saldos = CarteraVeta.Saldos(hexes, oro, plata, tokens);
        ultimo = (DateTime.UtcNow, direccion, saldos);
        return saldos;
    }

    static async Task<string> Rpc(string cuerpo, CancellationToken ct)
    {
        using var r = await http.PostAsync(CarteraVeta.Rpc, new StringContent(cuerpo, Encoding.UTF8, "application/json"), ct);
        if (!r.IsSuccessStatusCode) throw new InvalidOperationException($"La red de Orden Global no contestó ({(int)r.StatusCode}).");
        return await r.Content.ReadAsStringAsync(ct);
    }

    /// <summary>El último bloque de la cadena (desde dónde empezar a buscar un envío).</summary>
    public static async Task<long> Bloque(CancellationToken ct = default)
    {
        using var d = JsonDocument.Parse(await Rpc("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_blockNumber\",\"params\":[]}", ct));
        return d.RootElement.TryGetProperty("result", out var r) ? CarteraVeta.Bloque(r.GetString()) : 0;
    }

    /// <summary>
    /// Busca el envío de `desde` a `para` en los bloques desde `inicio` (hasta 200 por vez). Devuelve el hash si ya
    /// pasó y el siguiente bloque por mirar. Solo LEE la cadena.
    /// </summary>
    public static async Task<(string? Hash, long Siguiente)> BuscarEnvio(string desde, string para, string simbolo, decimal monto, long inicio, CancellationToken ct = default)
    {
        var ultimo = await Bloque(ct);
        // Sin base conocida se empieza en el último bloque: mirar hacia atrás podría tomar un envío viejo igual.
        if (inicio <= 0 || inicio > ultimo + 1) inicio = ultimo;
        var fin = Math.Min(ultimo, inicio + 199);
        if (fin < inicio) return (null, inicio);
        var lote = new List<object>();
        for (long b = inicio; b <= fin; b++)
            lote.Add(new { jsonrpc = "2.0", id = b, method = "eth_getBlockByNumber", @params = new object[] { "0x" + b.ToString("x"), true } });
        var json = await Rpc(JsonSerializer.Serialize(lote), ct);
        return (CarteraVeta.BuscarEnvio(json, desde, para, simbolo, monto), fin + 1);
    }
}
