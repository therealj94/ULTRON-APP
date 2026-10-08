/**
 * LA INICIATIVA DEL DÍA EN EL SERVIDOR: las rutas de Ajustes → Iniciativa, las órdenes por voz y el reloj que manda el
 * resumen de la mañana y los empujones a tiempo. Lo que piensa vive en lib/iniciativa-dia.ts.
 *
 *   GET  /api/iniciativa/dia                 → { preferencias, porOmision, dueno, hoyNo, empujonesHoy, topes }
 *   POST /api/iniciativa/dia {…cambios}      → { preferencias, desdeManana }
 *   POST /api/iniciativa/dia/hoy-no {quitar?} → { hoyNo }      («no me molestes hoy», o deshacerlo)
 *
 * La persona sale SIEMPRE de la sesión firmada (sesionDe), nunca del cuerpo.
 *
 * EL RELOJ (`RelojIniciativaDia`): un temporizador ligero en el mismo proceso, sin servicio nuevo. Cada minuto mira a las
 * cuentas con la iniciativa encendida (las dueñas por omisión y las que la encendieron: lib/iniciativa-dia.ts
 * cuentasConIniciativa); el resumen sale a su hora (reclamado antes de mandarse) y los empujones se piensan cada 5
 * minutos por cuenta, solo si el tope, el espaciado, las horas quietas y el «hoy no» lo dejan (antes de leer nada).
 */
import type express from 'express';
import crypto from 'node:crypto';
import {
  avisoResumen,
  candidatosEmpujon,
  cambiarPrefsDia,
  comandoIniciativa,
  corto,
  cuentasConIniciativa,
  decidirEmpujon,
  desdeAnoche,
  empujonesDeHoy,
  ESPACIO_EMPUJONES_MS,
  esCuentaDuena,
  finDeHoy,
  hayAlgoQueDecir,
  horaParaDecir,
  hoyNoActivo,
  IniciativaDiaNoDisponible,
  leerDia,
  pausarHoy,
  prefsEfectivas,
  prefsPorOmisionDia,
  previsualizarCambiosDia,
  reclamarEmpujon,
  reclamarGeneracion,
  reclamarResumen,
  redactarResumen,
  tocaResumen,
  TOPE_EMPUJONES_DIA,
  validarCambiosDia,
  type AbiertoDia,
  type BorradorDia,
  type EventoDia,
  type MaterialResumen,
  type PrefsDia,
  type PrefsGuardadas,
  type PropuestaDia,
  type Redactor,
} from '../lib/iniciativa-dia';
import { enQuietas, fechaLocal } from '../lib/zona-horaria';

/* ------------------------------------------------------------------ de dónde sale lo que se dice */

/** Lo que el reloj lee de la persona. Cada fuente puede fallar: lo que falla no se dice (nunca «no tienes nada»). */
export type FuentesDia = {
  /** null: sin calendario conectado o sin poder leerlo. */
  eventos: (correo: string, desde: number, hasta: number) => Promise<EventoDia[] | null>;
  recordatorios: (correo: string, desde: number, hasta: number) => Promise<Array<{ texto: string; cuando: number }>>;
  /** Importantes sin contestar desde `desde` (solo quién y por dónde). */
  mensajes: (correo: string, desde: number) => Promise<Array<{ quien: string; canal: 'whatsapp' | 'correo' }>>;
  abiertos: (correo: string) => Promise<AbiertoDia[]>;
  misiones: (correo: string) => Promise<Array<{ titulo: string; proximoPaso?: string }>>;
  /** La propuesta de la iniciativa de siempre que espera su respuesta (si la hay). */
  propuesta: (correo: string) => Promise<PropuestaDia | null>;
  /**
   * Los borradores que esperan su «sí» DE VERDAD: las decisiones abiertas del sistema de decisiones (las tareas durables
   * en `awaiting_approval` ligadas a un borrador, server/trabajos.ts). Sin esta fuente no se empuja ningún borrador.
   */
  borradores?: (correo: string) => Promise<BorradorDia[]>;
  /**
   * ¿Ese borrador ya tiene envío registrado? (lib/envios.ts reciboDeBorrador). Se mira justo antes de empujar: con
   * recibo (o sin poder saberlo, o sin esta fuente) no se dice que espera.
   */
  reciboEnvio?: (correo: string, canal: BorradorDia['canal'], intento: string) => Promise<'hay' | 'ninguno' | 'incierto'>;
};

