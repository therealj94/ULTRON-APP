using System.Globalization;
using System.Numerics;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Aura.Windows.Core;

/// <summary>Un saldo de la cartera: cuánto hay, su precio (null si no hay precio real) y su valor.</summary>
public sealed record Saldo(string Simbolo, decimal Cantidad, decimal? PrecioUsd, decimal? ValorUsd);

/// <summary>
/// La cartera de Veta Wallet, SOLO LECTURA: los saldos se leen de la cadena de Orden Global (5550) con la
/// dirección pública de la persona, igual que la wallet (mismo RPC, mismos tokens, mismos precios).
/// Aquí no hay claves ni firmas: AURA nunca mueve dinero. Enviar se hace en Veta Wallet, con su contraseña.
/// </summary>
public static class CarteraVeta
{
    public const string Rpc = "https://rpc.ordenglobal-rpc.com/";
    public const long CadenaId = 5550;
    const decimal GramosOnza = 31.1035m;

    /// <summary>Los tokens de la red (los mismos de veta-wallet-app/src/api.js), con 18 decimales.</summary>
    public static readonly (string Simbolo, string? Contrato)[] Tokens =
    {
        ("ORIGEN", null), ("AUKA", "0x6Facc8Df79cEDc6C5065442ce27e915Aa3a26B9B"), ("AGKA", "0x961f798f998c7Ff44D47d62C7FA1B572eF187a4B"),
        ("ONDK", "0xfb83eEA4B384a4b18E5A1EBa7a4bb4C0b7CA19c1"), ("MNKA", "0x18b6680CFF71c11067bec312Fc48786bE2e54Ead"),
        ("IBS", "0x7AF11D3E94A174f6fc290A5B7791A6DEE2718E62"), ("HARV", "0x0fa04D11F28B28cbC9b98dd016F02023AdDb1923"),
        ("AUBEX", "0xF1498640B27A66C0DC505093D70911C060e04fb0"), ("ASL", "0x69846aC960D45F9946C613DFCe1b761D37Faf098"),
        ("LOVE", "0x638F2ba0e3E1083D1ba570b449BD266F3860D164"), ("REST", "0x1aC12Ebd7739003059d1E9EA2a4863C92D1505DD"),
        ("SOL", "0xAAc6aE2E2037fC2e94d0b060792E7eB4E5fBfa66"), ("AIT", "0xAE14Db486872AC07d74Ad69cC09590239b21BA2e"),
        ("AGRO", "0x2A31ba919A5339fCB0F8aEeFfCE2c807B16007fe"), ("POLITICAL", "0x92496E1848e001428A3495409a9A9f616bB6dD3B"),
    };

    /// <summary>Los precios fijos de referencia que usa la wallet para los tokens del ecosistema.</summary>
    public static readonly Dictionary<string, decimal> PreciosFijos = new()
    {
        ["AGRO"] = 13.13m, ["AIT"] = 5.32m, ["SOL"] = 0.75m, ["REST"] = 8.57m, ["LOVE"] = 0.1m,
        ["POLITICAL"] = 0.33m, ["ASL"] = 2.328m, ["AUBEX"] = 10m, ["HARV"] = 0.75m, ["IBS"] = 1.2m,
    };

    static readonly Regex Direccion = new("^0x[0-9a-fA-F]{40}$");
    public static bool EsDireccion(string d) => Direccion.IsMatch(d.Trim());

    /// <summary>La llamada balanceOf(address) (selector 0x70a08231 + la dirección rellenada a 32 bytes).</summary>
    public static string DatosBalanceOf(string direccion) => "0x70a08231" + direccion.Trim()[2..].ToLowerInvariant().PadLeft(64, '0');

    /// <summary>Un número hexadecimal de la cadena («0x1bc16d674ec80000») con 18 decimales → cantidad.</summary>
    public static decimal Cantidad(string? hex, int decimales = 18)
    {
        if (string.IsNullOrEmpty(hex) || hex == "0x") return 0;
        var h = hex.StartsWith("0x", StringComparison.OrdinalIgnoreCase) ? hex[2..] : hex;
        if (h.Length == 0 || h.Length > 64 || !Regex.IsMatch(h, "^[0-9a-fA-F]+$")) return 0;
        var entero = BigInteger.Parse("0" + h, NumberStyles.HexNumber);
        var divisor = BigInteger.Pow(10, decimales);
        var parte = BigInteger.DivRem(entero, divisor, out var resto);
        if (parte > new BigInteger(decimal.MaxValue / 10)) return decimal.MaxValue;
        return (decimal)parte + (decimal)resto / (decimal)divisor;
    }

    /// <summary>Precio de un token en USD: ORIGEN = oro por gramo / 55; AUKA = onza de oro; AGKA = onza de plata; fijos; si no, null.</summary>
    public static decimal? Precio(string simbolo, decimal? oroOnza, decimal? plataOnza) => simbolo switch
    {
        "ORIGEN" when oroOnza > 0 => oroOnza / GramosOnza / 55m,
        "AUKA" when oroOnza > 0 => oroOnza,
        "AGKA" when plataOnza > 0 => plataOnza,
        _ => PreciosFijos.TryGetValue(simbolo, out var p) ? p : null,
    };

