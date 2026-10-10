/**
 * LAS ENTRADAS RÁPIDAS A AURA (Fase 1 del plan): de dónde vino la persona, si es una doble pulsación y cuánto tardó.
 *
 * Hay dos formas de llegar, y las dos traen su origen:
 *
 *  · `ultronfp://burbuja?origen=…&t=…` — la BURBUJA encima de cualquier app (src/burbuja/Burbuja.tsx). La abren el
 *    botón lateral (origen=asistente: la sesión del asistente digital), ASSIST (asistente) y VOICE_COMMAND (comando), el
 *    mosaico de Ajustes rápidos (mosaico) y el atajo del ícono (atajo). La abre el nativo (plugins/asistente-digital.js);
 *    las props de arranque de la actividad dicen `{ modo: 'burbuja', origen, invocadaEn }` y, si la vuelven a llamar
 *    con la burbuja abierta, llega este enlace por Linking.
 *  · `ultronfp://hablar?origen=…` — la app ENTERA, directo a la mesa con el micrófono escuchando (con sesión: sin la
 *    espera mínima de la intro; sin sesión: la entrada de siempre). La usa «Abrir en AURA» de la burbuja
 *    (origen=burbuja) y cualquiera que tenga el enlace.
 *
 * Un origen desconocido cuenta como «enlace»: nadie inventa orígenes en las migas desde fuera.
 *
 * La doble invocación (dos pulsaciones del botón, el mosaico tocado dos veces) se ignora dentro de 1,5 s.
 *
 * La medida, una línea por invocación en las migas (lib/reporte.ts): `[entrada] origen=… invocacion→escuchando=…ms`,
 * desde el momento de la invocación (el `t` que pone el nativo al pulsar: cuenta también lo que tarda React en
 * arrancar) hasta que un motor del oído escucha DE VERDAD (speech.oidoEscuchando), no hasta que se pidió.
 *
 * Sin React Native: se prueba en Node (tests/asistente-digital-movil.test.ts).
 */

export const ORIGENES = ['asistente', 'comando', 'mosaico', 'atajo', 'burbuja', 'enlace'] as const;
export type OrigenEntrada = (typeof ORIGENES)[number];

export const ESQUEMA_AURA = 'ultronfp';

/** Dos invocaciones dentro de esto son una sola (la segunda se ignora). */
export const VENTANA_DOBLE_MS = 1_500;

/** Un `t` más viejo que esto no es la invocación de ahora (un enlace guardado, un reloj raro): se mide desde que llegó. */
export const T_CREIBLE_MS = 60_000;

/** Un «hablar» que espera (la intro, la entrada sin sesión) deja de valer pasado esto: no abre el micrófono horas después. */
export const VIGENCIA_PEDIDO_MS = 2 * 60_000;

/** Cuánto se espera a que el oído escuche antes de decir que no se pudo (micrófono ocupado, sin foco de audio). */
export const TOPE_ESCUCHAR_MS = 6_000;

export function origenValido(v: unknown): OrigenEntrada {
  const s = String(v ?? '')
    .trim()
    .toLowerCase();
  return (ORIGENES as readonly string[]).includes(s) ? (s as OrigenEntrada) : 'enlace';
}

export type EnlaceEntrada = { destino: 'hablar' | 'burbuja'; origen: OrigenEntrada; invocadaEn: number | null };

function decodificar(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    // Un `%` roto no tumba al oyente de Linking (lib/genesis.ts aprendió lo mismo).
    return s;
  }
}

function consulta(q: string): Record<string, string> {
  const fuera: Record<string, string> = {};
  for (const par of q.split('&')) {
    if (!par) continue;
    const i = par.indexOf('=');
    const k = decodificar(i < 0 ? par : par.slice(0, i));
    if (k && !(k in fuera)) fuera[k] = decodificar(i < 0 ? '' : par.slice(i + 1));
  }
  return fuera;
}

/**
 * `ultronfp://hablar?…` o `ultronfp://burbuja?…` → qué pide; cualquier otro enlace (la vuelta de la wallet, el App Link
 * de /sso, otro esquema) → null, y lo atiende quien siempre lo atendió. Sin `URL`: la de React Native no es completa.
 */
export function leerEnlace(url: unknown): EnlaceEntrada | null {
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)[^?#]*(?:\?([^#]*))?/i.exec(String(url ?? '').trim());
  if (!m || m[1].toLowerCase() !== ESQUEMA_AURA) return null;
  const host = m[2].toLowerCase();
  if (host !== 'hablar' && host !== 'burbuja') return null;
  const q = consulta(m[3] || '');
  const t = Number(q.t);
  return { destino: host, origen: origenValido(q.origen), invocadaEn: Number.isFinite(t) && t > 0 ? t : null };
}

/** El enlace de «Abrir en AURA» (y de cualquiera que quiera la app entera escuchando). */
export function enlaceHablar(origen: OrigenEntrada, t?: number): string {
  return `${ESQUEMA_AURA}://hablar?origen=${origen}${t ? `&t=${Math.round(t)}` : ''}`;
}

/** Desde cuándo se mide: el `t` de la invocación si es creíble; si no, cuando llegó. */
export function momentoInvocacion(invocadaEn: number | null | undefined, recibidaEn: number): number {
  if (typeof invocadaEn !== 'number' || !Number.isFinite(invocadaEn)) return recibidaEn;
  if (invocadaEn > recibidaEn + 1_000 || recibidaEn - invocadaEn > T_CREIBLE_MS) return recibidaEn;
  return invocadaEn;
}

