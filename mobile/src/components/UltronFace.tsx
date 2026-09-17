import { useEffect, useRef } from 'react';
import { View, StyleSheet, useWindowDimensions, Animated, Easing } from 'react-native';
import type { FaceState } from '../config';

type Props = {
  face: FaceState;
  /** -1..1 gaze from camera / touch */
  gazeX?: number;
  gazeY?: number;
  energy?: number;
};

/** Paleta más cálida / tierna (menos “scanner robótico”). */
const FACE_COLORS: Record<FaceState, string> = {
  IDLE: '#7EE8FF',
  LISTENING: '#9AF5C8',
  THINKING: '#A8C8FF',
  SPEAKING: '#8DE4FF',
  HAPPY: '#FFE9A8',
  CONCERNED: '#FFC4A8',
  ANGRY: '#FF9AAA',
  SLEEPING: '#9AA8B8',
  STARTLE: '#FFB8E0',
  WINK: '#FFE9A8',
  CONFUSED: '#D4C0FF',
  MUSIC: '#FFB8E8',
  SCAN: '#9AFFE0',
  YAWNING: '#B0BCC8',
};

export function UltronFace({ face, gazeX = 0, gazeY = 0, energy = 85 }: Props) {
  const { width, height } = useWindowDimensions();
  const size = Math.min(width * 0.48, height * 0.78, 400);
  const color = FACE_COLORS[face] || FACE_COLORS.IDLE;

  const breath = useRef(new Animated.Value(1)).current;
  const blink = useRef(new Animated.Value(1)).current;
  const mouth = useRef(new Animated.Value(0.18)).current;
  const pupilX = useRef(new Animated.Value(0)).current;
  const pupilY = useRef(new Animated.Value(0)).current;
  const softGlow = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 1.025,
          duration: 2600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 1,
          duration: 2600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    const glowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(softGlow, { toValue: 0.55, duration: 2200, useNativeDriver: true }),
        Animated.timing(softGlow, { toValue: 0.32, duration: 2200, useNativeDriver: true }),
      ])
    );
    glowLoop.start();
    return () => {
      loop.stop();
      glowLoop.stop();
    };
  }, [breath, softGlow]);

  // Gaze follow (suave)
  useEffect(() => {
    const tx = Math.max(-1, Math.min(1, gazeX)) * 7;
    const ty = Math.max(-1, Math.min(1, gazeY)) * 5;
    Animated.spring(pupilX, { toValue: tx, useNativeDriver: true, friction: 8, tension: 40 }).start();
    Animated.spring(pupilY, { toValue: ty, useNativeDriver: true, friction: 8, tension: 40 }).start();
  }, [gazeX, gazeY, pupilX, pupilY]);

  useEffect(() => {
    blink.setValue(1);
    const blinkLoop = Animated.loop(
      Animated.sequence([
        Animated.delay(2400 + Math.random() * 1800),
        Animated.timing(blink, { toValue: 0.06, duration: 70, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1, duration: 140, useNativeDriver: true }),
        // parpadeo doble suave a veces
        Animated.delay(40),
        Animated.timing(blink, { toValue: Math.random() > 0.7 ? 0.08 : 1, duration: 60, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1, duration: 120, useNativeDriver: true }),
      ])
    );
    blinkLoop.start();

    const speak = face === 'SPEAKING' || face === 'MUSIC';
    let mouthLoop: Animated.CompositeAnimation | null = null;
    if (speak) {
      mouthLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(mouth, { toValue: 0.72, duration: 160, useNativeDriver: true }),
          Animated.timing(mouth, { toValue: 0.22, duration: 180, useNativeDriver: true }),
        ])
      );
      mouthLoop.start();
    } else {
      const target =
        face === 'YAWNING'
          ? 0.95
          : face === 'HAPPY' || face === 'WINK'
            ? 0.48
            : face === 'CONCERNED'
              ? 0.1
              : face === 'ANGRY'
                ? 0.28
                : face === 'SLEEPING'
                  ? 0.04
                  : 0.18;
      Animated.timing(mouth, { toValue: target, duration: 320, useNativeDriver: true }).start();
    }

    return () => {
      blinkLoop.stop();
      mouthLoop?.stop();
    };
  }, [face, blink, mouth]);

  const leftWink = face === 'WINK';
  const sleeping = face === 'SLEEPING';
  const eyeW = size * 0.13;
  const eyeH = size * 0.09;

  return (
    <Animated.View style={[styles.wrap, { width: size, height: size, transform: [{ scale: breath }] }]}>
      {/* Aura suave */}
      <Animated.View
        style={[
          styles.aura,
          {
            width: size * 0.92,
            height: size * 0.92,
            borderRadius: size * 0.46,
            backgroundColor: color,
            opacity: softGlow,
          },
        ]}
      />
      <View style={[styles.head, { width: size * 0.72, height: size * 0.72, borderRadius: size * 0.36 }]}>
        <View style={[styles.visorSoft, { borderColor: `${color}55` }]}>
          {/* Ojos tiernos — ovalados grandes, iris suave, pupilas que siguen */}
          <View style={styles.eyesRow}>
            <Animated.View
              style={[
                styles.eyeWhite,
                {
                  width: eyeW,
                  height: eyeH,
                  transform: [{ scaleY: leftWink ? 0.12 : blink }],
                  opacity: sleeping ? 0.25 : 1,
                },
              ]}
            >
              <View style={[styles.iris, { backgroundColor: color, width: eyeW * 0.55, height: eyeH * 0.72 }]}>
                <Animated.View
                  style={[
                    styles.pupil,
                    { transform: [{ translateX: pupilX }, { translateY: pupilY }] },
                  ]}
                />
                <View style={styles.glintBig} />
                <View style={styles.glintSmall} />
              </View>
            </Animated.View>
            <Animated.View
              style={[
                styles.eyeWhite,
                {
                  width: eyeW,
                  height: eyeH,
                  transform: [{ scaleY: blink }],
                  opacity: sleeping ? 0.25 : 1,
                },
              ]}
            >
              <View style={[styles.iris, { backgroundColor: color, width: eyeW * 0.55, height: eyeH * 0.72 }]}>
                <Animated.View
                  style={[
                    styles.pupil,
                    { transform: [{ translateX: pupilX }, { translateY: pupilY }] },
                  ]}
                />
                <View style={styles.glintBig} />
                <View style={styles.glintSmall} />
              </View>
            </Animated.View>
          </View>

          {/* Boca suave */}
          <Animated.View
            style={[
              styles.mouth,
              {
                backgroundColor: color,
                width: size * 0.12,
                height: size * 0.035,
                transform: [{ scaleY: mouth }, { scaleX: face === 'HAPPY' ? 1.25 : 1 }],
                borderRadius: face === 'HAPPY' || face === 'WINK' ? 20 : 10,
                opacity: 0.9,
              },
            ]}
          />
        </View>
      </View>
      {face === 'LISTENING' && (
        <View style={[styles.listenRing, { borderColor: color, width: size * 0.88, height: size * 0.88 }]} />
      )}
      <View style={styles.energyBar}>
        <View style={[styles.energyFill, { width: `${Math.min(100, energy)}%` as any, backgroundColor: color }]} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  aura: {
    position: 'absolute',
    opacity: 0.12,
  },
  head: {
    backgroundColor: '#0B1018',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#00E5FF',
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 8,
  },
  visorSoft: {
    width: '78%',
    height: '48%',
    borderRadius: 40,
    borderWidth: 1,
    backgroundColor: 'rgba(14,20,30,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingVertical: 12,
  },
  eyesRow: { flexDirection: 'row', gap: 28, alignItems: 'center' },
  eyeWhite: {
    backgroundColor: '#F4FBFF',
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  iris: {
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pupil: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: '#0A121A',
  },
  glintBig: {
    position: 'absolute',
    top: 3,
    left: 5,
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
    opacity: 0.95,
  },
  glintSmall: {
    position: 'absolute',
    bottom: 4,
    right: 5,
    width: 2.5,
    height: 2.5,
    borderRadius: 2,
    backgroundColor: '#FFFFFF',
    opacity: 0.55,
  },
  mouth: { marginTop: 2 },
  listenRing: {
    position: 'absolute',
    borderRadius: 999,
    borderWidth: 1,
    opacity: 0.22,
  },
  energyBar: {
    position: 'absolute',
    bottom: 14,
    width: '40%',
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  energyFill: { height: '100%', borderRadius: 2 },
});
