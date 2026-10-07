/**
 * ABRIR EL MARCADOR (auditoría del 7-oct, A-4): «llama a don Carlos del banco» → el servidor pregunta «¿Le marco a Don
 * Carlos al +504 9876-5432?» y, con el «sí», manda `{tipo:'marcar', numero, via}`. Aquí se abre:
 *
 *   · teléfono  → `tel:+50498765432`: el marcador del sistema con el número puesto. NO llama solo (ACTION_VIEW): la persona
 *                 toca llamar. Por eso no hace falta ningún permiso nuevo (ni CALL_PHONE ni leer contactos) y va por OTA;
 *   · WhatsApp  → el chat de ese número (`whatsapp://send?phone=…`; si no abre, `https://wa.me/…`). WhatsApp no publica un
 *                 enlace que empiece una llamada, y `whatsapp://call` en Android abre WhatsApp sin llamar a nadie: se abre
 *                 el chat y ahí está el botón de llamar (lo dice el recibo).
 *
 * Puro (sin React Native): `abrirMarcador` recibe el `abrir` de Linking. Lo prueba node (compa/pruebas).
 */

export type ViaMarcar = 'telefono' | 'whatsapp';

/** Un número que se puede marcar: E.164 («+50498765432»). */
export function numeroMarcable(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
}

/** Las direcciones a probar, en orden. Vacío si el número no vale (nunca se abre algo raro). */
export function enlacesDeMarcar(a: { numero?: unknown; via?: unknown }): string[] {
  const n = numeroMarcable(a.numero);
  if (!n) return [];
  const digitos = n.slice(1);
  if (a.via === 'whatsapp') return [`whatsapp://send?phone=${digitos}`, `https://wa.me/${digitos}`];
  return [`tel:${n}`];
}

/** Lo que se le dice si se abrió o no (el «hecho» de la acción). Nunca «ya hablé con él»: se abrió el marcador. */
export type ResultadoMarcar = { ok: boolean; detalle: string; enlace?: string };

/**
 * Abre el primero que el teléfono acepte. `abrir` es `Linking.openURL` (lanza si nada lo abre). Nunca lanza: lo que
 * falle se contesta con un motivo que AURA puede decir.
 */
export async function abrirMarcador(a: { numero?: unknown; via?: unknown; nombre?: unknown }, abrir: (url: string) => Promise<unknown>, tr: (es: string, en: string) => string = (es) => es): Promise<ResultadoMarcar> {
  const enlaces = enlacesDeMarcar(a);
  if (!enlaces.length) return { ok: false, detalle: tr('Ese número no lo puedo marcar.', "I can't dial that number.") };
  for (const enlace of enlaces) {
    try {
      await abrir(enlace);
      return {
        ok: true,
        enlace,
        detalle: a.via === 'whatsapp' ? tr('Abrí WhatsApp: toca el botón de llamar.', 'I opened WhatsApp: tap the call button.') : tr('Abrí el marcador: toca llamar.', 'I opened the dialer: tap call.'),
      };
    } catch {
      /* el siguiente */
    }
  }
  return {
    ok: false,
    detalle: a.via === 'whatsapp' ? tr('No pude abrir WhatsApp en este teléfono.', "I couldn't open WhatsApp on this phone.") : tr('No pude abrir el marcador en este teléfono.', "I couldn't open the dialer on this phone."),
  };
}
