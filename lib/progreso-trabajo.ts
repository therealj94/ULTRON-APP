/**
 * EL PROGRESO REAL DE UN TURNO QUE TRABAJA (José: «que se sienta que está trabajando, pero que no se note una AI atrás»).
 *
 * El harness (lib/harness.ts) avisa cuando una herramienta EMPIEZA de verdad (`alEmpezar`: ya pasó el reloj del turno, el
 * permiso y el «persistir antes de actuar») y cuando TERMINA (`alPaso`, con su estado, su resumen y su recibo). Aquí se
 * vuelven eventos chicos y tipados (`EventoProgreso`, mobile/src/compa/narrador.ts) que el turno manda como
 * `event: progreso` por el SSE de /api/turno/stream y por el turno de la voz (server/voz-agente.ts). Con ellos el teléfono
 * y la voz dicen «Abro tu correo…», «Hay dos de Ana…» y la mesa enseña una línea que cambia en su lugar.
 *
 * Lo que NUNCA viaja:
 *  · el resumen de la herramienta (lo que trajo: correos, páginas, mensajes): solo el NÚMERO, y solo si el texto lo dice
 *    con su forma conocida (`lecturaDeResultado`); si no se reconoce, no se cuenta nada (ni «encontré»);
 *  · los argumentos: de un correo o un WhatsApp solo el tema de una BÚSQUEDA («buscar Ana» → «Ana»), saneado (sin
 *    direcciones, números largos ni enlaces); nunca el texto de un borrador; de la web, la consulta saneada;
 *  · en MODO INVITADO (server/modo-invitado.ts), ni tema ni número, y solo de lo público (web, leer): las herramientas
 *    privadas ya están apagadas, y si alguna llegara a correr, su progreso no sale.
 * Un fallo no se narra como avance: no hay evento (la respuesta honesta lo dice). Quien escucha nunca rompe el turno.
 */
import { limpiarDetalle, MemoriaNarrador, type EventoProgreso, type FaseProgreso, type HerramientaProgreso } from '../mobile/src/compa/narrador';
import type { ReciboHerramienta, EstadoHerramienta } from './recibo-herramienta';

export type { EventoProgreso, FaseProgreso, HerramientaProgreso } from '../mobile/src/compa/narrador';

/** La categoría pública de una herramienta del harness (null: no es una herramienta que se narre). */
export function categoriaDe(herramienta: string): HerramientaProgreso | null {
  const h = String(herramienta || '').trim().toLowerCase();
  if (h === 'web' || h === 'leer' || h === 'correo' || h === 'whatsapp' || h === 'computadora') return h;
  if (['sistema', 'ejecutor', 'mision', 'circulo', 'triaje', 'tarea', 'cartera', 'investigar'].includes(h)) return 'trabajo';
  return null;
}

/** Lo único que se narra para un invitado. */
const PUBLICAS: ReadonlySet<HerramientaProgreso> = new Set(['web', 'leer']);

/**
 * El tema que se puede enseñar de lo que pidió el modelo. Web: la consulta (es lo que la persona preguntó). Correo y
 * WhatsApp: solo el tema de una búsqueda («buscar Ana», «busca factura de luz»); revisar, leer, responder o escribir no
 * dan tema (llevarían el texto de un borrador o una referencia). Lo demás, nada.
 */
export function detalleSeguro(herramienta: string, arg: string): string | undefined {
  const h = String(herramienta || '').trim().toLowerCase();
  const a = String(arg || '').split('|')[0].trim();
  let tema = '';
  if (h === 'web') tema = a;
  else if (h === 'correo' || h === 'whatsapp') {
    const m = /^(?:buscar|busca)\s+(.+)$/i.exec(a);
    tema = m ? m[1] : '';
  }
  const limpio = limpiarDetalle(tema.replace(/^(?:de|a|lo de|los de|del)\s+/i, ''));
  return limpio || undefined;
}

type PasoVisto = { herramienta: string; estado: EstadoHerramienta; resumen: string; recibo?: ReciboHerramienta };

/**
 * Qué se puede decir de cómo terminó una herramienta, leyendo SOLO las formas conocidas de su resumen. null: nada que
 * narrar (un fallo, una forma que no se reconoce o una herramienta que no cuenta resultados).
 */
