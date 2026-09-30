/**
 * LO QUE SE DICE EN PANTALLA: horas, días, el resumen de una conversación y cómo se agrupan las
 * burbujas. Sin React ni nada nativo: lo prueban en node (`pruebas/chat/formato.cjs`).
 *
 * Las burbujas se agrupan como en cualquier app de mensajería de primera: seguidas del mismo
 * remitente, el mismo día y con menos de cinco minutos entre una y otra van pegadas, y solo la
 * última del grupo lleva cola. Entre días, un separador («Hoy», «Ayer», «lunes», «28 sep»).
 */
import { localeActual, tr } from '../../i18n';
import type { Mensaje } from '../relevo';

const DIA = 86_400_000;
const PEGADAS_MS = 5 * 60_000;

/** Medianoche local del día de `ms`. */
function inicioDelDia(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Cuántos días de calendario hay entre `ms` y `ahora` (0 = hoy, 1 = ayer…). */
export function diasAtras(ms: number, ahora = Date.now()): number {
  return Math.round((inicioDelDia(ahora) - inicioDelDia(ms)) / DIA);
}

/** «14:05» (o «2:05 p. m.» según el idioma). */
export function hora(ms: number): string {
  if (!ms) return '';
  try {
    return new Date(ms).toLocaleTimeString(localeActual(), {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}

function fechaCorta(ms: number, ahora: number, conDia: boolean): string {
  const d = new Date(ms);
  const mismoAno = d.getFullYear() === new Date(ahora).getFullYear();
  try {
    return d.toLocaleDateString(localeActual(), {
      ...(conDia ? { weekday: 'short' } : {}),
      day: 'numeric',
      month: 'short',
      ...(mismoAno ? {} : { year: 'numeric' }),
    });
  } catch {
    return `${d.getDate()}/${d.getMonth() + 1}${mismoAno ? '' : '/' + String(d.getFullYear()).slice(2)}`;
  }
}

function diaDeLaSemana(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString(localeActual(), { weekday: 'long' });
  } catch {
    return fechaCorta(ms, ms, false);
  }
}

/** La hora de la lista de conversaciones: la hora si es de hoy, «Ayer», el día de la semana o la fecha. */
export function cuandoLista(ms: number, ahora = Date.now()): string {
  if (!ms) return '';
  const n = diasAtras(ms, ahora);
  if (n <= 0) return hora(ms);
  if (n === 1) return tr('Ayer', 'Yesterday');
  if (n < 7) return diaDeLaSemana(ms);
  return fechaCorta(ms, ahora, false);
}

/** El separador de días dentro del hilo. */
export function etiquetaDia(ms: number, ahora = Date.now()): string {
  const n = diasAtras(ms, ahora);
  if (n <= 0) return tr('Hoy', 'Today');
  if (n === 1) return tr('Ayer', 'Yesterday');
  if (n < 7) {
    const d = diaDeLaSemana(ms);
    return d.charAt(0).toUpperCase() + d.slice(1);
  }
  return fechaCorta(ms, ahora, true);
}

/** Un renglón: sin saltos ni espacios de más, recortado sin partir un emoji por la mitad. */
export function recortar(texto: string, max = 80): string {
  const plano = String(texto || '')
    .replace(/\s+/g, ' ')
    .trim();
  const letras = Array.from(plano);
  return letras.length > max
    ? letras
        .slice(0, max - 1)
        .join('')
        .trimEnd() + '…'
    : plano;
}

/** Lo que se lee debajo del nombre en la lista: el último mensaje, dicho con la verdad de su sobre. */
export function resumen(ultimo: Mensaje | null | undefined, yo?: string): string {
  if (!ultimo) return '';
  const mio = !!yo && ultimo.de === yo;
  const prefijo = mio ? tr('Tú: ', 'You: ') : '';
  if (ultimo.borrado) return prefijo + tr('Mensaje borrado', 'Message deleted');
  if (ultimo.cerrado) return prefijo + tr('Cifrado para otro de tus aparatos', 'Encrypted for another of your devices');
  if (ultimo.tipo === 'imagen') return prefijo + (ultimo.texto ? '📷 ' + recortar(ultimo.texto, 70) : '📷 ' + tr('Foto', 'Photo'));
  return prefijo + recortar(ultimo.texto, 90);
}

/** La inicial (o las dos iniciales) de un nombre, para el avatar sin foto. */
export function iniciales(nombre: string): string {
  const partes = String(nombre || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const primera = (s: string) => Array.from(s)[0] || '';
  if (!partes.length) return '?';
  const dos = partes.length > 1 ? primera(partes[0]) + primera(partes[partes.length - 1]) : primera(partes[0]);
  return dos.toUpperCase();
}

/* ── las burbujas agrupadas ───────────────────────────────────────────────────────────────── */

type ConEstado = Mensaje & { pendiente?: boolean; fallido?: boolean };

export type Fila =
  | { tipo: 'dia'; clave: string; texto: string }
  | {
      tipo: 'msg';
      clave: string;
      m: ConEstado;
      mio: boolean;
      /** Primera del grupo (arriba): lleva más aire encima. */
      primera: boolean;
      /** Última del grupo (abajo): lleva la cola. */
      ultima: boolean;
      /** La otra persona ya la vio (doble palomita). */
      leido: boolean;
    };

/**
 * Del hilo en orden (viejo → nuevo) a las filas de la lista, YA INVERTIDAS (nuevo → viejo) para una
 * FlatList `inverted`: así el hilo arranca pegado abajo y lo nuevo entra sin saltos.
 */
export function filasDelHilo(mensajes: ConEstado[], yo: string, leidoHasta: number, ahora = Date.now()): Fila[] {
  const filas: Fila[] = [];
  let diaAnterior = -1;
  for (let i = 0; i < mensajes.length; i++) {
    const m = mensajes[i];
    const dia = inicioDelDia(m.cuando || ahora);
    if (dia !== diaAnterior) {
      filas.push({
        tipo: 'dia',
        clave: 'dia-' + dia,
        texto: etiquetaDia(m.cuando || ahora, ahora),
      });
      diaAnterior = dia;
    }
    const antes = mensajes[i - 1];
    const despues = mensajes[i + 1];
    const pegadaA = (x: ConEstado | undefined) =>
      !!x && x.de === m.de && inicioDelDia(x.cuando || ahora) === dia && Math.abs((x.cuando || ahora) - (m.cuando || ahora)) < PEGADAS_MS;
    const mio = m.de === yo;
    filas.push({
      tipo: 'msg',
      clave: m.id,
      m,
      mio,
      primera: !pegadaA(antes),
      ultima: !pegadaA(despues),
      leido: mio && !m.pendiente && !m.fallido && leidoHasta > 0 && (m.cuando || 0) <= leidoHasta,
    });
  }
  return filas.reverse();
}
