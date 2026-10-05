/**
 * ¿Lo que se pidió en la mesa sale del sistema? Mandar por Telegram, WhatsApp o correo, avisar
 * urgente a la junta, una nota de voz o una llamada: antes se hacían en cuanto el taller las
 * reconocía (lib/taller.ts). Ahora la mesa enseña primero una tarjeta con destinatario, contenido y
 * hora, y el turno solo sale al servidor cuando la persona pulsa Confirmar. Desde la revisión 10 (MEDIO-C) el servidor
 * tampoco lo ejecuta desde el turno: devuelve una propuesta (`propuestaTaller`) y el Confirmar aprueba ESA decisión
 * (`coincideConServidor`), así que la app o un POST directo tampoco se la saltan.
 *
 * El reconocimiento copia el orden de `parsePedido` del taller (lo que no es un envío allí no puede
 * ser una tarjeta aquí); tests/aura-web-trabajo.test.ts compara los dos con las mismas frases para
 * que no se separen. El destinatario sale de cómo trabaja el taller: manda solo a los canales
 * propios configurados de la junta; desde el chat no se le puede dar un destinatario arbitrario.
 */

export type TipoAccion = 'enviar' | 'urgente' | 'nota-voz' | 'llamar';
export type CanalAccion = 'telegram' | 'whatsapp' | 'correo' | 'telefono';

export type AccionSensible = {
  tipo: TipoAccion;
  canal: CanalAccion;
  /** Qué se va a hacer, en una línea. */
  titulo: string;
  /** A quién le llega, como lo configura el servidor. */
  destinatario: string;
  /** Lo que se manda o se dice, como lo entendió la mesa. */
  contenido: string;
};

const plegar = (s: string) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

function canalDe(l: string): 'telegram' | 'whatsapp' | 'correo' | null {
  if (/telegram|tg\b/.test(l)) return 'telegram';
  if (/whats?app|\bwsp\b|\bwa\b/.test(l)) return 'whatsapp';
  if (/correo|email|gmail|mail\b/.test(l)) return 'correo';
  return null;
}

/** El mismo recorte que hace el taller para quedarse con el cuerpo del mensaje. */
export function cuerpoDe(q: string): string {
  return q
    .replace(/^(env[ií]a|manda|m[aá]ndame|mandale|haz un pdf|genera(r)? (un )?pdf|pdf de|por telegram|por whatsapp|por correo|ll[aá]mame[,:]?|avisame urgente|avísame urgente|urgente)\s*/i, '')
    .replace(/\b(por|a|al|en)\s+(telegram|whatsapp|wsp|correo|email|gmail)\b/gi, '')
    .replace(/\b(un )?pdf\b/gi, '')
    .trim();
}

const DESTINO: Record<CanalAccion, string> = {
  telegram: 'Grupo de Telegram de la junta (el chat configurado en el servidor)',
  whatsapp: 'WhatsApp de la junta (el número configurado en el servidor)',
  correo: 'Correo de la organización (la dirección configurada en el servidor)',
  telefono: 'Teléfono de la junta configurado en el servidor (llamada de Twilio)',
};

const NOMBRE: Record<'telegram' | 'whatsapp' | 'correo', string> = { telegram: 'Telegram', whatsapp: 'WhatsApp', correo: 'correo' };

/**
 * ¿Pide solo LEER el correo? (revisión 10, MENOR-D; la misma regla que `soloLeeCorreo` de lib/taller.ts). Leer, buscar,
 * abrir, revisar o enseñar correos —o preguntar si hay— sin un verbo que mande, avise o llame no sale del sistema: «Lee
 * los correos marcados como urgente» no es un aviso urgente ni «busca el correo con el PDF» un envío. `l`: plegado.
 */
export function soloLeeCorreo(l: string): boolean {
  if (!/\b(correos?|e-?mails?|mails?|gmail|bandeja|inbox)\b/.test(l)) return false;
  const lee = /\b(lee(?:me|r)?|lea|busca(?:me|r)?|encuentra(?:me)?|muestra(?:me)?|ensena(?:me)?|abre(?:me)?|revisa(?:me|r)?|resume(?:me)?|tengo|hay|cuantos|cuales)\b/.test(l);
  const sale = /\b(envia(?:me|le|lo|la|r)?|manda(?:me|le|lo|la|r)?|reenvia\w*|avisa(?:me|le|nos|r)?|alerta|notifica\w*|llama(?:me|nos|le|r)?|haz una llamada|hacer una llamada|call me)\b/.test(l);
  return lee && !sale;
}

