/**
 * EL HILO DE DR ELECTRUM — que una pregunta de seguimiento signifique algo.
 *
 * Hasta acá el Doctor empezaba de cero en cada turno. Preguntarle «¿y el segundo documento?» era
 * preguntárselo a alguien que acaba de entrar en la sala: contestaba con educación y sin la menor
 * idea de cuál era el primero. Eso, más que ningún fallo de cálculo, es lo que delata a una máquina.
 *
 * Telegram sí guardaba algo, pero de la peor manera posible: **pegaba el hilo entero adentro del
 * mensaje del usuario**. Eso tiene un efecto que no se ve hasta que se mide. El panel de
 * especialistas se elige contando palabras del oficio sobre el texto que llega (`convocar`), y los
 * hechos del cerebro se buscan sobre ese mismo texto. Con el hilo pegado, seis líneas hablando de
 * un pórfido hacen que «¿y cuándo vence?» convoque al Geólogo y al Ingeniero de Minas y deje al
 * Legal Minero **fuera** — sin sus herramientas de catastro y sin su regla de no afirmar vigencias
 * sin el expediente delante. La memoria mal puesta no es memoria de menos: es criterio de menos.
 *
 * Por eso acá el historial viaja como **mensajes con su rol**, que es la forma que el modelo
 * entiende como conversación, y la pregunta de ahora llega sola a `convocar`.
 *
 * Tres decisiones que importan:
 *
 *  - **Se guarda por persona y por canal.** El hilo de la mesa no es el de Telegram: son dos
 *    conversaciones distintas, aunque sea la misma persona. Y el de José nunca es el de Medardo.
 *  - **Caduca.** Un hilo de anteayer no es contexto, es ruido — y encima ruido con nombres de
 *    concesionarios dentro. A las seis horas se olvida solo.
 *  - **El navegador también manda lo suyo.** El servidor de Render se reinicia cuando quiere y se
 *    lleva la memoria; la pantalla, en cambio, tiene lo que está mostrando. Se fusionan, y gana el
 *    del servidor cuando existe, porque es el que no depende de que nadie haya recargado.
 */

import crypto from 'crypto';
import { redactar, sql, tipo } from '../../lib/cognitivo/base';

export type TurnoHilo = { rol: 'persona' | 'electrum'; texto: string };
export type MsgHilo = { role: 'user' | 'assistant'; content: string };

/** Doce idas y vueltas. Más que eso no mejora la respuesta y sí se come la ventana del modelo. */
const MAX_TURNOS = 24;
/** Un mensaje suelto no puede llevarse el contexto entero: un expediente pegado son miles de letras. */
const TOPE_TEXTO = 1500;
/** Seis horas. Lo de anteayer no es contexto. */
const CADUCA_MS = 6 * 60 * 60 * 1000;
/** Techo de conversaciones vivas, para que esto no crezca sin final en un proceso de meses. */
const MAX_HILOS = 200;

type Guardado = { turnos: TurnoHilo[]; tocado: number };

const hilos = new Map<string, Guardado>();

/** Reloj inyectable: las pruebas no pueden esperar seis horas de verdad. */
let ahora = () => Date.now();
export function relojDeHilo(f: () => number) {
  ahora = f;
}

/**
 * La llave. Persona **y** canal: la misma persona hablando por Telegram y en la mesa lleva dos
 * conversaciones, y mezclarlas hace que el Doctor conteste en la pantalla algo que se dijo en el
 * teléfono. Sin persona identificada, quien llama desde HTTP pasa por `claveHiloDe`, que pone la
 * huella del visitante en lugar del nombre; `anonimo` queda solo para quien llame sin petición.
 */
export function claveHilo(quien: string | null, canal: string): string {
  return `${quien || 'anonimo'}·${canal}`;
}

/**
 * Sal de este arranque para la huella del visitante. No es un secreto ni hace falta que lo sea:
 * esto reparte conversaciones, no abre puertas. Que cambie en cada despliegue no pierde nada — los
 * hilos viven en memoria y se van con el proceso de todos modos.
 */
const SAL_VISITANTE = crypto.randomBytes(16).toString('hex');

/** Lo mínimo de una petición que hace falta para saber de quién es el hilo. */
export type PeticionHilo = { ip?: string | null; headers?: Record<string, unknown> };

