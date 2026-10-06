/**
 * LA CÁMARA EN VIVO (modules/aura-camara): lo PURO, probado en Node (pruebas/camara/nativa.prueba.mjs).
 *
 * José: «que la cámara vea y reconozca en tiempo real». La cámara de fotos (components/CamaraVision.tsx)
 * saca ~3 fotos por segundo y ML Kit mira cada archivo: recuadros a 1-2 por segundo con retraso, y los
 * nombres tardan segundos. El módulo nativo (CameraX + ML Kit en flujo con seguimiento) manda a JS solo
 * eventos chicos (≤15 por segundo, solo si algo cambió) con un `id` estable por persona. Aquí:
 *
 *  · `eventoValido`: lo que llega del nativo, revisado (nada que venga de afuera se usa sin mirar).
 *  · `observacionNativa`: el evento → la misma `Observacion` que la máquina de escena de siempre
 *    (lib/escena.ts), con los umbrales del flujo (`UMBRALES_VIVO`).
 *  · `cajaEnVista`: el CONTRATO de coordenadas que cumple el nativo (Geometria.aVista en Kotlin): una caja
 *    del cuadro derecho (sin espejo) → fracciones de la vista previa tal como se ve (llena y recorta, con
 *    espejo en la frontal). Es lo mismo que lib/vistaEnVivo.ts cajaEnPantalla, en fracciones.
 *  · `elegirCamara`: cuál cámara usar (la nueva o la de fotos) y por qué.
 *  · La GUARDIA contra cierres (`guardia*`): antes de montar la cámara nativa se anota «montando»; con el
 *    primer cuadro sano y 10 s sin caerse, se borra. Si la app arranca y la marca sigue, la última vez se
 *    murió montándola: la cámara nueva queda apagada en ese teléfono unos días y se usa la de fotos.
 *
 * El motor nativo de 4.1.0 (vision-camera + worklets-core) cerraba la app al entrar a la mesa (0602318):
 * por eso hay guardia, interruptor remoto y ajuste, y la cámara de fotos sigue ahí, entera.
 */
import { FOV_DIAGONAL_GRADOS, UMBRALES, observacionMlkit, type CaraMlkit, type Observacion, type Umbrales } from './escena';

export type CajaF = { x: number; y: number; w: number; h: number };

export type CaraNativa = {
  /** trackingId de ML Kit (estable mientras se ve a la persona); negativo si el teléfono no siguió esa cara. */
  id: number;
  /** En fracciones de la VISTA tal como se ve (giro y espejo ya resueltos). Falta si la vista no tiene tamaño. */
  caja?: CajaF;
  /** En fracciones del cuadro derecho, SIN espejo (para la escena y para recortar). */
  foto: CajaF;
  yaw: number;
  pitch: number;
  roll: number;
  /** 0..1, o -1 si ML Kit no lo clasificó. */
  sonrisa: number;
  ojos: number;
  ojoI: number;
  ojoD: number;
};

export type EventoCaras = {
  caras: CaraNativa[];
  /** La vista previa en px. */
  w: number;
  h: number;
  /** El cuadro derecho que analizó ML Kit. */
  iw: number;
  ih: number;
  /** Lo que tardó ML Kit con ese cuadro. */
  ms: number;
  /** Cuadros analizados por segundo (medido en el nativo). */
  fps: number;
  /**
   * Hora de CAPTURA del cuadro (ms, reloj de pared del teléfono, comparable con Date.now): el nativo la saca de
   * `imageInfo.timestamp` del sensor y la pasa a hora de pared. Una APK anterior la fechaba después de ML Kit.
   */
  ts: number;
  lado: 'frontal' | 'trasera';
  espejo: boolean;
  /** Origen inmutable del cuadro (APK con el módulo nuevo): enlace de CameraX que lo produjo y número de cuadro. */
  epoca?: number;
  cuadro?: number;
  /** La captura en el reloj monótono del nativo (elapsedRealtime, ms) y de dónde salió: 'sensor' o 'llegada'. */
  tsMono?: number;
  base?: 'sensor' | 'llegada';
};

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const frac = (v: unknown) => Math.min(1, Math.max(0, num(v)));

