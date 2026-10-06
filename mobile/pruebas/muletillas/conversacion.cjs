// LAS MULETILLAS EN LA MESA, de punta a punta con el código REAL (lib/speech + el oído Turbo, lib/muletillas*,
// lib/sfx, lib/tts) y lo nativo simulado (./shims): el micrófono crudo con su cancelador de eco, la bocina que se cuela
// al micrófono mientras suena el «mjm», /api/tts con la voz de cada avatar, el disco y GET /api/movil/config.
//
//   node construir.cjs && node conversacion.cjs
//   SRC=/copia/de/main/mobile/src node construir.cjs && node conversacion.cjs     (main: no hay muletillas, falla)
'use strict';

const assert = require('node:assert/strict');
const path = require('path');
const reloj = require('../oido/reloj.cjs');
const m = require('./shims/mundo.js');
/** Las migas (lib/reporte.ts) se juntan aquí en vez de ir a la consola. */
globalThis.__DEV__ = false;

/** Los bytes de cada trozo dicen de quién es: la persona, la bocina (el «mjm») o el cuarto callado. */
const PERSONA = 0x50;
const BOCINA = 0x42;
const CUARTO = 0x07;

/** Turbo de mentira (el WebSocket de React Native): contesta los commits a los 50 ms con lo que diga la prueba. */
const sockets = [];
let alCommit = null;
class WsFalso {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.enviados = [];
    this.onopen = this.onmessage = this.onerror = this.onclose = null;
    sockets.push(this);
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
      this.decir({ message_type: 'session_started' });
    }, 5);
  }
  decir(j) {
    this.onmessage?.({ data: JSON.stringify(j) });
  }
  send(d) {
    const j = JSON.parse(d);
    this.enviados.push(j);
    if (j.commit && alCommit !== null) {
      const t = alCommit;
      alCommit = null;
      setTimeout(() => this.decir({ message_type: 'committed_transcript', text: t }), 50);
    }
  }
  close() {
    this.readyState = 3;
  }
  oyoLaBocina(desde = 0) {
    return this.enviados.slice(desde).some((x) => {
      const b = Buffer.from(x.audio_base_64, 'base64');
      return b.length > 100 && b[0] === BOCINA;
    });
  }
}
globalThis.WebSocket = WsFalso;

const M = require(process.env.MUL || path.join(__dirname, 'out/muletillas.cjs'));
const { SPEECH, MESA, AUDIO, AJUSTE, TTS, SONANDO } = M;
if (!MESA || !AUDIO || !AJUSTE) {
  console.log('✗ este código no trae las muletillas (lib/muletillasMesa, lib/muletillasAudio, lib/muletillasAjuste)');
  process.exit(1);
}

const ws = () => sockets[sockets.length - 1];
let dicho = '';
let ultimaVoz = 0;
async function trozo(persona) {
  await reloj.avanzar(100);
  const ahora = Date.now();
  const bocina = !persona && ahora <= m.bocinaHasta;
  const w = ws();
  const antes = w ? w.enviados.length : 0;
  m.alTrozo({ audio: Buffer.alloc(3200, persona ? PERSONA : bocina ? BOCINA : CUARTO).toString('base64'), db: persona ? -20 : bocina ? -30 : -75 });
  if (persona) ultimaVoz = ahora;
  // Si a Turbo le llega el «mjm», lo escribe detrás de lo que iba (como haría).
  if (w && w.oyoLaBocina(antes) && !/mjm$/.test(dicho)) {
    dicho = `${dicho} mjm`;
    w.decir({ message_type: 'partial_transcript', text: dicho });
  }
}
async function callar(k) {
  for (let i = 0; i < k; i++) await trozo(false);
}
/** Habla `ms` diciendo `texto` (un parcial por segundo, como Turbo), con un respiro de 0,1 s cada medio segundo. */
async function hablar(ms, texto) {
  const palabras = texto.split(' ');
  for (let i = 0; i < ms; i += 100) {
    await trozo(i % 500 !== 200);
    if (i % 1000 === 0 && ws()) {
      dicho = palabras.slice(0, Math.max(1, Math.round((palabras.length * (i + 1000)) / ms))).join(' ');
      ws().decir({ message_type: 'partial_transcript', text: dicho });
    }
  }
  dicho = texto;
  ws()?.decir({ message_type: 'partial_transcript', text: texto });
}

