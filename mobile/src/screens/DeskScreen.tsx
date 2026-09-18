import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, Dimensions, PanResponder, StyleSheet, Text, View } from 'react-native';
import { useCameraPermissions } from 'expo-camera';
import { Accelerometer } from 'expo-sensors';
import { UltronFace } from '../components/UltronFace';
import { GazeCamera, type FrameGrabber } from '../components/GazeCamera';
import { DeskMenu } from '../components/DeskMenu';
import { TONES, normalizeTone, tratoFor, type DeskPresence, type FaceState, type Mode, type SessionUser, type Tone } from '../config';
import { HOOKS, MISSING_TAKE, NO_MORE_HOOKS, pickHook, withTrato, type Hook } from '../lib/sing';
import type { TouchPoint } from '../components/UltronFace';
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
import { playSfx, preloadSfx, setSfxEnabled, silenceSfx } from '../lib/sfx';
import { StreamSpeaker, playTake, prefetchPhrases, setTtsEngine, speak, stopSpeaking } from '../lib/tts';
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
  return LINES.greetingTemplate.replace('{part}', part).replace('{name}', tratoFor(name));
}

/** Cara con la que se sostiene un tono al terminar de hablar (1.2–3.4 s, nada de flash). */
const TONE_HOLD_MS: Partial<Record<Tone, number>> = { BURLA: 2200, ENOJO_JUEGO: 2200, TRISTE: 3000, EUFORIA: 2400, CANSADO: 2600, FOCUS: 1400, ESTRES: 1600, ENOJO_REAL: 2400 };
const TONE_REST_FACE: Partial<Record<Tone, FaceState>> = { BURLA: 'BURLA', ENOJO_JUEGO: 'BURLA', TRISTE: 'TRISTE', EUFORIA: 'SMILE', CANSADO: 'CANSADO', FOCUS: 'FOCUS', ESTRES: 'ESTRES', ENOJO_REAL: 'ANGRY' };

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
  const touchGazeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const conocerIdxRef = useRef(-1);
  const objectsRef = useRef<string[]>([]);
  const sceneRef = useRef('');
  const lastSceneRemark = useRef(0);
  const lastUserAt = useRef(Date.now());
  const historial = useRef<Turn[]>([]);
  const longMemory = useRef<string[]>([]);
  const listenOffTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recentTaps = useRef<number[]>([]);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const faceHold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const singingRef = useRef<Hook | null>(null);
  const lastHook = useRef<Hook | null>(null);
  const [pokeSeq, setPokeSeq] = useState(0);
  const [winkSide, setWinkSide] = useState<'L' | 'R' | null>(null);
  const trato = tratoFor(user.name);
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

  /** Sostiene una cara un rato (1.2–3.4 s) y vuelve al reposo. Cancela el hold anterior. */
  const holdFace = useCallback(
    (f: FaceState, ms: number) => {
      if (faceHold.current) clearTimeout(faceHold.current);
      setFace(f);
      faceHold.current = setTimeout(() => {
        faceHold.current = null;
        if (!speakingRef.current && !handling.current) setFace(restFace());
      }, Math.max(1200, Math.min(3400, ms)));
    },
    [restFace]
  );

  const say = useCallback(
    async (text: string, nextFace?: FaceState, performance: 'speak' | 'sing' = 'speak', tone: Tone = 'IDLE') => {
      showBubble(text);
      void appendChatLog({ role: 'ultron', text });
      historial.current = [...historial.current, { rol: 'ultron' as const, texto: text }].slice(-12);
      speakingRef.current = true;
      const toneFace = tone !== 'IDLE' ? TONES[tone].face : null;
      const f = nextFace && nextFace !== 'SPEAKING' && nextFace !== 'IDLE' ? nextFace : toneFace || (performance === 'sing' ? 'MUSIC' : 'SPEAKING');
      if (faceHold.current) clearTimeout(faceHold.current);
      setFace(f);
      setStatus('speaking');
      await speak(text, {
        performance,
        tone,
        onAudioStart: () => {
          pauseMicForTts(true);
          setFace(f === 'IDLE' || f === 'LISTENING' ? 'SPEAKING' : f);
        },
        onEnd: () => {
          speakingRef.current = false;
          pauseMicForTts(false);
          const rest = TONE_REST_FACE[tone];
          if (rest) holdFace(rest, TONE_HOLD_MS[tone] || 1600);
          else if (nextFace === 'HAPPY' || nextFace === 'SMILE' || nextFace === 'WINK') holdFace(nextFace === 'WINK' ? 'WINK' : 'SMILE', 1500);
          else setFace(restFace());
          setStatus(micMuted ? 'muted' : 'listening');
        },
      });
    },
    [holdFace, micMuted, restFace, showBubble]
  );

  /** Canto: toma fija a capella, boca al volumen, sin SFX; si el jefe habla, corta. Luego SMILE + botón en español. */
  const singHook = useCallback(
    async (hook: Hook) => {
      lastHook.current = hook;
      if (!hook.take) return void (await say(withTrato(MISSING_TAKE, trato), 'CONCERNED'));
      singingRef.current = hook;
      speakingRef.current = true;
      silenceSfx(20_000);
      setStatus('speaking');
      setFace('MUSIC');
      showBubble(hook.lyrics.replace(/\n/g, ' · '));
      // el mic sigue abierto durante el canto para que "para" o cualquier frase del jefe corte
      let tick = 0;
      const ok = await playTake(hook.take, {
        onProgress: () => {
          tick += 1;
          // envolvente pseudo-vocal: la boca se mueve al ritmo, no al azar
          const v = 0.35 + 0.65 * Math.abs(Math.sin(tick * 0.9)) * (0.6 + 0.4 * Math.abs(Math.sin(tick * 0.23)));
          setLevel(v);
        },
        onEnd: () => setLevel(0),
      });
      const cut = singingRef.current !== hook;
      singingRef.current = null;
      speakingRef.current = false;
      silenceSfx(0);
      setLevel(0);
      if (!ok || cut) {
        setFace(restFace());
        setStatus(micMuted ? 'muted' : 'listening');
        return;
      }
      holdFace('SMILE', 1500);
      await new Promise((r) => setTimeout(r, 600));
      await say(withTrato(hook.after, trato), 'SMILE', 'speak', 'DESPUES_CANTO');
    },
    [holdFace, micMuted, restFace, say, showBubble, trato]
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
      const base = { message: cmd, mode: modeRef.current, userName: user.name, historial: historial.current, memoria: longMemory.current, image: opts?.image };
      const toneRef = { current: 'IDLE' as Tone };
      const filler = (text: string) => speak(text, { onAudioStart: () => pauseMicForTts(true), onEnd: () => pauseMicForTts(false) });

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
                  tone: toneRef.current,
                  onAudioStart: () => {
                    pauseMicForTts(true);
                    speakingRef.current = true;
                    setStatus('speaking');
                  },
                  onSentence: (sentence) => {
                    setFace(toneRef.current !== 'IDLE' ? TONES[toneRef.current].face : faceForReply(sentence));
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
            },
            (tono) => {
              toneRef.current = normalizeTone(tono);
              speaker?.setTone(toneRef.current);
              if (toneRef.current !== 'IDLE') setFace(TONES[toneRef.current].face);
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
            const tone = normalizeTone(result.tono || toneRef.current);
            if (!(speaker as StreamSpeaker | null)?.hasSpoken) await say(result.reply, faceForReply(result.reply), 'speak', tone);
            else {
              speakingRef.current = false;
              pauseMicForTts(false);
              const rest = TONE_REST_FACE[tone];
              if (rest) holdFace(rest, TONE_HOLD_MS[tone] || 1600);
              else setFace(restFace());
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
      if (result.error || !result.reply) {
        setOnline(false);
        await say(result.error ? 'No alcanzo al cerebro remoto ahora. Sigo contigo con lo básico.' : 'No recibí respuesta. Intenta de nuevo.', 'CONFUSED');
        return;
      }
      setOnline(true);
      if (result.mode && result.mode !== 'CONOCER' && MODE_WORDS.some(([, m]) => m === result.mode)) setMode(result.mode);
      await say(result.reply, faceForReply(result.reply), 'speak', normalizeTone(result.tono));
    },
    [holdFace, micMuted, restFace, say, showBubble, user.name]
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
        if (/^(callate|cállate|silencio|para|parale|detente|basta|shh|ya|stop|no)\b/.test(q) && q.split(/\s+/).length <= 3) {
          // "Para" = silencio total. Sin tono de ofendido.
          singingRef.current = null;
          await stopSpeaking();
          setLevel(0);
          setFace(restFace());
          return;
        }
        if (lastHook.current && /^(sigo|sigue|siguele|continua|continúa|otra vez|de nuevo|dale|si sigue|sí sigue)\b/.test(q)) {
          return void (await singHook(lastHook.current));
        }
        const hook = pickHook(cmd);
        if (hook === 'other') return void (await say(withTrato(NO_MORE_HOOKS, trato), 'BURLA', 'speak', 'BURLA'));
        if (hook) return void (await singHook(hook));
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
            await say(line, act.face, 'speak');
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

  // ---------- Tacto (gestos lentos, que se vean) ----------
  // 1 toque → blink ~0.4 s · ojo → wink 1.4–1.8 s · 2 toques → wake + escuchar · 3 → "Aquí estoy…" · 4 → purr 3.2 s
  // hold 0.8 s → FOCUS · deslizar → la mirada sigue el dedo (lento)
  const isEye = (p: TouchPoint) => p.y < 0.05 && p.y > -0.75 && Math.abs(p.x) > 0.16 && Math.abs(p.x) < 0.62;

  const resolveTaps = useCallback(
    (n: number) => {
      if (n >= 4) {
        playSfx('purr');
        holdFace('PURR', 3200);
        return;
      }
      if (n === 3) {
        holdFace('CURIOSITY', 2600);
        if (!speakingRef.current && !handling.current) setTimeout(() => void say(pick(LINES.curiosity), 'CURIOSITY'), 700);
        return;
      }
      if (n === 2) {
        if (singingRef.current) return; // no interrumpir el canto
        playSfx('wake');
        if (presenceRef.current === 'sleep') {
          setPresence('stay');
          presenceRef.current = 'stay';
        }
        holdFace('LISTENING', 1600);
        return;
      }
      // 1 toque: solo el parpadeo lento (ya hecho) y cara IDLE/BURLA sostenida
      holdFace(Math.random() < 0.3 ? 'BURLA' : 'IDLE', 1200);
    },
    [holdFace, say]
  );

  const onFaceTouchStart = useCallback(
    (p: TouchPoint) => {
      lastUserAt.current = Date.now();
      if (holdTimer.current) clearTimeout(holdTimer.current);
      holdTimer.current = setTimeout(() => {
        holdTimer.current = null;
        // Hold 0.8 s+ → FOCUS, espera orden (sin hablar)
        if (singingRef.current) return;
        holdFace('FOCUS', 3400);
        setGaze({ x: 0, y: 0 });
      }, 800);
      // la mirada va al dedo, despacio
      setGaze({ x: p.x * 0.8, y: p.y * 0.6 });
    },
    [holdFace]
  );

  const onFaceTouchMove = useCallback((p: TouchPoint) => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    setGaze({ x: p.x * 0.8, y: p.y * 0.6 });
  }, []);

  const onFaceTouchEnd = useCallback(
    (p: TouchPoint, start: TouchPoint, moved: boolean) => {
      if (holdTimer.current) {
        clearTimeout(holdTimer.current);
        holdTimer.current = null;
      }
      if (touchGazeTimer.current) clearTimeout(touchGazeTimer.current);
      touchGazeTimer.current = setTimeout(() => setGaze({ x: 0, y: 0 }), 1800);
      const dur = p.t - start.t;
      if (moved || dur >= 800) return; // deslizar o hold ya atendidos
      if (singingRef.current) return; // canto: sin SFX ni gestos que tapen la letra

      if (presenceRef.current === 'sleep') {
        setPresence('stay');
        presenceRef.current = 'stay';
        playSfx('wake');
        holdFace('LISTENING', 1600);
        return;
      }
      // Ojo → wink 1.4–1.8 s + tic + sonrisa. No dispara habla ni cuenta como toque.
      if (isEye(start)) {
        playSfx('wink');
        const side = start.x < 0 ? 'L' : 'R';
        setWinkSide(side);
        holdFace('SMILE', 1800);
        setTimeout(() => setWinkSide((cur) => (cur === side ? null : cur)), 1400 + Math.random() * 400);
        return;
      }
      // Toque de cara: tap + blink lento + squash
      playSfx('tap');
      setPokeSeq((n) => n + 1);
      const now = Date.now();
      recentTaps.current = [...recentTaps.current.filter((t) => now - t < 1400), now];
      const n = recentTaps.current.length;
      if (tapTimer.current) clearTimeout(tapTimer.current);
      if (n >= 4) {
        recentTaps.current = [];
        resolveTaps(4);
        return;
      }
      tapTimer.current = setTimeout(() => {
        tapTimer.current = null;
        const count = recentTaps.current.length;
        recentTaps.current = [];
        resolveTaps(count);
      }, 1400);
    },
    [holdFace, resolveTaps]
  );

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
        if (singingRef.current) {
          // Si el jefe habla, cortas. Se ignora lo que pueda ser la propia letra.
          const lyr = singingRef.current.lyrics.toLowerCase();
          const words = t.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
          const foreign = words.filter((w) => !lyr.includes(w));
          if (words.length >= 2 && foreign.length >= Math.ceil(words.length / 2)) {
            singingRef.current = null;
            void stopSpeaking();
          }
          return;
        }
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
    [handleCommand, say, user.name]
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

  const screenW = useRef(Dimensions.get('window').width);
  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => (screenW.current = window.width));
    return () => sub.remove();
  }, []);
  const pan = useRef(
    PanResponder.create({
      // menú solo desde el borde derecho: el resto de la pantalla es de la cara (deslizar = mirada)
      onMoveShouldSetPanResponderCapture: (e, g) => e.nativeEvent.pageX > screenW.current - 56 && g.dx < -14 && Math.abs(g.dx) > Math.abs(g.dy) * 1.2,
      onPanResponderRelease: (_, g) => {
        if (g.dx < -36) setMenuOpen(true);
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
      <UltronFace
        face={face}
        mode={mode}
        gazeX={gaze.x}
        gazeY={gaze.y}
        level={level}
        attack={attack}
        irritation={irritation}
        pokeSeq={pokeSeq}
        winkSide={winkSide}
        onTouchStart={onFaceTouchStart}
        onTouchMove={onFaceTouchMove}
        onTouchEnd={onFaceTouchEnd}
      />

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
        onSing={(id) => {
          setMenuOpen(false);
          const hook = HOOKS.find((h) => h.id === id);
          if (hook) void handleCommand(`canta ${hook.label}`);
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
