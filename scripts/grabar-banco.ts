#!/usr/bin/env -S npx tsx
/**
 * Graba los clips HABLADOS de AU-RA con su voz de Voicebox (perfil «AU-RA · Kokoro Dora») en
 * public/voz/<id>.mp3, y en mobile/assets/voice/<id>.mp3 si el clip va empaquetado en el APK (ya
 * estaba ahí, o está en EN_EL_APK). Después de grabar uno nuevo del APK, `npm run voice-bank` en
 * mobile/ lo registra en src/lib/voiceBank.ts.
 *
 *   VOICEBOX_URL=https://… VOICEBOX_CLAVE=… npx tsx scripts/grabar-banco.ts [ids…] [--force] [--oir]
 *
 * Sin ids graba todos. No sobreescribe salvo --force. --oir lo transcribe de vuelta con el Whisper
 * de Voicebox para comprobar que dice lo que tiene que decir. El perfil sale de VOICEBOX_PERFIL_AURA
 * (vacío = el de server/voz.ts). La llave viene del entorno; nunca se guarda en el repo.
 *
 * Voicebox devuelve WAV y los clips se sirven como MP3 (`/voz/<id>.mp3`): se codifican aquí con el
 * mismo codificador en JS que usan las notas de voz (lib/mp3.ts), sin ffmpeg.
 *
 * Lo que NO se graba aquí:
 *  - Las canciones (repertorio de lib/capacidades.ts): Kokoro no canta. Se quedan las grabaciones
 *    (las nuevas salen del estudio, scripts/estudio).
 *  - Las risas y exclamaciones sin palabras (NO_HABLADOS y public/voz/expresiones): Kokoro las lee
 *    como sílabas sueltas. Las expresiones también salen del estudio.
 */
import fs from 'node:fs';
import path from 'node:path';
import { hablar, vozDe, ORACION_DEL_DIA } from '../server/voz';
import { wavAMp3, duracionWav } from '../lib/mp3';
import { CANCIONES } from '../lib/capacidades';

/**
 * id → lo que dice el clip, palabra por palabra. Son los guiones con los que se grabaron (sin las
 * etiquetas de la voz anterior); los chistes y el «puedo» no estaban escritos en el repo y se
 * sacaron transcribiendo las grabaciones viejas.
 */
export const GUIONES: Record<string, string> = {
  aqui: 'Aquí estoy.',
  listo: 'Listo.',
  listos: 'Ahora sí. Estamos listos.',
  entendido: 'Entendido.',
  vale: 'Vale, jefe.',
  hola: 'Hola. Qué bueno verte.',
  gracias: 'Gracias. De verdad.',
  yaya: 'Ya, ya. Te vi.',
  risa2: 'Esa estuvo buena.',
  mmm: 'Mmm... déjame ver.',
  mmm2: 'Mmm... déjame pensarlo un segundo.',
  uy2: 'Uy. Eso no me lo esperaba.',
  cansado: 'Va. Una cosa a la vez.',
  carino: 'Tranquilo. Aquí estoy contigo.',
  orgullo: 'Eso. Así se hace.',
  sorpresa: '¿En serio? Contame más.',
  triste: 'Lo siento. De verdad lo siento.',
  molesto: 'Ya. Basta. Hablemos en serio.',
  despertar: 'Mmm... ya, ya desperté. ¿Qué necesitás?',
  calenta: 'Espera. Estamos calentando el motor.',
  dias: 'Buenos días, José. ¿Qué tal estás? Arrancamos. Dime cómo te ayudo.',
  tardes: 'Buenas tardes, José. ¿Qué tal? Aquí estoy. ¿Por dónde empezamos?',
  noches: 'Buenas noches, José. ¿Qué tal estás? Si vamos a trabajar, arranco con vos. ¿Qué hacemos?',
  puedo:
    'Puedo hablarte, escucharte, cantar, mirar con la cámara, leer la web, darte oro y dólar, guardar lo que me dictes y cambiar de modo. Lo que no sepa hoy lo voy a aprender. Si quieres el discurso largo, decime quién eres de verdad.',
  chiste1: 'José, ¿por qué el oro no usa WhatsApp? Porque ya está en visto... en la bóveda. Perdón, ese era barato.',
  chiste2: 'Un lempira entra a un bar y el dólar le dice: te cambio. El lempira responde: hoy no, hoy cotizo.',
  chiste3: 'Medardo pregunta cuánto vale un gramo. Yo le digo: depende. Si lo pesa José, vale un imperio. Si lo pesa el banco, vale una comisión.',
  chiste4: '¿Cuál es el plan de pensión de un token? Que no se duerma el nodo. Bueno, ese me lo debo.',
  chiste5: 'Le pedí a Kanye un consejo de negocios. Me dijo: «Runaway». Yo entendí: «corre hacia la bóveda».',
  // Su guion vive en server/voz.ts para no duplicarlo; hablar() le quita las etiquetas.
  oracion: ORACION_DEL_DIA,
  // Bienvenida y saludo por nombre (los de la junta en lib/acceso.ts)
  bienvenido: 'Bienvenido a AU-RA. ¿En qué te ayudo?',
  vertejose: 'Qué bueno verte, José.',
  vertemedardo: 'Qué bueno verte, Medardo.',
  vertecarlos: 'Qué bueno verte, Carlos.',
  vertemayra: 'Qué bueno verte, Mayra.',
  holadenuevo: 'Hola de nuevo.',
  mealegra: 'Me alegra verte.',
  // Respuestas de todos los días: si la respuesta del cerebro es exactamente una de estas, suena el clip
  unmomento: 'Un momento.',
  dameunsegundo: 'Dame un segundo, lo busco.',
  claroquesi: 'Claro que sí.',
  congusto: 'Con gusto.',
  perfecto: 'Perfecto.',
  yaesta: 'Ya está.',
  aquilotenes: 'Aquí lo tenés.',
  noentendi: 'No te entendí bien, ¿me lo repetís?',
  sinconexion: 'Estoy sin conexión ahora mismo.',
  denada: 'De nada.',
  cuandoquieras: 'Cuando quieras.',
  hastaluego: 'Hasta luego.',
  quedescanses: 'Que descanses.',
};