    /// <summary>Lee la respuesta de un lote JSON-RPC (id = índice del token) → hex por id. Los errores quedan fuera.</summary>
    public static Dictionary<int, string> LeerLote(string json)
    {
        var r = new Dictionary<int, string>();
        using var d = JsonDocument.Parse(json);
        var items = d.RootElement.ValueKind == JsonValueKind.Array ? d.RootElement.EnumerateArray().ToList() : new List<JsonElement> { d.RootElement };
        foreach (var e in items)
            if (e.TryGetProperty("id", out var id) && id.TryGetInt32(out var i) && e.TryGetProperty("result", out var res) && res.ValueKind == JsonValueKind.String)
                r[i] = res.GetString()!;
        return r;
    }

    /// <summary>El lote JSON-RPC: saldo nativo (ORIGEN) + balanceOf de cada token.</summary>
    public static string ArmarLote(string direccion)
    {
        var llamadas = Tokens.Select((t, i) => t.Contrato == null
            ? (object)new { jsonrpc = "2.0", id = i, method = "eth_getBalance", @params = new object[] { direccion, "latest" } }
            : new { jsonrpc = "2.0", id = i, method = "eth_call", @params = new object[] { new { to = t.Contrato, data = DatosBalanceOf(direccion) }, "latest" } });
        return JsonSerializer.Serialize(llamadas);
    }

    public static List<Saldo> Saldos(Dictionary<int, string> hexes, decimal? oroOnza, decimal? plataOnza)
    {
        var lista = new List<Saldo>();
        for (int i = 0; i < Tokens.Length; i++)
        {
            var cant = hexes.TryGetValue(i, out var h) ? Cantidad(h) : 0;
            var precio = Precio(Tokens[i].Simbolo, oroOnza, plataOnza);
            lista.Add(new Saldo(Tokens[i].Simbolo, cant, precio, precio is { } p ? Math.Round(cant * p, 2) : null));
        }
        return lista;
    }

    // ───────────── enviar: AURA prepara, Veta Wallet firma ─────────────

    /// <summary>La web de Veta Wallet. El envío se firma allá, con la contraseña de la persona.</summary>
    public const string Wallet = "https://app.vetawallet.com/";

    /// <summary>El símbolo tal cual lo usa la red («origen» → «ORIGEN»), o null si no es de la red.</summary>
    public static string? Simbolo(string s) => Tokens.Select(t => t.Simbolo).FirstOrDefault(x => x.Equals((s ?? "").Trim(), StringComparison.OrdinalIgnoreCase)
        || (x == "ORIGEN" && (s ?? "").Trim().Equals("origenes", StringComparison.OrdinalIgnoreCase)));

    /// <summary>
    /// Una cantidad escrita o dicha («10», «2.5», «2,5», «1,000») → decimal &gt; 0 con hasta 18 decimales, o null.
    /// Una coma seguida de tres cifras (y sin punto) es de miles; si no, es el decimal.
    /// </summary>
    public static decimal? Monto(string? texto)
    {
        var t = (texto ?? "").Trim().Replace(" ", "");
        if (!Regex.IsMatch(t, @"^\d{1,15}(?:[.,]\d{1,18})*$")) return null;
        if (t.Contains(',') && !t.Contains('.')) t = Regex.IsMatch(t, @"^\d{1,3}(?:,\d{3})+$") ? t.Replace(",", "") : t.Replace(',', '.');
        else t = t.Replace(",", "");
        if (t.Count(c => c == '.') > 1) return null;
        return decimal.TryParse(t, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var m) && m > 0 ? m : null;
    }

    /// <summary>
    /// El enlace de cobro de Veta Wallet (#pagar?a=…&amp;m=…&amp;s=…): abre el envío ya llenado y la persona lo
    /// firma allá. AURA no firma ni manda nada: si no se confirma en la wallet, no pasa nada.
    /// </summary>
    public static string EnlacePagar(string direccion, decimal monto, string simbolo)
    {
        if (!EsDireccion(direccion)) throw new InvalidOperationException("Esa persona no tiene una dirección de Veta Wallet válida.");
        if (monto <= 0 || decimal.Round(monto, 18) != monto) throw new InvalidOperationException("La cantidad no es válida.");
        var sim = Simbolo(simbolo) ?? throw new InvalidOperationException($"No conozco la moneda {simbolo}.");
        var m = monto.ToString("0.##################", CultureInfo.InvariantCulture);
        return $"{Wallet}#pagar?a={direccion.Trim()}&m={Uri.EscapeDataString(m)}&s={Uri.EscapeDataString(sim)}";
    }

