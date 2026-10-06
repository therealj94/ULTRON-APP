/**
 * EL TURNO ESPECULATIVO DE LA MESA (José, 6-oct: «que sea tan rápido contestar una conversación que nadie note que es una
 * IA»). El oído avisa a los ~0,35 s de silencio que la idea parece cerrada (turboMotor `onEspeculativa`, con el texto
 * EXACTO de Turbo), pero todavía espera su silencio por si la persona sigue (lib/finDeTurno.ts). La mesa empieza el turno
 * en ese momento con `especulativo: true`: el servidor prepara, piensa y escribe, y no hace NADA con efecto hasta que se
 * le confirme (server/turno-especulativo.ts).
 *
 * Cuando el oído entrega la frase final, la mesa la pide como siempre (askBrain) y aquí se decide si ese turno ya está:
 * misma frase (sin mayúsculas, tildes ni puntuación), mismo contexto (quién habla, hilo, modo, sin foto) y a tiempo. Si
 * sí, quien lo toma recibe en orden lo que ya llegó y lo que siga, y se le confirma al servidor con el idTurno del turno
 * especulativo (que pasa a ser el del turno: sus reintentos por JSON recuperan ESE turno, no corren otro). Si no, se corta
 * (el servidor lo descarta: sus acciones no corren nunca) y la mesa pide el turno de siempre.
 *
 * Si la persona sigue hablando, el oído avisa `onEspeculativaCancelada` y se corta. Sin React Native: se prueba en Node
 * (tests/turno-especulativo-movil.test.ts).
 */
import type { ChatResult, StreamHandlers, TurnoOpts } from './api';

type Stream = { promise: Promise<ChatResult>; abort: () => void };

export type DepsEspeculativo = {
  /** turnoStream de lib/api.ts. */
  arrancar: (opts: TurnoOpts & { especulativo: true }, h: StreamHandlers) => Stream;
  /** POST /api/turno/confirmar: true si el servidor lo confirmó. */
  confirmar: (idTurno: string) => Promise<boolean>;
  /** Avisarle al servidor que se tira (cortar el stream ya lo hace; esto es por si el corte no llega). */
  cancelar?: (idTurno: string) => void;
  ahora?: () => number;
};

/** Un turno especulativo que nadie tomó en este rato ya no vale (el oído entrega la frase en ≤1,1 s). */
export const VIGENCIA_ESPECULATIVO_MS = 4_000;

const plano = (s: string) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** ¿La frase final es la especulada? Sin mayúsculas, tildes ni puntuación; ni una palabra más ni menos. */
export function mismaFrase(especulada: string, final: string): boolean {
  const a = plano(especulada);
  return !!a && a === plano(final);
}

type Evento = { k: 'emocion' | 'delta' | 'replace' | 'tools'; v: any };

type Vivo = {
  opts: TurnoOpts;
  idTurno: string;
  desde: number;
  stream: Stream;
  eventos: Evento[];
  h: StreamHandlers | null;
  fallo: boolean;
};

/** Lo del contexto que tiene que ser igual para que el turno especulativo sirva. */
function mismoContexto(a: TurnoOpts, b: TurnoOpts): boolean {
  if (b.image || b.visto || a.image || a.visto) return false;
  if (a.mode !== b.mode || (a.correo || '') !== (b.correo || '')) return false;
  if (JSON.stringify(a.quienHabla ?? null) !== JSON.stringify(b.quienHabla ?? null)) return false;
  if (!!a.interrumpido !== !!b.interrumpido) return false;
  const ha = a.historial || [];
  const hb = b.historial || [];
  if (ha.length !== hb.length) return false;
  return ha.every((t, i) => t.rol === hb[i].rol && t.texto === hb[i].texto);
}

export class TurnoEspeculativo {
  private vivo: Vivo | null = null;
  private readonly ahora: () => number;

  constructor(private readonly d: DepsEspeculativo) {
    this.ahora = d.ahora || Date.now;
  }

  /** ¿Hay uno corriendo que nadie tomó? */
  activo(): boolean {
    return !!this.vivo;
  }

  /** Empieza el turno especulativo de esta frase (el anterior, si lo había, se corta). */
  empezar(opts: TurnoOpts, idTurno: string): boolean {
    this.cancelar();
    const eventos: Evento[] = [];
    const v: Vivo = { opts, idTurno, desde: this.ahora(), eventos, h: null, fallo: false, stream: null as unknown as Stream };
    const pasar = (k: Evento['k']) => (x: any) => {
      if (v.h) entregar(v.h, { k, v: x });
      else eventos.push({ k, v: x });
    };
    try {
      v.stream = this.d.arrancar(
        { ...opts, idTurno, especulativo: true },
        { onEmocion: pasar('emocion'), onDelta: pasar('delta'), onReplace: pasar('replace'), onTools: pasar('tools') }
      );
    } catch {
      return false;
    }
    // Si falla o termina mal antes de que alguien lo tome, ya no sirve.
    v.stream.promise.then(
      (r) => {
        if (!v.h && (r?.error || r?.cierre !== 'done')) v.fallo = true;
      },
      () => {
        v.fallo = true;
      }
    );
    this.vivo = v;
    return true;
  }

  /**
   * La frase final llegó y la mesa va a pedir el turno: si el especulativo es de ESTA frase y contexto, lo toma (con su
   * idTurno). null: no sirve (y se cortó); la mesa pide el de siempre.
   */
  tomar(opts: TurnoOpts, h: StreamHandlers): (Stream & { idTurno: string; adelantoMs: number }) | null {
    const v = this.vivo;
    if (!v) return null;
    this.vivo = null;
    const sirve = !v.fallo && this.ahora() - v.desde <= VIGENCIA_ESPECULATIVO_MS && mismaFrase(v.opts.message, opts.message) && mismoContexto(v.opts, opts);
    if (!sirve) {
      this.cortar(v);
      return null;
    }
    v.h = h;
    for (const e of v.eventos.splice(0)) entregar(h, e);
    void this.d.confirmar(v.idTurno).then(
      (ok) => {
        if (!ok) v.stream.abort();
      },
      () => v.stream.abort()
    );
    return { promise: v.stream.promise, abort: v.stream.abort, idTurno: v.idTurno, adelantoMs: Math.max(0, this.ahora() - v.desde) };
  }

  /** La persona siguió hablando (o la mesa no lo va a usar): se corta. */
  cancelar() {
    const v = this.vivo;
    this.vivo = null;
    if (v) this.cortar(v);
  }

  private cortar(v: Vivo) {
    try {
      v.stream.abort();
    } catch {
      /* */
    }
    try {
      this.d.cancelar?.(v.idTurno);
    } catch {
      /* */
    }
  }
}

function entregar(h: StreamHandlers, e: Evento) {
  if (e.k === 'emocion') h.onEmocion?.(e.v);
  else if (e.k === 'delta') h.onDelta(e.v);
  else if (e.k === 'replace') h.onReplace?.(e.v);
  else h.onTools?.(e.v);
}
