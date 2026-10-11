/**
 * EL ORBE DE LA BURBUJA: el MISMO orbe de partículas de la mesa (src/14-orbe/orbe.html, components/OrbeAura.tsx), entero
 * y centrado en su círculo (José, 10-oct: «mira el círculo de asistente, necesitamos mejorar eso»).
 *
 *  · Encuadre «centro» del orbe: el lienzo es un cuadro (`lienzo`), la cáscara de partículas llena el disco azul noche
 *    (`lado`) y alrededor es transparente: va encima de cualquier app, con su halo y su polvo sin cortarse.
 *  · Primer cuadro sin disco vacío: debajo va la foto del orbe (avatar3d/OrbeMini, ya del tamaño del disco) y se
 *    desvanece cuando la WebView dice que pintó («pintado»). Si la WebView no tiene WebGL, se cae o no arranca a tiempo,
 *    se queda la foto (con el velo de la emoción): nunca un círculo vacío.
 *  · Vive con el estado real: reposo (respira), escucha (con el nivel del micrófono), piensa (remolino), habla (con el
 *    nivel de la voz que suena), aviso/error; y la emoción del turno (orbe/expresiones.ts) encima, que vuelve sola.
 *  · «Reducir movimiento» del sistema: se le dice al orbe (menos giro, sin golpes) y la foto queda quieta.
 *  · No recibe toques (los toma el círculo de la burbuja): `pointerEvents="none"`.
 *
 * Revisión del 11-oct (José: «cuando se hace pequeño aura en chat se vea igual cuando es avatar»): este mismo componente es
 * ahora la AU-RA chiquita de la app (avatar3d/OrbeAuraChica: el acople de los chats, la pantalla completa y la que camina).
 * Para eso aprende dos cosas sin cambiar nada de la burbuja (las dos valen `true` por defecto):
 *  · `vivo`: si le toca el turno del único orbe vivo (avatar3d/orbeVivo.ts). Sin turno no monta la WebView y queda la
 *    foto; al volver el turno, la WebView nace de cero con la foto encima hasta que pinte;
 *  · `activo`: tapada o en segundo plano, ni WebView ni animaciones.
 * `alCaer` avisa una sola vez si la WebView no arrancó (para soltar el turno y no reintentar sin fin).
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { OrbeMini } from '../avatar3d/OrbeMini';
import { senalVoz } from '../avatar3d/senalVoz';
import { nivelOido } from '../compa/canales';
import { ORBE_HTML } from '../orbe/orbeHtml';
import { orbeConOpciones } from '../orbe/opciones';
import { mensajeExpresion, type ExpresionOrbe } from '../orbe/expresiones';
import { miga } from '../lib/reporte';

export type EstadoOrbeBurbuja = 'reposo' | 'escucha' | 'piensa' | 'habla' | 'aviso' | 'apagado';

type Props = {
  /** Diámetro del disco. */
  lado: number;
  /** Lado del lienzo (el disco + su halo). */
  lienzo: number;
  /** Fracciones del lienzo (burbuja/medidas.ts). */
  radioOrbe: number;
  radioDisco: number;
  estado: EstadoOrbeBurbuja;
  /** La emoción del turno; `n` distinto = otra vez (aunque se repita). */
  expresion: { nombre: ExpresionOrbe; n: number } | null;
  /** Le toca el turno del orbe vivo (avatar3d/orbeVivo.ts). Sin turno: la foto, sin WebView. */
  vivo?: boolean;
  /** Pausado (tapado, en segundo plano): sin WebView ni animaciones. */
  activo?: boolean;
  /** Quién es, para las migas (la burbuja o la AU-RA chiquita de la app). */
  origen?: string;
  /** La WebView no arrancó (una sola vez): queda la foto. */
  alCaer?: (motivo: string) => void;
  /**
   * Tope de cuadros por segundo (orbe/opciones.ts `fpsMax`): la AU-RA chiquita pide 30, y 15 dormida, por la batería.
   * Sin él (la burbuja), los de la pantalla. Cambiarlo no recarga el orbe: va por el puente (`{tipo:'fps'}`).
   */
  fpsMax?: number;
};

const ESPERA_LISTO_MS = 6_000;
const BOCA_CADA_MS = 66;

const CARA: Record<EstadoOrbeBurbuja, string> = {
  reposo: 'IDLE',
  escucha: 'LISTENING',
  piensa: 'THINKING',
  habla: 'SPEAKING',
  aviso: 'IDLE',
  apagado: 'SLEEPING',
};

