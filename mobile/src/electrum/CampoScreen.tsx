/**
 * LA PANTALLA DE CAMPO.
 *
 * Es la razón de que esta app exista en vez de ser la web guardada en la pantalla de inicio. Todo
 * lo que hace aquí es lo que un navegador hace mal o no hace:
 *
 *  · **«¿Dónde estoy y qué dice el catastro de esto?»** Parado sobre el terreno, el GPS da el punto y el
 *    catastro contesta. Es LA pregunta del campo, y la única respuesta que no se puede fingir.
 *  · **Hablarle con las manos sucias.** En un cerro nadie escribe en un teclado de vidrio.
 *  · **Enseñarle lo que estás viendo.** Un afloramiento, un testigo, la hoja de un expediente.
 *
 * El resto —el mapa grande, cargar el catastro— vive en la web, donde hay pantalla. Meterlo todo
 * aquí sería hacer una web peor dentro de una app. Los informes sí llegan: si el doctor arma un
 * PDF, se guarda en el teléfono desde el propio hilo.
 *
 * La lógica que no necesita teléfono (qué se manda, qué dice la barra, qué se ofrece) está en
 * `campo.ts`, con sus pruebas en `tests/electrum-movil-campo.test.ts`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import { Audio, type AVPlaybackStatus } from 'expo-av';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { UltronFace } from '../components/UltronFace';
import { ACENTO } from '../variante';
import { preguntar, salud, subirFoto, voz, SinPuerta } from './api';
import {
  avisosVisibles,
  conPlazo,
  hiloParaMandar,
  informeDe,
  lineaDeEstado,
  nombreDeFoto,
  PlazoVencido,
  puedeCargar,
  tamanoLegible,
  type EstadoInforme,
  type EstadoSalud,
  type TurnoCampo,
} from './campo';
import { dictadoDisponible, escuchar, type Escucha } from './dictado';
import { fraseDeError, SIN_NIVEL_PARA_CARGAR } from './frases';
import { guardarInformeEnTelefono } from './guardarInforme';
import { useBordes } from './useBordes';
import type { FaceState } from '../config';

/** Un renglón del hilo con su identidad: marcarlo como fallo o guardar su PDF no depende de su posición. */
type Renglon = TurnoCampo & { id: number };

const GRIS = '#8FA3B0';
const TENUE = '#6C7F89';

/** La guía de la cámara. Una sola frase para las dos orientaciones, que la colocan distinto. */
const GUIA_CAMARA =
  'Encuadrá el recuadro con los números y el sello. Lo que salga borroso lo voy a marcar como ilegible, no lo voy a adivinar.';

/** Lo que se espera al GPS antes de probar con la última posición conocida. */
const PLAZO_GPS_MS = 25_000;
/** La última posición conocida vale si no tiene más de esto. Más vieja, en el campo ya es otro sitio. */
const POSICION_VIEJA_MS = 2 * 60_000;
/** Al volver a la app, la barra se refresca si la última comprobación tiene más de esto. */
const SALUD_VIEJA_MS = 60_000;

/**
 * Un aviso que ESPERA la respuesta. `Alert.alert` no bloquea: el aviso de «para qué quiero la
 * ubicación» y el diálogo del sistema salían a la vez, uno encima del otro, y la explicación no se
 * leía antes de decidir — que era para lo que estaba.
 */
function confirmar(titulo: string, mensaje: string, si: string, no = 'Ahora no'): Promise<boolean> {
  return new Promise((resolver) => {
    Alert.alert(
      titulo,
      mensaje,
      [
        { text: no, style: 'cancel', onPress: () => resolver(false) },
        { text: si, onPress: () => resolver(true) },
      ],
      { cancelable: true, onDismiss: () => resolver(false) }
    );
  });
}

