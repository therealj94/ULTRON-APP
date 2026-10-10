/**
 * LO DEL TELÉFONO QUE CORRE CON LA APP ABIERTA (APK 5.7.1; F02 y la auditoría del 10-oct):
 *  · los RECIBOS: cada acción local que la app hizo (el `hecho` del bus) vuelve al servidor con su id (telefono/recibos.ts);
 *  · el LATIDO del aparato: qué es, su versión, lo que completa y sus permisos, cada minuto con la app delante
 *    (POST /api/app/aparato → lib/aparatos.ts, el registro durable);
 *  · lo COMPARTIDO con AU-RA desde otra app (telefono/compartido.ts): a la mesa, como un turno nuevo.
 */
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as FS from 'expo-file-system/legacy';
import { api } from '../lib/api';
import { escuchar } from '../nucleo/contrato';
import { tr } from '../i18n';
import { ES_ELECTRUM } from '../variante';
import { fijarEnvioRecibos, mandarRecibo } from './recibos';
import { alCompartir, nativoTelefono } from './nativo';
import { guardarCompartido, pedidoDeCompartido } from './compartido';
import { capacidadesDeSuperficie, permisosDeNotifee } from './capacidades';
import { abrirRuta } from '../app/rutas';

export const LATIDO_MS = 60_000;

/** El envío de los recibos con la sesión (idempotente: la mesa y la burbuja lo instalan). */
export function instalarEnvioRecibos(): void {
  fijarEnvioRecibos((r) => api('/api/app/recibo', { method: 'POST', body: JSON.stringify(r) }, 10_000));
}

async function permisos(): Promise<Record<string, 'si' | 'no' | 'preguntar'>> {
  try {
    const notifee = require('@notifee/react-native').default as { getNotificationSettings?: () => Promise<unknown> };
    return permisosDeNotifee((await notifee.getNotificationSettings?.()) as Parameters<typeof permisosDeNotifee>[0]);
  } catch {
    return {};
  }
}

async function latido(): Promise<void> {
  const habilidades = capacidadesDeSuperficie('mesa', { android: Platform.OS === 'android', electrum: ES_ELECTRUM });
  // La versión NATIVA (la APK instalada): la del manifiesto JS cambia con cada OTA.
  const version = String(Constants.nativeAppVersion || Constants.expoConfig?.version || '');
  await api(
    '/api/app/aparato',
    { method: 'POST', body: JSON.stringify({ tipo: Platform.OS === 'android' ? 'android' : Platform.OS === 'ios' ? 'ios' : 'web', superficie: 'mesa', version, habilidades, permisos: await permisos() }) },
    10_000
  ).catch(() => undefined);
}

async function leerCompartido(): Promise<void> {
  const m = nativoTelefono();
  if (!m?.tomarCompartido) return;
  const c = await m.tomarCompartido().catch(() => null);
  const p = pedidoDeCompartido(c, tr);
  if (!p) return;
  let imagen: string | undefined;
  if (p.imagen) {
    try {
      imagen = `data:image/jpeg;base64,${await FS.readAsStringAsync(p.imagen, { encoding: FS.EncodingType.Base64 })}`;
    } catch {
      imagen = undefined;
    }
  }
  abrirRuta('Mesa');
  guardarCompartido({ mensaje: p.mensaje, ...(imagen ? { imagen } : {}) });
}

/** Se monta una vez en la raíz de AU-RA (app/AppAura.tsx). */
export function useTelefono(): void {
  useEffect(() => {
    instalarEnvioRecibos();
    // Lo que la mesa hizo de verdad (el `hecho` de cada acción): su recibo, con el id con que llegó.
    const quitarHecho = escuchar('hecho', (h) => void mandarRecibo(h.accion, h.ok, h.detalle));
    void latido();
    void leerCompartido();
    const reloj = setInterval(() => {
      if (AppState.currentState === 'active') void latido();
    }, LATIDO_MS);
    const estado = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      void latido();
      void leerCompartido();
    });
    const quitarCompartir = alCompartir(() => void leerCompartido());
    return () => {
      quitarHecho();
      clearInterval(reloj);
      estado.remove();
      quitarCompartir();
    };
  }, []);
}