/**
 * ¿De quién es este hilo? De la persona, si la sesión la identifica. Si no —la llave de la
 * demostración, o el hueco de desarrollo— de ESTE visitante: una huella de su IP y su navegador.
 *
 * Antes todos los que entraban con la llave de la demo caían en el mismo `anonimo·mesa`: el cliente
 * que miraba la plataforma a las diez veía, como «lo que venían hablando», los expedientes que otro
 * había consultado a las nueve; y el «Borrá lo que hablamos» de uno borraba la conversación de todos.
 *
 * No es identidad: dos personas detrás de la misma IP con el mismo navegador comparten hilo, y eso
 * ya pasaba antes con todo el mundo. Es separar lo que se puede separar sin pedirle nada al cliente.
 */
export function quienDelHilo(persona: string | null | undefined, req: PeticionHilo): string {
  if (persona) return persona;
  /*
   * Visitante opaco (auditoría H04): el navegador genera una vez un identificador aleatorio de 128
   * bits y lo manda en `x-electrum-visita`. Con eso, dos personas detrás de la misma red y con el
   * mismo navegador ya no comparten hilo ni informes. Se guarda hasheado: la clave no lleva el valor.
   * La huella de IP y navegador queda solo de respaldo, para clientes viejos que no lo mandan.
   */
  const visita = visitaDe(req);
  if (visita) return `visita:${crypto.createHash('sha256').update(visita).digest('hex').slice(0, 32)}`;
  const ip = String(req.ip || '');
  const agente = String(req.headers?.['user-agent'] || '').slice(0, 400);
  const huella = crypto.createHash('sha256').update(`${SAL_VISITANTE}|${ip}|${agente}`).digest('hex').slice(0, 24);
  return `visita:${huella}`;
}

/** El identificador de visitante que manda el navegador, si tiene la forma esperada. */
export function visitaDe(req: PeticionHilo): string | null {
  const v = String(req.headers?.['x-electrum-visita'] || '').trim();
  return /^[A-Za-z0-9_-]{22,64}$/.test(v) ? v : null;
}

/** La llave del hilo de una petición HTTP: persona o visitante, y canal. */
export function claveHiloDe(persona: string | null | undefined, req: PeticionHilo, canal: string): string {
  return claveHilo(quienDelHilo(persona, req), canal);
}

function limpiar() {
  const t = ahora();
  for (const [k, v] of hilos) if (t - v.tocado > CADUCA_MS) hilos.delete(k);
  // Si aun así hay demasiados, se van los más viejos. Un proceso largo no puede crecer para siempre.
  if (hilos.size > MAX_HILOS) {
    const ordenados = [...hilos.entries()].sort((a, b) => a[1].tocado - b[1].tocado);
    for (const [k] of ordenados.slice(0, hilos.size - MAX_HILOS)) hilos.delete(k);
  }
}

export function hiloDe(clave: string): TurnoHilo[] {
  limpiar();
  return hilos.get(clave)?.turnos || [];
}

/**
 * Los hilos se guardan también en la base (cognitivo.hilo): Telegram, que no tiene cliente, y la
 * mesa (auditoría H17). En la mesa el navegador guardaba su copia solo en la pestaña: cambiar de
 * aparato o cerrar la pestaña con el servidor recién redesplegado era empezar de cero. Caducan
 * igual, a las seis horas, y van con los secretos tapados.
 */
const persistente = (clave: string) => (clave.endsWith('·telegram') || /·mesa(·|$)/.test(clave)) && tipo() === 'postgres';

/** Trae de la base el hilo que no está en memoria (tras un redespliegue). Nunca falla. */
export async function cargarHilo(clave: string): Promise<TurnoHilo[]> {
  limpiar();
  const vivo = hilos.get(clave);
  if (vivo || !persistente(clave)) return vivo?.turnos || [];
  try {
    const [f] = await sql<{ turnos: TurnoHilo[]; tocado: Date }>(`SELECT turnos, tocado FROM cognitivo.hilo WHERE clave = $1`, [clave]);
    const tocado = f ? new Date(f.tocado).getTime() : 0;
    if (!f) return [];
    if (ahora() - tocado > CADUCA_MS || !Array.isArray(f.turnos)) {
      // Caducado: se borra de la base igual que se olvida en memoria (seis horas), no se guarda para siempre.
      void sql(`DELETE FROM cognitivo.hilo WHERE clave = $1`, [clave]).catch(() => {});
      return [];
    }
    const turnos = hiloDelCliente(f.turnos);
    hilos.set(clave, { turnos, tocado });
    return turnos;
  } catch (e: any) {
    console.warn('[hilo] no pude leer', String(e?.message || e).slice(0, 120));
    return [];
  }
}

/** La última vez que se barrieron los hilos caducados de la base. */
let barrido = 0;

