/**
 * EL RECORRIDO: Claudio y ANT-ONIO, en video y con su voz, enseñan lo que hace AU-RA con ejemplos
 * animados (guion.ts + escenas/). Arriba pasa el ejemplo; abajo están los dos, el que habla al frente
 * y el otro escuchándolo; entre ellos, lo que dice, iluminándose al ritmo de la voz. Cuando el ejemplo
 * pide un toque (la foto, contestar, «sí, envíalo») el objetivo late y una indicación lo dice.
 *
 * Esta vista no sabe de audio ni de video: le pasan cómo hablar (`narrador`) y cómo dibujar a cada
 * anfitrión (`cuerpo`). En la app eso es la voz de ElevenLabs de cada uno y su cuerpo en video
 * (RecorridoApp.tsx); en la vista previa del navegador, otra cosa. Por eso aquí solo hay React Native.
 *
 * Controles: pausa, silencio (sin voz sigue con subtítulos, al ritmo de la lectura), atrás, siguiente
 * y cerrar. Con «reducir movimiento» las escenas siguen siendo legibles (lo esencial es texto).
 */
import { createElement, useCallback, useEffect, useMemo, useReducer, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { Animated, Easing, Modal, Pressable, StatusBar, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { duracionLectura, ESCENAS, siguientes, textoDe, type Anfitrion, type CaraLinea, type DemoId, type GestoLinea, type PruebaId } from './guion';
import { escenaDe, ESPERA_VOZ_MS, INICIO, lineaDe, pasoVisible, progreso, reducir, type AccionRecorrido, type EstadoRecorrido } from './motor';
import { COLOR, Icono, useVaiven, type PropsEscena } from './escenas/comun';
import { EfectoAnfitrion } from './escenas/efectos';
import { achicadoEn, momentoDe, type SonidoId, type Vibracion } from './coreografia';
import Portada from './escenas/Portada';
import Mesa from './escenas/Mesa';
import Hablar from './escenas/Hablar';
import Camara from './escenas/Camara';
import Llamada from './escenas/Llamada';
import Recordatorio from './escenas/Recordatorio';
import Avisos from './escenas/Avisos';
import Chat from './escenas/Chat';
import Whatsapp from './escenas/Whatsapp';
import Correo from './escenas/Correo';
import Internet from './escenas/Internet';
import Computadora from './escenas/Computadora';
import Memoria from './escenas/Memoria';
import Conocer from './escenas/Conocer';
import Propuestas from './escenas/Propuestas';
import Avatares from './escenas/Avatares';
import Ajustes from './escenas/Ajustes';
import Final from './escenas/Final';

const ESCENA: Record<DemoId, ComponentType<PropsEscena>> = {
  portada: Portada,
  mesa: Mesa,
  hablar: Hablar,
  camara: Camara,
  llamada: Llamada,
  recordatorio: Recordatorio,
  avisos: Avisos,
  chat: Chat,
  whatsapp: Whatsapp,
  correo: Correo,
  internet: Internet,
  computadora: Computadora,
  memoria: Memoria,
  conocer: Conocer,
  propuestas: Propuestas,
  avatares: Avatares,
  ajustes: Ajustes,
  final: Final,
};

/** Cómo habla el recorrido. `hablar` resuelve al terminar: true si sonó algo (false: sin voz, se lee). */
export type Narrador = {
  hablar(texto: string, quien: Anfitrion, emocion: string, alSonar: () => void): Promise<boolean>;
  preparar(texto: string, quien: Anfitrion, emocion: string): void;
  callar(): void;
};

/** Lo que recibe el cuerpo de cada anfitrión. */
export type PropsAnfitrion = {
  /** Es el que habla ahora (el otro lo escucha). */
  alFrente: boolean;
  hablando: boolean;
  /** El gesto pedido; `n` cambia en cada pedido aunque el gesto se repita. */
  gesto: { nombre: GestoLinea; n: number } | null;
  cara: CaraLinea | null;
  ancho: number;
  alto: number;
};

type Props = {
  visible: boolean;
  /** El nombre de la persona (lo dicen al saludar). */
  nombre: string;
  idioma: 'es' | 'en';
  narrador: Narrador;
  cuerpo: (quien: Anfitrion, p: PropsAnfitrion) => ReactNode;
  onCerrar: () => void;
  /** Al final, eligió probar algo de verdad. */
  onProbar: (id: PruebaId) => void;
  /** Para las capturas: empezar aquí. */
  inicio?: Partial<EstadoRecorrido>;
  /** Espera antes de la primera línea (la mesa suelta su audio al abrirse el recorrido). */
  retrasoMs?: number;
  /** Los sonidos y la vibración de cada momento (coreografia.ts). */
  efectos?: { sonar(s: SonidoId): void; vibrar(v: Vibracion): void };
};

type Rect = { x: number; y: number; w: number; h: number };

const NOMBRE: Record<Anfitrion, string> = { claudio: 'Claudio', antonio: 'ANT-ONIO' };
const ACENTO: Record<Anfitrion, string> = { claudio: COLOR.claudio, antonio: COLOR.antonio };

export function Recorrido({ visible, nombre, idioma, narrador, cuerpo, onCerrar, onProbar, inicio, retrasoMs = 600, efectos }: Props) {
  const [s, dispatch] = useReducer((e: EstadoRecorrido, a: AccionRecorrido) => reducir(e, a), { ...INICIO, ...inicio });
  const [listo, setListo] = useState(false);
  const [silencio, setSilencio] = useState(false);
  const [hablando, setHablando] = useState(false);
  const [desde, setDesde] = useState(0);
  /** La voz de la línea tarda en llegar (más de un momento): se dice «preparando la voz». */
  const [preparando, setPreparando] = useState(false);
  /** La voz no pudo sonar (sin red): la línea se lee. Se dice, para que no parezca trabado. */
  const [leyendo, setLeyendo] = useState(false);
  /** La vuelta cuya voz ya empezó a sonar: desde ahí se ve el paso de su línea (motor.pasoVisible). */
  const [soltado, setSoltado] = useState(0);
  /** Cuándo empezó la espera del toque (para la cuenta de «sigo solo en…»). */
  const [esperaDesde, setEsperaDesde] = useState(0);
  const [gesto, setGesto] = useState<{ quien: Anfitrion; nombre: GestoLinea; n: number } | null>(null);
  const { width: W, height: H } = useWindowDimensions();
  const horizontal = W > H;
  const escena = escenaDe(s);
  const linea = lineaDe(s);
  const quien = linea.quien;
  const texto = textoDe(linea, idioma, nombre);
  const cerrado = useRef(false);
  // El ejemplo se mueve cuando la voz de la línea empieza, no antes (motor.pasoVisible).
  const paso = pasoVisible(s, soltado);
  const momento = momentoDe(escena.id, paso);
  const achicado = achicadoEn(escena.id, paso);

  // Cada paso nuevo: su sonido y su vibración (una vez). Cada escena nueva: el golpe del capítulo.
  const ultimoPaso = useRef('');
  const ultimaEscena = useRef(-1);
  useEffect(() => {
    if (!visible || !listo || s.fase === 'fin') return;
    if (ultimaEscena.current !== s.e) {
      ultimaEscena.current = s.e;
      efectos?.sonar(s.e === 0 ? 'chispa' : 'capitulo');
    }
    const clave = `${escena.id}:${paso}`;
    if (ultimoPaso.current === clave) return;
    ultimoPaso.current = clave;
    if (momento.sonido) efectos?.sonar(momento.sonido);
    if (momento.vibra) efectos?.vibrar(momento.vibra);
  }, [visible, listo, s.e, paso]); // eslint-disable-line react-hooks/exhaustive-deps

  // Arranca un momento después de abrirse (deja que la mesa suelte su audio y que entre la pantalla).
  useEffect(() => {
    if (!visible) {
      setListo(false);
      return;
    }
    cerrado.current = false;
    ultimoPaso.current = '';
    ultimaEscena.current = -1;
    const id = setTimeout(() => setListo(true), retrasoMs);
    return () => clearTimeout(id);
  }, [visible, retrasoMs]);

  // Habla la línea en curso (o espera el toque). Cada vez que la línea empieza, `vuelta` sube.
  useEffect(() => {
    if (!visible || !listo || s.pausado) return;
    if (s.fase === 'fin') {
      if (!cerrado.current) {
        cerrado.current = true;
        onCerrar();
      }
      return;
    }
    const vuelta = s.vuelta;
    let vivo = true;
    let reloj: ReturnType<typeof setTimeout> | undefined;
    setPreparando(false);
    setLeyendo(false);
    if (s.fase === 'espera') {
      setHablando(false);
      setEsperaDesde(Date.now());
      const ms = linea.espera?.ms ?? 0;
      if (ms > 0) reloj = setTimeout(() => dispatch({ tipo: 'esperaVencio', vuelta }), ms);
      return () => clearTimeout(reloj);
    }
    // Una línea nueva: su gesto, y el audio de las que siguen se prepara mientras suena esta.
    if (linea.gesto) setGesto((g) => ({ quien, nombre: linea.gesto!, n: (g?.n ?? 0) + 1 }));
    for (const p of siguientes(s.e, s.l, 2)) {
      const l = ESCENAS[p.e].lineas[p.l];
      narrador.preparar(textoDe(l, idioma, nombre), l.quien, l.emocion || 'neutral');
    }
    const leer = (ms: number) => {
      setHablando(true);
      setDesde(Date.now());
      setSoltado(vuelta);
      reloj = setTimeout(() => vivo && dispatch({ tipo: 'termino', vuelta }), ms);
    };
    setHablando(false);
    let aviso: ReturnType<typeof setTimeout> | undefined;
    let tope: ReturnType<typeof setTimeout> | undefined;
    if (silencio) leer(duracionLectura(texto));
    else {
      const t0 = Date.now();
      let sonando = false;
      // Si la voz tarda, se avisa («preparando la voz») y, pasado el tope, el ejemplo se mueve igual.
      aviso = setTimeout(() => vivo && !sonando && setPreparando(true), 450);
      tope = setTimeout(() => vivo && setSoltado(vuelta), ESPERA_VOZ_MS);
      void narrador
        .hablar(texto, quien, linea.emocion || 'neutral', () => {
          if (!vivo) return;
          sonando = true;
          clearTimeout(aviso);
          clearTimeout(tope);
          setPreparando(false);
          setHablando(true);
          setDesde(Date.now());
          setSoltado(vuelta);
        })
        .then((sono) => {
          if (!vivo) return;
          clearTimeout(aviso);
          clearTimeout(tope);
          setPreparando(false);
          setHablando(false);
          // Sonó: una pausa corta de conversación y sigue. No sonó (sin red): se lee lo que falte.
          if (sono) reloj = setTimeout(() => vivo && dispatch({ tipo: 'termino', vuelta }), 280);
          else {
            setLeyendo(true);
            leer(Math.max(600, duracionLectura(texto) - (Date.now() - t0)));
          }
        });
    }
    return () => {
      vivo = false;
      clearTimeout(reloj);
      clearTimeout(aviso);
      clearTimeout(tope);
    };
  }, [visible, listo, s.vuelta, s.fase, s.pausado, silencio]); // eslint-disable-line react-hooks/exhaustive-deps

  // Al cerrarse (o desmontarse abierto), se calla. Cerrado desde el principio no toca la voz: la mesa
  // monta el recorrido escondido y no hay que cortarle su saludo.
  useEffect(() => {
    if (!visible) return;
    return () => narrador.callar();
  }, [visible, narrador]);

  const cerrar = useCallback(() => {
    cerrado.current = true;
    narrador.callar();
    onCerrar();
  }, [narrador, onCerrar]);

  const elegir = useCallback(
    (id: string) => {
      cerrado.current = true;
      narrador.callar();
      onProbar(id as PruebaId);
      onCerrar();
    },
    [narrador, onProbar, onCerrar]
  );

  const pausar = () => {
    if (s.pausado) dispatch({ tipo: 'sigue' });
    else {
      narrador.callar();
      setHablando(false);
      setPreparando(false);
      dispatch({ tipo: 'pausa' });
    }
  };
  const mover = (tipo: 'siguiente' | 'anterior') => {
    narrador.callar();
    setHablando(false);
    setPreparando(false);
    dispatch({ tipo });
  };
  const toggleSilencio = () => {
    narrador.callar();
    setSilencio((v) => !v);
  };

  // El que habla, al frente: los dos cuerpos se agrandan o se achican con suavidad. Va por JS, no por
  // el hilo nativo, igual que el vuelo de abajo: en Android, quitarle a una vista un estilo que movía
  // el hilo nativo la dejaba con el último valor puesto (y el estilo del cuerpo cambia al volverse
  // chiquito). Son dos vistas: no pesa.
  const frente = useRef(new Animated.Value(quien === 'claudio' ? 0 : 1)).current;
  useEffect(() => {
    Animated.timing(frente, { toValue: quien === 'claudio' ? 0 : 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [quien, frente]);

  // Cada escena entra deslizándose, con su título de capítulo y un barrido de luz (cine).
  const entra = useRef(new Animated.Value(1)).current;
  const titulo = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    entra.setValue(0);
    titulo.setValue(0);
    Animated.parallel([
      Animated.timing(entra, { toValue: 1, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.sequence([
        Animated.timing(titulo, { toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.delay(900),
        Animated.timing(titulo, { toValue: 2, duration: 460, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      ]),
    ]).start();
  }, [s.e, entra, titulo]);

  // Cada momento clave del ejemplo da un golpe de cámara: un acercamiento corto que vuelve.
  const golpe = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    golpe.setValue(1);
    Animated.spring(golpe, { toValue: 0, useNativeDriver: true, speed: 9, bounciness: 7 }).start();
  }, [paso, golpe]);

  // El vuelo de Claudio a la franja de los chats: se mide dónde está él y dónde está la franja (la
  // escena la marca) y se va para allá encogiéndose; al terminar el recordatorio, vuelve.
  //
  // Antes el vuelo iba por el hilo nativo y su estilo se ponía y se quitaba: al aterrizar, en el
  // teléfono de José, Claudio se quedaba invisible y solo se veía su nombre (2-oct, «Tus mensajes»).
  // Ahora va por JS, el estilo está siempre (en reposo: sin mover ni encoger) y al aterrizar su
  // cuadro se monta de nuevo (`aterrizajes`): su video arranca limpio, con sus fotos debajo mientras.
  const lugares = useRef<Record<string, Rect>>({});
  const caja = useRef<Record<Anfitrion, View | null>>({ claudio: null, antonio: null });
  const vuela = useRef(new Animated.Value(0)).current;
  const [vuelo, setVuelo] = useState<{ dx: number; dy: number; k: number } | null>(null);
  const [aterrizajes, setAterrizajes] = useState(0);
  /** Al terminar el recordatorio vuelve volando a su lugar (sigue redondito hasta aterrizar). */
  const [volviendo, setVolviendo] = useState<Anfitrion | null>(null);
  const enFranja = achicado ?? volviendo;
  useEffect(() => {
    if (!achicado) {
      if (!vuelo) return;
      setVolviendo('claudio');
      Animated.spring(vuela, { toValue: 0, useNativeDriver: false, speed: 7, bounciness: 5 }).start(() => {
        vuela.setValue(0);
        setVolviendo(null);
        setVuelo(null);
        setAterrizajes((n) => n + 1);
      });
      return;
    }
    setVolviendo(null);
    let vivo = true;
    // La escena mide la franja cuando el golpe de cámara del paso se asienta (~0,5 s): después, vuela.
    const id = setTimeout(() => {
      const destino = lugares.current.franja;
      caja.current[achicado]?.measureInWindow((x, y, w) => {
        if (!vivo || !destino) return;
        const lado = Math.min(w, cuerpoH);
        setVuelo({ dx: destino.x + destino.w / 2 - (x + w / 2), dy: destino.y + destino.h / 2 - (y + lado / 2), k: destino.w / lado });
        Animated.spring(vuela, { toValue: 1, useNativeDriver: false, speed: 5, bounciness: 7 }).start();
      });
    }, 560);
    return () => {
      vivo = false;
      clearTimeout(id);
    };
  }, [achicado]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible) return null;

  const arriba = (StatusBar.currentHeight ?? 0) + 8;
  const abajo = 14;
  const barraH = 52;
  const controlesH = 56;
  const libreH = H - arriba - abajo - barraH - controlesH;
  // Vertical: el ejemplo arriba y los dos abajo. Acostado: los dos a la izquierda y el ejemplo a la derecha.
  const escenarioW = horizontal ? Math.round(W * 0.58) : W;
  const escenarioH = horizontal ? libreH : Math.round(libreH * 0.56);
  const anfitrionesW = horizontal ? W - escenarioW : W;
  const anfitrionesH = horizontal ? libreH : libreH - escenarioH;
  const cuerpoW = horizontal ? anfitrionesW / 2 : W / 2;
  // Abajo va lo que dice (alto fijo: los cuerpos no saltan cuando cambia la frase) y encima, los dos.
  const subtituloH = SUBTITULO_H;
  const cuerpoH = Math.max(110, anfitrionesH - subtituloH - 24);

  const esperando = s.fase === 'espera';
  const props: PropsEscena = {
    paso,
    esperando,
    tocado: s.tocado,
    onToque: () => {
      narrador.callar();
      efectos?.sonar('tap');
      dispatch({ tipo: 'toque' });
    },
    acento: ACENTO[quien],
    idioma,
    ancho: escenarioW,
    alto: escenarioH,
    onElegir: elegir,
    marcarLugar: (nombreLugar, r) => {
      lugares.current[nombreLugar] = r;
    },
  };

  const anfitrion = (q: Anfitrion) => {
    const esClaudio = q === 'claudio';
    const alFrente = q === quien;
    const chiquito = enFranja === q;
    const escala = frente.interpolate({ inputRange: [0, 1], outputRange: esClaudio ? [1, 0.84] : [0.84, 1] });
    const opacidad = frente.interpolate({ inputRange: [0, 1], outputRange: esClaudio ? [1, 0.62] : [0.62, 1] });
    // Se achica desde los pies (no desde el centro): los dos quedan parados en el mismo piso.
    const baja = frente.interpolate({ inputRange: [0, 1], outputRange: esClaudio ? [0, cuerpoH * 0.08] : [cuerpoH * 0.08, 0] });
    // Chiquito en la franja: un círculo con su video que vuela hasta allá (y nada de achicarse por turno).
    const lado = Math.min(cuerpoW, cuerpoH);
    // Los estilos están SIEMPRE (en reposo valen «sin mover»): nunca se quita un estilo animado.
    const v = chiquito && vuelo ? vuelo : null;
    const vueloStyle = {
      transform: [
        { translateX: v ? vuela.interpolate({ inputRange: [0, 1], outputRange: [0, v.dx] }) : 0 },
        { translateY: v ? vuela.interpolate({ inputRange: [0, 1], outputRange: [0, v.dy] }) : 0 },
        { scale: v ? vuela.interpolate({ inputRange: [0, 1], outputRange: [1, v.k] }) : 1 },
      ],
    };
    const turnoStyle = chiquito ? { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] } : { opacity: opacidad, transform: [{ translateY: baja }, { scale: escala }] };
    return (
      <View key={q} ref={(r) => void (caja.current[q] = r)} collapsable={false} style={{ width: cuerpoW, zIndex: chiquito ? 5 : 1, elevation: chiquito ? 5 : 0 }}>
        <Animated.View style={[st.anfitrion, { width: cuerpoW }, turnoStyle]}>
          {alFrente && !chiquito ? <Aura color={ACENTO[q]} hablando={hablando} ancho={cuerpoW} alto={cuerpoH} /> : null}
          <Animated.View
            key={esClaudio ? `cuadro-${aterrizajes}` : 'cuadro'}
            style={[chiquito ? { width: lado, height: lado, borderRadius: lado / 2, borderWidth: 3, borderColor: ACENTO[q] } : { width: cuerpoW, height: cuerpoH, borderRadius: 24 }, { overflow: 'hidden' }, vueloStyle]}
          >
            {cuerpo(q, { alFrente, hablando: alFrente && hablando, gesto: gesto && gesto.quien === q ? { nombre: gesto.nombre, n: gesto.n } : null, cara: alFrente ? linea.cara ?? null : null, ancho: chiquito ? lado : cuerpoW, alto: chiquito ? lado : cuerpoH })}
          </Animated.View>
          {alFrente && !chiquito ? (
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, { width: cuerpoW, height: cuerpoH }]}>
              <EfectoAnfitrion key={`${escena.id}:${paso}`} efecto={momento.efecto} ancho={cuerpoW} alto={cuerpoH} acento={ACENTO[q]} />
            </View>
          ) : null}
          {chiquito ? null : (
            <View style={[st.nombre, { borderColor: ACENTO[q] }, alFrente && { backgroundColor: ACENTO[q] }]}>
              <Text style={[st.nombreTexto, { color: alFrente ? '#111' : ACENTO[q] }]}>{NOMBRE[q]}</Text>
              {alFrente && hablando ? <Text style={st.hablaTexto}> · {idioma === 'en' ? 'talking' : 'habla'}</Text> : null}
              {alFrente && preparando ? <Text style={st.hablaTexto}> · …</Text> : null}
            </View>
          )}
        </Animated.View>
      </View>
    );
  };

  return (
    <Modal visible transparent={false} animationType="fade" statusBarTranslucent onRequestClose={cerrar}>
      <View style={[st.raiz, { paddingTop: arriba, paddingBottom: abajo }]}>
        {/* El brillo de fondo toma el color del que habla. */}
        <Animated.View pointerEvents="none" style={[st.brillo, { backgroundColor: COLOR.claudio, opacity: frente.interpolate({ inputRange: [0, 1], outputRange: [0.16, 0] }) }]} />
        <Animated.View pointerEvents="none" style={[st.brillo, { backgroundColor: COLOR.antonio, opacity: frente.interpolate({ inputRange: [0, 1], outputRange: [0, 0.14] }) }]} />

        {/* Arriba: el capítulo, el avance y los controles. */}
        <View style={[st.barra, { height: barraH }]}>
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={st.capitulo} numberOfLines={1}>
              {s.e + 1}/{ESCENAS.length} · {escena.titulo[idioma]}
            </Text>
            <View style={st.avance}>
              <View style={[st.avanceLleno, { width: `${Math.round(progreso(s) * 100)}%`, backgroundColor: ACENTO[quien] }]} />
            </View>
          </View>
          <Boton etiqueta={s.pausado ? (idioma === 'en' ? 'Resume' : 'Seguir') : idioma === 'en' ? 'Pause' : 'Pausa'} onPress={pausar}>
            <Text style={st.glifo}>{s.pausado ? '▶' : '❚❚'}</Text>
          </Boton>
          <Boton etiqueta={silencio ? (idioma === 'en' ? 'Sound on' : 'Con voz') : idioma === 'en' ? 'Mute' : 'Sin voz'} onPress={toggleSilencio}>
            <View>
              <Icono nombre="volumen" tam={20} color={silencio ? COLOR.texto3 : COLOR.texto} />
              {silencio ? <View style={st.tachado} /> : null}
            </View>
          </Boton>
          <Boton etiqueta={idioma === 'en' ? 'Close the tour' : 'Cerrar el recorrido'} onPress={cerrar}>
            <Icono nombre="cerrar" tam={20} color={COLOR.texto} />
          </Boton>
        </View>

        <View style={{ flex: 1, flexDirection: horizontal ? 'row-reverse' : 'column' }}>
          {/* El ejemplo de la escena. */}
          <Animated.View
            style={{
              width: escenarioW,
              height: escenarioH,
              opacity: entra,
              transform: [{ translateX: entra.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }, { scale: golpe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.035] }) }],
            }}
          >
            {createElement(ESCENA[escena.id], { key: escena.id, ...props })}
            <Barrido avance={entra} ancho={escenarioW} alto={escenarioH} />
            <Capitulo avance={titulo} numero={s.e + 1} texto={escena.titulo[idioma]} color={ACENTO[quien]} ancho={escenarioW} alto={escenarioH} />
            {s.pausado ? <EnPausa idioma={idioma} onSeguir={pausar} /> : null}
          </Animated.View>

          {/* Los dos anfitriones, lo que dice el que habla y la indicación de tocar. */}
          <View style={{ width: anfitrionesW, height: anfitrionesH, justifyContent: 'flex-end' }}>
            <View style={[st.dos, horizontal && { flexDirection: 'row' }]}>
              {anfitrion('claudio')}
              {anfitrion('antonio')}
            </View>
            <Subtitulo texto={texto} quien={quien} hablando={hablando} desde={desde} pausado={s.pausado} alto={subtituloH} estado={s.pausado ? 'pausa' : preparando ? 'preparando' : leyendo ? 'leyendo' : null} idioma={idioma} />
            {esperando && linea.espera && !s.pausado ? <Indicacion texto={linea.espera.etiqueta[idioma]} color={ACENTO[quien]} ms={linea.espera.ms} desde={esperaDesde} idioma={idioma} /> : null}
          </View>
        </View>

        {/* Abajo: atrás y siguiente. */}
        <View style={[st.controles, { height: controlesH }]}>
          <Pressable onPress={() => mover('anterior')} style={st.mover} accessibilityRole="button" accessibilityLabel={idioma === 'en' ? 'Back' : 'Atrás'} hitSlop={8}>
            <Text style={st.moverTexto}>‹ {idioma === 'en' ? 'Back' : 'Atrás'}</Text>
          </Pressable>
          <View style={st.puntos}>
            {ESCENAS.map((e, k) => (
              <View key={e.id} style={[st.punto, k === s.e && { width: 12, backgroundColor: ACENTO[quien] }, k < s.e && { backgroundColor: COLOR.texto3 }]} />
            ))}
          </View>
          <Pressable onPress={() => mover('siguiente')} style={[st.mover, st.siguiente, { borderColor: ACENTO[quien] }]} accessibilityRole="button" accessibilityLabel={idioma === 'en' ? 'Next' : 'Siguiente'} hitSlop={8}>
            <Text style={[st.moverTexto, { color: ACENTO[quien] }]}>{idioma === 'en' ? 'Next' : 'Siguiente'} ›</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/** El brillo detrás del que habla: late suave y se aviva cuando su voz suena. */
function Aura({ color, hablando, ancho, alto }: { color: string; hablando: boolean; ancho: number; alto: number }) {
  const late = useVaiven(hablando ? 900 : 2400);
  const lado = Math.min(ancho, alto) * 1.05;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: (ancho - lado) / 2,
        top: (alto - lado) / 2,
        width: lado,
        height: lado,
        borderRadius: lado / 2,
        backgroundColor: color,
        opacity: late.interpolate({ inputRange: [0, 1], outputRange: hablando ? [0.16, 0.34] : [0.08, 0.16] }),
        transform: [{ scale: late.interpolate({ inputRange: [0, 1], outputRange: [0.92, hablando ? 1.08 : 1.0] }) }],
      }}
    />
  );
}

