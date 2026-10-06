// [locutor] EL LOCUTOR POR FRASES DE LA MESA (lib/tts.ts StreamSpeaker, el código real empaquetado con
// construir.cjs) con /api/tts y el reproductor de mentira (shims/nativos.js) y el reloj de mentira.
// Auditoría externa del 6-oct (AURA_MASTER §6):
//
//  VOZ-01 · «Sí.» atascaba el corte (una frase de menos de 6 letras no se cortaba y todo lo de detrás esperaba al
//           final) y un trozo con tres frases encolaba solo la primera.
//  VOZ-03 · cancelar dejaba vivo el audio que se estaba bajando o preparando: sonaba después; `done` esperaba a
//           la red abandonada; la recuperación stream→JSON podía decir dos veces la misma frase.
//  VOZ-05 · «Dr. Gómez» se partía tras «Dr.» (y la voz decía «Dr.» suelto).
//  §7.1   · la traza marcaba «suena» al pedir play, no cuando el reproductor confirma que suena.
//
// SRC=/copia/de/antes/mobile/src sh todas.sh corre lo mismo contra otro código (y falla con el de antes).
'use strict';

const path = require('path');
const reloj = require('./reloj.cjs');
const M = require(process.env.OIDO || path.join(__dirname, 'out/oido.cjs'));
const { TTS } = M;
const mundo = globalThis.__mundo;

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
const textos = () => mundo.sonidos.map((s) => s.texto);

async function limpio(o = {}) {
  await TTS.stopSpeaking();
  await reloj.avanzar(50);
  mundo.descargaManual = !!o.manual;
  mundo.ttsMs = o.ttsMs ?? 100;
  mundo.msPorLetra = o.msPorLetra ?? 20;
  mundo.confirmaMs = o.confirmaMs ?? 0;
  mundo.sonidos = [];
  mundo.descargas = [];
  mundo.pedidas = [];
}

