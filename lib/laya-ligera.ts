/**
 * LAYA LIGERA: qué mano de la app pidió la persona, decidido AQUÍ, sin red, en microsegundos.
 *
 * Es el grupo `app` de Laya «comando» (scripts/nodo-t4/laya/modelos/comando) destilado en un
 * clasificador lineal: aprende de los mismos datos (español catracho/latino e inglés, errores de
 * dictado, negativos que se parecen) con n-gramas de palabras y de letras y un léxico de conceptos
 * («abre», «open», «muéstrame» → @abrir). Lo entrena `scripts/nodo-t4/laya/ligera/entrenar_ligera.py`,
 * que escribe los pesos en `laya-ligera-modelo.ts` y las cifras en `ligera/informe.json`.
 *
 * Qué decide y qué no:
 *  · decide QUÉ mano es (atrás, abrir pantalla, tema, avatar, callar, llamar…) y con qué confianza;
 *  · NO decide a quién, qué pantalla, a qué hora ni qué texto: eso lo saca quien llama de la frase
 *    (lib/acciones-app.ts), y si no sale claro, no se hace nada y contesta el cerebro;
 *  · NUNCA se salta una confirmación: llamar queda como propuesta que espera el «sí», y enviar o borrar
 *    un borrador solo lo deciden las reglas.
 *
 * La cuenta es EXACTAMENTE la del script (mismas palabras, mismos cubos, mismos pesos int8); las
 * `MUESTRAS` del archivo de pesos lo comprueban en tests/laya-ligera.test.ts.
 */
import { DIM, ESCALA, ETIQUETAS, LEXICO, PESOS_B64, SESGO, TEMPERATURA, UMBRAL } from './laya-ligera-modelo';

export type EtiquetaApp = (typeof ETIQUETAS)[number];
export type PrediccionLigera = {
  etiqueta: EtiquetaApp;
  /** P calibrada de la etiqueta ganadora. */
  p: number;
  /** La segunda, para saber si dudó entre dos. */
  segunda: { etiqueta: EtiquetaApp; p: number };
  /** Lo que tardó (ms, con decimales). */
  ms: number;
};

/** Por debajo de esto no se ejecuta nada: se pregunta al Laya del nodo o al cerebro. Sale de la validación. */
export const UMBRAL_LIGERA = UMBRAL;
export const ETIQUETAS_LIGERA = ETIQUETAS;

let pesos: Int8Array | null = null;
function tabla(): Int8Array {
  if (!pesos) {
    const b = Buffer.from(PESOS_B64, 'base64');
    pesos = new Int8Array(b.buffer, b.byteOffset, b.byteLength);
  }
  return pesos;
}

/** Sin tildes, minúsculas, solo [a-z0-9] y espacios (normalizar() del script, paso por paso). */
export function normalizarLigera(texto: string): string {
  return String(texto ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const EXACTA = new Map<string, string[]>();
for (const [c, ws] of Object.entries(LEXICO.exactas)) for (const w of ws) EXACTA.set(w, [...(EXACTA.get(w) || []), c]);
const PREFIJOS = Object.entries(LEXICO.prefijos)
  .flatMap(([c, ps]) => ps.map((p) => [p, c] as const))
  .sort((a, b) => b[0].length - a[0].length || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));

function conceptos(palabra: string): string[] {
  const out = [...(EXACTA.get(palabra) || [])];
  for (const [p, c] of PREFIJOS) if (palabra.length >= p.length && palabra.startsWith(p) && !out.includes(c)) out.push(c);
  return out;
}

/** Los rasgos de la frase (rasgos() del script). */
export function rasgosLigera(texto: string): Set<string> {
  const w = normalizarLigera(texto).split(' ').slice(0, 40).filter(Boolean);
  const out = new Set<string>();
  if (!w.length) return out;
  out.add(`n=${Math.min(w.length, 12)}`);
  out.add(`s=${w[0]}`);
  if (w.length > 1) out.add(`s2=${w[0]}_${w[1]}`);
  let previos: string[] = [];
  let primero = true;
  w.forEach((x, i) => {
    out.add(`w=${x}`);
    if (i + 1 < w.length) out.add(`b=${x}_${w[i + 1]}`);
    const p = `<${x}>`;
    for (const n of [3, 4]) for (let j = 0; j + n <= p.length; j++) out.add(`c=${p.slice(j, j + n)}`);
    const cs = conceptos(x);
    for (const c of cs) {
      out.add(`k=${c}`);
      if (primero) out.add(`ks=${c}`);
      for (const a of previos) out.add(`kb=${a}_${c}`);
    }
    if (cs.length) {
      primero = false;
      previos = cs;
    }
  });
  return out;
}

/** FNV-1a de 32 bits (los rasgos ya son ASCII: un byte por letra). */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** La mano que pide la frase, con su P. Nunca lanza; una frase vacía es app_ninguna. */
export function predecirApp(texto: string): PrediccionLigera {
  const t0 = performance.now();
  const K = ETIQUETAS.length;
  const W = tabla();
  const r = rasgosLigera(texto);
  const z = SESGO.slice();
  if (r.size) {
    const v = 1 / Math.sqrt(r.size);
    const suma = new Float64Array(K);
    for (const f of r) {
      const fila = (fnv1a(f) % DIM) * K;
      for (let k = 0; k < K; k++) suma[k] += W[fila + k];
    }
    for (let k = 0; k < K; k++) z[k] += ((suma[k] * ESCALA[k]) / 127) * v;
  }
  let max = -Infinity;
  for (let k = 0; k < K; k++) max = Math.max(max, z[k] / TEMPERATURA);
  const e = z.map((x) => Math.exp(x / TEMPERATURA - max));
  const total = e.reduce((a, b) => a + b, 0);
  const orden = e.map((x, k) => [x / total, k] as const).sort((a, b) => b[0] - a[0]);
  return {
    etiqueta: ETIQUETAS[orden[0][1]],
    p: orden[0][0],
    segunda: { etiqueta: ETIQUETAS[orden[1][1]], p: orden[1][0] },
    ms: performance.now() - t0,
  };
}
