import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { miga, reportarEstado } from '../lib/reporte';
import { TrazaTurno } from '../lib/trazaTurno';
import { ControladorMirada } from '../lib/miradaAvatar';
import { seMovioTelefono } from '../lib/cercoCamara';
import { arrancarPulso, ponerAvisoBloqueo, pulsoJs } from '../lib/pulsoJs';
import { RellenoTurno, esperaDeRelleno } from '../lib/relleno';
// ── latencia de la voz: el turno especulativo (lib/turnoEspeculativo.ts) ──
import { TurnoEspeculativo } from '../lib/turnoEspeculativo';
import { CORTADO, TurnoMesa, type FichaTurno } from '../lib/turnoMesa';
import { cancelarTurnoEspeculativo, confirmarTurnoEspeculativo, type StreamHandlers, type TurnoOpts } from '../lib/api';
import { pedidoDeVoces } from '../voces/voces';
import { pedidoDeCaras } from '../caras/caras';
// ── fin ──
import { guardarPerfil } from '../lib/perfil';
import { AccessibilityInfo, Alert, AppState, Animated, BackHandler, Linking, PanResponder, Pressable, StyleSheet, Text, View, useWindowDimensions, type TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeepAwake } from 'expo-keep-awake';
import { useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Accelerometer } from 'expo-sensors';
import { UltronFace, type TouchZone } from '../components/UltronFace';
import { FONDO_ORBE, OrbeAura } from '../components/OrbeAura';
import type { PedidoCara } from '../cara/CaraSkia';
import { CaraSegura } from '../cara/CaraSegura';
import { textoTarea, tareaDeHerramientas, type Tarea } from '../lib/tareas';
import { T, SOMBRA } from '../tema';
import { DORMIDO_PERIODO_MS, SERVIDOR_CADA_MS, SERVIDOR_DORMIDO_MS, type FrameGrabber } from '../components/CamaraVision';
// La cámara de la mesa: la nueva en vivo o la de fotos (components/CamaraMesa.tsx decide; mismas props).
import { CamaraMesa } from '../components/CamaraMesa';
import { MasDelAvatar } from '../components/MasDelAvatar';
import { abrirCartera } from '../cartera/estado';
import type { Escena, MotorVision } from '../lib/escena';
import type { DeskPresence, FaceState, Mode, SessionUser } from '../config';
import { esVencida } from '../lib/intentoEntrada';
import { generacionCuenta, sigueVigente } from '../lib/cuenta';
// La frase nueva manda (José, 7-oct): la respuesta a una frase vieja no suena si ya llegó otra.
import { fraseDuranteTurno } from '../lib/fraseNueva';
import { api, CANCIONES_LOCAL, consultarTurnoGuardado, healthCheck, listCanciones, nuevoIdTurno, olvidarMemoriaServidor, opinarTurno, rememberFact, turno, turnoStream, verCamara, type Cancion, type ChatResult, type Turn } from '../lib/api';
import { faceForEmocion, type Emocion } from '../lib/emocion';
import { clasificarFallo, migaFalloTurno, reintentarFallo } from '../lib/falloTurno';
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
  oidoAguantaFondo,
  oidoEscuchando,
  oidoVivoDeVerdad,
  pauseMicForTts,
  reabrirMic,
  restartMic,
  setFondoPropio,
  setOirEncima,
  setSpeechCallbacks,
  setSttEngine,
  unmuteMic,
  volverANativoSiToca,
} from '../lib/speech';
import { arranqueDelMicrofono, migaArranqueMic } from '../lib/silencioMesa';
import { silencioHeredado } from '../lib/silencioHeredado';
import { GraciaFondo } from '../lib/appDelante';
import { REFRESCO_AMBIENTE_MS, ambienteActivo, leerAmbiente, refrescarAmbienteRemoto, suscribirAmbiente } from '../lib/ambienteAjuste';
import { TOPE_CORTADA } from '../lib/interrupcion';
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
import { useMuletillasMesa } from '../lib/muletillasMesa';
import { StreamSpeaker, cuandoSuene, fraccionSonando, registroVoz, setAvatarVoz, setSpeechLevelListener, speak, speakPrayer, speakReaccion, speakSong, stopSpeaking, type SongRequest } from '../lib/tts';
import { frase, saludoConNombre, type FraseId } from '../lib/frases';
import { de, idiomaActual, tr, useIdioma } from '../i18n';
import { quitarExpresiones } from '../lib/expresiones';
import { ClaudioRetrato, fotosRetrato } from '../avatares/ClaudioRetrato';
import { ClaudioDePie, FOTOS_ANTONIO_PIE } from '../avatares/ClaudioDePie';
import { CuerpoMesa } from '../avatar3d/CuerpoMesa';
import { caraConVoz, vozSonando } from '../avatar3d/sonando';
import { leeConHerramientas, ponerLee } from '../avatares/video/pistas';
import { hayModelo3D } from '../avatar3d/AvatarVivo';
import { hayVideo } from '../avatares/video/clips';
import { SelectorAvatar } from '../avatares/SelectorAvatar';
import { avatarPorId, conFotos, distribucion, type AvatarId } from '../avatares/catalogo';
import { SugerenciaMesa } from '../components/SugerenciaMesa';
import { VozProvider, esperarAudioLibre, useVoz, useVozOpcional, vozOcupaMicrofono } from '../compa/VozProvider';
import { avisarMesa, mensajeVoz, nivelOido, oidoTelefono, sueloCompa } from '../compa/canales';
import { etiquetaCiclo, llamadaActiva, llamadaTerminada } from '../compa/llamadaCiclo';
import { accionesDelTurno } from '../compa/acciones';
import { emitir, escuchar } from '../nucleo/contrato';
import { accionDeControlMesa, estadoControlesDe } from '../compa/controles';
import { respuestaAclaracion, type ControlVoz } from '../lib/controlesVoz';
import { usePulse } from '../pulse/PulseProvider';
import { useSinLeerTotal } from '../pulse/chats';
import { ChatMesa } from '../components/ChatMesa';
import { ALTO_BARRA, BarraMesa, anchoRiel, filaRiel } from '../components/BarraMesa';
import { EscribeleMesa } from '../components/EscribeleMesa';
import { HojaMas, type OpcionMas } from '../components/HojaMas';
import { RecorridoApp } from '../recorrido/RecorridoApp';
import type { PruebaId } from '../recorrido/guion';
import { conRecorridoVisto, tocaOfrecerRecorrido } from '../tutorial/pasos';
import { VentanaBienvenida } from '../bienvenida/VentanaBienvenida';
import { abrirBienvenida } from '../bienvenida/estado';
import { OidoMesa, VigilanteOido, duenoAudio, motivoFalloVoz, oidoPropio, saludoArranque } from '../compa/duenoAudio';
import { ESPERA_FRASE_MS, estadoDeEspera, fraseDeEstado, vozDeEspera } from '../compa/frasesEstado';
// Mientras trabaja: la línea que cambia en su lugar y lo que dice de lo que de verdad hace (event: progreso).
import { MemoriaNarrador } from '../compa/narrador';
import { TrabajoMesa } from '../compa/trabajoMesa';
import { reproductorAmbiente } from '../compa/ambienteSonido';
import { ControlCamara, conPreferencia, pedidoDeCamara, pideMirar, prefiereSiempre, respuestaModoCamara, type EstadoCamara } from '../lib/camaraModo';
import { marcoMesa, useMesaVisible, useModoPresencia } from '../avatar3d/usePresencia';
import { useCaras, type ApiCaras } from '../caras/useCaras';
import { ConsentimientoBiometria } from '../caras/HojaConsentimiento';
import { useVoces, type ApiVoces } from '../voces/useVoces';
import { escenaDelTurno, type QuienHablaTurno } from '../voces/voces';
import { decidirPrivadoLocal, fraseNegarLocal, intencionPrivada, negadoVaAlCerebro, pedidoLocalPrivado } from '../lib/privadoLocal';
import { avatarActual } from '../avatares/actual';
import { orientar } from '../lib/orientacion';
import { esperarFrame } from '../lib/esperarFrame';
import { COMENTARIOS, Comentarista, etiquetasDeVista, resumenVista, type FocoVision, type VistaCamara } from '../lib/vistaCamara';
import { vistaFresca, vistaParaTurno, type VistaTurno } from '../lib/vistaTurno';
import { ladoValido, pedidoDeVista, type Lado } from '../lib/vistaEnVivo';
import { VisorCamara, type EstadoVisor } from '../components/VisorCamara';
import { HojaComputadora } from '../ajustes/Computadora';
import { hojasAhora, suscribirHojas } from '../app/hojas';
import { avisoMesa, estadoEnPalabras, sondeoMs, trabajando as pcTrabajando, type EstadoPc } from '../compa/computadora';
import {
  PRIMER_SONDEO_MS,
  SONDEO_INICIATIVA_MS,
  TOPE_SONDEO_MS,
  cuerpoRespuesta,
  esAccionIniciativa,
  pedidoAMandar,
  propuestaDeAccion,
  propuestas,
  tocaSondear,
  type RespuestaSondeo,
  type ResultadoSondeo,
  type ResultadoRespuesta,
  type RespuestaBoton,
} from '../compa/iniciativa';
import type { PantallaCerebro } from '../compa/cerebro';
import { TarjetaPropuesta } from '../components/TarjetaPropuesta';
import { HojaCerebro } from '../app/HojasCerebro';
import { publicarMesa, retirarMesa } from '../app/mesaAjustes';
import { tomarPrimeraPeticion } from '../app/sesion';
import { useBorradorMesa } from '../lib/borradorMesa';
import { refsDeTurno } from '../lib/trabajos';
import { avisarTrabajos, useTrabajos } from '../trabajos/useTrabajos';
import { IndicadorTrabajos } from '../trabajos/IndicadorTrabajos';
import { PanelTrabajos } from '../trabajos/PanelTrabajos';
import { escucharPedidoPanel, tomarPedidoPanel } from '../trabajos/abrirPanel';
import { escucharPedidoObjetivo, tomarPedidoObjetivo } from '../objetivos/abrirObjetivo';
import { useObjetivos } from '../objetivos/useObjetivos';
import { TarjetaContinuar } from '../objetivos/TarjetaContinuar';
import { HojaObjetivo } from '../objetivos/HojaObjetivo';
// La ventana de decisión de la mesa (José, 5-oct): Sí · No · Editar, también por voz, en orden.
import { useVentanaDecision } from '../trabajos/useVentanaDecision';
import { VentanaDecision } from '../trabajos/VentanaDecision';
import { clienteTrabajos } from '../trabajos/useTrabajos';
import { alCambiarPrimer, anotarPrimer, leerPrimerDe } from '../primeravez/medida';
import { burbujaAbierta, hiloCompartido } from '../burbuja/logica';
import { buzonHablar, oidoParaHablar } from '../entrada/enlace';
import { useHablarEnMesa } from '../entrada/hablar';
import { SirvioPrimera } from '../primeravez/SirvioPrimera';
import { avancePrimer, clasificarTurno, debePreguntar, queRecuperar, seguirTareasPrimer, trasSoloRepetir, type PrimerResultado } from '../lib/primerResultado';

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

/** Lo que se le pide al cerebro según lo que se quiere ver (la vista ya va como hecho en el turno). */
const PEDIDO_VISTA: Record<FocoVision, [string, string]> = {
  escena: [
    // José, 6-oct: «sin identificar a nadie por su cara» le hacía decir «no puedo identificar personas por su cara» (falso:
    // el motor de caras del teléfono reconoce a las guardadas). Los nombres salen de ESCENA (lo que el motor confirmó).
    'Dime en dos frases qué ves por la cámara: quién está (por su nombre solo si ESCENA dice que lo reconoces; a quien no reconoces, «alguien que todavía no conozco», sin adivinar nombres), qué hace, qué objetos hay y dónde.',
    'Tell me in two sentences what you see through the camera: who is there (by name only if ESCENA says you recognize them; anyone else is “someone I don’t know yet”, never a guessed name), what they are doing, what objects there are and where.',
  ],
  leer: [
    'Léeme el texto que se ve en la cámara, tal cual y en orden. Si no se lee bien, dímelo y pídeme que lo acerque.',
    'Read me the text you see in the camera, exactly and in order. If it is not legible, tell me and ask me to bring it closer.',
  ],
  precio: [
    '¿Qué precio se ve en la cámara? Dime la cifra con su moneda y a qué corresponde. Si no se lee, dímelo.',
    'What price do you see in the camera? Tell me the amount with its currency and what it is for. If it is not legible, tell me.',
  ],
  que_es: [
    '¿Qué es lo que te muestro en la cámara? Dime qué es y para qué sirve, en dos frases.',
    'What am I showing you in the camera? Tell me what it is and what it is for, in two sentences.',
  ],
};
/** «Lo que vi» se queda este rato después de contestar (o hasta tocarlo). */
const VISOR_MS = 20_000;

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
  // Después de CADA turno se preguntan las tareas (AUR08; José, 5-oct): las que creó o tocó, y una decisión que un «sí»
  // o un «no» dicho acaba de resolver (la ventana de decisión se cierra o pasa a la siguiente; nunca queda una vieja).
  avisarTrabajos(refsDeTurno(r).map((x) => x.id));
}

