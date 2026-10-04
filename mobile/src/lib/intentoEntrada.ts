/**
 * UN INTENTO DE ENTRAR, Y SOLO EL ÚLTIMO GUARDA (auditoría del 3-oct, AUTH03).
 *
 * Entrar es asíncrono de punta a punta: la clave viaja al servidor, la huella espera al sensor, la wallet
 * devuelve el pase cuando quiere (a veces media hora después). Con dos intentos en vuelo —A y, sin
 * esperar, B; o A, «atrás» y B— el que terminaba DESPUÉS guardaba su token aunque fuera el viejo: la
 * pantalla decía B y el teléfono hablaba con el servidor como A. Una guarda de pantalla («¿sigue
 * montada?») no alcanza: el token lo guarda la capa de abajo.
 *
 * Cada intento (correo y clave, huella, Genesis ID y su vuelta tardía) se abre aquí con su número y la
 * generación de la sesión (lib/cuenta.ts) en que empezó. Solo el ÚLTIMO, y con la misma generación,
 * puede escribir: el token, la sesión, la clave recordada. Lo que escribe un intento pasa por
 * `confirmarIntento`, de a uno: lo de dos intentos no se mezcla, y lo que un intento alcanzó a guardar
 * antes de quedar viejo se suelta si nadie escribió encima. Empezar otro intento, «atrás», desmontar la
 * pantalla, salir o entrar otra persona vencen al anterior.
 *
 * Sin intento no se entra (auditoría AUR15): antes las firmas de login lo aceptaban opcional y, sin él,
 * escribían «como antes» —un login que llegaba tarde, con otra persona ya dentro, guardaba su token—. Ahora
 * el intento es obligatorio en los tipos y, en tiempo de ejecución, solo vale uno que salió de
 * `empezarIntento` (un objeto con la misma forma, armado a mano, no): sin intento nada se manda ni se guarda.
 *
 * Sin React ni nada nativo más que el almacén (lo prueban las pruebas de identidad en node).
 */
import type { SessionUser } from '../config';
import { generacionCuenta, sigueVigente } from './cuenta';
import { loadMesaToken, loadSession, saveMesaToken, saveSession } from './storage';

declare const marcaIntento: unique symbol;
/** Un intento de entrar. Solo lo fabrica `empezarIntento` (la marca impide armarlo a mano en los tipos). */
export type Intento = { readonly id: number; readonly gen: number; readonly [marcaIntento]: true };

/** El último intento que empezó: solo ese escribe. */
let ultimo = 0;
/** Los intentos que salieron de aquí (uno armado a mano no está, aunque tenga la misma forma). */
const emitidos = new WeakSet<object>();
/** Lo que guardó el último intento que llegó a escribir (para soltarlo si queda viejo). */
let escrito: { id: number; token?: string; correo?: string } | null = null;
/** Las escrituras de entrada, de a una. */
let cola: Promise<unknown> = Promise.resolve();

export function empezarIntento(): Intento {
  const i = Object.freeze({ id: ++ultimo, gen: generacionCuenta() }) as Intento;
  emitidos.add(i);
  return i;
}

/** ¿Es un intento de verdad (salió de `empezarIntento`), el último, y en la misma sesión? Sin intento, no. */
export function intentoVigente(i: Intento | null | undefined): boolean {
  return !!i && emitidos.has(i) && i.id === ultimo && sigueVigente(i.gen);
}

/** «Atrás», cancelar o desmontar la pantalla: vence a ESE intento si es el último (no a uno más nuevo). */
export function cancelarIntento(i: Intento | null | undefined) {
  if (i && i.id === ultimo) ultimo++;
}

/**
 * Lo que devuelve quien llegó tarde: su intento (o la sesión de su petición) ya no es el de ahora. No es
 * un fallo de red ni una clave mala: la pantalla no dice nada y no entra en modo local.
 */
export function vencida(): Error {
  return Object.assign(new Error('ya no es de la sesión de ahora'), { code: 'vencida' });
}

export function esVencida(e: unknown): boolean {
  return !!e && (e as { code?: unknown }).code === 'vencida';
}

function enCola<T>(f: () => Promise<T>): Promise<T> {
  const p = cola.then(f, f);
  cola = p.catch(() => undefined);
  return p;
}

/** Suelta lo que guardó `i`, solo si sigue siendo suyo: si otro escribió después, no se toca. */
async function soltar(i: Intento) {
  if (escrito?.id !== i.id) return;
  const { token, correo } = escrito;
  escrito = null;
  if (token && (await loadMesaToken().catch(() => '')) === token) await saveMesaToken(null).catch(() => {});
  if (correo && String((await loadSession().catch(() => null))?.correo || '').trim().toLowerCase() === correo) await saveSession(null).catch(() => {});
}

/** Lo que un intento puede hacer mientras escribe. */
export type Escritura = {
  /** ¿Sigue siendo el intento vigente? Se mira después de cada `await`. */
  sigue: () => boolean;
  /** Guarda el token de la mesa y anota que es de este intento. */
  token: (t: string) => Promise<void>;
  /** Guarda la sesión y anota que es de este intento. */
  sesion: (s: SessionUser) => Promise<void>;
};

/**
 * La escritura de un intento: corre sola (ninguna otra escritura de entrada en medio) y solo si el
 * intento sigue siendo el vigente al empezar. Si `escribir` devuelve false —quedó viejo a medias— o el
 * intento ya estaba vencido, lo que ESTE intento alcanzó a guardar (aquí o en un paso anterior) se
 * suelta. true = quedó escrito. Sin intento (o con uno que no salió de `empezarIntento`) no escribe nada.
 */
export function confirmarIntento(i: Intento, escribir: (e: Escritura) => Promise<boolean | void>): Promise<boolean> {
  return enCola(async () => {
    if (!intentoVigente(i)) {
      if (i && emitidos.has(i)) await soltar(i);
      return false;
    }
    const anotar = (cambio: { token?: string; correo?: string }) => {
      escrito = { ...(escrito?.id === i.id ? escrito : {}), id: i.id, ...cambio };
    };
    const r = await escribir({
      sigue: () => intentoVigente(i),
      token: async (t) => {
        await saveMesaToken(t);
        anotar({ token: t });
      },
      sesion: async (s) => {
        await saveSession(s);
        anotar({ correo: String(s.correo || '').trim().toLowerCase() });
      },
    });
    if (r === false) {
      await soltar(i);
      return false;
    }
    return true;
  });
}

/**
 * El token que devolvió el servidor al entrar (clave, huella o Genesis ID), guardado SOLO si el intento
 * sigue siendo el de ahora. Si «atrás» o un intento nuevo lo vencieron mientras se guardaba, se suelta.
 * false = no quedó (el intento ya no vale, o no hubo intento).
 */
export function guardarTokenDeEntrada(token: string, i: Intento): Promise<boolean> {
  return confirmarIntento(i, async (e) => {
    await e.token(token);
    return e.sigue();
  });
}