/** La tarjeta que corresponde a lo pedido, o null si no sale nada del sistema. */
export function accionSensibleDe(raw: string): AccionSensible | null {
  const q = String(raw || '').trim();
  if (!q) return null;
  const l = plegar(q);
  const canal = canalDe(l);
  const lee = soloLeeCorreo(l);
  // Lo que el taller decide antes que un envío: bóveda, redespliegue, mantenimiento. No son tarjetas.
  if (/\b(boveda|cajas de (la )?boveda|abri la boveda|abre la boveda)\b/.test(l)) return null;
  if (/\b(redeploy|redespl(?:ie|ié|e)g\w*|reinicia(r)? la mesa|nuevo deploy)\b/.test(l)) return null;
  // Nota de voz con el estado del sistema: sale por Telegram (lib/voz.ts, pideNotaDeVoz).
  if (/\b(nota de voz|audio del sistema|voz del sistema|\/audio\b)\b/.test(l) || (/\b(audio|nota de voz)\b/.test(l) && /\b(manda|envia|sistema|nodos|salud|estado|contesta)\b/.test(l))) {
    return {
      tipo: 'nota-voz',
      canal: 'telegram',
      titulo: 'Mandar una nota de voz con el estado del sistema',
      destinatario: DESTINO.telegram,
      contenido: 'El estado de los nodos, dicho con la voz de AU-RA.',
    };
  }
  if (/\b(mantenimiento|repara|arregla|diagnostico|diagnóstico)\b/.test(l)) return null;
  if (/\b(como esta|cómo está)\s+(el |la |los )?(sistema|mesa|servidor|plataforma|cerebro|nodos?|todo)\b|\b(estado del sistema|los nodos|salud del sistema|que nodos)\b/.test(l) || /^(status|salud)\b/.test(l)) return null;
  if (!lee && (/\b(envia|envía|manda|mandale|mandame|mándame)\b/.test(l) || (canal && /\bpdf\b/.test(l)))) {
    // Sin canal el taller no manda nada («No supe el canal»): no hay nada que autorizar.
    if (!canal) return null;
    const pdf = /\bpdf\b/.test(l);
    return {
      tipo: 'enviar',
      canal,
      titulo: `Mandar ${pdf ? 'un PDF' : 'un mensaje'} por ${NOMBRE[canal]}`,
      destinatario: DESTINO[canal],
      contenido: cuerpoDe(q) || 'Una nota de AU-RA con la hora de envío.',
    };
  }
  if (/\b(haz un pdf|genera(?:r)? (un )?pdf|pdf de)\b/.test(l)) return null;
  if (!lee && (/\b(urgente|avisame|alerta junta)\b/.test(l) || (canal === 'telegram' && /\b(llama(?:me|nos)?|ll[aá]mame|llamanos)\b/.test(l)))) {
    return {
      tipo: 'urgente',
      canal: 'telegram',
      titulo: 'Avisar urgente a la junta',
      destinatario: `${DESTINO.telegram}, como aviso urgente`,
      contenido: cuerpoDe(q) || 'AU-RA te necesita. Es urgente.',
    };
  }
  if (!lee && /\b(llama(?:me)?|ll[aá]mame|haz una llamada|hacer una llamada|call me)\b/.test(l)) {
    return {
      tipo: 'llamar',
      canal: 'telefono',
      titulo: 'Hacer una llamada',
      destinatario: DESTINO.telefono,
      contenido: cuerpoDe(q) || 'Hola, te llama AU-RA.',
    };
  }
  return null;
}

/**
 * Lo que el servidor dejó esperando aprobación (`propuestaTaller` del turno, lib/taller.ts; revisión 10, MEDIO-C). Con
 * su tarea, su decisión y su versión se aprueba (POST /api/trabajos/:tarea/decisiones), una sola vez.
 */
