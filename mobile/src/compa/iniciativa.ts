/**
 * LA INICIATIVA DE AURA EN EL TELÉFONO (la lógica, sin React Native): lo que ella propone sin que nadie
 * le pida nada (server/iniciativa.ts, docs/INICIATIVA.md).
 *
 * José (2-oct): «que no tenga yo que decirle qué hacer, que me proponga, que quiera cumplir misiones».
 *
 * Una propuesta llega por dos caminos y es la MISMA (mismo id):
 *   · empujada por el servidor en el canal de acciones: {tipo:'iniciativa', id, texto, pedido, clase, …};
 *   · al abrir la app y cada ~20 min en primer plano: GET /api/iniciativa → {propuesta: {id, texto, tipo, …}}.
 *     Un `{propuesta: null}` válido y más nuevo RETIRA la tarjeta (los «3 correos» ya se leyeron); un fallo, un
 *     cuerpo roto o una respuesta más vieja no tocan nada (ColaPropuestas.terminarSondeo, decidirSondeo).
 * La mesa la muestra como tarjeta (components/TarjetaPropuesta.tsx) con «Sí, hazlo» / «Luego» / «No»
 * y contesta con POST /api/iniciativa/responder {id, respuesta}. Con «Sí», el `pedido` se manda como un
 * turno normal de la persona (el mismo camino del chat de la mesa) para que AURA lo haga con sus manos.
 *
 * `propuestas` (ColaPropuestas) es un dato de módulo con oyentes (useSyncExternalStore en la mesa): la
 * tarjeta no se duplica aunque llegue por los dos caminos, y una ya contestada no vuelve a salir.
 */

/** Lo que el servidor empuja por el canal de acciones (lib/acciones-app.ts, AccionIniciativa). */
export type AccionIniciativa = {
  tipo: 'iniciativa';
  id: string;
  texto: string;
  pedido: string;
  clase: string;
  prioridad: number;
  creada: number;
  /** Revisión (A2): la misma propuesta regenerada en el servidor con el número de ahora. */
  rev?: number;
  /** Cuándo se leyó el número que dice (correo, WhatsApp). Una versión con una lectura más vieja no pisa la tarjeta. */
  observada?: number;
  misionId?: string;
};

/** La propuesta como la usa la app (venga de la acción o del GET). */
export type PropuestaAura = {
  id: string;
  texto: string;
  pedido: string;
  /** mision | conocer | ayuda | seguimiento | dia (en el GET se llama `tipo`; en la acción, `clase`). */
  clase: string;
  prioridad: number;
  creada: number;
  /** Revisión: sube cuando el servidor la regeneró (p. ej. «tres correos» → «1 correo»). Sin ella, 1. */
  rev?: number;
  /** Cuándo se leyó en el servidor el número que dice (solo correo y WhatsApp). */
  observada?: number;
  misionId?: string;
};

/** Los tres botones de la tarjeta, tal cual los entiende el servidor. */
export type RespuestaBoton = 'si' | 'luego' | 'no';
export const RESPUESTAS: readonly RespuestaBoton[] = ['si', 'luego', 'no'];

/** Una propuesta pendiente caduca a las 8 h en el servidor: más vieja, ya no se muestra. */
export const CADUCA_MS = 8 * 60 * 60_000;
/** Cada cuánto se pregunta con la app delante (el servidor sugiere 15–30 min). */
export const SONDEO_INICIATIVA_MS = 20 * 60_000;
/** Al abrir la app, la primera pregunta espera un poco: no compite con el arranque. */
export const PRIMER_SONDEO_MS = 8_000;
/** Pensar una nueva puede tardar hasta ~15 s (el modelo). */
export const TOPE_SONDEO_MS = 25_000;

const RE_ID = /^p_[a-f0-9]{6,24}$/;
const txt = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

