/**
 * LA PRIMERA VEZ: cuando el perfil no está `completado`, entre la entrada y la mesa.
 *
 * Arriba, «atrás» y la barra dorada de progreso (avanza con un resorte en cada paso); en medio, el
 * paso, que entra deslizándose desde el lado hacia donde se va (adelante desde la derecha, atrás
 * desde la izquierda); abajo, el botón para seguir. Los pasos y sus reglas viven en flujo.ts.
 *
 * Se guarda sobre la marcha: cada «Siguiente» escribe en el perfil lo de ese paso (lib/perfil.ts: al
 * instante en el teléfono y después en el servidor, sin esperar), y el número de paso queda anotado
 * en el teléfono; si Android cierra la app a la mitad, se retoma donde se quedó. Al final se marca
 * `completado`, se deja el avatar elegido en los ajustes que lee la mesa, y a la mesa, que lo
 * presenta con su voz.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { FadeInLeft, FadeInRight, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { tr, useIdioma } from '../i18n';
import { guardarPerfil, usePerfil } from '../lib/perfil';
import { saveSettings } from '../lib/storage';
import { setAvatarVoz, stopSpeaking } from '../lib/tts';
import type { Perfil } from '../nucleo/contrato';
import { MEDIDA, useTema } from '../nucleo/tema';
import { BarraProgreso, Boton, BotonRedondo, vibrar } from '../ui';
import type { RaizParams } from '../app/rutas';
import { reiniciarA } from '../app/rutas';
import { marcarRecienElegido, useUsuario } from '../app/sesion';
import { PASOS, anterior, borradorDesde, cambiosDe, preguntaDe, progreso, puedeSeguir, siguiente, type Borrador, type PasoId } from './flujo';
import { PasoApodo } from './pasos/PasoApodo';
import { PasoAura } from './pasos/PasoAura';
import { PasoAvatar } from './pasos/PasoAvatar';
import { LluviaConfeti, PasoFiesta } from './pasos/PasoFiesta';
import { PasoGenesis } from './pasos/PasoGenesis';
import { PasoPermisos } from './pasos/PasoPermisos';
import { PasoPregunta } from './pasos/PasoPregunta';
import { PasoTema } from './pasos/PasoTema';
import type { PropsPaso } from './pasos/tipos';

type Props = NativeStackScreenProps<RaizParams, 'PrimeraVez'>;

const CLAVE_PASO = (correo: string) => `aura.primeravez.paso.v1:${correo.trim().toLowerCase()}`;

/** Lo que cada paso escribe en el perfil al seguir. */
function cambiosDelPaso(paso: PasoId, b: Borrador): Partial<Perfil> | null {
  if (paso === 'genesis') return b.cumple ? { cumple: b.cumple } : null;
  if (paso === 'apodo') return { apodo: b.apodo.trim() };
  if (paso === 'avatar') return { avatar: b.avatar };
  if (paso === 'tema') return { tema: b.tema };
  const q = preguntaDe(paso);
  if (q) return { encuesta: { [q.campo]: b.encuesta[q.campo] || '' } };
  return null;
}

/** Los pasos que se pueden saltar con el botón de arriba (lo demás se sigue con «Siguiente»). */
function saltable(paso: PasoId): boolean {
  return paso.startsWith('encuesta:') || paso === 'permisos' || paso === 'aura';
}