export type PropuestaServidor = {
  tarea: string;
  decision: string;
  version: number;
  caduca: number;
  accion: string;
  canal: string;
  titulo: string;
  destinatario: string;
  contenido: string;
};

/** La acción del taller que corresponde a cada tarjeta. */
const ACCION_DEL_TALLER: Record<TipoAccion, string> = { enviar: 'enviar', urgente: 'urgente', llamar: 'llamada', 'nota-voz': 'voz_estado' };

/** ¿La propuesta llegó bien formada? (un servidor de antes no la manda; una rara no se aprueba). */
export function propuestaValida(x: unknown): x is PropuestaServidor {
  const p = x as PropuestaServidor;
  return !!p && typeof p === 'object' && typeof p.tarea === 'string' && !!p.tarea && typeof p.decision === 'string' && !!p.decision && Number.isFinite(p.version) && typeof p.accion === 'string' && typeof p.canal === 'string' && typeof p.contenido === 'string';
}

/**
 * ¿Lo que propone el servidor es EXACTAMENTE lo que la persona vio en la tarjeta y confirmó? La misma acción, el mismo
 * canal y el mismo contenido (la nota de voz no tiene contenido escrito: su texto lo dicta el servidor al mandarla). Solo
 * entonces el «Confirmar y enviar» que ya pulsó aprueba esa decisión; si no, la tarjeta enseña lo del servidor y pide
 * confirmar otra vez.
 */
export function coincideConServidor(a: AccionSensible, p: PropuestaServidor): boolean {
  if (ACCION_DEL_TALLER[a.tipo] !== p.accion || a.canal !== p.canal) return false;
  if (a.tipo === 'nota-voz') return true;
  const norma = (s: string) => plegar(s).replace(/\s+/g, ' ').trim();
  return norma(a.contenido) === norma(p.contenido);
}

export type Resultado = { estado: 'hecha' | 'fallida' | 'espera' | 'sin-confirmar'; resumen: string };

/**
 * Qué pasó, según lo que contestó el servidor. Solo se da por hecho lo que el canal confirmó
 * («enviado», «aceptado», «iniciada»); lo que no se entiende queda «sin confirmar», nunca «hecho».
 */
export function resultadoDe(respuesta: string, error?: string): Resultado {
  const t = String(respuesta || '').trim();
  if (error === 'sesión requerida') return { estado: 'fallida', resumen: 'No se hizo: necesita tu sesión de junta.' };
  // Sin respuesta (se cortó la red, se interrumpió el turno) no se sabe si el servidor lo hizo.
  if (error === 'interrumpido') return { estado: 'sin-confirmar', resumen: 'El turno se interrumpió antes de saber el resultado: puede que se haya hecho o no.' };
  if (!t) return { estado: 'sin-confirmar', resumen: 'No llegó respuesta del servidor: no sé si se hizo.' };
  if (/EN ESPERA DE APROBACI[OÓ]N/i.test(t)) return { estado: 'espera', resumen: 'Todavía no se hizo: espera la aprobación de la junta.' };
  if (/NO EJECUTADO|no envi[eé]|no llam[eé]|no mand[eé]|\bfalta\b|no supe el canal|no lo hago|necesita tu sesi[oó]n|\b(telegram|twilio|resend)\s+[45]\d\d\b/i.test(t)) return { estado: 'fallida', resumen: t };
  // «El mensaje no fue enviado», «no se pudo enviar», «falló el envío»: la palabra «enviado» con un «no»
  // delante no es un recibo (auditoría de Codex del 3-oct: se mostraba «Hecho»).
  if (/\bno\s+(fue|ha\s+sido|se\s+ha|est[aá]|qued[oó]|pude|se\s+pudo|logr[eé])\b|\bfall[oóa]\w*|\berror\b|rechazad[oa]|no\s+(se\s+)?(envi|mand|llam|inici)\w*/i.test(t)) return { estado: 'fallida', resumen: t };
  if (/\b(enviad[oa]|aceptad[oa]|iniciada)\b/i.test(t)) return { estado: 'hecha', resumen: t };
  return { estado: 'sin-confirmar', resumen: t };
}