/** Un destello de luz que cruza el ejemplo al entrar la escena. */
function Barrido({ avance, ancho, alto }: { avance: Animated.Value; ancho: number; alto: number }) {
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: -alto * 0.25,
        left: 0,
        width: ancho * 0.28,
        height: alto * 1.5,
        backgroundColor: 'rgba(255,255,255,0.10)',
        opacity: avance.interpolate({ inputRange: [0, 0.15, 0.85, 1], outputRange: [0, 1, 1, 0] }),
        transform: [{ translateX: avance.interpolate({ inputRange: [0, 1], outputRange: [-ancho * 0.4, ancho * 1.15] }) }, { rotate: '18deg' }],
      }}
    />
  );
}

/** El título del capítulo, de cine: bandas negras, el número grande y el nombre; se va solo. */
function Capitulo({ avance, numero, texto, color, ancho, alto }: { avance: Animated.Value; numero: number; texto: string; color: string; ancho: number; alto: number }) {
  const banda = Math.round(alto * 0.11);
  const visible = avance.interpolate({ inputRange: [0, 1, 2], outputRange: [0, 1, 0] });
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(6,7,9,0.72)', opacity: visible }]} />
      <Animated.View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: banda, backgroundColor: '#000', transform: [{ translateY: avance.interpolate({ inputRange: [0, 1, 2], outputRange: [-banda, 0, -banda] }) }] }} />
      <Animated.View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: banda, backgroundColor: '#000', transform: [{ translateY: avance.interpolate({ inputRange: [0, 1, 2], outputRange: [banda, 0, banda] }) }] }} />
      <Animated.View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: alto / 2 - 60,
          alignItems: 'center',
          opacity: visible,
          transform: [{ scale: avance.interpolate({ inputRange: [0, 1, 2], outputRange: [1.25, 1, 0.92] }) }],
        }}
      >
        <Text style={[st.capNumero, { color }]}>{String(numero).padStart(2, '0')}</Text>
        <View style={[st.capLinea, { backgroundColor: color, width: Math.min(160, ancho * 0.4) }]} />
        <Text style={st.capTexto}>{texto}</Text>
      </Animated.View>
    </View>
  );
}

