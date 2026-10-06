// [vozvivo] LA VOZ EN STREAMING (5.5, docs/adr/ADR-voz-en-streaming.md) con el código REAL de la mesa (lib/tts.ts
// speak y StreamSpeaker, lib/sonidoVivo.ts, lib/vozNativa.ts, empaquetados con construir.cjs) y el reproductor nativo
// simulado (vozNativaFalsa.cjs: las mismas reglas que Reproductor.kt) con el reloj de mentira:
//
//  · qué camino toma cada locución (sin permiso, lo privado, el canto y el relleno: el de siempre);
//  · cuánto antes empieza a sonar que bajando la frase entera; la cola SIN HUECO entre frases;
//  · el contrato de StreamSpeaker intacto: cancel (inmediato), reemplazar, done/fin, onSuena/cuandoSuene,
//    onAudioBajado, registroVoz; stopSpeaking calla al nativo;
//  · el respaldo: si el nativo falla ANTES de sonar, esa frase suena por expo-av (no se pierde, no se pisa) y el fallo
//    del módulo (o dos seguidos) apaga el camino nuevo en la sesión;
//  · la boca: el volumen real que manda el nativo → el nivel de la cara; la posición → lo que alcanzó a oír.
//
//   cd mobile/pruebas/oido && node construir.cjs && node vozvivo.cjs
'use strict';

const path = require('path');
const reloj = require('./reloj.cjs');
const falsa = require('./vozNativaFalsa.cjs');

const mundo = (globalThis.__mundo = globalThis.__mundo || {});
const N = falsa.crear();
mundo.vozNativa = N.modulo;
const M = require(process.env.OIDO || path.join(__dirname, 'out/oido.cjs'));
const { TTS, VOZNATIVA } = M;

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
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
/** Lo que sonó por expo-av (el camino de siempre) y por el nativo. */
const porArchivo = () => mundo.sonidos.map((s) => s.texto);
const porVivo = () => N.sonados.map((s) => s.texto);
const encolados = () => N.llamadas.filter((l) => l[0] === 'encolar').map((l) => l[2]);

async function limpio(o = {}) {
  await TTS.stopSpeaking();
  await reloj.avanzar(50);
  TTS._olvidarFalloVozEnVivo();
  TTS.permitirVozEnVivo(o.permitir !== false);
  mundo.descargaManual = false;
  mundo.ttsMs = o.ttsMs ?? 100;
  mundo.msPorLetra = o.msPorLetra ?? 20;
  mundo.confirmaMs = 0;
  mundo.sonidos = [];
  mundo.descargas = [];
  mundo.pedidas = [];
  Object.assign(N.cfg, { ttfbMs: 250, velocidad: 4, msPorLetra: o.msPorLetra ?? 20, nivel: () => 0.1, falla: () => null, encolarLanza: false }, o.nativo || {});
  N.sonados.length = 0;
  N.llamadas.length = 0;
}

function locutor(extra = {}) {
  const r = { frases: [], resuelto: null, eventos: [] };
  const t0 = Date.now();
  r.t0 = t0;
  r.sp = new TTS.StreamSpeaker({
    onSentence: (s) => r.frases.push(s),
    onAudioStart: () => r.eventos.push(['audioStart', Date.now() - t0]),
    onSuena: () => r.eventos.push(['suena', Date.now() - t0]),
    onAudioBajado: () => r.eventos.push(['bajado', Date.now() - t0]),
    ...extra,
  });
  void r.sp.done.then(() => (r.resuelto = Date.now() - t0));
  return r;
}

