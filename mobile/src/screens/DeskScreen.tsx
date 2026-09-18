import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, PanResponder, StyleSheet, Text, View } from 'react-native';
import { useCameraPermissions } from 'expo-camera';
import { Accelerometer } from 'expo-sensors';
import { UltronFace } from '../components/UltronFace';
import { GazeCamera, type FrameGrabber } from '../components/GazeCamera';
import { DeskMenu } from '../components/DeskMenu';
import type { DeskPresence, FaceState, Mode, SessionUser } from '../config';
import { healthCheck, rememberFact, turno, type Turn } from '../lib/api';
import { CONOCER_QUESTIONS, localAnswer } from '../lib/knowledge';
import LINES from '../../voice-lines.json';
import {
  destroySpeech,
  enableAlwaysOnMic,
  ensureSpeechPermissions,
  micWatchdogOk,
  muteMic,
  pauseMicForTts,
  restartMic,
  setSpeechCallbacks,
  unmuteMic,
} from '../lib/speech';
import { appendChatLog, loadConocerProgress, loadSettings, saveConocerProgress, saveSettings, upsertPersonFact } from '../lib/storage';
import { playSfx, preloadSfx } from '../lib/sfx';
import { prefetchPhrases, speak, stopSpeaking } from '../lib/tts';
import { matchVoiceAct } from '../lib/voiceActs';

type Props = {
  user: SessionUser;
  onLogout: () => void;
};

const CORE_COUNT = 10;
const pick = (arr: readonly string[]) => arr[Math.floor(Math.random() * arr.length)];

function greetingFor(name: string) {
  const h = new Date().getHours();
  const part = h < 12 ? LINES.greetingParts[0] : h < 19 ? LINES.greetingParts[1] : LINES.greetingParts[2];
  return LINES.greetingTemplate.replace('{part}', part).replace('{name}', name);
}

const MODE_WORDS: Array<[RegExp, Mode, string]> = [
  [/modo\s+(guardian|guardián|vigilancia)/, 'GUARDIAN', 'Modo Guardian. Vigilo el escritorio.'],
  [/modo\s+(mining|minería|mineria)/, 'MINING', 'Modo Mining. Extrayendo señales.'],
  [/modo\s+(gold|oro)/, 'GOLD', 'Modo Gold. Prioridad de alto valor.'],
  [/modo\s+(creative|creativo)/, 'CREATIVE', 'Modo Creative. Ideas en marcha.'],
  [/modo\s+(analytical|analítico|analitico|análisis)/, 'ANALYTICAL', 'Modo Analytical. Análisis frío.'],
  [/modo\s+(strategic|estratégico|estrategico|estrategia)/, 'STRATEGIC', 'Modo Strategic. Decisiones de junta.'],
  [/modo\s+(explorer|explore|explorar)/, 'EXPLORER', 'Modo Explorer. Listo para investigar.'],
];

/** Cara según el tono del texto del cerebro (el servidor no manda emoción). */
function faceForReply(text: string): FaceState {
  const t = text.toLowerCase();
  if (/jaja|jeje|excelente|perfecto|genial|buen(a|o)s? noticia|celebr/.test(t)) return 'HAPPY';
  if (/lo siento|no puedo|no tengo|no lo vi|no s[eé]|error|fall[oó]/.test(t)) return 'CONCERNED';
  if (/cuidado|alerta|riesgo|peligro/.test(t)) return 'SCAN';
  return 'SPEAKING';
}