export function PrimeraVez(_: Props) {
  useIdioma();
  const tema = useTema();
  const ins = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const horizontal = width > height && width > 600;
  const perfil = usePerfil();
  const usuario = useUsuario();
  const [i, setI] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [b, setB] = useState<Borrador>(() => borradorDesde(perfil, usuario?.name));
  const [terminando, setTerminando] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const paso = PASOS[i];

  // Retomar donde se quedó (si Android cerró la app a la mitad).
  useEffect(() => {
    if (!usuario) return;
    void AsyncStorage.getItem(CLAVE_PASO(usuario.correo))
      .then((v) => {
        const n = Number(v);
        if (Number.isInteger(n) && n > 0 && n < PASOS.length) setI(n);
      })
      .catch(() => {});
  }, [usuario]);

  // Si el perfil llega del servidor después de montar (nombre y cumple de Genesis), se completan los huecos.
  useEffect(() => {
    if (!perfil) return;
    setB((x) => ({
      ...x,
      apodo: x.apodo || borradorDesde(perfil, usuario?.name).apodo,
      cumple: x.cumple ?? perfil.cumple,
    }));
  }, [perfil, usuario]);

  const cambiar = useCallback((c: Partial<Borrador>) => setB((x) => ({ ...x, ...c })), []);

  const ir = useCallback(
    (n: number, d: 1 | -1) => {
      void stopSpeaking();
      setDir(d);
      setI(n);
      scroll.current?.scrollTo({ y: 0, animated: false });
      if (usuario) void AsyncStorage.setItem(CLAVE_PASO(usuario.correo), String(n)).catch(() => {});
    },
    [usuario]
  );

  const terminar = useCallback(async () => {
    if (terminando) return;
    setTerminando(true);
    vibrar('exito');
    guardarPerfil({ ...cambiosDe(b, true) });
    setAvatarVoz(b.avatar);
    // La mesa lee el avatar y el idioma de los ajustes del teléfono al abrirse: que ya estén.
    await saveSettings({ avatar: b.avatar, avatarElegido: true }).catch(() => {});
    if (usuario) await AsyncStorage.removeItem(CLAVE_PASO(usuario.correo)).catch(() => {});
    marcarRecienElegido(true);
    reiniciarA('Mesa', { recienElegido: true });
  }, [b, terminando, usuario]);

  const avanzar = useCallback(() => {
    if (!puedeSeguir(paso, b)) {
      vibrar('aviso');
      return;
    }
    if (paso === 'fiesta') return void terminar();
    const c = cambiosDelPaso(paso, b);
    if (c) guardarPerfil(c);
    vibrar('seleccion');
    ir(siguiente(i), 1);
  }, [paso, b, i, ir, terminar]);

  const volver = useCallback(() => {
    if (i === 0) return false;
    ir(anterior(i), -1);
    return true;
  }, [i, ir]);

  const saltar = () => {
    const q = preguntaDe(paso);
    // Saltar una pregunta la deja en blanco (aunque se hubiera tocado algún chip).
    if (q) {
      const e = { ...b.encuesta };
      delete e[q.campo];
      setB((x) => ({ ...x, encuesta: e }));
    }
    vibrar('seleccion');
    ir(siguiente(i), 1);
  };

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', volver);
    return () => sub.remove();
  }, [volver]);

  const props: PropsPaso = { perfil, borrador: b, cambiar, avanzar, horizontal };
  const q = preguntaDe(paso);
  const contenido =
    paso === 'genesis' ? (
      <PasoGenesis {...props} />
    ) : paso === 'apodo' ? (
      <PasoApodo {...props} />
    ) : paso === 'avatar' ? (
      <PasoAvatar {...props} />
    ) : paso === 'tema' ? (
      <PasoTema {...props} />
    ) : paso === 'aura' ? (
      <PasoAura {...props} />
    ) : q ? (
      <PasoPregunta key={q.campo} {...props} pregunta={q} />
    ) : paso === 'permisos' ? (
      <PasoPermisos {...props} />
    ) : (
      <PasoFiesta {...props} />
    );

  const titulo = paso === 'fiesta' ? tr('Ir a la mesa', 'Go to the desk') : paso === 'permisos' ? tr('Continuar', 'Continue') : tr('Siguiente', 'Next');

  const boton = (tam: 'normal' | 'chico') => (
    <Boton
      titulo={titulo}
      tam={tam}
      iconoDerecha={paso === 'fiesta' ? undefined : 'flecha'}
      icono={paso === 'fiesta' ? 'chispas' : undefined}
      onPress={avanzar}
      deshabilitado={!puedeSeguir(paso, b)}
      cargando={terminando}
    />
  );

  return (
    <KeyboardAvoidingView style={[s.raiz, { backgroundColor: tema.fondo }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={[s.barra, { paddingTop: ins.top + 6 }]}>
        <View style={s.lado}>{i > 0 && paso !== 'fiesta' && <BotonRedondo onPress={volver} />}</View>
        <View style={s.progreso}>
          <BarraProgreso valor={progreso(i)} alto={5} />
        </View>
        <View style={[s.lado, { alignItems: 'flex-end' }, horizontal && s.ladoH]}>
          {saltable(paso) && <Boton titulo={tr('Saltar', 'Skip')} variante="fantasma" tam="chico" onPress={saltar} />}
          {/* Acostado, el botón para seguir va arriba: la pantalla es baja y el paso necesita el alto. */}
          {horizontal && boton('chico')}
        </View>
      </View>
      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        contentContainerStyle={[s.contenido, horizontal && s.contenidoH]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View key={paso} entering={(dir > 0 ? FadeInRight : FadeInLeft).springify().damping(20).stiffness(170)} exiting={FadeOut.duration(120)} style={{ width: '100%', maxWidth: 560, alignSelf: 'center' }}>
          {contenido}
        </Animated.View>
      </ScrollView>
      {!horizontal && <View style={[s.pie, { paddingBottom: ins.bottom + MEDIDA.espacio.m }]}>{boton('normal')}</View>}
      {paso === 'fiesta' && <LluviaConfeti avatar={b.avatar} />}
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  raiz: { flex: 1 },
  barra: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: MEDIDA.espacio.l, paddingBottom: 8, gap: 12 },
  lado: { width: 72 },
  progreso: { flex: 1 },
  contenido: { paddingHorizontal: MEDIDA.espacio.xl, paddingTop: MEDIDA.espacio.l, paddingBottom: MEDIDA.espacio.xxl, flexGrow: 1 },
  contenidoH: { paddingHorizontal: 48 },
  pie: { paddingHorizontal: MEDIDA.espacio.xl, paddingTop: MEDIDA.espacio.s },
  ladoH: { width: 'auto', minWidth: 72, flexDirection: 'row', alignItems: 'center', gap: 8 },
});
