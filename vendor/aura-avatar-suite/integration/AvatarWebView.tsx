// Standalone avatar, adapted to AURA current WebView contract; retains the app fallback.
import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import {AVATAR_HTML} from './avatarHtml';
type FaceState=string;type Emocion=string;type Tarea=string;type AvatarId=keyof typeof AVATAR_HTML;

/** Un pedido de gesto; `n` distinto = pedido nuevo aunque la tarea se repita. */
export type PedidoTarea = { tarea: Tarea; n: number };

export type AvatarWebViewProps = {
  id: AvatarId;
  face: FaceState;
  emocion: Emocion;
  pedido: PedidoTarea | null;
  /** Nivel de la voz (0..1, ~20 Hz) para la boca; devuelve cómo desuscribirse. */
  speechLevelSource: (cb: (level01: number) => void) => () => void;
  /** Hacia dónde mira la persona según la cámara (-1..1). */
  mirada: { x: number; y: number; activa: boolean };
  onTocar: (zona: 'cuerpo' | 'cabeza' | 'mejilla' | 'panza') => void;
  onFallo: (motivo: string) => void;
};

/** Lo que tarda de sobra un teléfono modesto en compilar la sala; más que esto es que no va a arrancar. */
const ESPERA_LISTO_MS = 12_000;
/** La boca no necesita más de ~15 cuadros por segundo, y cada envío cruza el puente. */
const BOCA_CADA_MS = 66;

const FONDO = '#232528';

function AvatarWebViewInner({id, face, emocion, pedido, speechLevelSource, mirada, onTocar, onFallo }: AvatarWebViewProps) {
  const web = useRef<WebView>(null);
  const lista = useRef(false);
  const caida = useRef(false);
  // Lo último de cada cosa, para mandarlo en cuanto la sala diga «listo» (antes no hay a quién).
  const ultimo = useRef({ face, emocion, mirada });
  ultimo.current = { face, emocion, mirada };
  // Un gesto pedido mientras la sala todavía carga no se pierde: se guarda y sale tras «listo».
  const pedidoPendiente = useRef<PedidoTarea | null>(null);
  const cb = useRef({ onTocar, onFallo });
  cb.current = { onTocar, onFallo };

  const enviar = useCallback((m: object) => {
    if (!lista.current || caida.current) return;
    web.current?.injectJavaScript(`window.__aura&&window.__aura(${JSON.stringify(m)});true;`);
  }, []);

  const fallar = useCallback((motivo: string) => {
    if (caida.current) return;
    caida.current = true;
    cb.current.onFallo(motivo);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => !lista.current && fallar('la sala no arrancó a tiempo'), ESPERA_LISTO_MS);
    return () => clearTimeout(t);
  }, [fallar]);

  useEffect(() => enviar({ tipo: 'estado', face, emocion }), [enviar, face, emocion]);
  useEffect(() => {
    if (!pedido) return;
    if (lista.current) enviar({ tipo: 'tarea', tarea: pedido.tarea });
    else pedidoPendiente.current = pedido;
  }, [enviar, pedido]);
  useEffect(() => enviar({ tipo: 'mirar', x: mirada.x, y: mirada.y, activa: mirada.activa }), [enviar, mirada.x, mirada.y, mirada.activa]);

  // La boca va con la voz real. Se manda solo si cambió lo bastante y como mucho ~15 veces por segundo.
  useEffect(() => {
    let enviadoEn = 0;
    let ultimoNivel = -1;
    return speechLevelSource((n) => {
      const ahora = Date.now();
      const cerrar = n < 0.02 && ultimoNivel >= 0.02;
      if (!cerrar && (ahora - enviadoEn < BOCA_CADA_MS || Math.abs(n - ultimoNivel) < 0.03)) return;
      enviadoEn = ahora;
      ultimoNivel = n;
      enviar({ tipo: 'boca', n: Math.round(n * 100) / 100 });
    });
  }, [enviar, speechLevelSource]);

  const alMensaje = useCallback(
    (e: WebViewMessageEvent) => {
      let m: { tipo?: string; zona?: string; dir?: string; motivo?: string };
      try {
        m = JSON.parse(e.nativeEvent.data);
      } catch {
        return;
      }
      switch (m.tipo) {
        case 'listo': {
          lista.current = true;
          const u = ultimo.current;
          enviar({ tipo: 'estado', face: u.face, emocion: u.emocion });
          enviar({ tipo: 'entrar' });
          enviar({ tipo: 'mirar', x: u.mirada.x, y: u.mirada.y, activa: u.mirada.activa });
          if (pedidoPendiente.current) {
            enviar({ tipo: 'tarea', tarea: pedidoPendiente.current.tarea });
            pedidoPendiente.current = null;
          }
          return;
        }
        case 'tocar':
          return cb.current.onTocar(m.zona === 'cabeza' || m.zona === 'mejilla' || m.zona === 'panza' ? m.zona : 'cuerpo');
        case 'fallo':
          return fallar(m.motivo || 'la sala falló al arrancar');
      }
    },
    [enviar, fallar]
  );

  return (
    <View style={StyleSheet.absoluteFill}>
      <WebView
        ref={web}
        source={{ html: AVATAR_HTML[id] }}
        originWhitelist={['*']}
        onMessage={alMensaje}
        onError={(e) => fallar(`WebView: ${e.nativeEvent.description}`)}
        onRenderProcessGone={() => fallar('se cerró el proceso de la WebView')}
        onContentProcessDidTerminate={() => fallar('se cerró el proceso de la WebView')}
        style={styles.web}
        containerStyle={styles.web}
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
      />
    </View>
  );
}

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: FONDO },
});

/** Keyed inner view resets readiness and pending events when the character changes. */
export function AvatarWebView(props:AvatarWebViewProps){return <AvatarWebViewInner key={props.id} {...props}/>;}
