// LA SECUENCIA DE JOSÉ (APK 5.1, 30-sep), con el código REAL del oído y lo nativo simulado:
//   mesa grande escuchando → turno con respuesta → pasar a los chats (compañera chiquita) → hablarle
//   → doble toque («estoy escuchando») → hablarle → volver a la mesa grande → hablarle.
// En cada paso se mira QUIÉN tiene el audio (el dueño), QUÉ motor está vivo (el reconocedor del
// teléfono o la conversación en vivo), quién oyó lo que dijo la persona y qué dice la etiqueta.
//
// La conversación en vivo (ElevenLabs por WebRTC) se prueba en tres casos, porque en el teléfono no se
// sabe cuál le tocó a José: conecta y oye; se queda «Conectando…» para siempre; conecta pero el
// micrófono de WebRTC no le llega (cero perfecto).
//
// Lo que en la app hace DeskScreen (el efecto del dueño, el vigilante, la etiqueta) aquí va copiado en
// pocas líneas (`montarApp`): lo que decide está en los módulos reales, esto solo los conecta igual.
//
//   node construir.cjs && node secuencia.cjs            (el arreglo)
//   SRC=/copia/de/main/mobile/src node construir.cjs && node secuencia.cjs   (main: falla)
'use strict';

const assert = require('node:assert/strict');
const path = require('path');
const reloj = require('./reloj.cjs');
const M = require(process.env.OIDO || path.join(__dirname, 'out/oido.cjs'));
const { SPEECH, DUENO, SESION, ANIMO } = M;
const mundo = globalThis.__mundo;
/** ¿Este paquete trae el arreglo? (si no, es el código de main y se conecta como en main). */
const NUEVO = typeof DUENO.VigilanteOido === 'function';

const avanzar = reloj.avanzar;
/**
 * Lo que falla en un paso se anota y la secuencia SIGUE (así, contra main, se ve la evidencia de todos
 * los pasos y no solo del primero que falla); al final de la prueba, si algo falló, la prueba falla.
 */
let fallas = [];
const chequear = (ok, msg) => {
  if (ok) return;
  fallas.push(msg);
  console.log(`     ✗ ${msg}`);
};
let fallos = 0;
let n = 0;
const pruebas = [];
const prueba = (nombre, f) => pruebas.push([nombre, f]);

