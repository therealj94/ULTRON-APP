/**
 * EL MOTOR DE CARAS: una WebView escondida con face-api (motorCarasHtml.ts). Se monta SOLO mientras
 * la persona tiene el reconocimiento activado y la cámara encendida en la mesa; al apagar cualquiera
 * de las dos, se desmonta y no queda nada corriendo.
 *
 * `analizar(jpegBase64, cajas?)` → las caras de esa foto con su vector de 128 números. Con `cajas` (las de
 * ML Kit de esa misma foto, en fracciones) analiza un recorte agrandado de cada una y dice de cuál es cada
 * vector (`indice`): ve mejor las caras chicas o lejanas. La foto entra, se analiza en la WebView y se
 * suelta; no se guarda en ningún lado.
 */
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { miga } from '../lib/reporte';
import { MOTOR_CARAS_HTML } from './motorCarasHtml';
import { vectorValido, type CaraVista } from './caras';

/** Lo que se espera un análisis (la primera vez incluye bajar los modelos). */
const ESPERA_MS = 25_000;

export type ControlMotorCaras = {
  /** null: el motor no está listo o falló (se dice «no pude ver bien»). */
  analizar: (jpegBase64: string, cajas?: { x: number; y: number; w: number; h: number }[]) => Promise<CaraVista[] | null>;
  listo: () => boolean;
};

type Props = { onEstado?: (e: 'cargando' | 'listo' | 'fallo', motivo?: string) => void };

export const MotorCaras = forwardRef<ControlMotorCaras, Props>(function MotorCaras({ onEstado }, ref) {
  const web = useRef<WebView>(null);
  const listo = useRef(false);
  const esperando = useRef(new Map<number, (r: CaraVista[] | null) => void>());
  const n = useRef(0);
  const cb = useRef(onEstado);
  cb.current = onEstado;

  const alMensaje = useCallback((e: WebViewMessageEvent) => {
    let m: any;
    try {
      m = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (m?.tipo === 'lista') {
      listo.current = true;
      cb.current?.('listo');
      miga(`caras: motor listo (${m.motor})`);
    } else if (m?.tipo === 'fallo') {
      listo.current = false;
      cb.current?.('fallo', m.motivo);
      miga(`caras: el motor no cargó (${String(m.motivo).slice(0, 80)})`);
      for (const f of esperando.current.values()) f(null);
      esperando.current.clear();
    } else if (m?.tipo === 'caras' || m?.tipo === 'error') {
      const f = esperando.current.get(m.id);
      if (!f) return;
      esperando.current.delete(m.id);
      if (m.tipo === 'error') return f(null);
      const caras: CaraVista[] = (Array.isArray(m.caras) ? m.caras : []).filter((c: any) => vectorValido(c?.vector) && c?.caja);
      f(caras);
    }
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      listo: () => listo.current,
      analizar: (b64, cajas) =>
        new Promise<CaraVista[] | null>((resolver) => {
          if (!web.current || !b64) return resolver(null);
          const id = ++n.current;
          const t = setTimeout(() => {
            if (esperando.current.delete(id)) resolver(null);
          }, ESPERA_MS);
          esperando.current.set(id, (r) => {
            clearTimeout(t);
            resolver(r);
          });
          const cs = cajas?.length ? { cajas: cajas.map((c) => ({ x: +c.x.toFixed(4), y: +c.y.toFixed(4), w: +c.w.toFixed(4), h: +c.h.toFixed(4) })) } : {};
          web.current.injectJavaScript(`window.__caras&&window.__caras(${JSON.stringify({ tipo: 'analizar', id, imagen: b64, ...cs })});true;`);
        }),
    }),
    []
  );

  return (
    <View style={s.caja} pointerEvents="none">
      <WebView
        ref={web}
        source={{ html: MOTOR_CARAS_HTML, baseUrl: 'https://motor.caras.local/' }}
        originWhitelist={['https://*']}
        onMessage={alMensaje}
        onLoadStart={() => cb.current?.('cargando')}
        onContentProcessDidTerminate={() => {
          listo.current = false;
          cb.current?.('fallo', 'la WebView se cerró');
        }}
        onRenderProcessGone={() => {
          listo.current = false;
          cb.current?.('fallo', 'la WebView se cerró');
        }}
        javaScriptEnabled
        cacheEnabled
        cacheMode="LOAD_DEFAULT"
        style={s.web}
      />
    </View>
  );
});

const s = StyleSheet.create({
  // Una superficie real (WebGL la necesita), casi invisible en una esquina, como la cámara.
  caja: { position: 'absolute', left: 0, top: 0, width: 32, height: 32, opacity: 0.01, overflow: 'hidden' },
  web: { width: 32, height: 32, backgroundColor: 'transparent' },
});
