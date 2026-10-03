/**
 * UNA FRASE, UN TURNO. La mesa del teléfono reintenta un turno que falla (el stream se corta → JSON →
 * otro JSON): hasta tres turnos en el servidor por una sola frase, con el hilo repetido y las
 * herramientas o acciones hechas otra vez. Ahora el cliente manda un `idTurno` por frase y lo repite en
 * sus reintentos; aquí se recuerda, por quién habla + ese id, el turno en curso o terminado hace poco:
 *   · si sigue en curso, el reintento lo ESPERA (no corre otro en paralelo);
 *   · si terminó con respuesta, el reintento recibe esa misma respuesta (`repetido: true`);
 *   · si terminó sin respuesta (error, cortado), el reintento corre un turno nuevo: para eso reintenta.
 * En memoria y por poco tiempo (VIDA_MS, a lo más MAX_TURNOS): solo tiene que cubrir los reintentos.
 */

/** Lo que se repite de un turno: lo mismo que lleva el `done` del stream y el JSON de /api/turno. */
export type TurnoGuardado = {
  reply: string;
  voz: string;
  emocion: string;
  via: string;
  mode?: string;
  ms?: number;
  herramientas: string[];
  acciones?: unknown;
  trazaId?: string;
  /** El cerebro se cortó a media respuesta: un reintento lo repite marcado igual (Codex en #138). */
  parcial?: boolean;
};

type Entrada = { promesa: Promise<TurnoGuardado | null>; hecho: boolean; ts: number };

export const VIDA_MS = 2 * 60_000;
export const MAX_TURNOS = 500;
/** Lo más que un reintento espera al turno en curso (un turno largo anda por 70 s, el tope del cliente). */
export const ESPERA_MAX_MS = 75_000;

const turnos = new Map<string, Entrada>();

/** El id que manda el cliente: un texto corto y sin rarezas. Cualquier otra cosa, sin id (como antes). */
export function idTurnoValido(v: unknown): string | null {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(v) ? v : null;
}

/**
 * La clave: QUIÉN lo dice según el servidor (el correo de la sesión, o el aparato/IP sin sesión), nunca
 * un correo del cuerpo, más el id del cliente. Así nadie recibe la respuesta de otro adivinando un id.
 */
export function claveTurno(quien: string, idTurno: unknown): string | null {
  const id = idTurnoValido(idTurno);
  return id && quien ? `${quien.toLowerCase()}|${id}` : null;
}

function podar(ahora = Date.now()) {
  for (const [k, e] of turnos) if (e.hecho && ahora - e.ts > VIDA_MS) turnos.delete(k);
  // Tope de tamaño: primero se van los más viejos (el Map guarda el orden de llegada).
  for (const k of turnos.keys()) {
    if (turnos.size <= MAX_TURNOS) break;
    turnos.delete(k);
  }
}

/** Con qué se cierra el turno que se corre: su respuesta, o null si no la hubo. Se puede llamar de más. */
export type Terminar = (r: TurnoGuardado | null) => void;

/**
 * Qué hacer con esta petición: `previo` (la respuesta de este mismo turno, ya hecha) o `terminar` (correr
 * el turno y cerrarlo con eso). Sin clave (cliente viejo, sin `idTurno`): siempre se corre, como antes.
 */
export async function reclamarTurno(clave: string | null, esperaMs = ESPERA_MAX_MS): Promise<{ previo: TurnoGuardado } | { terminar: Terminar }> {
  if (!clave) return { terminar: () => {} };
  // Pocas vueltas: si el turno anterior terminó sin respuesta se borra y la siguiente vuelta lo corre.
  for (let vuelta = 0; vuelta < 3; vuelta++) {
    podar();
    const e = turnos.get(clave);
    if (!e) return { terminar: nuevo(clave) };
    let reloj: ReturnType<typeof setTimeout> | undefined;
    const tope = new Promise<null>((r) => (reloj = setTimeout(() => r(null), esperaMs)));
    const previo = await Promise.race([e.promesa.catch(() => null), tope]).finally(() => clearTimeout(reloj));
    if (previo) return { previo };
    // Se pasó la espera y sigue en curso: este reintento corre el suyo (mejor eso que dejarlo colgado).
    if (turnos.get(clave) === e && !e.hecho) turnos.delete(clave);
  }
  return { terminar: nuevo(clave) };
}

function nuevo(clave: string): Terminar {
  let resolver!: (r: TurnoGuardado | null) => void;
  const entrada: Entrada = { promesa: new Promise((r) => (resolver = r)), hecho: false, ts: Date.now() };
  turnos.set(clave, entrada);
  podar();
  return (r) => {
    if (entrada.hecho) return;
    entrada.hecho = true;
    entrada.ts = Date.now();
    resolver(r);
    // Sin respuesta no hay nada que repetir: el próximo reintento corre uno nuevo.
    if (!r && turnos.get(clave) === entrada) turnos.delete(clave);
  };
}

/** Solo pruebas. */
export function _olvidarTurnos() {
  turnos.clear();
}
export function _cuantosTurnos() {
  return turnos.size;
}
