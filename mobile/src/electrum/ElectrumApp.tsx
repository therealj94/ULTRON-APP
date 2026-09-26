/**
 * Dr Electrum FP en el teléfono: arranque, puerta y campo.
 *
 * Vive aparte del `App.tsx` de AU-RA a propósito. Podrían compartir el esqueleto —splash, sesión,
 * pantalla— y no lo hacen porque ese esqueleto está lleno de decisiones de AU-RA: bloquea en
 * horizontal, pide cámara al entrar a la mesa, esconde las barras del sistema. Cada una de esas es
 * correcta para la mesa de la junta y equivocada para una app que se usa de pie en un cerro.
 *
 * Lo que sí se comparte es lo que debe: la cara, el lector de audio y el cliente HTTP.
 */
import { useCallback, useEffect, useState } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import { StatusBar } from 'expo-status-bar';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { useRef } from 'react';
import { UltronFace } from '../components/UltronFace';
import { APP_VERSION, type FaceState } from '../config';
import { ACENTO } from '../variante';
import { cargarCredenciales, cerrarSesion, hayCredencial, olvidarCredenciales, probarPuerta } from './api';
import { EntrarScreen } from './EntrarScreen';
import { CampoScreen } from './CampoScreen';
import { useBordes } from './useBordes';

type Fase = 'arranque' | 'entrar' | 'campo';

void SplashScreen.preventAutoHideAsync().catch(() => {});

function Arranque({ opacidad }: { opacidad: Animated.Value }) {
  const [cara, setCara] = useState<FaceState>('SLEEPING');
  const sube = useRef(new Animated.Value(0)).current;
  const b = useBordes();

  useEffect(() => {
    void SplashScreen.hideAsync().catch(() => {});
    Animated.timing(sube, { toValue: 1, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    const a = setTimeout(() => setCara('IDLE'), 560);
    return () => clearTimeout(a);
  }, [sube]);

  const ty = sube.interpolate({ inputRange: [0, 1], outputRange: [10, 0] });
  return (
    <Animated.View pointerEvents="none" style={[s.arranque, { opacity: opacidad }]}>
      <View style={{ width: 280, height: 176, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
        <UltronFace face={cara} acento={ACENTO} size={68} stageHeight={176} />
      </View>
      <Animated.View style={{ alignItems: 'center', opacity: sube, transform: [{ translateY: ty }] }}>
        <Text style={s.marca}>DR ELECTRUM FP</Text>
        <Text style={s.lema}>ESTACIÓN DE TRABAJO MINERA</Text>
      </Animated.View>
      <Text style={[s.version, { bottom: 24 + b.abajo }]}>v{APP_VERSION}</Text>
    </Animated.View>
  );
}

/** Lo que se le dice en la entrada a quien llegó ahí sin pedirlo: el servidor ya no le abre. */
const SESION_CADUCADA = 'Tu sesión ya no tiene acceso a Dr Electrum. Volvé a entrar.';

/** Los insets reales de la ventana para toda la app del doctor (useBordes los lee). */
export default function ElectrumApp() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <ElectrumPantallas />
    </SafeAreaProvider>
  );
}

function ElectrumPantallas() {
  const [fase, setFase] = useState<Fase>('arranque');
  const [visible, setVisible] = useState(true);
  const [motivo, setMotivo] = useState('');
  const opacidad = useRef(new Animated.Value(1)).current;

  const arrancar = useCallback(async () => {
    const minimo = new Promise((r) => setTimeout(r, 1700));
    await SystemUI.setBackgroundColorAsync('#000000').catch(() => {});
    await cargarCredenciales();
    let dentro = false;
    if (hayCredencial()) {
      /*
       * Tener una credencial guardada no es tener acceso: el padrón pudo cambiar desde la última
       * vez. Pero **solo se echa a la pantalla de entrada si el servidor dice que NO**.
       *
       * Antes cualquier fallo de `salud` mandaba al login, o sea que quedarse sin señal —en el
       * campo, que es donde se usa esto— parecía una sesión caducada y obligaba a escribir la clave
       * con una raya de cobertura. Si el problema es la red, se entra igual: la pantalla ya dice
       * «catastro fuera de línea», y si la credencial de verdad no vale, la primera petición lo
       * descubre y saca al usuario.
       */
      const p = await probarPuerta();
      dentro = p.estado !== 'sin-permiso';
      if (!dentro) {
        // Se borra y se dice. Antes quedaba guardada —cada arranque la volvía a probar y a
        // rechazar— y la entrada aparecía vacía, sin explicar por qué no se entró directo.
        await olvidarCredenciales();
        setMotivo(SESION_CADUCADA);
      }
    }
    await minimo;
    setFase(dentro ? 'campo' : 'entrar');
  }, []);

  useEffect(() => {
    void arrancar();
  }, [arrancar]);

  useEffect(() => {
    if (fase === 'arranque') return;
    Animated.timing(opacidad, { toValue: 0, duration: 650, delay: 100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }).start(
      ({ finished }) => finished && setVisible(false)
    );
  }, [fase, opacidad]);

  /*
   * Cerrar la sesión, sin preguntar. Preguntar es cosa del botón SALIR (CampoScreen), que es donde
   * la persona decide; aquí también se llega cuando el servidor ya dijo que la credencial no vale
   * (`motivo` trae la frase), y ahí no hay nada que confirmar: la sesión ya no abre.
   *
   * `cerrarSesion` vuelve en cuanto la credencial está borrada del teléfono; el aviso al servidor
   * sale detrás. Antes se esperaba al servidor, y sin señal la pantalla se quedaba quieta seis
   * segundos después de tocar «Salir».
   */
  const saliendo = useRef(false);
  const salir = useCallback(async (porque?: string) => {
    if (saliendo.current) return;
    saliendo.current = true;
    try {
      await cerrarSesion();
    } finally {
      saliendo.current = false;
      setMotivo(porque || '');
      setFase('entrar');
    }
  }, []);

  const alSalir = useCallback((porque?: string) => void salir(porque), [salir]);
  const alEntrar = useCallback(() => {
    setMotivo('');
    setFase('campo');
  }, []);

  return (
    <View style={s.raiz}>
      <StatusBar style="light" />
      {fase === 'entrar' && <EntrarScreen motivo={motivo} onDentro={alEntrar} />}
      {fase === 'campo' && <CampoScreen onSalir={alSalir} />}
      {visible && <Arranque opacidad={opacidad} />}
    </View>
  );
}

const s = StyleSheet.create({
  raiz: { flex: 1, backgroundColor: '#000' },
  arranque: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000', gap: 4 },
  marca: { color: ACENTO, fontSize: 24, fontWeight: '700', letterSpacing: 6, marginTop: -4 },
  lema: { color: 'rgba(255,174,59,0.55)', fontSize: 9, letterSpacing: 2.6, fontWeight: '600', marginTop: 8 },
  // #3A4A5A daba 2,3:1 sobre negro; #6C7F89 da 5:1, por encima del 4,5:1 que pide un texto chico.
  version: { position: 'absolute', bottom: 24, color: '#6C7F89', fontSize: 12, fontFamily: 'monospace' },
});