export function DeskScreen({ user, onLogout }: Props) {
  const [face, setFace] = useState<FaceState>('IDLE');
  const [mode, setMode] = useState<Mode>('GUARDIAN');
  const [presence, setPresence] = useState<DeskPresence>('stay');
  const [bubble, setBubble] = useState('');
  const [status, setStatus] = useState<'boot' | 'listening' | 'muted' | 'thinking' | 'speaking' | 'reconnect' | 'offline'>('boot');
  const [draft, setDraft] = useState('');
  const [listening, setListening] = useState(false);
  const [level, setLevel] = useState(0);
  const [micMuted, setMicMuted] = useState(false);
  const [visionOn, setVisionOn] = useState(true);
  const [gaze, setGaze] = useState({ x: 0, y: 0 });
  const [objects, setObjects] = useState<string[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [attack, setAttack] = useState<'blaster' | 'saber' | null>(null);
  const [irritation, setIrritation] = useState(0);
  const [online, setOnline] = useState(true);
  const [camPerm, requestCam] = useCameraPermissions();

  const speakingRef = useRef(false);
  const handling = useRef(false);
  const pending = useRef<string | null>(null);
  const presenceRef = useRef<DeskPresence>('stay');
  const modeRef = useRef<Mode>('GUARDIAN');
  const irritationRef = useRef(0);
  const tapCount = useRef(0);
  const touchGazeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const conocerIdxRef = useRef(-1);
  const objectsRef = useRef<string[]>([]);
  const sceneRef = useRef('');
  const lastSceneRemark = useRef(0);
  const lastUserAt = useRef(Date.now());
  const historial = useRef<Turn[]>([]);
  const grabFrame = useRef<FrameGrabber | null>(null);
  const bubbleOp = useRef(new Animated.Value(0)).current;

  useEffect(() => void (presenceRef.current = presence), [presence]);
  useEffect(() => void (modeRef.current = mode), [mode]);
  useEffect(() => void (objectsRef.current = objects), [objects]);

  const restFace = useCallback((): FaceState => (presenceRef.current === 'sleep' ? 'SLEEPING' : 'IDLE'), []);

  const showBubble = useCallback(
    (text: string) => {
      setBubble(text);
      Animated.timing(bubbleOp, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    },
    [bubbleOp]
  );

  useEffect(() => {
    if (!bubble) return;
    const t = setTimeout(() => Animated.timing(bubbleOp, { toValue: 0, duration: 500, useNativeDriver: true }).start(), 9000);
    return () => clearTimeout(t);
  }, [bubble, bubbleOp]);

  const say = useCallback(
    async (text: string, nextFace?: FaceState, performance: 'speak' | 'sing' = 'speak') => {
      showBubble(text);
      void appendChatLog({ role: 'ultron', text });
      historial.current = [...historial.current, { rol: 'ultron' as const, texto: text }].slice(-12);
      speakingRef.current = true;
      const f = nextFace || (performance === 'sing' ? 'MUSIC' : 'SPEAKING');
      setFace(f);
      setStatus('speaking');
      await speak(text, {
        performance,
        onAudioStart: () => {
          pauseMicForTts(true);
          setFace(f === 'IDLE' || f === 'LISTENING' ? 'SPEAKING' : f);
        },
        onEnd: () => {
          speakingRef.current = false;
          pauseMicForTts(false);
          setFace(restFace());
          setStatus(micMuted ? 'muted' : 'listening');
        },
      });
    },
    [micMuted, restFace, showBubble]
  );

  const startConocer = useCallback(
    async (force = false) => {
      const progress = await loadConocerProgress(user.correo);
      if (progress.completedCore && !force) {
        await say('Ya completamos las diez preguntas principales. Si quieres, di «conocer más».', 'HAPPY');
        return;
      }
      const next = CONOCER_QUESTIONS.findIndex((q) => !progress.answeredIds.includes(q.id));
      const idx = next < 0 ? 0 : next;
      setMode('CONOCER');
      conocerIdxRef.current = idx;
      await say(
        force ? `Sigamos conociéndonos. ${CONOCER_QUESTIONS[idx].prompt}` : `Quiero conocerte. Pregunta ${idx + 1} de ${CORE_COUNT}: ${CONOCER_QUESTIONS[idx].prompt}`,
        'HAPPY'
      );
    },
    [say, user.correo]
  );

  const fireBlaster = useCallback(
    async (line: string) => {
      setAttack('blaster');
      setFace('ANGRY');
      playSfx('blaster');
      await say(line, 'ANGRY');
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
    await say('Sable de luz, listo. Que Orden Global te acompañe.', 'ANGRY');
    setAttack(null);
  }, [say]);

  const askBrain = useCallback(
    async (cmd: string, opts?: { image?: string }) => {
      setFace('THINKING');
      setStatus('thinking');
      const chat = turno({ message: cmd, mode: modeRef.current, userName: user.name, historial: historial.current, image: opts?.image });
      const ackTimer = new Promise<'ack'>((r) => setTimeout(() => r('ack'), opts?.image ? 900 : 1500));
      let ack: Promise<unknown> | null = null;
      if ((await Promise.race([chat, ackTimer])) === 'ack') {
        ack = speak(pick(LINES.acks), { onAudioStart: () => pauseMicForTts(true), onEnd: () => pauseMicForTts(false) });
      }
      const result = await chat;
      if (ack) await ack; // no cortar el "un momento" a la mitad
      if (result.error || !result.reply) {
        setOnline(false);
        await say(result.error ? 'No alcanzo al cerebro remoto ahora. Sigo contigo con lo básico.' : 'No recibí respuesta. Intenta de nuevo.', 'CONFUSED');
        return;
      }
      setOnline(true);
      if (result.mode && result.mode !== 'CONOCER' && MODE_WORDS.some(([, m]) => m === result.mode)) setMode(result.mode);
      await say(result.reply, faceForReply(result.reply));
    },
    [say, user.name]
  );

  const whatDoYouSee = useCallback(async () => {
    const frame = grabFrame.current ? await grabFrame.current() : null;
    if (frame) {
      await askBrain('Mira la cámara y dime en dos frases qué ves: quién está, qué hace y qué objetos hay.', { image: `data:image/jpeg;base64,${frame}` });
      return;
    }
    const objs = objectsRef.current;
    await say(objs.length ? `Veo: ${objs.join(', ')}.` : 'Aún no identifico nada. Dame un momento con la cámara.', 'SCAN');
  }, [askBrain, say]);

  const handleCommand = useCallback(
    async (raw: string) => {
      const cmd = raw.trim();
      if (!cmd) return;
      if (handling.current) {
        pending.current = cmd;
        return;
      }
      handling.current = true;
      lastUserAt.current = Date.now();
      await stopSpeaking();
      void appendChatLog({ role: 'user', text: cmd });
      historial.current = [...historial.current, { rol: 'usuario' as const, texto: cmd }].slice(-12);
      const q = cmd.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

      try {
        if (presenceRef.current === 'sleep') {
          setPresence('stay');
          presenceRef.current = 'stay';
          if (/^(despierta|wake|levantate|hola|ultron|buenos|buenas)/.test(q)) return void (await say('Despierto. Te escucho.', 'HAPPY'));
        }
        if (/^(duerme|a dormir|modo sleep|vete a dormir|descansa)/.test(q)) {
          setPresence('sleep');
          presenceRef.current = 'sleep';
          return void (await say('Descanso un momento. Háblame o tócame para despertar.', 'SLEEPING'));
        }
        for (const [re, m, line] of MODE_WORDS) {
          if (re.test(q)) {
            setMode(m);
            setPresence(m === 'EXPLORER' ? 'explore' : 'stay');
            return void (await say(line, m === 'GOLD' ? 'HAPPY' : m === 'EXPLORER' ? 'SCAN' : 'IDLE'));
          }
        }
        if (/\b(menu|opciones|capacidades|que puedes hacer)\b/.test(q)) {
          setMenuOpen(true);
          return void (await say('Aquí tienes lo que puedo hacer.', 'IDLE'));
        }
        if (/conocer mas|saber mas/.test(q)) return void (await startConocer(true));
        if (/modo conocer|quiero conocerte|conocerme|conocernos/.test(q)) return void (await startConocer(false));
        if (/logout|cerrar sesion|salir sesion/.test(q)) {
          await say('Hasta pronto.', 'IDLE');
          return onLogout();
        }
        if (/^(recuerda|anota|apunta) (que )?/.test(q)) {
          const hecho = cmd.replace(/^(recuerda|anota|apunta)\s+(que\s+)?/i, '').trim();
          if (hecho) {
            void rememberFact(`${user.name}: ${hecho}`);
            await upsertPersonFact({ nombre: user.name, correo: user.correo, rol: user.role, key: `nota_${Date.now().toString(36)}`, value: hecho });
            return void (await say('Anotado. Lo recuerdo.', 'HAPPY'));
          }
        }
        if (/\b(vision|camara)\b/.test(q) && !/que ves|que hay|que miras/.test(q)) {
          if (!camPerm?.granted) {
            const res = await requestCam();
            if (!res.granted) return void (await say('Necesito permiso de cámara para mirarte.', 'CONCERNED'));
          }
          setVisionOn(true);
          return void (await say('Visión activa. Te estoy mirando.', 'SCAN'));
        }
        if (/que ves|que hay (aqui|en la mesa|frente)|que miras|que tengo en la mano|quien esta|describe (lo que|la) (ves|camara|escena)/.test(q)) {
          return void (await whatDoYouSee());
        }
        if (/^(dispara|blaster|pium)/.test(q)) return void (await fireBlaster('¡Blaster listo! Pium, pium, pium.'));
        if (/espada|sable|jedi|lightsaber/.test(q)) return void (await fireSaber());

        // Conocer
        const ci = conocerIdxRef.current;
        if (modeRef.current === 'CONOCER' && ci >= 0 && ci < CONOCER_QUESTIONS.length) {
          const qq = CONOCER_QUESTIONS[ci];
          await upsertPersonFact({ nombre: user.name, correo: user.correo, rol: user.role, key: qq.memoryKey, value: cmd });
          void rememberFact(`${user.name} · ${qq.memoryKey}: ${cmd}`);
          const progress = await loadConocerProgress(user.correo);
          const answeredIds = Array.from(new Set([...progress.answeredIds, qq.id]));
          const completedCore = answeredIds.length >= CORE_COUNT;
          await saveConocerProgress({ correo: user.correo, answeredIds, completedCore });
          const next = CONOCER_QUESTIONS.findIndex((x) => !answeredIds.includes(x.id));
          if (completedCore && (next < 0 || next >= CORE_COUNT)) {
            conocerIdxRef.current = -1;
            setMode('GUARDIAN');
            return void (await say('Gracias. Ya te conozco mejor; no repetiré estas preguntas. Si quieres más, di «conocer más».', 'HAPPY'));
          }
          if (next >= 0) {
            conocerIdxRef.current = next;
            return void (await say(`Anotado. ${CONOCER_QUESTIONS[next].prompt}`, 'HAPPY'));
          }
          conocerIdxRef.current = -1;
          setMode('GUARDIAN');
          return void (await say('Listo. Ya te conozco mejor.', 'HAPPY'));
        }

        const act = matchVoiceAct(cmd);
        if (act) {
          if (act.id === 'saber') return void (await fireSaber());
          setFace(act.face);
          for (const line of act.lines) {
            await say(line, act.face, act.sing ? 'sing' : 'speak');
            if (act.lineGapMs) await new Promise((r) => setTimeout(r, act.lineGapMs));
          }
          return;
        }

        const offline = localAnswer(cmd);
        if (offline && !online) return void (await say(offline, 'IDLE'));
        if (offline && /hora|fecha|que dia|ayuda|comandos|que puedes/.test(q)) return void (await say(offline, 'IDLE'));

        await askBrain(cmd);
      } finally {
        handling.current = false;
        setStatus(micMuted ? 'muted' : 'listening');
        const next = pending.current;
        pending.current = null;
        if (next) void handleCommand(next);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [askBrain, camPerm?.granted, fireBlaster, fireSaber, micMuted, onLogout, online, requestCam, say, startConocer, user, whatDoYouSee]
  );

  // ---------- Tacto ----------
  const onTap = useCallback(
    (x: number, y: number) => {
      setGaze({ x: x * 0.8, y: y * 0.6 });
      if (touchGazeTimer.current) clearTimeout(touchGazeTimer.current);
      touchGazeTimer.current = setTimeout(() => setGaze({ x: 0, y: 0 }), 1500);
      lastUserAt.current = Date.now();

      if (presenceRef.current === 'sleep') {
        setPresence('stay');
        presenceRef.current = 'stay';
        playSfx('tap');
        void say('Ya despierto.', 'STARTLE');
        return;
      }
      playSfx('tap');
      tapCount.current += 1;
      const irr = Math.min(1, irritationRef.current + 0.17);
      irritationRef.current = irr;
      setIrritation(irr);
      if (handling.current || speakingRef.current) return;

      if (irr >= 0.85) {
        handling.current = true;
        void fireBlaster(pick(LINES.angry)).finally(() => {
          handling.current = false;
        });
      } else if (irr >= 0.5) {
        void say(pick(LINES.annoy), 'CONFUSED');
      } else {
        setFace(tapCount.current % 2 ? 'WINK' : 'HAPPY');
        if (tapCount.current % 3 === 1) void say(pick(LINES.tap), 'HAPPY');
        else setTimeout(() => setFace(restFace()), 700);
      }
    },
    [fireBlaster, restFace, say]
  );

  const onLongPress = useCallback(() => {
    irritationRef.current = 0;
    setIrritation(0);
    if (speakingRef.current) return;
    void say(pick(LINES.love), 'HAPPY');
  }, [say]);

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
        setFace('STARTLE');
        playSfx('tap');
        void say(pick(LINES.shake), 'STARTLE');
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
      onLevel: setLevel,
      onFinal: onSpeechFinal,
      onListeningChange: setListening,
      onError: () => {},
    });
  }, [onSpeechFinal]);

  // ---------- Arranque ----------
  useEffect(() => {
    let alive = true;
    (async () => {
      const settings = await loadSettings();
      setMicMuted(settings.micMuted);
      setVisionOn(settings.visionEnabled);
      void preloadSfx();
      void healthCheck().then((h) => setOnline(!!h.ok)).catch(() => setOnline(false));

      const micOk = await ensureSpeechPermissions();
      if (!alive) return;
      if (micOk && !settings.micMuted) {
        await enableAlwaysOnMic();
        setStatus('listening');
      } else setStatus(micOk ? 'muted' : 'offline');

      handling.current = true;
      await say(greetingFor(user.name), 'HAPPY');
      handling.current = false;
      void prefetchPhrases(['Anotado. Lo recuerdo.', 'No recibí respuesta. Intenta de nuevo.', 'Veo: ' + (objectsRef.current.join(', ') || 'nada aún') + '.']);

      if (settings.visionEnabled && camPerm && !camPerm.granted && camPerm.canAskAgain !== false) {
        Alert.alert('Cámara', '¿Permitir cámara para mirarte e identificar lo que hay en la mesa?', [
          { text: 'Ahora no', style: 'cancel', onPress: () => setVisionOn(false) },
          { text: 'Permitir', onPress: () => void requestCam() },
        ]);
      }

      const progress = await loadConocerProgress(user.correo);
      if (!progress.completedCore && alive) setTimeout(() => !handling.current && void startConocer(false), 1500);
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
      if (micMuted || speakingRef.current) return;
      if (!micWatchdogOk()) {
        setStatus('reconnect');
        void restartMic().then(() => setStatus('listening'));
      }
    }, 3000);
    return () => clearInterval(id);
  }, [micMuted]);

  // Mirada errante suave cuando no hay cámara.
  useEffect(() => {
    if (visionOn && camPerm?.granted) return;
    let t = 0;
    const id = setInterval(() => {
      t += 0.25;
      setGaze({ x: Math.sin(t * 0.3) * 0.15, y: Math.cos(t * 0.19) * 0.1 });
    }, 500);
    return () => clearInterval(id);
  }, [visionOn, camPerm?.granted]);

  // Comentario proactivo sobre la escena (máx. 1 cada 2 min, solo si hay calma).
  const onScene = useCallback(
    (summary: string, labels: string[]) => {
      const prev = sceneRef.current;
      sceneRef.current = labels.join(',');
      const now = Date.now();
      const calm = !handling.current && !speakingRef.current && presenceRef.current === 'stay' && now - lastUserAt.current > 25_000;
      const novel = prev && sceneRef.current !== prev && labels.filter((l) => !prev.includes(l)).length >= 2;
      if (calm && novel && now - lastSceneRemark.current > 120_000 && labels.length) {
        lastSceneRemark.current = now;
        const nuevo = labels.filter((l) => !prev.includes(l)).slice(0, 2).join(' y ');
        void say(`Veo ${nuevo} ahí. Si necesitas algo, dime.`, 'SCAN');
      }
      void summary;
    },
    [say]
  );

  const toggleMute = async () => {
    if (!micMuted) {
      await muteMic();
      setMicMuted(true);
      setStatus('muted');
      await saveSettings({ micMuted: true });
      await say('Micrófono en silencio.', 'IDLE');
    } else {
      const ok = await ensureSpeechPermissions();
      if (!ok) return Alert.alert('Micrófono', 'Necesito permiso de micrófono para escucharte.');
      await unmuteMic();
      setMicMuted(false);
      setStatus('listening');
      await saveSettings({ micMuted: false });
      await say('Te escucho de nuevo.', 'HAPPY');
    }
  };

  const toggleVision = async () => {
    if (!visionOn) {
      if (!camPerm?.granted) {
        const r = await requestCam();
        if (!r.granted) return;
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
    if (p === 'sleep') void say('Descanso un momento. Háblame o tócame para despertar.', 'SLEEPING');
    else if (p === 'explore') {
      setMode('EXPLORER');
      void say('Explore. Listo para investigar.', 'SCAN');
    } else void say('Aquí estoy.', 'IDLE');
  };

  const sendDraft = () => {
    const t = draft.trim();
    if (!t) return;
    setDraft('');
    setMenuOpen(false);
    void handleCommand(t);
  };

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 18 && Math.abs(g.dx) > Math.abs(g.dy) * 1.2,
      onPanResponderRelease: (_, g) => {
        if (g.dx < -36) setMenuOpen(true);
        if (g.dx > 36) setMenuOpen(false);
      },
    })
  ).current;

  const onGazeStable = useCallback((x: number, y: number) => setGaze({ x, y }), []);
  const onObjectsStable = useCallback((labels: string[]) => setObjects(labels), []);

  const dotColor =
    status === 'muted' ? '#FF7A8A' : status === 'reconnect' ? '#FFD166' : status === 'thinking' ? '#FFD166' : status === 'offline' ? '#666' : '#00E5FF';
  const statusLabel =
    status === 'listening'
      ? listening
        ? 'te escucho'
        : 'conectando mic'
      : status === 'muted'
        ? 'silenciado'
        : status === 'thinking'
          ? 'pensando'
          : status === 'speaking'
            ? 'hablando'
            : status === 'reconnect'
              ? 'reconectando mic'
              : status === 'offline'
                ? 'sin mic'
                : 'iniciando';

  return (
    <View style={styles.root} {...pan.panHandlers}>
      <GazeCamera
        enabled={visionOn && !!camPerm?.granted}
        grabRef={grabFrame}
        onGaze={onGazeStable}
        onObjects={onObjectsStable}
        onScene={onScene}
      />
      <UltronFace face={face} mode={mode} gazeX={gaze.x} gazeY={gaze.y} level={level} attack={attack} irritation={irritation} onTap={onTap} onLongPress={onLongPress} />

      <View pointerEvents="none" style={styles.hud}>
        <View style={[styles.hudDot, { backgroundColor: dotColor }]} />
        <Text style={styles.hudText}>
          {statusLabel} · {mode.toLowerCase()}
          {!online ? ' · sin cerebro' : ''}
        </Text>
      </View>

      {!!bubble && (
        <Animated.View pointerEvents="none" style={[styles.bubbleFloat, { opacity: bubbleOp }]}>
          <Text numberOfLines={3} style={styles.bubbleText}>
            {bubble}
          </Text>
        </Animated.View>
      )}
      <View pointerEvents="none" style={styles.edgeHint} />

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
        onSing={(g) => {
          setMenuOpen(false);
          void handleCommand(`canta ${g}`);
        }}
        onWhatDoYouSee={() => {
          setMenuOpen(false);
          void handleCommand('qué ves');
        }}
        onRemember={(f) => void handleCommand(`recuerda que ${f}`)}
        onLogout={onLogout}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  hud: { position: 'absolute', top: 12, left: 16, flexDirection: 'row', alignItems: 'center', gap: 7 },
  hudDot: { width: 6, height: 6, borderRadius: 3 },
  hudText: { color: 'rgba(200,212,222,0.55)', fontSize: 11, letterSpacing: 1 },
  bubbleFloat: { position: 'absolute', left: 32, right: 32, bottom: 16, alignItems: 'center' },
  bubbleText: { color: 'rgba(232,251,255,0.9)', fontSize: 15, lineHeight: 21, textAlign: 'center' },
  edgeHint: {
    position: 'absolute',
    right: 0,
    top: '38%',
    width: 4,
    height: 84,
    borderTopLeftRadius: 4,
    borderBottomLeftRadius: 4,
    backgroundColor: 'rgba(0,229,255,0.3)',
  },
});
