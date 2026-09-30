/**
 * EL CUERPO 3D DE AURA: la escena de three.js (src/12-avatar3d, empaquetada en escenaHtml.ts) en una
 * WebView con fondo transparente, recibiendo el mismo estado que la figurita 2D.
 *
 * Por qué WebView + three.js y no un motor nativo: lo cuenta docs/avatar-3d-especificacion.md (§1).
 * En corto: la sala 3D ya corre así en esta APK, no toca nada nativo (se actualiza por aire, sin APK
 * nueva), y el único motor nativo serio (Filament) exige react-native-worklets-core, que ya tumbó
 * esta app con la arquitectura nueva de RN 0.81 (commit 0602318).
 *
 * El .glb lo empaqueta Metro (assets/avatar3d/); una WebView no puede leer los archivos de la APK, así
 * que se lee aquí en pedazos de base64 y se le pasa a la página. Después, lo de siempre: estado cuando
 * cambia, la boca ~15 veces por segundo, pausa en segundo plano.
 *
 * No maneja el tacto: quien lo monta pone el dedo y le pregunta a `zonaEn(x, y)` qué zona tocó (la
 * escena hace el raycast contra los colisionadores del modelo).
 *
 * Si algo sale mal (sin WebGL, no carga, no dice «listo» a tiempo, se cae el proceso de la WebView o
 * no da los cuadros) avisa `onFallo` una sola vez y AvatarVivo vuelve a la figurita 2D.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import { ESCENA_HTML } from './escenaHtml';
import { ESPERA_LISTO_MS, veredictoRendimiento } from './capacidad';
import { senalVoz } from './senalVoz';
import type { ModeloAvatar3D } from './modelo';
import type { PropsCuerpo } from './contrato';
import type { AlaEscena, DeLaEscena, InfoModelo, ZonaToque } from './tipos';

/** Bytes por pedazo: múltiplo de 3, así cada pedazo es base64 completo (sin relleno en medio). */
const PASO = 3 * 65536;
/** La boca no necesita más de ~15 cuadros por segundo, y cada envío cruza el puente. */
const BOCA_CADA_MS = 66;
/** Lo que se espera la respuesta de un raycast antes de tratar el toque como uno cualquiera. */
const ESPERA_ZONA_MS = 180;

export type ControlAvatar3D = {
  /** ¿Qué zona hay en (x, y)? En px dentro de la vista. null: ninguna (o no contestó a tiempo). */
  zonaEn: (x: number, y: number) => Promise<ZonaToque | null>;
};

type Props = PropsCuerpo & {
  modelo: ModeloAvatar3D;
  /** El modelo cargó y ya se dibujó el primer cuadro. */
  onListo: (info: InfoModelo) => void;
  onFallo: (motivo: string) => void;
  /** Tope de resolución (la compañera chiquita no necesita 3×). */
  dprMax?: number;
  reducido?: boolean;
};

