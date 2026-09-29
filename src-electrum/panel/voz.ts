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
 */

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

/** Corta lo que suena e invalida lo que venía. Se puede llamar siempre. */
export function callar() {
  generacion++;
  relleno = null;
  cortePendiente?.abort();
  cortePendiente = null;
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

/**
 * Lo que se lee en voz alta: sin marcas de formato, enlaces ni listas, partido en trozos que
 * terminan en fin de frase. El primero es corto para que empiece a sonar enseguida.
 */
export function trocearParaVoz(texto: string, primero = 180, resto = 420): string[] {
  const limpio = String(texto || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[*_#`>|]+/g, ' ')
    .replace(/^\s*[-•·]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!limpio) return [];
  // Frases: hasta el punto, signo o punto y coma, sin partir «3,4 g/t» ni «S.A.».
  const frases = limpio.match(/[^.!?¡¿;:]+(?:[.!?;:]+(?=\s|$)|$)/g)?.map((f) => f.trim()).filter(Boolean) || [limpio];
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
  senal: AbortSignal
): Promise<Response> {
  const r = await fetch('/api/electrum/voz', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    // Los vecinos van para que la voz enlace la entonación entre trozos (ElevenLabs los usa).
    body: JSON.stringify({ texto, emocion, previo, siguiente }),
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

/** Reproduce el audio A MEDIDA QUE LLEGA: el primer pedazo suena sin esperar al último. */
function sonarEnVivo(a: HTMLAudioElement, r: Response, mia: number): Promise<void> {
  return new Promise((listo, fallo) => {
    const ms = new MediaSource();
    const url = URL.createObjectURL(ms);
    const lector = r.body!.getReader();
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
    a.src = url;
    a.play().catch((e) => fin(e?.name === 'NotAllowedError' ? new Error(BLOQUEADO) : e));
  });
}

/**
 * Dice la respuesta entera, trozo a trozo, pidiendo el siguiente mientras suena el actual.
 * Nunca lanza: los problemas llegan por `alFallar`.
 */
export async function hablar(texto: string, emocion: string | undefined, headers: Record<string, string>, avisos: Avisos = {}) {
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
      await sonar(a, respuesta, mia);
      if (mia !== generacion) return;
    }
  } catch (e: any) {
    if (mia === generacion && e?.name !== 'AbortError') avisos.alFallar?.(String(e?.message || e));
  } finally {
    if (mia === generacion && empezo) avisos.alTerminar?.();
  }
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
  const r = await sintetizar(texto, 'pensando', headers, undefined, undefined, senal || new AbortController().signal);
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
      await sonarBlob(elReproductor(), blob, mia);
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

/**
 * Hace sonar un diálogo (Dr Electrum, la ingeniera Tatiana…) con las voces de cada uno, trozo a
 * trozo, pidiendo el siguiente mientras suena el actual. `callar()` lo corta como a cualquier voz.
 */
export async function hablarDialogo(lineas: LineaDialogo[], headers: Record<string, string>, avisos: Avisos = {}) {
  callar();
  const mia = ++generacion;
  const trozos = partirDialogo(lineas.map(({ quien, texto }) => ({ quien, texto })));
  if (!trozos.length) return;
  reanudarVoz();
  const a = elReproductor();
  const corte = new AbortController();
  cortePendiente = corte;
  const pedir = async (i: number): Promise<Response> => {
    const r = await fetch('/api/electrum/dialogo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ lineas: trozos[i] }),
      signal: corte.signal,
    });
    if (!r.ok) {
      const j: any = await r.json().catch(() => null);
      throw new Error(j?.error || `el servidor contestó ${r.status}`);
    }
    return r;
  };
  let empezo = false;
  let siguiente: Promise<Response> | null = pedir(0);
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
      await sonar(a, r, mia);
      if (mia !== generacion) return;
    }
  } catch (e: any) {
    if (mia === generacion && e?.name !== 'AbortError') avisos.alFallar?.(String(e?.message || e));
  } finally {
    if (mia === generacion && empezo) avisos.alTerminar?.();
  }
}
