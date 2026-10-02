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
import { duracionLectura, ESCENAS, pasoEn, siguientes, textoDe, type Anfitrion, type CaraLinea, type DemoId, type GestoLinea, type PruebaId } from './guion';
import { escenaDe, INICIO, lineaDe, progreso, reducir, type AccionRecorrido, type EstadoRecorrido } from './motor';
import { COLOR, Icono, type PropsEscena } from './escenas/comun';
import Portada from './escenas/Portada';
import Hablar from './escenas/Hablar';
import Camara from './escenas/Camara';
import Llamada from './escenas/Llamada';
import Recordatorio from './escenas/Recordatorio';
import Chat from './escenas/Chat';
import Correo from './escenas/Correo';
import Internet from './escenas/Internet';
import Computadora from './escenas/Computadora';
import Memoria from './escenas/Memoria';
import Avatares from './escenas/Avatares';
import Final from './escenas/Final';

const ESCENA: Record<DemoId, ComponentType<PropsEscena>> = {
  portada: Portada,
  hablar: Hablar,
  camara: Camara,
  llamada: Llamada,
  recordatorio: Recordatorio,
  chat: Chat,
  correo: Correo,
  internet: Internet,
  computadora: Computadora,
  memoria: Memoria,
  avatares: Avatares,
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
};

const NOMBRE: Record<Anfitrion, string> = { claudio: 'Claudio', antonio: 'ANT-ONIO' };
const ACENTO: Record<Anfitrion, string> = { claudio: COLOR.claudio, antonio: COLOR.antonio };

