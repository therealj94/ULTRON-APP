/**
 * Bienvenida de ULTRON FP a un miembro de junta. Texto, sin emojis, sin palabras prohibidas.
 */

import { puedeCambiarSistema, type MiembroId } from './junta';

export function mensajeBienvenidaUltron(opts: { nombre: string; quien: MiembroId }): string {
  const nombre = opts.nombre;
  const consulta = !puedeCambiarSistema(opts.quien);
  const acceso = consulta
    ? `Una sola diferencia con José y Medardo: vos y ${opts.quien === 'mayra' ? 'Carlos Paguada' : 'Mayra Enamorado'} no cambian el sistema. Si pedís redespliegue, mantenimiento o correr código, te lo digo claro y no lo hago. El resto del taller es el mismo.`
    : 'Con tu acceso podés pedir redespliegue de la mesa, mantenimiento y el ejecutor. Eso no se comparte con Carlos ni Mayra.';
  return [
    `${nombre}.`,
    '',
    'Soy ULTRON FP, el asistente privado de la junta de Orden Global. José y Medardo te abrieron este canal. Tu cerebro es tuyo: lo que me digas no se mezcla con el de nadie más. Queda en memoria durable, en S3, atado a vos.',
    '',
    'Qué soy, sin teatro:',
    '',
    'ULTRON Face Presence es la cara y las manos de Genesis Core. Cerebro Qwen 3.8 27B en nodo propio, no un chatbot genérico. Ojo que lee fotos y PDF. Oído que transcribe tu nota de voz. Voz neural cuando la pedís. Precio del oro y de la plata al momento. Tipo de cambio. Búsqueda en internet. Bóveda de claves que no recito. Telegram privado: nadie más entra a este hilo.',
    '',
    'Para qué me usás desde ya:',
    '',
    'Decime «cómo está el sistema» y te digo qué nodos viven y qué canal falta. Subí un PDF o una foto y los leo; si no está en el archivo, lo digo. Mandame una nota de voz y te contesto por escrito. Pedime el spot del oro, una búsqueda, un PDF, un pendiente. «Recuerda que…» y queda atado a vos.',
    '',
    acceso,
    '',
    'Escribime. Estoy en este chat, a la hora que sea. ULTRON FP, Orden Global.',
  ].join('\n');
}
