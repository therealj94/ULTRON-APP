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

/*
 * Alias que también son frases de todos los días: «¿qué minas de oro hay en Honduras?» no es el
 * proyecto Minas de Oro, ni «la aldea Buena Vista» es Buenavista Monarca. Estos solo cuentan con
 * una señal de proyecto: «proyecto»/«carpeta» justo antes, o escritos con mayúscula a media frase.
 */
const PALABRAS_COMUNES = new Set(['mina', 'minas', 'de', 'del', 'el', 'la', 'los', 'las', 'oro', 'plata', 'buena', 'vista', 'buenavista', 'chaparro']);
const esComun = (alias: string) => fold(alias).split(/\s+/).every((w) => PALABRAS_COMUNES.has(w));

function conSenal(original: string, i: number, largo: number): boolean {
  const antes = fold(original.slice(Math.max(0, i - 24), i));
  if (/(proyecto|carpeta)( de| del)?\s*$/.test(antes)) return true;
  // Con mayúscula y no al empezar la oración: es un nombre propio.
  const trozo = original.slice(i, i + largo);
  const aMitad = i > 0 && !/[.!?¿¡]\s*$/.test(original.slice(0, i).trimEnd() + ' ');
  return aMitad && /^\p{Lu}/u.test(trozo.trim()) && trozo.split(/\s+/).filter((w) => w.length > 3).every((w) => /^\p{Lu}/u.test(w));
}

/** Los proyectos que nombra un texto, en el orden en que aparecen (sin repetir). */
export function proyectosEn(texto: string, proyectos: Proyecto[]): Proyecto[] {
  // Sin acentos y en minúsculas, pero con el mismo largo que el original (los índices coinciden).
  const t = texto.split('').map((c) => (fold(c) || c).slice(0, 1)).join('');
  const hallados: Array<{ p: Proyecto; i: number }> = [];
  for (const p of proyectos) {
    let primero = -1;
    for (const a of p.alias) {
      const al = fold(a).trim();
      // Todo alias, como palabras enteras. Una sigla de tres letras («MDO»), solo escrita en mayúsculas.
      if (al.length < 3) continue;
      const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${escapar(al)})(?=$|[^\\p{L}\\p{N}])`, 'gu');
      for (let m = re.exec(t); m; m = re.exec(t)) {
        const i = m.index + m[1].length;
        if (esComun(al) && !conSenal(texto, i, al.length)) continue;
        if (al.length === 3 && texto.slice(i, i + 3) !== texto.slice(i, i + 3).toUpperCase()) continue;
        if (primero < 0 || i < primero) primero = i;
        break;
      }
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

/**
 * Lo que se puede usar de las preguntas anteriores (para resolver «el informe», «ese documento»):
 * solo las que vinieron después de que se nombró el proyecto en foco, nunca las de otro proyecto.
 */
export function previasDelFoco(historial: MsgHilo[], foco: Foco, proyectos: Proyecto[], n = 2): string[] {
  const usuario = (ms: MsgHilo[]) => ms.filter((m) => m.role === 'user').map((m) => String(m.content || ''));
  if (foco.anterior) return []; // recién se cambió: todo lo de antes es del otro proyecto
  const enJuego = foco.actual ? [foco.actual] : foco.varios;
  if (!enJuego.length) {
    // Sin proyecto en la pregunta ni en foco: lo de siempre, pero sin cruzar a una conversación de proyecto.
    const sin: string[] = [];
    for (const m of [...historial].reverse()) {
      if (proyectosEn(String(m.content || ''), proyectos).length) break;
      if (m.role === 'user') sin.unshift(String(m.content || ''));
    }
    return sin.slice(-n);
  }
  const ids = new Set(enJuego.map((p) => p.id));
  // Desde el último mensaje que nombró al proyecto en foco; y se corta si antes aparece otro.
  let desde = -1;
  for (let k = historial.length - 1; k >= 0; k--) {
    const ps = proyectosEn(String(historial[k].content || ''), proyectos);
    if (ps.some((p) => !ids.has(p.id))) break;
    if (ps.length) desde = k;
  }
  return desde < 0 ? [] : usuario(historial.slice(desde)).slice(-n);
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