export function Recorrido({ visible, nombre, idioma, narrador, cuerpo, onCerrar, onProbar, inicio, retrasoMs = 600 }: Props) {
  const [s, dispatch] = useReducer((e: EstadoRecorrido, a: AccionRecorrido) => reducir(e, a), { ...INICIO, ...inicio });
  const [listo, setListo] = useState(false);
  const [silencio, setSilencio] = useState(false);
  const [hablando, setHablando] = useState(false);
  const [desde, setDesde] = useState(0);
  const [gesto, setGesto] = useState<{ quien: Anfitrion; nombre: GestoLinea; n: number } | null>(null);
  const { width: W, height: H } = useWindowDimensions();
  const horizontal = W > H;
  const escena = escenaDe(s);
  const linea = lineaDe(s);
  const quien = linea.quien;
  const texto = textoDe(linea, idioma, nombre);
  const cerrado = useRef(false);

  // Arranca un momento después de abrirse (deja que la mesa suelte su audio y que entre la pantalla).
  useEffect(() => {
    if (!visible) {
      setListo(false);
      return;
    }
    cerrado.current = false;
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
    if (s.fase === 'espera') {
      setHablando(false);
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
      reloj = setTimeout(() => vivo && dispatch({ tipo: 'termino', vuelta }), ms);
    };
    setHablando(false);
    if (silencio) leer(duracionLectura(texto));
    else {
      const t0 = Date.now();
      void narrador
        .hablar(texto, quien, linea.emocion || 'neutral', () => {
          if (!vivo) return;
          setHablando(true);
          setDesde(Date.now());
        })
        .then((sono) => {
          if (!vivo) return;
          setHablando(false);
          // Sonó: una pausa corta de conversación y sigue. No sonó (sin red): se lee lo que falte.
          if (sono) reloj = setTimeout(() => vivo && dispatch({ tipo: 'termino', vuelta }), 280);
          else leer(Math.max(600, duracionLectura(texto) - (Date.now() - t0)));
        });
    }
    return () => {
      vivo = false;
      clearTimeout(reloj);
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
      dispatch({ tipo: 'pausa' });
    }
  };
  const mover = (tipo: 'siguiente' | 'anterior') => {
    narrador.callar();
    setHablando(false);
    dispatch({ tipo });
  };
  const toggleSilencio = () => {
    narrador.callar();
    setSilencio((v) => !v);
  };

  // El que habla, al frente: los dos cuerpos se agrandan o se achican con suavidad.
  const frente = useRef(new Animated.Value(quien === 'claudio' ? 0 : 1)).current;
  useEffect(() => {
    Animated.timing(frente, { toValue: quien === 'claudio' ? 0 : 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [quien, frente]);

  // Cada escena entra deslizándose.
  const entra = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    entra.setValue(0);
    Animated.timing(entra, { toValue: 1, duration: 480, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [s.e, entra]);

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
    paso: pasoEn(escena, s.l),
    esperando,
    tocado: s.tocado,
    onToque: () => {
      narrador.callar();
      dispatch({ tipo: 'toque' });
    },
    acento: ACENTO[quien],
    idioma,
    ancho: escenarioW,
    alto: escenarioH,
    onElegir: elegir,
  };

  const anfitrion = (q: Anfitrion) => {
    const esClaudio = q === 'claudio';
    const alFrente = q === quien;
    const escala = frente.interpolate({ inputRange: [0, 1], outputRange: esClaudio ? [1, 0.84] : [0.84, 1] });
    const opacidad = frente.interpolate({ inputRange: [0, 1], outputRange: esClaudio ? [1, 0.62] : [0.62, 1] });
    // Se achica desde los pies (no desde el centro): los dos quedan parados en el mismo piso.
    const baja = frente.interpolate({ inputRange: [0, 1], outputRange: esClaudio ? [0, cuerpoH * 0.08] : [cuerpoH * 0.08, 0] });
    return (
      <Animated.View key={q} style={[st.anfitrion, { width: cuerpoW, opacity: opacidad, transform: [{ translateY: baja }, { scale: escala }] }]}>
        <View style={{ width: cuerpoW, height: cuerpoH, overflow: 'hidden', borderRadius: 24 }}>
          {cuerpo(q, { alFrente, hablando: alFrente && hablando, gesto: gesto && gesto.quien === q ? { nombre: gesto.nombre, n: gesto.n } : null, cara: alFrente ? linea.cara ?? null : null, ancho: cuerpoW, alto: cuerpoH })}
        </View>
        <View style={[st.nombre, { borderColor: ACENTO[q] }, alFrente && { backgroundColor: ACENTO[q] }]}>
          <Text style={[st.nombreTexto, { color: alFrente ? '#111' : ACENTO[q] }]}>{NOMBRE[q]}</Text>
          {alFrente && hablando ? <Text style={st.hablaTexto}> · {idioma === 'en' ? 'talking' : 'habla'}</Text> : null}
        </View>
      </Animated.View>
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
          <Animated.View style={{ width: escenarioW, height: escenarioH, opacity: entra, transform: [{ translateX: entra.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }] }}>
            {createElement(ESCENA[escena.id], { key: escena.id, ...props })}
          </Animated.View>

          {/* Los dos anfitriones, lo que dice el que habla y la indicación de tocar. */}
          <View style={{ width: anfitrionesW, height: anfitrionesH, justifyContent: 'flex-end' }}>
            <View style={[st.dos, horizontal && { flexDirection: 'row' }]}>
              {anfitrion('claudio')}
              {anfitrion('antonio')}
            </View>
            <Subtitulo texto={texto} quien={quien} hablando={hablando} desde={desde} pausado={s.pausado} alto={subtituloH} />
            {esperando && linea.espera ? <Indicacion texto={linea.espera.etiqueta[idioma]} color={ACENTO[quien]} /> : null}
          </View>
        </View>

        {/* Abajo: atrás y siguiente. */}
        <View style={[st.controles, { height: controlesH }]}>
          <Pressable onPress={() => mover('anterior')} style={st.mover} accessibilityRole="button" accessibilityLabel={idioma === 'en' ? 'Back' : 'Atrás'} hitSlop={8}>
            <Text style={st.moverTexto}>‹ {idioma === 'en' ? 'Back' : 'Atrás'}</Text>
          </Pressable>
          <View style={st.puntos}>
            {ESCENAS.map((e, k) => (
              <View key={e.id} style={[st.punto, k === s.e && { width: 16, backgroundColor: ACENTO[quien] }, k < s.e && { backgroundColor: COLOR.texto3 }]} />
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

function Subtitulo({ texto, quien, hablando, desde, pausado, alto }: { texto: string; quien: Anfitrion; hablando: boolean; desde: number; pausado: boolean; alto: number }) {
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
      <Text style={[st.quien, { color: ACENTO[quien] }]}>{NOMBRE[quien]}</Text>
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

/** «Toca el botón…»: late mientras espera. */
function Indicacion({ texto, color }: { texto: string; color: string }) {
  const v = useRef(new Animated.Value(0)).current;
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
    </Animated.View>
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
  quien: { fontSize: 11, fontWeight: '900', letterSpacing: 1, marginBottom: 2 },
  dice: { color: COLOR.texto, fontSize: 17, lineHeight: 23, fontWeight: '600' },
  diceMedia: { fontSize: 15.5, lineHeight: 21 },
  diceLarga: { fontSize: 14, lineHeight: 19 },
  porDecir: { color: 'rgba(242,238,232,0.38)' },
  indicacion: { position: 'absolute', top: 6, alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999 },
  indicacionTexto: { color: '#111', fontSize: 14, fontWeight: '800' },
  controles: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14 },
  mover: { minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 22 },
  siguiente: { borderWidth: 1.5 },
  moverTexto: { color: COLOR.texto2, fontSize: 15, fontWeight: '800' },
  puntos: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  punto: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.18)' },
});