export function lecturaDeResultado(p: PasoVisto): { fase: FaseProgreso; n?: number } | null {
  const h = String(p.herramienta || '').toLowerCase();
  const t = String(p.resumen || '');
  // Dejó algo esperando su «sí» (un borrador de correo o WhatsApp, su círculo): lo pide la respuesta.
  if (p.recibo?.efecto === 'borrador') return { fase: 'espera_ok' };
  if (h === 'web') {
    if (/^HARNESS web "[^"]*": sin resultados\./.test(t)) return { fase: 'nada' };
    if (p.estado !== 'succeeded' || !/^HARNESS web "/.test(t)) return null;
    const lista = t.split(/\nPRIMERA FUENTE /)[0];
    const n = (lista.match(/^\d+\. /gm) || []).length;
    return n > 0 ? { fase: 'encontre', n } : null;
  }
  if (h === 'leer') return p.estado === 'succeeded' && /^HARNESS leer \(/.test(t) ? { fase: 'paso' } : null;
  if (h === 'correo') {
    // «No sé si tiene», «no pude mirar»: no es «no hay» (AUR07). Solo se dice nada cuando de verdad no hay.
    if (/no pude (abrir|mirar|buscar)/i.test(t)) return null;
    if (/^CORREO \([^)]*\): nada\./.test(t) || /no tiene ningún correo en la bandeja de entrada/.test(t) || /no encuentro ningún correo de «[^»]*» \(ni en la lista/.test(t)) return { fase: 'nada' };
    if (p.estado !== 'succeeded') return null;
    const m = /^CORREO \((?:sin leer|buscando «[^»]*»): (\d+)/.exec(t) || /buscando «[^»]*» hay (\d+)/.exec(t) || /hay (\d+) que encajan/.exec(t);
    if (m) return { fase: 'encontre', n: Number(m[1]) };
    return /^CORREO( \d+ de \d+)? \(|^CORREO \(sigue/.test(t) ? { fase: 'paso' } : null;
  }
  if (h === 'whatsapp') {
    if (/^WHATSAPP: (nada con «|no hay chats todavía)/.test(t)) return { fase: 'nada' };
    if (p.estado !== 'succeeded') return null;
    const sinLeer = /^WHATSAPP \((\d+) con mensajes sin leer/.exec(t);
    if (sinLeer) return { fase: 'encontre', n: Number(sinLeer[1]) };
    if (/^WHATSAPP \(buscando «/.test(t)) {
      const n = (t.match(/^· /gm) || []).length;
      return n > 0 ? { fase: 'encontre', n } : null;
    }
    return { fase: 'paso' };
  }
  if (h === 'computadora') {
    // Terminó y se comprobó: lo tiene. Sigue (o no se pudo comprobar) con su misión abierta: su computadora sigue.
    if (p.estado === 'succeeded') return { fase: 'encontre' };
    if (p.estado === 'unknown' && p.recibo?.referencia) return { fase: 'paso' };
    return null;
  }
  // Lo demás (sus misiones, su círculo, investigar en segundo plano…) no cuenta resultados: solo cierra con `listo`.
  return null;
}

/**
 * El que emite los eventos de UN turno. `enviar` es el `send('progreso', …)` del turno en vivo. Recuerda el tema de cada
 * herramienta que empezó (para su resultado) y no emite nada de una herramienta cuyo inicio no salió.
 */
export class EmisorProgreso {
  private emitidas = new Map<string, { cat: HerramientaProgreso; detalle?: string }>();
  private ultima: HerramientaProgreso | null = null;

  constructor(
    private enviar: (ev: EventoProgreso) => void,
    private o: { invitado?: boolean } = {}
  ) {}

  private mandar(ev: EventoProgreso) {
    try {
      this.enviar(ev);
    } catch {
      /* quien escucha no rompe el turno */
    }
  }

  /** La herramienta empezó de verdad (lib/harness.ts `alEmpezar`). */
  empezo(herramienta: string, arg = '', ronda?: number) {
    const cat = categoriaDe(herramienta);
    if (!cat || (this.o.invitado && !PUBLICAS.has(cat))) return;
    const detalle = this.o.invitado ? undefined : detalleSeguro(herramienta, arg);
    this.emitidas.set(String(herramienta).toLowerCase(), { cat, ...(detalle ? { detalle } : {}) });
    this.ultima = cat;
    this.mandar({ fase: 'empece', herramienta: cat, ...(detalle ? { detalle_seguro: detalle } : {}), ...(ronda ? { ronda } : {}) });
  }

  /** La herramienta terminó (lib/harness.ts `alPaso`). */
  termino(p: PasoVisto & { ronda?: number }) {
    const vista = this.emitidas.get(String(p.herramienta).toLowerCase());
    if (!vista) return;
    const l = lecturaDeResultado(p);
    if (!l) return;
    const conDatos = !this.o.invitado;
    this.mandar({
      fase: l.fase,
      herramienta: vista.cat,
      ...(conDatos && vista.detalle && l.fase !== 'espera_ok' ? { detalle_seguro: vista.detalle } : {}),
      ...(conDatos && l.n !== undefined ? { n: l.n } : {}),
      ...(p.ronda ? { ronda: p.ronda } : {}),
    });
  }

  /** Terminó el trabajo del turno (la respuesta ya viene): la línea de la mesa se va. */
  listo() {
    if (!this.ultima) return;
    this.mandar({ fase: 'listo', herramienta: this.ultima });
  }

  get huboTrabajo(): boolean {
    return this.ultima !== null;
  }
}

/* ------------------------------------------------------------------ la memoria de frases de cada conversación */

const MEMORIAS = new Map<string, MemoriaNarrador>();
const MAX_MEMORIAS = 300;

/**
 * Las frases que el narrador ya dijo en ESTA conversación de voz (server/voz-agente.ts, por su `cid`): ninguna se repite
 * entre turnos. En memoria del proceso, las últimas MAX_MEMORIAS conversaciones (una que vuelve después es otra sesión).
 */
export function memoriaNarradorDe(cid: string): MemoriaNarrador {
  const k = String(cid || '');
  let m = MEMORIAS.get(k);
  if (m) {
    MEMORIAS.delete(k);
  } else {
    m = new MemoriaNarrador();
    if (MEMORIAS.size >= MAX_MEMORIAS) MEMORIAS.delete(MEMORIAS.keys().next().value as string);
  }
  MEMORIAS.set(k, m);
  return m;
}

/* ------------------------------------------------------------------ su computadora: los avances largos */

/**
 * La frase de «sigo» de su computadora (server/computadora.ts `narrar`) cuando no hay un paso nuevo que contar. Con un
 * plan de verdad (dos pasos o más) y pasos con recibo, dice cuántos lleva de cuántos («ya llevo dos de tres»): el número
 * sale de los recibos del plan, no de lo que el modelo cree. Sin eso, una de varias, sin número. `vez` la cambia.
 */
export function fraseSigoEnComputadora(o: { idioma?: 'es' | 'en'; hechos?: number; total?: number; vez?: number }): string {
  const en = o.idioma === 'en';
  const vez = Math.max(0, Math.floor(o.vez ?? 0));
  const total = Math.floor(o.total ?? 0);
  const hechos = Math.floor(o.hechos ?? 0);
  const palabra = (n: number) => (en ? ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'] : ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez'])[n] ?? String(n);
  const sinNumero = en
    ? ["I'm still working on it on my computer.", 'Still at it on my computer.', "My computer's still on it; I'll keep going."]
    : ['Sigo con eso en mi computadora.', 'Todavía estoy en eso, en mi computadora.', 'Mi computadora sigue en eso; no lo suelto.'];
  if (total >= 2 && hechos >= 1 && hechos < total) {
    const h = palabra(hechos);
    const t = palabra(total);
    const conNumero = en
      ? [`Still on it; I've done ${h} of ${t}.`, `Making progress: ${h} of ${t} done.`, `I keep going; ${h} of ${t} so far.`]
      : [`Sigo con eso; ya llevo ${h} de ${t}.`, `Voy avanzando: ya tengo ${h} de ${t}.`, `Aquí sigo; ${hechos === 1 ? 'va' : 'van'} ${h} de ${t}.`];
    // Seis distintas (con y sin número, alternadas): en un trabajo largo no suena la misma dos veces.
    const xs = [conNumero[0], sinNumero[0], conNumero[1], sinNumero[1], conNumero[2], sinNumero[2]];
    return xs[vez % xs.length];
  }
  return sinNumero[vez % sinNumero.length];
}

/**
 * El aviso corto del final de su computadora cuando la app está cerrada (FCM, server.ts alAvisarApp). El título dice cómo
 * terminó de verdad (`ok` del final de la misión: nunca «Terminé» si no quedó), y el texto es el final honesto sin la
 * muletilla repetida («Listo, ya terminé en mi computadora.» ya lo dice el título), cortado en una frase.
 */
export function avisoFinalComputadora(texto: string, ok: boolean | undefined, idioma: 'es' | 'en' = 'es'): { titulo: string; texto: string } {
  const en = idioma === 'en';
  const titulo = ok ? (en ? 'Done on my computer' : 'Ya quedó lo de mi computadora') : en ? 'About your computer task' : 'Sobre lo de mi computadora';
  let t = String(texto || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(Listo, ya terminé en mi computadora\.|Done, I finished on my computer\.)\s*/i, '');
  if (t.length > 170) {
    const corte = t.slice(0, 170);
    const fin = Math.max(corte.lastIndexOf('. '), corte.lastIndexOf('? '), corte.lastIndexOf('! '));
    t = fin >= 60 ? corte.slice(0, fin + 1) : `${corte.slice(0, 168).trimEnd()}…`;
  }
  return { titulo, texto: t || (ok ? (en ? 'I finished it.' : 'Ya lo terminé.') : en ? 'It did not finish; open it to see where it stopped.' : 'No quedó; ábrelo para ver dónde se quedó.') };
}
