/**
 * La cara de AU-RA con Skia: los anillos del teléfono, dibujados en la GPU y movidos en el hilo de la
 * interfaz (Reanimated), sin re-renderizar React en cada cuadro.
 *
 * Mismos gestos y mismas llamadas que UltronFace (tocar por zonas, mantener, arrastrar y te sigue,
 * frotar la mejilla, deslizar para el menú), así DeskScreen la cambia sin tocar su lógica. Lo nuevo:
 *  - los estados son de trabajo (estados.ts): escucha, piensa, lee, trabaja, habla, listo, te necesita,
 *    sin red, dormida;
 *  - la voz mueve la boca sin pasar por React (speechLevelSource);
 *  - al inclinar el teléfono cada capa del ojo se mueve distinto (giroscopio): se ve profundidad;
 *  - con «menos movimiento» del sistema solo queda el parpadeo.
 *
 * El dibujo es pintar.ts (el mismo que revisa scripts/qa/cara-skia.ts en la computadora).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Canvas, Picture, Skia } from '@shopify/react-native-skia';
import {
  Easing,
  SensorType,
  cancelAnimation,
  useAnimatedReaction,
  useAnimatedSensor,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  type SharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import type { FaceState } from '../config';
import type { Tarea } from '../lib/tareas';
import { OBJETIVOS, disposicion, estadoDe, geometria, mezclar, temaDeAcento, zonaDe, type EstadoCara, type Parametros, type Zona } from './estados';
import { grabar } from './pintar';

export type PedidoCara = { tarea: Tarea; n: number };

export type CaraSkiaProps = {
  face: FaceState;
  /** Color de su cara (cian por omisión). */
  acento?: string;
  /** Mirada que viene de fuera (cámara o mirada errante), -1..1. */
  gazeX?: number;
  gazeY?: number;
  speechLevelSource?: (cb: (level01: number) => void) => (() => void) | void;
  /** El cerebro responde; sin él, en reposo se ve apagada. */
  online?: boolean;
  /** La última tarea pedida (buscar, leer…): mientras dure, los ojos leen o trabajan. */
  pedido?: PedidoCara | null;
  /** Hay algo que necesita tu firma o tu respuesta. */
  necesita?: boolean;
  onTap?: (zone: Zona, x01: number, y01: number) => void;
  onLongPress?: () => void;
  onDragGaze?: (x: number, y: number) => void;
  onDragEnd?: () => void;
  onRub?: () => void;
  onSwipe?: (dir: 'left' | 'right') => void;
  /** Avisa qué estado muestra (para la línea de estado de arriba). */
  onEstado?: (e: EstadoCara) => void;
};

/** El borde derecho queda libre para el gesto de menú de DeskScreen (igual que UltronFace). */
const BORDE_MENU = 44;
/** Cuánto dura una tarea en la cara si nadie la cierra antes (empieza a hablar, por ejemplo). */
const TAREA_MAX_MS = 20_000;

const lim = (v: number) => (v < -1 ? -1 : v > 1 ? 1 : v);