const MEDIA_IDEA = 'y entonces fuimos a ver lo del terreno con mi hermano y';
const finales = [];
const cortes = [];
let hablando = false;
SPEECH.setSpeechCallbacks({
  onFinal: (t) => finales.push({ texto: t, tras: Date.now() - ultimaVoz }),
  onBargeIn: (t) => cortes.push(t),
});

/** La mesa: como useMuletillasMesa (lib/muletillasMesa.ts), sin React. */
let encendidas = false;
function montarMesa() {
  const orq = MESA.orquestaDeLaMesa(
    () => ({ avatar: 'aura', idioma: 'es', hablando: () => hablando, ocupada: () => false }),
    () => encendidas
  );
  SPEECH.setMuletillas(orq);
  return orq;
}
async function aplicar() {
  encendidas = MESA.aplicarMuletillas('aura', 'es', encendidas);
  await reloj.avanzar(50);
}

let fallos = 0;
const pruebas = [];
const prueba = (nombre, f) => pruebas.push([nombre, f]);

prueba('los clips: la voz de cada avatar, por /api/tts una sola vez, guardados en el disco; la de respaldo no se guarda', async () => {
  await AJUSTE.leerMuletillas();
  await AJUSTE.refrescarMuletillasRemota(true);
  assert.equal(AJUSTE.estadoMuletillas().encendidas, true, 'Android con micrófono crudo y cancelador: encendidas por omisión');
  assert.equal(await AUDIO.prepararMuletillas('aura', 'es'), 4);
  assert.deepEqual(m.tts.map((p) => `${p.avatar}/${p.idioma}/${p.texto}`), ['aura/es/Mjm.', 'aura/es/Ajá.', 'aura/es/Ya.', 'aura/es/Okey.']);
  assert.equal(AUDIO.duracionMuletilla('mjm'), 380);
  await AUDIO.prepararMuletillas('aura', 'es');
  assert.equal(m.tts.length, 4, 'la misma voz otra vez: nada nuevo');
  assert.equal(await AUDIO.prepararMuletillas('claudio', 'en'), 4);
  assert.deepEqual(m.tts.slice(4).map((p) => `${p.avatar}/${p.idioma}/${p.texto}`), ['claudio/en/Mm-hmm.', 'claudio/en/Yeah.', 'claudio/en/Right.', 'claudio/en/Okay.']);
  assert.equal(AUDIO.duracionMuletilla('mjm'), null, 'cambió el avatar: los de AU-RA se soltaron');
  assert.equal(await AUDIO.prepararMuletillas('aura', 'es'), 4);
  assert.equal(m.tts.length, 8, 'de vuelta a AU-RA: salen del disco, sin pedir voz');
  // Un miembro sin minutos: el servidor contesta con la voz de respaldo (otra voz). No se guarda ni se usa.
  m.motorTts = 'voicebox';
  assert.equal(await AUDIO.prepararMuletillas('antonio', 'es'), 0);
  assert.equal([...m.archivos.keys()].filter((k) => k.includes('antonio')).length, 0, 'nada de la otra voz en el disco');
  m.motorTts = 'elevenlabs-v3';
  assert.equal(await AUDIO.prepararMuletillas('antonio', 'es'), 0, 'lo que falló no se vuelve a pedir en esta sesión');
  // Un «mjm» que la voz leyó largo («eme jota eme»): se descarta y se borra.
  const antes = m.duracionDe;
  m.duracionDe = (t) => (t === 'Mjm.' ? 1400 : antes(t));
  assert.equal(await AUDIO.prepararMuletillas('antonio', 'en'), 4);
  assert.equal(await AUDIO.prepararMuletillas('claudio', 'es'), 3, 'el «Mjm.» largo no es un murmullo');
  assert.equal([...m.archivos.keys()].some((k) => k.includes('claudio-es-mjm')), false, 'y se borró del disco');
  m.duracionDe = antes;
  await AUDIO.prepararMuletillas('aura', 'es');
});

