/**
 * LOS EFECTOS DEL AVATAR: lo que le pasa encima al que habla (coreografia.ts). Va sobre su video, sin
 * tapar la cara: la cámara le sube a las manos y tira el flash con rayos, el teléfono le vibra con sus
 * ondas, le salen burbujas, sobres y un avión de papel, se le prende la cabeza de ideas, confeti…
 *
 * Solo React Native y su Animated, con el motor nativo para transformaciones y opacidad.
 */
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import type { EfectoId } from '../coreografia';
import { useCiclo, useVaiven } from './comun';

type Props = { efecto: EfectoId | null; ancho: number; alto: number; acento: string };

/** Un valor que corre una vez de 0 a 1 cuando el efecto empieza (entradas, ráfagas). */
function useUnaVez(clave: unknown, ms: number, retraso = 0) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    v.setValue(0);
    const a = Animated.timing(v, { toValue: 1, duration: ms, delay: retraso, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [clave, ms, retraso, v]);
  return v;
}

/** Un objeto que sube a las manos del avatar (abajo al centro) y se queda meciéndose. */
function Accesorio({ emoji, ancho, alto, x = 0.5, y = 0.7, tam = 0.26, gira = 8, children }: { emoji: string; ancho: number; alto: number; x?: number; y?: number; tam?: number; gira?: number; children?: React.ReactNode }) {
  const entra = useUnaVez(emoji, 520);
  const mece = useVaiven(1600);
  const lado = Math.min(ancho, alto) * tam;
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: ancho * x - lado / 2,
        top: alto * y - lado / 2,
        width: lado,
        height: lado,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: entra,
        transform: [
          { translateY: entra.interpolate({ inputRange: [0, 1], outputRange: [alto * 0.35, 0] }) },
          { translateY: mece.interpolate({ inputRange: [0, 1], outputRange: [0, -lado * 0.06] }) },
          { rotate: mece.interpolate({ inputRange: [0, 1], outputRange: [`${-gira}deg`, `${gira}deg`] }) },
          { scale: entra.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0.3, 1.15, 1] }) },
        ],
      }}
    >
      {children}
      <Text style={{ fontSize: lado * 0.82, textAlign: 'center' }}>{emoji}</Text>
    </Animated.View>
  );
}

/**
 * El avance de algo que va desfasado `d` (0..1) dentro de un ciclo de 0 a 1: los tramos para
 * interpolar sin salto cuando le toca volver a empezar.
 */
function desfase(d: number): { i: number[]; p: number[] } {
  if (d <= 0) return { i: [0, 1], p: [0, 1] };
  const c = 1 - d;
  return { i: [0, c - 0.001, c, 1], p: [d, 1, 0, d] };
}

/** Anillos que salen de un punto (la voz, el timbre). */
function Anillos({ x, y, color, tam, ms = 1400, cuantos = 3 }: { x: number; y: number; color: string; tam: number; ms?: number; cuantos?: number }) {
  const v = useCiclo(ms);
  return (
    <>
      {Array.from({ length: cuantos }, (_, i) => {
        // Cada anillo va desfasado: se arma la curva por tramos para que el ciclo no salte.
        const { i: entrada, p: salida } = desfase(i / cuantos);
        return (
          <Animated.View
            key={i}
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: x - tam / 2,
              top: y - tam / 2,
              width: tam,
              height: tam,
              borderRadius: tam / 2,
              borderWidth: 3,
              borderColor: color,
              opacity: v.interpolate({ inputRange: entrada, outputRange: salida.map((f) => 0.85 * (1 - f)) }),
              transform: [{ scale: v.interpolate({ inputRange: entrada, outputRange: salida.map((f) => 0.4 + f * 1.8) }) }],
            }}
          />
        );
      })}
    </>
  );
}