/** El pegamento de DeskScreen + VozProvider + Companera, en chiquito. */
let appViva = null;
async function montarApp({ voz = 'conecta', llamada = false } = {}) {
  const intervalos = [];
  const cada = (f, ms) => intervalos.push(setInterval(f, ms));
  const app = { pantalla: 'mesa', appActiva: true, enLlamada: false, micMuted: false, oidoListo: false, hablando: false, pensando: false, status: 'boot', oidos: [], respuestas: [], globos: [], migas: [], voz };
  const control = new SESION.ControlSesion('aura', 'es', { reintentos: 1 });
  const oido = new DUENO.OidoMesa({
    muteMic: SPEECH.muteMic,
    unmuteMic: SPEECH.unmuteMic,
    reabrirMic: SPEECH.reabrirMic,
    pauseMicForTts: SPEECH.pauseMicForTts,
    stopSpeaking: () => void (app.hablando = false),
    cancelarTurno: () => {},
    micQuerido: () => app.oidoListo && !app.micMuted,
    miga: (t) => app.migas.push(t),
  });
  oido.fijar('mesa');
  // El MODO LLAMADA (compa/llamadaCiclo.ts, el real), conectado como en el VozProvider.
  const ciclo = llamada && M.CICLO ? new M.CICLO.CicloLlamada({ nombre: () => 'AU-RA', idioma: () => 'es' }) : null;
  app.ciclo = ciclo;
  app.rapidas = [];
  app.despedidas = [];
  const ejecutar = (ef) => {
    for (const e of ef || []) {
      if (e.tipo === 'abrir') control.iniciar();
      else if (e.tipo === 'cerrar') control.terminar();
      else if (e.tipo === 'silenciar') control.silenciar(e.valor);
      else if (e.tipo === 'dormir') control.dormir();
      else if (e.tipo === 'primerMensaje') app.oidos.push({ por: 'conversacion (primer mensaje)', texto: e.texto, dueno: oido.actual() });
      else if (e.tipo === 'despedida') {
        app.despedidas.push(e.texto);
        void decir(e.texto);
      } else if (e.tipo === 'alNativo' && e.texto) void decir(`Respuesta a «${e.texto}»`);
    }
  };
  app.ejecutar = ejecutar;
  const vozOcupa = () => control.vista().montada || control.vista().dormida;
  const mesaVisible = () => app.pantalla === 'mesa';
  const nuestro = () => (DUENO.oidoPropio ? DUENO.oidoPropio(oido.actual()) : oido.actual() === 'mesa') && !vozOcupa() && !app.enLlamada;
  const idle = () => {
    if (app.micMuted) return void (app.status = 'muted');
    if (!NUEVO) return void (app.status = 'listening');
    if (!oido.oye()) return;
    app.status = SPEECH.oidoEscuchando() ? 'listening' : 'reconnect';
  };
  // El efecto del dueño del audio (DeskScreen).
  const aplicar = () => {
    const d = DUENO.duenoAudio({ enLlamada: app.enLlamada, conversacion: vozOcupa(), mesaVisible: mesaVisible(), appActiva: app.appActiva, companeraVisible: app.pantalla !== 'mesa' });
    const hizo = oido.aplicar(d);
    if (hizo === 'suelta') {
      app.hablando = false;
      if (d !== 'conversacion') app.status = 'muted';
    } else if (hizo === 'toma') app.status = app.micMuted ? 'muted' : NUEVO && !SPEECH.oidoEscuchando() ? 'reconnect' : 'listening';
    return d;
  };
  // La voz de la mesa (en main solo con la mesa a la vista; con el arreglo, también la compañera).
  const puedeHablar = () => (NUEVO ? oido.puedeHablar() : !vozOcupa() && !app.enLlamada && mesaVisible() && oido.puedeHablar());
  const decir = async (texto) => {
    if (!puedeHablar()) return void app.respuestas.push({ texto, sono: false, dueno: oido.actual() });
    app.hablando = true;
    SPEECH.pauseMicForTts(true);
    app.respuestas.push({ texto, sono: true, dueno: oido.actual() });
    await new Promise((r) => setTimeout(r, 400));
    if (app.hablando) {
      app.hablando = false;
      SPEECH.pauseMicForTts(false);
      idle();
    }
  };
  SPEECH.setSpeechCallbacks({
    onFinal: (t) => {
      // En la espera del modo llamada, lo que oye el teléfono se decide en el ciclo (DeskScreen.onSpeechFinal).
      if (ciclo && ciclo.estado() === 'espera') {
        const d = ciclo.frase(t, { mesaVisible: mesaVisible(), ruido: 0.1 });
        app.oidos.push({ por: 'telefono (espera)', texto: t, dueno: oido.actual(), decision: d.tipo });
        if (d.tipo === 'ignorar') return;
        if (d.tipo === 'despertar') {
          // El camino rápido (soloRapido) resuelve las órdenes claras sin conectar la llamada.
          if (/\b(apaga|abre|vete|pon|cambia)\b/i.test(d.resto)) {
            app.rapidas.push(d.resto);
            void decir(`Listo: ${d.resto}`);
            return;
          }
          ejecutar(ciclo.despertar(d.resto));
          return;
        }
      }
      app.oidos.push({ por: 'telefono', texto: t, dueno: oido.actual() });
      app.pensando = true;
      setTimeout(() => {
        app.pensando = false;
        void decir(`Respuesta a «${t}»`);
      }, 600);
    },
  });
  // El ánimo de la compañera: sus globitos.
  let animo = ANIMO.ANIMO_INICIAL;
  const despachar = (ev) => {
    const r = ANIMO.reducir(animo, ev, Date.now(), () => 0.99);
    animo = r.animo;
    for (const e of r.efectos) {
      if (e.tipo === 'globo') app.globos.push({ texto: e.texto, en: Date.now(), oye: motorOyendo() });
      if (e.tipo === 'alternarVoz') {
        if (ciclo) ejecutar(ciclo.dobleToque());
        else control.despertarOSilenciar();
      }
    }
  };
  // La conversación en vivo simulada (ModoConversacion con key={gen}).
  let sesion = null;
  const montarSesion = (gen) => {
    const s = { gen, vivo: true, conectada: false, timers: [] };
    sesion = s;
    s.timers.push(
      setTimeout(() => {
        if (!s.vivo) return;
        mundo.webrtcTieneMic = true; // AudioSession de LiveKit + la pista del micrófono
        if (app.voz === 'cuelga') return;
        s.timers.push(
          setTimeout(() => {
            if (!s.vivo) return;
            s.conectada = true;
            control.alEstado(gen, 'escuchando');
          }, 300)
        );
      }, 150)
    );
    s.nivel = setInterval(() => {
      if (s.vivo && s.conectada && control.entrada) control.entrada(app.voz === 'sorda' ? 0 : 0.01);
    }, 50);
  };
  const desmontar = () => {
    if (!sesion) return;
    sesion.vivo = false;
    sesion.timers.forEach(clearTimeout);
    clearInterval(sesion.nivel);
    sesion = null;
    mundo.webrtcTieneMic = false;
  };
  let vozAntes = null;
  let vistaAntes = control.vista();
  const soltarControl = control.suscribir((v) => {
    const a = vistaAntes;
    vistaAntes = v;
    if (v.montada && (!sesion || sesion.gen !== v.gen)) {
      desmontar();
      montarSesion(v.gen);
    } else if (!v.montada) desmontar();
    aplicar();
    if (ciclo) {
      const ef = [];
      if (v.montada && v.estado === 'conectando' && (!a.montada || a.gen !== v.gen)) ef.push(...ciclo.sesionAbriendo());
      if (v.montada && (v.estado === 'escuchando' || v.estado === 'hablando') && a.estado === 'conectando') ef.push(...ciclo.conectado());
      if (v.estado === 'hablando' && a.estado !== 'hablando') ef.push(...ciclo.agente(true));
      if (a.estado === 'hablando' && v.estado !== 'hablando') ef.push(...ciclo.agente(false));
      if (!v.montada && v.estado === 'error' && (a.montada || a.estado !== 'error')) ef.push(...ciclo.fallo(v.detalle));
      else if (a.montada && !v.montada) ef.push(...ciclo.cerrada());
      ejecutar(ef);
    }
    // La línea de estado de la mesa durante la conversación (DeskScreen: lo que dice la sesión).
    if (v.montada) app.status = v.silenciada ? 'muted' : v.estado === 'conectando' ? 'thinking' : v.estado === 'hablando' ? 'speaking' : v.estado === 'escuchando' ? 'listening' : app.status;
    const vv = { estado: v.estado, silenciada: v.silenciada, dormida: v.dormida, suspendida: v.suspendida };
    if (JSON.stringify(vv) !== JSON.stringify(vozAntes)) {
      vozAntes = vv;
      despachar({ tipo: 'voz', voz: vv });
    }
  });
  // ¿Quién oye de verdad ahora?
  const conversacionOye = () => !!sesion && sesion.conectada && app.voz !== 'sorda' && !control.vista().silenciada;
  // El oído del teléfono: el reconocedor nativo o, si cayó a la nube, la grabación que va a Whisper.
  const nubeOye = () => SPEECH.currentSttEngine() === 'cloud' && mundo.grabando > 0 && !mundo.webrtcTieneMic;
  const telefonoOye = () => nuestro() && !app.micMuted && (mundo.nativoOye() || nubeOye());
  function motorOyendo() {
    return conversacionOye() || telefonoOye();
  }
  app.control = control;
  app.oido = oido;
  app.motorOyendo = motorOyendo;
  // Lo que la conversación DICE (conectada): si el micrófono de WebRTC no le llega, no hay forma de
  // saberlo al instante; el vigilante lo descubre en SORDA_MS.
  app.conversacionConectada = () => !!sesion && sesion.conectada;
  app.conversacionOye = conversacionOye;
  app.telefonoOye = telefonoOye;
  app.aplicar = aplicar;
  app.despachar = despachar;
  app.hablar = (texto) => {
    if (conversacionOye()) {
      app.oidos.push({ por: 'conversacion', texto, dueno: oido.actual() });
      control.oyoFrase?.();
      if (ciclo) {
        // La llamada: la persona habló, el agente contesta ~2 s y vuelve a escuchar.
        ejecutar(ciclo.turnoUsuario(texto));
        const gen = control.vista().gen;
        setTimeout(() => control.alEstado(gen, 'hablando'), 800);
        setTimeout(() => control.alEstado(gen, 'escuchando'), 3000);
      }
      return 'conversacion';
    }
    if (nuestro() && mundo.oirNativo(texto)) return 'telefono';
    app.oidos.push({ por: 'nadie', texto, dueno: oido.actual() });
    return 'nadie';
  };
  app.estado = () => ({
    dueno: oido.actual(),
    conversacion: control.vista().montada ? control.vista().estado : `cerrada${control.vista().estado === 'error' ? ' (error)' : ''}`,
    motorTelefono: SPEECH.currentSttEngine() === 'cloud' ? (nubeOye() ? 'nube' : 'nube parada') : mundo.nativoActivo() ? (mundo.webrtcTieneMic ? 'vivo pero sin audio (WebRTC tiene el micrófono)' : 'escuchando') : 'apagado',
    webrtc: mundo.webrtcTieneMic ? (conversacionOye() ? 'escuchando' : 'con el micrófono, sin oír') : 'suelto',
    etiqueta: app.status,
  });
  // El vigilante del oído (DeskScreen): con el arreglo, con la app delante y el oído nuestro; en main,
  // solo con la mesa a la vista.
  if (NUEVO) {
    const vig = new DUENO.VigilanteOido({
      esNuestro: nuestro,
      silenciado: () => app.micMuted || !app.oidoListo,
      hablando: () => app.hablando,
      pensando: () => app.pensando,
      pausado: SPEECH.isMicPaused,
      soltarPausa: () => SPEECH.pauseMicForTts(false),
      vivo: SPEECH.micWatchdogOk,
      revivio: SPEECH.oidoVivoDeVerdad,
      reiniciar: () => SPEECH.restartMic(),
      caerANube: SPEECH.caerANube,
      miga: (t) => app.migas.push(t),
    });
    cada(() => {
      if (!app.appActiva) return;
      const r = vig.revisar();
      if (!nuestro() || !app.oidoListo || app.micMuted || app.hablando || app.pensando) return;
      app.status = r === 'reinicia' || r === 'nube' || r === 'sordo' || !SPEECH.oidoEscuchando() ? 'reconnect' : 'listening';
    }, 3000);
  } else {
    let pausadoSinVoz = 0;
    cada(() => {
      if (!(mesaVisible() && app.appActiva) || oido.actual() !== 'mesa') return;
      if (app.micMuted || app.hablando || vozOcupa() || app.enLlamada) return void (pausadoSinVoz = 0);
      if (SPEECH.isMicPaused() && !app.pensando) {
        if (++pausadoSinVoz >= 2) {
          SPEECH.pauseMicForTts(false);
          pausadoSinVoz = 0;
        }
        return;
      }
      pausadoSinVoz = 0;
      if (!SPEECH.micWatchdogOk()) {
        app.status = 'reconnect';
        void SPEECH.restartMic().then(idle);
      }
    }, 3000);
  }
  // El vigía de la conversación (VozProvider): solo existe con el arreglo.
  if (typeof control.revisar === 'function') cada(() => control.revisar(), 1000);
  // El reloj del ciclo (VozProvider): colgar por silencio, cerrar la sesión silenciada.
  if (ciclo) cada(() => ejecutar(ciclo.tic()), 1000);
  app.cerrar = () => {
    intervalos.forEach(clearInterval);
    soltarControl();
    desmontar();
  };
  appViva = app;
  // Arranque de la mesa: permiso y oído abierto.
  await SPEECH.ensureSpeechPermissions();
  await SPEECH.enableAlwaysOnMic();
  app.oidoListo = true;
  app.status = 'listening';
  if (ciclo) ejecutar(ciclo.encender());
  await avanzar(500);
  return app;
}

