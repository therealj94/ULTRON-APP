/**
 * LA CARTERA EN LA APP: qué hoja está abierta (Cartera o Enviar dinero), el vigía del pago en curso con sus
 * piezas de verdad (la cadena, el relevo, el llavero) y cómo se abre Veta Wallet.
 *
 * Las hojas se dibujan una sola vez en la raíz (cartera/HojasCartera.tsx, dentro de AppAura) y se abren desde
 * cualquier lado: el botón «Enviar dinero» de una conversación, la fila «Cartera» del menú de la mesa, o AURA
 * por voz (las manos `cartera` y `pagar`, lib/manos-app.ts).
 */
import { useSyncExternalStore } from 'react';
import { Linking } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { correoCuenta } from '../lib/cuenta';
import * as RELEVO from '../pulse/relevo';
import * as CHATS from '../pulse/chats';
import { enlaceApp, enlaceWeb, ESQUEMA_WALLET, WALLET_WEB, type Envio } from './logica';
import { bloqueActual, buscarEnvioEnRed } from './red';
import { VigiaPago, type EstadoVigia, type Pendiente } from './vigia';

/* ── las hojas ────────────────────────────────────────────────────────────────────────────── */

export type HojaCartera = null | { tipo: 'cartera' } | { tipo: 'pagar'; correo: string; nombre: string; monto?: string; moneda?: string; deVoz?: boolean };

let hoja: HojaCartera = null;
const oyentesHoja = new Set<() => void>();

function fijarHoja(h: HojaCartera) {
  hoja = h;
  for (const f of [...oyentesHoja]) {
    try {
      f();
    } catch {
      /* nada */
    }
  }
}

const suscribirHoja = (f: () => void) => {
  oyentesHoja.add(f);
  return () => {
    oyentesHoja.delete(f);
  };
};
const hojaAhora = () => hoja;

export function useHojaCartera(): HojaCartera {
  return useSyncExternalStore(suscribirHoja, hojaAhora, hojaAhora);
}

export const abrirCartera = () => fijarHoja({ tipo: 'cartera' });
export const abrirPagar = (p: { correo: string; nombre: string; monto?: string; moneda?: string; deVoz?: boolean }) =>
  fijarHoja({ tipo: 'pagar', ...p, correo: String(p.correo || '').toLowerCase() });
export const cerrarHojaCartera = () => fijarHoja(null);

/** ¿Está montada la raíz que dibuja las hojas? (una pantalla suelta no las tiene). */
let anfitriones = 0;
export function anunciarHojasCartera(): () => void {
  anfitriones++;
  return () => {
    anfitriones = Math.max(0, anfitriones - 1);
  };
}
export const hayHojasCartera = () => anfitriones > 0;

/* ── el vigía del pago ────────────────────────────────────────────────────────────────────── */

const CAJON_PAGO = 'aura.cartera.pago';

export const vigia = new VigiaPago({
  bloque: () => bloqueActual(),
  buscar: (b, inicio) => buscarEnvioEnRed(b, inicio),
  publicar: async (p) => {
    try {
      await RELEVO.pago(p);
    } catch {
      return false;
    }
    // El comprobante es un mensaje del hilo: se trae ya, sin esperar la próxima vuelta del sondeo.
    void CHATS.refrescarHilo(p.para).catch(() => undefined);
    return true;
  },
  guardar: async (d) => {
    if (!d.pago && !d.usados.length) return SecureStore.deleteItemAsync(CAJON_PAGO).catch(() => {});
    await SecureStore.setItemAsync(CAJON_PAGO, JSON.stringify({ ...d, de: correoCuenta() })).catch(() => {});
  },
});

export function useVigia(): EstadoVigia {
  return useSyncExternalStore(
    (f) => vigia.suscribir(f),
    () => vigia.estado(),
    () => vigia.estado(),
  );
}

/** Al arrancar: si quedó un pago a medias (Android cerró AU-RA en la wallet), se sigue mirando. */
export async function retomarPago() {
  try {
    const d = JSON.parse((await SecureStore.getItemAsync(CAJON_PAGO)) || 'null') as { pago: Pendiente | null; usados?: string[]; de?: string } | null;
    // Solo el de quien está dentro: el pago a medias de otra persona del teléfono no es de esta sesión.
    if (!d || d.de !== correoCuenta()) return;
    vigia.retomar(d);
  } catch {
    /* nada que retomar */
  }
}

/* ── abrir Veta Wallet ────────────────────────────────────────────────────────────────────── */

async function abrirWeb(url: string) {
  try {
    await WebBrowser.openBrowserAsync(url, { showTitle: true, enableBarCollapsing: true });
  } catch {
    await Linking.openURL(url);
  }
}

/**
 * Abre el envío ya llenado: la app Veta Wallet del teléfono (`vetawallet://pagar…`) o, si no está, la web
 * (`#pagar…`, la misma que usa AURA para Windows). Devuelve por dónde se abrió.
 */
export async function abrirEnvioEnWallet(e: Envio, o: { web?: boolean } = {}): Promise<'app' | 'web'> {
  if (!o.web) {
    try {
      await Linking.openURL(enlaceApp(e));
      return 'app';
    } catch {
      /* no está la app: la web */
    }
  }
  await abrirWeb(enlaceWeb(e));
  return 'web';
}

/** Abre Veta Wallet sin nada llenado (para recibir, ver o firmar algo allá). */
export async function abrirVetaWallet() {
  try {
    await Linking.openURL(ESQUEMA_WALLET);
  } catch {
    await abrirWeb(WALLET_WEB);
  }
}
