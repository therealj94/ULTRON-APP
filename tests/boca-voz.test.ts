/**
 * LA BOCA VA CON LA VOZ (José, 7-oct, Samsung SM-S942B con la APK 5.6.0: «el avatar empieza a hablar, la boca y la cara,
 * ANTES de que salga la voz»).
 *
 * La causa en la mesa del teléfono: la cara de hablar (SPEAKING, SING, PRAY) y `status` «speaking» se ponían al DECIDIR
 * hablar (say, la emoción del turno, onAudioStart, que es antes de play y, por el nativo en streaming, antes del primer
 * byte), y la cara clásica movía la boca sola a los 700 ms sin nivel. Ahora lo que se ve habla con
 * avatar3d/sonando.ts `hablando` (el reproductor confirmó que suena, hasta que la locución termina o la cortan).
 * El arnés con el reproductor de mentira y el código real de tts está en mobile/pruebas/oido/boca.cjs; aquí, lo puro
 * del estado, la conversación en vivo (sesionVoz) y que la mesa y la web estén cableadas a eso.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PAUSA_HABLA_MS, VozSonando, caraConVoz } from '../mobile/src/avatar3d/sonando';
import { abrirSesionVoz, type ConvMin } from '../mobile/src/compa/sesionVoz';

const RAIZ = path.resolve(import.meta.dirname, '..');
const leer = (r: string) => fs.readFileSync(path.join(RAIZ, r), 'utf8');

test('la voz de la mesa: no habla antes del primer «suena»; habla hasta el final o la interrupción', () => {
  let ahora = 0;
  const v = new VozSonando(() => ahora);
  const loc = {};
  const audio = {};
  v.preparar(loc, true);
  assert.equal(v.ahora().hablando, false, 'pidió el audio: no habla');
  assert.equal(caraConVoz('SPEAKING', v.ahora().hablando), 'THINKING', 'mientras se prepara, la cara piensa');
  v.sonar(audio, false, loc); // el primer aviso de expo-av: cargado, todavía sin sonar
  assert.equal(v.ahora().hablando, false, 'cargando: no habla');
  v.sonar(audio, true, loc);
  assert.equal(v.ahora().hablando, true, 'el reproductor dice «sonando»: habla');
  assert.equal(caraConVoz('SPEAKING', v.ahora().hablando), 'SPEAKING');
  ahora += 1000;
  v.sonar(audio, false, loc);
  assert.equal(v.ahora().hablando, true, 'hueco entre frases (< PAUSA_HABLA_MS): sigue hablando, boca cerrada');
  v.terminar(loc);
  assert.equal(v.ahora().hablando, false, 'terminó la locución: deja de hablar en el acto');
  const loc2 = {};
  v.preparar(loc2, true);
  v.sonar(audio, true, loc2);
  v.callar();
  assert.deepEqual(v.ahora(), { sonando: false, preparando: false, hablando: false }, 'interrumpida (stopSpeaking): todo calla en el acto');
});

test('la voz de la mesa: si la frase siguiente tarda más que el hueco, deja de hablar y vuelve a preparar (con su temporizador)', async () => {
  const v = new VozSonando();
  const loc = {};
  const audio = {};
  v.preparar(loc, true);
  v.sonar(audio, true, loc);
  v.sonar(audio, false, loc);
  assert.equal(v.ahora().hablando, true);
  await new Promise((r) => setTimeout(r, PAUSA_HABLA_MS + 60));
  assert.deepEqual(v.ahora(), { sonando: false, preparando: true, hablando: false });
  v.terminar(loc);
});

/** Una conversación en vivo de mentira: el reloj, el intervalo y el volumen los mueve la prueba. */
function llamada(volumen: () => number) {
  let ahora = 0;
  let paso: (() => void) | null = null;
  let ops: any = null;
  const niveles: number[] = [];
  const hablando = { current: false };
  const conv: ConvMin = {
    startSession: (x) => void (ops = x),
    endSession: () => undefined,
    setVolume: () => undefined,
    getOutputVolume: volumen,
    getInputVolume: () => 0,
    getOutputByteFrequencyData: () => new Uint8Array(4),
  };
  const cerrar = abrirSesionVoz({
    gen: 1,
    conv: () => conv,
    permiso: async () => ({ token: 't', pase: 'p' }),
    cbs: () => ({ onEstado: () => undefined, onMensaje: () => undefined, onInterrupcion: () => undefined, onNiveles: (s) => void niveles.push(s) }),
    silenciada: () => false,
    abierta: { current: false },
    hablando,
    reloj: () => ahora,
    intervalo: (f) => ((paso = f), 1),
    limpiarIntervalo: () => undefined,
    boca: { seguir: (s) => s, cortar: () => undefined },
    // La envolvente de respaldo: si sale, la boca se mueve SIN volumen real.
    envolventeLibre: () => () => 0.5,
    senal: { quiereForma: () => false, espectro: () => undefined, alineacion: () => undefined },
    miga: () => undefined,
    pasoMs: 33,
    sinVolumenMs: 600,
  });
  const correr = (ms: number) => {
    for (let t = 0; t < ms; t += 33) {
      ahora += 33;
      paso?.();
    }
  };
  return { niveles, hablando, correr, cerrar, ops: () => ops, listo: () => !!paso };
}
const tic = () => new Promise((r) => setImmediate(r));

