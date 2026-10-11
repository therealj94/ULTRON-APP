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
 *
 * La pausa (José, 11-oct: «cuando se hace pequeño aura en chat se vea igual cuando es avatar»): la mesa sigue montada
 * debajo de los chats y una WebView tapada no se entera (`document.hidden` sigue en falso), así que el orbe dibujaba a
 * ciegas. Con `activo` en falso (la mesa no se ve, la app en segundo plano o la llamada encima) se pausa de verdad
 * (`{tipo:'pausa'}`: el bucle se corta y la GPU queda libre), suelta el turno del orbe vivo (avatar3d/orbeVivo.ts) y deja
 * de mandarle nada (ni estado ni sonidos: no suena desde detrás). Al volver a verse toma el turno a la fuerza (la AU-RA
 * chiquita vuelve a su foto en ese instante), le pone al día lo que pasó mientras tanto, sin el sonido del cambio, y sigue.
 * Así la AU-RA chiquita de los chats es el MISMO orbe de partículas sin dos escenas WebGL vivas a la vez.
 *
 * Un intento más (revisión del 11-oct): las WebView de la app comparten el proceso que dibuja, y ahora el orbe chico vive
 * en otra; si ese proceso se cae (por el chico o por memoria), la mesa no se rinde a la primera: suelta el turno, vuelve a
 * crear su WebView de cero (otra `generacion`) y solo si se cae otra vez pone los anillos.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { FaceState } from '../config';
import { ORBE_HTML } from '../orbe/orbeHtml';
import { orbeConOpciones } from '../orbe/opciones';
import { expresionDeCara, mensajeExpresion } from '../orbe/expresiones';
import { DUENO_MESA, soltarOrbeVivo, tomarOrbeVivo } from '../avatar3d/orbeVivo';
import { miga } from '../lib/reporte';

type Props = {
  face: FaceState;
  /**
   * Está sonando su voz DE VERDAD (avatar3d/sonando.ts `hablando`, no la decisión de hablar): el orbe se queda en
   * «habla» aunque la cara cambie de emoción, y solo así forma las palabras.
   */
  hablando: boolean;
  /** La frase que suena ahora; `n` distinto = frase nueva aunque el texto se repita. */
  frase: { texto: string; n: number } | null;
  /** Efectos de sonido (Ajustes → La mesa). */
  sonidos: boolean;
  /** Lo que la app tapa arriba (su estado) y abajo (la barra), en dp: el orbe y sus palabras van en el resto. */
  margen?: { arriba: number; abajo: number };
  /** Nivel de la voz (0..1, ~20 Hz); devuelve cómo desuscribirse. */
  speechLevelSource: (cb: (level01: number) => void) => () => void;
  onTocar: () => void;
  onDeslizar: (dir: 'arriba' | 'abajo') => void;
  onFallo: (motivo: string) => void;
  /** La mesa se ve (y la app está delante): si no, el orbe se pausa y suelta el turno del orbe vivo. */
  activo?: boolean;
};

/** Lo que tarda de sobra un teléfono modesto en compilar los shaders del orbe. */
const ESPERA_LISTO_MS = 10_000;
/** Las veces que la mesa vuelve a crear su WebView si se cae el proceso que dibuja, antes de poner los anillos. */
export const REINTENTOS_MESA = 1;
/** El orbe no necesita más de ~15 niveles por segundo, y cada envío cruza el puente. */
const BOCA_CADA_MS = 66;
const FONDO = '#05070C';
/** El fondo del orbe: acostado, detrás del riel de la mesa, para que no quede una franja de otro color. */
export const FONDO_ORBE = FONDO;

/** El orbe con sus opciones ya puestas DENTRO de la página (orbe/opciones.ts; aquí sigue para quien lo importaba). */
export { orbeConOpciones };