/** Un locutor con lo que pasa anotado. */
function locutor(extra = {}) {
  const r = { frases: [], resuelto: null, eventos: [] };
  const t0 = Date.now();
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
  console.log('[locutor] VOZ-01 · nada se queda atascado detrás de una frase corta\n');

  // «Sí.» + dos frases en tres trozos: antes, cero pedidos de voz hasta end().
  {
    await limpio();
    const L = locutor();
    L.sp.push('Sí. ');
    L.sp.push('Puedo ayudarte con eso. ');
    L.sp.push('Dime qué necesitas.');
    await reloj.vaciar();
    const antes = [...mundo.pedidas];
    ok('«Sí.» / «Puedo ayudarte con eso.» / «Dime qué necesitas.»: la voz se pide ANTES de end()', antes.length >= 2, antes);
    ok('… y sale en orden, sin perder ni repetir palabras', norm(antes.join(' ')) === 'Sí. Puedo ayudarte con eso. Dime qué necesitas.', antes);
    L.sp.end();
    await reloj.avanzar(20_000);
    ok('al terminar suena todo una vez y en orden', norm(textos().join(' ')) === 'Sí. Puedo ayudarte con eso. Dime qué necesitas.', textos());
    ok('`done` terminó y `fin` dice «terminado»', L.resuelto !== null && (await Promise.race([L.sp.fin, Promise.resolve('sin fin')])) === 'terminado');
  }

  // Tres frases en un solo trozo: antes solo la primera, hasta el trozo siguiente o el final.
  {
    await limpio();
    const L = locutor();
    L.sp.push('Primera frase completa. Segunda frase completa. Tercera frase completa.');
    await reloj.vaciar();
    ok('tres frases en un trozo: se piden las tres sin esperar a nada más', mundo.pedidas.length === 3, mundo.pedidas);
    L.sp.end();
    await reloj.avanzar(20_000);
    ok('… y suenan las tres en orden', JSON.stringify(textos()) === JSON.stringify(['Primera frase completa.', 'Segunda frase completa.', 'Tercera frase completa.']), textos());
  }

  // Respuestas de una sola palabra: salen en cuanto llegan, no al cerrar el stream.
  for (const corta of ['No.', 'Ok.', '¡Va!', 'Dale.']) {
    await limpio();
    const L = locutor();
    L.sp.push(corta);
    await reloj.vaciar();
    ok(`«${corta}» sola: la voz se pide sin esperar a end()`, mundo.pedidas.length === 1 && mundo.pedidas[0] === corta, mundo.pedidas);
    L.sp.end();
    await reloj.avanzar(5_000);
    ok(`«${corta}» suena una vez`, JSON.stringify(textos()) === JSON.stringify([corta]), textos());
  }

  // Una corta seguida de otra que YA llegó: van juntas (una petición, no suena entrecortado).
  {
    await limpio();
    const L = locutor();
    L.sp.push('Claro. Te lo busco ahora mismo. ');
    await reloj.vaciar();
    ok('«Claro.» con la siguiente ya llegada: van juntas en un pedido', JSON.stringify(mundo.pedidas) === JSON.stringify(['Claro. Te lo busco ahora mismo.']), mundo.pedidas);
    L.sp.end();
    await reloj.avanzar(5_000);
  }

  // La puntuación partida entre trozos.
  {
    await limpio();
    const L = locutor();
    for (const t of ['Hola', '. Te', ' cuento algo', '?', ' Bien']) L.sp.push(t);
    await reloj.vaciar();
    ok('puntuación partida («Hola» + «. Te» + … + «?»): «Hola.» y «Te cuento algo?» se piden antes de end()', norm(mundo.pedidas.join(' ')) === 'Hola. Te cuento algo?', mundo.pedidas);
    L.sp.end();
    await reloj.avanzar(10_000);
    ok('… y al cerrar sale lo que quedaba sin punto («Bien»)', norm(textos().join(' ')) === 'Hola. Te cuento algo? Bien', textos());
  }

  // Abreviaturas, cifras, siglas: no se parten.
  {
    await limpio();
    const L = locutor();
    L.sp.push('El Dr. Gómez llegó temprano. ');
    L.sp.push('Viven en EE. UU. desde 2010. ');
    L.sp.push('Cuesta 1.500 dólares y pesa 3,5 kilos. ');
    L.sp.push('La Sra. Pérez y el Lic. Ruiz firman hoy.');
    await reloj.vaciar();
    ok('«Dr.», «EE. UU.», «1.500», «3,5», «Sra.», «Lic.»: ninguna frase se parte por dentro', JSON.stringify(mundo.pedidas) === JSON.stringify(['El Dr. Gómez llegó temprano.', 'Viven en EE. UU. desde 2010.', 'Cuesta 1.500 dólares y pesa 3,5 kilos.', 'La Sra. Pérez y el Lic. Ruiz firman hoy.']), mundo.pedidas);
    L.sp.end();
    await reloj.avanzar(20_000);
  }
  {
    await limpio();
    const L = locutor();
    L.sp.push('Te paso con el Dr.');
    await reloj.vaciar();
    ok('«…el Dr.» al final de lo llegado: espera (lo siguiente es un nombre)', mundo.pedidas.length === 0, mundo.pedidas);
    L.sp.push(' Gómez ahora mismo.');
    await reloj.vaciar();
    ok('… y sale entera con el nombre', JSON.stringify(mundo.pedidas) === JSON.stringify(['Te paso con el Dr. Gómez ahora mismo.']), mundo.pedidas);
    L.sp.end();
    await reloj.avanzar(10_000);
  }

  // Lo que el servidor suelta en dos comas de la primera frase (lib/trozos.ts, el mismo contrato): la app no
  // retiene el segundo tramo hasta el punto (antes la coma valía solo para lo primero que cortaba la app).
  {
    await limpio();
    const L = locutor();
    const tramos = ['Te recomiendo empezar ya mismo,', ' revisar la planta con todo el cuidado posible,', ' y después las cuentas del mes.'];
    const pedidosPorTramo = [];
    for (const t of tramos) {
      L.sp.push(t);
      await reloj.vaciar();
      pedidosPorTramo.push(mundo.pedidas.length);
    }
    ok('cada tramo que soltó el servidor se pide en cuanto llega (sin doble espera)', JSON.stringify(pedidosPorTramo) === '[1,2,3]', { pedidosPorTramo, pedidas: mundo.pedidas });
    L.sp.end();
    await reloj.avanzar(20_000);
  }

  // Cierre sin punto.
  {
    await limpio();
    const L = locutor();
    L.sp.push('Claro que sí');
    await reloj.vaciar();
    L.sp.end();
    await reloj.avanzar(5_000);
    ok('cierre sin punto: end() la dice', JSON.stringify(textos()) === JSON.stringify(['Claro que sí']), textos());
  }

  // Lo mismo partido de muchas maneras: siempre las mismas palabras, en orden, una vez.
  {
    const texto = 'Sí. El Dr. Gómez dijo que cuesta 1.500 dólares, más o menos, en EE. UU. y que llega a las 5 p.m. Mañana te aviso. ¡Va! ¿Algo más? No.';
    let azar = 7;
    const rnd = (k) => ((azar = (azar * 1103515245 + 12345) % 2147483648), azar % k);
    let malos = 0;
    let ejemplo = null;
    for (let caso = 0; caso < 25; caso++) {
      await limpio({ ttsMs: 5, msPorLetra: 1 });
      const t = `Caso ${caso + 1}: ${texto}`;
      const L = locutor();
      for (let i = 0; i < t.length; ) {
        const k = 1 + rnd(9);
        L.sp.push(t.slice(i, i + k));
        i += k;
        await reloj.vaciar();
      }
      L.sp.end();
      await reloj.avanzar(30_000);
      if (norm(L.frases.join(' ')) !== norm(t)) {
        malos++;
        ejemplo = ejemplo || L.frases;
      }
    }
    ok('25 maneras de partir el mismo texto: nada se pierde, repite ni desordena', malos === 0, ejemplo);
  }

  console.log('\n[locutor] VOZ-03 · cancelar es cancelar\n');

  // Cancelar mientras se baja: lo bajado después no suena.
  {
    await limpio({ manual: true });
    const L = locutor();
    L.sp.push('Esta frase vieja no debe sonar nunca. ');
    await reloj.avanzar(10);
    const d = mundo.descargas[0];
    ok('(la descarga de la frase quedó en vuelo)', !!d && mundo.descargas.length === 1, mundo.descargas.length);
    L.sp.cancel();
    await reloj.vaciar();
    ok('cancelar: `done` se resuelve en el acto, con la red todavía pendiente', L.resuelto !== null);
    ok('cancelar: `fin` dice «cancelado» (no «terminado»)', (await Promise.race([L.sp.fin, Promise.resolve('sin fin')])) === 'cancelado');
    ok('cancelar aborta la descarga en vuelo', !!d?.abortada);
    d?.soltar();
    await reloj.avanzar(5_000);
    ok('la descarga que llega tarde NO suena', mundo.sonidos.length === 0, textos());
    L.sp.cancel();
    L.sp.push('Y esto tampoco. ');
    L.sp.end();
    await reloj.avanzar(1_000);
    ok('cancelar dos veces y empujar después: nada suena ni explota', mundo.sonidos.length === 0 && mundo.descargas.length === 1);
  }

  // Otra locución (stopSpeaking) mientras se baja: `done` no espera a la red abandonada.
  {
    await limpio({ manual: true });
    const L = locutor();
    L.sp.push('Una respuesta que se baja muy despacio. ');
    L.sp.end();
    await reloj.avanzar(10);
    const d = mundo.descargas[0];
    await TTS.stopSpeaking();
    await reloj.avanzar(10);
    ok('stopSpeaking con la descarga en vuelo: `done` se suelta ya (no al volver la red)', L.resuelto !== null, L.resuelto);
    ok('… y la descarga se aborta', !!d?.abortada);
    d?.soltar();
    await reloj.avanzar(5_000);
    ok('… y lo que llega después no suena', mundo.sonidos.length === 0, textos());
  }

  // Cancelar suelta lo preparado y calla lo suyo que suena (es inmediato).
  {
    await limpio({ ttsMs: 100, msPorLetra: 60 });
    const L = locutor();
    L.sp.push('Primera frase que está sonando ahora mismo. Segunda frase ya preparada detrás. ');
    await reloj.avanzar(400);
    const sonando = mundo.sonidos[0]?.sonido;
    ok('(suena la primera y la segunda está preparada)', mundo.sonidos.length === 1 && mundo.vivos.size === 2, { sonidos: textos(), vivos: mundo.vivos.size });
    L.sp.cancel();
    await reloj.avanzar(50);
    ok('cancelar calla en el acto la frase suya que sonaba', !!sonando?.parado);
    ok('cancelar suelta todos los sonidos (el que sonaba y el preparado)', mundo.vivos.size === 0, mundo.vivos.size);
    await reloj.avanzar(10_000);
    ok('la segunda no llega a sonar', JSON.stringify(textos()) === JSON.stringify(['Primera frase que está sonando ahora mismo.']), textos());
  }

  // Un aviso tardío del sonido viejo no toca el sonido nuevo; cancelar el viejo otra vez tampoco.
  {
    await limpio({ ttsMs: 100, msPorLetra: 60 });
    const A = locutor();
    A.sp.push('Lo que decía antes la mesa, una frase larga. ');
    A.sp.end();
    await reloj.avanzar(300);
    const viejo = mundo.sonidos[0]?.sonido;
    A.sp.cancel();
    await reloj.avanzar(20);
    const B = locutor();
    B.sp.push('Respuesta nueva que suena ahora, también larga. ');
    B.sp.end();
    await reloj.avanzar(300);
    const nuevo = mundo.sonidos.at(-1)?.sonido;
    ok('(el nuevo suena y el viejo se calló al cancelar)', !!nuevo && nuevo !== viejo && !!viejo?.parado, textos());
    // El reproductor del viejo avisa tarde que terminó, y alguien cancela el viejo otra vez.
    viejo?.cb?.({ isLoaded: true, isPlaying: false, positionMillis: 9_999, durationMillis: 9_999, didJustFinish: true });
    A.sp.cancel();
    await reloj.avanzar(20);
    ok('el aviso tardío del viejo y su segundo cancel no tocan al nuevo', !nuevo?.parado && !nuevo?.soltado && B.resuelto === null && TTS.registroVoz.hablando());
    await reloj.avanzar(10_000);
    ok('el nuevo termina entero por su cuenta («terminado»)', B.resuelto !== null && (await B.sp.fin) === 'terminado' && textos().filter((t) => t.startsWith('Respuesta nueva')).length === 1);
  }

  // REEMPLAZAR no es cancelar: la frase que suena termina; lo viejo preparado o en vuelo no revive.
  {
    await limpio({ manual: true, msPorLetra: 60 });
    const L = locutor();
    L.sp.push('Uno dos tres cuatro cinco seis siete. Frase vieja que ya no va. ');
    await reloj.avanzar(10);
    mundo.descargas[0].soltar();
    await reloj.avanzar(50);
    const primera = mundo.sonidos[0]?.sonido;
    const vieja = mundo.descargas[1];
    ok('(suena la primera; la segunda vieja se está bajando)', !!primera && !!vieja && !vieja.soltada, textos());
    L.sp.reemplazar('Uno dos tres cuatro cinco seis siete. Frase corregida nueva.', 'Corrijo:');
    await reloj.avanzar(10);
    ok('reemplazar no corta la frase que suena', !primera?.parado);
    vieja?.soltar();
    await reloj.avanzar(10);
    for (const d of mundo.descargas) if (!d.soltada) d.soltar();
    L.sp.end();
    await reloj.avanzar(20_000);
    ok('lo viejo que llegó tarde no revive; suena lo corregido', JSON.stringify(textos()) === JSON.stringify(['Uno dos tres cuatro cinco seis siete.', 'Frase corregida nueva.']), textos());
    ok('reemplazar termina «terminado», no «cancelado»', (await L.sp.fin) === 'terminado');
  }

  // El stream se rompe con audio en vuelo y la mesa recupera por JSON (DeskScreen: cancel + turno() + say()).
  {
    await limpio({ manual: true });
    const L = locutor();
    L.sp.push('Te cuento lo del viaje. ');
    await reloj.avanzar(10);
    const enVuelo = mundo.descargas[0];
    // El stream lanzó: se cancela el locutor y se pide el MISMO turno por JSON (mismo idTurno).
    L.sp.cancel();
    // Mientras el JSON tarda, llega el audio del locutor cancelado.
    enVuelo?.soltar();
    await reloj.avanzar(600);
    // El JSON trae la respuesta entera y la mesa la dice.
    const dicho = TTS.speak('Te cuento lo del viaje. Ya quedó todo listo.', {});
    await reloj.avanzar(10);
    for (const d of mundo.descargas) if (!d.soltada) d.soltar();
    await reloj.avanzar(20_000);
    await dicho;
    const veces = textos().filter((t) => t === 'Te cuento lo del viaje.').length;
    ok('stream roto → JSON: «Te cuento lo del viaje.» suena UNA vez (no la del locutor cancelado y otra vez la del JSON)', veces === 1, textos());
  }

  console.log('\n[locutor] §7.1 · la traza mide cuando el reproductor confirma que suena\n');
  {
    await limpio({ ttsMs: 100, confirmaMs: 200 });
    let midio = -1;
    const t0 = Date.now();
    const L = locutor({
      onAudioStart: () => {
        L.eventos.push(['audioStart', Date.now() - t0]);
        TTS.cuandoSuene?.(() => (midio = Date.now() - t0));
      },
    });
    L.sp.push('Una frase para medir el comienzo real.');
    L.sp.end();
    await reloj.avanzar(10_000);
    const t = Object.fromEntries(L.eventos);
    ok('onAudioBajado: cuando terminó de bajar (100 ms), no cuando suena', t.bajado === 100, L.eventos);
    ok('onAudioStart: al mandar a sonar (antes de que el reproductor confirme)', t.audioStart === 100, L.eventos);
    ok('onSuena: cuando el reproductor confirma que suena (100 + 200 ms)', t.suena === 300, L.eventos);
    ok('cuandoSuene (la traza de la mesa) mide en ese mismo momento', midio === 300, midio);
  }
  {
    await limpio({ ttsMs: 100, confirmaMs: 150 });
    const t0 = Date.now();
    let start = -1;
    let suena = -1;
    await Promise.all([
      TTS.speak('Otra frase dicha entera para medir.', { onAudioStart: () => (start = Date.now() - t0), onSuena: () => (suena = Date.now() - t0) }),
      reloj.avanzar(10_000),
    ]);
    ok('speak(): onAudioStart al mandar a sonar y onSuena al confirmarlo el reproductor', start === 100 && suena === 250, { start, suena });
  }
  {
    await limpio({ manual: true, confirmaMs: 100 });
    let midio = false;
    const L = locutor({ onAudioStart: () => TTS.cuandoSuene?.(() => (midio = true)) });
    L.sp.push('Se corta antes de sonar.');
    L.sp.end();
    await reloj.avanzar(10);
    mundo.descargas[0].soltar();
    await reloj.avanzar(50);
    await TTS.stopSpeaking();
    await reloj.avanzar(1_000);
    ok('si se calla antes de que el reproductor confirme, la traza no mide nada (nunca sonó)', !midio && typeof TTS.cuandoSuene === 'function');
  }

  console.log(`\n${n - fallos}/${n} del locutor bien`);
  process.exit(fallos ? 1 : 0);
})().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
