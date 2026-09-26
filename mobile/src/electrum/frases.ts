/**
 * LO QUE SE LE DICE A LA PERSONA CUANDO ALGO FALLA.
 *
 * Antes la pantalla enseñaba lo que traía el error: «Network request failed», «Error 502»,
 * «speech-timeout». Eso es para quien depura, no para quien está en un cerro con una raya de
 * señal. Acá se traduce cada caso a una frase que diga QUÉ pasó y QUÉ hacer, sin acusar a la
 * credencial de lo que hizo el wifi. El detalle técnico no se pierde: quien llama lo deja en
 * `console.warn`.
 *
 * Este archivo no importa nada —ni React Native ni Expo— a propósito: así las frases se prueban
 * con node:test desde `tests/`, sin teléfono ni emulador.
 */

/** 401 de la puerta: la credencial ya no abre Dr Electrum. */
export class SinPuerta extends Error {
  constructor() {
    super('Dr Electrum FP es privado y esta sesión no tiene acceso.');
    this.name = 'SinPuerta';
  }
}

/**
 * El servidor contestó, pero no un 2xx. Se guarda el código para poder distinguir «caído» de «no
 * te deja» y el `error` que mandó el servidor, que en las rutas de Electrum ya viene en castellano.
 */
export class ErrorHttp extends Error {
  readonly status: number;
  readonly detalle: string;
  constructor(status: number, detalle = '') {
    super(detalle || `HTTP ${status}`);
    this.name = 'ErrorHttp';
    this.status = status;
    this.detalle = detalle;
  }
}

/**
 * Lo que puede contestar la puerta. Son cinco cosas y antes eran «entró / no entró».
 *
 * La distinción importa sobre todo en el campo: **solo `sin-permiso` significa que la credencial
 * no vale**. Las otras cuatro son la red o la plataforma, y tratarlas como falta de acceso echaba
 * al usuario a la pantalla de entrada cada vez que se quedaba sin señal — justo cuando menos puede
 * ponerse a escribir una clave.
 */
export type Puerta =
  | { estado: 'abierta' }
  | { estado: 'sin-permiso' }
  | { estado: 'servicio-caido'; codigo: number }
  | { estado: 'sin-red' }
  | { estado: 'lento' };

const SIN_RED = 'No alcancé el servidor. Revisá la señal y volvé a intentarlo — tu credencial no tiene nada que ver.';
const CAIDO = 'El servidor no está disponible ahora (puede estar arrancando). No es tu credencial ni tu señal: es la plataforma. Probá en un minuto.';

/** Lo que se le dice a la persona. Sin jerga y sin acusar a su credencial de lo que hizo el wifi. */
export function porQueNoAbre(p: Puerta): string {
  switch (p.estado) {
    case 'sin-permiso':
      return 'Esa credencial es buena pero no tiene acceso a Dr Electrum. Pedile a José que te agregue al padrón.';
    case 'servicio-caido':
      // El número (502, 503…) va al registro, no a la pantalla: a quien está en el campo no le dice nada.
      return CAIDO;
    case 'lento':
      return 'El servidor tardó más de doce segundos. Puede ser la señal de donde estás. Volvé a intentarlo.';
    case 'sin-red':
      return SIN_RED;
    default:
      return '';
  }
}

/**
 * Una credencial de consulta —la llave de demostración, o alguien con nivel `lee`— no puede
 * cargarle nada al cerebro (`/api/electrum/subir` contesta 403). Se dice ANTES de abrir la cámara:
 * descubrirlo después de encuadrar el papel y subir cuatro megas con una raya de señal es peor.
 */
export const SIN_NIVEL_PARA_CARGAR =
  'Con tu acceso de consulta podés preguntarme todo, pero no cargarle fotos al expediente. Si necesitás cargar, pedile a José nivel de trabajo.';

/** Qué se estaba haciendo cuando falló: cambia el arranque de la frase y cómo se lee un 401. */
export type Intento = 'contestar' | 'foto' | 'camara' | 'informe' | 'ubicacion' | 'entrar';

const ARRANQUE: Record<Intento, string> = {
  contestar: 'No pude contestarte.',
  foto: 'No pude subir la foto.',
  // Sacar la foto es otra cosa que subirla: si falla la cámara, decir «no pude subir» manda a
  // revisar la señal cuando el problema está en el teléfono.
  camara: 'No pude tomar la foto.',
  informe: 'No pude guardar el informe.',
  ubicacion: 'No pude fijar tu posición.',
  entrar: 'No pude entrar.',
};

function textoDe(e: unknown): string {
  if (e && typeof e === 'object') {
    const o = e as { message?: unknown; code?: unknown };
    return `${String(o.code ?? '')} ${String(o.message ?? '')}`.trim();
  }
  return String(e ?? '');
}

function nombreDe(e: unknown): string {
  return e && typeof e === 'object' ? String((e as { name?: unknown }).name ?? '') : '';
}

/** Se cortó la petición por tiempo: el `AbortController` de `conTope` o un timeout del sistema. */
function esTiempo(e: unknown): boolean {
  return nombreDe(e) === 'AbortError' || /\babort(ed)?\b|timed? ?out|timeout/i.test(textoDe(e));
}

/** No hubo red: el `fetch` de React Native rechaza con TypeError('Network request failed'). */
function esSinRed(e: unknown): boolean {
  return /network request failed|failed to fetch|network ?error|networkerror|internet|offline|net::/i.test(textoDe(e));
}

