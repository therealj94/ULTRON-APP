/**
 * DIÁLOGO A VARIAS VOCES: «explícamelo como conversación».
 *
 * Una respuesta larga (un análisis, un informe, lo que vence este año) se entiende mejor dicha
 * entre dos: Dr Electrum explica y la ingeniera Tatiana le pregunta lo que preguntaría quien
 * escucha. Con Eleven v4 y su «text to dialogue» cada personaje tiene su voz y las etiquetas
 * ([curious], [laughs], [thoughtful]) marcan cómo lo dice, con la dinámica de una charla de verdad
 * (se contestan, se interrumpen un poco, se ríen).
 *
 *  · El guion lo escribe el cerebro del nodo con una instrucción propia (no toca el prompt del
 *    doctor). Si el nodo no contesta, se arma uno determinista a partir del texto: nunca «no pude».
 *  · El audio sale de /v1/text-to-dialogue/stream, en trozos de hasta ~1800 caracteres (el tope de
 *    ElevenLabs por pedido es 2000), que el navegador encadena.
 */
import { clave } from '../../lib/boveda';
import { fetchNodo, NODO_MODELO, NODO_SECRETO, NODO_URL } from '../../lib/nodo';
import { guionEleven, elevenListo } from '../eleven';
import { expresar } from '../voz';

import type { Personaje } from './personajes';
export type { Personaje };

/** Quién es cada uno y con qué voz habla. */
export const PERSONAJES: Record<Personaje, { nombre: string; voz: string; quien: string }> = {
  electrum: { nombre: 'Dr Electrum', voz: 'Rt1JHkPO27QCUX6Nd5bV', quien: 'geólogo sénior con cuarenta años de campo, pausado y preciso' },
  tatiana: { nombre: 'Ing. Tatiana', voz: 'irla3teuChAApguKnzms', quien: 'ingeniera en minas: plan de minado, obra civil, relaves, permisos; ordenada y directa' },
  chema: { nombre: 'Don Chema', voz: 'wfTWLJ20rcMqvU8gIiAB', quien: 'ingeniero metalurgista de Olancho: pruebas metalúrgicas y planta; práctico, habla sencillo y con refranes' },
  narrador: { nombre: 'Narrador', voz: 'sDh3eviBhiuHKi0MjTNq', quien: 'narrador sereno de documental' },
};

export type Linea = { quien: Personaje; texto: string };

const TOPE_TROZO = 1800;
const MAX_LINEAS = 24;

export function esPersonaje(x: unknown): x is Personaje {
  return typeof x === 'string' && x in PERSONAJES;
}

/**
 * La voz propia de quien habla en la mesa (`personaje` en /api/electrum/voz y /api/electrum/voz/pcm): Don Chema o la
 * Ing. Tatiana con la suya. El doctor (o cualquier otra cosa que llegue) no lleva voz propia: la de la plataforma.
 */
export function vozDeLaMesa(personaje: unknown): string | undefined {
  return personaje === 'chema' || personaje === 'tatiana' ? PERSONAJES[personaje].voz : undefined;
}

/** Valida y limpia lo que llega (del modelo o del navegador). */
export function lineasValidas(crudo: unknown): Linea[] {
  if (!Array.isArray(crudo)) return [];
  return crudo
    .filter((l: any) => l && esPersonaje(l.quien) && typeof l.texto === 'string' && l.texto.trim())
    .slice(0, MAX_LINEAS)
    .map((l: any) => ({ quien: l.quien as Personaje, texto: String(l.texto).trim().slice(0, 600) }));
}

/** Parte el diálogo en pedidos que caben en ElevenLabs, sin partir una línea. */
export function partirDialogo(lineas: Linea[], tope = TOPE_TROZO): Linea[][] {
  const trozos: Linea[][] = [];
  let actual: Linea[] = [];
  let largo = 0;
  for (const l of lineas) {
    if (actual.length && largo + l.texto.length > tope) {
      trozos.push(actual);
      actual = [];
      largo = 0;
    }
    actual.push(l);
    largo += l.texto.length;
  }
  if (actual.length) trozos.push(actual);
  return trozos;
}

/* ------------------------------------------------------------------ el guion */

const INSTRUCCION = [
  'Convertí el texto en un diálogo hablado, en español de Honduras, entre Dr Electrum (geólogo sénior, pausado y preciso) y la Ing. Tatiana (ingeniera en minas: plan de minado y obra civil; pregunta lo que preguntaría quien escucha y aporta obra, permisos y riesgos). Si el texto toca planta, proceso del mineral o explotación, entra también Don Chema (ingeniero metalurgista, práctico, con algún refrán): quien = "chema".',
  'Reglas: entre 6 y 12 líneas cortas (una o dos frases cada una); Tatiana abre con una pregunta o un comentario; se contestan de verdad, a veces se interrumpen o se ríen; sin inventar cifras: solo las del texto; sin listas ni markdown.',
  'Marcá cómo se dice cada línea con UNA etiqueta de voz en inglés al principio cuando sume: [curious], [thoughtful], [warmly], [laughs], [chuckles], [surprised], [serious], [excited], [sighs], [whispers]. No en todas.',
  'Contestá SOLO un JSON: {"lineas":[{"quien":"tatiana","texto":"..."},{"quien":"electrum","texto":"..."}]}.',
].join(' ');

/** El JSON del modelo, aunque venga envuelto en ```json o con texto alrededor. */
export function leerGuion(texto: string): Linea[] {
  const t = String(texto || '');
  const i = t.indexOf('{');
  const j = t.lastIndexOf('}');
  if (i < 0 || j <= i) return [];
  try {
    const d = JSON.parse(t.slice(i, j + 1));
    return lineasValidas(d?.lineas);
  } catch {
    return [];
  }
}

