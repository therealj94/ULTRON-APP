import { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, useWindowDimensions, Animated, Easing } from 'react-native';
import type { FaceState } from '../config';

type Props = {
  face: FaceState;
  energy?: number;
};

const FACE_COLORS: Record<FaceState, string> = {
  IDLE: '#00E5FF',
  LISTENING: '#5CFFB0',
  THINKING: '#7AB8FF',
  SPEAKING: '#00E5FF',
  HAPPY: '#FFE566',
  CONCERNED: '#FF9F6B',
  ANGRY: '#FF4D6A',
  SLEEPING: '#6B7C8F',
  STARTLE: '#FF6BCB',
  WINK: '#FFE566',
  CONFUSED: '#C4A7FF',
  MUSIC: '#FF7AD9',
  SCAN: '#00FFC6',
  YAWNING: '#8FA3B8',
};

export function UltronFace({ face, energy = 85 }: Props) {
  const { width, height } = useWindowDimensions();
  const size = Math.min(width * 0.55, height * 0.72, 420);
  const color = FACE_COLORS[face] || FACE_COLORS.IDLE;
  const breath = useRef(new Animated.Value(1)).current;
  const blink = useRef(new Animated.Value(1)).current;
  const mouth = useRef(new Animated.Value(0.22)).current;
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1.03, duration: 2000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [breath]);

  useEffect(() => {
    blink.setValue(1);
    const blinkLoop = Animated.loop(
      Animated.sequence([
        Animated.delay(1800 + Math.random() * 1200),
        Animated.timing(blink, { toValue: 0.08, duration: 80, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1, duration: 120, useNativeDriver: true }),
      ])
    );
    blinkLoop.start();

    const speak = face === 'SPEAKING' || face === 'MUSIC';
    let mouthLoop: Animated.CompositeAnimation | null = null;
    if (speak) {
      mouthLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(mouth, { toValue: 0.9, duration: 140, useNativeDriver: true }),
          Animated.timing(mouth, { toValue: 0.25, duration: 160, useNativeDriver: true }),
        ])
      );
      mouthLoop.start();
    } else {
      const target =
        face === 'YAWNING'
          ? 1
          : face === 'HAPPY' || face === 'WINK'
            ? 0.55
            : face === 'CONCERNED'
              ? 0.12
              : face === 'ANGRY'
                ? 0.35
                : face === 'SLEEPING'
                  ? 0.05
                  : 0.22;
      Animated.timing(mouth, { toValue: target, duration: 280, useNativeDriver: true }).start();
    }

    const id = setInterval(() => setTick((n) => n + 1), 500);
    return () => {
      blinkLoop.stop();
      mouthLoop?.stop();
      clearInterval(id);
    };
  }, [face, blink, mouth]);

  const dilate = face === 'LISTENING' ? 1.15 : face === 'SLEEPING' ? 0.7 : 1;
  const eyeH = 28 * dilate;
  const leftWink = face === 'WINK';
  const glow = 0.35 + (energy / 400) + (tick % 2) * 0.05;

  return (
    <Animated.View style={[styles.wrap, { width: size, height: size, transform: [{ scale: breath }] }]}>
      <View style={[styles.ring, { borderColor: color, opacity: glow, width: size * 0.84, height: size * 0.84, borderRadius: size * 0.42 }]} />
      <View style={[styles.ringInner, { borderColor: color, width: size * 0.68, height: size * 0.68, borderRadius: size * 0.34 }]} />
      <View style={[styles.visor, { borderColor: color }]}>
        <View style={styles.eyesRow}>
          <Animated.View
            style={[
              styles.eye,
              {
                backgroundColor: color,
                height: eyeH,
                transform: [{ scaleY: leftWink ? 0.1 : blink }],
                opacity: face === 'SLEEPING' ? 0.35 : 1,
              },
            ]}
          >
            <View style={styles.pupil} />
            <View style={styles.glint} />
          </Animated.View>
          <Animated.View
            style={[
              styles.eye,
              {
                backgroundColor: color,
                height: eyeH,
                transform: [{ scaleY: blink }],
                opacity: face === 'SLEEPING' ? 0.35 : 1,
              },
            ]}
          >
            <View style={styles.pupil} />
            <View style={styles.glint} />
          </Animated.View>
        </View>
        <Animated.View
          style={[
            styles.mouth,
            {
              backgroundColor: color,
              transform: [{ scaleY: mouth }, { scaleX: 1 }],
              opacity: face === 'HAPPY' ? 0.95 : 0.85,
            },
          ]}
        />
      </View>
      {face === 'LISTENING' && <View style={[styles.listenPulse, { borderColor: color }]} />}
      <View style={styles.badge}>
        <View style={[styles.badgeDot, { backgroundColor: color }]} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#05070A',
    borderRadius: 36,
    overflow: 'hidden',
  },
  ring: {
    position: 'absolute',
    borderWidth: 2,
  },
  ringInner: {
    position: 'absolute',
    borderWidth: 1.5,
    opacity: 0.35,
  },
  visor: {
    width: '64%',
    height: '36%',
    borderRadius: 28,
    borderWidth: 1.5,
    backgroundColor: 'rgba(8,14,22,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingVertical: 10,
  },
  eyesRow: { flexDirection: 'row', gap: 28, alignItems: 'center' },
  eye: {
    width: 56,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pupil: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#001018' },
  glint: {
    position: 'absolute',
    top: 6,
    left: 14,
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#E8FBFF',
  },
  mouth: {
    width: 54,
    height: 18,
    borderRadius: 12,
  },
  listenPulse: {
    position: 'absolute',
    width: '92%',
    height: '92%',
    borderRadius: 999,
    borderWidth: 1,
    opacity: 0.25,
  },
  badge: { position: 'absolute', bottom: 18, alignItems: 'center' },
  badgeDot: { width: 8, height: 8, borderRadius: 4 },
});
