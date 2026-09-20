/**
 * La junta de Orden Global, vista desde ULTRON FP.
 *
 * Esto ya no es un padrón: es una VENTANA al padrón (lib/acceso.ts) recortada a la plataforma
 * ULTRON. Quien no tiene acceso a `ultron` no existe aquí, aunque exista en Dr Electrum. Los dos
 * cerebros son independientes y su gente también, que es justo lo que se pidió.
 *
 * La firma de este archivo no cambió a propósito: media docena de módulos (memoria, taller,
 * bienvenida, el turno entero) la usan, y reescribirlos todos para ganar elegancia sería romper lo
 * que funciona a cambio de nada.
 */
import { identificar, nivelDe, padron, personaPorId, type Persona } from './acceso';

/** El id de una persona del padrón. Era una unión cerrada de cuatro; ahora el padrón se amplía sin tocar código. */
export type MiembroId = string;

export type Miembro = { id: MiembroId; nombre: string; correo: string };

/** Los que entran a ULTRON. Se recalcula con el padrón, así que agregar gente no exige despliegue. */
export function miembrosUltron(): Record<MiembroId, Miembro> {
  const out: Record<MiembroId, Miembro> = {};
  for (const p of padron()) {
    if (!nivelDe(p, 'ultron')) continue;
    out[p.id] = { id: p.id, nombre: p.nombre, correo: p.correos[0] || '' };
  }
  return out;
}

export function nombreDe(id: MiembroId | null | undefined): string {
  if (!id) return 'la junta';
  return personaPorId(id)?.nombre || 'la junta';
}

/**
 * Mando = nivel `mando` en ULTRON. Se sigue tomando el id ya verificado río arriba
 * (`quienVerificado`, que solo mira sesión firmada y Telegram comprobado), así que un nombre
 * escrito en el cuerpo de la petición nunca llega hasta acá.
 */
export function puedeCambiarSistema(id: MiembroId | null | undefined): boolean {
  return nivelDe(personaPorId(id), 'ultron') === 'mando';
}

/** Puede alimentar el cerebro de ULTRON: hechos de junta, documentos. */
export function puedeAlimentarUltron(id: MiembroId | null | undefined): boolean {
  const n = nivelDe(personaPorId(id), 'ultron');
  return n === 'mando' || n === 'escribe';
}

/**
 * Quién es, recortado a ULTRON. Devuelve null para quien no entra a esta plataforma: un usuario de
 * Dr Electrum que escriba a ULTRON es un desconocido, y así debe ser.
 */
export function quienEs(opts: {
  nombre?: string;
  correo?: string;
  telegramUserId?: string | number;
  telegramChatId?: string | number;
}): MiembroId | null {
  const id = identificar(opts);
  if (!id) return null;
  return nivelDe(id.persona, 'ultron') ? id.persona.id : null;
}

/** Igual que `quienEs`, pero trae la persona entera y con qué prueba se la reconoció. */
export function quienEsUltron(opts: Parameters<typeof quienEs>[0]): { persona: Persona; prueba: 'sesion' | 'telegram' | 'nombre' } | null {
  const id = identificar(opts);
  if (!id || !nivelDe(id.persona, 'ultron')) return null;
  return id;
}
