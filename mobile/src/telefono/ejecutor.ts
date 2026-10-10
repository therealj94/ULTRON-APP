/**
 * EL QUE HACE LAS ACCIONES DEL TELÉFONO (José, 10-oct, APK 5.7.1: «le pedí abrir una app, Spotify, en mi celular y no
 * pudo»): abrir otra app o un enlace, navegar, la alarma y el temporizador del reloj, un borrador de SMS y la pantalla de
 * un evento del calendario. Lo usan la mesa (app/acciones.ts, por el bus) y la burbuja (burbuja/turnoBurbuja.ts, con las
 * acciones del `done`). Cada resultado es el RECIBO que va al servidor (telefono/recibos.ts): ok solo si el sistema
 * resolvió el intent y lo arrancó.
 *
 *  · Sin el módulo nativo (una APK anterior a la 5.7.1, con esta OTA): «esta versión de la app no puede…; actualiza a la
 *    5.7.1». En Dr Electrum o fuera de Android, nunca.
 *  · Una app por su nombre: telefono/apps.ts resolverApp; varias → pregunta cuál; ninguna → «no encuentro X».
 *  · Un enlace: si no hay app que lo abra, su respaldo por la web (`web`); si tampoco, se dice.
 *  · Desde la burbuja, abrir otra app la deja atrás: BurbujaActivity se termina sola al dejar de verse (onStop).
 *
 * Puro: todo lo de afuera entra por `deps` (las pruebas lo corren sin React Native).
 */
import type { AccionApp } from '../nucleo/contrato';
import { resolverApp, type AppInstalada } from './apps';

export type ReciboNativo = { ok: boolean; via?: string; motivo?: string };
/** Lo que expone el módulo nativo AuraTelefono (TelefonoAura.kt). */
export type NativoTelefono = {
  listarApps: () => Promise<AppInstalada[]>;
  abrirApp: (paquete: string) => Promise<boolean>;
  abrirEnlace: (uri: string) => Promise<boolean>;
  alarma?: (hora: number, minutos: number, etiqueta: string | null) => Promise<ReciboNativo>;
  temporizador?: (segundos: number, etiqueta: string | null) => Promise<ReciboNativo>;
  navegar?: (destino: string) => Promise<ReciboNativo>;
  marcar?: (numero: string) => Promise<ReciboNativo>;
  borradorSms?: (numero: string, texto: string) => Promise<ReciboNativo>;
  eventoCalendario?: (titulo: string, inicio: number, fin: number) => Promise<ReciboNativo>;
};

export type DepsEjecutor = {
  nativo: NativoTelefono | null;
  /** android, ios… */
  plataforma: string;
  electrum: boolean;
  tr: (es: string, en: string) => string;
};

export type ResultadoTelefono = { ok: boolean; detalle?: string; via?: string; app?: string };

export const VERSION_MANOS = '5.7.1';
export type AccionTelefonoApp = Extract<AccionApp, { tipo: 'abrir_app' | 'abrir_enlace' | 'navegar' | 'alarma' | 'temporizador' | 'sms' | 'evento_calendario' }>;

/** Lo que dice el teléfono cuando el sistema no lo pudo hacer, por el motivo del recibo nativo. */
function porQue(tr: DepsEjecutor['tr'], motivo: string | undefined, que: string): string {
  if (motivo === 'sin-app') return tr(`No encontré en tu teléfono una app para ${que}.`, `I couldn't find an app on your phone to ${que}.`);
  return tr(`El teléfono no me dejó ${que}.`, `Your phone didn't let me ${que}.`);
}

/** Las apps instaladas, una vez por un rato (listarlas cuesta). */
let cacheApps: { apps: AppInstalada[]; en: number } | null = null;
const VIDA_CACHE_MS = 5 * 60_000;
async function apps(n: NativoTelefono, ahora = Date.now()): Promise<AppInstalada[]> {
  if (cacheApps && ahora - cacheApps.en < VIDA_CACHE_MS) return cacheApps.apps;
  const lista = await n.listarApps();
  cacheApps = { apps: Array.isArray(lista) ? lista : [], en: ahora };
  return cacheApps.apps;
}
/** Pruebas. */
export function _olvidarCacheApps() {
  cacheApps = null;
}