function cajaValida(c: any): CajaF | null {
  if (!c || typeof c !== 'object') return null;
  const x = frac(c.x);
  const y = frac(c.y);
  const w = Math.min(1 - x, frac(c.w));
  const h = Math.min(1 - y, frac(c.h));
  return w > 0.002 && h > 0.002 ? { x, y, w, h } : null;
}

/** Lo que manda el nativo, revisado. null si no es un evento de caras. Como mucho 10 caras. */
export function eventoValido(e: unknown): EventoCaras | null {
  const o = e as any;
  if (!o || typeof o !== 'object' || !Array.isArray(o.caras)) return null;
  const iw = num(o.iw);
  const ih = num(o.ih);
  if (!(iw > 0 && ih > 0)) return null;
  const caras: CaraNativa[] = [];
  for (const c of o.caras.slice(0, 10)) {
    const foto = cajaValida(c?.foto);
    if (!foto) continue;
    const caja = cajaValida(c?.caja);
    const prob = (v: unknown) => {
      const n = num(v, -1);
      return n < 0 ? -1 : Math.min(1, n);
    };
    caras.push({
      id: Math.trunc(num(c.id, -1)),
      ...(caja ? { caja } : {}),
      foto,
      yaw: num(c.yaw),
      pitch: num(c.pitch),
      roll: num(c.roll),
      sonrisa: prob(c.sonrisa),
      ojos: prob(c.ojos),
      ojoI: prob(c.ojoI ?? c.ojos),
      ojoD: prob(c.ojoD ?? c.ojos),
    });
  }
  return {
    caras,
    w: Math.max(0, num(o.w)),
    h: Math.max(0, num(o.h)),
    iw,
    ih,
    ms: Math.max(0, num(o.ms)),
    fps: Math.max(0, num(o.fps)),
    ts: num(o.ts) > 0 ? num(o.ts) : Date.now(),
    lado: o.lado === 'trasera' ? 'trasera' : 'frontal',
    espejo: o.espejo !== false && o.lado !== 'trasera',
    ...(entero(o.epoca) !== undefined ? { epoca: entero(o.epoca) } : {}),
    ...(entero(o.cuadro) !== undefined ? { cuadro: entero(o.cuadro) } : {}),
    ...(num(o.tsMono) > 0 ? { tsMono: num(o.tsMono) } : {}),
    ...(o.base === 'sensor' || o.base === 'llegada' ? { base: o.base } : {}),
  };
}

/** Un entero ≥ 0 del nativo (época, número de cuadro), o undefined. */
function entero(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : undefined;
}

/**
 * Umbrales de la escena con el flujo nativo. El nativo manda hasta 15 eventos por segundo mientras algo
 * cambia, pero con alguien quieto solo un LATIDO cada 500 ms (cada 1 s sin nadie). Con los umbrales del
 * flujo de 10 fps (`UMBRALES`) eso rompía dos cosas: el latido de 500 ms pasaba la tolerancia de corte
 * (450 ms) y la llegada se reiniciaba, y el de 1 s sin nadie pasaba el hueco de muestreo (700 ms), así que
 * cada evento vacío se tomaba como «cámara apagada» y `se_fue` no llegaba nunca. Aquí el corte tolera más
 * que un latido con caras y el hueco empieza por encima del latido sin caras.
 */
export const UMBRALES_VIVO: Umbrales = { ...UMBRALES, toleranciaCorteMs: 800, huecoMuestreoMs: 1600 };

/** Las caras del evento en la forma que entiende `observacionMlkit` (píxeles del cuadro derecho). */
export function carasMlkitDeEvento(e: EventoCaras): CaraMlkit[] {
  return e.caras.map((c) => ({
    bounds: { x: c.foto.x * e.iw, y: c.foto.y * e.ih, width: c.foto.w * e.iw, height: c.foto.h * e.ih },
    yawAngle: c.yaw,
    pitchAngle: c.pitch,
    rollAngle: c.roll,
    smilingProbability: c.sonrisa,
    leftEyeOpenProbability: c.ojoI,
    rightEyeOpenProbability: c.ojoD,
  }));
}

/**
 * El evento → la `Observacion` de siempre. El cuadro ya viene derecho ('portrait': sin intercambiar lados)
 * y sin espejo, como las fotos de ML Kit: la máquina espeja x con la frontal igual que antes.
 */
