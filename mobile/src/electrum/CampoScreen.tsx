/**
 * LA PANTALLA DE CAMPO.
 *
 * Es la razón de que esta app exista en vez de ser la web guardada en la pantalla de inicio. Todo
 * lo que hace aquí es lo que un navegador hace mal o no hace:
 *
 *  · **«¿Dónde estoy y de quién es esto?»** Parado sobre el terreno, el GPS da el punto y el
 *    catastro contesta. Es LA pregunta del campo, y la única respuesta que no se puede fingir.
 *  · **Hablarle con las manos sucias.** En un cerro nadie escribe en un teclado de vidrio.
 *  · **Enseñarle lo que estás viendo.** Un afloramiento, un testigo, la hoja de un expediente.
 *
 * El resto —el mapa grande, los informes, cargar el catastro— vive en la web, donde hay pantalla.
 * Meterlo todo aquí sería hacer una web peor dentro de una app.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import { Audio } from 'expo-av';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { UltronFace } from '../components/UltronFace';
import { ACENTO } from '../variante';
import { preguntar, salud, subirFoto, voz, SinPuerta, type Salud, type Traza } from './api';
import { dictadoDisponible, escuchar, type Escucha } from './dictado';
import type { FaceState } from '../config';

type Turno = { de: 'persona' | 'doctor'; texto: string; panel?: string; traza?: Traza[] };

const GRIS = '#8FA3B0';
const TENUE = '#6C7F89';

export function CampoScreen({ onSalir }: { onSalir: () => void }) {
  const [turnos, setTurnos] = useState<Turno[]>([]);
  /*
   * `mandar` no puede depender de `turnos` sin reharse en cada mensaje; una ref siempre tiene el
   * hilo de ahora, que es el que hay que mandar.
   */
  const turnosRef = useRef<Turno[]>(turnos);
  turnosRef.current = turnos;
  const [texto, setTexto] = useState('');
  const [pensando, setPensando] = useState(false);
  const [cara, setCara] = useState<FaceState>('IDLE');
  const [estado, setEstado] = useState<Salud | null>(null);
  const [vozActiva, setVozActiva] = useState(true);
  const hilo = useRef<ScrollView>(null);
  const sonido = useRef<Audio.Sound | null>(null);

  /*
   * VERTICAL U HORIZONTAL, según cómo esté el teléfono.
   *
   * La versión anterior era horizontal a secas, con una razón buena: apilar cara, hilo y botones
   * deja la conversación en una rendija de cuatro renglones cuando el teléfono está tumbado. Pero
   * en el campo casi nunca está tumbado: se saca del bolsillo con una mano, con la otra ocupada en
   * la brújula, el martillo o el volante. Ahora manda la forma de la pantalla — dos columnas
   * cuando hay ancho, una sola cuando no — y en vertical lo que se toca queda abajo, al alcance
   * del pulgar, que es lo único que llega.
   */
  const { width, height } = useWindowDimensions();
  const apaisado = width > height;

  const [oyendo, setOyendo] = useState(false);
  const escucha = useRef<Escucha | null>(null);
  const hayMicro = dictadoDisponible();

  const [camara, setCamara] = useState(false);
  const [permisoCamara, pedirPermisoCamara] = useCameraPermissions();
  const lente = useRef<CameraView | null>(null);
  const [tomando, setTomando] = useState(false);

  useEffect(() => {
    salud().then(setEstado).catch(() => setEstado(null));
    // Que el audio suene aunque el teléfono esté en silencio: en el campo el timbre va apagado.
    Audio.setAudioModeAsync({ playsInSilentModeIOS: true, staysActiveInBackground: false }).catch(() => {});
    return () => {
      void sonido.current?.unloadAsync();
    };
  }, []);

  const decir = useCallback(
    async (t: string, emocion?: string) => {
      if (!vozActiva) return;
      const url = await voz(t, emocion);
      if (!url) return;
      try {
        await sonido.current?.unloadAsync();
        const { sound } = await Audio.Sound.createAsync({ uri: url }, { shouldPlay: true });
        sonido.current = sound;
      } catch {
        /* sin voz se sigue leyendo */
      }
    },
    [vozActiva]
  );

  const mandar = useCallback(
    async (mensaje: string) => {
      const q = mensaje.trim();
      if (!q || pensando) return;
      setTexto('');
      setTurnos((t) => [...t, { de: 'persona', texto: q }]);
      setPensando(true);
      setCara('THINKING');
      try {
        const r = await preguntar(q, turnosRef.current.map((t) => ({ de: t.de, texto: t.texto })));
        setTurnos((t) => [...t, { de: 'doctor', texto: r.texto, panel: r.panel, traza: r.traza }]);
        setCara('SPEAKING');
        void decir(r.texto, r.emocion);
      } catch (e) {
        const msg =
          e instanceof SinPuerta
            ? 'Esta sesión ya no tiene acceso. Volvé a entrar.'
            : `No pude contestar: ${String((e as Error)?.message || e).slice(0, 120)}`;
        setTurnos((t) => [...t, { de: 'doctor', texto: msg }]);
        setCara('CONCERNED');
        if (e instanceof SinPuerta) onSalir();
      } finally {
        setPensando(false);
        setTimeout(() => setCara('IDLE'), 1400);
      }
    },
    [pensando, decir, onSalir]
  );

  /* --------------------------------------------------------------- hablarle */

  /**
   * Apretar, hablar, soltar. El texto cae en la caja **y ahí se queda**: no se manda solo.
   *
   * Parece un paso de más y no lo es. El reconocedor confunde nombres de concesión —«Quebrada Seca»
   * sale «que brava seca» más veces de las que uno quiere— y en el campo discutir con la respuesta
   * a una pregunta que no se hizo cuesta más que mirar el renglón antes de tocar Ir.
   */
  const alternarMicro = useCallback(async () => {
    if (escucha.current) {
      escucha.current.parar();
      return;
    }
    const e = await escuchar({
      onParcial: (t) => setTexto(t),
      onFinal: (t) => setTexto(t),
      onFin: () => {
        escucha.current = null;
        setOyendo(false);
        setCara('IDLE');
      },
      onError: (motivo) => Alert.alert('Micrófono', motivo),
    });
    if (e) {
      escucha.current = e;
      setOyendo(true);
      setCara('LISTENING');
    }
  }, []);

  // Salir de la pantalla con el micrófono abierto lo dejaría abierto. En el campo eso es la batería.
  useEffect(() => () => escucha.current?.parar(), []);

  /* --------------------------------------------------------------- enseñarle */

  /**
   * La foto de un papel. Va al cerebro, no al chat: sale transcrita y queda en el expediente,
   * buscable por su número de resolución. Que después alguien pregunte «¿qué dice la resolución de
   * Quebrada Seca?» y aparezca, eso es lo que la hace valer; enseñarla y olvidarla, no.
   */
  const abrirCamara = useCallback(async () => {
    if (!permisoCamara?.granted) {
      const r = await pedirPermisoCamara();
      if (!r?.granted) {
        Alert.alert('Cámara', 'Sin permiso de cámara no puedo leer el papel que tengas delante.');
        return;
      }
    }
    setCamara(true);
  }, [permisoCamara, pedirPermisoCamara]);

  const tomarFoto = useCallback(async () => {
    if (tomando) return;
    setTomando(true);
    try {
      const foto = await lente.current?.takePictureAsync({ quality: 0.8, skipProcessing: false });
      setCamara(false);
      if (!foto?.uri) return;
      const nombre = `plano-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.jpg`;
      setTurnos((t) => [...t, { de: 'persona', texto: `(foto: ${nombre})` }]);
      setPensando(true);
      setCara('THINKING');
      const r = await subirFoto(foto.uri, nombre);
      setTurnos((t) => [...t, { de: 'doctor', texto: r.dicho }]);
      setCara(r.clase === 'nada' ? 'CONCERNED' : 'SPEAKING');
      void decir(r.dicho);
    } catch (e) {
      const msg =
        e instanceof SinPuerta
          ? 'Esta sesión ya no tiene acceso. Volvé a entrar.'
          : `No pude subir la foto: ${String((e as Error)?.message || e).slice(0, 120)}`;
      setTurnos((t) => [...t, { de: 'doctor', texto: msg }]);
      setCara('CONCERNED');
      if (e instanceof SinPuerta) onSalir();
    } finally {
      setTomando(false);
      setPensando(false);
      setTimeout(() => setCara('IDLE'), 1400);
    }
  }, [tomando, decir, onSalir]);

  /**
   * La pregunta del campo. El GPS da el punto; el catastro dice de quién es.
   *
   * Se manda la coordenada DENTRO de la pregunta, con sus decimales, en vez de por un campo
   * aparte: así la herramienta `catastro_en_punto` la recibe como argumento y la traza muestra
   * qué se consultó. Un dato que el modelo no ve es un dato que el modelo puede contradecir.
   */
  const dondeEstoy = useCallback(async () => {
    setCara('THINKING');
    try {
      const permiso = await Location.requestForegroundPermissionsAsync();
      if (permiso.status !== 'granted') {
        Alert.alert('Sin ubicación', 'Sin permiso de ubicación no puedo decirte sobre qué concesión estás parado.');
        setCara('IDLE');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const { longitude: lon, latitude: lat, accuracy } = pos.coords;
      const precision = accuracy ? ` (precisión ${Math.round(accuracy)} m)` : '';
      await mandar(
        `Estoy parado en ${lon.toFixed(6)}, ${lat.toFixed(6)}${precision}. ¿Sobre qué concesión estoy y qué hay cerca?`
      );
    } catch (e: any) {
      Alert.alert('Ubicación', `No pude fijar la posición: ${String(e?.message || e).slice(0, 120)}`);
      setCara('IDLE');
    }
  }, [mandar]);

  const nivel = estado?.nivel;
  const catastro = estado?.viva
    ? `catastro conectado${estado.concesiones != null ? ` · ${estado.concesiones} concesiones` : ''}`
    : estado
      ? `catastro fuera de línea${estado.motivo ? ` · ${estado.motivo}` : ''}`
      : 'comprobando…';

  return (
    <View style={s.raiz}>
      <View style={s.barra}>
        <View style={{ flex: 1 }}>
          <Text style={s.marca}>DR ELECTRUM FP</Text>
          <Text style={s.estado} numberOfLines={1}>
            {catastro}
            {nivel ? ` · ${nivel === 'lee' ? 'consulta' : nivel === 'escribe' ? 'trabajo' : 'mando'}` : ''}
          </Text>
        </View>
        <Pressable onPress={() => setVozActiva((v) => !v)} hitSlop={10} style={[s.chip, vozActiva && s.chipOn]}>
          <Text style={[s.chipTexto, vozActiva && { color: ACENTO }]}>VOZ</Text>
        </Pressable>
        <Pressable onPress={onSalir} hitSlop={10} style={s.chip}>
          <Text style={s.chipTexto}>SALIR</Text>
        </Pressable>
      </View>

      <View style={[s.cuerpo, !apaisado && { flexDirection: 'column' }]}>
        <View style={[s.izquierda, !apaisado && s.izquierdaVertical]}>
          <View style={[s.caraCaja, !apaisado && { height: 120 }]}>
            <UltronFace face={cara} acento={ACENTO} size={apaisado ? 56 : 40} stageHeight={apaisado ? 150 : 110} />
          </View>
          <Pressable onPress={() => void dondeEstoy()} disabled={pensando} style={[s.donde, pensando && { opacity: 0.4 }]}>
            <Text style={s.dondeTexto}>¿DÓNDE ESTOY?</Text>
          </Pressable>
        </View>

        <View style={[s.derecha, !apaisado && s.derechaVertical]}>
      <ScrollView
        ref={hilo}
        style={s.hilo}
        contentContainerStyle={{ padding: 14, gap: 12 }}
        onContentSizeChange={() => hilo.current?.scrollToEnd({ animated: true })}
      >
        {!turnos.length && (
          <View style={{ gap: 10 }}>
            <Text style={s.intro}>
              Preguntame de minería o del catastro. Si estás parado sobre el terreno, tocá «¿Dónde estoy?» y te digo de quién es.
            </Text>
            {['¿se traslapa algo en el catastro?', '250.000 toneladas a 3,4 g/t, ¿cuántas onzas?', '¿qué concesiones vencen este año?'].map((e) => (
              <Pressable key={e} onPress={() => void mandar(e)} style={s.ejemplo}>
                <Text style={s.ejemploTexto}>{e}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {turnos.map((t, i) => (
          <View key={i} style={t.de === 'persona' ? s.mio : s.suyo}>
            {t.de === 'doctor' && !!t.panel && <Text style={s.panel}>{t.panel}</Text>}
            <Text style={t.de === 'persona' ? s.mioTexto : s.suyoTexto}>{t.texto}</Text>
            {t.traza?.map((h, j) => (
              <Text key={j} style={s.traza} numberOfLines={1}>
                {h.ok ? '·' : '×'} {h.herramienta} — {h.resumen}
              </Text>
            ))}
          </View>
        ))}
        {pensando && <Text style={s.pensando}>pensando…</Text>}
      </ScrollView>

      <View style={s.entrada}>
        <TextInput
          value={texto}
          onChangeText={setTexto}
          placeholder={oyendo ? 'te escucho…' : 'Preguntale a Dr Electrum…'}
          placeholderTextColor={oyendo ? ACENTO : '#5E7078'}
          style={s.campo}
          onSubmitEditing={() => void mandar(texto)}
          returnKeyType="send"
        />
        {/*
          * El micrófono solo aparece si el teléfono de verdad lo trae. Un botón que no hace nada es
          * peor que no tenerlo: en el campo, tocarlo y que no pase nada se lee como «se colgó».
          */}
        {hayMicro && (
          <Pressable
            onPress={() => void alternarMicro()}
            disabled={pensando}
            style={[s.redondo, oyendo && s.redondoVivo, pensando && { opacity: 0.3 }]}
            accessibilityLabel={oyendo ? 'Dejar de dictar' : 'Dictar la pregunta'}
            accessibilityRole="button"
            hitSlop={8}
          >
            <Text style={[s.redondoTexto, oyendo && { color: '#000' }]}>{oyendo ? '■' : '🎙'}</Text>
          </Pressable>
        )}
        <Pressable
          onPress={() => void abrirCamara()}
          disabled={pensando}
          style={[s.redondo, pensando && { opacity: 0.3 }]}
          accessibilityLabel="Fotografiar un papel para el expediente"
          accessibilityRole="button"
          hitSlop={8}
        >
          <Text style={s.redondoTexto}>📷</Text>
        </Pressable>
        <Pressable onPress={() => void mandar(texto)} disabled={pensando || !texto.trim()} style={[s.ir, (pensando || !texto.trim()) && { opacity: 0.3 }]}>
          {pensando ? <ActivityIndicator color="#000" size="small" /> : <Text style={s.irTexto}>Ir</Text>}
        </Pressable>
          </View>
        </View>
      </View>

      {/*
        * La cámara a pantalla completa y con una sola instrucción. Quien está fotografiando un
        * plano sobre una mesa no quiere ajustes: quiere que quepa el recuadro con los datos.
        */}
      <Modal visible={camara} animationType="slide" onRequestClose={() => setCamara(false)}>
        <View style={s.camaraRaiz}>
          <CameraView ref={lente} style={{ flex: 1 }} facing="back" />
          <View style={s.camaraPie}>
            <Pressable onPress={() => setCamara(false)} hitSlop={10} style={s.chip}>
              <Text style={s.chipTexto}>CANCELAR</Text>
            </Pressable>
            <Text style={s.camaraGuia} numberOfLines={2}>
              Encuadrá el recuadro con los números y el sello. Lo que salga borroso lo voy a marcar como ilegible, no lo voy a adivinar.
            </Text>
            <Pressable onPress={() => void tomarFoto()} disabled={tomando} style={[s.disparo, tomando && { opacity: 0.4 }]}>
              {tomando ? <ActivityIndicator color="#000" size="small" /> : <Text style={s.irTexto}>Leer</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  raiz: { flex: 1, backgroundColor: '#000' },
  barra: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8 },
  marca: { color: ACENTO, fontSize: 12, fontWeight: '700', letterSpacing: 2.4 },
  estado: { color: TENUE, fontSize: 10, marginTop: 2, fontFamily: 'monospace' },
  chip: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  chipOn: { borderColor: ACENTO },
  chipTexto: { color: GRIS, fontSize: 9, letterSpacing: 1.6, fontWeight: '600' },
  // `overflow` recorta a propósito: los anillos del halo miden 4,3 veces el iris y desbordaban
  // la caja, pisando el texto de abajo. Recortados quedan como una banda, que es lo que se busca.
  cuerpo: { flex: 1, flexDirection: 'row' },
  // Ancho fijo: la cara no crece con la pantalla, y lo que gana el teléfono se lo lleva el hilo.
  izquierda: { width: 240, paddingLeft: 14, paddingBottom: 14, justifyContent: 'space-between' },
  izquierdaVertical: { width: '100%', paddingHorizontal: 14, paddingBottom: 6, flexDirection: 'row', alignItems: 'center', gap: 12 },
  derecha: { flex: 1, borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.08)' },
  derechaVertical: { borderLeftWidth: 0, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' },
  redondo: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  redondoVivo: { backgroundColor: ACENTO, borderColor: ACENTO },
  redondoTexto: { fontSize: 17, color: '#E7EEF2' },
  camaraRaiz: { flex: 1, backgroundColor: '#000' },
  camaraPie: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, backgroundColor: '#000' },
  camaraGuia: { flex: 1, color: '#8FA3B0', fontSize: 11, lineHeight: 15 },
  disparo: { backgroundColor: ACENTO, borderRadius: 999, paddingHorizontal: 20, paddingVertical: 12 },
  /*
   * La CAJA es más alta que el ESCENARIO de la cara (210 contra 150), y esa diferencia es el
   * arreglo. Subir las dos a la vez no servía de nada: la cara se centra en su escenario y dibuja
   * la boca por DEBAJO de él, así que con caja y escenario iguales la boca cae siempre justo en el
   * borde y `overflow: hidden` se la come. Recortar el halo está bien; recortarle la boca la deja
   * sin la mitad de la expresión.
   */
  caraCaja: { height: 210, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  hilo: { flex: 1 },
  intro: { color: GRIS, fontSize: 14, lineHeight: 21 },
  ejemplo: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, alignSelf: 'flex-start' },
  ejemploTexto: { color: '#9FB0B8', fontSize: 12 },
  mio: { alignSelf: 'flex-end', maxWidth: '88%', backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9 },
  mioTexto: { color: '#E7EEF2', fontSize: 14, lineHeight: 20 },
  suyo: { alignSelf: 'flex-start', maxWidth: '92%' },
  suyoTexto: { color: '#DDE7EC', fontSize: 14, lineHeight: 21, backgroundColor: 'rgba(255,255,255,0.045)', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9 },
  panel: { color: ACENTO, fontSize: 9, letterSpacing: 1.6, marginBottom: 4, fontWeight: '700' },
  traza: { color: TENUE, fontSize: 10, fontFamily: 'monospace', marginTop: 3, marginLeft: 4 },
  pensando: { color: TENUE, fontSize: 11, fontFamily: 'monospace' },
  donde: { marginRight: 14, borderWidth: 1, borderColor: ACENTO, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  dondeTexto: { color: ACENTO, fontSize: 12, fontWeight: '700', letterSpacing: 2 },
  entrada: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingBottom: 14, paddingTop: 6 },
  campo: { flex: 1, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color: '#E7EEF2', fontSize: 14 },
  ir: { backgroundColor: ACENTO, borderRadius: 12, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', minWidth: 56 },
  irTexto: { color: '#000', fontWeight: '700', fontSize: 13 },
});