/** Por dónde sale. Cada una dice a cuántos aparatos llegó (0: a ninguno) y nunca lanza. */
export type SalidasDia = {
  /**
   * `texto`: lo que se ve en el aviso (en la pantalla bloqueada: del resumen, solo cuántos y quién); `decir`: lo que AURA
   * dice al tocarlo, ya en la app (el resumen entero). Sin `decir`, dice `texto`.
   */
  avisar: (correo: string, a: { titulo: string; texto: string; id: string; decir?: string }) => Promise<number>;
  llamar: (correo: string, a: { motivo: string; id: string }) => Promise<number>;
  /** Una sola vez en el registro durable (lib/envios.ts primeraVezEvento). */
  unaVez?: (fuente: string, correo: string, id: string) => Promise<boolean>;
  /** El cerebro rápido para redactar el resumen (null: armado a mano). */
  redactor?: Redactor | null;
  /** ¿Se puede usar ahora? (CEREBRO_VOZ=qwen, sin credenciales o en pausa: no; y no se gasta la redacción del día). */
  redactorActivo?: () => boolean;
};

const idDe = (pre: string, ...partes: string[]) => `${pre}-${crypto.createHash('sha256').update(partes.join('|')).digest('hex').slice(0, 20)}`;

const conTope = <T>(p: Promise<T>, ms: number, siNo: T): Promise<T> =>
  new Promise((ok) => {
    const t = setTimeout(() => ok(siNo), ms);
    t.unref?.();
    p.then(
      (v) => (clearTimeout(t), ok(v)),
      () => (clearTimeout(t), ok(siNo))
    );
  });

/** Lo que va en el resumen de hoy: cada fuente con su tope (lo que no contesta, no se dice). */
export async function materialDelDia(correo: string, f: FuentesDia, p: PrefsDia, ahora: number): Promise<MaterialResumen> {
  const fin = finDeHoy(ahora, p.zona);
  const [eventos, recordatorios, mensajes, abiertos, misiones, borradores] = await Promise.all([
    conTope(f.eventos(correo, ahora, fin), 15_000, null),
    conTope(f.recordatorios(correo, ahora, fin), 8_000, []),
    conTope(f.mensajes(correo, desdeAnoche(ahora, p.zona)), 20_000, []),
    conTope(f.abiertos(correo), 8_000, []),
    conTope(f.misiones(correo), 8_000, []),
    f.borradores ? conTope(f.borradores(correo), 8_000, [] as BorradorDia[]) : Promise.resolve([] as BorradorDia[]),
  ]);
  return {
    eventos: eventos ? eventos.filter((e) => (e.fin ?? e.inicio) > ahora).sort((a, b) => a.inicio - b.inicio) : null,
    recordatorios: recordatorios.filter((r) => r.cuando >= ahora && r.cuando <= fin).sort((a, b) => a.cuando - b.cuando),
    mensajes,
    // Los borradores detectados con reglas en la conversación (lib/abiertos.ts) no se cierran cuando salen: no cuentan.
    // Los que esperan de verdad vienen del sistema de decisiones (`borradores`).
    abiertos: abiertos.filter((a) => a.estado === 'abierto' && a.tipo !== 'mision' && a.tipo !== 'borrador').map((a) => ({ texto: a.texto, tipo: a.tipo })),
    misiones,
    borradores: (await borradoresSinEnvio(correo, f, borradores.filter((b) => !b.caduca || b.caduca > ahora))).map((b) => ({ canal: b.canal, para: b.para })),
    zona: p.zona,
  };
}

