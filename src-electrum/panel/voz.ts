/**
 * LA VOZ DE DR ELECTRUM EN LA WEB.
 *
 * Antes: se esperaba la respuesta entera, se mandaban sus primeros 1200 caracteres a sintetizar de
 * una sola vez y se reproducía. Una respuesta larga se cortaba a media frase, y si la síntesis
 * fallaba no se decía nada: la persona creía que el doctor era mudo.
 *
 * Ahora:
 *  · La respuesta se parte en trozos de una o dos frases. El primero se pide al instante y suena en
 *    cuanto llega; mientras suena, ya se está pidiendo el siguiente. Se oye la respuesta ENTERA y
 *    empieza antes.
 *  · Un solo reproductor, desbloqueado al tocar algo: Safari y Chrome en teléfono no dejan sonar
 *    audio que no nace de un toque, y un `new Audio()` creado cuando llega la respuesta (segundos
 *    después del toque) se queda mudo sin error.
 *  · Si la voz falla se dice una vez, con el motivo del servidor.
 *  · `callar()` corta lo que suena e invalida lo que viene en camino.
 *  · EN VIVO (como AU-RA): `crearLocucion` dice cada frase de la respuesta en cuanto el turno la manda,
 *    sin esperar al final. La primera va con `primera: true` (el servidor la sintetiza con el modelo
 *    rápido) y mientras suena una ya se pide la siguiente.
 *  · Lleva la cuenta de lo que va diciendo (RegistroVoz, el mismo de AU-RA): el oído no toma su eco por
 *    la persona y, si lo interrumpen, se sabe qué alcanzó a oír (`interrumpido.oido` del turno siguiente).
 *  · Interrumpirlo lo calla bajando la voz en 160 ms, no a cuchillo; mientras se confirma si de verdad le
 *    hablan, la voz se PAUSA (o baja) y, si era su eco o un «ajá», sigue donde estaba.
 */

import { guardarPreferencia, leerPreferencia } from '../preferencias';
import { idiomaActual } from './idioma';
import { detectarIdioma } from '../../lib/idioma-detectar';
import { cortarFrases } from '../../src/03-voz/frases';
import { RegistroVoz } from '../../mobile/src/lib/interrupcion';
import { juntarFrases } from './frasesTurno';

/** Medio segundo de silencio en WAV: lo que suena al desbloquear el reproductor. */
const SILENCIO =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

let reproductor: HTMLAudioElement | null = null;
let generacion = 0;
/** Lo que se está pidiendo al servidor para la locución en curso: `callar()` lo corta. */
let cortePendiente: AbortController | null = null;
let desbloqueado = false;

function elReproductor(): HTMLAudioElement {
  if (!reproductor) {
    reproductor = new Audio();
    reproductor.preload = 'auto';
  }
  return reproductor;
}

/**
 * Llamarla DENTRO de un toque (activar la voz, dictar, enviar). Hace sonar un silencio en el
 * reproductor compartido: a partir de ahí el navegador lo deja sonar aunque la respuesta llegue
 * mucho después del toque.
 */
export function desbloquear() {
  if (desbloqueado || typeof Audio === 'undefined') return;
  try {
    const a = elReproductor();
    a.src = SILENCIO;
    // Lo que desbloquea es LLAMAR a play() dentro del toque, aunque después se corte para poner la
    // respuesta: Safari recuerda el elemento, no el sonido.
    a.play()?.catch?.(() => {});
    desbloqueado = true;
    conectarMedidor(a);
  } catch {
    /* sin audio en este navegador */
  }
}

/* ------------------------------------------------------------ el medidor para la boca */

/*
 * La boca de la cara sigue a la voz DE VERDAD: un analizador escucha el reproductor y da el volumen
 * de cada instante. `createMediaElementSource` se puede llamar UNA sola vez por elemento, y desde
 * ahí el sonido sale por el AudioContext: si ese contexto queda en pausa, el reproductor enmudece.
 * Por eso solo se engancha cuando el contexto arrancó de verdad (dentro de un toque), y se reanuda
 * antes de cada locución y en cada toque.
 */
let ctxVoz: AudioContext | null = null;
let analizadorVoz: AnalyserNode | null = null;
let datosVoz: Uint8Array | null = null;
let medidorPedido = false;

function conectarMedidor(a: HTMLAudioElement) {
  if (medidorPedido || typeof window === 'undefined') return;
  const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AC) return;
  medidorPedido = true;
  let ctx: AudioContext;
  try {
    ctx = new AC() as AudioContext;
  } catch {
    return;
  }
  void Promise.resolve(ctx.state === 'running' ? undefined : ctx.resume())
    .then(() => {
      if (ctx.state !== 'running') {
        // Sin arrancar no se engancha nada: la voz sigue saliendo directo, sin medidor.
        void ctx.close().catch(() => {});
        medidorPedido = false;
        return;
      }
      const fuente = ctx.createMediaElementSource(a);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      an.smoothingTimeConstant = 0.35;
      fuente.connect(an);
      an.connect(ctx.destination);
      ctxVoz = ctx;
      analizadorVoz = an;
      datosVoz = new Uint8Array(an.fftSize);
    })
    .catch(() => {
      medidorPedido = false;
    });
}

