/**
 * La junta de Orden Global, vista desde AU-RA FP.
 *
 * Esto ya no es un padrón: es una VENTANA al padrón (lib/acceso.ts) recortada a la plataforma
 * AU-RA. Quien no tiene acceso a `ultron` no existe aquí, aunque exista en Dr Electrum. Los dos
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

/** Los que entran a AU-RA. Se recalcula con el padrón, así que agregar gente no exige despliegue. */
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
 * Mando = nivel `mando` en AU-RA. Se sigue tomando el id ya verificado río arriba
 * (`quienVerificado`, que solo mira sesión firmada y Telegram comprobado), así que un nombre
 * escrito en el cuerpo de la petición nunca llega hasta acá.
 */
export function puedeCambiarSistema(id: MiembroId | null | undefined): boolean {
  return nivelDe(personaPorId(id), 'ultron') === 'mando';
}

/** Puede alimentar el cerebro de AU-RA: hechos de junta, documentos. */
export function puedeAlimentarUltron(id: MiembroId | null | undefined): boolean {
  const n = nivelDe(personaPorId(id), 'ultron');
  return n === 'mando' || n === 'escribe';
}

/**
 * Quién es, recortado a AU-RA. Devuelve null para quien no entra a esta plataforma: un usuario de
 * Dr Electrum que escriba a AU-RA es un desconocido, y así debe ser.
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

/**
 * Los nombres (de pila, como están en el padrón) de quienes tienen ese nivel en AU-RA, en el orden del padrón. Los
 * textos que antes nombraban a la junta a mano («A o B») los sacan de aquí: los nombres viven en el entorno,
 * no en el repositorio público (auditoría del 7-oct, C-1).
 */
export function nombresConNivel(nivel: 'mando' | 'escribe' | 'lee', excepto?: MiembroId | null): string[] {
  return padron()
    .filter((p) => p.id !== excepto && nivelDe(p, 'ultron') === nivel && p.nombre)
    .map((p) => p.nombre);
}

/** «A», «A y B», «A, B y C»; con `o`, «A o B». Vacío: `siNadie`. */
export function enumerar(nombres: string[], conjuncion: 'y' | 'o' | 'ni' = 'y', siNadie = ''): string {
  if (!nombres.length) return siNadie;
  if (nombres.length === 1) return nombres[0];
  return `${nombres.slice(0, -1).join(', ')} ${conjuncion} ${nombres[nombres.length - 1]}`;
}

/** Quién cambia el sistema, para decirlo en una frase: «A o B», o «alguien con mando» si no hay nombres. */
export function quienesMandan(conjuncion: 'y' | 'o' = 'o'): string {
  return enumerar(nombresConNivel('mando'), conjuncion, 'alguien de la junta con mando');
}
