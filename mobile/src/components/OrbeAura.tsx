/**
 * LA CARA DE AURA: el orbe de partículas que forma con sus partículas las palabras que dice (José, 2-oct:
 * «me gusta como se mira, subirlo, solo agregar efectos de sonido»). Es src/14-orbe/orbe.html empaquetado
 * en la app (orbe/orbeHtml.ts, lo genera scripts/orbe-movil.mjs) y dibujado en una WebView.
 *
 * El teléfono le manda el estado, el nivel real de la voz (la «boca») y la frase que está sonando, con
 * `window.__aura(mensaje)`; el orbe no habla (la voz es la de siempre) pero sí suena: sus efectos van con
 * «Efectos de sonido» de Ajustes. Contesta con postMessage: listo, tocar, deslizar o fallo. Si la WebView
 * no tiene WebGL, se cae o no dice «listo» a tiempo, avisa con `onFallo` y la mesa pone los anillos:
 * nunca pantalla vacía.
 */
import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { FaceState } from '../config';
import { ORBE_HTML } from '../orbe/orbeHtml';

type Props = {
  face: FaceState;
  /** Está sonando su voz (el orbe se queda en «habla» aunque la cara cambie de emoción). */
  hablando: boolean;
  /** La frase que suena ahora; `n` distinto = frase nueva aunque el texto se repita. */
  frase: { texto: string; n: number } | null;
  /** Efectos de sonido (Ajustes → La mesa). */
  sonidos: boolean;
  /** Nivel de la voz (0..1, ~20 Hz); devuelve cómo desuscribirse. */
  speechLevelSource: (cb: (level01: number) => void) => () => void;
  onTocar: () => void;
  onDeslizar: (dir: 'arriba' | 'abajo') => void;
  onFallo: (motivo: string) => void;
};

/** Lo que tarda de sobra un teléfono modesto en compilar los shaders del orbe. */
const ESPERA_LISTO_MS = 10_000;
/** El orbe no necesita más de ~15 niveles por segundo, y cada envío cruza el puente. */
const BOCA_CADA_MS = 66;
const FONDO = '#05070C';

export function OrbeAura({ face, hablando, frase, sonidos, speechLevelSource, onTocar, onDeslizar, onFallo }: Props) {
  const web = useRef<WebView>(null);
  const lista = useRef(false);
  const caida = useRef(false);
  const ultimo = useRef({ face, hablando, sonidos, frase });
  ultimo.current = { face, hablando, sonidos, frase };
  const cb = useRef({ onTocar, onDeslizar, onFallo });
  cb.current = { onTocar, onDeslizar, onFallo };

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
    const t = setTimeout(() => !lista.current && fallar('el orbe no arrancó a tiempo'), ESPERA_LISTO_MS);
    return () => clearTimeout(t);
  }, [fallar]);

  // Mientras suena la voz, «habla»; si no, lo que diga la cara (escucha, piensa, busca, contenta…).
  useEffect(() => enviar({ tipo: 'estado', face: hablando ? 'SPEAKING' : face }), [enviar, face, hablando]);
  // Al callarse (terminó o la interrumpieron), las palabras que quedaban se deshacen en partículas.
  const hablaba = useRef(hablando);
  useEffect(() => {
    if (hablaba.current && !hablando) enviar({ tipo: 'callar' });
    hablaba.current = hablando;
  }, [enviar, hablando]);
  useEffect(() => {
    if (frase?.texto) enviar({ tipo: 'decir', texto: frase.texto });
  }, [enviar, frase?.n, frase?.texto]);
  useEffect(() => enviar({ tipo: 'sonido', activo: sonidos }), [enviar, sonidos]);

  // El ritmo de las palabras y el brillo van con la voz real: se manda si cambió lo bastante.
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
      let m: { tipo?: string; dir?: string; motivo?: string };
      try {
        m = JSON.parse(e.nativeEvent.data);
      } catch {
        return;
      }
      switch (m.tipo) {
        case 'listo': {
          lista.current = true;
          const u = ultimo.current;
          enviar({ tipo: 'sonido', activo: u.sonidos });
          enviar({ tipo: 'estado', face: u.hablando ? 'SPEAKING' : u.face });
          if (u.hablando && u.frase?.texto) enviar({ tipo: 'decir', texto: u.frase.texto });
          return;
        }
        case 'tocar':
          return cb.current.onTocar();
        case 'deslizar':
          return cb.current.onDeslizar(m.dir === 'abajo' ? 'abajo' : 'arriba');
        case 'fallo':
          return fallar(m.motivo || 'el orbe falló al arrancar');
      }
    },
    [enviar, fallar]
  );

  return (
    <View style={StyleSheet.absoluteFill}>
      <WebView
        ref={web}
        source={{ html: ORBE_HTML }}
        originWhitelist={['*']}
        // Sin barra ni panel de prueba, sin voz propia (habla el teléfono) y con sus sonidos según Ajustes.
        injectedJavaScriptBeforeContentLoaded={`window.__orbeOpciones=${JSON.stringify({ clean: true, tts: false, sfx: sonidos })};true;`}
        onMessage={alMensaje}
        onError={(e) => fallar(`WebView: ${e.nativeEvent.description}`)}
        onRenderProcessGone={() => fallar('se cerró el proceso de la WebView')}
        onContentProcessDidTerminate={() => fallar('se cerró el proceso de la WebView')}
        style={styles.web}
        containerStyle={styles.web}
        javaScriptEnabled
        domStorageEnabled={false}
        // Los efectos suenan sin esperar un toque (WebAudio); son cortos y bajitos.
        mediaPlaybackRequiresUserAction={false}
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