/** Un paso de la secuencia, con su evidencia impresa. */
function evidencia(app, paso) {
  const e = app.estado();
  console.log(`   · ${paso.padEnd(34)} dueño=${String(e.dueno).padEnd(12)} teléfono=${e.motorTelefono.padEnd(11)} webrtc=${e.webrtc.padEnd(9)} conversación=${e.conversacion.padEnd(16)} etiqueta=${e.etiqueta}`);
  // Nunca dos motores peleando el micrófono: si WebRTC lo tiene, el reconocedor del teléfono no puede estar encendido.
  chequear(!(mundo.nativoActivo() && mundo.webrtcTieneMic), `${paso}: dos motores con el micrófono`);
  // La etiqueta no miente: «escuchando» solo si un motor escucha de verdad.
  if (app.status === 'listening') chequear(app.motorOyendo() || app.conversacionConectada(), `${paso}: la etiqueta dice «escuchando» y nadie escucha (${JSON.stringify(e)})`);
}

async function decirYEsperar(app, texto, paso) {
  const antes = app.respuestas.length;
  const quien = app.hablar(texto);
  await avanzar(2000);
  const r = app.respuestas.slice(antes);
  const oyo = app.oidos.at(-1);
  console.log(`   · ${paso.padEnd(34)} «${texto}» → lo oyó: ${oyo?.por}${quien === 'conversacion' ? ' (le contesta el agente)' : r.length ? ` · contestó ${r[0].sono ? `en voz (${r[0].dueno})` : 'SIN VOZ (callada)'}` : ' · sin respuesta'}`);
  return { quien: oyo?.por, respuesta: r[0] };
}

