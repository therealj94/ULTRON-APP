/**
 * LA PRIMERA VEZ: cuando el perfil no está `completado`, entre la entrada y la mesa.
 *
 * Arriba, «atrás» y la barra dorada de progreso (avanza con un resorte en cada paso); en medio, el
 * paso, que entra deslizándose desde el lado hacia donde se va (adelante desde la derecha, atrás
 * desde la izquierda; el que se va desaparece al instante, sin quedar encima); abajo, el botón para seguir. Los pasos y sus reglas viven en flujo.ts.
 *
 * Se guarda sobre la marcha: cada «Siguiente» escribe en el perfil lo de ese paso (lib/perfil.ts: al
 * instante en el teléfono y después en el servidor, sin esperar), y el número de paso queda anotado
 * en el teléfono; si Android cierra la app a la mitad, se retoma donde se quedó. Cada respuesta de la
 * encuesta (y el apodo) va también a «lo que sé de ti» (bienvenida/conocer.ts). Al final se marca
 * `completado`, se deja el avatar elegido en los ajustes que lee la mesa, y a la mesa, que lo
 * presenta con su voz.
 *
 * PRIMERO UN RESULTADO (AUR11): empieza por lo que quiere resolver, pide solo la restricción que cambia el
 * resultado y deja la primera petición lista (el paso «listo»); de ahí puede ir directo a la mesa, con la
 * petición escrita en su caja (sesion.ts marcarPrimeraPeticion), o personalizar primero. Cada persona
 * recorre SU plan (flujo.ts pasosDelPlan: la cuenta y los permisos solo si el objetivo los necesita). El
 * objetivo se guarda aparte (no va al perfil) para retomarlo, y quien iba a mitad con la versión de antes
 * retoma donde estaba (las claves v3 y v2 de siempre, flujo.ts pasoRetomado).
 *
 * EL PRIMER RESULTADO, MEDIDO (auditoría del 4-oct, P4 · R1; medida.ts): la petición que queda en la mesa es
 * un borrador, no el resultado. Aquí se abre el registro de la cuenta (cuándo empezó), se cuentan los toques
 * (seguir, saltar, atrás; si saltó conectar) y se deja la petición; la mesa sigue hasta el resultado de verdad.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { FadeInLeft, FadeInRight } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { tr, useIdioma } from '../i18n';
import { guardarPerfil, usePerfil } from '../lib/perfil';
import { saveSettings } from '../lib/storage';
import { frenarArranque } from '../lib/barreraOta';
import { setAvatarVoz, stopSpeaking } from '../lib/tts';
import { MEDIDA, useTema } from '../nucleo/tema';
import { BarraProgreso, Boton, BotonRedondo, vibrar } from '../ui';
import type { RaizParams } from '../app/rutas';
import { reiniciarA } from '../app/rutas';
import { marcarPrimeraPeticion, marcarRecienElegido, useUsuario } from '../app/sesion';
import {
  PASOS,
  anteriorEn,
  borradorDesde,
  cambiosDe,
  cambiosDelPaso,
  objetivoGuardado,
  pasoRetomado,
  pasosDelPlan,
  peticionInicial,
  preguntaDe,
  progresoEn,
  puedeSeguir,
  saltable,
  siguienteEn,
  type Borrador,
  type PasoId,
} from './flujo';
import { anotarEnConocer } from '../bienvenida/conocer';
import { anotarPrimer, empezarPrimer } from './medida';
import { PasoApodo } from './pasos/PasoApodo';
import { PasoAura } from './pasos/PasoAura';
import { PasoAvatar } from './pasos/PasoAvatar';
import { PasoConectar } from './pasos/PasoConectar';
import { LluviaConfeti, PasoFiesta } from './pasos/PasoFiesta';
import { PasoGenesis } from './pasos/PasoGenesis';
import { PasoIdioma } from './pasos/PasoIdioma';
import { PasoIniciativa } from './pasos/PasoIniciativa';
import { PasoListo } from './pasos/PasoListo';
import { PasoObjetivo } from './pasos/PasoObjetivo';
import { PasoPermisos } from './pasos/PasoPermisos';
import { PasoPregunta } from './pasos/PasoPregunta';
import { PasoRestriccion } from './pasos/PasoRestriccion';
import { PasoTema } from './pasos/PasoTema';
import type { PropsPaso } from './pasos/tipos';

type Props = NativeStackScreenProps<RaizParams, 'PrimeraVez'>;

// v3: se guarda el NOMBRE del paso (no su número): al llegar «conectar» los números se corrieron, y así un
// paso nuevo no vuelve a mandar a nadie a otra pregunta. v2 (número) se lee una vez como respaldo, con los
// pasos de entonces (flujo.ts PASOS_V2, congelados).
const CLAVE_PASO = (correo: string) => `aura.primeravez.paso.v3:${correo.trim().toLowerCase()}`;
const CLAVE_PASO_V2 = (correo: string) => `aura.primeravez.paso.v2:${correo.trim().toLowerCase()}`;
/** Lo que quiere resolver primero y su restricción (no van al perfil): para retomar y para la mesa. */
const CLAVE_OBJETIVO = (correo: string) => `aura.primeravez.objetivo.v1:${correo.trim().toLowerCase()}`;

