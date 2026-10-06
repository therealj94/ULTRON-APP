/**
 * EL SILENCIO DEL MICRÓFONO DE LA MESA CADUCA POR TIEMPO (José, 6-oct, APK 5.5.0: «a veces el micrófono falla»; y la
 * revisión del 6-oct a la 5.6.0: el silencio por proceso se perdía si Android mataba la app).
 *
 * La historia:
 *  · 5-oct: el silencio se guardaba en el disco y la mesa lo volvía a poner en cada arranque, para siempre. José lo
 *    había silenciado días antes, abría la app y la mesa no lo oía: lo vivía como un micrófono que falla (migas:
 *    `micrófono: arranca silenciado (la persona lo dejó así en otra sesión)`).
 *  · 5.6.0: el silencio valía solo en el proceso que lo puso. Pero Android mata la app en segundo plano (Samsung, muy
 *    a menudo), la cierra por un «no responde» (ANR) o una OTA tarda en montar: la mesa volvía con el micrófono
 *    ABIERTO aunque la persona lo había silenciado minutos antes. Un micrófono que se abre solo es de privacidad.
 *
 * Ahora el silencio se guarda con su HORA (`micMutedEn`) y vale `SILENCIO_VIGENCIA_MS` (8 h) desde que se puso, sin
 * importar cuántas veces se cierre o se recargue la app:
 *  · dentro de las 8 h la mesa arranca silenciada y lo DICE: el micrófono tachado, el globo y el chat con el saludo,
 *    y en voz si el saludo suena (compa/duenoAudio.ts saludoArranque), con cómo abrirlo («toca el micrófono»);
 *  · pasadas las 8 h arranca abierta y TAMBIÉN lo dice («el silencio que dejaste venció: ya te oigo»). Es la
 *    intención de José: el silencio de una reunión o de la noche no lo deja sordo al día siguiente.
 * Por qué 8 h: cubre una jornada o una noche (silenciar es para el momento: una reunión, una llamada, dormir) y vence
 * antes del día siguiente de uso normal. Un silencio sin hora (guardado por la 5.5.0 o la 5.6.0) no se sabe de
 * cuándo es: arranca abierto y se dice, salvo el que la 5.6.0 dejó apuntado justo antes de recargar por una OTA
 * (lib/silencioHeredado.ts): ese cuenta desde la hora de la recarga, para que la propia OTA de este cambio no le abra
 * a nadie un micrófono que acababa de cerrar.
 */

/** Lo que vale un silencio desde que se puso: 8 horas (una jornada o una noche; vence antes del día siguiente). */
export const SILENCIO_VIGENCIA_MS = 8 * 60 * 60_000;

export type ArranqueMic = {
  /** ¿La mesa arranca con el micrófono en silencio? */
  silenciada: boolean;
  /**
   * `vigente`: lo silenció hace menos de 8 h (se queda y se dice); `otra-sesion`: había un silencio vencido (o sin
   * hora, de una versión anterior) y no se arrastra (abre y se dice); `abierto`: nada.
   */
  motivo: 'vigente' | 'otra-sesion' | 'abierto';
  /** Hora en que se silenció (solo con `vigente`). */
  desde?: number;
};

/** Lo que dejó apuntado la 5.6.0 antes de recargar por una OTA: su sesión y la hora de la recarga. */
export type SilencioHeredado = { sesion?: unknown; en?: unknown } | null;

/**
 * Con lo guardado, cómo arranca la mesa. `micMutedEn`: la hora del silencio. `micMutedSesion` + `heredado`: solo para
 * el silencio de la 5.6.0 (sin hora) que siguió a una recarga por OTA: cuenta desde la hora de esa recarga.
 */
export function arranqueDelMicrofono(
  guardado: { micMuted?: boolean | null; micMutedEn?: number | null; micMutedSesion?: string | null },
  ahora = Date.now(),
  heredado: SilencioHeredado = null
): ArranqueMic {
  if (!guardado.micMuted) return { silenciada: false, motivo: 'abierto' };
  let desde = typeof guardado.micMutedEn === 'number' && Number.isFinite(guardado.micMutedEn) && guardado.micMutedEn > 0 ? guardado.micMutedEn : 0;
  if (!desde && guardado.micMutedSesion && heredado && heredado.sesion === guardado.micMutedSesion && typeof heredado.en === 'number' && heredado.en > 0) desde = heredado.en;
  // Con el reloj del teléfono movido hacia atrás la hora queda «en el futuro»: también vale si cae dentro del plazo
  // (abrirle el micrófono por un ajuste del reloj sería peor); una hora absurda no vale.
  if (desde && Math.abs(ahora - desde) < SILENCIO_VIGENCIA_MS) return { silenciada: true, motivo: 'vigente', desde };
  return { silenciada: false, motivo: 'otra-sesion' };
}

/** La miga del arranque (sin nada privado). '' si no hay nada que contar. */
export function migaArranqueMic(a: ArranqueMic, ahora = Date.now()): string {
  if (a.motivo === 'vigente') {
    const min = Math.max(0, Math.round((ahora - (a.desde ?? ahora)) / 60_000));
    return `micrófono: sigue silenciado (lo silenciaste hace ${min} min; el silencio vale ${SILENCIO_VIGENCIA_MS / 3_600_000} h)`;
  }
  if (a.motivo === 'otra-sesion') return `micrófono: abierto (el silencio guardado venció o no tenía hora; vale ${SILENCIO_VIGENCIA_MS / 3_600_000} h)`;
  return '';
}