/** Cosas que salen del avatar y se van volando (burbujas, sobres, el avión). */
function Vuelan({ emojis, ancho, alto, hacia = { x: 0.95, y: -0.1 }, desde = { x: 0.5, y: 0.62 }, tam = 0.16, ms = 1500, cada = 420, enBucle = true }: { emojis: string[]; ancho: number; alto: number; hacia?: { x: number; y: number }; desde?: { x: number; y: number }; tam?: number; ms?: number; cada?: number; enBucle?: boolean }) {
  return (
    <>
      {emojis.map((e, i) => (
        <Vuela key={`${e}${i}`} emoji={e} ancho={ancho} alto={alto} hacia={hacia} desde={desde} tam={tam} ms={ms} retraso={i * cada} enBucle={enBucle} desvio={(i % 2 ? 1 : -1) * 0.12} />
      ))}
    </>
  );
}

function Vuela({ emoji, ancho, alto, hacia, desde, tam, ms, retraso, enBucle, desvio }: { emoji: string; ancho: number; alto: number; hacia: { x: number; y: number }; desde: { x: number; y: number }; tam: number; ms: number; retraso: number; enBucle: boolean; desvio: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    v.setValue(0);
    const una = Animated.sequence([Animated.delay(retraso), Animated.timing(v, { toValue: 1, duration: ms, easing: Easing.inOut(Easing.quad), useNativeDriver: true }), Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true })]);
    const a = enBucle ? Animated.loop(una) : una;
    a.start();
    return () => a.stop();
  }, [v, ms, retraso, enBucle]);
  const lado = Math.min(ancho, alto) * tam;
  return (
    <Animated.Text
      style={{
        position: 'absolute',
        left: ancho * desde.x - lado / 2,
        top: alto * desde.y - lado / 2,
        fontSize: lado,
        opacity: v.interpolate({ inputRange: [0, 0.12, 0.8, 1], outputRange: [0, 1, 1, 0] }),
        transform: [
          { translateX: v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, ancho * ((hacia.x - desde.x) / 2 + desvio), ancho * (hacia.x - desde.x)] }) },
          { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, alto * (hacia.y - desde.y)] }) },
          { scale: v.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0.4, 1.1, 0.8] }) },
          { rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['-10deg', '14deg'] }) },
        ],
      }}
    >
      {emoji}
    </Animated.Text>
  );
}

/** Destellos que titilan alrededor del avatar. */
function Chispas({ ancho, alto, color }: { ancho: number; alto: number; color: string }) {
  const PUNTOS = [
    [0.14, 0.2],
    [0.86, 0.16],
    [0.08, 0.55],
    [0.92, 0.5],
    [0.24, 0.84],
    [0.78, 0.82],
    [0.5, 0.06],
  ];
  return (
    <>
      {PUNTOS.map(([x, y], i) => (
        <Chispa key={i} x={x * ancho} y={y * alto} retraso={i * 190} color={color} tam={Math.min(ancho, alto) * (i % 3 ? 0.08 : 0.11)} />
      ))}
    </>
  );
}

function Chispa({ x, y, retraso, color, tam }: { x: number; y: number; retraso: number; color: string; tam: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const a = Animated.loop(Animated.sequence([Animated.delay(retraso), Animated.timing(v, { toValue: 1, duration: 520, useNativeDriver: true }), Animated.timing(v, { toValue: 0, duration: 620, useNativeDriver: true }), Animated.delay(500)]));
    a.start();
    return () => a.stop();
  }, [v, retraso]);
  return (
    <Animated.Text style={{ position: 'absolute', left: x - tam / 2, top: y - tam / 2, fontSize: tam, color, opacity: v, transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1.2] }) }, { rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '90deg'] }) }] }}>
      ✦
    </Animated.Text>
  );
}

const COLORES_CONFETI = ['#FF9A4D', '#45C9DE', '#D6B56C', '#3DDC84', '#FF5A5F', '#B48CFF', '#4FA8FF'];

function Confeti({ ancho, alto }: { ancho: number; alto: number }) {
  const v = useCiclo(2600);
  return (
    <>
      {Array.from({ length: 18 }, (_, i) => {
        const x = ((i * 37) % 100) / 100;
        const { i: ida, p: caida } = desfase(((i * 13) % 10) / 10);
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              left: x * ancho,
              top: 0,
              width: 7,
              height: 12,
              borderRadius: 2,
              backgroundColor: COLORES_CONFETI[i % COLORES_CONFETI.length],
              transform: [
                { translateY: v.interpolate({ inputRange: ida, outputRange: caida.map((c) => -20 + c * (alto + 30)) }) },
                { rotate: v.interpolate({ inputRange: ida, outputRange: caida.map((c) => `${c * (i % 2 ? 540 : -540)}deg`) }) },
              ],
            }}
          />
        );
      })}
    </>
  );
}