/** Si el navegador pausó el audio (otra pestaña, una llamada), lo despierta. Llamarla en los toques. */
export function reanudarVoz() {
  if (ctxVoz && ctxVoz.state !== 'running') void ctxVoz.resume().catch(() => {});
}

/**
 * Cuánto suena la voz ahora: 0..1. `-1` si no hay medidor (Safari viejo, o antes del primer
 * toque): la cara entonces mueve la boca con su propio ritmo mientras habla.
 */
export function nivelVoz(): number {
  if (!analizadorVoz || !datosVoz) return -1;
  if (!suena()) return 0;
  analizadorVoz.getByteTimeDomainData(datosVoz as any);
  let suma = 0;
  for (let k = 0; k < datosVoz.length; k++) {
    const v = (datosVoz[k] - 128) / 128;
    suma += v * v;
  }
  const rms = Math.sqrt(suma / datosVoz.length);
  // La voz hablada ronda 0,05–0,25 de RMS: se estira para que la boca abra de verdad.
  return Math.min(1, Math.max(0, (rms - 0.012) * 5));
}

/* ------------------------------------------------------------ explorar sin voces */

/*
 * EL SILENCIO ES GLOBAL: con las voces apagadas no habla nadie —ni la respuesta, ni la mesa, ni el
 * recorrido, ni el «estoy revisando…»—. Lo que se iba a decir se lee: el diálogo se ve con sus caras
 * y sus subtítulos, al ritmo de lectura, y el recorrido espera lo que tarda leerlo. Es la misma
 * preferencia que el botón «Voz» del panel.
 */
let mudo = !leerPreferencia('voz', true, (v) => typeof v === 'boolean');
const oyentesMudo = new Set<(m: boolean) => void>();
export const estaMudo = () => mudo;
export function silenciar(m: boolean) {
  if (m === mudo) return;
  mudo = m;
  guardarPreferencia('voz', !m);
  if (m) callar();
  else desbloquear();
  oyentesMudo.forEach((f) => f(m));
}
export function escucharMudo(f: (m: boolean) => void): () => void {
  oyentesMudo.add(f);
  return () => {
    oyentesMudo.delete(f);
  };
}
/** Lo que tarda en leerse un texto (unas 3 palabras por segundo), entre 1,5 y 12 s. */
export const msDeLectura = (t: string) => Math.max(1500, Math.min(12_000, String(t || '').split(/\s+/).length * 330));

/* ------------------------------------------------------------ lo que va diciendo */

/**
 * Lo que la voz va diciendo, trozo a trozo (el mismo registro que AU-RA): para que el oído reconozca su
 * eco y para saber qué alcanzó a oír la persona si lo interrumpe.
 */
const registro = new RegistroVoz();
/** Lo que suena es un «estoy revisando…»: es eco, pero no es parte de la respuesta. */
let rellenoSonando = false;

function empezoTrozo(texto: string, esRelleno = false) {
  rellenoSonando = esRelleno;
  registro.empezo(texto);
}
function terminoTrozo() {
  // Un relleno que termina queda como eco reciente, no como algo oído de la respuesta.
  if (rellenoSonando) registro.callo();
  else registro.termino();
  rellenoSonando = false;
}

/** Lo que la voz dice ahora y lo de hace un momento: lo que el oído tiene que reconocer como eco. */
export const dichosVoz = (): string[] => registro.dichos();

/** Empieza la respuesta a una pregunta nueva: lo oído de la anterior ya no cuenta. */
export function nuevoTurnoVoz() {
  registro.nuevoTurno();
}

/** Lo que la persona alcanzó a oír la última vez que interrumpió, una sola vez (va con la pregunta siguiente). */
export function tomarCortada(): string | null {
  return registro.tomarCortada();
}

/* ------------------------------------------------------------ callar */

/** Volumen de la voz: 1, o bajado mientras se confirma si le están hablando encima (`bajarParaOir`). */
let volumen = 1;
/** La voz quedó en pausa para oír a quien le habla encima (`pausarParaOir`); `seguirTrasOir` la retoma. */
let pausaOir: { gen: number; reloj: ReturnType<typeof setTimeout> } | null = null;

function soltarReproductor() {
  // El silencio del desbloqueo no se corta: cortarlo a la mitad le quita el permiso en Safari.
  if (reproductor && !String(reproductor.src).startsWith('data:')) {
    try {
      reproductor.pause();
      reproductor.removeAttribute('src');
      reproductor.load();
    } catch {
      /* ya estaba suelto */
    }
  }
}