/** ¿Es una propuesta empujada bien formada? Lo que no, se descarta (como esAccionPc). */
export function esAccionIniciativa(a: any): a is AccionIniciativa {
  if (!a || typeof a !== 'object' || a.tipo !== 'iniciativa') return false;
  if (typeof a.id !== 'string' || !RE_ID.test(a.id)) return false;
  if (!txt(a.texto, 400) || !txt(a.pedido, 800)) return false;
  if (a.clase !== undefined && typeof a.clase !== 'string') return false;
  if (a.prioridad !== undefined && (typeof a.prioridad !== 'number' || !Number.isFinite(a.prioridad))) return false;
  if (a.creada !== undefined && (typeof a.creada !== 'number' || !Number.isFinite(a.creada))) return false;
  if (a.rev !== undefined && (typeof a.rev !== 'number' || !Number.isInteger(a.rev) || a.rev < 1)) return false;
  if (a.observada !== undefined && (typeof a.observada !== 'number' || !Number.isFinite(a.observada) || a.observada <= 0)) return false;
  return a.misionId === undefined || (typeof a.misionId === 'string' && a.misionId.length <= 64);
}

function normalizar(x: any, clase: unknown): PropuestaAura {
  const p: PropuestaAura = {
    id: String(x.id),
    texto: String(x.texto).replace(/\s+/g, ' ').trim(),
    pedido: String(x.pedido).replace(/\s+/g, ' ').trim(),
    clase: typeof clase === 'string' && clase ? clase : 'ayuda',
    prioridad: Number.isFinite(Number(x.prioridad)) ? Number(x.prioridad) : 2,
    creada: Number.isFinite(Number(x.creada)) ? Number(x.creada) : 0,
  };
  if (typeof x.misionId === 'string' && x.misionId) p.misionId = x.misionId;
  if (Number.isInteger(x.rev) && x.rev > 1) p.rev = x.rev;
  if (typeof x.observada === 'number' && Number.isFinite(x.observada) && x.observada > 0) p.observada = x.observada;
  return p;
}

/**
 * ¿`p` es una versión MÁS NUEVA que `actual` de la MISMA propuesta? (A2, revisión del 5-oct: «un contador actualizado
 * puede volver a un valor antiguo cuando dos consultas terminan fuera de orden»). Si las dos dicen cuándo se leyó su
 * número, manda la lectura más nueva (una más vieja no pisa, aunque traiga otra revisión: otra réplica pudo
 * regenerarla); con la misma lectura o sin ella, la revisión mayor. Vale igual para el empuje y para el GET.
 */
export function versionMasNueva(p: Pick<PropuestaAura, 'rev' | 'observada'>, actual: Pick<PropuestaAura, 'rev' | 'observada'>): boolean {
  const a = Number(p.observada);
  const b = Number(actual.observada);
  if (a > 0 && b > 0 && a !== b) return a > b;
  return (p.rev || 1) > (actual.rev || 1);
}

export function propuestaDeAccion(a: AccionIniciativa): PropuestaAura {
  return normalizar(a, a.clase);
}

/** El cuerpo de GET /api/iniciativa → la propuesta (o null: no hay, o vino mal). */
export function propuestaDeServidor(r: unknown): PropuestaAura | null {
  const x = (r as { propuesta?: any } | null)?.propuesta;
  if (!x || typeof x !== 'object') return null;
  if (typeof x.id !== 'string' || !RE_ID.test(x.id) || !txt(x.texto, 400) || !txt(x.pedido, 800)) return null;
  return normalizar(x, x.tipo ?? x.clase);
}

/**
 * Lo que trajo un GET /api/iniciativa: el cuerpo de una respuesta 2xx, o que no se pudo (sin red, no-2xx, sesión
 * caída o el tope de tiempo: `api()` lanza en todos esos casos).
 */
export type RespuestaSondeo = { ok: true; cuerpo: unknown } | { ok: false };