for (const voz of ['conecta', 'cuelga', 'sorda']) {
  prueba(`la secuencia de José con la conversación en vivo que ${voz === 'conecta' ? 'conecta y oye' : voz === 'cuelga' ? 'se queda «Conectando…»' : 'conecta pero no le llega el micrófono'}`, async () => {
    const app = await montarApp({ voz });
    // 1) Mesa grande escuchando → turno con respuesta.
    evidencia(app, '1 mesa grande');
    let r = await decirYEsperar(app, 'hola aura', '1 hablarle en la mesa');
    chequear(r.quien === 'telefono', '1: la mesa oye');
    chequear(r.respuesta?.sono, '1: contesta en la mesa');
    // 2) A los chats: la compañera chiquita.
    app.pantalla = 'chats';
    app.aplicar();
    await avanzar(300);
    evidencia(app, '2 chats (compañera chica)');
    r = await decirYEsperar(app, 'qué hora es', '2 hablarle a la compañera');
    chequear(r.quien === 'telefono', '2: la compañera en el chat escucha (José: «me dejó de escuchar»)');
    chequear(r.respuesta?.sono, '2: y contesta con la voz');
    // 3) Doble toque: «estoy escuchando».
    const g0 = app.globos.length;
    app.despachar({ tipo: 'dobleToque' });
    const alTocar = app.globos.slice(g0);
    for (const g of alTocar) if (/escucho|listening/i.test(g.texto)) chequear(g.oye, `3: al tocarla dice «${g.texto}» y ningún motor escucha`);
    await avanzar(1000);
    evidencia(app, '3 doble toque (+1 s)');
    if (voz !== 'conecta') {
      // La conversación no llega a oír: el vigilante lo ve y el oído del teléfono vuelve.
      await avanzar(30_000);
      evidencia(app, '3 doble toque (+31 s)');
    }
    const g1 = app.globos.length;
    r = await decirYEsperar(app, 'mándale un mensaje a beto', '3 hablarle tras el doble toque');
    chequear(r.quien !== 'nadie', '3: tras el doble toque alguien escucha de verdad (José: «nunca me escuchó»)');
    for (const g of app.globos.slice(g1)) if (/escucho|listening/i.test(g.texto)) chequear(g.oye, `3: globito «${g.texto}» sin motor`);
    // 4) Vuelve a la mesa grande.
    app.pantalla = 'mesa';
    app.aplicar();
    await avanzar(500);
    evidencia(app, '4 de vuelta en la mesa grande');
    r = await decirYEsperar(app, 'qué tiempo hace', '4 hablarle en la mesa grande');
    chequear(r.quien !== 'nadie', '4: al volver a la mesa la escucha alguien (José: «no me volvió a escuchar»)');
    // Y un rato después sigue escuchando (no se cae sola).
    await avanzar(20_000);
    evidencia(app, '4 mesa grande (+20 s)');
    r = await decirYEsperar(app, 'gracias', '4 hablarle otra vez');
    chequear(r.quien !== 'nadie', '4: y sigue escuchando 20 s después');
    app.control.terminar();
    await avanzar(1000);
  });
}

