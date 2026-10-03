/**
 * CÓMO QUIERE QUE LE LLAMEN. José (2-oct): «tratar de preguntar cómo quiere que le llame y recordar eso».
 *
 * La primera vez en la app ya se pregunta (mobile/src/primeravez, PasoApodo). Pero hay quien entra por la
 * web, por Windows o por la voz, o se saltó esa pantalla: su perfil tiene un apodo de relleno (su primer
 * nombre o «amigo»). Entonces:
 *   · el turno le pide a AURA que lo pregunte, una vez y con naturalidad (lineaApodoPendiente);
 *   · lo que conteste se reconoce aquí, sin modelo (detectarApodo): una orden clara («llámame Chepe»,
 *     «mi apodo es Chepe») en cualquier momento, o una respuesta corta («Chepe», «José está bien») justo
 *     después de que AURA lo preguntó;
 *   · se guarda en el perfil (lib/perfil-persona.ts, `apodoElegido`) y el turno ya lo usa.
 * Con el teléfono conectado, la mano `perfil` (lib/manos-app.ts) también lo guarda desde la app: es el
 * mismo dato, guardarlo dos veces no hace daño.
 */
import { actualizarPerfil, aplicarCambios, MAX_APODO, perfilInicial, type Perfil } from './perfil-persona';

type Msg = { role: 'user' | 'assistant'; content: string };

/** ¿Falta saber cómo quiere que le digan? Sin perfil, o con el apodo de relleno (ni lo eligió ni terminó la primera vez). */
export function apodoPendiente(p: Perfil | null | undefined): boolean {
  return !p || (!p.completado && !p.apodoElegido);
}

const plegar = (s: string) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Lo que dijo AURA ¿era preguntarle cómo quiere que le llame? */
export function preguntoApodo(textoAura: string): boolean {
  const q = plegar(textoAura);
  return (
    /como (quieres|prefieres|te gusta|te gustaria|deseas) que te (llame|diga|digamos|nombre)/.test(q) ||
    /como te (llamo|digo)\b/.test(q) ||
    /what (should|would you like me to|do you want me to) call you|how should i (call|address) you/.test(q)
  );
}

/** Palabras que no son un nombre (respuestas a medias, muletillas, cortesías). */
const NO_NOMBRE = new Set(
  'si no nada como quieras quieres cualquiera igual da lo que sea ok okay vale bueno pues mmm eh ah este esta bien gracias favor nombre apodo mi me te yo tu ya claro sale dale hola adios ninguno ninguna nadie ese eso asi solo simplemente normal yes no sure fine thanks please whatever anything call my name is'.split(' ')
);