/** Invalida lo que suena y lo que venía (sin tocar el reproductor todavía). */
function invalidar() {
  generacion++;
  relleno = null;
  terminarEscena();
  cortePendiente?.abort();
  cortePendiente = null;
  if (pausaOir) clearTimeout(pausaOir.reloj);
  pausaOir = null;
  volumen = 1;
  if (registro.hablando()) registro.callo();
  rellenoSonando = false;
}

/** Corta lo que suena e invalida lo que venía. Se puede llamar siempre. */
export function callar() {
  invalidar();
  soltarReproductor();
  if (reproductor) reproductor.volume = 1;
}

/**
 * Como `callar`, pero lo que suena BAJA en `ms` antes de cortarse (como AU-RA al interrumpirla): un corte
 * a cuchillo suena a error. Lo que venía en camino se invalida en el acto.
 */
export function callarSuave(ms = 160) {
  const a = reproductor;
  if (!a || a.paused || !a.src || String(a.src).startsWith('data:')) return callar();
  invalidar();
  const mia = generacion;
  const desde = a.volume || 1;
  const t0 = Date.now();
  const reloj = setInterval(() => {
    // Mientras bajaba empezó otra voz: esa suena entera.
    if (mia !== generacion) {
      clearInterval(reloj);
      a.volume = volumen;
      return;
    }
    const p = Math.min(1, (Date.now() - t0) / ms);
    a.volume = Math.max(0, desde * (1 - p));
    if (p >= 1) {
      clearInterval(reloj);
      soltarReproductor();
      a.volume = 1;
    }
  }, 16);
}

/**
 * Le hablan encima DE VERDAD (el oído lo confirmó con el texto): se calla bajando y se anota lo que la
 * persona alcanzó a oír de la respuesta (la frase que sonaba, hasta donde iba). Devuelve eso.
 */
export function interrumpirVoz(): string {
  let fraccion: number | undefined;
  if (rellenoSonando) registro.callo();
  else if (reproductor && Number.isFinite(reproductor.duration) && reproductor.duration > 0) fraccion = reproductor.currentTime / reproductor.duration;
  const oido = registro.cortar(fraccion);
  callarSuave();
  return oido;
}

/**
 * Algo suena encima de la voz y todavía no se sabe si es la persona: la voz se PAUSA (no se pierde nada)
 * hasta que el oído decida. Si en 12 s nadie decide, sigue sola. Devuelve si había algo que pausar.
 */
export function pausarParaOir(): boolean {
  if (!suena() || !reproductor) return false;
  try {
    reproductor.pause();
  } catch {
    return false;
  }
  if (pausaOir) clearTimeout(pausaOir.reloj);
  const gen = generacion;
  pausaOir = { gen, reloj: setTimeout(() => pausaOir?.gen === gen && seguirTrasOir(), 12_000) };
  return true;
}

/** Como `pausarParaOir`, pero la voz sigue, más bajo (el oído en vivo decide en décimas de segundo). */
export function bajarParaOir() {
  if (!suena() || !reproductor) return;
  volumen = 0.3;
  reproductor.volume = volumen;
}

/** Era su eco o un «ajá»: la voz vuelve a su volumen y sigue donde estaba. */
export function seguirTrasOir() {
  const p = pausaOir;
  pausaOir = null;
  if (p) clearTimeout(p.reloj);
  volumen = 1;
  const a = reproductor;
  if (!a) return;
  a.volume = 1;
  if (p && p.gen === generacion && a.paused && a.src && !String(a.src).startsWith('data:')) a.play()?.catch?.(() => {});
}

/** ¿La voz está hablando, o en pausa esperando si la interrumpieron? (para el oído: «¿esto es encima?»). */
export function hablandoVoz(): boolean {
  return suena() || (!!pausaOir && pausaOir.gen === generacion);
}

