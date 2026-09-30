// Skia en el banco, lo justo para los iconos (pulse/ui/Icono.tsx): un camino SVG con trazo o relleno,
// escalado en su grupo. Se dibuja con <svg> de verdad, así la captura enseña el icono real.
import type { ReactNode } from 'react';
import { createElement as h } from 'react';

type Camino = { svg: string };
export const Skia = {
  Path: { MakeFromSVGString: (svg: string): Camino => ({ svg }) },
  PictureRecorder: class {},
};

export function Canvas({ style, children }: { style?: any; children?: ReactNode }) {
  const w = style?.width ?? 24;
  const alto = style?.height ?? 24;
  return h('svg', { width: w, height: alto, viewBox: `0 0 ${w} ${alto}`, style: { overflow: 'visible', display: 'block' } }, children);
}

export function Group({ transform, opacity, children }: { transform?: { scale?: number }[]; opacity?: number; children?: ReactNode }) {
  const e = transform?.find((t) => t.scale !== undefined)?.scale ?? 1;
  return h('g', { transform: `scale(${e})`, opacity: typeof opacity === 'number' ? opacity : 1 }, children);
}

export function Path({ path, color, style, strokeWidth }: { path: Camino; color: string; style?: 'fill' | 'stroke'; strokeWidth?: number }) {
  const lleno = style === 'fill';
  return h('path', {
    d: path?.svg || '',
    fill: lleno ? color : 'none',
    stroke: lleno ? 'none' : color,
    strokeWidth: strokeWidth ?? 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  });
}

export const Circle = () => null;
export const Picture = () => null;
