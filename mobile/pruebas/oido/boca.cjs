// [boca] LA BOCA VA CON LA VOZ (José, 7-oct, SM-S942B con la 5.6.0: «empieza a mover la boca y la cara antes de que salga
// la voz»), con el código REAL de la mesa (lib/tts.ts speak, StreamSpeaker, speakUrl, stopSpeaking y avatar3d/sonando.ts,
// empaquetados con construir.cjs), el reproductor de expo-av de mentira (shims/nativos.js, con `confirmaMs` de carga) y el
// nativo en streaming de mentira (vozNativaFalsa.cjs, TTFB + prebúfer), con el reloj de mentira:
//
//  · ANTES de que el reproductor confirme que suena (bajando, cargando, onAudioStart, que es antes de play) la cara NO
//    habla: `hablando` false, la cara de hablar se ve pensando (caraConVoz) y el nivel de la boca no se abre;
//  · desde el primer aviso «sonando» (onSuena) habla, y sigue entre frases de la misma locución (hueco corto);
//  · si la frase siguiente tarda (el cerebro todavía escribe), deja de hablar y vuelve a «preparando»;
//  · al terminar la locución (onEnd), al cancelarla o con stopSpeaking (una interrupción), false EN EL ACTO.
//
//   cd mobile/pruebas/oido && node construir.cjs && node boca.cjs
//   (SRC=/copia/de/main/mobile/src sh todas.sh: contra el código de antes falla: la cara hablaba en onAudioStart)
'use strict';

const path = require('path');
const reloj = require('./reloj.cjs');
const falsa = require('./vozNativaFalsa.cjs');

const mundo = (globalThis.__mundo = globalThis.__mundo || {});
const N = falsa.crear();
mundo.vozNativa = N.modulo;
const M = require(process.env.OIDO || path.join(__dirname, 'out/oido.cjs'));
const { TTS, SONANDO } = M;

let fallos = 0;
let n = 0;
const ok = (nombre, cond, detalle) => {
  n++;
  if (cond) console.log(`ok    ${nombre}`);
  else {
    fallos++;
    console.log(`FALLA ${nombre}${detalle !== undefined ? `\n      ${typeof detalle === 'string' ? detalle : JSON.stringify(detalle)}` : ''}`);
  }
};

if (!SONANDO || typeof SONANDO.caraConVoz !== 'function') {
  console.log('FALLA esta copia no tiene avatar3d/sonando.ts con `hablando` ni caraConVoz: la cara habla al decidir hablar, no al sonar');
  process.exit(1);
}
const voz = SONANDO.vozSonando;
const estado = () => voz.ahora();
/** Lo que vería la mesa (DeskScreen): la cara pedida es SPEAKING; la que se ve depende de la voz real. */
const caraVista = () => SONANDO.caraConVoz('SPEAKING', estado().hablando);

async function limpio(o = {}) {
  await TTS.stopSpeaking();
  await reloj.avanzar(1000);
  TTS._olvidarFalloVozEnVivo();
  TTS.permitirVozEnVivo(!!o.nativo);
  mundo.descargaManual = false;
  mundo.ttsMs = o.ttsMs ?? 600;
  mundo.msPorLetra = o.msPorLetra ?? 30;
  mundo.confirmaMs = o.confirmaMs ?? 120;
  mundo.sonidos = [];
  mundo.descargas = [];
  mundo.pedidas = [];
  Object.assign(N.cfg, { ttfbMs: 700, velocidad: 4, msPorLetra: o.msPorLetra ?? 30, nivel: () => 0.3, falla: () => null, encolarLanza: false }, o.cfgNativo || {});
  N.sonados.length = 0;
  N.llamadas.length = 0;
}

/** Un locutor del turno que anota, en cada aviso, la hora y lo que la cara haría en ese instante. */
function locutor() {
  const r = { ev: [], t0: Date.now() };
  const anota = (que) => r.ev.push({ que, t: Date.now() - r.t0, ...estado(), cara: caraVista() });
  r.anota = anota;
  r.sp = new TTS.StreamSpeaker({ onAudioStart: () => anota('audioStart'), onSuena: () => anota('suena') });
  r.de = (que) => r.ev.find((e) => e.que === que);
  return r;
}

/** Cada cambio de la voz de la mesa, con su hora. */
function grabar() {
  const t0 = Date.now();
  const cambios = [];
  const quitar = voz.escuchar((e) => cambios.push({ t: Date.now() - t0, ...e }));
  return { cambios, quitar, t0 };
}

