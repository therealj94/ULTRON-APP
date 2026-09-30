/**
 * EL AURA: el anillo dorado que respira, la firma visual de AURA en toda la app (la intro, la
 * entrada, la bienvenida, la presentación de la primera vez).
 *
 * Tres capas dibujadas con Skia y movidas por Reanimated en el hilo de la interfaz:
 *   · el halo: un resplandor radial que se infla y desinfla despacio (respira cada 4,8 s);
 *   · el anillo: un trazo con degradado de barrido que gira, con una copia desenfocada debajo que
 *     hace de brillo; y un anillo interior finito;
 *   · las partículas: motas de oro que orbitan a distintas distancias y titilan.
 * Todo cicla con números enteros de vueltas, así que el bucle no tiene costura.
 *
 * `nivel` (0..1, p. ej. la voz) aviva el halo; `expansion` (0..1) lo abre hacia afuera y lo apaga:
 * es la salida de la intro.
 */
import { memo, useEffect, useMemo } from 'react';
import { BlurMask, Canvas, Circle, Group, RadialGradient, SweepGradient, vec } from '@shopify/react-native-skia';
import { Easing, useDerivedValue, useSharedValue, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';

type Props = {
  tam: number;
  particulas?: number;
  color?: string;
  /** Color claro del brillo del anillo. */
  colorClaro?: string;
  nivel?: SharedValue<number>;
  expansion?: SharedValue<number>;
  /** Aparece desde cero (la intro); 0..1 controlado desde afuera. */
  encendido?: SharedValue<number>;
};

/** #RRGGBB → rgba con esa opacidad. */
export function conAlfa(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Números fijos por mota (sin Math.random en cada dibujo: el aura es la misma en cada arranque). */
function motas(n: number) {
  const r: { a0: number; dist: number; vueltas: number; tam: number; fase: number; brillo: number }[] = [];
  let semilla = 7;
  const azar = () => {
    semilla = (semilla * 16807) % 2147483647;
    return (semilla - 1) / 2147483646;
  };
  for (let i = 0; i < n; i++) {
    r.push({
      a0: azar() * Math.PI * 2,
      dist: 0.86 + azar() * 0.62,
      vueltas: (azar() < 0.5 ? -1 : 1) * (1 + Math.floor(azar() * 2)),
      tam: 0.6 + azar() * 1.7,
      fase: azar() * Math.PI * 2,
      brillo: 1 + Math.floor(azar() * 3),
    });
  }
  return r;
}

function Mota({ m, t, c, R, color, encendido }: { m: ReturnType<typeof motas>[number]; t: SharedValue<number>; c: number; R: number; color: string; encendido: SharedValue<number> }) {
  const cx = useDerivedValue(() => c + Math.cos(m.a0 + t.value * Math.PI * 2 * m.vueltas) * R * m.dist * (0.7 + 0.3 * encendido.value));
  const cy = useDerivedValue(() => c + Math.sin(m.a0 + t.value * Math.PI * 2 * m.vueltas) * R * m.dist * (0.7 + 0.3 * encendido.value));
  const op = useDerivedValue(() => encendido.value * (0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t.value * Math.PI * 2 * m.brillo * 3 + m.fase))));
  return <Circle cx={cx} cy={cy} r={m.tam * (R / 90)} color={color} opacity={op} />;
}

export const Aura = memo(function Aura({ tam, particulas = 26, color = '#D6B56C', colorClaro = '#FFF1CC', nivel, expansion, encendido }: Props) {
  const c = tam / 2;
  const R = tam * 0.33;
  const t = useSharedValue(0);
  const respiro = useSharedValue(0);
  const cero = useSharedValue(0);
  const uno = useSharedValue(1);
  const enc = encendido ?? uno;
  const exp = expansion ?? cero;
  const niv = nivel ?? cero;

  useEffect(() => {
    t.value = withRepeat(withTiming(1, { duration: 16000, easing: Easing.linear }), -1, false);
    respiro.value = withRepeat(withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [t, respiro]);

  const lista = useMemo(() => motas(particulas), [particulas]);

  const giro = useDerivedValue(() => [{ rotate: t.value * Math.PI * 2 * 2 }]);
  const escalaHalo = useDerivedValue(() => [{ scale: (0.9 + 0.1 * respiro.value + 0.25 * niv.value) * (0.6 + 0.4 * enc.value) * (1 + exp.value * 0.9) }]);
  const escalaAnillo = useDerivedValue(() => [{ scale: (0.97 + 0.03 * respiro.value + 0.06 * niv.value) * (0.7 + 0.3 * enc.value) * (1 + exp.value * 0.6) }]);
  const opHalo = useDerivedValue(() => enc.value * (0.75 + 0.25 * respiro.value) * (1 - exp.value));
  const opAnillo = useDerivedValue(() => enc.value * (1 - exp.value));
  const encMotas = useDerivedValue(() => enc.value * (1 - exp.value));
  const origen = vec(c, c);

  return (
    <Canvas style={{ width: tam, height: tam }} pointerEvents="none">
      <Group transform={escalaHalo} origin={origen} opacity={opHalo}>
        <Circle cx={c} cy={c} r={c}>
          <RadialGradient c={origen} r={c} colors={[conAlfa(color, 0.5), conAlfa(color, 0.16), conAlfa(color, 0)]} positions={[0, 0.5, 1]} />
        </Circle>
      </Group>
      <Group transform={escalaAnillo} origin={origen} opacity={opAnillo}>
        <Group transform={giro} origin={origen}>
          <Circle cx={c} cy={c} r={R} style="stroke" strokeWidth={tam * 0.03} opacity={0.55}>
            <SweepGradient c={origen} colors={[colorClaro, color, conAlfa(color, 0.1), color, colorClaro]} />
            <BlurMask blur={tam * 0.03} style="normal" />
          </Circle>
          <Circle cx={c} cy={c} r={R} style="stroke" strokeWidth={Math.max(1.5, tam * 0.012)}>
            <SweepGradient c={origen} colors={[colorClaro, color, conAlfa(color, 0.1), color, colorClaro]} />
          </Circle>
        </Group>
        <Circle cx={c} cy={c} r={R * 0.8} style="stroke" strokeWidth={1} color={conAlfa(color, 0.3)} />
      </Group>
      {lista.map((m, i) => (
        <Mota key={i} m={m} t={t} c={c} R={R} color={i % 3 === 0 ? colorClaro : color} encendido={encMotas} />
      ))}
    </Canvas>
  );
});
