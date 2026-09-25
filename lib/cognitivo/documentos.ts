/**
 * RECONOCIMIENTO DE DOCUMENTOS — lo que el extractor de texto no puede leer.
 *
 * Dos casos llegan aquí: el PDF escaneado (sin capa de texto) y el PDF con capa de texto ilegible
 * (letras sueltas o codificación propia, ver `pareceProsa` en server/electrum/aprender.ts). Antes se
 * rechazaban con «hay que pasarlo por OCR». Con Docling (IBM, MIT) sirviéndose en la T4 se leen en
 * el momento: OCR, estructura, y TABLAS como tablas.
 *
 * Se pide el documento estructurado (JSON de Docling), no el Markdown, por dos razones:
 *  · cada bloque trae su página (`prov[].page_no`), y una cita sin página no sirve;
 *  · las tablas vienen como celdas: se escriben fila por fila, así el troceado no parte una fila de
 *    leyes y tonelajes por la mitad.
 *
 * Sin `DOCLING_URL` devuelve null y el documento se rechaza como antes, diciendo por qué.
 */

function conf() {
  return {
    url: String(process.env.DOCLING_URL || '').replace(/\/$/, ''),
    clave: String(process.env.DOCLING_API_KEY || ''),
    ms: Number(process.env.DOCLING_TIMEOUT_MS || 180_000),
  };
}

export function doclingConfigurado() {
  return !!conf().url;
}

export type PaginaLeida = { pagina: number; texto: string };

/** Las filas de una tabla: `grid` (campo calculado de docling-core) o, si no vino, desde las celdas. */
function filasDeTabla(data: any): Array<Array<{ text?: string }>> {
  if (Array.isArray(data?.grid) && data.grid.length) return data.grid;
  const celdas: any[] = Array.isArray(data?.table_cells) ? data.table_cells : [];
  const filas: Array<Array<{ text?: string }>> = [];
  for (const c of celdas) {
    const f = Number(c?.start_row_offset_idx) || 0;
    const k = Number(c?.start_col_offset_idx) || 0;
    (filas[f] ||= [])[k] = { text: c?.text };
  }
  return filas.filter(Boolean).map((f) => Array.from(f, (c) => c || { text: '' }));
}

/** Texto por página a partir del DoclingDocument (json_content). */
export function paginasDeDocling(doc: any): PaginaLeida[] {
  const porPagina = new Map<number, Array<{ orden: number; texto: string }>>();
  let orden = 0;
  const poner = (pagina: number, texto: string) => {
    const t = texto.replace(/\s+\n/g, '\n').trim();
    if (!t) return;
    const arr = porPagina.get(pagina) || [];
    arr.push({ orden: orden++, texto: t });
    porPagina.set(pagina, arr);
  };
  const pagina = (x: any) => Number(x?.prov?.[0]?.page_no) || 1;

  // El orden de lectura lo da el árbol que cuelga de `body` (grupos = listas y secciones, con sus
  // hijos dentro). Encabezados y pies de página van en `furniture` y no se leen: repetidos en cada
  // página, solo ensucian la búsqueda. Sin árbol, el orden de las listas.
  const porRef = new Map<string, any>();
  for (const t of doc?.texts || []) porRef.set(t.self_ref, { ...t, _clase: 'texto' });
  for (const t of doc?.tables || []) porRef.set(t.self_ref, { ...t, _clase: 'tabla' });
  for (const g of doc?.groups || []) porRef.set(g.self_ref, { ...g, _clase: 'grupo' });
  const ref = (c: any) => porRef.get(c?.$ref || c?.cref);
  const vistos = new Set<any>();
  const aplanar = (x: any): any[] => {
    if (!x || vistos.has(x)) return [];
    vistos.add(x);
    const hijos = (x.children || []).flatMap((c: any) => aplanar(ref(c)));
    return x._clase === 'grupo' ? hijos : [x, ...hijos];
  };
  const recorrido = doc?.body?.children?.length
    ? (doc.body.children as any[]).flatMap((c) => aplanar(ref(c)))
    : [...porRef.values()].filter((x) => x._clase !== 'grupo');
  const MOBILIARIO = new Set(['page_header', 'page_footer']);
  for (const item of recorrido) {
    if (MOBILIARIO.has(item.label)) continue;
    if (item._clase === 'tabla') {
      const filas = filasDeTabla(item?.data);
      const texto = filas.map((f) => f.map((c) => String(c?.text ?? '').trim()).join(' | ')).filter((l) => l.replace(/[|\s]/g, '')).join('\n');
      poner(pagina(item), texto ? `[TABLA]\n${texto}` : '');
    } else if (typeof item.text === 'string') {
      poner(pagina(item), item.text);
    }
  }
  return [...porPagina.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([p, bloques]) => ({ pagina: p, texto: bloques.sort((a, b) => a.orden - b.orden).map((b) => b.texto).join('\n\n') }));
}

/** Pasa un PDF por Docling. Null si no está configurado, falla o no sale texto. */
export async function leerConDocling(nombre: string, datos: Buffer): Promise<{ paginas: PaginaLeida[]; via: string } | null> {
  const { url, clave, ms } = conf();
  if (!url) return null;
  const cuerpo = () => {
    const f = new FormData();
    f.append('files', new Blob([new Uint8Array(datos)], { type: 'application/pdf' }), nombre);
    f.append('to_formats', 'json');
    f.append('do_ocr', 'true');
    f.append('force_ocr', 'false');
    f.append('ocr_lang', 'es');
    f.append('do_table_structure', 'true');
    f.append('image_export_mode', 'placeholder');
    return f;
  };
  // Detrás de Caddy (infra/t4) la puerta es el portador; docling-serve directo pide X-Api-Key.
  const cabeceras = clave ? { Authorization: `Bearer ${clave}`, 'X-Api-Key': clave } : undefined;
  try {
    // v1 es la API estable de docling-serve; v1alpha, la de versiones anteriores.
    for (const ruta of ['/v1/convert/file', '/v1alpha/convert/file']) {
      const r = await fetch(`${url}${ruta}`, { method: 'POST', headers: cabeceras, body: cuerpo(), signal: AbortSignal.timeout(ms) });
      if (r.status === 404) continue;
      if (!r.ok) return null;
      const j: any = await r.json();
      const doc = j?.document?.json_content || j?.document?.json || j?.json_content;
      const paginas = doc ? paginasDeDocling(doc) : [];
      if (!paginas.length || !paginas.some((p) => p.texto.length > 20)) return null;
      return { paginas, via: 'docling' };
    }
    return null;
  } catch {
    return null;
  }
}
