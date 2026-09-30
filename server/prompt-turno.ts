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
import { buildPersonality } from './desk';
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
};

export function personalidadDelTurno(p: PiezasTurno): string {
  const miembro = p.nivel === 'miembro';
  const perfil = p.perfil || perfilPara(p.nivel);
  const recuerdos = miembro
    ? 'No finjas recuerdos: de los miembros no se guarda memoria de largo plazo; usa el hilo de esta conversación. Nunca hables de lo que dijeron otras personas.'
    : `No finjas recuerdos: solo la memoria de ${p.quien ? nombreDe(p.quien) : 'quien no identifiqué'} y los hechos de junta. No recites la conversación privada del otro.`;
  return `${buildPersonality({ nombre: p.nombre, canal: p.canal, modo: p.modo, mando: p.mando, nivel: p.nivel, perfil })}${p.bloquePerfil ? `\n\n${p.bloquePerfil}` : ''}${p.bloqueApp ? `\n\n${p.bloqueApp}` : ''}

${perfil.tituloConocimiento}:
${perfil.conocimiento}

${promptAgente(p.agente, p.nivel)}

${recuerdos}
Modo de mesa pedido: ${p.modo}.${p.canal === 'mesa' && p.lineaAvatar ? `\n${p.lineaAvatar}` : ''}
HECHOS:\n${p.hechos.join('\n') || '(ninguno)'}\n${miembro ? '' : `${hechosCatalogo()}\n`}${promptMemoria(p.quienMem, { nivel: p.nivel, nombre: p.nombre })}`;
}