export function OrbeAura({ face, hablando, frase, sonidos, margen, speechLevelSource, onTocar, onDeslizar, onFallo, activo = true }: Props) {
  const web = useRef<WebView>(null);
  const lista = useRef(false);
  const caida = useRef(false);
  const ultimo = useRef({ face, hablando, sonidos, frase, margen });
  ultimo.current = { face, hablando, sonidos, frase, margen };
  const cb = useRef({ onTocar, onDeslizar, onFallo });
  cb.current = { onTocar, onDeslizar, onFallo };
  /** Se ve: solo así se le manda algo (pausado no suena ni se mueve detrás de los chats). */
  const activoRef = useRef(activo);
  activoRef.current = activo;
  /** Cada WebView nueva (al caerse el proceso) es otra generación: otra `key`, nace de cero. */
  const [generacion, setGeneracion] = useState(0);
  const reintentos = useRef(0);
  // Una vez por WebView: cambiar los sonidos después va por el puente («sonido»), sin recargar el orbe. Montado sin verse
  // (la app vuelve directo a los chats), nace pausado.
  const html = useMemo(
    () => orbeConOpciones(ORBE_HTML, { sonidos: ultimo.current.sonidos, ...(ultimo.current.margen ? { margen: ultimo.current.margen } : {}), ...(activoRef.current ? {} : { pausado: true }) }),
    [generacion]
  );

  const inyectar = useCallback((m: object) => {
    if (!lista.current || caida.current) return;
    web.current?.injectJavaScript(`window.__aura&&window.__aura(${JSON.stringify(m)});true;`);
  }, []);
  const enviar = useCallback(
    (m: object) => {
      if (activoRef.current) inyectar(m);
    },
    [inyectar]
  );

  /** Todo lo que el orbe tiene que saber de golpe (al arrancar y al volver de la pausa). */
  const ponerAlDia = useCallback(
    (mudo: boolean) => {
      const u = ultimo.current;
      inyectar({ tipo: 'sonido', activo: u.sonidos });
      if (u.margen) inyectar({ tipo: 'margen', arriba: Math.round(u.margen.arriba), abajo: Math.round(u.margen.abajo) });
      inyectar({ tipo: 'estado', face: u.hablando ? 'SPEAKING' : u.face, ...(mudo ? { mudo: true } : {}) });
      const ex = expresionDeCara(u.face);
      if (ex) inyectar(mensajeExpresion(ex));
      if (u.hablando && u.frase?.texto) inyectar({ tipo: 'decir', texto: u.frase.texto });
    },
    [inyectar]
  );

  const fallar = useCallback((motivo: string) => {
    if (caida.current) return;
    caida.current = true;
    soltarOrbeVivo(DUENO_MESA);
    cb.current.onFallo(motivo);
  }, []);

  /** Se cayó el proceso que dibuja: una WebView nueva (soltando el turno) antes de rendirse. */
  const procesoCaido = useCallback(() => {
    if (caida.current) return;
    if (reintentos.current >= REINTENTOS_MESA) return fallar('se cerró el proceso de la WebView');
    reintentos.current++;
    miga('mesa: se cerró el proceso de la WebView del orbe; se vuelve a crear');
    lista.current = false;
    soltarOrbeVivo(DUENO_MESA);
    setGeneracion((g) => g + 1);
  }, [fallar]);

  // La pausa: el turno del orbe vivo va con lo que se ve. Al pausar, las palabras a medias se deshacen y el bucle se corta;
  // al volver, primero el turno (la chiquita suelta su WebView), luego al día y a dibujar.
  useEffect(() => {
    if (!activo) {
      soltarOrbeVivo(DUENO_MESA);
      inyectar({ tipo: 'callar' });
      inyectar({ tipo: 'pausa', activa: true });
      return;
    }
    if (caida.current) return;
    tomarOrbeVivo(DUENO_MESA, { forzar: true });
    if (lista.current) {
      ponerAlDia(true);
      inyectar({ tipo: 'pausa', activa: false });
    }
  }, [activo, generacion, inyectar, ponerAlDia]);
  useEffect(() => () => soltarOrbeVivo(DUENO_MESA), []);

  useEffect(() => {
    const t = setTimeout(() => !lista.current && fallar('el orbe no arrancó a tiempo'), ESPERA_LISTO_MS);
    return () => clearTimeout(t);
  }, [fallar, generacion]);

  // Mientras suena la voz, «habla»; si no, lo que diga la cara (escucha, piensa, busca, contenta…).
  useEffect(() => enviar({ tipo: 'estado', face: hablando ? 'SPEAKING' : face }), [enviar, face, hablando]);
  // Al callarse (terminó o la interrumpieron), las palabras que quedaban se deshacen en partículas.
  const hablaba = useRef(hablando);
  useEffect(() => {
    if (hablaba.current && !hablando) enviar({ tipo: 'callar' });
    hablaba.current = hablando;
  }, [enviar, hablando]);
  // Las palabras se forman cuando la voz SUENA (José, 7-oct: hablaba antes de que saliera la voz): la frase que
  // llega antes (la mesa la muestra al decidir hablar) espera a que `hablando` se encienda.
  useEffect(() => {
    if (hablando && frase?.texto) enviar({ tipo: 'decir', texto: frase.texto });
  }, [enviar, hablando, frase?.n, frase?.texto]);
  useEffect(() => enviar({ tipo: 'sonido', activo: sonidos }), [enviar, sonidos]);
  // Más expresiones (José, 10-oct): la emoción del turno llega como cara (HAPPY, SAD, SURPRISED…). Aunque el orbe se quede
  // en «habla» mientras suena la voz, la emoción se mezcla encima (color, movimiento, núcleo) y vuelve sola a lo neutro.
  const expresion = expresionDeCara(face);
  useEffect(() => {
    if (expresion) enviar(mensajeExpresion(expresion));
  }, [enviar, expresion]);
  useEffect(() => {
    if (margen) enviar({ tipo: 'margen', arriba: Math.round(margen.arriba), abajo: Math.round(margen.abajo) });
  }, [enviar, margen?.arriba, margen?.abajo]);

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
          // Sin verse: que siga pausado (o se pause, si nació corriendo) y se ponga al día al volver.
          if (!activoRef.current) return inyectar({ tipo: 'pausa', activa: true });
          ponerAlDia(false);
          inyectar({ tipo: 'pausa', activa: false });
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
    [fallar, inyectar, ponerAlDia]
  );

  return (
    <View style={StyleSheet.absoluteFill}>
      <WebView
        key={generacion}
        ref={web}
        source={{ html }}
        originWhitelist={['*']}
        onMessage={alMensaje}
        onError={(e) => fallar(`WebView: ${e.nativeEvent.description}`)}
        onRenderProcessGone={procesoCaido}
        onContentProcessDidTerminate={procesoCaido}
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
