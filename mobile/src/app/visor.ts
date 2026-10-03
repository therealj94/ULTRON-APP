/**
 * EL VISOR DE SU COMPUTADORA: abierto o cerrado, y la sesión de cada tarea (AUR09). Sin React Native: un dato de
 * módulo con oyentes (useSyncExternalStore en la vista), como app/hojas.ts.
 *
 * El visor se abre SOLO cuando la persona lo pide desde la tarea (la hoja de su computadora): AURA nunca lo abre
 * sola ni lo reabre con cada avance. Cerrarlo vuelve al chat sin tocar la tarea; reabrirlo encuentra la misma sesión:
 * el mismo cliente, el control que tenía (época y secuencia), el zoom y el encuadre.
 */
import { SesionRemota, nuevoClienteId, type AckEntrada, type EntradaRemota, type VistaZoom } from '../lib/entradaRemota';

type EstadoVisor = { abierto: boolean; tareaId: string | null };

let estado: EstadoVisor = { abierto: false, tareaId: null };
const oyentes = new Set<() => void>();
/** El id de este visor: uno por app abierta (el servidor lo liga a la sesión; solo no da autoridad). */
let clienteId: string | null = null;
/** La sesión de cada tarea y su vista (zoom y centro): sobreviven a cerrar y reabrir el visor. */
const sesiones = new Map<string, { sesion: SesionRemota; vista: VistaZoom | null }>();
const SESIONES_MAX = 6;

function fijar(e: EstadoVisor) {
  estado = e;
  for (const f of [...oyentes]) {
    try {
      f();
    } catch {
      /* un oyente roto no rompe nada */
    }
  }
}

/** Lo abre la persona desde su tarea. */
export function abrirVisor(tareaId: string) {
  fijar({ abierto: true, tareaId });
}

/** La misión siguió con otra tarea: el visor abierto la sigue (cerrado, no se abre). */
export function seguirEnVisor(tareaId: string) {
  if (estado.abierto && estado.tareaId !== tareaId) fijar({ abierto: true, tareaId });
}

/** Volver al chat: la tarea sigue (y el control, si lo tenía, sigue siendo suyo). */
export function cerrarVisor() {
  if (estado.abierto) fijar({ ...estado, abierto: false });
}

export function visorAhora(): EstadoVisor {
  return estado;
}

export function visorAbierto(): boolean {
  return estado.abierto;
}

export function suscribirVisor(f: () => void): () => void {
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
}

export function clienteDelVisor(): string {
  if (!clienteId) clienteId = nuevoClienteId();
  return clienteId;
}

/** La sesión de la tarea (la misma al reabrir). `enviar` es la llamada al servidor. */
export function sesionDe(tareaId: string, enviar: (e: EntradaRemota) => Promise<AckEntrada>, alCambio?: () => void): SesionRemota {
  let s = sesiones.get(tareaId);
  if (!s) {
    s = { sesion: new SesionRemota({ tareaId, clientId: clienteDelVisor(), enviar: (e) => enviarActual.get(tareaId)!(e), alCambio: () => cambioActual.get(tareaId)?.() }), vista: null };
    sesiones.set(tareaId, s);
    while (sesiones.size > SESIONES_MAX) sesiones.delete(sesiones.keys().next().value!);
  }
  enviarActual.set(tareaId, enviar);
  if (alCambio) cambioActual.set(tareaId, alCambio);
  return s.sesion;
}
/** La vista montada de ahora pone su envío y su oyente (al reabrir, la sesión es la misma y la vista otra). */
const enviarActual = new Map<string, (e: EntradaRemota) => Promise<AckEntrada>>();
const cambioActual = new Map<string, () => void>();

export function soltarOyente(tareaId: string, f: () => void) {
  if (cambioActual.get(tareaId) === f) cambioActual.delete(tareaId);
}

export function vistaGuardada(tareaId: string): VistaZoom | null {
  return sesiones.get(tareaId)?.vista ?? null;
}

export function guardarVista(tareaId: string, v: VistaZoom) {
  const s = sesiones.get(tareaId);
  if (s) s.vista = v;
}