prueba('MODO LLAMADA (por omisión): espera barata → «Aura, …» → llamada que sigue viva de la mesa al chat y de vuelta → doble toque silencia → cuelga sola → orden suelta sin llamada', async () => {
  if (!M.CICLO) {
    chequear(false, 'este código no tiene el modo llamada (compa/llamadaCiclo.ts)');
    return;
  }
  const app = await montarApp({ llamada: true });
  const c = app.ciclo;
  const quien = () => (app.conversacionOye() ? 'conversacion' : app.telefonoOye() ? 'telefono' : 'nadie');
  const paso = (nombre) => {
    evidencia(app, nombre);
    console.log(`     ciclo=${c.estado()} · conectado ${Math.round(c.usadoMs() / 1000)} s`);
    // Un solo motor vivo: en llamada solo la conversación; en espera solo el teléfono; silenciado, nadie.
    if (c.estado() === 'en_llamada') chequear(quien() === 'conversacion', `${nombre}: en llamada oye ${quien()}`);
    if (c.estado() === 'espera') chequear(quien() === 'telefono', `${nombre}: en espera oye ${quien()}`);
    if (c.estado() === 'silenciado') chequear(quien() === 'nadie', `${nombre}: silenciado y oye ${quien()}`);
  };
  paso('1 mesa, en espera');
  chequear(c.estado() === 'espera', '1: arranca en espera (sin gastar minutos)');
  // Sin su nombre, de frente a la mesa y en silencio: también (y lo dicho no se pierde).
  let r = await decirYEsperar(app, 'Aura, ¿cómo estás hoy?', '2 «Aura, ¿cómo estás hoy?»');
  await avanzar(1500);
  paso('2 llamada conectada');
  chequear(c.estado() === 'en_llamada', '2: la palabra de activación abre la llamada');
  chequear(app.oidos.some((o) => o.por === 'conversacion (primer mensaje)' && /cómo estás hoy/.test(o.texto)), '2: lo dicho en espera entra como primer mensaje');
  const gen = app.control.vista().gen;
  // A los chats: la misma llamada sigue (no se corta ni queda sorda).
  app.pantalla = 'chats';
  app.aplicar();
  await avanzar(500);
  paso('3 chats (compañera chica)');
  r = await decirYEsperar(app, 'escríbele a beto que ya voy', '3 hablarle en el chat');
  chequear(r.quien === 'conversacion', '3: en el chat la oye la misma llamada');
  chequear(app.control.vista().gen === gen, '3: sin reconectar al cambiar de pantalla');
  // Doble toque: silencio de verdad.
  app.despachar({ tipo: 'dobleToque' });
  await avanzar(300);
  paso('4 doble toque (silenciado)');
  chequear(c.estado() === 'silenciado', '4: el doble toque silencia');
  r = await decirYEsperar(app, 'esto no lo tiene que oír', '4 hablarle silenciada');
  chequear(r.quien === 'nadie', '4: silenciada no oye nadie (ni el teléfono)');
  app.despachar({ tipo: 'dobleToque' });
  await avanzar(300);
  paso('5 doble toque (otra vez escucha)');
  chequear(c.estado() === 'en_llamada', '5: el segundo doble toque vuelve a escuchar');
  r = await decirYEsperar(app, 'ya puedes oír', '5 hablarle');
  chequear(r.quien === 'conversacion', '5: vuelve a oír la llamada');
  // De vuelta a la mesa grande: la misma llamada.
  app.pantalla = 'mesa';
  app.aplicar();
  await avanzar(500);
  paso('6 mesa grande');
  r = await decirYEsperar(app, '¿y qué más?', '6 hablarle en la mesa');
  chequear(r.quien === 'conversacion' && app.control.vista().gen === gen, '6: la misma llamada en la mesa grande');
  // Silencio: cuelga sola, dice cómo volver a llamarla y queda en espera.
  await avanzar(75_000);
  paso('7 tras el silencio');
  chequear(c.estado() === 'espera', '7: colgó sola tras el silencio');
  chequear(app.despedidas.length === 1 && /AU-RA/.test(app.despedidas[0]), `7: se despidió breve (${app.despedidas[0]})`);
  const usado = c.usadoMs();
  // Una orden suelta en espera: el camino rápido la resuelve sin conectar la llamada.
  r = await decirYEsperar(app, 'Aura, abre mis chats', '8 «Aura, abre mis chats»');
  await avanzar(2000);
  paso('8 orden suelta');
  chequear(app.rapidas.includes('abre mis chats'), '8: la orden va por el camino rápido');
  chequear(c.estado() === 'espera' && c.usadoMs() === usado, '8: sin abrir la llamada (cero minutos)');
  // Algo dicho al aire en los chats sin su nombre: se ignora (no abre llamadas por la tele).
  app.pantalla = 'chats';
  app.aplicar();
  await avanzar(300);
  await decirYEsperar(app, 'ya voy mamá', '9 al aire en los chats');
  chequear(c.estado() === 'espera', '9: sin su nombre en los chats no abre la llamada');
  console.log(`   · minutos conectados en esta secuencia: ${(c.usadoMs() / 60_000).toFixed(1)} min`);
});

