/**
 * Los íconos que PULSE2CHAT necesita y el Centro no trae (micrófono tachado, cámara tachada, altavoz,
 * agregar persona, clip, escudo…). Mismo trazo que los de `ui.ts` (24×24, familia Lucide, ISC).
 *
 * `botonP` arma el botón con `botonIcono` de ui.ts —con su descripción SIEMPRE (title + aria-label)— y
 * solo le cambia el dibujo cuando el ícono es de aquí.
 */
import { botonIcono, icono } from '../ui';

const TRAZOS_P: Record<string, string> = {
  micNo: 'M2 2l20 20 M18.89 13.23A7.12 7.12 0 0 0 19 12v-2 M5 10v2a7 7 0 0 0 12 5 M15 9.34V5a3 3 0 0 0-5.68-1.33 M9 9v3a3 3 0 0 0 5.12 2.12 M12 19v3',
  videoNo: 'M2 2l20 20 M10.66 6H14a2 2 0 0 1 2 2v2.34l1 1L22 8v8 M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2',
  altavoz: 'M11 5 6 9H2v6h4l5 4Z M15.54 8.46a5 5 0 0 1 0 7.07 M19.07 4.93a10 10 0 0 1 0 14.14',
  personaMas: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 3a4 4 0 1 0 .01 0Z M19 8v6 M22 11h-6',
  clip: 'm21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48',
  escudo: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z M9 12l2 2 4-4',
  minimizar: 'M4 14h6v6 M20 10h-6V4 M14 10l7-7 M3 21l7-7',
  expandir: 'M15 3h6v6 M9 21H3v-6 M21 3l-7 7 M3 21l7-7',
  dispositivos: 'M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6',
  abajo: 'M6 9l6 6 6-6',
  burbujas: 'M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.9-.9L3 20.5l1.5-4.5A8.4 8.4 0 0 1 12 3.1a8.5 8.5 0 0 1 9 8.4Z',
};

const NS = 'http://www.w3.org/2000/svg';

/** Un ícono: de aquí si existe, si no el de ui.ts. */
export function iconoP(nombre: string, tam = 18): SVGSVGElement {
  if (!TRAZOS_P[nombre]) return icono(nombre, tam);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(tam));
  svg.setAttribute('height', String(tam));
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('ico');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', TRAZOS_P[nombre]);
  svg.appendChild(p);
  return svg;
}

/** Botón de solo ícono, con su descripción (title + aria-label), vía `botonIcono`. */
export function botonP(nombre: string, descripcion: string, alClic: (e: MouseEvent) => void, clase = '', tam = 18): HTMLButtonElement {
  const b = botonIcono(nombre, descripcion, alClic, clase) as HTMLButtonElement;
  b.type = 'button';
  const viejo = b.querySelector('svg');
  const nuevo = iconoP(nombre, tam);
  if (viejo) b.replaceChild(nuevo, viejo);
  else b.appendChild(nuevo);
  return b;
}

/** Cambia el dibujo y la descripción de un botón de ícono (silenciar ⇄ activar, por ejemplo). */
export function cambiarBoton(b: HTMLButtonElement, nombre: string, descripcion: string, tam = 18) {
  b.title = descripcion;
  b.setAttribute('aria-label', descripcion);
  const viejo = b.querySelector('svg');
  const nuevo = iconoP(nombre, tam);
  if (viejo) b.replaceChild(nuevo, viejo);
  else b.appendChild(nuevo);
}