function Boton({ etiqueta, onPress, children }: { etiqueta: string; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={etiqueta} hitSlop={6} style={({ pressed }) => [st.boton, pressed && { backgroundColor: 'rgba(255,255,255,0.14)' }]}>
      {children}
    </Pressable>
  );
}

/**
 * Lo que dice el que habla. Las palabras se van iluminando al ritmo de la voz (por tiempo: la voz dura
 * más o menos lo que tarda en leerse). Sin voz o en pausa se ve entero.
 */
const SUBTITULO_H = 134;

/** Lo que está pasando con la voz, dicho junto al nombre: así nunca parece trabado. */
type EstadoVoz = 'preparando' | 'leyendo' | 'pausa' | null;
const ESTADO_VOZ: Record<Exclude<EstadoVoz, null>, { es: string; en: string }> = {
  preparando: { es: 'preparando la voz', en: 'getting the voice ready' },
  leyendo: { es: 'sin voz ahora · léelo', en: 'no voice right now · read it' },
  pausa: { es: 'en pausa', en: 'paused' },
};

function Subtitulo({ texto, quien, hablando, desde, pausado, alto, estado, idioma }: { texto: string; quien: Anfitrion; hablando: boolean; desde: number; pausado: boolean; alto: number; estado: EstadoVoz; idioma: 'es' | 'en' }) {
  const palabras = useMemo(() => texto.split(/(\s+)/), [texto]);
  const [ahora, setAhora] = useState(Date.now());
  useEffect(() => {
    if (!hablando) return;
    const id = setInterval(() => setAhora(Date.now()), 110);
    return () => clearInterval(id);
  }, [hablando]);
  const dura = Math.max(800, duracionLectura(texto) - 700);
  const hasta = hablando && !pausado ? Math.min(1, (ahora - desde) / dura) : 1;
  const total = texto.length || 1;
  let cuenta = 0;
  const aparece = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    aparece.setValue(0);
    Animated.timing(aparece, { toValue: 1, duration: 260, useNativeDriver: true }).start();
  }, [texto, aparece]);
  return (
    <Animated.View style={[st.subtitulo, { height: alto, borderColor: ACENTO[quien], opacity: aparece, transform: [{ translateY: aparece.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }]}>
      <View style={st.quienFila}>
        <Text style={[st.quien, { color: ACENTO[quien] }]}>{NOMBRE[quien]}</Text>
        {estado ? <Text style={st.estadoVoz}>· {ESTADO_VOZ[estado][idioma]}</Text> : null}
        {estado === 'preparando' ? <Puntos color={ACENTO[quien]} /> : null}
      </View>
      {/* La letra se ajusta al largo de la frase: siempre cabe entera en el cuadro. */}
      <Text style={[st.dice, texto.length > 140 ? st.diceLarga : texto.length > 90 ? st.diceMedia : null]} accessibilityLiveRegion="polite">
        {palabras.map((p, k) => {
          const dicha = cuenta / total <= hasta;
          cuenta += p.length;
          return (
            <Text key={k} style={!dicha && st.porDecir}>
              {p}
            </Text>
          );
        })}
      </Text>
    </Animated.View>
  );
}

/**
 * «Toca el botón…»: late mientras espera, con la cuenta de cuándo sigue solo (una barra que se vacía
 * y los segundos): así se sabe que no se trabó, que está esperando el toque.
 */
function Indicacion({ texto, color, ms, desde, idioma }: { texto: string; color: string; ms: number; desde: number; idioma: 'es' | 'en' }) {
  const v = useRef(new Animated.Value(0)).current;
  const [ahora, setAhora] = useState(Date.now());
  useEffect(() => {
    if (ms <= 0) return;
    const id = setInterval(() => setAhora(Date.now()), 250);
    return () => clearInterval(id);
  }, [ms]);
  const queda = ms > 0 ? Math.max(0, ms - (ahora - desde)) : 0;
  const segundos = Math.ceil(queda / 1000);
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 550, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 550, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  return (
    <Animated.View style={[st.indicacion, { backgroundColor: color, transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] }) }] }]}>
      <Text style={st.indicacionTexto}>👆 {texto}</Text>
      {ms > 0 ? (
        <>
          <Text style={st.indicacionCuenta}>{idioma === 'en' ? `or I’ll go on in ${segundos} s` : `o sigo solo en ${segundos} s`}</Text>
          <View style={st.indicacionBarra}>
            <View style={[st.indicacionLleno, { width: `${Math.round((queda / ms) * 100)}%` }]} />
          </View>
        </>
      ) : null}
    </Animated.View>
  );
}

