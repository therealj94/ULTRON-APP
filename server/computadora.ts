/**
 * LA COMPUTADORA DE LOS AGENTES: el cliente del nodo de scripts/nodo-computadora.
 *
 * José (1-oct): «darle computadora a los agentes… como grokbot… ocupo esto funcione». Cada avatar puede
 * encargarle a su propia computadora en la nube (un escritorio Ubuntu con Firefox y LibreOffice) una
 * tarea de pantalla: buscar y comparar en páginas, llenar un formulario, leer algo que solo se ve
 * navegando. La maneja Holo-3.1-9B en la GPU propia (gratis) o Claude (de pago, si hay clave), según
 * Ajustes (`motorComputadora` del perfil).
 *
 * Una tarea tarda de uno a tres minutos (medido: 11 pasos, 80 s). El turno espera lo que puede
 * (`esperaMs`); si no alcanza, la tarea sigue y el resultado queda guardado para esa persona: se lo dice
 * en el turno siguiente (`avisosPendientes`) y la app lo puede mirar (`/api/computadora/...`).
 *
 * José (2-oct): «le pedí que abriera una página, la abrió y se quedó ahí». Desde entonces, en vivo y
 * hasta el final (el canal de acciones del teléfono, `alAvisarApp`):
 *  · al empezar, el teléfono abre solo la vista en vivo (`empieza`) y pone el tecleo bajito;
 *  · mientras trabaja (ya sin el turno esperando) se le cuentan los avances, uno cada 12 s como mucho
 *    (`paso`: «Ya entré a bch.hn.», «Estoy leyendo la página.»);
 *  · si la tarea no alcanzó (se acabaron los pasos o dice que quedó a medias) la MISIÓN sigue sola con
 *    otra tarea desde donde quedó la pantalla, hasta MAX_CONTINUACIONES (`sigue`); nunca si lo que la paró
 *    fue una clave, un pago o un captcha;
 *  · al terminar, el resultado va al teléfono YA (`termina` con el texto) y AURA lo dice sin esperar el
 *    turno siguiente; si no le llegó a ningún teléfono, queda para el turno siguiente como antes.
 *  · «Abre bch.hn» a secas se le pide al nodo como «…y dime qué hay en la página» (`prepararMision`).
 */
import { nivelDeCorreo } from './nivel';
import crypto from 'node:crypto';
import { clave } from '../lib/boveda';

export type MotorNodo = 'holo' | 'claude';
export type PasoTarea = { n: number; t: number; accion: string; args?: Record<string, unknown>; ms?: number; miniatura?: string | null };
export type EstadoTarea = 'en_cola' | 'trabajando' | 'hecha' | 'parada' | 'sin_pasos' | 'fallo';
export type Tarea = {
  id: string;
  motor: MotorNodo;
  instruccion: string;
  estado: EstadoTarea;
  pasos: PasoTarea[];
  respuesta: string | null;
  error: string | null;
  segundos: number;
};

const TERMINADA = new Set<EstadoTarea>(['hecha', 'parada', 'sin_pasos', 'fallo']);
/** Cada cuánto se pregunta por la tarea mientras se espera. */
const SONDEO_MS = 2000;
/** Tras esto, una tarea que nadie terminó de esperar se deja de seguir. */
const SEGUIR_MAX_MS = 15 * 60_000;

/** Quién es, sin decirle el correo al nodo: le basta para saber si cambió de dueño (y limpiar el escritorio). */
function huellaDe(quien: string): string {
  return crypto.createHash('sha256').update(`computadora|${quien}`).digest('hex').slice(0, 24);
}

function conf() {
  return { url: clave('computadora_url').replace(/\/+$/, ''), clave: clave('computadora_clave') };
}

export function computadoraConfigurada(): boolean {
  const c = conf();
  return !!c.url && !!c.clave;
}

/** Ajustes dice «gratis» o «pago»; el nodo habla de holo o claude. */
export function motorDelPerfil(motor: string | null | undefined, correo?: string): MotorNodo {
  if (motor !== 'pago') return 'holo';
  // El de pago (Claude) cuesta por tarea: es de la junta. A un miembro le corre el gratis aunque lo elija.
  return correo && nivelDeCorreo(correo) === 'miembro' ? 'holo' : 'claude';
}

async function pedir(ruta: string, init: RequestInit & { ms?: number } = {}): Promise<any> {
  const c = conf();
  const r = await fetch(`${c.url}${ruta}`, {
    ...init,
    headers: { authorization: `Bearer ${c.clave}`, 'content-type': 'application/json', ...(init.headers || {}) },
    signal: init.signal ?? AbortSignal.timeout(init.ms ?? 15_000),
  });
  const texto = await r.text();
  let j: any = null;
  try {
    j = texto ? JSON.parse(texto) : null;
  } catch {
    j = null;
  }
  if (!r.ok) throw new Error(String(j?.detail || j?.error || texto || `HTTP ${r.status}`).slice(0, 200));
  return j;
}

