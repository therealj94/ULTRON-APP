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
 *    primer cuadro sano y 10 s sin caerse, se borra. Si la app arranca y la marca sigue, se mira POR QUÉ terminó
 *    (`causaDelCierre`): solo una caída de verdad cuenta; con dos, la cámara nueva se apaga un rato (1 h la primera
 *    vez, más si se repite) y se usa la de fotos.
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

const HORA = 3600_000;
const DIA = 24 * HORA;

/**
 * José, 7-oct 00:30: la app se cerró 13 s después de abrir, justo cuando bajó una OTA, sin ningún crash, y la guardia
 * de antes (cualquier salida sin explicar = caída; una sola bastaba) le apagó la voz en vivo 7 días. Ahora:
 *  · solo cuenta un cierre DE VERDAD con lo nativo en marcha (`causaDelCierre`): no una recarga de la OTA, no una
 *    actualización aplicada al reabrir, no deslizarla en recientes ni mandarla a segundo plano;
 *  · un golpe solo apaga lo nativo en ESA sesión; hacen falta `golpesMax` en `ventanaGolpesMs` para apagarlo más;
 *  · el castigo es corto y sube si se repite (`bloqueosMs`): 1 h, 6 h, 1 día, 3 días como mucho.
 */
export const GUARDIA = {
  /** Con el primer cuadro sano (o la primera frase que suena), cuánto más tiene que aguantar para borrar la marca. */
  sanoTrasMs: 10_000,
  /** Cierres de verdad con lo nativo en marcha que hacen falta para apagarlo en el teléfono (antes bastaba uno)… */
  golpesMax: 2,
  ventanaGolpesMs: 3 * DIA,
  /** …y por cuánto: la primera vez 1 h; si vuelve a pasar dentro de `ventanaBloqueosMs`, el siguiente escalón. */
  bloqueosMs: [HORA, 6 * HORA, DIA, 3 * DIA] as readonly number[],
  ventanaBloqueosMs: 7 * DIA,
  /** La forma de lo guardado. Lo de una versión anterior (el apagado de 7 días incluido) se borra UNA vez. */
  version: 2,
} as const;

export type EstadoGuardia = {
  /** Versión de la guardia que escribió esto (`GUARDIA.version`). Sin ella: lo dejó la guardia de antes. */
  v?: number;
  /** ts en que se empezó a montar; se borra con el rato sano o al soltarla con calma. */
  montando?: number;
  /** ts desde que corre sana; se borra al soltarla (desmontar, segundo plano). */
  enUso?: number;
  /** El JS (OTA) que corría al poner la marca: si al reabrir corre otro, la salida fue para aplicar la actualización. */
  bundle?: string;
  golpes?: number[];
  /** Cuándo se apagó por golpes (para escalar el castigo). */
  bloqueos?: number[];
  bloqueadaHasta?: number;
  motivo?: string;
};

export function guardiaValida(v: unknown): EstadoGuardia {
  const o = v as any;
  if (!o || typeof o !== 'object') return {};
  const ts = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : undefined);
  const lista = (x: unknown) => (Array.isArray(x) ? x.map(ts).filter((y: number | undefined): y is number => !!y).slice(-10) : undefined);
  const e: EstadoGuardia = {};
  if (typeof o.v === 'number' && Number.isInteger(o.v) && o.v > 0) e.v = o.v;
  if (ts(o.montando)) e.montando = ts(o.montando);
  if (ts(o.enUso)) e.enUso = ts(o.enUso);
  if (typeof o.bundle === 'string' && o.bundle) e.bundle = o.bundle.slice(0, 64);
  const golpes = lista(o.golpes);
  if (golpes) e.golpes = golpes;
  const bloqueos = lista(o.bloqueos);
  if (bloqueos) e.bloqueos = bloqueos;
  if (ts(o.bloqueadaHasta)) e.bloqueadaHasta = ts(o.bloqueadaHasta);
  if (typeof o.motivo === 'string') e.motivo = o.motivo.slice(0, 120);
  return e;
}

/**
 * Cómo se llama en los avisos lo que la guardia cuida. La misma guardia vale para la voz en streaming
 * (modules/aura-voz, lib/guardiaVoz.ts): solo cambian las palabras.
 */
