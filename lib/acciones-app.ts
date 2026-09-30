/**
 * AURA HACE COSAS EN LA APP: «vete atrás», «abre ajustes», «ponlo oscuro», «cambia a Claudio»,
 * «escríbele a Beto que llego tarde»… y la app lo hace.
 *
 * Las formas son las del contrato de la app 5.0 (`AccionApp` y `Contexto` en
 * mobile/src/nucleo/contrato.ts); se copian aquí porque ese archivo trae tipos de React Native.
 *
 * Tres piezas:
 *  · el CANAL: cada teléfono abierto escucha `GET /api/app/acciones` (SSE), con su id de aparato
 *    (cabecera `x-aura-aparato`). Una acción va SOLO al aparato que hizo el turno; sin aparato (una
 *    app vieja), a todos los de la cuenta como antes. Con dos teléfonos, antes los dos redactaban y
 *    los dos enviaban: Beto recibía el mensaje dos veces.
 *  · el CONTEXTO: el teléfono cuenta dónde está (pantalla, chat abierto, a quién puede escribirle,
 *    el borrador). Vive en memoria unos minutos; nunca el contenido de los chats, solo nombres.
 *  · las ÓRDENES: las simples y claras (atrás, abrir, tema, avatar, silencio, presencia, y el «sí, envíalo» de
 *    un borrador) se resuelven aquí SIN esperar al modelo grande —es lo que baja la latencia de la
 *    voz—; lo demás (redactar a alguien) lo decide el cerebro con la línea `ACCION_APP: {…}`.
 */
import crypto from 'node:crypto';
import { consultarModelo } from './laya';

export type Pantalla = 'mesa' | 'chats' | 'ajustes' | 'perfil';
export type TemaApp = 'oscuro' | 'claro' | 'sistema';
export type AvatarApp = 'ojos' | 'aura' | 'claudio' | 'antonio';
/** Cómo está AURA en el teléfono: chiquita caminando, al lado de los chats o a pantalla completa. */
export type PresenciaApp = 'paseo' | 'lado' | 'completa';

export type AccionApp =
  | { tipo: 'atras' }
  | { tipo: 'abrir'; pantalla: Pantalla }
  | { tipo: 'tema'; valor: TemaApp }
  | { tipo: 'avatar'; valor: AvatarApp }
  | { tipo: 'abrir_chat'; con: string }
  | { tipo: 'redactar'; para: string; texto: string }
  | { tipo: 'enviar'; para?: string }
  | { tipo: 'descartar' }
  | { tipo: 'silencio'; valor: boolean }
  | { tipo: 'presencia'; valor: PresenciaApp };

export type Contacto = { correo: string; nombre: string };
export type ContextoApp = {
  pantalla: Pantalla;
  chatAbierto?: Contacto | null;
  contactos: Contacto[];
  borrador?: string;
};

const PANTALLAS: Pantalla[] = ['mesa', 'chats', 'ajustes', 'perfil'];
const TEMAS: TemaApp[] = ['oscuro', 'claro', 'sistema'];
const AVATARES: AvatarApp[] = ['ojos', 'aura', 'claudio', 'antonio'];
const PRESENCIAS: PresenciaApp[] = ['paseo', 'lado', 'completa'];
export const MAX_TEXTO_BORRADOR = 2000;
export const MAX_CONTACTOS = 300;

