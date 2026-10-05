/**
 * El motor de voces DE VERDAD (lib/voces-motor.ts: sherpa-onnx + CAM++ en un proceso hijo) sobre voces
 * reales: cuánto se parece la misma persona a sí misma y a las demás, aciertos/«no sé»/confusiones con
 * el umbral y el margen de lib/voces-miembro.ts, lo que tarda y la memoria del hijo.
 *
 *   npx tsx scripts/voces-motor-prueba.ts <carpeta>
 *
 * <carpeta>/<persona>/<n>.wav: WAV PCM 16 bits, mono, 16 kHz, al menos 4 por persona. Se inscribe a
 * cada persona con 0.wav, 1.wav y 2.wav (como en la app: tres frases) y se le reconoce con las demás.
 * Se usó con 16 lectores de LibriSpeech dev-clean (dominio público, openslr.org/31) y 6 voces en
 * español. El modelo se baja solo (sha256 fijado) o se toma de ULTRON_VOCES_MODELO.
 * Sin carpeta, sin red o sin el binario de sherpa-onnx: lo dice y sale sin fallar.
 */
import fs from 'node:fs';
import path from 'node:path';
import { apagarMotorVoces, FRECUENCIA, huellaDeVoz, muestrasDeAudio, motorVoces, soloVoz, _pidMotorVoces } from '../lib/voces-motor';
import { identificarVoz, MARGEN_VOZ, parecidoA, UMBRAL_VOZ, type PersonaVoz } from '../lib/voces-miembro';

const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) {
  console.log('uso: npx tsx scripts/voces-motor-prueba.ts <carpeta con <persona>/<n>.wav>');
  process.exit(0);
}
const rssHijo = () => {
  const pid = _pidMotorVoces();
  if (!pid) return null;
  const m = /VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8'));
  return m ? Math.round(Number(m[1]) / 1024) : null;
};
const audio = (f: string) => muestrasDeAudio(fs.readFileSync(f).toString('base64'));

let t = Date.now();
try {
  await motorVoces(120_000);
} catch (e) {
  console.log(`[voces] se salta: el motor no está disponible (${(e as Error).message})`);
  process.exit(0);
}
console.log(`[voces] motor listo en ${Date.now() - t} ms (bajar si hacía falta + arrancar el hijo); memoria del hijo: ${rssHijo()} MB`);

const personas = fs.readdirSync(dir).filter((p) => fs.existsSync(path.join(dir, p, '0.wav'))).sort();
const inscritas: PersonaVoz[] = [];
const tiempos: { seg: number; ms: number }[] = [];
async function huella(f: string) {
  const m = audio(f);
  if (!m) throw new Error(`no es WAV 16 kHz mono 16 bits: ${f}`);
  const sv = soloVoz(m);
  const t0 = performance.now();
  const v = await huellaDeVoz(sv.muestras);
  tiempos.push({ seg: sv.muestras.length / FRECUENCIA, ms: performance.now() - t0 });
  return { v, voz: sv.vozSeg, total: m.length / FRECUENCIA };
}
for (const p of personas) {
  const vectores: number[][] = [];
  for (const i of [0, 1, 2]) vectores.push((await huella(path.join(dir, p, `${i}.wav`))).v);
  inscritas.push({ id: p, nombre: p, relacion: 'conocido', vectores, consentimiento: { como: 'voz', t: 0 }, creado: 0, actualizado: 0 });
}
const misma: number[] = [];
const otra: number[] = [];
let aciertos = 0;
let nose = 0;
let confusiones = 0;
let total = 0;
for (const p of personas) {
  for (const f of fs.readdirSync(path.join(dir, p)).filter((x) => /^\d+\.wav$/.test(x) && Number(x.split('.')[0]) >= 3)) {
    const { v } = await huella(path.join(dir, p, f));
    for (const q of inscritas) (q.id === p ? misma : otra).push(parecidoA(v, q));
    const r = identificarVoz(v, inscritas);
    total++;
    if (!r.persona) nose++;
    else if (r.persona.id === p) aciertos++;
    else confusiones++;
  }
}
// Desconocidos: la mitad de las personas sin inscribir. Nadie debería ser llamado por otro nombre.
const pares = inscritas.filter((_, i) => i % 2 === 0);
let desconocidas = 0;
let nombradas = 0;
let maxDesconocida = -1;
for (const p of personas.filter((_, i) => i % 2 === 1)) {
  for (const f of fs.readdirSync(path.join(dir, p)).filter((x) => /^\d+\.wav$/.test(x))) {
    const { v } = await huella(path.join(dir, p, f));
    desconocidas++;
    maxDesconocida = Math.max(maxDesconocida, ...pares.map((q) => parecidoA(v, q)));
    if (identificarVoz(v, pares).persona) nombradas++;
  }
}
const f3 = (x: number) => x.toFixed(3);
const media = (a: number[]) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
console.log(`[voces] ${personas.length} personas, ${total} frases de prueba`);
console.log(`[voces] misma persona: media ${f3(media(misma))}, mínima ${f3(Math.min(...misma))}`);
console.log(`[voces] personas distintas: media ${f3(media(otra))}, máxima ${f3(Math.max(...otra))}`);
console.log(`[voces] con umbral ${UMBRAL_VOZ} y margen ${MARGEN_VOZ}: ${aciertos} aciertos, ${nose} «no sé», ${confusiones} confusiones`);
console.log(`[voces] desconocidos (${desconocidas} frases de personas sin inscribir contra ${pares.length} inscritas): ${nombradas} llamadas por otro nombre; similitud máxima ${f3(maxDesconocida)}`);
const porSeg =(a: number, b: number) => tiempos.filter((x) => x.seg >= a && x.seg < b).map((x) => x.ms);
for (const [a, b] of [[1.5, 3.5], [3.5, 6.5], [6.5, 13]]) {
  const ms = porSeg(a, b);
  if (ms.length) console.log(`[voces] huella de ${a}–${b} s de voz: ${media(ms).toFixed(0)} ms (n=${ms.length})`);
}
console.log(`[voces] memoria del hijo al final: ${rssHijo()} MB (el servidor no la carga: es otro proceso)`);
apagarMotorVoces();
process.exit(confusiones + nombradas > 0 ? 1 : 0);