(async () => {
  console.log('[vozvivo] qué camino toma la voz\n');
  {
    await limpio({ permitir: false });
    const L = locutor();
    L.sp.push('Sin permiso todavía, por el camino de siempre.');
    L.sp.end();
    await reloj.avanzar(10_000);
    ok('sin permiso (guardiaVoz todavía no leyó lo guardado, o lo apagaron): el camino de siempre, nada al nativo', encolados().length === 0 && porArchivo().length === 1, { encolados: encolados(), archivo: porArchivo() });
  }
  {
    await limpio();
    const L = locutor();
    L.sp.push('Con permiso y el módulo, por el nativo.');
    L.sp.end();
    await reloj.avanzar(10_000);
    ok('con permiso y el módulo: la frase va al nativo y NO se baja entera', encolados().length === 1 && mundo.pedidas.length === 0 && porVivo().length === 1, { encolados: encolados(), pedidas: mundo.pedidas });
    const enc = N.llamadas.find((l) => l[0] === 'encolar');
    ok('se encola con `esperar` (baja ya, suena cuando la mesa la suelta) y el prebúfer de 150 ms', enc[3].esperar === true && enc[3].prebufferMs === 150, enc[3]);
    ok('con las cabeceras de sesión y pidiendo PCM', enc[4].Accept === 'audio/pcm', enc[4]);
    ok('`fin` dice «terminado»', (await L.sp.fin) === 'terminado');
  }
  {
    await limpio();
    await Promise.all([TTS.speak('Lo que dice un chat de la persona.', { privado: true }), reloj.avanzar(10_000)]);
    await Promise.all([TTS.speak('Una letra cantada por la mesa.', { performance: 'sing' }), reloj.avanzar(10_000)]);
    const corte = new Promise(() => {});
    await Promise.all([TTS.speak('Déjame ver un momento.', { hastaQue: corte }), reloj.avanzar(10_000)]);
    // Lo privado va por POST (XMLHttpRequest, que este arnés no tiene): basta con que no vaya al nativo.
    ok('lo privado, el canto y el relleno (`hastaQue`): el camino de siempre, nada al nativo', encolados().length === 0 && JSON.stringify(porArchivo()) === JSON.stringify(['Una letra cantada por la mesa.', 'Déjame ver un momento.']), { encolados: encolados(), archivo: porArchivo() });
  }
  {
    await limpio();
    // Precalentada (los saludos, «un momento»): ya está en el teléfono, suena de ahí sin pedir nada.
    await Promise.all([TTS.prefetchPhrases(['Hola, ¿en qué te ayudo?']), reloj.avanzar(1_000)]);
    const antes = mundo.pedidas.length;
    await Promise.all([TTS.speak('Hola, ¿en qué te ayudo?'), reloj.avanzar(5_000)]);
    ok('una frase ya bajada (precalentada) suena de la caché, sin ir al nativo', encolados().length === 0 && mundo.pedidas.length === antes && porArchivo().length === 1, { encolados: encolados(), archivo: porArchivo() });
  }

  console.log('\n[vozvivo] cuánto antes suena y la cola sin hueco\n');
  {
    const frase = 'Una respuesta de un poco más de un segundo para medir.';
    const dur = frase.length * 20;
    // El camino de siempre espera la síntesis ENTERA y la descarga: lo mismo que tarda el nativo en bajarla toda.
    await limpio({ permitir: false, ttsMs: 250 + dur / 4 });
    const A = locutor();
    A.sp.push(frase);
    A.sp.end();
    await reloj.avanzar(10_000);
    const archivo = Object.fromEntries(A.eventos).suena;
    // Otra frase del mismo largo: la de arriba ya quedó en la caché de archivos y sonaría de ahí.
    await limpio();
    const B = locutor();
    B.sp.push(frase.replace('medir', 'notar'));
    B.sp.end();
    await reloj.avanzar(10_000);
    const vivo = Object.fromEntries(B.eventos).suena;
    console.log(`  [medida] onSuena: bajando entera ${archivo} ms · en streaming ${vivo} ms (${archivo - vivo} ms antes)`);
    ok('en streaming suena con el primer prebúfer (TTFB + 150 ms de voz), no al bajar toda la frase', vivo > 0 && vivo < archivo && vivo <= 300, { archivo, vivo });
  }
  {
    await limpio();
    const L = locutor();
    L.sp.push('Primera frase de la cola sin hueco. Segunda frase que va pegada. Tercera y última frase.');
    L.sp.end();
    await reloj.avanzar(20_000);
    const s = N.sonados;
    const huecos = s.slice(1).map((x, i) => x.inicio - s[i].fin);
    ok('tres frases por el nativo, en orden', JSON.stringify(porVivo()) === JSON.stringify(['Primera frase de la cola sin hueco.', 'Segunda frase que va pegada.', 'Tercera y última frase.']), porVivo());
    ok('SIN HUECO: cada frase empieza en el mismo milisegundo en que termina la anterior', huecos.length === 2 && huecos.every((h) => h === 0), huecos);
    ok('la siguiente se suelta (encadena) mientras suena la anterior, no al terminar', N.llamadas.filter((l) => l[0] === 'soltar').length === 3, N.llamadas.filter((l) => l[0] === 'soltar'));
    ok('onSentence en orden, una vez cada una', norm(L.frases.join(' ')) === norm(porVivo().join(' ')), L.frases);
    ok('`done` resuelto y «terminado»', L.resuelto !== null && (await L.sp.fin) === 'terminado');
  }
  {
    await limpio();
    await Promise.all([TTS.speak('Una frase de speak. Y otra pegada detrás.'), reloj.avanzar(20_000)]);
    const s = N.sonados;
    ok('speak(): también encadena sin hueco', s.length === 2 && s[1].inicio === s[0].fin, s);
  }

  console.log('\n[vozvivo] el contrato de StreamSpeaker\n');
  {
    await limpio();
    let midio = -1;
    const L = locutor({
      onAudioStart: () => {
        L.eventos.push(['audioStart', Date.now() - L.t0]);
        TTS.cuandoSuene(() => (midio = Date.now() - L.t0));
      },
    });
    L.sp.push('Una frase para medir el comienzo real por el nativo.');
    L.sp.end();
    await reloj.avanzar(10_000);
    const t = Object.fromEntries(L.eventos);
    const inicio = N.sonados[0].inicio - L.t0;
    ok('onAudioBajado: al juntar el prebúfer («listo»), antes de sonar', t.bajado > 0 && t.bajado <= inicio, L.eventos);
    ok('onSuena y cuandoSuene: cuando la pista avanzó (el «sonando» del nativo), no al pedir play', t.suena === inicio && midio === inicio && t.audioStart < t.suena, { eventos: L.eventos, inicio, midio });
  }
  {
    await limpio({ msPorLetra: 60 });
    const L = locutor();
    L.sp.push('Primera frase que suena ahora mismo por el nativo. Segunda frase preparada detrás. ');
    await reloj.avanzar(600);
    ok('(suena la primera por el nativo)', N.sonandoAhora()?.texto === 'Primera frase que suena ahora mismo por el nativo.', porVivo());
    L.sp.cancel();
    await reloj.vaciar();
    ok('cancel(): `done` en el acto y «cancelado»', L.resuelto !== null && (await L.sp.fin) === 'cancelado');
    ok('cancel(): calla la que suena en el nativo YA (cortada)', N.sonados[0].cortada === true && !N.sonandoAhora(), N.sonados);
    const cancelados = N.llamadas.filter((l) => l[0] === 'cancelar').length;
    ok('cancel(): suelta también la preparada (cancelar en el nativo para las dos)', cancelados >= 2, N.llamadas);
    await reloj.avanzar(10_000);
    ok('nada más suena después', porVivo().length === 1 && porArchivo().length === 0, { vivo: porVivo(), archivo: porArchivo() });
    ok('registroVoz: ya no habla', !TTS.registroVoz.hablando());
  }
  {
    await limpio({ msPorLetra: 60 });
    const L = locutor();
    L.sp.push('Una respuesta larga que ya está sonando ahora. Y su segunda parte. ');
    await reloj.avanzar(600);
    await TTS.stopSpeaking();
    await reloj.vaciar();
    ok('stopSpeaking: parar() al nativo, el locutor se suelta ya', N.llamadas.some((l) => l[0] === 'parar') && L.resuelto !== null);
    await reloj.avanzar(10_000);
    ok('… y nada más suena', porVivo().length === 1 && N.sonados[0].cortada === true, N.sonados);
  }
  {
    await limpio({ msPorLetra: 60 });
    const L = locutor();
    L.sp.push('Uno dos tres cuatro cinco seis siete. Frase vieja que ya no va. ');
    await reloj.avanzar(700);
    const primera = N.sonandoAhora();
    ok('(suena la primera; la vieja está encolada detrás)', primera?.texto === 'Uno dos tres cuatro cinco seis siete.' && encolados().includes('Frase vieja que ya no va.'), encolados());
    L.sp.reemplazar('Uno dos tres cuatro cinco seis siete. Frase corregida nueva.', 'Corrijo:');
    await reloj.vaciar();
    ok('reemplazar: la que suena NO se corta', N.sonandoAhora() === primera);
    L.sp.end();
    await reloj.avanzar(20_000);
    ok('reemplazar: la vieja (ya encadenada en el nativo) no suena; suena lo corregido', JSON.stringify(porVivo()) === JSON.stringify(['Uno dos tres cuatro cinco seis siete.', 'Frase corregida nueva.']), porVivo());
    ok('reemplazar termina «terminado»', (await L.sp.fin) === 'terminado');
  }

  console.log('\n[vozvivo] la boca y lo que alcanzó a oír\n');
  {
    await limpio({ msPorLetra: 60, nativo: { nivel: (_t, ms) => (Math.floor(ms / 200) % 2 === 0 ? 0.1 : 0) } });
    const niveles = [];
    TTS.setSpeechLevelListener((v) => niveles.push([Date.now(), v]));
    const L = locutor();
    L.sp.push('Una frase con pausas de verdad para mover la boca.');
    L.sp.end();
    await reloj.avanzar(1_500);
    const frac = TTS.fraccionSonando();
    await reloj.avanzar(10_000);
    TTS.setSpeechLevelListener(null);
    const s = N.sonados[0];
    const durante = niveles.filter(([t]) => t > s.inicio && t < s.fin).map(([, v]) => v);
    const max = Math.max(...durante);
    const esperado = VOZNATIVA.nivelDeRms(0.1);
    ok('la boca sale del volumen REAL del nativo: abre hasta nivelDeRms(0,1) cuando suena', Math.abs(max - esperado) < 0.05, { max, esperado });
    ok('… y se cierra en las pausas de verdad (volumen 0)', durante.some((v) => v < 0.05), durante.slice(0, 20));
    ok('al terminar, la boca queda cerrada', niveles.at(-1)[1] === 0, niveles.at(-1));
    ok('fraccionSonando: por la posición que mandó el nativo (y la duración bajada)', typeof frac === 'number' && frac > 0.05 && frac < 0.6, frac);
  }
  {
    await limpio({ msPorLetra: 60 });
    TTS.registroVoz.nuevoTurno();
    const L = locutor();
    L.sp.push('Alfa beta gama delta épsilon zeta eta theta iota kappa.');
    L.sp.end();
    await reloj.avanzar(250 + 40 + 1_500);
    const oido = TTS.registroVoz.cortar(TTS.fraccionSonando());
    L.sp.cancel();
    ok('interrumpir: lo que alcanzó a oír sale de la posición REAL del nativo (un trozo, no toda la frase)', oido.endsWith('…') && oido.length > 5 && oido.length < 50, oido);
  }

  console.log('\n[vozvivo] la guardia contra cierres (lib/guardiaVoz.ts)\n');
  {
    await limpio();
    let veces = 0;
    TTS.alPrimeraVozEnVivo(async () => {
      veces++;
      return true;
    });
    await Promise.all([TTS.speak('Primera con la guardia anotada. Y la segunda detrás.'), reloj.avanzar(10_000)]);
    ok('«arrancando» se anota UNA vez, antes de la primera frase por el nativo; después suena por el nativo', veces === 1 && porVivo().length === 2, { veces, vivo: porVivo() });
    await limpio();
    TTS.alPrimeraVozEnVivo(async () => false);
    await Promise.all([TTS.speak('Sin la marca en el disco no se arriesga.'), reloj.avanzar(10_000)]);
    ok('si la marca no quedó en el disco: esa frase por expo-av y la sesión por el camino de siempre', encolados().length === 0 && porArchivo().length === 1 && /guardia/.test(String(TTS.estadoVozEnVivo().fallo)), { archivo: porArchivo(), estado: TTS.estadoVozEnVivo() });
    TTS.alPrimeraVozEnVivo(null);
  }

  console.log('\n[vozvivo] el respaldo: si el nativo falla antes de sonar, la frase no se pierde\n');
  {
    await limpio({ nativo: { falla: (t) => (t.startsWith('Primera') ? { codigo: 'red', motivo: 'se cayó la red' } : null) } });
    const avisos = [];
    const quitar = TTS.escucharVozEnVivo({ alFallar: (f, apagada) => avisos.push([f.codigo, apagada]) });
    const L = locutor();
    L.sp.push('Primera frase que el nativo no puede bajar. Segunda frase que sí suena por el nativo. ');
    L.sp.end();
    await reloj.avanzar(20_000);
    quitar();
    ok('la frase que falló suena por expo-av (el camino de siempre), entera', JSON.stringify(porArchivo()) === JSON.stringify(['Primera frase que el nativo no puede bajar.']), porArchivo());
    ok('la siguiente sigue por el nativo (una caída de red no apaga el camino nuevo)', JSON.stringify(porVivo()) === JSON.stringify(['Segunda frase que sí suena por el nativo.']), porVivo());
    const fin1 = mundo.sonidos[0].en + mundo.sonidos[0].sonido.dur;
    ok('sin pisarse: la segunda empieza cuando terminó la del respaldo', N.sonados[0].inicio >= fin1, { fin1, inicio2: N.sonados[0].inicio });
    ok('el fallo se avisa y NO apaga la sesión', avisos.length === 1 && avisos[0][0] === 'red' && avisos[0][1] === null && TTS.estadoVozEnVivo().fallo === null, avisos);
    ok('`done` «terminado» y las dos frases dichas en orden', (await L.sp.fin) === 'terminado' && norm(L.frases.join(' ')) === 'Primera frase que el nativo no puede bajar. Segunda frase que sí suena por el nativo.', L.frases);
  }
  {
    await limpio({ nativo: { falla: () => ({ codigo: 'red', motivo: 'sin red' }) } });
    const L = locutor();
    L.sp.push('Una frase que falla. Otra que también falla. Y la tercera ya va directa. ');
    L.sp.end();
    await reloj.avanzar(30_000);
    ok('dos fallos seguidos antes de sonar: el camino nuevo se apaga en la sesión', TTS.estadoVozEnVivo().fallo !== null, TTS.estadoVozEnVivo());
    ok('… las tres frases sonaron igual (por el camino de siempre), en orden', JSON.stringify(porArchivo()) === JSON.stringify(['Una frase que falla.', 'Otra que también falla.', 'Y la tercera ya va directa.']), porArchivo());
    const antes = encolados().length;
    await Promise.all([TTS.speak('Lo siguiente ya ni se intenta por el nativo.'), reloj.avanzar(10_000)]);
    ok('… y lo siguiente ya no se intenta por el nativo (hasta reabrir la app)', encolados().length === antes && porArchivo().at(-1) === 'Lo siguiente ya ni se intenta por el nativo.', { antes, ahora: encolados().length });
  }
  {
    await limpio({ nativo: { falla: () => ({ codigo: 'pista', motivo: 'no se pudo abrir la salida de audio' }) } });
    const avisos = [];
    const quitar = TTS.escucharVozEnVivo({ alFallar: (f, apagada) => avisos.push([f.codigo, apagada]) });
    await Promise.all([TTS.speak('El módulo truena al abrir la pista.'), reloj.avanzar(10_000)]);
    quitar();
    ok('el módulo truena (la pista no abre): esa frase por expo-av y el camino nuevo apagado YA, con el motivo', porArchivo().length === 1 && avisos.length === 1 && /pista/.test(String(avisos[0][1])), { avisos, archivo: porArchivo() });
  }
  {
    await limpio({ nativo: { encolarLanza: true } });
    await Promise.all([TTS.speak('El puente con el nativo lanza al encolar.'), reloj.avanzar(10_000)]);
    ok('el puente lanza al encolar: la frase suena por expo-av y el camino nuevo se apaga', porArchivo().length === 1 && /puente/.test(String(TTS.estadoVozEnVivo().fallo)), { archivo: porArchivo(), estado: TTS.estadoVozEnVivo() });
  }
  {
    await limpio({ nativo: { falla: (t) => (t.startsWith('Esta') ? { codigo: 'http', status: 404, motivo: 'el servidor contestó 404' } : null) } });
    await Promise.all([TTS.speak('Esta va a un servidor viejo sin la ruta.'), reloj.avanzar(10_000)]);
    ok('un servidor viejo (404 en /api/tts/pcm): la frase por expo-av y el camino nuevo apagado', porArchivo().length === 1 && /404/.test(String(TTS.estadoVozEnVivo().fallo)), TTS.estadoVozEnVivo());
  }

  console.log(`\n${n - fallos}/${n} de la voz en streaming bien`);
  process.exit(fallos ? 1 : 0);
})().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
