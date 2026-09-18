import React from 'react';
import { View, StyleSheet, Animated, Dimensions } from 'react-native';

const { width: W } = Dimensions.get('window');
export const EYE = Math.min(124, W * 0.26);

type Props = {
  color: string;
  blink: Animated.Value;
  winkL: Animated.Value;
  winkR: Animated.Value;
  squash: Animated.Value;
  breath: Animated.Value;
  pupil: Animated.ValueXY;
  lip: number;
};

export function Face({ color, blink, winkL, winkR, squash, breath, pupil, lip }: Props) {
  const scale = Animated.multiply(
    breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.028] }),
    squash
  );
  return (
    <Animated.View style={[st.wrap, { transform: [{ scale }] }]}>
      <View style={st.row}>
        <Orb color={color} open={Animated.multiply(blink, winkL)} pupil={pupil} />
        <Orb color={color} open={Animated.multiply(blink, winkR)} pupil={pupil} />
      </View>
      <View style={[st.mouthBox, { height: 10 + lip * 20 }]}>
        <View style={[st.mouth, { height: 3 + lip * 14, backgroundColor: color }]} />
      </View>
    </Animated.View>
  );
}

function Orb({
  color, open, pupil,
}: { color: string; open: Animated.AnimatedInterpolation<number> | Animated.Value; pupil: Animated.ValueXY }) {
  const lidY = (open as Animated.Value).interpolate
    ? (open as Animated.AnimatedInterpolation<number>).interpolate({
        inputRange: [0, 1],
        outputRange: [EYE * 0.46, 0],
      })
    : 0;
  return (
    <View style={st.well}>
      <View style={[st.sclera, { borderColor: color + 'AA' }]}>
        <View style={[st.glow, { backgroundColor: color + '18' }]} />
        <View style={st.iris}>
          <Animated.View style={[st.pupil, { transform: pupil.getTranslateTransform() }]} />
          <View style={st.glint} />
        </View>
        <Animated.View style={[st.lidTop, { backgroundColor: '#000', transform: [{ translateY: lidY as any }] }]} />
        <Animated.View style={[st.lidBot, { backgroundColor: '#000', transform: [{ translateY: Animated.multiply(lidY as any, -1) }] }]} />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { alignItems: 'center' },
  row: { flexDirection: 'row', gap: EYE * 0.42 },
  well: { width: EYE, height: EYE, alignItems: 'center', justifyContent: 'center' },
  sclera: {
    width: EYE * 0.98,
    height: EYE * 0.98,
    borderRadius: EYE,
    backgroundColor: '#071014',
    overflow: 'hidden',
    borderWidth: 1.4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: { position: 'absolute', width: EYE, height: EYE, borderRadius: EYE },
  iris: {
    width: EYE * 0.56,
    height: EYE * 0.56,
    borderRadius: EYE,
    backgroundColor: '#0a3d48',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pupil: { width: EYE * 0.22, height: EYE * 0.22, borderRadius: EYE, backgroundColor: '#000' },
  glint: {
    position: 'absolute',
    top: EYE * 0.09,
    left: EYE * 0.12,
    width: EYE * 0.1,
    height: EYE * 0.1,
    borderRadius: EYE,
    backgroundColor: '#eaffff',
  },
  lidTop: { position: 'absolute', top: -EYE * 0.5, left: 0, right: 0, height: EYE * 0.52 },
  lidBot: { position: 'absolute', bottom: -EYE * 0.5, left: 0, right: 0, height: EYE * 0.52 },
  mouthBox: { marginTop: 10, width: EYE * 0.72, alignItems: 'center', justifyContent: 'center' },
  mouth: { width: EYE * 0.38, borderRadius: 4 },
});
