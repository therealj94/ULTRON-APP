/**
 * Claudio, el zorro de lentes, en retrato.
 *
 * Son las ilustraciones de José sin fondo (assets/avatares/claudio, scripts/avatares-claudio.py),
 * apiladas: cada estado de la cara enciende su foto con un fundido corto y las demás se apagan. Al
 * hablar, la foto de boca abierta (alineada con la cerrada) se abre y se cierra con el nivel de la
 * voz, el mismo que mueve la boca de AU-RA (tres cuadros de habla sacados de la misma foto). Encima de eso respira, sigue con la cabeza la mirada (la
 * cámara o el dedo) y de vez en cuando mira a un lado.
 *
 * No es un modelo 3D: es 2,5D con fotos. Un Claudio 3D de verdad (girar la cabeza, parpadear) pide
 * un modelo con huesos y caras que hoy no existe.
 */
import { memo, useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View, type ImageSourcePropType } from 'react-native';
import type { FaceState } from '../caraTipos';
import { aperturaBoca, bocaSigueVoz, fotoPorMirada, fotoRetrato, HABLA_RETRATO, type FotoRetrato } from './expresiones';

const FOTOS: Record<FotoRetrato, ImageSourcePropType> = {
  base: require('../../assets/avatares/claudio/base.webp'),
  canta: require('../../assets/avatares/claudio/canta.webp'),
  risa: require('../../assets/avatares/claudio/risa.webp'),
  sorpresa: require('../../assets/avatares/claudio/sorpresa.webp'),
  pensando: require('../../assets/avatares/claudio/pensando.webp'),
  sueno: require('../../assets/avatares/claudio/sueno.webp'),
  mira: require('../../assets/avatares/claudio/mira.webp'),
  aparta: require('../../assets/avatares/claudio/aparta.webp'),
  perfil: require('../../assets/avatares/claudio/perfil.webp'),
};

/** Los tres cuadros de habla, de menos a más abierta, sacados de la foto `base`. */
const HABLA: ImageSourcePropType[] = [
  require('../../assets/avatares/claudio/habla1.webp'),
  require('../../assets/avatares/claudio/habla2.webp'),
  require('../../assets/avatares/claudio/habla3.webp'),
];

const ORDEN: FotoRetrato[] = ['base', 'canta', 'risa', 'sorpresa', 'pensando', 'sueno', 'mira', 'aparta', 'perfil'];

export const FOTOS_CLAUDIO = { ...FOTOS, habla: HABLA };

type Props = {
  face: FaceState;
  gazeX?: number;
  gazeY?: number;
  /** Nivel de la voz 0..1 a ~20 Hz (el mismo de la boca de AU-RA). Devuelve cómo desuscribirse. */
  speechLevelSource?: (cb: (nivel: number) => void) => () => void;
  /** Lado del cuadro que lo contiene; por omisión llena el padre. */
  tamano?: number;
  onTap?: () => void;
  onLongPress?: () => void;
};