/** En pausa: el ejemplo se oscurece y lo dice (con el botón para seguir), para que no parezca trabado. */
function EnPausa({ idioma, onSeguir }: { idioma: 'es' | 'en'; onSeguir: () => void }) {
  return (
    <Pressable onPress={onSeguir} accessibilityRole="button" accessibilityLabel={idioma === 'en' ? 'Resume' : 'Seguir'} style={[StyleSheet.absoluteFill, st.pausa]}>
      <View style={st.pausaBoton}>
        <Text style={st.pausaGlifo}>▶</Text>
      </View>
      <Text style={st.pausaTexto}>{idioma === 'en' ? 'Paused · tap to resume' : 'En pausa · toca para seguir'}</Text>
    </Pressable>
  );
}

/** Tres puntos que laten en fila: está en eso. */
function Puntos({ color }: { color: string }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(v, { toValue: 3, duration: 1100, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return (
    <View style={st.puntosVoz}>
      {[0, 1, 2].map((k) => (
        <Animated.View
          key={k}
          style={[st.puntoVoz, { backgroundColor: color, opacity: v.interpolate({ inputRange: [0, k, k + 0.5, k + 1, 3], outputRange: [0.25, 0.25, 1, 0.25, 0.25], extrapolate: 'clamp' }) }]}
        />
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  raiz: { flex: 1, backgroundColor: COLOR.fondo, overflow: 'hidden' },
  brillo: { position: 'absolute', left: '-25%', right: '-25%', bottom: '-30%', height: '75%', borderRadius: 9999 },
  barra: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16 },
  capitulo: { color: COLOR.texto, fontSize: 15, fontWeight: '800' },
  avance: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
  avanceLleno: { height: 4, borderRadius: 2 },
  boton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.07)' },
  glifo: { color: COLOR.texto, fontSize: 14, fontWeight: '900' },
  tachado: { position: 'absolute', left: -2, right: -2, top: 9, height: 2, backgroundColor: COLOR.rojo, transform: [{ rotate: '-35deg' }] },
  dos: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center' },
  anfitrion: { alignItems: 'center' },
  nombre: { flexDirection: 'row', alignItems: 'center', marginTop: -16, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, borderWidth: 1.5, backgroundColor: COLOR.fondo },
  nombreTexto: { fontSize: 13, fontWeight: '900', letterSpacing: 0.5 },
  hablaTexto: { color: '#111', fontSize: 12, fontWeight: '700' },
  subtitulo: { marginHorizontal: 14, marginTop: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, borderWidth: 1.5, backgroundColor: 'rgba(18,19,22,0.92)' },
  quienFila: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  quien: { fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  estadoVoz: { color: COLOR.texto2, fontSize: 11, fontWeight: '700' },
  puntosVoz: { flexDirection: 'row', gap: 3, alignItems: 'center' },
  puntoVoz: { width: 5, height: 5, borderRadius: 3 },
  dice: { color: COLOR.texto, fontSize: 17, lineHeight: 23, fontWeight: '600' },
  diceMedia: { fontSize: 15.5, lineHeight: 21 },
  diceLarga: { fontSize: 14, lineHeight: 19 },
  porDecir: { color: 'rgba(242,238,232,0.38)' },
  indicacion: { position: 'absolute', top: 6, alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999 },
  indicacionTexto: { color: '#111', fontSize: 14, fontWeight: '800', textAlign: 'center' },
  indicacionCuenta: { color: 'rgba(17,17,17,0.72)', fontSize: 11.5, fontWeight: '700', textAlign: 'center', marginTop: 1 },
  indicacionBarra: { height: 3, borderRadius: 2, marginTop: 5, backgroundColor: 'rgba(17,17,17,0.18)', overflow: 'hidden' },
  indicacionLleno: { height: 3, borderRadius: 2, backgroundColor: 'rgba(17,17,17,0.7)' },
  pausa: { backgroundColor: 'rgba(6,7,9,0.62)', alignItems: 'center', justifyContent: 'center', gap: 10 },
  pausaBoton: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.35)' },
  pausaGlifo: { color: COLOR.texto, fontSize: 24, fontWeight: '900', marginLeft: 4 },
  pausaTexto: { color: COLOR.texto, fontSize: 15, fontWeight: '800' },
  capNumero: { fontSize: 64, fontWeight: '900', letterSpacing: 4, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 12 },
  capLinea: { height: 3, borderRadius: 2, marginVertical: 6 },
  capTexto: { color: COLOR.texto, fontSize: 24, fontWeight: '800', letterSpacing: 1 },
  controles: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14 },
  mover: { minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 22 },
  siguiente: { borderWidth: 1.5 },
  moverTexto: { color: COLOR.texto2, fontSize: 15, fontWeight: '800' },
  // 18 capítulos: los puntos se achican para caber entre «Atrás» y «Siguiente» en un teléfono angosto.
  puntos: { flexDirection: 'row', gap: 3, alignItems: 'center', flexShrink: 1, flexWrap: 'wrap', justifyContent: 'center' },
  punto: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: 'rgba(255,255,255,0.18)' },
});