/**
 * Qué dice esa respuesta (revisión del 5-oct: «propuesta:null retira la tarjeta; distingue una retirada válida de un
 * error o timeout»): una propuesta bien formada; `ninguna` SOLO si el servidor contestó bien y dijo `propuesta: null`
 * (el hecho ya no vale, horas quietas, iniciativa apagada: no hay nada pendiente que mostrar); `invalida` si el
 * cuerpo no se entiende (JSON roto → `api()` da {}, sin la clave; una propuesta mal formada); `fallo` si no llegó.
 */
export type LecturaSondeo = { tipo: 'propuesta'; propuesta: PropuestaAura } | { tipo: 'ninguna' } | { tipo: 'invalida' } | { tipo: 'fallo' };

export function leerSondeo(r: RespuestaSondeo): LecturaSondeo {
  if (!r.ok) return { tipo: 'fallo' };
  const c = r.cuerpo;
  if (!c || typeof c !== 'object' || Array.isArray(c) || !('propuesta' in c)) return { tipo: 'invalida' };
  if ((c as { propuesta: unknown }).propuesta === null) return { tipo: 'ninguna' };
  const p = propuestaDeServidor(c);
  return p ? { tipo: 'propuesta', propuesta: p } : { tipo: 'invalida' };
}

/** El turno de una consulta: su número (sube en cada una) y cuántos cambios llevaba la tarjeta cuando salió. */
export type TurnoSondeo = { n: number; cambios: number };

/** Cómo quedó la tarjeta con una respuesta del sondeo. */
export type ResultadoSondeo = ResultadoOferta | 'retirada' | 'sin_cambio' | 'fuera_de_orden' | 'fallo';

export type DecisionSondeo =
  | { hacer: 'ofrecer'; propuesta: PropuestaAura }
  | { hacer: 'retirar' }
  | { hacer: 'nada'; porque: 'sin_cambio' | 'fuera_de_orden' | 'fallo' };

/**
 * LA DECISIÓN DEL SONDEO (pura). Las consultas pueden terminar fuera de orden (la app vuelve de segundo plano con
 * otra en camino, una tarda hasta el tope): solo decide una respuesta VÁLIDA más nueva que la última aplicada.
 *   · Un fallo o un cuerpo que no se entiende no decide nada (queda la última tarjeta válida) ni cuenta para el orden.
 *   · Una respuesta más vieja que la última aplicada no resucita ni retira nada.
 *   · `propuesta: null` retira la tarjeta, salvo que la tarjeta haya cambiado DESPUÉS de que esa consulta salió
 *     (llegó o se actualizó por el canal de acciones, o la persona contestó): ese null describe un momento anterior;
 *     la próxima vuelta decide con lo de ahora.
 *   · Una propuesta pasa por `ofrecer` (que ya cuida la misma, la contestada, la caducada y la versión vieja).
 */
export function decidirSondeo(e: { aplicado: number; cambios: number; hayTarjeta: boolean }, t: TurnoSondeo, r: RespuestaSondeo): DecisionSondeo {
  const l = leerSondeo(r);
  if (l.tipo === 'fallo' || l.tipo === 'invalida') return { hacer: 'nada', porque: 'fallo' };
  if (t.n <= e.aplicado) return { hacer: 'nada', porque: 'fuera_de_orden' };
  if (l.tipo === 'propuesta') return { hacer: 'ofrecer', propuesta: l.propuesta };
  if (!e.hayTarjeta || e.cambios !== t.cambios) return { hacer: 'nada', porque: 'sin_cambio' };
  return { hacer: 'retirar' };
}

/** ¿Toca preguntar otra vez? (nunca se preguntó, o ya pasó el rato del sondeo). */
export function tocaSondear(ultimo: number, ahora: number, cadaMs = SONDEO_INICIATIVA_MS): boolean {
  return !ultimo || ahora - ultimo >= cadaMs;
}

/** El cuerpo de POST /api/iniciativa/responder. */
export function cuerpoRespuesta(id: string, r: RespuestaBoton): { id: string; respuesta: RespuestaBoton } {
  return { id, respuesta: r };
}

