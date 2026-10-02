/**
 * SU COMPUTADORA EN LA APP (la lógica, sin React Native): qué decir del estado de la computadora en la
 * nube del avatar (server/computadora.ts) y cada cuánto preguntar.
 *
 * José (2-oct): «le dimos una computadora pero no logro ver lo que hace ni nada, ni cómo usarla». La
 * app no la mostraba en ningún lado. Ahora: «Más → Su computadora» (ajustes/Computadora.tsx) con lo
 * que está viendo, cada paso en palabras, el resultado y el botón de parar; y en la mesa un aviso
 * mientras trabaja (DeskScreen), con «Ver».
 */

export type EstadoTareaPc = 'en_cola' | 'trabajando' | 'hecha' | 'parada' | 'sin_pasos' | 'fallo';

export type PasoPc = { n: number; t: number; accion: string; texto?: string; miniatura?: string | null };
export type TareaPc = { id: string; instruccion: string; estado: EstadoTareaPc; pasos: PasoPc[]; respuesta: string | null; error: string | null; segundos: number };
export type ResumenPc = { id: string; estado: EstadoTareaPc; pasos: number; instruccion: string; ultimo: string | null };
export type EstadoPc = { configurada: boolean; ok: boolean; motores: string[]; ocupada: boolean; ultima: string | null; actual: ResumenPc | null; detalle?: string };

export const trabajando = (e: EstadoTareaPc | null | undefined) => e === 'en_cola' || e === 'trabajando';

/** Cada cuánto se pregunta: rápido mientras trabaja (se ve avanzar), lento si no hace nada. */
export function sondeoMs(e: EstadoTareaPc | null | undefined, abierta: boolean): number {
  if (trabajando(e)) return abierta ? 2500 : 8000;
  return abierta ? 8000 : 20000;
}

/** La línea de arriba: cómo está la computadora. */
export function estadoEnPalabras(s: EstadoPc | null, idioma: 'es' | 'en' = 'es'): { texto: string; tono: 'bien' | 'trabaja' | 'mal' | 'espera' } {
  const en = idioma === 'en';
  if (!s) return { texto: en ? 'Checking…' : 'Revisando…', tono: 'espera' };
  if (!s.configurada) return { texto: en ? 'Not set up on the server yet' : 'Todavía no está conectada en el servidor', tono: 'mal' };
  if (!s.ok) return { texto: en ? 'Not answering right now (it may be off)' : 'No contesta ahora (puede estar apagada)', tono: 'mal' };
  if (trabajando(s.actual?.estado)) return { texto: en ? 'Working on your task' : 'Trabajando en tu encargo', tono: 'trabaja' };
  if (s.ocupada) return { texto: en ? 'Busy with another task' : 'Ocupada con otro encargo', tono: 'trabaja' };
  return { texto: en ? 'Ready' : 'Lista para trabajar', tono: 'bien' };
}

/** Lo que dice la tarjeta de la tarea, según cómo terminó (o en qué va). */
export function tareaEnPalabras(t: Pick<TareaPc, 'estado' | 'pasos' | 'error'>, idioma: 'es' | 'en' = 'es'): string {
  const en = idioma === 'en';
  const hechos = t.pasos.filter((p) => p.accion !== 'escritorio_limpio' && p.accion !== 'answer').length;
  const ultimo = t.pasos[t.pasos.length - 1];
  switch (t.estado) {
    case 'en_cola':
      return en ? 'In line: it starts in a moment' : 'En fila: empieza en un momento';
    case 'trabajando':
      return ultimo?.texto ? `${en ? 'Step' : 'Paso'} ${hechos || 1} · ${ultimo.texto}` : en ? 'Starting…' : 'Empezando…';
    case 'hecha':
      return en ? `Done in ${hechos} steps` : `Lista en ${hechos} pasos`;
    case 'parada':
      return en ? 'You stopped it' : 'La paraste';
    case 'sin_pasos':
      return en ? `It didn’t finish in ${hechos} steps` : `No terminó en ${hechos} pasos`;
    default:
      return en ? `It failed: ${t.error || 'no details'}` : `Falló: ${t.error || 'sin detalle'}`;
  }
}

/** Para empezar: encargos que la computadora sabe hacer bien (y que muestran cómo pedir). */
export const EJEMPLOS_PC: { es: string; en: string }[] = [
  { es: 'Entra a es.wikipedia.org y dime en qué fecha nació Francisco Morazán', en: 'Go to en.wikipedia.org and tell me when Francisco Morazán was born' },
  { es: 'Busca en Google el clima de mañana en Tegucigalpa y dime la temperatura', en: 'Search Google for tomorrow’s weather in Tegucigalpa and tell me the temperature' },
  { es: 'Entra a bch.hn y dime el precio de compra del dólar de hoy', en: 'Go to bch.hn and tell me today’s dollar buying rate' },
];

/**
 * El aviso de la mesa: mientras trabaja, «trabajando · paso»; cuando termina, «terminó» un rato (para
 * que lo vea aunque no estuviera mirando). null = no se muestra.
 */
export function avisoMesa(antes: ResumenPc | null, ahora: ResumenPc | null, idioma: 'es' | 'en' = 'es'): { texto: string; terminada: boolean } | null {
  const en = idioma === 'en';
  if (!ahora) return null;
  if (trabajando(ahora.estado)) return { texto: ahora.ultimo ? `${en ? 'Its computer' : 'Su computadora'} · ${ahora.ultimo}` : en ? 'Its computer is working' : 'Su computadora está trabajando', terminada: false };
  if (antes && antes.id === ahora.id && trabajando(antes.estado)) return { texto: en ? 'Its computer finished · see the result' : 'Su computadora terminó · ver el resultado', terminada: true };
  return null;
}
