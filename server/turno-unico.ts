/**
 * UNA FRASE, UN TURNO. La mesa del teléfono reintenta un turno que falla (el stream se corta → JSON →
 * otro JSON): hasta tres turnos en el servidor por una sola frase, con el hilo repetido y las
 * herramientas o acciones hechas otra vez. Ahora el cliente manda un `idTurno` por frase y lo repite en
 * sus reintentos; aquí se recuerda, por quién habla + ese id, el turno en curso o terminado hace poco:
 *   · si sigue en curso, el reintento lo ESPERA (no corre otro en paralelo);
 *   · si terminó con respuesta, el reintento recibe esa misma respuesta (`repetido: true`);
 *   · si terminó sin respuesta (error, cortado), el reintento corre un turno nuevo: para eso reintenta.
 *   · si se cansa de esperar y el turno SIGUE en curso, recibe «en curso» (`enCurso`): cansarse de esperar
 *     no le da la propiedad del turno (auditoría 3-oct, EXEC01: a los 75 s entraba un segundo ejecutor
 *     mientras el primero seguía y podía repetir un envío o una tarea de la computadora).
 * En memoria y por poco tiempo (VIDA_MS, a lo más MAX_TURNOS): solo tiene que cubrir los reintentos.
 * LÍMITE CONOCIDO: el Map vive en este proceso. Un reinicio o una segunda réplica no lo ven, así que ahí un
 * reintento sí podría correr otra vez el turno. El proyecto no tiene hoy un almacén compartido para esto
 * (la memoria va a S3 por persona, sin escrituras condicionales); hacerlo durable pide uno con «crear si
 * no existe» atómico por quién + idTurno. Mientras, los efectos de verdad (correo, WhatsApp) siguen
 * exigiendo su «sí» en un turno aparte, que es lo que impide mandarlos dos veces.
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
  /** Cómo terminó y por qué no quedó completo (auditoría 3-oct, STREAM01): el reintento lo repite igual. */
  estado?: 'completo' | 'truncado' | 'error';
  motivo?: string;
  /** Quién contestó de verdad (EXEC04): el reintento no lo vuelve a adivinar por la `via`. */
  modelo?: string;
  proveedor?: string;
};

type Entrada = { promesa: Promise<TurnoGuardado | null>; hecho: boolean; ts: number };

export const VIDA_MS = 2 * 60_000;
export const MAX_TURNOS = 500;
/**
 * Lo más que un reintento espera al turno en curso (un turno largo anda por 70 s, el tope del cliente).
 * Es cuánto ESPERA el reintento, no cuánto dura la propiedad: pasado esto contesta «en curso».
 */
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
  // Tope de tamaño: primero se van los más viejos (el Map guarda el orden de llegada). Solo los terminados:
  // podar uno en curso sería darle el turno a otro dueño mientras el primero sigue (EXEC01). Los que están
  // en curso a la vez los acota el cupo por persona de las rutas.
  for (const [k, e] of turnos) {
    if (turnos.size <= MAX_TURNOS) break;
    if (e.hecho) turnos.delete(k);
  }
}

/** Con qué se cierra el turno que se corre: su respuesta, o null si no la hubo. Se puede llamar de más. */
export type Terminar = (r: TurnoGuardado | null) => void;

/**
 * Qué hacer con esta petición: `previo` (la respuesta de este mismo turno, ya hecha), `terminar` (correr
 * el turno y cerrarlo con eso) o `enCurso` (el mismo turno sigue corriendo en otra petición y no terminó
 * mientras esta esperaba: NO se corre otro). Sin clave (cliente viejo, sin `idTurno`): siempre se corre.
 */
export async function reclamarTurno(clave: string | null, esperaMs = ESPERA_MAX_MS): Promise<{ previo: TurnoGuardado } | { terminar: Terminar } | { enCurso: true }> {
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
    // Se pasó la espera y sigue en curso: el dueño sigue siendo el primero (puede estar mandando algo).
    // Este reintento no corre otro; se le dice que sigue, sin soltar la propiedad.
    if (turnos.get(clave) === e && !e.hecho) return { enCurso: true };
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
