/**
 * EVIDENCIAS DEL TURNO — que cada cita se pueda comprobar (auditoría H13).
 *
 * Antes el modelo citaba «documento, página» en texto libre: nadie verificaba que ese documento y
 * esa página fueran de lo que de verdad se leyó en el turno. Ahora cada trozo que llega al modelo
 * lleva un código estable (`[D12-p5]`: documento 12, página 5) y queda anotado como evidencia del
 * turno. Al terminar, `verificarCitas` cambia cada código por «(nombre, p. 5)» si es de lo leído, y
 * lo quita —diciéndolo— si no lo es. Un código inventado no llega nunca a la pantalla.
 *
 * El registro vive en un `AsyncLocalStorage`: las herramientas corren dentro del turno y anotan lo
 * que leyeron sin que haya que pasar nada de mano en mano. Fuera de un turno, anotar no hace nada.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export type Evidencia = { codigo: string; documentoId: number; documento: string; pagina: number | null; transcripcion?: boolean };

const almacen = new AsyncLocalStorage<Map<string, Evidencia>>();

/** Corre `fn` con un registro de evidencias propio. Devuelve lo que devuelve `fn`. */
export function conEvidencias<T>(fn: () => Promise<T>): Promise<T> {
  return almacen.run(new Map(), fn);
}

export function codigoEvidencia(documentoId: number, pagina: number | null | undefined): string {
  return `D${documentoId}${pagina ? `-p${pagina}` : ''}`;
}

/** Anota un trozo leído y devuelve su código (`D12-p5`). */
export function anotarEvidencia(e: Omit<Evidencia, 'codigo'>): string {
  const codigo = codigoEvidencia(e.documentoId, e.pagina);
  const m = almacen.getStore();
  if (m && !m.has(codigo) && m.size < 400) m.set(codigo, { ...e, codigo });
  return codigo;
}

/** Lo anotado en el turno en curso. */
export function evidenciasDelTurno(): Evidencia[] {
  return [...(almacen.getStore()?.values() ?? [])];
}

const CODIGO = /\s?\[(D\d+(?:-p\d+)?)\]/g;
/*
 * Un código mal escrito no pasaba por la verificación y salía tal cual, con aspecto de cita
 * comprobada: «[D99-p1, D12-p5]», «[d99-p1]», «[D99 p.1]». Antes de verificar se normalizan a la
 * forma de siempre —uno por corchete, en mayúscula, con `-p`—, y así un código inventado se quita.
 */
const CODIGO_SUELTO = /\[\s*([dD]\s?\d+(?:\s*(?:-|,)?\s*[pP](?:[áa]g|[ÁA]G)?\.?\s*\d+)?(?:\s*[,;]\s*[dD]\s?\d+(?:\s*(?:-|,)?\s*[pP](?:[áa]g|[ÁA]G)?\.?\s*\d+)?)*)\s*\]/g;
export function normalizarCodigos(texto: string): string {
  return texto.replace(CODIGO_SUELTO, (_m, dentro: string) =>
    dentro
      .split(/\s*;\s*|\s*,\s*(?=[dD]\s?\d)/)
      .map((c) => {
        const m = /^[dD]\s?(\d+)(?:\s*(?:-|,)?\s*[pP](?:[áa]g|[ÁA]G)?\.?\s*(\d+))?$/.exec(c.trim());
        return m ? `[D${m[1]}${m[2] ? `-p${m[2]}` : ''}]` : `[${c.trim()}]`;
      })
      .join(' ')
  );
}

/**
 * Cambia los códigos del texto por su cita legible y quita los que no son de lo leído. Un código de
 * documento sin página (`D12`) vale si se leyó cualquier página de ese documento.
 */
export function verificarCitas(
  texto: string,
  evidencias: Evidencia[],
  idioma: 'es' | 'en' = 'es'
): { texto: string; citas: Evidencia[]; quitadas: string[] } {
  const por = new Map(evidencias.map((e) => [e.codigo, e]));
  const porDoc = new Map<number, Evidencia>();
  for (const e of evidencias) if (!porDoc.has(e.documentoId)) porDoc.set(e.documentoId, e);
  const citas = new Map<string, Evidencia>();
  const quitadas: string[] = [];
  let salida = normalizarCodigos(texto).replace(CODIGO, (_m, codigo: string) => {
    const e = por.get(codigo) ?? (/-p/.test(codigo) ? undefined : porDoc.get(Number(codigo.slice(1))));
    if (!e) {
      quitadas.push(codigo);
      return '';
    }
    citas.set(e.codigo, e);
    const pag = codigo.includes('-p') ? e.pagina : null;
    const sin = e.transcripcion ? (idioma === 'en' ? ', unreviewed photo transcription' : ', transcripción de foto sin revisar') : '';
    return ` (${e.documento}${pag ? `, p. ${pag}` : ''}${sin})`;
  });
  // Un mismo trozo citado dos veces seguidas queda una.
  salida = salida.replace(/(\([^()]+\))(\s*\1)+/g, '$1');
  if (quitadas.length) {
    salida = `${salida.trimEnd()}\n\n${
      idioma === 'en'
        ? `(I removed ${quitadas.length === 1 ? 'a citation' : `${quitadas.length} citations`} that did not match what I read.)`
        : `(Quité ${quitadas.length === 1 ? 'una cita que no correspondía' : `${quitadas.length} citas que no correspondían`} a lo que leí.)`
    }`;
  }
  return { texto: salida, citas: [...citas.values()], quitadas };
}

/** La línea que va con los trozos: cómo se cita. */
export const COMO_CITAR =
  'Citá cada dato de estos documentos poniendo su código entre corchetes justo después, tal cual aparece (por ejemplo [D12-p5]); no inventes códigos: lo que no tenga código no lo atribuyas a un documento.';
