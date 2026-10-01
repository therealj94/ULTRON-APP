using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using Aura.Windows.Core;
using Aura.Windows.Manos;

namespace Aura.Windows;

/// <summary>
/// Prueba del inicio de sesión con Spotify, Google y Microsoft contra proveedores SIMULADOS
/// (windows/gateway/fixture-oauth.mjs en 127.0.0.1:18789): la vuelta del navegador a 127.0.0.1:43821,
/// PKCE, renovación con y sin rotación, un 401 que obliga a renovar, y cada API que usa AURA
/// (poner música en Spotify sin dispositivo activo, Gmail, Calendar, YouTube, Outlook). No toca
/// ninguna cuenta real.
/// </summary>
internal static class ConexionesSelfTest
{
    const string Base = "http://127.0.0.1:18789";

    /// <summary>Hace de navegador: abre la página de permiso y sigue la redirección hasta el callback de AURA.</summary>
    static async Task Navegador(string url)
    {
        using var h = new HttpClient(new HttpClientHandler { AllowAutoRedirect = true }) { Timeout = TimeSpan.FromSeconds(20) };
        using var r = await h.GetAsync(url);
        var html = await r.Content.ReadAsStringAsync();
        if (!r.IsSuccessStatusCode || !html.Contains("quedó conectado")) throw new Exception($"el callback respondió {(int)r.StatusCode}: {html[..Math.Min(200, html.Length)]}");
    }

    public static async Task Run(string salida)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(salida)!);
        var r = new Dictionary<string, object?>();
        try
        {
            using var ct = new CancellationTokenSource(TimeSpan.FromSeconds(60));
            var sp = Oauth.Spotify("cid-spotify", auth: Base + "/sp", api: Base);
            var g = Oauth.Google("cid-google", "secreto-google", auth: Base + "/g/auth", token: Base + "/g/token", api: Base);
            var ms = Oauth.Microsoft("cid-microsoft", auth: Base + "/ms", api: Base);

            // 1) Entrar a los tres por el «navegador» (uno tras otro: comparten el puerto 43821).
            var tSp = await Conexion.Entrar(sp, Navegador, ct.Token);
            var tG = await Conexion.Entrar(g, Navegador, ct.Token);
            var tMs = await Conexion.Entrar(ms, Navegador, ct.Token);
            if (tSp.Cuenta != "jose@spotify.test" || tG.Cuenta != "jose@gmail.test" || tMs.Cuenta != "jose@outlook.test") throw new Exception($"cuentas: {tSp.Cuenta} {tG.Cuenta} {tMs.Cuenta}");
            if (tSp.Renovar != "SP-R1" || tG.Renovar != "G-R1") throw new Exception("sin refresh token");
            r["entrar"] = new[] { tSp.Cuenta, tG.Cuenta, tMs.Cuenta };

            // 1b) Como Chrome/Edge: una conexión «de reserva» que no manda nada NO debe tapar la vuelta.
            {
                var tReserva = await Conexion.Entrar(sp, async url =>
                {
                    await Task.Delay(200);
                    var vacia = new System.Net.Sockets.TcpClient();
                    await vacia.ConnectAsync("127.0.0.1", 43821); // queda abierta y muda
                    await Navegador(url);
                    vacia.Dispose();
                }, ct.Token);
                if (tReserva.Renovar.Length == 0) throw new Exception("con conexión de reserva no volvió");
                r["conexion_de_reserva"] = "ok";
            }

            // 2) Un estado falso no entra (otra página no puede colarse en la vuelta).
            try
            {
                await Conexion.Entrar(sp, async url => { await Task.Delay(300); using var h = new HttpClient(); await h.GetAsync("http://127.0.0.1:43821/callback?code=x&state=falso"); }, ct.Token);
                throw new Exception("aceptó un estado falso");
            }
            catch (InvalidOperationException ex) { r["estado_falso"] = ex.Message; }

            // 3) Spotify: sin dispositivo activo → usa el de la PC y pone al ARTISTA pedido.
            var guardados = new List<TokenOauth>();
            using var cSp = new Conexion(sp, tSp, guardados.Add);
            var puesto = await SpotifyWeb.Poner(cSp, "Bad Bunny", ct.Token);
            if (puesto != "Bad Bunny") throw new Exception("spotify puso: " + puesto);
            r["spotify"] = puesto;

            // 4) Google: el primer pedido a Gmail da 401 → renueva (sin rotar el refresh) y sigue.
            using var cG = new Conexion(g, tG, guardados.Add);
            var cartas = await GoogleWeb.NoLeidos(cG, 5, ct.Token);
            if (cartas.Count != 2 || cartas[0].Id != "m2" || cartas[1].De != "Karla") throw new Exception("gmail: " + string.Join(" | ", cartas));
            var renovadoG = guardados.LastOrDefault(t => t.Acceso.StartsWith("G-"));
            if (renovadoG is not { Acceso: "G-A2", Renovar: "G-R1", Cuenta: "jose@gmail.test" }) throw new Exception("renovación google: " + renovadoG);
            var eventos = await GoogleWeb.Eventos(cG, DateTime.Now, DateTime.Now.AddDays(1), ct.Token);
            if (eventos.Count != 1 || eventos[0].Titulo != "Junta directiva") throw new Exception("calendar: " + eventos.Count);
            var yt = await GoogleWeb.Cancion(cG, "vivir mi vida", ct.Token);
            if (yt is not { Url: "https://music.youtube.com/watch?v=yt123" }) throw new Exception("youtube: " + yt);
            r["google"] = new { correos = cartas.Count, eventos = eventos.Count, youtube = yt.Value.Url };

            // 5) Microsoft con el token vencido: renueva ANTES de pedir y guarda el refresh nuevo (rota).
            using var cMs = new Conexion(ms, tMs with { Vence = DateTimeOffset.UtcNow.AddMinutes(-5) }, guardados.Add);
            var outlook = await GraphWeb.NoLeidos(cMs, 5, ct.Token);
            var calOutlook = await GraphWeb.Eventos(cMs, DateTime.Now, DateTime.Now.AddDays(1), ct.Token);
            var renovadoMs = guardados.LastOrDefault(t => t.Acceso.StartsWith("MS-"));
            if (outlook.Count != 1 || outlook[0].De != "Contabilidad" || calOutlook.Count != 1 || calOutlook[0].Lugar != "Teams") throw new Exception("outlook");
            if (renovadoMs is not { Renovar: "MS-R2" }) throw new Exception("renovación microsoft: " + renovadoMs);
            r["microsoft"] = new { correos = outlook.Count, eventos = calOutlook.Count, refresh = renovadoMs.Renovar };

            // 6) El buzón por API avisa solo de lo NUEVO (la primera foto no se anuncia).
            var llegadas = new List<string>();
            var lote = new List<Carta> { new("a", "X", "1", "", DateTimeOffset.Now) };
            using (var b = new BuzonApi("prueba", (_, _) => Task.FromResult(lote.ToList())))
            {
                b.Nuevo += c => { lock (llegadas) llegadas.Add(c.Id); };
                b.Vigilar();
                await Task.Delay(800);
                if (llegadas.Count != 0) throw new Exception("anunció lo que ya estaba");
            }
            r["buzon_sin_ruido"] = true;
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
