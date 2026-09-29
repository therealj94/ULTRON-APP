/**
 * Los avatares de la mesa de AU-RA.
 *
 * Tres personajes, un solo cerebro: cambia la cara, la voz y cómo se acomoda la pantalla; lo que
 * sabe y lo que puede hacer es lo mismo. Vive aparte (sin React Native) para que las pruebas y el
 * almacenamiento lo lean sin arrastrar componentes.
 *
 *  · AU-RA: los ojos de siempre (Skia), voz de Dora. Horizontal a pantalla completa.
 *  · Claudio: el zorro de lentes, retrato. Horizontal a pantalla completa.
 *  · Claudio de pie: el mismo zorro de cuerpo entero. Como está parado, su pantalla completa es la
 *    vertical.
 *
 * En vertical, AU-RA y Claudio se hacen un cuadro arriba con el chat abajo.
 */
export type AvatarId = 'aura' | 'claudio' | 'claudio-pie';

export type Avatar = {
  id: AvatarId;
  nombre: string;
  /** Una línea para la tarjeta de elección. */
  descripcion: string;
  /** Qué voz tiene, dicho para una persona. */
  voz: string;
  /** La orientación en la que ocupa la pantalla entera. */
  completa: 'horizontal' | 'vertical';
  /** Con qué saluda la primera vez que se lo elige. */
  presentacion: string;
};

export const AVATARES: readonly Avatar[] = [
  {
    id: 'aura',
    nombre: 'AU-RA',
    descripcion: 'Los ojos de siempre. Serena y atenta.',
    voz: 'Dora · voz propia',
    completa: 'horizontal',
    presentacion: 'Aquí estoy. Soy AU-RA, la de siempre.',
  },
  {
    id: 'claudio',
    nombre: 'Claudio',
    descripcion: 'El zorro de lentes. Curioso y bromista.',
    voz: 'Charlee · juvenil',
    completa: 'horizontal',
    presentacion: '¡Hola! Soy Claudio. Pregúntame lo que quieras, que para eso traigo lentes.',
  },
  {
    id: 'claudio-pie',
    nombre: 'Claudio de pie',
    descripcion: 'Claudio de cuerpo entero. Mejor en vertical.',
    voz: 'Alejandro · enérgico',
    completa: 'vertical',
    presentacion: '¡Ya llegué! Claudio de cuerpo entero, listo para trabajar contigo.',
  },
];

export function normalizarAvatarId(v: unknown): AvatarId {
  return v === 'claudio' || v === 'claudio-pie' ? v : 'aura';
}

export function avatarPorId(id: AvatarId): Avatar {
  return AVATARES.find((a) => a.id === id) || AVATARES[0];
}

/** ¿El avatar tiene su propia voz grabada en el APK? Solo AU-RA: los clips del banco son de Dora. */
export function usaBancoDeVoz(id: AvatarId): boolean {
  return id === 'aura';
}

/**
 * Cómo se reparte la pantalla. `completa`: el avatar ocupa todo y el chat flota encima.
 * `cuadro`: el avatar en un recuadro y el chat al lado (horizontal) o debajo (vertical).
 */
export function distribucion(id: AvatarId, horizontal: boolean): { tipo: 'completa' | 'cuadro'; chat: 'abajo' | 'lado' | 'flota' } {
  const a = avatarPorId(id);
  const enSuOrientacion = (a.completa === 'horizontal') === horizontal;
  if (enSuOrientacion) return { tipo: 'completa', chat: 'flota' };
  return { tipo: 'cuadro', chat: horizontal ? 'lado' : 'abajo' };
}
