/**
 * Qué hace AU-RA con el cuerpo según lo que esté haciendo el cerebro.
 *
 * El turno manda al empezar la lista de herramientas que corrió (`tools` en el SSE de
 * /api/turno/stream; los nombres salen de `prepararTurno` en server.ts y de lib/taller.ts). Cada
 * herramienta tiene un gesto, para que se vea qué está haciendo mientras trabaja en vez de
 * quedarse quieta esperando.
 *
 * Es una función pura a propósito: la prueba (tests/sala.test.ts) fija el reparto sin WebGL.
 */
import type { FaceState } from '../types';
import type { Emocion } from '../../lib/emocion';

export type Tarea = 'buscar' | 'enviar' | 'anotar' | 'oro' | 'leer' | 'mirar';
export type Postura = 'pie' | 'sentada';

/**
 * Orden de prioridad cuando el turno trae varias: lo que MÁS se ve gana. Enviar algo es lo último
 * que pasa y lo que el usuario pidió explícitamente; buscar en internet es lo que más tarda.
 */
const REGLAS: Array<[Tarea, RegExp]> = [
  ['enviar', /^(enviar|telegram|whatsapp|correo|urgente|llamada)$/],
  ['buscar', /^(web|pagina)$/],
  ['leer', /^(pdf-leer|pdf|rag)$/],
  ['anotar', /^(tareas|memoria|recordar)$/],
  ['oro', /^(oro|plata|hnl|metales|fx)$/],
  ['mirar', /^(vision|escena|foto)$/],
];

export function tareaDeHerramientas(tools: readonly string[] | null | undefined): Tarea | null {
  const lista = (tools || []).map((t) => String(t || '').trim().toLowerCase()).filter(Boolean);
  for (const [tarea, re] of REGLAS) if (lista.some((t) => re.test(t))) return tarea;
  return null;
}

/** Lo que se ve en el cuerpo: una emoción del contrato, o uno de los estados del turno. */
export type Animo =
  | Emocion
  | 'escuchando'
  | 'dormido';

/**
 * El estado de la mesa (FaceState) manda sobre la emoción cuando es un estado del turno: dormida,
 * escuchando o pensando se ve así diga lo que diga la última emoción. Mientras habla o en reposo, se
 * ve la emoción que abrió la respuesta.
 */
export function animoDe(face: FaceState, emocion: Emocion): Animo {
  switch (face) {
    case 'SLEEPING': return 'dormido';
    case 'LISTENING': return 'escuchando';
    case 'THINKING': return 'pensando';
    case 'SING': return 'canto';
    case 'PRAY': return 'oracion';
    case 'LAUGH': return 'risa';
    case 'SAD': return 'triste';
    case 'TIRED': return 'cansado';
    case 'ANGRY':
    case 'FURY': return 'molesto';
    case 'CONCERNED': return emocion === 'alarma' ? 'alarma' : 'preocupado';
    case 'SURPRISED':
    case 'STARTLE': return 'sorpresa';
    case 'CURIOSITY': return emocion === 'escepticismo' ? 'escepticismo' : 'curioso';
    case 'WINK': return 'travieso';
    case 'PURR': return 'carino';
    case 'HAPPY': return emocion === 'orgullo' ? 'orgullo' : 'feliz';
    default: return emocion || 'neutral';
  }
}

export const HABLA: ReadonlySet<FaceState> = new Set<FaceState>(['SPEAKING', 'SING', 'LAUGH', 'PRAY']);

/** Pose que el cuerpo busca. Los brazos en radianes; el resto son factores. */
export type Pose = {
  ojoY: number;
  ojoS: number;
  ojoMY: number;
  guino: number;
  inclX: number;
  inclZ: number;
  escY: number;
  anilloV: number;
  anilloOp: number;
  bIz: number;
  bIx: number;
  bDz: number;
  bDx: number;
  mej: number;
  boca: 'sonrisa' | 'triste' | 'abierta' | 'o' | 'linea';
  brinco: boolean;
  puntos: boolean;
  notas: boolean;
  zetas: boolean;
};

export const POSE_BASE: Pose = {
  ojoY: 1, ojoS: 1, ojoMY: 0, guino: 1, inclX: 0, inclZ: 0, escY: 1, anilloV: 0.6, anilloOp: 1,
  bIz: -0.25, bIx: 0, bDz: 0.25, bDx: 0, mej: 0.5, boca: 'sonrisa',
  brinco: false, puntos: false, notas: false, zetas: false,
};

