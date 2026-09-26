import { useCallback, useEffect, useRef, useState } from 'react';
import { miga, reportarEstado } from '../lib/reporte';
import { Alert, Animated, BackHandler, Linking, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Accelerometer } from 'expo-sensors';
import { UltronFace, type TouchZone } from '../components/UltronFace';
import { SalaAura, type PedidoTarea } from '../components/SalaAura';
import { CaraSegura } from '../cara/CaraSegura';
import { TAREA_TEXTO, tareaDeHerramientas, type Postura, type Tarea } from '../lib/tareas';
import { T, SOMBRA } from '../tema';
import { CamaraVision, DORMIDO_PERIODO_MS, SERVIDOR_CADA_MS, SERVIDOR_DORMIDO_MS, type FrameGrabber } from '../components/CamaraVision';
import { DeskMenu } from '../components/DeskMenu';
import type { Escena, MotorVision } from '../lib/escena';
import type { DeskPresence, FaceState, Mode, SessionUser } from '../config';
import { CANCIONES_LOCAL, healthCheck, listCanciones, rememberFact, turno, turnoStream, type Cancion, type Turn } from '../lib/api';
import { faceForEmocion, type Emocion } from '../lib/emocion';
import { GENEROS, generoPorId, interpretar, type Gag } from '../lib/intenciones';
import { AYUDA, CONOCER_CORE, CONOCER_QUESTIONS, fechaLocal, horaLocal } from '../lib/knowledge';
import LINES from '../../voice-lines.json';
import {
  currentSttEngine,
  destroySpeech,
  enableAlwaysOnMic,
  ensureSpeechPermissions,
  micWatchdogOk,
  muteMic,
  pauseMicForTts,
  restartMic,
  setSpeechCallbacks,
  setSttEngine,
  unmuteMic,
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
import { StreamSpeaker, setSpeechLevelListener, speak, speakClip, speakPrayer, speakSong, stopSpeaking, type SongRequest } from '../lib/tts';
import { CLIP_TEXT, type ClipId } from '../lib/voiceBank';

type Props = {
  user: SessionUser;
  onLogout: () => void;
};

const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

/** Un permiso negado: Android ya no vuelve a preguntar, así que se ofrece ir a los ajustes. */
function pedirEnAjustes(titulo: string, texto: string) {
  Alert.alert(titulo, texto, [
    { text: 'Ahora no', style: 'cancel' },
    { text: 'Abrir ajustes', onPress: () => void Linking.openSettings().catch(() => {}) },
  ]);
}

function greetingFor(name: string) {
  const h = new Date().getHours();
  const part = h < 12 ? LINES.greetingParts[0] : h < 19 ? LINES.greetingParts[1] : LINES.greetingParts[2];
  return LINES.greetingTemplate.replace('{part}', part).replace('{name}', name);
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

/** Gag → clip corto de emoción del servidor (se toca antes de las líneas, sin fallback a TTS). */
const GAG_CLIP: Record<string, ClipId> = { sad: 'triste', angry: 'molesto', startle: 'sorpresa', yawn: 'cansado', proud: 'orgullo', laugh: 'risa1' };

const haptic = (kind: 'light' | 'medium' = 'light') =>
  Haptics.impactAsync(kind === 'light' ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

export function DeskScreen({ user, onLogout }: Props) {
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
  const [visionOn, setVisionOn] = useState(true);
  const [gaze, setGaze] = useState({ x: 0, y: 0 });
  const [objects, setObjects] = useState<string[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  // La mesa no se apaga sola: si la pantalla se bloquea, deja de escuchar y de verte.
  useKeepAwake('mesa');
  // Botón atrás de Android: cierra el menú; con el menú cerrado hace lo de siempre.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!menuOpen) return false;
      setMenuOpen(false);
      return true;
    });
    return () => sub.remove();
  }, [menuOpen]);
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
  const chisteIdx = useRef(0);
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
  const idleStatus = useCallback(() => setStatus(micMutedRef.current ? 'muted' : 'listening'), []);

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
    return escenaFresca(e) ? e.descripcion : undefined;
  }, [escenaFresca]);

  const showBubble = useCallback(
    (text: string) => {
      setBubble(text);
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
    historial.current = [...historial.current, { rol: 'ultron' as const, texto: text }].slice(-12);
  }, []);

  /** Fin de cualquier audio: mic de vuelta, cara en reposo, HUD según mute real (ref, no closure). */
  const settle = useCallback(() => {
    speakingRef.current = false;
    pauseMicForTts(false);
    setFace(restFace());
    idleStatus();
  }, [idleStatus, restFace]);

  const onAudio = useCallback((f: FaceState) => {
    pauseMicForTts(true);
    speakingRef.current = true;
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
      logUltron(text);
      speakingRef.current = true;
      setFace(f);
      setStatus('speaking');
      // risa: una carcajada corta del banco antes del texto (si el clip no está, se sigue sin ella)
      if (emocion === 'risa') await speakClip(pick(['risa1', 'risa2'] as const), { fallback: false, onAudioStart: () => onAudio('LAUGH') });
      await speak(text, {
        performance,
        emocion,
        onAudioStart: () => onAudio(f === 'IDLE' || f === 'LISTENING' ? 'SPEAKING' : f),
        onEnd: settle,
      });
    },
    [logUltron, onAudio, settle, showBubble]
  );

  /** Clip del banco por id. Si el servidor no lo sirve: `fallback` (texto) o nada. */
  const playClip = useCallback(
    async (id: ClipId, f: FaceState, opts?: { fallbackText?: string | null; emocion?: Emocion }) => {
      if (opts?.fallbackText !== null) showBubble(opts?.fallbackText ?? CLIP_TEXT[id]);
      speakingRef.current = true;
      setFace(f);
      setStatus('speaking');
      const ok = await speakClip(id, { fallback: false, onAudioStart: () => onAudio(f), onEnd: settle });
      if (!ok && opts?.fallbackText) await say(opts.fallbackText, f, { emocion: opts.emocion });
      return ok;
    },
    [onAudio, say, settle, showBubble]
  );

  /**
   * «Olvidar» (menú o voz): borra la memoria de largo plazo de quien está en la mesa, no la de los
   * demás. Es irreversible, así que antes se pregunta.
   */
  const confirmarOlvido = useCallback(() => {
    Alert.alert('¿Olvidar lo que recuerdo de ti?', `Se borran los hechos que guardé en este teléfono para ${user.name}. No se puede deshacer.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Olvidar',
        style: 'destructive',
        onPress: () =>
          void (async () => {
            await clearLongMemory(user);
            longMemory.current = [];
            await say('Memoria de largo plazo borrada.', 'CONCERNED', { emocion: 'preocupado' });
          })(),
      },
    ]);
  }, [say, user]);

  /** AU-RA canta: POST /api/cantar. Cara SING, mic pausado, sin rellenos. */
  const sing = useCallback(
    async (req: SongRequest, titulo: string) => {
      showBubble(`♪ ${titulo}`);
      logUltron(`(canta ${titulo})`);
      speakingRef.current = true;
      setFace('SING');
      setStatus('speaking');
      setToolHint('afinando');
      const ok = await speakSong(req, {
        onPreparing: () => setToolHint('preparando la canción'),
        onAudioStart: () => {
          setToolHint('');
          onAudio('SING');
        },
        onEnd: settle,
      });
      setToolHint('');
      if (!ok) await say('No pude cantar esa ahora. Prueba con «canta 1» o «canta salsa».', 'CONCERNED', { emocion: 'preocupado' });
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
        onPreparing: () => setToolHint('preparando la oración'),
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
      if (!ok) await say('No pude traer la oración ahora. Inténtalo en un momento.', 'CONCERNED', { emocion: 'preocupado' });
    },
    [logUltron, say, settle, showBubble]
  );

  const startConocer = useCallback(
    async (mas: boolean) => {
      const progress = await loadConocerProgress(user.correo);
      if (progress.completedCore && !mas) {
        await say('Ya completamos las diez preguntas principales. Si quieres, di «conocer más».', 'HAPPY', { emocion: 'feliz' });
        return;
      }
      const next = CONOCER_QUESTIONS.findIndex((q) => !progress.answeredIds.includes(q.id));
      if (next < 0) {
        await say('Ya respondiste todo lo que tenía para preguntarte. Gracias.', 'HAPPY', { emocion: 'carino' });
        return;
      }
      setMode('CONOCER');
      modeRef.current = 'CONOCER';
      conocerIdxRef.current = next;
      await say(
        `${mas ? 'Sigamos conociéndonos.' : `Quiero conocerte. Son ${CONOCER_CORE} preguntas cortas; di «luego» y lo dejamos.`} ${CONOCER_QUESTIONS[next].prompt}`,
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
    await say('Sable de luz, listo. Que Orden Global te acompañe.', 'ANGRY', { emocion: 'travieso' });
    setAttack(null);
  }, [say]);

  const askBrain = useCallback(
    async (cmd: string, opts?: { image?: string }) => {
      setFace('THINKING');
      setStatus('thinking');
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
      };
      let emocion: Emocion = 'neutral';
      let reacted = false;
      // Un solo relleno, local y sin red: «mmm» del banco si el cerebro tarda (inmediato con imagen).
      const mmm = () => void speakClip('mmm', { fallback: false, onAudioStart: () => pauseMicForTts(true), onEnd: () => !speakingRef.current && pauseMicForTts(false) });
      let mmmTimer: ReturnType<typeof setTimeout> | null = opts?.image ? (mmm(), null) : setTimeout(mmm, 700);
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
                cancelMmm();
                setFace(faceForEmocion(e));
                speaker?.setEmocion(e);
                if (e === 'risa') void speakClip(pick(['risa1', 'risa2'] as const), { fallback: false, onAudioStart: () => onAudio('LAUGH') });
              },
              onDelta: (piece) => {
                cancelMmm();
                if (!speaker) {
                  speaker = new StreamSpeaker({
                    emocion,
                    onAudioStart: () => onAudio(faceForEmocion(emocion)),
                    onSentence: (sentence) => showBubble(sentence),
                  });
                }
                speaker.push(piece);
              },
              onTools: (tools) => {
                const t = tareaDeHerramientas(tools);
                if (t) {
                  hacerTarea(t);
                  setToolHint(TAREA_TEXTO[t]);
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
            if (speaker) {
              (speaker as StreamSpeaker).end();
              await (speaker as StreamSpeaker).done;
            }
            setToolHint('');
            if (result.reply) {
              setOnline(true);
              logUltron(result.reply);
              const spoke = (speaker as StreamSpeaker | null)?.hasSpoken;
              if (!spoke) await say(result.reply, faceForEmocion(result.emocion), { emocion: result.emocion });
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
              await say('Se me fue el hilo pensando eso. ¿Me lo repites?', 'CONFUSED', { emocion: 'preocupado' });
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
        if (failed(out)) {
          const auth = /sesión|privado|401/i.test(String(out.error || ''));
          if (auth) {
            setOnline(true);
            await say('Se me cerró la sesión de la mesa. Entra de nuevo y te oigo.', 'CONCERNED', { emocion: 'preocupado' });
            Alert.alert('Sesión cerrada', 'Tu sesión de la mesa se cerró. Entra de nuevo para seguir.', [
              { text: 'Luego', style: 'cancel' },
              { text: 'Entrar', onPress: onLogout },
            ]);
            return;
          }
          setOnline(false);
          await say('No alcanzo al cerebro remoto ahora. Sigo contigo con lo básico.', 'CONFUSED', { emocion: 'preocupado' });
          return;
        }
        setOnline(true);
        applyMode(out.mode);
        await say(out.reply, faceForEmocion(out.emocion), { emocion: out.emocion });
      } finally {
        cancelMmm();
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
      await askBrain('Mira la cámara y dime en dos frases qué ves: quién está, qué hace y qué objetos hay.', { image: `data:image/jpeg;base64,${frame}` });
      return;
    }
    // Sin frame: lo que la detección local ya sabe (persona, lado, gesto) y las etiquetas del servidor.
    const e = escenaRef.current;
    const objs = objectsRef.current;
    if (escenaFresca(e)) {
      const mesa = objs.filter((l) => !/persona|rostro|cara|hombre|mujer|niñ|gente|face|person/.test(l));
      await say(`${e.descripcion}${mesa.length ? ` En la mesa: ${mesa.join(', ')}.` : ''}`, 'SCAN');
      return;
    }
    await say(objs.length ? `Veo: ${objs.join(', ')}.` : 'Aún no identifico nada. Dame un momento con la cámara.', 'SCAN');
  }, [askBrain, escenaFresca, say]);

  const runGag = useCallback(
    async (gag: Gag) => {
      const emocion = GAG_EMOCION[gag.id] || 'neutral';
      setFace(gag.face);
      const clip = GAG_CLIP[gag.id];
      if (clip) await speakClip(clip, { fallback: false, onAudioStart: () => onAudio(gag.face) });
      for (const line of gag.lines) {
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
      await say(`Anotado. ${CONOCER_QUESTIONS[next].prompt}`, 'CURIOUS', { emocion: 'curioso' });
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

      const enConocer = modeRef.current === 'CONOCER' && conocerIdxRef.current >= 0 && conocerIdxRef.current < CONOCER_QUESTIONS.length;
      const intent = interpretar(cmd, { dormido: presenceRef.current === 'sleep', enConocer });

      try {
        if (presenceRef.current === 'sleep') {
          setPresence('stay');
          presenceRef.current = 'stay';
          if (intent.tipo === 'despertar') return void (await say('Despierto. Te escucho.', 'HAPPY', { emocion: 'feliz' }));
        }
        // En la entrevista todo es respuesta salvo salir / callar / dormir / menú / sesión.
        if (enConocer && !['conocer_salir', 'callar', 'dormir', 'logout', 'menu', 'catalogo'].includes(intent.tipo)) return void (await answerConocer(cmd));

        switch (intent.tipo) {
          case 'despertar':
            return void (await say('Aquí estoy.', 'HAPPY', { emocion: 'feliz' }));
          case 'dormir':
            setPresence('sleep');
            presenceRef.current = 'sleep';
            return void (await say('Descanso un momento. Háblame o tócame para despertar.', 'SLEEPING', { emocion: 'cansado' }));
          case 'callar':
            await stopSpeaking();
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
            return void (await playClip('listo', 'IDLE', { fallbackText: 'Aquí tienes todo lo que puedo hacer.' }));
          case 'conocer':
            return void (await startConocer(intent.mas));
          case 'conocer_salir':
            return void (await exitConocer());
          case 'logout':
            await say('Hasta pronto.', 'IDLE', { emocion: 'carino' });
            return onLogout();
          case 'recordar': {
            hacerTarea('anotar');
            const line = `${user.name}: ${intent.hecho}`;
            if (longMemory.current.includes(line)) return void (await say('Eso ya lo tenía en memoria.', 'HAPPY'));
            const remoto = rememberFact(line, user.name);
            longMemory.current = (await addLongFact(user, line)).map((f) => f.hecho);
            const ok = await remoto;
            return void (await say(ok ? 'Anotado. Lo recuerdo.' : 'Anotado aquí en la mesa; al servidor se lo paso cuando haya sesión.', 'HAPPY', { emocion: 'feliz' }));
          }
          case 'olvidar':
            // Borrar es irreversible y la voz se puede oír mal: se confirma en la pantalla.
            confirmarOlvido();
            return void (await say('Para borrar lo que recuerdo de ti, confírmalo en la pantalla.', 'CONCERNED', { emocion: 'preocupado' }));
          case 'que_recuerdas': {
            const mine = longMemory.current.filter((f) => f.startsWith(user.name)).slice(0, 4).map((f) => f.replace(/^[^:]+:\s*/, ''));
            if (mine.length) return void (await say(`Recuerdo: ${mine.join('. ')}.`, 'HAPPY', { emocion: 'feliz' }));
            return void (await askBrain(cmd));
          }
          case 'vision_on': {
            if (!camPerm?.granted) {
              const res = await requestCam();
              if (!res.granted) return void (await say('Necesito permiso de cámara para mirarte.', 'CONCERNED', { emocion: 'preocupado' }));
            }
            setVisionOn(true);
            return void (await say('Visión activa. Te estoy mirando.', 'SCAN'));
          }
          case 'que_ves':
            return void (await whatDoYouSee());
          case 'blaster':
            return void (await fireBlaster('¡Blaster listo! Pium, pium, pium.'));
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
          case 'chiste': {
            chisteIdx.current = (chisteIdx.current % 5) + 1;
            const ok = await playClip(`chiste${chisteIdx.current}` as ClipId, 'HAPPY', { fallbackText: null });
            if (!ok) await askBrain('Cuéntame un chiste corto y bueno.');
            return;
          }
          case 'clip': {
            if (intent.id === 'puedo') {
              setMenuOpen(true);
              setCatalogRequest((n) => n + 1);
            }
            const ok = await playClip(intent.id, 'HAPPY', { fallbackText: null });
            if (!ok) await askBrain(cmd);
            return;
          }
          case 'saludo':
            return void (await playClip('hola', 'HAPPY', { fallbackText: `Hola, ${user.name}. Aquí estoy.`, emocion: 'feliz' }));
          case 'gracias':
            return void (await say(`De nada, ${user.name}.`, 'HAPPY', { emocion: 'carino' }));
          case 'gag':
            return void (await runGag(intent.gag));
          case 'hora':
            return void (await say(horaLocal(), 'IDLE'));
          case 'fecha':
            return void (await say(fechaLocal(), 'IDLE'));
          case 'ayuda':
            return void (await say(AYUDA, 'HAPPY', { emocion: 'feliz' }));
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
    [answerConocer, askBrain, camPerm?.granted, canciones, confirmarOlvido, exitConocer, fireBlaster, fireSaber, hacerTarea, idleStatus, onLogout, playClip, pray, requestCam, runGag, say, settle, sing, startConocer, user, whatDoYouSee]
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
    void playClip('despertar', 'STARTLE', { fallbackText: 'Ya despierto.', emocion: 'sorpresa' });
  }, [playClip]);

  /** Toques seguidos: «ya, ya» — molesto 1,2 s y luego se ríe. */
  const yaYa = useCallback(async () => {
    handling.current = true;
    try {
      playSfx('tap');
      void haptic('medium');
      setFace('ANGRY');
      const t = setTimeout(() => setFace('LAUGH'), 1200);
      showBubble('Ya, ya.');
      speakingRef.current = true;
      setStatus('speaking');
      const ok = await speakClip('yaya', { fallback: false, onAudioStart: () => onAudio('ANGRY'), onEnd: () => {} });
      if (!ok) await speak('Ya, ya.', { emocion: 'molesto', onAudioStart: () => pauseMicForTts(true) });
      clearTimeout(t);
      setFace('LAUGH');
      playSfx('giggle');
      await speakClip(pick(['risa1', 'risa2'] as const), { fallback: false });
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
        void fireBlaster(pick(LINES.angry)).finally(() => {
          handling.current = false;
        });
        return;
      }
      if (sinceLast < 380 && zone !== 'eyeL' && zone !== 'eyeR') {
        playSfx('wink');
        setFace('WINK');
        void say(pick(LINES.double), 'WINK', { emocion: 'travieso' });
        return;
      }
      switch (zone) {
        case 'eyeL':
        case 'eyeR':
          playSfx('wink');
          setWinkSide(zone === 'eyeL' ? 'L' : 'R');
          setFace('WINK');
          if (tapCount.current % 2) void say(pick(LINES.eye), 'WINK', { emocion: 'travieso' });
          else setTimeout(() => setFace(restFace()), 900);
          return;
        case 'forehead':
          playSfx('tap');
          setFace('CURIOUS');
          if (tapCount.current % 2) void say(pick(LINES.forehead), 'CURIOUS', { emocion: 'curioso' });
          else setTimeout(() => setFace(restFace()), 1500);
          return;
        case 'chin':
          playSfx('giggle');
          setFace('LAUGH');
          void say(pick(LINES.tickle), 'LAUGH', { emocion: 'risa' });
          return;
        case 'mouth':
          playSfx('giggle');
          setFace('HAPPY');
          void say(pick(LINES.mouth), 'HAPPY', { emocion: 'travieso' });
          return;
        case 'cheek':
          playSfx('tap');
          void playClip('je', 'HAPPY');
          return;
        default:
          playSfx('tap');
          setFace(tapCount.current % 2 ? 'WINK' : 'HAPPY');
          if (tapCount.current % 3 === 1) void playClip('aqui', 'HAPPY', { fallbackText: pick(LINES.tap), emocion: 'feliz' });
          else setTimeout(() => setFace(restFace()), 700);
      }
    },
    [fireBlaster, pausarMirada, playClip, restFace, say, wakeUp, yaYa]
  );

  /** Frotar la mejilla: ronroneo, baja el enojo. */
  const onRub = useCallback(() => {
    irritationRef.current = 0;
    setIrritation(0);
    playSfx('purr');
    void haptic('light');
    setFace('HAPPY');
    if (speakingRef.current || handling.current) return;
    void say(pick(LINES.love), 'HAPPY', { emocion: 'carino' });
  }, [say]);

  /** Mantener pulsado: duerme / despierta. */
  const onLongPress = useCallback(() => {
    void haptic('medium');
    if (presenceRef.current === 'sleep') return wakeUp();
    if (speakingRef.current || handling.current) return;
    setPresence('sleep');
    presenceRef.current = 'sleep';
    void say('Descanso un momento. Háblame o tócame para despertar.', 'SLEEPING', { emocion: 'cansado' });
  }, [say, wakeUp]);

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
    const id = setInterval(() => {
      if (irritationRef.current > 0) {
        irritationRef.current = Math.max(0, irritationRef.current - 0.06);
        setIrritation(irritationRef.current);
      }
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // ---------- Sacudida ----------
  useEffect(() => {
    let last = 0;
    let lastShakeAt = 0;
    Accelerometer.setUpdateInterval(90);
    const sub = Accelerometer.addListener(({ x, y, z }) => {
      const g = Math.sqrt(x * x + y * y + z * z);
      const jerk = Math.abs(g - last);
      last = g;
      if (jerk > 1.6 && Date.now() - lastShakeAt > 4000 && !speakingRef.current && !handling.current) {
        lastShakeAt = Date.now();
        setFace('SURPRISED');
        playSfx('tap');
        void say(pick(LINES.shake), 'SURPRISED', { emocion: 'sorpresa' });
      }
    });
    return () => sub.remove();
  }, [say]);

  // ---------- Voz ----------
  const onSpeechFinal = useCallback((text: string) => void handleCommand(text), [handleCommand]);

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
      setVisionOn(s.visionEnabled);
      setSettings({ sttEngine: s.sttEngine, proactive: s.proactive, sfx: s.sfx });
      setPostura(s.postura === 'sentada' ? 'sentada' : 'pie');
      setCara(s.cara === 'sala' ? 'sala' : 'anillos');
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
        setStatus('listening');
      } else setStatus(micOk ? 'muted' : 'offline');

      handling.current = true;
      await say(greetingFor(user.name), 'HAPPY', { emocion: 'feliz' });
      handling.current = false;

      if (s.visionEnabled && camPerm && !camPerm.granted && camPerm.canAskAgain !== false) {
        Alert.alert('Cámara', '¿Permitir cámara para mirarte e identificar lo que hay en la mesa?', [
          { text: 'Ahora no', style: 'cancel', onPress: () => setVisionOn(false) },
          { text: 'Permitir', onPress: () => void requestCam() },
        ]);
      }
    })();
    return () => {
      alive = false;
      void destroySpeech();
      void stopSpeaking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Watchdog del micrófono: si el bucle se cuelga, reinicio duro.
  useEffect(() => {
    const id = setInterval(() => {
      if (micMutedRef.current || speakingRef.current) return;
      if (!micWatchdogOk()) {
        setStatus('reconnect');
        void restartMic().then(() => idleStatus());
      }
    }, 3000);
    return () => clearInterval(id);
  }, [idleStatus]);

  // Mirada errante (único generador): se pausa si hay dedo, toque reciente o persona en cámara.
  useEffect(() => {
    let t = 0;
    const id = setInterval(() => {
      if (dragging.current || touchGazeTimer.current || Date.now() - personSeenAt.current < 5000) return;
      t += 0.25;
      setGaze({ x: Math.sin(t * 0.3) * 0.15, y: Math.cos(t * 0.19) * 0.1 });
    }, 500);
    return () => clearInterval(id);
  }, []);

  // Comentario proactivo: si la escena cambia y hay calma, el cerebro mira un frame y comenta (máx. 1 cada 2 min).
  const onScene = useCallback(
    (_summary: string, labels: string[]) => {
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
      if (!e.eventos.length) return;
      const calm = !handling.current && !speakingRef.current;
      for (const ev of e.eventos) {
        if (ev === 'llego') {
          const quieto = now - lastUserAt.current > 60_000 && now - lastGreetAt.current > 60_000;
          if (!quieto) continue;
          lastGreetAt.current = now;
          if (presenceRef.current === 'sleep') {
            wakeUp();
          } else if (calm) {
            void playClip(pick(['hola', 'aqui'] as const), 'HAPPY', { fallbackText: `Hola, ${user.name}.`, emocion: 'feliz' });
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
          void say('¿Y quién te acompaña?', 'CURIOUS', { emocion: 'curioso' });
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

  const toggleMute = async () => {
    if (!micMutedRef.current) {
      await muteMic();
      micMutedRef.current = true;
      setMicMuted(true);
      setStatus('muted');
      await saveSettings({ micMuted: true });
      await say('Micrófono en silencio.', 'IDLE');
    } else {
      const ok = await ensureSpeechPermissions();
      if (!ok) return pedirEnAjustes('Micrófono', 'Para escucharte necesito el micrófono. Actívalo en los ajustes del teléfono.');
      await unmuteMic();
      micMutedRef.current = false;
      setMicMuted(false);
      setStatus('listening');
      await saveSettings({ micMuted: false });
      await say('Te escucho de nuevo.', 'HAPPY', { emocion: 'feliz' });
    }
  };

  const toggleVision = async () => {
    if (!visionOn) {
      if (!camPerm?.granted) {
        const r = await requestCam();
        if (!r.granted) {
          pedirEnAjustes('Cámara', 'Para verte necesito la cámara. Actívala en los ajustes del teléfono.');
          return;
        }
      }
      setVisionOn(true);
      await saveSettings({ visionEnabled: true });
    } else {
      setVisionOn(false);
      setObjects([]);
      await saveSettings({ visionEnabled: false });
    }
  };

  const setPresenceUI = (p: DeskPresence) => {
    setPresence(p);
    presenceRef.current = p;
    if (p === 'sleep') void say('Descanso un momento. Háblame o tócame para despertar.', 'SLEEPING', { emocion: 'cansado' });
    else if (p === 'explore') {
      setMode('EXPLORER');
      void say('Modo explorador: listo para investigar.', 'SCAN', { emocion: 'curioso' });
    } else void playClip('aqui', 'IDLE', { fallbackText: 'Aquí estoy.' });
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
    await say(next ? 'Comentarios de cámara activados.' : 'Comentarios de cámara apagados.', 'IDLE');
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
    void say(`Así sueno, ${user.name}. Una sola voz: Gabriela, en ElevenLabs v3. Puedo reír, cantar o contarte un chiste; tú dime.`, 'HAPPY', { emocion: 'feliz' });
  };

  const sendDraft = () => {
    const t = draft.trim();
    if (!t) return;
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

  const dotColor =
    status === 'muted' ? T.aviso : status === 'reconnect' || status === 'thinking' ? T.principal : status === 'offline' ? T.texto3 : T.activo;
  const statusLabel =
    toolHint ? toolHint :
    status === 'listening'
      ? listening
        ? 'te escucho'
        : 'conectando mic'
      : status === 'muted'
        ? 'silenciado'
        : status === 'thinking'
          ? 'pensando'
          : status === 'speaking'
            ? face === 'SING' ? 'cantando' : 'hablando'
            : status === 'orando'
              ? 'orando'
            : status === 'reconnect'
              ? 'reconectando mic'
              : status === 'offline'
                ? 'sin mic'
                : 'iniciando';

  // Qué cara se ve: los anillos (Skia), la sala 3D o, si lo elegido falló, la cara de siempre.
  const vista: 'anillos' | 'sala' | 'clasica' | null =
    cara === null ? null : cara === 'anillos' ? (skiaFallo ? 'clasica' : 'anillos') : conSala ? 'sala' : 'clasica';
  const enSala = vista === 'sala';
  nivelVisible.current = vista === 'clasica';

  return (
    <View style={[styles.root, !enSala && styles.rootCara]}>
      <CamaraVision
        enabled={visionOn && !!camPerm?.granted}
        dormido={presence === 'sleep'}
        grabRef={grabFrame}
        onEscena={onEscena}
        onGaze={onGazeCam}
        onObjects={onObjectsStable}
        onScene={onScene}
        onMotor={setVisionMotor}
      />
      {vista === 'sala' && postura ? (
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
      ) : null}

      <View pointerEvents="none" style={styles.hud}>
        <View style={[styles.hudDot, { backgroundColor: dotColor }]} />
        <Text style={styles.hudText}>
          {statusLabel}
          {verPersona ? (visionMotor === 'mlkit' ? ' · te veo' : ' · alguien') : ''}
          {!online ? ' · sin cerebro' : ''}
        </Text>
      </View>

      {!!partial && (
        <View pointerEvents="none" style={styles.partialWrap}>
          <Text numberOfLines={2} style={styles.partialText}>
            {partial}
          </Text>
        </View>
      )}

      {!!bubble && (
        <Animated.View pointerEvents="none" style={[styles.bubbleFloat, enSala ? styles.bubbleArriba : styles.bubbleAbajo, { opacity: bubbleOp }]}>
          <View style={styles.bubbleCard}>
            <Text numberOfLines={3} style={styles.bubbleText}>
              {bubble}
            </Text>
          </View>
        </Animated.View>
      )}

      <View style={styles.controles} pointerEvents="box-none">
        <Pressable
          onPress={() => void toggleMute()}
          accessibilityRole="button"
          accessibilityLabel={micMuted ? 'Activar el micrófono' : 'Silenciar el micrófono'}
          style={[styles.mic, !micMuted && styles.micAbierto, listening && !micMuted && styles.micOyendo]}
        >
          <Text style={[styles.micIcono, !micMuted && { color: T.sobrePrincipal }]}>{micMuted ? '🔇' : '🎙'}</Text>
        </Pressable>
        <Pressable onPress={() => setMenuOpen(true)} accessibilityRole="button" accessibilityLabel="Escribir y ajustes" style={styles.escribir}>
          <Text style={styles.escribirTexto}>Escribir</Text>
        </Pressable>
      </View>

      <View style={styles.edgeZone} {...edgePan.panHandlers}>
        <View pointerEvents="none" style={styles.edgeHint} />
      </View>

      <DeskMenu
        visible={menuOpen}
        userName={user.name}
        mode={mode}
        presence={presence}
        micMuted={micMuted}
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
          void fireBlaster('¡Blaster listo! Pium, pium, pium.');
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
        caraClasica={vista === 'clasica'}
        postura={postura || 'pie'}
        onSetPostura={cambiarPostura}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.fondo2 },
  // la cara de respaldo se dibuja sobre negro, como siempre
  rootCara: { backgroundColor: '#000' },
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
  bubbleAbajo: { bottom: 88 },
  bubbleCard: { backgroundColor: T.panel, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, maxWidth: 520, ...SOMBRA },
  bubbleText: { color: T.texto, fontSize: 16, lineHeight: 22, textAlign: 'center' },
  partialWrap: { position: 'absolute', left: 120, right: 120, bottom: 24, alignItems: 'center' },
  partialText: { color: T.texto2, fontSize: 14, fontStyle: 'italic', textAlign: 'center', backgroundColor: 'rgba(52,54,58,0.9)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 4, overflow: 'hidden' },
  controles: { position: 'absolute', right: 56, bottom: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
  mic: { width: 56, height: 56, borderRadius: 28, backgroundColor: T.panel, alignItems: 'center', justifyContent: 'center', ...SOMBRA },
  micAbierto: { backgroundColor: T.principal },
  micOyendo: { borderWidth: 3, borderColor: T.activo },
  micIcono: { fontSize: 22, color: T.texto2 },
  escribir: { height: 44, borderRadius: 22, paddingHorizontal: 18, backgroundColor: T.panel, justifyContent: 'center', ...SOMBRA },
  escribirTexto: { color: T.texto, fontSize: 15, fontWeight: '600' },
  edgeZone: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 44, justifyContent: 'center', alignItems: 'flex-end' },
  edgeHint: { width: 5, height: 84, borderTopLeftRadius: 4, borderBottomLeftRadius: 4, backgroundColor: 'rgba(214,181,108,0.35)' },
});
