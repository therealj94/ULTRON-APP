/**
 * EL ESTADO DE LAS NORMAS QUE CITA DR ELECTRUM, con su fuente y la fecha en que se revisó.
 *
 * Un asistente que corrige a la gente no puede corregirla con una norma equivocada: el conocimiento
 * decía que JORC 2024 era la edición vigente, y es un borrador (auditoría H01). Cada norma lleva aquí
 * su edición vigente, lo que está propuesto, dónde se comprobó y cuándo. Una propuesta no reemplaza
 * a la norma por aparecer en un borrador. `tests/normas.test.ts` impide que el conocimiento (lo que
 * lee el modelo) contradiga este registro.
 *
 * `revisado` es la fecha en que alguien miró la fuente oficial. Pasado un año, la norma se da por
 * «a revalidar»: no se afirma su estado como si fuera de hoy.
 */
export type EstadoNorma = 'vigente' | 'a_revalidar';

export type Norma = {
  id: string;
  nombre: string;
  jurisdiccion: string;
  /** La edición que obliga hoy, según la fuente. */
  vigente: string;
  /** Lo que está propuesto o en consulta: NO sustituye a la vigente. */
  propuesta?: string;
  fuente: string;
  /** AAAA-MM-DD: cuándo se comprobó en la fuente oficial. */
  revisado: string;
  /** Qué no se pudo comprobar en esa revisión. */
  nota?: string;
};

export const NORMAS: Norma[] = [
  {
    id: 'jorc',
    nombre: 'Código JORC',
    jurisdiccion: 'Australasia',
    vigente: '2012 (obligatoria desde el 1 de diciembre de 2013)',
    propuesta: 'Borrador 2024: consulta pública del 1 de agosto al 31 de octubre de 2024',
    fuente: 'https://jorc.org/',
    revisado: '2026-09-30',
  },
  {
    id: 'ni43-101',
    nombre: 'NI 43-101',
    jurisdiccion: 'Canadá',
    vigente: 'La norma actual con el formulario 43-101F1',
    propuesta: 'Derogación y sustitución publicada para comentarios en junio de 2025 (plazo hasta el 10 de octubre de 2025)',
    fuente: 'https://www.securities-administrators.ca/',
    revisado: '2025-10-10',
    nota: 'El 30 de septiembre de 2026 no se pudo abrir la fuente oficial para confirmar si ya se adoptó.',
  },
];

const UN_ANIO_MS = 365 * 24 * 3600 * 1000;

export function estadoNorma(n: Norma, hoy = new Date()): EstadoNorma {
  const t = Date.parse(n.revisado);
  return Number.isFinite(t) && hoy.getTime() - t <= UN_ANIO_MS && !n.nota ? 'vigente' : 'a_revalidar';
}
