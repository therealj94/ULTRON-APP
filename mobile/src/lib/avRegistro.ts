/**
 * EL REGISTRO DE LOS SONIDOS DE EXPO-AV: cada `Audio.Sound` que se carga en la app, en un solo sitio, para poder
 * soltarlos todos antes de recargar (lib/recarga.ts).
 *
 * Por qué (emulador, 8-oct; y el cierre de José a los ~13 s de abrir tras bajar una OTA, 7-oct): al recargar el JS
 * (`Updates.reloadAsync`), React Native destruye la instancia desde un hilo de fondo y expo-av (AVManager.onHostDestroy)
 * suelta ahí los reproductores que siguen cargados. ExoPlayer exige su hilo (el principal) y la app se cierra:
 * «IllegalStateException: Player is accessed on the wrong thread». `unloadAsync` sí lo hace en el hilo principal
 * (AVManager.unloadForSound → runOnUiQueueThread), así que, si al recargar no queda ninguno cargado, no hay nada que
 * soltar desde el hilo equivocado.
 *
 * Cómo: se envuelven `Audio.Sound.prototype.loadAsync` y `unloadAsync` una sola vez, al arrancar (index.js lo importa
 * antes que la app). `Audio.Sound.createAsync` llama a `loadAsync`, así que entra todo: la voz (tts.ts), los efectos
 * (sfx.ts), el timbre, los sonidos de trabajo, el recorrido, la llamada, los audios de WhatsApp, el campo de Electrum…
 * sin tocar a ninguno. Los `<Video>` no pasan por aquí: esos se sueltan desmontándolos (App.tsx pinta la raíz vacía).
 *
 * `soltarTodo` cierra el registro: un sonido que termina de cargar después se suelta en el acto y uno nuevo se
 * rechaza (un efecto de despedida al desmontar no vuelve a crear un reproductor). Si la recarga falla,
 * `abrirRegistro` lo vuelve a abrir.
 */
import { Audio } from 'expo-av';

type Sonido = InstanceType<typeof Audio.Sound>;
type Carga = Sonido['loadAsync'];
type Descarga = Sonido['unloadAsync'];

const MARCA = '__auraRegistroAv';

/** Los sonidos cargados (o cargándose) ahora. */
const vivos = new Set<Sonido>();
/** Las cargas en curso: al soltar todo, se espera a que terminen (y se sueltan). */
const cargando = new Set<Promise<unknown>>();
let cerrado = false;
let original: { carga: Carga; descarga: Descarga } | null = null;

/** Sin soltar en el hilo principal: lo que expo-av rechaza o no termina no cuelga la recarga. */
function descargar(s: Sonido): Promise<void> {
  vivos.delete(s);
  if (!original) return Promise.resolve();
  return Promise.resolve()
    .then(() => original!.descarga.call(s))
    .then(
      () => {},
      () => {}
    );
}

/** Envuelve el `Audio.Sound` de expo-av. Una sola vez (llamarla de nuevo no hace nada). */
export function instalarRegistroAv(Sound: { prototype: Sonido } | undefined = Audio?.Sound): boolean {
  const proto = Sound?.prototype as (Sonido & { [MARCA]?: true }) | undefined;
  if (!proto || typeof proto.loadAsync !== 'function' || typeof proto.unloadAsync !== 'function') return false;
  if (proto[MARCA]) return true;
  const carga = proto.loadAsync;
  const descarga = proto.unloadAsync;
  original = { carga, descarga };

  proto.loadAsync = function (this: Sonido, ...args: Parameters<Carga>) {
    // Recargando: ningún reproductor nuevo (lo soltaría el hilo equivocado al destruir la instancia).
    if (cerrado) return Promise.reject(new Error('expo-av: la app se está recargando'));
    // Ya estaba (cargado o cargándose: expo-av rechaza la segunda carga): ese rechazo no lo saca del registro.
    const yaEstaba = vivos.has(this);
    vivos.add(this);
    const p = carga.apply(this, args);
    const seguido = p.then(
      () => {
        // Terminó de cargar con la recarga ya en marcha: se suelta ya.
        if (cerrado) return descargar(this);
        // Un unloadAsync a media carga lo sacó del registro y expo-av lo ignoró: quedó cargado, se vuelve a anotar.
        vivos.add(this);
      },
      () => {
        if (!yaEstaba) vivos.delete(this);
      }
    );
    cargando.add(seguido);
    void seguido.finally(() => cargando.delete(seguido));
    return p;
  } as Carga;

  proto.unloadAsync = function (this: Sonido) {
    vivos.delete(this);
    return descarga.call(this);
  } as Descarga;

  Object.defineProperty(proto, MARCA, { value: true });
  return true;
}

/** Cuántos sonidos de expo-av siguen cargados (o cargándose). */
export function sonidosVivos(): number {
  return vivos.size;
}

/** ¿Está cerrado el registro (recargando)? */
export function registroCerrado(): boolean {
  return cerrado;
}

/**
 * Cierra el registro y suelta todos los sonidos cargados, en el hilo de expo-av (el principal), con tope: uno que
 * no responde no cuelga la recarga. Nunca lanza. Devuelve cuántos se soltaron y cuántos quedaron sin confirmar.
 */
export async function soltarTodo(topeMs = 1500): Promise<{ soltados: number; pendientes: number }> {
  cerrado = true;
  const lista = [...vivos];
  let confirmados = 0;
  const trabajo = Promise.all([...lista.map((s) => descargar(s).then(() => void (confirmados += 1))), ...[...cargando]]).then(() => 'ok' as const);
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const tope = new Promise<'tope'>((r) => (reloj = setTimeout(() => r('tope'), topeMs)));
  try {
    await Promise.race([trabajo, tope]);
  } finally {
    clearTimeout(reloj);
  }
  // Sin confirmar: descargas que el nativo no contestó a tiempo y cargas que siguen en curso.
  return { soltados: lista.length, pendientes: lista.length - confirmados + cargando.size };
}

/** La recarga no se hizo: el registro vuelve a aceptar sonidos. */
export function abrirRegistro() {
  cerrado = false;
}

/** Solo pruebas. */
export function _reiniciarRegistroAv() {
  vivos.clear();
  cargando.clear();
  cerrado = false;
}

instalarRegistroAv();
