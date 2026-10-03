/** Cómo se escriben el dinero, las cantidades y las horas en la cartera (en el idioma del teléfono). */
import { localeActual } from '../i18n';

export const dinero = (n: number | null) => {
  if (n == null) return '—';
  try {
    return n.toLocaleString(localeActual(), { style: 'currency', currency: 'USD', maximumFractionDigits: n < 1 ? 4 : 2 });
  } catch {
    return `US$ ${n.toFixed(2)}`;
  }
};

export const cantidad = (n: number) => {
  try {
    return n.toLocaleString(localeActual(), { maximumFractionDigits: n < 1 ? 6 : 4 });
  } catch {
    return String(n);
  }
};

export const hora = (ms: number) => {
  try {
    return new Date(ms).toLocaleTimeString(localeActual(), { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};

/** «hoy 10:32», «ayer», «12 sep» (para la lista de movimientos). */
export const fechaCorta = (ms: number, ahora = Date.now()) => {
  if (!ms) return '';
  const d = new Date(ms);
  const hoy = new Date(ahora);
  const mismoDia = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  try {
    if (mismoDia(d, hoy)) return hora(ms);
    const ayer = new Date(ahora - 86_400_000);
    if (mismoDia(d, ayer)) return localeActual().startsWith('en') ? 'yesterday' : 'ayer';
    return d.toLocaleDateString(localeActual(), { day: 'numeric', month: 'short', ...(d.getFullYear() !== hoy.getFullYear() ? { year: 'numeric' } : {}) });
  } catch {
    return d.toISOString().slice(0, 10);
  }
};
