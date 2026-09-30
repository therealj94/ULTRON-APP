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
 */
export function piezasDelTurno(p: PiezasTurno, hora?: Date): { fijo: string; delTurno: string } {
  const miembro = p.nivel === 'miembro';
  const perfil = p.perfil || perfilPara(p.nivel);
  const recuerdos = miembro
    ? 'No finjas recuerdos: solo lo que está en la memoria de esta persona y en el hilo. Nunca hables de lo que dijeron otras personas.'
    : `No finjas recuerdos: solo la memoria de ${p.quien ? nombreDe(p.quien) : 'quien no identifiqué'} y los hechos de junta. No recites la conversación privada del otro.`;
  const fijo = `${buildPersonality({ nombre: p.nombre, canal: p.canal, modo: p.modo, mando: p.mando, nivel: p.nivel, perfil, conHora: false })}

${perfil.tituloConocimiento}:
${perfil.conocimiento}

${recuerdos}
${miembro ? '' : `${hechosCatalogo()}\n`}${miembro && p.memoriaMiembro ? p.memoriaMiembro : promptMemoria(p.quienMem, { nivel: p.nivel, nombre: p.nombre })}`;
  const agente = promptAgente(p.agente, p.nivel);
  const delTurno = [
    lineaAhora(hora),
    p.bloquePerfil || '',
    `Modo de mesa pedido: ${p.modo}.${p.canal === 'mesa' && p.lineaAvatar ? `\n${p.lineaAvatar}` : ''}`,
    agente,
    p.bloqueApp || '',
    `HECHOS:\n${p.hechos.join('\n') || '(ninguno)'}`,
  ]
    .filter((x) => x.trim())
    .join('\n\n');
  return { fijo, delTurno };
}

/** El prompt del turno de una pieza (lo fijo y después lo del turno). */
export function personalidadDelTurno(p: PiezasTurno, hora?: Date): string {
  const { fijo, delTurno } = piezasDelTurno(p, hora);
  return `${fijo}\n\n${delTurno}`;
}
