using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using Aura.Windows.Core;
using Aura.Windows.Voz;

namespace Aura.Windows.Notch;

/// <summary>
/// LA CONVERSACIÓN EN VIVO (Fase 1): al despertarla («Oye AURA», la tecla o el micrófono del notch) AURA
/// abre una conversación con el agente de ElevenLabs de su avatar, como la llamada del teléfono. ElevenLabs
/// oye, decide cuándo terminaste y deja interrumpir; el cerebro es el de AU-RA. Las manos:
///  · lo que las reglas de la PC reconocen en lo que dijiste se hace al instante, aquí mismo;
///  · lo que pide el cerebro («⟦hacer⟧») llega por el canal y pasa por la guarda tipada (AutorizarOrden: misma acción, mismo objetivo; lo destructivo con «sí»);
///  · lo mismo dos veces en unos segundos no se hace dos veces (HechasRecientes).
/// Si la conversación no abre (sin sesión, sin red, sin minutos), sigue el oído de siempre (Voz/Oido.cs).
/// </summary>
public partial class NotchWindow
{
    AgenteVoz? agente;
    PermisoAgente? permisoAgente;
    /// <summary>Después de un fallo no se reintenta en un rato: mientras, el oído de siempre.</summary>
    DateTime agenteFalloHasta = DateTime.MinValue;
    DateTime agenteUltimaVoz = DateTime.MinValue;
    bool abriendoAgente;
    string agenteUltimoDicho = "";
    /// <summary>Lo último que dijiste en la conversación en vivo (no se borra al contestar): la guarda de órdenes lo usa si el canal no trae lo dicho.</summary>
    string dichoEnVivo = "";
    readonly HechasRecientes hechasRecientes = new();
    /// <summary>Las reglas lo están intentando con lo que dijiste: un fallo todavía no se le dice al agente (puede venir la orden del cerebro).</summary>
    bool intentoLocal;
    DateTime ultimaOrdenCerebro = DateTime.MinValue;
    /// <summary>La orden del cerebro que llegó mientras las reglas lo intentaban (se saltó por repetida): el segundo intento si el primero falla.</summary>
    OrdenPc? ordenSaltada;
    string ultimoMotivo = "";
    System.Windows.Controls.TextBlock? burbujaAgente;
    CancellationTokenSource? canal;

    bool AgenteAbierto => agente?.Abierto == true;

    /// <summary>La conversación en vivo está elegida y se puede (con sesión, sin pausa ni silencio, sin un fallo reciente).</summary>
    bool PuedeAgente => ajustes.VozMotor == "agente" && api != null && !string.IsNullOrEmpty(ajustes.Token)
                        && !pausado && !microSilenciado && !soloRender && DateTime.Now >= agenteFalloHasta;

    /// <summary>Despertó: la conversación en vivo si se puede; si no (o si falla), el oído de siempre.</summary>
    async Task Despertar()
    {
        if (AgenteAbierto || abriendoAgente) return;
        if (PuedeAgente && await AbrirAgente()) return;
        // Si no abrió porque la silenciaste o pausaste mientras conectaba, tampoco se abre el oído de siempre.
        if (microSilenciado || pausado) return;
        if (!escuchando) { Callar(); EmpezarAEscuchar(); }
    }

