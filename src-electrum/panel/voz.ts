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
  } catch {
    /* sin audio en este navegador */
  }
}

/** Corta lo que suena e invalida lo que venía. Se puede llamar siempre. */
export function callar() {
  generacion++;
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

async function sintetizar(texto: string, emocion: string | undefined, headers: Record<string, string>, previo?: string, siguiente?: string): Promise<Blob> {
  const r = await fetch('/api/electrum/voz', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    // Los vecinos van para que la voz enlace la entonación entre trozos (ElevenLabs los usa).
    body: JSON.stringify({ texto, emocion, previo, siguiente }),
  });
  if (!r.ok) {
    const j: any = await r.json().catch(() => null);
    throw new Error(r.status === 401 ? 'la sesión venció: volvé a entrar' : j?.error || `el servidor contestó ${r.status}`);
  }
  return r.blob();
}

function sonar(a: HTMLAudioElement, blob: Blob, mia: number): Promise<void> {
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
    a.play().catch((e) => fin(e?.name === 'NotAllowedError' ? new Error('el navegador bloqueó el sonido: tocá «Voz» una vez para permitirlo') : e));
  });
}

/**
 * Dice la respuesta entera, trozo a trozo, pidiendo el siguiente mientras suena el actual.
 * Nunca lanza: los problemas llegan por `alFallar`.
 */
export async function hablar(texto: string, emocion: string | undefined, headers: Record<string, string>, avisos: Avisos = {}) {
  callar();
  const mia = ++generacion;
  const trozos = trocearParaVoz(texto);
  if (!trozos.length) return;
  const a = elReproductor();
  let empezo = false;
  const pedir = (i: number) => sintetizar(trozos[i], emocion, headers, trozos[i - 1], trozos[i + 1]);
  let siguiente: Promise<Blob> | null = pedir(0);
  try {
    for (let i = 0; i < trozos.length; i++) {
      const blob = await siguiente!;
      if (mia !== generacion) return;
      siguiente = i + 1 < trozos.length ? pedir(i + 1) : null;
      // Que un fallo del trozo siguiente no quede como promesa rechazada sin atender.
      siguiente?.catch(() => {});
      if (!empezo) {
        empezo = true;
        avisos.alEmpezar?.();
      }
      await sonar(a, blob, mia);
      if (mia !== generacion) return;
    }
  } catch (e: any) {
    if (mia === generacion) avisos.alFallar?.(String(e?.message || e));
  } finally {
    if (mia === generacion && empezo) avisos.alTerminar?.();
  }
}

/** ¿Está sonando algo ahora? */
export function suena(): boolean {
  return !!reproductor && !reproductor.paused && !!reproductor.src && !reproductor.src.startsWith('data:');
}
