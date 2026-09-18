/**
 * Cara ULTRON — estilo LOOI / DeskBot: dos anillos luminosos sobre negro,
 * párpados para emociones, cejas, boca en arco y glifos por modo.
 * Solo RN Animated (native driver) — sin Skia/Reanimated (EAS-safe).
 */
import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { FaceState, Mode } from '../config';

type Props = {
  face: FaceState;
  mode?: Mode;
  gazeX?: number;
  gazeY?: number;
  /** 0..1 nivel de mic → pulso al escuchar */
  level?: number;
  /** disparo de broma */
  blaster?: boolean;
  /** 0..1 enojo acumulado por toques */
  irritation?: number;
  onTap?: (x01: number, y01: number) => void;
  onLongPress?: () => void;
};

const CYAN = '#00E5FF';
const GOLD = '#FFD166';
const RED = '#FF3B5C';

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
  browTilt: number; // grados
  browOpacity: number;
  pupil: number; // escala pupila
  mouth: number; // -1 triste .. 1 sonrisa
  mouthW: number; // escala ancho
};

const NEUTRAL: Lids = { top: 0, bottom: 0, tilt: 0, browY: 0, browTilt: 0, browOpacity: 0, pupil: 1, mouth: 0.15, mouthW: 1 };

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
  CONFUSED: { ...NEUTRAL, top: 0.12, browOpacity: 0.8, browY: -0.4, browTilt: 10, mouth: -0.1, mouthW: 0.6 },
  MUSIC: { ...NEUTRAL, bottom: 0.35, mouth: 0.9, mouthW: 0.8 },
  SCAN: { ...NEUTRAL, top: 0.26, pupil: 0.8, mouth: 0.1 },
  YAWNING: { ...NEUTRAL, top: 0.7, mouth: -0.9, mouthW: 0.6 },
};

function useAnim(v: number) {
  return useRef(new Animated.Value(v)).current;
}