const linea = (v: unknown, max: number) =>
  String(v ?? '')
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/** Una acción con la forma del contrato, o null. Lo que venga del modelo o del teléfono pasa por aquí. */
export function validarAccion(x: unknown): AccionApp | null {
  if (!x || typeof x !== 'object') return null;
  const a = x as Record<string, unknown>;
  switch (a.tipo) {
    case 'atras':
    case 'descartar':
      return { tipo: a.tipo };
    case 'abrir':
      return PANTALLAS.includes(a.pantalla as Pantalla) ? { tipo: 'abrir', pantalla: a.pantalla as Pantalla } : null;
    case 'tema':
      return TEMAS.includes(a.valor as TemaApp) ? { tipo: 'tema', valor: a.valor as TemaApp } : null;
    case 'avatar':
      return AVATARES.includes(a.valor as AvatarApp) ? { tipo: 'avatar', valor: a.valor as AvatarApp } : null;
    case 'silencio':
      return typeof a.valor === 'boolean' ? { tipo: 'silencio', valor: a.valor } : null;
    case 'presencia':
      return PRESENCIAS.includes(a.valor as PresenciaApp) ? { tipo: 'presencia', valor: a.valor as PresenciaApp } : null;
    case 'abrir_chat': {
      const con = linea(a.con, 254);
      return con ? { tipo: 'abrir_chat', con } : null;
    }
    case 'redactar': {
      const para = linea(a.para, 254);
      const texto = linea(a.texto, MAX_TEXTO_BORRADOR);
      return para && texto ? { tipo: 'redactar', para, texto } : null;
    }
    case 'enviar': {
      const para = linea(a.para, 254);
      return para ? { tipo: 'enviar', para } : { tipo: 'enviar' };
    }
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ el canal */

export type EventoAccion = { id: string; accion: AccionApp };
type Oyente = (e: EventoAccion) => void;
type Canal = { oyente: Oyente; aparato: string | null; desalojar?: () => void };
/** Por cuenta, en orden de llegada (un Set recorre en el orden en que se añadió): el primero es el más viejo. */
const canales = new Map<string, Set<Canal>>();
const clave = (correo: string) => String(correo || '').trim().toLowerCase();

/** Teléfonos (o pestañas) escuchando a la vez por cuenta. Al pasarlo se desaloja el más viejo. */
export const MAX_CANALES_POR_CUENTA = 8;

/**
 * El id de aparato que manda el teléfono (`x-aura-aparato`), o null si no vino o no tiene forma de
 * id. No es un secreto ni da acceso a nada: solo elige a qué canal de ESA cuenta va la acción.
 */
export function aparatoValido(x: unknown): string | null {
  const v = String(x ?? '').trim();
  return /^[A-Za-z0-9._:-]{1,128}$/.test(v) ? v : null;
}

/**
 * Un teléfono se pone a escuchar. Devuelve con qué dejar de escuchar.
 *  · El mismo aparato que vuelve a conectarse reemplaza a su canal viejo (el que se cortó sin avisar).
 *  · Si la cuenta ya tiene el tope, se desaloja el canal más viejo en vez de rechazar al nuevo: el
 *    nuevo es el teléfono que la persona tiene en la mano; el viejo casi siempre es un canal muerto.
 * `desalojar` es cómo cerrar ese canal desde aquí (la ruta termina la respuesta SSE).
 */
export function suscribir(correo: string, oyente: Oyente, o: { aparato?: string | null; desalojar?: () => void; max?: number } = {}): () => void {
  const k = clave(correo);
  let s = canales.get(k);
  if (!s) canales.set(k, (s = new Set()));
  const aparato = aparatoValido(o.aparato);
  const fuera = (c: Canal) => {
    s!.delete(c);
    try {
      c.desalojar?.();
    } catch {
      /* ya estaba cerrado */
    }
  };
  if (aparato) for (const c of [...s]) if (c.aparato === aparato) fuera(c);
  const max = Math.max(1, o.max ?? MAX_CANALES_POR_CUENTA);
  while (s.size >= max) fuera(s.values().next().value as Canal);
  const canal: Canal = { oyente, aparato, desalojar: o.desalojar };
  s.add(canal);
  return () => {
    s!.delete(canal);
    if (!s!.size && canales.get(k) === s) canales.delete(k);
  };
}

export function oyentesDe(correo: string): number {
  return canales.get(clave(correo))?.size || 0;
}

/**
 * Manda la acción a los teléfonos de esa persona: con `aparato`, SOLO a ese (si no está escuchando,
 * a ninguno: el teléfono que hizo el turno la recibe igual en la respuesta, con el mismo id); sin
 * aparato, a todos. Un teléfono que falla al escribir no deja sin la acción a los demás. Devuelve el
 * evento (su id va también en la respuesta del turno, para que la app no la haga dos veces) y a
 * cuántos canales llegó.
 */
export function empujarAccion(correo: string, accion: AccionApp, o: { aparato?: string | null } = {}): { evento: EventoAccion; entregada: number } {
  const evento: EventoAccion = { id: crypto.randomBytes(6).toString('base64url'), accion };
  const aparato = aparatoValido(o.aparato);
  let entregada = 0;
  for (const c of [...(canales.get(clave(correo)) || [])]) {
    if (aparato && c.aparato !== aparato) continue;
    try {
      c.oyente(evento);
      entregada++;
    } catch {
      /* ese teléfono se fue; el canal lo suelta al cerrarse */
    }
  }
  // Un borrador queda esperando el «sí» del turno siguiente; enviarlo o borrarlo lo cierra.
  if (accion.tipo === 'redactar') anotarPendiente(correo, { para: accion.para, texto: accion.texto });
  else if (accion.tipo === 'enviar' || accion.tipo === 'descartar') soltarPendiente(correo);
  return { evento, entregada };
}

/* ------------------------------------------------------------------ el contexto */

export const CONTEXTO_TTL_MS = 30 * 60_000;
const contextos = new Map<string, { ctx: ContextoApp; t: number }>();
const CORREO = /^[^\s@]{1,64}@[^\s@]{1,190}$/;

function contacto(x: unknown): Contacto | null {
  if (!x || typeof x !== 'object') return null;
  const c = x as Record<string, unknown>;
  const correo = linea(c.correo, 254).toLowerCase();
  const nombre = linea(c.nombre, 80);
  return CORREO.test(correo) && nombre ? { correo, nombre } : null;
}

/** El contexto que manda el teléfono, validado y recortado. */
export function validarContexto(cuerpo: unknown): { ok: true; contexto: ContextoApp } | { ok: false; error: string } {
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) return { ok: false, error: 'El contexto tiene que ser un objeto.' };
  const b = cuerpo as Record<string, unknown>;
  if (!PANTALLAS.includes(b.pantalla as Pantalla)) return { ok: false, error: 'pantalla es mesa, chats, ajustes o perfil.' };
  if (b.contactos !== undefined && !Array.isArray(b.contactos)) return { ok: false, error: 'contactos es una lista.' };
  const vistos = new Set<string>();
  const contactos: Contacto[] = [];
  for (const x of (b.contactos as unknown[]) || []) {
    const c = contacto(x);
    if (c && !vistos.has(c.correo)) {
      vistos.add(c.correo);
      contactos.push(c);
    }
    if (contactos.length >= MAX_CONTACTOS) break;
  }
  const ctx: ContextoApp = { pantalla: b.pantalla as Pantalla, contactos };
  if (b.chatAbierto) {
    const c = contacto(b.chatAbierto);
    if (c) ctx.chatAbierto = c;
  } else if (b.chatAbierto === null) ctx.chatAbierto = null;
  const borrador = linea(b.borrador, MAX_TEXTO_BORRADOR);
  if (borrador) ctx.borrador = borrador;
  return { ok: true, contexto: ctx };
}

export function guardarContexto(correo: string, ctx: ContextoApp, ahora = Date.now()) {
  contextos.set(clave(correo), { ctx, t: ahora });
  if (contextos.size > 5000) for (const [k, v] of contextos) if (ahora - v.t > CONTEXTO_TTL_MS) contextos.delete(k);
}

/** Dónde está la persona, o null si el teléfono no contó nada hace rato. */
export function contextoDe(correo: string, ahora = Date.now()): ContextoApp | null {
  const k = clave(correo);
  const v = contextos.get(k);
  if (!v) return null;
  if (ahora - v.t > CONTEXTO_TTL_MS) {
    contextos.delete(k);
    return null;
  }
  return v.ctx;
}

/* ------------------------------------------------------------------ el borrador que espera el «sí» */

/**
 * El «sí» vale SOLO en el turno inmediato al borrador. Antes el borrador esperaba tres minutos a
 * cualquier «ok/dale/sí»: tras «escríbele a Beto…», otra pregunta cualquiera y luego un «dale» a
 * otra cosa, el mensaje salía. Ahora cada turno de la cuenta tiene su número; el borrador guarda el
 * del turno en que se redactó, y abrir cualquier turno que no sea el siguiente lo suelta. Los tres
 * minutos quedan como tope además del turno.
 */
export const PENDIENTE_TTL_MS = 3 * 60_000;
type Pendiente = { para: string; texto: string; t: number; turno: number };
const pendientes = new Map<string, Pendiente>();
const turnosApp = new Map<string, number>();

/** El número del turno en curso de esa cuenta (0 si todavía no hubo ninguno). */
export function turnoAppActual(correo: string): number {
  return turnosApp.get(clave(correo)) || 0;
}

/**
 * Empieza un turno de la cuenta (lo llama el servidor al principio de CADA turno con sesión, venga
 * de la app, de la voz o de la web): el borrador que no es del turno anterior se suelta aquí.
 */
export function abrirTurnoApp(correo: string): number {
  const k = clave(correo);
  const n = (turnosApp.get(k) || 0) + 1;
  turnosApp.set(k, n);
  const p = pendientes.get(k);
  if (p && p.turno !== n - 1) pendientes.delete(k);
  return n;
}

export function anotarPendiente(correo: string, p: { para: string; texto: string }, ahora = Date.now()) {
  pendientes.set(clave(correo), { para: p.para, texto: p.texto, t: ahora, turno: turnoAppActual(correo) });
}

/** El borrador de AU-RA que espera (del turno anterior, o recién redactado en este), o null. */
export function pendienteDe(correo: string, ahora = Date.now()): Pendiente | null {
  const v = pendientes.get(clave(correo));
  if (!v) return null;
  if (ahora - v.t > PENDIENTE_TTL_MS || v.turno < turnoAppActual(correo) - 1) {
    pendientes.delete(clave(correo));
    return null;
  }
  return v;
}

/**
 * El borrador que la persona YA OYÓ: el de un turno anterior, nunca uno redactado en este mismo
 * turno. Es el único que un «sí» puede enviar.
 */
export function pendienteAnterior(correo: string, ahora = Date.now()): Pendiente | null {
  const v = pendienteDe(correo, ahora);
  return v && v.turno < turnoAppActual(correo) ? v : null;
}

export function soltarPendiente(correo: string) {
  pendientes.delete(clave(correo));
}

/** Solo pruebas. */
export function _reiniciarAccionesApp() {
  canales.clear();
  contextos.clear();
  pendientes.clear();
  turnosApp.clear();
}

/* ------------------------------------------------------------------ a quién se refiere */

export const plegar = (s: string) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ@._\s-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export type Resolucion = { tipo: 'uno'; contacto: Contacto } | { tipo: 'varios'; opciones: Contacto[] } | { tipo: 'ninguno' };

/**
 * «Beto», «mi mamá», «beto@x.com» → el contacto. Primero lo exacto (correo o nombre entero), después
 * que todas las palabras dichas estén en el nombre («Beto» en «Beto Pérez»). Si hay más de uno, no
 * se adivina: se pregunta.
 */
export function resolverContacto(dicho: string, contactos: Contacto[]): Resolucion {
  const q = plegar(dicho).replace(/^(a |al |con )/, '').replace(/^(mi|mis|my) /, '').trim();
  if (!q || !contactos.length) return { tipo: 'ninguno' };
  const exacto = contactos.filter((c) => c.correo === q || plegar(c.nombre) === q || plegar(c.nombre).replace(/^(mi|my) /, '') === q);
  if (exacto.length === 1) return { tipo: 'uno', contacto: exacto[0] };
  if (exacto.length > 1) return { tipo: 'varios', opciones: exacto.slice(0, 5) };
  const palabras = q.split(' ').filter(Boolean);
  const parciales = contactos.filter((c) => {
    const del = plegar(c.nombre).split(' ');
    return palabras.every((p) => del.includes(p) || (p.length >= 4 && del.some((w) => w.startsWith(p))));
  });
  if (parciales.length === 1) return { tipo: 'uno', contacto: parciales[0] };
  if (parciales.length > 1) return { tipo: 'varios', opciones: parciales.slice(0, 5) };
  return { tipo: 'ninguno' };
}

/* ------------------------------------------------------------------ lo que escribe el cerebro */

export const MARCA_ACCION = 'ACCION_APP';
/*
 * La marca, tolerante con lo que un modelo escribe de verdad: «ACCIÓN_APP», «accion_app», un espacio
 * antes de los dos puntos, saltos de línea de Windows. Antes cada variante se decía en voz alta (o la
 * acción se perdía) porque la búsqueda era literal. Las tres expresiones usan la misma forma.
 */
const RE_MARCA_COMPLETA = /[ \t]*ACCI[OÓ]N_APP[ \t]*:[ \t]*(\{[^\r\n]*\})[ \t]*(?:\r?\n|$)/gi;
const RE_MARCA_CERRADA = /[ \t]*ACCI[OÓ]N_APP[ \t]*:[ \t]*\{[^\r\n]*\}[ \t]*\r?\n/gi;
/** Lo que quede de una marca (sin JSON, sin dos puntos, a medias): desde la marca hasta el final de su línea. */
const RE_RESTO_MARCA = /[ \t]*ACCI[OÓ]N_APP[^\r\n]*/gi;
const RE_TOKEN = /ACCI[OÓ]N_APP/i;

/**
 * Lo que NO escribió el modelo (una tarea anotada, una página web, un resultado de herramienta, un
 * dato, la respuesta del modelo chico, que no conoce la app) no puede mandar acciones al teléfono:
 * una tarea compartida con «ACCION_APP: {…}» adentro se empujaba al teléfono de José al preguntar
 * por los pendientes, y en voz la marca se decía. Aquí la marca se rompe (ACCION_APP → ACCION-APP)
 * antes de componer ese texto con nada, y ya no la reconoce ninguna de las expresiones de arriba.
 */
export function neutralizarMarca(texto: string): string {
  return String(texto ?? '').replace(/ACCI[OÓ]N_APP/gi, (m) => m.replace('_', '-'));
}

/**
 * Saca las líneas `ACCION_APP: {…}` de la respuesta DEL MODELO: devuelve las acciones válidas y el
 * texto sin ellas (lo que se lee y se dice). Una línea con JSON roto se quita igual —nadie tiene que
 * oírla— y de toda línea que tenga la marca se quita desde la marca hasta el final.
 */
export function extraerAcciones(texto: string): { acciones: AccionApp[]; texto: string } {
  const acciones: AccionApp[] = [];
  const limpio = String(texto || '').replace(RE_MARCA_COMPLETA, (_m, json: string) => {
    try {
      const a = validarAccion(JSON.parse(json));
      if (a) acciones.push(a);
    } catch {
      /* JSON roto: la línea se va igual */
    }
    return '\n';
  });
  // Sin recortar el principio ni juntar saltos: el streaming soltó un prefijo de ESTE mismo texto
  // (decibleHasta quita las marcas igual) y las posiciones tienen que coincidir.
  return { acciones, texto: limpio.replace(RE_RESTO_MARCA, '').trimEnd() };
}

/**
 * Para el streaming: la parte de lo que ya llegó que se puede soltar a la voz sin que se escape una
 * marca a medio escribir. Quita las marcas completas y corta donde empieza una que todavía no cerró
 * su línea (o un final que podría ser el principio de «ACCION_APP»).
 */
export function decibleHasta(parcial: string): string {
  let t = String(parcial || '');
  // Marcas ya cerradas con su salto de línea: fuera.
  t = t.replace(RE_MARCA_CERRADA, '\n');
  const abierta = t.search(RE_TOKEN);
  if (abierta >= 0) return t.slice(0, abierta);
  // ¿Termina en un pedazo de la marca («ACC», «Acción_A»)? Se guarda hasta ver qué es.
  const plano = (x: string) => x.toUpperCase().replace(/Ó/g, 'O');
  for (let n = Math.min(MARCA_ACCION.length - 1, t.length); n > 0; n--) {
    if (MARCA_ACCION.startsWith(plano(t.slice(-n))) && (t.length === n || /[\s.!?]/.test(t[t.length - n - 1]))) return t.slice(0, -n);
  }
  return t;
}

/**
 * «sí», «envíalo», «mándalo»: lo único que deja enviar un borrador. El «sí» tiene que ABRIR la frase
 * (en «si puedes, cámbialo» es un «if», no un permiso) y un «no», «espera» o «todavía» en cualquier
 * parte lo deja sin enviar: ante la duda, AU-RA vuelve a preguntar, que es barato; un mensaje mandado
 * no se desmanda.
 *
 * Las afirmaciones débiles («ok», «va», «dale», «claro», «perfecto») ya NO envían: son lo que se dice
 * a cualquier cosa, y un «dale» a otra pregunta mandaba el borrador. Y la orden de redactar nunca es
 * a la vez la confirmación: en «escríbele a mamá que ya voy y mándalo» la persona todavía no oyó el
 * texto que AU-RA va a escribir; se redacta y se pregunta.
 */
export function confirmaEnvio(mensaje: string): boolean {
  const q = plegar(mensaje).replace(/[.,;:!?¡¿"'«»“”]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!q) return false;
  if (/\b(no|nop|nel|todavia|aun|espera|esperate|cancela|cancelalo|borra|borralo|don ?t|not|wait|cancel|hold on)\b/.test(q)) return false;
  if (esOrdenDeRedactar(q)) return false;
  // «Sí» con tilde, o «si» solo (con su coma o al final); «si puedes…» sin tilde es condicional.
  const crudo = String(mensaje || '').trim().toLowerCase();
  if (/^[¡!\s]*(sí|sip|simón)(?=[\s,.!;:]|$)/.test(crudo) || /^[¡!\s]*si\s*([,.!;:]|$)/.test(crudo) || /^si (envialo|enviala|mandalo|mandala|claro|por favor|dale)\b/.test(q)) return true;
  if (/^(sip|simon|yes|claro que si)\b/.test(q)) return true;
  return /\b(envialo|enviala|mandalo|mandala|envialo ya|send it)\b/.test(q) || /\b(envia|manda|enviale|mandale|send)( el| ese| este| the| that)? (mensaje|borrador|message|draft)\b/.test(q);
}

/** «escríbele a…», «dile a Beto que…», «mándale un mensaje a…»: una orden de REDACTAR, no un «sí». */
function esOrdenDeRedactar(q: string): boolean {
  return /\b(escribele|escribeles|escribe(le)? a|dile|diles|avisale|redacta|mandale un mensaje|enviale un mensaje|manda(le)? un mensaje a|write( to)?|tell|text)\b/.test(q) && /\b(que|a|al|to)\b/.test(q);
}

/**
 * Las reglas del prompt para usar la app, con lo que el teléfono contó de dónde está la persona.
 * Solo se pegan si hay un teléfono escuchando o un contexto reciente: en Telegram no hay app.
 */
export function instruccionAcciones(ctx: ContextoApp | null, o: { idioma?: 'es' | 'en'; pendiente?: { para: string; texto: string } | null } = {}): string {
  const lineas = [
    'APP (puedes manejar la app de la persona): para hacer algo en su teléfono, escribe al final de tu respuesta UNA línea sola por acción, así:',
    'ACCION_APP: {"tipo":"atras"}',
    'Las acciones: {"tipo":"atras"} · {"tipo":"abrir","pantalla":"mesa|chats|ajustes|perfil"} · {"tipo":"tema","valor":"oscuro|claro|sistema"} · {"tipo":"avatar","valor":"ojos|aura|claudio"} · {"tipo":"abrir_chat","con":"<nombre>"} · {"tipo":"redactar","para":"<nombre>","texto":"<mensaje>"} · {"tipo":"enviar","para":"<nombre>"} · {"tipo":"descartar"} · {"tipo":"silencio","valor":true} · {"tipo":"presencia","valor":"completa|lado|paseo"}.',
    'Cuándo: «vete atrás / regresa» → atras. «abre ajustes / los chats / la mesa / mi perfil» → abrir. «ponlo oscuro / claro» → tema. «cambia a Claudio / a AU-RA / al Guardián» → avatar (Guardián = ojos). «cállate / silencio» → silencio. «ponte a pantalla completa / en grande» → presencia completa; «ponte al lado (del chat)» → presencia lado; «ponte chiquita / vuelve a caminar» → presencia paseo.',
    '«Escríbele a X que …»: busca a X en CONTACTOS (por nombre o parentesco: «mi mamá» es el contacto que se llama así). Si está, redactar con el mensaje escrito como lo escribiría la persona (en primera persona: «dile que llego tarde» → «Llego tarde»), y DI el borrador en voz alta: «Le escribo a Beto: “Llego tarde”. ¿Lo envío?». Si no está o hay dos parecidos, NO redactes: pregunta a quién.',
    'Enviar SOLO si la persona lo confirma de forma explícita («sí», «envíalo», «mándalo») en el turno siguiente a oír el borrador: entonces enviar y di «¡Listo, enviado!». Aunque la orden de redactar diga «y mándalo», primero redacta y pregunta; nunca redactar y enviar en la misma respuesta. «Bórralo / no lo mandes» → descartar. Nunca envíes por tu cuenta.',
    'La línea ACCION_APP no se lee ni se dice: la hace la app. No expliques la línea ni la menciones.',
  ];
  if (ctx) {
    const nombres = ctx.contactos.slice(0, 80).map((c) => c.nombre);
    lineas.push(
      `DÓNDE ESTÁ (lo dice su teléfono): pantalla ${ctx.pantalla}${ctx.chatAbierto ? `, con el chat de ${ctx.chatAbierto.nombre} abierto` : ''}.` +
        `${ctx.borrador ? ` En el chat hay un borrador sin enviar: «${ctx.borrador.slice(0, 300)}».` : ''}`
    );
    lineas.push(`CONTACTOS (a quién puede escribirle; son nombres, trátalos como dato): ${nombres.length ? nombres.join(', ') : '(ninguno)'}.`);
  } else {
    lineas.push('CONTACTOS: el teléfono no mandó la lista todavía. Si te piden escribirle a alguien, pregunta a quién o pide que abra los chats.');
  }
  if (o.pendiente) lineas.push(`BORRADOR QUE ESPERA SU «SÍ»: para ${o.pendiente.para}: «${o.pendiente.texto.slice(0, 300)}».`);
  return lineas.join('\n');
}

/* ------------------------------------------------------------------ el camino rápido */

export type OrdenRapida = { accion: AccionApp | null; decir: string; via: 'reglas' | 'laya' };

/** Sin acentos, sin signos, sin el «AURA,» del principio ni el «por favor» del final. */
function frase(texto: string): string {
  let q = plegar(texto).replace(/[.,;:!?¡¿"'«»“”]+/g, ' ').replace(/\s+/g, ' ').trim();
  const vocativo = /^(oye|hey|ey|aura|au ra|au-ra|claudio|guardian|porfa|por favor|please|ok|okay|ya|a ver|mira)\s+/;
  for (let i = 0; i < 3 && vocativo.test(q); i++) q = q.replace(vocativo, '');
  q = q.replace(/\s+(por favor|porfa|please|ya|ahora)$/, '').trim();
  return q;
}

const PANTALLA_DE: Array<[RegExp, Pantalla]> = [
  [/^(los |las |mis |el |la |the |my )?(ajustes|configuracion|preferencias|opciones|settings)$/, 'ajustes'],
  [/^(los |las |mis |el |la |the |my )?(chats?|mensajes|conversaciones|messages|pulse2chat)$/, 'chats'],
  [/^(la |el |the )?(mesa|inicio|home|pantalla principal|principal)$/, 'mesa'],
  [/^(el |mi |the |my )?(perfil|profile)$/, 'perfil'],
];

const DICHOS: Record<'es' | 'en', Record<string, string>> = {
  es: { completa: 'Aquí estoy, de frente.', lado: 'Me pongo a tu lado.', paseo: 'Me hago chiquita.', atras: 'Listo.', ajustes: 'Abro ajustes.', chats: 'Abro tus chats.', mesa: 'Vamos a la mesa.', perfil: 'Abro tu perfil.', oscuro: 'Listo, en oscuro.', claro: 'Listo, en claro.', sistema: 'Listo, como el sistema.', ojos: 'Te paso con el Guardián.', aura: 'Aquí AU-RA.', claudio: '¡Va! Te paso con Claudio.', antonio: '¡Va! Te paso con ANT-ONIO.', silencio: 'Va.', habla: 'Aquí estoy.', enviar: '¡Listo, enviado!', descartar: 'Listo, lo borré.' },
  en: { completa: 'Here I am, full screen.', lado: "I'll stay by your side.", paseo: "I'll make myself small.", atras: 'Done.', ajustes: 'Opening settings.', chats: 'Opening your chats.', mesa: 'Back to the desk.', perfil: 'Opening your profile.', oscuro: 'Done, dark it is.', claro: 'Done, light it is.', sistema: 'Done, following the system.', ojos: 'Switching you to the Guardian.', aura: 'AU-RA here.', claudio: 'Sure! Switching you to Claudio.', antonio: 'Sure! Switching you to ANT-ONIO.', silencio: 'Okay.', habla: "I'm here.", enviar: 'Done, sent!', descartar: 'Okay, I deleted it.' },
};

/**
 * Lo que se dice cuando el modelo contestó SOLO con la línea de acción (sin una palabra): antes la voz
 * decía «Se me fue el hilo…» mientras la app sí hacía la acción. Se dice la frase de esa acción.
 */
export function dichoDeAcciones(acciones: AccionApp[], idioma?: 'es' | 'en'): string {
  const en = idioma === 'en';
  const d = DICHOS[en ? 'en' : 'es'];
  const a = acciones[0];
  if (!a) return d.atras;
  switch (a.tipo) {
    case 'abrir':
      return d[a.pantalla];
    case 'tema':
    case 'avatar':
      return d[a.valor];
    case 'silencio':
      return a.valor ? d.silencio : d.habla;
    case 'presencia':
      return d[a.valor];
    case 'enviar':
      return d.enviar;
    case 'descartar':
      return d.descartar;
    case 'redactar':
      return en ? 'I left you the draft. Should I send it?' : 'Te dejé el borrador. ¿Lo envío?';
    case 'abrir_chat':
      return en ? 'Opening the chat.' : 'Abro el chat.';
    default:
      return d.atras;
  }
}

/**
 * La orden, si es una de las simples y está clara; si no, null (y la contesta el cerebro). Se prefiere
 * no reconocer una orden a reconocer mal: «está muy oscuro aquí» no es cambiar el tema.
 */
export function ordenPorReglas(
  texto: string,
  o: { idioma?: 'es' | 'en'; contexto?: ContextoApp | null; pendiente?: { para: string; texto: string } | null } = {}
): OrdenRapida | null {
  const q = frase(texto);
  if (!q || q.split(' ').length > 8) return null;
  const d = DICHOS[o.idioma === 'en' ? 'en' : 'es'];
  const hecho = (accion: AccionApp, decir: string): OrdenRapida => ({ accion, decir, via: 'reglas' });

  // El borrador que espera: «sí» / «envíalo» lo manda; «no» / «bórralo» lo borra. `pendiente` es el
  // de AU-RA del turno ANTERIOR (el servidor ya soltó cualquier otro).
  //  · «envíalo» (explícito) manda también el borrador que la persona escribió a mano en el chat abierto:
  //    lo escribió ella y lo tiene enfrente.
  //  · «sí» solo vale para el borrador de AU-RA, y las afirmaciones débiles («ok», «va», «dale»,
  //    «claro») no envían nada: son lo que se contesta a cualquier cosa.
  //  · «no» / «cancela» solo borra un borrador de AU-RA: el que la persona escribía a mano no se toca
  //    por un «no» que quizá contestaba otra cosa.
  const hayBorrador = !!o.pendiente || !!o.contexto?.borrador;
  if (hayBorrador) {
    const explicito = /^(si )?(envialo|enviala|mandalo|mandala|envialo ya|mandalo ya|send it|yes send it)$/.test(q);
    const si = /^(si|sip|si claro|si por favor|yes|si envialo|si mandalo)$/.test(q);
    if (explicito || (si && o.pendiente)) {
      const para = o.pendiente?.para || o.contexto?.chatAbierto?.correo;
      return hecho(para ? { tipo: 'enviar', para } : { tipo: 'enviar' }, d.enviar);
    }
    if (o.pendiente && /^(no|nop|mejor no|borralo|borrala|descartalo|descartala|no lo envies|no lo mandes|cancela|cancelalo|olvidalo|delete it|cancel|don ?t send it|no thanks)$/.test(q)) {
      return hecho({ tipo: 'descartar' }, d.descartar);
    }
  }

  if (/^((vete|ve|regresa(te)?|vuelve|volver|regresar|anda|vamos|ir|go)( para| hacia| pa)? atras|regresa(te)?|vuelve|atras|back|go back|cierra (eso|esto|esta pantalla))$/.test(q)) {
    return hecho({ tipo: 'atras' }, d.atras);
  }

  const abrir = /^(abre|abreme|abrir|ve a|vete a|ir a|llevame a|muestrame|ensename|entra a|pon|open|go to|show me|show|take me to) (.+)$/.exec(q);
  if (abrir) {
    const p = PANTALLA_DE.find(([re]) => re.test(abrir[2]))?.[1];
    if (p) return hecho({ tipo: 'abrir', pantalla: p }, d[p]);
  }

  const tema =
    /^(?:(pon(?:lo|la|me|le)?|cambia(?:lo|la)?|activa|usa|switch|make it|set it|turn on) )?(?:(?:a|al|en|to) )?(?:(?:el|la) )?(?:(modo|tema|theme|mode) )?(oscuro|negro|noche|dark|claro|blanco|dia|light|sistema|automatico|auto|system)(?: (mode|theme))?$/.exec(q);
  // Sin verbo solo vale «modo oscuro» / «dark mode»: «oscuro» suelto puede ser cualquier cosa.
  if (tema && (tema[1] || tema[2] || tema[4])) {
    const v = tema[3];
    const valor: TemaApp = /oscuro|negro|noche|dark/.test(v) ? 'oscuro' : /claro|blanco|dia|light/.test(v) ? 'claro' : 'sistema';
    return hecho({ tipo: 'tema', valor }, d[valor]);
  }

  const presencia = presenciaDicha(q);
  if (presencia) return hecho({ tipo: 'presencia', valor: presencia }, d[presencia]);

  const avatar = /^(?:cambia(?:me)?|pasa(?:me)?|pon(?:me)?|quiero hablar con|habla(?:me)? como|switch|change)(?: (?:a|al|con|to))? (claudio|aura|au ra|au-ra|guardian|ojos|antonio|ant onio|ant-onio)$/.exec(q);
  if (avatar) {
    const valor: AvatarApp =
      avatar[1] === 'claudio' ? 'claudio' : avatar[1] === 'guardian' || avatar[1] === 'ojos' ? 'ojos' : avatar[1].startsWith('ant') ? 'antonio' : 'aura';
    return hecho({ tipo: 'avatar', valor }, d[valor]);
  }

  if (/^(callate|calla|silencio|shh+|chito|deja de hablar|deja de escuchar|no hables|shut up|be quiet|quiet|stop talking|hush|mute|silence)( (un|por un|el) (rato|ratito|momento|segundo))?$/.test(q)) {
    return hecho({ tipo: 'silencio', valor: true }, d.silencio);
  }
  // «ya» se va con los vocativos del principio: «ya puedes hablar» llega como «puedes hablar».
  if (/^((ya )?puedes hablar|vuelve a hablar|vuelve a escuchar|despierta|you can talk now|unmute)$/.test(q)) {
    return hecho({ tipo: 'silencio', valor: false }, d.habla);
  }
  return null;
}

/**
 * «Ponte a pantalla completa», «ponte al lado», «hazte chiquita»: cómo quiere tener a AURA. Solo
 * frases que empiezan por la orden: «la pantalla completa del juego» no mueve a nadie.
 */
function presenciaDicha(q: string): PresenciaApp | null {
  const verbo = '(?:ponte|pon(?:te)?|hazte|quedate|ven(?:te)?|muevete|pasate|vete|sal|muestrate|go|stay|move|make yourself|be)';
  if (new RegExp(`^(?:${verbo} )?(?:a |en |de )?(?:la )?(?:pantalla completa|full ?screen|grande|en grande|de frente)$`).test(q) && !/^(grande|de frente)$/.test(q)) return 'completa';
  if (new RegExp(`^(?:${verbo} )(?:a mi |al |a un |de |en el |por un |by my |to the |on the )?(?:lado|ladito|costado|side)(?: del chat| de los chats| de la pantalla| of the chat)?$`).test(q)) return 'lado';
  if (/^(?:al lado|a mi lado)(?: del chat| de los chats)?$/.test(q)) return 'lado';
  if (new RegExp(`^(?:${verbo} )(?:(?:mas )?(?:chiquita|chiquito|pequena|pequeno|chica|chico|normal|small)|a caminar)$`).test(q)) return 'paseo';
  if (/^(?:vuelve a caminar|camina|minimizate|achicate|encogete|walk around)$/.test(q)) return 'paseo';
  return null;
}

/** Lo que Laya «comando» sabe de pantallas y sirve aquí (el resto de su lista es del mapa de Electrum). */
const DE_LAYA: Record<string, { accion: AccionApp; dicho: 'silencio' | 'atras' }> = {
  callar: { accion: { tipo: 'silencio', valor: true }, dicho: 'silencio' },
  cerrar: { accion: { tipo: 'atras' }, dicho: 'atras' },
};
/** Las mismas exigencias que server/electrum/comando-voz.ts: la orden gana claro y «ninguna» no le discute. */
const P_MINIMA_LAYA = 0.6;
const P_NINGUNA_MAXIMA_LAYA = 0.45;

/**
 * ¿La frase tiene forma de orden de pantalla? Solo entonces vale la pena preguntarle a Laya: antes se
 * le preguntaba (hasta 350 ms) antes de CADA frase corta que no era orden —«¿qué hora es?», «buenos
 * días a todos»—, y eso se sumaba a la primera palabra de la voz. Una pregunta nunca es orden; una
 * orden de la app habla de callar, hablar, quitar, cerrar, bajar, parar, la pantalla…
 */
export function pareceOrden(texto: string): boolean {
  if (/[?¿]/.test(String(texto || ''))) return false;
  const q = frase(texto);
  if (!q) return false;
  if (/^(que|como|cuando|donde|quien|quienes|cual|cuales|cuanto|cuanta|cuantos|por que|porque|what|how|when|where|who|why|which)\b/.test(q)) return false;
  return /\b(quit|cierr|cerra|call|shh|silenci|habl|baj|sub|par[ae]\b|detente|deten|dej|paus|apag|prend|encend|acerc|alej|pantalla|volumen|ruido|mute|stop|close|quiet|hush|shut)/.test(q);
}

/**
 * El camino rápido entero: reglas primero (sin red); si no casan, la frase es corta y TIENE FORMA de
 * orden, Laya «comando» con un tope corto (la voz no espera). Si Laya no está, tarda o duda, null:
 * contesta el cerebro.
 */
export async function ordenRapida(
  texto: string,
  o: { idioma?: 'es' | 'en'; contexto?: ContextoApp | null; pendiente?: { para: string; texto: string } | null; esperaLayaMs?: number; esCharla?: (t: string) => boolean } = {}
): Promise<OrdenRapida | null> {
  const r = ordenPorReglas(texto, o);
  if (r) return r;
  const q = frase(texto);
  if (!q || q.split(' ').length > 6 || o.esCharla?.(texto) || !pareceOrden(texto)) return null;
  const { resultado } = await consultarModelo('comando', q, { esperaMs: o.esperaLayaMs ?? 350 });
  const id = resultado?.grupos?.accion;
  if (!id || !DE_LAYA[id]) return null;
  const p = Number(resultado!.p?.[id] ?? 0);
  if (p < P_MINIMA_LAYA || Number(resultado!.p?.ninguna ?? 0) > P_NINGUNA_MAXIMA_LAYA) return null;
  const d = DICHOS[o.idioma === 'en' ? 'en' : 'es'];
  return { accion: DE_LAYA[id].accion, decir: d[DE_LAYA[id].dicho], via: 'laya' };
}

/**
 * Lo que pide el cerebro, listo para la app: el nombre dicho se cambia por el correo del contacto si
 * es uno solo (el contrato acepta los dos; el correo no se confunde). Un «enviar» sale SOLO si:
 *  · hay un borrador de AU-RA de un turno ANTERIOR (`pendiente`: el que la persona ya oyó),
 *  · la persona lo confirmó de forma explícita en ESTE mensaje, y
 *  · en la misma respuesta no hay un `redactar` (lo recién redactado nadie lo oyó todavía).
 * Y va siempre al destinatario de ese borrador (`para = pendiente.para`), diga lo que diga el modelo.
 * Enviar por cuenta propia no es de AU-RA.
 */
export function prepararAcciones(acciones: AccionApp[], o: { mensaje: string; contexto?: ContextoApp | null; pendiente?: { para: string; texto: string } | null }): AccionApp[] {
  const out: AccionApp[] = [];
  const contactos = o.contexto?.contactos || [];
  const aCorreo = (nombre: string) => {
    const r = resolverContacto(nombre, contactos);
    return r.tipo === 'uno' ? r.contacto.correo : nombre;
  };
  const conRedactar = acciones.some((a) => a.tipo === 'redactar');
  let enviado = false;
  for (const a of acciones) {
    if (a.tipo === 'enviar') {
      if (enviado || !o.pendiente || conRedactar || !confirmaEnvio(o.mensaje)) continue;
      enviado = true;
      out.push({ tipo: 'enviar', para: o.pendiente.para });
    } else if (a.tipo === 'redactar') out.push({ ...a, para: aCorreo(a.para) });
    else if (a.tipo === 'abrir_chat') out.push({ ...a, con: aCorreo(a.con) });
    else out.push(a);
  }
  return out.slice(0, 4);
}
