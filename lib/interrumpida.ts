/**
 * CUANDO LA PERSONA LE HABLA ENCIMA (José, 3-oct: «como ChatGPT con voz: si le interrumpo me escucha y
 * vuelve y me dice ok, está bien… que sienta que me escucha»).
 *
 * El teléfono y la web cortan la voz en cuanto la persona entra (mobile/src/lib/interrupcion.ts) y con
 * el pedido siguiente mandan `interrumpido: { oido }`: lo que la persona alcanzó a oír de la respuesta
 * anterior. El cerebro recibe un hecho que le dice dónde quedó y cómo retomar: un acuse muy corto y
 * natural («Va.», «Ok, dime.», «Claro, entonces…»), sin pedir perdón, y directo a lo nuevo; y si solo
 * le pidieron esperar, dos o tres palabras y nada más. Lo que no alcanzó a decir, la persona no lo oyó.
 */
type Idioma = 'es' | 'en';

/** Tope de lo que se cree del cliente como «lo que oyó» (es solo una pista para el cerebro). */
export const TOPE_OIDO = 400;

/**
 * `interrumpido` del cuerpo del turno: `null` si no la interrumpieron; si sí, lo que oyó (puede ser ''
 * si la cortó antes de la primera palabra).
 */
export function oidoAlInterrumpir(body: unknown): string | null {
  const i = (body as any)?.interrumpido;
  if (!i || typeof i !== 'object') return null;
  const oido = typeof i.oido === 'string' ? i.oido : '';
  return oido.replace(/\s+/g, ' ').replace(/[«»"]/g, '').trim().slice(-TOPE_OIDO);
}

/** El hecho para el cerebro: la persona la cortó y su voz NO dijo nada todavía. */
export function hechoInterrumpida(idioma: Idioma, oido: string): string {
  if (idioma === 'en') {
    const donde = oido ? ` They only heard up to: «${oido}» — they did NOT hear the rest of that answer.` : ' They cut you off before your first word.';
    return (
      `INTERRUPTED: the person talked over you and you stopped to listen.${donde} ` +
      'Start with a very short, natural acknowledgment (one to three words: «Okay.», «Sure, go on.», «Got it, so…») — no apologies — and go straight to what they just said. ' +
      'If they only asked you to wait or stop, answer just that («Sure, I\'m listening.») and nothing else. Do not repeat what you already said unless they ask.'
    );
  }
  const donde = oido ? ` Solo alcanzó a oír hasta: «${oido}» — lo demás de esa respuesta NO lo oyó.` : ' Te cortó antes de la primera palabra.';
  return (
    `TE INTERRUMPIÓ: la persona te habló encima y te callaste para escucharla.${donde} ` +
    'Empieza con un acuse muy corto y natural (de una a tres palabras: «Va.», «Ok, dime.», «Claro, entonces…»), sin pedir perdón, y ve directo a lo que acaba de decir. ' +
    'Si solo te pidió que esperaras o pararas, contesta solo eso («Claro, aquí estoy.») y nada más. No repitas lo que ya dijiste salvo que te lo pida.'
  );
}
