/**
 * SEGUIR UNA RECARGA EN CAMINO (la pestaña Veta Wallet, veta/SeccionTarjeta.tsx): se pregunta cada tanto en
 * qué va hasta que se acredita, falla o pasan 10 minutos.
 *
 * Es de la sesión que la empezó (auditoría AUR01): antes la consulta que volvía tarde —la persona ya había
 * salido de la pestaña, de Veta o de AURA, y quizá estaba otra— igual pintaba su estado. Ahora cada vuelta
 * mira `vale()` antes de preguntar y otra vez al volver; `parar()` (salir de la pestaña, desmontar, otra
 * recarga) suelta lo que esté en vuelo. Dos consultas no se pisan: hasta que vuelve una no sale la siguiente.
 *
 * Sin React ni nada nativo (lo prueban las pruebas de veta en node).
 */
import type { Recarga } from './sesion';

export const CONSULTA_RECARGA_MS = 6_000;
export const ESPERA_RECARGA_MS = 10 * 60_000;

export type Seguimiento = {
  /** Pregunta en qué va (tarjeta.estadoRecarga). */
  consultar: () => Promise<Recarga>;
  /** ¿Sigue valiendo lo que llegue? (la misma sesión de Veta y de AURA, la pestaña a la vista) */
  vale: () => boolean;
  /** Desde cuándo se espera (para el tope). */
  desde: number;
  /** Un estado nuevo, ya comprobado que es de esta sesión. */
  alEstado: (r: Recarga) => void;
  /** Pasó el tope sin acreditarse. */
  alTope: () => void;
  cadaMs?: number;
  topeMs?: number;
};

const terminada = (r: Recarga | null | undefined) => r?.status === 'funded' || r?.status === 'failed';

/** Empieza a seguir la recarga. Devuelve cómo pararla (lo que esté en vuelo ya no se publica). */
export function seguirRecarga(o: Seguimiento): () => void {
  let parado = false;
  let preguntando = false;
  const parar = () => {
    parado = true;
    clearInterval(t);
  };
  const vuelta = async () => {
    if (parado || preguntando) return;
    if (!o.vale()) return parar();
    if (Date.now() - o.desde > (o.topeMs ?? ESPERA_RECARGA_MS)) {
      parar();
      o.alTope();
      return;
    }
    preguntando = true;
    let r: Recarga;
    try {
      r = await o.consultar();
    } catch {
      return; /* se reintenta en la próxima vuelta (una de otra sesión, abajo se para) */
    } finally {
      preguntando = false;
    }
    // Volvió cuando ya no era de nadie aquí (paró, salió de Veta o de AURA): no se publica ni se sigue.
    if (parado) return;
    if (!o.vale()) return parar();
    if (terminada(r)) parar();
    o.alEstado(r);
  };
  const t = setInterval(() => void vuelta(), o.cadaMs ?? CONSULTA_RECARGA_MS);
  return parar;
}