/** Lo que contestó el servidor al responder (o que no se pudo preguntar). */
export type ResultadoRespuesta = { ok: true; pedido: string | null } | { ok: false; status?: number };

/**
 * Qué se manda como turno de la persona después de tocar un botón:
 *   · «Luego» y «No»: nada (la tarjeta solo se cierra).
 *   · «Sí» y el servidor la aceptó: su `pedido` (o el de la propuesta, si no vino).
 *   · «Sí» y el servidor dijo que ya no está pendiente (404: caducó o se contestó en otro lado): nada.
 *   · «Sí» sin red o con el servidor caído: el pedido igual. La persona dijo que sí; AURA lo hace.
 */
export function pedidoAMandar(r: RespuestaBoton, p: Pick<PropuestaAura, 'pedido'>, res: ResultadoRespuesta): string | null {
  if (r !== 'si') return null;
  if (res.ok) return (res.pedido || p.pedido || '').trim() || null;
  if (res.status === 404) return null;
  return p.pedido.trim() || null;
}

/** El texto de cada botón. */
export function textoBoton(r: RespuestaBoton, idioma: 'es' | 'en' = 'es'): string {
  const en = idioma === 'en';
  if (r === 'si') return en ? 'Yes, do it' : 'Sí, hazlo';
  if (r === 'luego') return en ? 'Later' : 'Luego';
  return en ? 'No' : 'No';
}

/** La etiqueta chica de arriba de la tarjeta, según qué tipo de propuesta es. */
export function etiquetaClase(clase: string, idioma: 'es' | 'en' = 'es'): string {
  const en = idioma === 'en';
  switch (clase) {
    case 'mision':
      return en ? 'For your mission' : 'Para tu misión';
    case 'seguimiento':
      return en ? 'Following up' : 'Seguimiento';
    case 'conocer':
      return en ? 'To know you better' : 'Para conocerte';
    case 'dia':
      return en ? 'Your day' : 'Tu día';
    default:
      return en ? 'An idea' : 'Una idea';
  }
}

export type ResultadoOferta = 'nueva' | 'actualizada' | 'repetida' | 'contestada' | 'caducada' | 'vieja';

/**
 * LA COLA DE PROPUESTAS: a lo sumo UNA a la vista. La misma (mismo id) no se duplica; una ya contestada
 * (o descartada aquí) no vuelve aunque el servidor la empuje otra vez o el GET la traiga antes de saber
 * la respuesta; una caducada no sale. Si llega otra distinta, la más nueva reemplaza a la de antes (el
 * servidor solo deja una pendiente: la de antes ya no vale).
 */
export class ColaPropuestas {
  private actual: PropuestaAura | null = null;
  private contestadas: string[] = [];
  private oyentes = new Set<() => void>();
  /** Cuándo se preguntó por última vez (GET /api/iniciativa); la mesa lo usa para el sondeo. */
  ultimoSondeo = 0;
  /** Cuántas veces cambió la tarjeta a la vista (cada aviso a los oyentes). */
  private cambios = 0;
  /** El número de la última consulta que salió y el de la última cuya respuesta se aplicó (decidirSondeo). */
  private sondeoN = 0;
  private sondeoAplicado = 0;

  constructor(private reloj: () => number = Date.now) {}

  /** Para useSyncExternalStore: la propuesta a la vista (la misma referencia mientras no cambie). */
  ahora = (): PropuestaAura | null => this.actual;

  suscribir = (f: () => void): (() => void) => {
    this.oyentes.add(f);
    return () => {
      this.oyentes.delete(f);
    };
  };

  private avisar() {
    this.cambios += 1;
    for (const f of [...this.oyentes]) {
      try {
        f();
      } catch {
        /* un oyente roto no rompe nada */
      }
    }
  }

  yaContestada(id: string): boolean {
    return this.contestadas.includes(id);
  }

