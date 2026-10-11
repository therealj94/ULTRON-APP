/**
 * EL PROYECTO EN FOCO — de qué proyecto se está hablando, y que cambiar de uno a otro no los mezcle.
 *
 * El documento de la Etapa 1 (regla 7) lo pide: «cada proyecto tiene su carpeta y su contexto
 * (Pantaleona, Buena Vista – Monarka, Cimarrón). Nunca mezclar datos entre proyectos». Sin esto,
 * con el historial delante, el modelo hacía dos cosas mal: «¿y su geología?» después de hablar de
 * Pantaleona no sabía de qué proyecto era, y al pasar a Buena Vista arrastraba cifras o documentos
 * de Pantaleona a la respuesta.
 *
 * Los proyectos y sus nombres salen del índice de capas (las carpetas bajo 300000, con sus alias):
 * no hay una lista escrita a mano. Se mira la pregunta y, si no nombra ninguno, lo último que se
 * habló. Lo que sale es una nota corta pegada a la pregunta, no una regla más en el system.
 */
import type { MsgHilo } from './hilo';

export type Proyecto = { id: number; nombre: string; alias: string[] };

/** Las carpetas de proyecto del índice: hijas directas de 300000 «Proyectos». */
export function proyectosDelIndice(capas: Array<{ id: number; nombre: string; padre?: number | null; alias?: string[] }>): Proyecto[] {
  return capas.filter((c) => c.padre === 300000).map((c) => ({ id: c.id, nombre: c.nombre, alias: [...new Set([c.nombre, ...(c.alias || [])])] }));
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Los proyectos que nombra un texto, en el orden en que aparecen (sin repetir). */
export function proyectosEn(texto: string, proyectos: Proyecto[]): Proyecto[] {
  const t = fold(texto);
  const hallados: Array<{ p: Proyecto; i: number }> = [];
  for (const p of proyectos) {
    let primero = -1;
    for (const a of p.alias) {
      const al = fold(a).trim();
      // Siglas de dos o tres letras («mdo») solo como palabra suelta; todo alias, como palabras enteras.
      if (al.length < 3) continue;
      const m = new RegExp(`(^|[^\\p{L}\\p{N}])${escapar(al)}(?=$|[^\\p{L}\\p{N}])`, 'u').exec(t);
      if (m && (primero < 0 || m.index < primero)) primero = m.index;
    }
    if (primero >= 0) hallados.push({ p, i: primero });
  }
  return hallados.sort((a, b) => a.i - b.i).map((h) => h.p);
}

export type Foco = {
  /** El proyecto del que se habla ahora (null: ninguno, o la pregunta compara varios). */
  actual: Proyecto | null;
  /** El de antes, si la pregunta pasó a otro. */
  anterior: Proyecto | null;
  /** La pregunta nombra varios: es una comparación. */
  varios: Proyecto[];
  /** El proyecto no se nombró ahora: sigue el de la conversación. */
  sigue: boolean;
};

/**
 * ¿De qué proyecto se habla? Lo que nombra la pregunta manda; si no nombra ninguno, el último
 * proyecto nombrado (él solo) en la conversación, de lo más nuevo a lo más viejo.
 */
export function proyectoEnFoco(mensaje: string, historial: MsgHilo[], proyectos: Proyecto[]): Foco {
  const aqui = proyectosEn(mensaje, proyectos);
  let previo: Proyecto | null = null;
  for (const m of [...historial].reverse()) {
    const ps = proyectosEn(String(m.content || ''), proyectos);
    if (ps.length === 1) {
      previo = ps[0];
      break;
    }
    // Un mensaje que comparaba varios no decide el foco; se sigue mirando más atrás.
  }
  if (aqui.length > 1) return { actual: null, anterior: null, varios: aqui, sigue: false };
  if (aqui.length === 1) return { actual: aqui[0], anterior: previo && previo.id !== aqui[0].id ? previo : null, varios: [], sigue: false };
  return { actual: previo, anterior: null, varios: [], sigue: !!previo };
}

/** La nota que va pegada a la pregunta. null: no hay proyecto en juego. */
export function bloqueProyecto(f: Foco): string | null {
  const n = (p: Proyecto) => `${p.nombre} (carpeta ${p.id} del índice)`;
  if (f.varios.length) {
    return `PROYECTOS: la pregunta compara ${f.varios.map((p) => p.nombre).join(' y ')}. Cada cifra, documento o conclusión es de uno solo: decí de cuál es y no los mezcles.`;
  }
  if (!f.actual) return null;
  if (f.anterior) {
    return `PROYECTO EN FOCO: ahora ${n(f.actual)}. Antes se hablaba de ${f.anterior.nombre}: no arrastres sus cifras, documentos ni conclusiones a ${f.actual.nombre}. Lo de ${f.anterior.nombre} que ya dijiste sigue siendo de ${f.anterior.nombre}.`;
  }
  if (f.sigue) {
    return `PROYECTO EN FOCO: ${n(f.actual)}, el de esta conversación. Lo que pregunten de un proyecto sin nombrarlo (sus documentos, su geología, su plan) es de ${f.actual.nombre}; lo general (el país, el catastro, la ley) no es de ningún proyecto.`;
  }
  return `PROYECTO EN FOCO: ${n(f.actual)}. Usá solo lo de su carpeta; si algo es de otro proyecto, decilo.`;
}
