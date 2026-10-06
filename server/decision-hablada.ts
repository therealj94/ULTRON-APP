/**
 * UN «SÍ» HABLADO SOLO MANDA LO QUE SE VE (revisión del 6-oct, bloqueante 1: «Ningún envío si la aprobación no coincide
 * exactamente con lo mostrado»).
 *
 * Antes, un «sí» dicho en voz alta se resolvía con la regla única como uno escrito: con UN solo borrador esperando lo
 * mandaba aunque no fuera el que la ventana mostraba —p. ej. justo después de Editar, antes de que la ventana volviera a
 * dibujarse con el texto nuevo— y, si se perdía el registro de la ventana (reinicio, caducidad, un aviso «oculta» que
 * llegó tarde), elegía el principal aunque la persona estuviera mirando otro (un apartado).
 *
 * Ahora, en un turno HABLADO (la voz de la mesa, el dictado de la app o de la web, la conversación de voz), un «sí» que
 * mandaría un correo o un WhatsApp se ejecuta SOLO si está atado a la huella exacta del borrador que ese aparato muestra:
 *   1. el campo `decisionVista: { tareaId, decisionId, huella }` que manda el teléfono con la frase (solo mientras la
 *      ventana está a la vista y no se está editando: mobile/src/lib/decisionVista.ts), o, si no vino,
 *   2. el registro de la ventana (server/decision-en-pantalla.ts) de ESE aparato, vigente.
 * La huella tiene que ser la de un borrador que espera AHORA en esa conversación. Sin atadura, con otra huella (la vieja
 * de antes de editar) o con un registro de otro aparato: no se elige nada, no sale nada y se le pide que mire la ventana.
 * Con varias esperando y sin un registro que diga desde cuándo se ve lo que dice el campo, se pregunta cuál.
 *
 * Lo escrito (el chat) y el toque en la ventana o el panel (POST /api/trabajos/:id/decisiones) siguen como siempre.
 */
import { apartadosCorreoDe, borradorDe } from './correo';
import { apartadosWhatsappDe, borradorWhatsappDe } from './whatsapp';
import type { EnPantalla } from './decision-en-pantalla';

/** Lo que el teléfono dice que muestra su ventana de decisión al decir la frase. */
export type DecisionVistaTurno = { tareaId: string; decisionId: string; huella: string };

const ID = /^[A-Za-z0-9_.:-]{1,120}$/;

/** El campo `decisionVista` del cuerpo del turno, validado (forma y largo), o null. Nunca da permiso: solo ata. */
export function decisionVistaDelTurno(x: unknown): DecisionVistaTurno | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const { tareaId, decisionId, huella } = x as Record<string, unknown>;
  if (typeof tareaId !== 'string' || typeof decisionId !== 'string' || typeof huella !== 'string') return null;
  if (!ID.test(tareaId) || !ID.test(decisionId) || !/^[A-Za-z0-9_-]{8,128}$/.test(huella)) return null;
  return { tareaId, decisionId, huella };
}

export type BorradorLigado = { canal: 'correo' | 'whatsapp'; intento: string; huella: string };

/** El borrador que espera AHORA en esta conversación con ESA huella (principal o apartado, correo o WhatsApp), o null. */
export function borradorConHuella(dueno: string, ambito: string, huella: string, whatsapp: boolean): BorradorLigado | null {
  const correos = [borradorDe(dueno, ambito), ...apartadosCorreoDe(dueno, ambito)];
  for (const b of correos) if (b && b.huella === huella) return { canal: 'correo', intento: b.intento, huella: b.huella };
  if (whatsapp) {
    const was = [borradorWhatsappDe(dueno, ambito), ...apartadosWhatsappDe(dueno, ambito)];
    for (const b of was) if (b && b.huella === huella) return { canal: 'whatsapp', intento: b.intento, huella: b.huella };
  }
  return null;
}

