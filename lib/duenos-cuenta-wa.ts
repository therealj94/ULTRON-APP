/**
 * DE QUIÉN ES CADA CUENTA DEL PUENTE DE WHATSAPP (para los avisos de mensajes nuevos, A-6). El puente solo conoce la
 * clave opaca de cada cuenta (server/whatsapp.ts claveCuentaWhatsapp: «legado» o un HMAC); cuando avisa «llegó un
 * mensaje a la cuenta X», el servidor tiene que saber a qué persona de AU-RA avisarle. El HMAC no se puede deshacer, así
 * que aquí se anota, cada vez que una sesión de verdad usa SU WhatsApp (las rutas de la app), qué correo dio esa clave.
 *
 * Quien lo usa (lib/alertas-mensajes.ts) VUELVE a sacar la clave de cada correo anotado y solo avisa si coincide: un
 * registro manipulado no hace que el WhatsApp de una persona le avise a otra. Para «legado» (el de los dueños, que lo
 * comparten por configuración: WHATSAPP_DUENOS) puede haber varios correos.
 *
 * En el cajón seguro de siempre (lib/misiones.ts), con la clave de la cuenta por «dueño». Hasta MAX_CORREOS por cuenta,
 * el más reciente primero.
 */
import { cajonPorCorreo } from './misiones';

type CajonDuenos = { version: 1; correos: string[] };
export const MAX_CORREOS_CUENTA = 4;

const normal = (s: unknown) => String(s ?? '').trim().toLowerCase();

const cajon = cajonPorCorreo<CajonDuenos>({
  nombre: 'whatsapp-duenos',
  s3: 'ultron/whatsapp-duenos',
  dirEnv: 'ULTRON_WA_DUENOS_DIR',
  dirDef: 'whatsapp-duenos',
  sanear: (x) => ({ version: 1, correos: (Array.isArray((x as any)?.correos) ? ((x as any).correos as unknown[]) : []).map(normal).filter((c) => /^[^\s@]+@[^\s@]+$/.test(c) || /^veta:0x[0-9a-f]{40}$/.test(c)).slice(0, MAX_CORREOS_CUENTA) }),
  vacio: () => ({ version: 1, correos: [] }),
  que: 'de quién es cada WhatsApp',
});

/** Lo ya anotado en este proceso (no se escribe en cada pedido de la app). */
const VISTOS = new Map<string, number>();
const VOLVER_A_ANOTAR_MS = 6 * 3600_000;

/** Anota que `correo` usa la cuenta `cuenta` del puente. Nunca lanza (si no se pudo, se intenta en el próximo pedido). */
export async function anotarDuenoCuentaWA(cuenta: string, correo: string): Promise<void> {
  const k = normal(cuenta);
  const c = normal(correo);
  if (!k || !c || !/^(legado|[a-f0-9]{32,64})$/.test(k)) return;
  const visto = VISTOS.get(`${k}|${c}`);
  if (visto && Date.now() - visto < VOLVER_A_ANOTAR_MS) return;
  try {
    await cajon.modificar(k, (cj) => {
      cj.correos = [c, ...cj.correos.filter((x) => x !== c)].slice(0, MAX_CORREOS_CUENTA);
    });
    if (VISTOS.size > 5000) VISTOS.clear();
    VISTOS.set(`${k}|${c}`, Date.now());
  } catch {
    /* S3 caído: se vuelve a intentar con el próximo pedido */
  }
}

/** Los correos anotados para una cuenta del puente (vacío si no se sabe o no se pudo leer). */
export async function duenosDeCuentaWA(cuenta: string): Promise<string[]> {
  const r = await cajon.leer(normal(cuenta)).catch(() => ({ ok: false as const }));
  return r.ok ? r.valor.correos : [];
}

/** Pruebas. */
export function _olvidarDuenosCuentaWA() {
  VISTOS.clear();
  cajon._olvidar();
}
