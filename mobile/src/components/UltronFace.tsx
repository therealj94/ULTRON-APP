/**
 * Cara ULTRON — estilo LOOI / DeskBot: dos anillos luminosos sobre negro,
 * párpados para emociones, cejas, boca en arco y glifos por modo.
 * Solo RN Animated (native driver) — sin Skia/Reanimated (EAS-safe).
 *
 * Tacto: la cara clasifica la zona tocada (ojo, frente, mejilla, boca, barbilla) y avisa al padre;
 * arrastrar el dedo mueve la mirada; frotar la mejilla y mantener pulsado tienen sus callbacks.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import type { FaceState, Mode } from '../config';

export type TouchZone = 'eyeL' | 'eyeR' | 'forehead' | 'mouth' | 'chin' | 'cheek' | 'face';

type Props = {
  face: FaceState;
  mode?: Mode;
  gazeX?: number;
  gazeY?: number;
  /** 0..1 nivel del micrófono → pulso al escuchar */
  level?: number;
  /** 0..1 nivel de la voz de ULTRON (lip-sync, desde tts.setSpeechLevelListener) → apertura de boca */
  speechLevel?: number;
  attack?: 'blaster' | 'saber' | null;
  /** 0..1 enojo acumulado por toques */
  irritation?: number;
  /** Ojo que se cierra en WINK. */
  winkSide?: 'L' | 'R';
  onTap?: (zone: TouchZone, x01: number, y01: number) => void;
  onLongPress?: () => void;
  /** El dedo arrastra: mirada relativa al centro de la cara (-1..1). */
  onDragGaze?: (x: number, y: number) => void;
  onDragEnd?: () => void;
  /** Frotó la mejilla (ida y vuelta corta dentro de la zona). */
  onRub?: () => void;
  /** Deslizamiento rápido horizontal (abrir/cerrar menú). */
  onSwipe?: (dir: 'left' | 'right') => void;
  /** Versión compacta (login/splash): diámetro de ojo y alto del escenario fijos. */
  size?: number;
  stageHeight?: number;
};

const CYAN = '#00E5FF';
const GOLD = '#FFD166';
const RED = '#FF3B5C';
const SABER = '#39FF14';
const EDGE_PX = 44;

const MODE_GLYPHS: Record<Mode, [string, string]> = {
  GUARDIAN: ['⛨', '⚿'],
  MINING: ['⚙', '⛏'],
  GOLD: ['✦', '✧'],
  CREATIVE: ['✎', '☼'],
  ANALYTICAL: ['♛', '⌕'],
  STRATEGIC: ['♞', '♚'],
  EXPLORER: ['⌖', '✈'],
  CONOCER: ['♡', '✉'],
};

type Lids = {
  top: number; // 0..1 cobertura párpado superior
  bottom: number; // 0..1 cobertura inferior (ojos sonrientes)
  tilt: number; // grados: + = ceño (interior baja)
  browY: number; // -1 arriba .. 1 abajo
  browTilt: number; // grados: - = interior arriba (pena), + = interior abajo (enojo)
  browOpacity: number;
  browAsym: number; // 0..1 ceja izquierda más arriba (curioso)
  pupil: number; // escala pupila
  mouth: number; // -1 triste .. 1 sonrisa
  mouthW: number; // escala ancho
  headTilt: number; // grados de inclinación de la cabeza
};

const NEUTRAL: Lids = { top: 0, bottom: 0, tilt: 0, browY: 0, browTilt: 0, browOpacity: 0, browAsym: 0, pupil: 1, mouth: 0.15, mouthW: 1, headTilt: 0 };

