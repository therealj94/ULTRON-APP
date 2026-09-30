// expo-linear-gradient en el banco: un degradado CSS de verdad (la captura enseña el fondo de la llamada).
import { createElement as h, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';

type Props = { colors: string[]; locations?: number[]; start?: { x: number; y: number }; end?: { x: number; y: number }; style?: any; children?: ReactNode };

export function LinearGradient({ colors, locations, start, end, style, children }: Props) {
  const plano = StyleSheet.flatten(style) || {};
  const ang = start && end ? Math.round((Math.atan2(end.x - start.x, -(end.y - start.y)) * 180) / Math.PI) : 180;
  const paradas = colors.map((c, i) => `${c}${locations ? ` ${Math.round(locations[i] * 100)}%` : ''}`).join(', ');
  const css: Record<string, unknown> = { backgroundImage: `linear-gradient(${ang}deg, ${paradas})`, display: 'flex', flexDirection: 'column', boxSizing: 'border-box' };
  for (const [k, v] of Object.entries(plano)) css[k] = typeof v === 'number' && !['opacity', 'flex', 'zIndex'].includes(k) ? `${v}px` : v;
  if (plano.position === 'absolute' && plano.top === 0 && plano.left === 0) Object.assign(css, { right: 0, bottom: 0 });
  return h('div', { style: css }, children);
}
