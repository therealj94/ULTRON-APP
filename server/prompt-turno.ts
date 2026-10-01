/**
 * EL PROMPT DE UN TURNO DE AU-RA, armado en un solo sitio.
 *
 * Vivía dentro de prepararTurno (server.ts). Salió aquí para que se pueda probar lo que de verdad le
 * llega al modelo según con quién habla (server/nivel.ts):
 *
 *   · junta   — el de siempre: cerebro de la junta, catálogo del taller, memoria de la junta.
 *   · miembro — su cerebro (lo público, perfilPara), sin catálogo del taller, sin memoria ni hechos de
 *               la junta, y el agente del turno sin la mecánica interna de la junta.
 */
import { buildPersonality, lineaAhora } from './desk';
import { promptAgente } from '../lib/cognitivo/agentes';
import { promptMemoria } from '../lib/memoria';
import { nombreDe, type MiembroId } from '../lib/junta';
import { hechosCatalogo } from '../lib/taller';
import { perfilPara, type NivelAura, type PerfilCerebro } from '../lib/perfiles';

export type PiezasTurno = {
  nivel: NivelAura;
  /** El cerebro del turno; por omisión, el que toca al nivel. */
  perfil?: PerfilCerebro;
  /** Cómo se le dice a la persona (apodo, nombre del padrón o el que escribió). */
  nombre?: string;
  canal: 'mesa' | 'telegram';
  modo: string;
  mando: boolean;
  /** Quién es en el padrón (solo junta) y de quién es la memoria del turno. */
  quien: MiembroId | null;
  quienMem: MiembroId | null;
  agente?: string | null;
  bloquePerfil?: string;
  bloqueApp?: string;
  /** La línea del avatar (solo en la mesa). */
  lineaAvatar?: string;
  hechos: string[];
  /**
   * La memoria personal de un miembro (lib/memoria-miembro.ts: lo suyo y su hilo). Sin ella —un
   * miembro que habla sin sesión—, solo con quién habla. La junta no la usa: tiene la suya.
   */
  memoriaMiembro?: string;
  /** La memoria del miembro en modo 'firma' (con quién habla y lo que pidió recordar). */
  memoriaMiembroFirma?: string;
  /**
   * El hilo de la conversación va como mensajes del turno (server.ts mensajesQwen). Entonces el hilo
   * corto no se repite en la memoria del system: ya está en los mensajes, y dentro del system cambiaba
   * en cada turno.
   */
  hiloEnMensajes?: boolean;
};

/**
 * El prompt del turno en dos partes, en el orden en que el nodo lo lee:
 *
 *   · `fijo`     — lo que es igual turno a turno para esta persona: quién eres, el cerebro, el catálogo y
 *                  la memoria. Va ARRIBA: llama.cpp reutiliza lo que ya leyó mientras el principio no
 *                  cambie, y así solo lee lo nuevo.
 *   · `delTurno` — lo que cambia en cada turno: la hora, el perfil, el avatar, el agente, la app y los
 *                  HECHOS. Va AL FINAL.
 *
 * 30-sep: con la hora y los HECHOS mezclados arriba, el nodo releía ~4 000 fichas en cada turno y la
 * primera palabra de la llamada tardaba 7–9 s (ElevenLabs corta a los 4).
 *
 * `contexto` es lo del turno sin los HECHOS. El turno de AU-RA lo manda en el MENSAJE de la persona, no
 * en el system: el Qwen de la A10G (llama.cpp con decodificación especulativa) solo puede volver atrás
 * hasta un punto guardado, y guarda uno al empezar cada mensaje de la persona, nunca dentro del system.
 * Con cualquier cosa que cambie dentro del system, relee todo (medido: 6 s por turno con 5 800 fichas).
 */