/** Hace la acción del teléfono y devuelve su recibo (ver arriba). Nunca lanza. */
export async function ejecutarAccionTelefono(a: AccionTelefonoApp, d: DepsEjecutor): Promise<ResultadoTelefono> {
  const { tr } = d;
  if (d.electrum) return { ok: false, detalle: tr('Eso no lo hago en esta app.', "I don't do that in this app.") };
  if (d.plataforma !== 'android') return { ok: false, detalle: tr('Abrir otras apps solo lo sé hacer en Android, por ahora.', 'I can only open other apps on Android for now.') };
  const n = d.nativo;
  const actualiza = tr(
    `Esta versión de la app no puede abrir otras apps ni usar el reloj del teléfono; actualiza a la ${VERSION_MANOS}.`,
    `This version of the app can't open other apps or use the phone's clock; update to ${VERSION_MANOS}.`
  );
  if (!n) return { ok: false, detalle: actualiza };
  try {
    switch (a.tipo) {
      case 'abrir_app': {
        const r = resolverApp(a.app, await apps(n), a.paquete);
        if (r.tipo === 'ninguna') return { ok: false, detalle: tr(`No encuentro ${a.app} en tu teléfono. ¿Está instalada?`, `I can't find ${a.app} on your phone. Is it installed?`) };
        if (r.tipo === 'varias') {
          const nombres = r.opciones.map((o) => o.nombre).join(', ');
          return { ok: false, detalle: tr(`Tengo varias que se parecen: ${nombres}. ¿Cuál abro?`, `I have a few that match: ${nombres}. Which one should I open?`) };
        }
        const ok = await n.abrirApp(r.app.paquete);
        return ok ? { ok: true, via: 'app', app: r.app.nombre } : { ok: false, detalle: tr(`No pude abrir ${r.app.nombre}.`, `I couldn't open ${r.app.nombre}.`) };
      }
      case 'abrir_enlace': {
        if (await n.abrirEnlace(a.uri)) return { ok: true, via: 'enlace', ...(a.app ? { app: a.app } : {}) };
        if (a.web && (await n.abrirEnlace(a.web))) return { ok: true, via: 'web', ...(a.app ? { app: a.app } : {}) };
        return { ok: false, detalle: a.app ? tr(`No pude abrirlo: ¿tienes ${a.app} instalada?`, `I couldn't open it: do you have ${a.app} installed?`) : tr('No encontré con qué abrir eso.', "I couldn't find anything to open that.") };
      }
      case 'navegar': {
        if (!n.navegar) return { ok: false, detalle: actualiza };
        const r = await n.navegar(a.destino);
        return r.ok ? { ok: true, via: r.via, app: 'Maps' } : { ok: false, detalle: porQue(tr, r.motivo, tr(`llevarte a ${a.destino}`, `take you to ${a.destino}`)) };
      }
      case 'alarma': {
        if (!n.alarma) return { ok: false, detalle: actualiza };
        const r = await n.alarma(a.hora, a.minutos, a.etiqueta ?? null);
        return r.ok ? { ok: true, via: r.via } : { ok: false, detalle: porQue(tr, r.motivo, tr('poner la alarma', 'set the alarm')) };
      }
      case 'temporizador': {
        if (!n.temporizador) return { ok: false, detalle: actualiza };
        const r = await n.temporizador(a.segundos, a.etiqueta ?? null);
        return r.ok ? { ok: true, via: r.via } : { ok: false, detalle: porQue(tr, r.motivo, tr('poner el temporizador', 'set the timer')) };
      }
      case 'sms': {
        if (!n.borradorSms) return { ok: false, detalle: actualiza };
        const r = await n.borradorSms(a.numero, a.texto);
        return r.ok ? { ok: true, via: r.via } : { ok: false, detalle: porQue(tr, r.motivo, tr('dejarte el SMS', 'leave the text ready')) };
      }
      case 'evento_calendario': {
        if (!n.eventoCalendario) return { ok: false, detalle: actualiza };
        const r = await n.eventoCalendario(a.titulo, a.inicio, a.fin);
        // Revisión obligatoria: se abrió la pantalla para que ELLA lo guarde; nunca «agendado».
        return r.ok
          ? { ok: true, via: r.via, detalle: tr('Te abrí la pantalla para que lo confirmes.', 'I opened the screen for you to confirm it.') }
          : { ok: false, detalle: porQue(tr, r.motivo, tr('abrir tu calendario', 'open your calendar')) };
      }
      default:
        return { ok: false, detalle: tr('Eso no lo sé hacer en el teléfono.', "I don't know how to do that on the phone.") };
    }
  } catch {
    return { ok: false, detalle: tr('Algo falló en el teléfono al hacerlo.', 'Something failed on the phone.') };
  }
}
