/**
 * QUÉ VOZ SE PUEDE GUARDAR PARA SIEMPRE (la caché de S3, server/voz.ts).
 *
 * Solo las frases que AU-RA dice igual a cualquiera: las del banco de respuestas al instante
 * (lib/respuestas-fijas.ts, con el nombre de la persona) y las de espera (mobile/src/compa/frasesEstado.ts).
 * Una respuesta del cerebro, aunque sea corta («tu cita con el doctor es a las tres», el expediente de un
 * cliente en Dr Electrum), NUNCA va a S3: se queda en la caché de memoria, que se pierde al redesplegar.
 * (Revisión de Codex en #112: antes bastaba con que fuera corta.)
 */
import { ESTADOS_FRASE, frasesDe } from '../mobile/src/compa/frasesEstado';
import { quitarExpresiones } from './expresiones';

const normal = (s: string) =>
  quitarExpresiones(String(s || ''))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Una frase y cada una de sus oraciones (el teléfono pide la voz oración por oración). */
function partes(texto: string): string[] {
  const t = normal(texto);
  if (!t) return [];
  const oraciones = t.split(/(?<=[.!?…])\s+/).map((x) => x.trim()).filter(Boolean);
  return [...new Set([t, ...oraciones])];
}

let deEspera: Set<string> | null = null;
function esperas(): Set<string> {
  if (deEspera) return deEspera;
  deEspera = new Set();
  for (const e of ESTADOS_FRASE)
    for (const a of ['ojos', 'aura', 'claudio', 'antonio'] as const)
      for (const i of ['es', 'en'] as const) for (const f of frasesDe(e, a, i)) for (const p of partes(f)) deEspera.add(p);
  return deEspera;
}

const fijas = new Set<string>();
const MAX_FIJAS = 20_000;

/** El banco acaba de decir esto: su voz se puede guardar. */
export function anotarFraseFija(texto: string) {
  if (fijas.size > MAX_FIJAS) fijas.clear();
  for (const p of partes(texto)) fijas.add(p);
}

/** ¿Es una frase del banco o de espera (y no una respuesta del cerebro)? */
export function esFraseConocida(texto: string): boolean {
  const t = normal(texto);
  return !!t && (fijas.has(t) || esperas().has(t));
}
