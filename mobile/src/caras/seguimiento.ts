/**
 * SEGUIR LAS CARAS ENTRE FOTOS Y VOTAR QUIÉN ES (lo puro; se prueba en Node).
 *
 * José (5-oct): «le costó reconocer». Antes se miraba quién era cada 20 s con UNA foto, y lo que salía
 * (un acierto suelto, o un «no sé» por una mala toma) era la verdad hasta la siguiente. Ahora:
 *
 *  · cada foto del bucle trae las cajas de ML Kit; `Seguidor.actualizar` las une con las de la foto
 *    anterior por solapamiento (IoU) y así cada cara es una PISTA que dura mientras se la vea (con
 *    `PERDIDA_MS` de tolerancia: ML Kit pierde una cara en una foto suelta);
 *  · cada reconocimiento es un VOTO para su pista (el motor analiza recortes de esas mismas cajas, así
 *    que se sabe de qué pista es cada vector). Un nombre se CONFIRMA cuando ≥ 2 de los últimos 3 votos
 *    coinciden; se cambia solo si ≥ 2 de los últimos 3 dicen otro nombre. Los «no sé» no lo borran (una
 *    toma movida no hace olvidar a nadie) salvo que pase `MANTENER_MS` sin un voto a favor;
 *  · nunca se muestra un nombre con un solo voto: mejor «Persona» que el nombre equivocado;
 *  · `tocaReconocer`: cuándo mirar otra vez. Enseguida al llegar alguien, ~1,2 s si falta un voto para
 *    confirmar, ~2,5 s con la vista «Lo que veo» abierta o con alguien sin nombre, ~8 s si no.
 */
import type { Reconocida, Relacion } from './caras';

export type CajaN = { x: number; y: number; w: number; h: number };

/** Solapamiento mínimo para decir que una caja es la misma cara que en la foto anterior. */
export const IOU_MIN = 0.25;
/** Una pista sin verse más que esto, se cierra (otra cara en ese lugar será otra pista). */
export const PERDIDA_MS = 2500;
/** En la vista se dibuja solo lo visto hace menos que esto. */
export const VIVA_MS = 1500;
export const VOTOS = 3;
export const CONFIRMAR = 2;
/** Sin un voto a favor en este tiempo (solo «no sé»), el nombre confirmado se suelta. */
export const MANTENER_MS = 30_000;
export const RECONOCER = { llegadaMs: 0, confirmarMs: 1200, atentoMs: 2500, calmaMs: 8000 };

export type Identidad = { id: string; nombre: string; relacion: Relacion; parentesco?: string; distancia: number; desde: number; ultimoVoto: number };
export type Voto = { id: string | null; nombre?: string; relacion?: Relacion; parentesco?: string; distancia: number; ts: number };
/** `ext`: el trackingId de ML Kit de la cámara en vivo (modules/aura-camara), si la pista viene de ahí. */
export type Pista = { id: number; caja: CajaN; visto: number; nacio: number; votos: Voto[]; identidad: Identidad | null; ext?: number };

export function iou(a: CajaN, b: CajaN): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * La identidad que dicen los votos (los últimos `VOTOS`): la que tenga ≥ `CONFIRMAR`. Si ninguna llega,
 * se queda la actual mientras no pase `MANTENER_MS` sin un voto a su favor.
 */
export function decidirIdentidad(votos: Voto[], actual: Identidad | null, ahora: number): Identidad | null {
  const ultimos = votos.slice(-VOTOS);
  const cuenta = new Map<string, Voto[]>();
  for (const v of ultimos) if (v.id) cuenta.set(v.id, [...(cuenta.get(v.id) || []), v]);
  let ganador: Voto[] | null = null;
  for (const vs of cuenta.values()) if (vs.length >= CONFIRMAR && (!ganador || vs.length > ganador.length)) ganador = vs;
  if (ganador) {
    const v = ganador[ganador.length - 1];
    const mejor = Math.min(...ganador.map((x) => x.distancia));
    if (actual && actual.id === v.id) return { ...actual, distancia: mejor, ultimoVoto: v.ts, nombre: v.nombre || actual.nombre, parentesco: v.parentesco ?? actual.parentesco };
    return { id: v.id!, nombre: v.nombre || '', relacion: v.relacion || 'conocido', ...(v.parentesco ? { parentesco: v.parentesco } : {}), distancia: mejor, desde: ahora, ultimoVoto: v.ts };
  }
  if (!actual) return null;
  const aFavor = ultimos.filter((v) => v.id === actual.id).map((v) => v.ts);
  const ultimo = Math.max(actual.ultimoVoto, ...aFavor);
  return ahora - ultimo > MANTENER_MS ? null : { ...actual, ultimoVoto: ultimo };
}