/** Sin marcas de formato, enlaces ni listas: lo que se puede leer en voz alta. */
export function limpiarParaVoz(texto: string): string {
  return String(texto || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[*_#`>|]+/g, ' ')
    .replace(/^\s*[-•·]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Lo que se lee en voz alta: sin marcas de formato, enlaces ni listas, partido en trozos que
 * terminan en fin de frase. El primero es corto para que empiece a sonar enseguida.
 */
export function trocearParaVoz(texto: string, primero = 180, resto = 420): string[] {
  const limpio = limpiarParaVoz(texto);
  if (!limpio) return [];
  /*
   * Frases con el MISMO cortador que AU-RA, el servidor y el teléfono (src/03-voz/frases.ts): no parte
   * «3,4 g/t», «1.500», «Dr. Gómez» ni «S.A.». Aquí el texto llegó entero: solo fines de frase.
   */
  const frases = cortarFrases(limpio, true, { comas: false }).listas;
  if (!frases.length) frases.push(limpio);
  const trozos: string[] = [];
  let actual = '';
  for (const f of frases) {
    const tope = trozos.length === 0 ? primero : resto;
    if (actual && (actual + ' ' + f).length > tope) {
      trozos.push(actual);
      actual = f;
    } else actual = actual ? `${actual} ${f}` : f;
    // Una frase sola más larga que el tope se parte por comas para no pasarse del límite del servidor.
    while (actual.length > 1100) {
      const corte = actual.lastIndexOf(',', 1000) > 200 ? actual.lastIndexOf(',', 1000) + 1 : 1000;
      trozos.push(actual.slice(0, corte).trim());
      actual = actual.slice(corte).trim();
    }
  }
  if (actual) trozos.push(actual);
  return trozos;
}

export type Avisos = {
  alEmpezar?: () => void;
  alTerminar?: () => void;
  alFallar?: (motivo: string) => void;
};

async function sintetizar(
  texto: string,
  emocion: string | undefined,
  headers: Record<string, string>,
  previo: string | undefined,
  siguiente: string | undefined,
  senal: AbortSignal,
  idioma: 'es' | 'en' = idiomaActual(),
  primera = false
): Promise<Response> {
  const r = await fetch('/api/electrum/voz', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    // Los vecinos van para que la voz enlace la entonación entre trozos (ElevenLabs los usa).
    // El idioma de la respuesta que se lee: el servidor elige cómo pronunciarla.
    // `primera`: la primera frase de una respuesta en vivo; el servidor la hace con el modelo rápido.
    body: JSON.stringify({ texto, emocion, previo, siguiente, idioma, ...(primera ? { primera: true } : {}) }),
    signal: senal,
  });
  if (!r.ok) {
    const j: any = await r.json().catch(() => null);
    throw new Error(r.status === 401 ? 'la sesión venció: volvé a entrar' : j?.error || `el servidor contestó ${r.status}`);
  }
  return r;
}

const BLOQUEADO = 'el navegador bloqueó el sonido: tocá «Voz» una vez para permitirlo';

/**
 * ¿Se puede reproducir mientras llega? MediaSource con MP3: Chrome, Edge, Firefox y Android sí; el
 * iPhone no (ahí se espera el trozo entero, como antes).
 */
function enVivoPosible(r: Response): boolean {
  try {
    return (
      !!r.body &&
      /audio\/mpeg/.test(r.headers.get('content-type') || '') &&
      typeof MediaSource !== 'undefined' &&
      MediaSource.isTypeSupported('audio/mpeg')
    );
  } catch {
    return false;
  }
}

type Lector = { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(): Promise<unknown> };

/** Reproduce el audio A MEDIDA QUE LLEGA: el primer pedazo suena sin esperar al último. */
function sonarEnVivo(a: HTMLAudioElement, r: Response, mia: number): Promise<void> {
  return sonarLector(a, r.body!.getReader() as Lector, mia);
}

function sonarLector(a: HTMLAudioElement, lector: Lector, mia: number): Promise<void> {
  return new Promise((listo, fallo) => {
    const ms = new MediaSource();
    const url = URL.createObjectURL(ms);
    let hecho = false;
    const fin = (e?: unknown) => {
      if (hecho) return;
      hecho = true;
      a.onended = a.onerror = null;
      lector.cancel().catch(() => {});
      URL.revokeObjectURL(url);
      e ? fallo(e) : listo();
    };
    if (mia !== generacion) return fin();
    a.onended = () => fin();
    a.onerror = () => fin(new Error('el navegador no pudo reproducir el audio'));
    a.volume = volumen;
    ms.addEventListener(
      'sourceopen',
      async () => {
        try {
          const sb = ms.addSourceBuffer('audio/mpeg');
          const listoSb = () => new Promise<void>((ok) => sb.addEventListener('updateend', () => ok(), { once: true }));
          for (;;) {
            if (mia !== generacion) return fin();
            const { done, value } = await lector.read();
            if (done) break;
            if (value?.length) {
              sb.appendBuffer(value);
              await listoSb();
            }
          }
          if (ms.readyState === 'open') ms.endOfStream();
        } catch (e) {
          // Callar a mitad corta la descarga: eso no es un fallo que haya que contar.
          fin(mia !== generacion ? undefined : e);
        }
      },
      { once: true }
    );
    a.src = url;
    a.play().catch((e) => fin(e?.name === 'NotAllowedError' ? new Error(BLOQUEADO) : e));
  });
}

async function sonar(a: HTMLAudioElement, r: Response, mia: number): Promise<void> {
  if (enVivoPosible(r)) return sonarEnVivo(a, r, mia);
  return sonarBlob(a, await r.blob(), mia);
}

function sonarBlob(a: HTMLAudioElement, blob: Blob, mia: number): Promise<void> {
  return new Promise((listo, fallo) => {
    const url = URL.createObjectURL(blob);
    const fin = (e?: unknown) => {
      a.onended = a.onerror = null;
      URL.revokeObjectURL(url);
      e ? fallo(e) : listo();
    };
    if (mia !== generacion) return fin();
    a.onended = () => fin();
    a.onerror = () => fin(new Error('el navegador no pudo reproducir el audio'));
    a.volume = volumen;
    a.src = url;
    a.play().catch((e) => fin(e?.name === 'NotAllowedError' ? new Error(BLOQUEADO) : e));
  });
}

/**
 * Dice la respuesta entera, trozo a trozo, pidiendo el siguiente mientras suena el actual.
 * Nunca lanza: los problemas llegan por `alFallar`.
 */
export async function hablar(texto: string, emocion: string | undefined, headers: Record<string, string>, avisos: Avisos = {}) {
  if (mudo) {
    // En silencio no suena, pero se respeta el tiempo de leerlo (el recorrido va a ese paso).
    const mia = ++generacion;
    avisos.alEmpezar?.();
    await new Promise((ok) => setTimeout(ok, msDeLectura(texto.replace(/\[[^\]\n]{1,40}\]/g, ''))));
    if (mia === generacion) avisos.alTerminar?.();
    return;
  }
  const trozos = trocearParaVoz(texto);
  // Callar corta también lo que viene en camino: ni se sigue bajando ni se gastan créditos.
  const corte = new AbortController();
  const pedir = (i: number) => sintetizar(trozos[i], emocion, headers, trozos[i - 1], trozos[i + 1], corte.signal);
  let adelantado: Promise<Response> | null = null;
  /*
   * Si está sonando el «estoy revisando…», se le deja terminar la frase —cortarla a la mitad suena
   * peor que el silencio— y mientras tanto ya se pide la respuesta, para que entre sin hueco.
   */
  const r = relleno;
  if (r && r.gen === generacion && trozos.length) {
    adelantado = pedir(0);
    adelantado.catch(() => {});
    await Promise.race([r.fin, new Promise((ok) => setTimeout(ok, 7000))]);
    if (generacion !== r.gen) {
      // Mientras tanto alguien calló o empezó otra cosa: esta respuesta ya no va.
      corte.abort();
      return;
    }
  }
  callar();
  const mia = ++generacion;
  if (!trozos.length) return;
  reanudarVoz();
  const a = elReproductor();
  let empezo = false;
  cortePendiente = corte;
  let siguiente: Promise<Response> | null = adelantado || pedir(0);
  try {
    for (let i = 0; i < trozos.length; i++) {
      const respuesta = await siguiente!;
      if (mia !== generacion) return;
      siguiente = i + 1 < trozos.length ? pedir(i + 1) : null;
      // Que un fallo del trozo siguiente no quede como promesa rechazada sin atender.
      siguiente?.catch(() => {});
      if (!empezo) {
        empezo = true;
        avisos.alEmpezar?.();
      }
      empezoTrozo(trozos[i]);
      await sonar(a, respuesta, mia);
      if (mia !== generacion) return;
      terminoTrozo();
    }
  } catch (e: any) {
    if (mia === generacion && e?.name !== 'AbortError') avisos.alFallar?.(String(e?.message || e));
  } finally {
    if (mia === generacion && empezo) avisos.alTerminar?.();
  }
}

/* ------------------------------------------------------------ la respuesta en vivo */

export type Locucion = {
  /** Una frase más de la respuesta (texto para decir, con sus etiquetas de expresión si las trae). */
  agregar(texto: string): void;
  /** No llegan más frases: lo que queda en cola se dice y termina. */
  cerrar(): void;
  /**
   * ¿La cortaron antes de terminar? (`callar()`, una interrupción, otra voz): lo que llegue después ya no se
   * dice y no va a avisar `alTerminar`. Terminar bien (o fallar, que avisa `alFallar`) no es cortarla.
   */
  cortada(): boolean;
};

/**
 * Dice una respuesta A MEDIDA QUE LLEGA, frase a frase (evento `frase` del turno en stream). La primera
 * va sola y con `primera: true`; las que se acumulan mientras suena una se juntan (hasta ~420 letras) en
 * un solo pedido, que se hace mientras suena la anterior. Si está sonando el «estoy revisando…», se le
 * deja terminar su frase mientras ya se pide la primera, como en `hablar`.
 * Nunca lanza: los problemas llegan por `alFallar`. `alTerminar` llega cuando se cerró y se dijo todo.
 */
export function crearLocucion(headers: Record<string, string>, emocion: string | undefined, avisos: Avisos = {}): Locucion {
  const cola: string[] = [];
  let cerrada = false;
  /** Ya no dice nada más: terminó, falló o la cortaron. */
  let muerta = false;
  /** La cortaron antes de terminar. */
  let cortadaAntes = false;
  let arranco = false;
  /** La generación de esta locución una vez que empezó a sonar (-1: todavía no). */
  let mia = -1;
  let pedidos = 0;
  let previo: string | undefined;
  const corte = new AbortController();
  let siguiente: { texto: string; r: Promise<Response> } | null = null;

  const pedirSiguiente = () => {
    if (siguiente || !cola.length || muerta) return;
    const { texto, usadas } = juntarFrases(cola, pedidos === 0 ? 0 : 420);
    cola.splice(0, usadas);
    if (!texto) return;
    const primera = pedidos === 0;
    pedidos++;
    const r = sintetizar(texto, emocion, headers, previo, undefined, corte.signal, idiomaActual(), primera);
    r.catch(() => {});
    previo = texto;
    siguiente = { texto, r };
  };
  const dormir = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

  async function correr() {
    pedirSiguiente();
    const rel = relleno;
    if (rel && rel.gen === generacion) {
      await Promise.race([rel.fin, dormir(7000)]);
      // Mientras tanto alguien calló (una interrupción, otra pregunta): esta respuesta ya no suena.
      if (generacion !== rel.gen) {
        muerta = cortadaAntes = true;
        corte.abort();
        return;
      }
    }
    callar();
    mia = ++generacion;
    cortePendiente = corte;
    reanudarVoz();
    const a = elReproductor();
    let empezo = false;
    try {
      for (;;) {
        // Sin pedido en camino: se espera a que llegue otra frase (o a que se cierre).
        while (!siguiente) {
          if (mia !== generacion) return;
          if (cerrada && !cola.length) return;
          pedirSiguiente();
          if (!siguiente) await dormir(60);
        }
        const actual: { texto: string; r: Promise<Response> } = siguiente;
        const respuesta = await actual.r;
        if (mia !== generacion) return;
        siguiente = null;
        // Mientras suena esta, ya se pide la que sigue (si llegó).
        pedirSiguiente();
        if (!empezo) {
          empezo = true;
          avisos.alEmpezar?.();
        }
        empezoTrozo(actual.texto);
        await sonar(a, respuesta, mia);
        if (mia !== generacion) return;
        terminoTrozo();
      }
    } catch (e: any) {
      if (mia === generacion && e?.name !== 'AbortError') avisos.alFallar?.(String(e?.message || e));
    } finally {
      muerta = true;
      if (mia !== generacion) cortadaAntes = true;
      else {
        if (cortePendiente === corte) cortePendiente = null;
        if (empezo) avisos.alTerminar?.();
      }
    }
  }

  return {
    agregar(texto: string) {
      const t = limpiarParaVoz(texto);
      if (!t || muerta || cerrada || mudo) return;
      cola.push(t);
      if (!arranco) {
        arranco = true;
        void correr();
      } else if (mia === generacion) pedirSiguiente();
    },
    cerrar() {
      cerrada = true;
    },
    cortada() {
      // Sigue en marcha pero otra voz ya tomó el reproductor: también está cortada (su bucle lo verá enseguida).
      return cortadaAntes || (!muerta && mia !== -1 && mia !== generacion);
    },
  };
}

/** ¿Está sonando algo ahora? */
export function suena(): boolean {
  return !!reproductor && !reproductor.paused && !!reproductor.src && !reproductor.src.startsWith('data:');
}

/* ------------------------------------------------------------ «estoy revisando…» */

/** El «estoy revisando…» que está sonando: `hablar` espera a que termine antes de empezar. */
let relleno: { gen: number; fin: Promise<void> } | null = null;
/** Las frases cortas se guardan ya dichas: la segunda vez suenan al instante, sin ir al servidor. */
const rellenosGuardados = new Map<string, Blob>();

async function blobDeRelleno(texto: string, headers: Record<string, string>, senal?: AbortSignal): Promise<Blob> {
  const guardado = rellenosGuardados.get(texto);
  if (guardado) return guardado;
  // Una muletilla se dice en SU idioma («Déjeme revisar…» en español aunque la charla sea en inglés).
  const r = await sintetizar(texto, 'pensando', headers, undefined, undefined, senal || new AbortController().signal, detectarIdioma(texto) || 'es');
  const blob = await r.blob();
  if (blob.size > 0) {
    if (rellenosGuardados.size > 40) rellenosGuardados.delete(rellenosGuardados.keys().next().value as string);
    rellenosGuardados.set(texto, blob);
  }
  return blob;
}

/**
 * Dice una frase corta de trabajo («estoy dibujando el mapa geológico…») mientras el cerebro piensa.
 * Nunca lanza y nunca avisa de fallos: si no suena, la respuesta llega igual.
 */
export function rellenar(texto: string, headers: Record<string, string>, avisos: Pick<Avisos, 'alEmpezar' | 'alTerminar'> = {}): Promise<void> {
  if (mudo) return Promise.resolve();
  // No pisa una respuesta que está sonando.
  if (suena() && !relleno) return Promise.resolve();
  callar();
  const mia = ++generacion;
  const corte = new AbortController();
  cortePendiente = corte;
  reanudarVoz();
  const fin = (async () => {
    try {
      const blob = await blobDeRelleno(texto, headers, corte.signal);
      if (mia !== generacion) return;
      avisos.alEmpezar?.();
      // Su eco tampoco es la persona hablando, pero no es parte de la respuesta.
      empezoTrozo(texto, true);
      await sonarBlob(elReproductor(), blob, mia);
      if (mia === generacion) terminoTrozo();
    } catch {
      /* sin voz para el relleno: no pasa nada */
    } finally {
      if (relleno?.gen === mia) relleno = null;
      if (mia === generacion) avisos.alTerminar?.();
    }
  })();
  relleno = { gen: mia, fin };
  return fin;
}

/** Deja lista (sin sonar) una frase de trabajo, para que la próxima vez salga sin espera. */
export function prepararRelleno(texto: string, headers: Record<string, string>) {
  if (rellenosGuardados.has(texto)) return;
  void blobDeRelleno(texto, headers).catch(() => {});
}

/* ------------------------------------------------------------ diálogo a varias voces */

export type LineaDialogo = { quien: string; texto: string; nombre?: string };

/** Como `partirDialogo` del servidor: pedidos de hasta ~1800 caracteres, sin partir una línea. */
export function partirDialogo(lineas: LineaDialogo[], tope = 1800): LineaDialogo[][] {
  const trozos: LineaDialogo[][] = [];
  let actual: LineaDialogo[] = [];
  let largo = 0;
  for (const l of lineas) {
    if (actual.length && largo + l.texto.length > tope) {
      trozos.push(actual);
      actual = [];
      largo = 0;
    }
    actual.push(l);
    largo += l.texto.length;
  }
  if (actual.length) trozos.push(actual);
  return trozos;
}

/* --- quién habla ahora: lo miran las caras de la pantalla --- */

export type Escena = {
  hablante: string | null;
  participantes: string[] | null;
  /** La línea que se está diciendo (con sus etiquetas de expresión: [laughs], [curious]…). */
  linea?: string | null;
};
let escena: Escena = { hablante: null, participantes: null, linea: null };
const oyentesEscena = new Set<(e: Escena) => void>();
let relojEscena: number | undefined;

function publicarEscena(e: Escena) {
  if (e.hablante === escena.hablante && (e.linea ?? null) === (escena.linea ?? null) && (e.participantes || []).join() === (escena.participantes || []).join()) return;
  escena = e;
  oyentesEscena.forEach((f) => f(e));
}
function terminarEscena() {
  if (relojEscena) clearInterval(relojEscena);
  relojEscena = undefined;
  publicarEscena({ hablante: null, participantes: null, linea: null });
}

/** Avisa cada vez que cambia quién habla en un diálogo (o termina). Devuelve cómo dejar de escuchar. */
export function escucharEscena(f: (e: Escena) => void): () => void {
  oyentesEscena.add(f);
  f(escena);
  return () => {
    oyentesEscena.delete(f);
  };
}
/**
 * El diálogo sin voces: la mesa aparece igual, cada uno «dice» su línea en el subtítulo el tiempo
 * que tarda leerla, con su cara encendida. Nada suena.
 */
async function leerDialogo(lineas: LineaDialogo[], avisos: Avisos) {
  callar();
  const mia = ++generacion;
  const hablan = [...new Set(lineas.map((l) => l.quien))];
  const participantes = hablan.some((q) => q !== 'electrum' && q !== 'narrador') && !hablan.includes('electrum') ? ['electrum', ...hablan] : hablan;
  avisos.alEmpezar?.();
  for (const l of lineas) {
    if (mia !== generacion) return;
    publicarEscena({ hablante: l.quien, participantes, linea: l.texto });
    await new Promise((ok) => setTimeout(ok, msDeLectura(l.texto.replace(/\[[^\]\n]{1,40}\]/g, ''))));
  }
  if (mia === generacion) {
    terminarEscena();
    avisos.alTerminar?.();
  }
}

/** Quién habla ahora en un diálogo (null fuera de un diálogo). */
export const hablanteActual = () => escena.hablante;

type Segmento = { q: string; d: number; h: number; i?: number };

function bytesDeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k);
  return out;
}

