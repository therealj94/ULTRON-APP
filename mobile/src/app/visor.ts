/**
 * EL VISOR DE SU COMPUTADORA: abierto o cerrado, y la sesión de cada tarea (AUR09). Sin React Native: un dato de
 * módulo con oyentes (useSyncExternalStore en la vista), como app/hojas.ts.
 *
 * El visor se abre SOLO cuando la persona lo pide desde la tarea (la hoja de su computadora): AURA nunca lo abre
 * sola ni lo reabre con cada avance. Cerrarlo vuelve al chat sin tocar la tarea; reabrirlo encuentra la misma sesión:
 * el mismo cliente, el control que tenía (época y secuencia), el zoom y el encuadre.
 *
 * DE QUIÉN ES (revisión 9): todo lo de aquí es de la cuenta que lo abrió. En el teléfono, cambiar de cuenta (salir,
 * entrar otra) lo olvida en el acto (oye `alCambiarCuenta`); en la web lo olvida App.tsx al cambiar la cuenta. Y por si
 * algo quedara, cada cosa lleva la MARCA con que se abrió (generación de la cuenta y época del visor): con otra marca,
 * leerla da vacío, reanudarla no manda nada y abrir con una marca vieja (un `await` que volvió tarde) no abre.
 */
import { BufferTeclado, LoteTeclado, SesionRemota, nuevoClienteId, type AckEntrada, type EntradaRemota, type VistaZoom } from '../lib/entradaRemota';
import { alCambiarCuenta, generacionCuenta } from '../lib/generacionCuenta';

type EstadoVisor = { abierto: boolean; tareaId: string | null };

/** De qué cuenta y de qué época del visor es algo. La captura quien empieza algo asíncrono (`marcaVisor`). */
export type MarcaVisor = { cuenta: number; epoca: number };
/** Sube cada vez que el visor se olvida (cambio de cuenta en el teléfono o en la web). */
let epoca = 0;

export function marcaVisor(): MarcaVisor {
  return { cuenta: generacionCuenta(), epoca };
}

function vigente(m: MarcaVisor): boolean {
  return m.cuenta === generacionCuenta() && m.epoca === epoca;
}

const CERRADO: EstadoVisor = Object.freeze({ abierto: false, tareaId: null }) as EstadoVisor;
let estado: EstadoVisor = CERRADO;
let marcaEstado: MarcaVisor = marcaVisor();
const oyentes = new Set<() => void>();
/** El id de este visor: uno por app abierta (el servidor lo liga a la sesión; solo no da autoridad). */
let clienteId: string | null = null;
type Entrada = { sesion: SesionRemota; vista: VistaZoom | null; lote: LoteTeclado; buffer: BufferTeclado; marca: MarcaVisor };
/** La sesión de cada tarea y su vista (zoom y centro): sobreviven a cerrar y reabrir el visor. */
const sesiones = new Map<string, Entrada>();
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

/**
 * Lo abre la persona desde su tarea. `marca`: la que se capturó antes de un `await` (si la cuenta cambió en medio, no
 * abre y devuelve false); sin ella, la de ahora.
 */
export function abrirVisor(tareaId: string, marca: MarcaVisor = marcaVisor()): boolean {
  if (!vigente(marca)) return false;
  marcaEstado = marca;
  fijar({ abierto: true, tareaId });
  return true;
}

/** La misión siguió con otra tarea: el visor abierto la sigue (cerrado, no se abre). */
export function seguirEnVisor(tareaId: string) {
  const v = visorAhora();
  if (v.abierto && v.tareaId !== tareaId) fijar({ abierto: true, tareaId });
}

/** Volver al chat: la tarea sigue (y el control, si lo tenía, sigue siendo suyo). */
export function cerrarVisor() {
  if (visorAhora().abierto) fijar({ ...estado, abierto: false });
}

