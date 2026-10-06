/**
 * ¿MULETILLAS ENCENDIDAS EN ESTE TELÉFONO? Lo que toca el disco, la red y el módulo nativo; la decisión es pura
 * (lib/asentir.ts `decidirAsentir`):
 *  · el teléfono: Android con el micrófono crudo (modules/aura-mic) y cancelador de eco (`micEcoDisponible`);
 *  · la persona: Ajustes → Voz y oído → «Muletillas al escuchar» (`CLAVE_AJUSTE_ASENTIR`; sin elegir, encendidas
 *    donde el teléfono puede);
 *  · el servidor: GET /api/movil/config (server/movil-config.ts, AURA_ASENTIR=0 las apaga para todos sin sacar APK).
 *    Se usa lo último guardado al instante y se refresca al entrar a la mesa y cada 10 min con ella delante. Sin red o
 *    con un servidor viejo (404) queda lo guardado; nunca leído, permitidas.
 * Quien cambia algo avisa (`suscribirMuletillas`): la mesa enciende o apaga al momento.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { api } from './api';
import { CLAVE_AJUSTE_ASENTIR, ajusteAsentirGuardado, asentirRemotoValido, decidirAsentir, type MotivoAsentir } from './asentir';
import { micCrudoDisponible, micEcoDisponible } from './auraMic';
import { miga } from './reporte';

const CLAVE_REMOTA = 'aura.asentir.remota';
export const REFRESCO_REMOTO_MS = 10 * 60_000;

let ajuste: boolean | null = null;
let remota = true;
let leido: Promise<void> | null = null;
let ultimaRemota = 0;
const oyentes = new Set<() => void>();

function avisar() {
  for (const f of [...oyentes]) {
    try {
      f();
    } catch {
      /* */
    }
  }
}

export function suscribirMuletillas(f: () => void): () => void {
  oyentes.add(f);
  return () => oyentes.delete(f);
}

/** Lo guardado (el ajuste y lo último que dijo el servidor), una vez por proceso. */
export function leerMuletillas(): Promise<void> {
  if (leido) return leido;
  leido = (async () => {
    try {
      const [a, r] = await Promise.all([AsyncStorage.getItem(CLAVE_AJUSTE_ASENTIR), AsyncStorage.getItem(CLAVE_REMOTA)]);
      ajuste = ajusteAsentirGuardado(a);
      remota = r !== '0';
    } catch {
      /* sin disco: lo de omisión */
    }
  })();
  return leido;
}

export type EstadoMuletillas = { encendidas: boolean; motivo: MotivoAsentir; valor: boolean; disponible: boolean };

/** Lo de ahora (síncrono: tras `leerMuletillas`). `valor` es lo que muestra el interruptor de Ajustes. */
export function estadoMuletillas(): EstadoMuletillas {
  const android = Platform.OS === 'android';
  const crudo = micCrudoDisponible();
  const d = decidirAsentir({ android, microfonoCrudo: crudo, ecoDisponible: micEcoDisponible(), ajuste, remoto: remota });
  return { encendidas: d.encendidas, motivo: d.motivo, valor: ajuste ?? d.porOmision, disponible: android && crudo };
}

export async function fijarMuletillas(v: boolean) {
  ajuste = v;
  await AsyncStorage.setItem(CLAVE_AJUSTE_ASENTIR, v ? '1' : '0').catch(() => {});
  miga(`muletillas: ${v ? 'encendidas' : 'apagadas'} en Ajustes`);
  avisar();
}

/** GET /api/movil/config sin frenar nada (como mucho una vez cada REFRESCO_REMOTO_MS, salvo `ya`). */
export async function refrescarMuletillasRemota(ya = false): Promise<void> {
  if (!ya && Date.now() - ultimaRemota < REFRESCO_REMOTO_MS) return;
  ultimaRemota = Date.now();
  try {
    const r = await api<unknown>('/api/movil/config', { method: 'GET' }, 6000, false);
    const nueva = asentirRemotoValido(r);
    await AsyncStorage.setItem(CLAVE_REMOTA, nueva ? '1' : '0').catch(() => {});
    if (nueva !== remota) {
      remota = nueva;
      miga(`muletillas: el servidor las ${nueva ? 'permite' : 'apaga'}`);
      avisar();
    }
  } catch {
    /* sin red o servidor viejo: queda lo guardado */
  }
}