    async Task<bool> AbrirAgente()
    {
        if (api == null) return false;
        abriendoAgente = true;
        agenteUltimaVoz = DateTime.Now;
        CerrarOido();
        Callar();
        TextoEscucha.Text = T("Conectando…", "Connecting…"); EstadoPanel.Text = TextoEscucha.Text; Recalcular();
        var crono = Stopwatch.StartNew();
        var nuevo = new AgenteVoz();
        try
        {
            permisoAgente = await api.AbrirAgente(ajustes.Avatar, ajustes.Idioma);
            // Mientras conectaba pudieron silenciarla, pausarla o elegir «frase por frase»: no se abre nada.
            if (!PuedeAgente) { SoltarPermiso(); return false; }
            CablearAgente(nuevo);
            agente = nuevo;
            await nuevo.Abrir(permisoAgente, CancellationToken.None);
            if (!PuedeAgente || !ReferenceEquals(agente, nuevo)) { agente = null; nuevo.Cerrar(); SoltarPermiso(); return false; }
            agenteUltimaVoz = DateTime.Now;
            escuchando = true;
            TextoEscucha.Text = T("Te escucho…", "Listening…");
            LuzMic.Opacity = 1; AnilloMic.Opacity = 0.9;
            AvatarPanel.Estado = "listening"; EstadoPanel.Text = TextoEscucha.Text;
            Centro.Registro.Anotar("voz-vivo", $"conversación abierta en {crono.ElapsedMilliseconds} ms");
            Recalcular();
            return true;
        }
        catch (Exception ex)
        {
            agente = null;
            nuevo.Cerrar();
            SoltarPermiso();
            agenteFalloHasta = DateTime.Now.AddMinutes(10);
            var porque = ex is AuraError ae ? ae.Message : ex is TimeoutException ? T("el agente no contestó a tiempo", "the agent didn't answer in time") : ex.Message;
            Centro.Registro.Anotar("voz-vivo", "no abrió: " + porque + " · sigo con el oído de siempre 10 min");
            Avisar(new Aviso(T("Voz en vivo no disponible", "Live voice unavailable"), T("Sigo escuchándote como siempre. ", "I'll keep listening the usual way. ") + porque, "", "worried", Segundos: 4));
            return false;
        }
        finally { abriendoAgente = false; }
    }

    void CablearAgente(AgenteVoz a)
    {
        a.TuDijiste += t => Dispatcher.BeginInvoke(new Action(() => { if (ReferenceEquals(agente, a)) _ = AlOirEnVivo(t); }));
        a.Respuesta += r => Dispatcher.BeginInvoke(new Action(() =>
        {
            if (!ReferenceEquals(agente, a)) return;
            var visible = Expresiones.Quitar(r.Texto).Trim();
            if (visible.Length == 0) return;
            Subtitulo.Text = visible;
            ultimaRespuesta = visible;
            // La corrección (la cortaste a mitad) cambia la burbuja que ya estaba, no agrega otra.
            if (r.Correccion && burbujaAgente != null) { burbujaAgente.Text = visible; return; }
            burbujaAgente = AgregarMensaje(ajustes.NombreAvatar, visible);
            if (agenteUltimoDicho.Length > 0) { Recordar(agenteUltimoDicho, visible); agenteUltimoDicho = ""; }
        }));
        a.Hablando += si =>
        {
            var cuando = Stopwatch.GetTimestamp();
            Dispatcher.BeginInvoke(new Action(() =>
            {
                if (!ReferenceEquals(agente, a)) return;
                hablandoAhora = si;
                if (si)
                {
                    // En vivo se cuenta DESDE LA TRANSCRIPCIÓN (no incluye tu captura ni el STT de ElevenLabs) y «suena» es
                    // audio en la cola del altavoz, no una medición acústica. Así queda dicho en la línea del turno.
                    metricas.Marcar(EtapaVoz.InicioReproduccion, cuando);
                    metricas.Cerrar("ok", cuando);
                }
                AvatarPanel.Estado = si ? "speaking" : "listening";
                EstadoPanel.Text = si ? T("Hablando…", "Speaking…") : T("Te escucho…", "Listening…");
                if (!si) { AvatarHabla.Boca = AvatarPanel.Boca = 0; agenteUltimaVoz = DateTime.Now; }
                Recalcular();
            }));
        };
        a.Interrumpida += () => Dispatcher.BeginInvoke(new Action(() => { if (ReferenceEquals(agente, a)) { Centro.Registro.Anotar("voz-vivo", "me interrumpiste"); metricas.Cerrar("interrumpido"); } }));
        a.NivelMic += n => Dispatcher.BeginInvoke(new Action(() => { if (ReferenceEquals(agente, a) && !hablandoAhora) { BarrasEscucha.Nivel = n; EscalaAnillo.ScaleX = EscalaAnillo.ScaleY = 1 + n * 0.5; } }));
        a.NivelBoca += n => Dispatcher.BeginInvoke(new Action(() => { if (ReferenceEquals(agente, a)) { AvatarHabla.Boca = n; AvatarPanel.Boca = n; BarrasHabla.Nivel = n; } }));
        a.Cerrada += motivo => Dispatcher.BeginInvoke(new Action(() =>
        {
            // Mientras se abre, el fallo lo avisa AbrirAgente (un solo aviso).
            if (!ReferenceEquals(agente, a) || abriendoAgente) return;
            agente = null;
            metricas.Cerrar(motivo != null ? "fallo (se cortó)" : "cancelado");
            if (a.MetricasCola.Length > 0) Centro.Registro.Anotar("voz-vivo", a.MetricasCola);
            SoltarPermiso();
            hablandoAhora = false; escuchando = false;
            LuzMic.Opacity = 0; AnilloMic.Opacity = 0; BarrasEscucha.Nivel = 0;
            AvatarPanel.Estado = EstadoDeEmocion(emocionActual);
            EstadoPanel.Text = pausado ? "En pausa" : "Aquí contigo";
            if (motivo != null)
            {
                Centro.Registro.Anotar("voz-vivo", "se cerró: " + motivo);
                agenteFalloHasta = DateTime.Now.AddMinutes(2);
                Avisar(new Aviso(T("Se cortó la voz en vivo", "Live voice dropped"), T("Sigo escuchándote como siempre.", "I'll keep listening the usual way."), "", "worried", Segundos: 3));
            }
            else Centro.Registro.Anotar("voz-vivo", "conversación cerrada");
            // De vuelta a esperar «Oye AURA» (o lo que diga la escucha elegida).
            AplicarEscucha();
        }));
    }