prueba('el reconocedor del teléfono falla al arrancar una y otra vez (error + end, sin «start»): se reinicia, pasa a la nube y la etiqueta no miente', async () => {
  const app = await montarApp();
  evidencia(app, 'mesa, oído sano');
  mundo.fallaAlArrancar = 'client';
  // Algo lo tumba (el sistema, otra app): de aquí en adelante cada arranque falla.
  void SPEECH.restartMic();
  await avanzar(4000);
  const arranques0 = mundo.arranques;
  await avanzar(8_000);
  // Muerto: la etiqueta no puede decir «escuchando» (evidencia lo comprueba).
  evidencia(app, 'a los 12 s de fallos');
  await avanzar(32_000);
  evidencia(app, 'tras 40 s de fallos');
  console.log(`   · arranques en 40 s: ${mundo.arranques - arranques0} · motor: ${SPEECH.currentSttEngine()} · migas: ${app.migas.filter((m) => /oído:/.test(m)).slice(-3).join(' | ')}`);
  // Un bucle de error+end no es vida: el vigilante lo detecta; tras el tope, el oído sigue por la nube.
  assert.equal(SPEECH.currentSttEngine(), 'cloud', 'tras reiniciar sin éxito, el oído pasa a la nube (antes: el guardián lo daba por vivo)');
  mundo.fallaAlArrancar = null;
});

