/** Íconos de trazo del recorrido (24×24), además de los del Centro (ui.ts): si no está aquí, usa aquel. */
import { icono } from '../ui';

const TRAZOS: Record<string, string> = {
  sol: 'M12 8a4 4 0 1 0 .01 0Z M12 2v2 M12 20v2 M2 12h2 M20 12h2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4',
  luna: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z',
  sobre: 'M3 6h18v12H3Z M3 6l9 7 9-7',
  calendario: 'M4 6h16v14H4Z M4 10h16 M8 3v5 M16 3v5',
  reloj: 'M12 3a9 9 0 1 0 .01 0Z M12 7v5l3 2',
  escudo: 'M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6Z M9 12l2 2 4-4',
  avion: 'M3 11 21 3l-8 18-2-8Z M11 13l10-10',
  nota: 'M9 18V5l10-2v12 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z M19 15a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  moneda: 'M12 3a9 9 0 1 0 .01 0Z M12 7v10 M9 9.5c0-1.4 1.3-2 3-2s3 .8 3 2-1.5 1.8-3 2.2-3 1-3 2.3 1.3 2 3 2 3-.7 3-2',
  ventana: 'M3 5h18v14H3Z M3 9h18',
  teclado: 'M2 7h20v11H2Z M6 11h.01 M10 11h.01 M14 11h.01 M18 11h.01 M7 15h10',
  lapiz: 'M4 20l4-1L19 8l-3-3L5 16Z M14 7l3 3',
  micNo: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z M6 11a6 6 0 0 0 12 0 M12 17v4 M3 3l18 18',
  chispa: 'M12 2l2.2 6.8L21 11l-6.8 2.2L12 20l-2.2-6.8L3 11l6.8-2.2Z',
  windows: 'M3 5l8-1v8H3Z M13 3.7 21 2.6V12h-8Z M3 13h8v7.9L3 20Z M13 13h8v8.4l-8-1.1Z',
  wifi: 'M2 9a15 15 0 0 1 20 0 M5 12.5a10 10 0 0 1 14 0 M8.5 16a5 5 0 0 1 7 0 M12 19.5h.01',
  carpeta: 'M3 6h6l2 2h10v11H3Z',
  globo: 'M12 3a9 9 0 1 0 .01 0Z M3 12h18 M12 3c3 3 3 15 0 18 M12 3c-3 3-3 15 0 18',
  copiar: 'M8 8h12v12H8Z M4 16V4h12',
  pegar: 'M8 4h8v3H8Z M6 5H4v16h16V5h-2',
  guardar: 'M5 3h12l3 3v15H4V3Z M8 3v6h8V3 M8 21v-7h8v7',
  excel: 'M4 4h16v16H4Z M8 8l8 8 M16 8l-8 8',
  altavoz: 'M4 9h4l5-4v14l-5-4H4Z M16 9a4 4 0 0 1 0 6 M19 6a8 8 0 0 1 0 12',
  altavozNo: 'M4 9h4l5-4v14l-5-4H4Z M17 9l5 6 M22 9l-5 6',
};

export function ico(nombre: string, tam = 18): SVGSVGElement {
  if (!TRAZOS[nombre]) return icono(nombre, tam);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(tam));
  svg.setAttribute('height', String(tam));
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('ico');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', TRAZOS[nombre]);
  svg.appendChild(p);
  return svg;
}

export const TIENE = (n: string) => n in TRAZOS;