export function observacionNativa(e: EventoCaras, opciones?: { trasera?: boolean; fovDiagonal?: number }): Observacion {
  const trasera = opciones?.trasera ?? e.lado === 'trasera';
  return observacionMlkit(carasMlkitDeEvento(e), e.iw, e.ih, 'portrait', e.ts, opciones?.fovDiagonal ?? FOV_DIAGONAL_GRADOS, { trasera });
}

/**
 * EL CONTRATO DE COORDENADAS (igual a Geometria.aVista en Kotlin). Una caja del cuadro derecho (fracciones,
 * sin espejo) → fracciones de una vista de vw×vh que muestra ese cuadro llenándola y recortando lo que sobre
 * (PreviewView FILL_CENTER), espejado con la frontal. Recortada a lo visible; null si queda fuera.
 */
export function cajaEnVista(f: CajaF, iw: number, ih: number, vw: number, vh: number, espejo: boolean): CajaF | null {
  if (!(iw > 0 && ih > 0 && vw > 0 && vh > 0)) return null;
  const s = Math.max(vw / iw, vh / ih);
  const W = iw * s;
  const H = ih * s;
  const ox = (vw - W) / 2;
  const oy = (vh - H) / 2;
  const x = espejo ? 1 - f.x - f.w : f.x;
  const izq = Math.max(0, ox + x * W);
  const arr = Math.max(0, oy + f.y * H);
  const der = Math.min(vw, ox + (x + f.w) * W);
  const aba = Math.min(vh, oy + (f.y + f.h) * H);
  if (der - izq < 1 || aba - arr < 1) return null;
  return { x: izq / vw, y: arr / vh, w: (der - izq) / vw, h: (aba - arr) / vh };
}

/** La caja de una cara para dibujarla en un marco de `marco` px: la del nativo si la trae, si no la cuenta aquí. */
export function rectDeCara(c: Pick<CaraNativa, 'caja' | 'foto'>, e: Pick<EventoCaras, 'iw' | 'ih' | 'espejo'>, marco: { w: number; h: number }) {
  const v = c.caja || cajaEnVista(c.foto, e.iw, e.ih, marco.w, marco.h, e.espejo);
  if (!v || !(marco.w > 0 && marco.h > 0)) return null;
  return { left: v.x * marco.w, top: v.y * marco.h, width: v.w * marco.w, height: v.h * marco.h };
}

/* ── cuál cámara ─────────────────────────────────────────────────────────────────────────── */

export type MotivoCamara = 'nueva' | 'sin-modulo' | 'no-android' | 'ajuste' | 'remoto' | 'bloqueada' | 'fallo';

/**
 * La cámara nueva solo si: Android, el binario trae el módulo (una APK vieja que recibe este JS por aire no
 * lo trae), el servidor no la apagó (interruptor remoto), la persona no la apagó en Ajustes (encendida por
 * omisión) y la guardia no la bloqueó en este teléfono. Si en esta sesión ya falló, la de fotos hasta reabrir.
 */
export function elegirCamara(o: { android: boolean; modulo: boolean; ajuste?: boolean; remoto?: boolean; bloqueada: boolean; falloEnSesion?: boolean }): { usar: 'vivo' | 'fotos'; motivo: MotivoCamara } {
  if (!o.android) return { usar: 'fotos', motivo: 'no-android' };
  if (!o.modulo) return { usar: 'fotos', motivo: 'sin-modulo' };
  if (o.remoto === false) return { usar: 'fotos', motivo: 'remoto' };
  if (o.ajuste === false) return { usar: 'fotos', motivo: 'ajuste' };
  if (o.bloqueada) return { usar: 'fotos', motivo: 'bloqueada' };
  if (o.falloEnSesion) return { usar: 'fotos', motivo: 'fallo' };
  return { usar: 'vivo', motivo: 'nueva' };
}

/* ── la guardia contra cierres ───────────────────────────────────────────────────────────── */

const DIA = 24 * 3600_000;

