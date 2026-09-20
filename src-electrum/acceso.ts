/**
 * Cómo la pantalla de Dr Electrum demuestra quién es.
 *
 * Dos maneras, porque hay dos formas de llegar:
 *
 *  · **Sesión.** Quien ya entró a ULTRON con su correo lleva el token en el almacenamiento del
 *    navegador. Se reusa tal cual: la sesión es una sola, lo que cambia es a qué plataforma te
 *    deja entrar, y eso lo decide el padrón del servidor, no esta pantalla.
 *
 *  · **Llave de demostración.** Un enlace con `?llave=…` para enseñarle la plataforma a alguien
 *    sin crearle sesión. La llave se guarda y se limpia de la barra de direcciones en el acto:
 *    dejarla ahí es dejarla en el historial, en el título de una pestaña compartida y en cualquier
 *    captura de pantalla de la demo.
 *
 * Sin ninguna de las dos, el servidor contesta 401 y la pantalla lo dice. No hay modo invitado.
 */
const LLAVE = 'electrum_llave';

function guardado(k: string): string {
  try {
    return localStorage.getItem(k) || sessionStorage.getItem(k) || '';
  } catch {
    return '';
  }
}

/** Recoge `?llave=` del enlace, la guarda y la borra de la barra. Se llama una vez, al arrancar. */
export function recogerLlaveDelEnlace() {
  try {
    const u = new URL(window.location.href);
    const llave = u.searchParams.get('llave');
    if (!llave) return;
    try {
      localStorage.setItem(LLAVE, llave);
    } catch {
      sessionStorage.setItem(LLAVE, llave);
    }
    u.searchParams.delete('llave');
    window.history.replaceState({}, '', u.toString());
  } catch {
    /* sin URL utilizable */
  }
}

export function headersElectrum(): Record<string, string> {
  const h: Record<string, string> = {};
  const sesion = guardado('ultron_sesion_token');
  if (sesion) h['x-ultron-sesion'] = sesion;
  const llave = guardado(LLAVE);
  if (llave) h['x-electrum-llave'] = llave;
  return h;
}

/** Lo que se le dice a alguien al que el servidor no le abre. Sin jerga y sin culparlo. */
export const SIN_PUERTA =
  'Dr Electrum FP es privado y esta sesión no tiene acceso. Si sos de la junta, entrá primero en ULTRON con tu correo; si venís a ver la demostración, pedile a José el enlace con llave.';