export function CampoScreen({ onSalir }: { onSalir: (motivo?: string) => void }) {
  const [turnos, setTurnos] = useState<Renglon[]>([]);
  /*
   * `mandar` no puede depender de `turnos` sin reharse en cada mensaje; una ref siempre tiene el
   * hilo de ahora, que es el que hay que mandar.
   */
  const turnosRef = useRef<Renglon[]>(turnos);
  turnosRef.current = turnos;
  const siguienteId = useRef(0);
  const [texto, setTexto] = useState('');
  const [pensando, setPensando] = useState(false);
  /**
   * Lo mismo que `pensando`, pero se lee en el acto. El estado tarda un pintado en llegar a los
   * botones: dos toques seguidos a «Ir» (o un ejemplo y un «Ir») mandaban dos preguntas.
   */
  const enVuelo = useRef(false);
  const [cara, setCara] = useState<FaceState>('IDLE');
  const [estado, setEstado] = useState<EstadoSalud>(null);
  const ultimaSalud = useRef(0);
  const [vozActiva, setVozActiva] = useState(true);
  const vozActivaRef = useRef(vozActiva);
  vozActivaRef.current = vozActiva;
  const hilo = useRef<ScrollView>(null);
  const sonido = useRef<Audio.Sound | null>(null);
  /** Cada frase dicha tiene su número; si al llegar el audio ya hay otra más nueva, esta se tira. */
  const vozTurno = useRef(0);
  const montado = useRef(true);
  const reloj = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saliendo = useRef(false);
  /*
   * `onSalir` en una ref: quien monta esta pantalla puede pasar una función nueva en cada pintado,
   * y con ella en las dependencias `comprobar` cambiaba, el efecto de montaje se volvía a correr y
   * su limpieza callaba al doctor y cortaba el dictado sin que nadie lo pidiera.
   */
  const onSalirRef = useRef(onSalir);
  onSalirRef.current = onSalir;
  const [trazasAbiertas, setTrazasAbiertas] = useState<Set<number>>(() => new Set());

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
  // Lo que tapan la barra de estado y la de navegación (edge-to-edge de Expo 54): ver bordes.ts.
  const b = useBordes();

  const [oyendo, setOyendo] = useState(false);
  const escucha = useRef<Escucha | null>(null);
  // Se pregunta una vez: es una llamada al módulo nativo, no algo que cambie mientras la app vive.
  const [hayMicro] = useState(dictadoDisponible);

  const [camara, setCamara] = useState(false);
  const [lenteLista, setLenteLista] = useState(false);
  const [permisoCamara, pedirPermisoCamara] = useCameraPermissions();
  const lente = useRef<CameraView | null>(null);
  const [tomando, setTomando] = useState(false);
  const tomandoRef = useRef(false);
  /** Fijando el GPS. Es una fase propia: puede tardar quince segundos y el botón tiene que decirlo. */
  const [ubicando, setUbicando] = useState(false);
  const ubicandoRef = useRef(false);

  /* --------------------------------------------------------------- utilidades del hilo */

  const agregar = useCallback((t: TurnoCampo): number => {
    const id = (siguienteId.current += 1);
    setTurnos((ts) => [...ts, { ...t, id }]);
    return id;
  }, []);

  const marcarFallo = useCallback((id: number) => {
    setTurnos((ts) => ts.map((t) => (t.id === id ? { ...t, fallo: true } : t)));
  }, []);

  /** La cara vuelve sola a su sitio. Un reloj a la vez, y ninguno vivo si la pantalla se fue. */
  const caraLuego = useCallback((c: FaceState, ms = 1400) => {
    if (reloj.current) clearTimeout(reloj.current);
    reloj.current = setTimeout(() => {
      reloj.current = null;
      if (montado.current) setCara(c);
    }, ms);
  }, []);

  const caraAhora = useCallback((c: FaceState) => {
    if (reloj.current) clearTimeout(reloj.current);
    reloj.current = null;
    setCara(c);
  }, []);

  /**
   * El servidor dijo que esta credencial ya no abre (401). Una sola vez: si fallan a la vez la
   * pregunta y la barra, no se sale dos veces.
   */
  const salirPorPuerta = useCallback((e: unknown) => {
    if (saliendo.current) return;
    saliendo.current = true;
    onSalirRef.current(fraseDeError(e));
  }, []);

  /* --------------------------------------------------------------- la barra */

  /**
   * Preguntar cómo está el catastro. Un fallo dejaba `estado` en null, y la barra lo pinta como
   * «comprobando…»: una espera sin salida y sin explicación. Ahora se marca que falló, se dice, y
   * la propia línea sirve para volver a intentarlo.
   */
  const comprobar = useCallback(async () => {
    setEstado(null);
    ultimaSalud.current = Date.now();
    try {
      const s = await salud();
      if (!montado.current) return;
      // El motivo técnico (el error de Postgres) va al registro; la barra dice qué significa.
      if (!s.viva && s.motivo) console.warn('[electrum] catastro:', s.motivo);
      setEstado(s);
    } catch (e: any) {
      console.warn('[electrum] salud:', e?.name, e?.status ?? '', e?.message || e);
      if (!montado.current) return;
      // Un 401 acá no es «sin señal»: la credencial dejó de valer. Antes se pintaba «no alcancé el
      // servidor · tocá para reintentar», y reintentar no iba a arreglarlo nunca.
      if (e instanceof SinPuerta) return salirPorPuerta(e);
      setEstado('fallo');
    }
  }, [salirPorPuerta]);

  /* --------------------------------------------------------------- la voz */

  /** Calla al doctor: corta lo que suena y tira lo que esté por llegar. */
  const callar = useCallback(() => {
    vozTurno.current += 1;
    const s = sonido.current;
    sonido.current = null;
    if (s) void s.unloadAsync().catch(() => {});
  }, []);

  /**
   * Leer una respuesta en voz alta.
   *
   * Antes se pisaban: dos respuestas seguidas pedían dos audios, los dos sonaban a la vez y el
   * primero no se descargaba nunca (un WAV de un minuto son megas de memoria). Y apagar VOZ no
   * callaba lo que ya estaba sonando. Ahora cada frase lleva su número y solo suena la última, el
   * sonido se descarga al terminar, y VOZ, el micrófono y una pregunta nueva lo cortan.
   */
  const decir = useCallback(
    async (t: string, emocion?: string) => {
      callar();
      if (!vozActivaRef.current || !t.trim()) return;
      const mio = vozTurno.current;
      const url = await voz(t, emocion);
      if (!url || mio !== vozTurno.current || !vozActivaRef.current || !montado.current) return;
      try {
        const { sound } = await Audio.Sound.createAsync({ uri: url }, { shouldPlay: true });
        if (mio !== vozTurno.current || !montado.current) {
          void sound.unloadAsync().catch(() => {});
          return;
        }
        sonido.current = sound;
        sound.setOnPlaybackStatusUpdate((st: AVPlaybackStatus) => {
          if (st.isLoaded && st.didJustFinish && sonido.current === sound) {
            sonido.current = null;
            void sound.unloadAsync().catch(() => {});
          }
        });
      } catch {
        /* sin voz se sigue leyendo */
      }
    },
    [callar]
  );

  const alternarVoz = useCallback(() => {
    if (vozActivaRef.current) callar();
    setVozActiva((v) => !v);
  }, [callar]);

  useEffect(() => {
    montado.current = true;
    void comprobar();
    // Que el audio suene aunque el teléfono esté en silencio: en el campo el timbre va apagado.
    Audio.setAudioModeAsync({ playsInSilentModeIOS: true, staysActiveInBackground: false }).catch(() => {});
    // Solo al desmontar: `comprobar` y `callar` no cambian (sus dependencias son refs).
    return () => {
      montado.current = false;
      if (reloj.current) clearTimeout(reloj.current);
      callar();
      // Salir de la pantalla con el micrófono abierto lo dejaría abierto. En el campo eso es la batería.
      escucha.current?.cancelar();
    };
  }, [comprobar, callar]);

  /*
   * Al fondo y de vuelta. Con la app al fondo el micrófono no tiene nada que hacer abierto; y al
   * volver, una barra de hace una hora que dice «catastro conectado» puede estar mintiendo.
   */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') escucha.current?.parar();
      else if (Date.now() - ultimaSalud.current > SALUD_VIEJA_MS) void comprobar();
    });
    return () => sub.remove();
  }, [comprobar]);

  /* --------------------------------------------------------------- preguntarle */

  const mandar = useCallback(
    async (mensaje: string, desdeCaja = false) => {
      const q = mensaje.trim();
      // Mientras se fija el GPS tampoco: su pregunta llega detrás y se perdería callada.
      if (!q || enVuelo.current || ubicandoRef.current) return;
      enVuelo.current = true;
      // Con el micrófono abierto, lo que entienda después ya no es de esta pregunta.
      escucha.current?.cancelar();
      callar();
      // Solo se vacía la caja si lo que se manda es lo que estaba escrito: tocar un ejemplo o
      // «¿Dónde estoy?» a mitad de escribir borraba la pregunta a medias.
      if (desdeCaja) setTexto('');
      const hiloAntes = hiloParaMandar(turnosRef.current);
      const idPregunta = agregar({ de: 'persona', texto: q });
      setPensando(true);
      caraAhora('THINKING');
      try {
        const r = await preguntar(q, hiloAntes);
        if (!montado.current) return;
        const dicho = String(r.texto || '').trim();
        if (!dicho) {
          marcarFallo(idPregunta);
          agregar({ de: 'doctor', texto: 'No me salió nada que decirte. Preguntámelo de nuevo, con otras palabras si podés.', fallo: true });
          caraAhora('CONCERNED');
          return;
        }
        const informe = informeDe(r.ui);
        agregar({
          de: 'doctor',
          texto: dicho,
          panel: r.panel,
          traza: Array.isArray(r.traza) ? r.traza : [],
          informe: informe ? { ...informe, estado: { fase: 'listo' } } : undefined,
        });
        caraAhora('SPEAKING');
        void decir(dicho, r.emocion);
      } catch (e: any) {
        // El detalle técnico, al registro; en el hilo, qué pasó y qué hacer (ver frases.ts).
        console.warn('[electrum] turno:', e?.name, e?.status ?? '', e?.message || e);
        if (!montado.current) return;
        marcarFallo(idPregunta);
        agregar({ de: 'doctor', texto: fraseDeError(e, 'contestar'), fallo: true });
        caraAhora('CONCERNED');
        if (e instanceof SinPuerta) salirPorPuerta(e);
      } finally {
        enVuelo.current = false;
        if (montado.current) {
          setPensando(false);
          caraLuego('IDLE');
        }
      }
    },
    [agregar, marcarFallo, caraAhora, caraLuego, callar, decir, salirPorPuerta]
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
    // El micrófono oiría al doctor hablando.
    callar();
    const e = await escuchar({
      onParcial: (t) => setTexto(t),
      onFinal: (t) => setTexto(t),
      onFin: () => {
        escucha.current = null;
        if (!montado.current) return;
        setOyendo(false);
        caraAhora('IDLE');
      },
      // `motivo` ya viene como frase (dictado.ts lo traduce con `fraseDeDictado`), nunca como código.
      onError: (motivo) => Alert.alert('Micrófono', motivo),
    });
    if (!e) return;
    if (!montado.current) {
      e.cancelar();
      return;
    }
    escucha.current = e;
    setOyendo(true);
    caraAhora('LISTENING');
  }, [callar, caraAhora]);

  /* --------------------------------------------------------------- enseñarle */

  /**
   * La foto de un papel. Va al cerebro, no al chat: sale transcrita y queda en el expediente,
   * buscable por su número de resolución. Que después alguien pregunte «¿qué dice la resolución de
   * Quebrada Seca?» y aparezca, eso es lo que la hace valer; enseñarla y olvidarla, no.
   */
  const abrirCamara = useCallback(async () => {
    if (enVuelo.current) return;
    // Con acceso de consulta el servidor la rechaza (403) DESPUÉS de subirla: se dice antes.
    if (puedeCargar(estado) === false) {
      Alert.alert('Cámara', SIN_NIVEL_PARA_CARGAR);
      return;
    }
    if (!permisoCamara?.granted) {
      const r = await pedirPermisoCamara();
      if (!r?.granted) {
        if (r && !r.canAskAgain) {
          Alert.alert('Cámara', 'El permiso de cámara está negado en los ajustes del teléfono. Sin él no puedo leer el papel que tengas delante.', [
            { text: 'Ahora no', style: 'cancel' },
            { text: 'Abrir ajustes', onPress: () => void Linking.openSettings() },
          ]);
        } else {
          Alert.alert('Cámara', 'Sin permiso de cámara no puedo leer el papel que tengas delante.');
        }
        return;
      }
    }
    escucha.current?.parar();
    setLenteLista(false);
    setCamara(true);
  }, [estado, permisoCamara, pedirPermisoCamara]);

  const tomarFoto = useCallback(async () => {
    if (tomandoRef.current || enVuelo.current) return;
    tomandoRef.current = true;
    setTomando(true);
    let uri: string | undefined;
    try {
      const foto = await lente.current?.takePictureAsync({ quality: 0.8 });
      uri = foto?.uri;
    } catch (e: any) {
      // Antes el fallo de la cámara dejaba el modal abierto y el aviso escondido detrás, en el hilo.
      console.warn('[electrum] cámara:', e?.code ?? '', e?.message || e);
      if (montado.current) {
        agregar({ de: 'doctor', texto: fraseDeError(e, 'camara'), fallo: true });
        caraAhora('CONCERNED');
        caraLuego('IDLE');
      }
    } finally {
      tomandoRef.current = false;
      if (montado.current) {
        setTomando(false);
        setCamara(false);
      }
    }
    if (!uri || !montado.current || enVuelo.current) return;

    enVuelo.current = true;
    callar();
    const nombre = nombreDeFoto(new Date());
    const idFoto = agregar({ de: 'persona', texto: `(foto: ${nombre})` });
    setPensando(true);
    caraAhora('THINKING');
    try {
      const r = await subirFoto(uri, nombre);
      if (!montado.current) return;
      agregar({ de: 'doctor', texto: r.dicho, avisos: avisosVisibles(r.avisos), fallo: r.clase === 'nada' });
      if (r.clase === 'nada') marcarFallo(idFoto);
      caraAhora(r.clase === 'nada' ? 'CONCERNED' : 'SPEAKING');
      void decir(r.dicho);
    } catch (e: any) {
      console.warn('[electrum] foto:', e?.name, e?.status ?? '', e?.message || e);
      if (!montado.current) return;
      marcarFallo(idFoto);
      agregar({ de: 'doctor', texto: fraseDeError(e, 'foto'), fallo: true });
      caraAhora('CONCERNED');
      if (e instanceof SinPuerta) salirPorPuerta(e);
    } finally {
      enVuelo.current = false;
      if (montado.current) {
        setPensando(false);
        caraLuego('IDLE');
      }
    }
  }, [agregar, marcarFallo, caraAhora, caraLuego, callar, decir, salirPorPuerta]);

  /* --------------------------------------------------------------- informes */

  const ponerInforme = useCallback((id: number, e: EstadoInforme) => {
    setTurnos((ts) => ts.map((t) => (t.id === id && t.informe ? { ...t, informe: { ...t.informe, estado: e } } : t)));
  }, []);

  const guardarPdf = useCallback(
    async (id: number) => {
      const inf = turnosRef.current.find((t) => t.id === id)?.informe;
      if (!inf || inf.estado.fase === 'guardando') return;
      ponerInforme(id, { fase: 'guardando' });
      try {
        const r = await guardarInformeEnTelefono(inf);
        if (!montado.current) return;
        // `null`: cerró el selector de carpeta sin elegir. Queda como estaba, sin reproche.
        ponerInforme(id, r ? { fase: 'guardado', carpeta: r.carpeta } : { fase: 'listo' });
      } catch (e: any) {
        console.warn('[electrum] informe:', e?.name, e?.status ?? '', e?.message || e);
        if (!montado.current) return;
        ponerInforme(id, { fase: 'listo' });
        if (e instanceof SinPuerta) return salirPorPuerta(e);
        Alert.alert('Informe', fraseDeError(e, 'informe'));
      }
    },
    [ponerInforme, salirPorPuerta]
  );

  /* --------------------------------------------------------------- dónde estoy */

  /**
   * La pregunta del campo. El GPS da el punto; el catastro dice quién figura inscrito ahí.
   *
   * Se manda la coordenada DENTRO de la pregunta, con sus decimales, en vez de por un campo
   * aparte: así la herramienta `catastro_en_punto` la recibe como argumento y la traza muestra
   * qué se consultó. Un dato que el modelo no ve es un dato que el modelo puede contradecir.
   */
  const dondeEstoy = useCallback(async () => {
    /*
     * Ocupado DESDE EL PRINCIPIO (y con una ref, que se lee en el acto).
     *
     * Fijar el GPS bajo árboles o en un cañón tarda diez o quince segundos. En ese hueco el botón
     * seguía vivo, y lo normal —tocarlo otra vez porque «no hizo nada»— disparaba una segunda
     * petición de posición encima de la primera.
     */
    if (ubicandoRef.current || enVuelo.current) return;
    ubicandoRef.current = true;
    setUbicando(true);
    caraAhora('THINKING');
    let pregunta: string | null = null;
    try {
      const previo = await Location.getForegroundPermissionsAsync();
      if (previo.status !== 'granted') {
        if (!previo.canAskAgain) {
          // Negado para siempre: pedirlo otra vez no saca ningún diálogo. Solo queda ir a ajustes.
          Alert.alert(
            'Sin permiso de ubicación',
            'El permiso de ubicación está negado en los ajustes del teléfono. Activalo ahí, o pedime el catastro por nombre de concesión.',
            [
              { text: 'Ahora no', style: 'cancel' },
              { text: 'Abrir ajustes', onPress: () => void Linking.openSettings() },
            ]
          );
          return;
        }
        // Para qué se pide, ANTES de que salga el diálogo del sistema — y esperando a que se lea.
        const sigue = await confirmar(
          'Necesito tu ubicación',
          'Para decirte qué dice el catastro del punto donde estás parado. La coordenada se manda con la pregunta y no queda guardada como historial de recorrido.',
          'Continuar'
        );
        if (!sigue) return;
        const permiso = await Location.requestForegroundPermissionsAsync();
        if (permiso.status !== 'granted') {
          Alert.alert('Sin ubicación', 'Sin permiso de ubicación no puedo mirar el catastro de donde estás. Podés pedírmelo por nombre de concesión.');
          return;
        }
      }
      // Con la ubicación del sistema apagada, el GPS no contesta nunca: se dice en el acto.
      if (!(await Location.hasServicesEnabledAsync().catch(() => true))) {
        Alert.alert('Ubicación apagada', 'La ubicación del teléfono está apagada. Encendela desde los ajustes rápidos y tocá «¿Dónde estoy?» otra vez.');
        return;
      }
      let pos: Location.LocationObject;
      let deAntes = false;
      try {
        pos = await conPlazo(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }), PLAZO_GPS_MS, 'GPS');
      } catch (e) {
        if (!(e instanceof PlazoVencido)) throw e;
        // Sin fijar a tiempo: la última posición conocida, si es reciente, y diciéndolo.
        const ultima = await Location.getLastKnownPositionAsync({ maxAge: POSICION_VIEJA_MS, requiredAccuracy: 150 }).catch(() => null);
        if (!ultima) throw e;
        pos = ultima;
        deAntes = true;
      }
      const { longitude: lon, latitude: lat, accuracy } = pos.coords;
      const precision = accuracy ? `, con precisión de ${Math.round(accuracy)} m` : '';
      const hora = new Date(pos.timestamp || Date.now()).toLocaleTimeString('es-HN', { hour: '2-digit', minute: '2-digit' });
      const cuando = deAntes ? `es la última posición que tenía el teléfono, de las ${hora} (el GPS no fijó una nueva)` : `tomado a las ${hora}`;
      /*
       * «Qué DICE el padrón», no «de quién es».
       *
       * La diferencia no es de estilo. El padrón dice quién figura inscrito; de quién es el derecho
       * lo dice un expediente y, si hay conflicto, un juez. Una app que contesta «esto es de fulano»
       * está emitiendo una conclusión jurídica que no le toca, y con un GPS de ±8 m encima.
       */
      pregunta =
        `Estoy parado en ${lon.toFixed(6)}, ${lat.toFixed(6)}${precision}; ${cuando}. ` +
        `¿Qué dice el catastro de este punto y qué hay cerca? Tené en cuenta el margen del GPS si caigo junto a un lindero.`;
    } catch (e: any) {
      console.warn('[electrum] ubicación:', e?.code ?? '', e?.message || e);
      if (montado.current) Alert.alert('Ubicación', fraseDeError(e, 'ubicacion'));
    } finally {
      ubicandoRef.current = false;
      if (montado.current) {
        setUbicando(false);
        if (!pregunta) caraAhora('IDLE');
      }
    }
    if (pregunta && montado.current) await mandar(pregunta);
  }, [mandar, caraAhora]);

  /* --------------------------------------------------------------- salir */

  /**
   * SALIR borra la credencial del teléfono y cierra la sesión en el servidor. Estaba a un toque sin
   * preguntar, en la esquina donde cae el pulgar: rozarlo sacando el teléfono del bolsillo obligaba
   * a escribir la clave de nuevo en el campo. Ahora se confirma. (Cuando es el SERVIDOR el que dice
   * que la sesión no vale —`SinPuerta`— se sale sin preguntar: ahí no hay nada que decidir.)
   */
  const pedirSalir = useCallback(() => {
    Alert.alert(
      '¿Cerrar la sesión?',
      'Se borra tu credencial de este teléfono. Para volver vas a tener que entrar otra vez con tu correo o tu llave.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Salir',
          style: 'destructive',
          onPress: () => {
            if (saliendo.current) return;
            saliendo.current = true;
            onSalirRef.current();
          },
        },
      ],
      { cancelable: true }
    );
  }, []);

  /*
   * El botón ATRÁS de Android.
   *
   * Sin esto, atrás mandaba la app al fondo pasara lo que pasara (la MainActivity de Expo hace
   * `moveTaskToBack`), con el micrófono abierto o a mitad de una pregunta. Ahora va por capas, como
   * se espera de atrás: primero cierra lo que esté abierto encima —la cámara, el dictado— y solo
   * después sale. Y si hay conversación en pantalla pregunta antes, porque un borde de pantalla
   * rozado con el pulgar es atrás, y el hilo vive solo en la memoria de la app: si el teléfono
   * necesita memoria y la cierra estando al fondo, lo hablado no vuelve. Con la pantalla vacía no
   * hay nada que perder y atrás hace lo de siempre.
   */
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      // Con el Modal abierto Android le entrega atrás a su `onRequestClose`; esto cubre el resto.
      if (camara) {
        setCamara(false);
        return true;
      }
      if (escucha.current) {
        escucha.current.parar();
        return true;
      }
      if (!turnosRef.current.length && !enVuelo.current && !ubicandoRef.current) return false;
      Alert.alert(
        '¿Salir de Dr Electrum?',
        'La app queda en segundo plano. Si el teléfono necesita memoria la puede cerrar, y esta conversación no se guarda en el teléfono.',
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Salir', onPress: () => BackHandler.exitApp() },
        ],
        { cancelable: true }
      );
      return true;
    });
    return () => sub.remove();
  }, [camara]);

  const alternarTraza = useCallback((id: number) => {
    setTrazasAbiertas((a) => {
      const n = new Set(a);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const lineaEstado = lineaDeEstado(estado);
  const hayTexto = !!texto.trim();
  /** Hay algo en vuelo (una pregunta, una foto subiendo o el GPS fijando): lo que manda, espera. */
  const ocupado = pensando || ubicando;

  return (
    <KeyboardAvoidingView
      style={[s.raiz, { paddingTop: b.arriba, paddingBottom: b.abajo, paddingLeft: b.izquierda, paddingRight: b.derecha }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={s.barra}>
        <View style={{ flex: 1 }}>
          <Text style={s.marca} accessibilityRole="header">
            DR ELECTRUM FP
          </Text>
          {/* Si falló, la línea de estado es el botón de reintentar: no hay que buscar otro sitio. */}
          <Pressable
            onPress={() => estado === 'fallo' && comprobar()}
            disabled={estado !== 'fallo'}
            hitSlop={15}
            accessibilityRole={estado === 'fallo' ? 'button' : 'text'}
            accessibilityHint={estado === 'fallo' ? 'Vuelve a comprobar la conexión con el catastro' : undefined}
          >
            {/* En vertical, dos renglones: en uno solo se cortaba justo «tocá para reintentar». */}
            <Text style={[s.estado, estado === 'fallo' && { color: '#D9705A' }]} numberOfLines={apaisado ? 1 : 2}>
              {lineaEstado}
            </Text>
          </Pressable>
        </View>
        <Pressable
          onPress={alternarVoz}
          hitSlop={6}
          accessibilityRole="switch"
          accessibilityLabel="Voz del doctor"
          accessibilityHint="Lee las respuestas en voz alta"
          accessibilityState={{ checked: vozActiva }}
          style={[s.chip, vozActiva && s.chipOn]}
        >
          <Text style={[s.chipTexto, vozActiva && { color: ACENTO }]}>VOZ</Text>
        </Pressable>
        <Pressable onPress={pedirSalir} hitSlop={6} accessibilityRole="button" accessibilityLabel="Salir y cerrar la sesión" style={s.chip}>
          <Text style={s.chipTexto}>SALIR</Text>
        </Pressable>
      </View>

      <View style={[s.cuerpo, !apaisado && { flexDirection: 'column' }]}>
        <View style={[s.izquierda, !apaisado && s.izquierdaVertical]}>
          <View style={[s.caraCaja, !apaisado && s.caraCajaVertical]} accessible={false} importantForAccessibility="no-hide-descendants">
            <UltronFace face={cara} acento={ACENTO} size={apaisado ? 56 : 40} stageHeight={apaisado ? 150 : 110} />
          </View>
          <Pressable
            onPress={() => void dondeEstoy()}
            disabled={ocupado}
            accessibilityRole="button"
            accessibilityState={{ disabled: ocupado, busy: ubicando }}
            accessibilityLabel="Consultar el catastro del punto donde estoy"
            style={[s.donde, !apaisado && s.dondeVertical, ocupado && { opacity: 0.4 }]}
          >
            <Text style={s.dondeTexto}>{ubicando ? 'FIJANDO GPS…' : '¿DÓNDE ESTOY?'}</Text>
          </Pressable>
        </View>

        <View style={[s.derecha, !apaisado && s.derechaVertical]}>
          <ScrollView
            ref={hilo}
            style={s.hilo}
            contentContainerStyle={{ padding: 14, gap: 12 }}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => hilo.current?.scrollToEnd({ animated: true })}
          >
            {!turnos.length && (
              <View style={{ gap: 10 }}>
                <Text style={s.intro}>
                  Preguntame de minería o del catastro. Si estás parado sobre el terreno, tocá «¿Dónde estoy?» y te digo qué dice el catastro de ese punto.
                </Text>
                {['¿se traslapa algo en el catastro?', '250.000 toneladas a 3,4 g/t, ¿cuántas onzas?', '¿qué concesiones vencen este año?'].map((e) => (
                  <Pressable
                    key={e}
                    onPress={() => void mandar(e)}
                    disabled={ocupado}
                    accessibilityRole="button"
                    accessibilityHint="Manda esta pregunta"
                    style={s.ejemplo}
                  >
                    <Text style={s.ejemploTexto}>{e}</Text>
                  </Pressable>
                ))}
              </View>
            )}

            {turnos.map((t) => {
              const abierta = trazasAbiertas.has(t.id);
              const fase = t.informe?.estado.fase;
              return (
                <View key={t.id} style={t.de === 'persona' ? s.mio : s.suyo}>
                  {t.de === 'doctor' && !!t.panel && <Text style={s.panel}>{t.panel}</Text>}
                  <Text
                    style={[t.de === 'persona' ? s.mioTexto : s.suyoTexto, t.fallo && t.de === 'doctor' && s.falloTexto]}
                    selectable
                    accessibilityLiveRegion={t.de === 'doctor' ? 'polite' : 'none'}
                  >
                    {t.texto}
                  </Text>
                  {t.avisos?.map((a, j) => (
                    <Text key={j} style={s.aviso}>
                      {a}
                    </Text>
                  ))}
                  {!!t.informe && (
                    <Pressable
                      onPress={() => void guardarPdf(t.id)}
                      disabled={fase === 'guardando'}
                      accessibilityRole="button"
                      accessibilityLabel={`Guardar en el teléfono el informe ${t.informe.nombre}`}
                      accessibilityState={{ disabled: fase === 'guardando', busy: fase === 'guardando' }}
                      style={s.informe}
                    >
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={s.informeNombre} numberOfLines={1}>
                          {t.informe.nombre}
                        </Text>
                        <Text style={s.informeMeta} numberOfLines={2}>
                          {t.informe.estado.fase === 'guardado'
                            ? `Guardado en ${t.informe.estado.carpeta}. Abrilo desde «Archivos».`
                            : `PDF${t.informe.bytes ? ` · ${tamanoLegible(t.informe.bytes)}` : ''} · se puede bajar durante media hora`}
                        </Text>
                      </View>
                      {fase === 'guardando' ? (
                        <ActivityIndicator color={ACENTO} size="small" />
                      ) : (
                        <Text style={s.informeAccion}>{fase === 'guardado' ? 'OTRA VEZ' : 'GUARDAR'}</Text>
                      )}
                    </Pressable>
                  )}
                  {!!t.traza?.length && (
                    <Pressable
                      onPress={() => alternarTraza(t.id)}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: abierta }}
                      accessibilityLabel={`Lo que consultó: ${t.traza
                        .map((h) => `${h.herramienta}, ${h.ok ? 'bien' : 'falló'}: ${h.resumen}`)
                        .join('. ')}`}
                      accessibilityHint={abierta ? 'Recoge el detalle' : 'Muestra el detalle completo'}
                      style={{ paddingVertical: 2 }}
                    >
                      {t.traza.map((h, j) => (
                        <Text key={j} style={[s.traza, !h.ok && { color: '#C98A5A' }]} numberOfLines={abierta ? undefined : 1}>
                          {h.ok ? '·' : '×'} {h.herramienta} — {h.resumen}
                        </Text>
                      ))}
                    </Pressable>
                  )}
                </View>
              );
            })}
            {pensando && (
              <Text style={s.pensando} accessibilityLiveRegion="polite">
                pensando…
              </Text>
            )}
          </ScrollView>

          <View style={s.entrada}>
            {/*
              * Varios renglones: lo dictado se tiene que poder LEER entero antes de mandarlo (para
              * eso no se manda solo), y en un renglón de 160 px en vertical no se veía ni la mitad.
              * `submitBehavior="submit"`: la tecla de enviar manda y el teclado se queda abierto
              * para la repregunta.
              */}
            <TextInput
              value={texto}
              onChangeText={setTexto}
              // En vertical la caja mide 160 px y la pista larga partía en dos renglones.
              placeholder={oyendo ? 'te escucho…' : apaisado ? 'Preguntale a Dr Electrum…' : 'Escribí tu pregunta…'}
              placeholderTextColor={oyendo ? ACENTO : TENUE}
              accessibilityLabel="Pregunta para Dr Electrum"
              style={s.campo}
              multiline
              maxLength={4000}
              submitBehavior="submit"
              onSubmitEditing={() => void mandar(texto, true)}
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
                accessibilityState={{ disabled: pensando }}
                hitSlop={8}
              >
                <Text style={[s.redondoTexto, oyendo && { color: '#000' }]}>{oyendo ? '■' : '🎙'}</Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => void abrirCamara()}
              disabled={ocupado}
              style={[s.redondo, ocupado && { opacity: 0.3 }]}
              accessibilityLabel="Fotografiar un papel para el expediente"
              accessibilityRole="button"
              accessibilityState={{ disabled: ocupado }}
              hitSlop={8}
            >
              <Text style={s.redondoTexto}>📷</Text>
            </Pressable>
            <Pressable
              onPress={() => void mandar(texto, true)}
              disabled={ocupado || !hayTexto}
              accessibilityRole="button"
              accessibilityLabel="Mandar la pregunta"
              accessibilityState={{ disabled: ocupado || !hayTexto, busy: pensando }}
              style={[s.ir, (ocupado || !hayTexto) && { opacity: 0.3 }]}
            >
              {pensando ? <ActivityIndicator color="#000" size="small" /> : <Text style={s.irTexto}>Ir</Text>}
            </Pressable>
          </View>
        </View>
      </View>

      {/*
        * La cámara a pantalla completa y con una sola instrucción. Quien está fotografiando un
        * plano sobre una mesa no quiere ajustes: quiere que quepa el recuadro con los datos.
        *
        * Translúcida, como la pantalla de atrás: así las dos se dibujan igual bajo las barras del
        * sistema y los mismos bordes (`b`) apartan los botones de ellas. Sin esto, en Android 15+
        * «Leer» caía bajo los botones de navegación.
        */}
      <Modal
        visible={camara}
        animationType="slide"
        onRequestClose={() => setCamara(false)}
        statusBarTranslucent
        navigationBarTranslucent
        supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
      >
        <View style={s.camaraRaiz}>
          <CameraView
            ref={lente}
            style={{ flex: 1 }}
            facing="back"
            onCameraReady={() => setLenteLista(true)}
            onMountError={(e) => {
              console.warn('[electrum] cámara no abrió:', e?.message);
              setCamara(false);
              agregar({ de: 'doctor', texto: 'No pude abrir la cámara. Cerrá otras apps que la estén usando y probá de nuevo.', fallo: true });
            }}
          />
          {/* En vertical la guía va en su renglón: entre los dos botones, en 360 px, quedaban dos
              renglones de ocho letras cortados a la mitad. */}
          {!apaisado && <Text style={[s.camaraGuia, s.camaraGuiaVertical]}>{GUIA_CAMARA}</Text>}
          <View
            style={[
              s.camaraPie,
              { paddingBottom: 16 + b.abajo, paddingLeft: 16 + b.izquierda, paddingRight: 16 + b.derecha },
              !apaisado && { justifyContent: 'space-between' },
            ]}
          >
            <Pressable onPress={() => setCamara(false)} hitSlop={6} accessibilityRole="button" accessibilityLabel="Cancelar la foto" style={s.chip}>
              <Text style={s.chipTexto}>CANCELAR</Text>
            </Pressable>
            {apaisado && (
              <Text style={s.camaraGuia} numberOfLines={2}>
                {GUIA_CAMARA}
              </Text>
            )}
            <Pressable
              onPress={() => void tomarFoto()}
              disabled={tomando || !lenteLista}
              accessibilityRole="button"
              accessibilityLabel="Tomar la foto y leerla"
              accessibilityState={{ disabled: tomando || !lenteLista, busy: tomando }}
              style={[s.disparo, (tomando || !lenteLista) && { opacity: 0.4 }]}
            >
              {tomando ? <ActivityIndicator color="#000" size="small" /> : <Text style={s.irTexto}>Leer</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  raiz: { flex: 1, backgroundColor: '#000' },
  barra: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 8 },
  marca: { color: ACENTO, fontSize: 12, fontWeight: '700', letterSpacing: 2.4 },
  estado: { color: TENUE, fontSize: 11, marginTop: 2, fontFamily: 'monospace' },
  /*
   * VOZ y SALIR iban a 9 pt en una píldora de 20 px de alto: ilegibles al sol y difíciles de
   * acertar. 13 pt y 44 px de alto, lo mínimo que se acierta con el pulgar sin mirar.
   */
  chip: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', borderRadius: 999, paddingHorizontal: 14, minHeight: 44, justifyContent: 'center' },
  chipOn: { borderColor: ACENTO },
  chipTexto: { color: GRIS, fontSize: 13, letterSpacing: 1.2, fontWeight: '600' },
  // `overflow` recorta a propósito: los anillos del halo miden 4,3 veces el iris y desbordaban
  // la caja, pisando el texto de abajo. Recortados quedan como una banda, que es lo que se busca.
  cuerpo: { flex: 1, flexDirection: 'row' },
  // Ancho fijo: la cara no crece con la pantalla, y lo que gana el teléfono se lo lleva el hilo.
  izquierda: { width: 240, paddingLeft: 14, paddingBottom: 14, justifyContent: 'space-between' },
  izquierdaVertical: { width: '100%', paddingHorizontal: 14, paddingBottom: 6, flexDirection: 'row', alignItems: 'center', gap: 12 },
  derecha: { flex: 1, borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.08)' },
  derechaVertical: { borderLeftWidth: 0, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' },
  redondo: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  redondoVivo: { backgroundColor: ACENTO, borderColor: ACENTO },
  redondoTexto: { fontSize: 17, color: '#E7EEF2' },
  camaraRaiz: { flex: 1, backgroundColor: '#000' },
  camaraPie: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 16, backgroundColor: '#000' },
  camaraGuia: { flex: 1, color: '#8FA3B0', fontSize: 12, lineHeight: 16 },
  camaraGuiaVertical: { flex: 0, paddingHorizontal: 16, paddingTop: 12, backgroundColor: '#000' },
  disparo: { backgroundColor: ACENTO, borderRadius: 999, paddingHorizontal: 20, minHeight: 44, justifyContent: 'center' },
  /*
   * La CAJA es más alta que el ESCENARIO de la cara (210 contra 150), y esa diferencia es el
   * arreglo. Subir las dos a la vez no servía de nada: la cara se centra en su escenario y dibuja
   * la boca por DEBAJO de él, así que con caja y escenario iguales la boca cae siempre justo en el
   * borde y `overflow: hidden` se la come. Recortar el halo está bien; recortarle la boca la deja
   * sin la mitad de la expresión.
   */
  caraCaja: { height: 210, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  // En vertical la cara va en la fila del botón: ancho fijo para que el escenario (100 %) tenga de
  // qué medirse, y el botón se lleva el resto.
  caraCajaVertical: { height: 120, width: 150 },
  hilo: { flex: 1 },
  intro: { color: GRIS, fontSize: 14, lineHeight: 21 },
  ejemplo: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: 999, paddingHorizontal: 14, minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  ejemploTexto: { color: '#9FB0B8', fontSize: 13 },
  mio: { alignSelf: 'flex-end', maxWidth: '88%', backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9 },
  mioTexto: { color: '#E7EEF2', fontSize: 14, lineHeight: 20 },
  suyo: { alignSelf: 'flex-start', maxWidth: '92%' },
  suyoTexto: { color: '#DDE7EC', fontSize: 14, lineHeight: 21, backgroundColor: 'rgba(255,255,255,0.045)', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9 },
  // Un fallo se distingue de una respuesta: borde del color del error, el mismo de la barra.
  falloTexto: { borderLeftWidth: 2, borderLeftColor: '#D9705A' },
  panel: { color: ACENTO, fontSize: 11, letterSpacing: 1.6, marginBottom: 4, fontWeight: '700' },
  aviso: { color: GRIS, fontSize: 12, lineHeight: 17, marginTop: 5, marginLeft: 4, fontStyle: 'italic' },
  informe: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
    minHeight: 52,
    borderWidth: 1,
    borderColor: ACENTO,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  informeNombre: { color: '#E7EEF2', fontSize: 13, fontWeight: '600' },
  informeMeta: { color: GRIS, fontSize: 11, marginTop: 2 },
  informeAccion: { color: ACENTO, fontSize: 12, fontWeight: '700', letterSpacing: 1.4 },
  traza: { color: TENUE, fontSize: 11, fontFamily: 'monospace', marginTop: 3, marginLeft: 4 },
  pensando: { color: TENUE, fontSize: 11, fontFamily: 'monospace' },
  donde: { marginRight: 14, borderWidth: 1, borderColor: ACENTO, borderRadius: 12, paddingVertical: 12, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  // En vertical el margen derecho ya lo pone la fila (paddingHorizontal): con los dos, quedaba doble.
  dondeVertical: { flex: 1, marginRight: 0 },
  dondeTexto: { color: ACENTO, fontSize: 12, fontWeight: '700', letterSpacing: 2 },
  // `alignItems: 'flex-end'`: con la caja en varios renglones, los botones quedan abajo, junto al pulgar.
  entrada: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 14, paddingBottom: 14, paddingTop: 6 },
  // `minWidth: 0`: sin eso la caja no cede su ancho natural y en vertical empujaba «Ir» fuera de la pantalla.
  campo: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    maxHeight: 120,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingTop: 11,
    paddingBottom: 11,
    color: '#E7EEF2',
    fontSize: 14,
    textAlignVertical: 'top',
  },
  ir: { backgroundColor: ACENTO, borderRadius: 12, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', minWidth: 56, minHeight: 44 },
  irTexto: { color: '#000', fontWeight: '700', fontSize: 13 },
});
