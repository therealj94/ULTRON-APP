/**
 * LOS CONTROLES DE VOZ EN LA WEB (AUR10 / AUR14): los mismos que el teléfono, con lo que la web tiene.
 *
 * Qué es cada control y cómo se reconoce por voz está en lib/controles-voz.ts (el mismo intérprete que el
 * servidor y el teléfono): «cállate» / «para de hablar» callan lo que suena; «cuelga» cuelga la
 * conversación en vivo; «cancela / pausa / sigue con la tarea» y «tomo el control» van a su computadora;
 * «para» a secas con audio y tarea vivos pregunta. Aquí están los PUERTOS de la web:
 *
 *   · pararAudio → `callar()` de 03-voz/hablar.ts (la frase que suena y las que esperan) Y, con la llamada
 *     abierta, `ConversacionEnVivo.callarSalida()`: el TTS de la mesa NO es el audio de la llamada (P2,
 *     auditoría del 4-oct). Si la llamada no sabe callar su salida, se dice: callar la mesa no es un «listo»;
 *   · cortarTurno → lo que pase quien llama (el turno en camino que no debe decirse);
 *   · colgar → `ConversacionEnVivo.cerrar()` (03-voz/enVivo.ts), solo si hay una abierta;
 *   · tarea → las mismas rutas de su computadora que usa el teléfono, con la sesión de la mesa;
 *   · micrófono → `ConversacionEnVivo.silenciarMic()`: el de ESA sesión, sin colgar, y se vuelve a escuchar.
 *     Si el SDK no sabe silenciar, se dice y el botón no lo anuncia (botonMicrofonoWeb), no se finge.
 *
 * Callar, silenciar o colgar nunca tocan la tarea durable (su computadora sigue como estaba).
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

/**
 * Lo que los controles necesitan de la llamada (ConversacionEnVivo lo cumple). Lo opcional, si falta, no se
 * puede hacer y se dice.
 */
export type LlamadaWeb = {
  estado(): string;
  cerrar(): void;
  silenciarMic?(silenciar: boolean): ResultadoPuerto;
  callarSalida?(): ResultadoPuerto;
};

/** ¿Hay una llamada en curso (conectando o abierta)? */
const enCurso = (l: LlamadaWeb | null | undefined): l is LlamadaWeb => {
  const e = l?.estado();
  return !!l && !!e && e !== 'cerrada' && e !== 'error';
};

/** Los puertos de la web. Sin `enVivo`, no hay qué colgar; sin `pedir`, la tarea no se maneja desde aquí. */
export function puertosWeb(d: { callar: () => void; cortarTurno?: () => void; enVivo?: LlamadaWeb | null; pedir?: PedirWeb }): PuertosControl {
  return {
    pararAudio: () => {
      // La voz de la mesa (TTS ordinario) se calla siempre; no es el audio de la llamada.
      d.callar();
      const l = d.enVivo;
      if (!enCurso(l)) return { ok: true };
      if (!l.callarSalida) return { ok: false, detalle: 'Callé mi voz, pero no puedo callar el audio de la llamada en vivo; si quieres, cuelga.' };
      return l.callarSalida();
    },
    ...(d.cortarTurno ? { cortarTurno: d.cortarTurno } : {}),
    microfono: (silenciar: boolean) => {
      const l = d.enVivo;
      if (!enCurso(l)) return { ok: false, detalle: 'No hay ninguna conversación en vivo abierta: el micrófono de la mesa se apaga con su botón.' };
      if (!l.silenciarMic) return { ok: false, detalle: 'En vivo no puedo silenciar el micrófono sin colgar.' };
      return l.silenciarMic(silenciar);
    },
    colgar: () => {
      const l = d.enVivo;
      if (!enCurso(l)) return { ok: false, detalle: 'No hay ninguna conversación en vivo que colgar.' };
      l.cerrar();
      return { ok: true };
    },
    ...(d.pedir ? { tarea: (que: QueTarea) => tareaWeb(que, d.pedir!) } : {}),
  };
}

/**
 * El botón del micrófono de la mesa. Sin llamada: el oído de siempre (useOido). Con la llamada abierta: el
 * micrófono de ESA sesión (silenciar sin colgar / volver a escuchar), SOLO si la llamada sabe hacerlo; si no,
 * el botón se apaga y dice por qué (no se anuncia algo que no hace).
 */
export function botonMicrofonoWeb(o: { vivoAbierta: boolean; silenciable: boolean; silenciado: boolean; micEnabled: boolean; escuchando: boolean }): {
  modo: 'mesa' | 'llamada' | 'no_disponible';
  /** aria-pressed: el micrófono está mandando. */
  activo: boolean;
  disabled: boolean;
  etiqueta: string;
} {
  if (!o.vivoAbierta)
    return {
      modo: 'mesa',
      activo: o.micEnabled,
      disabled: false,
      etiqueta: o.micEnabled ? (o.escuchando ? 'Micrófono abierto: te está escuchando' : 'Micrófono abierto') : 'Micrófono apagado',
    };
  if (!o.silenciable) return { modo: 'no_disponible', activo: true, disabled: true, etiqueta: 'En vivo no puedo silenciar el micrófono: para que deje de escucharte, cuelga' };
  return o.silenciado
    ? { modo: 'llamada', activo: false, disabled: false, etiqueta: 'Micrófono de la llamada silenciado: toca para volver a escuchar' }
    : { modo: 'llamada', activo: true, disabled: false, etiqueta: 'Silenciar el micrófono de la llamada (no cuelga)' };
}