function OrbeBurbujaBase({ lado, lienzo, radioOrbe, radioDisco, estado, expresion, vivo = true, activo = true, origen = 'burbuja', alCaer, fpsMax }: Props) {
  const web = useRef<WebView>(null);
  const lista = useRef(false);
  const [caida, setCaida] = useState(false);
  const caidaRef = useRef(false);
  const alCaerRef = useRef(alCaer);
  alCaerRef.current = alCaer;
  /** Hay WebView: le toca el turno, se ve y no se cayó. */
  const conWeb = vivo && activo && !caida;
  const [pintada, setPintada] = useState(false);
  const [quieto, setQuieto] = useState(false);
  const foto = useRef(new Animated.Value(1)).current;
  const ultimo = useRef({ estado, expresion, quieto, fpsMax });
  ultimo.current = { estado, expresion, quieto, fpsMax };

  // Una sola vez: el lienzo se mide en la página (resize), así que cambiar de tamaño no recarga el orbe. El tope de cuadros
  // nace con el que haya y después va por el puente.
  const html = useMemo(
    () => orbeConOpciones(ORBE_HTML, { sonidos: false, centro: { radio: radioOrbe, disco: radioDisco }, ...(ultimo.current.fpsMax ? { fpsMax: ultimo.current.fpsMax } : {}) }),
    [radioOrbe, radioDisco]
  );

  const enviar = useCallback((m: object) => {
    if (!lista.current) return;
    web.current?.injectJavaScript(`window.__aura&&window.__aura(${JSON.stringify(m)});true;`);
  }, []);

  const fallar = useCallback(
    (motivo: string) => {
      if (caidaRef.current) return;
      caidaRef.current = true;
      miga(`${origen}: el orbe de partículas no arrancó (${motivo}); queda la foto`);
      setCaida(true);
      alCaerRef.current?.(motivo);
    },
    [origen]
  );

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((q) => setQuieto(q))
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (q) => setQuieto(q));
    return () => sub.remove();
  }, []);

  // Cada WebView que nace tiene su plazo para decir «listo».
  useEffect(() => {
    if (!conWeb) return;
    const t = setTimeout(() => !lista.current && fallar('no dijo «listo» a tiempo'), ESPERA_LISTO_MS);
    return () => clearTimeout(t);
  }, [conWeb, fallar]);
  // Sin WebView (sin turno, tapada): la próxima nace de cero, con la foto encima hasta que pinte.
  useEffect(() => {
    if (conWeb) return;
    lista.current = false;
    setPintada(false);
    foto.setValue(1);
  }, [conWeb, foto]);

  useEffect(() => enviar({ tipo: 'movimiento', reducido: quieto }), [enviar, quieto]);
  useEffect(() => enviar({ tipo: 'fps', max: fpsMax ?? 0 }), [enviar, fpsMax]);
  useEffect(() => enviar({ tipo: 'estado', face: CARA[estado], mudo: true }), [enviar, estado]);
  useEffect(() => {
    if (expresion) enviar(mensajeExpresion(expresion.nombre, { quieto: ultimo.current.quieto }));
  }, [enviar, expresion?.n, expresion?.nombre]);
  // Un aviso (sin micrófono, error) se ve como preocupación suave mientras dure.
  useEffect(() => {
    if (estado === 'aviso') enviar(mensajeExpresion('preocupacion', { fuerza: 0.6, quieto: ultimo.current.quieto }));
  }, [enviar, estado]);

  // El nivel que mueve el orbe: la voz de AURA al hablar, el micrófono al escuchar (sin pasar por React).
  useEffect(() => {
    let enviadoEn = 0;
    let ultimoNivel = -1;
    const mandar = (n: number) => {
      const ahora = Date.now();
      const cerrar = n < 0.02 && ultimoNivel >= 0.02;
      if (!cerrar && (ahora - enviadoEn < BOCA_CADA_MS || Math.abs(n - ultimoNivel) < 0.03)) return;
      enviadoEn = ahora;
      ultimoNivel = n;
      enviar({ tipo: 'boca', n: Math.round(Math.min(1, n) * 100) / 100 });
    };
    const fueraVoz = senalVoz.boca.escuchar((b) => ultimo.current.estado === 'habla' && mandar(b.nivel));
    const fueraOido = nivelOido.escuchar((n) => ultimo.current.estado === 'escucha' && mandar(n));
    return () => {
      fueraVoz();
      fueraOido();
    };
  }, [enviar]);

  // Pintó: la foto se desvanece (la WebView transparente ya tiene el orbe vivo encima).
  useEffect(() => {
    if (!pintada || caida) return;
    Animated.timing(foto, { toValue: 0, duration: 260, useNativeDriver: true }).start();
  }, [pintada, caida, foto]);
  useEffect(() => {
    if (caida) foto.setValue(1);
  }, [caida, foto]);

  const alMensaje = useCallback(
    (e: WebViewMessageEvent) => {
      let m: { tipo?: string; motivo?: string };
      try {
        m = JSON.parse(e.nativeEvent.data);
      } catch {
        return;
      }
      if (m.tipo === 'listo') {
        lista.current = true;
        const u = ultimo.current;
        enviar({ tipo: 'movimiento', reducido: u.quieto });
        enviar({ tipo: 'fps', max: u.fpsMax ?? 0 });
        enviar({ tipo: 'estado', face: CARA[u.estado], mudo: true });
        if (u.expresion) enviar(mensajeExpresion(u.expresion.nombre, { quieto: u.quieto }));
      } else if (m.tipo === 'pintado') setPintada(true);
      else if (m.tipo === 'fallo') fallar(m.motivo || 'falló al arrancar');
    },
    [enviar, fallar]
  );

  const off = (lienzo - lado) / 2;
  const silenciado = estado === 'apagado';
  return (
    <View pointerEvents="none" style={{ width: lienzo, height: lienzo }}>
      {/* Sin WebView, la foto entera en ESTE mismo render: el efecto que la vuelve a 1 llega un cuadro tarde y se veía un
          parpadeo (la foto a medio desvanecer) al soltar el turno. */}
      <Animated.View style={{ position: 'absolute', left: off, top: off, width: lado, height: lado, opacity: conWeb ? foto : 1 }}>
        <OrbeMini
          lado={lado}
          activo={activo && (!conWeb || !pintada)}
          expresion={expresion?.nombre ?? null}
          estado={{ escuchando: estado === 'escucha', pensando: estado === 'piensa', silenciado }}
        />
      </Animated.View>
      {conWeb && (
        <WebView
          ref={web}
          source={{ html }}
          originWhitelist={['*']}
          onMessage={alMensaje}
          onError={(e) => fallar(`WebView: ${e.nativeEvent.description}`)}
          onRenderProcessGone={() => fallar('se cerró el proceso de la WebView')}
          style={[StyleSheet.absoluteFill, s.web, silenciado && { opacity: 0.6 }]}
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
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  web: { backgroundColor: 'transparent' },
});

export const OrbeBurbuja = memo(OrbeBurbujaBase);
