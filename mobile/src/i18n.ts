/**
 * El idioma de AU-RA FP: español o inglés, elegido al entrar (pantalla de entrada o bienvenida) y
 * guardado en los ajustes del teléfono.
 *
 * Decide tres cosas: el texto de la interfaz, la voz de cada avatar (el servidor tiene una en cada
 * idioma) y en qué idioma contesta el cerebro y se escucha el micrófono.
 *
 * Un dato de módulo con suscriptores (sin contexto de React): lo leen la voz y la API, que no son
 * componentes, y las pantallas se redibujan con `useIdioma()` cuando cambia.
 */
import { useSyncExternalStore } from 'react';

export type Idioma = 'es' | 'en';

let actual: Idioma = 'es';
const oyentes = new Set<() => void>();

export function normalizarIdioma(v: unknown): Idioma {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return s === 'en' || s.startsWith('en-') ? 'en' : 'es';
}

export function fijarIdioma(i: Idioma) {
  if (i === actual) return;
  actual = i;
  for (const f of oyentes) f();
}

export function idiomaActual(): Idioma {
  return actual;
}

/** El idioma para una pantalla: se redibuja sola al cambiarlo. */
export function useIdioma(): Idioma {
  return useSyncExternalStore(
    (f) => {
      oyentes.add(f);
      return () => oyentes.delete(f);
    },
    () => actual,
    () => actual
  );
}

/** El texto en el idioma de ahora. Español primero: es el idioma en que está escrita la app. */
export function tr(es: string, en: string): string {
  return actual === 'en' ? en : es;
}

/** Un texto con las dos versiones (catálogo de avatares, frases). */
export type Bilingue = { es: string; en: string };

export function de(b: Bilingue, i: Idioma = actual): string {
  return b[i] || b.es;
}

/** Para fechas, horas y el reconocimiento de voz del teléfono. */
export function localeActual(): 'es-HN' | 'en-US' {
  return actual === 'en' ? 'en-US' : 'es-HN';
}