export function piezasDelTurno(p: PiezasTurno, hora?: Date): { fijo: string; firma: string; delTurno: string; contexto: string } {
  const miembro = p.nivel === 'miembro';
  const perfil = p.perfil || perfilPara(p.nivel);
  const recuerdos = miembro
    ? 'No finjas recuerdos: solo lo que está en la memoria de esta persona y en el hilo. Nunca hables de lo que dijeron otras personas.'
    : `No finjas recuerdos: solo la memoria de ${p.quien ? nombreDe(p.quien) : 'quien no identifiqué'} y los hechos de junta. No recites la conversación privada del otro.`;
  const cabeza = `${buildPersonality({ nombre: p.nombre, canal: p.canal, modo: p.modo, mando: p.mando, nivel: p.nivel, perfil, conHora: false })}

${perfil.tituloConocimiento}:
${perfil.conocimiento}

${recuerdos}
${miembro ? '' : `${hechosCatalogo()}\n`}`;
  const memoria = miembro && p.memoriaMiembro ? p.memoriaMiembro : promptMemoria(p.quienMem, { nivel: p.nivel, nombre: p.nombre, hilo: p.hiloEnMensajes ? 'mediano' : 'todo' });
  const fijo = `${cabeza}${memoria}`;
  // Lo fijo sin la conversación ni lo guardado solo: si esto no cambió, el system de antes sigue valiendo
  // (fijoDeLaConversacion).
  const firma = `${cabeza}${miembro && p.memoriaMiembro ? p.memoriaMiembroFirma ?? p.memoriaMiembro : promptMemoria(p.quienMem, { nivel: p.nivel, nombre: p.nombre, hilo: 'firma' })}`;
  const agente = promptAgente(p.agente, p.nivel);
  // Lo del turno sin los HECHOS (el turno los pone él mismo, y el harness les suma lo que devuelve cada
  // herramienta): va en el MENSAJE de la persona, no en el system (server.ts mensajesQwen).
  const contexto = [
    lineaAhora(hora),
    p.bloquePerfil || '',
    `Modo de mesa pedido: ${p.modo}.${p.canal === 'mesa' && p.lineaAvatar ? `\n${p.lineaAvatar}` : ''}`,
    agente,
    p.bloqueApp || '',
  ]
    .filter((x) => x.trim())
    .join('\n\n');
  const delTurno = `${contexto}\n\nHECHOS:\n${p.hechos.join('\n') || '(ninguno)'}`;
  return { fijo, firma, delTurno, contexto };
}

/**
 * LO FIJO SE QUEDA FIJO DURANTE LA CONVERSACIÓN.
 *
 * La memoria de la persona trae la conversación mediana (los turnos 40 a 8 hacia atrás), y cada turno
 * la corre un lugar: dentro del system, eso obligaba al nodo a releerlo todo (1-oct, medido en
 * producción después de #95: 66 % común, 5 700 fichas releídas, 6 s por turno).
 *
 * Mientras la conversación sigue viva, el turno reutiliza el `fijo` que ya armó, siempre que su `firma`
 * (reglas, cerebro, catálogo, modo, avatar, con quién habla, su acceso y lo que pidió recordar) no haya
 * cambiado. Lo que se guarda solo, por nombrar «la mina» o «la junta», no entra en la firma: pasaba casi
 * cada turno. Lo dicho en la conversación no se pierde: va en los mensajes.
 *   · Se rehace al instante si cambia la firma (pidió recordar algo, otro avatar, otro modo, otro acceso).
 *   · Se rehace tras CONGELAR_INACTIVA_MS sin turnos o CONGELAR_MAX_MS desde que se armó: lo guardado
 *     desde otro lado (Telegram, la web) llega a la conversación a más tardar entonces.
 */
export const CONGELAR_INACTIVA_MS = 10 * 60_000;
export const CONGELAR_MAX_MS = 30 * 60_000;
const congelados = new Map<string, { fijo: string; firma: string; creado: number; usado: number }>();

export function fijoDeLaConversacion(clave: string, fijo: string, firma: string, ahora = Date.now()): string {
  if (!clave) return fijo;
  const c = congelados.get(clave);
  if (c && c.firma === firma && ahora - c.usado < CONGELAR_INACTIVA_MS && ahora - c.creado < CONGELAR_MAX_MS) {
    c.usado = ahora;
    return c.fijo;
  }
  congelados.delete(clave);
  congelados.set(clave, { fijo, firma, creado: ahora, usado: ahora });
  // Una por persona; las más viejas se van primero.
  while (congelados.size > 500) congelados.delete(congelados.keys().next().value as string);
  return fijo;
}

/**
 * Suena la llamada y el nodo se precalienta con el último system de la persona (server.ts
 * calentarCerebro): el primer turno de la llamada tiene que usar ESE mismo fijo, aunque haga rato que no
 * hablaba. La firma se sigue comprobando en el turno.
 */
export function renovarFijo(clave: string, ahora = Date.now()): void {
  const c = congelados.get(clave);
  if (c) {
    c.creado = ahora;
    c.usado = ahora;
  }
}

/** Solo pruebas. */
export function _olvidarFijos(): void {
  congelados.clear();
}

/** El prompt del turno de una pieza (lo fijo y después lo del turno). */
export function personalidadDelTurno(p: PiezasTurno, hora?: Date): string {
  const { fijo, delTurno } = piezasDelTurno(p, hora);
  return `${fijo}\n\n${delTurno}`;
}
