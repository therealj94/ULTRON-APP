/**
 * LOS CONTROLES DE VOZ EN EL TELÉFONO (AUR10): cómo hace el teléfono cada control separado.
 *
 * Qué significa cada uno y cómo se reconoce está en lib/controlesVoz.ts (la copia de lib/controles-voz.ts).
 * Aquí está el CÓMO, con puertos que se inyectan (sin React Native: las pruebas usan dobles):
 *
 *   · detener_audio → para la voz de la mesa y su cola (lib/tts.ts) y cierra la boca; en la llamada calla
 *     también lo que la conversación está diciendo (callarLlamada, P2), sin colgar; NO silencia el
 *     micrófono ni toca la tarea;
 *   · colgar → cuelga la llamada del avatar (compa/llamadaCiclo.ts); la tarea de su computadora sigue;
 *   · tarea → su computadora por las rutas que ya existen (`/api/computadora/tareas/:id/parar|pausar|
 *     reanudar|control`), con lo que su servicio sabe hacer (controlesPc). Cancelar NO cuelga.
 *
 * El VozProvider arma los puertos (`puertos`) y llama a `aplicarAccionControl` con lo que mandó el
 * servidor; la mesa puede hacer lo mismo con lo que reconoce ella (lib/intenciones.ts, `control`).
 * Lo que no se pudo vuelve con su porqué: nunca un «listo» de más.
 */
import { ejecutarControl, type ControlVoz, type EstadoControles, type PuertosControl, type QueTarea, type ResultadoEjecucion, type ResultadoPuerto } from '../lib/controlesVoz';
import type { AccionApp } from '../nucleo/contrato';
import { controlesPc, trabajando, type EstadoPc, type EstadoTareaPc } from './computadora';
import { llamadaActiva, type EstadoCiclo } from './llamadaCiclo';

export type { PuertosControl } from '../lib/controlesVoz';

/** Lo poco de `api()` (lib/api.ts) que hace falta: así se prueba con un doble. */
export type ApiMin = (ruta: string, init?: { method?: string; body?: string }, timeoutMs?: number) => Promise<any>;

const RUTA_DE: Record<QueTarea, string> = { cancelar: 'parar', pausar: 'pausar', reanudar: 'reanudar', tomar: 'control' };

/** El control de una acción del servidor (null si no es de los controles). */
export function controlDeAccion(a: AccionApp): ControlVoz | null {
  switch (a.tipo) {
    case 'detener_audio':
      return 'detener_audio';
    case 'colgar':
      return 'colgar';
    case 'tarea':
      return a.que === 'pausar' ? 'pausar_tarea' : a.que === 'reanudar' ? 'reanudar_tarea' : a.que === 'tomar' ? 'tomar_control' : 'cancelar_tarea';
    case 'silencio':
      return a.valor ? 'silenciar_mic' : 'activar_mic';
    default:
      return null;
  }
}

/**
 * Al revés: el control que reconoció la mesa (lib/intenciones.ts, `control`) como la acción que hace el
 * VozProvider. Así la mesa no tiene su propia copia de cómo se cuelga o se cancela: emite la acción en el
 * bus (`emitir('accion', …)`) y el resultado vuelve como `hecho` (la compañera dice lo que no se pudo).
 */
export function accionDeControlMesa(c: ControlVoz): AccionApp {
  switch (c) {
    case 'detener_audio':
    case 'interrumpir':
      return { tipo: 'detener_audio' };
    case 'colgar':
      return { tipo: 'colgar' };
    case 'silenciar_mic':
      return { tipo: 'silencio', valor: true };
    case 'activar_mic':
      return { tipo: 'silencio', valor: false };
    case 'pausar_tarea':
      return { tipo: 'tarea', que: 'pausar' };
    case 'reanudar_tarea':
      return { tipo: 'tarea', que: 'reanudar' };
    case 'cancelar_tarea':
      return { tipo: 'tarea', que: 'cancelar' };
    case 'tomar_control':
      return { tipo: 'tarea', que: 'tomar' };
  }
}

/** Ejecuta la acción de control tocando SOLO sus puertos (lib/controlesVoz.ts, ejecutarControl). */
export async function aplicarAccionControl(a: AccionApp, p: PuertosControl): Promise<ResultadoEjecucion> {
  const c = controlDeAccion(a);
  if (!c) return { ok: false, detalle: 'No es un control.', hechos: [] };
  return ejecutarControl(c, p);
}

