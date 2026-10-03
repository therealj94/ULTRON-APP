/**
 * LOS CONTROLES DE VOZ EN LA WEB (AUR10 / AUR14): los mismos que el teléfono, con lo que la web tiene.
 *
 * Qué es cada control y cómo se reconoce por voz está en lib/controles-voz.ts (el mismo intérprete que el
 * servidor y el teléfono): «cállate» / «para de hablar» callan lo que suena; «cuelga» cuelga la
 * conversación en vivo; «cancela / pausa / sigue con la tarea» y «tomo el control» van a su computadora;
 * «para» a secas con audio y tarea vivos pregunta. Aquí están los PUERTOS de la web:
 *
 *   · pararAudio → `callar()` de 03-voz/hablar.ts (la frase que suena y las que esperan);
 *   · cortarTurno → lo que pase quien llama (el turno en camino que no debe decirse);
 *   · colgar → `ConversacionEnVivo.cerrar()` (03-voz/enVivo.ts), solo si hay una abierta;
 *   · tarea → las mismas rutas de su computadora que usa el teléfono, con la sesión de la mesa;
 *   · micrófono → la conversación en vivo de la web todavía no sabe silenciarse sin colgar: se dice
 *     («Aquí no puedo silenciar el micrófono»), no se finge.
 *
 * Sin DOM ni React: lo de afuera entra por parámetros (así se prueba en Node, tests/controles-voz-web.test.ts).
 */
import type { PuertosControl, QueTarea, ResultadoPuerto } from '../../lib/controles-voz';

export { dichoDeControl, ejecutarControl, interpretarControl, preguntaAclaracion, respuestaAclaracion } from '../../lib/controles-voz';
export type { ControlVoz, EstadoControles, ResultadoControl } from '../../lib/controles-voz';

/** fetch con la sesión de la mesa, ya leído (lo mismo que `pedir` de enVivo.ts, con método). */
export type PedirWeb = (ruta: string, init?: { method?: string; body?: string }) => Promise<{ ok: boolean; status: number; json: any }>;

const RUTA_DE: Record<QueTarea, string> = { cancelar: 'parar', pausar: 'pausar', reanudar: 'reanudar', tomar: 'control' };
const VIVA = new Set(['en_cola', 'trabajando', 'pausada', 'confirmar', 'control']);
const EN_MARCHA = new Set(['en_cola', 'trabajando']);

/**
 * La tarea de su computadora desde la web: mira cómo está (GET /api/computadora) y pide solo lo que su
 * servicio sabe y tiene sentido en ese estado (las mismas reglas que mobile/src/compa/controles.ts).
 */
export async function tareaWeb(que: QueTarea, pedir: PedirWeb): Promise<ResultadoPuerto> {
  try {
    const s = await pedir('/api/computadora', { method: 'GET' });
    const actual = s.ok ? s.json?.actual : null;
    const estado = String(actual?.estado || '');
    if (!actual?.id || !VIVA.has(estado)) return { ok: false, detalle: 'No hay ninguna tarea en marcha en tu computadora.' };
    const caps: string[] = Array.isArray(s.json?.capacidades) ? s.json.capacidades : [];
    if (que === 'pausar' && !(caps.includes('pausar') && EN_MARCHA.has(estado)))
      return { ok: false, detalle: caps.includes('pausar') ? 'La tarea no está avanzando: no hay nada que pausar.' : 'Tu computadora todavía no sabe pausar; solo puedo detenerla del todo.' };
    if (que === 'reanudar' && !(caps.includes('pausar') && estado === 'pausada')) return { ok: false, detalle: 'La tarea no está en pausa.' };
    if (que === 'tomar' && !(caps.includes('control') && (EN_MARCHA.has(estado) || estado === 'pausada')))
      return { ok: false, detalle: caps.includes('control') ? 'Ahora no se puede tomar el control.' : 'Tu computadora todavía no sabe darte el control.' };
    const r = await pedir(`/api/computadora/tareas/${encodeURIComponent(actual.id)}/${RUTA_DE[que]}`, { method: 'POST', body: JSON.stringify(que === 'tomar' ? { tomar: true } : {}) });
    if (!r.ok) return { ok: false, detalle: String(r.json?.error || 'La computadora no contestó.') };
    if (r.json?.fase === 'draining') return { ok: true, detalle: 'Está terminando una acción que ya había empezado; en un momento queda como pediste.' };
    return { ok: true };
  } catch {
    return { ok: false, detalle: 'La computadora no contestó.' };
  }
}

/** Los puertos de la web. Sin `enVivo`, no hay qué colgar; sin `pedir`, la tarea no se maneja desde aquí. */
export function puertosWeb(d: { callar: () => void; cortarTurno?: () => void; enVivo?: { estado(): string; cerrar(): void } | null; pedir?: PedirWeb }): PuertosControl {
  return {
    pararAudio: () => d.callar(),
    ...(d.cortarTurno ? { cortarTurno: d.cortarTurno } : {}),
    colgar: () => {
      const e = d.enVivo?.estado();
      if (!d.enVivo || !e || e === 'cerrada') return { ok: false, detalle: 'No hay ninguna conversación en vivo que colgar.' };
      d.enVivo.cerrar();
      return { ok: true };
    },
    ...(d.pedir ? { tarea: (que: QueTarea) => tareaWeb(que, d.pedir!) } : {}),
  };
}
