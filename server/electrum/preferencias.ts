/**
 * PREFERENCIAS DE PANTALLA POR PERSONA — cómo dejó cada quien la interfaz.
 *
 * El panel de caras de la mesa (Dr Electrum, la Ing. Tatiana, Don Chema) tapaba el mapa. Ahora se
 * pliega, y cómo lo dejó cada quien se guarda con la persona (o con su visitante opaco si entró con
 * la llave de la demo), no con el navegador: abre igual en el teléfono y en la computadora.
 *
 * Solo se aceptan las claves conocidas y valores booleanos: esto no es un almacén libre.
 */
import type { Express, Request, Response } from 'express';
import { exigirPlataforma, identidadDe, limitar } from '../seguridad';
import { sql, tipo } from '../../lib/cognitivo/base';
import { quienDelHilo } from './hilo';

/** Las preferencias que existen y su valor si nadie tocó nada. */
export const PREFERENCIAS = {
  /** El panel de caras, fuera del recorrido. Plegado: el mapa manda. */
  retratosPlegados: true,
  /** El panel de caras durante el recorrido. Plegado: el cuadro del capítulo ya dice lo que se habla. */
  retratosPlegadosRecorrido: true,
} as const;
export type Preferencias = { -readonly [K in keyof typeof PREFERENCIAS]: boolean };

/** Solo claves conocidas con valor booleano; lo demás se ignora. */
export function sanearPreferencias(crudo: unknown): Partial<Preferencias> {
  const out: Partial<Preferencias> = {};
  if (!crudo || typeof crudo !== 'object') return out;
  for (const k of Object.keys(PREFERENCIAS) as Array<keyof Preferencias>) {
    const v = (crudo as Record<string, unknown>)[k];
    if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

const enMemoria = new Map<string, Partial<Preferencias>>();

export async function preferenciasDe(quien: string): Promise<Preferencias> {
  let guardadas: Partial<Preferencias> = enMemoria.get(quien) || {};
  if (tipo() === 'postgres') {
    try {
      const [f] = await sql<{ datos: unknown }>(`SELECT datos FROM cognitivo.preferencia WHERE quien = $1`, [quien]);
      if (f) guardadas = sanearPreferencias(f.datos);
    } catch (e: any) {
      console.warn('[preferencias] no pude leer', String(e?.message || e).slice(0, 120));
    }
  }
  return { ...PREFERENCIAS, ...guardadas };
}

export async function guardarPreferencias(quien: string, cambios: Partial<Preferencias>): Promise<Preferencias> {
  const actual = await preferenciasDe(quien);
  const nuevas = { ...actual, ...sanearPreferencias(cambios) };
  enMemoria.set(quien, nuevas);
  if (enMemoria.size > 2_000) enMemoria.delete(enMemoria.keys().next().value!);
  if (tipo() === 'postgres') {
    await sql(
      `INSERT INTO cognitivo.preferencia (quien, datos, tocado) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (quien) DO UPDATE SET datos = EXCLUDED.datos, tocado = now()`,
      [quien, JSON.stringify(nuevas)]
    ).catch((e: any) => console.warn('[preferencias] no pude guardar', String(e?.message || e).slice(0, 120)));
  }
  return nuevas;
}

export function montarRutasPreferencias(app: Express) {
  const E = exigirPlataforma('electrum');
  app.get('/api/electrum/preferencias', E, limitar(60), async (req: Request, res: Response) => {
    const quien = quienDelHilo(identidadDe(req)?.persona.id, req);
    res.json({ preferencias: await preferenciasDe(quien), honesto: true });
  });
  app.put('/api/electrum/preferencias', E, limitar(60), async (req: Request, res: Response) => {
    const quien = quienDelHilo(identidadDe(req)?.persona.id, req);
    res.json({ preferencias: await guardarPreferencias(quien, req.body || {}), honesto: true });
  });
}
