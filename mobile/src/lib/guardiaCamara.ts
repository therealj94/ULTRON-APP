/**
 * ¿CÁMARA NUEVA O DE FOTOS? La red de seguridad de la cámara en vivo (modules/aura-camara). Lo puro
 * (decidir, la guardia, revisar lo que llega) está en lib/camaraNativa.ts; aquí lo que toca el disco y la red.
 *
 *  1. ¿El binario la trae? (lib/auraCamara.ts) Una APK anterior que recibe este JS por aire no la tiene.
 *  2. Guardia contra cierres: antes de montar la vista nativa se anota «montando» en el disco (y se ESPERA a
 *     que quede escrito: si la app muere al montar, la marca tiene que estar). Con el primer cuadro sano y
 *     10 s más, se borra. Si la app arranca y la encuentra, se murió montándola: la cámara nueva queda
 *     apagada 7 días en este teléfono y se avisa por /api/diag (lib/reporte.ts). Si se murió con ella ya
 *     andando, cuenta un golpe; dos en tres días, 3 días apagada.
 *  3. Interruptor remoto: GET /api/movil/config (server/movil-config.ts, AURA_CAMARA_RAPIDA=0 la apaga).
 *     Se usa lo último guardado al instante y se refresca por detrás: al arrancar, al volver al frente (si pasó
 *     1 min) y cada 10 min con la app delante (camaraNativa.ts REMOTA). Si el servidor la apaga con la cámara
 *     andando, se cambia a la de fotos en ese momento. No es instantáneo: el peor caso es el TTL.
 *  2b. Si la marca «montando» NO se puede escribir (disco lleno, AsyncStorage roto), no se monta la nativa: se avisa
 *     y la mesa usa la de fotos (sin la marca, un cierre al montar no se detectaría la próxima vez).
 *  4. El ajuste «Cámara rápida (nueva)» (encendida por omisión donde exista).
 *  5. Si en esta sesión falló (no abrió, sin cuadros), la de fotos hasta reabrir la app.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';
import { api } from './api';
import { camaraVivaDisponible } from './auraCamara';
import {
  FilaGuardia,
  configCamaraValida,
  elegirCamara,
  guardiaAlArrancar,
  guardiaAlMontar,
  guardiaAlSanar,
  guardiaAlSoltar,
  guardiaBloqueada,
  guardiaValida,
  tocaRefrescarRemota,
  type ConfigCamaraRemota,
  type EstadoGuardia,
  type MotivoCamara,
} from './camaraNativa';
import { loadSettings, saveSettings } from './storage';
import { miga, murioLaVezAnterior, reportarEstado } from './reporte';

const CLAVE_GUARDIA = 'aura_camara_nativa_guardia_v1';
const CLAVE_REMOTA = 'aura_camara_nativa_remota_v1';

let guardia: EstadoGuardia = {};
let remota: ConfigCamaraRemota = { activa: true };
let falloEnSesion: string | null = null;
let arranque: Promise<void> | null = null;
const oyentes = new Set<() => void>();

function avisar() {
  for (const f of oyentes) {
    try {
      f();
    } catch {
      /* */
    }
  }
}

/** Para que la mesa cambie de cámara al momento (el servidor la apagó, falló, cambió el ajuste). */
export function suscribirCamara(f: () => void): () => void {
  oyentes.add(f);
  return () => oyentes.delete(f);
}

/** Las escrituras van en fila (camaraNativa.ts FilaGuardia); cada una dice si quedó en el disco. */
const fila = new FilaGuardia((texto) => AsyncStorage.setItem(CLAVE_GUARDIA, texto));

function escribirGuardia(e: EstadoGuardia): Promise<boolean> {
  guardia = e;
  return fila.poner(e);
}

/** Una vez por proceso: lo que dejó la vez anterior y lo último que dijo el servidor. */
function arrancar(): Promise<void> {
  if (arranque) return arranque;
  arranque = (async () => {
    try {
      const [g, r] = await Promise.all([AsyncStorage.getItem(CLAVE_GUARDIA), AsyncStorage.getItem(CLAVE_REMOTA)]);
      remota = configCamaraValida(r ? JSON.parse(r) : null);
      const { estado, aviso } = guardiaAlArrancar(guardiaValida(g ? JSON.parse(g) : null), Date.now(), murioLaVezAnterior());
      await escribirGuardia(estado);
      if (aviso) reportarEstado(aviso);
    } catch {
      /* */
    }
    void refrescarRemota();
    vigilarRemota();
  })();
  return arranque;
}

let ultimaRemota = 0;
let remotaEnCurso = false;
let vigilando = false;