/** Solo los borradores sin recibo de envío (con recibo, o sin poder saberlo, no se dice que esperan). */
async function borradoresSinEnvio(correo: string, f: FuentesDia, bs: BorradorDia[]): Promise<BorradorDia[]> {
  if (!bs.length || !f.reciboEnvio) return [];
  const r = await Promise.all(bs.slice(0, 6).map((b) => conTope(f.reciboEnvio!(correo, b.canal, b.id), 5_000, 'incierto' as const)));
  return bs.slice(0, 6).filter((_, i) => r[i] === 'ninguno');
}

/* ------------------------------------------------------------------ el reloj */

export type ResultadoResumen = { correo: string; salio: boolean; porque: string; texto?: string; por?: 'aviso' | 'llamada'; generado?: boolean };
export type ResultadoEmpujon = { correo: string; salio: boolean; porque: string; texto?: string; clave?: string };

/** Cada cuánto se piensan los empujones de una cuenta (el calendario se lee como mucho así de seguido). */
export const EMPUJON_CADA_MS = 5 * 60_000;
export const CADA_MS_RELOJ_DIA = 60_000;

export class RelojIniciativaDia {
  private t: NodeJS.Timeout | null = null;
  private corriendo = false;
  private revisado = new Map<string, number>();
  private readonly ahora: () => number;

  constructor(
    private d: {
      /** Las cuentas a mirar (las dueñas y las que la encendieron). */
      personas: () => Promise<string[]> | string[];
      fuentes: FuentesDia;
      salidas: SalidasDia;
      ahora?: () => number;
      cadaMs?: number;
      max?: number;
    }
  ) {
    this.ahora = d.ahora || Date.now;
  }

  arrancar() {
    if (this.t) return;
    this.t = setInterval(() => void this.vuelta().catch(() => undefined), this.d.cadaMs ?? CADA_MS_RELOJ_DIA);
    this.t.unref?.();
  }

  parar() {
    if (this.t) clearInterval(this.t);
    this.t = null;
  }

  /** Una vuelta: el resumen de quien le toque y los empujones de quien toque pensar. Una a la vez; nunca lanza. */
  async vuelta(): Promise<{ resumenes: ResultadoResumen[]; empujones: ResultadoEmpujon[] }> {
    const out = { resumenes: [] as ResultadoResumen[], empujones: [] as ResultadoEmpujon[] };
    if (this.corriendo) return out;
    this.corriendo = true;
    try {
      const lista = [...new Set((await Promise.resolve(this.d.personas()).catch(() => [] as string[])).map((c) => String(c || '').trim().toLowerCase()).filter((c) => c.includes('@')))];
      for (const correo of lista.slice(0, this.d.max ?? 60)) {
        try {
          const r = await this.resumenPara(correo);
          if (!['temprano', 'ya', 'apagado', 'tarde', 'quietas'].includes(r.porque)) out.resumenes.push(r);
          const ahora = this.ahora();
          if (ahora - (this.revisado.get(correo) || 0) >= EMPUJON_CADA_MS) {
            this.revisado.set(correo, ahora);
            const e = await this.empujonPara(correo);
            if (e.salio || !['apagado', 'quietas', 'tope', 'espaciado', 'hoy_no', 'nada'].includes(e.porque)) out.empujones.push(e);
          }
        } catch (e: any) {
          if (!(e instanceof IniciativaDiaNoDisponible)) console.warn('[iniciativa-dia] una cuenta falló', String(e?.message || e).slice(0, 120));
        }
      }
    } finally {
      this.corriendo = false;
    }
    return out;
  }

