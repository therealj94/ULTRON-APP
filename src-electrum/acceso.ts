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
const SESION = 'ultron_sesion_token';

/**
 * EL TERCER ALMACÉN: la memoria.
 *
 * Hay navegadores donde `localStorage` y `sessionStorage` lanzan los dos: ventana privada con
 * almacenamiento bloqueado, políticas de empresa, un iframe sin permiso. El código anterior probaba
 * el segundo dentro del `catch` del primero **sin protegerlo**, así que cuando fallaban los dos la
 * excepción salía disparada y dejaba la pantalla de entrada colgada con el botón deshabilitado para
 * siempre: ni entraba ni decía por qué.
 *
 * Con este respaldo, la credencial vale al menos para esta carga de página. No sobrevive a un F5, y
 * eso se le dice — pero se entra, que es lo que la persona vino a hacer.
 */
const enMemoria = new Map<string, string>();

/** Dónde acabó quedando. `ninguno` no existe: siempre queda al menos en memoria. */
export type Donde = 'local' | 'sesion' | 'memoria';

function guardar(k: string, v: string): Donde {
  try {
    localStorage.setItem(k, v);
    return 'local';
  } catch {
    /* sigue */
  }
  try {
    sessionStorage.setItem(k, v);
    return 'sesion';
  } catch {
    /* sigue */
  }
  enMemoria.set(k, v);
  return 'memoria';
}

function guardado(k: string): string {
  /*
   * Cada almacén con su propio try. Encadenarlos en un `||` dentro de un solo try parece lo mismo y
   * no lo es: si el primero LANZA, la expresión entera revienta y el segundo no se llega a leer. Un
   * navegador que bloquea `localStorage` pero permite `sessionStorage` —que los hay— perdía así la
   * credencial que sí estaba guardada. Lo encontró una prueba, no un usuario, que es como hay que
   * encontrar estas cosas.
   */
  try {
    const v = localStorage.getItem(k);
    if (v) return v;
  } catch {
    /* sigue */
  }
  try {
    const v = sessionStorage.getItem(k);
    if (v) return v;
  } catch {
    /* sigue */
  }
  return enMemoria.get(k) || '';
}

/** ¿El navegador deja guardar algo que sobreviva a recargar? Sirve para avisar, no para bloquear. */
export function almacenamientoFragil(): boolean {
  try {
    const p = '__electrum_prueba__';
    localStorage.setItem(p, '1');
    localStorage.removeItem(p);
    return false;
  } catch {
    try {
      const p = '__electrum_prueba__';
      sessionStorage.setItem(p, '1');
      sessionStorage.removeItem(p);
      return false;
    } catch {
      return true;
    }
  }
}

/** Recoge `?llave=` del enlace, la guarda y la borra de la barra. Se llama una vez, al arrancar. */
export function recogerLlaveDelEnlace() {
  try {
    const u = new URL(window.location.href);
    const llave = u.searchParams.get('llave');
    if (!llave) return;
    guardar(LLAVE, llave);
    u.searchParams.delete('llave');
    window.history.replaceState({}, '', u.toString());
  } catch {
    /* sin URL utilizable */
  }
}

export function headersElectrum(): Record<string, string> {
  const h: Record<string, string> = {};
  const sesion = guardado(SESION);
  if (sesion) h['x-ultron-sesion'] = sesion;
  const llave = guardado(LLAVE);
  if (llave) h['x-electrum-llave'] = llave;
  return h;
}

/** Lo que se le dice a alguien al que el servidor no le abre. Sin jerga y sin culparlo. */
export const SIN_PUERTA =
  'Dr Electrum FP es privado y esta sesión no tiene acceso. Si sos de la junta, entrá primero en ULTRON con tu correo; si venís a ver la demostración, pedile a José el enlace con llave.';

/** Guarda el token de sesión que devuelve ULTRON al entrar. Lo comparten las dos plataformas. */
export function guardarSesion(token: string): Donde {
  return guardar(SESION, token);
}

/** Guarda la llave de demostración. Devuelve dónde quedó, para poder avisar si fue en memoria. */
export function guardarLlave(llave: string): Donde {
  return guardar(LLAVE, llave);
}

/**
 * Cerrar la sesión en este navegador.
 *
 * Borra las dos credenciales de los tres sitios donde pueden estar. **Cierra también la de ULTRON**,
 * porque es la misma: el token se comparte entre las dos plataformas y fingir que son dos sesiones
 * sería dejar una abierta creyendo que se cerró.
 */
