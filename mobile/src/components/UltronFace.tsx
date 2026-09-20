/**
 * Cara ULTRON — estilo LOOI / DeskBot: dos anillos luminosos sobre negro, párpados para emociones,
 * cejas, boca paramétrica y glifos por modo. Solo RN Animated (native driver) — sin Skia/Reanimated.
 *
 * Boca (4.1): protagonista secundaria. Cuatro capas animadas solo con transforms/opacity:
 *  - arco (curva -1..1 = triste..sonrisa, ancho, inclinación para muecas),
 *  - interior oscuro con borde (apertura 0..1, redondez 0.5..1.2, mandíbula que baja),
 *  - barra de labio apretado (molestia),
 *  - dientes (risa abierta).
 * Cada estado define una forma (sonrisa amplia, «o» de sorpresa, mueca triste, risa abierta, labio
 * apretado, boca pequeña serena en PRAY…) y al hablar los visemas siguen `speechLevel`
 * (cerrada / media ancha / abierta redonda) con ataque rápido (35 ms) y cierre más lento (90 ms).
 *
 * Tacto: la cara reacciona sola y de inmediato en onPanResponderGrant (< 1 frame, sin setState):
 * squash del ojo tocado, pupilas que saltan al punto, boca «oh» en barbilla, sonrisa en mejilla,
 * cejas arriba en frente, onda fina en el punto tocado, squash leve general. Al arrastrar, los ojos
 * siguen el dedo con retardo elástico (spring blando). El padre recibe onTap/onDragGaze/… igual que antes.
 *
 * Atención (`attention` 0..1): con alguien mirando, halo y pupilas se iluminan un poco.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import type { FaceState, Mode } from '../config';

export type TouchZone = 'eyeL' | 'eyeR' | 'forehead' | 'mouth' | 'chin' | 'cheek' | 'face';

type Props = {
  face: FaceState;
  mode?: Mode;
  /**
   * Color de la cara. Cian es ULTRON; Dr Electrum es ámbar.
   *
   * Sin esto, la app del doctor enseñaba la cara de ULTRON con otro nombre encima, que es
   * exactamente lo que el resto del sistema se cuida de no hacer: dos cerebros con la misma firma
   * visual son la misma cosa con dos rótulos. Por omisión cian, para que ULTRON no cambie.
   *
   * No manda siempre: el rojo del enojo, el sable y el modo GOLD siguen ganando, porque esos son
   * estados del CUERPO y le pasan igual a las dos plataformas.
   */
  acento?: string;
  gazeX?: number;
  gazeY?: number;
  /** 0..1 nivel del micrófono → pulso al escuchar */
  level?: number;
  /** 0..1 nivel de la voz de ULTRON (lip-sync) → visemas. Cada cambio re-renderiza: preferí `speechLevelSource`. */
  speechLevel?: number;
  /**
   * Fuente del nivel de voz sin pasar por el estado del padre: la cara se suscribe una vez y mueve la
   * boca con Animated a 20 Hz sin ningún setState ni re-render (DeskScreen pasa tts.setSpeechLevelListener).
   * Devuelve la función para desuscribirse.
   */
  speechLevelSource?: (cb: (level01: number) => void) => (() => void) | void;
  /** 0..1 alguien delante mirando (cámara): la cara se ilumina un poco. */
  attention?: number;
  attack?: 'blaster' | 'saber' | null;
  /** 0..1 enojo acumulado por toques */
  irritation?: number;
  /** Ojo que se cierra en WINK. */
  winkSide?: 'L' | 'R';
  onTap?: (zone: TouchZone, x01: number, y01: number) => void;
  onLongPress?: () => void;
  /** El dedo arrastra: mirada relativa al centro de la cara (-1..1). La cara ya sigue el dedo sola. */
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
const MOUTH_DARK = '#02151B';
/** Núcleo claro del ojo y su borde: dan el volumen del ojo lleno (la web lo hace con un degradado radial). */
const IRIS_CLARO = '#D6F8FF';
const IRIS_BORDE = 'rgba(3,58,76,0.55)';

/**
 * El brillo del iris, derivado del color de la cara.
 *
 * Era una constante pálida de cian (`#D6F8FF`). Sobre el iris ámbar de Dr Electrum dejaba de ser un
 * reflejo y pasaba a ser un disco gris verdoso en mitad del ojo, como una catarata. Un reflejo es
 * el MISMO color con más luz, no otro color: por eso se calcula mezclando el acento con blanco.
 */