  /**
   * El resumen de hoy de una cuenta, si le toca: se RECLAMA en su cajón (y en el registro durable) antes de leer nada;
   * si no hay nada que valga la pena, no sale nada. «Llámame» solo fuera de sus horas quietas; si la llamada no sale,
   * el aviso de siempre.
   */
  async resumenPara(correo: string): Promise<ResultadoResumen> {
    const ahora = this.ahora();
    const e = await leerDia(correo);
    const p = prefsEfectivas(e.prefs, { dueno: esCuentaDuena(correo) });
    const t = tocaResumen(e, p, ahora);
    if (t.toca === false) return { correo, salio: false, porque: (t as { porque: string }).porque };
    const fecha = (t as { fecha: string }).fecha;
    // «No me molestes hoy» dicho en OTRO proceso (su caché del cajón no lo ve): el registro durable sí.
    if (await hoyNoActivo(correo, ahora)) return { correo, salio: false, porque: 'hoy_no' };
    if (!(await reclamarResumen(correo, fecha))) return { correo, salio: false, porque: 'ya' };
    if (this.d.salidas.unaVez && !(await this.d.salidas.unaVez('iniciativa-resumen', correo, fecha).catch(() => true))) return { correo, salio: false, porque: 'ya' };
    const m = await materialDelDia(correo, this.d.fuentes, p, ahora);
    if (!hayAlgoQueDecir(m)) return { correo, salio: false, porque: 'vacio' };
    const redactor = this.d.salidas.redactor && (!this.d.salidas.redactorActivo || this.d.salidas.redactorActivo()) ? this.d.salidas.redactor : null;
    const r = await redactarResumen(m, { redactor, puedeGenerar: () => reclamarGeneracion(correo, fecha) });
    if (!r.texto) return { correo, salio: false, porque: 'vacio' };
    const id = idDe('dia', correo, fecha);
    // Lo que se ve en la pantalla bloqueada (el aviso, el motivo de la llamada): solo cuántos y quién, nunca texto libre.
    const visible = avisoResumen(m) || 'Tengo tu resumen de hoy. Tócalo y te lo cuento.';
    if (p.llamarResumen && !enQuietas(this.ahora(), p.zona, p.quietas)) {
      const n = await this.d.salidas.llamar(correo, { motivo: corto(visible), id }).catch(() => 0);
      if (n > 0) return { correo, salio: true, porque: 'llamada', texto: r.texto, por: 'llamada', generado: r.generado };
    }
    const n = await this.d.salidas.avisar(correo, { titulo: 'Tu día', texto: visible, decir: r.texto, id }).catch(() => 0);
    return { correo, salio: n > 0, porque: n > 0 ? 'aviso' : 'sin_aparatos', texto: r.texto, por: 'aviso', generado: r.generado };
  }