prueba('el micrófono de escucha: encendidas, dictado con el cancelador de eco; apagadas, el de siempre', async () => {
  montarMesa();
  await aplicar();
  await SPEECH.enableAlwaysOnMic();
  await reloj.avanzar(50);
  assert.equal(m.grabando, 'reconocimiento_eco');
  await AJUSTE.fijarMuletillas(false);
  await aplicar();
  assert.equal(m.grabando, 'reconocimiento', 'apagadas en Ajustes: vuelve la fuente de dictado sola');
  assert.equal(AJUSTE.estadoMuletillas().motivo, 'apagadas_por_la_persona');
  await AJUSTE.fijarMuletillas(true);
  await aplicar();
  assert.equal(m.grabando, 'reconocimiento_eco');
});

/** Desde qué mensaje a Turbo empieza la frase de ahora. */
let desdeMensaje = 0;
/** Una frase larga a media idea y una pausa: cuándo sale la frase y qué sonó. */
async function fraseLarga() {
  finales.length = 0;
  m.sonidos.length = 0;
  desdeMensaje = ws() ? ws().enviados.length : 0;
  await callar(5);
  await hablar(8000, MEDIA_IDEA);
  alCommit = 'Y entonces fuimos a ver lo del terreno con mi hermano y';
  await callar(25);
  await reloj.avanzar(100);
}

let base = null;
prueba('sin muletillas: cuándo sale la frase (la base)', async () => {
  await AJUSTE.fijarMuletillas(false);
  await aplicar();
  montarMesa();
  await fraseLarga();
  assert.equal(m.sonidos.length, 0);
  assert.equal(finales.length, 1);
  base = finales[0];
});

prueba('con muletillas: un «mjm» bajito por el canal de efectos, sin tocar la voz de AU-RA ni el oído; la frase sale igual', async () => {
  await AJUSTE.fijarMuletillas(true);
  await aplicar();
  montarMesa();
  await fraseLarga();
  assert.equal(m.sonidos.length, 1, 'sonó uno');
  const s = m.sonidos[0];
  assert.match(s.uri, /asentir-v1\/aura-es-/, 'el clip de AU-RA en español');
  assert.equal(s.volumen, M.ASENTIR.VOLUMEN_ASENTIR);
  assert.deepEqual(TTS.registroVoz.dichos(), [], 'no pasó por la voz de AU-RA (no queda como eco ni como «dicho»)');
  assert.equal(SONANDO.vozSonando.ahora().sonando, false, 'la boca del avatar no se movió');
  assert.equal(SPEECH.isMicPaused(), false, 'el oído no se pausó');
  assert.deepEqual(cortes, [], 'no abrió la interrupción');
  assert.equal(ws().oyoLaBocina(desdeMensaje), false, 'a Turbo le llegó silencio en lugar del «mjm»');
  assert.equal(finales.length, 1);
  assert.equal(finales[0].texto, base.texto);
  assert.equal(finales[0].tras, base.tras, `la frase sale a los ${finales[0].tras} ms de callar, igual que sin muletilla (${base.tras} ms)`);
});

prueba('la persona retoma encima del «mjm» y Turbo lo escribe: a la mesa llega limpio', async () => {
  montarMesa();
  finales.length = 0;
  m.sonidos.length = 0;
  await callar(5);
  await hablar(8000, MEDIA_IDEA);
  alCommit = 'Y entonces fuimos a ver lo del terreno con mi hermano y';
  await callar(6);
  assert.equal(m.sonidos.length, 1);
  // Lo que sonó («Mjm.», «Ajá.»…: rota), como Turbo lo escribiría pegado a lo que ella sigue diciendo.
  const dicha = m.sonidos[0].texto.replace(/\.$/, '');
  await hablar(1500, `${dicha.toLowerCase()} le dije que no`);
  alCommit = `${dicha}, le dije que no.`;
  await callar(10);
  await reloj.avanzar(100);
  assert.deepEqual(finales.map((f) => f.texto), ['Y entonces fuimos a ver lo del terreno con mi hermano y le dije que no.']);
});