export type TextosGuardia = { nombre: string; montar: string; montando: string };
export const TEXTOS_CAMARA: TextosGuardia = { nombre: 'cámara nueva', montar: 'al montar la cámara nueva', montando: 'montándola' };

/**
 * Lo que se sabe de cómo terminó la vez anterior.
 *  · `murio` (lib/reporte.ts): true = terminó EN PRIMER PLANO sin marca de cierre; false = se cerró bien (segundo
 *    plano, la recarga de la OTA con `reloadAsync`, un error de JS ya reportado); null = no se sabe.
 *  · `motivoAndroid`: lo que Android anotó de ESA salida (ApplicationExitInfo, lib/salidasPrevias.ts y
 *    modules/aura-camara): 'crash-nativo', 'crash', 'senal', 'la-persona', 'actualizada', 'memoria', 'otro'…
 *    null/undefined si no hay (APK sin el módulo de la cámara versión 2, Android < 11, iOS).
 *  · `bundle`: el JS (OTA) que corre AHORA; si la marca la puso otro, la app se reabrió con una actualización.
 */
export type SalidaAnterior = { murio: boolean | null; motivoAndroid?: string | null; bundle?: string | null };

/** Los motivos de Android que son una caída de verdad (no «la persona la cerró», «se actualizó» ni «memoria»). */
const CAIDA_ANDROID = /^(crash-nativo|crash|senal)$/;

export type CausaCierre =
  /** Prueba de caída: Android dice crash con la marca puesta. */
  | 'caida'
  /** Murió en primer plano sin marca de cierre y Android no dice nada: se cuenta (un golpe), no se castiga sola. */
  | 'sospecha'
  /** Se cerró bien: segundo plano, recarga de la OTA, la persona la deslizó, etc. */
  | 'limpia'
  /** Se reabrió con otro JS: la salida fue para aplicar una actualización. */
  | 'ota'
  /** No se sabe nada (sin la marca de reporte.ts): no se acusa a nadie. */
  | 'sin-datos';

/**
 * ¿La salida anterior, con la marca de la guardia puesta, fue una caída de lo nativo? Solo `caida` y `sospecha`
 * cuentan como golpe. Puro: lo prueban pruebas/camara/nativa.prueba.mjs y pruebas/voz/nativa.prueba.mjs.
 */
export function causaDelCierre(e: EstadoGuardia, s: SalidaAnterior): CausaCierre {
  if (s.murio === false) return 'limpia';
  if (e.bundle && s.bundle && e.bundle !== s.bundle) return 'ota';
  const m = typeof s.motivoAndroid === 'string' ? s.motivoAndroid : '';
  if (m) return CAIDA_ANDROID.test(m) ? 'caida' : 'limpia';
  return s.murio === true ? 'sospecha' : 'sin-datos';
}

/**
 * De las salidas que Android recuerda (lib/auraCamara.ts salidasNativas, la más nueva primero o en cualquier orden),
 * el motivo de la que terminó el proceso DESPUÉS de poner la marca (`desde`). null si no hay ninguna así.
 */
export function motivoDeSalidaTrasMarca(lista: { motivo: string; ts: number }[] | null | undefined, desde: number | undefined): string | null {
  if (!desde || !Array.isArray(lista)) return null;
  let mejor: { motivo: string; ts: number } | null = null;
  for (const s of lista) if (s && typeof s.ts === 'number' && typeof s.motivo === 'string' && s.ts >= desde && (!mejor || s.ts < mejor.ts)) mejor = s;
  return mejor ? mejor.motivo : null;
}

/** «1 hora», «6 horas», «1 día», «3 días». */
export function duracionEnPalabras(ms: number): string {
  if (ms < DIA) {
    const h = Math.max(1, Math.round(ms / HORA));
    return `${h} ${h === 1 ? 'hora' : 'horas'}`;
  }
  const d = Math.round(ms / DIA);
  return `${d} ${d === 1 ? 'día' : 'días'}`;
}

export type ArranqueGuardia = {
  estado: EstadoGuardia;
  /** Para /api/diag (reportarEstado): se apagó, un golpe, o se borró el apagado de la guardia anterior. */
  aviso?: string;
  /** Solo para las migas: una marca que quedó pero no fue caída (no cuenta). */
  nota?: string;
  /** Un golpe sin llegar a `golpesMax`: lo nativo no se usa en ESTA sesión (vuelve a probarse al reabrir). */
  soloSesion?: boolean;
};

