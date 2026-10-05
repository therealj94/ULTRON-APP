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
  /** Lo de este momento en la app (dónde está, contactos, lo que espera su «sí»): va en el mensaje del turno. */
  bloqueApp?: string;
  /** Las reglas de la app (o de Windows): iguales turno a turno, van en lo fijo (el system). */
  reglasApp?: string;
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
   * La memoria del turno YA POR LA VISTA AUTORIZADA (server/contexto-turno.ts bloquesPersonales): la del
   * miembro o la de la junta, sin lo que la persona marcó «No usarlo». Con ella, manda sobre todo lo de
   * arriba y aquí no se lee ninguna memoria. server.ts siempre la da; lo demás queda para pruebas y scripts.
   */
  memoria?: { completa: string; firma: string };
  /**
   * El hilo de la conversación va como mensajes del turno (server.ts mensajesQwen). Entonces el hilo
   * corto no se repite en la memoria del system: ya está en los mensajes, y dentro del system cambiaba
   * en cada turno.
   */
  hiloEnMensajes?: boolean;
  /**
   * El turno hablado (la llamada, la voz de la web): el system corto (piezasDelTurno). Sin el cerebro
   * entero (lo del tema ya llega en HECHOS, lib/cerebro.ts), sin el catálogo del taller y con la memoria
   * en modo «firma» (sin la conversación mediana): unas 2 500 fichas en vez de 5 000–7 000.
   */
  compacto?: boolean;
  /**
   * Lo que quedó a medias y las conversaciones de antes que vienen al caso (lib/abiertos.ts,
   * lib/episodios.ts): cambia con la consulta, va en el mensaje del turno.
   */
  bloqueCerebro?: string;
  /**
   * Lo que AU-RA sabe de la persona (lib/conocer-persona.ts): va en lo fijo pero NO en la firma, así
   * aprender un dato no rehace el system a media conversación (entra cuando se rehace el fijo).
   */
  conocer?: string;
  /**
   * La versión de lo que la persona CORRIGIÓ, LIMITÓ o BORRÓ de lo que AU-RA sabe (lib/conocer-persona.ts
   * firmaConocer, AUR11): sí entra en la firma. Aprender algo no la cambia (el system no se rehace a media
   * conversación); corregir o borrar sí, y el turno siguiente ya no usa lo viejo.
   */
  conocerFirma?: string;
};