    /// <summary>Cuelga la conversación en vivo (si hay una).</summary>
    void CerrarAgente()
    {
        var a = agente;
        if (a == null) return;
        a.Cerrar(); // Cerrada hace el resto
    }

    void SoltarPermiso()
    {
        var p = permisoAgente; permisoAgente = null;
        if (p != null && api != null) _ = api.CerrarAgente(p.Pase);
    }

    /// <summary>Lo que ElevenLabs entendió que dijiste. Las reglas de la PC lo hacen al instante; el cerebro contesta igual.</summary>
    async Task AlOirEnVivo(string texto)
    {
        agenteUltimaVoz = DateTime.Now;
        // Un turno nuevo con su reloj. Honesto: en vivo solo se ve desde que llega la transcripción.
        var t = metricas.Nuevo("vivo", "transcripción recibida (sin captura ni STT; voz = audio en cola)");
        agenteUltimoDicho = texto;
        dichoEnVivo = texto;
        Centro.Registro.AnotarDicho("oir", $"turno {t.Id} · en vivo", texto);
        AgregarMensaje("Tú", texto);
        if (propuesta != null)
        {
            switch (Parametros.Respuesta(texto))
            {
                case true: await Responder(true); return;
                case false: await Responder(false); return;
            }
        }
        var frase = Parametros.QuitarNombre(texto, out var sinNombre) && sinNombre.Length > 0 ? sinNombre : texto;
        var p = Intencion.PorReglas(frase);
        if (p.Mano == Mano.Ninguna) return;
        metricas.Marcar(EtapaVoz.Intencion, turno: t.Id);
        Centro.Registro.Anotar("entender", $"turno {t.Id} · en vivo · {p.Mano} (reglas)");
        hechasRecientes.Anotar(texto);
        var desde = DateTime.Now;
        resultadoUltimo = null;
        ordenSaltada = null;
        intentoLocal = true;
        try { await Hacer(p, frase, true); }
        finally { intentoLocal = false; }
        if (resultadoUltimo != false) return;
        // No salió: la orden del cerebro (que a veces entendió mejor: «abre exel» → «abre excel») sí se hace.
        // Si en unos segundos no llega ninguna, el agente dice que no se pudo: nunca un «sí» callado.
        hechasRecientes.Olvidar(texto);
        var motivo = ultimoMotivo;
        Centro.Registro.Anotar("cerebro-manos", "las reglas no pudieron: " + motivo);
        // La orden del cerebro ya llegó mientras se intentaba (y se saltó por repetida): es el segundo intento.
        if (ordenSaltada is { } os)
        {
            ordenSaltada = null;
            Centro.Registro.AnotarDicho("cerebro-manos", "segundo intento con la orden del cerebro", os.Orden);
            await HacerOrdenDelCerebro(os.Orden, os.Dicho.Length > 0 ? os.Dicho : frase, true);
            return;
        }
        await Task.Delay(TimeSpan.FromSeconds(8));
        // Ninguna orden del cerebro en ese rato: ahora sí, el fallo se muestra y el agente lo dice.
        if (ultimaOrdenCerebro < desde) NoPude(motivo);
    }