export function salir() {
  for (const k of [SESION, LLAVE]) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* sigue */
    }
    try {
      sessionStorage.removeItem(k);
    } catch {
      /* sigue */
    }
    enMemoria.delete(k);
  }
}

/** ¿Llevamos encima algo con lo que llamar a la puerta? No dice si vale: eso lo dice el servidor. */
export function hayCredencial(): boolean {
  return Boolean(guardado(SESION) || guardado(LLAVE));
}

/**
 * Lo que puede contestar la puerta.
 *
 * Son cinco cosas distintas y antes eran un booleano. La distinción no es cosmética: solo una de
 * las cinco —`sin-permiso`— se le puede reprochar a la credencial. Las otras cuatro son la red o la
 * plataforma, y presentarlas como un problema de acceso manda a la persona a pedir una llave nueva
 * que no va a arreglar nada.
 */
export type Puerta =
  /** Abre. */
  | { estado: 'abierta' }
  /** El servidor contestó, y dijo que no. Es lo ÚNICO que se le puede reprochar a la credencial. */
  | { estado: 'sin-permiso' }
  /** El servidor contestó mal: está caído, redesplegando, o roto. No es culpa de quien entra. */
  | { estado: 'servicio-caido'; codigo: number }
  /** No hubo respuesta: sin conexión, DNS caído, o el servidor no está. */
  | { estado: 'sin-red' }
  /** Contestar tardó más de lo razonable. En el campo pasa, y no significa que no tengas permiso. */
  | { estado: 'lento' };

/**
 * Pregunta al servidor si esta credencial abre Electrum.
 *
 * Se pregunta de verdad en vez de mirar solo si hay un token guardado: un token caducado, o el de
 * alguien que entró a ULTRON pero no está en el padrón de Electrum, se ve igual desde el navegador
 * y solo el servidor sabe la diferencia. Antes se descubría al primer mensaje, con la pantalla ya
 * montada y la conversación contestando que no hay acceso.
 */
export async function puertaAbierta(): Promise<Puerta> {
  /*
   * Sin tope, esta llamada puede quedarse colgada indefinidamente y con ella la pantalla de entrada:
   * la comprobación no tenía ninguno. Doce segundos es de sobra para un `salud` y poco para que
   * alguien se pregunte si se rompió.
   */
  const corte = new AbortController();
  const reloj = setTimeout(() => corte.abort(), 12_000);
  try {
    const r = await fetch('/api/electrum/salud', { headers: headersElectrum(), signal: corte.signal });
    if (r.ok) return { estado: 'abierta' };
    if (r.status === 401 || r.status === 403) return { estado: 'sin-permiso' };
    return { estado: 'servicio-caido', codigo: r.status };
  } catch (e: any) {
    /*
     * ESTE ERA EL PUNTO DE F08. Antes todo esto devolvía `false`, y `false` se le enseñaba a la
     * persona como «tu cuenta no tiene acceso» o «esa llave no abre». O sea que un túnel, un wifi de
     * hotel o un servidor redesplegando se le contaban como un problema de permisos, y la reacción
     * natural —pedirle a José otra llave— no arreglaba nada.
     */
    return e?.name === 'AbortError' ? { estado: 'lento' } : { estado: 'sin-red' };
  } finally {
    clearTimeout(reloj);
  }
}

/** Lo que se le dice a la persona según lo que contestó la puerta. Sin jerga y sin acusarla. */
export function porQueNoAbre(p: Puerta, cual: 'sesion' | 'llave'): string {
  switch (p.estado) {
    case 'sin-permiso':
      return cual === 'llave'
        ? 'Esa llave no abre. Pedile a José la vigente.'
        : 'Entraste en ULTRON, pero tu cuenta no tiene acceso a Dr Electrum FP. Pedíselo a José.';
    case 'servicio-caido':
      return `El servidor contestó ${p.codigo}. No es tu credencial: es la plataforma. Probá de nuevo en un momento.`;
    case 'lento':
      return 'El servidor tardó más de doce segundos en contestar. Puede ser tu conexión o la plataforma despertando. Volvé a intentarlo.';
    case 'sin-red':
      return 'No alcancé el servidor. Revisá la conexión y volvé a intentarlo — tu credencial no tiene nada que ver.';
    default:
      return '';
  }
}