  ofrecer(p: PropuestaAura): ResultadoOferta {
    if (this.yaContestada(p.id)) return 'contestada';
    if (p.creada && this.reloj() - p.creada > CADUCA_MS) return 'caducada';
    if (this.actual?.id === p.id) {
      // La misma, regenerada en el servidor con el número de ahora (A2): se reemplaza la tarjeta (no es otra ni se
      // anuncia como nueva). Una revisión igual o más vieja, o una lectura más vieja (un empuje o un GET que llegó
      // tarde), no pisa la de ahora.
      if (!versionMasNueva(p, this.actual)) return 'repetida';
      this.actual = p;
      this.avisar();
      return 'actualizada';
    }
    if (this.actual && p.creada && this.actual.creada && p.creada < this.actual.creada) return 'vieja';
    this.actual = p;
    this.avisar();
    return 'nueva';
  }

  /** Sale una consulta GET /api/iniciativa: se toma su turno ANTES de mandarla. */
  empezarSondeo(): TurnoSondeo {
    this.sondeoN += 1;
    return { n: this.sondeoN, cambios: this.cambios };
  }

  /**
   * Llegó la respuesta de esa consulta (o su fallo): se aplica según decidirSondeo. Un `propuesta: null` válido y en
   * orden retira la tarjeta (no la marca como contestada: si el servidor la vuelve a tener pendiente, sale otra vez).
   */
  terminarSondeo(t: TurnoSondeo, r: RespuestaSondeo): ResultadoSondeo {
    const d = decidirSondeo({ aplicado: this.sondeoAplicado, cambios: this.cambios, hayTarjeta: !!this.actual }, t, r);
    if (d.hacer === 'nada' && d.porque !== 'sin_cambio') return d.porque;
    this.sondeoAplicado = t.n;
    if (d.hacer === 'ofrecer') return this.ofrecer(d.propuesta);
    if (d.hacer === 'nada') return 'sin_cambio';
    this.actual = null;
    this.avisar();
    return 'retirada';
  }

  /**
   * La persona tocó un botón: se cierra al instante y queda como contestada (un segundo toque, o la
   * misma empujada otra vez, no hace nada). Devuelve la propuesta, o null si esa ya no estaba a la vista.
   */
  responder(id: string): PropuestaAura | null {
    const p = this.actual?.id === id ? this.actual : null;
    if (!p) return null;
    this.marcar(id);
    this.actual = null;
    this.avisar();
    return p;
  }

  /** Se cierra sin contestar al servidor (p. ej. al cerrar la sesión): tampoco vuelve. */
  descartar(id: string) {
    this.marcar(id);
    if (this.actual?.id === id) {
      this.actual = null;
      this.avisar();
    }
  }

  /** La que está a la vista ya caducó (la app quedó abierta horas): se quita. */
  limpiarCaducada(): boolean {
    if (!this.actual?.creada || this.reloj() - this.actual.creada <= CADUCA_MS) return false;
    this.actual = null;
    this.avisar();
    return true;
  }

  /** Otra persona en el teléfono: nada de la anterior sigue a la vista. */
  reiniciar() {
    this.actual = null;
    this.contestadas = [];
    this.ultimoSondeo = 0;
    // Lo que iba en camino era de la persona anterior: llega «fuera de orden» y no toca nada.
    this.sondeoAplicado = this.sondeoN;
    this.avisar();
  }

  private dueno = '';
  /** La mesa dice de quién es la sesión: si cambió de persona, se empieza de cero. */
  paraPersona(correo: string) {
    const c = String(correo || '').trim().toLowerCase();
    if (c === this.dueno) return;
    this.dueno = c;
    this.reiniciar();
  }

  private marcar(id: string) {
    if (this.contestadas.includes(id)) return;
    this.contestadas.push(id);
    if (this.contestadas.length > 100) this.contestadas.shift();
  }
}

/** La cola de la app (una sola para todas las pantallas). */
export const propuestas = new ColaPropuestas();
