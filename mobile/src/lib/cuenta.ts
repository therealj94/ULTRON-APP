/**
 * QUIÉN ESTÁ DENTRO, Y DESDE CUÁNDO: la generación de la sesión.
 *
 * Un teléfono compartido cambia de persona con operaciones a medias: una lectura del perfil de A que
 * llega tarde, el logout de A que termina después de que B entró, una renovación del token que vuelve
 * cuando ya no es de nadie. Comparar el correo no basta (A → B → A: la operación vieja de A se parece
 * a la nueva). Cada cambio de persona —y cada salida— abre una GENERACIÓN nueva: quien empieza algo
 * asíncrono captura la generación y, después de cada `await`, comprueba que sigue siendo la misma
 * antes de aplicar, guardar, publicar o navegar.
 *
 * Sin React ni nada nativo (lo prueban las pruebas en node). Lo fija la sesión (app/sesion.ts).
 */
import { sha256 } from '@noble/hashes/sha2';

let correo = '';
let generacion = 0;
const oyentes = new Set<() => void>();

const normal = (c: string | null | undefined) => String(c || '').trim().toLowerCase();

/**
 * La persona que está dentro (o nadie, con null). Cambiar de persona abre una generación nueva;
 * `nueva: true` la abre aunque sea la misma (salir y volver a entrar, o una sesión que cayó).
 */
export function fijarCuenta(c: string | null | undefined, o: { nueva?: boolean } = {}): number {
  const n = normal(c);
  if (n !== correo || o.nueva) {
    correo = n;
    generacion++;
    // En el acto, sin esperar a nada: lo que tenga sesiones propias (Veta Wallet) corta lo que tenía en
    // vuelo y suelta lo que tenía en memoria antes de que la persona nueva vea una sola pantalla.
    for (const f of [...oyentes]) {
      try {
        f();
      } catch {
        /* un oyente roto no deja la cuenta a medias */
      }
    }
  }
  return generacion;
}

/** Avisa cada cambio de generación (salir, entrar otra persona, o la misma de nuevo). Devuelve cómo dejar de oír. */
export function alCambiarCuenta(f: () => void): () => void {
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
}

/** El correo de quien está dentro, o '' si no hay nadie. */
export function correoCuenta(): string {
  return correo;
}

export function generacionCuenta(): number {
  return generacion;
}

/** ¿Sigue vigente la generación que se capturó al empezar? */
export function sigueVigente(g: number): boolean {
  return g === generacion;
}

/**
 * Un nombre estable y seudónimo de una cuenta, para marcar lo que queda en el sistema del teléfono
 * (los avisos programados de Android los ve cualquiera que liste las notificaciones): no lleva el
 * correo, pero la misma cuenta da siempre el mismo.
 */
export function seudonimoDe(c: string | null | undefined): string {
  const n = normal(c);
  if (!n) return '';
  // UTF-8 a mano (como candado.ts): sin depender de TextEncoder en el motor del teléfono.
  const b = unescape(encodeURIComponent(`aura-dueno:${n}`));
  const bytes = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) bytes[i] = b.charCodeAt(i);
  const h = sha256(bytes);
  let s = '';
  for (let i = 0; i < 8; i++) s += h[i].toString(16).padStart(2, '0');
  return `u${s}`;
}

/** El seudónimo de quien está dentro ('' sin nadie). */
export function seudonimoActual(): string {
  return seudonimoDe(correo);
}

/** Solo pruebas. */
export function _reiniciarCuenta() {
  correo = '';
  generacion = 0;
}