/** El audio de un trozo de diálogo llega como JSON por líneas: el audio va al reproductor, los tiempos a la escena. */
function lectorDialogo(r: Response, alSegmentos: (s: Segmento[]) => void): Lector {
  const base = r.body!.getReader();
  const dec = new TextDecoder();
  const cola: Uint8Array[] = [];
  let resto = '';
  const procesar = (linea: string) => {
    if (!linea.trim()) return;
    try {
      const d = JSON.parse(linea);
      if (Array.isArray(d.s) && d.s.length) alSegmentos(d.s);
      if (typeof d.a === 'string' && d.a) cola.push(bytesDeBase64(d.a));
    } catch {
      /* línea rota: se sigue */
    }
  };
  return {
    async read() {
      for (;;) {
        if (cola.length) return { done: false, value: cola.shift() };
        const { done, value } = await base.read();
        if (done) {
          if (resto.trim()) procesar(resto);
          resto = '';
          if (cola.length) continue;
          return { done: true };
        }
        resto += dec.decode(value, { stream: true });
        const partes = resto.split('\n');
        resto = partes.pop() || '';
        partes.forEach(procesar);
      }
    },
    cancel: () => base.cancel(),
  };
}

/**
 * Hace sonar un diálogo (Dr Electrum, la ingeniera Tatiana…) con las voces de cada uno, trozo a
 * trozo, pidiendo el siguiente mientras suena el actual. Mientras suena, la escena dice quién habla
 * (las caras se animan con eso). `callar()` lo corta como a cualquier voz.
 */