  /**
   * Un empujón para una cuenta, si toca: primero los límites (sin leer ninguna fuente si no pasan), después lo que
   * merece uno (un evento en 15 minutos, un borrador o una propuesta que espera, algo que AU-RA ofreció) y se reclama
   * antes de mandarlo. Solo una propuesta en pregunta: nada se hace.
   */
  async empujonPara(correo: string): Promise<ResultadoEmpujon> {
    const ahora = this.ahora();
    const e = await leerDia(correo);
    const p = prefsEfectivas(e.prefs, { dueno: esCuentaDuena(correo) });
    const d = decidirEmpujon(e, p, ahora);
    if (d.ok === false) return { correo, salio: false, porque: (d as { porque: string }).porque };
    if (await hoyNoActivo(correo, ahora)) return { correo, salio: false, porque: 'hoy_no' };
    const f = this.d.fuentes;
    const [eventos, abiertos, propuesta, borradores] = await Promise.all([
      conTope(f.eventos(correo, ahora, ahora + 16 * 60_000), 15_000, null),
      conTope(f.abiertos(correo), 8_000, []),
      conTope(f.propuesta(correo), 8_000, null),
      f.borradores ? conTope(f.borradores(correo), 8_000, [] as BorradorDia[]) : Promise.resolve([] as BorradorDia[]),
    ]);
    let c = null as ReturnType<typeof candidatosEmpujon>[number] | null;
    for (const x of candidatosEmpujon({ eventos, abiertos, propuesta, borradores }, ahora, e.claves)) {
      // Un borrador: justo antes, que no tenga recibo de envío (pudo salir por el panel o por otro camino). Sin poder
      // saberlo, tampoco: nunca se dice que espera algo que pudo haber salido.
      if (x.borrador && (!f.reciboEnvio || (await conTope(f.reciboEnvio(correo, x.borrador.canal, x.borrador.id), 5_000, 'incierto' as const)) !== 'ninguno')) continue;
      c = x;
      break;
    }
    if (!c) return { correo, salio: false, porque: 'nada' };
    if (!(await reclamarEmpujon(correo, c, ahora))) return { correo, salio: false, porque: 'reclamado' };
    // Además del cajón (la caché de ESTE proceso), el registro durable: dos procesos a la vez (un despliegue) no mandan
    // el mismo empujón dos veces.
    if (this.d.salidas.unaVez && !(await this.d.salidas.unaVez('iniciativa-empujon', correo, c.clave).catch(() => true))) return { correo, salio: false, porque: 'reclamado' };
    const n = await this.d.salidas.avisar(correo, { titulo: 'AURA', texto: c.texto, id: idDe('emp', correo, c.clave) }).catch(() => 0);
    return { correo, salio: n > 0, porque: n > 0 ? 'aviso' : 'sin_aparatos', texto: c.texto, clave: c.clave };
  }
}

/* ------------------------------------------------------------------ la voz */

/** Lo que AURA dice al pausar el día: la verdad de lo que todavía puede llegar (lib/alertas-mensajes.ts). */
export const DECIR_HOY_NO = 'Listo, hoy no te busco. Solo te aviso si algo urgente de tus contactos importantes.';

/**
 * Una orden de la iniciativa dicha en un turno («no me molestes hoy», «mándame el resumen de la mañana a las 7», «ya no me
 * llames»). null si no es una. `decir`: lo que AU-RA contesta (la verdad de lo que queda guardado). «para» / «basta» a
 * secas no son de aquí: callan la voz y nada más.
 *
 * EL CONTRATO DEL TURNO ESPECULATIVO (revisión de la tanda F, B2): con `hacer` (el `retener.hacer` del turno: la voz de
 * ElevenLabs o la mesa especulativa del teléfono), NADA se escribe aquí: se lee lo de ahora para contestar la verdad y la
 * escritura va a `hacer`, que la corre solo si el turno se confirma. Una frase a medias que se descarta («no me
 * molestes…» que seguía «…con eso ahora, dime la hora») no pausa el día.
 */