const LIDS: Record<FaceState, Lids> = {
  IDLE: NEUTRAL,
  LISTENING: { ...NEUTRAL, pupil: 1.15, mouth: 0.2 },
  THINKING: { ...NEUTRAL, top: 0.18, pupil: 0.85, mouth: 0.05, browOpacity: 0.5, browY: -0.5 },
  SPEAKING: { ...NEUTRAL, mouth: 0.3 },
  HAPPY: { ...NEUTRAL, bottom: 0.42, mouth: 1, mouthW: 1.25, pupil: 1.1 },
  WINK: { ...NEUTRAL, bottom: 0.3, mouth: 0.8, mouthW: 1.15 },
  CONCERNED: { ...NEUTRAL, top: 0.2, browOpacity: 0.9, browY: -0.6, browTilt: -14, mouth: -0.6, mouthW: 0.7 },
  ANGRY: { ...NEUTRAL, top: 0.42, tilt: 22, browOpacity: 1, browY: 0.6, browTilt: 22, mouth: -0.4, mouthW: 0.8, pupil: 0.7 },
  SLEEPING: { ...NEUTRAL, top: 0.94, mouth: 0.1, mouthW: 0.5, pupil: 0.6 },
  STARTLE: { ...NEUTRAL, pupil: 0.55, mouth: -0.2, mouthW: 0.5, browOpacity: 0.8, browY: -1 },
  CONFUSED: { ...NEUTRAL, top: 0.12, browOpacity: 0.8, browY: -0.4, browTilt: 10, mouth: -0.1, mouthW: 0.6, headTilt: 5 },
  MUSIC: { ...NEUTRAL, bottom: 0.35, mouth: 0.9, mouthW: 0.8 },
  SCAN: { ...NEUTRAL, top: 0.26, pupil: 0.8, mouth: 0.1 },
  YAWNING: { ...NEUTRAL, top: 0.7, mouth: -0.9, mouthW: 0.6 },
  // --- 4.0 ---
  LAUGH: { ...NEUTRAL, bottom: 0.55, mouth: 1, mouthW: 1.2, pupil: 1.05 },
  SURPRISED: { ...NEUTRAL, pupil: 0.6, mouth: -0.35, mouthW: 0.5, browOpacity: 0.95, browY: -1 },
  SAD: { ...NEUTRAL, top: 0.38, browOpacity: 0.9, browY: -0.35, browTilt: -22, mouth: -0.75, mouthW: 0.7, pupil: 0.9 },
  TIRED: { ...NEUTRAL, top: 0.62, browOpacity: 0.4, browY: 0.3, mouth: -0.1, mouthW: 0.6, pupil: 0.8 },
  SING: { ...NEUTRAL, bottom: 0.3, mouth: 0.9, mouthW: 0.85, headTilt: -3 },
  CURIOUS: { ...NEUTRAL, top: 0.05, pupil: 1.1, mouth: 0.35, mouthW: 0.8, browOpacity: 0.85, browY: -0.2, browAsym: 1, headTilt: -7 },
  PROUD: { ...NEUTRAL, top: 0.12, bottom: 0.25, mouth: 0.85, mouthW: 1.1, browOpacity: 0.6, browY: -0.3, pupil: 0.95 },
  // ojos cerrados con suavidad (no es sueño), cejas relajadas, sonrisa mínima serena
  PRAY: { ...NEUTRAL, top: 0.97, browOpacity: 0.3, browY: -0.05, mouth: 0.4, mouthW: 0.7, pupil: 0.9, headTilt: 0 },
};

/** Estados en los que la boca sigue el audio (lip-sync). */
const MOUTH_LOOP: ReadonlySet<FaceState> = new Set(['SPEAKING', 'MUSIC', 'SING', 'LAUGH', 'PRAY']);
/** Párpados lentos al entrar/salir de estos estados (los ojos se abren despacio al terminar de orar). */
const SLOW_LIDS: ReadonlySet<FaceState> = new Set(['PRAY', 'SLEEPING']);

function useAnim(v: number) {
  return useRef(new Animated.Value(v)).current;
}

const clamp = (v: number, a = -1, b = 1) => Math.max(a, Math.min(b, v));