export async function hablarDialogo(lineas: LineaDialogo[], headers: Record<string, string>, avisos: Avisos = {}) {
  if (mudo) return leerDialogo(lineas, avisos);
  const trozos = partirDialogo(lineas.map(({ quien, texto }) => ({ quien, texto })));
  const corte = new AbortController();
  const pedir = async (i: number): Promise<Response> => {
    const r = await fetch('/api/electrum/dialogo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ lineas: trozos[i] }),
      signal: corte.signal,
    });
    if (!r.ok || !r.body) {
      const j: any = await r.json().catch(() => null);
      throw new Error(j?.error || `el servidor contestó ${r.status}`);
    }
    return r;
  };
  // Como `hablar`: el «estoy revisando…» termina su frase mientras ya se pide el primer trozo.
  let adelantado: Promise<Response> | null = null;
  const rel = relleno;
  if (rel && rel.gen === generacion && trozos.length) {
    adelantado = pedir(0);
    adelantado.catch(() => {});
    await Promise.race([rel.fin, new Promise((ok) => setTimeout(ok, 7000))]);
    if (generacion !== rel.gen) {
      corte.abort();
      return;
    }
  }
  callar();
  const mia = ++generacion;
  if (!trozos.length) return;
  reanudarVoz();
  const a = elReproductor();
  cortePendiente = corte;
  // En la mesa siempre está el doctor: si contesta Don Chema solo, Dr Electrum lo escucha a su lado.
  const hablan = [...new Set(lineas.map((l) => l.quien))];
  const participantes = hablan.some((q) => q !== 'electrum' && q !== 'narrador') && !hablan.includes('electrum') ? ['electrum', ...hablan] : hablan;
  publicarEscena({ hablante: null, participantes, linea: null });
  let empezo = false;
  let siguiente: Promise<Response> | null = adelantado || pedir(0);
  try {
    for (let i = 0; i < trozos.length; i++) {
      const r = await siguiente!;
      if (mia !== generacion) return;
      siguiente = i + 1 < trozos.length ? pedir(i + 1) : null;
      siguiente?.catch(() => {});
      if (!empezo) {
        empezo = true;
        avisos.alEmpezar?.();
      }
      // Los tiempos de este trozo empiezan en cero, igual que su audio.
      const segmentos: Segmento[] = [];
      const lector = lectorDialogo(r, (s) => segmentos.push(...s));
      if (relojEscena) clearInterval(relojEscena);
      const lineasTrozo = trozos[i];
      relojEscena = window.setInterval(() => {
        const t = a.currentTime;
        const s = segmentos.find((x) => t >= x.d && t < x.h);
        const hablante = a.paused ? null : s?.q ?? escena.hablante;
        const linea = s && typeof s.i === 'number' ? lineasTrozo[s.i]?.texto ?? null : hablante ? escena.linea ?? null : null;
        publicarEscena({ hablante, participantes, linea });
      }, 60);
      // Lo que dice la mesa también es eco para el oído (sin las etiquetas [laughs], que no se oyen como palabras).
      empezoTrozo(lineasTrozo.map((l) => l.texto.replace(/\[[^\]\n]{1,40}\]/g, ' ')).join(' '));
      if (typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported('audio/mpeg')) {
        await sonarLector(a, lector, mia);
      } else {
        // iPhone: sin MediaSource se junta el trozo entero y suena igual, con sus tiempos.
        const partes: Uint8Array[] = [];
        for (;;) {
          const { done, value } = await lector.read();
          if (done) break;
          if (value) partes.push(value);
        }
        await sonarBlob(a, new Blob(partes as BlobPart[], { type: 'audio/mpeg' }), mia);
      }
      if (mia !== generacion) return;
      terminoTrozo();
    }
  } catch (e: any) {
    if (mia === generacion && e?.name !== 'AbortError') avisos.alFallar?.(String(e?.message || e));
  } finally {
    if (mia === generacion) {
      terminarEscena();
      if (empezo) avisos.alTerminar?.();
    }
  }
}
