/**
 * ¿SUENAN LOS SONIDOS DE TRABAJO EN ESTE TELÉFONO? (compa/sonidosTrabajo.ts decide; aquí el disco, la red y el ajuste
 * de efectos). Como las muletillas (lib/muletillasAjuste.ts):
 *  · la persona: Ajustes → La mesa → «Sonidos mientras trabaja» (`CLAVE_AJUSTE_AMBIENTE`; sin elegir, encendidos), y
 *    «Efectos de sonido» de siempre (lib/sfx.ts);
 *  · el servidor: GET /api/movil/config (server/movil-config.ts, AURA_AMBIENTE=0 los apaga para todos sin sacar APK).
 *    Vale lo último guardado al instante; se refresca al entrar a la mesa y cada 10 min. Sin red o con un servidor viejo
 *    (404) queda lo guardado; nunca leído, permitidos.
 * Quien cambia algo avisa (`suscribirAmbiente`): un sonido que suena se va al momento si se apagan.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';
import { miga } from './reporte';
import { sfxActivos } from './sfx';
import { ajusteAmbienteGuardado, ambienteRemotoValido, decidirAmbiente, type MotivoAmbiente } from '../compa/sonidosTrabajo';

export const CLAVE_AJUSTE_AMBIENTE = 'aura.ambiente.ajuste';
const CLAVE_REMOTA = 'aura.ambiente.remota';
export const REFRESCO_AMBIENTE_MS = 10 * 60_000;

let ajuste: boolean | null = null;
let remoto = true;
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

export function suscribirAmbiente(f: () => void): () => void {
  oyentes.add(f);
  return () => oyentes.delete(f);
}

/** Lo guardado (el ajuste y lo último que dijo el servidor), una vez por proceso. */
export function leerAmbiente(): Promise<void> {
  if (leido) return leido;
  leido = (async () => {
    try {
      const [a, r] = await Promise.all([AsyncStorage.getItem(CLAVE_AJUSTE_AMBIENTE), AsyncStorage.getItem(CLAVE_REMOTA)]);
      ajuste = ajusteAmbienteGuardado(a);
      remoto = r !== '0';
    } catch {
      /* sin disco: lo de omisión */
    }
  })();
  return leido;
}

export type EstadoAmbiente = { encendidos: boolean; motivo: MotivoAmbiente; valor: boolean };

/** Lo de ahora (síncrono). `valor` es lo que muestra el interruptor de Ajustes (sin elegir: encendido). */
export function estadoAmbiente(): EstadoAmbiente {
  const d = decidirAmbiente({ efectos: sfxActivos(), ajuste, remoto });
  return { ...d, valor: ajuste ?? true };
}

/** ¿Puede sonar un sonido de trabajo ahora? (los efectos, su ajuste y el servidor). */
export function ambienteActivo(): boolean {
  return estadoAmbiente().encendidos;
}

export async function fijarAmbiente(v: boolean) {
  ajuste = v;
  await AsyncStorage.setItem(CLAVE_AJUSTE_AMBIENTE, v ? '1' : '0').catch(() => {});
  miga(`sonidos de trabajo: ${v ? 'encendidos' : 'apagados'} en Ajustes`);
  avisar();
}

/** GET /api/movil/config sin frenar nada (como mucho una vez cada REFRESCO_AMBIENTE_MS, salvo `ya`). */
export async function refrescarAmbienteRemoto(ya = false): Promise<void> {
  if (!ya && Date.now() - ultimaRemota < REFRESCO_AMBIENTE_MS) return;
  ultimaRemota = Date.now();
  try {
    const r = await api<unknown>('/api/movil/config', { method: 'GET' }, 6000, false);
    const nuevo = ambienteRemotoValido(r);
    await AsyncStorage.setItem(CLAVE_REMOTA, nuevo ? '1' : '0').catch(() => {});
    if (nuevo !== remoto) {
      remoto = nuevo;
      miga(`sonidos de trabajo: el servidor los ${nuevo ? 'permite' : 'apaga'}`);
      avisar();
    }
  } catch {
    /* sin red o servidor viejo: queda lo guardado */
  }
}