(async () => {
  for (const nativo of [true, false]) {
    const camino = nativo ? 'nativo en streaming (5.5+)' : 'expo-av';
    console.log(`\n[boca] ${camino}: la cara habla cuando SUENA, no al decidir hablar\n`);
    await limpio({ nativo });
    const niveles = [];
    TTS.setSpeechLevelListener((v) => niveles.push([Date.now(), v]));
    const g = grabar();
    const L = locutor();
    L.sp.push(`Primera frase de la respuesta por ${nativo ? 'el nativo' : 'expo'}. Segunda frase pegada detrás.`);
    L.anota('push');
    L.sp.end();
    await reloj.avanzar(100);
    ok('pidió decirlo y se está bajando: NO habla, prepara (la cara de hablar se ve pensando)', !estado().hablando && estado().preparando && caraVista() === 'THINKING', estado());
    await reloj.avanzar(20_000);
    g.quitar();
    TTS.setSpeechLevelListener(null);
    const audioStart = L.de('audioStart');
    const suena = L.de('suena');
    const primera = (nativo ? N.sonados : mundo.sonidos.map((s) => ({ inicio: s.sonido.sonandoDesde })))[0];
    console.log(`  [medida] onAudioStart a los ${audioStart?.t} ms · el reproductor confirma que suena a los ${suena?.t} ms (${suena && audioStart ? suena.t - audioStart.t : '?'} ms en que antes la boca ya se movía)`);
    ok('onAudioStart (antes de play): todavía NO habla y la cara se ve pensando', audioStart && !audioStart.hablando && audioStart.cara === 'THINKING', audioStart);
    ok('onSuena (el reproductor dice «sonando»): YA habla y la cara es la de hablar', suena && suena.hablando && suena.cara === 'SPEAKING', suena);
    const primerHabla = g.cambios.find((c) => c.hablando);
    ok('`hablando` se enciende en el mismo milisegundo en que el reproductor confirma (ni antes ni después)', primerHabla && primerHabla.t === suena.t && g.t0 + primerHabla.t === primera.inicio, { primerHabla, suena, inicio: primera.inicio - g.t0 });
    const antesDeSonar = niveles.filter(([t]) => t < primera.inicio).map(([, v]) => v);
    ok('la boca (el nivel) no se abre antes del primer sonido', antesDeSonar.every((v) => v === 0), antesDeSonar);
    const apagados = g.cambios.filter((c, i) => i > 0 && g.cambios[i - 1].hablando && !c.hablando);
    ok('entre la primera y la segunda frase NO deja de hablar (un solo encendido y un solo apagado)', g.cambios.filter((c) => c.hablando && !(g.cambios[g.cambios.indexOf(c) - 1] || {}).hablando).length === 1 && apagados.length === 1, g.cambios);
    ok('al terminar: no habla, no prepara, no suena', !estado().hablando && !estado().preparando && !estado().sonando && caraVista() === 'THINKING', estado());
    const fin = (nativo ? N.sonados : mundo.sonidos.map((s) => ({ fin: s.sonido.sonandoDesde + s.sonido.dur })))[1].fin;
    ok('deja de hablar cuando termina el último audio (sin cola de boca)', apagados[0] && g.t0 + apagados[0].t === fin, { apagado: apagados[0], fin: fin - g.t0 });
  }

  console.log('\n[boca] say(): la mesa pone SPEAKING antes de pedir la voz; lo que se ve espera al sonido\n');
  {
    await limpio({ nativo: true });
    const vista = [];
    const anota = (que) => vista.push({ que, hablando: estado().hablando, cara: caraVista() });
    anota('antes de speak (say ya puso SPEAKING y «speaking»)');
    await Promise.all([
      TTS.speak('Una frase que dice la mesa con say.', { onAudioStart: () => anota('audioStart'), onSuena: () => anota('suena'), onEnd: () => anota('fin') }),
      reloj.avanzar(10_000),
    ]);
    const de = (q) => vista.find((v) => v.que.startsWith(q));
    ok('antes de pedir el audio: se ve pensando', de('antes').cara === 'THINKING' && !de('antes').hablando, vista);
    ok('onAudioStart: todavía pensando', de('audioStart').cara === 'THINKING', vista);
    ok('onSuena: habla', de('suena').cara === 'SPEAKING' && de('suena').hablando, vista);
    ok('onEnd (settle): ya no habla', !de('fin').hablando, vista);
  }

  console.log('\n[boca] interrupciones: callar es dejar de hablar EN EL ACTO\n');
  {
    await limpio({ nativo: true, msPorLetra: 60 });
    const L = locutor();
    L.sp.push('Una respuesta larga que ya está sonando por el nativo. Y su segunda parte. ');
    await reloj.avanzar(1500);
    ok('(suena)', estado().hablando && estado().sonando, estado());
    await TTS.stopSpeaking();
    ok('stopSpeaking (la interrumpieron): deja de hablar sin esperar al reproductor', !estado().hablando && !estado().sonando && !estado().preparando, estado());
    await reloj.avanzar(5000);
    ok('… y no vuelve a hablar con un aviso tardío', !estado().hablando, estado());
  }
  {
    await limpio({ nativo: false, msPorLetra: 60 });
    const L = locutor();
    L.sp.push('Otra respuesta larga que suena por expo-av ahora. Y más detrás. ');
    await reloj.avanzar(1500);
    ok('(suena por expo-av)', estado().hablando, estado());
    L.sp.cancel();
    ok('cancel() del locutor: deja de hablar en el acto', !estado().hablando && !estado().preparando, estado());
  }
  {
    await limpio({ nativo: true });
    const L = locutor();
    L.sp.push('Una que se cancela mientras se baja. ');
    await reloj.avanzar(300);
    ok('(bajando: prepara, no habla)', estado().preparando && !estado().hablando, estado());
    L.sp.cancel();
    ok('cancelada antes de sonar: ni prepara ni habla (nunca abrió la boca)', !estado().preparando && !estado().hablando, estado());
  }

  console.log('\n[boca] el cerebro tarda entre frases: la cara vuelve a pensar, no se queda «hablando» callada\n');
  {
    await limpio({ nativo: true });
    const g = grabar();
    const L = locutor();
    L.sp.push('Primera frase corta. ');
    await reloj.avanzar(3000);
    const callada = estado();
    ok('la primera ya sonó y la segunda no llegó: no habla, prepara', !callada.hablando && callada.preparando, { callada, cambios: g.cambios });
    const apagado = g.cambios.find((c, i) => i > 0 && g.cambios[i - 1].hablando && !c.hablando);
    const finPrimera = N.sonados[0].fin - g.t0;
    ok(`deja de hablar ${SONANDO.PAUSA_HABLA_MS} ms después de callarse (el hueco corto)`, apagado && apagado.t === finPrimera + SONANDO.PAUSA_HABLA_MS, { apagado, finPrimera });
    L.sp.push('Y la segunda llega tarde. ');
    L.sp.end();
    await reloj.avanzar(300);
    ok('la segunda todavía se baja (TTFB): sigue sin hablar', !estado().hablando, estado());
    await reloj.avanzar(10_000);
    const encendidos = g.cambios.filter((c, i) => c.hablando && !(g.cambios[i - 1] || {}).hablando).map((c) => c.t);
    ok('habla otra vez justo cuando suena la segunda', encendidos.length === 2 && g.t0 + encendidos[1] === N.sonados[1].inicio, { encendidos, inicio: N.sonados[1].inicio - g.t0 });
    ok('y al final, callada', !estado().hablando && !estado().preparando, estado());
    g.quitar();
  }

  console.log('\n[boca] un audio suelto (canción, oración, un mp3: speakUrl)\n');
  {
    await limpio({ nativo: false, confirmaMs: 400 });
    const vista = [];
    const anota = (que) => vista.push({ que, ...estado(), cara: SONANDO.caraConVoz('SING', estado().hablando) });
    const p = TTS.speakUrl('https://prueba/api/tts?text=' + encodeURIComponent('Una canción de mentira.'), { onStart: () => anota('start'), onAudioStart: () => anota('audioStart'), onSuena: () => anota('suena'), onEnd: () => anota('fin') });
    await Promise.all([p, reloj.avanzar(10_000)]);
    const de = (q) => vista.find((v) => v.que === q);
    ok('pedida (bajando o cargando): la cara de cantar se ve pensando', de('start').cara === 'THINKING' && de('start').preparando && de('audioStart').cara === 'THINKING', vista);
    ok('cuando suena: canta', de('suena').cara === 'SING' && de('suena').hablando, vista);
    ok('al terminar: callada', !de('fin').hablando && !de('fin').preparando, vista);
  }

  console.log(`\n[boca] ${n - fallos}/${n} bien`);
  process.exit(fallos ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
