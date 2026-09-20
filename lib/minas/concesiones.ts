/**
 * FICHAS DE CONCESIONES Y PERMISOS — registro consultable por voz.
 *
 * Son datos de DEMOSTRACIÓN. Ninguna de estas concesiones es real y ninguna pertenece a Orden
 * Global: sirven para enseñar qué puede hacer el Cerebro de Minas con un padrón cargado. Cada
 * respuesta lo dice, porque afirmar la vigencia de una concesión sin el expediente delante es
 * exactamente el error que esta plataforma no puede cometer.
 *
 * El padrón vive en data/concesiones-demo.json para poder cambiarlo sin tocar código.
 */
import fs from 'node:fs';
import path from 'node:path';

export type Concesion = {
  /** Código del expediente. */
  id: string;
  nombre: string;
  titular: string;
  /** Municipio y departamento. */
  ubicacion: string;
  /** Hectáreas. */
  areaHa: number;
  tipo: 'exploración' | 'explotación';
  /** Mineral o minerales declarados. */
  mineral: string;
  estado: 'vigente' | 'en trámite' | 'suspendida' | 'vencida';
  /** ISO corto: 2021-03-15. */
  otorgada: string;
  vence: string;
  /** Licencia ambiental: estado y número si lo hay. */
  ambiental: string;
  /** Obligaciones pendientes o al día. */
  obligaciones: string[];
  nota?: string;
};

const ARCHIVO = path.join(process.cwd(), 'data', 'concesiones-demo.json');

let cache: { at: number; datos: Concesion[] } | null = null;

/** Padrón en disco. Se relee cada minuto para poder editar el JSON sin reiniciar. */
export function concesiones(): Concesion[] {
  if (cache && Date.now() - cache.at < 60_000) return cache.datos;
  let datos: Concesion[] = [];
  try {
    datos = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8'));
    if (!Array.isArray(datos)) datos = [];
  } catch {
    datos = [];
  }
  cache = { at: Date.now(), datos };
  return datos;
}

const fold = (s: string) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/** Días que faltan para el vencimiento. Negativo si ya venció. */
export function diasParaVencer(c: Concesion, hoy = new Date()): number {
  const v = new Date(`${c.vence}T00:00:00Z`).getTime();
  if (!isFinite(v)) return NaN;
  return Math.round((v - hoy.getTime()) / 86_400_000);
}

/** Concesiones que vencen dentro de `dias`, de la más urgente a la menos. */
export function porVencer(dias = 365, hoy = new Date()): Concesion[] {
  return concesiones()
    .map((c) => ({ c, d: diasParaVencer(c, hoy) }))
    .filter((x) => isFinite(x.d) && x.d <= dias)
    .sort((a, b) => a.d - b.d)
    .map((x) => x.c);
}

/** Busca por nombre, expediente, titular, ubicación o mineral. */
export function buscarConcesion(texto: string): Concesion[] {
  const q = fold(texto);
  if (!q) return [];
  const palabras = q.split(/[^a-z0-9-]+/).filter((w) => w.length >= 3);
  if (!palabras.length) return [];
  return concesiones()
    .map((c) => {
      const heno = fold([c.id, c.nombre, c.titular, c.ubicacion, c.mineral, c.tipo, c.estado].join(' '));
      let score = 0;
      for (const w of palabras) if (heno.includes(w)) score += w.length >= 5 ? 2 : 1;
      // El nombre pesa más que cualquier otro campo.
      if (fold(c.nombre).includes(q) || fold(c.id) === q) score += 5;
      return { c, score };
    })
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.c);
}

const fecha = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return isFinite(d.getTime())
    ? new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d)
    : iso;
};