export async function ordenIniciativaDia(correo: string, texto: string, ahora = Date.now(), o: { hacer?: (f: () => void) => void } = {}): Promise<{ decir: string; via: string } | null> {
  const c = comandoIniciativa(texto);
  const quien = String(correo || '').trim().toLowerCase();
  if (!c || !quien.includes('@')) return null;
  const noPude = 'No pude guardarlo en este momento; no cambié nada. Puedes hacerlo en Ajustes → Iniciativa.';
  /** Escribe ya (sin `hacer`) o al confirmarse el turno (con `hacer`: lo de antes ya se comprobó que se puede leer). */
  const escribir = async (f: () => Promise<unknown>) => {
    if (!o.hacer) return void (await f());
    o.hacer(() => {
      void f().catch((e) => console.warn('[iniciativa-dia] orden por voz (al confirmar)', String((e as Error)?.message || e).slice(0, 120)));
    });
  };
  const cambio = async (cambios: PrefsGuardadas) => {
    if (!o.hacer) {
      const r = await cambiarPrefsDia(quien, cambios, ahora);
      return { p: r.prefs, desdeManana: r.desdeManana, enQuietas: r.enQuietas };
    }
    // Lo que va a quedar, sin escribir todavía (lanza si el cajón no se pudo leer: entonces no se promete nada).
    const previa = await previsualizarCambiosDia(quien, cambios, ahora);
    await escribir(() => cambiarPrefsDia(quien, cambios, ahora));
    return previa;
  };
  try {
    if (c.tipo === 'hoy_no') {
      await leerDia(quien);
      await escribir(() => pausarHoy(quien, ahora));
      return { decir: DECIR_HOY_NO, via: 'iniciativa-hoy-no' };
    }
    if (c.tipo === 'no_llames') {
      await cambio({ llamarResumen: false, llamarVip: false });
      return { decir: 'Entendido: ya no te llamo por mi cuenta. Si hay algo, te llega como notificación.', via: 'iniciativa-no-llames' };
    }
    if (c.tipo === 'sin_resumen') {
      await cambio({ resumen: false });
      return { decir: 'Entendido: no más resumen de la mañana. Lo vuelves a encender en Ajustes → Iniciativa.', via: 'iniciativa-sin-resumen' };
    }
    if (c.tipo === 'encender_resumen') {
      const r = await cambio({ activa: true, resumen: true });
      return { decir: `Listo: tu resumen de la mañana queda encendido; te llega a las ${horaParaDecir(r.p.horaResumen)}${r.desdeManana ? ', desde mañana' : ''}.`, via: 'iniciativa-encender-resumen' };
    }
    // La hora del resumen. Cambiarla no enciende la iniciativa de quien la tiene apagada, salvo que lo pida («enciende…»).
    const r = await cambio({ resumen: true, horaResumen: c.hora, ...(c.encender ? { activa: true } : {}) });
    const h = horaParaDecir(r.p.horaResumen);
    if (!r.p.activa) {
      return {
        decir: `Guardé las ${h} para tu resumen de la mañana, pero tu iniciativa del día está apagada, así que todavía no te llega. Si lo quieres, dime «enciende mi resumen de la mañana» o actívala en Ajustes → Iniciativa.`,
        via: 'iniciativa-hora-resumen',
      };
    }
    const quietas = r.enQuietas ? ` Ojo: esa hora cae en tus horas quietas (de ${horaParaDecir(r.p.quietas.desde)} a ${horaParaDecir(r.p.quietas.hasta)}); como la elegiste tú, te lo mando a esa hora.` : '';
    return { decir: `Listo: el resumen te llega a las ${h}${r.desdeManana ? ', desde mañana' : ''}.${quietas}`, via: 'iniciativa-hora-resumen' };
  } catch (e) {
    if (!(e instanceof IniciativaDiaNoDisponible)) console.warn('[iniciativa-dia] orden por voz', String((e as Error)?.message || e).slice(0, 120));
    return { decir: noPude, via: 'iniciativa-fallo' };
  }
}

/* ------------------------------------------------------------------ las rutas */

export type DepsRutasDia = {
  exigirMesa: express.RequestHandler;
  limitar: (max: number, ventanaMs?: number, grupo?: string) => express.RequestHandler;
  sesionDe: (req: express.Request) => { correo: string } | null;
  reloj?: () => number;
};

