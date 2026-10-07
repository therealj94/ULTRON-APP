/**
 * ¿VOZ EN STREAMING O LA DE SIEMPRE? La red de seguridad del reproductor nativo (modules/aura-voz), igual que la de
 * la cámara en vivo (lib/guardiaCamara.ts). Lo puro está en lib/vozNativa.ts y lib/camaraNativa.ts (la guardia); aquí
 * lo que toca el disco y la red. docs/adr/ADR-voz-en-streaming.md.
 *
 *  1. ¿El binario lo trae? (lib/auraVoz.ts) Una APK anterior que recibe este JS por aire no lo tiene.
 *  2. Guardia contra cierres: antes de la PRIMERA frase por el nativo en este proceso se anota «arrancando» en el
 *     disco (y se ESPERA a que quede escrito); con la primera frase que suena y 10 s más, se borra. Si la app arranca
 *     y la encuentra, se mira por qué terminó (lib/salidaAnterior.ts + camaraNativa.ts `causaDelCierre`): una recarga
 *     de la OTA, una actualización aplicada al reabrir, deslizarla o mandarla a segundo plano NO cuentan. Una caída de
 *     verdad es un golpe: esa sesión va por la de siempre; dos en tres días la apagan 1 h (más si se repite) y se avisa
 *     por /api/diag. Si la marca NO se puede escribir, esa sesión va por el camino de siempre.
 *  3. Interruptor remoto: GET /api/movil/config (server/movil-config.ts, AURA_VOZ_STREAM=0 lo apaga). Lo último
 *     guardado vale al instante y se refresca por detrás (al arrancar, al volver al frente y cada 10 min).
 *  4. El ajuste «Voz en vivo (nueva)» (encendido por omisión donde exista).
 *  5. Si en esta sesión el módulo truena (o falla dos frases seguidas), lib/tts.ts lo anota y no se reintenta hasta
 *     reabrir la app; aquí se reporta.
 *
 * Hasta que esto lea lo guardado, lib/tts.ts usa el camino de siempre (`permitirVozEnVivo` empieza en false).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';
import { api } from './api';
import { vozVivoDisponible } from './auraVoz';
import { FilaGuardia, GUARDIA, guardiaAlArrancar, guardiaAlMontar, guardiaAlSanar, guardiaAlSoltar, guardiaBloqueada, guardiaValida, tocaRefrescarRemota, type EstadoGuardia } from './camaraNativa';
import { TEXTOS_GUARDIA_VOZ, configVozValida, elegirVoz, type ConfigVozRemota, type MotivoVoz } from './vozNativa';
import { alPrimeraVozEnVivo, escucharVozEnVivo, estadoVozEnVivo, permitirVozEnVivo } from './tts';
import { loadSettings, saveSettings } from './storage';
import { miga, reportarEstado } from './reporte';
import { bundleActual, salidaAnterior } from './salidaAnterior';

const CLAVE_GUARDIA = 'aura_voz_nativa_guardia_v1';
const CLAVE_REMOTA = 'aura_voz_nativa_remota_v1';

let guardia: EstadoGuardia = {};
let remota: ConfigVozRemota = { activa: true };
let ajuste: boolean | undefined;
let leido = false;
let arranque: Promise<void> | null = null;
let motivo: MotivoVoz = 'sin-decidir';
let sanoPendiente: ReturnType<typeof setTimeout> | null = null;
let sana = false;
/** Un golpe de la guardia (sin llegar a apagarla): esta sesión, por la de siempre. */
let soloSesion = false;
const oyentes = new Set<() => void>();

const fila = new FilaGuardia((texto) => AsyncStorage.setItem(CLAVE_GUARDIA, texto));

function escribirGuardia(e: EstadoGuardia): Promise<boolean> {
  guardia = e;
  return fila.poner(e);
}

function avisar() {
  for (const f of oyentes) {
    try {
      f();
    } catch {
      /* */
    }
  }
}

/** Para Ajustes: cuando cambia algo (el servidor la apagó, falló, cambió el ajuste). */
export function suscribirVoz(f: () => void): () => void {
  oyentes.add(f);
  return () => oyentes.delete(f);
}

/** Decide con lo que se sabe y se lo dice a lib/tts.ts. */
function aplicar() {
  const d = elegirVoz({
    android: Platform.OS === 'android',
    modulo: vozVivoDisponible(),
    decidido: leido,
    ajuste,
    remoto: remota.activa,
    bloqueada: soloSesion || guardiaBloqueada(guardia, Date.now()),
    falloEnSesion: !!estadoVozEnVivo().fallo,
  });
  if (d.motivo !== motivo) miga(`voz en vivo: ${d.usar === 'vivo' ? 'encendida' : `la de siempre (${d.motivo})`}`);
  motivo = d.motivo;
  permitirVozEnVivo(d.usar === 'vivo');
  avisar();
}