export const GUARDIA = {
  /** Con el primer cuadro sano, cuánto más tiene que aguantar para borrar «montando». */
  sanoTrasMs: 10_000,
  /** Murió montándola: apagada en este teléfono por… */
  bloqueoMontarMs: 7 * DIA,
  /** Murió con ella ya andando (después del rato sano): un golpe. Con `golpesMax` en `ventanaGolpesMs`… */
  golpesMax: 2,
  ventanaGolpesMs: 3 * DIA,
  /** …apagada por esto. */
  bloqueoGolpesMs: 3 * DIA,
} as const;

export type EstadoGuardia = {
  /** ts en que se empezó a montar; se borra con el rato sano o al soltarla con calma. */
  montando?: number;
  /** ts desde que corre sana; se borra al soltarla (desmontar, segundo plano). */
  enUso?: number;
  golpes?: number[];
  bloqueadaHasta?: number;
  motivo?: string;
};

export function guardiaValida(v: unknown): EstadoGuardia {
  const o = v as any;
  if (!o || typeof o !== 'object') return {};
  const ts = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : undefined);
  const e: EstadoGuardia = {};
  if (ts(o.montando)) e.montando = ts(o.montando);
  if (ts(o.enUso)) e.enUso = ts(o.enUso);
  if (Array.isArray(o.golpes)) e.golpes = o.golpes.map(ts).filter((x: number | undefined): x is number => !!x).slice(-10);
  if (ts(o.bloqueadaHasta)) e.bloqueadaHasta = ts(o.bloqueadaHasta);
  if (typeof o.motivo === 'string') e.motivo = o.motivo.slice(0, 120);
  return e;
}

/**
 * Al arrancar la app (una vez): lo que dejó la vez anterior. `murio`: si la app anterior terminó EN PRIMER
 * PLANO sin cerrarse (lib/reporte.ts: true = murió, false = se cerró bien o la recargó la OTA, null = no se
 * sabe). Con `murio === false` las marcas son viejas (una recarga a propósito) y no cuentan.
 */
/**
 * Cómo se llama en los avisos lo que la guardia cuida. La misma guardia vale para la voz en streaming
 * (modules/aura-voz, lib/guardiaVoz.ts): solo cambian las palabras.
 */
export type TextosGuardia = { nombre: string; montar: string; montando: string };
export const TEXTOS_CAMARA: TextosGuardia = { nombre: 'cámara nueva', montar: 'al montar la cámara nueva', montando: 'montándola' };

export function guardiaAlArrancar(e: EstadoGuardia, ahora: number, murio: boolean | null, t: TextosGuardia = TEXTOS_CAMARA): { estado: EstadoGuardia; aviso?: string } {
  const golpes = (e.golpes || []).filter((t) => ahora - t <= GUARDIA.ventanaGolpesMs);
  let bloqueadaHasta = e.bloqueadaHasta && e.bloqueadaHasta > ahora ? e.bloqueadaHasta : undefined;
  let motivo = bloqueadaHasta ? e.motivo : undefined;
  let aviso: string | undefined;
  if (murio !== false && e.montando) {
    bloqueadaHasta = Math.max(bloqueadaHasta || 0, ahora + GUARDIA.bloqueoMontarMs);
    motivo = `se cerró ${t.montar}`;
    aviso = `${t.nombre}: la app se cerró ${t.montando}; la apago ${Math.round(GUARDIA.bloqueoMontarMs / DIA)} días en este teléfono`;
  } else if (murio !== false && e.enUso) {
    golpes.push(ahora);
    if (golpes.length >= GUARDIA.golpesMax) {
      bloqueadaHasta = Math.max(bloqueadaHasta || 0, ahora + GUARDIA.bloqueoGolpesMs);
      motivo = `se cerró ${golpes.length} veces con la ${t.nombre}`;
      aviso = `${t.nombre}: la app se cerró ${golpes.length} veces con ella encendida; la apago ${Math.round(GUARDIA.bloqueoGolpesMs / DIA)} días`;
    } else aviso = `${t.nombre}: la app se cerró con ella encendida (1 aviso)`;
  }
  return {
    estado: { ...(golpes.length ? { golpes } : {}), ...(bloqueadaHasta ? { bloqueadaHasta, motivo } : {}) },
    ...(aviso ? { aviso } : {}),
  };
}