function Mesa({ user, onLogout, recienElegido = false }: Props) {
  // PULSE2CHAT: el chat y las llamadas entre personas con Genesis ID (ver src/pulse).
  const pulse = usePulse();
  // El puntito del botón Chat: mensajes sin leer de las conversaciones (sondeo tranquilo, app delante).
  const chatSinLeer = useSinLeerTotal() > 0;
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
  /** El orbe de AURA; si la WebView no puede con él (sin WebGL, se cae), quedan los anillos. */
  const [conOrbe, setConOrbe] = useState(true);
  /** Su cara: el orbe (desde el 2-oct) o los anillos (Skia). null hasta leer los ajustes, para no parpadear. */
  const [cara, setCara] = useState<'orbe' | 'anillos' | null>(null);
  /** Skia no cargó o no pudo dibujar: se queda la cara de siempre. */
  const [skiaFallo, setSkiaFallo] = useState(false);
  const [pedido, setPedido] = useState<PedidoCara | null>(null);
  /** La frase que está sonando: el orbe la forma con sus partículas. */
  const [fraseOrbe, setFraseOrbe] = useState<{ texto: string; n: number } | null>(null);
  const [mode, setMode] = useState<Mode>('GUARDIAN');
  const [presence, setPresence] = useState<DeskPresence>('stay');
  const [bubble, setBubble] = useState('');
  const [status, setStatus] = useState<'boot' | 'listening' | 'muted' | 'thinking' | 'speaking' | 'orando' | 'reconnect' | 'offline'>('boot');
  // La primera vez deja escrita la primera petición (AUR11, el miniresultado): la persona la revisa y la manda.
  const [draft, setDraft] = useState(() => tomarPrimeraPeticion());
  // Lo escrito sobrevive a una actualización por aire (UI01, 3-oct).
  useBorradorMesa(draft, setDraft);
  /**
   * EL PRIMER RESULTADO (auditoría del 4-oct, P4 · R1; primeravez/medida.ts): el registro de esta cuenta, si
   * está midiendo su primera vez. La petición escrita en la caja no es el resultado: lo es la respuesta (o la
   * tarea) que vuelve. Con resultado se pregunta una vez «¿Te sirvió?».
   */
  const [primer, setPrimer] = useState<PrimerResultado | null>(null);
  /** El primer pedido que quedó a medias al cerrar la app: se vuelve a pedir con su idTurno (askBrain). */
  const turnoRecuperado = useRef<{ texto: string; idTurno: string; soloRepetir?: boolean } | null>(null);
  const [listening, setListening] = useState(false);
  const [level, setLevel] = useState(0);
  /** El volumen del micrófono solo lo dibuja la cara clásica: con las otras no se re-renderiza por él. */
  const nivelVisible = useRef(false);
  const [micMuted, setMicMuted] = useState(false);
  /** La cámara arranca APAGADA (lib/camaraModo.ts): se enciende solo ahora o siempre, a pedido. */
  const [visionOn, setVisionOn] = useState(false);
  const visionOnRef = useRef(false);
  visionOnRef.current = visionOn;
  const camara = useRef(new ControlCamara()).current;
  const [estadoCamara, setEstadoCamara] = useState<EstadoCamara>(camara.estado());
  /** Se preguntó «¿solo ahora o siempre?» y se espera la respuesta. */
  const esperaModoCamara = useRef(false);
  const [masAbierto, setMasAbierto] = useState(false);
  /** Su computadora en la nube (ajustes/Computadora.tsx): la hoja, su estado y el aviso de la mesa. */
  const [pcAbierta, setPcAbierta] = useState(false);
  const [pcEstado, setPcEstado] = useState<EstadoPc | null>(null);
  const pcEstadoRef = useRef<EstadoPc | null>(null);
  pcEstadoRef.current = pcEstado;
  /** AUR10: «para» a secas con voz y tarea vivas preguntó qué parar; la respuesta del turno siguiente decide. */
  const aclaracionMesa = useRef<ControlVoz[] | null>(null);
  const [pcAviso, setPcAviso] = useState<{ texto: string; terminada: boolean } | null>(null);
  /** La vista en vivo de toda la app (app/ComputadoraEnVivo.tsx) abierta: el aviso de arriba sobra. */
  const pcVivoAbierta = useSyncExternalStore(suscribirHojas, () => hojasAhora().abierta === 'computadora', () => false);
  /** Lo que AURA propone por su cuenta (compa/iniciativa.ts): la tarjeta de arriba, una a la vez. */
  const propuesta = useSyncExternalStore(propuestas.suscribir, propuestas.ahora, propuestas.ahora);
  /** Sus misiones, lo que sabe de ti o tu círculo, pedidos desde el menú (app/HojasCerebro.tsx). */
  const [hojaCerebro, setHojaCerebro] = useState<PantallaCerebro | null>(null);
  const [tutorialAbierto, setTutorialAbierto] = useState(false);
  /** Las preguntas para conocerle están a la vista (bienvenida/): el dictado necesita el micrófono. */
  const [preguntasAbiertas, setPreguntasAbiertas] = useState(false);
  /**
   * Charlar (el avatar grande, de frente) o Trabajar (el avatar compacto arriba y la conversación
   * escrita debajo, para leer y volver a consultar lo dicho). Se elige en «Más» y se guarda.
   */
  const [modoMesa, setModoMesa] = useState<'charlar' | 'trabajar'>('charlar');
  /** El alto de la columna de abajo (atajos + barra): la burbuja y lo que va oyendo van justo encima. */
  const [altoAbajo, setAltoAbajo] = useState(ALTO_BARRA + 58);
  const [gaze, setGaze] = useState({ x: 0, y: 0 });
  const [objects, setObjects] = useState<string[]>([]);
  /** «Lo que vi» (components/VisorCamara.tsx): la foto mirada con lo reconocido; null = cerrado. */
  const [visor, setVisor] = useState<EstadoVisor | null>(null);
  const cerrarVisorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** La vista de la cámara visible para apuntar («léeme esto», «¿qué es esto?») mientras mira. */
  const [previaCamara, setPreviaCamara] = useState(false);
  /** «Lo que veo» (José, 5-oct): la vista en vivo con lo reconocido, abierta por la persona (botón o voz). */
  const [vistaCamara, setVistaCamara] = useState(false);
  /** La cámara de la mesa: frontal (te ve a ti) o trasera. Se guarda en los ajustes. */
  const [ladoCamara, setLadoCamara] = useState<Lado>('frontal');
  /** El selector de avatar abierto desde el menú (al entrar se elige en App, antes de la mesa). */
  const [eligiendo, setEligiendo] = useState<'menu' | null>(null);
  // La mesa no se apaga sola: si la pantalla se bloquea, deja de escuchar y de verte.
  useKeepAwake('mesa');
  // Botón atrás de Android: cierra el selector de avatar; con él cerrado hace lo de siempre («Más» se cierra solo: ui/Hoja).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (eligiendo !== 'menu') return false;
      setEligiendo(null);
      return true;
    });
    return () => sub.remove();
  }, [eligiendo]);
  const [catalogRequest, setCatalogRequest] = useState(0);
  const [attack, setAttack] = useState<'blaster' | 'saber' | null>(null);
  const [irritation, setIrritation] = useState(0);
  const [online, setOnline] = useState(true);
  /*
   * Sin conexión, la mesa vuelve a probar sola cada 20 s (lo que dice «Sin conexión — reintento»); al volver, tu
   * mensaje que no llegó deja de marcarse. Solo el estado de la conexión: el turno, la voz y el oído no cambian.
   */
  useEffect(() => {
    if (online) {
      setFallido(null);
      return;
    }
    const t = setInterval(() => void healthCheck().then((h) => h.ok && setOnline(true)).catch(() => undefined), 20_000);
    return () => clearInterval(t);
  }, [online]);
  const [partial, setPartial] = useState('');
  /**
   * Lo último que dijo la persona (la frase ya entendida), unos segundos a la vista arriba a la derecha:
   * su lado de la conversación, aparte del de su avatar (abajo), para que nunca se encimen (José, 3-oct).
   */
  const [dicho, setDicho] = useState<{ texto: string; n: number } | null>(null);
  useEffect(() => {
    if (!dicho) return;
    const t = setTimeout(() => setDicho(null), 4_500);
    return () => clearTimeout(t);
  }, [dicho]);
  const [toolHint, setToolHint] = useState('');
  /** Lo que está haciendo ahora mientras trabaja (compa/trabajoMesa.ts): la línea suave del chat de la mesa. */
  const [progresoMesa, setProgresoMesa] = useState('');
  /** Las frases del narrador de esta mesa: ninguna se repite entre turnos (compa/narrador.ts). */
  const memoriaNarrador = useRef(new MemoriaNarrador());
  /** El trabajo del turno en curso (sus sonidos): la persona que habla o un ajuste que cambia le avisan. */
  const trabajoActual = useRef<TrabajoMesa | null>(null);
  // Los sonidos de trabajo: lo guardado al entrar, lo del servidor (AURA_AMBIENTE) al entrar y cada 10 min, y un
  // cambio (Ajustes, el servidor) se aplica al sonido del turno en curso al momento.
  useEffect(() => {
    void leerAmbiente().then(() => trabajoActual.current?.revisar());
    void refrescarAmbienteRemoto(true);
    const quitar = suscribirAmbiente(() => trabajoActual.current?.revisar());
    const tic = setInterval(() => AppState.currentState === 'active' && void refrescarAmbienteRemoto(), REFRESCO_AMBIENTE_MS);
    return () => {
      quitar();
      clearInterval(tic);
    };
  }, []);
  const [winkSide, setWinkSide] = useState<'L' | 'R'>('L');
  const [canciones, setCanciones] = useState<Cancion[]>(CANCIONES_LOCAL);
  const [settings, setSettings] = useState<Pick<AppSettings, 'sttEngine' | 'proactive' | 'sfx' | 'interrumpir'>>({ sttEngine: 'turbo', proactive: true, sfx: true, interrumpir: false });
  const [camPerm, requestCam] = useCameraPermissions();
  /** 0 nadie · 0.5 alguien delante · 1 alguien mirando la pantalla (la cara se ilumina). */
  const [atencion, setAtencion] = useState(0);
  const [verPersona, setVerPersona] = useState(false);
  const [visionMotor, setVisionMotor] = useState<MotorVision>('ninguno');
  /** Con quién se habla: AU-RA (los ojos), Claudio o Claudio de pie. null hasta leer los ajustes. */
  const [avatar, setAvatar] = useState<AvatarId | null>(null);
  /** Lo que se dijo en la mesa, para el chat del modo cuadro (vertical). */
  const [mensajes, setMensajes] = useState<Turn[]>([]);
  /**
   * Tu último mensaje que no llegó (sin conexión o «se me fue el hilo»): el chat de la mesa lo marca con
   * «Reintentar» (auditoría visual del 7-oct, A10). Solo es lo que se VE: el turno sigue igual.
   */
  const [fallido, setFallido] = useState<string | null>(null);
  /** «Escríbele…» de la mesa (o el campo del chat del modo trabajo): «Más → Escribir» pone el cursor ahí. */
  const entradaEscribir = useRef<TextInput | null>(null);
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
  /** La conversación entendió a la persona y el agente todavía no contesta (sesion.ts, CALL04). */
  const convPensando = voz.vista.pensando;
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
  /**
   * ¿Suena la voz de la mesa? (lib/tts → avatar3d/sonando.ts). El cuerpo en video o 3D habla con ESTO, no
   * con la cara: la cara SPEAKING llega antes que el audio (José, 5-oct: «habla cuando no está diciendo nada»).
   * Y desde el 7-oct también la cara (orbe, anillos, la clásica, las fotos): ver `hablaVoz` y `caraVista` abajo.
   */
  const audioMesa = useSyncExternalStore(vozSonando.escuchar, vozSonando.ahora);
  /** La mesa es la pantalla que se ve (la pila nativa la deja montada debajo de los chats y Ajustes). */
  const mesaVisible = useMesaVisible();
  const mesaVisibleRef = useRef(mesaVisible);
  mesaVisibleRef.current = mesaVisible;
  /** Hay una llamada (estado, para decidir el dueño del audio; el ref de abajo es para los callbacks). */
  const [enLlamada, setEnLlamada] = useState(false);
  /** La app está delante (con la app detrás la mesa no oye, no mira ni mueve sensores). */
  const [appActiva, setAppActiva] = useState(AppState.currentState !== 'background');
  useEffect(() => {
    // Un parpadeo de segundo plano (~0,1 s al bloquear la orientación en el Samsung de José) no suelta el oído: solo
    // cuenta si dura más de GRACIA_FONDO_MS (lib/appDelante.ts).
    const gracia = new GraciaFondo({ alCambiar: setAppActiva, miga }, AppState.currentState !== 'background');
    const sub = AppState.addEventListener('change', (st) => gracia.estado(st));
    return () => {
      sub.remove();
      gracia.soltar();
    };
  }, []);
  /**
   * La burbuja del asistente digital está abierta (botón lateral, mosaico, atajo: src/burbuja). Comparte este motor de
   * JS: con ella delante React dice «app activa», pero el micrófono es suyo (compa/duenoAudio.ts, dueño «burbuja»).
   */
  const burbuja = useSyncExternalStore(burbujaAbierta.suscribir, burbujaAbierta.abierta, burbujaAbierta.abierta);
  /**
   * La mesa está viva: se ve y la app está delante. Los sensores (acelerómetro), la mirada errante, el
   * enojo que baja solo y el perro guardián del micrófono solo corren así (A25: una pantalla tapada en
   * la pila no gasta batería ni reinicia un micrófono que es de otro).
   */
  const mesaActiva = mesaVisible && appActiva;
  // El pulso del hilo de JS (lib/pulsoJs.ts) mientras la mesa está viva: la traza del turno y el resumen de la cámara
  // dicen cuánto se trabó (José, 6-oct: ¿la cámara traba la voz?).
  useEffect(() => (mesaActiva ? arrancarPulso() : undefined), [mesaActiva]);
  // Un bloqueo del hilo de JS (≥ 1,5 s sin atender toques) va a las migas con lo que pasaba; uno grave (≥ 5 s, cuando
  // Android ya puede decir «no responde» y cerrarla al tocar) se manda enseguida (José, 6-oct: «al tocar se cierra»).
  useEffect(() => {
    ponerAvisoBloqueo(({ ms, grave }) => {
      const que = [visionOnRef.current ? `cámara${carasRef.current?.reconoce ? '+caras' : ''}` : 'sin cámara', handling.current ? 'pensando' : '', speakingRef.current ? 'hablando' : ''].filter(Boolean).join(', ');
      const linea = `JS bloqueado ${ms} ms (${que})`;
      if (grave) reportarEstado(linea);
      else miga(linea);
    });
    return () => ponerAvisoBloqueo(null);
  }, []);

  // Las tareas durables (AUR08): el indicador mínimo y el panel. Cerrar el panel no cancela nada; el
  // servidor es la fuente de verdad y, al volver, la misma tarea (mismo id) sigue con su estado.
  const [panelTrabajos, setPanelTrabajos] = useState(false);
  const trabajos = useTrabajos({ activo: mesaActiva || panelTrabajos, panelAbierto: panelTrabajos, idioma: idioma === 'en' ? 'en' : 'es' });
  // Un aviso tocado pidió sus tareas («Terminé de investigar»): el panel se abre al montarse la mesa o al instante.
  useEffect(() => {
    const abrir = () => {
      if (tomarPedidoPanel()) setPanelTrabajos(true);
    };
    abrir();
    return escucharPedidoPanel(abrir);
  }, []);

  // Los objetivos con estado (Fase 2): «Continuar trabajo» con el más reciente y su hoja. Un aviso «Necesito tu decisión»
  // tocado pide la hoja de ESE objetivo (al montarse la mesa o al instante).
  const [objetivoAbierto, setObjetivoAbierto] = useState<string | null>(null);
  useObjetivos({ activo: mesaActiva || !!objetivoAbierto, conSesion: !!user.correo });
  useEffect(() => {
    const p = tomarPedidoObjetivo();
    if (p) setObjetivoAbierto(p);
    return escucharPedidoObjetivo(() => {
      const id = tomarPedidoObjetivo();
      if (id) setObjetivoAbierto(id);
    });
  }, []);

  // Su computadora: se pregunta despacio (rápido mientras trabaja) con la mesa a la vista. Mientras
  // trabaja, la mesa lo dice arriba con «Ver»; al terminar, «terminó · ver el resultado» un rato.
  // Sin computadora en el servidor, se deja de preguntar.
  useEffect(() => {
    if (!mesaActiva) return;
    let vivo = true;
    let reloj: ReturnType<typeof setTimeout>;
    let antes: EstadoPc['actual'] = null;
    let quitarAviso: ReturnType<typeof setTimeout> | undefined;
    const vuelta = async () => {
      let s: EstadoPc | null = null;
      try {
        s = await api<EstadoPc>('/api/computadora', { method: 'GET' }, 12_000);
      } catch {
        s = null;
      }
      if (!vivo) return;
      if (s) {
        setPcEstado(s);
        const aviso = avisoMesa(antes, s.actual, idiomaActual() === 'en' ? 'en' : 'es');
        if (aviso) {
          setPcAviso(aviso);
          clearTimeout(quitarAviso);
          if (aviso.terminada) quitarAviso = setTimeout(() => vivo && setPcAviso(null), 45_000);
        } else if (!s.actual || !pcTrabajando(s.actual.estado)) {
          setPcAviso((a) => (a?.terminada ? a : null));
        }
        antes = s.actual;
        if (!s.configurada) return;
      }
      reloj = setTimeout(vuelta, sondeoMs(s?.actual?.estado, false));
    };
    void vuelta();
    return () => {
      vivo = false;
      clearTimeout(reloj);
      clearTimeout(quitarAviso);
    };
  }, [mesaActiva]);
  /**
   * La compañera se ve (los chats, Ajustes o el perfil encima de la mesa; chiquita, al lado o a
   * pantalla completa): entonces el oído de la mesa sigue abierto y ella atiende (compa/duenoAudio.ts).
   */
  const modoPresencia = useModoPresencia();
  const companeraVisible = modoPresencia === 'paseo' || modoPresencia === 'lado' || modoPresencia === 'completa';
  const { width: anchoPantalla, height: altoPantalla } = useWindowDimensions();
  const horizontal = anchoPantalla >= altoPantalla;
  // El recorte de la cámara y las barras (la mesa va inmersiva: acostado, el recorte queda a un lado u otro).
  const ins = useSafeAreaInsets();

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
  /** «Comenta lo que ve» sin repetirse: novedad de verdad, tope por hora, calma (lib/vistaCamara.ts). */
  const comentarista = useRef(new Comentarista()).current;
  const lastUserAt = useRef(Date.now());
  const historial = useRef<Turn[]>([]);
  const longMemory = useRef<string[]>([]);
  // El hilo es de UNA cuenta: si la mesa siguiera montada al entrar otra, no viaja nada de la anterior.
  const historialDe = useRef(user.correo);
  if (historialDe.current !== user.correo) {
    historial.current = [];
    longMemory.current = [];
    historialDe.current = user.correo;
  }
  // La burbuja del asistente digital (src/burbuja) pregunta con ESTE hilo: lo que se venía hablando en la mesa.
  useEffect(() => hiloCompartido.proveer(user.correo, () => historial.current), [user.correo]);
  const lastTapAt = useRef(0);
  const listenOffTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recentTaps = useRef<number[]>([]);
  const proactiveRef = useRef(true);
  const grabFrame = useRef<FrameGrabber | null>(null);
  /**
   * Cada turno con su propia ficha (lib/turnoMesa.ts, auditoría A-2): cortar el turno N (el stream, o la espera del JSON con
   * foto) nunca toca al N+1, y lo tardío del N ya no habla. «Callar» no espera al cerebro. La ficha también dice si en el turno
   * empezó una herramienta con efectos (un envío, un borrador): ese ya no se corta (revisión del 7-oct, G2).
   */
  const turnoMesa = useRef(new TurnoMesa()).current;
  /** La mesa sigue montada: al irse, lo que quedó en cola (lo que dijo la persona anterior) ya no se manda. */
  const mesaMontada = useRef(true);
  // La mesa se va (salió, venció o entró otra persona): el turno en vuelo se corta y lo que llegue ya no se dice ni se hace.
  useEffect(
    () => () => {
      mesaMontada.current = false;
      turnoMesa.cancelar('mesa_se_va');
      pending.current = null;
      pendienteOidaEn.current = 0;
    },
    []
  );
  /**
   * La persona interrumpió a AU-RA hablándole encima: lo que alcanzó a oír de la respuesta. Viaja con el
   * próximo pedido para que el cerebro sepa dónde quedó y conteste «Va, dime» en vez de repetirse.
   */
  const interrumpida = useRef<string | null>(null);
  /**
   * La marca de arriba, tomada por el pedido que sigue a la interrupción (y solo por ese): si ese pedido
   * no llega al cerebro, la marca no queda pegada para uno posterior (revisión de Codex en #133).
   */
  const interrumpidaTurno = useRef<string | null>(null);
  /** Cuándo entregó el oído la última frase (para medir cuánto tarda la respuesta en sonar). */
  const fraseOidaEn = useRef(0);
  /** Cuándo se oyó la frase del turno en curso (0 si se escribió): las voces buscan quién dijo ESA frase. */
  const oidaTurno = useRef(0);
  /** El mismo dato del pedido que espera en `pending` (si la persona habló mientras AU-RA contestaba). */
  const pendienteOidaEn = useRef(0);
  const turnosHablados = useRef(0);
  /** Dónde se va el tiempo de cada turno hablado, de la frase a la voz (lib/trazaTurno.ts): una miga por turno. */
  const trazaTurno = useRef(new TrazaTurno()).current;
  /**
   * El turno especulativo (lib/turnoEspeculativo.ts): el oído avisa a los ~0,35 s de silencio que la idea parece cerrada
   * y el turno empieza ya; askBrain lo toma si la frase final es esa (si no, se corta y el servidor no hace nada).
   */
  const especulativo = useRef(new TurnoEspeculativo<TurnoOpts, ChatResult>({ arrancar: (o, h) => turnoStream(o, h), confirmar: confirmarTurnoEspeculativo, cancelar: cancelarTurnoEspeculativo })).current;
  /** El stream del turno: el especulativo de ESTA frase si sirve (con su idTurno, que pasa a ser el del turno), si no uno nuevo. */
  const streamDelTurno = (base: TurnoOpts & { idTurno: string }, h: StreamHandlers) => {
    const e = especulativo.tomar(base, h);
    if (!e) return turnoStream(base, h);
    base.idTurno = e.idTurno;
    trazaTurno.dato('espMs', e.adelantoMs);
    return e;
  };
  const bubbleOp = useRef(new Animated.Value(0)).current;
  /** Última escena de la cámara local (descripción en español para el cerebro). */
  const escenaRef = useRef<Escena | null>(null);
  const lastGreetAt = useRef(0);
  const lastSonrisaAt = useRef(0);
  const acompanaDicho = useRef(false);
  /** CAM-A: la mirada de la cámara, fuera del estado de React (el cuerpo 3D la lee en su cuadro). */
  const miradaCam = useRef(new ControladorMirada()).current;
  const gazeCamLast = useRef({ x: 0, y: 0 });
  /** CAM-G: la última vez que el teléfono se movió (los objetos de una foto anterior dejan de dibujarse). */
  const telefonoMovidoEn = useRef(0);
  const movidaTelefono = useCallback(() => telefonoMovidoEn.current, []);
  const sonrisaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Un solo dueño del audio (compa/duenoAudio.ts): la mesa oye y habla solo si se la ve y no hay
   * conversación en vivo ni llamada. Al perderlo corta su turno, calla y SUELTA la pausa del micrófono
   * (una voz cortada no llama a su onEnd: esa pausa colgada dejaba a la mesa sorda en 4.7.0).
   */
  /** El oído de la mesa ya se abrió con el permiso concedido (el arranque o la persona al activarlo). */
  const oidoListo = useRef(false);
  /** El arranque de la mesa ya decidió el micrófono (abierto, silenciado o sin permiso): un `hablar` puede atenderse. */
  const arranqueHecho = useRef(false);
  /** El último pedido vino del oído (no del teclado ni de un atajo): el turno va con los topes de la voz. */
  const ultimoHablado = useRef(false);
  /** El reconocimiento de caras (se engancha más abajo, cuando ya existe `say`). */
  const carasRef = useRef<ApiCaras | null>(null);
  /** Las voces: quién habla, por la voz (src/voces; se engancha junto a las caras). */
  const vocesRef = useRef<ApiVoces | null>(null);
  const oidoMesa = useRef<OidoMesa | null>(null);
  if (!oidoMesa.current) {
    oidoMesa.current = new OidoMesa({
      muteMic,
      unmuteMic,
      reabrirMic,
      pauseMicForTts,
      stopSpeaking,
      cancelarTurno: () => {
        turnoMesa.cancelar('oido');
        pending.current = null;
      },
      // Solo si el oído ya se abrió una vez con el permiso (no se abre «a ciegas» al volver de otra pantalla).
      micQuerido: () => oidoListo.current && !micMutedRef.current,
      silenciadoPorPersona: () => micMutedRef.current,
      // Al colgar, el oído se reabre cuando la conversación soltó de verdad el audio (como mucho 4 s).
      esperarAudioLibre: () => esperarAudioLibre(),
      // La burbuja espera este acuse (no un respiro fijo) antes de abrir su micrófono prestado.
      acusarBurbuja: () => burbujaAbierta.acusar(),
      miga,
    });
    // Nace dueña (la mesa se monta visible) sin abrir nada todavía: el oído lo abre el arranque, con
    // el permiso ya pedido. El efecto de abajo corrige si el audio es de otro.
    oidoMesa.current.fijar('mesa');
  }

  // Las muletillas («mjm», «ajá») mientras la persona habla largo (lib/asentir.ts, lib/muletillasMesa.ts): solo con el
  // oído de la mesa, sin AU-RA hablando ni pensando un turno, y nunca en una llamada o con el micrófono silenciado.
  useMuletillasMesa({
    avatar,
    idioma: idioma === 'en' ? 'en' : 'es',
    hablando: () => speakingRef.current,
    ocupada: () =>
      micMutedRef.current || handling.current || conversandoRef.current || enLlamadaRef.current || !mesaVisibleRef.current || oidoMesa.current?.actual() !== 'mesa',
  });

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

  /**
   * La escena del turno de la frase oída en `oidaEn` (0 si se escribió): quién habla por la voz PRIMERO
   * (la escena se corta a 300/400 letras y la regla de «no le leas lo privado de la dueña» no puede caerse),
   * lo que reconocen las caras y la descripción de la cámara si es reciente y de un motor real. Lo de la voz
   * es de ESA frase: espera su resultado hasta ESPERA_VOZ_TURNO_MS (350 ms; casi siempre ya llegó porque se
   * consultó al cerrarse la frase) y, si no llegó, no dice quién habla. `quienHabla` va también aparte en el
   * cuerpo (el servidor lo usa aunque la escena llegue cortada); sin dato de esa frase puede ir, solo para frenar, la
   * última voz que no es la dueña con `reciente` (revisión 7.5, M1′: un «sí» corto de Ana no manda lo de José).
   */
  const escenaReciente = useCallback(
    async (oidaEn: number): Promise<{ escena?: string; quienHabla?: QuienHablaTurno }> => {
      const t0 = Date.now();
      // Revisión 7 (G2): la cara de la dueña confirmada cuenta para la continuidad de su voz.
      const voz = (await vocesRef.current?.paraTurno(oidaEn, { caraDuenaEn: carasRef.current?.duenaVistaEn?.() || 0 }).catch(() => null)) || { frase: '' };
      trazaTurno.dato('vozMs', Date.now() - t0);
      const e = escenaRef.current;
      // Revisión 7 (G2): si no es la dueña (o no se sabe), la escena no lleva los nombres guardados (caras ni voces).
      const escena = voz.quienHabla
        ? escenaDelTurno({ camara: escenaFresca(e) ? e.descripcion : '' })
        : escenaDelTurno({ voz: voz.frase, caras: carasRef.current?.escena() || '', camara: escenaFresca(e) ? e.descripcion : '' });
      return { escena, ...(voz.quienHabla ? { quienHabla: voz.quienHabla } : {}) };
    },
    [escenaFresca]
  );

  // La burbuja y el hilo son para LEER: las expresiones de voz ([risa]…) se oyen, no se enseñan.
  const showBubble = useCallback(
    (text: string) => {
      const limpio = quitarExpresiones(text).trim();
      setBubble(limpio);
      setFraseOrbe(limpio ? { texto: limpio, n: Date.now() } : null);
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

  const logUltron = useCallback((text: string, parcial = false) => {
    const texto = quitarExpresiones(text).trim();
    // Cortada a media respuesta: el cerebro del turno siguiente lo sabe (no la toma por completa).
    const paraHilo = parcial && texto ? `${texto} [respuesta cortada por un fallo; no terminó]` : texto;
    historial.current = [...historial.current, { rol: 'ultron' as const, texto: paraHilo }].slice(-12);
    if (texto) setMensajes((m) => [...m, { rol: 'ultron' as const, texto }].slice(-80));
    // Si ofreció aprender una cara («¿cómo se llama? … la recuerdo») con alguien sin nombre a la vista, la respuesta de la
    // dueña con el nombre la aprende (src/caras/aprenderPorVoz.ts), con el «sí» de esa persona.
    if (texto && !parcial) carasRef.current?.alResponder(texto);
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
    // Cuánto tardó en contestar con voz desde que el oído entregó la frase (José, 3-oct: «tarda mucho»).
    // Cada pocos turnos hablados se mandan las migas: así se ve en los logs del servidor sin esperar un error.
    // VOZ (auditoría 6-oct §7.1): se mide cuando el reproductor CONFIRMA que suena (cuandoSuene), no al pedir play.
    const oida = fraseOidaEn.current;
    if (oida) cuandoSuene(() => {
      if (fraseOidaEn.current !== oida) return;
      // La traza del turno (lib/trazaTurno.ts): la misma miga de siempre con cada tramo detrás (José, 6-oct: ~6 s con la cámara).
      const ahora = Date.now();
      const linea = trazaTurno.linea(ahora, { jsMax: pulsoJs.maxEntre(oida, ahora), camara: visionOnRef.current, caras: !!carasRef.current?.reconoce });
      miga(linea || `mesa: contestó con voz ${ahora - oida} ms después de la frase`);
      fraseOidaEn.current = 0;
      turnosHablados.current += 1;
      if (turnosHablados.current === 3 || turnosHablados.current % 8 === 0) reportarEstado(`voz: ${turnosHablados.current} turnos hablados`);
    });
    pauseMicForTts(true);
    speakingRef.current = true;
    avisarMesa({ hablando: true, pensando: false });
    setStatus('speaking');
    setFace(f);
  }, []);

  const say = useCallback(
    async (text: string, nextFace?: FaceState, opts?: { performance?: 'speak' | 'sing'; emocion?: Emocion; parcial?: boolean }) => {
      const emocion = opts?.emocion || 'neutral';
      const performance = opts?.performance || 'speak';
      if (emocion !== 'neutral') setEmocion(emocion);
      const f = nextFace || (performance === 'sing' ? 'SING' : faceForEmocion(emocion));
      showBubble(text);
      // En la conversación fluida o en una llamada la mesa no habla: se lee, no se oye (M3; un solo
      // dueño del audio). Tapada por los chats sí, si el audio es de la compañera: ella lo dice.
      if (conversandoRef.current || enLlamadaRef.current || !oidoMesa.current?.puedeHablar()) return;
      logUltron(text, !!opts?.parcial);
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
    if (e.modo === 'apagada') {
      setObjects([]);
      comentarista.reiniciar();
    }
  }), [camara, comentarista]);
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
  const cambiarLadoRef = useRef<(l: Lado) => void>(() => {});
  const encenderCamaraRef = useRef(encenderCamara);
  encenderCamaraRef.current = encenderCamara;
  const apagarCamaraRef = useRef(apagarCamara);
  apagarCamaraRef.current = apagarCamara;

  /** La mesa piensa o habla (un turno en vuelo o su voz sonando): la cámara y las caras aflojan mientras tanto. */
  const mesaOcupada = useCallback(() => handling.current || speakingRef.current, []);
  const caras = useCaras({
    ocupada: mesaOcupada,
    correo: user.correo,
    nombre: user.name,
    nombreAvatar: de(avatarPorId(avatar || 'aura').nombre),
    camaraEncendida: visionOn && !!camPerm?.granted,
    mesaVisible,
    grabFrame,
    lado: ladoCamara,
    vistaAbierta: vistaCamara || previaCamara,
    decir: (t, e) => say(t, e === 'feliz' ? 'HAPPY' : e === 'preocupado' ? 'CONCERNED' : e === 'curioso' ? 'CURIOUS' : 'IDLE', { emocion: e && e !== 'neutral' ? e : 'neutral' }),
    encenderCamara: () => encenderCamara('temporal'),
  });
  carasRef.current = caras;
  // ── voces (src/voces): quién habla, con permiso; el audio sale del oído Turbo ──
  const voces = useVoces({
    correo: user.correo,
    nombre: user.name,
    nombreAvatar: de(avatarPorId(avatar || 'aura').nombre),
    carasActivas: caras.activas,
    oidoTurbo: () => currentSttEngine() === 'turbo',
    decir: (t, e) => say(t, e === 'feliz' ? 'HAPPY' : e === 'preocupado' ? 'CONCERNED' : e === 'curioso' ? 'CURIOUS' : 'IDLE', { emocion: e && e !== 'neutral' ? e : 'neutral' }),
  });
  vocesRef.current = voces;

  /** Cambiar de cámara (botón de «Lo que veo» o por voz): se guarda para la próxima. */
  const cambiarLado = useCallback((l: Lado) => {
    setLadoCamara(l);
    void saveSettings({ camaraLado: l });
    miga(`mesa: cámara ${l}`);
  }, []);
  cambiarLadoRef.current = cambiarLado;
  const ladoCamaraRef = useRef(ladoCamara);
  ladoCamaraRef.current = ladoCamara;
  const vistaCamaraRef = useRef(vistaCamara);
  vistaCamaraRef.current = vistaCamara;

  /**
   * «Olvidar» (menú o voz): borra la memoria de largo plazo de quien está en la mesa, no la de los
   * demás. Es irreversible, así que antes se pregunta.
   */
  const confirmarOlvido = useCallback(() => {
    Alert.alert(tr('¿Olvidar lo que recuerdo de ti?', 'Forget what I remember about you?'), tr(`Se borran los hechos que guardé de ${user.name}, en este teléfono y en el servidor. No se puede deshacer.`, `The facts I saved about ${user.name} will be erased, on this phone and on the server. This can’t be undone.`), [
      { text: tr('Cancelar', 'Cancel'), style: 'cancel' },
      {
        text: tr('Olvidar', 'Forget'),
        style: 'destructive',
        onPress: () =>
          void (async () => {
            await clearLongMemory(user);
            longMemory.current = [];
            // El servidor también recuerda (cada hecho se le manda con rememberFact): sin esto, «olvidar»
            // solo vaciaba la copia del teléfono y la memoria volvía en la próxima respuesta.
            const servidor = await olvidarMemoriaServidor(user.name);
            if (servidor) await say(tr('Memoria de largo plazo borrada, aquí y en el servidor.', 'Long-term memory erased, here and on the server.'), 'CONCERNED', { emocion: 'preocupado' });
            else
              await say(
                tr(
                  'Borré lo que guardaba en este teléfono, pero no pude borrar la copia del servidor. Pídemelo otra vez cuando haya conexión.',
                  'I erased what I kept on this phone, but couldn’t erase the server copy. Ask me again when there’s a connection.'
                ),
                'CONCERNED',
                { emocion: 'preocupado' }
              );
          })(),
      },
    ]);
  }, [say, user]);

  /** AU-RA canta: POST /api/cantar. Cara SING, mic pausado, sin rellenos. */
  const sing = useCallback(
    async (req: SongRequest, titulo: string) => {
      // Nunca encima de la conversación en vivo o de una llamada (sonaban las dos a la vez).
      if (conversandoRef.current || enLlamadaRef.current) return void showBubble(tr('Termina la conversación en vivo y te la canto.', 'End the live conversation and I’ll sing it.'));
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
      if (conversandoRef.current || enLlamadaRef.current) return void showBubble(tr('Termina la conversación en vivo y oramos.', 'End the live conversation and we’ll pray.'));
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
    async (line = tr('Vale, lo dejamos aquí. Cuando quieras seguimos.', 'Okay, let’s stop here. We can continue whenever you want.')) => {
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
    async (cmd: string, opts?: { image?: string; visto?: string; vistoTomadaEn?: number; foco?: FocoVision; ficha?: FichaTurno }) => {
      // La ficha de ESTE turno (la de «¿qué ves?» si la trae; si esa ya se cortó o la reemplazó otra, no sale): todo lo de
      // abajo pregunta a ella.
      if (opts?.ficha && !opts.ficha.vigente) return;
      const tk = opts?.ficha ?? turnoMesa.empezar();
      trazaTurno.marcar('pide');
      setFace('THINKING');
      setStatus('thinking');
      avisarMesa({ pensando: true });
      setToolHint('');
      // La sesión a la que pertenece este turno: el JSON de respaldo y su reintento salen con ELLA o no salen.
      const genTurno = generacionCuenta();
      // El primer pedido que quedó a medias al cerrar la app se pide con SU idTurno: el servidor repite la
      // respuesta que ya tenía, sin correr otro turno (server/turno-unico.ts; lib/primer-resultado.ts).
      const rec = turnoRecuperado.current;
      turnoRecuperado.current = null;
      const idTurno = rec && rec.texto === cmd ? rec.idTurno : nuevoIdTurno();
      // R1 (revisión 9): recuperar es SOLO repetir lo guardado; el servidor nunca corre otro turno con esto.
      const soloRepetir = !!(rec && rec.texto === cmd && rec.soloRepetir);
      // El primer resultado (R1): se anota el envío; si esta cuenta no está midiendo su primera vez, no hace nada.
      void anotarPrimer(user.correo, { tipo: 'enviar', idTurno, texto: cmd });
      /** Lo que volvió de verdad (o por qué no): al terminar se clasifica para el primer resultado. */
      let paraPrimer: Partial<ChatResult> | null = null;
      // Quién dijo ESTA frase (las voces): como mucho 350 ms, y nada si las voces están apagadas.
      const vista = await escenaReciente(oidaTurno.current);
      trazaTurno.marcar('escena');
      const base = {
        message: cmd,
        mode: modeRef.current,
        userName: user.name,
        correo: user.correo,
        historial: historial.current,
        memoria: longMemory.current,
        image: opts?.image,
        visto: opts?.visto,
        // Cuándo se sacó la foto de lo visto: viaja como su edad (una vista reutilizada no es «ahora mismo»).
        vistoTomadaEn: opts?.vistoTomadaEn,
        foco: opts?.foco,
        escena: vista.escena,
        ...(vista.quienHabla ? { quienHabla: vista.quienHabla } : {}),
        hablado: ultimoHablado.current,
        // Uno por frase y el mismo en los reintentos de abajo: el servidor no corre la frase dos veces.
        idTurno,
        ...(soloRepetir ? { soloRepetir: true } : {}),
        ...(interrumpidaTurno.current !== null ? { interrumpido: { oido: interrumpidaTurno.current } } : {}),
      };
      ultimoHablado.current = false;
      interrumpidaTurno.current = null;
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
      // Un relleno que todavía no empezó a sonar cuando llega el primer texto se tira (lib/relleno.ts): antes la respuesta
      // esperaba a que se bajara y sonara entero, ~1 s más de mediana con el cerebro sobre los 2,5 s (José, 6-oct).
      /** El narrador del trabajo de este turno (nace con el stream; compa/trabajoMesa.ts). */
      let trabajo: TrabajoMesa | null = null;
      const relleno = new RellenoTurno({
        esperaMs: ESPERA_FRASE_MS,
        decir: (corte) => {
          if (!tk.vigente || !oidoMesa.current?.puedeHablar()) return;
          trazaTurno.marcar('relleno');
          const quien = avatarActual();
          const estado = opts?.image ? 'mirando' : estadoDeEspera(cmd);
          const f = fraseDeEstado(estado, quien, idiomaActual() === 'en' ? 'en' : 'es');
          // `neutral`: la etiqueta ya la eligió vozDeEspera (o ninguna, a propósito); con la emoción, el
          // servidor le ponía además su tono y casi todas sonaban igual (auditoría externa, 1-oct).
          void speak(vozDeEspera(f.texto, estado, quien), {
            emocion: 'neutral',
            hastaQue: corte,
            onAudioStart: () => {
              trabajo?.yaSeDijo();
              // Su voz suena: el sonido de trabajo se va (y vuelve al terminar si sigue trabajando).
              trabajo?.vozEmpieza();
              pauseMicForTts(true);
            },
            // «Suena» cuando el reproductor lo confirma, no al pedir play (auditoría 6-oct §7.1).
            onSuena: () => trazaTurno.marcar('rellenoSuena'),
            onEnd: () => {
              trabajo?.vozTermina();
              if (!speakingRef.current) pauseMicForTts(false);
            },
          }).then((sono) => !sono && trazaTurno.marcar('rellenoTirado'));
        },
      });
      // Lo que siempre tarda (buscar, leer, revisar) se acusa antes del segundo (lib/relleno.ts esperaDeRelleno).
      relleno.programar(!!opts?.image, esperaDeRelleno(opts?.image ? 'mirando' : estadoDeEspera(cmd), ESPERA_FRASE_MS));
      const cancelMmm = () => relleno.respuesta();
      const applyMode = (m?: Mode) => {
        if (m && m !== 'CONOCER' && m !== modeRef.current) setMode(m);
      };
      const t0Turno = Date.now();
      /** Por qué cayó el stream (su error, nunca lo que dijo la persona): va en la miga si el turno no trae respuesta. */
      let errorStream: string | null | undefined = opts?.image ? undefined : null;
      try {
        // Cortado mientras buscaba quién habla (antes ese «callar» se borraba al arrancar el turno): no sale.
        if (!tk.vigente) return;
        // 1) Streaming: la cara reacciona con `emocion` antes del primer delta y habla por oraciones.
        if (!opts?.image) {
          let speaker: StreamSpeaker | null = null;
          /** El locutor del turno: nace con el primer texto (delta o replace). */
          const locutor = (): StreamSpeaker => {
            if (!speaker) {
              // Ya contesta: terminó de leer (Claudio y ANT-ONIO en video guardan el teléfono).
              ponerLee(false);
              speaker = new StreamSpeaker({
                emocion,
                onAudioStart: () => onAudio(faceForEmocion(emocion)),
                onAudioBajado: () => trazaTurno.marcar('audio'),
                onSentence: (sentence) => {
                  showBubble(sentence);
                  // Con la mesa tapada lo dice la compañera: su globito lee lo mismo que suena.
                  avisarMesa({ texto: quitarExpresiones(sentence).trim(), emocion });
                },
              });
            }
            return speaker;
          };
          // Mientras trabaja (buscar, su correo, su computadora): la línea del chat y un comentario corto de lo que de
          // verdad pasa, solo si nada más suena ni sonó en el turno (un speak encima cortaría el locutor de la respuesta).
          trabajo = new TrabajoMesa({
            avatar: avatarActual(),
            idioma: idiomaActual() === 'en' ? 'en' : 'es',
            memoria: memoriaNarrador.current,
            puedeHablar: () => !speaker && !speakingRef.current && tk.vigente && !conversandoRef.current && !enLlamadaRef.current && !!oidoMesa.current?.puedeHablar(),
            hablar: (texto, corte) =>
              void speak(texto, {
                emocion: 'neutral',
                hastaQue: corte,
                onAudioStart: () => {
                  trabajo?.vozEmpieza();
                  pauseMicForTts(true);
                },
                onEnd: () => {
                  trabajo?.vozTermina();
                  if (!speakingRef.current) pauseMicForTts(false);
                },
              }),
            alLinea: (l) => {
              setProgresoMesa(l);
              setToolHint(l);
            },
            // Los sonidos de trabajo (José, 6-oct): tecleo, papel, clics y el murmullo de «pensando», por el canal de
            // efectos. Con el micrófono de la mesa abierto solo si el oído graba con el cancelador de eco (si no, el
            // tecleo podría abrirle una frase); mientras suenan, el oído sube su umbral (setFondoPropio).
            ambiente: reproductorAmbiente,
            sonido: () => ambienteActivo() && !conversandoRef.current && !enLlamadaRef.current && (micMutedRef.current || oidoAguantaFondo()),
            pensando: true,
            alFondo: setFondoPropio,
            miga,
          });
          const trabajoTurno = trabajo;
          trabajoActual.current = trabajoTurno;
          try {
            trazaTurno.marcar('envio');
            const st = streamDelTurno(base, {
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
                trazaTurno.marcar('texto');
                cancelMmm();
                trabajoTurno.respuesta();
                locutor().push(piece);
              },
              // El servidor corrigió lo dicho (auditoría del 3-oct, VOICE02): lo que no sonó del texto
              // viejo se tira y se dice solo lo que falta de lo corregido; si ya sonó algo distinto, con
              // «Corrijo:» delante. El hilo guarda la respuesta corregida (el `done` la trae entera).
              onReplace: (texto) => {
                trazaTurno.marcar('texto');
                cancelMmm();
                trabajoTurno.respuesta();
                locutor().reemplazar(texto, tr('Corrijo:', 'Correction:'));
              },
              onProgreso: (e) => {
                // Una herramienta que puede dejar algo afuera ya empezó: desde aquí una frase nueva no corta el turno (G2).
                if (e.fase === 'empece' && e.herramienta !== 'web' && e.herramienta !== 'leer') tk.marcarEfecto();
                if (tk.vigente) trabajoTurno.evento(e);
              },
              onTools: (tools) => {
                const t = tareaDeHerramientas(tools);
                if (t) {
                  hacerTarea(t);
                  setToolHint(textoTarea(t));
                }
                // Abrió un correo o un WhatsApp: Claudio y ANT-ONIO en video lo leen en el teléfono.
                if (leeConHerramientas(tools)) ponerLee(true);
              },
            });
            tk.ponerCorte(st.abort);
            let result = await st.promise.finally(() => {
              tk.ponerCorte(null);
              trabajoTurno.terminar();
              if (trabajoActual.current === trabajoTurno) trabajoActual.current = null;
            });
            cancelMmm();
            if (!tk.vigente) {
              if (speaker) (speaker as StreamSpeaker).cancel();
              return;
            }
            // El stream se cerró sin `done` (auditoría del 3-oct, VOICE01): lo dicho no es la respuesta
            // entera. Con el MISMO idTurno, el JSON devuelve ese turno ya corrido (server/turno-unico.ts),
            // sin repetir sus herramientas; de lo que trae se dice solo lo que falta detrás de lo oído.
            if (result.cierre === 'eof' && Date.now() - t0Turno < 30_000) {
              const recuperado = await tk.hasta(turno(base, genTurno));
              if (recuperado === CORTADO || !tk.vigente) {
                if (speaker) (speaker as StreamSpeaker).cancel();
                return;
              }
              if (recuperado.reply && !recuperado.error) {
                if (speaker) (speaker as StreamSpeaker).reemplazar(recuperado.voz || recuperado.reply, tr('Corrijo:', 'Correction:'));
                result = { ...recuperado, idTurno: result.idTurno };
              }
            }
            emitirAccionesDelTurno(result);
            paraPrimer = result;
            if (speaker) {
              (speaker as StreamSpeaker).end();
              await (speaker as StreamSpeaker).done;
            }
            // La interrumpieron mientras decía el final: lo que oyó la persona ya quedó en el hilo.
            if (!tk.vigente) return;
            setToolHint('');
            if (result.parcial) miga(`mesa: respuesta cortada (${result.error || result.via || 'el cerebro se cortó'})`);
            if (result.reply) {
              setOnline(true);
              logUltron(result.reply, !!result.parcial);
              const spoke = (speaker as StreamSpeaker | null)?.hasSpoken;
              if (!spoke) await say(result.voz || result.reply, faceForEmocion(result.emocion), { emocion: result.emocion, parcial: !!result.parcial });
              else settle();
              applyMode(result.mode);
              return;
            }
            if (speaker && (speaker as StreamSpeaker).hasSpoken) {
              // habló algo y el stream se cortó: no repetir la pregunta
              settle();
              return;
            }
            errorStream = result.error || `sin texto (${result.cierre || 'sin cierre'})`;
          } catch (e) {
            if (speaker) (speaker as StreamSpeaker).cancel();
            cancelMmm();
            // De una sesión que ya no está (salió o entró otra persona): ni se repite por JSON ni se dice nada.
            if (!tk.vigente || esVencida(e)) return;
            errorStream = String((e as Error)?.message || e || 'error');
            // Si el stream ya se comió más de 20 s, el servidor sí tiene stream y está lento: repetir la
            // misma espera con JSON (70 s, y otro intento) dejaba a la mesa «pensando» unos 3 minutos.
            if (Date.now() - t0Turno > 20_000) {
              paraPrimer = { reply: '', error: 'timeout' };
              // Por qué, en los logs del servidor y ya (no al próximo aviso): el error del stream, sin texto de la persona.
              reportarEstado(migaFalloTurno({ dijo: 'hilo', idTurno, ms: Date.now() - t0Turno, stream: errorStream }));
              setToolHint('');
              setFallido(cmd);
              await say(tr('Se me fue el hilo pensando eso. ¿Me lo repites?', 'I lost my train of thought on that. Could you repeat it?'), 'CONFUSED', { emocion: 'preocupado' });
              return;
            }
            /* el servidor no tiene stream → JSON clásico */
          }
        }

        // 2) JSON clásico (visión o servidor sin stream).
        if (!reacted) setFace('THINKING');
        trazaTurno.marcar('envio');
        // Con foto también se corta (A-2): mientras espera, una frase nueva o «callar» lo sueltan al instante (antes hasta 35 s).
        let out = await tk.hasta(turno(base, genTurno));
        let intentosJson = 1;
        cancelMmm();
        if (out === CORTADO || !tk.vigente || out.vencida) return;
        const failed = (r: { error?: string; reply?: string }) => !!(r.error || !r.reply);
        // Un 429 no se repite: pedirApi ya esperó lo que pidió el servidor, y otro pedido gastaría otro turno.
        if (failed(out) && reintentarFallo(out) && Date.now() - t0Turno < 30_000) {
          await tk.hasta(new Promise((r) => setTimeout(r, 800)));
          if (!tk.vigente || !sigueVigente(genTurno)) return;
          out = await tk.hasta(turno(base, genTurno));
          intentosJson += 1;
          if (out === CORTADO || !tk.vigente || out.vencida) return;
        }
        setToolHint('');
        emitirAccionesDelTurno(out);
        paraPrimer = out;
        if (failed(out)) {
          const clase = clasificarFallo(out);
          // José, 5-oct: «No alcanzo al cerebro remoto» sin nada en los logs. La miga dice qué pasó en cada
          // camino (error, HTTP, código; sin lo que dijo la persona) y se manda YA, no al próximo aviso.
          reportarEstado(migaFalloTurno({ dijo: clase, idTurno, ms: Date.now() - t0Turno, stream: errorStream, json: out, intentosJson }));
          if (clase === 'sesion') {
            setOnline(true);
            await say(tr('Se me cerró la sesión de la mesa. Entra de nuevo y te oigo.', 'My desk session closed. Sign in again and I’ll hear you.'), 'CONCERNED', { emocion: 'preocupado' });
            Alert.alert(tr('Sesión cerrada', 'Session closed'), tr('Tu sesión de la mesa se cerró. Entra de nuevo para seguir.', 'Your desk session closed. Sign in again to continue.'), [
              { text: tr('Luego', 'Later'), style: 'cancel' },
              { text: tr('Entrar', 'Sign in'), onPress: onLogout },
            ]);
            return;
          }
          // El servidor llegó y dijo la verdad: sigue con ese mismo turno (409) o va muy rápido (429). Se dice eso
          // (su frase honesta), no «no alcanzo al cerebro»: el cerebro está, y la mesa sigue en línea.
          if (clase === 'en-curso' || clase === 'rapido') {
            const honesta =
              out.error && !/^HTTP \d+$/.test(out.error)
                ? out.error
                : clase === 'en-curso'
                  ? tr('Sigo con eso que me pediste. Dame un momento y pregúntame otra vez.', 'I’m still working on that. Give me a moment and ask me again.')
                  : tr('Vas muy rápido. Dame un minuto y seguimos.', 'You’re going too fast. Give me a minute and we’ll continue.');
            await say(honesta, 'CONCERNED', { emocion: 'preocupado' });
            return;
          }
          setOnline(false);
          setFallido(cmd);
          // Sin red de verdad (el teléfono no llega a nada): la frase corta de siempre (lib/frases.ts), que sale de la caché de audio.
          await say(clase === 'sin-red' ? frase('sinconexion') : tr('No alcanzo al cerebro remoto ahora. Sigo contigo con lo básico.', 'I can’t reach the remote brain right now. I’m still here with the basics.'), 'CONFUSED', { emocion: 'preocupado' });
          return;
        }
        setOnline(true);
        applyMode(out.mode);
        if (out.parcial) miga(`mesa: respuesta cortada (${out.via || 'json'})`);
        await say(out.voz || out.reply, faceForEmocion(out.emocion), { emocion: out.emocion, parcial: !!out.parcial });
      } finally {
        // Cortado por la persona o de otra sesión: no es resultado ni fallo (queda enviada; lo siguiente que mande cuenta).
        if (paraPrimer && !tk.cancelado && sigueVigente(genTurno)) {
          const r = paraPrimer;
          void anotarPrimer(user.correo, { tipo: 'turno', idTurno, resultado: clasificarTurno(r), trazaId: r.trazaId });
        }
        cancelMmm();
        turnoMesa.terminar(tk);
        ponerLee(false);
        avisarMesa({ pensando: false });
        if (!speakingRef.current) {
          pauseMicForTts(false);
          idleStatus();
        }
      }
    },
    [escenaReciente, hacerTarea, idleStatus, logUltron, onAudio, say, settle, showBubble, user.correo, user.name]
  );

  /* ---------- «Lo que vi» (components/VisorCamara.tsx): se abre al mirar a pedido y se cierra solo ---------- */
  const cerrarVisor = useCallback(() => {
    if (cerrarVisorTimer.current) clearTimeout(cerrarVisorTimer.current);
    cerrarVisorTimer.current = null;
    setVisor(null);
  }, []);
  const cerrarVisorEn = useCallback((ms: number) => {
    if (cerrarVisorTimer.current) clearTimeout(cerrarVisorTimer.current);
    cerrarVisorTimer.current = setTimeout(() => {
      cerrarVisorTimer.current = null;
      setVisor(null);
    }, ms);
  }, []);
  // Cámara apagada o fuera de la mesa: la foto se suelta (no se guarda en ningún lado).
  useEffect(() => {
    if (visionOn && mesaVisible) return;
    setPreviaCamara(false);
    setVistaCamara(false);
    cerrarVisor();
  }, [visionOn, mesaVisible, cerrarVisor]);
  useEffect(() => () => void (cerrarVisorTimer.current && clearTimeout(cerrarVisorTimer.current)), []);
  // Al desmontar la mesa (salir de la cuenta, otra ruta) la vista fresca (foto + lo visto, ~20 s) no sobrevive: la
  // próxima mesa no contesta «¿qué ves?» con la escena de antes. El cambio de cuenta la suelta también (lib/vistaTurno.ts).
  useEffect(() => () => vistaFresca.invalidar(), []);

  /**
   * «¿Qué ves?», «léeme esto», «¿cuánto dice el precio?», «¿qué es esto?». El turno NUNCA espera a la visión más de
   * ~1,5 s (lib/vistaTurno.ts; José, 6-oct: «toma como una foto y se traba, queda pensando»): «¿qué ves?» usa la vista
   * fresca de la subida continua al instante; si no la hay, una foto (con más calidad si hay que leer) y, si el
   * servidor no la ve a tiempo, el turno sale con la foto y «Lo que vi» se completa cuando vuelva. Para leer o
   * reconocer algo, la vista de la cámara se ve un momento para apuntar.
   */
  const whatDoYouSee = useCallback(async (foco: FocoVision = 'escena') => {
    const apuntar = foco !== 'escena';
    const calidad = foco === 'leer' || foco === 'precio' ? 'leer' : 'normal';
    const tomar = () => {
      const g = grabFrame.current;
      return g ? () => g({ calidad }) : null;
    };
    let frame: string | null = null;
    let vt: VistaTurno | null = null;
    // `escena`: la cámara y la gente al sacar la foto; con eso se guarda la vista aunque llegue tarde (lib/vistaTurno.ts).
    const alSacar = () => ({ lado: ladoCamaraRef.current, personas: escenaRef.current?.personas ?? 0 });
    const io = (foto: () => Promise<string | null>, escena = alSacar) => ({ ahora: Date.now, foto, escena, ver: (b64: string, f: FocoVision) => verCamara(b64, f) });
    const opciones = { lado: ladoCamaraRef.current, personas: escenaFresca(escenaRef.current) ? escenaRef.current.personas : undefined };
    // A-2: el turno con foto tiene su ficha desde que empieza a mirar: una frase nueva o «callar» lo cortan también mientras
    // espera la cámara o la vista (lib/turnoMesa.ts), y askBrain sigue con la misma ficha. Si nadie la usa, la próxima la
    // reemplaza (no queda nada en camino).
    const tk = turnoMesa.empezar();
    if (apuntar) setPreviaCamara(true);
    try {
      // Con la cámara ya prendida y algo que mostrar: un momento para ponerlo delante y que enfoque.
      if (apuntar && grabFrame.current) await tk.hasta(new Promise((r) => setTimeout(r, 900)));
      const g = grabFrame.current;
      if (g && tk.vigente) {
        const v = await tk.hasta(vistaParaTurno(io(() => g({ calidad })), foco, opciones));
        if (v === CORTADO) return;
        vt = v;
      }
      if (!tk.vigente) return;
      if (!vt || vt.tipo === 'sin_foto') {
        // La cámara arranca apagada: si pide «¿qué ves?», se prende SOLO AHORA para mirar (lo pidió) y se
        // dice; mientras enfoca, la línea de estado dice «mirando». Antes contestaba «aún no identifico
        // nada» sin prenderla (José, 2-oct: «una foto… no lo hace»).
        if (!camara.encendida()) {
          if (!(await encenderCamara('temporal'))) return void (await say(tr('Necesito permiso de cámara para verte.', 'I need camera permission to see you.'), 'CONCERNED', { emocion: 'preocupado' }));
          await say(
            apuntar ? tr('Prendo la cámara un momento. Ponlo frente a la pantalla…', 'Turning the camera on for a moment. Hold it up to the screen…') : tr('Prendo la cámara un momento. Déjame ver…', 'Turning the camera on for a moment. Let me look…'),
            'SCAN'
          );
        }
        setToolHint(tr('mirando con la cámara', 'looking with the camera'));
        try {
          const f = await tk.hasta(esperarFrame(tomar, { maxMs: 7000 }));
          if (f === CORTADO) return;
          frame = f;
        } finally {
          setToolHint('');
        }
        // Lo de cuando se sacó (ya está sacada: es ahora mismo, antes de esperar al servidor).
        const alSacarFrame = alSacar();
        // La foto ya está: lo que diga el servidor tampoco traba el turno más de ~1,5 s.
        const listo = frame;
        if (listo) {
          const v = await tk.hasta(vistaParaTurno(io(async () => listo, () => alSacarFrame), foco, { ...opciones, lado: alSacarFrame.lado }));
          if (v === CORTADO) return;
          vt = v;
        }
      }
    } finally {
      setPreviaCamara(false);
    }
    if (!tk.vigente) return;
    if (vt && vt.tipo !== 'sin_foto') {
      const [es, en] = PEDIDO_VISTA[foco];
      const pedido = tr(es, en);
      setFace('SCAN');
      miga(`vista del turno: ${vt.tipo === 'fresca' ? `fresca de hace ${Math.round(vt.edadMs / 1000)} s` : vt.tipo === 'vista' ? `vista en ${vt.esperaMs} ms` : `foto al turno (${vt.motivo} a los ${vt.esperaMs} ms)`}`);
      if (vt.tipo === 'fresca' || vt.tipo === 'vista') {
        if (vt.foto) setVisor({ foto: vt.foto, vista: vt.vista, foco, mirando: false });
        const etiquetas = etiquetasDeVista(vt.vista);
        if (etiquetas.length) setObjects(etiquetas);
        // Solo la de «¿qué ves?» queda como vista fresca: el hecho de «léeme esto» lleva otra instrucción.
        if (vt.tipo === 'vista' && foco === 'escena') vistaFresca.guardar({ vista: vt.vista, visto: vt.visto, ts: Date.now() - vt.esperaMs, lado: vt.alSacar.lado, personas: vt.alSacar.personas, foto: vt.foto });
        // La hora de captura: la fresca trae su edad; la recién vista, lo que se esperó al servidor.
        await askBrain(pedido, { visto: vt.visto, vistoTomadaEn: Date.now() - (vt.tipo === 'fresca' ? vt.edadMs : vt.esperaMs), foco, ficha: tk });
        if (vt.foto) cerrarVisorEn(VISOR_MS);
        return;
      }
      // El servidor no la vio a tiempo: el turno sale YA con la foto (el servidor la mira dentro del turno) y «Lo que vi»
      // se completa cuando vuelva el primer pedido; si no vuelve nada, se cierra solo (nada de una foto congelada).
      const foto = vt.foto;
      const tomadaEn = Date.now() - vt.esperaMs;
      // La cámara y la gente de cuando se sacó: la respuesta puede llegar segundos después, con otra cámara u otra gente.
      const { lado: ladoFoto, personas: personasFoto } = vt.alSacar;
      setVisor({ foto, vista: null, foco, mirando: true });
      void vt.tarde.then((r) => {
        setVisor((v) => (v && v.foto === foto ? (r?.vista ? { foto, vista: r.vista, foco, mirando: false } : null) : v));
        if (!r?.vista) return;
        if (r.etiquetas.length) setObjects(r.etiquetas);
        if (foco === 'escena') vistaFresca.guardar({ vista: r.vista, visto: r.estructurada ? r.visto : '', ts: tomadaEn, lado: ladoFoto, personas: personasFoto, foto });
      });
      await askBrain(pedido, { image: `data:image/jpeg;base64,${foto}`, foco, ficha: tk });
      cerrarVisorEn(VISOR_MS);
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
    await say(objs.length ? `${tr('Veo', 'I see')}: ${objs.join(', ')}.` : tr('La cámara no me dio imagen todavía. Apúntala hacia ti y pregúntame otra vez «¿qué ves?».', 'The camera hasn’t given me a picture yet. Point it at yourself and ask me again “what do you see?”.'), 'SCAN');
  }, [askBrain, camara, cerrarVisorEn, encenderCamara, escenaFresca, say]);

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
      if (coreDone && ci < CONOCER_CORE)
        return exitConocer(tr('Gracias. Ya te conozco mejor; no repetiré estas preguntas. Si quieres más, di «conocer más».', 'Thanks. I know you better now; I won’t repeat these questions. If you want more, say “learn more”.'));
      if (next < 0) return exitConocer(tr('Listo. Ya te conozco mejor.', 'Done. I know you better now.'));
      conocerIdxRef.current = next;
      await say(`${tr('Anotado.', 'Noted.')} ${preguntaConocer(next)}`, 'CURIOUS', { emocion: 'curioso' });
    },
    [exitConocer, say, user]
  );

  const handleCommand = useCallback(
    // `oidaEn`: cuándo entregó el oído esta frase (0 si se escribió): viaja con el pedido, también si espera en `pending`.
    async (raw: string, oidaEn = 0) => {
      const cmd = raw.trim();
      if (!cmd) return;
      if (handling.current) {
        // «Callar» no se encola: corta lo que esté pensando o diciendo, ya.
        if (interpretar(cmd, { dormido: false, enConocer: false }).tipo === 'callar') {
          turnoMesa.cancelar('callar');
          pending.current = null;
          await stopSpeaking();
          // La voz cortada no llama a su onEnd: la pausa del micrófono se suelta aquí.
          oidoMesa.current?.vozCortada();
          speakingRef.current = false;
          setToolHint('');
          // Le habló encima para callarla: como una persona, un «está bien» corto y a escuchar.
          if (interrumpida.current !== null) {
            interrumpida.current = null;
            void say(tr('Está bien.', 'Okay.'), 'IDLE');
          }
          return;
        }
        // Habló otra vez mientras pensaba (José, 7-oct: la respuesta a la frase de antes sonaba después de la nueva). Si la
        // respuesta todavía no suena y es una frase nueva de verdad, ese turno se corta: no suena ni hace nada, y la frase
        // nueva va después (el servidor le manda la de antes como contexto). Si ya suena, como siempre: se juntan en orden y
        // van después (Codex, 3-oct: «se juntan, no se pisan»). Revisión del 7-oct (G2): «¿hola?», «¿me oyes?» o un «ajá»
        // no cortan (el turno contesta), y un turno con una herramienta con efectos en curso nunca se corta (lib/fraseNueva.ts).
        const d = fraseDuranteTurno({ cmd, pendiente: pending.current, pensando: turnoMesa.pensando(), hablando: speakingRef.current, efecto: turnoMesa.efecto() });
        if (d.descartada) {
          miga('mesa: frase de relleno mientras pensaba; el turno sigue');
          return;
        }
        if (d.cortar) {
          turnoMesa.cancelar('frase_nueva');
          miga('mesa: llegó otra frase antes de contestar; la respuesta a la de antes ya no suena');
        }
        pending.current = d.pendiente;
        pendienteOidaEn.current = oidaEn || pendienteOidaEn.current;
        return;
      }
      handling.current = true;
      fraseOidaEn.current = oidaEn;
      oidaTurno.current = oidaEn;
      trazaTurno.empezar(oidaEn);
      lastUserAt.current = Date.now();
      comentarista.usuarioHablo();
      // Lo que estaba vivo ANTES de cortar la voz: «para» decide sobre eso (AUR10).
      const controlesAntes = estadoControlesDe({ hablando: speakingRef.current, cola: 0, tarea: pcEstadoRef.current?.actual?.estado, ciclo: vozRef.current.ciclo, pensando: false });
      await stopSpeaking();
      registroVoz.nuevoTurno();
      interrumpidaTurno.current = interrumpida.current;
      interrumpida.current = null;
      historial.current = [...historial.current, { rol: 'usuario' as const, texto: cmd }].slice(-12);
      setMensajes((m) => [...m, { rol: 'usuario' as const, texto: cmd }].slice(-80));

      const enConocer = modeRef.current === 'CONOCER' && conocerIdxRef.current >= 0 && conocerIdxRef.current < CONOCER_QUESTIONS.length;
      const intent = interpretar(cmd, { dormido: presenceRef.current === 'sleep', enConocer, ...controlesAntes });

      try {
        // La respuesta a «¿Qué paro: mi voz, la tarea o las dos?» (AUR10): cada control toca solo lo suyo.
        if (aclaracionMesa.current) {
          const opciones = aclaracionMesa.current;
          aclaracionMesa.current = null;
          const r = respuestaAclaracion(cmd, opciones);
          if (r === 'ninguno') return void (await say(tr('Va, sigo.', "Okay, I'll keep going."), 'IDLE'));
          if (r) {
            for (const c of r) emitir('accion', accionDeControlMesa(c));
            return;
          }
        }
        if (presenceRef.current === 'sleep') {
          setPresence('stay');
          presenceRef.current = 'stay';
          if (intent.tipo === 'despertar') return void (await say(tr('Despierto. Te escucho.', 'Awake. I’m listening.'), 'HAPPY', { emocion: 'feliz' }));
        }
        // En la entrevista todo es respuesta salvo salir / callar / dormir / menú / sesión.
        if (enConocer && !['conocer_salir', 'callar', 'dormir', 'logout', 'menu', 'catalogo', 'control', 'aclarar'].includes(intent.tipo)) return void (await answerConocer(cmd));

        // La respuesta a «¿solo ahora o siempre?» (la cámara).
        if (esperaModoCamara.current) {
          esperaModoCamara.current = false;
          const r = respuestaModoCamara(cmd);
          if (r === 'no') return void (await say(tr('Va, la dejo apagada.', 'Okay, I’ll leave it off.'), 'IDLE'));
          const modo = r === 'siempre' ? 'siempre' : 'temporal';
          if (!(await encenderCamara(modo))) return void (await say(tr('Necesito permiso de cámara para verte.', 'I need camera permission to see you.'), 'CONCERNED', { emocion: 'preocupado' }));
          return void (await say(modo === 'siempre' ? tr('Listo: te veré siempre que entres. Dime «apaga la cámara» cuando quieras.', 'Done: I’ll see you every time you come in. Say “turn off the camera” anytime.') : tr('Listo, te veo. Me apago sola en diez minutos o al salir de la mesa.', 'Done, I can see you. I’ll turn off by myself in ten minutes or when you leave the desk.'), 'HAPPY', { emocion: 'feliz' }));
        }
        // ── Revisión 7 (G1): lo que el teléfono resuelve solo y toca lo privado de la dueña pasa por «¿quién habla?»
        // (src/lib/privadoLocal.ts): con su voz guardada, solo con su voz confirmada en esta frase o por continuidad.
        const decidirLocal = () => decidirPrivadoLocal({ oidaEn, paraTurno: vocesRef.current?.paraTurno, caraDuenaEn: carasRef.current?.duenaVistaEn?.() || 0 });
        // El nombre que contesta a «¿cómo se llama? … la recuerdo» también: aprender una cara lo pide la dueña, no un invitado.
        // Solo si de verdad da un nombre (esperaNombre es estricta: una orden, una pregunta o una frase corta de un invitado
        // no reciben «eso es de la dueña»; siguen su camino y sueltan la espera, aprenderPorVoz.ts interrumpeEspera).
        if (pedidoLocalPrivado(cmd) || caras.esperaNombre(cmd)) {
          const d = await decidirLocal();
          if (!d.permitido) {
            // «Me acompaña mi hija» de un invitado no es aprender nada: es charla, va al servidor (en modo invitado).
            if (negadoVaAlCerebro(cmd)) return void (await askBrain(cmd));
            return void (await say(fraseNegarLocal(d.quienHabla, idiomaActual() === 'en'), 'CONCERNED', { emocion: 'preocupado' }));
          }
        }
        if (intencionPrivada(intent.tipo)) {
          const d = await decidirLocal();
          if (!d.permitido) {
            // Lo que lee («¿qué sabes de mí?») va al servidor, que contesta en modo invitado; lo que escribe se niega aquí.
            if (intent.tipo === 'que_recuerdas') return void (await askBrain(cmd));
            return void (await say(fraseNegarLocal(d.quienHabla, idiomaActual() === 'en'), 'CONCERNED', { emocion: 'preocupado' }));
          }
        }
        // ── fin revisión 7 (G1)
        // Las caras (con permiso): «conóceme», «te presento a…», «olvida a…» y el «sí» de quien presentaron.
        // Las voces (con permiso): «aprende mi voz», «aprende la voz de…», sus frases y el «sí», «¿quién habla?».
        if (await vocesRef.current?.manejar(cmd)) return;
        if (await caras.manejar(cmd)) return;
        // «Lo que veo» y la cámara de atrás: «muéstrame lo que ves», «cierra la vista», «cámara trasera»,
        // «voltea la cámara». Con la cámara apagada, la prende solo por ahora (lo pidió para ver).
        const pv = pedidoDeVista(cmd, { vistaAbierta: vistaCamaraRef.current });
        if (pv) {
          if (pv === 'cerrar') {
            setVistaCamara(false);
            return void (await say(tr('Listo, cierro la vista. Sigo mirando.', 'Done, view closed. I’m still looking.'), 'IDLE'));
          }
          const lado: Lado = pv === 'trasera' ? 'trasera' : pv === 'frontal' ? 'frontal' : pv === 'voltear' ? (ladoCamaraRef.current === 'frontal' ? 'trasera' : 'frontal') : ladoCamaraRef.current;
          if (lado !== ladoCamaraRef.current) cambiarLado(lado);
          if (!camara.encendida() && !(await encenderCamara('temporal'))) return void (await say(tr('Necesito permiso de cámara para ver.', 'I need camera permission to see.'), 'CONCERNED', { emocion: 'preocupado' }));
          setVistaCamara(true);
          const dicho =
            pv === 'abrir'
              ? tr('Mira: esto es lo que veo. Las caras llevan su recuadro.', 'Look: this is what I see. Faces get a box.')
              : lado === 'trasera'
              ? tr('Cámara trasera: ahora veo lo que tienes delante.', 'Back camera: now I see what’s in front of you.')
              : tr('Cámara frontal: otra vez te veo a ti.', 'Front camera: I see you again.');
          return void (await say(dicho, 'SCAN'));
        }
        // La cámara por voz: «puedes verme», «mírame» → ¿solo ahora o siempre?; «apaga la cámara».
        // «Mira esto», «¿me ves?» son mirar (whatDoYouSee, abajo), no solo encenderla (José, 6-oct: «Mira, mira» → «¿Qué ves?»).
        const pc = intent.tipo === 'vision_on' ? 'encender' : intent.tipo === 'que_ves' ? null : pedidoDeCamara(cmd);
        if (pc === 'encender') {
          // Ya encendida y pide que la mire («puedes verme», «mírame»): se mira de verdad y se dice lo visto.
          if (camara.encendida()) return void (await (pideMirar(cmd) ? whatDoYouSee() : say(tr('Ya te estoy viendo.', 'I can already see you.'), 'HAPPY', { emocion: 'feliz' })));
          esperaModoCamara.current = true;
          return void (await say(tr('¿Te veo solo ahora, o siempre que entres?', 'Should I see you just now, or every time you come in?'), 'CURIOUS', { emocion: 'curioso' }));
        }
        if (pc === 'apagar' || pc === 'apagar_siempre') {
          const siempre = camara.estado().modo === 'siempre';
          await apagarCamara(pc === 'apagar_siempre');
          return void (await say(pc === 'apagar_siempre' || !siempre ? tr('Listo, apagué la cámara.', 'Done, camera off.') : tr('Apagué la cámara. Sigue en «siempre» para la próxima; dime «no me veas nunca» para quitarlo.', 'Camera off. It’s still set to “always” for next time; say “never look at me” to remove that.'), 'IDLE'));
        }

        switch (intent.tipo) {
          case 'control':
            emitir('accion', accionDeControlMesa(intent.control));
            return;
          case 'aclarar':
            aclaracionMesa.current = intent.opciones;
            return void (await say(intent.pregunta, 'CURIOUS', { emocion: 'curioso' }));
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
            // Le habló encima para callarla: un «está bien» corto (José: «que me diga ok, está bien»).
            if (interrumpidaTurno.current !== null) {
              interrumpidaTurno.current = null;
              return void (await say(tr('Está bien.', 'Okay.'), 'IDLE'));
            }
            return;
          case 'modo':
            setMode(intent.modo);
            setPresence(intent.modo === 'EXPLORER' ? 'explore' : 'stay');
            return void (await say(intent.frase, intent.modo === 'GOLD' ? 'PROUD' : intent.modo === 'EXPLORER' ? 'SCAN' : 'IDLE', { emocion: intent.modo === 'GOLD' ? 'orgullo' : 'neutral' }));
          case 'menu':
            // Un solo menú (M-7): «menú» abre «Más».
            setMasAbierto(true);
            return void (await playClip('listo', 'IDLE'));
          case 'catalogo':
            setMasAbierto(true);
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
            return void (await say(
              ok ? tr('Anotado. Lo recuerdo.', 'Noted. I’ll remember it.') : tr('Anotado aquí en la mesa; al servidor se lo paso cuando haya sesión.', 'Noted here at the desk; I’ll pass it to the server once there’s a session.'),
              'HAPPY',
              { emocion: 'feliz' }
            ));
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
            return void (await whatDoYouSee(intent.foco));
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
              setMasAbierto(true);
              setCatalogRequest((n) => n + 1);
            }
            return void (await playClip(intent.id, 'HAPPY'));
          }
          case 'saludo': {
            // Revisión 7 (G1): el nombre de la dueña solo si es ella (o no hay voz guardada que diga otra cosa).
            const ella = (await decidirLocal()).permitido;
            return void (await say(`${tr('Hola', 'Hi')}${ella ? `, ${user.name}` : ''}. ${frase('aqui')}`, 'HAPPY', { emocion: 'feliz' }));
          }
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
        // Un turno especulativo que este pedido no tomó (lo atendió la mesa sin cerebro, u otra frase): se corta.
        especulativo.cancelar();
        handling.current = false;
        idleStatus();
        const next = pending.current;
        const nextOidaEn = pendienteOidaEn.current;
        pending.current = null;
        if (next && mesaMontada.current) void handleCommand(next, nextOidaEn);
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

  /**
   * Claudio y ANT-ONIO en video: cuatro toques seguidos sacaron el sable de luz o los blasters
   * (avatares/video/efectos). Llega EN VEZ del onTap de ese cuarto toque: dice una frase corta de molesto,
   * de las de siempre (lineas.ts; sale de la caché de audio después de la primera vez). La capa ya decidió
   * que el avatar estaba tranquilo al empezar la ráfaga; aquí no se pisa una conversación, una llamada ni
   * otra reacción en curso (el «ya, ya»).
   */
  const onRafagaVideo = useCallback(
    (efecto: 'espada' | 'blasters') => {
      pausarMirada();
      const ahora = Date.now();
      lastUserAt.current = ahora;
      lastTapAt.current = ahora;
      recentTaps.current = [];
      // La ráfaga ya se desahogó (como después del blaster de la mesa): sin esto, unos toques más disparaban
      // el blaster del enojo (irritación ≥ 0,92) apenas terminaba el sable, dos secuencias seguidas.
      irritationRef.current = Math.min(irritationRef.current, 0.25);
      setIrritation(irritationRef.current);
      if (conversandoRef.current || enLlamadaRef.current || presenceRef.current === 'sleep' || handling.current) return;
      handling.current = true;
      setFace('ANGRY');
      void say(pick(lineas(efecto === 'blasters' ? 'angry' : 'annoy')), 'ANGRY', { emocion: 'molesto' }).finally(() => {
        handling.current = false;
      });
    },
    [pausarMirada, say]
  );

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
  const onSwipe = useCallback((dir: 'left' | 'right') => void (dir === 'left' && setMasAbierto(true)), []);

  // El orbe: tocarlo es como tocarle la barbilla (le da cosquillas); deslizar hacia arriba abre «Más».
  const onTocarOrbe = useCallback(() => onTap('chin', 0, 0), [onTap]);
  const onDeslizarOrbe = useCallback((dir: 'arriba' | 'abajo') => void (dir === 'arriba' && setMasAbierto(true)), []);
  const onFalloOrbe = useCallback((motivo: string) => {
    miga(`orbe no disponible: ${motivo}`);
    setConOrbe(false);
  }, []);
  const onFalloSkia = useCallback((motivo: string) => {
    miga(`cara Skia no disponible: ${motivo}`);
    setSkiaFallo(true);
  }, []);
  const cambiarCara = useCallback((c: 'orbe' | 'anillos') => {
    setCara(c);
    // Volver a elegir el orbe es darle otra oportunidad si antes falló.
    if (c === 'orbe') setConOrbe(true);
    void saveSettings({ cara: c, caraElegida: true });
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
    let antes: { x: number; y: number; z: number } | null = null;
    Accelerometer.setUpdateInterval(90);
    const sub = Accelerometer.addListener(({ x, y, z }) => {
      // CAM-G: girar o mover el teléfono deja vieja la foto de la escena (sus recuadros se van).
      if (seMovioTelefono(antes, { x, y, z })) telefonoMovidoEn.current = Date.now();
      antes = { x, y, z };
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
      // Con el micrófono silenciado nada de lo oído es un turno (una frase vieja que llegó tarde, Codex 3-oct).
      if (micMutedRef.current) return void miga('oído: frase tirada (llegó con el micrófono silenciado)');
      setDicho({ texto: text.trim(), n: Date.now() });
      ultimoHablado.current = true;
      void handleCommand(text, Date.now());
    },
    [handleCommand]
  );
  /**
   * El oído cree que la idea está cerrada (lib/finDeTurno.ts) pero todavía espera su silencio: si esa frase va a ir al
   * cerebro tal cual (la mesa está libre y no es nada que la mesa atienda sola: cámara, caras, voces, un modo que espera
   * respuesta), el turno empieza ya como especulativo. Sin quién habla por la voz: si la frase final trae a otra
   * persona, askBrain no lo toma (lib/turnoEspeculativo.ts compara).
   */
  const intentarEspecular = useCallback(
    (texto: string) => {
      const cmd = texto.trim();
      if (!cmd || micMutedRef.current || handling.current || speakingRef.current || turnoRecuperado.current) return;
      if (presenceRef.current === 'sleep' || modeRef.current === 'CONOCER' || aclaracionMesa.current || esperaModoCamara.current || interrumpida.current !== null) return;
      if (!oidoMesa.current?.puedeHablar()) return;
      if (interpretar(cmd, { dormido: false, enConocer: false }).tipo !== 'cerebro') return;
      if (pedidoDeVoces(cmd) || pedidoDeCaras(cmd) || pedidoDeVista(cmd, { vistaAbierta: vistaCamaraRef.current }) || pedidoDeCamara(cmd)) return;
      const e = escenaRef.current;
      const escena = escenaDelTurno({ voz: '', caras: carasRef.current?.escena() || '', camara: escenaFresca(e) ? e.descripcion : '' });
      especulativo.empezar(
        { message: cmd, mode: modeRef.current, userName: user.name, correo: user.correo, historial: [...historial.current, { rol: 'usuario' as const, texto: cmd }].slice(-12), memoria: longMemory.current, escena, hablado: true },
        nuevoIdTurno()
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [escenaFresca, user]
  );
  useEffect(() => {
    setSpeechCallbacks({
      onEspeculativa: (t) => intentarEspecular(t),
      onEspeculativaCancelada: () => especulativo.cancelar(),
      onSpeechStart: () => {
        // La persona habla: el sonido de trabajo del turno en curso se va y ya no vuelve en ese turno.
        trabajoActual.current?.personaHabla();
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
      // Le hablaron encima (lib/speech.ts ya decidió que no es su eco ni un «ajá»): se calla YA, como una
      // persona, y escucha. Lo que dijo hasta ahí queda en el hilo y viaja con el próximo pedido.
      onBargeIn: () => {
        const oido = registroVoz.cortar(fraccionSonando());
        interrumpida.current = oido.slice(-TOPE_CORTADA);
        turnoMesa.cancelar('barge_in');
        pending.current = null;
        void stopSpeaking();
        oidoMesa.current?.vozCortada();
        speakingRef.current = false;
        avisarMesa({ hablando: false, pensando: false });
        if (oido) {
          // Si la respuesta entera ya estaba en el hilo (una que se dijo de un tirón), queda solo lo oído.
          const texto = quitarExpresiones(oido).trim();
          const h = historial.current;
          const ultima = h[h.length - 1];
          if (ultima?.rol === 'ultron' && ultima.texto.startsWith(texto.replace(/…$/, '').slice(0, 24))) historial.current = [...h.slice(0, -1), { rol: 'ultron' as const, texto }];
          else logUltron(oido);
        }
        setToolHint('');
        setFace('LISTENING');
        setStatus('listening');
        miga(`mesa: la interrumpieron hablando (oyó ${oido.length} letras)`);
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
  }, [onSpeechFinal, logUltron, intentarEspecular]);

  // ---------- Arranque ----------
  useEffect(() => {
    let alive = true;
    (async () => {
      const s = await loadSettings();
      // El silencio vale 8 h desde que se puso (lib/silencioMesa.ts SILENCIO_VIGENCIA_MS), aunque Android haya cerrado
      // la app entretanto: dentro del plazo arranca silenciada; pasado, abierta (José, 6-oct: «el micrófono falla»). Las
      // dos cosas se DICEN en el saludo. El silencio de la 5.6.0 (sin hora) tras su OTA: lib/silencioHeredado.ts.
      const arranqueMic = arranqueDelMicrofono(s, Date.now(), await silencioHeredado());
      const silenciada = arranqueMic.silenciada;
      micMutedRef.current = silenciada;
      setMicMuted(silenciada);
      if (arranqueMic.motivo === 'otra-sesion') void saveSettings({ micMuted: false, micMutedEn: null, micMutedSesion: null });
      else if (silenciada && s.micMutedEn !== arranqueMic.desde) void saveSettings({ micMutedEn: arranqueMic.desde, micMutedSesion: null });
      // La cámara arranca apagada salvo que esta persona haya elegido «siempre» (y haya permiso).
      camara.arrancar(prefiereSiempre(s.camaraSiempre, user.correo) && !!camPerm?.granted);
      setLadoCamara(ladoValido(s.camaraLado));
      // La primera vez (o cuando el recorrido creció): la ventana con «Empezar» / «Después».
      const verTutorial = tocaOfrecerRecorrido(s, user.correo);
      setModoMesa(s.modoMesa === 'trabajar' ? 'trabajar' : 'charlar');
      setSettings({ sttEngine: s.sttEngine, proactive: s.proactive, sfx: s.sfx, interrumpir: s.interrumpir === true });
      setOirEncima(s.interrumpir === true);
      // El orbe es su cara desde el 2-oct; los anillos, solo si la persona los eligió después.
      setCara(s.cara === 'anillos' && s.caraElegida ? 'anillos' : 'orbe');
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
      if (micOk && !silenciada) {
        await enableAlwaysOnMic();
        oidoListo.current = true;
        // Si mientras tanto el audio pasó a otro (la conversación, una llamada, otra pantalla), se suelta.
        if (!oidoMesa.current?.oye()) void muteMic();
        setStatus('listening');
      } else setStatus(micOk ? 'muted' : 'offline');
      // Un silencio vencido no se arrastra (antes sí, y José lo vivía como «el micrófono falla»); uno vigente se queda,
      // se ve tachado y el saludo lo dice. Los dos quedan en las migas.
      const migaMic = micOk ? migaArranqueMic(arranqueMic) : '';
      if (migaMic) miga(migaMic);
      arranqueHecho.current = true;

      // El avatar se eligió al entrar (App): si es recién elegido, se presenta él mismo con su voz.
      handling.current = true;
      const saludo = saludoConNombre(user.name);
      const conPresentacion = recienElegido ? `${saludo} ${de(avatarPorId(s.avatar).presentacion)}` : saludo;
      const micReabierto = micOk && arranqueMic.motivo === 'otra-sesion';
      const textoSaludo = saludoArranque(conPresentacion, { micSilenciado: micOk && silenciada, micReabierto, en: idiomaActual() === 'en' });
      // El aviso del micrófono (sigue en silencio, o el silencio venció) se VE siempre: el globo lo pone `say` y, si el
      // saludo no va a sonar (conversación, llamada, el audio es de otro), también queda en el chat.
      // La abrieron para HABLAR (`ultronfp://hablar`, entrada/hablar.ts): sin saludo hablado, que ocuparía la voz y el
      // micrófono justo cuando la persona va a hablar. El aviso del micrófono, si lo hay, queda en el chat.
      const paraHablar = !!buzonHablar.pendiente(Date.now());
      const sonaraSaludo = !paraHablar && !conversandoRef.current && !enLlamadaRef.current && !!oidoMesa.current?.puedeHablar();
      if (micOk && (silenciada || micReabierto) && !sonaraSaludo) logUltron(textoSaludo);
      if (!paraHablar) await say(textoSaludo, 'HAPPY', { emocion: 'feliz' });
      handling.current = false;
      // Después del saludo la mesa sigue al teléfono: en vertical, cuadro con la cara y el chat
      // (Claudio se pone de pie).
      void orientar('libre');

      // La primera vez, la ventana que ofrece el recorrido (Empezar / Contarte de mí / Después); se vuelve a
      // abrir desde «Más → Qué puedo hacer».
      if (alive && verTutorial && mesaVisibleRef.current) abrirBienvenida('primera');
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

  /*
   * «Comenta lo que ve» (lib/vistaCamara.ts Comentarista): con cada vista de la cámara decide si hay
   * algo NUEVO de verdad (texto, lo que te acerca, otro lugar, objetos que no estaban en los últimos
   * 15 min), si hay calma (nadie hablando ni recién hablado, sin llamada) y si toca (≥ 3 min entre
   * comentarios, más si no le contestas; tope 6 por hora). El turno lleva lo visto como texto: antes
   * tomaba OTRA foto y el servidor la volvía a mirar. Si la persona habla mientras, se calla el comentario;
   * y no dice dos veces lo mismo.
   */
  const onVista = useCallback(
    (v: VistaCamara) => {
      const d = comentarista.observar(v, {
        activo: proactiveRef.current,
        ocupada: conversandoRef.current || handling.current || speakingRef.current,
        presente: presenceRef.current === 'stay',
      });
      if (!d.comentar || Date.now() - lastUserAt.current < COMENTARIOS.calmaMs) return;
      const inicio = Date.now();
      void (async () => {
        handling.current = true;
        try {
          const r = await turno({
            message: `Comenta en UNA frase corta y natural lo nuevo que ves por la cámara (${d.novedad.cosas.slice(0, 4).join(', ')}). No describas todo ni repitas lo que ya comentaste. Si no vale la pena, responde solo: nada.`,
            mode: modeRef.current,
            userName: user.name,
            correo: user.correo,
            historial: [],
            visto: resumenVista(v),
            foco: 'escena',
          });
          const reply = (r.reply || '').trim();
          // Habló mientras se pensaba, o ya lo dijo: mejor callar que interrumpir o repetirse.
          const interrumpe = lastUserAt.current > inicio || !!pending.current || conversandoRef.current;
          if (reply && !/^nada\b/i.test(reply) && !interrumpe && !comentarista.repetido(reply)) {
            comentarista.dicho(reply);
            await say(reply, faceForEmocion(r.emocion), { emocion: r.emocion });
          } else comentarista.intentado();
        } finally {
          handling.current = false;
          const next = pending.current;
          const nextOidaEn = pendienteOidaEn.current;
          pending.current = null;
          if (next) void handleCommand(next, nextOidaEn);
        }
      })();
    },
    [comentarista, handleCommand, say, user.correo, user.name]
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

  /**
   * CAM-A: la mirada hacia la persona en CADA evento de la cámara (hasta 15/s), sin estado de React: solo deja el
   * objetivo en el controlador (lib/miradaAvatar.ts). El cuerpo 3D lo lee en su cuadro (alisado con deltaTime,
   * zona muerta, límites, velocidad acotada, sostener y volver al centro). Con el dedo encima, el dedo manda.
   */
  const onGazeCam = useCallback(
    (x: number, y: number, activa: boolean) => {
      if (dragging.current || touchGazeTimer.current) return miradaCam.soltar(Date.now());
      miradaCam.objetivo(x * 0.9, y * 0.7, activa, Date.now());
    },
    [miradaCam]
  );

  // Las caras 2D (gazeX/gazeY por props) no leen el controlador por su cuenta: ≤ 4 veces/s su valor YA alisado, y solo
  // si ningún cuerpo lo lee directo. Sin persona (activa false) retoma la mirada errante.
  useEffect(() => {
    if (!mesaActiva) return;
    const id = setInterval(() => {
      if (miradaCam.conectados() > 0 || dragging.current || touchGazeTimer.current) return;
      const p = miradaCam.paso(Date.now());
      if (!p.activa) return;
      const moved = Math.abs(p.x - gazeCamLast.current.x) > 0.04 || Math.abs(p.y - gazeCamLast.current.y) > 0.04;
      if (!moved) return;
      gazeCamLast.current = { x: p.x, y: p.y };
      setGaze({ x: p.x, y: p.y });
    }, 250);
    return () => clearInterval(id);
  }, [mesaActiva, miradaCam]);

  useEffect(
    () => () => {
      if (sonrisaTimer.current) clearTimeout(sonrisaTimer.current);
    },
    []
  );

  /** Cambiar de avatar desde el menú: su voz desde ya, se guarda y se presenta él mismo. */
  const elegirAvatar = async (id: AvatarId) => {
    setEligiendo(null);
    setMasAbierto(false);
    await stopSpeaking();
    setAvatar(id);
    setAvatarVoz(id);
    await saveSettings({ avatar: id, avatarElegido: true });
    // También a su perfil, como el selector y Ajustes: si no, el perfil seguía con el avatar viejo y la
    // próxima sincronización lo devolvía solo (inventario de botones, 3-oct).
    guardarPerfil({ avatar: id });
    if (!conversandoRef.current) void say(de(avatarPorId(id).presentacion), 'HAPPY', { emocion: 'feliz' });
  };

  /**
   * Conversar de corrido (como el modo voz de ChatGPT): se suelta el micrófono de la mesa y la voz
   * de la mesa, y los toma la sesión de ElevenLabs (VozProvider). Nada se espera antes de pedirla:
   * el permiso ya está precalentado y soltar el micrófono tarda menos que conectar.
   */
  const toggleConversar = () => {
    void haptic('medium');
    setMasAbierto(false);
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
    } else if (estadoConv === 'escuchando' && convPensando) {
      // Ya la entendió y el agente prepara la respuesta: no se pinta «escuchando» (el micrófono sigue abierto).
      setFace('THINKING');
      setStatus('thinking');
    } else if (estadoConv === 'escuchando') {
      setFace('LISTENING');
      setStatus('listening');
      setListening(true);
    } else if (estadoConv === 'conectando') {
      setFace('THINKING');
      setStatus('thinking');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversando, convSilencio, estadoConv, convPensando]);

  // Lo que se dice en la conversación va al chat y a la burbuja de la mesa; lo tuyo cuenta como actividad.
  useEffect(
    () =>
      mensajeVoz.escuchar((m) => {
        if (!m) return;
        if (m.rol === 'usuario') {
          lastUserAt.current = Date.now();
          comentarista.usuarioHablo();
          historial.current = [...historial.current, { rol: 'usuario' as const, texto: m.texto }].slice(-12);
          setMensajes((l) => [...l, { rol: 'usuario' as const, texto: m.texto }].slice(-80));
          setDicho({ texto: m.texto.trim(), n: Date.now() });
          // La cámara por voz también en la conversación en vivo: ahí no se pregunta «¿solo ahora o
          // siempre?» (contesta el agente), así que es «solo ahora»; el agente se entera de lo que pasó.
          // «Lo que veo» y la cámara de atrás también ahí (solo si la cámara ya está encendida).
          const pv = camaraRef.current.encendida() ? pedidoDeVista(m.texto, { vistaAbierta: vistaCamaraRef.current }) : null;
          if (pv === 'cerrar') setVistaCamara(false);
          else if (pv) {
            const lado: Lado = pv === 'trasera' ? 'trasera' : pv === 'frontal' ? 'frontal' : pv === 'voltear' ? (ladoCamaraRef.current === 'frontal' ? 'trasera' : 'frontal') : ladoCamaraRef.current;
            if (lado !== ladoCamaraRef.current) {
              cambiarLadoRef.current(lado);
              vozRef.current.avisarAgente(lado === 'trasera' ? '[app] Ahora la cámara es la TRASERA: lo que ve no es quien mira la pantalla.' : '[app] Ahora la cámara es la frontal.');
            }
            setVistaCamara(true);
          }
          const pc = pv ? null : pedidoDeCamara(m.texto);
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
    // Con el recorrido abierto la mesa suelta el oído: si no, oiría a Claudio y ANT-ONIO y les contestaría.
    // Igual con las preguntas de la bienvenida a la vista: su dictado usa el micrófono.
    const tapada = tutorialAbierto || preguntasAbiertas;
    const dueno = duenoAudio({ enLlamada, conversacion: vozOcupa, burbuja, mesaVisible: mesaVisible && !tapada, appActiva, companeraVisible: companeraVisible && !tapada });
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
  }, [enLlamada, vozOcupa, burbuja, mesaVisible, appActiva, companeraVisible, restFace, tutorialAbierto, preguntasAbiertas]);

  // Lo que se habló en la burbuja, al hilo y al chat de la mesa en cuanto se cierra (o al montarse, si la app no estaba
  // abierta): «Abrir en AURA» sigue la MISMA conversación.
  useEffect(() => {
    if (burbuja) return;
    const nuevos = hiloCompartido.tomarPorEntregar(user.correo);
    if (!nuevos.length) return;
    historial.current = [...historial.current, ...nuevos].slice(-12);
    setMensajes((m) => [...m, ...nuevos].slice(-80));
    miga(`mesa: ${nuevos.length} turnos de la burbuja pasan al hilo`);
  }, [burbuja, user.correo]);

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
          turnoMesa.cancelar('llamada');
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
      // Lo dicho y aún en espera (no empezado) era de antes de silenciar: no sale después al reabrir.
      if (pending.current && pendienteOidaEn.current) {
        pending.current = null;
        pendienteOidaEn.current = 0;
      }
      setMicMuted(true);
      setStatus('muted');
      // Con su hora: el silencio sigue 8 h aunque Android cierre la app (lib/silencioMesa.ts), y después vence.
      await saveSettings({ micMuted: true, micMutedEn: Date.now(), micMutedSesion: null });
      await say(tr('Micrófono en silencio.', 'Microphone muted.'), 'IDLE');
    } else {
      const ok = await ensureSpeechPermissions();
      if (!ok) return pedirEnAjustes(tr('Micrófono', 'Microphone'), tr('Para escucharte necesito el micrófono. Actívalo en los ajustes del teléfono.', 'I need the microphone to hear you. Turn it on in the phone settings.'));
      await unmuteMic();
      oidoListo.current = true;
      micMutedRef.current = false;
      setMicMuted(false);
      setStatus('listening');
      await saveSettings({ micMuted: false, micMutedEn: null, micMutedSesion: null });
      await say(tr('Te escucho de nuevo.', 'I’m listening again.'), 'HAPPY', { emocion: 'feliz' });
    }
  };

  /*
   * `ultronfp://hablar` (entrada/hablar.ts): la persona pidió hablar desde fuera (el «Abrir en AURA» de la burbuja). Se
   * calla a AURA si hablaba, se abre el micrófono SIN decir nada y se mide hasta que el oído escucha de verdad. El
   * silencio que la persona dejó puesto solo lo quita el pedido interno de la burbuja (lo acaba de pedir hablándole); un
   * enlace de fuera lo respeta (entrada/enlace.ts `oidoParaHablar`).
   */
  useHablarEnMesa({
    // Con la burbuja todavía abierta (el «Abrir en AURA» la está cerrando) el micrófono es suyo: se espera a que lo suelte.
    lista: () => arranqueHecho.current && !burbujaAbierta.abierta(),
    ocupada: () => conversandoRef.current || enLlamadaRef.current,
    callar: () => {
      if (!speakingRef.current) return;
      void stopSpeaking();
      oidoMesa.current?.vozCortada();
      speakingRef.current = false;
      avisarMesa({ hablando: false });
    },
    abrirOido: async (p) => {
      const queHacer = oidoParaHablar(p, micMutedRef.current);
      if (queHacer === 'respetar-silencio') {
        setStatus('muted');
        showBubble(tr('Sigo con el micrófono en silencio, como lo dejaste. Tócalo para hablarme.', 'My microphone is still muted, as you left it. Tap it to talk to me.'));
        return 'silenciado';
      }
      const ok = await ensureSpeechPermissions();
      if (!ok) {
        pedirEnAjustes(tr('Micrófono', 'Microphone'), tr('Para escucharte necesito el micrófono. Actívalo en los ajustes del teléfono.', 'I need the microphone to hear you. Turn it on in the phone settings.'));
        return false;
      }
      if (queHacer === 'quitar-silencio' || !oidoListo.current) {
        // Arrancó silenciada: el oído nunca se armó (enableAlwaysOnMic elige el motor y cae al siguiente si hace falta).
        if (!oidoListo.current) await enableAlwaysOnMic();
        else await unmuteMic();
        oidoListo.current = true;
        micMutedRef.current = false;
        setMicMuted(false);
        await saveSettings({ micMuted: false, micMutedEn: null, micMutedSesion: null });
      } else if (!oidoEscuchando()) await reabrirMic();
      setStatus('listening');
      return true;
    },
    avisarSinOido: () => {
      setStatus('reconnect');
      showBubble(tr('No pude abrir el micrófono. ¿Otra app lo está usando?', 'I couldn’t open the microphone. Is another app using it?'));
    },
  });

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
    await saveSettings({ sttEngine: e, oidoElegido: true });
    await setSttEngine(e);
    await say(
      e === 'turbo'
        ? tr('Oído Turbo: te oigo en vivo.', 'Turbo hearing: listening live.')
        : e === 'native'
          ? tr('Oído: reconocimiento del teléfono.', 'Hearing: phone recognition.')
          : tr('Oído: transcripción en la nube.', 'Hearing: cloud transcription.'),
      'IDLE'
    );
  };
  const toggleInterrumpir = async () => {
    const next = !settings.interrumpir;
    setSettings((p) => ({ ...p, interrumpir: next }));
    setOirEncima(next);
    await saveSettings({ interrumpir: next, interrumpirElegido: true });
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
    // Sin efectos tampoco suenan los de trabajo: el del turno en curso se va ya.
    trabajoActual.current?.revisar();
    setSettings((p) => ({ ...p, sfx: next }));
    await saveSettings({ sfx: next });
    if (next) playSfx('tap');
  };
  const probarVoz = () => {
    setMasAbierto(false);
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

  /**
   * Un turno de la persona escrito (o el «Sí» de una propuesta de AURA): conversando, va a la conversación
   * (la mesa no contesta encima, M3); si no, lo contesta la mesa. false si la conversación no lo aceptó.
   */
  const mandarTurno = (t: string): boolean => {
    if (conversandoRef.current) {
      if (!voz.enviarTexto(t)) return false;
      lastUserAt.current = Date.now();
      comentarista.usuarioHablo();
      historial.current = [...historial.current, { rol: 'usuario' as const, texto: t }].slice(-12);
      setMensajes((l) => [...l, { rol: 'usuario' as const, texto: t }].slice(-80));
      return true;
    }
    void handleCommand(t);
    return true;
  };
  const mandarTurnoRef = useRef(mandarTurno);
  mandarTurnoRef.current = mandarTurno;

  /* ── el primer resultado: recuperar al reabrir, seguir sus tareas y el «¿Te sirvió?» ──────────── */

  useEffect(() => {
    let vivo = true;
    const gen = generacionCuenta();
    const quitar = alCambiarPrimer((correo, r) => {
      if (vivo && correo === user.correo) setPrimer(r);
    });
    let espera: ReturnType<typeof setTimeout> | null = null;
    void leerPrimerDe(user.correo).then((r) => {
      if (!vivo || !sigueVigente(gen)) return;
      setPrimer(r);
      const q = queRecuperar(r, Date.now());
      // Preparada o fallida: vuelve a la caja (lo manda la persona). Lo escrito después gana.
      if (q.accion === 'rellenar') setDraft((d) => (d.trim() ? d : q.texto));
      else if (q.accion === 'reconsultar') {
        // Se mandó y se cerró la app antes de la respuesta. Primero se pregunta SOLO por ese idTurno (revisión 9, R1):
        // si el servidor tiene su respuesta (o el turno sigue en curso), se pide con `soloRepetir` y la repite, sin correr
        // otro. Si el pedido nunca llegó, NO corre un turno nuevo sin que la persona toque nada: vuelve a la caja.
        espera = setTimeout(() => {
          if (!vivo || !sigueVigente(gen)) return;
          void consultarTurnoGuardado(q.idTurno).then((resp) => {
            if (!vivo || !sigueVigente(gen)) return;
            const d = trasSoloRepetir(resp);
            // Conversando, el texto iría a la voz (otro turno, sin idTurno): también vuelve a la caja.
            if (d.accion === 'rellenar' || conversandoRef.current) {
              miga(d.accion === 'rellenar' && d.noLlego ? 'primer resultado: el pedido no llegó; vuelve a la caja' : 'primer resultado: no pude recuperar el pedido; vuelve a la caja');
              setDraft((x) => (x.trim() ? x : q.texto));
              if (d.accion === 'rellenar' && d.noLlego) void anotarPrimer(user.correo, { tipo: 'turno', idTurno: q.idTurno, resultado: { clase: 'fallida', motivo: 'el pedido no llegó al servidor' } });
              return;
            }
            miga('primer resultado: recuperando el pedido pendiente');
            turnoRecuperado.current = { texto: q.texto, idTurno: q.idTurno, soloRepetir: true };
            if (!mandarTurnoRef.current(q.texto)) turnoRecuperado.current = null;
          });
        }, 1500);
      }
    });
    return () => {
      vivo = false;
      quitar();
      if (espera) clearTimeout(espera);
    };
  }, [user.correo]);

  // La respuesta abrió tareas durables: el resultado es el de TODAS esas tareas (las de /api/trabajos, la fuente de
  // verdad; también tras reabrir). Las que no están en la lista (o vienen «sin confirmar») se preguntan una por una;
  // una que no se pudo leer (503, 404, red) queda SIN LEER, no se descarta (auditoría del 5-oct, R1): el
  // clasificador no cierra hasta tenerlas todas. Lo leído va atado a este turno y a estos ids, y a esta sesión.
  const idsPrimer = primer?.estado === 'en-tarea' ? (primer.tareas || []).join(',') : '';
  const turnoPrimer = primer?.estado === 'en-tarea' ? primer.idTurno : undefined;
  useEffect(() => {
    if (!idsPrimer) return;
    let vivo = true;
    const gen = generacionCuenta();
    void seguirTareasPrimer({
      ids: idsPrimer.split(','),
      idTurno: turnoPrimer,
      lista: trabajos.tareas,
      leer: (id) => clienteTrabajos.leer(id),
      vigente: () => vivo && sigueVigente(gen),
      anotar: (ev) => void anotarPrimer(user.correo, ev),
    });
    return () => {
      vivo = false;
    };
  }, [idsPrimer, turnoPrimer, trabajos.tareas, user.correo]);

  const opinarPrimer = useCallback(
    (sirvio: boolean) => {
      void haptic('light');
      const traza = primer?.trazaId;
      void anotarPrimer(user.correo, { tipo: 'opinar', sirvio });
      // La misma señal que la web (`opinarTurno`): si hay traza del turno, también va al servidor.
      if (traza) void opinarTurno(traza, sirvio ? 1 : -1);
    },
    [primer?.trazaId, user.correo]
  );
  // Con resultado, «¿Te sirvió?»; esperando tareas con alguna ya terminada, el progreso (sin pregunta ni cierre).
  const avance = avancePrimer(primer);
  const preguntaPrimer = debePreguntar(primer) || (avance && avance.listas > 0) ? <SirvioPrimera registro={primer!} onOpinar={opinarPrimer} /> : null;

  const sendDraft = () => {
    const t = draft.trim();
    if (!t) return;
    const conversandoAhora = conversandoRef.current;
    if (!mandarTurno(t)) return;
    setDraft('');
    if (!conversandoAhora) setMasAbierto(false);
  };

  /* ── lo que AURA propone por su cuenta (compa/iniciativa.ts, server/iniciativa.ts) ──────────── */

  useEffect(() => {
    propuestas.paraPersona(user.correo);
  }, [user.correo]);

  /** Llegó una nueva: con la mesa a la vista, un toque suave. En una conversación de voz (o hablando), en silencio. */
  const avisarPropuesta = useCallback((r: ResultadoSondeo) => {
    if (r === 'nueva' && mesaVisibleRef.current && !conversandoRef.current && !speakingRef.current) void haptic('light');
  }, []);

  // Empujada por el servidor en el canal de acciones (la misma que el GET: no se duplica).
  useEffect(
    () =>
      escuchar('accion', (a) => {
        if (esAccionIniciativa(a)) avisarPropuesta(propuestas.ofrecer(propuestaDeAccion(a)));
      }),
    [avisarPropuesta]
  );

  // Al abrir la app y cada ~20 min con ella delante: ¿hay una propuesta? (si quedó pendiente, sale otra vez).
  useEffect(() => {
    if (!appActiva) return;
    let vivo = true;
    let reloj: ReturnType<typeof setTimeout>;
    const vuelta = async () => {
      if (!vivo) return;
      propuestas.limpiarCaducada();
      if (tocaSondear(propuestas.ultimoSondeo, Date.now())) {
        propuestas.ultimoSondeo = Date.now();
        // Cada consulta toma su turno antes de salir: si terminan fuera de orden, una vieja no resucita ni retira la
        // tarjeta. Un `propuesta: null` válido y más nuevo la retira (el hecho ya no vale); un fallo no toca nada.
        const turno = propuestas.empezarSondeo();
        let res: RespuestaSondeo;
        try {
          res = { ok: true, cuerpo: await api('/api/iniciativa', { method: 'GET' }, TOPE_SONDEO_MS) };
        } catch {
          /* sin red, sin la ruta todavía, un no-2xx o el tope de tiempo: queda la última tarjeta válida */
          res = { ok: false };
        }
        const r = propuestas.terminarSondeo(turno, res);
        if (vivo) avisarPropuesta(r);
      }
      if (vivo) reloj = setTimeout(vuelta, SONDEO_INICIATIVA_MS);
    };
    const ultimo = propuestas.ultimoSondeo;
    reloj = setTimeout(vuelta, ultimo ? Math.max(1000, ultimo + SONDEO_INICIATIVA_MS - Date.now()) : PRIMER_SONDEO_MS);
    return () => {
      vivo = false;
      clearTimeout(reloj);
    };
  }, [appActiva, avisarPropuesta]);

  /**
   * Tocó «Sí, hazlo», «Luego» o «No»: la tarjeta se cierra ya y la respuesta viaja por detrás. Con «Sí», el
   * pedido que devuelve el servidor se manda como turno normal (AURA lo hace con sus manos).
   */
  const responderPropuesta = (r: RespuestaBoton) => {
    const p = propuestas.ahora();
    if (!p || !propuestas.responder(p.id)) return;
    void haptic('light');
    void (async () => {
      let res: ResultadoRespuesta;
      try {
        const d = await api<{ pedido?: string | null }>('/api/iniciativa/responder', { method: 'POST', body: JSON.stringify(cuerpoRespuesta(p.id, r)) }, 15_000);
        res = { ok: true, pedido: d?.pedido ?? null };
      } catch (e: any) {
        res = { ok: false, status: Number(e?.status) || undefined };
      }
      const pedido = pedidoAMandar(r, p, res);
      if (pedido) {
        mandarTurnoRef.current(pedido);
        return;
      }
      if (r === 'si' && !res.ok && !conversandoRef.current) {
        miga('iniciativa: la propuesta ya no estaba pendiente');
        void say(tr('Esa idea ya no estaba vigente. Si todavía la quieres, dímela y lo hago.', 'That idea had expired. If you still want it, tell me and I’ll do it.'), 'IDLE');
      }
    })();
  };

  // ── Ventana de decisión (José, 5-oct) ──────────────────────────────────────────────────────────────────────────
  // Lo que espera su «sí» (un WhatsApp, un correo, lo del taller, la pregunta de su computadora) aparece encima de la
  // mesa, de a una y en orden. Espera a que no haya nada encima (chat, panel, recorrido, su computadora).
  const ventana = useVentanaDecision({
    trabajos,
    activa: mesaVisible && !tutorialAbierto && !panelTrabajos && !masAbierto && !pcAbierta && !pcVivoAbierta && !eligiendo && !visor && !hojaCerebro && !preguntasAbiertas,
    idioma: idiomaActual() === 'en' ? 'en' : 'es',
    conversando: () => conversandoRef.current,
    hablando: () => speakingRef.current,
    decir: (texto) => void say(texto, 'IDLE'),
    mandarTurno: (texto) => mandarTurnoRef.current(texto),
    pc: pcEstado?.actual ? { id: pcEstado.actual.id, estado: pcEstado.actual.estado, instruccion: pcEstado.actual.instruccion, pasos: pcEstado.actual.pasos } : null,
  });
  // ── fin ventana de decisión ─────────────────────────────────────────────────────────────────────────────────────

  const onObjectsStable = useCallback((labels: string[]) => setObjects(labels), []);

  // Borde derecho: tocar o arrastrar hacia la izquierda abre «Más» (la cara deja libre esa franja).
  const edgePan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderRelease: (_e, g) => {
        if (g.dx < -30 || (Math.abs(g.dx) < 12 && Math.abs(g.dy) < 12)) setMasAbierto(true);
      },
    })
  ).current;

  const dotColorNativo =
    status === 'muted' ? T.aviso : status === 'reconnect' || status === 'thinking' ? avatarPorId(avatar || 'aura').tema.acento : status === 'offline' ? T.texto3 : T.activo;
  /*
   * ¿HABLA DE VERDAD? (José, 7-oct, SM-S942B: «empieza a mover la boca antes de que salga la voz»). La mesa pone la
   * cara de hablar (y `status` «speaking») cuando DECIDE hablar: en `say` antes de pedir el audio, con la emoción del
   * turno mientras el cerebro escribe, y en onAudioStart, que es ANTES de play (por el nativo en streaming, antes
   * incluso de que llegue el primer byte). Lo que se VE habla solo desde que el reproductor confirma que suena hasta
   * que la locución termina o la cortan (avatar3d/sonando.ts `hablando`), o mientras habla el agente de la
   * conversación en vivo. Antes de eso la cara piensa (caraConVoz) y la línea dice «preparando».
   */
  const hablaVoz = audioMesa.hablando || (conversando && estadoConv === 'hablando');
  const caraVista = caraConVoz(face, hablaVoz);
  /*
   * EL PUNTO ÚNICO donde la mesa dice qué está haciendo (el HUD y la cabecera del chat de la mesa).
   * El banco de frases variadas de estado («escuchando», «pensando», «revisando»…) lo arma otra rama
   * (fraseDeEstado(estado, avatar, idioma), en la capa de lógica): cuando llegue, entra AQUÍ y en
   * avatar3d/DockAura.textoEstado, sin copiar el banco.
   */
  // En español llano y corto (auditoría visual del 7-oct, M1): nada de «sin cerebro», «reconectando mic» ni «preparando».
  const statusLabelNativo =
    toolHint ? toolHint :
    status === 'listening'
      ? listening
        ? tr('Escuchando', 'Listening')
        : tr('Abriendo el micrófono…', 'Turning on the mic…')
      : status === 'muted'
        ? tr('Micrófono apagado', 'Mic off')
        : status === 'thinking'
          ? tr('Pensando…', 'Thinking…')
          : status === 'speaking'
            // Antes de que suene la voz, la cara piensa (caraConVoz): la línea dice lo mismo.
            ? !hablaVoz ? tr('Pensando…', 'Thinking…') : face === 'SING' ? tr('Cantando', 'Singing') : tr('Hablando', 'Speaking')
            : status === 'orando'
              ? tr('Orando', 'Praying')
            : status === 'reconnect'
              ? tr('Abriendo el micrófono…', 'Turning on the mic…')
              : status === 'offline'
                ? tr('Micrófono sin permiso', 'No mic permission')
                : tr('Un momento…', 'One moment…');
  /** La conexión, aparte: la mesa sigue oyendo y contesta lo básico mientras vuelve a probar sola. */
  const textoSinConexion = tr('Sin conexión — reintento', 'Offline — retrying');

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
  /*
   * ACOSTADO, a pantalla completa (auditoría del 7-oct, C1): los botones van en un riel a la derecha y el avatar se
   * queda con todo el alto en lo que queda a su izquierda (centrado ahí, no detrás del riel).
   */
  const riel = horizontal && !enCuadro;
  const anchoR = riel ? anchoRiel(ins.right) : 0;
  const cajaCara = enCuadro ? { w: cuadroW, h: cuadroH } : riel ? { w: anchoPantalla - anchoR, h: altoPantalla } : undefined;
  /** Acostado, lo que dice el avatar va abajo junto a «Escríbele…» (no sobre la boca ni la barbilla). */
  const fila = filaRiel(anchoPantalla, ins);
  const burbujaRiel = { left: fila.izquierda + fila.anchoEscribir + 12, right: fila.derecha + 8, bottom: conversando ? altoAbajo + 8 : fila.abajo };
  /** La cámara mirando de verdad (la misma condición con que se monta CamaraVision). */
  const camaraActiva = visionOn && !!camPerm?.granted && mesaActiva && !enLlamada;
  /** «Lo que veo»: con la cámara encendida, un botón para ver lo que mira y lo que reconoce. */
  const botonVista =
    camaraActiva && !vistaCamara && !previaCamara ? (
      <Pressable
        onPress={() => setVistaCamara(true)}
        hitSlop={8}
        style={[styles.verCamara, enCuadro && styles.verCamaraCuadro]}
        accessibilityRole="button"
        accessibilityLabel={tr('Ver lo que veo con la cámara', 'See what the camera sees')}
      >
        <View style={[styles.verCamaraPunto, { backgroundColor: verPersona ? T.activo : T.texto3 }]} />
        <Text style={styles.verCamaraTexto}>{tr('Lo que veo', 'What I see')}</Text>
      </Pressable>
    ) : null;
  /*
   * Dónde va «Lo que veo»: en el lugar del avatar. Con el chat (cuadro), el cuadro entero del avatar; a
   * pantalla completa, debajo del estado y por encima de la barra y del subtítulo en vertical, o un panel
   * grande a la derecha en horizontal. Nunca sobre el chat ni el teclado.
   */
  const marcoVista = enCuadro
    ? horizontal
      ? { left: 0, top: 0, width: cuadroW, height: altoPantalla }
      : { left: 0, top: 0, width: anchoPantalla, height: cuadroH }
    : horizontal
    ? { left: Math.round(anchoPantalla * 0.42), top: 52, width: Math.round(anchoPantalla * 0.58) - anchoR - 8, height: Math.max(140, altoPantalla - 52 - (altoAbajo + 12)) }
    : { left: 12, top: 92, width: anchoPantalla - 24, height: Math.max(160, altoPantalla - 92 - (altoAbajo + 84)) };

  // Qué cara se ve. El Guardián: sus ojos celestes de siempre (la cara clásica). AU-RA: el orbe (o los
  // anillos dorados de Skia si los eligió); si lo elegido falló, lo siguiente: orbe → anillos → clásica.
  const anillosOClasica = skiaFallo ? 'clasica' : 'anillos';
  const vista: 'orbe' | 'anillos' | 'clasica' | null =
    avatarId === 'ojos' ? 'clasica' : cara === null ? null : cara === 'orbe' && conOrbe ? 'orbe' : anillosOClasica;
  const enOrbe = avatarId === 'aura' && vista === 'orbe';
  nivelVisible.current = vista === 'clasica' && !conFotos(avatarId);
  const caraAura =
    vista === 'orbe' ? (
      <OrbeAura
        // Arriba, el estado (y lo que dice la persona); abajo, la barra con su sugerencia: ahí no escribe.
        margen={{ arriba: 56, abajo: altoAbajo + 12 }}
        face={caraVista}
        hablando={hablaVoz}
        frase={fraseOrbe}
        sonidos={settings.sfx}
        speechLevelSource={suscribirNivelVoz}
        onTocar={onTocarOrbe}
        onDeslizar={onDeslizarOrbe}
        onFallo={onFalloOrbe}
      />
    ) : vista === 'anillos' ? (
      <CaraSegura
        face={caraVista}
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
        face={caraVista}
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
        face={caraVista}
        gazeX={gaze.x}
        speechLevelSource={suscribirNivelVoz}
        fotos={avatarId === 'antonio' ? FOTOS_ANTONIO_PIE : undefined}
        nombre={nombreAvatar}
        onTap={() => onTap('face', 0, 0)}
        onLongPress={onLongPress}
      />
    ) : (
      <ClaudioRetrato
        face={caraVista}
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
        face={caraVista}
        emocion={emocion}
        // Habla solo con audio de verdad: el de la mesa o el del agente en la conversación fluida. Sin audio,
        // piensa mientras el turno sigue (o la voz se prepara); si no, la cara decide (escucha, reposo…).
        voz={{ sonando: audioMesa.sonando, agenteHabla: conversando && estadoConv === 'hablando', pensando: status === 'thinking' || audioMesa.preparando }}
        mirada={{ x: gaze.x, y: gaze.y, activa: verPersona && ladoCamara === 'frontal' }}
        fuenteMirada={miradaCam}
        respaldo={fotosCara}
        onTap={() => onTap('face', 0, 0)}
        onLongPress={onLongPress}
        activo={mesaActiva && !tutorialAbierto && !(llamadaActiva(voz.ciclo) && !voz.llamada.minimizada)}
        senal={senalAtajo}
        conversando={vozOcupa}
        ataque={attack}
        onRafaga={onRafagaVideo}
      />
    ) : (
      fotosCara
    )
  ) : (
    caraAura
  );
  const esClaudio = conFotos(avatarId);
  const acciones = avatarPorId(avatarId).acciones;
  // Calma en la mesa: le oye sin que nadie hable ni piense, sin frase a medias ni nada abierto encima.
  const calmaMesa =
    (status === 'listening' || status === 'muted') && !partial && !dicho && !bubble && !toolHint && !conversando && !propuesta && !masAbierto && !tutorialAbierto && !eligiendo;
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
  /** Escribirle al avatar, a un toque y por el mismo camino que un turno hablado (C4). */
  const escribirMesa = <EscribeleMesa nombreAvatar={de(avatarPorId(avatarId).nombre)} tema={tema} valor={draft} onCambiar={setDraft} onEnviar={sendDraft} entradaRef={entradaEscribir} />;
  /** «Reintentar» en tu mensaje que no llegó: otra vez por el mismo camino (mandarTurno). */
  const reintentar = (texto: string) => {
    setFallido(null);
    mandarTurnoRef.current(texto);
  };
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
    // En la conversación en vivo lo oye el agente (antes iba a la mesa, que está callada en vivo).
    mandarTurnoRef.current(pedido);
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
        // El cursor en «Escríbele…» (o en el chat del modo trabajo). Ya no hay menú viejo: un solo menú, «Más» (M-7).
        return void setTimeout(() => entradaEscribir.current?.focus(), 350);
      case 'camara':
        return menuCamara();
      case 'caras':
        return caras.abrirOpciones();
      case 'voces':
        return voces.abrirOpciones();
      case 'avatar':
        return setEligiendo('menu');
      case 'tutorial':
        // «Qué puedo hacer»: la ventana con el recorrido y las preguntas para conocerle.
        return abrirBienvenida('menu');
      case 'computadora':
        return setPcAbierta(true);
      case 'misiones':
        return setHojaCerebro('misiones');
      case 'circulo':
        return setHojaCerebro('circulo');
      case 'cartera':
        return abrirCartera();
      case 'agenda':
        return setHojaCerebro('agenda');
      case 'recordatorios':
        return setHojaCerebro('recordatorios');
      case 'ajustes':
        // La pantalla de Ajustes entera (voz, oído, memoria, su cara, tema, perfil, permisos y sesión).
        return emitir('accion', { tipo: 'abrir', pantalla: 'ajustes' });
      case 'modo': {
        const n = trabajando ? 'charlar' : 'trabajar';
        setModoMesa(n);
        void saveSettings({ modoMesa: n });
        return;
      }
    }
  };
  /** Se cerró el recorrido (terminado o no): ya lo vio; se vuelve a abrir desde «Más → Qué puedo hacer». */
  const cerrarTutorial = () => {
    setTutorialAbierto(false);
    void loadSettings().then((s0) => saveSettings(conRecorridoVisto(s0, user.correo)));
  };
  /**
   * Al final del recorrido eligió probar algo: lo mismo que su botón o su frase en la mesa. Espera a que
   * el recorrido se cierre y la mesa recupere el oído y la voz (si no, la mesa todavía no puede hablar).
   */
  const probarDesdeRecorrido = (id: PruebaId) => {
    setTimeout(() => {
      switch (id) {
        case 'hablar':
          return void say(tr('Te escucho: dime lo que quieras.', 'I’m listening: tell me anything.'), 'HAPPY', { emocion: 'feliz' });
        case 'camara':
          // Prende la cámara si hace falta, espera la foto y dice lo que ve (whatDoYouSee).
          return void handleCommand('qué ves');
        case 'llamame':
          return toggleConversar();
        case 'recordatorio':
          // Al momento y con un ejemplo, sin esperar al servidor: el oído queda abierto y la frase que
          // diga ya trae el qué y la hora (el servidor lo repite y pide el «sí», como en el recorrido).
          return void say(
            tr('¡Va! Dime qué te recuerdo y a qué hora. Por ejemplo: «recuérdame a las cinco tomar la pastilla».', 'Sure! Tell me what to remind you about and when. For example: “remind me at five to take my pill”.'),
            'HAPPY',
            { emocion: 'feliz' }
          );
        case 'chat':
          return pulse.abrir();
      }
    }, 700);
  };

  // Voz, oído, comentarios, efectos, memoria y su cara se ajustan en Ajustes (José, 2-oct:
  // el menú angosto «se mira mal»): la mesa le publica lo que hay y le presta sus mismas acciones.
  useEffect(() => {
    publicarMesa(
      { avatar: avatarId, sttEngine: settings.sttEngine, proactive: settings.proactive, sfx: settings.sfx, interrumpir: settings.interrumpir, memoria: longMemory.current.length, cara: cara ?? 'orbe' },
      {
        fijarOido: (e) => void changeStt(e),
        alternarComentarios: () => void toggleProactive(),
        alternarEfectos: () => void toggleSfx(),
        alternarInterrumpir: () => void toggleInterrumpir(),
        olvidar: confirmarOlvido,
        fijarCara: cambiarCara,
      }
    );
  });
  useEffect(() => retirarMesa, []);

  return (
    <View
      ref={enCuadro ? undefined : cuerpoRef}
      onLayout={enCuadro ? undefined : medirCuerpo}
      style={[styles.root, !enOrbe && { backgroundColor: esClaudio ? tema.fondo : '#000' }, riel && enOrbe && { backgroundColor: FONDO_ORBE }, enCuadro && { flexDirection: horizontal ? 'row' : 'column' }]}
    >
      {/* La cámara solo con la mesa a la vista, sin llamada y encendida a pedido (apagada por omisión). */}
      <CamaraMesa
        enabled={visionOn && !!camPerm?.granted && mesaActiva && !enLlamada}
        dormido={presence === 'sleep'}
        grabRef={grabFrame}
        onEscena={onEscena}
        onGaze={onGazeCam}
        onObjects={onObjectsStable}
        onVista={onVista}
        observar={settings.proactive}
        vista={previaCamara || vistaCamara}
        marcoVista={marcoVista}
        lado={ladoCamara}
        onVoltear={() => cambiarLado(ladoCamara === 'frontal' ? 'trasera' : 'frontal')}
        onCerrarVista={() => {
          setVistaCamara(false);
          setPreviaCamara(false);
        }}
        seguidor={caras.seguidor}
        caras={caras}
        onMotor={setVisionMotor}
        ocupada={mesaOcupada}
        movida={movidaTelefono}
      />
      {/* Con el chat, el botón de «Lo que veo» va arriba a la izquierda del cuadro del avatar. */}
      {enCuadro ? botonVista : null}
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
            {/* El indicador de tareas va arriba del cuadro del avatar: no tapa la cabecera del chat ni el teclado. */}
            <IndicadorTrabajos texto={trabajos.indicador} resumen={trabajos.resumen} reducido={trabajos.reducido} onAbrir={() => (ventana.abrirDesdeIndicador() ? undefined : setPanelTrabajos(true))} style={styles.trabajosCuadro} />
            {!!preguntaPrimer && <View style={styles.primerCuadro}>{preguntaPrimer}</View>}
          </View>
          <View style={{ flex: 1 }}>
            <ChatMesa
              mensajes={mensajes}
              avatar={avatarId}
              acciones={acciones}
              onAccion={onAccion}
              nombreAvatar={de(avatarPorId(avatarId).nombre)}
              estado={online ? statusLabel : `${statusLabel} · ${textoSinConexion}`}
              progreso={progresoMesa}
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
              fallido={fallido}
              onReintentar={reintentar}
              entradaRef={entradaEscribir}
            />
          </View>
        </>
      ) : riel ? (
        <View style={{ flex: 1, marginRight: anchoR }}>{caraEntrando}</View>
      ) : (
        caraEntrando
      )}

      {!enCuadro && (
        <>
        {/* «Trabajando · 2» / «Necesito una decisión · 1»: arriba a la derecha, frente al estado; nunca abajo con el teclado. */}
        <IndicadorTrabajos texto={trabajos.indicador} resumen={trabajos.resumen} reducido={trabajos.reducido} onAbrir={() => (ventana.abrirDesdeIndicador() ? undefined : setPanelTrabajos(true))} style={[styles.trabajos, riel && { right: anchoR + 8 }]} />
        {/* «Continuar trabajo» (Fase 2): el objetivo abierto más reciente, debajo del estado; no compite con el aviso de su computadora. */}
        {!pcAviso && !tutorialAbierto ? (
          <View pointerEvents="box-none" style={[styles.continuar, riel && { left: Math.max(16, ins.left + 8), right: anchoR + 16 }]}>
            <TarjetaContinuar onAbrir={setObjetivoAbierto} />
          </View>
        ) : null}
        {/* «¿Te sirvió?» del primer resultado: abajo, por encima de la barra y del subtítulo (hasta tres líneas), sin tapar lo que dice la persona arriba. */}
        {!!preguntaPrimer && <View style={[styles.primerFlota, { bottom: altoAbajo + 100 }, riel && { left: Math.max(16, ins.left + 8), right: anchoR + 16 }]}>{preguntaPrimer}</View>}

        {/* El estado y, al lado, «Lo que veo» (en la misma fila: no se encima con lo que dice la persona, debajo). */}
        <View pointerEvents="box-none" style={[styles.hudFila, riel && { left: Math.max(16, ins.left + 8), right: anchoR + 150 }]}>
          <View pointerEvents="none" style={styles.hud}>
            <View style={[styles.hudDot, { backgroundColor: online ? dotColor : T.aviso }]} />
            <View style={styles.hudTextos}>
              {/* El nombre entero (nunca se parte: «AU-/RA») y el estado al lado; si no cabe (letra grande), el estado
                  baja ENTERO al renglón de abajo, sin cortarse. Sin conexión, debajo. */}
              <View style={styles.hudLinea}>
                <Text style={styles.hudNombre} numberOfLines={1} maxFontSizeMultiplier={1.4}>
                  {de(avatarPorId(avatarId).nombre)}
                </Text>
                <Text style={styles.hudText} numberOfLines={2} maxFontSizeMultiplier={1.4}>
                  · {statusLabel}
                  {verPersona ? (visionMotor === 'mlkit' && ladoCamara === 'frontal' ? tr(' · te veo', ' · I see you') : tr(' · alguien', ' · someone')) : ''}
                </Text>
              </View>
              {!online ? (
                <Text style={styles.hudSinConexion} numberOfLines={1} maxFontSizeMultiplier={1.4}>
                  {textoSinConexion}
                </Text>
              ) : null}
            </View>
          </View>
          {botonVista}
        </View>

        {/* Lo que dice la persona: arriba a la derecha, como su lado de un chat (mientras habla, en cursiva;
            ya entendido, unos segundos). Lo del avatar va abajo: nunca se encima uno con otro. */}
        {!!(partial || dicho?.texto) && (
          <View pointerEvents="none" style={[styles.dichoWrap, propuesta && mesaVisible ? { top: 132 } : null, riel && { right: anchoR + 8 }]}>
            <View style={[styles.dichoCard, { borderColor: tema.acentoFondo }]}>
              <Text style={[styles.dichoQuien, { color: tema.acentoTexto }]}>{tr('Tú', 'You')}</Text>
              <Text numberOfLines={3} style={[styles.dichoText, !!partial && styles.dichoParcial]}>
                {partial || dicho?.texto}
              </Text>
            </View>
          </View>
        )}

        {/* Con el orbe no: sus partículas YA son el subtítulo (van por encima de la barra, con su margen); dos
            textos con lo mismo se encimaban (José, 3-oct). Con los otros avatares, la frase abajo. */}
        {!!bubble && !enOrbe && (
          <Animated.View
            pointerEvents="none"
            style={[styles.bubbleFloat, { bottom: altoAbajo + 8 }, !horizontal && styles.bubbleVertical, riel && burbujaRiel, { opacity: bubbleOp }]}
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
          chatSinLeer={chatSinLeer}
          onMas={() => setMasAbierto(true)}
          onTerminar={toggleConversar}
          // Una sugerencia de su oficio a la vez, solo con calma (José, 3-oct: nada de montón de botones).
          // «Llámame» y lo demás siguen en Más.
          encima={<SugerenciaMesa acciones={acciones} tema={tema} calma={calmaMesa && !draft} onAccion={onAccion} />}
          escribir={escribirMesa}
          riel={riel}
          onAlto={setAltoAbajo}
        />

        {/* El borde derecho (en vertical): acostado ahí va el riel con «Más». No llega a lo de abajo. */}
        {!riel ? (
          <View style={[styles.edgeZone, { bottom: altoAbajo + 16 }]} {...edgePan.panHandlers}>
            <View pointerEvents="none" style={[styles.edgeHint, { backgroundColor: tema.acentoFondo }]} />
          </View>
        ) : null}
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
        estadoVoces={voces.estadoTexto}
        trabajando={trabajando}
        conChat={enCuadro}
        estadoComputadora={pcEstado?.configurada ? estadoEnPalabras(pcEstado, idiomaActual() === 'en' ? 'en' : 'es').texto : null}
        computadoraTrabajando={pcTrabajando(pcEstado?.actual?.estado)}
        // Lo del avatar que vivía en el menú viejo de la derecha (M-7): un solo menú, «Más».
        extra={
          <MasDelAvatar
            visible={masAbierto}
            avatar={avatarId}
            online={online}
            mode={mode}
            presence={presence}
            canciones={canciones}
            caraClasica={vista === 'clasica'}
            conOrbe={enOrbe}
            catalogRequest={catalogRequest}
            onCommand={(t) => {
              setMasAbierto(false);
              mandarTurnoRef.current(t);
            }}
            onSetMode={(m) => {
              setMasAbierto(false);
              if (m === 'CONOCER') void startConocer(false);
              else mandarTurnoRef.current(`modo ${m.toLowerCase()}`);
            }}
            onSetPresence={(p) => {
              setMasAbierto(false);
              setPresenceUI(p);
            }}
            onConocer={() => {
              setMasAbierto(false);
              void startConocer(false);
            }}
            onBlaster={() => {
              setMasAbierto(false);
              void fireBlaster(tr('¡Blaster listo! Pium, pium, pium.', 'Blaster ready! Pew, pew, pew.'));
            }}
            onSaber={() => {
              setMasAbierto(false);
              void fireSaber();
            }}
            onSingSong={(id) => {
              setMasAbierto(false);
              const c = canciones.find((s) => s.id === id);
              mandarTurnoRef.current(c?.pedir || `canta ${id}`);
            }}
            onSingGenre={(g) => {
              setMasAbierto(false);
              mandarTurnoRef.current(`canta ${g}`);
            }}
            onOrar={() => {
              setMasAbierto(false);
              mandarTurnoRef.current('ora por el día');
            }}
            onRemember={(f) => mandarTurnoRef.current(`recuerda que ${f}`)}
            onSearch={(q) => {
              setMasAbierto(false);
              mandarTurnoRef.current(`busca ${q}`);
            }}
            onProbarVoz={probarVoz}
          />
        }
      />

      <HojaComputadora visible={pcAbierta} onCerrar={() => setPcAbierta(false)} nombreAvatar={de(avatarPorId(avatarId).nombre)} />
      <ConsentimientoBiometria correo={user.correo} />

      <PanelTrabajos
        visible={panelTrabajos}
        onCerrar={() => setPanelTrabajos(false)}
        tareas={trabajos.tareas}
        aviso={trabajos.aviso}
        reducido={trabajos.reducido}
        idioma={idioma === 'en' ? 'en' : 'es'}
        onTarea={trabajos.aplicar}
        onRefrescar={() => void trabajos.refrescar()}
        onEditar={(sugerencia) => {
          // «Editar»: el texto propuesto queda en el campo de escribir; lo manda la persona (nada sale solo).
          setPanelTrabajos(false);
          setDraft(sugerencia);
          setTimeout(() => entradaEscribir.current?.focus(), 350);
        }}
        // Editar el texto en la ventana de decisión (José, 5-oct): se cierra el panel y la ventana lo abre listo.
        onEditarAqui={(t) => {
          const tomada = ventana.abrirParaEditar(t.id);
          if (tomada) setPanelTrabajos(false);
          return tomada;
        }}
        onAbrirComputadora={() => {
          setPanelTrabajos(false);
          setPcAbierta(true);
        }}
      />

      {/* La hoja del objetivo (Fase 2): meta, criterios, documentos, decisiones y eventos; cerrarla no cancela nada. */}
      <HojaObjetivo id={objetivoAbierto} onCerrar={() => setObjetivoAbierto(null)} />

      {/* La ventana de decisión (José, 5-oct): Sí · No · Editar, también por voz; cerrarla es «Luego». */}
      <VentanaDecision v={ventana} nombreAvatar={de(avatarPorId(avatarId).nombre)} />

      {/* Su computadora trabaja (o acaba de terminar): se dice arriba, con «Ver». */}
      {pcAviso && !pcAbierta && !pcVivoAbierta && !tutorialAbierto ? (
        <Pressable
          onPress={() => {
            // HojaComputadora abre la vista en vivo de toda la app (o la suya, sin la raíz).
            setPcAbierta(true);
            if (pcAviso.terminada) setPcAviso(null);
          }}
          accessibilityRole="button"
          accessibilityLabel={pcAviso.texto}
          hitSlop={6}
          style={[styles.avisoPc, { borderColor: tema.acento }]}
        >
          <Text style={styles.avisoPcTexto} numberOfLines={1}>
            🖥 {pcAviso.texto}
          </Text>
          <Text style={[styles.avisoPcVer, { color: tema.acento }]}>{tr('Ver', 'See')}</Text>
        </Pressable>
      ) : null}

      {/* Lo que AURA propone por su cuenta: arriba (debajo del aviso de su computadora), sin tapar al avatar.
          En una conversación de voz se queda a la vista, sin sonar: no interrumpe. */}
      {propuesta && mesaVisible && !tutorialAbierto && !eligiendo && !masAbierto ? (
        <TarjetaPropuesta
          propuesta={propuesta}
          nombreAvatar={de(avatarPorId(avatarId).nombre)}
          tema={tema}
          idioma={idiomaActual() === 'en' ? 'en' : 'es'}
          onResponder={responderPropuesta}
          arriba={pcAviso && !pcAbierta && !pcVivoAbierta ? 100 : 54}
        />
      ) : null}

      <HojaCerebro cual={hojaCerebro} onCerrar={() => setHojaCerebro(null)} />

      {visor ? <VisorCamara estado={visor} onCerrar={cerrarVisor} /> : null}

      <RecorridoApp visible={tutorialAbierto} nombre={user.name} idioma={idioma} onCerrar={cerrarTutorial} onProbar={probarDesdeRecorrido} />

      {/* La ventana de bienvenida: ofrece el recorrido y las preguntas para conocerle (bienvenida/). */}
      <VentanaBienvenida correo={user.correo} nombre={user.name} onRecorrido={() => setTutorialAbierto(true)} onHablando={() => void startConocer(false)} onTapa={setPreguntasAbiertas} />

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

/** Buenos días / tardes / noches según la hora del teléfono (su zona horaria; antes, UTC−6 fijo). */
function saludoPorHora(ahora = new Date()): string {
  const h = ahora.getHours();
  return h < 12 ? tr('Buenos días', 'Good morning') : h < 19 ? tr('Buenas tardes', 'Good afternoon') : tr('Buenas noches', 'Good evening');
}

const styles = StyleSheet.create({
  avisoPc: {
    position: 'absolute',
    top: 54,
    alignSelf: 'center',
    maxWidth: '92%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 40,
    borderRadius: 999,
    borderWidth: 1.5,
    backgroundColor: 'rgba(18,19,22,0.92)',
    zIndex: 40,
    elevation: 8,
  },
  avisoPcTexto: { color: '#F2EEE8', fontSize: 13.5, fontWeight: '700', flexShrink: 1 },
  avisoPcVer: { fontSize: 13.5, fontWeight: '900' },
  root: { flex: 1, backgroundColor: T.fondo2 },
  // El indicador de tareas (AUR08): arriba a la derecha, a la altura del estado; el cuadro del chat lo lleva dentro.
  trabajos: { position: 'absolute', top: 12, right: 16, zIndex: 35 },
  trabajosCuadro: { position: 'absolute', top: 10, right: 10, zIndex: 35 },
  // «Continuar trabajo»: debajo de la fila del estado y del indicador de tareas (top 12 + 40 de alto + aire).
  continuar: { position: 'absolute', top: 62, left: 16, right: 16, alignItems: 'center', zIndex: 34 },
  primerCuadro: { position: 'absolute', bottom: 10, left: 10, right: 10, alignItems: 'center', zIndex: 36 },
  primerFlota: { position: 'absolute', left: 16, right: 16, alignItems: 'center', zIndex: 36 },
  cuadro: { overflow: 'hidden', backgroundColor: '#000', position: 'relative' },
  hudFila: { position: 'absolute', top: 12, left: 16, right: 140, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  hud: {
    flexShrink: 1,
    minWidth: 0,
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
  // «Lo que veo»: al lado del estado (o arriba a la izquierda del cuadro del avatar), lejos de la barra y del teclado.
  verCamara: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: 'rgba(18,19,22,0.82)',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    // Con el hitSlop de 8 por lado, el dedo tiene más de 48 dp.
    minHeight: 36,
    zIndex: 38,
    elevation: 12,
  },
  verCamaraCuadro: { position: 'absolute', top: 10, left: 10 },
  verCamaraPunto: { width: 8, height: 8, borderRadius: 4 },
  verCamaraTexto: { color: '#F2EEE8', fontSize: 13, fontWeight: '800' },
  hudTextos: { flexShrink: 1, minWidth: 0 },
  hudLinea: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 5 },
  hudText: { color: T.texto2, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  hudNombre: { color: T.texto, fontSize: 13, fontWeight: '800', flexShrink: 0 },
  hudSinConexion: { color: T.aviso, fontSize: 12, fontWeight: '700' },
  bubbleFloat: { position: 'absolute', left: 90, right: 90, alignItems: 'center' },
  bubbleVertical: { left: 16, right: 16 },
  bubbleCard: { backgroundColor: T.panel, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, maxWidth: 520, ...SOMBRA },
  bubbleText: { color: T.texto, fontSize: 16, lineHeight: 22, textAlign: 'center' },
  // Lo que dice la persona: arriba a la derecha, debajo del estado.
  dichoWrap: { position: 'absolute', top: 54, right: 14, left: 64, alignItems: 'flex-end', zIndex: 30 },
  dichoCard: { maxWidth: 420, backgroundColor: 'rgba(28,29,32,0.86)', borderRadius: 16, borderTopRightRadius: 4, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7 },
  dichoQuien: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4, marginBottom: 1, textAlign: 'right' },
  dichoText: { color: T.texto, fontSize: 14.5, lineHeight: 19, textAlign: 'right' },
  dichoParcial: { color: T.texto2, fontStyle: 'italic' },
  // El borde derecho abre el menú; no llega a la barra (ahí está «Más»).
  edgeZone: { position: 'absolute', right: 0, top: 0, width: 44, justifyContent: 'center', alignItems: 'flex-end' },
  edgeHint: { width: 5, height: 84, borderTopLeftRadius: 4, borderBottomLeftRadius: 4, backgroundColor: 'rgba(214,181,108,0.35)' },
});