export function montarRutasIniciativaDia(app: express.Express, d: DepsRutasDia) {
  const quien = (req: express.Request, res: express.Response): string => {
    res.setHeader('Cache-Control', 'no-store');
    const c = String(d.sesionDe(req)?.correo || '').trim().toLowerCase();
    if (!c.includes('@')) {
      res.status(401).json({ error: 'Entra con tu sesión.', code: 'sesion_requerida', honesto: true });
      return '';
    }
    return c;
  };
  const ahora = () => (d.reloj ? d.reloj() : Date.now());
  const fallo = (res: express.Response, e: unknown) => {
    if (e instanceof IniciativaDiaNoDisponible) return res.status(503).json({ error: (e as Error).message, code: 'almacen_no_disponible', honesto: true });
    return res.status(500).json({ error: 'No pude con tu iniciativa del día ahora.', honesto: true });
  };
  const vista = async (c: string) => {
    const e = await leerDia(c);
    const dueno = esCuentaDuena(c);
    const p = prefsEfectivas(e.prefs, { dueno });
    const t = ahora();
    return {
      preferencias: p,
      porOmision: prefsPorOmisionDia(dueno),
      dueno,
      hoyNo: e.hoyNo === fechaLocal(t, p.zona),
      empujonesHoy: empujonesDeHoy(e, p.zona, t).length,
      topes: { empujonesDia: TOPE_EMPUJONES_DIA, espacioMin: ESPACIO_EMPUJONES_MS / 60_000 },
      honesto: true,
    };
  };

  app.get('/api/iniciativa/dia', d.exigirMesa, d.limitar(30), async (req, res) => {
    const c = quien(req, res);
    if (!c) return;
    try {
      return res.json(await vista(c));
    } catch (e) {
      return fallo(res, e);
    }
  });

  app.post('/api/iniciativa/dia', d.exigirMesa, d.limitar(30), async (req, res) => {
    const c = quien(req, res);
    if (!c) return;
    const v = validarCambiosDia(req.body);
    if (!v.ok) return res.status(400).json({ error: (v as { error: string }).error, honesto: true });
    try {
      const r = await cambiarPrefsDia(c, v.cambios, ahora());
      return res.json({ ...(await vista(c)), desdeManana: r.desdeManana, enQuietas: r.enQuietas, durable: r.durable });
    } catch (e) {
      return fallo(res, e);
    }
  });

  app.post('/api/iniciativa/dia/hoy-no', d.exigirMesa, d.limitar(30), async (req, res) => {
    const c = quien(req, res);
    if (!c) return;
    try {
      const r = await pausarHoy(c, ahora(), { quitar: req.body?.quitar === true });
      return res.json({ ...(await vista(c)), durable: r.durable });
    } catch (e) {
      return fallo(res, e);
    }
  });
}

/* ------------------------------------------------------------------ las fuentes de verdad (server.ts) */

/** Las fuentes productivas: su calendario, sus recordatorios, el triaje (sin modelo ni Laya), lo abierto y sus misiones. */
export function fuentesProductivas(): FuentesDia {
  return {
    eventos: async (correo, desde, hasta) => (await import('./calendario')).eventosParaIniciativa(correo, desde, hasta),
    recordatorios: async (correo, desde, hasta) => {
      const { listarRecordatoriosServidor } = await import('../lib/recordatorios-servidor');
      const r = await listarRecordatoriosServidor(correo);
      return r.recordatorios.filter((x) => x.proxima !== null && x.proxima >= desde && x.proxima <= hasta).map((x) => ({ texto: x.texto, cuando: x.proxima as number }));
    },
    mensajes: async (correo, desde) => {
      const [{ triar }, wa] = await Promise.all([import('../lib/triaje'), import('./whatsapp')]);
      // Su WhatsApp solo si es suyo y puede tenerlo aquí (como /api/triaje); si no, solo sus correos.
      const conWa = wa.esDuenoWhatsapp(correo) || ((await wa.whatsappPermitido(correo).catch(() => false)) && (await wa.whatsappVinculadoRapido(correo, 2000).catch(() => false)));
      const r = await triar(correo, { fuentes: { modelo: null, laya: null, ...(conWa ? {} : { whatsapp: null }) } });
      return r.conversaciones
        .filter((c) => (c.importancia === 'urgente' || c.importancia === 'importante') && !c.ultimoMio && c.hora >= desde && !c.intenciones.includes('estafa'))
        .slice(0, 6)
        .map((c) => ({ quien: c.circulo || c.nombre || 'alguien', canal: c.canal }));
    },
    abiertos: async (correo) => (await import('../lib/abiertos')).abiertosDe(correo),
    misiones: async (correo) => {
      const { listarMisiones } = await import('../lib/misiones');
      return (await listarMisiones(correo)).filter((m) => m.estado === 'activa').map((m) => ({ titulo: m.titulo, ...(m.proximoPaso ? { proximoPaso: m.proximoPaso } : {}) }));
    },
    propuesta: async (correo) => {
      const { leerEstadoIniciativa } = await import('../lib/iniciativa');
      const est = await leerEstadoIniciativa(correo);
      const p = est.ok ? est.estado.pendiente : null;
      return p ? { id: p.id, texto: p.texto, creada: p.creada, ...(p.entregada ? { entregada: p.entregada } : {}) } : null;
    },
    borradores: async (correo) => borradoresEsperando(await (await import('../lib/tareas-durables')).listarTareas(correo)),
    reciboEnvio: async (correo, canal, intento) => (await import('../lib/envios')).reciboDeBorrador(canal, correo, intento),
  };
}

