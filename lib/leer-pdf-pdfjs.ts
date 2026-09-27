/**
 * EL SEGUNDO LECTOR DE PDF: pdf.js (vía unpdf), página por página.
 *
 * `extraerPdf` (lib/leer-pdf.ts) lee los flujos de contenido a mano: es rápido y no depende de nada,
 * pero no entiende las fuentes CID con su tabla ToUnicode, que es como vienen muchos informes
 * técnicos. Con el informe del USGS SIR 2010-5090-I (94 páginas, 330 000 caracteres) sacó 8 000:
 * el índice y poco más, y Dr Electrum decía que «solo tenía el índice». pdf.js es el lector de
 * Firefox y lee esas fuentes como las ve una persona.
 *
 * Se importa con un `import()` de verdad: el servidor sale empaquetado en CommonJS y unpdf es un
 * módulo ES.
 */
const importar = new Function('m', 'return import(m)') as (m: string) => Promise<any>;

export type PaginasPdf = { paginas: string[]; total: number };

export async function textoPorPaginas(datos: Buffer, topeMs = 60_000): Promise<PaginasPdf | null> {
  try {
    const { extractText, getDocumentProxy } = await importar('unpdf');
    const trabajo = (async () => {
      const pdf = await getDocumentProxy(new Uint8Array(datos));
      const { totalPages, text } = await extractText(pdf, { mergePages: false });
      return { paginas: (text as string[]).map((t) => String(t || '')), total: Number(totalPages) || (text as string[]).length };
    })();
    return await Promise.race([trabajo, new Promise<null>((r) => setTimeout(() => r(null), topeMs).unref?.())]);
  } catch (e: any) {
    console.warn('[pdf] pdf.js no pudo leerlo:', String(e?.message || e).slice(0, 160));
    return null;
  }
}

/** Caracteres útiles (sin espacios repetidos) de un texto. */
export function cuerpo(t: string): number {
  return String(t || '').replace(/\s+/g, ' ').trim().length;
}