/**
 * Sin modelo: Tatiana pregunta y el doctor contesta con las frases del texto, de dos en dos. No es
 * una charla brillante, pero se oye a dos personas y no se inventa nada.
 */
export function guionDeRespaldo(texto: string): Linea[] {
  const frases = String(texto || '')
    .replace(/\s+/g, ' ')
    .match(/[^.!?]+[.!?]+/g)
    ?.map((f) => f.trim())
    .filter((f) => f.length > 3) || [];
  if (!frases.length) return [];
  const preguntas = ['[curious] Doctor, ¿qué tenemos aquí?', '[thoughtful] ¿Y eso qué significa en la práctica?', '[curious] ¿Algo más que haya que tener en cuenta?', '¿Y entonces?'];
  const lineas: Linea[] = [];
  for (let k = 0, p = 0; k < frases.length && lineas.length < MAX_LINEAS - 1; k += 2, p++) {
    lineas.push({ quien: 'tatiana', texto: preguntas[Math.min(p, preguntas.length - 1)] });
    lineas.push({ quien: 'electrum', texto: frases.slice(k, k + 2).join(' ') });
  }
  lineas.push({ quien: 'tatiana', texto: '[warmly] Clarísimo, gracias doctor.' });
  return lineas;
}

/** El guion: primero el cerebro; si no está o tarda, el de respaldo. */
export async function guionDialogo(texto: string, tema?: string): Promise<{ lineas: Linea[]; origen: 'cerebro' | 'respaldo' }> {
  const base = String(texto || '').slice(0, 4000);
  if (NODO_URL) {
    try {
      const r = await fetchNodo(`${NODO_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ultron-secreto': NODO_SECRETO },
        body: JSON.stringify({
          model: NODO_MODELO,
          stream: false,
          messages: [
            { role: 'system', content: INSTRUCCION },
            { role: 'user', content: `${tema ? `Tema: ${tema}\n\n` : ''}Texto:\n${base}` },
          ],
          options: { temperature: 0.7 },
        }),
        signal: AbortSignal.timeout(25_000),
      });
      if (r.ok) {
        const j: any = await r.json().catch(() => ({}));
        const lineas = leerGuion(String(j?.message?.content || ''));
        if (lineas.length >= 2) return { lineas, origen: 'cerebro' };
      }
    } catch {
      /* sin cerebro: respaldo */
    }
  }
  return { lineas: guionDeRespaldo(base), origen: 'respaldo' };
}

/* ------------------------------------------------------------------ el audio */

/** De qué personaje es una voz de ElevenLabs (para los tiempos por hablante). */
export function quienDeVoz(voz: string): Personaje | null {
  return (Object.keys(PERSONAJES) as Personaje[]).find((p) => PERSONAJES[p].voz === voz) || null;
}

/** Un segmento de tiempo por hablante, como lo entiende la pantalla: quién, desde y hasta (s), y qué línea del trozo dice (i). */
export type Segmento = { q: Personaje; d: number; h: number; i?: number };

/** Lo que manda ElevenLabs en cada trozo (voice_segments) → nuestros segmentos por personaje. */
export function segmentosDe(crudo: unknown): Segmento[] {
  if (!Array.isArray(crudo)) return [];
  const out: Segmento[] = [];
  for (const s of crudo as any[]) {
    const q = quienDeVoz(String(s?.voice_id || ''));
    const d = Number(s?.start_time_seconds);
    const h = Number(s?.end_time_seconds);
    const i = Number(s?.dialogue_input_index);
    if (q && Number.isFinite(d) && Number.isFinite(h) && h > d) out.push({ q, d: Math.round(d * 1000) / 1000, h: Math.round(h * 1000) / 1000, ...(Number.isInteger(i) && i >= 0 ? { i } : {}) });
  }
  return out;
}

/**
 * Abre el audio de un trozo de diálogo (ya partido con partirDialogo), CON LOS TIEMPOS DE CADA
 * VOZ: la respuesta en curso trae JSON por líneas ({audio_base64, voice_segments}), y con eso las
 * caras de la pantalla saben quién habla en cada instante. null si no se pudo.
 */
export async function abrirDialogo(lineas: Linea[]): Promise<Response | null> {
  const key = clave('elevenlabs');
  if (!key || !elevenListo() || !lineas.length) return null;
  const inputs = lineas
    .map((l) => ({
      // El mismo guion que la voz de siempre: cifras y unidades como se dicen, etiquetas de v4.
      text: guionEleven(l.texto, 'neutral', (t) => expresar(t, 'neutral', 'speak', { cifras: false })),
      voice_id: PERSONAJES[l.quien].voz,
    }))
    .filter((x) => x.text);
  if (!inputs.length) return null;
  try {
    const r = await fetch('https://api.elevenlabs.io/v1/text-to-dialogue/stream/with-timestamps?output_format=mp3_44100_96', {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      // Estabilidad baja: en un diálogo la gracia es que se note la emoción de cada uno.
      body: JSON.stringify({ model_id: 'eleven_v4', inputs, settings: { stability: 0.4 } }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok || !r.body) {
      console.warn('[dialogo] ElevenLabs contestó', r.status, (await r.text().catch(() => '')).slice(0, 200));
      return null;
    }
    return r;
  } catch (e: any) {
    console.warn('[dialogo] sin audio:', String(e?.message || e).slice(0, 160));
    return null;
  }
}