/** ¿Contesta el nodo? Qué motores ofrece y si está ocupado. Para Ajustes y la salud del sistema. */
export async function estadoComputadora(): Promise<{ configurada: boolean; ok: boolean; motores: MotorNodo[]; ocupada: boolean; detalle?: string }> {
  if (!computadoraConfigurada()) return { configurada: false, ok: false, motores: [], ocupada: false, detalle: 'Falta COMPUTADORA_URL o COMPUTADORA_CLAVE.' };
  try {
    const j = await pedir('/salud', { ms: 8000 });
    return { configurada: true, ok: !!j?.ok, motores: Array.isArray(j?.motores) ? j.motores : [], ocupada: !!j?.ocupada };
  } catch (e: any) {
    return { configurada: true, ok: false, motores: [], ocupada: false, detalle: String(e?.message || e).slice(0, 160) };
  }
}

export async function verTarea(id: string, miniaturas = false, ms = 10_000, senal?: AbortSignal): Promise<Tarea> {
  const tope = AbortSignal.timeout(Math.max(1, ms));
  return pedir(`/tareas/${encodeURIComponent(id)}${miniaturas ? '?miniaturas=1' : ''}`, { signal: senal ? AbortSignal.any([senal, tope]) : tope });
}

export async function pararTarea(id: string): Promise<void> {
  await pedir(`/tareas/${encodeURIComponent(id)}/parar`, { method: 'POST', ms: 8000 });
}