    /// <summary>La cantidad en la unidad mínima de la cadena (18 decimales).</summary>
    public static BigInteger AWei(decimal monto)
    {
        var entero = decimal.Truncate(monto);
        var fraccion = monto - entero;
        var wei = new BigInteger(entero) * BigInteger.Pow(10, 18);
        // La parte fraccionaria, cifra por cifra (decimal tiene 28: no se pierde nada hasta 18).
        for (int i = 17; i >= 0 && fraccion > 0; i--)
        {
            fraccion *= 10;
            var d = (int)decimal.Truncate(fraccion);
            wei += d * BigInteger.Pow(10, i);
            fraccion -= d;
        }
        return wei;
    }

    static BigInteger Hex(string? h)
    {
        if (string.IsNullOrEmpty(h)) return BigInteger.Zero;
        var x = h.StartsWith("0x", StringComparison.OrdinalIgnoreCase) ? h[2..] : h;
        return x.Length == 0 || !Regex.IsMatch(x, "^[0-9a-fA-F]+$") ? BigInteger.Zero : BigInteger.Parse("0" + x, NumberStyles.HexNumber);
    }

    /// <summary>El número de bloque de una respuesta hex («0x4db67»).</summary>
    public static long Bloque(string? hex) => (long)Hex(hex);

    /// <summary>
    /// Entre los bloques (respuestas de eth_getBlockByNumber con las transacciones completas), el hash del envío de
    /// `desde` a `para` por esa cantidad exacta: ORIGEN es una transferencia nativa; un token, la llamada
    /// transfer(para, cantidad) a su contrato. Sirve para publicar el comprobante en el chat DESPUÉS de que pasó.
    /// </summary>
    public static string? BuscarEnvio(string jsonBloques, string desde, string para, string simbolo, decimal monto)
    {
        var sim = Simbolo(simbolo);
        if (sim == null || !EsDireccion(desde) || !EsDireccion(para)) return null;
        var contrato = Tokens.First(t => t.Simbolo == sim).Contrato;
        var wei = AWei(monto);
        string d = desde.Trim().ToLowerInvariant(), p = para.Trim().ToLowerInvariant();
        var datos = "0xa9059cbb" + p[2..].PadLeft(64, '0') + wei.ToString("x").TrimStart('0').PadLeft(64, '0');
        using var doc = JsonDocument.Parse(jsonBloques);
        var bloques = doc.RootElement.ValueKind == JsonValueKind.Array ? doc.RootElement.EnumerateArray().ToList() : new List<JsonElement> { doc.RootElement };
        foreach (var b in bloques)
        {
            if (!b.TryGetProperty("result", out var r) || r.ValueKind != JsonValueKind.Object || !r.TryGetProperty("transactions", out var txs) || txs.ValueKind != JsonValueKind.Array) continue;
            foreach (var tx in txs.EnumerateArray())
            {
                if (tx.ValueKind != JsonValueKind.Object) continue;
                string De(string k) => tx.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString()!.ToLowerInvariant() : "";
                if (De("from") != d) continue;
                var ok = contrato == null
                    ? De("to") == p && Hex(De("value")) == wei
                    : De("to") == contrato.ToLowerInvariant() && De("input") == datos;
                if (ok && De("hash") is { Length: 66 } hash) return hash;
            }
        }
        return null;
    }

    static string Num(decimal n, bool en) => n.ToString(n >= 1000 ? "#,0" : n >= 1 ? "#,0.##" : "0.####", CultureInfo.GetCultureInfo(en ? "en-US" : "es-HN"));

    /// <summary>Cómo se dice: «Tienes 1,520.4 ORIGEN (unos 1,321 dólares). Además: 0.12 AUKA…».</summary>
    public static string Decir(List<Saldo> saldos, string? soloSimbolo, bool en)
    {
        if (soloSimbolo != null)
        {
            var s = saldos.FirstOrDefault(x => x.Simbolo.Equals(soloSimbolo, StringComparison.OrdinalIgnoreCase));
            if (s == null) return en ? $"I don't know the token {soloSimbolo}." : $"No conozco el token {soloSimbolo}.";
            var valor = s.ValorUsd is { } v && v > 0 ? (en ? $" (about {Num(v, en)} dollars)" : $" (unos {Num(v, en)} dólares)") : "";
            return en ? $"You have {Num(s.Cantidad, en)} {s.Simbolo}{valor}." : $"Tienes {Num(s.Cantidad, en)} {s.Simbolo}{valor}.";
        }
        var con = saldos.Where(x => x.Cantidad > 0).OrderByDescending(x => x.ValorUsd ?? 0).ToList();
        if (con.Count == 0) return en ? "Your wallet is empty." : "Tu cartera está en cero.";
        var total = con.Sum(x => x.ValorUsd ?? 0);
        var partes = con.Take(4).Select(x => $"{Num(x.Cantidad, en)} {x.Simbolo}");
        return en ? $"You have about {Num(total, en)} dollars: {string.Join(", ", partes)}."
                  : $"Tienes unos {Num(total, en)} dólares: {string.Join(", ", partes)}.";
    }
}