/** ¡Flash! Una ráfaga blanca con rayos que sale de la cámara. */
function Rafaga({ x, y, tam }: { x: number; y: number; tam: number }) {
  const v = useUnaVez('flash', 700);
  return (
    <>
      <Animated.View pointerEvents="none" style={{ position: 'absolute', left: x - tam / 2, top: y - tam / 2, width: tam, height: tam, borderRadius: tam / 2, backgroundColor: '#fff', opacity: v.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 0] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.2, 3.2] }) }] }} />
      {Array.from({ length: 10 }, (_, i) => (
        <Animated.View
          key={i}
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: x - 2,
            top: y - tam * 0.9,
            width: 4,
            height: tam * 0.55,
            borderRadius: 2,
            backgroundColor: '#FFF6C8',
            opacity: v.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 0] }),
            transform: [{ translateY: tam * 0.9 }, { rotate: `${i * 36}deg` }, { translateY: -tam * 0.9 }, { scaleY: v.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1.6] }) }],
          }}
        />
      ))}
    </>
  );
}

/** Una línea que barre al avatar de arriba abajo (analizando). */
function Escaneo({ ancho, alto, color }: { ancho: number; alto: number; color: string }) {
  const v = useCiclo(1300);
  return (
    <>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(69,201,222,0.07)' }]} />
      <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, width: ancho, height: 3, backgroundColor: color, shadowColor: color, shadowOpacity: 1, shadowRadius: 10, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, alto] }) }] }} />
    </>
  );
}

export function EfectoAnfitrion({ efecto, ancho, alto, acento }: Props) {
  if (!efecto || ancho <= 0 || alto <= 0) return null;
  const capa = (contenido: React.ReactNode) => (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {contenido}
    </View>
  );
  const boca = { x: ancho * 0.5, y: alto * 0.5 };
  switch (efecto) {
    case 'ondas':
      return capa(<Anillos x={boca.x} y={boca.y} color={acento} tam={Math.min(ancho, alto) * 0.5} />);
    case 'camara':
      return capa(<Accesorio emoji="📸" ancho={ancho} alto={alto} x={0.66} y={0.74} gira={5} />);
    case 'flash':
      return capa(
        <>
          <Accesorio emoji="📸" ancho={ancho} alto={alto} x={0.66} y={0.74} gira={3} />
          <Rafaga x={ancho * 0.66} y={alto * 0.68} tam={Math.min(ancho, alto) * 0.42} />
        </>
      );
    case 'escaneo':
      return capa(<Escaneo ancho={ancho} alto={alto} color="#45C9DE" />);
    case 'telefono':
      return capa(
        <>
          <Anillos x={ancho * 0.7} y={alto * 0.68} color="#3DDC84" tam={Math.min(ancho, alto) * 0.32} ms={1100} />
          <Timbra ancho={ancho} alto={alto} />
        </>
      );
    case 'reloj':
      return capa(<Accesorio emoji="⏰" ancho={ancho} alto={alto} x={0.7} y={0.72} gira={14} />);
    case 'check':
      return capa(
        <>
          <Anillos x={ancho * 0.7} y={alto * 0.7} color="#3DDC84" tam={Math.min(ancho, alto) * 0.3} cuantos={2} />
          <Accesorio emoji="✅" ancho={ancho} alto={alto} x={0.7} y={0.7} gira={4} />
        </>
      );
    case 'burbujas':
      return capa(<Vuelan emojis={['💬', '💭', '💬']} ancho={ancho} alto={alto} hacia={{ x: 0.85, y: 0.05 }} desde={{ x: 0.62, y: 0.55 }} />);
    case 'lapiz':
      return capa(<Accesorio emoji="✏️" ancho={ancho} alto={alto} x={0.7} y={0.74} gira={18} />);
    case 'avion':
      return capa(<Vuelan emojis={['🕊️']} ancho={ancho} alto={alto} hacia={{ x: 1.15, y: -0.15 }} desde={{ x: 0.5, y: 0.7 }} tam={0.22} ms={1300} enBucle={false} />);
    case 'sobres':
      return capa(<Vuelan emojis={['✉️', '📨', '✉️']} ancho={ancho} alto={alto} hacia={{ x: 0.9, y: -0.05 }} desde={{ x: 0.55, y: 0.7 }} />);
    case 'engrane':
      return capa(<Gira emoji="⚙️" ancho={ancho} alto={alto} />);
    case 'lupa':
      return capa(<Orbita emoji="🔍" ancho={ancho} alto={alto} />);
    case 'globo':
      return capa(
        <>
          <Gira emoji="🌐" ancho={ancho} alto={alto} />
          <Chispas ancho={ancho} alto={alto} color={acento} />
        </>
      );
    case 'nube':
      return capa(
        <>
          <Accesorio emoji="☁️" ancho={ancho} alto={alto} x={0.5} y={0.14} tam={0.3} gira={3} />
          <Vuelan emojis={['⬆️', '💻', '⬆️']} ancho={ancho} alto={alto} hacia={{ x: 0.5, y: 0.08 }} desde={{ x: 0.5, y: 0.75 }} tam={0.12} cada={500} />
        </>
      );
    case 'cerebro':
      return capa(
        <>
          <Anillos x={ancho * 0.5} y={alto * 0.16} color={acento} tam={Math.min(ancho, alto) * 0.28} cuantos={2} ms={1800} />
          <Accesorio emoji="🧠" ancho={ancho} alto={alto} x={0.5} y={0.16} tam={0.24} gira={4} />
          <Chispas ancho={ancho} alto={alto} color={acento} />
        </>
      );
    case 'chispas':
      return capa(<Chispas ancho={ancho} alto={alto} color={acento} />);
    case 'confeti':
      return capa(<Confeti ancho={ancho} alto={alto} />);
  }
}