/** La ficha dicha como la diría una persona, no como una tabla. */
export function fichaTexto(c: Concesion, hoy = new Date()): string {
  const d = diasParaVencer(c, hoy);
  const vigencia =
    !isFinite(d) ? `Vence el ${fecha(c.vence)}.`
    : d < 0 ? `Venció hace ${Math.abs(d)} días, el ${fecha(c.vence)}.`
    : d <= 90 ? `Vence en ${d} días, el ${fecha(c.vence)}. Eso ya es plazo corto.`
    : `Vence el ${fecha(c.vence)}, faltan ${d} días.`;
  // Un padrón que dice «vigente» sobre una fecha ya pasada es un error del padrón, y hay que decirlo:
  // callarlo es exactamente cómo se firma un papel sobre una concesión caduca.
  const contradice = isFinite(d) && d < 0 && c.estado === 'vigente' ? ' Ojo: el padrón la da por vigente pero la fecha ya pasó; eso hay que revisarlo.' : '';
  const pend = c.obligaciones.filter((o) => !/al d[ií]a|cumplid/i.test(o));
  const obligaciones = pend.length ? `Pendiente: ${pend.join('; ')}.` : 'Obligaciones al día.';
  return [
    `${c.nombre}, expediente ${c.id}.`,
    `Concesión de ${c.tipo} para ${c.mineral}, ${new Intl.NumberFormat('es-ES').format(c.areaHa)} hectáreas en ${c.ubicacion}.`,
    `Titular ${c.titular.replace(/\.$/, '')}. Estado ${c.estado}.${contradice}`,
    `Otorgada el ${fecha(c.otorgada)}. ${vigencia}`,
    `Ambiental: ${c.ambiental}.`,
    obligaciones,
    c.nota ? c.nota : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Resumen corto del padrón, para cuando preguntan «qué concesiones hay». */
export function resumenPadron(hoy = new Date()): string {
  const todas = concesiones();
  if (!todas.length) return 'El padrón de demostración está vacío.';
  const porEstado = todas.reduce<Record<string, number>>((a, c) => ((a[c.estado] = (a[c.estado] || 0) + 1), a), {});
  const pronto = porVencer(90, hoy);
  const partes = [
    `Hay ${todas.length} concesiones cargadas: ${Object.entries(porEstado).map(([e, n]) => `${n} ${e}${n > 1 ? 's' : ''}`).join(', ')}.`,
    `Nombres: ${todas.map((c) => c.nombre).join(', ')}.`,
  ];
  if (pronto.length) partes.push(`Ojo con ${pronto.map((c) => `${c.nombre} (${diasParaVencer(c, hoy)} días)`).join(' y ')}.`);
  return partes.join(' ');
}

/**
 * Contesta una pregunta sobre el padrón, o null si la frase no va de concesiones.
 * Siempre agrega que el padrón es de demostración: la honestidad no es opcional aquí.
 */
export function responderConcesion(mensaje: string, hoy = new Date()): string | null {
  const q = fold(mensaje);
  if (!q) return null;
  const hablaDelTema = /concesion|concesiones|expediente|permiso|padron|titular|vigencia|vence|caduca|inhgeomin/.test(q);

  if (/vence|caduca|por vencer|vencimiento|vigencia/.test(q) && hablaDelTema) {
    const lista = porVencer(365, hoy);
    if (!lista.length) return 'Ninguna concesión del padrón de demostración vence en el próximo año.';
    return `${lista.map((c) => `${c.nombre} vence el ${fecha(c.vence)}, en ${diasParaVencer(c, hoy)} días`).join('; ')}. Son datos de demostración, no un padrón real.`;
  }

  const hits = buscarConcesion(mensaje);
  if (hits.length === 1) return `${fichaTexto(hits[0], hoy)} Es una ficha de demostración, no un expediente real.`;
  if (hits.length > 1) {
    return `Coinciden ${hits.length}: ${hits.map((c) => c.nombre).join(', ')}. Decime cuál querés y te doy la ficha.`;
  }

  if (hablaDelTema && /cuant|cuál|cuales|lista|todas|hay|padron|resumen/.test(q)) {
    return `${resumenPadron(hoy)} Es un padrón de demostración.`;
  }
  if (hablaDelTema) {
    return `No encuentro esa concesión en el padrón de demostración. ${resumenPadron(hoy)}`;
  }
  return null;
}