/** El interruptor remoto en sesiones largas: al volver al frente y cada `REMOTA.ttlMs` con la app delante. */
function vigilarRemota() {
  if (vigilando) return;
  vigilando = true;
  const quizas = (motivo: 'frente' | 'tic') => {
    if (tocaRefrescarRemota({ ahora: Date.now(), ultima: ultimaRemota, motivo, enCurso: remotaEnCurso })) void refrescarRemota();
  };
  try {
    AppState.addEventListener('change', (s) => s === 'active' && quizas('frente'));
    setInterval(() => AppState.currentState === 'active' && quizas('tic'), 60_000);
  } catch {
    /* sin AppState: solo al arrancar */
  }
}

/** GET /api/movil/config, sin frenar nada. Si cambia algo, se guarda y se avisa. */
export async function refrescarRemota(): Promise<void> {
  if (remotaEnCurso) return;
  remotaEnCurso = true;
  ultimaRemota = Date.now();
  try {
    const r = await api<unknown>('/api/movil/config', { method: 'GET' }, 6000, false);
    const nueva = configCamaraValida(r);
    const cambio = JSON.stringify(nueva) !== JSON.stringify(remota);
    remota = nueva;
    await AsyncStorage.setItem(CLAVE_REMOTA, JSON.stringify(nueva)).catch(() => {});
    if (cambio) {
      miga(`cámara nueva: el servidor la ${nueva.activa ? 'permite' : 'apaga'}`);
      avisar();
    }
  } catch {
    /* sin red o servidor viejo (404): se queda lo guardado */
  } finally {
    remotaEnCurso = false;
  }
}

export type DecisionCamara = { usar: 'vivo' | 'fotos'; motivo: MotivoCamara; remota: ConfigCamaraRemota };

/** Cuál cámara monta la mesa ahora. */
export async function decidirCamara(): Promise<DecisionCamara> {
  await arrancar();
  const s = await loadSettings().catch(() => null);
  const d = elegirCamara({
    android: Platform.OS === 'android',
    modulo: camaraVivaDisponible(),
    ajuste: s?.camaraRapida,
    remoto: remota.activa,
    bloqueada: guardiaBloqueada(guardia, Date.now()),
    falloEnSesion: !!falloEnSesion,
  });
  return { ...d, remota };
}

/**
 * Antes de montar la vista nativa. Se espera: la marca tiene que estar en el disco si la app muere ahí. false = NO
 * quedó escrita: quien monta no debe montar (CamaraVivo pasa a la de fotos con `onFallo`, que lo reporta).
 */
export async function camaraMontando(): Promise<boolean> {
  const ok = await escribirGuardia(guardiaAlMontar(guardia, Date.now()));
  miga(ok ? 'cámara nueva: montando' : 'cámara nueva: no pude anotar «montando» en el disco');
  return ok;
}

/** Primer cuadro sano + 10 s sin caerse. */
export function camaraSana(fps?: number) {
  void escribirGuardia(guardiaAlSanar(guardia, Date.now()));
  miga(`cámara nueva: sana${fps ? ` (${fps} cuadros/s)` : ''}`);
}

/** Se desmontó con calma (salir de la mesa, segundo plano, apagar la cámara). */
export function camaraSoltada() {
  if (!guardia.montando && !guardia.enUso) return;
  void escribirGuardia(guardiaAlSoltar(guardia));
}

/** Falló sin cerrar la app: la de fotos hasta reabrir, y se cuenta en el diagnóstico. */
export function camaraFallo(motivo: string) {
  if (falloEnSesion) return;
  falloEnSesion = motivo;
  void escribirGuardia(guardiaAlSoltar(guardia));
  reportarEstado(`cámara nueva: falló (${motivo.slice(0, 120)}); sigo con la de fotos`);
  avisar();
}

/** El ajuste de «Cámara rápida (nueva)». */
export async function ajusteCamaraRapida(): Promise<boolean> {
  const s = await loadSettings().catch(() => null);
  return s?.camaraRapida !== false;
}

export async function fijarCamaraRapida(v: boolean) {
  await saveSettings({ camaraRapida: v });
  miga(`cámara nueva: ${v ? 'encendida' : 'apagada'} en Ajustes`);
  avisar();
}

/** Lo que se lee en Ajustes debajo del interruptor. */
export function estadoCamaraNueva(): { disponible: boolean; bloqueada: boolean; remota: boolean; fallo: string | null } {
  return { disponible: Platform.OS === 'android' && camaraVivaDisponible(), bloqueada: guardiaBloqueada(guardia, Date.now()), remota: remota.activa, fallo: falloEnSesion };
}

export { arrancar as prepararCamara };
