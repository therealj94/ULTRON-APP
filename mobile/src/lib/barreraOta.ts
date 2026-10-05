/**
 * LA BARRERA DE LA ACTUALIZACIÓN POR AIRE: cuándo SÍ y cuándo NO recargar la app.
 *
 * La OTA descargada se aplica en un momento seguro (lib/ota.ts). Recargar es tirar el JS vivo: una
 * llamada en curso se corta, un borrador del chat que solo vive en memoria se pierde, la conversación
 * con AURA se cae. Por eso, además del momento, que no haya trabajo activo; si lo hay, se pospone.
 *
 * Los momentos (`decidirAplicar`):
 *  · `volver`      volvió a la app tras FUERA_PARA_APLICAR_MS fuera: para ella es «volver a abrirla».
 *  · `quieto`      la app lleva QUIETO_PARA_APLICAR_MS sin un toque ni voz (la mesa siempre delante).
 *  · `fin-trabajo` acaba de terminar una llamada o la conversación con AURA y nadie tocó nada desde
 *                  hace QUIETO_TRAS_TRABAJO_MS.
 *  · `boton`       la persona tocó «Reiniciar».
 *
 * Cada frente registra cómo saber si tiene algo entre manos (`registrarTrabajoActivo`): los borradores
 * del chat, la llamada de un recordatorio sonando, la llamada en curso, la conversación con AURA. El
 * comprobador devuelve `true` (ocupado), `false` (libre) o la hora (epoch ms) del último movimiento:
 * eso cuenta como ocupado solo durante TRABAJO_CADUCA_MS (un borrador olvidado no frena para siempre).
 * Un comprobador que falla cuenta como ocupado: ante la duda, no se recarga.
 *
 * La llamada de PULSE2CHAT y la conversación con AURA también se saben por el bus del contrato; un
 * `activa: false` perdido no bloquea más de AVISO_CADUCA_MS (lo vivo lo dicen sus comprobadores).
 *
 * Sin React ni nada nativo: lo prueban las pruebas en node.
 */
import { escuchar } from '../nucleo/contrato';

/** Fuera al menos esto = «la volvió a abrir». Menos es mirar una notificación y regresar. */
export const FUERA_PARA_APLICAR_MS = 45_000;
/** Sin un toque ni voz durante esto, la app está quieta: se puede recargar sin que se note. */
export const QUIETO_PARA_APLICAR_MS = 3 * 60_000;
/** Tras colgar, lo que se espera sin toques antes de recargar. */
export const QUIETO_TRAS_TRABAJO_MS = 20_000;
/** Un trabajo con hora (un borrador) deja de frenar tras esto sin moverse. */
export const TRABAJO_CADUCA_MS = 10 * 60_000;
/** Un aviso del bus (`llamada`, `voz`) sin su cierre deja de frenar tras esto. */
export const AVISO_CADUCA_MS = 5 * 60_000;

/**
 * `arranque` (José, 5-oct: «apenas abra la app aparezca el de actualizar, porque sale hasta que uno está en el
 * avatar»): recién abierta la app (VENTANA_ARRANQUE_MS) todavía no hay nada entre manos, así que lo descargado se
 * aplica en el acto, sin esperar a que esté quieta ni a que vuelva de fuera. Lo vivo (teclado, llamada…) sí frena.
 */
export type Momento = 'volver' | 'quieto' | 'fin-trabajo' | 'boton' | 'arranque';
/** Cuánto dura «recién abierta» para aplicar sin esperar. */
export const VENTANA_ARRANQUE_MS = 60_000;

const trabajos = new Map<string, () => boolean | number>();
/** Desde cuándo el bus dice que hay llamada / que la conversación tiene el audio (0 = no). */
let llamadaDesde = 0;
let vozDesde = 0;
let ultimaActividad = Date.now();

escuchar('llamada', (e) => {
  llamadaDesde = e?.activa ? Date.now() : 0;
});
escuchar('voz', (e) => {
  vozDesde = e?.libre ? 0 : Date.now();
});

/** Un toque o una voz: la app no está quieta. */
export function marcarActividad(ahora = Date.now()) {
  ultimaActividad = ahora;
}
/** Cuánto lleva la app sin un toque ni voz. */
export const quietoDesdeMs = (ahora = Date.now()) => Math.max(0, ahora - ultimaActividad);

/** Un frente dice cómo saber si tiene trabajo activo. Devuelve cómo borrarse. */
export function registrarTrabajoActivo(nombre: string, activo: () => boolean | number): () => void {
  trabajos.set(nombre, activo);
  return () => {
    if (trabajos.get(nombre) === activo) trabajos.delete(nombre);
  };
}

