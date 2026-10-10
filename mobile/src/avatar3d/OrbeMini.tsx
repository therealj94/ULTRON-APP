/**
 * AU-RA CHIQUITA: su orbe (la foto del orbe real de la mesa) para donde no cabe ni conviene otra escena
 * 3D: el acople de los chats, la pantalla completa de la compañera, la que camina y la llamada (José,
 * 3-oct: «en chat sigue saliendo el aura viejo»). Antes ahí salía el robot blanco (aura.glb).
 *
 * Nunca dos escenas 3D vivas a la vez (Companera, CuerpoLlamada, presencia): el orbe de partículas de la
 * mesa sigue montado debajo de los chats, así que aquí va una imagen con vida, sin WebGL:
 *  · respira despacio en reposo;
 *  · late con SU voz (senalVoz.boca, ~20 Hz), crece y brilla al hablar;
 *  · con la de la persona (nivelOido) pulsa suave cuando la escucha;
 *  · silenciada, se apaga un poco; pensando, gira lento.
 * Con «reducir movimiento», queda quieta (solo el brillo de la voz). Fase 0 (APK 5.7.1): se respeta al montarse Y cuando la
 * persona lo cambia con la app abierta (`reduceMotionChanged`). Antes se leía una vez en un ref y la respiración ya había
 * arrancado antes de que llegara la respuesta: con «reducir movimiento» encendido, igual respiraba sin parar.
 *
 * Revisión del 10-oct (José, en la burbuja del botón lateral: «mira el círculo de asistente»): el círculo enseñaba una
 * ESQUINA del orbe (fondo con estrellas y un pedacito del anillo abajo a la derecha). La imagen iba con
 * `StyleSheet.absoluteFill` y sin ancho ni alto: Image toma de la fuente su tamaño propio (512 × 512 dp del recurso) y
 * con ancho explícito Yoga ignora `right`/`bottom`, así que la foto quedaba de 512 dp pegada arriba a la izquierda y el
 * círculo (~190 dp) solo mostraba su esquina. Ahora la imagen mide exactamente el disco.
 */
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import { senalVoz } from './senalVoz';
import { nivelOido } from '../compa/canales';
import type { EstadoAvatar } from './tipos';
import { tinteExpresion, type ExpresionOrbe } from '../orbe/expresiones';
import { buclesOrbeMini, RESPIRO_QUIETO } from './movimientoOrbe';

const ORBE = require('../../assets/avatares/aura/orbe.webp');
const FONDO = '#05070C';

type Props = {
  /** Lado del cuadro donde va (el orbe es redondo y se centra). */
  lado: number;
  estado?: Pick<EstadoAvatar, 'silenciado' | 'pensando' | 'escuchando'>;
  /** Pausado (tapado, en segundo plano): sin animaciones ni oyentes. */
  activo?: boolean;
  /** La emoción del turno (orbe/expresiones.ts): sin WebGL, un velo de su color encima. */
  expresion?: ExpresionOrbe | null;
};

export function OrbeMini({ lado, estado, activo = true, expresion = null }: Props) {
  const voz = useRef(new Animated.Value(0)).current;
  const oido = useRef(new Animated.Value(0)).current;
  const respira = useRef(new Animated.Value(0)).current;
  const giro = useRef(new Animated.Value(0)).current;
  /** «Reducir movimiento» del sistema; null mientras no se sabe (no se anima hasta saberlo). */
  const [quieto, setQuieto] = useState<boolean | null>(null);

  useEffect(() => {
    let vivo = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((q) => vivo && setQuieto((v) => (v === null ? !!q : v)))
      .catch(() => vivo && setQuieto((v) => (v === null ? false : v)));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (q) => setQuieto(!!q));
    return () => {
      vivo = false;
      sub.remove();
    };
  }, []);

  // Su voz y la de la persona, sin pasar por React (cambian 20 veces por segundo).
  useEffect(() => {
    if (!activo) return;
    const fuera = senalVoz.boca.escuchar((b) => voz.setValue(Math.min(1, b.nivel)));
    const fueraOido = nivelOido.escuchar((n) => oido.setValue(Math.min(1, n)));
    return () => {
      fuera();
      fueraOido();
      voz.setValue(0);
      oido.setValue(0);
    };
  }, [activo, voz, oido]);

  // Respirar en reposo (y quieta, en su punto medio, con «reducir movimiento»).
  const pensando = !!estado?.pensando;
  const bucles = buclesOrbeMini({ activo, quieto, pensando });
  useEffect(() => {
    if (!bucles.respira) {
      respira.setValue(RESPIRO_QUIETO);
      return;
    }
    const a = Animated.loop(
      Animated.sequence([
        Animated.timing(respira, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(respira, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    a.start();
    return () => a.stop();
  }, [bucles.respira, respira]);

  // Pensando: gira lento.
  useEffect(() => {
    if (!bucles.gira) {
      giro.setValue(0);
      return;
    }
    giro.setValue(0);
    const a = Animated.loop(Animated.timing(giro, { toValue: 1, duration: 9000, easing: Easing.linear, useNativeDriver: true }));
    a.start();
    return () => a.stop();
  }, [bucles.gira, giro]);

  const d = Math.max(24, lado);
  const escala = Animated.add(
    Animated.add(respira.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1.02] }), voz.interpolate({ inputRange: [0, 1], outputRange: [0, 0.12] })),
    oido.interpolate({ inputRange: [0, 1], outputRange: [0, estado?.escuchando ? 0.05 : 0] })
  );
  const brillo = voz.interpolate({ inputRange: [0, 1], outputRange: [0, 0.55] });
  const rot = giro.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const tinte = tinteExpresion(expresion, 0.22);

  return (
    <View pointerEvents="none" style={[s.caja, { width: d, height: d }]}>
      <Animated.View style={{ width: d, height: d, borderRadius: d / 2, overflow: 'hidden', backgroundColor: FONDO, opacity: estado?.silenciado ? 0.55 : 1, transform: [{ scale: escala }, { rotate: rot }] }}>
        <Animated.Image source={ORBE} style={{ position: 'absolute', left: 0, top: 0, width: d, height: d }} resizeMode="cover" accessibilityIgnoresInvertColors />
        {!!tinte && <View style={[StyleSheet.absoluteFill, { borderRadius: d / 2, backgroundColor: tinte }]} />}
        {/* El brillo de la voz: un halo cálido encima, que sube con lo que dice. */}
        <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: d / 2, backgroundColor: 'rgba(255,236,200,0.9)', opacity: Animated.multiply(brillo, 0.35) }]} />
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  caja: { alignItems: 'center', justifyContent: 'center' },
});
