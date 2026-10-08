/**
 * LA INICIATIVA DEL DÍA EN EL TELÉFONO (la lógica, sin React Native): Ajustes → Iniciativa (server/iniciativa-dia.ts,
 * lib/iniciativa-dia.ts; tanda F2).
 *
 *   GET  /api/iniciativa/dia                  → { preferencias, porOmision, dueno, hoyNo, empujonesHoy, topes }
 *   POST /api/iniciativa/dia {…cambios}       → lo mismo + { desdeManana }
 *   POST /api/iniciativa/dia/hoy-no {quitar?} → lo mismo
 *
 * Lo que la persona controla: el interruptor general, el resumen de la mañana y su hora, los empujones a tiempo, «llámame
 * en lugar de avisar» (el resumen y los urgentes de un VIP, cada uno aparte) y sus horas quietas. Todo se guarda en el
 * servidor por cuenta; el teléfono solo lo enseña.
 */

export type PrefsDia = {
  activa: boolean;
  resumen: boolean;
  horaResumen: string;
  empujones: boolean;
  llamarResumen: boolean;
  llamarVip: boolean;
  quietas: { desde: string; hasta: string };
  zona: string;
};

export type VistaDia = {
  preferencias: PrefsDia;
  dueno: boolean;
  hoyNo: boolean;
  empujonesHoy: number;
  topes: { empujonesDia: number; espacioMin: number };
  desdeManana?: boolean;
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** El cuerpo que devuelve el servidor → la vista (o null si vino mal: no es «todo apagado»). */
export function vistaDeServidor(r: unknown): VistaDia | null {
  const x = (r || {}) as Record<string, any>;
  const p = x.preferencias;
  if (!p || typeof p !== 'object' || !HHMM.test(String(p.horaResumen)) || !HHMM.test(String(p.quietas?.desde)) || !HHMM.test(String(p.quietas?.hasta)) || typeof p.zona !== 'string') return null;
  const b = (v: unknown) => v === true;
  return {
    preferencias: {
      activa: b(p.activa),
      resumen: b(p.resumen),
      horaResumen: p.horaResumen,
      empujones: b(p.empujones),
      llamarResumen: b(p.llamarResumen),
      llamarVip: b(p.llamarVip),
      quietas: { desde: p.quietas.desde, hasta: p.quietas.hasta },
      zona: p.zona,
    },
    dueno: b(x.dueno),
    hoyNo: b(x.hoyNo),
    empujonesHoy: Number.isInteger(x.empujonesHoy) ? x.empujonesHoy : 0,
    topes: { empujonesDia: Number(x.topes?.empujonesDia) || 3, espacioMin: Number(x.topes?.espacioMin) || 45 },
    ...(x.desdeManana === true ? { desdeManana: true } : {}),
  };
}

/** Las horas del resumen para elegir con un toque (la que tenga, si es otra, se agrega). */
export const HORAS_RESUMEN: readonly string[] = ['06:30', '07:00', '07:30', '08:00', '08:30'];

export function horasResumenCon(actual: string): string[] {
  return HORAS_RESUMEN.includes(actual) || !HHMM.test(actual) ? [...HORAS_RESUMEN] : [...HORAS_RESUMEN, actual].sort();
}

/** Horas quietas para elegir con un toque. */
export const QUIETAS_DIA: readonly { id: string; desde: string; hasta: string }[] = [
  { id: '22-07', desde: '22:00', hasta: '07:00' },
  { id: '21-07', desde: '21:00', hasta: '07:00' },
  { id: '23-08', desde: '23:00', hasta: '08:00' },
];

export function idQuietasDia(q: { desde: string; hasta: string }): string {
  return QUIETAS_DIA.find((x) => x.desde === q.desde && x.hasta === q.hasta)?.id || 'otro';
}

/** «7:30» como se lee. */
export function horaBonita(hhmm: string): string {
  const m = HHMM.exec(hhmm);
  return m ? `${Number(m[1])}:${hhmm.slice(3)}` : hhmm;
}

/** El pie del grupo: qué hace hoy, en una frase. */
export function resumenEstado(v: VistaDia, idioma: 'es' | 'en' = 'es'): string {
  const en = idioma === 'en';
  const p = v.preferencias;
  if (!p.activa) return en ? 'Off: AURA only talks when you talk to her.' : 'Apagada: AURA solo habla cuando le hablas.';
  if (v.hoyNo) return en ? 'Paused for today. Tomorrow it starts again.' : 'En pausa por hoy. Mañana vuelve.';
  const partes: string[] = [];
  if (p.resumen) partes.push(en ? `summary at ${horaBonita(p.horaResumen)}` : `resumen a las ${horaBonita(p.horaResumen)}`);
  if (p.empujones) partes.push(en ? `up to ${v.topes.empujonesDia} nudges a day (${v.empujonesHoy} today)` : `hasta ${v.topes.empujonesDia} avisos al día (${v.empujonesHoy} hoy)`);
  if (!partes.length) return en ? 'On, but with nothing chosen.' : 'Encendida, pero sin nada elegido.';
  return `${en ? 'On' : 'Encendida'}: ${partes.join(' · ')}.`;
}

/** El aviso al guardar una hora que hoy ya pasó. */
export function avisoDesdeManana(v: VistaDia, idioma: 'es' | 'en' = 'es'): string {
  if (!v.desdeManana) return '';
  return idioma === 'en' ? `Today’s time already passed: it starts tomorrow at ${horaBonita(v.preferencias.horaResumen)}.` : `La hora de hoy ya pasó: empieza mañana a las ${horaBonita(v.preferencias.horaResumen)}.`;
}