export class Seguidor {
  private pistas: Pista[] = [];
  private siguiente = 1;
  /** Nació una pista desde el último pedido de reconocer (alguien llegó). */
  private nueva = false;

  /**
   * Las cajas de una foto → la pista de cada una (mismo orden que `cajas`). `ids` (cámara en vivo): el
   * trackingId de ML Kit de cada caja (negativo o ausente = sin seguimiento). Con id, la pista es la de ESE
   * id mientras viva (la identidad votada se queda con la persona aunque se cruce con otra); un id nuevo es
   * una pista nueva aunque se solape con una vieja de otro id. Sin id, por solapamiento como siempre.
   */
  actualizar(cajas: CajaN[], ts: number, ids?: (number | null | undefined)[]): Pista[] {
    this.pistas = this.pistas.filter((p) => ts - p.visto <= PERDIDA_MS);
    const ext = (i: number) => {
      const e = ids?.[i];
      return typeof e === 'number' && e >= 0 ? e : undefined;
    };
    const asignadas = new Map<number, Pista>();
    const usadas = new Set<Pista>();
    cajas.forEach((_, i) => {
      const e = ext(i);
      if (e === undefined) return;
      const p = this.pistas.find((x) => x.ext === e);
      if (p && !usadas.has(p)) {
        asignadas.set(i, p);
        usadas.add(p);
      }
    });
    const pares: { i: number; p: Pista; o: number }[] = [];
    cajas.forEach((c, i) => {
      if (asignadas.has(i)) return;
      const e = ext(i);
      this.pistas.forEach((p) => {
        if (usadas.has(p) || (e !== undefined && p.ext !== undefined && p.ext !== e)) return;
        const o = iou(c, p.caja);
        if (o >= IOU_MIN) pares.push({ i, p, o });
      });
    });
    pares.sort((a, b) => b.o - a.o);
    for (const { i, p } of pares) {
      if (asignadas.has(i) || usadas.has(p)) continue;
      asignadas.set(i, p);
      usadas.add(p);
    }
    return cajas.map((c, i) => {
      const p = asignadas.get(i);
      const e = ext(i);
      if (p) {
        p.caja = c;
        p.visto = ts;
        if (e !== undefined) p.ext = e;
        return p;
      }
      const n: Pista = { id: this.siguiente++, caja: c, visto: ts, nacio: ts, votos: [], identidad: null, ...(e !== undefined ? { ext: e } : {}) };
      this.pistas.push(n);
      this.nueva = true;
      return n;
    });
  }

  /** Un reconocimiento para la pista `id` (r null = «no sé quién es»). Devuelve la identidad que queda. */
  votar(id: number, r: Reconocida | null, ts: number): { pista: Pista | null; identidad: Identidad | null; confirmo: boolean } {
    const p = this.pistas.find((x) => x.id === id);
    if (!p) return { pista: null, identidad: null, confirmo: false };
    p.votos = [...p.votos, r ? { id: r.id, nombre: r.nombre, relacion: r.relacion, ...(r.parentesco ? { parentesco: r.parentesco } : {}), distancia: r.distancia, ts } : { id: null, distancia: 1, ts }].slice(-VOTOS);
    const antes = p.identidad;
    p.identidad = decidirIdentidad(p.votos, antes, ts);
    return { pista: p, identidad: p.identidad, confirmo: !!p.identidad && p.identidad.id !== antes?.id };
  }

  /** Las pistas que se ven ahora (para dibujar). */
  visibles(ts: number): Pista[] {
    return this.pistas.filter((p) => ts - p.visto <= VIVA_MS);
  }

  /** ¿Hay alguien a la vista sin nombre confirmado? */
  sinIdentificar(ts: number): boolean {
    return this.visibles(ts).some((p) => !p.identidad);
  }

  /** ¿Alguien a la vista tiene un solo voto (le falta otro para confirmar)? */
  porConfirmar(ts: number): boolean {
    return this.visibles(ts).some((p) => !p.identidad && p.votos.length > 0 && p.votos.some((v) => v.id));
  }