export type VistaHablada = {
  /** La vista con la que se arman los pendientes del turno (marca `aVista`). */
  vista: EnPantalla | null;
  /** El borrador al que está atado el «sí» hablado, o null. */
  ligada: BorradorLigado | null;
  /** El teléfono dijo qué muestra, pero eso ya no espera (lo editó, venció o se resolvió). */
  campoSinBorrador: boolean;
  /** Había un registro de la ventana, pero de OTRO aparato. */
  otroAparato: boolean;
};

/**
 * La vista de un turno hablado: la del campo del teléfono si vino (atada a un borrador que espera con esa huella); si no,
 * el registro de la ventana de ESE aparato. `t` (desde cuándo se ve, lo que compara conLaVista con una pregunta más
 * nueva): la del registro si es la misma; si no hay registro que lo diga, 0 (con varias esperando, se pregunta cuál).
 */
export function vistaHablada(o: { dueno: string; ambito: string; whatsapp: boolean; campo: DecisionVistaTurno | null; aparato?: unknown; registro: EnPantalla | null; ahora?: number }): VistaHablada {
  const aparato = typeof o.aparato === 'string' ? o.aparato : '';
  const otroAparato = !!o.registro?.aparato && o.registro.aparato !== aparato;
  const registro = o.registro && !otroAparato ? o.registro : null;
  if (o.campo) {
    const b = borradorConHuella(o.dueno, o.ambito, o.campo.huella, o.whatsapp);
    if (!b) return { vista: null, ligada: null, campoSinBorrador: true, otroAparato };
    const mismo = !!registro && registro.canal === b.canal && registro.intento === b.intento && registro.huella === b.huella;
    const ahora = o.ahora ?? Date.now();
    const vista: EnPantalla = { canal: b.canal, ambito: o.ambito, intento: b.intento, huella: b.huella, tareaId: o.campo.tareaId, decisionId: o.campo.decisionId, via: 'pantalla', t: mismo ? registro!.t : 0, vivo: ahora, ...(aparato ? { aparato } : {}) };
    return { vista, ligada: b, campoSinBorrador: false, otroAparato };
  }
  if (!registro) return { vista: null, ligada: null, campoSinBorrador: false, otroAparato };
  // El registro tiene que seguir siendo un borrador que espera con esa huella.
  const b = borradorConHuella(o.dueno, o.ambito, registro.huella, o.whatsapp);
  const ligada = b && b.canal === registro.canal && b.intento === registro.intento ? b : null;
  return { vista: registro, ligada, campoSinBorrador: false, otroAparato };
}

/**
 * ¿Este «sí» hablado puede mandar `p`? null si sí (está atado a su intento y huella exactos); si no, el HECHO que dice
 * que no salió nada y qué hacer.
 */
export function hechoSiNoEstaLigada(p: { origen: string; id?: string; huella?: string }, h: VistaHablada, mensaje: string, decir: string): string | null {
  const l = h.ligada;
  if (l && l.canal === p.origen && l.intento === p.id && !!p.huella && l.huella === p.huella) return null;
  const dijo = `dijo «${mensaje.slice(0, 80)}» en voz alta`;
  if (h.campoSinBorrador)
    return `HECHO: ${dijo}, pero lo que su ventana de decisión mostraba ya no es lo que espera (lo editó, venció o cambió). NO se mandó nada. Dile que mire la ventana: ahí está la versión de ahora (${decir}); si es esa, que diga «sí» mientras la ve o toque «Sí».`;
  if (l)
    return `HECHO: ${dijo} mientras su ventana de decisión muestra otra cosa, no ${decir}. NO se mandó nada. Pregúntale cuál quiere (la de la ventana o ${decir}) y que lo confirme mirándola.`;
  return `HECHO: ${dijo}, pero no tengo constancia de qué le muestra su pantalla ahora (la ventana de decisión no está a la vista, se cerró o la está editando), así que un «sí» dicho no manda nada. NO se mandó nada (${decir} sigue esperando). Dile que mire su ventana de decisión y diga «sí» mientras la ve, o toque «Sí» ahí; no digas que se envió.`;
}