/**
 * La tarea de su computadora: pausar, seguir, cancelar o tomar el control. Mira primero cómo está (GET
 * /api/computadora) y solo pide lo que su servicio sabe y lo que tiene sentido en ese estado.
 */
export async function controlarTareaPc(que: QueTarea, api: ApiMin): Promise<ResultadoPuerto> {
  try {
    const s = (await api('/api/computadora', { method: 'GET' }, 12_000)) as EstadoPc | null;
    const actual = s?.actual || null;
    const estado = (actual?.estado || null) as EstadoTareaPc | null;
    if (!actual || !trabajando(estado)) return { ok: false, detalle: 'No hay ninguna tarea en marcha en tu computadora.' };
    const caps = s?.capacidades;
    const c = controlesPc(caps, estado);
    if (que === 'cancelar' && !c.detener) return { ok: false, detalle: 'Esa tarea ya no se puede detener.' };
    if (que === 'pausar' && !c.pausar)
      return { ok: false, detalle: caps?.includes('pausar') ? 'La tarea no está avanzando: no hay nada que pausar.' : 'Tu computadora todavía no sabe pausar (falta actualizar su servicio); solo puedo detenerla del todo.' };
    if (que === 'reanudar' && !c.seguir) return { ok: false, detalle: estado === 'pausada' ? 'Tu computadora todavía no sabe seguir una pausa.' : 'La tarea no está en pausa.' };
    if (que === 'tomar' && !c.tomar) return { ok: false, detalle: caps?.includes('control') ? 'Ahora no se puede tomar el control.' : 'Tu computadora todavía no sabe darte el control.' };
    const r = await api(`/api/computadora/tareas/${encodeURIComponent(actual.id)}/${RUTA_DE[que]}`, { method: 'POST', body: JSON.stringify(que === 'tomar' ? { tomar: true } : {}) }, 15_000);
    // Un toque que ya había salido termina primero (no se deshace): todavía no queda como se pidió.
    if (r?.fase === 'draining') return { ok: true, detalle: 'Está terminando una acción que ya había empezado; en un momento queda como pediste.' };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, detalle: e?.message || 'La computadora no contestó.' };
  }
}

/** Lo que está vivo, para leer «para» a secas (la mesa) y para el contexto: audio, tarea, llamada, turno. */
export function estadoControlesDe(v: { hablando: boolean; cola: number; tarea: EstadoTareaPc | null | undefined; ciclo: EstadoCiclo; pensando: boolean }): EstadoControles {
  return { audio: v.hablando || v.cola > 0, tarea: trabajando(v.tarea), llamada: llamadaActiva(v.ciclo), turno: v.pensando };
}

/**
 * Los puertos del teléfono a partir de lo que tiene el VozProvider. `enLlamada`: la conversación es dueña
 * del audio (la mesa no toca su micrófono al callar).
 */
export function puertosTelefono(d: {
  pararVozMesa: () => void | Promise<void>;
  cerrarBoca: () => void;
  soltarPausaMicrofono: () => void;
  enLlamada: () => boolean;
  /**
   * Callar lo que la conversación en vivo está diciendo, sin colgar (P2; compa/sesionVoz.ts, callarSalida):
   * la voz de la mesa no es el audio de la llamada. Sin esto, en la llamada callar lo dice (no finge).
   */
  callarLlamada?: () => ResultadoPuerto;
  colgar: () => ResultadoPuerto;
  api: ApiMin;
}): PuertosControl {
  return {
    pararAudio: async (): Promise<ResultadoPuerto> => {
      await d.pararVozMesa();
      d.cerrarBoca();
      // La voz cortada no llama a su onEnd: si la mesa había pausado su micrófono para hablar, se suelta
      // (sin eso quedaba sorda). En la llamada el micrófono es de la conversación: no se toca.
      if (!d.enLlamada()) {
        d.soltarPausaMicrofono();
        return { ok: true };
      }
      if (!d.callarLlamada) return { ok: false, detalle: 'Callé mi voz, pero no puedo callar el audio de la llamada.' };
      return d.callarLlamada();
    },
    colgar: () => d.colgar(),
    tarea: (que) => controlarTareaPc(que, d.api),
  };
}