    /// <summary>El resultado real de una mano, a la conversación en vivo (si hay una).</summary>
    void AvisarAgente(string texto, bool hablar)
    {
        if (agente is { Abierto: true } a) a.AvisarPc(texto, hablar);
    }

    /// <summary>Una orden del cerebro que llegó por el canal (la conversación en vivo): guarda y repetidas.</summary>
    async Task OrdenDelCanal(OrdenPc o)
    {
        ultimaOrdenCerebro = DateTime.Now;
        // Las reglas ya hicieron algo con esa misma frase: el cerebro pide lo mismo, no se repite.
        if (hechasRecientes.Repetida(o.Id, o.Dicho))
        {
            if (intentoLocal) ordenSaltada = o;
            Centro.Registro.AnotarDicho("cerebro-manos", "ya hecha", o.Orden);
            return;
        }
        await HacerOrdenDelCerebro(o.Orden, o.Dicho.Length > 0 ? o.Dicho : dichoEnVivo, true);
    }

    /// <summary>
    /// El canal de AURA para este equipo: queda abierto mientras haya sesión y trae las órdenes que el
    /// cerebro pide en la voz en vivo. Si se corta, vuelve solo (cada vez más espaciado, hasta 1 min).
    /// </summary>
    void IniciarCanal()
    {
        canal?.Cancel();
        if (soloRender || api == null || string.IsNullOrEmpty(ajustes.Token)) return;
        var cts = canal = new CancellationTokenSource();
        var cliente = api;
        _ = Task.Run(async () =>
        {
            var espera = TimeSpan.FromSeconds(3);
            while (!cts.IsCancellationRequested)
            {
                // Si en 60 s no llega ni el latido (cada 20 s), el socket quedó medio abierto (la PC se
                // suspendió, cambió de red): se corta y se vuelve a conectar.
                using var vivo = CancellationTokenSource.CreateLinkedTokenSource(cts.Token);
                try
                {
                    vivo.CancelAfter(TimeSpan.FromSeconds(60));
                    await using var s = await cliente.Canal(vivo.Token);
                    using var r = new StreamReader(s);
                    espera = TimeSpan.FromSeconds(3);
                    await CanalPc.Leer(r, o => Dispatcher.BeginInvoke(new Action(() => { if (!pausado) _ = OrdenDelCanal(o); })), vivo.Token,
                        () => { try { vivo.CancelAfter(TimeSpan.FromSeconds(60)); } catch (ObjectDisposedException) { } });
                }
                catch (OperationCanceledException) when (!cts.IsCancellationRequested) { espera = TimeSpan.FromSeconds(1); }
                catch (OperationCanceledException) { return; }
                catch (ObjectDisposedException) { return; }
                catch (AuraError e) when (e.Estado == System.Net.HttpStatusCode.Unauthorized) { espera = TimeSpan.FromMinutes(1); }
                catch { espera = TimeSpan.FromSeconds(Math.Min(60, espera.TotalSeconds * 2)); }
                try { await Task.Delay(espera, cts.Token); } catch { return; }
            }
        });
    }

    /// <summary>Cada 5 s (relojRecordatorios): sin hablar un rato, la conversación en vivo se cuelga sola (cuesta por minuto).</summary>
    void RevisarAgente()
    {
        // Mientras se abre una conversación nueva no se mide el silencio: su reloj todavía es el de la anterior
        // (1-oct 22:39: «nadie habló: cuelgo» colgó la conversación que se acababa de abrir).
        if (!AgenteAbierto || hablandoAhora || abriendoAgente) return;
        var ventana = ajustes.Escucha == "siempre" ? TimeSpan.FromMinutes(3) : TimeSpan.FromSeconds(60);
        if (DateTime.Now - agenteUltimaVoz > ventana) { Centro.Registro.Anotar("voz-vivo", "nadie habló: cuelgo"); CerrarAgente(); }
    }
}
