/**
 * QUÉ PRODUCTO ES ESTE DESPLIEGUE.
 *
 * Hasta ahora el mismo proceso servía las dos cosas: AU-RA FP en `/` y Dr Electrum en
 * `/electrum.html`. Cómodo para desarrollar y equivocado para vender. Son dos productos, con dos
 * públicos y dos puertas, y compartían tres cosas que no deberían:
 *
 *  1. **La dirección.** Quien abría el enlace de Dr Electrum aterrizaba en AU-RA FP.
 *  2. **La superficie de la API.** Un despliegue de Dr Electrum exponía `/api/ejecutar` —el ejecutor
 *     de código de AU-RA—, `/api/render/deploy`, `/api/taller` y `/api/vault/*`. Están detrás de
 *     permisos, sí; pero la mejor defensa de una ruta peligrosa es que no esté en ese servidor.
 *  3. **Los dos bots de Telegram** registrados desde el mismo proceso.
 *
 * Lo que SÍ se comparte, y está bien que se comparta, es la infraestructura: el nodo del modelo, el
 * de visión, el de voz. Son tuberías, no producto.
 *
 * Por defecto es **electrum**. No es una preferencia estética: el servicio que existe hoy en Render
 * es el de Dr Electrum, y un valor por defecto que hay que recordar poner acaba no puesto. AU-RA FP
 * pide su variable a propósito — es el que se mueve de casa.
 */
export type Plataforma = 'electrum' | 'ultron';

function leer(): Plataforma {
  const v = String(process.env.PLATAFORMA || '').trim().toLowerCase();
  if (v === 'ultron' || v === 'ultron-fp' || v === 'genesis') return 'ultron';
  return 'electrum';
}

export const PLATAFORMA: Plataforma = leer();
export const ES_ELECTRUM = PLATAFORMA === 'electrum';
export const ES_ULTRON = PLATAFORMA === 'ultron';

/** La página que se sirve en la raíz y en cualquier ruta que no sea de la API. */
export const PAGINA_RAIZ = ES_ELECTRUM ? 'electrum.html' : 'index.html';

/**
 * Lo que un despliegue de Dr Electrum deja pasar.
 *
 * Es una lista de PERMITIDOS, no de prohibidos. Una lista de prohibidos envejece mal: la ruta
 * peligrosa que alguien añada el mes que viene entra sola.
 *
 *  · `/api/electrum/*` — lo suyo.
 *  · `/api/health`     — para que Render sepa si está vivo.
 *  · La puerta         — entrar, salir y mirar la sesión. La sesión es una sola entre las dos
 *                        plataformas; a cuál te deja entrar lo decide el padrón del servidor.
 *  · `/api/cognitivo/*` — trazas, auditoría, reglas y aprobaciones. Cada despliegue sirve solo las
 *                        de su propia plataforma (server/cognitivo.ts).
 */
const PERMITIDO_EN_ELECTRUM = [
  /^\/api\/electrum(\/|$)/,
  /^\/api\/health(\/|$)/,
  /^\/api\/ultron\/(entrar|salir|sesion|biometric-login)(\/|$)/,
  /^\/api\/cognitivo(\/|$)/,
];

/**
 * Y al revés: un despliegue de AU-RA FP tampoco sirve el catastro.
 *
 * La simetría no es simetría por elegancia. Si «son separados» solo valiera en una dirección,
 * AU-RA FP seguiría cargando las rutas de los expedientes mineros y su base de datos, y en el
 * primer susto habría que explicar por qué la plataforma de la junta tiene dentro el padrón de
 * concesiones.
 */
const PROHIBIDO_EN_ULTRON = [/^\/api\/electrum(\/|$)/];

export function rutaPermitida(camino: string): boolean {
  if (ES_ULTRON) return !PROHIBIDO_EN_ULTRON.some((re) => re.test(camino));
  return PERMITIDO_EN_ELECTRUM.some((re) => re.test(camino));
}