prueba('AU-RA empieza a hablar con el clip sonando: se calla; mientras ella habla, ninguna', async () => {
  montarMesa();
  m.sonidos.length = 0;
  m.callados = 0;
  await callar(5);
  await hablar(8000, MEDIA_IDEA);
  alCommit = 'Y entonces fuimos a ver lo del terreno con mi hermano y';
  await callar(6);
  assert.equal(m.sonidos.length, 1);
  hablando = true;
  SPEECH.pauseMicForTts(true);
  await reloj.avanzar(10);
  assert.equal(m.callados, 1, 'el clip se calló');
  await callar(10);
  SPEECH.pauseMicForTts(false);
  await callar(5);
  await hablar(8000, MEDIA_IDEA);
  alCommit = 'Y entonces fuimos a ver lo del terreno con mi hermano y';
  await callar(12);
  assert.equal(m.sonidos.length, 1, 'con la mesa hablando (speakingRef), ninguna');
  hablando = false;
});

prueba('con «Interrumpir hablando»: hablarle encima a AU-RA la sigue cortando, y ahí no suena ningún «mjm»', async () => {
  montarMesa();
  m.sonidos.length = 0;
  cortes.length = 0;
  SPEECH.setOirEncima(true);
  await reloj.avanzar(50);
  assert.equal(m.grabando, 'llamada');
  hablando = true;
  SPEECH.pauseMicForTts(true);
  await callar(5);
  await hablar(2000, 'espera espera para un momento');
  assert.equal(cortes.length, 1, 'la cortó');
  assert.equal(m.sonidos.length, 0);
  hablando = false;
  await callar(15);
  SPEECH.setOirEncima(false);
  await reloj.avanzar(50);
  assert.equal(m.grabando, 'reconocimiento_eco');
});

prueba('AURA_ASENTIR=0 en el servidor: se apagan sin APK y el micrófono vuelve al de siempre', async () => {
  m.config = { camaraRapida: { activa: true }, asentir: { activo: false }, honesto: true };
  await AJUSTE.refrescarMuletillasRemota(true);
  await aplicar();
  assert.equal(AJUSTE.estadoMuletillas().motivo, 'apagadas_por_el_servidor');
  assert.equal(m.grabando, 'reconocimiento');
  montarMesa();
  await fraseLarga();
  assert.equal(m.sonidos.length, 0);
  // Sin red o servidor viejo: queda lo último que dijo.
  m.config = 404;
  await AJUSTE.refrescarMuletillasRemota(true);
  assert.equal(AJUSTE.estadoMuletillas().encendidas, false);
  m.config = { camaraRapida: { activa: true }, asentir: { activo: true }, honesto: true };
  await AJUSTE.refrescarMuletillasRemota(true);
  await aplicar();
  assert.equal(m.grabando, 'reconocimiento_eco');
});

prueba('un teléfono donde el cancelador no se deja pegar al dictado: nunca suenan', async () => {
  m.ecoPegaEnDictado = false;
  montarMesa();
  await fraseLarga();
  assert.equal(m.sonidos.length, 0);
  m.ecoPegaEnDictado = true;
});

(async () => {
  for (const [nombre, f] of pruebas) {
    try {
      await f();
      console.log(`✓ ${nombre}`);
    } catch (e) {
      fallos++;
      console.log(`✗ ${nombre}\n   ${String(e && e.message).split('\n').join('\n   ')}`);
    }
  }
  console.log(fallos ? `\n${fallos} de ${pruebas.length} fallaron` : `\nlas ${pruebas.length} pasaron`);
  process.exit(fallos ? 1 : 0);
})();