/** Los fallos de expo-location, que vienen con códigos y mensajes en inglés. */
function fraseDeUbicacion(e: unknown): string | null {
  const t = textoDe(e);
  if (/unauthori[sz]ed|not authori[sz]ed|permission/i.test(t)) {
    return 'No tengo permiso de ubicación. Activalo en los ajustes del teléfono, o pedime el catastro por nombre de concesión.';
  }
  if (/services? (are )?(disabled|enabled)|services_disabled|settings|unavailable|unknown/i.test(t)) {
    return 'El GPS está apagado o no encuentra satélites. Encendé la ubicación del teléfono y, si estás bajo techo o entre árboles, probá en un claro.';
  }
  if (/cancel/i.test(t)) return 'Se cortó la búsqueda de posición. Tocá «¿Dónde estoy?» otra vez.';
  if (esTiempo(e)) return 'El GPS tardó demasiado en fijar la posición. Probá en un lugar más abierto.';
  return null;
}

/**
 * La frase para un error cualquiera de la app del doctor.
 *
 * Distingue lo que a la persona le cambia qué hacer: sin señal (revisá la cobertura), servidor
 * caído (esperá, no es tuyo), sin acceso (volvé a entrar / pedí nivel), tardó demasiado (probá de
 * nuevo), y en la ubicación, permiso y GPS apagado.
 */
export function fraseDeError(e: unknown, intento: Intento = 'contestar'): string {
  const arranque = ARRANQUE[intento];

  if (e instanceof SinPuerta) return 'Esta sesión ya no tiene acceso a Dr Electrum. Volvé a entrar.';

  if (e instanceof ErrorHttp) {
    const { status, detalle } = e;
    if (status === 401 || status === 403) {
      // En la puerta de entrada un 401 es «correo o clave mal», no «tu sesión caducó». Y la frase es
      // de acá, no del servidor: ese rechazo lo reenvía tal cual desde el cerebro remoto.
      if (intento === 'entrar') {
        return 'El servidor no aceptó ese correo con esa clave. Revisalos y probá de nuevo; si están bien, pedile a José que te dé de alta.';
      }
      // Un 403 dentro es de NIVEL (una llave de consulta que quiere cargar una foto): el servidor
      // manda el porqué en castellano, y es mejor que cualquier frase genérica de acá.
      return detalle || 'Tu acceso no alcanza para esto. Pedile a José que te suba el nivel.';
    }
    // El freno de la entrada dice cuánto esperar («Probá de nuevo en 5 minutos») y eso vale más que
    // un genérico; el freno general solo dice «demasiadas peticiones», que no aporta nada.
    if (status === 429) return /\d/.test(detalle) ? detalle : 'Fueron muchos pedidos seguidos. Esperá un minuto y probá de nuevo.';
    if (status === 408 || status === 504) return `${arranque} El servidor tardó demasiado en contestar. Probá de nuevo en un momento.`;
    if (status === 502 || status === 503) return `${arranque} ${CAIDO}`;
    if (status >= 500) return `${arranque} El servidor tuvo un problema de su lado — no es tu señal ni tu credencial. Probá de nuevo en un momento.`;
    // El resto de 4xx: las rutas de Electrum explican el motivo («La foto es muy pesada…»).
    return detalle ? `${arranque} ${detalle}` : `${arranque} El servidor no aceptó el pedido. Probá de nuevo; si se repite, avisale a José.`;
  }

  if (intento === 'ubicacion') {
    const f = fraseDeUbicacion(e);
    if (f) return f;
  }

  if (esTiempo(e)) return `${arranque} El servidor tardó demasiado en contestar. Puede ser la señal de donde estás: volvé a intentarlo.`;
  if (esSinRed(e)) return `${arranque} ${SIN_RED}`;

  if (intento === 'ubicacion') return 'No pude fijar tu posición. Revisá que la ubicación del teléfono esté encendida y probá de nuevo.';
  return `${arranque} Algo falló de este lado. Probá de nuevo; si se repite, avisale a José.`;
}

/**
 * La frase para un código del reconocedor de voz (expo-speech-recognition). `null` = no avisar.
 *
 * «aborted» es que se cortó a propósito y «no-speech» es soltar el botón sin haber dicho nada: ni
 * uno ni otro son fallos que merezcan un diálogo.
 */
export function fraseDeDictado(codigo: string): string | null {
  switch (codigo) {
    case 'aborted':
    case 'no-speech':
      return null;
    case 'speech-timeout':
      return 'No te oí decir nada. Tocá el micrófono y hablá cerca del teléfono.';
    case 'not-allowed':
      return 'Sin permiso de micrófono no puedo oírte. Activalo en los ajustes del teléfono.';
    case 'service-not-allowed':
      return 'El teléfono no me deja usar su reconocimiento de voz. Revisá los permisos de micrófono y de voz en los ajustes.';
    case 'network':
      return 'El dictado necesita señal y ahora no hay. Escribime la pregunta, o probá cuando vuelva la cobertura.';
    case 'audio-capture':
      return 'No pude usar el micrófono: puede que otra app lo tenga ocupado.';
    case 'busy':
    case 'too-many-requests':
      return 'El reconocimiento de voz está ocupado. Esperá un segundo y tocá el micrófono otra vez.';
    case 'language-not-supported':
      return 'Este teléfono no reconoce voz en español. Escribime la pregunta.';
    case 'interrupted':
      return 'Se cortó el dictado (una llamada o una alarma). Tocá el micrófono otra vez.';
    default:
      return 'El dictado falló. Tocá el micrófono otra vez, o escribime la pregunta.';
  }
}
