/**
 * EL ESCRITORIO DE SU COMPUTADORA EN LA WEB, LA LÓGICA (auditoría del 4-oct, U1 / paquete P3).
 *
 * La app Expo ya tiene un visor dedicado (mobile/src/app/VisorComputadora.tsx) con toda su lógica en
 * mobile/src/lib/entradaRemota.ts (coordenadas, sesión con épocas y ACK, frescura del frame, lote de teclado) y el
 * estado abierto/cerrado y la sesión de cada tarea en mobile/src/app/visor.ts. La web NO tenía nada: aquí está el
 * adaptador que lo reutiliza tal cual, igual que 13-trabajo/Trabajos.tsx reutiliza mobile/src/lib/trabajos.ts.
 *
 * Solo lo que cambia entre teléfono y navegador: cómo se llama al servidor (fetch con la sesión de la mesa), qué tarea
 * de la computadora corresponde a una tarea durable, el teclado físico y la rueda del ratón. Las rutas son las que ya
 * existen (server/computadora.ts: /api/computadora, /tareas/:id, /control, /entrada, /pantalla, /seguro…): el servidor
 * y el nodo siguen siendo el árbitro, sin otra plataforma remota (ni noVNC ni un iframe).
 */
import { comboPermitido, type Mod } from '../../mobile/src/lib/entradaRemota';

/** Un error del servidor con la forma que espera `SesionRemota` (status y data.code); sin status = no llegó. */
export type ErrorPc = Error & { status?: number; data?: any };

export type PedirPc = <T = any>(ruta: string, init?: { method?: string; body?: string }) => Promise<T>;

/** fetch con las cabeceras de la mesa; un 4xx/5xx se lanza con su status y su cuerpo, un fallo de red sin status. */
export function crearPedirPc(cabeceras: () => Record<string, string>, f: typeof fetch = (ruta, init) => fetch(ruta, init)): PedirPc {
  return async <T,>(ruta: string, init?: { method?: string; body?: string }) => {
    let r: Response;
    try {
      r = await f(ruta, { method: init?.method || 'GET', body: init?.body, headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...cabeceras() } });
    } catch (e: any) {
      throw Object.assign(new Error(String(e?.message || 'sin red')), { status: undefined }) as ErrorPc;
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(String(data?.error || `HTTP ${r.status}`)), { status: r.status, data }) as ErrorPc;
    return data as T;
  };
}

/**
 * La tarea de la computadora que se abre desde una tarea durable. `environment.id` es el id de la tarea de la
 * computadora (misiones que no nacieron de una durable) o el de su MISIÓN (encargos del chat): la misión se pregunta
 * primero y da su tarea de ahora; si no es una misión, el id se toma como tarea (el servidor revisa que sea suya). Sin
 * id todavía («pendiente»), la tarea actual de su computadora.
 */
export async function tareaDelEscritorio(entornoId: string | null | undefined, pedir: PedirPc): Promise<string | null> {
  const id = String(entornoId || '').trim();
  if (id && id !== 'pendiente' && /^[A-Za-z0-9._:-]{1,80}$/.test(id)) {
    try {
      const r = await pedir<{ mision?: { tareaId?: string } }>(`/api/computadora/misiones/${encodeURIComponent(id)}`);
      if (r?.mision?.tareaId) return String(r.mision.tareaId);
    } catch (e: any) {
      if (e?.status !== 404) throw e;
    }
    return id;
  }
  const s = await pedir<{ actual?: { id?: string } | null }>('/api/computadora');
  return s?.actual?.id ? String(s.actual.id) : null;
}

const TECLAS_FISICAS: Record<string, string> = {
  Enter: 'enter',
  Tab: 'tab',
  Escape: 'escape',
  Backspace: 'backspace',
  Delete: 'delete',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Home: 'home',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown',
  F5: 'f5',
};

/**
 * Una tecla del teclado físico sobre el escritorio: las especiales y las combinaciones de la lista blanca (la misma del
 * servidor y del nodo). El texto NO va tecla por tecla: se escribe en el campo (con su IME) y sale compuesto.
 * `null`: no es para el escritorio (se queda en el navegador). Durante una composición del IME, nunca.
 */
export function teclaDeEvento(e: { key: string; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean; isComposing?: boolean }): { tecla: string; mods: Mod[] } | null {
  if (e.isComposing || e.metaKey) return null;
  const mods: Mod[] = [];
  if (e.ctrlKey) mods.push('ctrl');
  if (e.shiftKey) mods.push('shift');
  if (e.altKey) mods.push('alt');
  const tecla = TECLAS_FISICAS[e.key] ?? (e.key === ' ' ? 'space' : e.key.length === 1 && (e.ctrlKey || e.altKey) ? e.key.toLowerCase() : null);
  if (!tecla) return null;
  return comboPermitido(mods, tecla) ? { tecla, mods } : null;
}

/** La rueda del ratón en pasos de rueda del escritorio (positivo = bajar), como mucho 10 por evento. */
export function pasosRueda(deltaY: number, deltaMode = 0): number {
  const px = deltaMode === 1 ? deltaY * 40 : deltaMode === 2 ? deltaY * 800 : deltaY;
  if (!Number.isFinite(px) || px === 0) return 0;
  return Math.max(-10, Math.min(10, Math.sign(px) * Math.max(1, Math.round(Math.abs(px) / 100))));
}