function guardarEnBase(clave: string) {
  if (!persistente(clave)) return;
  const g = hilos.get(clave);
  /*
   * A la base va con los secretos tapados (lib/cognitivo/base.ts, redactar): si alguien pega una
   * clave o una URL con contraseña en Telegram, en memoria vive seis horas; en la base y sus
   * respaldos viviría para siempre. En memoria se queda tal cual, que es lo que el modelo necesita
   * para contestar en este mismo rato.
   */
  const q = g
    ? sql(
        `INSERT INTO cognitivo.hilo (clave, turnos, tocado) VALUES ($1, $2::jsonb, to_timestamp($3 / 1000.0))
         ON CONFLICT (clave) DO UPDATE SET turnos = EXCLUDED.turnos, tocado = EXCLUDED.tocado`,
        [clave, JSON.stringify(g.turnos.map((t) => ({ ...t, texto: redactar(t.texto) }))), g.tocado],
      )
    : sql(`DELETE FROM cognitivo.hilo WHERE clave = $1`, [clave]);
  void q.catch((e: any) => console.warn('[hilo] no pude guardar', String(e?.message || e).slice(0, 120)));
  // Las conversaciones de quien no volvió también caducan en la base: un barrido cada hora como mucho.
  if (ahora() - barrido > 60 * 60 * 1000) {
    barrido = ahora();
    void sql(`DELETE FROM cognitivo.hilo WHERE tocado < to_timestamp($1 / 1000.0)`, [ahora() - CADUCA_MS]).catch(() => {});
  }
}

/** Guarda la ida y la vuelta juntas: un turno a medias no le sirve de contexto a nadie. */
export function recordarHilo(clave: string, persona: string, doctor: string) {
  const p = String(persona || '').trim().slice(0, TOPE_TEXTO);
  const d = String(doctor || '').trim().slice(0, TOPE_TEXTO);
  if (!p && !d) return;
  const prev = hilos.get(clave)?.turnos || [];
  const turnos: TurnoHilo[] = [...prev];
  if (p) turnos.push({ rol: 'persona', texto: p });
  if (d) turnos.push({ rol: 'electrum', texto: d });
  hilos.set(clave, { turnos: turnos.slice(-MAX_TURNOS), tocado: ahora() });
  limpiar();
  guardarEnBase(clave);
}

/** Pruebas y «borrá lo que hablamos». Sin clave, se olvida todo. */
export function olvidarHilo(clave?: string) {
  if (clave) {
    hilos.delete(clave);
    guardarEnBase(clave);
  } else hilos.clear();
}

/** Lo que trae la pantalla, ya saneado: no se confía en la forma de lo que manda un navegador. */
export function hiloDelCliente(crudo: unknown): TurnoHilo[] {
  if (!Array.isArray(crudo)) return [];
  const out: TurnoHilo[] = [];
  for (const t of crudo.slice(-MAX_TURNOS)) {
    const texto = String((t as any)?.texto || '').trim().slice(0, TOPE_TEXTO);
    if (!texto) continue;
    const rol = (t as any)?.rol === 'electrum' || (t as any)?.de === 'electrum' ? 'electrum' : 'persona';
    out.push({ rol, texto });
  }
  return out;
}

/**
 * El historial que va al modelo.
 *
 * Gana el del servidor cuando tiene al menos un intercambio: es el que sobrevive a que alguien
 * recargue la página o cambie de aparato. El del navegador entra cuando el servidor no tiene nada,
 * que es justo lo que pasa después de cada redespliegue de Render.
 *
 * Y se quita la pregunta de ahora si viene repetida al final: la pantalla ya la pintó antes de
 * mandarla, y dejarla haría que el modelo la viera dos veces y creyera que se la repitieron.
 */
export function fusionarHiloElectrum(opts: {
  servidor?: TurnoHilo[];
  cliente?: TurnoHilo[];
  mensaje: string;
  max?: number;
}): MsgHilo[] {
  const servidor = opts.servidor || [];
  const cliente = opts.cliente || [];
  const fuente = servidor.length >= 2 ? servidor : cliente.length ? cliente : servidor;

  const msgs: MsgHilo[] = fuente.slice(-(opts.max ?? MAX_TURNOS)).map((t) => ({
    role: t.rol === 'electrum' ? ('assistant' as const) : ('user' as const),
    content: t.texto.slice(0, TOPE_TEXTO),
  }));

  const actual = String(opts.mensaje || '').trim().slice(0, TOPE_TEXTO);
  while (msgs.length && msgs[msgs.length - 1].role === 'user' && msgs[msgs.length - 1].content === actual) {
    msgs.pop();
  }
  // Un historial que empieza por el Doctor deja al modelo con una respuesta sin pregunta.
  while (msgs.length && msgs[0].role === 'assistant') msgs.shift();
  return msgs;
}