/** Por qué no se debe recargar ahora (vacío = se puede). */
export function motivosParaNoRecargar(ahora = Date.now()): string[] {
  const m = new Set<string>();
  if (llamadaDesde && ahora - llamadaDesde < AVISO_CADUCA_MS) m.add('llamada');
  if (vozDesde && ahora - vozDesde < AVISO_CADUCA_MS) m.add('voz');
  for (const [nombre, activo] of trabajos) {
    let ocupado = true;
    try {
      const r = activo();
      ocupado = typeof r === 'number' ? r > 0 && ahora - r < TRABAJO_CADUCA_MS : !!r;
    } catch {
      /* ante la duda, ocupado */
    }
    if (ocupado) m.add(nombre);
  }
  return [...m];
}

/**
 * Qué hacer con la OTA descargada en este momento: `aplicar`, `posponer` (es el momento, pero hay
 * trabajo activo) o `nada` (no hay descargada, o no es el momento).
 */
export function decidirAplicar(o: { pendiente: boolean; momento: Momento; fueraMs?: number; quietoMs?: number; motivos?: string[] }): 'aplicar' | 'posponer' | 'nada' {
  if (!o.pendiente) return 'nada';
  const quieto = o.quietoMs ?? quietoDesdeMs();
  if (o.momento === 'volver' && (o.fueraMs ?? 0) < FUERA_PARA_APLICAR_MS) return 'nada';
  if (o.momento === 'quieto' && quieto < QUIETO_PARA_APLICAR_MS) return 'nada';
  if (o.momento === 'fin-trabajo' && quieto < QUIETO_TRAS_TRABAJO_MS) return 'nada';
  return (o.motivos ?? motivosParaNoRecargar()).length ? 'posponer' : 'aplicar';
}

/** Lo de siempre: al volver a la app tras `fueraMs` fuera. */
export function decidirAlVolver(o: { pendiente: boolean; fueraMs: number; motivos?: string[] }): 'aplicar' | 'posponer' | 'nada' {
  return decidirAplicar({ ...o, momento: 'volver' });
}

/**
 * ¿Hace falta instalar la APK nueva? Solo en el canal de producción (las APK de ramas escuchan
 * `pruebas` y nunca coinciden con la de main) y solo si lo publicado parece una huella de verdad.
 */
export function necesitaApkNueva(o: { instalado: string | null; publicado: string | null; canal: string | null }): boolean {
  const publicado = (o.publicado || '').trim();
  return o.canal === 'production' && !!o.instalado && /^[0-9a-f]{40}$/.test(publicado) && publicado !== o.instalado;
}

/*
 * ANTES DE RECARGAR (auditoría del 3-oct, UI01). Un borrador olvidado deja de frenar la recarga a los diez
 * minutos; para que no se pierda, cada frente puede guardar lo suyo justo antes (el chat: sus borradores
 * en el llavero, pulse/borradores.ts) y recuperarlo al volver.
 */
const antesDe = new Map<string, () => Promise<void> | void>();

/** Un frente dice qué guardar antes de recargar. Devuelve cómo borrarse. */
export function antesDeRecargar(nombre: string, guardar: () => Promise<void> | void): () => void {
  antesDe.set(nombre, guardar);
  return () => {
    if (antesDe.get(nombre) === guardar) antesDe.delete(nombre);
  };
}

/**
 * Corre todo lo registrado con `antesDeRecargar`, a la vez y con tope: uno que falla o no termina no
 * cuelga la recarga (se nombra en `fallaron`). Nunca lanza.
 */
export async function prepararRecarga(topeMs = 1500): Promise<{ fallaron: string[] }> {
  const fallaron: string[] = [];
  await Promise.all(
    [...antesDe].map(async ([nombre, guardar]) => {
      let reloj: ReturnType<typeof setTimeout> | undefined;
      const tope = new Promise<'tope'>((r) => (reloj = setTimeout(() => r('tope'), topeMs)));
      try {
        const r = await Promise.race([Promise.resolve().then(guardar).then(() => 'ok' as const), tope]);
        if (r === 'tope') fallaron.push(nombre);
      } catch {
        fallaron.push(nombre);
      } finally {
        clearTimeout(reloj);
      }
    })
  );
  return { fallaron };
}

/** Solo pruebas. */
export function _reiniciarBarreraOta() {
  antesDe.clear();
  trabajos.clear();
  llamadaDesde = 0;
  vozDesde = 0;
  ultimaActividad = Date.now();
}
