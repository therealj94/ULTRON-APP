/**
 * Bienvenida de AU-RA FP a un miembro de junta. Texto, sin emojis, sin palabras prohibidas, en tú.
 *
 * Auditoría del 7-oct (M6/A-1): decía «Cerebro Qwen 3.8 27B en nodo propio» y voz neural de Voicebox, pero lo que piensa
 * es Amazon Bedrock (GLM-5, con Kimi K2.5 de respaldo; el Qwen del nodo es el último respaldo) y lo que habla, ElevenLabs.
 */

import { enumerar, nombresConNivel, puedeCambiarSistema, type MiembroId } from './junta';

export function mensajeBienvenidaUltron(opts: { nombre: string; quien: MiembroId }): string {
  const nombre = opts.nombre;
  const consulta = !puedeCambiarSistema(opts.quien);
  // Los nombres salen del padrón (en el entorno, no en el repo público): quién manda y quién más consulta.
  const mandan = enumerar(nombresConNivel('mando'), 'y', 'la junta');
  const otrosConsultan = nombresConNivel('lee', opts.quien);
  const acceso = consulta
    ? `Una sola diferencia con ${mandan}: ${otrosConsultan.length ? `tú y ${enumerar(otrosConsultan)} no cambian` : 'tú no cambias'} el sistema. Si pides redespliegue, mantenimiento o correr código, te lo digo claro y no lo hago. El resto del taller es el mismo.`
    : `Con tu acceso puedes pedir redespliegue de la mesa, mantenimiento y el ejecutor.${nombresConNivel('lee').length ? ` Eso no se comparte con ${enumerar(nombresConNivel('lee'), 'ni')}.` : ''}`;
  return [
    `${nombre}.`,
    '',
    `Soy AU-RA FP, el asistente privado de la junta de Orden Global. ${nombresConNivel('mando').length > 1 ? `${mandan} te abrieron` : `${mandan === 'la junta' ? 'La junta' : mandan} te abrió`} este canal. Tu cerebro es tuyo: lo que me digas no se mezcla con el de nadie más. Queda en memoria durable, en S3, atado a ti.`,
    '',
    'Qué soy, sin teatro:',
    '',
    'AU-RA Face Presence es la cara y las manos de Genesis Core. Pienso con modelos en la nube (Amazon Bedrock) y, de respaldo, con el Qwen 27B de un nodo propio; puedo equivocarme, y lo importante conviene comprobarlo. Ojo que lee fotos y PDF. Oído que transcribe tu nota de voz. Notas de voz con mi voz (ElevenLabs) cuando las pides. Precio del oro y de la plata al momento. Tipo de cambio. Búsqueda en internet. Bóveda de claves que no recito. Telegram privado: nadie más entra a este hilo.',
    '',
    'Para qué me usas desde ya:',
    '',
    'Dime «cómo está el sistema» y te digo qué nodos viven y qué canal falta. Sube un PDF o una foto y los leo; si no está en el archivo, lo digo. Mándame una nota de voz y te contesto por escrito. Pídeme el spot del oro, una búsqueda, un PDF, un pendiente. «Recuerda que…» y queda atado a ti.',
    '',
    acceso,
    '',
    'Escríbeme. Estoy en este chat, a la hora que sea. AU-RA FP, Orden Global.',
  ].join('\n');
}
