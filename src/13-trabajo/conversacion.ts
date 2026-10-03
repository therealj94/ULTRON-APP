/**
 * La conversación que se ve en pantalla: lo que dijo la persona, lo que contestó AU-RA con el
 * estado de cada turno, y las tarjetas de las acciones que salen del sistema.
 *
 * Dónde vive (y por qué): en `sessionStorage`, con una clave por cuenta. Sobrevive a recargar la
 * página, no sobrevive a cerrar la pestaña, y al cerrar sesión o cambiar de cuenta se borra la de
 * quien se fue: en una tableta compartida, quien entra después no ve lo que se habló antes. Esto es
 * solo la vista; la memoria de AU-RA (09-estado/memoria.ts) es otra cosa y no se toca desde aquí.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccionSensible } from './accionSensible';
import type { RefTarea } from '../../mobile/src/lib/trabajos';
import { avisarTrabajoLibre, registrarTrabajoActivo } from '../10-infra/trabajoActivo';

export type EstadoTurno = 'pensando' | 'usando' | 'respondiendo' | 'lista' | 'error' | 'interrumpida';
export type EstadoAccion = 'propuesta' | 'enviando' | 'hecha' | 'fallida' | 'espera' | 'sin-confirmar' | 'cancelada';

export type EntradaPersona = { id: string; tipo: 'persona'; texto: string; ts: number; conFoto?: boolean };
export type EntradaAura = {
  id: string;
  tipo: 'aura';
  texto: string;
  ts: number;
  estado: EstadoTurno;
  herramientas: string[];
  /** Cuánto tardó el turno, según el servidor. */
  ms?: number;
  tsFin?: number;
  trazaId?: string;
  /** Las tareas durables que dejó este turno (AUR08): la burbuja las enlaza aunque el panel esté cerrado. */
  tareas?: RefTarea[];
};
export type EntradaAccion = {
  id: string;
  tipo: 'accion';
  ts: number;
  accion: AccionSensible;
  /** Lo que se pidió, tal cual: es lo que viaja al servidor si se confirma. */
  pedido: string;
  estado: EstadoAccion;
  resultado?: string;
  tsResultado?: number;
};
export type Entrada = EntradaPersona | EntradaAura | EntradaAccion;

/** Tope de lo que se guarda: la vista, no un archivo. */
export const MAX_ENTRADAS = 150;
const MAX_TEXTO = 8000;
const PREFIJO = 'aura_conversacion:';

export const claveDe = (cuenta: string | null) => PREFIJO + (cuenta ? cuenta.trim().toLowerCase() : 'invitado');

let contador = 0;
export const nuevoId = () => `${Date.now().toString(36)}-${(contador++).toString(36)}`;

export function leerGuardada(cuenta: string | null, almacen: Pick<Storage, 'getItem'> | null = almacenDeSesion()): Entrada[] {
  try {
    const raw = almacen?.getItem(claveDe(cuenta));
    const xs = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(xs)) return [];
    // Un turno que quedó a medias al recargar ya no va a terminar: se marca interrumpido.
    return xs
      .filter((x) => x && typeof x.id === 'string' && (x.tipo === 'persona' || x.tipo === 'aura' || x.tipo === 'accion'))
      .map((x: Entrada) => {
        if (x.tipo === 'aura' && (x.estado === 'pensando' || x.estado === 'usando' || x.estado === 'respondiendo')) return { ...x, estado: 'interrumpida' as const };
        if (x.tipo === 'accion' && x.estado === 'enviando') return { ...x, estado: 'sin-confirmar' as const, resultado: x.resultado || 'La página se recargó antes de saber el resultado.' };
        return x;
      })
      .slice(-MAX_ENTRADAS);
  } catch {
    return [];
  }
}

export function guardar(cuenta: string | null, xs: Entrada[], almacen: Pick<Storage, 'setItem' | 'removeItem'> | null = almacenDeSesion()) {
  try {
    if (!xs.length) almacen?.removeItem(claveDe(cuenta));
    else almacen?.setItem(claveDe(cuenta), JSON.stringify(xs.slice(-MAX_ENTRADAS)));
  } catch {
    /* sin almacenamiento o lleno: la conversación sigue en pantalla */
  }
}