prueba('con el hilo principal lento, el «end» tardío de un abort() no provoca un segundo arranque (ni el «busy» de Android)', async () => {
  const app = await montarApp();
  mundo.hiloMs = 300; // la escena 3D al volver a la mesa grande ocupa el hilo principal
  const arr0 = mundo.arranques;
  const busy0 = mundo.eventos.filter((e) => e === 'error').length;
  void SPEECH.restartMic();
  await avanzar(3000);
  const arranques = mundo.arranques - arr0;
  const errores = mundo.eventos.filter((e) => e === 'error').length - busy0;
  console.log(`   · reinicio con el hilo lento: ${arranques} arranque(s), ${errores} error(es) · oye: ${app.telefonoOye()}`);
  assert.equal(arranques, 1, 'un reinicio = un arranque (antes el end viejo pedía otro y Android contestaba «busy»)');
  assert.equal(errores, 0);
  assert.ok(app.telefonoOye());
  mundo.hiloMs = 2;
});

(async () => {
  console.log(`oído (${NUEVO ? 'con el arreglo' : 'código de main'})`);
  for (const [nombre, f] of pruebas) {
    n++;
    // Cada prueba empieza con el oído limpio.
    appViva?.cerrar();
    appViva = null;
    await SPEECH.destroySpeech();
    Object.assign(mundo, { webrtcTieneMic: false, fallaAlArrancar: null, hiloMs: 2 });
    if (SPEECH.currentSttEngine() !== 'native') await SPEECH.setSttEngine('native');
    await avanzar(1000);
    console.log(`\n${nombre}`);
    fallas = [];
    try {
      await f();
      assert.deepEqual(fallas, [], 'falló algún paso');
      console.log(`ok    ${nombre}`);
    } catch (e) {
      fallos++;
      console.log(`FALLA ${nombre}\n      ${String(e?.message || e).split('\n').join('\n      ')}`);
    }
  }
  console.log(`\n${n - fallos}/${n} pruebas bien`);
  process.exit(fallos ? 1 : 0);
})();
