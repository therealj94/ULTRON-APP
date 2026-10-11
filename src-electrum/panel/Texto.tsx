/**
 * LA RESPUESTA CON FORMATO. Dr Electrum contesta en Markdown (negritas, listas, títulos, tablas) y
 * el chat lo mostraba crudo: «**Pantaleona:** …» con los asteriscos a la vista. Esto lo dibuja.
 *
 * Es un lector chico y a propósito limitado: arma elementos de React (nunca HTML), así que nada de
 * lo que venga en el texto puede inyectar código. Los enlaces solo si son http(s). Lo que no
 * entiende lo deja como texto, tal cual.
 */
import type { ReactNode } from 'react';

const AMBAR = '#FFAE3B';

/** Negritas, cursivas, código y enlaces dentro de una línea. */
function enLinea(t: string, clave: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\[[^\]\n]+\]\((https?:\/\/[^)\s]+)\)|(?<![\p{L}\p{N}*])\*[^*\n]+\*(?![\p{L}\p{N}*])|(?<![\p{L}\p{N}_])_[^_\n]+_(?![\p{L}\p{N}_]))/gu;
  let i = 0;
  let k = 0;
  for (let m = re.exec(t); m; m = re.exec(t)) {
    if (m.index > i) out.push(t.slice(i, m.index));
    const s = m[0];
    const id = `${clave}-${k++}`;
    if (s.startsWith('**') || s.startsWith('__')) out.push(<strong key={id} className="font-semibold text-[#F3F6F8]">{enLinea(s.slice(2, -2), id)}</strong>);
    else if (s.startsWith('`')) out.push(<code key={id} className="rounded bg-white/[0.08] px-1 py-px font-mono text-[0.92em] text-[#FFE3A3]">{s.slice(1, -1)}</code>);
    else if (s.startsWith('[')) {
      const texto = s.slice(1, s.indexOf(']('));
      out.push(
        <a key={id} href={m[2]} target="_blank" rel="noopener noreferrer" className="underline decoration-[#FFAE3B]/50 underline-offset-2 hover:decoration-[#FFAE3B]" style={{ color: AMBAR }}>
          {texto}
        </a>
      );
    } else out.push(<em key={id}>{enLinea(s.slice(1, -1), id)}</em>);
    i = m.index + s.length;
  }
  if (i < t.length) out.push(t.slice(i));
  return out;
}

const esFilaTabla = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const esSeparadorTabla = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const celdas = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

/** El texto de una respuesta, con su formato. */
export function TextoConFormato({ texto }: { texto: string }) {
  const lineas = String(texto || '').replace(/\r\n?/g, '\n').split('\n');
  const bloques: ReactNode[] = [];
  let k = 0;
  for (let i = 0; i < lineas.length; ) {
    const l = lineas[i];
    const clave = `b${k++}`;
    if (!l.trim()) {
      i++;
      continue;
    }
    // Títulos: «# », «## », «### ».
    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    if (h) {
      bloques.push(
        <p key={clave} className={`font-semibold text-[#F3F6F8] ${h[1].length <= 2 ? 'text-[15px]' : 'text-[14px]'} mt-1`}>
          {enLinea(h[2], clave)}
        </p>
      );
      i++;
      continue;
    }
    // Tablas con barras.
    if (esFilaTabla(l) && i + 1 < lineas.length && esSeparadorTabla(lineas[i + 1])) {
      const cab = celdas(l);
      const filas: string[][] = [];
      i += 2;
      while (i < lineas.length && esFilaTabla(lineas[i])) filas.push(celdas(lineas[i++]));
      bloques.push(
        <div key={clave} className="my-1 overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {cab.map((c, j) => (
                  <th key={j} className="border-b border-white/15 px-2 py-1 text-left font-semibold text-[#F3F6F8]">
                    {enLinea(c, `${clave}h${j}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.map((f, r) => (
                <tr key={r} className="border-b border-white/[0.06]">
                  {f.map((c, j) => (
                    <td key={j} className="px-2 py-1 align-top">
                      {enLinea(c, `${clave}${r}-${j}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }
    // Listas: «- », «* », «• » o «1. ».
    const viñeta = /^\s*([-*•]|\d+[.)])\s+/;
    if (viñeta.test(l)) {
      const numerada = /^\s*\d+[.)]/.test(l);
      const items: string[] = [];
      while (i < lineas.length && viñeta.test(lineas[i])) items.push(lineas[i++].replace(viñeta, ''));
      const Lista = numerada ? 'ol' : 'ul';
      bloques.push(
        <Lista key={clave} className={`${numerada ? 'list-decimal' : 'list-disc'} space-y-0.5 pl-5 marker:text-[#FFAE3B]/80`}>
          {items.map((it, j) => (
            <li key={j}>{enLinea(it, `${clave}${j}`)}</li>
          ))}
        </Lista>
      );
      continue;
    }
    // Un párrafo: las líneas seguidas hasta una vacía o un bloque distinto (con sus saltos).
    const parrafo: string[] = [];
    while (i < lineas.length && lineas[i].trim() && !/^(#{1,4})\s/.test(lineas[i]) && !viñeta.test(lineas[i]) && !(esFilaTabla(lineas[i]) && esSeparadorTabla(lineas[i + 1] || ''))) parrafo.push(lineas[i++]);
    bloques.push(
      <p key={clave}>
        {parrafo.map((p, j) => (
          <span key={j}>
            {j > 0 && <br />}
            {enLinea(p, `${clave}${j}`)}
          </span>
        ))}
      </p>
    );
  }
  return <div className="space-y-1.5">{bloques}</div>;
}