/** El visor de ahora; si lo abrió otra cuenta (u otra época), cerrado y sin tarea. */
export function visorAhora(): EstadoVisor {
  return vigente(marcaEstado) ? estado : CERRADO;
}

export function visorAbierto(): boolean {
  return visorAhora().abierto;
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

/** La sesión de la tarea si es de esta cuenta; la de otra se suelta aquí mismo (nada de ella se lee ni se reanuda). */
function propia(tareaId: string): Entrada | undefined {
  const s = sesiones.get(tareaId);
  if (!s) return undefined;
  if (vigente(s.marca)) return s;
  soltarEntrada(s);
  sesiones.delete(tareaId);
  enviarActual.delete(tareaId);
  cambioActual.delete(tareaId);
  imagenActual.delete(tareaId);
  return undefined;
}

function soltarEntrada(s: Entrada) {
  s.lote.descartar();
  // El campo también se vacía: una vista vieja que aún lo tuviera en la mano no enseña lo que escribió la otra cuenta.
  s.buffer.aplicado();
  // Lo que estuviera en cola de esa sesión ya no sale (su generación cambia).
  s.sesion.alDesconectar();
}

/** El envío de una sesión que ya no es la vigente de su tarea (otra cuenta, o se olvidó): no sale nada. */
const vencida = () => Promise.reject(Object.assign(new Error('El visor era de otra sesión.'), { status: 409, data: { code: 'cliente' } }));

/** La sesión de la tarea (la misma al reabrir). `enviar` es la llamada al servidor. */
export function sesionDe(tareaId: string, enviar: (e: EntradaRemota) => Promise<AckEntrada>, alCambio?: () => void): SesionRemota {
  let s = propia(tareaId);
  if (!s) {
    const marca = marcaVisor();
    // Cada envío comprueba que esta sesión siga siendo la de su tarea y de esta cuenta: una referencia vieja (la vista
    // de A que se desmonta, un lote que reanuda) nunca sale con el envío de quien entró después.
    const esLaVigente = () => sesiones.get(tareaId) === s && vigente(marca);
    const sesion = new SesionRemota({
      tareaId,
      clientId: clienteDelVisor(),
      enviar: (e) => (esLaVigente() ? enviarActual.get(tareaId)?.(e) ?? vencida() : vencida()),
      alCambio: () => {
        if (esLaVigente()) cambioActual.get(tareaId)?.();
      },
    });
    // El lote de teclado (A3) y el campo viven con la sesión: cerrar la vista pausa lo que falta y reabrirla lo encuentra.
    const lote = new LoteTeclado({
      sesion,
      pedirImagen: () => {
        if (esLaVigente()) imagenActual.get(tareaId)?.();
      },
      alCambio: () => {
        if (esLaVigente()) cambioActual.get(tareaId)?.();
      },
    });
    s = { sesion, vista: null, lote, buffer: new BufferTeclado(), marca };
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
  const s = propia(tareaId);
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
 * faltaba, el cliente). Nada de A queda para B en un navegador o un teléfono compartido.
 */
export function olvidarVisor() {
  epoca++;
  for (const s of sesiones.values()) soltarEntrada(s);
  sesiones.clear();
  enviarActual.clear();
  cambioActual.clear();
  imagenActual.clear();
  clienteId = null;
  marcaEstado = marcaVisor();
  // Siempre avisa: lo que se pintaba con el visor de antes (vigente o no) deja de pintarse.
  fijar(CERRADO);
}

// En el teléfono, cada cambio de cuenta (lib/cuenta.ts → fijarCuenta) olvida el visor en el acto, antes de que la
// persona nueva vea una pantalla. En la web nadie abre generaciones: no se dispara (allí lo olvida App.tsx).
alCambiarCuenta(olvidarVisor);

export function vistaGuardada(tareaId: string): VistaZoom | null {
  return propia(tareaId)?.vista ?? null;
}

export function guardarVista(tareaId: string, v: VistaZoom) {
  const s = propia(tareaId);
  if (s) s.vista = v;
}