/**
 * Al arrancar la app (una vez): lo que dejó la vez anterior. `salida` puede ser solo `murio` (boolean | null) o
 * todo lo que se sabe (`SalidaAnterior`). Lo de una guardia anterior (sin `v`) se borra una vez, con aviso si estaba
 * apagada: así la voz en vivo de José vuelve con esta OTA en vez del 14-oct.
 */
export function guardiaAlArrancar(eIn: EstadoGuardia, ahora: number, salida: boolean | null | SalidaAnterior, t: TextosGuardia = TEXTOS_CAMARA): ArranqueGuardia {
  const s: SalidaAnterior = salida !== null && typeof salida === 'object' ? salida : { murio: salida as boolean | null };
  if (eIn.v !== GUARDIA.version) {
    const estaba = !!eIn.bloqueadaHasta && eIn.bloqueadaHasta > ahora;
    return {
      estado: { v: GUARDIA.version },
      ...(estaba ? { aviso: `${t.nombre}: quito el apagado que dejó la guardia anterior (${(eIn.motivo || 'sin motivo').slice(0, 60)}); vuelve a usarse` } : {}),
    };
  }
  const golpes = (eIn.golpes || []).filter((x) => ahora - x <= GUARDIA.ventanaGolpesMs);
  const bloqueos = (eIn.bloqueos || []).filter((x) => ahora - x <= GUARDIA.ventanaBloqueosMs);
  let bloqueadaHasta = eIn.bloqueadaHasta && eIn.bloqueadaHasta > ahora ? eIn.bloqueadaHasta : undefined;
  let motivo = bloqueadaHasta ? eIn.motivo : undefined;
  let aviso: string | undefined;
  let nota: string | undefined;
  let soloSesion = false;
  const marca = eIn.montando ? 'montando' : eIn.enUso ? 'en-uso' : null;
  if (marca) {
    const causa = causaDelCierre(eIn, s);
    const como = marca === 'montando' ? t.montando : 'con ella encendida';
    if (causa === 'caida' || causa === 'sospecha') {
      golpes.push(ahora);
      const prueba = causa === 'caida' ? `Android: ${s.motivoAndroid}` : 'sin marca de cierre';
      if (golpes.length >= GUARDIA.golpesMax) {
        const dur = GUARDIA.bloqueosMs[Math.min(bloqueos.length, GUARDIA.bloqueosMs.length - 1)];
        bloqueos.push(ahora);
        bloqueadaHasta = Math.max(bloqueadaHasta || 0, ahora + dur);
        motivo = `se cerró ${golpes.length} veces (la última ${marca === 'montando' ? t.montar : `con la ${t.nombre}`})`;
        aviso = `${t.nombre}: la app se cerró ${golpes.length} veces con ella (la última ${como}, ${prueba}); la apago ${duracionEnPalabras(dur)} en este teléfono`;
        golpes.length = 0;
      } else {
        soloSesion = true;
        aviso = `${t.nombre}: la app se cerró ${como} (${prueba}; 1 aviso); en esta sesión va por la de siempre`;
      }
    } else nota = `${t.nombre}: la marca quedó de un cierre que no fue caída (${causa}${s.motivoAndroid ? `, Android: ${s.motivoAndroid}` : ''}); no cuenta`;
  }
  return {
    estado: {
      v: GUARDIA.version,
      ...(golpes.length ? { golpes } : {}),
      ...(bloqueos.length ? { bloqueos } : {}),
      ...(bloqueadaHasta ? { bloqueadaHasta, motivo } : {}),
    },
    ...(aviso ? { aviso } : {}),
    ...(nota ? { nota } : {}),
    ...(soloSesion ? { soloSesion } : {}),
  };
}

/** La marca antes de lo nativo; `bundle` = el JS (OTA) que corre ahora (para no culpar a una actualización). */
export const guardiaAlMontar = (e: EstadoGuardia, ahora: number, bundle?: string | null): EstadoGuardia => {
  const r: EstadoGuardia = { ...e, v: GUARDIA.version, montando: ahora, enUso: undefined };
  if (bundle) r.bundle = bundle;
  else delete r.bundle;
  return r;
};
export const guardiaAlSanar = (e: EstadoGuardia, ahora: number): EstadoGuardia => ({ ...e, v: GUARDIA.version, montando: undefined, enUso: ahora });
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