/**
 * Los que van en el APK aunque todavía no estén en mobile/assets/voice. Tienen que ser los mismos
 * que `bundle: true` en mobile/scripts/build-voice-bank.mjs.
 */
export const EN_EL_APK = ['bienvenido', 'vertejose', 'vertemedardo', 'holadenuevo', 'unmomento', 'sinconexion', 'hastaluego', 'denada'];

/** Risas y exclamaciones sin palabras: se quedan como están. */
export const NO_HABLADOS = ['je', 'risa1', 'uy'];

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PUBLICO = path.join(RAIZ, 'public', 'voz');
const MOVIL = path.join(RAIZ, 'mobile', 'assets', 'voice');

async function oir(audio: Buffer): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/mpeg' }), 'clip.mp3');
  form.append('language', 'es');
  form.append('model', 'turbo');
  const url = String(process.env.VOICEBOX_URL || '').replace(/\/+$/, '');
  const r = await fetch(`${url}/transcribe`, {
    method: 'POST',
    headers: { 'X-Voz-Clave': String(process.env.VOICEBOX_CLAVE || '') },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) return `(no se pudo oír: ${r.status})`;
  const j: any = await r.json().catch(() => ({}));
  return String(j.text || '').trim();
}

async function main() {
  if (!process.env.VOICEBOX_URL || !process.env.VOICEBOX_CLAVE) {
    console.error('Faltan VOICEBOX_URL y VOICEBOX_CLAVE en el entorno.');
    process.exit(1);
  }
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const conOido = args.includes('--oir');
  const pedidos = args.filter((a) => !a.startsWith('--'));
  const ids = pedidos.length ? pedidos : Object.keys(GUIONES);
  const canciones = new Set<string>(CANCIONES.map((c) => c.id));
  console.log(`perfil ${vozDe('ultron')} · ${ids.length} clip(s)`);

  let fallos = 0;
  for (const id of ids) {
    if (canciones.has(id)) {
      console.warn(`- ${id}: es una canción; Kokoro no canta. Se queda la grabación.`);
      continue;
    }
    if (NO_HABLADOS.includes(id)) {
      console.warn(`- ${id}: risa o exclamación sin palabras; se queda la grabación.`);
      continue;
    }
    const guion = GUIONES[id];
    if (!guion) {
      console.warn(`- ${id}: sin guion`);
      continue;
    }
    const ruta = path.join(PUBLICO, `${id}.mp3`);
    if (fs.existsSync(ruta) && !force) {
      console.log(`= ${id}: ya existe (usa --force para regrabarlo)`);
      continue;
    }
    const t0 = Date.now();
    const out = await hablar({ texto: guion, plataforma: 'ultron', sinCache: true });
    const segundos = out ? duracionWav(out.audio) : 0;
    if (!out || segundos < 0.3) {
      console.error(`✗ ${id}: Voicebox no devolvió audio`);
      fallos++;
      continue;
    }
    const mp3 = await wavAMp3(out.audio);
    if (!mp3) {
      console.error(`✗ ${id}: no pude codificar el MP3`);
      fallos++;
      continue;
    }
    fs.mkdirSync(PUBLICO, { recursive: true });
    fs.writeFileSync(ruta, mp3);
    const movil = path.join(MOVIL, `${id}.mp3`);
    const empaquetado = fs.existsSync(movil) || EN_EL_APK.includes(id);
    if (empaquetado) fs.writeFileSync(movil, mp3);
    let linea = `✓ ${id}: ${segundos.toFixed(2)} s, ${Math.round(mp3.length / 1024)} KB${empaquetado ? ' (+ APK)' : ''}, ${Date.now() - t0} ms`;
    if (conOido) linea += `\n    oído: «${await oir(mp3)}»`;
    console.log(linea);
  }
  if (fallos) process.exit(1);
}

await main();