test('conversación en vivo: con volumen real, el «speaking» del SDK sin sonido NO mueve la boca (antes, a los 600 ms, sí)', async () => {
  let vol = 0;
  const l = llamada(() => vol);
  await tic();
  assert.ok(l.listo(), 'el reloj de la boca arrancó');
  l.hablando.current = true;
  vol = 0.3; // el agente habla: volumen de verdad
  l.correr(300);
  assert.ok(l.niveles.at(-1)! > 0.3, 'con voz, la boca abre con el volumen');
  vol = 0; // el SDK sigue en «speaking» pero no suena nada (antes de la primera sílaba de la frase siguiente, una pausa)
  l.niveles.length = 0;
  l.correr(2000);
  assert.ok(l.niveles.every((n) => n === 0), `sin sonido la boca queda cerrada: ${JSON.stringify(l.niveles.slice(0, 5))}`);
  l.cerrar();
});

test('conversación en vivo: un teléfono que NUNCA da el volumen conserva la envolvente de respaldo', async () => {
  const l = llamada(() => 0);
  await tic();
  l.hablando.current = true;
  l.correr(2000);
  assert.ok(l.niveles.some((n) => n === 0.5), 'sin volumen nunca, la boca sigue la envolvente mientras el agente habla');
  l.hablando.current = false;
  l.niveles.length = 0;
  l.correr(200);
  assert.ok(l.niveles.every((n) => n === 0), 'deja de hablar: cerrada');
  l.cerrar();
});

test('la mesa del teléfono dibuja la cara con la voz REAL, no con la cara pedida', () => {
  const mesa = leer('mobile/src/screens/DeskScreen.tsx');
  assert.match(mesa, /const hablaVoz = audioMesa\.hablando \|\| \(conversando && estadoConv === 'hablando'\);/);
  assert.match(mesa, /const caraVista = caraConVoz\(face, hablaVoz\);/);
  assert.equal((mesa.match(/^\s+face=\{face\}$/gm) || []).length, 0, 'ninguna cara recibe la cara pedida tal cual');
  assert.ok((mesa.match(/^\s+face=\{caraVista\}$/gm) || []).length >= 6, 'orbe, anillos, clásica, fotos y cuerpo: la cara vista');
  assert.match(mesa, /hablando=\{hablaVoz\}/, 'el orbe habla con la voz real');
  assert.doesNotMatch(mesa, /hablando=\{status === 'speaking'\}/);
  // La cara clásica no inventa boca con una fuente de nivel (su silencio es boca cerrada).
  const clasica = leer('mobile/src/components/UltronFace.tsx');
  assert.match(clasica, /if \(!MOUTH_LOOP\.has\(face\) \|\| conFuente\) return;/);
  // El orbe forma las palabras solo mientras suena.
  assert.match(leer('mobile/src/components/OrbeAura.tsx'), /if \(hablando && frase\?\.texto\) enviar\(\{ tipo: 'decir'/);
  // La compañera mueve la boca con lo que suena, no con lo que la mesa decidió.
  assert.match(leer('mobile/src/compa/Companera.tsx'), /ecoVisible\(e, vozSonando\.ahora\(\)\)/);
});

test('la mesa web: cantar y orar piensan hasta que suena (d.inicio), no ponen SING/PRAY antes', () => {
  const app = leer('src/App.tsx');
  const cantar = app.slice(app.indexOf("case 'cantar': {"), app.indexOf("case 'orar': {"));
  const orar = app.slice(app.indexOf("case 'orar': {"), app.indexOf("case 'chiste':"));
  for (const [nombre, tramo, cara] of [['cantar', cantar, 'SING'], ['orar', orar, 'PRAY']] as const) {
    const antes = tramo.slice(0, tramo.indexOf('.inicio.then'));
    assert.doesNotMatch(antes, new RegExp(`setFace\\('${cara}'\\)`), `${nombre}: ${cara} antes de que suene`);
    assert.match(antes, /setFace\('THINKING'\)/, `${nombre}: piensa mientras se prepara`);
    assert.match(tramo, new RegExp(`\\.inicio\\.then\\(\\(\\) => hablando\\.current === d && setFace\\('${cara}'\\)\\)`), `${nombre}: ${cara} al sonar`);
  }
  // La sala: el ánimo «canto» mueve la boca solo con voz que suena.
  assert.match(leer('src/11-sala/sala.ts'), /habla: habla \|\| \(animo === 'canto' && conAudio\),/);
});