function ClaudioRetratoBase({ face, gazeX = 0, gazeY = 0, speechLevelSource, tamano, onTap, onLongPress }: Props) {
  const opac = useRef(Object.fromEntries(ORDEN.map((f) => [f, new Animated.Value(f === 'base' ? 1 : 0)])) as Record<FotoRetrato, Animated.Value>).current;
  /** Qué cuadro de habla se ve (0 = ninguno, la boca cerrada de la base). Sin fundido: la boca salta. */
  const boca = useRef(HABLA_RETRATO.map(() => new Animated.Value(0))).current;
  const respira = useRef(new Animated.Value(0)).current;
  const brinco = useRef(new Animated.Value(0)).current;
  const mirada = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const apertura = useRef(0);
  const siguiendoVoz = useRef(bocaSigueVoz(face));
  const vistazo = useRef<FotoRetrato | null>(null);

  // La foto que toca: la del estado, o la de la mirada si está tranquilo, o un vistazo al azar.
  const porEstado = fotoRetrato(face);
  const tranquilo = face === 'IDLE' || face === 'LISTENING';
  const porMirada = tranquilo ? fotoPorMirada(gazeX) : null;
  const elegida: FotoRetrato = porMirada || porEstado;

  const encender = useMemo(
    () => (f: FotoRetrato) => {
      Animated.parallel(
        ORDEN.map((k) => Animated.timing(opac[k], { toValue: k === f ? 1 : 0, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }))
      ).start();
    },
    [opac]
  );

  const mostrarBoca = useMemo(
    () => (n: number) => {
      apertura.current = n;
      boca.forEach((v, i) => v.setValue(i === n - 1 ? 1 : 0));
    },
    [boca]
  );

  useEffect(() => {
    vistazo.current = null;
    encender(elegida);
    siguiendoVoz.current = bocaSigueVoz(face) && !porMirada;
    // En las otras fotos la boca ya viene en la foto: los cuadros de habla se apagan.
    if (!siguiendoVoz.current) mostrarBoca(0);
  }, [elegida, encender, face, porMirada, mostrarBoca]);

  // Respira siempre: sin esto, una foto quieta se lee como foto.
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(respira, { toValue: 1, duration: 2300, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(respira, { toValue: 0, duration: 2300, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [respira]);

  // Sigue la mirada con la cabeza, suave.
  useEffect(() => {
    Animated.spring(mirada, { toValue: { x: gazeX, y: gazeY }, useNativeDriver: true, speed: 6, bounciness: 2 }).start();
  }, [gazeX, gazeY, mirada]);

  // En reposo, de vez en cuando mira a un lado un momento.
  useEffect(() => {
    if (!tranquilo || porMirada) return;
    let vivo = true;
    let t: ReturnType<typeof setTimeout>;
    const programar = () => {
      t = setTimeout(() => {
        if (!vivo) return;
        const f: FotoRetrato = Math.random() < 0.6 ? 'mira' : 'perfil';
        vistazo.current = f;
        encender(f);
        t = setTimeout(() => {
          if (!vivo || vistazo.current !== f) return;
          vistazo.current = null;
          encender('base');
          programar();
        }, 1400 + Math.random() * 900);
      }, 7000 + Math.random() * 6000);
    };
    programar();
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [tranquilo, porMirada, encender]);

  // La boca con la voz, sin re-renderizar: el nivel mueve Animated directamente.
  useEffect(() => {
    if (!speechLevelSource) return;
    return speechLevelSource((nivel) => {
      brinco.setValue(nivel);
      if (!siguiendoVoz.current) return;
      const n = aperturaBoca(nivel, apertura.current);
      if (n !== apertura.current) mostrarBoca(n);
    });
  }, [speechLevelSource, brinco, mostrarBoca]);

  const escala = Animated.add(
    respira.interpolate({ inputRange: [0, 1], outputRange: [1, 1.014] }),
    brinco.interpolate({ inputRange: [0, 1], outputRange: [0, 0.018] })
  );
  const transform = [
    { translateX: mirada.x.interpolate({ inputRange: [-1, 1], outputRange: [-10, 10] }) },
    { translateY: Animated.add(respira.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }), mirada.y.interpolate({ inputRange: [-1, 1], outputRange: [-6, 6] })) },
    { rotate: mirada.x.interpolate({ inputRange: [-1, 1], outputRange: ['-2.5deg', '2.5deg'] }) },
    { scale: escala },
  ];
  const caja = tamano ? { width: tamano, height: tamano } : StyleSheet.absoluteFillObject;

  return (
    <Pressable onPress={onTap} onLongPress={onLongPress} delayLongPress={500} style={[styles.raiz, caja]} accessibilityRole="imagebutton" accessibilityLabel="Claudio">
      <View pointerEvents="none" style={styles.halo} />
      <Animated.View pointerEvents="none" style={[styles.lienzo, { transform }]}>
        {ORDEN.map((f) => (
          <Animated.Image key={f} source={FOTOS[f]} resizeMode="contain" style={[styles.foto, { opacity: opac[f] }]} fadeDuration={0} />
        ))}
        {/* Los cuadros de habla van encima de la base (misma pose, solo cambia la boca). */}
        {HABLA.map((src, i) => (
          <Animated.Image key={`habla${i}`} source={src} resizeMode="contain" style={[styles.foto, { opacity: Animated.multiply(boca[i], opac.base) }]} fadeDuration={0} />
        ))}
      </Animated.View>
    </Pressable>
  );
}

export const ClaudioRetrato = memo(ClaudioRetratoBase);

const styles = StyleSheet.create({
  raiz: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  halo: {
    position: 'absolute',
    width: '78%',
    aspectRatio: 1,
    borderRadius: 9999,
    backgroundColor: 'rgba(214,181,108,0.10)',
  },
  lienzo: { width: '100%', height: '100%', maxWidth: 820, alignItems: 'center', justifyContent: 'center' },
  foto: { ...StyleSheet.absoluteFillObject, width: undefined, height: undefined },
});