export async function pantallaComputadora(): Promise<Buffer> {
  const c = conf();
  const r = await fetch(`${c.url}/pantalla`, { headers: { authorization: `Bearer ${c.clave}` }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

/* ------------------------------------------------------------------ de quién es cada tarea */

/**
 * Un encargo: una tarea del nodo y de quién es. Una MISIÓN puede ser varias tareas seguidas (`vuelta`
 * 0, 1, 2…): si una no alcanzó, la siguiente sigue desde donde quedó la pantalla. `instruccion` es
 * siempre la misión tal como se pidió (lo que se le cuenta a la persona); al nodo le va `paraNodo`.
 */
type Encargo = {
  id: string;
  quien: string;
  instruccion: string;
  creada: number;
  terminada?: Tarea;
  avisada?: boolean;
  /** El teléfono del turno (x-aura-aparato): ahí se abre la vista en vivo. null: todos los de la cuenta. */
  aparato: string | null;
  idioma: 'es' | 'en';
  motor: MotorNodo;
  maxPasos: number;
  /** Cuántas tareas van en esta misión antes de esta (0: la primera). */
  vuelta: number;
  /** Cuándo el turno dejó de esperarla (desde ahí se narra y se avisa al terminar). */
  soltada?: number;
  /** Alguien ya decidió qué hacer con su final (el turno o el seguimiento): no se hace dos veces. */
  cerrada?: boolean;
  /** El último paso que se contó en voz, cuándo y cuántas frases van. */
  narrado: number;
  ultimaVoz: number;
  dichas: number;
  ultimaFrase?: string;
  /** Cuántas veces se contó cada acción (para variar la frase: «Estoy leyendo», «Sigo leyendo»…). */
  porAccion: Record<string, number>;
};
const ENCARGOS = new Map<string, Encargo>();
/** La última tarea de cada persona (para la app). */
const ULTIMA = new Map<string, string>();
/**
 * Las tareas de cada persona que siguieron después de que su turno dejó de esperar y que todavía no se
 * le contaron. Todas: una segunda tarea no tapa a la primera.
 */
const PENDIENTES = new Map<string, Set<string>>();

/* ------------------------------------------------------------------ la app en vivo */

/**
 * Lo que su computadora le cuenta al teléfono (lib/acciones-app.ts, AccionComputadora): `empieza` abre
 * la vista en vivo, `paso` es una frase corta de avance, `sigue` otra tarea de la misma misión y
 * `termina` el final (con `texto`, el resultado para decirlo; sin él, ya lo dijo el turno).
 */
export type FaseAviso = 'empieza' | 'paso' | 'sigue' | 'termina';
export type AvisoApp = { tipo: 'computadora'; fase: FaseAviso; id: string; texto?: string; ok?: boolean };
/** Empuja el aviso al canal de acciones (server.ts: empujarAccion) y dice a cuántos teléfonos llegó. */
export type AvisadorApp = (quien: string, aviso: AvisoApp, aparato: string | null) => number;
let avisador: AvisadorApp | null = null;

/** server.ts conecta el canal de acciones del teléfono (las pruebas, un espía). null lo desconecta. */
export function alAvisarApp(f: AvisadorApp | null) {
  avisador = f;
}

/** Al aparato del turno; con `todos`, si ese no está escuchando, a cualquier teléfono de la cuenta. */
function avisarApp(e: Encargo, aviso: AvisoApp, todos = false): number {
  if (!avisador) return 0;
  try {
    let n = avisador(e.quien, aviso, e.aparato);
    if (!n && todos && e.aparato) n = avisador(e.quien, aviso, null);
    return n;
  } catch {
    return 0;
  }
}

/**
 * Los tiempos del seguimiento (las pruebas los acortan):
 *  · sondeoMs: cada cuánto se mira la tarea después de que el turno la soltó;
 *  · silencioTrasTurnoMs: tras soltarla, este rato callado (que se oiga lo que el turno contestó);
 *  · narrarCadaMs: entre una frase de avance y la siguiente, como mínimo (sin llenar la conversación);
 *  · trabajandoCadaMs: sin pasos nuevos en este rato, «sigo trabajando».
 */
export const TIEMPOS_SEGUIR = { sondeoMs: 3000, silencioTrasTurnoMs: 8000, narrarCadaMs: 12_000, trabajandoCadaMs: 35_000 };
/** Frases de avance por tarea, como mucho. */
export const MAX_FRASES = 8;
/** Tareas de más que una misión puede encadenar cuando una no alcanzó. */
export const MAX_CONTINUACIONES = 3;

export function duenoDe(id: string): string | null {
  return ENCARGOS.get(id)?.quien ?? null;
}

/** La misión tal como se pidió (sin lo que se le agregó para el nodo). */
export function misionDe(id: string): string | null {
  return ENCARGOS.get(id)?.instruccion ?? null;
}

export function ultimaTareaDe(quien: string): string | null {
  return ULTIMA.get(quien) ?? null;
}

export function pendientesDe(quien: string): string[] {
  return [...(PENDIENTES.get(quien) ?? [])];
}

/**
 * Lo que terminó después de que el turno dejó de esperar y todavía no se le dijo: va como HECHO en el
 * turno siguiente de esa persona. Solo se mira: se da por dicho con `confirmarAvisos` cuando el modelo
 * de verdad contestó con esos hechos (un «hola» que contesta el banco o el modelo chico no los lleva).
 * Si el teléfono lo recibió al terminar (y AURA lo dijo), ya no está aquí.
 */
export function avisosPendientes(quien: string): { ids: string[]; hecho: string } | null {
  const listas = pendientesDe(quien)
    .map((id) => ENCARGOS.get(id))
    .filter((e): e is Encargo => !!e?.terminada && !e.avisada);
  if (!listas.length) return null;
  const partes = listas.map((e) => `«${e.instruccion.slice(0, 160)}»: ${resumenTarea(e.terminada!)}`);
  return {
    ids: listas.map((e) => e.id),
    hecho: `COMPUTADORA (terminó lo que te encargaron antes) ${partes.join(' · ')} Díselo al empezar, en una o dos frases.`,
  };
}

/** Ya se le dijo: no se vuelve a contar. */
export function confirmarAvisos(quien: string, ids: readonly string[]) {
  const set = PENDIENTES.get(quien);
  for (const id of ids) {
    const e = ENCARGOS.get(id);
    if (e) e.avisada = true;
    set?.delete(id);
  }
  if (set && !set.size) PENDIENTES.delete(quien);
}

function anotarPendiente(e: Encargo) {
  if (!PENDIENTES.has(e.quien)) PENDIENTES.set(e.quien, new Set());
  PENDIENTES.get(e.quien)!.add(e.id);
}

/* ------------------------------------------------------------------ la misión: completa y hasta el final */

const RE_SOLO_ABRIR = /^(?:abre|abrir|abreme|ábreme|entrar? (?:a|en)|ve a|ir a|visita|open|go to|visit)\s+(.+)$/i;
/** Lo que dice que hay algo más que hacer después de abrir: entonces la misión ya está completa. */
const RE_HAY_MAS = /\b(y|e|and|para|dime|busca|buscar|compara|saca|llena|lee|revisa|cuenta|tell|find|search|compare|read|check|luego|despu[eé]s|then)\b|[,;:]/i;

/**
 * Lo que va al nodo. «Abre bch.hn» y nada más dejaba la página abierta y la tarea «hecha» en dos pasos
 * (José, 2-oct: «abrió la página y se quedó ahí»): se le pide además contar qué hay en ella.
 */
export function prepararMision(instruccion: string, idioma: 'es' | 'en' = 'es'): string {
  const t = String(instruccion || '').replace(/\s+/g, ' ').trim();
  const m = RE_SOLO_ABRIR.exec(t);
  // Solo «abre <sitio>» (unas pocas palabras, sin «y dime…»): lo demás ya dice qué traer.
  if (!m || RE_HAY_MAS.test(m[1]) || m[1].split(' ').length > 6) return t;
  const sin = t.replace(/[.\s]+$/, '');
  return idioma === 'en'
    ? `${sin}, and once it loads, tell me in two or three sentences what the page shows (the main things on it).`
    : `${sin}, y cuando cargue dime en dos o tres frases qué hay en la página (lo principal que se ve).`;
}

/** «No terminé», «me faltó», «couldn't finish»: la respuesta dice que quedó a medias. */
const RE_INCOMPLETA =
  /\b(no (pude|logr[eé]|alcanc[eé]) (a )?(terminar|completar|acabar)|no (termin[eé]|complet[eé]|acab[eé])|qued[oó] (a medias|incomplet[ao])|incomplet[ao]|me falt[oó]|faltan? (pasos|por hacer)|todav[ií]a no (termin|acab)|ran out of steps|(could ?not|couldn'?t|was(n'?t| not) able to) (finish|complete)|did(n'?t| not) (finish|complete)|not (yet )?(finished|completed?)|incomplete|only partially)\b/i;
/** Lo que la detuvo a propósito (una clave, un pago, un captcha): eso no se insiste, se le dice. */
const RE_BLOQUEO =
  /contrase|password|clave de acceso|iniciar? sesi|inicio de sesi|log ?in\b|sign ?in|captcha|no soy un robot|robot|pag(o|ar)\b|tarjeta|comprar?\b|compra\b|payment|\bpay\b|credit card|checkout|verificaci[oó]n en dos|two.factor|2fa|permiso|permission/i;

/**
 * ¿La misión tiene que seguir con otra tarea? Solo si se acabaron los pasos o la respuesta dice que
 * quedó a medias, y nunca si lo que la paró fue una clave, un pago o un captcha (eso no lo hace).
 * Parada (la persona la paró) o falla del nodo: no se insiste.
 */
export function misionIncompleta(t: Pick<Tarea, 'estado' | 'respuesta' | 'error'>): boolean {
  const texto = `${t.respuesta || ''} ${t.error || ''}`;
  if (RE_BLOQUEO.test(texto)) return false;
  if (t.estado === 'sin_pasos') return true;
  if (t.estado !== 'hecha') return false;
  return !String(t.respuesta || '').trim() || RE_INCOMPLETA.test(String(t.respuesta || ''));
}

/** La tarea que sigue la misión: desde donde quedó la pantalla (el escritorio es el mismo), sin empezar de cero. */
export function instruccionContinuar(mision: string, t: Pick<Tarea, 'pasos'>, idioma: 'es' | 'en' = 'es'): string {
  const hechos = t.pasos
    .filter((p) => p.accion !== 'escritorio_limpio' && p.accion !== 'answer')
    .slice(-4)
    .map((p) => pasoEnPalabras(p, idioma));
  const m = mision.slice(0, 900);
  if (idioma === 'en') {
    return `Continue this mission from where the screen is now, without starting over: «${m}».${hechos.length ? ` The last things you did: ${hechos.join('; ')}.` : ''} Finish the whole mission and answer with the concrete result that was asked for.`;
  }
  return `Sigue con esta misión desde donde está la pantalla ahora, sin empezar de cero: «${m}».${hechos.length ? ` Lo último que hiciste: ${hechos.join('; ')}.` : ''} Termina la misión completa y responde con el resultado concreto que se pidió.`;
}

/* ------------------------------------------------------------------ lo que se dice mientras trabaja */

function dominio(url: unknown): string {
  const t = String(url ?? '').trim().replace(/^[a-z]+:\/\//i, '').replace(/^www\./i, '');
  return t.split(/[/?#]/)[0].slice(0, 40) || t.slice(0, 40);
}

/**
 * La frase corta de un avance, para decirla en voz («Ya entré a bch.hn.», «Estoy leyendo la página.»).
 * `i` cambia la frase entre las que dicen lo mismo (no repetir «sigo leyendo» tres veces).
 */
export function fraseDePaso(p: Pick<PasoTarea, 'accion' | 'args'>, idioma: 'es' | 'en' = 'es', i = 0): string {
  const a = (p.args || {}) as Record<string, any>;
  const en = idioma === 'en';
  const una = (xs: string[]) => xs[Math.abs(i) % xs.length];
  const corto = (x: unknown, n = 40) => {
    const t = String(x ?? '').replace(/\s+/g, ' ').trim();
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
  };
  switch (p.accion) {
    case 'open_url':
      return en ? `I'm on ${dominio(a.url)} now.` : `Ya entré a ${dominio(a.url)}.`;
    case 'type':
      return a.text ? (en ? `I'm typing «${corto(a.text)}».` : `Estoy escribiendo «${corto(a.text)}».`) : en ? "I'm typing." : 'Estoy escribiendo.';
    case 'click':
    case 'double_click':
      return a.element
        ? en ? `I clicked «${corto(a.element, 30)}».` : `Toqué «${corto(a.element, 30)}».`
        : una(en ? ["I'm opening what I found.", "I'm moving through the page."] : ['Estoy abriendo lo que encontré.', 'Sigo navegando en la página.']);
    case 'scroll':
      return una(en ? ["I'm reading the page.", "I'm still reading…", "I'm going through the results…"] : ['Estoy leyendo la página.', 'Sigo leyendo…', 'Analizando los resultados…']);
    case 'wait':
      return en ? 'Waiting for the page to load.' : 'Esperando a que cargue la página.';
    case 'nada':
      return en ? "I'm looking at what's on the screen." : 'Estoy analizando lo que veo.';
    case 'key':
      return una(en ? ["I'm moving through the page.", 'Still working on it.'] : ['Sigo navegando.', 'Sigo en eso.']);
    default:
      return en ? "I'm still working on it." : 'Sigo trabajando en eso.';
  }
}

/** El final, para decirlo en voz sin pasar por el cerebro (el teléfono lo dice tal cual). */
export function fraseDeFinal(mision: string, t: Tarea, idioma: 'es' | 'en' = 'es'): string {
  const en = idioma === 'en';
  const corto = (x: unknown, n: number) => {
    const s = String(x ?? '').replace(/\s+/g, ' ').trim();
    return s.length > n ? `${s.slice(0, n - 1)}…` : s;
  };
  if (t.estado === 'hecha') {
    const r = corto(t.respuesta, 650);
    return r ? (en ? `Done, I finished on my computer. ${r}` : `Listo, ya terminé en mi computadora. ${r}`) : en ? 'Done, I finished on my computer.' : 'Listo, ya terminé en mi computadora.';
  }
  if (t.estado === 'sin_pasos') {
    const u = [...t.pasos].reverse().find((p) => p.accion !== 'answer' && p.accion !== 'escritorio_limpio');
    const donde = u ? ` ${en ? 'I stopped at' : 'Me quedé en'}: ${pasoEnPalabras(u, idioma).toLowerCase()}.` : '';
    return en ? `I couldn't finish «${corto(mision, 80)}» on my computer.${donde} Want me to keep going?` : `No alcancé a terminar «${corto(mision, 80)}» en mi computadora.${donde} ¿Sigo?`;
  }
  if (t.estado === 'fallo') return en ? `My computer failed: ${corto(t.error || 'no details', 120)}.` : `Mi computadora falló: ${corto(t.error || 'sin detalle', 120)}.`;
  return en ? 'I stopped the computer task.' : 'Paré lo de mi computadora.';
}

/* ------------------------------------------------------------------ seguir la tarea hasta el final */

/**
 * El seguimiento de cada tarea, desde que se encarga: mientras el turno la espera no hace nada (el turno
 * ya la mira); en cuanto la suelta, la mira cada TIEMPOS_SEGUIR.sondeoMs, le cuenta los avances al teléfono y, al
 * terminar, decide: seguir la misión con otra tarea o avisar el final YA (no en el turno siguiente).
 */
function seguir(e: Encargo) {
  const hasta = e.creada + SEGUIR_MAX_MS;
  const vuelta = async () => {
    // Terminó, se pasó del tope o se olvidó (las pruebas): ya no se sigue.
    if (Date.now() > hasta || e.cerrada || ENCARGOS.get(e.id) !== e) return;
    if (e.soltada) {
      try {
        const t = await verTarea(e.id);
        if (TERMINADA.has(t.estado)) {
          if (!e.cerrada) await alTerminar(e, t, false);
          return;
        }
        narrar(e, t);
      } catch {
        /* el nodo no contestó esta vez: se vuelve a probar */
      }
    }
    setTimeout(vuelta, TIEMPOS_SEGUIR.sondeoMs).unref?.();
  };
  setTimeout(vuelta, TIEMPOS_SEGUIR.sondeoMs).unref?.();
}

/** Un avance nuevo (o «sigo trabajando» si tarda), como mucho cada TIEMPOS_SEGUIR.narrarCadaMs y sin repetir. */
function narrar(e: Encargo, t: Tarea, ahora = Date.now()) {
  if (!e.soltada || ahora - e.soltada < TIEMPOS_SEGUIR.silencioTrasTurnoMs) return;
  if (ahora - e.ultimaVoz < TIEMPOS_SEGUIR.narrarCadaMs || e.dichas >= MAX_FRASES) return;
  const utiles = t.pasos.filter((p) => p.accion !== 'escritorio_limpio' && p.accion !== 'answer');
  const nuevo = utiles.length ? utiles[utiles.length - 1] : null;
  let texto = '';
  if (nuevo && nuevo.n > e.narrado) {
    e.narrado = nuevo.n;
    const vez = e.porAccion[nuevo.accion] ?? 0;
    e.porAccion[nuevo.accion] = vez + 1;
    texto = fraseDePaso(nuevo, e.idioma, vez);
  } else if (ahora - Math.max(e.ultimaVoz, e.soltada) >= TIEMPOS_SEGUIR.trabajandoCadaMs) {
    texto = e.idioma === 'en' ? "I'm still working on my computer." : 'Sigo trabajando en mi computadora.';
  }
  if (!texto || texto === e.ultimaFrase) return;
  e.ultimaFrase = texto;
  e.ultimaVoz = ahora;
  e.dichas++;
  avisarApp(e, { tipo: 'computadora', fase: 'paso', id: e.id, texto });
}

/**
 * La tarea terminó. Si la misión quedó a medias (y no fue por una clave, un pago o un captcha), sigue con
 * otra tarea desde donde quedó, hasta MAX_CONTINUACIONES. Si no, el final: con `enTurno` lo dice el turno
 * (el teléfono solo se entera); si no, se le empuja al teléfono para que AURA lo diga ya, y si le llegó,
 * ya no queda para el turno siguiente.
 */
async function alTerminar(e: Encargo, t: Tarea, enTurno: boolean): Promise<{ sigue: Encargo | null }> {
  e.cerrada = true;
  e.terminada = t;
  if (misionIncompleta(t) && e.vuelta < MAX_CONTINUACIONES) {
    const e2 = await crearEncargo({
      instruccion: e.instruccion,
      paraNodo: instruccionContinuar(e.instruccion, t, e.idioma),
      quien: e.quien,
      motor: e.motor,
      aparato: e.aparato,
      idioma: e.idioma,
      maxPasos: e.maxPasos,
      vuelta: e.vuelta + 1,
    }).catch(() => null);
    if (e2) {
      // Esta ya no se cuenta sola: el final de la misión es el de la que sigue.
      e.avisada = true;
      confirmarAvisos(e.quien, [e.id]);
      e2.soltada = Date.now();
      e2.ultimaVoz = e2.soltada; // el «sigo con la misión» ya se dijo
      anotarPendiente(e2);
      // En el turno lo dice el cerebro (el HECHO lo cuenta); después, el teléfono.
      const dicho = e.idioma === 'en' ? 'I need a bit more; I keep going.' : 'Me falta un poco; sigo con la misión.';
      avisarApp(e2, { tipo: 'computadora', fase: 'sigue', id: e2.id, ...(enTurno ? {} : { texto: dicho }) });
      return { sigue: e2 };
    }
  }
  if (enTurno || t.estado === 'parada') {
    e.avisada = true;
    confirmarAvisos(e.quien, [e.id]);
    avisarApp(e, { tipo: 'computadora', fase: 'termina', id: e.id, ok: t.estado === 'hecha' });
    return { sigue: null };
  }
  const llego = avisarApp(e, { tipo: 'computadora', fase: 'termina', id: e.id, ok: t.estado === 'hecha' && !misionIncompleta(t), texto: fraseDeFinal(e.instruccion, t, e.idioma) }, true);
  if (llego) confirmarAvisos(e.quien, [e.id]);
  return { sigue: null };
}

/** Pide la tarea al nodo y la anota (de quién, su última, su seguimiento). */
async function crearEncargo(o: {
  instruccion: string;
  paraNodo: string;
  quien: string;
  motor: MotorNodo;
  aparato: string | null;
  idioma: 'es' | 'en';
  maxPasos: number;
  vuelta: number;
}): Promise<Encargo> {
  const creada: { id: string } = await pedir('/tareas', { method: 'POST', body: JSON.stringify({ instruccion: o.paraNodo, motor: o.motor, max_pasos: o.maxPasos, dueno: huellaDe(o.quien) }) });
  const e: Encargo = { id: creada.id, quien: o.quien, instruccion: o.instruccion, creada: Date.now(), aparato: o.aparato, idioma: o.idioma, motor: o.motor, maxPasos: o.maxPasos, vuelta: o.vuelta, narrado: 0, ultimaVoz: 0, dichas: 0, porAccion: {} };
  ENCARGOS.set(e.id, e);
  ULTIMA.set(o.quien, e.id);
  seguir(e);
  return e;
}

/** El resultado contado para el modelo: qué pasó, en cuántos pasos, y la respuesta tal cual. */
export function resumenTarea(t: Tarea): string {
  const pasos = t.pasos.filter((p) => p.accion !== 'answer' && p.accion !== 'escritorio_limpio').length;
  if (t.estado === 'hecha') return `Hecha en ${pasos} pasos (${Math.round(t.segundos)} s). Lo que encontró o hizo: ${String(t.respuesta || '').slice(0, 1500)}`;
  if (t.estado === 'parada') return 'La pararon antes de terminar.';
  if (t.estado === 'sin_pasos') return `No la terminó en ${pasos} pasos. ${t.error || ''}`.trim();
  return `Falló: ${t.error || 'sin detalle'}.`;
}

/**
 * Encarga una tarea y espera hasta `esperaMs`. Si termina, el HECHO lleva el resultado; si no, dice que
 * sigue (y en qué paso va) y la tarea se sigue mirando: se narra en el teléfono y su final se le dice
 * en cuanto llegue. Al empezar, el teléfono abre la vista en vivo (`empieza`).
 */
export async function encargarTarea(o: {
  instruccion: string;
  quien: string;
  motor: MotorNodo;
  esperaMs: number;
  senal?: AbortSignal;
  maxPasos?: number;
  /** El teléfono del turno (x-aura-aparato). */
  aparato?: string | null;
  idioma?: 'es' | 'en';
}): Promise<{ hecho: string; id: string | null; tarea: Tarea | null }> {
  if (!computadoraConfigurada()) {
    return { hecho: 'HARNESS computadora: no está configurada en este servidor. No la usé; dilo con naturalidad.', id: null, tarea: null };
  }
  const idioma: 'es' | 'en' = o.idioma === 'en' ? 'en' : 'es';
  const instruccion = String(o.instruccion || '').replace(/\s+/g, ' ').trim();
  let e: Encargo;
  let nota = '';
  const base = { instruccion, paraNodo: prepararMision(instruccion, idioma), quien: o.quien, aparato: o.aparato ?? null, idioma, maxPasos: o.maxPasos ?? 25, vuelta: 0 };
  try {
    try {
      e = await crearEncargo({ ...base, motor: o.motor });
    } catch (err: any) {
      // Eligió Claude en Ajustes pero el nodo no tiene su clave: la hace la gratis, y se dice.
      if (o.motor !== 'claude' || !/claude/i.test(String(err?.message || ''))) throw err;
      e = await crearEncargo({ ...base, motor: 'holo' });
      nota = ' (La hizo el modelo gratis: Claude no está configurado en la computadora.)';
    }
  } catch (err: any) {
    return { hecho: `HARNESS computadora: no pude encargarla (${String(err?.message || err).slice(0, 120)}). No inventes el resultado.`, id: null, tarea: null };
  }
  // El teléfono abre la vista en vivo: la captura, los pasos en palabras y el tecleo bajito.
  const enVivo = avisarApp(e, { tipo: 'computadora', fase: 'empieza', id: e.id }) > 0;
  const mira = enVivo
    ? 'En su teléfono ya se abrió sola la vista en vivo de tu computadora: dile que mire la pantalla, que le vas contando y que le dices el resultado en cuanto termine.'
    : 'Puede mirarla en vivo en la app, en «Más → Su computadora»; le dices el resultado en cuanto termine.';
  const hasta = Date.now() + Math.max(0, o.esperaMs);
  let t: Tarea | null = null;
  // El plazo es de verdad: ni la pausa ni la consulta se pasan de lo que queda (ni de la interrupción).
  while (Date.now() < hasta && !o.senal?.aborted) {
    await esperar(Math.min(SONDEO_MS, hasta - Date.now()), o.senal);
    const queda = hasta - Date.now();
    if (queda <= 0 || o.senal?.aborted) break;
    try {
      t = await verTarea(e.id, false, Math.min(10_000, queda), o.senal);
    } catch {
      continue;
    }
    if (TERMINADA.has(t.estado) && !e.cerrada) {
      const { sigue } = await alTerminar(e, t, true);
      if (sigue) {
        return {
          hecho:
            `HARNESS computadora «${instruccion.slice(0, 160)}»: la primera parte no alcanzó (${resumenTarea(t).slice(0, 200)}) y ya sigue sola en tu computadora con lo que falta.${nota} ` +
            `Di que sigues trabajando en eso. ${mira} No inventes el resultado.`,
          id: sigue.id,
          tarea: t,
        };
      }
      return { hecho: `HARNESS computadora «${instruccion.slice(0, 160)}»: ${resumenTarea(t)}${nota}`, id: e.id, tarea: t };
    }
  }
  if (!e.cerrada) {
    e.soltada = Date.now();
    anotarPendiente(e);
  }
  const ultimo = t?.pasos?.[t.pasos.length - 1];
  const vaEn = ultimo ? ` Va en el paso ${ultimo.n} (${pasoEnPalabras(ultimo)}).` : '';
  return {
    hecho:
      `HARNESS computadora «${instruccion.slice(0, 160)}»: la tarea sigue en tu computadora.${vaEn}${nota} ` +
      `Di que ya la estás haciendo («ya la estoy usando, mira la pantalla»). ${mira} No inventes el resultado.`,
    id: e.id,
    tarea: t,
  };
}

function esperar(ms: number, senal?: AbortSignal): Promise<void> {
  return new Promise((r) => {
    if (ms <= 0 || senal?.aborted) return r();
    const t = setTimeout(r, ms);
    senal?.addEventListener('abort', () => (clearTimeout(t), r()), { once: true });
  });
}

/** Su última tarea, en corto (sin capturas): para el aviso de la mesa «tu computadora está trabajando». */
export async function resumenUltima(quien: string): Promise<{ id: string; estado: EstadoTarea; pasos: number; instruccion: string; ultimo: string | null } | null> {
  const id = ultimaTareaDe(quien);
  if (!id) return null;
  try {
    const t = await verTarea(id, false, 5000);
    const u = t.pasos[t.pasos.length - 1];
    return { id, estado: t.estado, pasos: t.pasos.length, instruccion: (misionDe(id) || t.instruccion).slice(0, 200), ultimo: u ? pasoEnPalabras(u) : null };
  } catch {
    return null;
  }
}

/** Pruebas: olvidar los encargos. */
export function _olvidarEncargos() {
  ENCARGOS.clear();
  ULTIMA.clear();
  PENDIENTES.clear();
}

/* ------------------------------------------------------------------ rutas para la app y la web */

type DepsRutas = {
  exigirMesa: import('express').RequestHandler;
  limitar: (max: number, ventanaMs?: number, grupo?: string) => import('express').RequestHandler;
  sesionDe: (req: import('express').Request) => { correo: string } | null;
  /** Qué motor eligió en Ajustes («gratis» o «pago»); sin perfil, gratis. */
  motorDe?: (correo: string) => Promise<string | null | undefined>;
};

/**
 * La tarea para la app: con la captura SOLO del último paso (lo que la computadora está viendo ahora),
 * o la del paso que se pidió (`paso`). Todas juntas pesaban casi 1 MB en cada consulta.
 */
export function tareaParaApp(t: Tarea, paso?: number): Tarea {
  // Sin `paso`: el último paso con captura («escritorio_limpio» no trae): lo más reciente que vio.
  const mostrar = Number.isFinite(paso) ? Number(paso) : ([...t.pasos].reverse().find((p) => p.miniatura)?.n ?? -1);
  return { ...t, pasos: t.pasos.map((p) => (p.n === mostrar ? p : { ...p, miniatura: undefined })) };
}

/** Lo que dice cada paso, en palabras de persona (la app lo muestra en la lista de pasos). */
export function pasoEnPalabras(p: Pick<PasoTarea, 'accion' | 'args'>, idioma: 'es' | 'en' = 'es'): string {
  const a = (p.args || {}) as Record<string, any>;
  const en = idioma === 'en';
  const corto = (x: unknown, n = 60) => {
    const t = String(x ?? '').replace(/\s+/g, ' ').trim();
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
  };
  switch (p.accion) {
    case 'escritorio_limpio':
      return en ? 'Started a clean desktop' : 'Abrió un escritorio limpio';
    case 'open_url':
      return en ? `Opened ${corto(a.url)}` : `Abrió ${corto(a.url)}`;
    case 'click':
      return a.element ? (en ? `Clicked «${corto(a.element, 40)}»` : `Tocó «${corto(a.element, 40)}»`) : en ? 'Clicked' : 'Hizo clic';
    case 'double_click':
      return en ? 'Double-clicked' : 'Hizo doble clic';
    case 'right_click':
      return en ? 'Right-clicked' : 'Hizo clic derecho';
    case 'type':
      return en ? `Typed «${corto(a.text, 50)}»${a.press_enter ? ' and pressed Enter' : ''}` : `Escribió «${corto(a.text, 50)}»${a.press_enter ? ' y dio Enter' : ''}`;
    case 'key':
      return en ? `Pressed ${corto(a.keys, 30)}` : `Presionó ${corto(a.keys, 30)}`;
    case 'scroll':
      return a.direction === 'up' ? (en ? 'Scrolled up' : 'Subió en la página') : en ? 'Scrolled down' : 'Bajó en la página';
    case 'drag':
      return en ? 'Dragged' : 'Arrastró';
    case 'wait':
      return en ? 'Waited for the page' : 'Esperó a que cargara';
    case 'answer':
      return en ? 'Finished and reported' : 'Terminó y dio el resultado';
    case 'nada':
      return en ? 'Looked at the screen' : 'Miró la pantalla';
    default:
      return corto(p.accion, 40);
  }
}

/**
 * Lo que la app muestra de su computadora: si está, qué motores ofrece, su última tarea con las
 * capturas de cada paso, y el botón de pararla. Cada quien ve solo sus tareas.
 *   GET  /api/computadora            → { configurada, ok, motores, ocupada, ultima }
 *   GET  /api/computadora/tareas/:id → la tarea con miniaturas (si es suya)
 *   POST /api/computadora/tareas/:id/parar
 */
export function montarRutasComputadora(app: import('express').Express, d: DepsRutas) {
  const correoDe = (req: import('express').Request) => String(d.sesionDe(req)?.correo || '').toLowerCase();
  const sinSesion = (res: import('express').Response) => res.status(401).json({ error: 'Entra con tu sesión.', code: 'sesion_requerida', honesto: true });

  app.get('/api/computadora', d.exigirMesa, d.limitar(40), async (req, res) => {
    const correo = correoDe(req);
    if (!correo) return sinSesion(res);
    const [estado, actual] = await Promise.all([estadoComputadora(), resumenUltima(correo)]);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ...estado, ultima: ultimaTareaDe(correo), actual, pendientes: pendientesDe(correo), honesto: true });
  });

  /**
   * La persona le encarga algo a su computadora desde la app (sin pasar por la conversación). No espera:
   * la app mira los pasos en vivo, y si termina sin que la mire, el avatar se lo cuenta en el turno siguiente.
   */
  app.post('/api/computadora/tareas', d.exigirMesa, d.limitar(8), async (req, res) => {
    const correo = correoDe(req);
    if (!correo) return sinSesion(res);
    const instruccion = String(req.body?.instruccion || '').replace(/\s+/g, ' ').trim();
    if (instruccion.length < 4) return res.status(400).json({ error: 'Dile qué hacer (una frase con lo que quieres).', honesto: true });
    if (instruccion.length > 600) return res.status(400).json({ error: 'Muy largo: dilo en menos de 600 letras.', honesto: true });
    const motor = motorDelPerfil(await d.motorDe?.(correo).catch(() => null), correo);
    // El teléfono que la pidió (el mismo id de aparato que usa el canal de acciones): ahí se narra y se avisa.
    const aparato = String(req.headers['x-aura-aparato'] || '').trim();
    const idioma = req.body?.idioma === 'en' ? 'en' : 'es';
    const r = await encargarTarea({ instruccion, quien: correo, motor, esperaMs: 0, aparato: /^[A-Za-z0-9._:-]{1,128}$/.test(aparato) ? aparato : null, idioma });
    if (!r.id) return res.status(503).json({ error: r.hecho.replace(/^HARNESS computadora:\s*/, '').replace(/\s*(No inventes.*|No la usé.*|dilo con naturalidad\.?)$/i, ''), honesto: true });
    return res.json({ id: r.id, honesto: true });
  });

  app.get('/api/computadora/tareas/:id', d.exigirMesa, d.limitar(90), async (req, res) => {
    const correo = correoDe(req);
    if (!correo) return sinSesion(res);
    if (duenoDe(req.params.id) !== correo) return res.status(404).json({ error: 'No encuentro esa tarea.', honesto: true });
    try {
      res.setHeader('Cache-Control', 'no-store');
      const paso = req.query.paso != null ? Number(req.query.paso) : undefined;
      const crudo = await verTarea(req.params.id, true);
      // La misión como se pidió (al nodo le pudo ir con «sigue desde donde quedó…» o con «dime qué hay»).
      const t = tareaParaApp({ ...crudo, instruccion: misionDe(req.params.id) || crudo.instruccion }, paso);
      const idioma = req.query.idioma === 'en' ? 'en' : 'es';
      return res.json({ tarea: { ...t, pasos: t.pasos.map((p) => ({ ...p, texto: pasoEnPalabras(p, idioma) })) }, honesto: true });
    } catch (e: any) {
      return res.status(502).json({ error: `La computadora no contestó (${String(e?.message || e).slice(0, 80)}).`, honesto: true });
    }
  });

  app.post('/api/computadora/tareas/:id/parar', d.exigirMesa, d.limitar(20), async (req, res) => {
    const correo = correoDe(req);
    if (!correo) return sinSesion(res);
    if (duenoDe(req.params.id) !== correo) return res.status(404).json({ error: 'No encuentro esa tarea.', honesto: true });
    try {
      await pararTarea(req.params.id);
      return res.json({ ok: true, honesto: true });
    } catch (e: any) {
      return res.status(502).json({ error: `No pude pararla (${String(e?.message || e).slice(0, 80)}).`, honesto: true });
    }
  });
}
