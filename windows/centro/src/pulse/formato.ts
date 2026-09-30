/**
 * LO QUE SE DICE EN PANTALLA: horas, días, el resumen de una conversación, las iniciales y cómo se
 * agrupan las burbujas. Igual que `mobile/src/pulse/ui/formato.ts`: seguidas del mismo remitente, el
 * mismo día y con menos de cinco minutos entre una y otra van pegadas; entre días, un separador.
 */
import { T, estado } from '../estado';
import type { Mensaje } from './relevo';

const DIA = 86_400_000;
const PEGADAS_MS = 5 * 60_000;

const locale = () => (estado()?.idioma === 'en' ? 'en-US' : 'es-HN');

function inicioDelDia(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function diasAtras(ms: number, ahora = Date.now()): number {
  return Math.round((inicioDelDia(ahora) - inicioDelDia(ms)) / DIA);
}

export function hora(ms: number): string {
  if (!ms) return '';
  try {
    return new Date(ms).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  } catch {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}

function fechaCorta(ms: number, ahora: number, conDia: boolean): string {
  const d = new Date(ms);
  const mismoAno = d.getFullYear() === new Date(ahora).getFullYear();
  try {
    return d.toLocaleDateString(locale(), { ...(conDia ? { weekday: 'short' } : {}), day: 'numeric', month: 'short', ...(mismoAno ? {} : { year: 'numeric' }) });
  } catch {
    return `${d.getDate()}/${d.getMonth() + 1}${mismoAno ? '' : '/' + String(d.getFullYear()).slice(2)}`;
  }
}

function diaDeLaSemana(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString(locale(), { weekday: 'long' });
  } catch {
    return fechaCorta(ms, ms, false);
  }
}

/** La hora de la lista: la hora si es de hoy, «Ayer», el día de la semana o la fecha. */
export function cuandoLista(ms: number, ahora = Date.now()): string {
  if (!ms) return '';
  const n = diasAtras(ms, ahora);
  if (n <= 0) return hora(ms);
  if (n === 1) return T('Ayer', 'Yesterday');
  if (n < 7) return diaDeLaSemana(ms);
  return fechaCorta(ms, ahora, false);
}

/** El separador de días dentro del hilo. */
export function etiquetaDia(ms: number, ahora = Date.now()): string {
  const n = diasAtras(ms, ahora);
  if (n <= 0) return T('Hoy', 'Today');
  if (n === 1) return T('Ayer', 'Yesterday');
  if (n < 7) {
    const d = diaDeLaSemana(ms);
    return d.charAt(0).toUpperCase() + d.slice(1);
  }
  return fechaCorta(ms, ahora, true);
}

/** Un renglón: sin saltos ni espacios de más, recortado sin partir un emoji por la mitad. */
export function recortar(texto: string, max = 80): string {
  const plano = String(texto || '').replace(/\s+/g, ' ').trim();
  const letras = Array.from(plano);
  return letras.length > max ? letras.slice(0, max - 1).join('').trimEnd() + '…' : plano;
}

/** Lo que se lee debajo del nombre en la lista: el último mensaje, dicho con la verdad de su sobre. */
export function resumen(ultimo: Mensaje | null | undefined, yo?: string): string {
  if (!ultimo) return '';
  const mio = !!yo && ultimo.de === yo;
  const prefijo = mio ? T('Tú: ', 'You: ') : '';
  if (ultimo.borrado) return prefijo + T('Mensaje borrado', 'Message deleted');
  if (ultimo.cerrado) return prefijo + T('Cifrado para otro de tus aparatos', 'Encrypted for another of your devices');
  if (ultimo.tipo === 'imagen') return prefijo + (ultimo.texto ? '📷 ' + recortar(ultimo.texto, 70) : '📷 ' + T('Foto', 'Photo'));
  return prefijo + recortar(ultimo.texto, 90);
}

/** La inicial (o las dos iniciales) de un nombre, para la cara sin foto. */
export function iniciales(nombre: string): string {
  const partes = String(nombre || '').trim().split(/\s+/).filter(Boolean);
  const primera = (s: string) => Array.from(s)[0] || '';
  if (!partes.length) return '?';
  const dos = partes.length > 1 ? primera(partes[0]) + primera(partes[partes.length - 1]) : primera(partes[0]);
  return dos.toUpperCase();
}

/** «1:05» o «1:02:05». */
export function reloj(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

type ConEstado = Mensaje & { pendiente?: boolean; fallido?: boolean; motivoFallo?: string };

export type Fila =
  | { tipo: 'dia'; clave: string; texto: string }
  | { tipo: 'msg'; clave: string; m: ConEstado; mio: boolean; primera: boolean; ultima: boolean; leido: boolean };

/** Del hilo en orden (viejo → nuevo) a las filas, en el mismo orden, con sus separadores de día. */
export function filasDelHilo(mensajes: ConEstado[], yo: string, leidoHasta: number, ahora = Date.now()): Fila[] {
  const filas: Fila[] = [];
  let diaAnterior = -1;
  for (let i = 0; i < mensajes.length; i++) {
    const m = mensajes[i];
    const dia = inicioDelDia(m.cuando || ahora);
    if (dia !== diaAnterior) {
      filas.push({ tipo: 'dia', clave: 'dia-' + dia, texto: etiquetaDia(m.cuando || ahora, ahora) });
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
  return filas;
}