/** Una vez por proceso (AppAura al montar): lo que dejó la vez anterior, lo guardado y lo que dice el servidor. */
export function prepararVoz(): Promise<void> {
  if (arranque) return arranque;
  arranque = (async () => {
    if (Platform.OS !== 'android' || !vozVivoDisponible()) {
      leido = true;
      aplicar();
      return;
    }
    try {
      const [g, r, s] = await Promise.all([AsyncStorage.getItem(CLAVE_GUARDIA), AsyncStorage.getItem(CLAVE_REMOTA), loadSettings().catch(() => null)]);
      remota = configVozValida(r ? JSON.parse(r) : null);
      ajuste = s?.vozEnVivo;
      const previa = guardiaValida(g ? JSON.parse(g) : null);
      const inicio = guardiaAlArrancar(previa, Date.now(), await salidaAnterior(previa), TEXTOS_GUARDIA_VOZ);
      soloSesion = !!inicio.soloSesion;
      await escribirGuardia(inicio.estado);
      if (inicio.nota) miga(inicio.nota);
      if (inicio.aviso) reportarEstado(inicio.aviso);
    } catch {
      /* lo guardado no se pudo leer: lo de fábrica */
    }
    // La primera frase por el nativo espera a que «arrancando» quede en el disco (si no se puede, la de siempre).
    alPrimeraVozEnVivo(async () => {
      const ok = await escribirGuardia(guardiaAlMontar(guardia, Date.now(), bundleActual()));
      miga(ok ? 'voz en vivo: arrancando' : 'voz en vivo: no pude anotar «arrancando» en el disco');
      if (!ok) reportarEstado('voz en vivo: no pude anotar la guardia en el disco; sigo con la de siempre');
      return ok;
    });
    escucharVozEnVivo({
      alSonar: () => {
        if (sana || sanoPendiente) return;
        sanoPendiente = setTimeout(() => {
          sanoPendiente = null;
          sana = true;
          void escribirGuardia(guardiaAlSanar(guardia, Date.now()));
          miga('voz en vivo: sana');
        }, GUARDIA.sanoTrasMs);
      },
      alFallar: (f, apagada) => {
        miga(`voz en vivo: una frase no sonó (${f.codigo}${f.status ? ` ${f.status}` : ''}); va por la de siempre`);
        if (apagada) {
          reportarEstado(`voz en vivo: falló (${apagada.slice(0, 120)}); sigo con la de siempre hasta reabrir la app`);
          aplicar();
        }
      },
    });
    leido = true;
    aplicar();
    void refrescarRemota();
    vigilar();
  })();
  return arranque;
}

let ultimaRemota = 0;
let remotaEnCurso = false;
let vigilando = false;

/** El interruptor remoto en sesiones largas, y la guardia se suelta con calma al irse a segundo plano. */
function vigilar() {
  if (vigilando) return;
  vigilando = true;
  const quizas = (m: 'frente' | 'tic') => {
    if (tocaRefrescarRemota({ ahora: Date.now(), ultima: ultimaRemota, motivo: m, enCurso: remotaEnCurso })) void refrescarRemota();
  };
  try {
    AppState.addEventListener('change', (s) => {
      if (s === 'active') quizas('frente');
      else if (guardia.montando || guardia.enUso) {
        // A segundo plano con calma: la voz se calló, no es un cierre con ella andando.
        if (sanoPendiente) clearTimeout(sanoPendiente);
        sanoPendiente = null;
        sana = false;
        void escribirGuardia(guardiaAlSoltar(guardia));
        // La próxima frase por el nativo vuelve a anotar «arrancando».
        alPrimeraVozEnVivo(async () => escribirGuardia(guardiaAlMontar(guardia, Date.now(), bundleActual())));
      }
    });
    setInterval(() => AppState.currentState === 'active' && quizas('tic'), 60_000);
  } catch {
    /* sin AppState: solo al arrancar */
  }
}

/** GET /api/movil/config, sin frenar nada. Si cambia, se guarda y se aplica. */
export async function refrescarRemota(): Promise<void> {
  if (remotaEnCurso) return;
  remotaEnCurso = true;
  ultimaRemota = Date.now();
  try {
    const r = await api<unknown>('/api/movil/config', { method: 'GET' }, 6000, false);
    const nueva = configVozValida(r);
    const cambio = nueva.activa !== remota.activa;
    remota = nueva;
    await AsyncStorage.setItem(CLAVE_REMOTA, JSON.stringify(nueva)).catch(() => {});
    if (cambio) {
      miga(`voz en vivo: el servidor la ${nueva.activa ? 'permite' : 'apaga'}`);
      aplicar();
    }
  } catch {
    /* sin red o servidor viejo (404): se queda lo guardado */
  } finally {
    remotaEnCurso = false;
  }
}

/** El ajuste «Voz en vivo (nueva)». */
export async function ajusteVozEnVivo(): Promise<boolean> {
  const s = await loadSettings().catch(() => null);
  return s?.vozEnVivo !== false;
}

export async function fijarVozEnVivo(v: boolean) {
  await saveSettings({ vozEnVivo: v });
  ajuste = v;
  miga(`voz en vivo: ${v ? 'encendida' : 'apagada'} en Ajustes`);
  aplicar();
}

/** Lo que se lee en Ajustes debajo del interruptor. */
export function estadoVozNueva(): { disponible: boolean; bloqueada: boolean; remota: boolean; fallo: string | null } {
  return { disponible: Platform.OS === 'android' && vozVivoDisponible(), bloqueada: soloSesion || guardiaBloqueada(guardia, Date.now()), remota: remota.activa, fallo: estadoVozEnVivo().fallo };
}