export function UltronFace({
  face,
  mode = 'GUARDIAN',
  gazeX = 0,
  gazeY = 0,
  level = 0,
  speechLevel = 0,
  attack = null,
  irritation = 0,
  winkSide = 'L',
  onTap,
  onLongPress,
  onDragGaze,
  onDragEnd,
  onRub,
  onSwipe,
  size,
  stageHeight,
}: Props) {
  const { width, height } = useWindowDimensions();
  const stageH = stageHeight ?? height;
  const D = size ?? Math.min(height * 0.42, width * 0.28, 320);
  const compact = size !== undefined;
  const ring = Math.max(6, D * 0.09);
  const gap = D * 0.55;
  const firing = attack === 'blaster';
  const saberOn = attack === 'saber';
  const accent = face === 'ANGRY' || firing ? RED : saberOn ? SABER : mode === 'GOLD' ? GOLD : CYAN;
  const dim = face === 'SLEEPING';
  const lids = LIDS[face] || NEUTRAL;
  const [gL, gR] = MODE_GLYPHS[mode] || MODE_GLYPHS.GUARDIAN;
  const [stageW, setStageW] = useState(width);

  const breath = useAnim(1);
  const blink = useAnim(1);
  const topLid = useAnim(lids.top);
  const bottomLid = useAnim(lids.bottom);
  const tilt = useAnim(lids.tilt);
  const browY = useAnim(lids.browY);
  const browTilt = useAnim(lids.browTilt);
  const browOp = useAnim(lids.browOpacity);
  const browAsym = useAnim(lids.browAsym);
  const headTilt = useAnim(lids.headTilt);
  const pupilScale = useAnim(lids.pupil);
  const mouthCurve = useAnim(lids.mouth);
  const mouthW = useAnim(lids.mouthW);
  const mouthOpen = useAnim(0);
  const px = useAnim(0);
  const py = useAnim(0);
  const pulse = useAnim(0);
  const shake = useAnim(0);
  const bounce = useAnim(0);
  const squash = useAnim(1);
  const sway = useAnim(0);
  const glyphBob = useAnim(0);
  const beam = useAnim(0);
  const flash = useAnim(0);
  const saber = useAnim(0);
  const thinkDots = useAnim(0);

  // respiración (muy lenta al orar) + glifos flotando
  const praying = face === 'PRAY';
  useEffect(() => {
    const dur = praying ? 4600 : 2400;
    const b = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: praying ? 1.015 : 1.02, duration: dur, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 1, duration: dur, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    const g = Animated.loop(
      Animated.sequence([
        Animated.timing(glyphBob, { toValue: 1, duration: 2800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(glyphBob, { toValue: 0, duration: 2800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    b.start();
    g.start();
    return () => {
      b.stop();
      g.stop();
    };
  }, [breath, glyphBob, praying]);

  // parpadeo natural (lento y pesado si está cansado)
  useEffect(() => {
    let alive = true;
    let t: ReturnType<typeof setTimeout>;
    const slow = face === 'TIRED' ? 2.4 : 1;
    const doBlink = () => {
      if (!alive) return;
      if (face !== 'SLEEPING' && face !== 'PRAY') {
        Animated.sequence([
          Animated.timing(blink, { toValue: 0.05, duration: 70 * slow, useNativeDriver: true }),
          Animated.timing(blink, { toValue: 1, duration: 130 * slow, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        ]).start();
      }
      t = setTimeout(doBlink, (face === 'TIRED' ? 1800 : 2600) + Math.random() * 2600);
    };
    t = setTimeout(doBlink, 1200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [blink, face]);

  // transición de emoción
  const prevFace = useRef<FaceState>(face);
  useEffect(() => {
    const ease = Easing.out(Easing.cubic);
    const dur = 260;
    const slowLids = SLOW_LIDS.has(face) || SLOW_LIDS.has(prevFace.current);
    prevFace.current = face;
    Animated.parallel([
      Animated.timing(topLid, { toValue: lids.top, duration: slowLids ? (face === 'PRAY' ? 700 : 900) : dur, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
      Animated.timing(bottomLid, { toValue: lids.bottom, duration: dur, easing: ease, useNativeDriver: true }),
      Animated.timing(tilt, { toValue: lids.tilt, duration: dur, easing: ease, useNativeDriver: true }),
      Animated.timing(browY, { toValue: lids.browY, duration: dur, easing: ease, useNativeDriver: true }),
      Animated.timing(browTilt, { toValue: lids.browTilt, duration: dur, easing: ease, useNativeDriver: true }),
      Animated.timing(browOp, { toValue: lids.browOpacity, duration: dur, useNativeDriver: true }),
      Animated.timing(browAsym, { toValue: lids.browAsym, duration: dur, easing: ease, useNativeDriver: true }),
      Animated.spring(headTilt, { toValue: lids.headTilt, friction: 6, useNativeDriver: true }),
      Animated.spring(pupilScale, { toValue: lids.pupil, friction: 6, useNativeDriver: true }),
      Animated.timing(mouthCurve, { toValue: lids.mouth, duration: dur, easing: ease, useNativeDriver: true }),
      Animated.timing(mouthW, { toValue: lids.mouthW, duration: dur, easing: ease, useNativeDriver: true }),
    ]).start();

    const running: Animated.CompositeAnimation[] = [];
    const run = (a: Animated.CompositeAnimation) => {
      running.push(a);
      a.start();
    };

    if (!MOUTH_LOOP.has(face)) Animated.timing(mouthOpen, { toValue: 0, duration: 160, useNativeDriver: true }).start();

    if (face === 'THINKING') {
      run(
        Animated.loop(
          Animated.sequence([
            Animated.timing(thinkDots, { toValue: 1, duration: 900, useNativeDriver: true }),
            Animated.timing(thinkDots, { toValue: 0, duration: 900, useNativeDriver: true }),
          ])
        )
      );
    }

    if (face === 'ANGRY' || face === 'STARTLE' || face === 'SURPRISED') {
      run(
        Animated.sequence([
          Animated.timing(shake, { toValue: 1, duration: 40, useNativeDriver: true }),
          Animated.timing(shake, { toValue: -1, duration: 60, useNativeDriver: true }),
          Animated.timing(shake, { toValue: 0.6, duration: 50, useNativeDriver: true }),
          Animated.timing(shake, { toValue: 0, duration: 70, useNativeDriver: true }),
        ])
      );
    }

    // LAUGH: rebote rítmico con squash
    if (face === 'LAUGH') {
      run(
        Animated.loop(
          Animated.sequence([
            Animated.parallel([
              Animated.timing(bounce, { toValue: 1, duration: 130, easing: Easing.out(Easing.quad), useNativeDriver: true }),
              Animated.timing(squash, { toValue: 1.05, duration: 130, useNativeDriver: true }),
            ]),
            Animated.parallel([
              Animated.timing(bounce, { toValue: 0, duration: 150, easing: Easing.in(Easing.quad), useNativeDriver: true }),
              Animated.timing(squash, { toValue: 0.93, duration: 150, useNativeDriver: true }),
            ]),
          ])
        )
      );
    } else if (face === 'PROUD') {
      // pecho arriba: sube y se queda ligeramente erguido
      run(
        Animated.sequence([
          Animated.parallel([
            Animated.spring(bounce, { toValue: 1.4, friction: 4, tension: 90, useNativeDriver: true }),
            Animated.spring(squash, { toValue: 1.05, friction: 5, useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.spring(bounce, { toValue: 0.7, friction: 6, useNativeDriver: true }),
            Animated.spring(squash, { toValue: 1.02, friction: 6, useNativeDriver: true }),
          ]),
        ])
      );
    } else if (face === 'SURPRISED') {
      run(
        Animated.sequence([
          Animated.spring(squash, { toValue: 1.08, friction: 3, tension: 120, useNativeDriver: true }),
          Animated.spring(squash, { toValue: 1, friction: 5, useNativeDriver: true }),
        ])
      );
    } else if (face === 'TIRED') {
      run(
        Animated.loop(
          Animated.sequence([
            Animated.timing(bounce, { toValue: -0.6, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
            Animated.timing(bounce, { toValue: -0.2, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          ])
        )
      );
    } else if (face === 'PRAY') {
      // cabeza ligeramente inclinada hacia abajo, quieta
      run(Animated.timing(bounce, { toValue: -0.45, duration: 900, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }));
    } else {
      Animated.parallel([
        Animated.spring(bounce, { toValue: 0, friction: 6, useNativeDriver: true }),
        Animated.spring(squash, { toValue: 1, friction: 6, useNativeDriver: true }),
      ]).start();
    }

    // SING / MUSIC: balanceo suave
    if (face === 'SING' || face === 'MUSIC') {
      run(
        Animated.loop(
          Animated.sequence([
            Animated.timing(sway, { toValue: 1, duration: 620, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
            Animated.timing(sway, { toValue: -1, duration: 620, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          ])
        )
      );
    } else {
      Animated.timing(sway, { toValue: 0, duration: 300, useNativeDriver: true }).start();
    }

    return () => running.forEach((a) => a.stop());
  }, [face, lids, topLid, bottomLid, tilt, browY, browTilt, browOp, browAsym, headTilt, pupilScale, mouthCurve, mouthW, mouthOpen, shake, thinkDots, bounce, squash, sway]);

  // mirada
  useEffect(() => {
    const think = face === 'THINKING';
    const sad = face === 'SAD';
    const tx = (think ? 0.55 : clamp(gazeX)) * D * 0.18;
    const ty = (think ? -0.6 : sad ? 0.75 : clamp(gazeY)) * D * 0.14;
    Animated.spring(px, { toValue: tx, friction: 7, tension: 50, useNativeDriver: true }).start();
    Animated.spring(py, { toValue: ty, friction: 7, tension: 50, useNativeDriver: true }).start();
  }, [gazeX, gazeY, face, D, px, py]);

  // pulso por nivel de mic al escuchar
  useEffect(() => {
    Animated.timing(pulse, { toValue: face === 'LISTENING' ? level : 0, duration: 90, useNativeDriver: true }).start();
  }, [level, face, pulse]);

  // Lip-sync: la boca sigue el nivel de la voz (tts.ts lo emite a 20 Hz sincronizado a positionMillis).
  const lastLevelAt = useRef(0);
  useEffect(() => {
    if (!MOUTH_LOOP.has(face)) return;
    lastLevelAt.current = Date.now();
    const gain = face === 'PRAY' ? 0.7 : face === 'LAUGH' ? 1.1 : face === 'SING' || face === 'MUSIC' ? 1.15 : 1;
    Animated.timing(mouthOpen, { toValue: Math.min(1, speechLevel * gain), duration: 45, useNativeDriver: true }).start();
  }, [speechLevel, face, mouthOpen]);

  // Respaldo: si estamos "hablando" pero no llega nivel (audio ajeno a tts.ts), la boca se mueve sola.
  useEffect(() => {
    if (!MOUTH_LOOP.has(face)) return;
    let loop: Animated.CompositeAnimation | null = null;
    const fast = face === 'LAUGH';
    const id = setInterval(() => {
      const stale = Date.now() - lastLevelAt.current > 700;
      if (stale && !loop) {
        loop = Animated.loop(
          Animated.sequence([
            Animated.timing(mouthOpen, { toValue: 0.9, duration: fast ? 90 : 130, useNativeDriver: true }),
            Animated.timing(mouthOpen, { toValue: 0.2, duration: fast ? 90 : 150, useNativeDriver: true }),
            Animated.timing(mouthOpen, { toValue: 0.65, duration: 110, useNativeDriver: true }),
            Animated.timing(mouthOpen, { toValue: 0.1, duration: fast ? 100 : 170, useNativeDriver: true }),
          ])
        );
        loop.start();
      } else if (!stale && loop) {
        loop.stop();
        loop = null;
      }
    }, 200);
    return () => {
      clearInterval(id);
      loop?.stop();
    };
  }, [face, mouthOpen]);

  useEffect(() => {
    if (!firing) {
      beam.setValue(0);
      if (!saberOn) flash.setValue(0);
      return;
    }
    const shot = Animated.sequence([
      Animated.parallel([
        Animated.timing(beam, { toValue: 1, duration: 110, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(flash, { toValue: 0.45, duration: 60, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(beam, { toValue: 0, duration: 160, useNativeDriver: true }),
        Animated.timing(flash, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]),
      Animated.delay(120),
    ]);
    const l = Animated.loop(shot, { iterations: 3 });
    l.start();
    return () => l.stop();
  }, [firing, saberOn, beam, flash]);

  useEffect(() => {
    if (!saberOn) {
      saber.setValue(0);
      return;
    }
    const swing = Animated.sequence([
      Animated.parallel([
        Animated.timing(saber, { toValue: 1, duration: 160, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(flash, { toValue: 0.28, duration: 80, useNativeDriver: true }),
      ]),
      Animated.timing(saber, { toValue: 0.92, duration: 80, useNativeDriver: true }),
      Animated.delay(720),
      Animated.parallel([
        Animated.timing(saber, { toValue: 0, duration: 220, useNativeDriver: true }),
        Animated.timing(flash, { toValue: 0, duration: 220, useNativeDriver: true }),
      ]),
    ]);
    swing.start();
    return () => swing.stop();
  }, [saberOn, saber, flash]);

  // ---------------------------------------------------------------- tacto
  // Geometría de la cara en coordenadas del escenario (columna centrada: fila de ojos + boca).
  const geo = useRef({ D, stageW, stageH, gap });
  geo.current = { D, stageW, stageH, gap };
  const cbs = useRef({ onTap, onLongPress, onDragGaze, onDragEnd, onRub, onSwipe });
  cbs.current = { onTap, onLongPress, onDragGaze, onDragEnd, onRub, onSwipe };
  const origin = useRef({ x: 0, y: 0 });
  const stageRef = useRef<View>(null);

  const onStageLayout = (e: LayoutChangeEvent) => {
    setStageW(e.nativeEvent.layout.width);
    stageRef.current?.measureInWindow((x, y) => {
      origin.current = { x, y };
    });
  };

  const zoneAt = (x: number, y: number): TouchZone => {
    const { D: d, stageW: w, stageH: h, gap: g } = geo.current;
    const cx = w / 2;
    const top = (h - d * 1.5) / 2;
    const ey = top + d / 2;
    const my = top + d * 1.33;
    const ex = g / 2 + d / 2;
    if (Math.hypot(x - (cx - ex), y - ey) < d * 0.55) return 'eyeL';
    if (Math.hypot(x - (cx + ex), y - ey) < d * 0.55) return 'eyeR';
    if (y < ey - d * 0.45 && Math.abs(x - cx) < d * 1.6) return 'forehead';
    if (Math.abs(y - my) < d * 0.28 && Math.abs(x - cx) < d * 0.45) return 'mouth';
    if (y > my + d * 0.28 && Math.abs(x - cx) < d * 1.4) return 'chin';
    if (y >= ey - d * 0.45 && y <= my + d * 0.28 && Math.abs(x - cx) >= d * 0.45) return 'cheek';
    return 'face';
  };

  const gazeFromPoint = (x: number, y: number) => {
    const { D: d, stageW: w, stageH: h } = geo.current;
    const top = (h - d * 1.5) / 2;
    return { gx: clamp((x - w / 2) / (d * 1.3)), gy: clamp((y - (top + d / 2)) / (d * 0.9)) };
  };

  const pan = useRef(
    (() => {
      const s = {
        x0: 0,
        y0: 0,
        t0: 0,
        zone: 'face' as TouchZone,
        dragged: false,
        longFired: false,
        rubbed: false,
        path: 0,
        lx: 0,
        ly: 0,
        timer: null as ReturnType<typeof setTimeout> | null,
      };
      const local = (pageX: number, pageY: number) => ({ x: pageX - origin.current.x, y: pageY - origin.current.y });
      const clear = () => {
        if (s.timer) clearTimeout(s.timer);
        s.timer = null;
      };
      return PanResponder.create({
        onStartShouldSetPanResponder: (e) => {
          const { x } = local(e.nativeEvent.pageX, e.nativeEvent.pageY);
          // el borde derecho queda libre para el gesto de menú del padre
          return x < geo.current.stageW - EDGE_PX;
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          const { x, y } = local(e.nativeEvent.pageX, e.nativeEvent.pageY);
          s.x0 = x;
          s.y0 = y;
          s.lx = x;
          s.ly = y;
          s.t0 = Date.now();
          s.zone = zoneAt(x, y);
          s.dragged = false;
          s.longFired = false;
          s.rubbed = false;
          s.path = 0;
          clear();
          s.timer = setTimeout(() => {
            if (s.dragged) return;
            s.longFired = true;
            cbs.current.onLongPress?.();
          }, 450);
        },
        onPanResponderMove: (e, g) => {
          const { x, y } = local(e.nativeEvent.pageX, e.nativeEvent.pageY);
          if (!s.dragged && Math.hypot(g.dx, g.dy) > 10) {
            s.dragged = true;
            clear();
          }
          if (!s.dragged) return;
          s.path += Math.hypot(x - s.lx, y - s.ly);
          s.lx = x;
          s.ly = y;
          const { gx, gy } = gazeFromPoint(x, y);
          cbs.current.onDragGaze?.(gx, gy);
          if (!s.rubbed && s.zone === 'cheek' && zoneAt(x, y) === 'cheek' && s.path > geo.current.D * 0.6) {
            s.rubbed = true;
            cbs.current.onRub?.();
          }
        },
        onPanResponderRelease: (_e, g) => {
          clear();
          const dt = Date.now() - s.t0;
          if (s.dragged) {
            cbs.current.onDragEnd?.();
            if (Math.abs(g.dx) > 140 && Math.abs(g.dy) < 80 && dt < 420) cbs.current.onSwipe?.(g.dx < 0 ? 'left' : 'right');
            return;
          }
          if (s.longFired) return;
          const { stageW: w, stageH: h } = geo.current;
          cbs.current.onTap?.(s.zone, clamp((s.x0 / w) * 2 - 1), clamp((s.y0 / h) * 2 - 1));
        },
        onPanResponderTerminate: () => {
          clear();
          if (s.dragged) cbs.current.onDragEnd?.();
        },
      });
    })()
  ).current;

  // ---------------------------------------------------------------- interpolaciones
  const lidH = D * 1.1;
  const topLidY = topLid.interpolate({ inputRange: [0, 1], outputRange: [-lidH, -lidH + D * 1.02] });
  const bottomLidY = bottomLid.interpolate({ inputRange: [0, 1], outputRange: [lidH, lidH - D * 1.0] });
  const tiltL = tilt.interpolate({ inputRange: [-45, 45], outputRange: ['-45deg', '45deg'] });
  const tiltR = tilt.interpolate({ inputRange: [-45, 45], outputRange: ['45deg', '-45deg'] });
  const browTiltL = browTilt.interpolate({ inputRange: [-45, 45], outputRange: ['-45deg', '45deg'] });
  const browTiltR = browTilt.interpolate({ inputRange: [-45, 45], outputRange: ['45deg', '-45deg'] });
  const browTy = browY.interpolate({ inputRange: [-1, 1], outputRange: [-D * 0.12, D * 0.14] });
  const browAsymL = browAsym.interpolate({ inputRange: [0, 1], outputRange: [0, -D * 0.1] });
  const browAsymR = browAsym.interpolate({ inputRange: [0, 1], outputRange: [0, D * 0.03] });
  const headRot = headTilt.interpolate({ inputRange: [-45, 45], outputRange: ['-45deg', '45deg'] });
  const shakeX = shake.interpolate({ inputRange: [-1, 1], outputRange: [-8, 8] });
  const bounceTy = bounce.interpolate({ inputRange: [-1, 0, 1.5], outputRange: [D * 0.05, 0, -D * 0.09] });
  const swayX = sway.interpolate({ inputRange: [-1, 1], outputRange: [-D * 0.06, D * 0.06] });
  const swayRot = sway.interpolate({ inputRange: [-1, 1], outputRange: ['-3deg', '3deg'] });
  const glyphTy = glyphBob.interpolate({ inputRange: [0, 1], outputRange: [0, -8] });
  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.22] });
  const pulseOp = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.12, 0.5] });

  const mouthWpx = D * 0.62;
  const mouthArcH = D * 0.26;
  const mouthScaleY = mouthCurve.interpolate({ inputRange: [-1, 0, 1], outputRange: [-1, 0.08, 1] });
  const mouthOpenScale = mouthOpen.interpolate({ inputRange: [0, 1], outputRange: [0.01, 1], extrapolate: 'clamp' });
  const beamH = stageH * 0.95;
  const beamScale = beam.interpolate({ inputRange: [0, 1], outputRange: [0.01, 1] });
  const beamTy = beam.interpolate({ inputRange: [0, 1], outputRange: [-beamH / 2, 0] });
  const saberH = stageH * 0.85;
  const saberScale = saber.interpolate({ inputRange: [0, 1], outputRange: [0.02, 1] });
  const saberRotL = saber.interpolate({ inputRange: [0, 1], outputRange: ['-8deg', '-28deg'] });
  const saberRotR = saber.interpolate({ inputRange: [0, 1], outputRange: ['8deg', '28deg'] });

  const glyphStyle = useMemo(() => ({ color: accent, opacity: dim ? 0.15 : 0.42, fontSize: D * 0.22 }), [accent, dim, D]);
  const mouthLoop = MOUTH_LOOP.has(face);

  const renderEye = (side: 'L' | 'R') => {
    const wink = face === 'WINK' && side === winkSide;
    const scaleY = wink ? 0.06 : blink;
    return (
      <Animated.View key={side} style={[styles.eyeWrap, { width: D, height: D, transform: [{ scaleY }] }]}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.pulseRing,
            {
              width: D * 1.18,
              height: D * 1.18,
              borderRadius: D * 0.59,
              borderColor: accent,
              opacity: pulseOp,
              transform: [{ scale: pulseScale }],
            },
          ]}
        />
        <View style={[styles.glow, { width: D * 1.06, height: D * 1.06, borderRadius: D * 0.53, borderColor: accent, opacity: dim ? 0.08 : 0.28 }]} />
        <View style={[styles.eye, { width: D, height: D, borderRadius: D / 2, overflow: 'hidden' }]}>
          <View style={[styles.ring, { width: D, height: D, borderRadius: D / 2, borderWidth: ring, borderColor: accent, opacity: dim ? 0.35 : 1 }]} />
          <View style={[styles.innerGlow, { width: D * 0.78, height: D * 0.78, borderRadius: D * 0.39, backgroundColor: accent, opacity: dim ? 0.03 : 0.08 }]} />
          <Animated.View
            style={[
              styles.pupil,
              {
                width: D * 0.24,
                height: D * 0.24,
                borderRadius: D * 0.12,
                backgroundColor: accent,
                opacity: dim ? 0.35 : 1,
                transform: [{ translateX: px }, { translateY: py }, { scale: pupilScale }],
              },
            ]}
          >
            <View style={[styles.glint, { width: D * 0.06, height: D * 0.06, borderRadius: D * 0.03 }]} />
          </Animated.View>
          {/* párpado superior (con inclinación para ceño) */}
          <Animated.View
            style={[
              styles.lid,
              {
                width: D * 1.6,
                height: lidH,
                left: -D * 0.3,
                transform: [{ translateY: topLidY }, { rotate: side === 'L' ? tiltL : tiltR }],
              },
            ]}
          />
          {/* párpado inferior (ojos sonrientes) */}
          <Animated.View style={[styles.lid, { width: D * 1.6, height: lidH, left: -D * 0.3, borderRadius: D * 0.6, transform: [{ translateY: bottomLidY }] }]} />
        </View>
        {/* ceja */}
        <Animated.View
          style={[
            styles.brow,
            {
              width: D * 0.72,
              height: Math.max(4, ring * 0.8),
              borderRadius: ring,
              backgroundColor: accent,
              top: -D * 0.16,
              opacity: browOp,
              transform: [{ translateY: browTy }, { translateY: side === 'L' ? browAsymL : browAsymR }, { rotate: side === 'L' ? browTiltL : browTiltR }],
            },
          ]}
        />
        {/* haz blaster */}
        {firing && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.beam,
              {
                width: Math.max(3, ring * 0.7),
                height: beamH,
                top: D * 0.5,
                backgroundColor: RED,
                opacity: beam,
                transform: [{ translateY: beamTy }, { scaleY: beamScale }],
              },
            ]}
          />
        )}
        {saberOn && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.beam,
              {
                width: Math.max(6, ring * 1.1),
                height: saberH,
                top: D * 0.42,
                backgroundColor: SABER,
                shadowColor: SABER,
                opacity: saber,
                transform: [{ rotate: side === 'L' ? saberRotL : saberRotR }, { scaleY: saberScale }],
              },
            ]}
          />
        )}
      </Animated.View>
    );
  };

  return (
    <View ref={stageRef} style={[styles.stage, { height: stageH }]} onLayout={onStageLayout} {...(compact ? {} : pan.panHandlers)}>
      <Animated.View
        style={[
          styles.faceRow,
          { gap, transform: [{ scale: breath }, { translateX: Animated.add(shakeX, swayX) }, { translateY: bounceTy }, { scaleY: squash }, { rotate: headRot }, { rotate: swayRot }] },
        ]}
      >
        {!compact && <Animated.Text style={[styles.glyph, glyphStyle, { transform: [{ translateY: glyphTy }] }]}>{gL}</Animated.Text>}
        {renderEye('L')}
        {renderEye('R')}
        {!compact && <Animated.Text style={[styles.glyph, glyphStyle, { transform: [{ translateY: Animated.multiply(glyphTy, -1) }] }]}>{gR}</Animated.Text>}
      </Animated.View>

      {/* boca */}
      <Animated.View style={[styles.mouthWrap, { height: mouthArcH * 1.3, marginTop: D * 0.16, transform: [{ translateY: bounceTy }, { translateX: swayX }] }]}>
        <Animated.View
          style={[
            styles.mouthArc,
            {
              width: mouthWpx,
              height: mouthArcH,
              borderBottomWidth: Math.max(4, ring * 0.75),
              borderColor: accent,
              borderBottomLeftRadius: mouthWpx / 2,
              borderBottomRightRadius: mouthWpx / 2,
              opacity: dim ? 0.3 : face === 'PRAY' ? 0.55 : mouthLoop ? 0 : 1,
              transform: [{ scaleX: mouthW }, { scaleY: mouthScaleY }],
            },
          ]}
        />
        {mouthLoop && (
          <Animated.View
            style={[
              styles.mouthOpen,
              {
                width: mouthWpx * (face === 'LAUGH' ? 0.62 : face === 'PRAY' ? 0.4 : 0.55),
                height: mouthArcH * 0.9,
                borderRadius: mouthWpx * 0.3,
                backgroundColor: accent,
                transform: [{ scaleY: mouthOpenScale }],
              },
            ]}
          />
        )}
        {face === 'THINKING' && (
          <Animated.View style={[styles.dots, { opacity: thinkDots }]}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={[styles.dot, { backgroundColor: accent, opacity: 0.4 + i * 0.3 }]} />
            ))}
          </Animated.View>
        )}
      </Animated.View>

      {face === 'SLEEPING' && (
        <Animated.Text style={[styles.zzz, { color: CYAN, right: width * 0.28, transform: [{ translateY: glyphTy }] }]}>z z</Animated.Text>
      )}
      {(face === 'SING' || face === 'MUSIC') && !compact && (
        <Animated.Text style={[styles.zzz, { color: accent, right: width * 0.22, top: stageH * 0.22, transform: [{ translateY: glyphTy }] }]}>♪ ♫</Animated.Text>
      )}

      {irritation > 0.35 && !compact && (
        <View style={[styles.irrBar, { width: D * 2 }]}>
          <View style={[styles.irrFill, { width: `${Math.round(irritation * 100)}%`, backgroundColor: irritation > 0.75 ? RED : accent }]} />
        </View>
      )}

      {firing && <Animated.View pointerEvents="none" style={[styles.flash, { opacity: flash, backgroundColor: RED }]} />}
      {saberOn && <Animated.View pointerEvents="none" style={[styles.flash, { opacity: flash, backgroundColor: SABER }]} />}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { width: '100%', alignItems: 'center', justifyContent: 'center' },
  faceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  eyeWrap: { alignItems: 'center', justifyContent: 'center' },
  pulseRing: { position: 'absolute', borderWidth: 2 },
  glow: { position: 'absolute', borderWidth: 6 },
  eye: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  ring: { position: 'absolute' },
  innerGlow: { position: 'absolute' },
  pupil: { alignItems: 'flex-start', justifyContent: 'flex-start', padding: 3 },
  glint: { backgroundColor: '#FFFFFF', opacity: 0.9 },
  lid: { position: 'absolute', top: 0, backgroundColor: '#000' },
  brow: { position: 'absolute' },
  beam: { position: 'absolute', borderRadius: 2 },
  glyph: { marginHorizontal: 8, textAlign: 'center', includeFontPadding: false },
  mouthWrap: { alignItems: 'center', justifyContent: 'center' },
  mouthArc: { position: 'absolute' },
  mouthOpen: { position: 'absolute' },
  dots: { flexDirection: 'row', gap: 8, position: 'absolute' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  zzz: { position: 'absolute', top: 0, fontSize: 22, letterSpacing: 4, opacity: 0.6 },
  irrBar: { position: 'absolute', bottom: 4, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  irrFill: { height: '100%', borderRadius: 2 },
  flash: { ...StyleSheet.absoluteFillObject },
});
