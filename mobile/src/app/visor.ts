/**
 * EL VISOR DE SU COMPUTADORA: abierto o cerrado, y la sesión de cada tarea (AUR09). Sin React Native: un dato de
 * módulo con oyentes (useSyncExternalStore en la vista), como app/hojas.ts.
 *
 * El visor se abre SOLO cuando la persona lo pide desde la tarea (la hoja de su computadora): AURA nunca lo abre
 * sola ni lo reabre con cada avance. Cerrarlo vuelve al chat sin tocar la tarea; reabrirlo encuentra la misma sesión:
 * el mismo cliente, el control que tenía (época y secuencia), el zoom y el encuadre.
 */
import { BufferTeclado, LoteTeclado, SesionRemota, nuevoClienteId, type AckEntrada, type EntradaRemota, type VistaZoom } from '../lib/entradaRemota';

type EstadoVisor = { abierto: boolean; tareaId: string | null };

let estado: EstadoVisor = { abierto: false, tareaId: null };
const oyentes = new Set<() => void>();
/** El id de este visor: uno por app abierta (el servidor lo liga a la sesión; solo no da autoridad). */
let clienteId: string | null = null;
/** La sesión de cada tarea y su vista (zoom y centro): sobreviven a cerrar y reabrir el visor. */
const sesiones = new Map<string, { sesion: SesionRemota; vista: VistaZoom | null; lote: LoteTeclado; buffer: BufferTeclado }>();
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
    const sesion = new SesionRemota({ tareaId, clientId: clienteDelVisor(), enviar: (e) => enviarActual.get(tareaId)!(e), alCambio: () => cambioActual.get(tareaId)?.() });
    // El lote de teclado (A3) y el campo viven con la sesión: cerrar la vista pausa lo que falta y reabrirla lo encuentra.
    const lote = new LoteTeclado({ sesion, pedirImagen: () => imagenActual.get(tareaId)?.(), alCambio: () => cambioActual.get(tareaId)?.() });
    s = { sesion, vista: null, lote, buffer: new BufferTeclado() };
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
const imagenActual = new Map<string, () => void>();

/**
 * El lote de teclado y el campo de la tarea (los mismos al reabrir). `pedirImagen`: cómo pide la vista montada la
 * pantalla de ahora (el lote la pide tras cada ACK y cuando espera la imagen de después). Hace falta `sesionDe` antes.
 */
export function tecladoDe(tareaId: string, pedirImagen?: () => void): { lote: LoteTeclado; buffer: BufferTeclado } {
  const s = sesiones.get(tareaId);
  if (!s) throw new Error('tecladoDe: primero sesionDe');
  if (pedirImagen) imagenActual.set(tareaId, pedirImagen);
  return { lote: s.lote, buffer: s.buffer };
}

/** La vista se va: deja de pedir imágenes por ella (el lote, si iba, ya se pausó al cerrar). */
export function soltarImagen(tareaId: string, f: () => void) {
  if (imagenActual.get(tareaId) === f) imagenActual.delete(tareaId);
}

export function soltarOyente(tareaId: string, f: () => void) {
  if (cambioActual.get(tareaId) === f) cambioActual.delete(tareaId);
}

/**
 * Cambió la cuenta (salió, entró otra): el visor se cierra y se olvida todo lo de la anterior (sesiones, lo escrito que
 * faltaba, el cliente). Nada de A queda para B en un navegador compartido.
 */
export function olvidarVisor() {
  for (const { lote } of sesiones.values()) lote.descartar();
  sesiones.clear();
  enviarActual.clear();
  cambioActual.clear();
  imagenActual.clear();
  clienteId = null;
  if (estado.abierto || estado.tareaId) fijar({ abierto: false, tareaId: null });
}

export function vistaGuardada(tareaId: string): VistaZoom | null {
  return sesiones.get(tareaId)?.vista ?? null;
}

export function guardarVista(tareaId: string, v: VistaZoom) {
  const s = sesiones.get(tareaId);
  if (s) s.vista = v;
}