export function borrarGuardada(cuenta: string | null, almacen: Pick<Storage, 'removeItem'> | null = almacenDeSesion()) {
  try {
    almacen?.removeItem(claveDe(cuenta));
  } catch {
    /* */
  }
}

function almacenDeSesion(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

const recortar = (t: string) => String(t || '').slice(0, MAX_TEXTO);

/**
 * ¿Hay una decisión abierta (una tarjeta esperando su «confirmar» o un envío sin resultado)? Mientras la
 * haya, la PWA no aplica una versión nueva encima (AUR14, 10-infra/trabajoActivo.ts).
 */
export function hayDecisionAbierta(xs: readonly Entrada[]): boolean {
  return xs.some((x) => x.tipo === 'accion' && (x.estado === 'propuesta' || x.estado === 'enviando'));
}

/**
 * `cuenta`: el nombre de quien tiene la sesión, o null sin sesión. Al cambiar, se borra lo guardado
 * de la cuenta anterior y se carga lo de la nueva (que solo existe si recargó la página).
 */
export function useConversacion(cuenta: string | null) {
  const [entradas, setEntradas] = useState<Entrada[]>(() => leerGuardada(cuenta));
  const cuentaRef = useRef(cuenta);

  useEffect(() => {
    const antes = cuentaRef.current;
    if (antes === cuenta) return;
    cuentaRef.current = cuenta;
    // Se fue una cuenta (cerró sesión o entró otra persona): lo suyo no se queda en esta pestaña.
    // Lo que se habló sin sesión tampoco pasa a la cuenta que entra.
    borrarGuardada(antes);
    if (cuenta) borrarGuardada(null);
    setEntradas(leerGuardada(cuenta));
  }, [cuenta]);

  useEffect(() => guardar(cuentaRef.current, entradas), [entradas]);

  // Una decisión a medias no se corta con una recarga de versión (AUR14): cuenta como trabajo activo.
  const entradasRef = useRef(entradas);
  entradasRef.current = entradas;
  useEffect(() => registrarTrabajoActivo('decision', () => hayDecisionAbierta(entradasRef.current)), []);
  useEffect(() => {
    if (!hayDecisionAbierta(entradas)) avisarTrabajoLibre();
  }, [entradas]);

  const agregar = useCallback((e: Entrada) => {
    setEntradas((xs) => [...xs, e].slice(-MAX_ENTRADAS));
    return e.id;
  }, []);

  const persona = useCallback((texto: string, o: { conFoto?: boolean } = {}) => agregar({ id: nuevoId(), tipo: 'persona', texto: recortar(texto), ts: Date.now(), conFoto: o.conFoto }), [agregar]);

  const aura = useCallback(
    (texto = '', estado: EstadoTurno = 'pensando') => agregar({ id: nuevoId(), tipo: 'aura', texto: recortar(texto), ts: Date.now(), estado, herramientas: [], tsFin: estado === 'lista' ? Date.now() : undefined }),
    [agregar]
  );

  const proponer = useCallback((accion: AccionSensible, pedido: string) => agregar({ id: nuevoId(), tipo: 'accion', ts: Date.now(), accion, pedido: recortar(pedido), estado: 'propuesta' }), [agregar]);

  /** Cambia una entrada; `f` recibe la actual (para ir sumando texto del stream). */
  const actualizar = useCallback(<T extends Entrada>(id: string, f: Partial<T> | ((e: T) => Partial<T>)) => {
    setEntradas((xs) =>
      xs.map((x) => {
        if (x.id !== id) return x;
        const cambio = typeof f === 'function' ? f(x as T) : f;
        const nueva = { ...x, ...cambio } as Entrada;
        if ('texto' in nueva) (nueva as EntradaAura).texto = recortar((nueva as EntradaAura).texto);
        return nueva;
      })
    );
  }, []);

  const vaciar = useCallback(() => {
    borrarGuardada(cuentaRef.current);
    setEntradas([]);
  }, []);

  return { entradas, persona, aura, proponer, actualizar, vaciar };
}

export type Conversacion = ReturnType<typeof useConversacion>;
