import { useCallback, useEffect, useRef, useState } from 'react';
import { miga, reportarEstado } from '../lib/reporte';
import { AccessibilityInfo, Alert, AppState, Animated, BackHandler, Linking, PanResponder, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Accelerometer } from 'expo-sensors';
import { UltronFace, type TouchZone } from '../components/UltronFace';
import { SalaAura, type PedidoTarea } from '../components/SalaAura';
import { CaraSegura } from '../cara/CaraSegura';
import { textoTarea, tareaDeHerramientas, type Postura, type Tarea } from '../lib/tareas';
import { T, SOMBRA } from '../tema';
import { CamaraVision, DORMIDO_PERIODO_MS, SERVIDOR_CADA_MS, SERVIDOR_DORMIDO_MS, type FrameGrabber } from '../components/CamaraVision';
import { DeskMenu } from '../components/DeskMenu';
import type { Escena, MotorVision } from '../lib/escena';
import type { DeskPresence, FaceState, Mode, SessionUser } from '../config';
import { CANCIONES_LOCAL, healthCheck, listCanciones, nuevoIdTurno, rememberFact, turno, turnoStream, type Cancion, type Turn } from '../lib/api';
import { faceForEmocion, type Emocion } from '../lib/emocion';
import { GENEROS, generoPorId, interpretar, type Gag } from '../lib/intenciones';
import { ayuda, CONOCER_CORE, CONOCER_QUESTIONS, fechaLocal, horaLocal, preguntaConocer } from '../lib/knowledge';
import { lineas, lineasGag } from '../lib/lineas';
import {
  caerANube,
  currentSttEngine,
  destroySpeech,
  enableAlwaysOnMic,
  ensureSpeechPermissions,
  isMicPaused,
  micWatchdogOk,
  muteMic,
  oidoEscuchando,
  oidoVivoDeVerdad,
  pauseMicForTts,
  reabrirMic,
  restartMic,
  setSpeechCallbacks,
  setSttEngine,
  unmuteMic,
  volverANativoSiToca,
} from '../lib/speech';
import {
  addLongFact,
  borrarRastrosViejos,
  clearLongMemory,
  loadConocerProgress,
  loadLongMemory,
  loadSettings,
  saveConocerProgress,
  saveSettings,
  type AppSettings,
  type SttEngine,
} from '../lib/storage';
import { playSfx, preloadSfx, setSfxEnabled } from '../lib/sfx';
import { StreamSpeaker, setAvatarVoz, setSpeechLevelListener, speak, speakPrayer, speakReaccion, speakSong, stopSpeaking, type SongRequest } from '../lib/tts';
import { frase, saludoConNombre, type FraseId } from '../lib/frases';
import { de, idiomaActual, tr, useIdioma } from '../i18n';
import { quitarExpresiones } from '../lib/expresiones';
import { ClaudioRetrato, fotosRetrato } from '../avatares/ClaudioRetrato';
import { ClaudioDePie, FOTOS_ANTONIO_PIE } from '../avatares/ClaudioDePie';
import { CuerpoMesa } from '../avatar3d/CuerpoMesa';
import { hayModelo3D } from '../avatar3d/AvatarVivo';
import { hayVideo } from '../avatares/video/clips';
import { SelectorAvatar } from '../avatares/SelectorAvatar';
import { avatarPorId, conFotos, distribucion, type AvatarId } from '../avatares/catalogo';
import { AccionesAvatar } from '../components/AccionesAvatar';
import { VozProvider, esperarAudioLibre, useVoz, useVozOpcional, vozOcupaMicrofono } from '../compa/VozProvider';
import { avisarMesa, mensajeVoz, nivelOido, oidoTelefono, sueloCompa } from '../compa/canales';
import { etiquetaCiclo, llamadaActiva, llamadaTerminada } from '../compa/llamadaCiclo';
import { accionesDelTurno } from '../compa/acciones';
import { emitir, escuchar } from '../nucleo/contrato';
import { usePulse } from '../pulse/PulseProvider';
import { ChatMesa } from '../components/ChatMesa';
import { ALTO_BARRA, BarraMesa } from '../components/BarraMesa';
import { HojaMas, type OpcionMas } from '../components/HojaMas';
import { Tutorial } from '../tutorial/Tutorial';
import { conTutorialVisto, tocaTutorial } from '../tutorial/pasos';
import { OidoMesa, VigilanteOido, duenoAudio, motivoFalloVoz, oidoPropio } from '../compa/duenoAudio';
import { ESPERA_FRASE_MS, estadoDeEspera, fraseDeEstado, vozDeEspera } from '../compa/frasesEstado';
import { ControlCamara, conPreferencia, pedidoDeCamara, prefiereSiempre, respuestaModoCamara, type EstadoCamara } from '../lib/camaraModo';
import { marcoMesa, useMesaVisible, useModoPresencia } from '../avatar3d/usePresencia';
import { useCaras, type ApiCaras } from '../caras/useCaras';
import { avatarActual } from '../avatares/actual';
import { orientar } from '../lib/orientacion';

type Props = {
  user: SessionUser;
  onLogout: () => void;
  /** Se acaba de elegir el avatar al entrar: se presenta él mismo con su voz. */
  recienElegido?: boolean;
};

const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

/** Un permiso negado: Android ya no vuelve a preguntar, así que se ofrece ir a los ajustes. */
function pedirEnAjustes(titulo: string, texto: string) {
  Alert.alert(titulo, texto, [
    { text: tr('Ahora no', 'Not now'), style: 'cancel' },
    { text: tr('Abrir ajustes', 'Open settings'), onPress: () => void Linking.openSettings().catch(() => {}) },
  ]);
}

const GAG_EMOCION: Record<string, Emocion> = {
  sad: 'triste',
  happy: 'feliz',
  angry: 'molesto',
  startle: 'sorpresa',
  confused: 'pensando',
  yawn: 'cansado',
  wink: 'travieso',
  laugh: 'risa',
  proud: 'orgullo',
  curious: 'curioso',
};

/** Gag → una expresión corta antes de las líneas, dicha en vivo por el avatar. */
const GAG_FRASE: Record<string, FraseId> = { sad: 'triste', angry: 'molesto', startle: 'sorpresa', yawn: 'bostezo', laugh: 'risacorta' };