  /** Llegó alguien desde el último reconocimiento (sin borrar la marca). */
  hayNueva(): boolean {
    return this.nueva;
  }

  /** Lo mismo, y se borra la marca (al pedir de verdad el reconocimiento). */
  tomarNueva(): boolean {
    const n = this.nueva;
    this.nueva = false;
    return n;
  }

  /**
   * Quién está (para el cerebro): nombres confirmados y cuántas caras SIN nombre después de mirarlas al
   * menos `CONFIRMAR` veces (a quien acaba de llegar todavía no se le dice «no te conozco»), vistas hace
   * menos de `frescoMs`.
   */
  presentes(ts: number, frescoMs = 10_000): { r: Identidad[]; desconocidas: number } {
    const vivas = this.pistas.filter((p) => ts - p.visto <= frescoMs);
    const r: Identidad[] = [];
    for (const p of vivas) if (p.identidad && !r.some((x) => x.id === p.identidad!.id)) r.push(p.identidad);
    return { r, desconocidas: vivas.filter((p) => !p.identidad && p.votos.length >= CONFIRMAR).length };
  }

  /** «Olvida a Ana»: su nombre se borra ya de la vista (y de los votos). */
  olvidar(id?: string) {
    for (const p of this.pistas) {
      if (id && p.identidad?.id !== id && !p.votos.some((v) => v.id === id)) continue;
      p.identidad = null;
      p.votos = id ? p.votos.filter((v) => v.id !== id) : [];
    }
  }

  reiniciar() {
    this.pistas = [];
    this.nueva = false;
  }
}

/** ¿Toca analizar quién es? (nunca dos a la vez: `ocupado`). */
export function tocaReconocer(o: { ahora: number; ultima: number; nueva: boolean; porConfirmar: boolean; vistaAbierta: boolean; sinIdentificar: boolean; ocupado: boolean }): boolean {
  if (o.ocupado) return false;
  if (o.nueva) return o.ahora - o.ultima >= RECONOCER.llegadaMs;
  const cada = o.porConfirmar ? RECONOCER.confirmarMs : o.vistaAbierta || o.sinIdentificar ? RECONOCER.atentoMs : RECONOCER.calmaMs;
  return o.ahora - o.ultima >= cada;
}

/* ── sin ML Kit: el respaldo del servidor (revisión del 5-oct, M3) ───────────────────────────── */

/**
 * Sin ML Kit (no está, o falló 3 veces) la cámara manda una foto al servidor cada 12 s (30 s dormida) y no
 * hay cajas ni pistas que votar. Antes, ahí no se reconocía a nadie de forma continua (solo con «¿quién
 * soy?»). Ahora esa MISMA foto se ofrece también al motor de caras (que busca las caras él mismo), como
 * mucho cada `cadaMs`, y lo que sale vale para la escena del turno `frescoMs` (2,5× el ritmo del respaldo).
 * Con ML Kit esto no corre: cada foto va por UNA sola vía (onCaras con ML Kit, onFotoRespaldo sin él).
 */
export const RESPALDO = { cadaMs: 10_000, frescoMs: 30_000 };

export function tocaReconocerRespaldo(o: { ahora: number; ultima: number; ocupado: boolean; reconoce: boolean }): boolean {
  return o.reconoce && !o.ocupado && o.ahora - o.ultima >= RESPALDO.cadaMs;
}

export type PresenteRespaldo = Pick<Reconocida, 'id' | 'nombre' | 'relacion' | 'parentesco'>;

/** Lo que vio el respaldo (sin votos: una toma; sin pistas: no se dibuja, solo va a la escena). */
export class VistoRespaldo {
  private v: { r: PresenteRespaldo[]; desconocidas: number; t: number } | null = null;
  poner(r: PresenteRespaldo[], desconocidas: number, t: number) {
    this.v = { r, desconocidas, t };
  }
  presentes(ts: number, frescoMs = RESPALDO.frescoMs): { r: PresenteRespaldo[]; desconocidas: number } {
    if (!this.v || ts - this.v.t > frescoMs) return { r: [], desconocidas: 0 };
    return { r: this.v.r, desconocidas: this.v.desconocidas };
  }
  olvidar(id?: string) {
    if (!this.v) return;
    if (!id) this.v = null;
    else this.v = { ...this.v, r: this.v.r.filter((x) => x.id !== id) };
  }
}