export function PrimeraVez(_: Props) {
  const idioma = useIdioma();
  const tema = useTema();
  const ins = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const horizontal = width > height && width > 600;
  const perfil = usePerfil();
  const usuario = useUsuario();
  const [dir, setDir] = useState<1 | -1>(1);
  const [b, setB] = useState<Borrador>(() => borradorDesde(perfil, usuario?.name));
  const [terminando, setTerminando] = useState(false);
  const scroll = useRef<ScrollView>(null);
  /** La persona ya tocó algo (no se la manda a la mesa aunque el servidor diga tarde que terminó). */
  const tocado = useRef(false);
  // El plan de esta persona: cambia con su objetivo (la cuenta y los permisos solo si hacen falta).
  const plan = useMemo(() => pasosDelPlan(b), [b.objetivo, b.objetivoTexto, b.restriccion]); // eslint-disable-line react-hooks/exhaustive-deps
  const [paso, setPaso] = useState<PasoId>(PASOS[0]);
  const i = Math.max(0, plan.indexOf(paso));

  // Mientras está en la primera vez, la actualización por aire no recarga como `arranque` (revisión 7.5, MENOR 3): se
  // aplica en el próximo momento seguro.
  useEffect(() => frenarArranque('primera-vez'), []);

  // Retomar donde se quedó (si Android cerró la app a la mitad), con su objetivo.
  useEffect(() => {
    if (!usuario) return;
    // El primer resultado empieza a contar aquí (si ya había empezado, se conserva su inicio).
    void empezarPrimer(usuario.correo);
    void (async () => {
      const [v3, v2, obj] = await Promise.all([
        AsyncStorage.getItem(CLAVE_PASO(usuario.correo)),
        AsyncStorage.getItem(CLAVE_PASO_V2(usuario.correo)),
        AsyncStorage.getItem(CLAVE_OBJETIVO(usuario.correo)),
      ]);
      // Si mientras tanto ya empezó a tocar, no se le mueve.
      if (tocado.current) return;
      const guardado = objetivoGuardado(obj);
      if (Object.keys(guardado).length) setB((x) => ({ ...x, ...guardado }));
      const donde = pasoRetomado(pasosDelPlan(guardado), v3, v2 === null ? null : Number(v2));
      if (donde !== PASOS[0]) setPaso(donde);
    })().catch(() => {});
  }, [usuario]);

  // El objetivo se guarda aparte al cambiar (si Android cierra la app, la petición no se pierde).
  useEffect(() => {
    if (!usuario || !tocado.current) return;
    const { objetivo, objetivoTexto, restriccion } = b;
    void AsyncStorage.setItem(CLAVE_OBJETIVO(usuario.correo), JSON.stringify({ objetivo, objetivoTexto, restriccion })).catch(() => {});
  }, [b.objetivo, b.objetivoTexto, b.restriccion, usuario]); // eslint-disable-line react-hooks/exhaustive-deps

  // Si el perfil llega del servidor después de montar (nombre y cumple de Genesis), se completan los huecos.
  useEffect(() => {
    if (!perfil) return;
    setB((x) => ({
      ...x,
      apodo: x.apodo || borradorDesde(perfil, usuario?.name).apodo,
      cumple: x.cumple ?? perfil.cumple,
    }));
  }, [perfil, usuario]);

  // Si el servidor contesta tarde que esta persona ya había terminado la primera vez (otro teléfono,
  // o la intro no alcanzó a esperarlo), no se la hace repetir: a la mesa, antes de que toque nada.
  useEffect(() => {
    if (perfil?.completado && !tocado.current && i === 0 && !terminando) reiniciarA('Mesa');
  }, [perfil, i, terminando]);

  const cambiar = useCallback((c: Partial<Borrador>) => {
    tocado.current = true;
    setB((x) => ({ ...x, ...c }));
  }, []);

  const ir = useCallback(
    (nuevo: PasoId, d: 1 | -1) => {
      tocado.current = true;
      void stopSpeaking();
      setDir(d);
      setPaso(nuevo);
      scroll.current?.scrollTo({ y: 0, animated: false });
      if (usuario) void AsyncStorage.setItem(CLAVE_PASO(usuario.correo), nuevo).catch(() => {});
    },
    [usuario]
  );

  const terminar = useCallback(async () => {
    if (terminando) return;
    setTerminando(true);
    vibrar('exito');
    guardarPerfil({ ...cambiosDe(b, true) });
    setAvatarVoz(b.avatar);
    // El miniresultado: la primera petición queda escrita en la mesa (no se manda sola).
    marcarPrimeraPeticion(peticionInicial(b, idioma === 'en' ? 'en' : 'es'));
    // Y queda anotada en el registro de la cuenta (para medir y para recuperarla si se cierra la app): es un
    // borrador, no el resultado. Se espera para que la mesa ya la encuentre preparada.
    if (usuario) {
      await anotarPrimer(usuario.correo, { tipo: 'toque', accion: 'seguir', paso });
      await anotarPrimer(usuario.correo, { tipo: 'preparar', peticion: peticionInicial(b, idioma === 'en' ? 'en' : 'es') });
    }
    // La mesa lee el avatar y el idioma de los ajustes del teléfono al abrirse: que ya estén.
    await saveSettings({ avatar: b.avatar, avatarElegido: true }).catch(() => {});
    if (usuario) await AsyncStorage.multiRemove([CLAVE_PASO(usuario.correo), CLAVE_PASO_V2(usuario.correo), CLAVE_OBJETIVO(usuario.correo)]).catch(() => {});
    marcarRecienElegido(true);
    reiniciarA('Mesa', { recienElegido: true });
  }, [b, terminando, usuario, idioma, paso]);

  const avanzar = useCallback(() => {
    if (!puedeSeguir(paso, b)) {
      vibrar('aviso');
      return;
    }
    if (paso === 'fiesta') return void terminar();
    const c = cambiosDelPaso(paso, b);
    if (c) guardarPerfil(c);
    // También en «lo que sé de ti» (sin esperar; si falla, el perfil ya lo tiene).
    void anotarEnConocer(paso, b);
    if (usuario) void anotarPrimer(usuario.correo, { tipo: 'toque', accion: 'seguir', paso });
    vibrar('seleccion');
    ir(siguienteEn(plan, paso), 1);
  }, [paso, b, plan, ir, terminar, usuario]);

  const volver = useCallback(() => {
    if (i === 0) return false;
    if (usuario) void anotarPrimer(usuario.correo, { tipo: 'toque', accion: 'atras', paso });
    ir(anteriorEn(plan, paso), -1);
    return true;
  }, [i, plan, paso, ir, usuario]);

  /** Saltar deja en blanco lo de este paso (aunque se hubiera tocado algún chip) y sigue en el plan que queda. */
  const saltar = () => {
    const q = preguntaDe(paso);
    let nb = b;
    if (q) {
      const e = { ...b.encuesta };
      delete e[q.campo];
      nb = { ...b, encuesta: e };
    } else if (paso === 'objetivo') nb = { ...b, objetivo: undefined, objetivoTexto: undefined, restriccion: undefined };
    else if (paso === 'restriccion') nb = { ...b, restriccion: undefined };
    tocado.current = true;
    setB(nb);
    if (usuario) void anotarPrimer(usuario.correo, { tipo: 'toque', accion: 'saltar', paso });
    vibrar('seleccion');
    ir(siguienteEn(pasosDelPlan(nb), paso), 1);
  };

  /**
   * Las preguntas de la encuesta, de una vez: lo ya contestado se queda y se sigue en la iniciativa. Lo
   * saltado se retoma desde la mesa (Más → Qué puedo hacer → «Contarte de mí»).
   */
  const saltarEncuesta = () => {
    const q = preguntaDe(paso);
    if (q) {
      const e = { ...b.encuesta };
      delete e[q.campo];
      setB((x) => ({ ...x, encuesta: e }));
    }
    if (usuario) void anotarPrimer(usuario.correo, { tipo: 'toque', accion: 'saltar', paso });
    vibrar('seleccion');
    ir('iniciativa', 1);
  };

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', volver);
    return () => sub.remove();
  }, [volver]);

  const props: PropsPaso = { perfil, borrador: b, cambiar, avanzar, horizontal };
  const q = preguntaDe(paso);
  const contenido =
    paso === 'objetivo' ? (
      <PasoObjetivo {...props} />
    ) : paso === 'restriccion' ? (
      <PasoRestriccion {...props} />
    ) : paso === 'listo' ? (
      <PasoListo {...props} />
    ) : paso === 'genesis' ? (
      <PasoGenesis {...props} />
    ) : paso === 'idioma' ? (
      <PasoIdioma {...props} />
    ) : paso === 'apodo' ? (
      <PasoApodo {...props} />
    ) : paso === 'avatar' ? (
      <PasoAvatar {...props} />
    ) : paso === 'tema' ? (
      <PasoTema {...props} />
    ) : paso === 'aura' ? (
      <PasoAura {...props} />
    ) : paso === 'conectar' ? (
      <PasoConectar {...props} />
    ) : q ? (
      <PasoPregunta key={q.campo} {...props} pregunta={q} />
    ) : paso === 'iniciativa' ? (
      <PasoIniciativa {...props} />
    ) : paso === 'permisos' ? (
      <PasoPermisos {...props} />
    ) : (
      <PasoFiesta {...props} />
    );

  const titulo =
    paso === 'fiesta' ? tr('Ir a la mesa', 'Go to the desk') : paso === 'listo' ? tr('Usar mi petición ahora', 'Use my request now') : paso === 'permisos' ? tr('Continuar', 'Continue') : tr('Siguiente', 'Next');
  // En el miniresultado, el botón principal termina ya (con la petición escrita en la mesa).
  const termina = paso === 'fiesta' || paso === 'listo';

  const boton = (tam: 'normal' | 'chico') => (
    <Boton
      titulo={titulo}
      tam={tam}
      iconoDerecha={termina ? undefined : 'flecha'}
      icono={termina ? 'chispas' : undefined}
      onPress={paso === 'listo' ? () => void terminar() : avanzar}
      deshabilitado={!puedeSeguir(paso, b)}
      cargando={terminando}
    />
  );

  return (
    <KeyboardAvoidingView style={[s.raiz, { backgroundColor: tema.fondo }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={[s.barra, { paddingTop: ins.top + 6 }]}>
        <View style={s.lado}>{i > 0 && paso !== 'fiesta' && <BotonRedondo onPress={volver} />}</View>
        <View style={s.progreso}>
          <BarraProgreso valor={progresoEn(plan, paso)} alto={5} />
        </View>
        <View style={[s.lado, { alignItems: 'flex-end' }, horizontal && s.ladoH]}>
          {paso.startsWith('encuesta:') && <Boton titulo={tr('Saltar todas', 'Skip all')} variante="fantasma" tam="chico" onPress={saltarEncuesta} />}
          {saltable(paso) && <Boton titulo={tr('Saltar', 'Skip')} variante="fantasma" tam="chico" onPress={saltar} />}
          {/* Acostado, el botón para seguir va arriba: la pantalla es baja y el paso necesita el alto. */}
          {horizontal && boton('chico')}
        </View>
      </View>
      {/* El confeti cae detrás del contenido y del botón: se ve todo, no tapa nada. */}
      {paso === 'fiesta' && <LluviaConfeti avatar={b.avatar} />}
      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        contentContainerStyle={[s.contenido, horizontal && s.contenidoH]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Sin animación de salida: el paso que se va queda un rato como vista «fantasma» encima del que
            llega (la salida de Reanimated deja la vista nativa montada sin su nodo de React) y, mientras dura
            o si se atasca en Android, puede tragarse los toques de lo que tiene debajo. Por si acaso (José,
            5-oct, el cumpleaños en un Samsung), el paso nuevo es lo único que hay encima. */}
        <Animated.View key={paso} entering={(dir > 0 ? FadeInRight : FadeInLeft).springify().damping(20).stiffness(170)} style={{ width: '100%', maxWidth: 560, alignSelf: 'center' }}>
          {contenido}
        </Animated.View>
      </ScrollView>
      {!horizontal && <View style={[s.pie, { paddingBottom: ins.bottom + MEDIDA.espacio.m }]}>{boton('normal')}</View>}
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