function aclarar(hex: string, cuanto: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return IRIS_CLARO;
  const n = parseInt(m[1], 16);
  const mezcla = (c: number) => Math.round(c + (255 - c) * cuanto);
  const r = mezcla((n >> 16) & 255);
  const g = mezcla((n >> 8) & 255);
  const b = mezcla(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
const TEETH = '#D9FBFF';
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
  mouth: number; // -1 triste .. 1 sonrisa (curva del arco)
  mouthW: number; // escala ancho del arco
  headTilt: number; // grados de inclinación de la cabeza
  // --- boca 4.1
  open: number; // 0..1 apertura en reposo (interior oscuro visible)
  round: number; // 0.5 «o» cerrada .. 1.2 ancha
  press: number; // 0..1 labio apretado (barra plana en vez de arco)
  mouthTilt: number; // grados: mueca / sonrisa ladeada
  jaw: number; // 0..1 mandíbula baja
  teeth: number; // 0..1 dientes visibles (risa)
};

const NEUTRAL: Lids = {
  top: 0, bottom: 0, tilt: 0, browY: 0, browTilt: 0, browOpacity: 0.5, browAsym: 0, pupil: 1, mouth: 0.32, mouthW: 1, headTilt: 0,
  open: 0, round: 0.95, press: 0, mouthTilt: 0, jaw: 0, teeth: 0,
};

const LIDS: Record<FaceState, Lids> = {
  IDLE: NEUTRAL,
  LISTENING: { ...NEUTRAL, pupil: 1.15, mouth: 0.2, open: 0.05, round: 1 },
  THINKING: { ...NEUTRAL, top: 0.18, pupil: 0.85, mouth: 0.05, mouthW: 0.85, browOpacity: 0.5, browY: -0.5, mouthTilt: 7 },
  SPEAKING: { ...NEUTRAL, mouth: 0.42 },
  // sonrisa amplia con un interior fino (profundidad)
  HAPPY: { ...NEUTRAL, bottom: 0.42, mouth: 1, mouthW: 1.25, pupil: 1.1, open: 0.16, round: 1.2 },
  WINK: { ...NEUTRAL, bottom: 0.3, mouth: 0.8, mouthW: 1.15, mouthTilt: 6 },
  CONCERNED: { ...NEUTRAL, top: 0.2, browOpacity: 0.9, browY: -0.6, browTilt: -14, mouth: -0.6, mouthW: 0.7, open: 0.08, round: 0.6 },
  // labio apretado: barra plana, sin arco
  ANGRY: { ...NEUTRAL, top: 0.42, tilt: 22, browOpacity: 1, browY: 0.6, browTilt: 22, mouth: -0.4, mouthW: 0.8, pupil: 0.7, press: 1 },
  SLEEPING: { ...NEUTRAL, top: 0.94, mouth: 0.1, mouthW: 0.5, pupil: 0.6, open: 0.07, round: 0.55 },
  // «o» de susto
  STARTLE: { ...NEUTRAL, pupil: 0.55, mouth: -0.2, mouthW: 0.5, browOpacity: 0.8, browY: -1, open: 0.62, round: 0.6, jaw: 0.45 },
  CONFUSED: { ...NEUTRAL, top: 0.12, browOpacity: 0.8, browY: -0.4, browTilt: 10, mouth: -0.1, mouthW: 0.6, headTilt: 5, mouthTilt: -8 },
  MUSIC: { ...NEUTRAL, bottom: 0.35, mouth: 0.9, mouthW: 0.8, round: 0.8 },
  SCAN: { ...NEUTRAL, top: 0.26, pupil: 0.8, mouth: 0.1, press: 0.35 },
  YAWNING: { ...NEUTRAL, top: 0.7, mouth: -0.9, mouthW: 0.6, open: 1, round: 0.75, jaw: 1 },
  // --- 4.0 ---
  // risa abierta con interior oscuro y dientes
  LAUGH: { ...NEUTRAL, bottom: 0.55, mouth: 1, mouthW: 1.2, pupil: 1.05, open: 0.8, round: 1.15, jaw: 0.6, teeth: 1 },
  // «o» de sorpresa
  SURPRISED: { ...NEUTRAL, pupil: 0.6, mouth: -0.35, mouthW: 0.5, browOpacity: 0.95, browY: -1, open: 0.72, round: 0.62, jaw: 0.5 },
  // mueca de tristeza: arco caído, ladeado
  SAD: { ...NEUTRAL, top: 0.38, browOpacity: 0.9, browY: -0.35, browTilt: -22, mouth: -0.75, mouthW: 0.7, pupil: 0.9, mouthTilt: -6 },
  TIRED: { ...NEUTRAL, top: 0.62, browOpacity: 0.4, browY: 0.3, mouth: -0.1, mouthW: 0.6, pupil: 0.8, open: 0.14, round: 0.6 },
  SING: { ...NEUTRAL, bottom: 0.3, mouth: 0.9, mouthW: 0.85, headTilt: -3, round: 0.8 },
  CURIOUS: { ...NEUTRAL, top: 0.05, pupil: 1.1, mouth: 0.35, mouthW: 0.8, browOpacity: 0.85, browY: -0.2, browAsym: 1, headTilt: -7, open: 0.12, round: 0.7, mouthTilt: 4 },
  PROUD: { ...NEUTRAL, top: 0.12, bottom: 0.25, mouth: 0.85, mouthW: 1.1, browOpacity: 0.6, browY: -0.3, pupil: 0.95 },
  // ojos cerrados con suavidad (no es sueño), cejas relajadas, boca pequeña serena
  PRAY: { ...NEUTRAL, top: 0.97, browOpacity: 0.3, browY: -0.05, mouth: 0.35, mouthW: 0.55, pupil: 0.9, headTilt: 0, round: 0.7 },
};

/** Estados en los que la boca sigue el audio (visemas). */
const MOUTH_LOOP: ReadonlySet<FaceState> = new Set(['SPEAKING', 'MUSIC', 'SING', 'LAUGH', 'PRAY']);
/** Párpados lentos al entrar/salir de estos estados (los ojos se abren despacio al terminar de orar). */
const SLOW_LIDS: ReadonlySet<FaceState> = new Set(['PRAY', 'SLEEPING']);

function useAnim(v: number) {
  return useRef(new Animated.Value(v)).current;
}

const clamp = (v: number, a = -1, b = 1) => Math.max(a, Math.min(b, v));

/** Visema a partir del nivel de voz: cerrada / media ancha / abierta redonda. */
function visema(level01: number): { open: number; round: number } {
  const l = clamp(level01, 0, 1);
  if (l < 0.12) return { open: 0, round: 0.95 };
  if (l < 0.55) return { open: l * 1.05, round: 1.02 };
  return { open: l, round: 0.72 + (1 - l) * 0.25 };
}

export function UltronFace({
  face,
  mode = 'GUARDIAN',
  acento,
  gazeX = 0,
  gazeY = 0,
  level = 0,
  speechLevel = 0,
  speechLevelSource,
  attention = 0,
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
  const accent = face === 'ANGRY' || firing ? RED : saberOn ? SABER : mode === 'GOLD' ? GOLD : acento || CYAN;
  /*
   * Con el cian se usa la constante de siempre, no la derivada. La calculada da #B8F8FF y la de
   * ULTRON es #D6F8FF: la diferencia es mínima y aun así es un cambio en una cara que ya está
   * aprobada y en manos de la junta. El cálculo entra solo donde no había nada.
   */
  const irisClaro = useMemo(() => (accent === CYAN ? IRIS_CLARO : aclarar(accent, 0.72)), [accent]);
  const dim = face === 'SLEEPING';
  const lids = LIDS[face] || NEUTRAL;
  const lidsRef = useRef(lids);
  lidsRef.current = lids;
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
  const mouthOpenBase = useAnim(lids.open);
  const mouthOpen = useAnim(0); // visemas
  const mouthRound = useAnim(lids.round);
  const press = useAnim(lids.press);
  const mouthTilt = useAnim(lids.mouthTilt);
  const jaw = useAnim(lids.jaw);
  const jawSpeech = useAnim(0);
  const teeth = useAnim(lids.teeth);
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
  const attn = useAnim(0);
  // --- reacciones táctiles (locales, sin setState)
  const tx = useAnim(0);
  const ty = useAnim(0);
  const touchOpen = useAnim(0);
  const touchSmile = useAnim(0);
  const touchBrow = useAnim(0);
  const tapSquash = useAnim(1);
  const eyeSquashL = useAnim(1);
  const eyeSquashR = useAnim(1);
  const eyeStretchL = useAnim(1);
  const eyeStretchR = useAnim(1);
  const ripples = useRef(
    [0, 1].map(() => ({ x: new Animated.Value(0), y: new Animated.Value(0), s: new Animated.Value(0), o: new Animated.Value(0) }))
  ).current;
  const rippleIdx = useRef(0);

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
    const loop = MOUTH_LOOP.has(face);
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
      // la boca en reposo del estado (al hablar, los visemas van sobre esta base)
      Animated.timing(mouthOpenBase, { toValue: loop ? Math.min(lids.open, 0.35) : lids.open, duration: face === 'SURPRISED' || face === 'STARTLE' ? 90 : 220, easing: ease, useNativeDriver: true }),
      Animated.timing(press, { toValue: lids.press, duration: dur, useNativeDriver: true }),
      Animated.timing(mouthTilt, { toValue: lids.mouthTilt, duration: dur, easing: ease, useNativeDriver: true }),
      Animated.timing(jaw, { toValue: lids.jaw, duration: 220, easing: ease, useNativeDriver: true }),
      Animated.timing(teeth, { toValue: lids.teeth, duration: 200, useNativeDriver: true }),
      ...(loop ? [] : [Animated.timing(mouthRound, { toValue: lids.round, duration: dur, easing: ease, useNativeDriver: true })]),
    ]).start();

    const running: Animated.CompositeAnimation[] = [];
    const run = (a: Animated.CompositeAnimation) => {
      running.push(a);
      a.start();
    };

    if (!loop) {
      Animated.timing(mouthOpen, { toValue: 0, duration: 160, useNativeDriver: true }).start();
      Animated.timing(jawSpeech, { toValue: 0, duration: 160, useNativeDriver: true }).start();
    }

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
  }, [face, lids, topLid, bottomLid, tilt, browY, browTilt, browOp, browAsym, headTilt, pupilScale, mouthCurve, mouthW, mouthOpenBase, mouthOpen, mouthRound, press, mouthTilt, jaw, jawSpeech, teeth, shake, thinkDots, bounce, squash, sway]);

  // mirada (cámara / errante / pensando); el dedo se suma aparte (tx, ty)
  useEffect(() => {
    const think = face === 'THINKING';
    const sad = face === 'SAD';
    const gx = (think ? 0.55 : clamp(gazeX)) * D * 0.18;
    const gy = (think ? -0.6 : sad ? 0.75 : clamp(gazeY)) * D * 0.14;
    Animated.spring(px, { toValue: gx, friction: 7, tension: 50, useNativeDriver: true }).start();
    Animated.spring(py, { toValue: gy, friction: 7, tension: 50, useNativeDriver: true }).start();
  }, [gazeX, gazeY, face, D, px, py]);

  // atención: alguien delante mirando → halo y pupilas un poco más vivos
  useEffect(() => {
    Animated.timing(attn, { toValue: clamp(attention, 0, 1), duration: 650, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [attention, attn]);

  // pulso por nivel de mic al escuchar
  useEffect(() => {
    Animated.timing(pulse, { toValue: face === 'LISTENING' ? level : 0, duration: 90, useNativeDriver: true }).start();
  }, [level, face, pulse]);

  // Lip-sync: visemas por nivel (tts.ts lo emite a 20 Hz sincronizado a positionMillis). Todo va por
  // Animated: con `speechLevelSource` no hay setState ni re-render por muestra.
  const lastLevelAt = useRef(0);
  const lastOpen = useRef(0);
  const faceRef = useRef<FaceState>(face);
  faceRef.current = face;
  const aplicarVisema = useCallback(
    (nivel: number) => {
      const f = faceRef.current;
      lastLevelAt.current = Date.now();
      const gain = f === 'PRAY' ? 0.7 : f === 'LAUGH' ? 1.1 : f === 'SING' || f === 'MUSIC' ? 1.15 : 1;
      const v = visema(nivel * gain);
      const rising = v.open > lastOpen.current;
      lastOpen.current = v.open;
      const dur = rising ? 35 : 90;
      // al cantar/orar la boca es más redonda; en risa más ancha
      const round = f === 'LAUGH' ? Math.max(v.round, 1.1) : f === 'SING' || f === 'MUSIC' || f === 'PRAY' ? Math.min(v.round, 0.85) : v.round;
      Animated.parallel([
        Animated.timing(mouthOpen, { toValue: v.open, duration: dur, useNativeDriver: true }),
        Animated.timing(mouthRound, { toValue: round, duration: Math.max(dur, 60), useNativeDriver: true }),
        Animated.timing(jawSpeech, { toValue: v.open * 0.85, duration: dur + 15, useNativeDriver: true }),
      ]).start();
    },
    [mouthOpen, mouthRound, jawSpeech]
  );
  // vía prop (LoginScreen / usos simples): un render por muestra
  useEffect(() => {
    if (!MOUTH_LOOP.has(face)) return;
    aplicarVisema(speechLevel);
  }, [speechLevel, face, aplicarVisema]);
  // vía suscripción (DeskScreen): cero renders
  useEffect(() => {
    if (!speechLevelSource) return;
    const off = speechLevelSource((v) => {
      if (MOUTH_LOOP.has(faceRef.current)) aplicarVisema(v);
    });
    return () => {
      off?.();
    };
  }, [speechLevelSource, aplicarVisema]);

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
            Animated.parallel([
              Animated.timing(mouthOpen, { toValue: 0.9, duration: fast ? 90 : 130, useNativeDriver: true }),
              Animated.timing(jawSpeech, { toValue: 0.7, duration: fast ? 90 : 130, useNativeDriver: true }),
            ]),
            Animated.parallel([
              Animated.timing(mouthOpen, { toValue: 0.2, duration: fast ? 90 : 150, useNativeDriver: true }),
              Animated.timing(jawSpeech, { toValue: 0.15, duration: fast ? 90 : 150, useNativeDriver: true }),
            ]),
            Animated.timing(mouthOpen, { toValue: 0.65, duration: 110, useNativeDriver: true }),
            Animated.parallel([
              Animated.timing(mouthOpen, { toValue: 0.1, duration: fast ? 100 : 170, useNativeDriver: true }),
              Animated.timing(jawSpeech, { toValue: 0.05, duration: fast ? 100 : 170, useNativeDriver: true }),
            ]),
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
  }, [face, mouthOpen, jawSpeech]);

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

  /** Onda fina en el punto tocado (dos ranuras alternas para toques seguidos). */
  const ripple = (x: number, y: number) => {
    const r = ripples[rippleIdx.current];
    rippleIdx.current = (rippleIdx.current + 1) % ripples.length;
    const R = geo.current.D * 0.25;
    r.x.setValue(x - R);
    r.y.setValue(y - R);
    r.s.setValue(0.25);
    r.o.setValue(0.7);
    Animated.parallel([
      Animated.timing(r.s, { toValue: 1, duration: 460, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(r.o, { toValue: 0, duration: 460, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();
  };

  /** Reacción inmediata al contacto (antes de que el padre decida nada). */
  const reaccionToque = (zone: TouchZone, x: number, y: number) => {
    const d = geo.current.D;
    const { gx, gy } = gazeFromPoint(x, y);
    // pupilas saltan al punto de contacto
    tx.stopAnimation();
    ty.stopAnimation();
    tx.setValue(gx * d * 0.18);
    ty.setValue(gy * d * 0.14);
    ripple(x, y);
    Animated.sequence([
      Animated.timing(tapSquash, { toValue: 0.965, duration: 45, useNativeDriver: true }),
      Animated.spring(tapSquash, { toValue: 1, friction: 4, tension: 140, useNativeDriver: true }),
    ]).start();
    const hold = (v: Animated.Value, to: number, holdMs: number, back = 0, upMs = 60, downMs = 320) =>
      Animated.sequence([
        Animated.timing(v, { toValue: to, duration: upMs, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.delay(holdMs),
        Animated.timing(v, { toValue: back, duration: downMs, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]).start();
    switch (zone) {
      case 'eyeL':
      case 'eyeR': {
        const sq = zone === 'eyeL' ? eyeSquashL : eyeSquashR;
        const st = zone === 'eyeL' ? eyeStretchL : eyeStretchR;
        Animated.sequence([
          Animated.parallel([
            Animated.timing(sq, { toValue: 0.42, duration: 45, useNativeDriver: true }),
            Animated.timing(st, { toValue: 1.12, duration: 45, useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.spring(sq, { toValue: 1, friction: 4, tension: 150, useNativeDriver: true }),
            Animated.spring(st, { toValue: 1, friction: 4, tension: 150, useNativeDriver: true }),
          ]),
        ]).start();
        break;
      }
      case 'chin':
        // «oh» redondo
        hold(touchOpen, 0.75, 260, 0, 50, 240);
        Animated.sequence([
          Animated.timing(mouthRound, { toValue: 0.62, duration: 50, useNativeDriver: true }),
          Animated.delay(260),
          Animated.timing(mouthRound, { toValue: lidsRef.current.round, duration: 240, useNativeDriver: true }),
        ]).start();
        break;
      case 'mouth':
        hold(touchOpen, 0.4, 180, 0, 45, 220);
        hold(touchSmile, 0.5, 400, 0, 60, 380);
        break;
      case 'cheek':
        hold(touchSmile, 0.75, 520, 0, 60, 420);
        break;
      case 'forehead':
        hold(touchBrow, 1, 520, 0, 55, 300);
        break;
      default:
        break;
    }
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
        release: null as ReturnType<typeof setTimeout> | null,
      };
      const local = (pageX: number, pageY: number) => ({ x: pageX - origin.current.x, y: pageY - origin.current.y });
      const clear = () => {
        if (s.timer) clearTimeout(s.timer);
        s.timer = null;
      };
      /** Al soltar, las pupilas vuelven al centro con un poco de retardo elástico. */
      const soltarMirada = (delay: number) => {
        if (s.release) clearTimeout(s.release);
        s.release = setTimeout(() => {
          s.release = null;
          Animated.spring(tx, { toValue: 0, friction: 6, tension: 40, useNativeDriver: true }).start();
          Animated.spring(ty, { toValue: 0, friction: 6, tension: 40, useNativeDriver: true }).start();
        }, delay);
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
          if (s.release) clearTimeout(s.release);
          s.release = null;
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
          reaccionToque(s.zone, x, y);
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
          // los ojos siguen el dedo con retardo elástico
          const d = geo.current.D;
          Animated.spring(tx, { toValue: gx * d * 0.18, friction: 5, tension: 38, useNativeDriver: true }).start();
          Animated.spring(ty, { toValue: gy * d * 0.14, friction: 5, tension: 38, useNativeDriver: true }).start();
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
            soltarMirada(650);
            cbs.current.onDragEnd?.();
            if (Math.abs(g.dx) > 140 && Math.abs(g.dy) < 80 && dt < 420) cbs.current.onSwipe?.(g.dx < 0 ? 'left' : 'right');
            return;
          }
          soltarMirada(1300);
          if (s.longFired) return;
          const { stageW: w, stageH: h } = geo.current;
          cbs.current.onTap?.(s.zone, clamp((s.x0 / w) * 2 - 1), clamp((s.y0 / h) * 2 - 1));
        },
        onPanResponderTerminate: () => {
          clear();
          soltarMirada(400);
          if (s.dragged) cbs.current.onDragEnd?.();
        },
      });
    })()
  ).current;

  // ---------------------------------------------------------------- interpolaciones
  // Todos los nodos derivados (interpolate/add/multiply) se crean UNA vez por tamaño: los Animated.Value
  // son refs estables y así un re-render (emoción, mirada, atención…) no recrea ~45 nodos nativos.
  const A = useMemo(() => {
    const lidH = D * 1.1;
    const topLidY = topLid.interpolate({ inputRange: [0, 1], outputRange: [-lidH, -lidH + D * 1.02] });
    /**
     * El párpado inferior es un CÍRCULO grande que sube desde abajo, no una barra: su borde superior
     * es convexo, que es lo que hace el «ojo sonriente». Con una barra recta el ojo quedaba cortado
     * por la mitad con una línea dura, y HAPPY parecía un error de dibujo.
     */
    const lidRadio = D * 1.1;
    const bottomLidY = bottomLid.interpolate({ inputRange: [0, 1], outputRange: [D, D * 0.08] });
    const tiltL = tilt.interpolate({ inputRange: [-45, 45], outputRange: ['-45deg', '45deg'] });
    const tiltR = tilt.interpolate({ inputRange: [-45, 45], outputRange: ['45deg', '-45deg'] });
    const browTiltL = browTilt.interpolate({ inputRange: [-45, 45], outputRange: ['-45deg', '45deg'] });
    const browTiltR = browTilt.interpolate({ inputRange: [-45, 45], outputRange: ['45deg', '-45deg'] });
    const browTy = browY.interpolate({ inputRange: [-1, 1], outputRange: [-D * 0.12, D * 0.14] });
    const browTouchTy = touchBrow.interpolate({ inputRange: [0, 1], outputRange: [0, -D * 0.11] });
    const browOpacity = Animated.add(browOp, touchBrow.interpolate({ inputRange: [0, 1], outputRange: [0, 0.9] })).interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' });
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
    const attnHaloOp = attn.interpolate({ inputRange: [0, 1], outputRange: [0, 0.34] });
    const attnPupil = attn.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] });
    const pupilTx = Animated.add(px, tx);
    const pupilTy = Animated.add(py, ty);
    const pupilScaleTotal = Animated.multiply(pupilScale, attnPupil);

    // --- boca
    // La boca de la web mide ~0,7 del ojo y está a ~0,68 D por debajo; la del móvil era la mitad de
    // ancha y estaba más lejos, y por eso no se leía como cara.
    const mouthWpx = D * 0.95;
    const mouthArcH = D * 0.34;
    const openW = mouthWpx * 0.62;
    const openH = mouthArcH * 0.92;
    const mouthCurveTotal = Animated.add(mouthCurve, touchSmile).interpolate({ inputRange: [-1, 0, 1], outputRange: [-1, 0.08, 1], extrapolate: 'clamp' });
    const openTotal = Animated.add(Animated.add(mouthOpenBase, mouthOpen), touchOpen);
    const mouthOpenScale = openTotal.interpolate({ inputRange: [0, 1], outputRange: [0.03, 1], extrapolate: 'clamp' });
    const mouthRoundScale = mouthRound.interpolate({ inputRange: [0.5, 1.2], outputRange: [0.5, 1.2], extrapolate: 'clamp' });
    // el arco se atenúa cuando la boca se abre mucho (el interior manda) y desaparece con el labio apretado
    const arcOpByOpen = openTotal.interpolate({ inputRange: [0, 0.35, 0.8], outputRange: [1, 0.55, 0.12], extrapolate: 'clamp' });
    const arcOpByPress = press.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
    const mouthRot = mouthTilt.interpolate({ inputRange: [-45, 45], outputRange: ['-45deg', '45deg'] });
    const jawTy = Animated.add(jaw, jawSpeech).interpolate({ inputRange: [0, 1], outputRange: [0, D * 0.075], extrapolate: 'clamp' });
    const teethOp = Animated.multiply(teeth, openTotal.interpolate({ inputRange: [0, 0.25, 0.6], outputRange: [0, 0.2, 1], extrapolate: 'clamp' }));
    const pressBarScaleX = press.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] });

    const beamH = stageH * 0.95;
    const beamScale = beam.interpolate({ inputRange: [0, 1], outputRange: [0.01, 1] });
    const beamTy = beam.interpolate({ inputRange: [0, 1], outputRange: [-beamH / 2, 0] });
    const saberH = stageH * 0.85;
    const saberScale = saber.interpolate({ inputRange: [0, 1], outputRange: [0.02, 1] });
    const saberRotL = saber.interpolate({ inputRange: [0, 1], outputRange: ['-8deg', '-28deg'] });
    const saberRotR = saber.interpolate({ inputRange: [0, 1], outputRange: ['8deg', '28deg'] });

    // compuestos que antes se creaban en el JSX / por ojo en cada render
    const rowTx = Animated.add(shakeX, swayX);
    const glyphTyNeg = Animated.multiply(glyphTy, -1);
    const eyeGlowOp = attn.interpolate({ inputRange: [0, 1], outputRange: [0, 0.09] });
    const lineaParpado = topLid.interpolate({ inputRange: [0, 0.82, 0.96], outputRange: [0, 0, 0.85], extrapolate: 'clamp' });
    const eyeScaleYL = Animated.multiply(blink, eyeSquashL);
    const eyeScaleYR = Animated.multiply(blink, eyeSquashR);
    return { lidH, topLidY, bottomLidY, tiltL, tiltR, browTiltL, browTiltR, browTy, browTouchTy, browOpacity, browAsymL, browAsymR, headRot, shakeX, bounceTy, swayX, swayRot, glyphTy, pulseScale, pulseOp, attnHaloOp, attnPupil, pupilTx, pupilTy, pupilScaleTotal, mouthWpx, mouthArcH, openW, openH, mouthCurveTotal, openTotal, mouthOpenScale, mouthRoundScale, arcOpByOpen, arcOpByPress, mouthRot, jawTy, teethOp, pressBarScaleX, beamH, beamScale, beamTy, saberH, saberScale, saberRotL, saberRotR, rowTx, glyphTyNeg, eyeGlowOp, eyeScaleYL, eyeScaleYR, lidRadio, lineaParpado };
  }, [D, stageH]);
  const { lidH, topLidY, bottomLidY, tiltL, tiltR, browTiltL, browTiltR, browTy, browTouchTy, browOpacity, browAsymL, browAsymR, headRot, shakeX, bounceTy, swayX, swayRot, glyphTy, pulseScale, pulseOp, attnHaloOp, attnPupil, pupilTx, pupilTy, pupilScaleTotal, mouthWpx, mouthArcH, openW, openH, mouthCurveTotal, openTotal, mouthOpenScale, mouthRoundScale, arcOpByOpen, arcOpByPress, mouthRot, jawTy, teethOp, pressBarScaleX, beamH, beamScale, beamTy, saberH, saberScale, saberRotL, saberRotR, rowTx, glyphTyNeg, eyeGlowOp, eyeScaleYL, eyeScaleYR, lidRadio, lineaParpado } = A;

  const glyphStyle = useMemo(() => ({ color: accent, opacity: dim ? 0.12 : 0.3, fontSize: D * 0.15 }), [accent, dim, D]);
  const mouthDim = dim ? 0.3 : face === 'PRAY' ? 0.6 : 1;

  const renderEye = (side: 'L' | 'R') => {
    const wink = face === 'WINK' && side === winkSide;
    const stretchEye = side === 'L' ? eyeStretchL : eyeStretchR;
    const scaleY = wink ? 0.06 : side === 'L' ? eyeScaleYL : eyeScaleYR;
    return (
      <Animated.View key={side} style={[styles.eyeWrap, { width: D, height: D, transform: [{ scaleY }, { scaleX: stretchEye }] }]}>
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
        {/* halo de atención (alguien mirando) */}
        <Animated.View pointerEvents="none" style={[styles.attnHalo, { width: D * 1.3, height: D * 1.3, borderRadius: D * 0.65, borderColor: accent, opacity: attnHaloOp }]} />
        <View style={[styles.glow, { width: D * 1.06, height: D * 1.06, borderRadius: D * 0.53, borderColor: accent, opacity: dim ? 0.08 : 0.28 }]} />
        <View style={[styles.eye, { width: D, height: D, borderRadius: D / 2, overflow: 'hidden' }]}>
          {/* iris lleno: el ojo es un disco de luz, no un anillo hueco */}
          <View style={[styles.iris, { width: D, height: D, borderRadius: D / 2, backgroundColor: accent, opacity: dim ? 0.18 : 0.9 }]} />
          <View style={[styles.ring, { width: D, height: D, borderRadius: D / 2, borderWidth: Math.max(2, ring * 0.32), borderColor: IRIS_BORDE, opacity: dim ? 0.3 : 0.5 }]} />
          {/* respiración de luz al hablar/escuchar */}
          <Animated.View pointerEvents="none" style={[styles.innerGlow, { width: D * 0.9, height: D * 0.9, borderRadius: D * 0.45, backgroundColor: irisClaro, opacity: eyeGlowOp }]} />
          {/* lo que se mueve con la mirada: núcleo claro, anillo interior y los dos destellos */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.mirada,
              { width: D, height: D, transform: [{ translateX: pupilTx }, { translateY: pupilTy }, { scale: pupilScaleTotal }] },
            ]}
          >
            <View style={[styles.innerGlow, { width: D * 0.62, height: D * 0.62, borderRadius: D * 0.31, backgroundColor: irisClaro, opacity: dim ? 0.05 : 0.42 }]} />
            <View style={[styles.innerGlow, { width: D * 0.34, height: D * 0.34, borderRadius: D * 0.17, backgroundColor: irisClaro, opacity: dim ? 0.05 : 0.5 }]} />
            <View style={[styles.ring, { width: D * 0.56, height: D * 0.56, borderRadius: D * 0.28, borderWidth: Math.max(2, D * 0.014), borderColor: IRIS_BORDE, opacity: dim ? 0.15 : 0.4 }]} />
            <View style={[styles.glint, { width: D * 0.2, height: D * 0.2, borderRadius: D * 0.1, left: D * 0.2, top: D * 0.2, opacity: dim ? 0.2 : 0.95 }]} />
            <View style={[styles.glint, { width: D * 0.085, height: D * 0.085, borderRadius: D * 0.043, left: D * 0.58, top: D * 0.56, opacity: dim ? 0.15 : 0.8 }]} />
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
            <Animated.View style={[styles.lid, { width: lidRadio * 2, height: lidRadio * 2, left: D / 2 - lidRadio, borderRadius: lidRadio, transform: [{ translateY: bottomLidY }] }]} />
          {/*
            Ojo cerrado (oración, sueño): sin esto el párpado negro dejaba un agujero y parecía
            apagado, no dormido. Se dibuja la línea del párpado cuando el ojo ya está casi cerrado.
          */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.parpadoLinea,
              {
                width: D * 0.94,
                height: D * 0.4,
                borderBottomWidth: Math.max(8, D * 0.06),
                borderColor: accent,
                borderBottomLeftRadius: D * 0.47,
                borderBottomRightRadius: D * 0.47,
                opacity: Animated.multiply(lineaParpado, 0.16),
              },
            ]}
          />
          <Animated.View
            pointerEvents="none"
            style={[
              styles.parpadoLinea,
              {
                width: D * 0.86,
                height: D * 0.34,
                borderBottomWidth: Math.max(3, D * 0.022),
                borderColor: accent,
                borderBottomLeftRadius: D * 0.43,
                borderBottomRightRadius: D * 0.43,
                opacity: lineaParpado,
              },
            ]}
          />
        </View>
        {/* ceja */}
        <Animated.View
          style={[
            styles.brow,
            {
              width: D * 0.78,
              height: Math.max(5, ring * 0.62),
              borderRadius: ring,
              backgroundColor: accent,
              top: -D * 0.115,
              opacity: browOpacity,
              transform: [{ translateY: browTy }, { translateY: browTouchTy }, { translateY: side === 'L' ? browAsymL : browAsymR }, { rotate: side === 'L' ? browTiltL : browTiltR }],
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
      {/*
        Contorno de la cara: dos óvalos tenuísimos detrás de todo. Sin ellos los ojos y la boca flotan
        sueltos en el negro y no se leen como una cara (es lo que hace la versión de la web).
        RN no dibuja elipses, así que son círculos aplastados con scaleY.
      */}
      {!compact && (
        <>
          <View pointerEvents="none" style={[styles.contorno, { width: D * 3.5, height: D * 3.5, borderRadius: D * 1.75, borderColor: accent, opacity: dim ? 0.05 : 0.14, transform: [{ scaleY: 0.66 }] }]} />
          <View pointerEvents="none" style={[styles.contorno, { width: D * 4.3, height: D * 4.3, borderRadius: D * 2.15, borderColor: accent, opacity: dim ? 0.03 : 0.08, transform: [{ scaleY: 0.6 }] }]} />
        </>
      )}
      <Animated.View style={[styles.column, { transform: [{ scaleY: tapSquash }] }]}>
        <Animated.View
          style={[
            styles.faceRow,
            { gap, transform: [{ scale: breath }, { translateX: rowTx }, { translateY: bounceTy }, { scaleY: squash }, { rotate: headRot }, { rotate: swayRot }] },
          ]}
        >
          {!compact && <Animated.Text style={[styles.glyph, glyphStyle, { transform: [{ translateY: glyphTy }] }]}>{gL}</Animated.Text>}
          {renderEye('L')}
          {renderEye('R')}
          {!compact && <Animated.Text style={[styles.glyph, glyphStyle, { transform: [{ translateY: glyphTyNeg }] }]}>{gR}</Animated.Text>}
        </Animated.View>

        {/* boca: arco + interior oscuro (visemas / «o» / risa) + labio apretado + dientes */}
        <Animated.View
          style={[
            styles.mouthWrap,
            { height: mouthArcH * 1.5, marginTop: D * 0.06, opacity: mouthDim, transform: [{ translateY: bounceTy }, { translateX: swayX }, { translateY: jawTy }, { rotate: mouthRot }] },
          ]}
        >
          <Animated.View style={[styles.mouthLayer, { opacity: arcOpByPress }]}>
            <Animated.View
              style={[
                styles.mouthArc,
                {
                  width: mouthWpx,
                  height: mouthArcH,
                  borderBottomWidth: Math.max(5, ring * 1.05),
                  borderColor: accent,
                  borderBottomLeftRadius: mouthWpx / 2,
                  borderBottomRightRadius: mouthWpx / 2,
                  opacity: arcOpByOpen,
                  transform: [{ scaleX: mouthW }, { scaleY: mouthCurveTotal }],
                },
              ]}
            />
          </Animated.View>
          {/* labio apretado (molestia / concentración) */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.pressBar,
              {
                width: mouthWpx * 0.55,
                height: Math.max(4, ring * 0.7),
                borderRadius: ring,
                backgroundColor: accent,
                opacity: press,
                transform: [{ scaleX: pressBarScaleX }],
              },
            ]}
          />
          {/* interior oscuro con borde: apertura (scaleY) y redondez (scaleX) */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.mouthOpen,
              {
                width: openW,
                height: openH,
                borderRadius: openW * 0.5,
                borderWidth: Math.max(3, ring * 0.5),
                borderColor: accent,
                backgroundColor: MOUTH_DARK,
                transform: [{ scaleX: mouthRoundScale }, { scaleY: mouthOpenScale }],
              },
            ]}
          >
            <Animated.View style={[styles.teeth, { height: openH * 0.24, backgroundColor: TEETH, opacity: teethOp }]} />
            <View style={[styles.tongue, { width: openW * 0.5, height: openH * 0.34, borderRadius: openW * 0.25, backgroundColor: accent }]} />
          </Animated.View>
          {face === 'THINKING' && (
            <Animated.View style={[styles.dots, { opacity: thinkDots }]}>
              {[0, 1, 2].map((i) => (
                <View key={i} style={[styles.dot, { backgroundColor: accent, opacity: 0.4 + i * 0.3 }]} />
              ))}
            </Animated.View>
          )}
        </Animated.View>
      </Animated.View>

      {/* ondas de toque */}
      {!compact &&
        ripples.map((r, i) => (
          <Animated.View
            key={i}
            pointerEvents="none"
            style={[
              styles.ripple,
              {
                width: D * 0.5,
                height: D * 0.5,
                borderRadius: D * 0.25,
                borderColor: accent,
                opacity: r.o,
                transform: [{ translateX: r.x }, { translateY: r.y }, { scale: r.s }],
              },
            ]}
          />
        ))}

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
  contorno: { position: 'absolute', borderWidth: 1 },
  column: { alignItems: 'center', justifyContent: 'center' },
  faceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  eyeWrap: { alignItems: 'center', justifyContent: 'center' },
  pulseRing: { position: 'absolute', borderWidth: 2 },
  attnHalo: { position: 'absolute', borderWidth: 10 },
  glow: { position: 'absolute', borderWidth: 6 },
  eye: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  iris: { position: 'absolute' },
  mirada: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute' },
  innerGlow: { position: 'absolute' },
  glint: { position: 'absolute', backgroundColor: '#FFFFFF' },
  lid: { position: 'absolute', top: 0, backgroundColor: '#000' },
  parpadoLinea: { position: 'absolute', borderColor: 'transparent', borderWidth: 0 },
  brow: { position: 'absolute' },
  beam: { position: 'absolute', borderRadius: 2 },
  glyph: { marginHorizontal: -6, textAlign: 'center', includeFontPadding: false },
  mouthWrap: { alignItems: 'center', justifyContent: 'center' },
  mouthLayer: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  mouthArc: { position: 'absolute' },
  pressBar: { position: 'absolute' },
  mouthOpen: { position: 'absolute', overflow: 'hidden', alignItems: 'center', justifyContent: 'space-between' },
  teeth: { width: '86%', borderBottomLeftRadius: 6, borderBottomRightRadius: 6, marginTop: 2 },
  tongue: { opacity: 0.22, marginBottom: -2 },
  dots: { flexDirection: 'row', gap: 8, position: 'absolute' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  ripple: { position: 'absolute', left: 0, top: 0, borderWidth: 1.5 },
  zzz: { position: 'absolute', top: 0, fontSize: 22, letterSpacing: 4, opacity: 0.6 },
  irrBar: { position: 'absolute', bottom: 4, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  irrFill: { height: '100%', borderRadius: 2 },
  flash: { ...StyleSheet.absoluteFillObject },
});