export function CaraSkia(props: CaraSkiaProps) {
  const { face, acento, gazeX = 0, gazeY = 0, speechLevelSource, online, pedido, necesita, onEstado } = props;
  const [tam, setTam] = useState({ w: 0, h: 0 });
  const reducido = useReducedMotion();
  const tema = useMemo(() => temaDeAcento(acento), [acento]);
  const L = useMemo(() => disposicion(tam.w || 1, tam.h || 1), [tam.w, tam.h]);

  // ---- tarea en curso: dura hasta que empieza a hablar o se acaba el tiempo
  const [tarea, setTarea] = useState<Tarea | null>(null);
  useEffect(() => {
    if (!pedido) return;
    setTarea(pedido.tarea);
    const t = setTimeout(() => setTarea(null), TAREA_MAX_MS);
    return () => clearTimeout(t);
  }, [pedido?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (face === 'SPEAKING' || face === 'SING') setTarea(null);
  }, [face]);

  const estado = estadoDe({ face, online, tarea, necesita });
  useEffect(() => {
    onEstado?.(estado);
  }, [estado, onEstado]);

  // ---- parámetros: una sola curva mezcla del estado anterior al nuevo
  const desde = useSharedValue<Parametros>(OBJETIVOS.espera);
  const hacia = useSharedValue<Parametros>(OBJETIVOS.espera);
  const t = useSharedValue(1);
  useEffect(() => {
    const actual = mezclar(desde.value, hacia.value, t.value);
    desde.value = actual;
    hacia.value = OBJETIVOS[estado];
    t.value = 0;
    t.value = withTiming(1, { duration: 380, easing: Easing.out(Easing.cubic) });
  }, [estado]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- lo vivo
  const parpadeo = useSharedValue(1);
  const sacadaX = useSharedValue(0);
  const sacadaY = useSharedValue(0);
  const fase = useSharedValue(-1);
  const latido = useSharedValue(0);
  const giro = useSharedValue(0);
  const respira = useSharedValue(0);
  const inclinX = useSharedValue(0);
  const inclinY = useSharedValue(0);
  const voz = useSharedValue(0);
  const fueraX = useSharedValue(0);
  const fueraY = useSharedValue(0);
  const fuera = useSharedValue(0);
  const arrastrando = useRef(false);

  // Parpadeo: cada 4–7 s al azar, 1 de cada 8 doble. Queda incluso con «menos movimiento».
  useEffect(() => {
    let vivo = true;
    let timer: ReturnType<typeof setTimeout>;
    const cerrar = () => withSequence(withTiming(0.08, { duration: 70 }), withTiming(1, { duration: 90 }));
    const programar = () => {
      timer = setTimeout(() => {
        if (!vivo) return;
        parpadeo.value = Math.random() < 0.125 ? withSequence(cerrar(), withTiming(1, { duration: 80 }), cerrar()) : cerrar();
        programar();
      }, 4000 + Math.random() * 3000);
    };
    programar();
    return () => {
      vivo = false;
      clearTimeout(timer);
    };
  }, [parpadeo]);

  // Sacadas, respiración y latido: la vida en reposo. Fuera con «menos movimiento» y dormida (dormida
  // no se mueve nada salvo el parpadeo, y así la GPU no dibuja 60 cuadros por segundo para nadie).
  const quieta = reducido || estado === 'duerme';
  useEffect(() => {
    if (quieta) {
      sacadaX.value = withTiming(0, { duration: 300 });
      sacadaY.value = withTiming(0, { duration: 300 });
      respira.value = withTiming(0, { duration: 600 });
      latido.value = 0.5;
      return;
    }
    let vivo = true;
    let timer: ReturnType<typeof setTimeout>;
    const saltar = () => {
      timer = setTimeout(() => {
        if (!vivo) return;
        sacadaX.value = withTiming((Math.random() - 0.5) * 0.14, { duration: 60 });
        sacadaY.value = withTiming((Math.random() - 0.5) * 0.08, { duration: 60 });
        saltar();
      }, 2000 + Math.random() * 2000);
    };
    saltar();
    respira.value = withRepeat(withTiming(1, { duration: 2100, easing: Easing.inOut(Easing.sin) }), -1, true);
    latido.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => {
      vivo = false;
      clearTimeout(timer);
      cancelAnimation(respira);
      cancelAnimation(latido);
    };
  }, [quieta, sacadaX, sacadaY, respira, latido]);

  // La lectura (de lado a lado) solo corre leyendo, y el arco que gira solo trabajando.
  const leyendo = estado === 'lee' && !reducido;
  useEffect(() => {
    if (!leyendo) {
      cancelAnimation(fase);
      fase.value = 0;
      return;
    }
    fase.value = -1;
    fase.value = withRepeat(withTiming(1, { duration: 800, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(fase);
  }, [leyendo, fase]);
  const girando = estado === 'trabaja';
  useEffect(() => {
    if (!girando) {
      cancelAnimation(giro);
      return;
    }
    giro.value = 0;
    giro.value = withRepeat(withTiming(360, { duration: reducido ? 4000 : 1400, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(giro);
  }, [girando, reducido, giro]);

  // Voz: la boca sigue su volumen sin pasar por React.
  useEffect(() => {
    if (!speechLevelSource) return;
    const off = speechLevelSource((l) => {
      voz.value = withTiming(l < 0 ? 0 : l > 1 ? 1 : l, { duration: 60 });
    });
    return () => {
      if (typeof off === 'function') off();
    };
  }, [speechLevelSource, voz]);

  // Mirada de fuera (cámara o mirada errante). Con la mirada propia del estado (piensa, lee, trabaja,
  // dormida) lo de fuera casi no manda. El dedo, cuando arrastra, manda del todo.
  const pesoFuera = estado === 'piensa' || estado === 'lee' || estado === 'trabaja' || estado === 'duerme' ? 0.15 : 1;
  useEffect(() => {
    if (arrastrando.current) return;
    fueraX.value = withSpring(lim(gazeX), { stiffness: 120, damping: 14 });
    fueraY.value = withSpring(lim(gazeY), { stiffness: 120, damping: 14 });
    fuera.value = withTiming(pesoFuera, { duration: 300 });
  }, [gazeX, gazeY, pesoFuera, fueraX, fueraY, fuera]);

  // ---- el cuadro
  const cuadro = useDerivedValue(() => {
    const p = mezclar(desde.value, hacia.value, t.value);
    const g = geometria(
      p,
      {
        parpadeo: parpadeo.value,
        sacadaX: sacadaX.value,
        sacadaY: sacadaY.value,
        fase: fase.value,
        latido: latido.value,
        giro: giro.value,
        respira: respira.value,
        inclinX: inclinX.value,
        inclinY: inclinY.value,
        voz: voz.value,
        fueraX: fueraX.value,
        fueraY: fueraY.value,
        fuera: fuera.value,
      },
      L,
    );
    return grabar(Skia, g, tema);
  }, [L, tema]);

  // ---- tacto: las mismas zonas y llamadas que UltronFace
  const cbs = useRef(props);
  cbs.current = props;
  const geo = useRef(L);
  geo.current = L;
  const peso = useRef(pesoFuera);
  peso.current = pesoFuera;
  const responder = useMemo(() => {
    const s = { x0: 0, y0: 0, lx: 0, ly: 0, t0: 0, zona: 'face' as Zona, movido: false, largo: false, frotado: false, camino: 0, timer: null as ReturnType<typeof setTimeout> | null };
    const limpiar = () => {
      if (s.timer) clearTimeout(s.timer);
      s.timer = null;
    };
    const soltar = () => {
      arrastrando.current = false;
      fuera.value = withTiming(peso.current, { duration: 650 });
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: (e) => e.nativeEvent.locationX < geo.current.W - BORDE_MENU,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const { locationX: x, locationY: y } = e.nativeEvent;
        s.x0 = s.lx = x;
        s.y0 = s.ly = y;
        s.t0 = Date.now();
        s.zona = zonaDe(x, y, geo.current);
        s.movido = false;
        s.largo = false;
        s.frotado = false;
        s.camino = 0;
        limpiar();
        s.timer = setTimeout(() => {
          if (s.movido) return;
          s.largo = true;
          cbs.current.onLongPress?.();
        }, 450);
      },
      onPanResponderMove: (e, g) => {
        const { locationX: x, locationY: y } = e.nativeEvent;
        if (!s.movido && Math.hypot(g.dx, g.dy) > 10) {
          s.movido = true;
          limpiar();
        }
        if (!s.movido) return;
        s.camino += Math.hypot(x - s.lx, y - s.ly);
        s.lx = x;
        s.ly = y;
        const G = geo.current;
        const gx = lim((x - G.cx) / (G.d * 1.6));
        const gy = lim((y - G.cy) / (G.d * 1.2));
        arrastrando.current = true;
        fueraX.value = withSpring(gx, { stiffness: 180, damping: 16 });
        fueraY.value = withSpring(gy, { stiffness: 180, damping: 16 });
        fuera.value = 1;
        cbs.current.onDragGaze?.(gx, gy);
        if (!s.frotado && s.zona === 'cheek' && zonaDe(x, y, G) === 'cheek' && s.camino > G.d * 0.6) {
          s.frotado = true;
          cbs.current.onRub?.();
        }
      },
      onPanResponderRelease: (_e, g) => {
        limpiar();
        const dt = Date.now() - s.t0;
        if (s.movido) {
          soltar();
          cbs.current.onDragEnd?.();
          if (Math.abs(g.dx) > 140 && Math.abs(g.dy) < 80 && dt < 420) cbs.current.onSwipe?.(g.dx < 0 ? 'left' : 'right');
          return;
        }
        if (s.largo) return;
        // Tocarle un ojo lo hace parpadear: responde al tacto sin hacer gracias.
        if (s.zona === 'eyeL' || s.zona === 'eyeR') parpadeo.value = withSequence(withTiming(0.08, { duration: 60 }), withTiming(1, { duration: 110 }));
        const G = geo.current;
        cbs.current.onTap?.(s.zona, lim((s.x0 / G.W) * 2 - 1), lim((s.y0 / G.H) * 2 - 1));
      },
      onPanResponderTerminate: () => {
        limpiar();
        if (s.movido) {
          soltar();
          cbs.current.onDragEnd?.();
        }
      },
    });
  }, [fuera, fueraX, fueraY, parpadeo]);

  const medir = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width !== tam.w || height !== tam.h) setTam({ w: width, h: height });
  };

  return (
    <View style={styles.raiz} onLayout={medir} {...responder.panHandlers} accessibilityLabel="Cara de AU-RA" accessibilityRole="image">
      {!quieta ? <Inclinacion x={inclinX} y={inclinY} /> : null}
      {tam.w > 0 ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Canvas style={StyleSheet.absoluteFill}>
            <Picture picture={cuadro} />
          </Canvas>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Profundidad al inclinar el teléfono. Va en un componente aparte para poder NO montarlo: el sensor
 * solo se escucha cuando hace falta (ni con «menos movimiento» ni dormida). La base se recentra sola,
 * así cuenta el movimiento y no la postura en la que esté apoyado. Al desmontarse, la cara vuelve al
 * centro.
 */
function Inclinacion({ x, y }: { x: SharedValue<number>; y: SharedValue<number> }) {
  const sensor = useAnimatedSensor(SensorType.ROTATION, { interval: 'auto' });
  const baseRoll = useSharedValue<number | null>(null);
  const basePitch = useSharedValue(0);
  useAnimatedReaction(
    () => sensor.sensor.value,
    (s) => {
      if (!s) return;
      if (baseRoll.value === null) {
        baseRoll.value = s.roll;
        basePitch.value = s.pitch;
      }
      baseRoll.value += (s.roll - baseRoll.value) * 0.02;
      basePitch.value += (s.pitch - basePitch.value) * 0.02;
      const nx = (s.roll - baseRoll.value) / 0.3;
      const ny = (s.pitch - basePitch.value) / 0.3;
      x.value = nx < -1 ? -1 : nx > 1 ? 1 : nx;
      y.value = ny < -1 ? -1 : ny > 1 ? 1 : ny;
    },
  );
  useEffect(
    () => () => {
      x.value = withTiming(0, { duration: 400 });
      y.value = withTiming(0, { duration: 400 });
    },
    [x, y],
  );
  return null;
}

const styles = StyleSheet.create({
  raiz: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
});