/** Lo que va antes o después del nombre en una respuesta corta y no es parte de él. */
const RELLENO_ANTES =
  /^(?:(?:pues|bueno|mmm+|eh+|ah+|este|ok|okay|ya|claro|mira|hola)[,\s]+)*(?:(?:de ahora en adelante|desde ahora|a partir de ahora)\s+)?(?:(?:me puedes|puedes|podes|me podes|quiero que me|prefiero que me|me gusta que me)\s+)?(?:llamame|llamarme|dime|decime|decirme|digas|diga|llames|me dicen|dicen|me llaman|mi apodo es|mi nombre es|me llamo|soy|call me|my name is|i'm|im)?\s*/;
const RELLENO_DESPUES = /[,\s]+(?:esta bien|por favor|nada mas|solamente|solo|gracias|nomas|please|is fine|thanks)\s*$/;

function capitalizar(s: string) {
  return s
    .split(' ')
    .map((w) => (w ? w[0].toLocaleUpperCase('es') + w.slice(1) : w))
    .join(' ');
}

/** El nombre dicho, copiado del original (con sus tildes), o null si no parece un nombre. */
function nombreDe(original: string, plegado: string): string | null {
  const p = plegado.trim();
  if (!p) return null;
  const palabras = p.split(/\s+/);
  if (palabras.length > 3 || palabras.some((w) => !/^[a-zñ'-]{2,20}$/.test(w) || NO_NOMBRE.has(w))) return null;
  // Se copia del original la misma cantidad de palabras finales (plegar no cambia el largo de las palabras).
  const orig = original.normalize('NFC').replace(/[.!¡¿?,;:"«»“”]+/g, ' ').trim().split(/\s+/);
  const tomadas = orig.slice(Math.max(0, orig.length - palabras.length));
  const v = capitalizar(tomadas.join(' ')).slice(0, MAX_APODO).trim();
  return v.length >= 2 ? v : null;
}

/**
 * El apodo que dijo la persona en este mensaje, o null.
 *  · En cualquier momento, solo una orden inequívoca: «llámame Chepe», «mi apodo es Chepe», «de ahora en
 *    adelante dime Chepe», «call me Joe». («dime algo» no: «dime» también es «cuéntame»; vale solo con
 *    el nombre en mayúscula o con «de ahora en adelante»).
 *  · Si AURA acaba de preguntarlo (`preguntado`), también una respuesta corta: «Chepe», «Pepe, por
 *    favor», «José está bien», «dime Jefe». «Como quieras» o «no sé» no son un nombre.
 */
export function detectarApodo(mensaje: string, o: { preguntado?: boolean } = {}): string | null {
  const original = String(mensaje || '').replace(/\s+/g, ' ').trim();
  if (!original || original.length > 80) return null;
  const q = plegar(original).replace(/[.!¡¿?,;:"«»“”]+/g, ' ').replace(/\s+/g, ' ').trim();
  // Una orden clara, con su verbo.
  const orden =
    /^(?:(?<fijo>de ahora en adelante|desde ahora|a partir de ahora) )?(?:(?:me puedes|puedes|quiero que me|prefiero que me) )?(?<verbo>llamame|dime|decime|digas|decirme|llames|call me) (?<v>[a-zñ'-]+(?: [a-zñ'-]+)?)$/.exec(q) ||
    /^(?:mi apodo es|me dicen|todos me dicen|me gusta que me digan|prefiero que me digan|my nickname is) (?<v>[a-zñ'-]+(?: [a-zñ'-]+)?)$/.exec(q);
  if (orden?.groups?.v) {
    const verbo = orden.groups.verbo || '';
    // «dime cómo…», «dime algo»: solo vale con el nombre en mayúscula o con «de ahora en adelante».
    const nombreOriginal = original.split(' ').slice(-orden.groups.v.split(' ').length).join(' ');
    const ambiguo = /^(dime|decime)$/.test(verbo) && !orden.groups.fijo && !/^\p{Lu}/u.test(nombreOriginal) && !o.preguntado;
    if (!ambiguo) {
      const n = nombreDe(original, orden.groups.v);
      if (n) return n;
    }
  }
  if (!o.preguntado) return null;
  // La respuesta corta a «¿cómo quieres que te llame?».
  if (/\b(no se|como quieras|me da igual|lo que quieras|cualquiera|no importa|whatever|i don'?t know)\b/.test(q)) return null;
  const sinRelleno = q.replace(RELLENO_ANTES, '').replace(RELLENO_DESPUES, '').trim();
  if (sinRelleno.split(' ').length > 3) return null;
  return nombreDe(original.replace(/[,\s]+(?:est[aá] bien|por favor|nada m[aá]s|solamente|solo|gracias|nom[aá]s|please|is fine|thanks)\s*[.!]*$/i, ''), sinRelleno);
}

/**
 * La indicación del turno cuando todavía no sabe cómo llamarle ('' si ya lo sabe). Va con lo del turno
 * (no en el system): cuando lo guarda, desaparece sin rehacer lo fijo.
 */
export function lineaApodoPendiente(p: Perfil | null | undefined, idioma: 'es' | 'en' = 'es', o: { nombre?: string } = {}): string {
  if (!apodoPendiente(p)) return '';
  const nombre = String(o.nombre || p?.nombreGenesis || '').trim().split(/\s+/)[0] || '';
  if (idioma === 'en')
    return `YOU DON'T KNOW YET WHAT THEY WANT TO BE CALLED: in this conversation ask once, naturally, early on, "What would you like me to call you?"${nombre ? ` (you can offer "${nombre}" or a nickname)` : ''}, but only after doing what they asked in this turn (never instead of it: if they asked for something, do it first and ask at the end, or in another turn). When they tell you, confirm it ("Got it, I'll call you … from now on") and always use it. If they'd rather not say, don't insist.`;
  return `AÚN NO SABES CÓMO QUIERE QUE LE LLAMES: en esta conversación pregúntale una vez, con naturalidad y al principio, «¿Cómo quieres que te llame?»${nombre ? ` (puedes ofrecerle «${nombre}» o un apodo)` : ''}, pero solo después de hacer lo que te pidió en este turno (nunca en lugar de eso: si te pidió algo, hazlo y pregúntalo al final o en otro turno). Cuando te lo diga, confírmalo («Listo, desde ahora te digo …») y úsalo siempre. Si no quiere decirlo, no insistas.`;
}

/** Lo último que dijo AURA en el hilo (para saber si acaba de preguntar). */
function ultimaDeAura(hilo: readonly Msg[]): string {
  for (let i = hilo.length - 1; i >= 0; i--) if (hilo[i].role === 'assistant') return hilo[i].content;
  return '';
}

/**
 * El turno: si en este mensaje dijo cómo quiere que le llamen, se guarda (sin esperar a S3) y se devuelve
 * el perfil con el apodo nuevo para que ESTE turno ya lo use. Si no, el perfil tal cual. Nunca lanza.
 * `guardar` es para las pruebas.
 */
export async function conApodoDelTurno(
  correo: string,
  mensaje: string,
  hilo: readonly Msg[],
  perfil: Perfil | null,
  guardar: (correo: string, apodo: string) => Promise<unknown> = (c, apodo) => actualizarPerfil(c, { apodo })
): Promise<Perfil | null> {
  if (!correo) return perfil;
  try {
    const preguntado = apodoPendiente(perfil) && preguntoApodo(ultimaDeAura(hilo));
    const apodo = detectarApodo(mensaje, { preguntado });
    // El mismo apodo que ya tenía: solo si era el de relleno («José está bien») se guarda, para marcarlo elegido.
    if (!apodo || (apodo === perfil?.apodo && !apodoPendiente(perfil))) return perfil;
    void guardar(correo, apodo).catch((e) => console.warn('[apodo] no pude guardarlo', String(e?.message || e).slice(0, 120)));
    return { ...aplicarCambios(perfil || perfilInicial({}), { apodo }), apodoElegido: true };
  } catch {
    return perfil;
  }
}