export function UltronFace({
  face,
  mode = 'GUARDIAN',
  gazeX = 0,
  gazeY = 0,
  level = 0,
  blaster = false,
  irritation = 0,
  onTap,
  onLongPress,
}: Props) {
  const { width, height } = useWindowDimensions();
  const stageH = Math.min(height * 0.62, 420);
  const D = Math.min(stageH * 0.56, width * 0.2, 230); // diámetro ojo
  const ring = Math.max(5, D * 0.085);
  const gap = D * 0.62;
  const accent = face === 'ANGRY' || blaster ? RED : mode === 'GOLD' ? GOLD : CYAN;
  const dim = face === 'SLEEPING';
  const lids = LIDS[face] || NEUTRAL;
  const [gL, gR] = MODE_GLYPHS[mode] || MODE_GLYPHS.GUARDIAN;

  const breath = useAnim(1);
  const blink = useAnim(1);
  const topLid = useAnim(lids.top);
  const bottomLid = useAnim(lids.bottom);
  const tilt = useAnim(lids.tilt);
  const browY = useAnim(lids.browY);
  const browTilt = useAnim(lids.browTilt);
  const browOp = useAnim(lids.browOpacity);
  const pupilScale = useAnim(lids.pupil);
  const mouthCurve = useAnim(lids.mouth);
  const mouthW = useAnim(lids.mouthW);
  const mouthOpen = useAnim(0);
  const px = useAnim(0);
  const py = useAnim(0);
  const pulse = useAnim(0);
  const shake = useAnim(0);
  const glyphBob = useAnim(0);
  const beam = useAnim(0);
  const flash = useAnim(0);
  const thinkDots = useAnim(0);

  // respiración + glifos flotando
  useEffect(() => {
    const b = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1.02, duration: 2400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 1, duration: 2400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
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
  }, [breath, glyphBob]);

  // parpadeo natural
  useEffect(() => {
    let alive = true;
    let t: ReturnType<typeof setTimeout>;
    const doBlink = () => {
      if (!alive) return;
      if (face !== 'SLEEPING') {
        Animated.sequence([
          Animated.timing(blink, { toValue: 0.05, duration: 70, useNativeDriver: true }),
          Animated.timing(blink, { toValue: 1, duration: 130, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        ]).start();
      }
      t = setTimeout(doBlink, 2600 + Math.random() * 2600);
    };
    t = setTimeout(doBlink, 1200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [blink, face]);

  // transición de emoción
  useEffect(() => {
    const ease = Easing.out(Easing.cubic);
    const dur = 260;
    Animated.parallel([
      Animated.timing(topLid, { toValue: lids.top, duration: dur, easing: ease, useNativeDriver: true }),
      Animated.timing(bottomLid, { toValue: lids.bottom, duration: dur, easing: ease, useNativeDriver: true }),
      Animated.timing(tilt, { toValue: lids.tilt, duration: dur, easing: ease, useNativeDriver: true }),
      Animated.timing(browY, { toValue: lids.browY, duration: dur, easing: ease, useNativeDriver: true }),
      Animated.timing(browTilt, { toValue: lids.browTilt, duration: dur, easing: ease, useNativeDriver: true }),
      Animated.timing(browOp, { toValue: lids.browOpacity, duration: dur, useNativeDriver: true }),
      Animated.spring(pupilScale, { toValue: lids.pupil, friction: 6, useNativeDriver: true }),
      Animated.timing(mouthCurve, { toValue: lids.mouth, duration: dur, easing: ease, useNativeDriver: true }),
      Animated.timing(mouthW, { toValue: lids.mouthW, duration: dur, easing: ease, useNativeDriver: true }),
    ]).start();

    let loop: Animated.CompositeAnimation | null = null;
    if (face === 'SPEAKING' || face === 'MUSIC') {
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(mouthOpen, { toValue: 1, duration: 120 + Math.random() * 80, useNativeDriver: true }),
          Animated.timing(mouthOpen, { toValue: 0.25, duration: 140 + Math.random() * 90, useNativeDriver: true }),
          Animated.timing(mouthOpen, { toValue: 0.7, duration: 110, useNativeDriver: true }),
          Animated.timing(mouthOpen, { toValue: 0.1, duration: 160, useNativeDriver: true }),
        ])
      );
      loop.start();
    } else {
      Animated.timing(mouthOpen, { toValue: 0, duration: 160, useNativeDriver: true }).start();
    }
    let think: Animated.CompositeAnimation | null = null;
    if (face === 'THINKING') {
      think = Animated.loop(
        Animated.sequence([
          Animated.timing(thinkDots, { toValue: 1, duration: 900, useNativeDriver: true }),
          Animated.timing(thinkDots, { toValue: 0, duration: 900, useNativeDriver: true }),
        ])
      );
      think.start();
    }
    let sh: Animated.CompositeAnimation | null = null;
    if (face === 'ANGRY' || face === 'STARTLE') {
      sh = Animated.sequence([
        Animated.timing(shake, { toValue: 1, duration: 40, useNativeDriver: true }),
        Animated.timing(shake, { toValue: -1, duration: 60, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 0.6, duration: 50, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 0, duration: 70, useNativeDriver: true }),
      ]);
      sh.start();
    }
    return () => {
      loop?.stop();
      think?.stop();
      sh?.stop();
    };
  }, [face, lids, topLid, bottomLid, tilt, browY, browTilt, browOp, pupilScale, mouthCurve, mouthW, mouthOpen, shake, thinkDots]);

  // mirada
  useEffect(() => {
    const think = face === 'THINKING';
    const tx = (think ? 0.55 : Math.max(-1, Math.min(1, gazeX))) * D * 0.18;
    const ty = (think ? -0.6 : Math.max(-1, Math.min(1, gazeY))) * D * 0.14;
    Animated.spring(px, { toValue: tx, friction: 7, tension: 50, useNativeDriver: true }).start();
    Animated.spring(py, { toValue: ty, friction: 7, tension: 50, useNativeDriver: true }).start();
  }, [gazeX, gazeY, face, D, px, py]);

  // pulso por nivel de mic
  useEffect(() => {
    Animated.timing(pulse, { toValue: face === 'LISTENING' ? level : 0, duration: 90, useNativeDriver: true }).start();
  }, [level, face, pulse]);

  // blaster
  useEffect(() => {
    if (!blaster) {
      beam.setValue(0);
      flash.setValue(0);
      return;
    }
    const shot = Animated.sequence([
      Animated.parallel([
        Animated.timing(beam, { toValue: 1, duration: 110, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(flash, { toValue: 0.55, duration: 60, useNativeDriver: true }),
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
  }, [blaster, beam, flash]);

  const lidH = D * 1.1;
  const topLidY = topLid.interpolate({ inputRange: [0, 1], outputRange: [-lidH, -lidH + D * 1.02] });
  const bottomLidY = bottomLid.interpolate({ inputRange: [0, 1], outputRange: [lidH, lidH - D * 1.0] });
  const tiltL = tilt.interpolate({ inputRange: [-45, 45], outputRange: ['-45deg', '45deg'] });
  const tiltR = tilt.interpolate({ inputRange: [-45, 45], outputRange: ['45deg', '-45deg'] });
  const browTiltL = browTilt.interpolate({ inputRange: [-45, 45], outputRange: ['-45deg', '45deg'] });
  const browTiltR = browTilt.interpolate({ inputRange: [-45, 45], outputRange: ['45deg', '-45deg'] });
  const browTy = browY.interpolate({ inputRange: [-1, 1], outputRange: [-D * 0.12, D * 0.14] });
  const shakeX = shake.interpolate({ inputRange: [-1, 1], outputRange: [-8, 8] });
  const glyphTy = glyphBob.interpolate({ inputRange: [0, 1], outputRange: [0, -8] });
  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.22] });
  const pulseOp = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.12, 0.5] });

  const mouthWpx = D * 0.62;
  const mouthArcH = D * 0.26;
  const mouthScaleY = mouthCurve.interpolate({ inputRange: [-1, 0, 1], outputRange: [-1, 0.08, 1] });
  const mouthOpenScale = mouthOpen.interpolate({ inputRange: [0, 1], outputRange: [0.01, 1] });
  const beamH = stageH * 0.9;
  const beamScale = beam.interpolate({ inputRange: [0, 1], outputRange: [0.01, 1] });
  const beamTy = beam.interpolate({ inputRange: [0, 1], outputRange: [-beamH / 2, 0] });

  const glyphStyle = useMemo(
    () => ({ color: accent, opacity: dim ? 0.15 : 0.42, fontSize: D * 0.22 }),
    [accent, dim, D]
  );

  const renderEye = (side: 'L' | 'R') => {
    const wink = face === 'WINK' && side === 'L';
    const scaleY = wink ? 0.06 : blink;
    return (
      <Animated.View
        key={side}
        style={[
          styles.eyeWrap,
          { width: D, height: D, transform: [{ scaleY }] },
        ]}
      >
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
        <View
          style={[
            styles.glow,
            { width: D * 1.06, height: D * 1.06, borderRadius: D * 0.53, borderColor: accent, opacity: dim ? 0.08 : 0.28 },
          ]}
        />
        <View style={[styles.eye, { width: D, height: D, borderRadius: D / 2, overflow: 'hidden' }]}>
          <View
            style={[
              styles.ring,
              { width: D, height: D, borderRadius: D / 2, borderWidth: ring, borderColor: accent, opacity: dim ? 0.35 : 1 },
            ]}
          />
          <View
            style={[
              styles.innerGlow,
              { width: D * 0.78, height: D * 0.78, borderRadius: D * 0.39, backgroundColor: accent, opacity: dim ? 0.03 : 0.08 },
            ]}
          />
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
          <Animated.View
            style={[
              styles.lid,
              { width: D * 1.6, height: lidH, left: -D * 0.3, borderRadius: D * 0.6, transform: [{ translateY: bottomLidY }] },
            ]}
          />
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
              transform: [{ translateY: browTy }, { rotate: side === 'L' ? browTiltL : browTiltR }],
            },
          ]}
        />
        {/* haz blaster */}
        {blaster && (
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
      </Animated.View>
    );
  };

  return (
    <Pressable
      style={[styles.stage, { height: stageH }]}
      onPress={(e) => {
        const { locationX, locationY } = e.nativeEvent;
        onTap?.(Math.max(-1, Math.min(1, (locationX / width) * 2 - 1)), Math.max(-1, Math.min(1, (locationY / stageH) * 2 - 1)));
      }}
      onLongPress={onLongPress}
      delayLongPress={450}
    >
      <Animated.View style={[styles.faceRow, { gap, transform: [{ scale: breath }, { translateX: shakeX }] }]}>
        <Animated.Text style={[styles.glyph, glyphStyle, { transform: [{ translateY: glyphTy }] }]}>{gL}</Animated.Text>
        {renderEye('L')}
        {renderEye('R')}
        <Animated.Text style={[styles.glyph, glyphStyle, { transform: [{ translateY: Animated.multiply(glyphTy, -1) }] }]}>
          {gR}
        </Animated.Text>
      </Animated.View>

      {/* boca */}
      <View style={[styles.mouthWrap, { height: mouthArcH * 1.3, marginTop: D * 0.16 }]}>
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
              opacity: dim ? 0.3 : face === 'SPEAKING' || face === 'MUSIC' ? 0 : 1,
              transform: [{ scaleX: mouthW }, { scaleY: mouthScaleY }],
            },
          ]}
        />
        {(face === 'SPEAKING' || face === 'MUSIC') && (
          <Animated.View
            style={[
              styles.mouthOpen,
              {
                width: mouthWpx * 0.55,
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
      </View>

      {face === 'SLEEPING' && (
        <Animated.Text style={[styles.zzz, { color: CYAN, right: width * 0.28, transform: [{ translateY: glyphTy }] }]}>z z</Animated.Text>
      )}

      {irritation > 0.35 && !blaster && (
        <View style={[styles.irrBar, { width: D * 2 }]}>
          <View style={[styles.irrFill, { width: `${Math.round(irritation * 100)}%`, backgroundColor: irritation > 0.75 ? RED : accent }]} />
        </View>
      )}

      {blaster && <Animated.View pointerEvents="none" style={[styles.flash, { opacity: flash }]} />}
    </Pressable>
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
  glyph: { marginHorizontal: 18, textAlign: 'center', includeFontPadding: false },
  mouthWrap: { alignItems: 'center', justifyContent: 'center' },
  mouthArc: { position: 'absolute' },
  mouthOpen: { position: 'absolute' },
  dots: { flexDirection: 'row', gap: 8, position: 'absolute' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  zzz: { position: 'absolute', top: 0, fontSize: 22, letterSpacing: 4, opacity: 0.6 },
  irrBar: { position: 'absolute', bottom: 4, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  irrFill: { height: '100%', borderRadius: 2 },
  flash: { ...StyleSheet.absoluteFillObject, backgroundColor: RED },
});
