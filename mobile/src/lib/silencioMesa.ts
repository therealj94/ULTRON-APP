/**
 * EL SILENCIO DEL MICRÓFONO DE LA MESA VALE SOLO EN SU SESIÓN (José, 6-oct, APK 5.5.0: «a veces el micrófono falla»).
 *
 * Las migas de ese día: `micrófono: arranca silenciado (la persona lo dejó así en otra sesión)` y `oído de la mesa: lo
 * toma (mesa) (silenciado por la persona)`. El silencio se guardaba en el disco y la mesa lo volvía a poner en cada
 * arranque: José lo había silenciado días antes, abría la app y la mesa no lo oía. Lo vivía como un micrófono que falla.
 *
 * Ahora:
 *  · cada arranque de la app es una sesión nueva (`SESION_APP`, en memoria: muere con el proceso);
 *  · silenciar guarda TAMBIÉN de qué sesión es (`micMutedSesion`);
 *  · al montar la mesa, arranca silenciada solo si el silencio es de ESTA sesión (la mesa se volvió a montar sin cerrar
 *    la app: salir y volver a entrar a la cuenta, por ejemplo). Ahí se ve el micrófono tachado, la etiqueta dice
 *    «silenciado» y el saludo lo dice en voz alta (lib/saludo.ts saludoArranque). Un silencio de otra sesión no se
 *    arrastra: el micrófono abre y queda en la miga.
 * La razón de privacidad que había (duenoAudio.ts saludoArranque, 5-oct: «una recarga por OTA no le abre solo un
 * micrófono que ella cerró») se mantiene: la recarga de una OTA NO es una sesión nueva. Antes de recargar se deja
 * apuntada la sesión (lib/silencioHeredado.ts, con lib/barreraOta.ts antesDeRecargar) y el arranque que sigue, si llega
 * en HEREDAR_MS, la hereda: un silencio de antes de la OTA sigue. Cerrar la app y volver a abrirla sí es otra sesión:
 * silenciar es para el momento (una reunión, una llamada) y que siga así días después José lo tomó por avería.
 */

/** Esta sesión de la app (cambia en cada arranque del proceso; un recargo de JS también es una sesión nueva). */
export const SESION_APP = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Lo que tarda en volver una recarga por OTA: la sesión apuntada antes vale si el arranque llega antes de esto. */
export const HEREDAR_MS = 2 * 60_000;

/** Las sesiones que cuentan como «esta»: la de ahora y, si llegó a tiempo, la que dejó apuntada una recarga por OTA. */
export function sesionesDelSilencio(heredada: { sesion?: unknown; en?: unknown } | null, ahora = Date.now(), sesion = SESION_APP): string[] {
  const s = heredada && typeof heredada.sesion === 'string' ? heredada.sesion : '';
  const en = heredada && typeof heredada.en === 'number' ? heredada.en : 0;
  return s && ahora - en >= 0 && ahora - en < HEREDAR_MS ? [sesion, s] : [sesion];
}

export type ArranqueMic = {
  /** ¿La mesa arranca con el micrófono en silencio? */
  silenciada: boolean;
  /** `misma-sesion`: lo silenció en esta sesión; `otra-sesion`: había un silencio viejo y no se arrastra; `abierto`: nada. */
  motivo: 'misma-sesion' | 'otra-sesion' | 'abierto';
};

/** Con lo guardado (`micMuted` y de qué sesión es), cómo arranca la mesa. `sesiones`: las que cuentan como «esta». */
export function arranqueDelMicrofono(guardado: { micMuted?: boolean | null; micMutedSesion?: string | null }, sesiones: string | readonly string[] = SESION_APP): ArranqueMic {
  if (!guardado.micMuted) return { silenciada: false, motivo: 'abierto' };
  const validas = typeof sesiones === 'string' ? [sesiones] : sesiones;
  if (guardado.micMutedSesion && validas.includes(guardado.micMutedSesion)) return { silenciada: true, motivo: 'misma-sesion' };
  return { silenciada: false, motivo: 'otra-sesion' };
}

/** La miga del arranque (sin nada privado). '' si no hay nada que contar. */
export function migaArranqueMic(a: ArranqueMic): string {
  if (a.motivo === 'misma-sesion') return 'micrófono: sigue silenciado (lo silenciaste en esta sesión)';
  if (a.motivo === 'otra-sesion') return 'micrófono: abierto (el silencio de una sesión anterior no se arrastra)';
  return '';
}