/**
 * Los borradores que esperan su «sí» en el sistema de decisiones: las tareas durables en `awaiting_approval` cuya decisión
 * está ligada a un borrador (server/trabajos.ts abrirDecisionDeBorrador), sin pospone ni vencer. Solo canal, a quién y
 * desde cuándo (nada del texto). Si la lista no se pudo leer, ninguno (nunca se adivina).
 */
export function borradoresEsperando(
  lista: { ok: true; tareas: Array<{ estado: string; decision?: { creada: number; caduca?: number; pospuesta?: boolean; pospuestaHasta?: number | null; propuesta: { destinatario?: string }; vinculo?: { tipo: string; canal?: string; intento?: string } } | null }> } | { ok: false },
  ahora = Date.now()
): BorradorDia[] {
  if (!lista.ok) return [];
  const out: BorradorDia[] = [];
  for (const t of lista.tareas) {
    const d = t.decision;
    const v = d?.vinculo;
    if (t.estado !== 'awaiting_approval' || !d || !v || v.tipo !== 'borrador' || !v.intento || (v.canal !== 'correo' && v.canal !== 'whatsapp')) continue;
    if (d.pospuesta || (d.pospuestaHasta && d.pospuestaHasta > ahora) || (d.caduca && d.caduca <= ahora)) continue;
    out.push({ id: v.intento, canal: v.canal, para: String(d.propuesta?.destinatario || ''), creado: d.creada, ...(d.caduca ? { caduca: d.caduca } : {}) });
  }
  return out;
}

/**
 * El cerebro rápido de Bedrock (lib/cerebro-rapido.ts) para redactar el resumen: un pedido chico, con tope de fichas.
 * `activo` dice si se usa en este servidor ahora (CEREBRO_VOZ=qwen, sin credenciales o en pausa por fallos: no, y el
 * resumen sale armado a mano sin gastar la redacción del día).
 */
export function redactorProductivo(): { redactor: Redactor; activo: () => boolean } {
  let R: typeof import('../lib/cerebro-rapido') | null = null;
  void import('../lib/cerebro-rapido').then((m) => (R = m)).catch(() => undefined);
  return {
    activo: () => !!R && R.cerebroRapidoActivo(),
    redactor: async (mensajes) => {
      const M = R || (await import('../lib/cerebro-rapido'));
      let t = '';
      for await (const trozo of M.hablarRapido(mensajes, undefined, { maxTokens: 260 })) t += trozo;
      return t;
    },
  };
}

/** Los correos de las cuentas dueñas (WHATSAPP_DUENOS: correos o ids del padrón). */
export function correosDuenos(duenosCrudo: string, padron: Record<string, { correo: string }>): string[] {
  const out = new Set<string>();
  for (const x of String(duenosCrudo || '').split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    if (x.includes('@')) out.add(x);
    else if (padron[x]?.correo) out.add(padron[x].correo.toLowerCase());
  }
  return [...out];
}