const haptic = (kind: 'light' | 'medium' = 'light') =>
  Haptics.impactAsync(kind === 'light' ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

/**
 * La mesa. La conversación fluida vive en el VozProvider (src/compa), montado encima de todas las
 * pantallas; si alguien monta la mesa sin él, la mesa se lo pone a sí misma y sigue igual.
 */
export function DeskScreen(props: Props) {
  const voz = useVozOpcional();
  if (voz) return <Mesa {...props} />;
  return (
    <VozProvider>
      <Mesa {...props} />
    </VozProvider>
  );
}

/** Las acciones que el cerebro decidió en el turno de la mesa van al bus (la app las hace). */
function emitirAccionesDelTurno(r: unknown) {
  for (const a of accionesDelTurno(r)) emitir('accion', a);
}

function Mesa({ user, onLogout, recienElegido = false }: Props) {
  // PULSE2CHAT: el chat y las llamadas entre personas con Genesis ID (ver src/pulse).
  const pulse = usePulse();
  // Toda la mesa se redibuja si cambia el idioma (desde el menú), y el oído vuelve a arrancar en
  // el idioma nuevo (el reconocedor del teléfono fija el idioma al empezar a escuchar).
  const idioma = useIdioma();
  const idiomaOido = useRef(idioma);
  useEffect(() => {
    if (idiomaOido.current === idioma) return;
    idiomaOido.current = idioma;
    void restartMic().catch(() => {});
  }, [idioma]);
  // Diagnóstico de campo: si la app muere aquí, el servidor sabrá hasta dónde llegó.
  useEffect(() => {
    miga('DeskScreen montado');
    // Solo avisa que llegó bien; si luego muere en primer plano, se reporta al reabrir (ver reporte.ts).
    const t = setTimeout(() => reportarEstado('mesa estable'), 8000);
    return () => clearTimeout(t);
  }, []);

  const [face, setFace] = useState<FaceState>('IDLE');
  /** La emoción que abrió la respuesta: la sala la muestra con el cuerpo (la cara de respaldo no la usa). */
  const [emocion, setEmocion] = useState<Emocion>('neutral');
  /** Sube cada vez que se toca un atajo: Claudio o ANT-ONIO lo señalan. */
  const [senalAtajo, setSenalAtajo] = useState(0);
  /** AU-RA de cuerpo entero; si la WebView no puede con la sala, vuelve la cara de siempre. */
  const [conSala, setConSala] = useState(true);
  /** Su cara: los anillos (Skia) o la habitación 3D. null hasta leer los ajustes, para no parpadear entre las dos. */
  const [cara, setCara] = useState<'anillos' | 'sala' | null>(null);
  /** Skia no cargó o no pudo dibujar: se queda la cara de siempre. */
  const [skiaFallo, setSkiaFallo] = useState(false);
  /** De pie o sentada al contestar; null hasta leer el ajuste guardado (la sala nace ya en su sitio). */
  const [postura, setPostura] = useState<Postura | null>(null);
  const [pedido, setPedido] = useState<PedidoTarea | null>(null);
  const [mode, setMode] = useState<Mode>('GUARDIAN');
  const [presence, setPresence] = useState<DeskPresence>('stay');
  const [bubble, setBubble] = useState('');
  const [status, setStatus] = useState<'boot' | 'listening' | 'muted' | 'thinking' | 'speaking' | 'orando' | 'reconnect' | 'offline'>('boot');
  const [draft, setDraft] = useState('');
  const [listening, setListening] = useState(false);
  const [level, setLevel] = useState(0);
  /** El volumen del micrófono solo lo dibuja la cara clásica: con las otras no se re-renderiza por él. */
  const nivelVisible = useRef(false);
  const [micMuted, setMicMuted] = useState(false);
  /** La cámara arranca APAGADA (lib/camaraModo.ts): se enciende solo ahora o siempre, a pedido. */
  const [visionOn, setVisionOn] = useState(false);
  const camara = useRef(new ControlCamara()).current;
  const [estadoCamara, setEstadoCamara] = useState<EstadoCamara>(camara.estado());
  /** Se preguntó «¿solo ahora o siempre?» y se espera la respuesta. */
  const esperaModoCamara = useRef(false);
  const [masAbierto, setMasAbierto] = useState(false);
  const [tutorialAbierto, setTutorialAbierto] = useState(false);
  /**
   * Charlar (el avatar grande, de frente) o Trabajar (el avatar compacto arriba y la conversación
   * escrita debajo, para leer y volver a consultar lo dicho). Se elige en «Más» y se guarda.
   */
  const [modoMesa, setModoMesa] = useState<'charlar' | 'trabajar'>('charlar');
  /** El alto de la columna de abajo (atajos + barra): la burbuja y lo que va oyendo van justo encima. */
  const [altoAbajo, setAltoAbajo] = useState(ALTO_BARRA + 58);
  const [gaze, setGaze] = useState({ x: 0, y: 0 });
  const [objects, setObjects] = useState<string[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  /** El selector de avatar abierto desde el menú (al entrar se elige en App, antes de la mesa). */
  const [eligiendo, setEligiendo] = useState<'menu' | null>(null);
  // La mesa no se apaga sola: si la pantalla se bloquea, deja de escuchar y de verte.
  useKeepAwake('mesa');
  // Botón atrás de Android: cierra el menú; con el menú cerrado hace lo de siempre.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (eligiendo === 'menu') {
        setEligiendo(null);
        return true;
      }
      if (!menuOpen) return false;
      setMenuOpen(false);
      return true;
    });
    return () => sub.remove();
  }, [menuOpen, eligiendo]);
  const [catalogRequest, setCatalogRequest] = useState(0);
  const [attack, setAttack] = useState<'blaster' | 'saber' | null>(null);
  const [irritation, setIrritation] = useState(0);
  const [online, setOnline] = useState(true);
  const [partial, setPartial] = useState('');
  const [toolHint, setToolHint] = useState('');
  const [winkSide, setWinkSide] = useState<'L' | 'R'>('L');
  const [canciones, setCanciones] = useState<Cancion[]>(CANCIONES_LOCAL);
  const [settings, setSettings] = useState<Pick<AppSettings, 'sttEngine' | 'proactive' | 'sfx'>>({ sttEngine: 'native', proactive: true, sfx: true });
  const [camPerm, requestCam] = useCameraPermissions();
  /** 0 nadie · 0.5 alguien delante · 1 alguien mirando la pantalla (la cara se ilumina). */
  const [atencion, setAtencion] = useState(0);
  const [verPersona, setVerPersona] = useState(false);
  const [visionMotor, setVisionMotor] = useState<MotorVision>('ninguno');
  /** Con quién se habla: AU-RA (los ojos), Claudio o Claudio de pie. null hasta leer los ajustes. */
  const [avatar, setAvatar] = useState<AvatarId | null>(null);
  /** Lo que se dijo en la mesa, para el chat del modo cuadro (vertical). */
  const [mensajes, setMensajes] = useState<Turn[]>([]);
  /*
   * Conversación fluida (ElevenLabs Agents), del VozProvider: el micrófono y la voz van por WebRTC
   * mientras dura. Durante ella el micrófono que manda es el de WebRTC, no el de la mesa: el botón
   * de siempre lo silencia (de verdad: micrófono y voz) mientras se conversa.
   */
  const voz = useVoz();
  const vozRef = useRef(voz);
  vozRef.current = voz;
  const conversando = voz.vista.montada;
  const convSilencio = voz.vista.silenciada;
  const estadoConv = voz.vista.estado;
  /**
   * La llamada del avatar tiene el micrófono (suena, conecta o se habla; o la sesión dormida por un
   * silencio largo): la mesa no oye ni habla sola (M3). Al colgar, el oído de la mesa vuelve.
   */
  const vozOcupa = vozOcupaMicrofono(voz.vista) || llamadaActiva(voz.ciclo);
  const conversandoRef = useRef(vozOcupa);
  conversandoRef.current = vozOcupa;
  /** Hay una llamada: la mesa calla, no oye y apaga la cámara hasta colgar. */
  const enLlamadaRef = useRef(false);
  const micApagado = conversando ? convSilencio : micMuted;
  /** La mesa es la pantalla que se ve (la pila nativa la deja montada debajo de los chats y Ajustes). */
  const mesaVisible = useMesaVisible();
  const mesaVisibleRef = useRef(mesaVisible);
  mesaVisibleRef.current = mesaVisible;
  /** Hay una llamada (estado, para decidir el dueño del audio; el ref de abajo es para los callbacks). */
  const [enLlamada, setEnLlamada] = useState(false);
  /** La app está delante (con la app detrás la mesa no oye, no mira ni mueve sensores). */
  const [appActiva, setAppActiva] = useState(AppState.currentState !== 'background');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => setAppActiva(st !== 'background'));
    return () => sub.remove();
  }, []);
  /**
   * La mesa está viva: se ve y la app está delante. Los sensores (acelerómetro), la mirada errante, el
   * enojo que baja solo y el perro guardián del micrófono solo corren así (A25: una pantalla tapada en
   * la pila no gasta batería ni reinicia un micrófono que es de otro).
   */
  const mesaActiva = mesaVisible && appActiva;
  /**
   * La compañera se ve (los chats, Ajustes o el perfil encima de la mesa; chiquita, al lado o a
   * pantalla completa): entonces el oído de la mesa sigue abierto y ella atiende (compa/duenoAudio.ts).
   */
  const modoPresencia = useModoPresencia();
  const companeraVisible = modoPresencia === 'paseo' || modoPresencia === 'lado' || modoPresencia === 'completa';
  const { width: anchoPantalla, height: altoPantalla } = useWindowDimensions();
  const horizontal = anchoPantalla >= altoPantalla;

  const speakingRef = useRef(false);
  const handling = useRef(false);
  const pending = useRef<string | null>(null);
  const presenceRef = useRef<DeskPresence>('stay');
  const modeRef = useRef<Mode>('GUARDIAN');
  const micMutedRef = useRef(false);
  const irritationRef = useRef(0);
  const tapCount = useRef(0);
  const touchGazeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragging = useRef(false);
  const personSeenAt = useRef(0);
  const conocerIdxRef = useRef(-1);
  const objectsRef = useRef<string[]>([]);
  const sceneRef = useRef('');
  const lastSceneRemark = useRef(0);
  const lastUserAt = useRef(Date.now());
  const historial = useRef<Turn[]>([]);
  const longMemory = useRef<string[]>([]);
  const lastTapAt = useRef(0);
  const listenOffTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recentTaps = useRef<number[]>([]);
  const proactiveRef = useRef(true);
  const grabFrame = useRef<FrameGrabber | null>(null);
  /** Cortar el turno en curso (el stream) y marcar que se canceló: «callar» no espera al cerebro. */
  const abortTurno = useRef<(() => void) | null>(null);
  const turnoCancelado = useRef(false);
  const bubbleOp = useRef(new Animated.Value(0)).current;
  /** Última escena de la cámara local (descripción en español para el cerebro). */
  const escenaRef = useRef<Escena | null>(null);
  const lastGreetAt = useRef(0);
  const lastSonrisaAt = useRef(0);
  const acompanaDicho = useRef(false);
  const gazeCamAt = useRef(0);
  const gazeCamLast = useRef({ x: 0, y: 0 });
  const sonrisaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Un solo dueño del audio (compa/duenoAudio.ts): la mesa oye y habla solo si se la ve y no hay
   * conversación en vivo ni llamada. Al perderlo corta su turno, calla y SUELTA la pausa del micrófono
   * (una voz cortada no llama a su onEnd: esa pausa colgada dejaba a la mesa sorda en 4.7.0).
   */
  /** El oído de la mesa ya se abrió con el permiso concedido (el arranque o la persona al activarlo). */
  const oidoListo = useRef(false);
  /** El último pedido vino del oído (no del teclado ni de un atajo): el turno va con los topes de la voz. */
  const ultimoHablado = useRef(false);
  /** El reconocimiento de caras (se engancha más abajo, cuando ya existe `say`). */
  const carasRef = useRef<ApiCaras | null>(null);
  const oidoMesa = useRef<OidoMesa | null>(null);
  if (!oidoMesa.current) {
    oidoMesa.current = new OidoMesa({
      muteMic,
      unmuteMic,
      reabrirMic,
      pauseMicForTts,
      stopSpeaking,
      cancelarTurno: () => {
        turnoCancelado.current = true;
        abortTurno.current?.();
        pending.current = null;
      },
      // Solo si el oído ya se abrió una vez con el permiso (no se abre «a ciegas» al volver de otra pantalla).
      micQuerido: () => oidoListo.current && !micMutedRef.current,
      // Al colgar, el oído se reabre cuando la conversación soltó de verdad el audio (como mucho 4 s).
      esperarAudioLibre: () => esperarAudioLibre(),
      miga,
    });
    // Nace dueña (la mesa se monta visible) sin abrir nada todavía: el oído lo abre el arranque, con
    // el permiso ya pedido. El efecto de abajo corrige si el audio es de otro.
    oidoMesa.current.fijar('mesa');
  }

  useEffect(() => void (presenceRef.current = presence), [presence]);
  useEffect(() => void (modeRef.current = mode), [mode]);
  useEffect(() => void (objectsRef.current = objects), [objects]);
  useEffect(() => void (micMutedRef.current = micMuted), [micMuted]);

  // Lip-sync: la cara se suscribe directamente al nivel de la voz (0..1, 20 Hz) y mueve la boca con
  // Animated; nada de setState aquí (antes cada muestra re-renderizaba DeskScreen y UltronFace).
  const suscribirNivelVoz = useCallback((cb: (level01: number) => void) => {
    setSpeechLevelListener(cb);
    return () => setSpeechLevelListener(null);
  }, []);

  const restFace = useCallback((): FaceState => (presenceRef.current === 'sleep' ? 'SLEEPING' : 'IDLE'), []);
  /**
   * La línea de estado en reposo. «Escuchando» solo si un motor escucha de verdad (speech.oidoEscuchando):
   * pedir que escuche no es que escuche. Con el audio de otro (la conversación, una llamada) no se toca.
   */
  const idleStatus = useCallback(() => {
    if (micMutedRef.current) return setStatus('muted');
    if (!oidoMesa.current?.oye()) return;
    setStatus(oidoEscuchando() ? 'listening' : 'reconnect');
  }, []);

  /**
   * ¿La escena sigue valiendo como hecho? La ventana depende del MOTOR y del MODO, porque cada
   * combinación tiene su propia cadencia (las constantes salen de `CamaraVision`, no se copian):
   *  - ML Kit despierto: ≥ 2 emisiones/s → 12 s de margen de sobra.
   *  - ML Kit dormido: la cámara solo se enciende 2,5 s cada DORMIDO_PERIODO_MS (12 s), así que entre
   *    escena y escena pueden pasar ~12 s; se aceptan 2× el periodo (24 s).
   *  - Servidor: una foto cada SERVIDOR_CADA_MS (30 s dormido) → 2,5× su cadencia.
   */
  const escenaFresca = useCallback((e: Escena | null): e is Escena => {
    if (!e || e.motor === 'ninguno') return false;
    const durmiendo = presenceRef.current === 'sleep';
    const ventana =
      e.motor === 'servidor'
        ? 2.5 * (durmiendo ? SERVIDOR_DORMIDO_MS : SERVIDOR_CADA_MS)
        : durmiendo
        ? 2 * DORMIDO_PERIODO_MS
        : 12_000;
    return Date.now() - e.ts <= ventana;
  }, []);

  /** Descripción de la escena si es reciente y viene de un motor real; va en el body del turno. */
  const escenaReciente = useCallback((): string | undefined => {
    const e = escenaRef.current;
    const quien = carasRef.current?.escena() || '';
    const d = escenaFresca(e) ? e.descripcion : '';
    return [d, quien].filter(Boolean).join(' ') || undefined;
  }, [escenaFresca]);

  // La burbuja y el hilo son para LEER: las expresiones de voz ([risa]…) se oyen, no se enseñan.
  const showBubble = useCallback(
    (text: string) => {
      setBubble(quitarExpresiones(text).trim());
      Animated.timing(bubbleOp, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    },
    [bubbleOp]
  );

  /** Que se le vea hacer la tarea: la sala camina al escritorio, al sillón o saca la libreta. */
  const hacerTarea = useCallback((tarea: Tarea) => setPedido({ tarea, n: Date.now() }), []);

  useEffect(() => {
    if (!bubble) return;
    const t = setTimeout(() => Animated.timing(bubbleOp, { toValue: 0, duration: 500, useNativeDriver: true }).start(), 9000);
    return () => clearTimeout(t);
  }, [bubble, bubbleOp]);

  const logUltron = useCallback((text: string) => {
    const texto = quitarExpresiones(text).trim();
    historial.current = [...historial.current, { rol: 'ultron' as const, texto }].slice(-12);
    if (texto) setMensajes((m) => [...m, { rol: 'ultron' as const, texto }].slice(-80));
  }, []);

  /** Fin de cualquier audio: mic de vuelta, cara en reposo, HUD según mute real (ref, no closure). */
  const settle = useCallback(() => {
    speakingRef.current = false;
    avisarMesa({ hablando: false, pensando: false });
    pauseMicForTts(false);
    setFace(restFace());
    idleStatus();
  }, [idleStatus, restFace]);

  const onAudio = useCallback((f: FaceState) => {
    pauseMicForTts(true);
    speakingRef.current = true;
    avisarMesa({ hablando: true, pensando: false });
    setStatus('speaking');
    setFace(f);
  }, []);

  const say = useCallback(
    async (text: string, nextFace?: FaceState, opts?: { performance?: 'speak' | 'sing'; emocion?: Emocion }) => {
      const emocion = opts?.emocion || 'neutral';
      const performance = opts?.performance || 'speak';
      if (emocion !== 'neutral') setEmocion(emocion);
      const f = nextFace || (performance === 'sing' ? 'SING' : faceForEmocion(emocion));
      showBubble(text);
      // En la conversación fluida o en una llamada la mesa no habla: se lee, no se oye (M3; un solo
      // dueño del audio). Tapada por los chats sí, si el audio es de la compañera: ella lo dice.
      if (conversandoRef.current || enLlamadaRef.current || !oidoMesa.current?.puedeHablar()) return;
      logUltron(text);
      avisarMesa({ emocion, texto: quitarExpresiones(text).trim() });
      speakingRef.current = true;
      setFace(f);
      setStatus('speaking');
      // risa: una risa corta grabada antes del texto (si no hay ninguna, se sigue sin ella)
      if (emocion === 'risa') await speakReaccion('risa', { onAudioStart: () => onAudio('LAUGH') });
      await speak(text, {
        performance,
        emocion,
        onAudioStart: () => onAudio(f === 'IDLE' || f === 'LISTENING' ? 'SPEAKING' : f),
        onEnd: settle,
      });
    },
    [logUltron, onAudio, settle, showBubble]
  );

  /** Una frase corta de la mesa (frases.ts), dicha en vivo por el avatar y en el idioma elegido. */
  const playClip = useCallback(
    async (id: FraseId, f: FaceState, opts?: { emocion?: Emocion }) => {
      await say(frase(id), f, { emocion: opts?.emocion });
      return true;
    },
    [say]
  );

  /* ---------- La cámara: apagada por omisión; solo ahora o siempre (lib/camaraModo.ts) ---------- */
  useEffect(() => camara.suscribir((e) => {
    setEstadoCamara(e);
    setVisionOn(e.modo !== 'apagada');
    if (e.modo === 'apagada') setObjects([]);
  }), [camara]);
  // «Solo ahora» vence sola; y al irse de la mesa se apaga (la cámara no mira detrás de los chats).
  useEffect(() => {
    const t = setInterval(() => {
      if (camara.tic()) miga('cámara: «solo ahora» venció, se apaga');
    }, 15_000);
    return () => clearInterval(t);
  }, [camara]);
  useEffect(() => {
    if (!mesaVisible && camara.alSalirDeLaMesa()) miga('cámara: salió de la mesa, «solo ahora» se apaga');
  }, [mesaVisible, camara]);

  /** Enciende la cámara (pide el permiso si falta). `siempre` además queda guardado para esta persona. */
  const encenderCamara = useCallback(
    async (modo: 'temporal' | 'siempre'): Promise<boolean> => {
      if (!camPerm?.granted) {
        const r = await requestCam();
        if (!r.granted) {
          pedirEnAjustes(tr('Cámara', 'Camera'), tr('Para verte necesito la cámara. Actívala en los ajustes del teléfono.', 'I need the camera to see you. Turn it on in the phone settings.'));
          return false;
        }
      }
      camara.encender(modo);
      const s0 = await loadSettings();
      await saveSettings({ camaraSiempre: conPreferencia(s0.camaraSiempre, user.correo, modo === 'siempre') });
      miga(`cámara: encendida (${modo})`);
      return true;
    },
    [camPerm?.granted, camara, requestCam, user.correo]
  );
  const apagarCamara = useCallback(
    async (quitarSiempre: boolean) => {
      camara.apagar();
      if (quitarSiempre) {
        const s0 = await loadSettings();
        await saveSettings({ camaraSiempre: conPreferencia(s0.camaraSiempre, user.correo, false) });
      }
      miga(`cámara: apagada${quitarSiempre ? ' (y sin «siempre»)' : ''}`);
    },
    [camara, user.correo]
  );
  /** Lo que se lee debajo de «Cámara» en la hoja «Más». */
  const textoCamara =
    estadoCamara.modo === 'siempre'
      ? tr('Siempre', 'Always')
      : estadoCamara.modo === 'temporal'
        ? tr(`Solo ahora · ${Math.max(1, Math.round((estadoCamara.hasta - Date.now()) / 60_000))} min`, `Just now · ${Math.max(1, Math.round((estadoCamara.hasta - Date.now()) / 60_000))} min`)
        : tr('Apagada', 'Off');
  /** El botón «Cámara» de la hoja «Más»: encenderla (solo ahora / siempre) o apagarla. */
  const menuCamara = useCallback(() => {
    if (camara.encendida()) {
      const siempre = camara.estado().modo === 'siempre';
      Alert.alert(tr('Cámara encendida', 'Camera on'), siempre ? tr('Está en «siempre»: se enciende cada vez que entras.', 'It’s set to “always”: it turns on every time you come in.') : tr('Está encendida solo por ahora.', 'It’s on just for now.'), [
        { text: tr('Dejarla así', 'Keep it'), style: 'cancel' },
        ...(siempre ? [{ text: tr('Quitar «siempre»', 'Stop “always”'), onPress: () => void apagarCamara(true) }] : []),
        { text: tr('Apagar', 'Turn off'), style: 'destructive' as const, onPress: () => void apagarCamara(false) },
      ]);
      return;
    }
    Alert.alert(tr('¿Te puedo ver?', 'May I see you?'), tr('La cámara me deja mirarte y ver lo que hay en la mesa. «Solo ahora» se apaga sola en 10 minutos o al salir de la mesa.', 'The camera lets me look at you and the desk. “Just now” turns off by itself in 10 minutes or when you leave the desk.'), [
      { text: tr('Cancelar', 'Cancel'), style: 'cancel' },
      { text: tr('Siempre', 'Always'), onPress: () => void encenderCamara('siempre') },
      { text: tr('Solo ahora', 'Just now'), onPress: () => void encenderCamara('temporal') },
    ]);
  }, [apagarCamara, camara, encenderCamara]);

  const camaraRef = useRef(camara);
  const encenderCamaraRef = useRef(encenderCamara);
  encenderCamaraRef.current = encenderCamara;
  const apagarCamaraRef = useRef(apagarCamara);
  apagarCamaraRef.current = apagarCamara;

  const caras = useCaras({
    correo: user.correo,
    nombre: user.name,
    nombreAvatar: de(avatarPorId(avatar || 'aura').nombre),
    camaraEncendida: visionOn && !!camPerm?.granted,
    mesaVisible,
    grabFrame,
    decir: (t, e) => say(t, e === 'feliz' ? 'HAPPY' : e === 'preocupado' ? 'CONCERNED' : e === 'curioso' ? 'CURIOUS' : 'IDLE', { emocion: e && e !== 'neutral' ? e : 'neutral' }),
    encenderCamara: () => encenderCamara('temporal'),
  });
  carasRef.current = caras;

  /**
   * «Olvidar» (menú o voz): borra la memoria de largo plazo de quien está en la mesa, no la de los
   * demás. Es irreversible, así que antes se pregunta.
   */
  const confirmarOlvido = useCallback(() => {
    Alert.alert(tr('¿Olvidar lo que recuerdo de ti?', 'Forget what I remember about you?'), tr(`Se borran los hechos que guardé en este teléfono para ${user.name}. No se puede deshacer.`, `The facts I saved on this phone for ${user.name} will be erased. This can’t be undone.`), [
      { text: tr('Cancelar', 'Cancel'), style: 'cancel' },
      {
        text: tr('Olvidar', 'Forget'),
        style: 'destructive',
        onPress: () =>
          void (async () => {
            await clearLongMemory(user);
            longMemory.current = [];
            await say(tr('Memoria de largo plazo borrada.', 'Long-term memory erased.'), 'CONCERNED', { emocion: 'preocupado' });
          })(),
      },
    ]);
  }, [say, user]);

  /** AU-RA canta: POST /api/cantar. Cara SING, mic pausado, sin rellenos. */
  const sing = useCallback(
    async (req: SongRequest, titulo: string) => {
      // El repertorio está grabado con la voz de AU-RA: los otros avatares no lo cantan con la de ella.
      if ('id' in req && avatarActual() !== 'aura') {
        await say(
          tr(
            `«${titulo}» la tiene grabada AU-RA con su voz. Cámbiame a AU-RA para oírla, o dime la letra y te la digo yo.`,
            `“${titulo}” is recorded in AU-RA’s voice. Switch to AU-RA to hear it, or give me the lyrics and I’ll say them.`
          ),
          'CONCERNED',
          { emocion: 'preocupado' }
        );
        return;
      }
      showBubble(`♪ ${titulo}`);
      logUltron(`(canta ${titulo})`);
      speakingRef.current = true;
      setFace('SING');
      setStatus('speaking');
      setToolHint(tr('afinando', 'warming up'));
      const ok = await speakSong(req, {
        onPreparing: () => setToolHint(tr('preparando la canción', 'preparing the song')),
        onAudioStart: () => {
          setToolHint('');
          onAudio('SING');
        },
        onEnd: settle,
      });
      setToolHint('');
      if (!ok) await say(tr('No pude cantar esa ahora. Prueba con «canta 1» o «canta salsa».', 'I couldn’t sing that one right now. Try “sing 1” or “sing salsa”.'), 'CONCERNED', { emocion: 'preocupado' });
    },
    [logUltron, onAudio, say, settle, showBubble]
  );

  /** Oración del día: POST /api/orar. Cara PRAY, mic pausado, sin rellenos, HUD «orando». */
  const pray = useCallback(
    async (tema?: string) => {
      showBubble(tema ? `Oración por ${tema}` : 'Oración por el día');
      logUltron(tema ? `(ora por ${tema})` : '(ora por el día)');
      speakingRef.current = true;
      setFace('PRAY');
      setStatus('orando');
      setToolHint('');
      const ok = await speakPrayer({
        tema,
        onPreparing: () => setToolHint(tr('preparando la oración', 'preparing the prayer')),
        onAudioStart: () => {
          setToolHint('');
          pauseMicForTts(true);
          speakingRef.current = true;
          setStatus('orando');
          setFace('PRAY');
        },
        onEnd: settle,
      });
      setToolHint('');
      if (!ok) await say(tr('No pude traer la oración ahora. Inténtalo en un momento.', 'I couldn’t bring up the prayer right now. Try again in a moment.'), 'CONCERNED', { emocion: 'preocupado' });
    },
    [logUltron, say, settle, showBubble]
  );

  const startConocer = useCallback(
    async (mas: boolean) => {
      const progress = await loadConocerProgress(user.correo);
      if (progress.completedCore && !mas) {
        await say(tr('Ya completamos las diez preguntas principales. Si quieres, di «conocer más».', 'We finished the ten main questions. If you want, say “learn more”.'), 'HAPPY', { emocion: 'feliz' });
        return;
      }
      const next = CONOCER_QUESTIONS.findIndex((q) => !progress.answeredIds.includes(q.id));
      if (next < 0) {
        await say(tr('Ya respondiste todo lo que tenía para preguntarte. Gracias.', 'You’ve answered everything I had to ask. Thank you.'), 'HAPPY', { emocion: 'carino' });
        return;
      }
      setMode('CONOCER');
      modeRef.current = 'CONOCER';
      conocerIdxRef.current = next;
      await say(
        `${mas ? tr('Sigamos conociéndonos.', 'Let’s keep getting to know each other.') : tr(`Quiero conocerte. Son ${CONOCER_CORE} preguntas cortas; di «luego» y lo dejamos.`, `I’d like to get to know you. It’s ${CONOCER_CORE} short questions; say “later” and we’ll stop.`)} ${preguntaConocer(next)}`,
        'CURIOUS',
        { emocion: 'curioso' }
      );
    },
    [say, user.correo]
  );

  const exitConocer = useCallback(
    async (line = 'Vale, lo dejamos aquí. Cuando quieras seguimos.') => {
      conocerIdxRef.current = -1;
      setMode('GUARDIAN');
      modeRef.current = 'GUARDIAN';
      await say(line, 'HAPPY', { emocion: 'carino' });
    },
    [say]
  );

  const fireBlaster = useCallback(
    async (line: string) => {
      setAttack('blaster');
      setFace('ANGRY');
      playSfx('blaster');
      await say(line, 'ANGRY', { emocion: 'travieso' });
      setAttack(null);
      irritationRef.current = 0.25;
      setIrritation(0.25);
    },
    [say]
  );

  const fireSaber = useCallback(async () => {
    setAttack('saber');
    setFace('ANGRY');
    playSfx('saber');
    await say(tr('Sable de luz, listo. Que Orden Global te acompañe.', 'Lightsaber ready. May Orden Global be with you.'), 'ANGRY', { emocion: 'travieso' });
    setAttack(null);
  }, [say]);

  const askBrain = useCallback(
    async (cmd: string, opts?: { image?: string }) => {
      setFace('THINKING');
      setStatus('thinking');
      avisarMesa({ pensando: true });
      setToolHint('');
      const base = {
        message: cmd,
        mode: modeRef.current,
        userName: user.name,
        correo: user.correo,
        historial: historial.current,
        memoria: longMemory.current,
        image: opts?.image,
        escena: escenaReciente(),
        hablado: ultimoHablado.current,
        // Uno por frase y el mismo en los reintentos de abajo: el servidor no corre la frase dos veces.
        idTurno: nuevoIdTurno(),
      };
      ultimoHablado.current = false;
      let emocion: Emocion = 'neutral';
      let reacted = false;
      // Un solo relleno y solo si el cerebro de verdad tarda (ESPERA_FRASE_MS, ~2,5 s; inmediato con
      // imagen, que siempre tarda), con la voz del avatar. Antes salía a los 700 ms, en casi todos los
      // turnos, y la respuesta ESPERABA a que terminara (StreamSpeaker no corta la frase en curso): el
      // relleno no tapaba la espera, la alargaba. Lo que contesta el camino rápido llega mucho antes y
      // no lo oye nunca (el primer trozo lo cancela).
      // La frase sale del banco según lo pedido (buscar, leer, calcular, mirar…), con la forma de ser
      // del avatar, sin repetir las últimas ni su arranque, y casi siempre con su etiqueta de audio v4
      // (compa/etiquetasVoz.ts). Antes eran dos fijas: «Mmm… déjame ver» y «Un momento» (José: «es
      // molesto después de un rato»).
      const mmm = () => {
        if (!oidoMesa.current?.puedeHablar()) return;
        const quien = avatarActual();
        const estado = opts?.image ? 'mirando' : estadoDeEspera(cmd);
        const f = fraseDeEstado(estado, quien, idiomaActual() === 'en' ? 'en' : 'es');
        void speak(vozDeEspera(f.texto, estado, quien), { emocion: f.emocion, onAudioStart: () => pauseMicForTts(true), onEnd: () => !speakingRef.current && pauseMicForTts(false) });
      };
      let mmmTimer: ReturnType<typeof setTimeout> | null = opts?.image ? (mmm(), null) : setTimeout(mmm, ESPERA_FRASE_MS);
      const cancelMmm = () => {
        if (mmmTimer) clearTimeout(mmmTimer);
        mmmTimer = null;
      };
      const applyMode = (m?: Mode) => {
        if (m && m !== 'CONOCER' && m !== modeRef.current) setMode(m);
      };
      turnoCancelado.current = false;
      const t0Turno = Date.now();
      try {
        // 1) Streaming: la cara reacciona con `emocion` antes del primer delta y habla por oraciones.
        if (!opts?.image) {
          let speaker: StreamSpeaker | null = null;
          try {
            const st = turnoStream(base, {
              onEmocion: (e) => {
                emocion = e;
                reacted = true;
                setEmocion(e);
                avisarMesa({ emocion: e });
                cancelMmm();
                setFace(faceForEmocion(e));
                speaker?.setEmocion(e);
                if (e === 'risa') void speakReaccion('risa', { onAudioStart: () => onAudio('LAUGH') });
              },
              onDelta: (piece) => {
                cancelMmm();
                if (!speaker) {
                  speaker = new StreamSpeaker({
                    emocion,
                    onAudioStart: () => onAudio(faceForEmocion(emocion)),
                    onSentence: (sentence) => {
                      showBubble(sentence);
                      // Con la mesa tapada lo dice la compañera: su globito lee lo mismo que suena.
                      avisarMesa({ texto: quitarExpresiones(sentence).trim(), emocion });
                    },
                  });
                }
                speaker.push(piece);
              },
              onTools: (tools) => {
                const t = tareaDeHerramientas(tools);
                if (t) {
                  hacerTarea(t);
                  setToolHint(textoTarea(t));
                }
              },
            });
            abortTurno.current = st.abort;
            const result = await st.promise.finally(() => {
              abortTurno.current = null;
            });
            cancelMmm();
            if (turnoCancelado.current) {
              if (speaker) (speaker as StreamSpeaker).cancel();
              return;
            }
            emitirAccionesDelTurno(result);
            if (speaker) {
              (speaker as StreamSpeaker).end();
              await (speaker as StreamSpeaker).done;
            }
            setToolHint('');
            if (result.reply) {
              setOnline(true);
              logUltron(result.reply);
              const spoke = (speaker as StreamSpeaker | null)?.hasSpoken;
              if (!spoke) await say(result.voz || result.reply, faceForEmocion(result.emocion), { emocion: result.emocion });
              else settle();
              applyMode(result.mode);
              return;
            }
            if (speaker && (speaker as StreamSpeaker).hasSpoken) {
              // habló algo y el stream se cortó: no repetir la pregunta
              settle();
              return;
            }
          } catch {
            if (speaker) (speaker as StreamSpeaker).cancel();
            cancelMmm();
            if (turnoCancelado.current) return;
            // Si el stream ya se comió más de 20 s, el servidor sí tiene stream y está lento: repetir la
            // misma espera con JSON (70 s, y otro intento) dejaba a la mesa «pensando» unos 3 minutos.
            if (Date.now() - t0Turno > 20_000) {
              setToolHint('');
              await say(tr('Se me fue el hilo pensando eso. ¿Me lo repites?', 'I lost my train of thought on that. Could you repeat it?'), 'CONFUSED', { emocion: 'preocupado' });
              return;
            }
            /* el servidor no tiene stream → JSON clásico */
          }
        }

        // 2) JSON clásico (visión o servidor sin stream).
        if (!reacted) setFace('THINKING');
        let out = await turno(base);
        cancelMmm();
        if (turnoCancelado.current) return;
        const failed = (r: { error?: string; reply?: string }) => !!(r.error || !r.reply);
        if (failed(out) && Date.now() - t0Turno < 30_000) {
          await new Promise((r) => setTimeout(r, 800));
          out = await turno(base);
          if (turnoCancelado.current) return;
        }
        setToolHint('');
        emitirAccionesDelTurno(out);
        if (failed(out)) {
          const auth = /sesión|privado|401/i.test(String(out.error || ''));
          if (auth) {
            setOnline(true);
            await say(tr('Se me cerró la sesión de la mesa. Entra de nuevo y te oigo.', 'My desk session closed. Sign in again and I’ll hear you.'), 'CONCERNED', { emocion: 'preocupado' });
            Alert.alert(tr('Sesión cerrada', 'Session closed'), tr('Tu sesión de la mesa se cerró. Entra de nuevo para seguir.', 'Your desk session closed. Sign in again to continue.'), [
              { text: 'Luego', style: 'cancel' },
              { text: 'Entrar', onPress: onLogout },
            ]);
            return;
          }
          setOnline(false);
          // Sin red de verdad (el teléfono no llega a nada): la frase grabada, que va en el APK y suena sin red.
          const sinRed = /network|red\b|conexi[oó]n|timeout|abort/i.test(String(out.error || ''));
          await say(sinRed ? 'Estoy sin conexión ahora mismo.' : 'No alcanzo al cerebro remoto ahora. Sigo contigo con lo básico.', 'CONFUSED', { emocion: 'preocupado' });
          return;
        }
        setOnline(true);
        applyMode(out.mode);
        await say(out.voz || out.reply, faceForEmocion(out.emocion), { emocion: out.emocion });
      } finally {
        cancelMmm();
        avisarMesa({ pensando: false });
        if (!speakingRef.current) {
          pauseMicForTts(false);
          idleStatus();
        }
      }
    },
    [escenaReciente, hacerTarea, idleStatus, logUltron, onAudio, say, settle, showBubble, user.correo, user.name]
  );

  const whatDoYouSee = useCallback(async () => {
    const frame = grabFrame.current ? await grabFrame.current() : null;
    if (frame) {
      await askBrain(tr('Mira la cámara y dime en dos frases qué ves: quién está, qué hace y qué objetos hay.', 'Look at the camera and tell me in two sentences what you see: who is there, what they are doing and what objects there are.'), { image: `data:image/jpeg;base64,${frame}` });
      return;
    }
    // Sin frame: lo que la detección local ya sabe (persona, lado, gesto) y las etiquetas del servidor.
    const e = escenaRef.current;
    const objs = objectsRef.current;
    if (escenaFresca(e)) {
      const mesa = objs.filter((l) => !/persona|rostro|cara|hombre|mujer|niñ|gente|face|person/.test(l));
      await say(`${e.descripcion}${mesa.length ? ` ${tr('En la mesa', 'On the desk')}: ${mesa.join(', ')}.` : ''}`, 'SCAN');
      return;
    }
    await say(objs.length ? `${tr('Veo', 'I see')}: ${objs.join(', ')}.` : tr('Aún no identifico nada. Dame un momento con la cámara.', 'I can’t identify anything yet. Give me a moment with the camera.'), 'SCAN');
  }, [askBrain, escenaFresca, say]);

  const runGag = useCallback(
    async (gag: Gag) => {
      const emocion = GAG_EMOCION[gag.id] || 'neutral';
      setFace(gag.face);
      const corta = GAG_FRASE[gag.id];
      if (corta) await speak(frase(corta), { onAudioStart: () => onAudio(gag.face) });
      for (const line of lineasGag(gag.id, gag.lines)) {
        await say(line, gag.face, { emocion });
        if (gag.lineGapMs) await new Promise((r) => setTimeout(r, gag.lineGapMs));
      }
    },
    [onAudio, say]
  );

  const answerConocer = useCallback(
    async (cmd: string) => {
      const ci = conocerIdxRef.current;
      const qq = CONOCER_QUESTIONS[ci];
      void rememberFact(`${user.name} · ${qq.memoryKey}: ${cmd}`, user.name);
      const progress = await loadConocerProgress(user.correo);
      const answeredIds = Array.from(new Set([...progress.answeredIds, qq.id]));
      const coreDone = CONOCER_QUESTIONS.slice(0, CONOCER_CORE).every((q) => answeredIds.includes(q.id));
      await saveConocerProgress({ correo: user.correo, answeredIds, completedCore: coreDone });
      const next = CONOCER_QUESTIONS.findIndex((x) => !answeredIds.includes(x.id));
      if (coreDone && ci < CONOCER_CORE) return exitConocer('Gracias. Ya te conozco mejor; no repetiré estas preguntas. Si quieres más, di «conocer más».');
      if (next < 0) return exitConocer('Listo. Ya te conozco mejor.');
      conocerIdxRef.current = next;
      await say(`${tr('Anotado.', 'Noted.')} ${preguntaConocer(next)}`, 'CURIOUS', { emocion: 'curioso' });
    },
    [exitConocer, say, user]
  );

  const handleCommand = useCallback(
    async (raw: string) => {
      const cmd = raw.trim();
      if (!cmd) return;
      if (handling.current) {
        // «Callar» no se encola: corta lo que esté pensando o diciendo, ya.
        if (interpretar(cmd, { dormido: false, enConocer: false }).tipo === 'callar') {
          turnoCancelado.current = true;
          abortTurno.current?.();
          pending.current = null;
          await stopSpeaking();
          // La voz cortada no llama a su onEnd: la pausa del micrófono se suelta aquí.
          oidoMesa.current?.vozCortada();
          speakingRef.current = false;
          setToolHint('');
          return;
        }
        pending.current = cmd;
        return;
      }
      handling.current = true;
      lastUserAt.current = Date.now();
      await stopSpeaking();
      historial.current = [...historial.current, { rol: 'usuario' as const, texto: cmd }].slice(-12);
      setMensajes((m) => [...m, { rol: 'usuario' as const, texto: cmd }].slice(-80));

      const enConocer = modeRef.current === 'CONOCER' && conocerIdxRef.current >= 0 && conocerIdxRef.current < CONOCER_QUESTIONS.length;
      const intent = interpretar(cmd, { dormido: presenceRef.current === 'sleep', enConocer });

      try {
        if (presenceRef.current === 'sleep') {
          setPresence('stay');
          presenceRef.current = 'stay';
          if (intent.tipo === 'despertar') return void (await say(tr('Despierto. Te escucho.', 'Awake. I’m listening.'), 'HAPPY', { emocion: 'feliz' }));
        }
        // En la entrevista todo es respuesta salvo salir / callar / dormir / menú / sesión.
        if (enConocer && !['conocer_salir', 'callar', 'dormir', 'logout', 'menu', 'catalogo'].includes(intent.tipo)) return void (await answerConocer(cmd));

        // La respuesta a «¿solo ahora o siempre?» (la cámara).
        if (esperaModoCamara.current) {
          esperaModoCamara.current = false;
          const r = respuestaModoCamara(cmd);
          if (r === 'no') return void (await say(tr('Va, la dejo apagada.', 'Okay, I’ll leave it off.'), 'IDLE'));
          const modo = r === 'siempre' ? 'siempre' : 'temporal';
          if (!(await encenderCamara(modo))) return void (await say(tr('Necesito permiso de cámara para verte.', 'I need camera permission to see you.'), 'CONCERNED', { emocion: 'preocupado' }));
          return void (await say(modo === 'siempre' ? tr('Listo: te veré siempre que entres. Dime «apaga la cámara» cuando quieras.', 'Done: I’ll see you every time you come in. Say “turn off the camera” anytime.') : tr('Listo, te veo. Me apago sola en diez minutos o al salir de la mesa.', 'Done, I can see you. I’ll turn off by myself in ten minutes or when you leave the desk.'), 'HAPPY', { emocion: 'feliz' }));
        }
        // Las caras (con permiso): «conóceme», «te presento a…», «olvida a…» y el «sí» de quien presentaron.
        if (await caras.manejar(cmd)) return;
        // La cámara por voz: «puedes verme», «mírame» → ¿solo ahora o siempre?; «apaga la cámara».
        const pc = intent.tipo === 'vision_on' ? 'encender' : pedidoDeCamara(cmd);
        if (pc === 'encender') {
          if (camara.encendida()) return void (await say(tr('Ya te estoy viendo.', 'I can already see you.'), 'HAPPY', { emocion: 'feliz' }));
          esperaModoCamara.current = true;
          return void (await say(tr('¿Te veo solo ahora, o siempre que entres?', 'Should I see you just now, or every time you come in?'), 'CURIOUS', { emocion: 'curioso' }));
        }
        if (pc === 'apagar' || pc === 'apagar_siempre') {
          const siempre = camara.estado().modo === 'siempre';
          await apagarCamara(pc === 'apagar_siempre');
          return void (await say(pc === 'apagar_siempre' || !siempre ? tr('Listo, apagué la cámara.', 'Done, camera off.') : tr('Apagué la cámara. Sigue en «siempre» para la próxima; dime «no me veas nunca» para quitarlo.', 'Camera off. It’s still set to “always” for next time; say “never look at me” to remove that.'), 'IDLE'));
        }

        switch (intent.tipo) {
          case 'despertar':
            return void (await say(tr('Aquí estoy.', 'I’m here.'), 'HAPPY', { emocion: 'feliz' }));
          case 'llamame':
            // La llamada del avatar suena YA (sin ir al servidor): la mesa no dice nada encima del timbre.
            miga('mesa: «llámame» → la llamada del avatar');
            if (vozRef.current.llamame()) return;
            return void (await say(tr('Ahora no puedo llamarte: hay otra llamada.', "I can't call you right now: there's another call."), 'CONCERNED', { emocion: 'preocupado' }));
          case 'dormir':
            setPresence('sleep');
            presenceRef.current = 'sleep';
            return void (await say(tr('Descanso un momento. Háblame o tócame para despertar.', 'Resting for a moment. Talk to me or touch me to wake me up.'), 'SLEEPING', { emocion: 'cansado' }));
          case 'callar':
            await stopSpeaking();
            oidoMesa.current?.vozCortada();
            settle();
            return;
          case 'modo':
            setMode(intent.modo);
            setPresence(intent.modo === 'EXPLORER' ? 'explore' : 'stay');
            return void (await say(intent.frase, intent.modo === 'GOLD' ? 'PROUD' : intent.modo === 'EXPLORER' ? 'SCAN' : 'IDLE', { emocion: intent.modo === 'GOLD' ? 'orgullo' : 'neutral' }));
          case 'menu':
            setMenuOpen(true);
            return void (await playClip('listo', 'IDLE'));
          case 'catalogo':
            setMenuOpen(true);
            setCatalogRequest((n) => n + 1);
            return void (await playClip('todo', 'IDLE'));
          case 'conocer':
            return void (await startConocer(intent.mas));
          case 'conocer_salir':
            return void (await exitConocer());
          case 'logout':
            await say(tr('Hasta luego.', 'See you later.'), 'IDLE', { emocion: 'carino' });
            return onLogout();
          case 'recordar': {
            hacerTarea('anotar');
            const line = `${user.name}: ${intent.hecho}`;
            if (longMemory.current.includes(line)) return void (await say(tr('Eso ya lo tenía en memoria.', 'I already had that in memory.'), 'HAPPY'));
            const remoto = rememberFact(line, user.name);
            longMemory.current = (await addLongFact(user, line)).map((f) => f.hecho);
            const ok = await remoto;
            return void (await say(ok ? 'Anotado. Lo recuerdo.' : 'Anotado aquí en la mesa; al servidor se lo paso cuando haya sesión.', 'HAPPY', { emocion: 'feliz' }));
          }
          case 'olvidar':
            // Borrar es irreversible y la voz se puede oír mal: se confirma en la pantalla.
            confirmarOlvido();
            return void (await say(tr('Para borrar lo que recuerdo de ti, confírmalo en la pantalla.', 'To erase what I remember about you, confirm it on the screen.'), 'CONCERNED', { emocion: 'preocupado' }));
          case 'que_recuerdas': {
            const mine = longMemory.current.filter((f) => f.startsWith(user.name)).slice(0, 4).map((f) => f.replace(/^[^:]+:\s*/, ''));
            if (mine.length) return void (await say(`${tr('Recuerdo', 'I remember')}: ${mine.join('. ')}.`, 'HAPPY', { emocion: 'feliz' }));
            return void (await askBrain(cmd));
          }
          case 'vision_on':
            // Lo atiende la cámara de arriba (pregunta solo ahora o siempre).
            return;
          case 'que_ves':
            return void (await whatDoYouSee());
          case 'blaster':
            return void (await fireBlaster(tr('¡Blaster listo! Pium, pium, pium.', 'Blaster ready! Pew, pew, pew.')));
          case 'sable':
            return void (await fireSaber());
          case 'cantar': {
            if (intent.cancion) {
              const c = canciones.find((s) => s.id === intent.cancion);
              return void (await sing({ id: intent.cancion }, c ? `${c.titulo} · ${c.artista}` : intent.cancion));
            }
            const g = (intent.genero && generoPorId(intent.genero)) || pick(GENEROS);
            return void (await sing({ letra: g.letra, titulo: g.titulo }, `${g.titulo} (${g.etiqueta})`));
          }
          case 'orar':
            return void (await pray(intent.tema));
          case 'chiste':
            // Un chiste nuevo cada vez, contado por el avatar con su gracia (ya no hay chistes grabados).
            return void (await askBrain(tr('Cuéntame un chiste corto, limpio y bueno. Solo el chiste.', 'Tell me a short, clean, good joke. Just the joke.')));
          case 'clip': {
            if (intent.id === 'puedo') {
              setMenuOpen(true);
              setCatalogRequest((n) => n + 1);
            }
            return void (await playClip(intent.id, 'HAPPY'));
          }
          case 'saludo':
            return void (await say(`${tr('Hola', 'Hi')}, ${user.name}. ${frase('aqui')}`, 'HAPPY', { emocion: 'feliz' }));
          case 'gracias': {
            const id = pick(['denada', 'cuandoquieras'] as const);
            return void (await playClip(id, 'HAPPY', { emocion: 'carino' }));
          }
          case 'gag':
            return void (await runGag(intent.gag));
          case 'hora':
            return void (await say(horaLocal(), 'IDLE'));
          case 'fecha':
            return void (await say(fechaLocal(), 'IDLE'));
          case 'ayuda':
            return void (await say(ayuda(), 'HAPPY', { emocion: 'feliz' }));
          case 'cerebro':
          default:
            await askBrain(cmd);
        }
      } finally {
        handling.current = false;
        idleStatus();
        const next = pending.current;
        pending.current = null;
        if (next) void handleCommand(next);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [answerConocer, apagarCamara, askBrain, camara, canciones, caras, confirmarOlvido, encenderCamara, exitConocer, fireBlaster, fireSaber, hacerTarea, idleStatus, onLogout, playClip, pray, runGag, say, settle, sing, startConocer, user, whatDoYouSee]
  );

  // ---------- Tacto ----------
  /** La cara ya mira al dedo por su cuenta (UltronFace); aquí solo se pausa la mirada errante/cámara. */
  const pausarMirada = useCallback((ms = 1500) => {
    if (touchGazeTimer.current) clearTimeout(touchGazeTimer.current);
    touchGazeTimer.current = setTimeout(() => {
      touchGazeTimer.current = null;
    }, ms);
  }, []);

  const wakeUp = useCallback(() => {
    setPresence('stay');
    presenceRef.current = 'stay';
    playSfx('boing');
    void playClip('despertar', 'STARTLE', { emocion: 'sorpresa' });
  }, [playClip]);

  /** Toques seguidos: «ya, ya» — molesto 1,2 s y luego se ríe. */
  const yaYa = useCallback(async () => {
    handling.current = true;
    try {
      playSfx('tap');
      void haptic('medium');
      setFace('ANGRY');
      const t = setTimeout(() => setFace('LAUGH'), 1200);
      showBubble(tr('Ya, ya.', 'Okay, okay.'));
      speakingRef.current = true;
      setStatus('speaking');
      await speak(frase('yaya'), { emocion: 'molesto', onAudioStart: () => onAudio('ANGRY') });
      clearTimeout(t);
      setFace('LAUGH');
      playSfx('giggle');
      await speakReaccion('risa');
      await new Promise((r) => setTimeout(r, 500));
    } finally {
      settle();
      handling.current = false;
    }
  }, [onAudio, settle, showBubble]);

  const onTap = useCallback(
    (zone: TouchZone, _x: number, _y: number) => {
      pausarMirada();
      lastUserAt.current = Date.now();
      if (conversandoRef.current) {
        // Conversando, tocarla no la hace hablar encima: sonríe y ya.
        void haptic('light');
        setFace('HAPPY');
        setTimeout(() => setFace(restFace()), 700);
        return;
      }
      const now = Date.now();
      const sinceLast = now - lastTapAt.current;
      lastTapAt.current = now;
      recentTaps.current = [...recentTaps.current.filter((t) => now - t < 2200), now];
      void haptic('light');

      if (presenceRef.current === 'sleep') return wakeUp();
      tapCount.current += 1;
      const irr = Math.min(1, irritationRef.current + 0.12);
      irritationRef.current = irr;
      setIrritation(irr);
      const busy = handling.current || speakingRef.current;

      // Toques seguidos → «ya, ya» (gana a todo lo demás)
      if (recentTaps.current.length >= 4) {
        recentTaps.current = [];
        if (!busy) void yaYa();
        return;
      }
      if (busy) {
        playSfx('tap');
        return;
      }
      if (irr >= 0.92) {
        handling.current = true;
        void fireBlaster(pick(lineas('angry'))).finally(() => {
          handling.current = false;
        });
        return;
      }
      if (sinceLast < 380 && zone !== 'eyeL' && zone !== 'eyeR') {
        playSfx('wink');
        setFace('WINK');
        void say(pick(lineas('double')), 'WINK', { emocion: 'travieso' });
        return;
      }
      switch (zone) {
        case 'eyeL':
        case 'eyeR':
          playSfx('wink');
          setWinkSide(zone === 'eyeL' ? 'L' : 'R');
          setFace('WINK');
          if (tapCount.current % 2) void say(pick(lineas('eye')), 'WINK', { emocion: 'travieso' });
          else setTimeout(() => setFace(restFace()), 900);
          return;
        case 'forehead':
          playSfx('tap');
          setFace('CURIOUS');
          if (tapCount.current % 2) void say(pick(lineas('forehead')), 'CURIOUS', { emocion: 'curioso' });
          else setTimeout(() => setFace(restFace()), 1500);
          return;
        case 'chin':
          playSfx('giggle');
          setFace('LAUGH');
          void say(pick(lineas('tickle')), 'LAUGH', { emocion: 'risa' });
          return;
        case 'mouth':
          playSfx('giggle');
          setFace('HAPPY');
          void say(pick(lineas('mouth')), 'HAPPY', { emocion: 'travieso' });
          return;
        case 'cheek':
          playSfx('tap');
          void playClip('je', 'HAPPY');
          return;
        default:
          playSfx('tap');
          setFace(tapCount.current % 2 ? 'WINK' : 'HAPPY');
          if (tapCount.current % 3 === 1) void say(pick(lineas('tap')), 'HAPPY', { emocion: 'feliz' });
          else setTimeout(() => setFace(restFace()), 700);
      }
    },
    [fireBlaster, pausarMirada, playClip, restFace, say, wakeUp, yaYa]
  );

  /** Frotar la mejilla: ronroneo, baja el enojo. */
  const onRub = useCallback(() => {
    irritationRef.current = 0;
    setIrritation(0);
    void haptic('light');
    setFace('HAPPY');
    if (conversandoRef.current) return;
    playSfx('purr');
    if (speakingRef.current || handling.current) return;
    void (async () => {
      // Primero el «aww» grabado, después la frase.
      await speakReaccion('carino', { onAudioStart: () => onAudio('HAPPY') });
      await say(pick(lineas('love')), 'HAPPY', { emocion: 'carino' });
    })();
  }, [onAudio, say]);

  /** Mantener pulsado: duerme / despierta. */
  const onLongPress = useCallback(() => {
    void haptic('medium');
    if (conversandoRef.current) return;
    if (presenceRef.current === 'sleep') return wakeUp();
    if (speakingRef.current || handling.current) return;
    setPresence('sleep');
    presenceRef.current = 'sleep';
    void (async () => {
      // Se duerme bostezando.
      await speakReaccion('cansado', { onAudioStart: () => onAudio('SLEEPING') });
      await say(tr('Descanso un momento. Háblame o tócame para despertar.', 'Resting for a moment. Talk to me or touch me to wake me up.'), 'SLEEPING', { emocion: 'cansado' });
    })();
  }, [onAudio, say, wakeUp]);

  // Al arrastrar, los ojos siguen el dedo dentro de UltronFace (retardo elástico); aquí solo se pausa lo demás.
  const onDragGaze = useCallback(() => {
    dragging.current = true;
    lastUserAt.current = Date.now();
    if (touchGazeTimer.current) clearTimeout(touchGazeTimer.current);
  }, []);
  const onDragEnd = useCallback(() => {
    dragging.current = false;
    pausarMirada(800);
  }, [pausarMirada]);
  const onSwipe = useCallback((dir: 'left' | 'right') => setMenuOpen(dir === 'left'), []);

  // La sala solo distingue cabeza y cuerpo: la cabeza es la frente (curiosa) y el cuerpo, cosquillas.
  const onTocarSala = useCallback((zona: 'cuerpo' | 'cabeza') => onTap(zona === 'cabeza' ? 'forehead' : 'chin', 0, 0), [onTap]);
  const onDeslizarSala = useCallback((dir: 'arriba' | 'abajo') => setMenuOpen(dir === 'arriba'), []);
  const onFalloSala = useCallback((motivo: string) => {
    miga(`sala 3D no disponible: ${motivo}`);
    setConSala(false);
  }, []);
  const cambiarPostura = useCallback((p: Postura) => {
    setPostura(p);
    void saveSettings({ postura: p });
  }, []);
  const onFalloSkia = useCallback((motivo: string) => {
    miga(`cara Skia no disponible: ${motivo}`);
    setSkiaFallo(true);
  }, []);
  const cambiarCara = useCallback((c: 'anillos' | 'sala') => {
    setCara(c);
    // Volver a elegir la sala es darle otra oportunidad si antes falló.
    if (c === 'sala') setConSala(true);
    void saveSettings({ cara: c });
  }, []);

  useEffect(() => {
    if (!mesaActiva) return;
    const id = setInterval(() => {
      if (irritationRef.current > 0) {
        irritationRef.current = Math.max(0, irritationRef.current - 0.06);
        setIrritation(irritationRef.current);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [mesaActiva]);

  // ---------- Sacudida ----------
  useEffect(() => {
    if (!mesaActiva) return;
    let last = 0;
    let lastShakeAt = 0;
    Accelerometer.setUpdateInterval(90);
    const sub = Accelerometer.addListener(({ x, y, z }) => {
      const g = Math.sqrt(x * x + y * y + z * z);
      const jerk = Math.abs(g - last);
      last = g;
      if (jerk > 1.6 && Date.now() - lastShakeAt > 4000 && !speakingRef.current && !handling.current && !conversandoRef.current && !enLlamadaRef.current) {
        lastShakeAt = Date.now();
        setFace('SURPRISED');
        playSfx('tap');
        void say(pick(lineas('shake')), 'SURPRISED', { emocion: 'sorpresa' });
      }
    });
    return () => sub.remove();
  }, [say, mesaActiva]);

  // ---------- Voz ----------
  // Lo dicho en voz alta llega marcado (`hablado`): el servidor lo atiende con los topes de la voz.
  /*
   * Lo que oye el reconocedor del teléfono va a la mesa, siempre (sin palabra de activación ni «espera»:
   * la llamada del avatar se pide con «llámame» y la reconoce `interpretar` aquí mismo, sin red).
   */
  const onSpeechFinal = useCallback(
    (text: string) => {
      ultimoHablado.current = true;
      void handleCommand(text);
    },
    [handleCommand]
  );
  useEffect(() => {
    setSpeechCallbacks({
      onSpeechStart: () => {
        if (!speakingRef.current && !handling.current) setFace('LISTENING');
      },
      onPartial: (t) => {
        if (!speakingRef.current) {
          setFace('LISTENING');
          setPartial(t);
        }
      },
      onLevel: (l) => {
        if (nivelVisible.current) setLevel(l);
        // Con la mesa tapada, el anillo de la compañera late con la voz de la persona (la oye ella).
        if (oidoMesa.current?.actual() === 'companera') nivelOido.emitir(l);
      },
      onFinal: (t) => {
        setPartial('');
        onSpeechFinal(t);
      },
      // el reconocedor nativo reinicia entre frases (~300 ms): no parpadear el HUD
      onListeningChange: (on) => {
        if (listenOffTimer.current) clearTimeout(listenOffTimer.current);
        if (on) setListening(true);
        else listenOffTimer.current = setTimeout(() => setListening(false), 1500);
      },
      onError: () => {},
      onEngineChange: (eng) => setSettings((p) => ({ ...p, sttEngine: eng })),
    });
  }, [onSpeechFinal]);

  // ---------- Arranque ----------
  useEffect(() => {
    let alive = true;
    (async () => {
      const s = await loadSettings();
      micMutedRef.current = s.micMuted;
      setMicMuted(s.micMuted);
      // La cámara arranca apagada salvo que esta persona haya elegido «siempre» (y haya permiso).
      camara.arrancar(prefiereSiempre(s.camaraSiempre, user.correo) && !!camPerm?.granted);
      const verTutorial = tocaTutorial(s.tutorialVisto, user.correo);
      setModoMesa(s.modoMesa === 'trabajar' ? 'trabajar' : 'charlar');
      setSettings({ sttEngine: s.sttEngine, proactive: s.proactive, sfx: s.sfx });
      setPostura(s.postura === 'sentada' ? 'sentada' : 'pie');
      setCara(s.cara === 'sala' ? 'sala' : 'anillos');
      setAvatar(s.avatar);
      setAvatarVoz(s.avatar);
      // La bienvenida arranca en vertical, como toda la app; después la mesa sigue al teléfono.
      void orientar('vertical');
      setSfxEnabled(s.sfx);
      proactiveRef.current = s.proactive;
      if (s.sttEngine !== currentSttEngine()) await setSttEngine(s.sttEngine);
      // Solo la memoria de quien entró: es la que viaja al cerebro en cada turno.
      longMemory.current = (await loadLongMemory(user)).map((f) => f.hecho);
      void borrarRastrosViejos();
      void preloadSfx();
      void healthCheck().then((h) => setOnline(!!h.ok)).catch(() => setOnline(false));
      void listCanciones().then((c) => alive && setCanciones(c));

      const micOk = await ensureSpeechPermissions();
      if (!alive) return;
      if (micOk && !s.micMuted) {
        await enableAlwaysOnMic();
        oidoListo.current = true;
        // Si mientras tanto el audio pasó a otro (la conversación, una llamada, otra pantalla), se suelta.
        if (!oidoMesa.current?.oye()) void muteMic();
        setStatus('listening');
      } else setStatus(micOk ? 'muted' : 'offline');

      // El avatar se eligió al entrar (App): si es recién elegido, se presenta él mismo con su voz.
      handling.current = true;
      const saludo = saludoConNombre(user.name);
      await say(recienElegido ? `${saludo} ${de(avatarPorId(s.avatar).presentacion)}` : saludo, 'HAPPY', { emocion: 'feliz' });
      handling.current = false;
      // Después del saludo la mesa sigue al teléfono: en vertical, cuadro con la cara y el chat
      // (Claudio se pone de pie).
      void orientar('libre');

      // La primera vez, el recorrido de qué puede hacer (saltable; se vuelve a abrir desde «Más»).
      if (alive && verTutorial && mesaVisibleRef.current) setTutorialAbierto(true);
    })();
    return () => {
      alive = false;
      void destroySpeech();
      void stopSpeaking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
   * El vigilante del oído (compa/duenoAudio.ts, VigilanteOido): con la app delante y el oído NUESTRO
   * (en la mesa o, con la mesa tapada, en la compañera). Antes solo corría con la mesa a la vista: en
   * los chats nadie cuidaba el oído. Suelta una pausa colgada, reinicia al reconocedor que no da
   * señales de vida (un bucle de errores no es vida), y tras varios intentos pasa a la nube; si
   * tampoco, sigue probando cada vez más espaciado (antes quedaba sordo para siempre). De paso,
   * la etiqueta y la cara de la compañera dicen «te escucho» solo si un motor escucha.
   */
  const vigilante = useRef<VigilanteOido | null>(null);
  if (!vigilante.current) {
    vigilante.current = new VigilanteOido({
      esNuestro: () => oidoPropio(oidoMesa.current?.actual() ?? null) && !conversandoRef.current && !enLlamadaRef.current,
      silenciado: () => micMutedRef.current || !oidoListo.current,
      hablando: () => speakingRef.current,
      pensando: () => handling.current,
      pausado: isMicPaused,
      soltarPausa: () => pauseMicForTts(false),
      vivo: micWatchdogOk,
      revivio: oidoVivoDeVerdad,
      reiniciar: () => restartMic(),
      caerANube,
      // En la nube por un fallo: a los 10 min se vuelve a probar el reconocedor del teléfono.
      volverANativo: () => volverANativoSiToca(),
      miga,
    });
  }
  useEffect(() => {
    if (!appActiva) {
      oidoTelefono.emitir(false);
      return;
    }
    const revisar = () => {
      const r = vigilante.current!.revisar();
      const nuestro = oidoPropio(oidoMesa.current?.actual() ?? null) && !conversandoRef.current && !enLlamadaRef.current;
      const oye = nuestro && !micMutedRef.current && oidoEscuchando();
      oidoTelefono.emitir(oye);
      if (!nuestro || !oidoListo.current || micMutedRef.current || speakingRef.current || handling.current) return;
      if (r === 'reinicia' || r === 'nube' || r === 'sordo' || !oye) setStatus('reconnect');
      else setStatus('listening');
    };
    revisar();
    const id = setInterval(revisar, 3000);
    return () => clearInterval(id);
  }, [appActiva]);

  // Mirada errante (único generador): se pausa si hay dedo, toque reciente o persona en cámara.
  useEffect(() => {
    if (!mesaActiva) return;
    let t = 0;
    const id = setInterval(() => {
      if (dragging.current || touchGazeTimer.current || Date.now() - personSeenAt.current < 5000) return;
      t += 0.25;
      setGaze({ x: Math.sin(t * 0.3) * 0.15, y: Math.cos(t * 0.19) * 0.1 });
    }, 500);
    return () => clearInterval(id);
  }, [mesaActiva]);

  // Comentario proactivo: si la escena cambia y hay calma, el cerebro mira un frame y comenta (máx. 1 cada 2 min).
  const onScene = useCallback(
    (_summary: string, labels: string[]) => {
      if (conversandoRef.current) return;
      const prev = sceneRef.current;
      const cur = labels.join(',');
      sceneRef.current = cur;
      const now = Date.now();
      const calm = proactiveRef.current && !handling.current && !speakingRef.current && presenceRef.current === 'stay' && now - lastUserAt.current > 25_000;
      const novel = !!prev && cur !== prev && labels.filter((l) => !prev.includes(l)).length >= 2;
      if (!calm || !novel || now - lastSceneRemark.current < 120_000 || !grabFrame.current) return;
      lastSceneRemark.current = now;
      void (async () => {
        const frame = await grabFrame.current?.();
        if (!frame || handling.current || speakingRef.current) return;
        handling.current = true;
        try {
          const r = await turno({
            message: 'Comenta en UNA frase corta y natural algo nuevo o útil que veas en la cámara (persona, gesto, objeto). Si no hay nada que valga la pena, responde solo: nada.',
            mode: modeRef.current,
            userName: user.name,
            correo: user.correo,
            historial: [],
            image: `data:image/jpeg;base64,${frame}`,
          });
          const reply = (r.reply || '').trim();
          if (reply && !/^nada\b/i.test(reply)) await say(reply, faceForEmocion(r.emocion), { emocion: r.emocion });
        } finally {
          handling.current = false;
          const next = pending.current;
          pending.current = null;
          if (next) void handleCommand(next);
        }
      })();
    },
    [handleCommand, say, user.correo, user.name]
  );

  /**
   * Escena de la cámara local (≤ 2/s, inmediata con eventos). Reacciones:
   *  llego → saludo con clip local si hubo > 60 s sin interacción (o despierta si dormía);
   *  sonrie → sonrisa breve; dos_personas → CURIOUS + «¿y quién te acompaña?» una vez por sesión;
   *  mira / aparta_mirada → atención (la cara se ilumina); se_fue → nada inmediato.
   */
  const onEscena = useCallback(
    (e: Escena) => {
      escenaRef.current = e;
      const now = Date.now();
      if (e.personas > 0) personSeenAt.current = now;
      const hay = e.personas > 0;
      setVerPersona((v) => (v === hay ? v : hay));
      const att = !hay ? 0 : e.principal?.mirando ? 1 : 0.5;
      setAtencion((a) => (a === att ? a : att));
      carasRef.current?.observar(e.personas, e.eventos.includes('llego'));
      if (!e.eventos.length || conversandoRef.current) return;
      const calm = !handling.current && !speakingRef.current;
      for (const ev of e.eventos) {
        if (ev === 'llego') {
          const quieto = now - lastUserAt.current > 60_000 && now - lastGreetAt.current > 60_000;
          if (!quieto) continue;
          lastGreetAt.current = now;
          if (presenceRef.current === 'sleep') {
            wakeUp();
          } else if (calm) {
            const id = pick(['hola', 'aqui', 'holadenuevo', 'mealegra'] as const);
            void playClip(id, 'HAPPY', { emocion: 'feliz' });
          }
        } else if (ev === 'sonrie') {
          if (!calm || presenceRef.current === 'sleep' || now - lastSonrisaAt.current < 8_000) continue;
          lastSonrisaAt.current = now;
          setFace('HAPPY');
          if (sonrisaTimer.current) clearTimeout(sonrisaTimer.current);
          sonrisaTimer.current = setTimeout(() => {
            sonrisaTimer.current = null;
            if (!handling.current && !speakingRef.current) setFace(restFace());
          }, 1600);
        } else if (ev === 'dos_personas') {
          if (acompanaDicho.current || presenceRef.current === 'sleep') continue;
          acompanaDicho.current = true;
          if (!calm) continue;
          setFace('CURIOUS');
          void say(tr('¿Y quién te acompaña?', 'And who’s with you?'), 'CURIOUS', { emocion: 'curioso' });
        }
      }
    },
    [playClip, restFace, say, user.name, wakeUp]
  );

  /** Mirada suavizada hacia la persona: ≤ 4 cambios/s y solo si se movió, para no re-renderizar a 10 Hz. */
  const onGazeCam = useCallback((x: number, y: number, activa: boolean) => {
    if (dragging.current || touchGazeTimer.current) return;
    if (!activa) return; // la mirada errante retoma sola 5 s después de perder a la persona
    const now = Date.now();
    const nx = x * 0.9;
    const ny = y * 0.7;
    const moved = Math.abs(nx - gazeCamLast.current.x) > 0.04 || Math.abs(ny - gazeCamLast.current.y) > 0.04;
    if (now - gazeCamAt.current < 250 || !moved) return;
    gazeCamAt.current = now;
    gazeCamLast.current = { x: nx, y: ny };
    setGaze({ x: nx, y: ny });
  }, []);

  useEffect(
    () => () => {
      if (sonrisaTimer.current) clearTimeout(sonrisaTimer.current);
    },
    []
  );

  /** Cambiar de avatar desde el menú: su voz desde ya, se guarda y se presenta él mismo. */
  const elegirAvatar = async (id: AvatarId) => {
    setEligiendo(null);
    setMenuOpen(false);
    await stopSpeaking();
    setAvatar(id);
    setAvatarVoz(id);
    await saveSettings({ avatar: id, avatarElegido: true });
    if (!conversandoRef.current) void say(de(avatarPorId(id).presentacion), 'HAPPY', { emocion: 'feliz' });
  };

  /**
   * Conversar de corrido (como el modo voz de ChatGPT): se suelta el micrófono de la mesa y la voz
   * de la mesa, y los toma la sesión de ElevenLabs (VozProvider). Nada se espera antes de pedirla:
   * el permiso ya está precalentado y soltar el micrófono tarda menos que conectar.
   */
  const toggleConversar = () => {
    void haptic('medium');
    setMenuOpen(false);
    // En llamada, cuelga; sonando, rechaza; si no, la conversación se abre al instante (sin timbre).
    voz.alternar();
  };

  // Lo que pasa en la conversación, en la cara y la línea de estado de la mesa.
  const estadoAntes = useRef(estadoConv);
  useEffect(() => {
    const antes = estadoAntes.current;
    estadoAntes.current = estadoConv;
    if (!conversando) {
      if (estadoConv === 'error' && antes !== 'error') {
        miga(`conversación: ${String(voz.vista.detalle || '').slice(0, 80)}`);
        // Por qué, dicho claro (sesión vencida, servidor actualizándose, sin red…), y que el micrófono
        // de la mesa ya volvió: el dueño del audio vuelve a ser la mesa (efecto de abajo).
        const motivo = motivoFalloVoz(voz.vista.detalle, idiomaActual() === 'en');
        const texto = tr(`No pude abrir la conversación en vivo: ${motivo}. Sigo escuchándote por aquí.`, `I couldn’t open the live conversation: ${motivo}. I’m still listening here.`);
        // Un respiro: primero el dueño del audio vuelve al oído del teléfono (efecto de abajo), y así
        // lo dice la mesa o, con la mesa tapada, la compañera.
        setTimeout(() => {
          if (oidoMesa.current?.puedeHablar()) void say(texto, 'CONCERNED', { emocion: 'preocupado' });
          else showBubble(texto);
        }, 0);
      }
      return;
    }
    if (convSilencio) {
      setFace(restFace());
      setStatus('muted');
    } else if (estadoConv === 'hablando') {
      setFace('SPEAKING');
      setStatus('speaking');
    } else if (estadoConv === 'escuchando') {
      setFace('LISTENING');
      setStatus('listening');
      setListening(true);
    } else if (estadoConv === 'conectando') {
      setFace('THINKING');
      setStatus('thinking');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversando, convSilencio, estadoConv]);

  // Lo que se dice en la conversación va al chat y a la burbuja de la mesa; lo tuyo cuenta como actividad.
  useEffect(
    () =>
      mensajeVoz.escuchar((m) => {
        if (!m) return;
        if (m.rol === 'usuario') {
          lastUserAt.current = Date.now();
          historial.current = [...historial.current, { rol: 'usuario' as const, texto: m.texto }].slice(-12);
          setMensajes((l) => [...l, { rol: 'usuario' as const, texto: m.texto }].slice(-80));
          // La cámara por voz también en la conversación en vivo: ahí no se pregunta «¿solo ahora o
          // siempre?» (contesta el agente), así que es «solo ahora»; el agente se entera de lo que pasó.
          const pc = pedidoDeCamara(m.texto);
          if (pc === 'encender' && !camaraRef.current.encendida()) {
            void encenderCamaraRef.current('temporal').then((ok) => vozRef.current.avisarAgente(ok ? '[app] Cámara encendida solo por ahora (10 min).' : '[app] No se pudo encender la cámara (sin permiso).'));
          } else if ((pc === 'apagar' || pc === 'apagar_siempre') && camaraRef.current.encendida()) {
            void apagarCamaraRef.current(pc === 'apagar_siempre').then(() => vozRef.current.avisarAgente('[app] Cámara apagada.'));
          }
        } else {
          logUltron(m.texto);
          showBubble(m.texto);
          if (m.emocion !== 'neutral') setEmocion(m.emocion);
        }
      }),
    [logUltron, showBubble]
  );

  // Un solo dueño del audio: la llamada, la conversación en vivo o la mesa (solo si se la ve).
  useEffect(() => {
    const dueno = duenoAudio({ enLlamada, conversacion: vozOcupa, mesaVisible, appActiva, companeraVisible });
    const hizo = oidoMesa.current!.aplicar(dueno);
    if (hizo === 'suelta') {
      speakingRef.current = false;
      avisarMesa({ hablando: false, pensando: false });
      oidoTelefono.emitir(false);
      setToolHint('');
      setFace(restFace());
      // Suena la llamada del avatar (todavía sin sesión): la mesa no escucha; la línea dice «te llama…».
      if (dueno !== 'conversacion' || !vozRef.current.vista.montada) setStatus('muted');
    } else if (hizo === 'toma') {
      setFace(restFace());
      // Se reabrió un reconocedor nuevo: «escuchando» cuando de verdad escuche (el vigilante lo mira).
      setStatus(micMutedRef.current ? 'muted' : oidoEscuchando() ? 'listening' : 'reconnect');
    }
  }, [enLlamada, vozOcupa, mesaVisible, appActiva, companeraVisible, restFace]);

  // La voz toma el avatar de la mesa. El permiso de la conversación se pide cuando suena la llamada
  // (VozProvider, `timbre`), no al entrar: eran segundos de GPU del nodo sin ninguna llamada.
  useEffect(() => {
    if (avatar) vozRef.current.fijarAvatar(avatar);
  }, [avatar]);
  // El perfil cambió en otra pantalla (ajustes, la primera vez): la mesa toma el avatar nuevo en silencio.
  useEffect(
    () =>
      escuchar('perfil', (p) => {
        setAvatar((antes) => {
          if (antes === p.avatar) return antes;
          setAvatarVoz(p.avatar);
          return p.avatar;
        });
      }),
    []
  );

  /*
   * Llamadas: al empezar, la mesa corta lo que pensaba o decía, apaga la cámara (sin guardarlo: es
   * por la llamada) y se queda quieta; el oído y la voz los suspende el VozProvider. Al colgar, la
   * cámara vuelve si estaba encendida.
   */
  const visionAntesLlamada = useRef<boolean | null>(null);
  useEffect(
    () =>
      escuchar('llamada', ({ activa }) => {
        if (!!activa === enLlamadaRef.current) return;
        enLlamadaRef.current = !!activa;
        setEnLlamada(!!activa);
        if (activa) {
          turnoCancelado.current = true;
          abortTurno.current?.();
          pending.current = null;
          void stopSpeaking();
          speakingRef.current = false;
          avisarMesa({ hablando: false, pensando: false });
          setToolHint('');
          // La cámara se apaga por la llamada (sin tocar la preferencia) y vuelve como estaba al colgar.
          visionAntesLlamada.current = camara.encendida();
          if (visionAntesLlamada.current) setVisionOn(false);
          setFace(restFace());
          setStatus('muted');
        } else {
          if (visionAntesLlamada.current && camara.encendida()) setVisionOn(true);
          visionAntesLlamada.current = null;
          idleStatus();
        }
      }),
    [camara, idleStatus, restFace]
  );

  const toggleMute = async () => {
    if (conversando) {
      voz.silenciar(!convSilencio);
      return;
    }
    if (!micMutedRef.current) {
      await muteMic();
      micMutedRef.current = true;
      setMicMuted(true);
      setStatus('muted');
      await saveSettings({ micMuted: true });
      await say(tr('Micrófono en silencio.', 'Microphone muted.'), 'IDLE');
    } else {
      const ok = await ensureSpeechPermissions();
      if (!ok) return pedirEnAjustes(tr('Micrófono', 'Microphone'), tr('Para escucharte necesito el micrófono. Actívalo en los ajustes del teléfono.', 'I need the microphone to hear you. Turn it on in the phone settings.'));
      await unmuteMic();
      oidoListo.current = true;
      micMutedRef.current = false;
      setMicMuted(false);
      setStatus('listening');
      await saveSettings({ micMuted: false });
      await say(tr('Te escucho de nuevo.', 'I’m listening again.'), 'HAPPY', { emocion: 'feliz' });
    }
  };

  const toggleVision = () => menuCamara();

  const setPresenceUI = (p: DeskPresence) => {
    setPresence(p);
    presenceRef.current = p;
    if (p === 'sleep') void say(tr('Descanso un momento. Háblame o tócame para despertar.', 'Resting for a moment. Talk to me or touch me to wake me up.'), 'SLEEPING', { emocion: 'cansado' });
    else if (p === 'explore') {
      setMode('EXPLORER');
      void say(tr('Modo explorador: listo para investigar.', 'Explorer mode: ready to investigate.'), 'SCAN', { emocion: 'curioso' });
    } else void playClip('aqui', 'IDLE');
  };

  const changeStt = async (e: SttEngine) => {
    setSettings((p) => ({ ...p, sttEngine: e }));
    await saveSettings({ sttEngine: e });
    await setSttEngine(e);
    await say(e === 'native' ? 'Oído: reconocimiento del teléfono.' : 'Oído: transcripción en la nube.', 'IDLE');
  };
  const toggleProactive = async () => {
    const next = !settings.proactive;
    proactiveRef.current = next;
    setSettings((p) => ({ ...p, proactive: next }));
    await saveSettings({ proactive: next });
    await say(next ? tr('Comentarios de cámara activados.', 'Camera comments on.') : tr('Comentarios de cámara apagados.', 'Camera comments off.'), 'IDLE');
  };
  const toggleSfx = async () => {
    const next = !settings.sfx;
    setSfxEnabled(next);
    setSettings((p) => ({ ...p, sfx: next }));
    await saveSettings({ sfx: next });
    if (next) playSfx('tap');
  };
  const probarVoz = () => {
    setMenuOpen(false);
    const a = avatarPorId(avatar || 'aura');
    void say(
      tr(
        `Así sueno, ${user.name}. Soy ${de(a.nombre)}, con mi propia voz. ${de(a.oficio)}: pregúntame lo que quieras.`,
        `This is how I sound, ${user.name}. I’m ${de(a.nombre)}, with my own voice. ${de(a.oficio)}: ask me anything.`
      ),
      'HAPPY',
      { emocion: 'feliz' }
    );
  };

  const sendDraft = () => {
    const t = draft.trim();
    if (!t) return;
    // Conversando, lo escrito va a la conversación (la mesa no contesta encima, M3).
    if (conversandoRef.current) {
      if (!voz.enviarTexto(t)) return;
      setDraft('');
      lastUserAt.current = Date.now();
      historial.current = [...historial.current, { rol: 'usuario' as const, texto: t }].slice(-12);
      setMensajes((l) => [...l, { rol: 'usuario' as const, texto: t }].slice(-80));
      return;
    }
    setDraft('');
    setMenuOpen(false);
    void handleCommand(t);
  };

  const onObjectsStable = useCallback((labels: string[]) => setObjects(labels), []);

  // Borde derecho: tocar o arrastrar hacia la izquierda abre el menú (la cara deja libre esa franja).
  const edgePan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderRelease: (_e, g) => {
        if (g.dx < -30 || (Math.abs(g.dx) < 12 && Math.abs(g.dy) < 12)) setMenuOpen(true);
      },
    })
  ).current;

  const dotColorNativo =
    status === 'muted' ? T.aviso : status === 'reconnect' || status === 'thinking' ? avatarPorId(avatar || 'aura').tema.acento : status === 'offline' ? T.texto3 : T.activo;
  /*
   * EL PUNTO ÚNICO donde la mesa dice qué está haciendo (el HUD y la cabecera del chat de la mesa).
   * El banco de frases variadas de estado («escuchando», «pensando», «revisando»…) lo arma otra rama
   * (fraseDeEstado(estado, avatar, idioma), en la capa de lógica): cuando llegue, entra AQUÍ y en
   * avatar3d/DockAura.textoEstado, sin copiar el banco.
   */
  const statusLabelNativo =
    toolHint ? toolHint :
    status === 'listening'
      ? listening
        ? tr('te escucho', 'listening')
        : tr('conectando mic', 'connecting mic')
      : status === 'muted'
        ? tr('silenciado', 'muted')
        : status === 'thinking'
          ? tr('pensando', 'thinking')
          : status === 'speaking'
            ? face === 'SING' ? tr('cantando', 'singing') : tr('hablando', 'speaking')
            : status === 'orando'
              ? tr('orando', 'praying')
            : status === 'reconnect'
              ? tr('reconectando mic', 'reconnecting mic')
              : status === 'offline'
                ? tr('sin mic', 'no mic')
                : tr('iniciando', 'starting');

  /*
   * LA LLAMADA DEL AVATAR: mientras suena o se habla, la línea dice en qué punto está (te llama, en
   * llamada, silenciado) y los minutos de voz de hoy. Fuera de la llamada, lo de siempre.
   */
  const enAccion = !!toolHint || status === 'thinking' || status === 'speaking' || status === 'orando' || status === 'offline';
  const etiquetaLlamada = !enAccion || llamadaActiva(voz.ciclo) ? etiquetaCiclo(voz.ciclo, voz.nombreLlamada, idiomaActual(), voz.usadoHoyMs) : null;
  const statusLabel = etiquetaLlamada ? etiquetaLlamada.texto : statusLabelNativo;
  const dotColor = etiquetaLlamada
    ? etiquetaLlamada.tono === 'verde'
      ? '#3FB950'
      : etiquetaLlamada.tono === 'ambar'
        ? T.aviso
        : etiquetaLlamada.tono === 'azul'
          ? avatarPorId(avatar || 'aura').tema.acento
          : T.texto3
    : dotColorNativo;

  // Qué avatar se ve y cómo se reparte la pantalla (Claudio: retrato acostado, de pie derecho).
  const avatarId: AvatarId = avatar || 'aura';
  const tema = avatarPorId(avatarId).tema;
  const reparto = distribucion(avatarId, horizontal);
  const trabajando = modoMesa === 'trabajar';
  const enCuadro = reparto.tipo === 'cuadro' || trabajando;
  // El cuadro de la cara (cuando va con el chat): la cara clásica se mide contra él, no contra la pantalla.
  // Trabajando, el avatar va más compacto: lo que importa es la conversación.
  const cuadroW = horizontal ? Math.round(anchoPantalla * (trabajando ? 0.34 : 0.42)) : anchoPantalla;
  const cuadroH = horizontal ? altoPantalla : Math.round(Math.min(anchoPantalla * 0.95, altoPantalla * (trabajando ? 0.3 : 0.44)));
  const cajaCara = enCuadro ? { w: cuadroW, h: cuadroH } : undefined;

  // Qué cara se ve. El Guardián: sus ojos celestes de siempre (la cara clásica). AU-RA: los anillos
  // dorados (Skia) o la sala 3D; si lo elegido falló, la clásica.
  const vista: 'anillos' | 'sala' | 'clasica' | null =
    avatarId === 'ojos' ? 'clasica' : cara === null ? null : cara === 'anillos' ? (skiaFallo ? 'clasica' : 'anillos') : conSala ? 'sala' : 'clasica';
  const enSala = avatarId === 'aura' && vista === 'sala';
  nivelVisible.current = vista === 'clasica' && !conFotos(avatarId);
  const caraAura =
    vista === 'sala' && postura ? (
      <SalaAura
        face={face}
        emocion={emocion}
        postura={postura}
        pedido={pedido}
        speechLevelSource={suscribirNivelVoz}
        mirada={{ x: gaze.x, y: gaze.y, activa: verPersona }}
        onTocar={onTocarSala}
        onDeslizar={onDeslizarSala}
        onFallo={onFalloSala}
      />
    ) : vista === 'anillos' ? (
      <CaraSegura
        face={face}
        acento={mode === 'GOLD' ? '#FFD166' : undefined}
        gazeX={gaze.x}
        gazeY={gaze.y}
        speechLevelSource={suscribirNivelVoz}
        online={online}
        pedido={pedido}
        onTap={onTap}
        onLongPress={onLongPress}
        onDragGaze={onDragGaze}
        onDragEnd={onDragEnd}
        onRub={onRub}
        onSwipe={onSwipe}
        onFallo={onFalloSkia}
      />
    ) : vista === 'clasica' ? (
      <UltronFace
        face={face}
        mode={mode}
        caja={cajaCara}
        gazeX={gaze.x}
        gazeY={gaze.y}
        level={level}
        speechLevelSource={suscribirNivelVoz}
        attention={atencion}
        attack={attack}
        irritation={irritation}
        winkSide={winkSide}
        onTap={onTap}
        onLongPress={onLongPress}
        onDragGaze={onDragGaze}
        onDragEnd={onDragEnd}
        onRub={onRub}
        onSwipe={onSwipe}
      />
    ) : null;
  // Claudio y ANT-ONIO: su cuerpo en video (clips animados); sin video, el 3D si hay modelo y el teléfono
  // lo aguanta; si no, sus fotos (retrato acostado, de pie derecho), las de siempre. AU-RA sigue con su
  // sala o sus anillos: la sala es su mesa (silla, escritorio, tareas) y su cuerpo 3D nuevo va en la
  // compañera, al lado y a pantalla completa.
  const nombreAvatar = de(avatarPorId(avatarId).nombre);
  const fotosCara =
    reparto.pose === 'pie' ? (
      <ClaudioDePie
        face={face}
        gazeX={gaze.x}
        speechLevelSource={suscribirNivelVoz}
        fotos={avatarId === 'antonio' ? FOTOS_ANTONIO_PIE : undefined}
        nombre={nombreAvatar}
        onTap={() => onTap('face', 0, 0)}
        onLongPress={onLongPress}
      />
    ) : (
      <ClaudioRetrato
        face={face}
        gazeX={gaze.x}
        gazeY={gaze.y}
        speechLevelSource={suscribirNivelVoz}
        fotos={fotosRetrato(avatarId) || undefined}
        nombre={nombreAvatar}
        onTap={() => onTap('face', 0, 0)}
        onLongPress={onLongPress}
      />
    );
  const caraNode = conFotos(avatarId) ? (
    hayVideo(avatarId) || hayModelo3D(avatarId) ? (
      <CuerpoMesa
        avatar={avatarId}
        camara={reparto.pose === 'pie' ? 'cuerpo' : 'retrato'}
        face={face}
        emocion={emocion}
        mirada={{ x: gaze.x, y: gaze.y, activa: verPersona }}
        respaldo={fotosCara}
        onTap={() => onTap('face', 0, 0)}
        onLongPress={onLongPress}
        activo={mesaActiva && !(llamadaActiva(voz.ciclo) && !voz.llamada.minimizada)}
        senal={senalAtajo}
      />
    ) : (
      fotosCara
    )
  ) : (
    caraAura
  );
  const esClaudio = conFotos(avatarId);
  const acciones = avatarPorId(avatarId).acciones;
  /*
   * Colgó la llamada del avatar con la mesa delante: el avatar grande vuelve ENTRANDO desde un lado y
   * se acomoda en su lugar (en los chats lo hace la compañera, caminando). Con «reducir movimiento», no.
   */
  const entradaX = useRef(new Animated.Value(0)).current;
  const cicloAntes = useRef(voz.ciclo);
  useEffect(() => {
    const antes = cicloAntes.current;
    cicloAntes.current = voz.ciclo;
    const venia = llamadaActiva(antes) || llamadaTerminada(antes);
    if (voz.ciclo !== 'reposo' || !venia || !mesaVisibleRef.current) return;
    void AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((quieto) => {
        if (quieto) return;
        entradaX.setValue(-anchoPantalla);
        Animated.spring(entradaX, { toValue: 0, damping: 16, stiffness: 90, mass: 1, useNativeDriver: true }).start();
      });
  }, [voz.ciclo, entradaX, anchoPantalla]);
  const caraEntrando = <Animated.View style={{ flex: 1, transform: [{ translateX: entradaX }] }}>{caraNode}</Animated.View>;
  // La compañera pasea por encima de lo que no se debe tapar: los atajos y la barra de escribir del
  // chat de la mesa (cuadro) o los botones con los atajos (de pie); acostado, solo los botones.
  const sueloMesa = enCuadro || !horizontal ? 150 : 88;
  useEffect(() => {
    sueloCompa.emitir(sueloMesa);
  }, [sueloMesa]);
  useEffect(() => () => sueloCompa.emitir(88), []);

  const onAccion = (pedido: string) => {
    void haptic('light');
    setSenalAtajo((n) => n + 1);
    void handleCommand(pedido);
  };

  // Dónde está el cuerpo grande en la ventana: la compañera sale de ahí al dejar la mesa (y vuelve).
  const cuerpoRef = useRef<View>(null);
  const medirCuerpo = useCallback(() => {
    cuerpoRef.current?.measureInWindow((x, y, ancho, alto) => {
      if (ancho > 0 && alto > 0) marcoMesa.emitir({ x, y, ancho, alto });
    });
  }, []);

  /** La hoja «Más». */
  const alOpcionMas = (o: OpcionMas) => {
    setMasAbierto(false);
    switch (o) {
      case 'chat':
        return pulse.abrir();
      case 'envivo':
        return toggleConversar();
      case 'escribir':
        return setMenuOpen(true);
      case 'camara':
        return menuCamara();
      case 'caras':
        return caras.abrirOpciones();
      case 'avatar':
        return setEligiendo('menu');
      case 'tutorial':
        return setTutorialAbierto(true);
      case 'ajustes':
        return setMenuOpen(true);
      case 'modo': {
        const n = trabajando ? 'charlar' : 'trabajar';
        setModoMesa(n);
        void saveSettings({ modoMesa: n });
        return;
      }
    }
  };
  const cerrarTutorial = (noVolver: boolean) => {
    setTutorialAbierto(false);
    if (!noVolver) return;
    void loadSettings().then((s0) => saveSettings({ tutorialVisto: conTutorialVisto(s0.tutorialVisto, user.correo) }));
  };

  return (
    <View
      ref={enCuadro ? undefined : cuerpoRef}
      onLayout={enCuadro ? undefined : medirCuerpo}
      style={[styles.root, !enSala && { backgroundColor: esClaudio ? tema.fondo : '#000' }, enCuadro && { flexDirection: horizontal ? 'row' : 'column' }]}
    >
      {/* La cámara solo con la mesa a la vista, sin llamada y encendida a pedido (apagada por omisión). */}
      <CamaraVision
        enabled={visionOn && !!camPerm?.granted && mesaActiva && !enLlamada}
        dormido={presence === 'sleep'}
        grabRef={grabFrame}
        onEscena={onEscena}
        onGaze={onGazeCam}
        onObjects={onObjectsStable}
        onScene={onScene}
        onMotor={setVisionMotor}
      />
      {enCuadro ? (
        <>
          <View
            ref={cuerpoRef}
            onLayout={medirCuerpo}
            style={[
              styles.cuadro,
              { backgroundColor: esClaudio ? tema.fondo : '#000' },
              horizontal ? { width: cuadroW } : { height: cuadroH },
            ]}
          >
            {caraEntrando}
          </View>
          <View style={{ flex: 1 }}>
            <ChatMesa
              mensajes={mensajes}
              avatar={avatarId}
              acciones={acciones}
              onAccion={onAccion}
              nombreAvatar={de(avatarPorId(avatarId).nombre)}
              estado={statusLabel}
              colorEstado={dotColor}
              parcial={partial}
              borrador={draft}
              micSilenciado={micApagado}
              escuchando={listening}
              onBorrador={setDraft}
              onEnviar={sendDraft}
              onMic={() => void toggleMute()}
              onMenu={() => setMasAbierto(true)}
              onCambiarAvatar={() => setEligiendo('menu')}
              conversando={conversando}
              conectando={conversando && estadoConv === 'conectando'}
              onConversar={toggleConversar}
            />
          </View>
        </>
      ) : (
        caraEntrando
      )}

      {!enCuadro && (
        <>
        <View pointerEvents="none" style={styles.hud}>
          <View style={[styles.hudDot, { backgroundColor: dotColor }]} />
          <Text style={styles.hudText}>
            {de(avatarPorId(avatarId).nombre)} · {statusLabel}
            {verPersona ? (visionMotor === 'mlkit' ? tr(' · te veo', ' · I see you') : tr(' · alguien', ' · someone')) : ''}
            {!online ? tr(' · sin cerebro', ' · offline') : ''}
          </Text>
        </View>

        {!!partial && (
          <View pointerEvents="none" style={[styles.partialWrap, { bottom: altoAbajo + 8 }]}>
            <Text numberOfLines={2} style={styles.partialText}>
              {partial}
            </Text>
          </View>
        )}

        {!!bubble && (
          <Animated.View
            pointerEvents="none"
            style={[styles.bubbleFloat, enSala ? styles.bubbleArriba : { bottom: altoAbajo + 8 }, !horizontal && styles.bubbleVertical, { opacity: bubbleOp }]}
          >
            <View style={styles.bubbleCard}>
              <Text numberOfLines={3} style={styles.bubbleText}>
                {bubble}
              </Text>
            </View>
          </Animated.View>
        )}

        <BarraMesa
          tema={tema}
          nombreAvatar={de(avatarPorId(avatarId).nombre)}
          micApagado={micApagado}
          oyendo={(listening || conversando) && !micApagado}
          conversando={conversando}
          conectando={conversando && estadoConv === 'conectando'}
          onHablar={() => void toggleMute()}
          onChat={() => pulse.abrir()}
          onMas={() => setMasAbierto(true)}
          onTerminar={toggleConversar}
          // Los atajos de este avatar (su oficio): una fila que se desliza de lado, justo encima de la barra.
          encima={<AccionesAvatar acciones={acciones} tema={tema} onAccion={onAccion} llamame={llamadaActiva(voz.ciclo) ? undefined : { etiqueta: tr('Llámame', 'Call me'), onPress: toggleConversar }} />}
          onAlto={setAltoAbajo}
        />

        <View style={styles.edgeZone} {...edgePan.panHandlers}>
          <View pointerEvents="none" style={[styles.edgeHint, { backgroundColor: tema.acentoFondo }]} />
        </View>
        </>
      )}

      {caras.motor}

      <HojaMas
        visible={masAbierto}
        onCerrar={() => setMasAbierto(false)}
        onOpcion={alOpcionMas}
        nombreAvatar={de(avatarPorId(avatarId).nombre)}
        conversando={llamadaActiva(voz.ciclo)}
        estadoCamara={textoCamara}
        camaraEncendida={visionOn}
        estadoCaras={caras.estadoTexto}
        trabajando={trabajando}
        conChat={enCuadro}
      />

      <Tutorial visible={tutorialAbierto} nombreAvatar={de(avatarPorId(avatarId).nombre)} tema={tema} onCerrar={cerrarTutorial} />

      <DeskMenu
        visible={menuOpen}
        userName={user.name}
        mode={mode}
        presence={presence}
        micMuted={micApagado}
        listening={listening}
        visionOn={visionOn && !!camPerm?.granted}
        online={online}
        objects={objects}
        draft={draft}
        catalogRequest={catalogRequest}
        canciones={canciones}
        onChangeDraft={setDraft}
        onSendDraft={sendDraft}
        onClose={() => setMenuOpen(false)}
        onSetMode={(m) => {
          setMenuOpen(false);
          if (m === 'CONOCER') void startConocer(false);
          else void handleCommand(`modo ${m.toLowerCase()}`);
        }}
        onSetPresence={(p) => {
          setMenuOpen(false);
          setPresenceUI(p);
        }}
        onToggleMic={() => void toggleMute()}
        onToggleVision={() => void toggleVision()}
        onConocer={() => {
          setMenuOpen(false);
          void startConocer(false);
        }}
        onBlaster={() => {
          setMenuOpen(false);
          void fireBlaster(tr('¡Blaster listo! Pium, pium, pium.', 'Blaster ready! Pew, pew, pew.'));
        }}
        onSaber={() => {
          setMenuOpen(false);
          void fireSaber();
        }}
        onSingSong={(id) => {
          setMenuOpen(false);
          const c = canciones.find((s) => s.id === id);
          void handleCommand(c?.pedir || `canta ${id}`);
        }}
        onSingGenre={(g) => {
          setMenuOpen(false);
          void handleCommand(`canta ${g}`);
        }}
        onOrar={() => {
          setMenuOpen(false);
          void handleCommand('ora por el día');
        }}
        onWhatDoYouSee={() => {
          setMenuOpen(false);
          void handleCommand('qué ves');
        }}
        onRemember={(f) => void handleCommand(`recuerda que ${f}`)}
        onCommand={(t) => {
          setMenuOpen(false);
          void handleCommand(t);
        }}
        onProbarVoz={probarVoz}
        settings={settings}
        memoryCount={longMemory.current.length}
        onSetSttEngine={(e) => void changeStt(e)}
        onToggleProactive={() => void toggleProactive()}
        onToggleSfx={() => void toggleSfx()}
        onForget={confirmarOlvido}
        onSearch={(q) => {
          setMenuOpen(false);
          void handleCommand(`busca ${q}`);
        }}
        onLogout={onLogout}
        conSala={enSala}
        cara={cara ?? 'anillos'}
        onSetCara={cambiarCara}
        avatar={avatarId}
        onSetAvatar={(id) => void elegirAvatar(id)}
        caraClasica={vista === 'clasica'}
        postura={postura || 'pie'}
        onSetPostura={cambiarPostura}
      />

      {eligiendo && (
        <SelectorAvatar
          nombre={user.name}
          saludo={saludoPorHora()}
          actual={avatarId}
          onElegir={(id) => void elegirAvatar(id)}
          onCerrar={eligiendo === 'menu' ? () => setEligiendo(null) : undefined}
        />
      )}
    </View>
  );
}

/** Buenos días / tardes / noches según la hora de Honduras (UTC−6, sin horario de verano). */
function saludoPorHora(ahora = new Date()): string {
  const h = (ahora.getUTCHours() + 24 - 6) % 24;
  return h < 12 ? tr('Buenos días', 'Good morning') : h < 19 ? tr('Buenas tardes', 'Good afternoon') : tr('Buenas noches', 'Good evening');
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.fondo2 },
  cuadro: { overflow: 'hidden', backgroundColor: '#000', position: 'relative' },
  hud: {
    position: 'absolute',
    top: 12,
    left: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: T.panel,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    ...SOMBRA,
  },
  hudDot: { width: 8, height: 8, borderRadius: 4 },
  hudText: { color: T.texto2, fontSize: 13, fontWeight: '600' },
  bubbleFloat: { position: 'absolute', left: 90, right: 90, alignItems: 'center' },
  bubbleArriba: { top: 14 },
  bubbleVertical: { left: 16, right: 16 },
  bubbleCard: { backgroundColor: T.panel, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, maxWidth: 520, ...SOMBRA },
  bubbleText: { color: T.texto, fontSize: 16, lineHeight: 22, textAlign: 'center' },
  partialWrap: { position: 'absolute', left: 24, right: 24, alignItems: 'center' },
  partialText: { color: T.texto2, fontSize: 14, fontStyle: 'italic', textAlign: 'center', backgroundColor: 'rgba(52,54,58,0.9)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 4, overflow: 'hidden' },
  // El borde derecho abre el menú; no llega a la barra (ahí está «Más»).
  edgeZone: { position: 'absolute', right: 0, top: 0, bottom: ALTO_BARRA + 64, width: 44, justifyContent: 'center', alignItems: 'flex-end' },
  edgeHint: { width: 5, height: 84, borderTopLeftRadius: 4, borderBottomLeftRadius: 4, backgroundColor: 'rgba(214,181,108,0.35)' },
});