/** La pose de cada ánimo. `t` es el reloj, para lo que oscila (risa, canto). */
export function poseDe(animo: Animo, t: number): Pose {
  const o: Pose = { ...POSE_BASE };
  switch (animo) {
    case 'feliz': o.mej = 0.72; o.anilloV = 0.9; o.brinco = true; break;
    case 'orgullo': o.mej = 0.75; o.anilloV = 1.1; o.inclX = -0.08; o.bIz = -0.55; o.bDz = 0.55; break;
    case 'risa': o.ojoY = 0.35; o.boca = 'abierta'; o.inclZ = Math.sin(t * 22) * 0.1; o.anilloV = 1.6; o.mej = 0.85; break;
    case 'sorpresa': o.ojoS = 1.35; o.boca = 'o'; o.anilloV = 2.2; o.bIz = -0.9; o.bDz = 0.9; o.inclX = -0.08; break;
    case 'alarma': o.ojoS = 1.25; o.boca = 'o'; o.anilloV = 1.8; o.bIz = -0.6; o.bDz = 0.6; o.inclX = -0.05; break;
    case 'curioso': o.ojoS = 1.1; o.ojoMY = 0.01; o.inclZ = 0.15; o.anilloV = 0.8; break;
    case 'escepticismo': o.guino = 0.55; o.inclZ = -0.1; o.boca = 'linea'; o.anilloV = 0.5; break;
    case 'pensando': o.ojoMY = 0.02; o.inclZ = 0.08; o.anilloV = 0.3; o.boca = 'o'; o.bDx = -2.1; o.bDz = -0.35; o.puntos = true; break;
    case 'preocupado': o.ojoMY = -0.012; o.inclX = 0.08; o.boca = 'triste'; o.bIz = -0.05; o.bDz = 0.05; o.anilloV = 0.4; o.mej = 0.35; break;
    case 'triste': o.ojoMY = -0.03; o.inclX = 0.16; o.escY = 0.94; o.anilloV = 0.15; o.anilloOp = 0.4; o.boca = 'triste'; o.bIz = -0.08; o.bDz = 0.08; o.mej = 0.2; break;
    case 'molesto': o.ojoY = 0.7; o.boca = 'triste'; o.inclX = -0.04; o.bIz = -0.12; o.bDz = 0.12; o.anilloV = 1.2; o.mej = 0.3; break;
    case 'cansado': o.ojoY = 0.5; o.escY = 0.96; o.inclZ = 0.08; o.anilloV = 0.2; o.anilloOp = 0.6; o.boca = 'linea'; break;
    case 'carino': o.ojoY = 0.55; o.mej = 0.9; o.bIx = -1.0; o.bIz = 0.3; o.bDx = -1.0; o.bDz = -0.3; o.inclZ = Math.sin(t * 1.6) * 0.06; break;
    case 'travieso': o.guino = 0.12; o.inclZ = 0.12; o.mej = 0.7; o.anilloV = 1.0; break;
    case 'canto': o.boca = 'abierta'; o.inclZ = Math.sin(t * 3) * 0.14; o.bIz = -0.8 + Math.sin(t * 3) * 0.2; o.bDz = 0.8 + Math.sin(t * 3) * 0.2; o.anilloV = 1.2; o.ojoY = 0.55; o.notas = true; break;
    case 'oracion': o.ojoY = 0.08; o.boca = 'linea'; o.bIx = -1.35; o.bIz = 0.42; o.bDx = -1.35; o.bDz = -0.42; o.anilloV = 0.3; o.inclX = 0.06; break;
    case 'escuchando': o.ojoS = 1.1; o.inclX = 0.06; o.anilloV = 0.9; o.anilloOp = 0.8 + Math.sin(t * 4) * 0.2; break;
    case 'dormido': o.ojoY = 0.08; o.boca = 'o'; o.escY = 1 + Math.sin(t * 1.3) * 0.03; o.anilloV = 0.12; o.anilloOp = 0.45; o.inclZ = 0.1; o.bIz = -0.12; o.bDz = 0.12; o.zetas = true; break;
    case 'firme':
    case 'seco': o.boca = 'linea'; o.anilloV = 0.5; break;
    default: break;
  }
  return o;
}
