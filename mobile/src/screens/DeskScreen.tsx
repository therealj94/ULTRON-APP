import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, PanResponder, StyleSheet, Text, View } from 'react-native';
import { useCameraPermissions } from 'expo-camera';
import { Accelerometer } from 'expo-sensors';
import { UltronFace } from '../components/UltronFace';
import { GazeCamera, type FrameGrabber } from '../components/GazeCamera';
import { DeskMenu } from '../components/DeskMenu';
import type { DeskPresence, FaceState, Mode, SessionUser } from '../config';
import { healthCheck, rememberFact, turno, turnoStream, type Turn } from '../lib/api';
import { CONOCER_QUESTIONS, localAnswer } from '../lib/knowledge';
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
  appendChatLog,
  clearLongMemory,
  loadConocerProgress,
  loadLongMemory,
  loadSettings,
  saveConocerProgress,
  saveSettings,
  upsertPersonFact,
  type AppSettings,
  type SttEngine,
  type TtsEngine,
} from '../lib/storage';
import { playSfx, preloadSfx, setSfxEnabled } from '../lib/sfx';
import { StreamSpeaker, prefetchPhrases, setTtsEngine, speak, speakUrl, stopSpeaking } from '../lib/tts';
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
  const [partial, setPartial] = useState('');
  const [toolHint, setToolHint] = useState('');
  const [settings, setSettings] = useState<Pick<AppSettings, 'ttsEngine' | 'sttEngine' | 'proactive' | 'sfx'>>({
    ttsEngine: 'eleven',
    sttEngine: 'native',
    proactive: true,
    sfx: true,
  });
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
  const longMemory = useRef<string[]>([]);
  const lastTapAt = useRef(0);
  const listenOffTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recentTaps = useRef<number[]>([]);
  const proactiveRef = useRef(true);
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

  /** Habla y registra un texto que ya se está reproduciendo (stream). */
  const noteSpoken = useCallback(
    (text: string) => {
      showBubble(text);
      void appendChatLog({ role: 'ultron', text });
      historial.current = [...historial.current, { rol: 'ultron' as const, texto: text }].slice(-12);
    },
    [showBubble]
  );

  const askBrain = useCallback(
    async (cmd: string, opts?: { image?: string }) => {
      setFace('THINKING');
      setStatus('thinking');
      setToolHint('');
      const base = { message: cmd, mode: modeRef.current, userName: user.name, correo: user.correo, historial: historial.current, memoria: longMemory.current, image: opts?.image };
      const filler = (text: string) => speak(text, { onAudioStart: () => pauseMicForTts(true), onEnd: () => pauseMicForTts(false) });
      try {

      // 1) Streaming: empieza a hablar con la primera oración mientras Qwen sigue escribiendo.
      if (!opts?.image) {
        let speaker: StreamSpeaker | null = null;
        let firstAt = 0;
        const ackTimer = setTimeout(() => {
          if (!speaker?.hasSpoken && !firstAt) void filler(pick(LINES.acks));
        }, 1800);
        try {
          const st = turnoStream(
            base,
            (piece) => {
              if (!firstAt) {
                firstAt = Date.now();
                clearTimeout(ackTimer);
              }
              if (!speaker) {
                speaker = new StreamSpeaker({
                  onAudioStart: () => {
                    pauseMicForTts(true);
                    speakingRef.current = true;
                    setStatus('speaking');
                  },
                  onSentence: (sentence) => {
                    setFace(faceForReply(sentence));
                    showBubble(sentence);
                  },
                });
              }
              speaker.push(piece);
            },
            (tools) => {
              if (tools.includes('web')) {
                setToolHint('investigando en internet');
                void filler(pick(LINES.thinking));
              } else if (tools.includes('oro') || tools.includes('plata') || tools.includes('hnl')) setToolHint('consultando precio');
              else if (tools.includes('pagina')) setToolHint('leyendo la página');
            }
          );
          const result = await st.promise;
          clearTimeout(ackTimer);
          if (speaker) {
            (speaker as StreamSpeaker).end();
            await (speaker as StreamSpeaker).done;
          }
          setToolHint('');
          if (result.reply) {
            setOnline(true);
            void appendChatLog({ role: 'ultron', text: result.reply });
            historial.current = [...historial.current, { rol: 'ultron' as const, texto: result.reply }].slice(-12);
            if (!(speaker as StreamSpeaker | null)?.hasSpoken) await say(result.reply, faceForReply(result.reply));
            else {
              speakingRef.current = false;
              pauseMicForTts(false);
              setFace(restFace());
              setStatus(micMuted ? 'muted' : 'listening');
            }
            if (result.mode && result.mode !== 'CONOCER' && MODE_WORDS.some(([, m]) => m === result.mode)) setMode(result.mode);
            return;
          }
          if (speaker && (speaker as StreamSpeaker).hasSpoken) {
            // habló algo y el stream se cortó: no repetir la pregunta
            speakingRef.current = false;
            pauseMicForTts(false);
            setFace(restFace());
            setStatus(micMuted ? 'muted' : 'listening');
            return;
          }
        } catch {
          clearTimeout(ackTimer);
          if (speaker) (speaker as StreamSpeaker).cancel();
          /* el servidor no tiene stream aún → JSON clásico */
        }
      }

      // 2) JSON clásico (visión o servidor sin stream).
      const chat = turno(base);
      const ackTimer = new Promise<'ack'>((r) => setTimeout(() => r('ack'), opts?.image ? 900 : 1500));
      let ack: Promise<unknown> | null = null;
      if ((await Promise.race([chat, ackTimer])) === 'ack') {
        ack = filler(opts?.image ? 'Déjame ver.' : pick(LINES.acks));
        if (opts?.image) {
          const still = new Promise<'still'>((r) => setTimeout(() => r('still'), 6500));
          if ((await Promise.race([chat, still])) === 'still') {
            await ack;
            ack = filler('Todavía estoy mirando.');
          }
        }
      }
      const result = await chat;
      if (ack) await ack;
      setToolHint('');
      const failed = (r: { error?: string; reply?: string }) => !!(r.error || !r.reply);
      let out = result;
      if (failed(out)) {
        await new Promise((r) => setTimeout(r, 800));
        out = await turno(base);
      }
      if (failed(out)) {
        const auth = /sesión|privado|401/i.test(String(out.error || ''));
        if (auth) {
          setOnline(true);
          await say('Se me cerró la sesión de la mesa. Entra de nuevo y te oigo.', 'CONCERNED');
          return;
        }
        setOnline(false);
        await say('No alcanzo al cerebro remoto ahora. Sigo contigo con lo básico.', 'CONFUSED');
        return;
      }
      setOnline(true);
      if (out.mode && out.mode !== 'CONOCER' && MODE_WORDS.some(([, m]) => m === out.mode)) setMode(out.mode);
      await say(out.reply, faceForReply(out.reply));
      } finally {
        if (!speakingRef.current) pauseMicForTts(false);
        if (!micMuted && !speakingRef.current) setStatus('listening');
      }
    },
    [micMuted, restFace, say, showBubble, user.correo, user.name]
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
        if (/^(recuerda|anota|apunta|memoriza|guarda) (que |esto:? )?/.test(q)) {
          const hecho = cmd.replace(/^(recuerda|anota|apunta|memoriza|guarda)\s+(que\s+|esto:?\s+)?/i, '').trim();
          if (hecho) {
            const line = `${user.name}: ${hecho}`;
            if (longMemory.current.includes(line)) return void (await say('Eso ya lo tenía en memoria.', 'HAPPY'));
            void rememberFact(line);
            longMemory.current = (await addLongFact(line)).map((f) => f.hecho);
            await upsertPersonFact({ nombre: user.name, correo: user.correo, rol: user.role, key: `nota_${Date.now().toString(36)}`, value: hecho });
            return void (await say('Anotado. Lo recuerdo.', 'HAPPY'));
          }
        }
        if (/^(olvida|borra) (todo|la memoria|lo que sabes)/.test(q)) {
          await clearLongMemory();
          longMemory.current = [];
          return void (await say('Memoria de largo plazo borrada.', 'CONCERNED'));
        }
        if (/^(que|qué) (recuerdas|sabes de mi|tienes en memoria)/.test(q) && longMemory.current.length) {
          const mine = longMemory.current.filter((f) => f.startsWith(user.name)).slice(0, 4).map((f) => f.replace(/^[^:]+:\s*/, ''));
          if (mine.length) return void (await say(`Recuerdo: ${mine.join('. ')}.`, 'HAPPY'));
        }
        if (/^(callate|cállate|silencio|para|basta|shh)\b/.test(q)) {
          await stopSpeaking();
          setFace(restFace());
          return;
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
          if (act.audioUrl) {
            await speakUrl(act.audioUrl);
            return;
          }
          for (const line of act.lines) {
            await say(line, act.face, act.sing ? 'sing' : 'speak');
            if (act.lineGapMs) await new Promise((r) => setTimeout(r, act.lineGapMs));
          }
          return;
        }

        const offline = localAnswer(cmd);
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
    [askBrain, camPerm?.granted, fireBlaster, fireSaber, micMuted, onLogout, requestCam, say, startConocer, user, whatDoYouSee]
  );

  // ---------- Tacto: reacciones distintas según zona, ritmo y humor ----------
  const onTap = useCallback(
    (x: number, y: number) => {
      setGaze({ x: x * 0.8, y: y * 0.6 });
      if (touchGazeTimer.current) clearTimeout(touchGazeTimer.current);
      touchGazeTimer.current = setTimeout(() => setGaze({ x: 0, y: 0 }), 1500);
      lastUserAt.current = Date.now();
      const now = Date.now();
      const sinceLast = now - lastTapAt.current;
      lastTapAt.current = now;
      recentTaps.current = [...recentTaps.current.filter((t) => now - t < 2200), now];

      if (presenceRef.current === 'sleep') {
        setPresence('stay');
        presenceRef.current = 'stay';
        playSfx('boing');
        void say('Ya despierto.', 'STARTLE');
        return;
      }
      tapCount.current += 1;
      const irr = Math.min(1, irritationRef.current + 0.15);
      irritationRef.current = irr;
      setIrritation(irr);
      const busy = handling.current || speakingRef.current;

      // Cosquillas: 5+ toques rápidos → risa (gana a todo lo demás)
      if (recentTaps.current.length >= 5) {
        recentTaps.current = [];
        playSfx('giggle');
        setFace('HAPPY');
        if (!busy) void say(pick(LINES.tickle), 'HAPPY');
        return;
      }
      if (busy) {
        playSfx('tap');
        return;
      }
      // Enojo por acumulación
      if (irr >= 0.85) {
        handling.current = true;
        void fireBlaster(pick(LINES.angry)).finally(() => {
          handling.current = false;
        });
        return;
      }
      if (irr >= 0.55) {
        playSfx('tap');
        void say(pick(LINES.annoy), 'CONFUSED');
        return;
      }
      // Doble toque
      if (sinceLast < 380) {
        playSfx('wink');
        setFace('WINK');
        void say(pick(LINES.double), 'WINK');
        return;
      }
      // Zonas: ojos (arriba, a los lados), frente (arriba centro), boca (abajo centro)
      const eyeZone = y < -0.05 && Math.abs(x) > 0.22;
      const foreheadZone = y < -0.45 && Math.abs(x) <= 0.22;
      const mouthZone = y > 0.35 && Math.abs(x) < 0.4;
      if (eyeZone) {
        playSfx('wink');
        setFace(tapCount.current % 2 ? 'WINK' : 'STARTLE');
        if (tapCount.current % 2) void say(pick(LINES.eye), 'WINK');
        else setTimeout(() => setFace(restFace()), 800);
        return;
      }
      if (foreheadZone) {
        playSfx('tap');
        setFace('THINKING');
        void say(pick(LINES.forehead), 'THINKING');
        return;
      }
      if (mouthZone) {
        playSfx('giggle');
        setFace('HAPPY');
        void say(pick(LINES.mouth), 'HAPPY');
        return;
      }
      // Toque normal: alterna guiño / sonrisa, a veces habla
      playSfx('tap');
      setFace(tapCount.current % 2 ? 'WINK' : 'HAPPY');
      if (tapCount.current % 3 === 1) void say(pick(LINES.tap), 'HAPPY');
      else setTimeout(() => setFace(restFace()), 700);
    },
    [fireBlaster, restFace, say]
  );

  const onLongPress = useCallback(() => {
    irritationRef.current = 0;
    setIrritation(0);
    playSfx('purr');
    setFace('HAPPY');
    if (speakingRef.current || handling.current) return;
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
      onPartial: (t) => {
        if (!speakingRef.current) {
          setFace('LISTENING');
          setPartial(t);
        }
      },
      onLevel: setLevel,
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
      const settings = await loadSettings();
      setMicMuted(settings.micMuted);
      setVisionOn(settings.visionEnabled);
      setSettings({ ttsEngine: settings.ttsEngine, sttEngine: settings.sttEngine, proactive: settings.proactive, sfx: settings.sfx });
      setTtsEngine(settings.ttsEngine);
      setSfxEnabled(settings.sfx);
      proactiveRef.current = settings.proactive;
      if (settings.sttEngine !== currentSttEngine()) await setSttEngine(settings.sttEngine);
      longMemory.current = (await loadLongMemory()).map((f) => f.hecho);
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
      void prefetchPhrases(['Ya completamos las diez preguntas principales. Si quieres, di «conocer más».']);

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
          if (reply && !/^nada\b/i.test(reply)) await say(reply, 'SCAN');
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

  const changeTts = async (e: TtsEngine) => {
    setSettings((p) => ({ ...p, ttsEngine: e }));
    setTtsEngine(e);
    await saveSettings({ ttsEngine: e });
    await say(e === 'eleven' ? 'Motor de voz: ElevenLabs.' : e === 'qwen' ? 'Motor de voz: nodo Qwen local.' : 'Motor de voz: automático.', 'IDLE');
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
  const forgetAll = async () => {
    await clearLongMemory();
    longMemory.current = [];
    await say('Memoria de largo plazo borrada.', 'CONCERNED');
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

      {!!partial && (
        <View pointerEvents="none" style={styles.partialWrap}>
          <Text numberOfLines={2} style={styles.partialText}>
            {partial}
          </Text>
        </View>
      )}

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
        settings={settings}
        memoryCount={longMemory.current.length}
        onSetTtsEngine={(e) => void changeTts(e)}
        onSetSttEngine={(e) => void changeStt(e)}
        onToggleProactive={() => void toggleProactive()}
        onToggleSfx={() => void toggleSfx()}
        onForget={() => void forgetAll()}
        onSearch={(q) => {
          setMenuOpen(false);
          void handleCommand(`busca ${q}`);
        }}
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
  partialWrap: { position: 'absolute', left: 40, right: 40, top: 34, alignItems: 'center' },
  partialText: { color: 'rgba(0,229,255,0.55)', fontSize: 13, fontStyle: 'italic', textAlign: 'center' },
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