export type ModoRaiz = { modo: 'app' } | { modo: 'burbuja'; origen: OrigenEntrada; invocadaEn: number | null };

/**
 * Las props de arranque de la actividad (las pone BurbujaActivity; MainActivity no pone ninguna) → qué dibuja App.tsx.
 * Cualquier otra cosa es la app de siempre: un valor raro nunca deja a la persona en una burbuja sin salida.
 */
export function modoDeArranque(props: unknown): ModoRaiz {
  const p = (props && typeof props === 'object' ? props : {}) as Record<string, unknown>;
  if (p.modo !== 'burbuja') return { modo: 'app' };
  const t = typeof p.invocadaEn === 'number' ? p.invocadaEn : Number(p.invocadaEn);
  return { modo: 'burbuja', origen: origenValido(p.origen), invocadaEn: Number.isFinite(t) && t > 0 ? t : null };
}

/** La segunda invocación dentro de la ventana no cuenta (ni extiende la ventana: la tercera, pasada, sí). */
export class GuardiaInvocacion {
  private ultima = Number.NEGATIVE_INFINITY;

  constructor(private ventanaMs = VENTANA_DOBLE_MS) {}

  aceptar(ahora: number): boolean {
    if (ahora - this.ultima < this.ventanaMs) return false;
    this.ultima = ahora;
    return true;
  }
}

/** La de los `hablar` de la app entera: la comparten el oyente de enlaces y el «Abrir en AURA» de la burbuja. */
export const guardiaHablar = new GuardiaInvocacion();

/** La línea de la medida, siempre con la misma forma (se busca en los reportes por `[entrada]`). */
export function lineaEntrada(origen: OrigenEntrada, desde: number, hasta: number | null, motivo?: string): string {
  if (hasta === null) return `[entrada] origen=${origen} invocacion→escuchando=sin-oido${motivo ? ` (${motivo})` : ''}`;
  return `[entrada] origen=${origen} invocacion→escuchando=${Math.max(0, Math.round(hasta - desde))}ms${motivo ? ` (${motivo})` : ''}`;
}

/* ── el «hablar» que espera a la mesa ─────────────────────────────────────────────────────────── */

/**
 * `interno`: lo pidió la burbuja desde ESTE mismo motor de JS (su «Abrir en AURA» deja el pedido en el buzón). Un enlace
 * `ultronfp://hablar` de fuera nunca es interno, aunque diga `origen=burbuja` (cualquiera puede escribir ese enlace).
 */
export type PedidoHablar = { origen: OrigenEntrada; desde: number; n: number; interno: boolean };

/**
 * Revisión de fases: ¿qué hace la mesa con el micrófono ante un «hablar»? El silencio que la persona dejó puesto (el
 * botón, guardado entre sesiones) SOLO lo quita un pedido interno de la burbuja (la persona acaba de tocar «Abrir en
 * AURA» con la burbuja escuchándola). Un enlace de fuera abre la app escuchando solo si no estaba silenciada; si lo
 * estaba, la respeta (antes cualquier enlace le quitaba el silencio a escondidas).
 */
export function oidoParaHablar(p: Pick<PedidoHablar, 'interno'>, silenciadoPorPersona: boolean): 'abrir' | 'quitar-silencio' | 'respetar-silencio' {
  if (!silenciadoPorPersona) return 'abrir';
  return p.interno ? 'quitar-silencio' : 'respetar-silencio';
}

/**
 * El buzón entre el enlace (que llega en cualquier momento: con la intro a medias, en otra pantalla, con la mesa ya
 * montada) y la mesa, que es la que abre el micrófono. Uno solo vale: el último. Caduca (VIGENCIA_PEDIDO_MS).
 */
export class BuzonHablar {
  private pedido: PedidoHablar | null = null;
  private n = 0;
  private oyentes = new Set<(p: PedidoHablar) => void>();

  /** `interno` solo desde la burbuja (mismo motor de JS); el oyente de enlaces nunca lo pone. */
  pedir(origen: OrigenEntrada, desde: number, o: { interno?: boolean } = {}): PedidoHablar {
    const p = { origen, desde, n: ++this.n, interno: o.interno === true };
    this.pedido = p;
    for (const f of this.oyentes) f(p);
    return p;
  }

  /** ¿Hay uno vigente? (la intro lo mira para no hacer esperar). No lo consume. */
  pendiente(ahora: number): PedidoHablar | null {
    if (this.pedido && ahora - this.pedido.desde > VIGENCIA_PEDIDO_MS) this.pedido = null;
    return this.pedido;
  }

  /** Lo consume quien lo atiende (la mesa). */
  tomar(ahora: number): PedidoHablar | null {
    const p = this.pendiente(ahora);
    this.pedido = null;
    return p;
  }

  escuchar(f: (p: PedidoHablar) => void): () => void {
    this.oyentes.add(f);
    return () => {
      this.oyentes.delete(f);
    };
  }
}

/** El de la app (un solo motor de JS: lo comparten la mesa, la intro y el oyente de enlaces). */
export const buzonHablar = new BuzonHablar();
