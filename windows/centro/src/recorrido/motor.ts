/**
 * EL MOTOR DEL RECORRIDO: en qué escena y en qué línea va, y qué hace con cada cosa que pasa (terminó
 * de hablar, la persona tocó, se acabó la espera, siguiente, atrás, pausa).
 *
 * Es el MISMO reductor del teléfono (mobile/src/recorrido/motor.ts; test/recorrido.test.mjs comprueba
 * que los dos contestan igual a la misma serie de acciones). Aquí vive su copia porque el del teléfono
 * arrastra los tipos de React. Cada vez que una línea (re)empieza sube `vuelta`, y los avisos traen la
 * vuelta en que se pidieron: un «terminó» de una línea que ya se saltó no mueve nada.
 */
import { ESCENAS, type Escena, type Linea } from './guion';

export type Fase = 'habla' | 'espera' | 'fin';

export type EstadoRecorrido = {
  e: number;
  l: number;
  fase: Fase;
  pausado: boolean;
  /** Sube cada vez que una línea empieza (o vuelve a empezar): la vista la habla otra vez. */
  vuelta: number;
  /** La persona tocó para llegar a esta línea (la animación responde al toque). */
  tocado: boolean;
};

export type AccionRecorrido =
  | { tipo: 'termino'; vuelta: number }
  | { tipo: 'toque' }
  | { tipo: 'esperaVencio'; vuelta: number }
  | { tipo: 'siguiente' }
  | { tipo: 'anterior' }
  | { tipo: 'ir'; e: number }
  | { tipo: 'pausa' }
  | { tipo: 'sigue' };

export const INICIO: EstadoRecorrido = { e: 0, l: 0, fase: 'habla', pausado: false, vuelta: 1, tocado: false };

export function escenaDe(s: EstadoRecorrido, escenas: readonly Escena[] = ESCENAS): Escena {
  return escenas[Math.min(s.e, escenas.length - 1)];
}

export function lineaDe(s: EstadoRecorrido, escenas: readonly Escena[] = ESCENAS): Linea {
  const e = escenaDe(s, escenas);
  return e.lineas[Math.min(s.l, e.lineas.length - 1)];
}

const empezar = (s: EstadoRecorrido, e: number, l: number): EstadoRecorrido => ({ e, l, fase: 'habla', pausado: false, vuelta: s.vuelta + 1, tocado: false });

function avanzar(s: EstadoRecorrido, escenas: readonly Escena[]): EstadoRecorrido {
  const e = escenas[s.e];
  if (s.l + 1 < e.lineas.length) return empezar(s, s.e, s.l + 1);
  if (s.e + 1 < escenas.length) return empezar(s, s.e + 1, 0);
  return { ...s, fase: 'fin', vuelta: s.vuelta + 1 };
}

export function reducir(s: EstadoRecorrido, a: AccionRecorrido, escenas: readonly Escena[] = ESCENAS): EstadoRecorrido {
  switch (a.tipo) {
    case 'termino': {
      if (a.vuelta !== s.vuelta || s.fase !== 'habla' || s.pausado) return s;
      return lineaDe(s, escenas).espera ? { ...s, fase: 'espera' } : avanzar(s, escenas);
    }
    case 'toque': {
      // Tocar mientras espera es la respuesta; tocar mientras todavía habla adelanta la espera.
      if (s.fase === 'fin' || !lineaDe(s, escenas).espera) return s;
      return { ...avanzar(s, escenas), tocado: true };
    }
    case 'esperaVencio': {
      if (a.vuelta !== s.vuelta || s.fase !== 'espera' || s.pausado) return s;
      const ms = lineaDe(s, escenas).espera?.ms ?? 0;
      return ms > 0 ? avanzar(s, escenas) : s;
    }
    case 'siguiente':
      if (s.fase === 'fin') return s;
      return s.e + 1 < escenas.length ? empezar(s, s.e + 1, 0) : { ...s, fase: 'fin', vuelta: s.vuelta + 1 };
    case 'anterior':
      if (s.fase !== 'fin' && s.l > 0) return empezar(s, s.e, 0);
      return empezar(s, Math.max(0, s.fase === 'fin' ? s.e : s.e - 1), 0);
    case 'ir':
      return empezar(s, Math.max(0, Math.min(escenas.length - 1, a.e)), 0);
    case 'pausa':
      return s.fase === 'fin' || s.pausado ? s : { ...s, pausado: true };
    case 'sigue':
      if (!s.pausado) return s;
      return s.fase === 'espera' ? { ...s, pausado: false, vuelta: s.vuelta + 1 } : { ...s, pausado: false, fase: 'habla', vuelta: s.vuelta + 1 };
  }
}

/** Cuánto lleva el recorrido, de 0 a 1 (por líneas). */
export function progreso(s: EstadoRecorrido, escenas: readonly Escena[] = ESCENAS): number {
  if (s.fase === 'fin') return 1;
  const total = escenas.reduce((n, e) => n + e.lineas.length, 0);
  const hechas = escenas.slice(0, s.e).reduce((n, e) => n + e.lineas.length, 0) + s.l;
  return total ? hechas / total : 0;
}