export const Avatar3D = forwardRef<ControlAvatar3D, Props>(function Avatar3D(
  { modelo, camara, estado, ancho, alto, fpsMax = 60, dprMax = 2, reducido = false, onListo, onFallo },
  ref
) {
  const web = useRef<WebView>(null);
  const lista = useRef(false);
  const listo = useRef(false);
  const caida = useRef(false);
  const ultimo = useRef({ estado, camara });
  ultimo.current = { estado, camara };
  const cb = useRef({ onListo, onFallo });
  cb.current = { onListo, onFallo };
  const zonas = useRef(new Map<number, (z: ZonaToque | null) => void>());
  const nZona = useRef(0);

  const enviar = useCallback((m: AlaEscena) => {
    if (!lista.current || caida.current) return;
    web.current?.injectJavaScript(`window.__avatar&&window.__avatar(${JSON.stringify(m)});true;`);
  }, []);

  const fallar = useCallback((motivo: string) => {
    if (caida.current) return;
    caida.current = true;
    for (const f of zonas.current.values()) f(null);
    zonas.current.clear();
    cb.current.onFallo(motivo);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      zonaEn: (x, y) =>
        new Promise((resolver) => {
          if (!listo.current || caida.current) return resolver(null);
          const id = ++nZona.current;
          const t = setTimeout(() => {
            zonas.current.delete(id);
            resolver(null);
          }, ESPERA_ZONA_MS);
          zonas.current.set(id, (z) => {
            clearTimeout(t);
            zonas.current.delete(id);
            resolver(z);
          });
          enviar({ tipo: 'zona', id, x: x / Math.max(1, ancho), y: y / Math.max(1, alto) });
        }),
    }),
    [alto, ancho, enviar]
  );

  // Sin «listo» a tiempo, no va a arrancar: la figurita se queda.
  useEffect(() => {
    const t = setTimeout(() => !listo.current && fallar('la escena 3D no arrancó a tiempo'), ESPERA_LISTO_MS);
    return () => clearTimeout(t);
  }, [fallar]);

  // El modelo, en pedazos, en cuanto la página dice que arrancó.
  const mandarModelo = useCallback(async () => {
    try {
      const a = Asset.fromModule(modelo.fuente);
      await a.downloadAsync();
      const uri = a.localUri || a.uri;
      if (!uri) throw new Error('el modelo no tiene dirección');
      const total = Math.ceil(modelo.bytes / PASO);
      for (let i = 0; i < total; i++) {
        if (caida.current) return;
        const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64, position: i * PASO, length: PASO });
        enviar({ tipo: 'trozo', i, total, b64 });
      }
      enviar({ tipo: 'fin', bytes: modelo.bytes });
    } catch (e: any) {
      fallar(`no se pudo leer el modelo: ${String(e?.message || e).slice(0, 80)}`);
    }
  }, [enviar, fallar, modelo]);

  useEffect(() => {
    if (listo.current) enviar({ tipo: 'estado', estado });
  }, [enviar, estado]);
  useEffect(() => {
    if (listo.current) enviar({ tipo: 'camara', camara });
  }, [enviar, camara]);

  // La boca: la apertura y el visema de senalVoz. Mientras este cuerpo vive, pide la forma (espectro).
  useEffect(() => {
    const soltar = senalVoz.pedirForma();
    let enviadoEn = 0;
    let previo = { nivel: -1, visema: 'sil' };
    const off = senalVoz.boca.escuchar((b) => {
      if (!listo.current) return;
      const ahora = Date.now();
      const cerrar = b.nivel < 0.02 && previo.nivel >= 0.02;
      const cambio = b.visema !== previo.visema || Math.abs(b.nivel - previo.nivel) >= 0.03;
      if (!cerrar && (!cambio || ahora - enviadoEn < BOCA_CADA_MS)) return;
      enviadoEn = ahora;
      previo = { nivel: b.nivel, visema: b.visema };
      enviar({ tipo: 'boca', nivel: Math.round(b.nivel * 100) / 100, visema: b.visema, peso: Math.round(b.peso * 100) / 100 });
    });
    return () => {
      off();
      soltar();
    };
  }, [enviar]);

  // Detrás, sin cuadros.
  useEffect(() => {
    const s = AppState.addEventListener('change', (st) => enviar({ tipo: 'pausa', valor: st !== 'active' }));
    return () => s.remove();
  }, [enviar]);

  const alMensaje = useCallback(
    (e: WebViewMessageEvent) => {
      let m: DeLaEscena;
      try {
        m = JSON.parse(e.nativeEvent.data);
      } catch {
        return;
      }
      switch (m?.tipo) {
        case 'lista':
          if (lista.current) return;
          lista.current = true;
          enviar({ tipo: 'config', camara: ultimo.current.camara, fpsMax, dprMax, mapeo: modelo.mapeo, reducido });
          void mandarModelo();
          return;
        case 'listo':
          if (listo.current) return;
          listo.current = true;
          enviar({ tipo: 'estado', estado: ultimo.current.estado });
          cb.current.onListo(m.info);
          return;
        case 'zona':
          zonas.current.get(m.id)?.(m.zona);
          return;
        case 'rendimiento':
          if (veredictoRendimiento(m) === 'caer') fallar(`el teléfono no da los cuadros (${m.fps} fps)`);
          return;
        case 'fallo':
          fallar(m.motivo || 'la escena 3D falló');
          return;
      }
    },
    [dprMax, enviar, fallar, fpsMax, mandarModelo, modelo.mapeo, reducido]
  );

  return (
    <View style={[s.caja, { width: ancho, height: alto }]} pointerEvents="none">
      <WebView
        ref={web}
        source={{ html: ESCENA_HTML }}
        originWhitelist={['*']}
        onMessage={alMensaje}
        onError={(ev) => fallar(`WebView: ${ev.nativeEvent.description}`)}
        onRenderProcessGone={() => fallar('se cerró el proceso de la WebView')}
        onContentProcessDidTerminate={() => fallar('se cerró el proceso de la WebView')}
        style={s.web}
        containerStyle={s.web}
        javaScriptEnabled
        domStorageEnabled={false}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        setBuiltInZoomControls={false}
        textZoom={100}
        androidLayerType="hardware"
        setSupportMultipleWindows={false}
        allowsInlineMediaPlayback={false}
        mediaPlaybackRequiresUserAction
      />
    </View>
  );
});

const s = StyleSheet.create({
  caja: { overflow: 'hidden', backgroundColor: 'transparent' },
  web: { flex: 1, backgroundColor: 'transparent' },
});