/** El teléfono que vibra en la mano. */
function Timbra({ ancho, alto }: { ancho: number; alto: number }) {
  const vibra = useVaiven(120);
  return (
    <Animated.View style={{ position: 'absolute', left: 0, top: 0, width: ancho, height: alto, transform: [{ rotate: vibra.interpolate({ inputRange: [0, 1], outputRange: ['-1.2deg', '1.2deg'] }) }] }}>
      <Accesorio emoji="📱" ancho={ancho} alto={alto} x={0.7} y={0.68} gira={12} />
    </Animated.View>
  );
}

function Gira({ emoji, ancho, alto }: { emoji: string; ancho: number; alto: number }) {
  const v = useCiclo(3000);
  const lado = Math.min(ancho, alto) * 0.24;
  return (
    <Animated.Text style={{ position: 'absolute', left: ancho * 0.72 - lado / 2, top: alto * 0.7 - lado / 2, fontSize: lado * 0.85, transform: [{ rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }}>
      {emoji}
    </Animated.Text>
  );
}

function Orbita({ emoji, ancho, alto }: { emoji: string; ancho: number; alto: number }) {
  const v = useCiclo(2400);
  const lado = Math.min(ancho, alto) * 0.22;
  const r = Math.min(ancho, alto) * 0.3;
  const N = 9;
  const pasos = Array.from({ length: N }, (_, i) => i / (N - 1));
  return (
    <Animated.Text
      style={{
        position: 'absolute',
        left: ancho * 0.5 - lado / 2,
        top: alto * 0.45 - lado / 2,
        fontSize: lado * 0.85,
        transform: [
          { translateX: v.interpolate({ inputRange: pasos, outputRange: pasos.map((p) => Math.cos(p * Math.PI * 2) * r) }) },
          { translateY: v.interpolate({ inputRange: pasos, outputRange: pasos.map((p) => Math.sin(p * Math.PI * 2) * r * 0.6) }) },
        ],
      }}
    >
      {emoji}
    </Animated.Text>
  );
}
