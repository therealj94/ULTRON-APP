import { useEffect, useState } from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import {
  Canvas,
  Circle,
  Group,
  Oval,
  Path,
  RadialGradient,
  RoundedRect,
  Skia,
  vec,
} from '@shopify/react-native-skia';
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
  const [phase, setPhase] = useState(0);
  const [blink, setBlink] = useState(1);
  const [mouth, setMouth] = useState(0.22);

  useEffect(() => {
    let raf = 0;
    let start = Date.now();
    let blinkAt = start + 2200;
    let blinkUntil = 0;
    let mouthT = 0;
    const tick = () => {
      const now = Date.now();
      const t = ((now - start) % 4000) / 4000;
      setPhase(t);

      if (now >= blinkAt) {
        blinkUntil = now + 110;
        blinkAt = now + 1800 + Math.random() * 1600;
      }
      setBlink(now < blinkUntil ? 0.08 : 1);

      const speak = face === 'SPEAKING' || face === 'MUSIC';
      if (speak) {
        mouthT += 0.18;
        setMouth(0.25 + Math.abs(Math.sin(mouthT)) * 0.6);
      } else if (face === 'YAWNING') setMouth(0.95);
      else if (face === 'HAPPY' || face === 'WINK') setMouth(0.55);
      else if (face === 'CONCERNED') setMouth(0.12);
      else if (face === 'ANGRY') setMouth(0.35);
      else if (face === 'SLEEPING') setMouth(0.05);
      else setMouth(0.22);

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [face]);

  const cx = size / 2;
  const cy = size / 2;
  const breath = 1 + Math.sin(phase * Math.PI * 2) * 0.018;
  const glow = 0.35 + Math.sin(phase * Math.PI * 2) * 0.12 + energy / 400;
  const eyeY =
    face === 'SLEEPING' ? 8 : face === 'THINKING' ? -4 + Math.sin(phase * Math.PI * 4) * 2 : Math.sin(phase * Math.PI * 2) * 3;
  const dilate = face === 'LISTENING' ? 1.2 : face === 'THINKING' || face === 'SCAN' ? 0.85 : face === 'SLEEPING' ? 0.6 : 1;
  const leftWink = face === 'WINK';
  const browAngry = face === 'ANGRY' || face === 'STARTLE';
  const smile = face === 'HAPPY' || face === 'WINK' || face === 'MUSIC' ? 1 : face === 'CONCERNED' ? -1 : 0;

  const mouthPath = (() => {
    const p = Skia.Path.Make();
    const w = 54 + mouth * 10;
    const h = 6 + mouth * 28;
    const my = 38 + (smile < 0 ? 6 : 0);
    if (smile > 0 && mouth < 0.4) {
      p.moveTo(-w / 2, my);
      p.quadTo(0, my + 18, w / 2, my);
    } else if (smile < 0 && mouth < 0.35) {
      p.moveTo(-w / 2, my + 10);
      p.quadTo(0, my - 8, w / 2, my + 10);
    } else {
      p.addOval(Skia.XYWHRect(-w / 2, my - h / 2, w, h));
    }
    return p;
  })();

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Canvas style={{ width: size, height: size }}>
        <RoundedRect x={0} y={0} width={size} height={size} r={size * 0.12} color="#05070A" />
        <Circle cx={cx} cy={cy} r={size * 0.46}>
          <RadialGradient c={vec(cx, cy)} r={size * 0.5} colors={['rgba(0,229,255,0.16)', 'rgba(0,0,0,0)']} />
        </Circle>

        <Group origin={vec(cx, cy)} transform={[{ scale: breath }]}>
          <Circle cx={cx} cy={cy} r={size * 0.42} style="stroke" strokeWidth={2} color={color} opacity={glow} />
          <Circle cx={cx} cy={cy} r={size * 0.34} style="stroke" strokeWidth={1.5} color={color} opacity={0.35} />
        </Group>

        <RoundedRect
          x={cx - size * 0.32}
          y={cy - size * 0.18}
          width={size * 0.64}
          height={size * 0.36}
          r={28}
          color="rgba(8,14,22,0.92)"
        />
        <RoundedRect
          x={cx - size * 0.32}
          y={cy - size * 0.18}
          width={size * 0.64}
          height={size * 0.36}
          r={28}
          style="stroke"
          strokeWidth={1.5}
          color={color}
          opacity={0.45}
        />

        <Group transform={[{ translateX: cx - size * 0.12 }, { translateY: cy - size * 0.04 + eyeY }]}>
          <Group transform={[{ scaleY: (leftWink ? 0.1 : blink) * dilate }]}>
            <Oval x={-28} y={-16} width={56} height={32} color={color} opacity={0.95} />
            <Circle cx={0} cy={0} r={7} color="#001018" />
            <Circle cx={-3} cy={-3} r={2.2} color="#E8FBFF" />
          </Group>
          {browAngry && (
            <Path
              path={Skia.Path.Make().moveTo(-30, -28).lineTo(26, -18)}
              color={color}
              style="stroke"
              strokeWidth={3}
            />
          )}
        </Group>

        <Group transform={[{ translateX: cx + size * 0.12 }, { translateY: cy - size * 0.04 + eyeY }]}>
          <Group transform={[{ scaleY: blink * dilate }]}>
            <Oval x={-28} y={-16} width={56} height={32} color={color} opacity={0.95} />
            <Circle cx={0} cy={0} r={7} color="#001018" />
            <Circle cx={-3} cy={-3} r={2.2} color="#E8FBFF" />
          </Group>
          {browAngry && (
            <Path
              path={Skia.Path.Make().moveTo(-26, -18).lineTo(30, -28)}
              color={color}
              style="stroke"
              strokeWidth={3}
            />
          )}
        </Group>

        <Group transform={[{ translateX: cx }, { translateY: cy + size * 0.02 }]}>
          <Path path={mouthPath} color={color} />
        </Group>

        {face === 'LISTENING' && (
          <Group>
            <Circle cx={cx} cy={cy} r={size * 0.48} style="stroke" strokeWidth={1} color={color} opacity={0.25} />
            <Circle cx={cx} cy={cy} r={size * 0.52} style="stroke" strokeWidth={1} color={color} opacity={0.12} />
          </Group>
        )}
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
});