export const guardiaAlMontar = (e: EstadoGuardia, ahora: number): EstadoGuardia => ({ ...e, montando: ahora, enUso: undefined });
export const guardiaAlSanar = (e: EstadoGuardia, ahora: number): EstadoGuardia => ({ ...e, montando: undefined, enUso: ahora });
export const guardiaAlSoltar = (e: EstadoGuardia): EstadoGuardia => ({ ...e, montando: undefined, enUso: undefined });
/** La cámara nueva falló sin cerrar la app (no abrió, sin cuadros): no bloquea días, solo la sesión. */
export const guardiaBloqueada = (e: EstadoGuardia, ahora: number): boolean => !!e.bloqueadaHasta && e.bloqueadaHasta > ahora;

/**
 * Las escrituras de la guardia, en fila (CAM-D): «montando» y un «soltar» que llega enseguida no pueden quedar al
 * revés en el disco, y quien espera la marca sabe si QUEDÓ escrita (`true`) o no (`false`). Antes el fallo se
 * tragaba y la cámara nativa se montaba sin red de seguridad.
 */
export class FilaGuardia {
  private fila: Promise<unknown> = Promise.resolve();
  constructor(private escribir: (texto: string) => Promise<void>) {}

  poner(e: EstadoGuardia): Promise<boolean> {
    const texto = JSON.stringify(e);
    const p = this.fila.then(() => this.escribir(texto)).then(
      () => true,
      () => false
    );
    this.fila = p;
    return p;
  }
}

/* ── el interruptor remoto ───────────────────────────────────────────────────────────────── */

/**
 * Cuándo volver a preguntar al servidor (antes: una sola vez por proceso, y el interruptor no llegaba a una sesión
 * larga). Al volver al frente, si pasó `frenteMinMs` desde la última consulta; con la app delante, cada `ttlMs`.
 * No promete apagado instantáneo: el peor caso es `ttlMs` (o la próxima vuelta al frente).
 */
export const REMOTA = { ttlMs: 10 * 60_000, frenteMinMs: 60_000 };

export function tocaRefrescarRemota(o: { ahora: number; ultima: number; motivo: 'frente' | 'tic'; enCurso?: boolean }): boolean {
  if (o.enCurso) return false;
  const desde = o.ahora - o.ultima;
  return o.motivo === 'frente' ? desde >= REMOTA.frenteMinMs : desde >= REMOTA.ttlMs;
}

export type ConfigCamaraRemota = { activa: boolean; ladoCorto?: number; hz?: number; fps?: number };

/** Lo que dice GET /api/movil/config sobre la cámara nueva, revisado. Sin dato: encendida, con lo de fábrica. */
export function configCamaraValida(v: unknown): ConfigCamaraRemota {
  const o = (v as any)?.camaraRapida ?? v;
  if (!o || typeof o !== 'object') return { activa: true };
  const entre = (x: unknown, a: number, b: number) => (typeof x === 'number' && Number.isFinite(x) && x >= a && x <= b ? Math.round(x) : undefined);
  const r: ConfigCamaraRemota = { activa: o.activa !== false };
  const lc = entre(o.ladoCorto, 240, 1080);
  const hz = entre(o.hz, 1, 30);
  const fps = entre(o.fps, 1, 30);
  if (lc) r.ladoCorto = lc;
  if (hz) r.hz = hz;
  if (fps) r.fps = fps;
  return r;
}

/** Ritmo del nativo: lo pedido por el servidor o el de fábrica; con la cara dormida, pocos cuadros. */
export function ritmoNativo(c: ConfigCamaraRemota, dormido: boolean): { hz: number; fps: number; ladoCorto: number } {
  const ladoCorto = c.ladoCorto ?? 480;
  if (dormido) return { hz: 2, fps: 3, ladoCorto };
  return { hz: c.hz ?? 15, fps: c.fps ?? 15, ladoCorto };
}

/**
 * El tamaño de una cara en el cuadro nativo, en la escala de las fotos de 720 px de lado corto con que
 * `debeAprender` (caras.ts) fija su mínimo: así «aprender con el uso» pide los mismos píxeles de cara que antes.
 */
export const tamEquivalente = (tam: number, ladoCorto: number) => Math.max(0, tam) * (ladoCorto / 720);