/** Lo del cerebro que va en el system corto de la voz: los encabezados y párrafos, sin las líneas de hecho. */
function resumenDelCerebro(conocimiento: string, max = 900): string {
  const sin = conocimiento
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('-'))
    .join('\n');
  return sin.length > max ? `${sin.slice(0, max).replace(/\s+\S*$/, '')}…` : sin;
}

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
  const personalidad = buildPersonality({ nombre: p.nombre, canal: p.canal, modo: p.modo, mando: p.mando, nivel: p.nivel, perfil, conHora: false, compacto: p.compacto });
  const cabeza = p.compacto
    ? `${personalidad}

${perfil.tituloConocimiento} (resumen):
${resumenDelCerebro(perfil.conocimiento)}
Lo concreto de cada tema te llega en HECHOS cuando hace falta. Si no está ahí, dilo en una frase y ofrece buscarlo.

${recuerdos}
`
    : `${personalidad}

${perfil.tituloConocimiento}:
${perfil.conocimiento}

${recuerdos}
${miembro ? '' : `${hechosCatalogo()}\n`}`;
  const memoriaFirma = p.memoria
    ? p.memoria.firma
    : miembro && p.memoriaMiembro
      ? p.memoriaMiembroFirma ?? p.memoriaMiembro
      : promptMemoria(p.quienMem, { nivel: p.nivel, nombre: p.nombre, hilo: 'firma' });
  const memoria = p.compacto
    ? memoriaFirma
    : p.memoria
      ? p.memoria.completa
      : miembro && p.memoriaMiembro
        ? p.memoriaMiembro
        : promptMemoria(p.quienMem, { nivel: p.nivel, nombre: p.nombre, hilo: p.hiloEnMensajes ? 'mediano' : 'todo' });
  const app = p.reglasApp?.trim() ? `\n\n${p.reglasApp.trim()}` : '';
  const fijo = `${cabeza}${memoria}${p.conocer?.trim() ? `\n\n${p.conocer.trim()}` : ''}${app}`;
  // Lo fijo sin la conversación ni lo guardado solo: si esto no cambió, el system de antes sigue valiendo
  // (fijoDeLaConversacion).
  const firma = `${cabeza}${memoriaFirma}${app}${p.conocerFirma ? `\n[conocer ${p.conocerFirma}]` : ''}`;
  const agente = promptAgente(p.agente, p.nivel);
  // Lo del turno sin los HECHOS (el turno los pone él mismo, y el harness les suma lo que devuelve cada
  // herramienta): va en el MENSAJE de la persona, no en el system (server.ts mensajesQwen).
  const contexto = [
    lineaAhora(hora),
    p.bloquePerfil || '',
    p.bloqueCerebro || '',
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
 *   · Se rehace con más de CONGELAR_MAX_NUEVOS turnos guardados desde la foto. Hasta entonces, todo lo
 *     de después de la foto va en los mensajes del turno (ventanaDelHilo).
 *   · Se rehace tras CONGELAR_INACTIVA_MS sin turnos o CONGELAR_MAX_MS desde que se armó: lo guardado
 *     desde otro lado (Telegram, la web) llega a la conversación a más tardar entonces.
 */
export const CONGELAR_INACTIVA_MS = 10 * 60_000;
export const CONGELAR_MAX_MS = 30 * 60_000;
/**
 * Cuántos turnos guardados después de la foto aguanta el fijo. La foto trae la conversación mediana
 * hasta 8 turnos antes de la foto; los mensajes del turno llevan los 16 de antes de la foto MÁS todos
 * los guardados desde entonces (ventanaDelHilo): la ventana crece desde un principio fijo en vez de
 * correrse, así no se pierde nada (Codex en #98) y el nodo tampoco relee el historial. Pasados estos,
 * se rehace la foto para que la ventana no crezca sin fin.
 */
export const CONGELAR_MAX_NUEVOS = 24;
export const HILO_BASE = 16;
/**
 * En la voz, menos hilo: 8 mensajes de base y la foto se rehace a los 12 nuevos (máximo 20 mensajes,
 * cada uno de hasta 600 caracteres en server.ts). Cada ficha del prompt es tiempo antes de hablar.
 */
export type LimitesHilo = { base: number; maxNuevos: number };
export const LIMITES_TEXTO: LimitesHilo = { base: HILO_BASE, maxNuevos: CONGELAR_MAX_NUEVOS };
export const LIMITES_VOZ: LimitesHilo = { base: 8, maxNuevos: 12 };
const congelados = new Map<string, { fijo: string; firma: string; foto: number; creado: number; usado: number; desde?: number }>();

/**
 * `turnosDesde(foto)`: cuántos turnos de la memoria de la persona se guardaron después de `foto`
 * (en ms). Sin él, se cuentan cero (no hay memoria que se corra).
 */
export function fijoDeLaConversacion(
  clave: string,
  fijo: string,
  firma: string,
  ahora = Date.now(),
  turnosDesde?: (foto: number) => number,
  /** Cuándo se guardó el primer mensaje de la ventana del hilo de ESTE turno (ventanaDelHilo la mantiene). */
  desde?: number,
  limites: LimitesHilo = LIMITES_TEXTO
): string {
  if (!clave) return fijo;
  const c = congelados.get(clave);
  if (
    c &&
    c.firma === firma &&
    ahora - c.usado < CONGELAR_INACTIVA_MS &&
    ahora - c.creado < CONGELAR_MAX_MS &&
    (turnosDesde ? turnosDesde(c.foto) : 0) <= limites.maxNuevos
  ) {
    c.usado = ahora;
    return c.fijo;
  }
  congelados.delete(clave);
  congelados.set(clave, { fijo, firma, foto: ahora, creado: ahora, usado: ahora, ...(Number.isFinite(desde) ? { desde } : {}) });
  // Una por persona; las más viejas se van primero.
  while (congelados.size > 500) congelados.delete(congelados.keys().next().value as string);
  return fijo;
}

/**
 * Cuántos mensajes del hilo van en el turno (server.ts fusionarHilo): HILO_BASE más los guardados
 * desde la foto del fijo congelado. Así el principio de la ventana no se mueve mientras dura la foto
 * (los mensajes de antes no cambian y el nodo los reutiliza) y nada de lo dicho después de la foto se
 * sale. Sin foto vigente, o pasada de CONGELAR_MAX_NUEVOS (se rehará), HILO_BASE.
 */
export function ventanaDelHilo(
  clave: string,
  turnosDesde: (foto: number) => number,
  ahora = Date.now(),
  /** Cuántos mensajes de la memoria se guardaron en o después de este instante. */
  contarDesde?: (t: number) => number,
  limites: LimitesHilo = LIMITES_TEXTO
): number {
  const c = clave ? congelados.get(clave) : undefined;
  if (!c || ahora - c.usado >= CONGELAR_INACTIVA_MS || ahora - c.creado >= CONGELAR_MAX_MS) return limites.base;
  const n = turnosDesde(c.foto);
  if (n > limites.maxNuevos) return limites.base;
  // La ventana empieza en el mismo mensaje que cuando se tomó la foto (aunque ese turno la tuviera más
  // larga que HILO_BASE): si no, al rehacerse la foto el principio se corría y el nodo releía el hilo.
  if (c.desde !== undefined && contarDesde) return Math.max(1, contarDesde(c.desde));
  return limites.base + n;
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
