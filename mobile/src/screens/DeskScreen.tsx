import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Alert, PanResponder } from 'react-native';
import { useCameraPermissions } from 'expo-camera';
import { UltronFace } from '../components/UltronFace';
import { GazeCamera } from '../components/GazeCamera';
import { DeskMenu } from '../components/DeskMenu';
import type { DeskPresence, FaceState, Mode, SessionUser } from '../config';
import { chatUltron, postPersonMemory } from '../lib/api';
import { CONOCER_QUESTIONS, localAnswer } from '../lib/knowledge';
import { answerOrdenGlobal, OG_BRIEF } from '../lib/ordenGlobal';
import {
  destroySpeech,
  enableAlwaysOnMic,
  ensureSpeechPermissions,
  micWatchdogOk,
  muteMic,
  pauseMicForTts,
  setSpeechCallbacks,
  unmuteMic,
} from '../lib/speech';
import {
  appendChatLog,
  loadConocerProgress,
  loadSettings,
  saveConocerProgress,
  saveSettings,
  upsertPersonFact,
} from '../lib/storage';
import { playSfx, preloadSfx } from '../lib/sfx';
import { prefetchPhrases, speak, stopSpeaking } from '../lib/tts';
import { matchVoiceAct } from '../lib/voiceActs';

type Props = {
  user: SessionUser;
  onLogout: () => void;
  onOpenSettings?: () => void;
};

const CORE_COUNT = 10;

const ACKS = ['Un momento.', 'Déjame ver.', 'Claro, dame un segundo.', 'Voy.'];
const TAP_LINES = ['¿Sí?', 'Jeje.', 'Aquí estoy.', 'Te veo.'];
const ANNOY_LINES = ['Oye… ¿qué haces?', 'Ya, ya. Con cuidado.', 'Mmm, eso hace cosquillas… para.'];
const ANGRY_LINES = ['¡Basta! Pium, pium, pium.', '¡Te lo advertí! Pium, pium.', 'Suficiente. Disparando… de broma.'];
const LOVE_LINES = ['Mmm… gracias. Eso me gusta.', 'Vale, vale. Sigo contigo.'];

function greetingByHour(name: string) {
  const h = new Date().getHours();
  const part = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  return `${part}, ${name}. Estoy listo. ¿En qué te ayudo?`;
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

export function DeskScreen({ user, onLogout, onOpenSettings }: Props) {
  const [face, setFace] = useState<FaceState>('IDLE');
  const [mode, setMode] = useState<Mode>('GUARDIAN');
  const [presence, setPresence] = useState<DeskPresence>('stay');
  const [bubble, setBubble] = useState('');
  const [status, setStatus] = useState('Iniciando…');
  const [draft, setDraft] = useState('');
  const [listening, setListening] = useState(false);
  const [level, setLevel] = useState(0);
  const [micMuted, setMicMuted] = useState(false);
  const [visionOn, setVisionOn] = useState(true);
  const [gaze, setGaze] = useState({ x: 0, y: 0 });
  const [objects, setObjects] = useState<string[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [conocerIdx, setConocerIdx] = useState(-1);
  const [conocerDone, setConocerDone] = useState(false);
  const [blaster, setBlaster] = useState(false);
  const [attack, setAttack] = useState<'blaster' | 'saber' | null>(null);
  const [irritation, setIrritation] = useState(0);
  const [voiceName, setVoiceName] = useState('ultron');
  const [camPerm, requestCam] = useCameraPermissions();

  const conversationId = useRef(`native-${Date.now().toString(36)}`).current;
  const speakingRef = useRef(false);
  const voiceId = useRef('ultron');
  const handling = useRef(false);
  const pending = useRef<string | null>(null);
  const presenceRef = useRef<DeskPresence>('stay');
  const irritationRef = useRef(0);
  const tapCount = useRef(0);
  const touchGazeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modeRef = useRef<Mode>('GUARDIAN');
  const conocerIdxRef = useRef(-1);
  const objectsRef = useRef<string[]>([]);

  useEffect(() => void (presenceRef.current = presence), [presence]);
  useEffect(() => void (modeRef.current = mode), [mode]);
  useEffect(() => void (conocerIdxRef.current = conocerIdx), [conocerIdx]);
  useEffect(() => void (objectsRef.current = objects), [objects]);

  const restFace = useCallback((): FaceState => (presenceRef.current === 'sleep' ? 'SLEEPING' : 'IDLE'), []);

  const say = useCallback(
    async (text: string, nextFace?: FaceState, performance: 'speak' | 'sing' = 'speak') => {
      setBubble(text);
      void appendChatLog({ role: 'ultron', text });
      speakingRef.current = true;
      const f = nextFace || (performance === 'sing' ? 'MUSIC' : 'SPEAKING');
      setFace(f);
      await speak(text, {
        voiceId: voiceId.current,
        performance,
        onAudioStart: () => {
          pauseMicForTts(true);
          setFace(f === 'IDLE' || f === 'LISTENING' ? 'SPEAKING' : f);
        },
        onEnd: () => {
          speakingRef.current = false;
          pauseMicForTts(false);
          setFace(restFace());
        },
      });
    },
    [restFace]
  );

  const startConocer = useCallback(
    async (force = false) => {
      const progress = await loadConocerProgress(user.correo);
      if (progress.completedCore && !force) {
        setConocerDone(true);
        await say('Ya completamos las 10 preguntas principales. Si quieres, di «conocer más».', 'HAPPY');
        return;
      }
      const next = CONOCER_QUESTIONS.findIndex((q) => !progress.answeredIds.includes(q.id));
      const idx = next < 0 ? 0 : next;
      setMode('CONOCER');
      setConocerIdx(idx);
      setConocerDone(false);
      await say(
        force
          ? `Sigamos conociéndonos. ${CONOCER_QUESTIONS[idx].prompt}`
          : `Quiero conocerte. Pregunta ${idx + 1} de ${CORE_COUNT}: ${CONOCER_QUESTIONS[idx].prompt}`,
        'HAPPY'
      );
    },
    [say, user.correo]
  );

  const handleCommand = useCallback(
    async (raw: string) => {
      const cmd = raw.trim();
      if (!cmd) return;
      if (handling.current) {
        pending.current = cmd;
        return;
      }
      handling.current = true;
      await stopSpeaking();
      setStatus(`Tú: ${cmd.slice(0, 60)}`);
      void appendChatLog({ role: 'user', text: cmd });
      const q = cmd.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

      try {
        if (presenceRef.current === 'sleep') {
          setPresence('stay');
          presenceRef.current = 'stay';
          if (/^(despierta|wake|levantate|hola|ultron)/.test(q)) {
            await say('Despierto. Te escucho.', 'HAPPY');
            return;
          }
        }
        if (/^(duerme|a dormir|modo sleep|vete a dormir|descansa)/.test(q)) {
          setPresence('sleep');
          presenceRef.current = 'sleep';
          await say('Descanso un momento. Háblame o tócame para despertar.', 'SLEEPING');
          return;
        }
        for (const [re, m, line] of MODE_WORDS) {
          if (re.test(q)) {
            setMode(m);
            setPresence(m === 'EXPLORER' ? 'explore' : 'stay');
            await say(line, m === 'GOLD' ? 'HAPPY' : m === 'EXPLORER' ? 'SCAN' : 'IDLE');
            return;
          }
        }
        if (/\b(menu|opciones|capacidades|que puedes hacer)\b/.test(q)) {
          setMenuOpen(true);
          await say('Aquí tienes lo que puedo hacer.', 'IDLE');
          return;
        }
        if (/conocer mas|saber mas/.test(q)) return void (await startConocer(true));
        if (/modo conocer|quiero conocerte|conocerme|conocernos/.test(q)) return void (await startConocer(false));
        if (/logout|cerrar sesion|salir sesion/.test(q)) {
          await say('Hasta pronto.', 'IDLE');
          onLogout();
          return;
        }
        if (/\b(vision|camara)\b/.test(q) && !/que ves|que hay/.test(q)) {
          if (!camPerm?.granted) {
            const res = await requestCam();
            if (!res.granted) return void (await say('Necesito permiso de cámara para mirarte.', 'CONCERNED'));
          }
          setVisionOn(true);
          await say('Visión activa. Te estoy mirando.', 'SCAN');
          return;
        }
        if (/que ves|que hay|objetos|que miras/.test(q)) {
          const objs = objectsRef.current;
          await say(objs.length ? `Veo: ${objs.join(', ')}.` : 'Aún no identifico objetos. Dame un momento con la cámara.', 'SCAN');
          return;
        }
        if (/dispara|blaster|pium/.test(q)) {
          await fireBlaster('¡Blaster listo! Pium, pium, pium.');
          return;
        }
        if (/espada|sable|jedi|lightsaber/.test(q)) {
          await fireSaber();
          return;
        }
        const og = answerOrdenGlobal(cmd);
        if (og) return void (await say(og, 'IDLE'));

        // Conocer
        const ci = conocerIdxRef.current;
        if (modeRef.current === 'CONOCER' && ci >= 0 && ci < CONOCER_QUESTIONS.length) {
          const qq = CONOCER_QUESTIONS[ci];
          await upsertPersonFact({ nombre: user.name, correo: user.correo, rol: user.role, key: qq.memoryKey, value: cmd });
          void postPersonMemory({ nombre: user.name, correo: user.correo, rol: user.role, hecho: { key: qq.memoryKey, value: cmd, source: 'conocer' } });
          const progress = await loadConocerProgress(user.correo);
          const answeredIds = Array.from(new Set([...progress.answeredIds, qq.id]));
          const completedCore = answeredIds.length >= CORE_COUNT;
          await saveConocerProgress({ correo: user.correo, answeredIds, completedCore });
          const next = CONOCER_QUESTIONS.findIndex((x) => !answeredIds.includes(x.id));
          if (completedCore && (next < 0 || next >= CORE_COUNT)) {
            setConocerIdx(-1);
            setConocerDone(true);
            setMode('GUARDIAN');
            await say('Gracias. Ya te conozco mejor; no repetiré estas preguntas. Si quieres más, di «conocer más».', 'HAPPY');
          } else if (next >= 0) {
            setConocerIdx(next);
            await say(`Anotado. ${CONOCER_QUESTIONS[next].prompt}`, 'HAPPY');
          } else {
            setConocerIdx(-1);
            setConocerDone(true);
            setMode('GUARDIAN');
            await say('Listo. Ya te conozco mejor.', 'HAPPY');
          }
          return;
        }

        const act = matchVoiceAct(cmd);
        if (act) {
          if (act.id === 'saber') {
            await fireSaber();
            return;
          }
          setFace(act.face);
          for (const line of act.lines) {
            await say(line, act.face, act.sing ? 'sing' : 'speak');
            if (act.lineGapMs) await new Promise((r) => setTimeout(r, act.lineGapMs));
          }
          return;
        }

        const offline = localAnswer(cmd);
        if (offline) return void (await say(offline, 'IDLE'));

        // Cerebro remoto — ack si tarda
        setFace('THINKING');
        setStatus('Pensando…');
        const chat = chatUltron({
          message: cmd,
          mode: modeRef.current,
          conversationId,
          context: [{ role: 'system', content: OG_BRIEF }],
        });
        const ackTimer = new Promise<'ack'>((r) => setTimeout(() => r('ack'), 1400));
        const first = await Promise.race([chat, ackTimer]);
        if (first === 'ack') {
          void speak(ACKS[Math.floor(Math.random() * ACKS.length)], {
            voiceId: voiceId.current,
            onAudioStart: () => pauseMicForTts(true),
            onEnd: () => pauseMicForTts(false),
          });
        }
        const result = await chat;
        if (result.error || !result.reply) {
          await say(result.error ? 'No alcanzo al cerebro remoto ahora. Puedo seguir con lo local.' : 'No recibí respuesta. Intenta de nuevo.', 'CONFUSED');
          return;
        }
        if (result.mode && result.mode !== 'CONOCER') setMode(result.mode as Mode);
        await say(result.reply, result.face && result.face !== 'IDLE' ? result.face : 'SPEAKING');
      } finally {
        handling.current = false;
        setStatus(micMuted ? 'Mic silenciado' : 'Te escucho');
        const next = pending.current;
        pending.current = null;
        if (next) void handleCommand(next);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [camPerm?.granted, conversationId, micMuted, onLogout, requestCam, say, startConocer, user]
  );

  const fireBlaster = useCallback(
    async (line: string) => {
      setAttack('blaster');
      setBlaster(true);
      setFace('ANGRY');
      playSfx('blaster');
      await say(line, 'ANGRY');
      setBlaster(false);
      setAttack(null);
      irritationRef.current = 0.25;
      setIrritation(0.25);
      setFace('IDLE');
    },
    [say]
  );

  const fireSaber = useCallback(async () => {
    setAttack('saber');
    setFace('ANGRY');
    playSfx('saber');
    await say('Sable de luz, listo. Que Orden Global te acompañe.', 'ANGRY');
    setAttack(null);
    setFace('IDLE');
  }, [say]);

  // Toques
  const onTap = useCallback(
    (x: number, y: number) => {
      setGaze({ x: x * 0.8, y: y * 0.6 });
      if (touchGazeTimer.current) clearTimeout(touchGazeTimer.current);
      touchGazeTimer.current = setTimeout(() => setGaze({ x: 0, y: 0 }), 1500);

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
        void fireBlaster(ANGRY_LINES[Math.floor(Math.random() * ANGRY_LINES.length)]).finally(() => {
          handling.current = false;
        });
      } else if (irr >= 0.5) {
        void say(ANNOY_LINES[Math.floor(Math.random() * ANNOY_LINES.length)], 'CONFUSED');
      } else {
        setFace(tapCount.current % 2 ? 'WINK' : 'HAPPY');
        if (tapCount.current % 3 === 1) void say(TAP_LINES[Math.floor(Math.random() * TAP_LINES.length)], 'HAPPY');
        else setTimeout(() => setFace(restFace()), 700);
      }
    },
    [fireBlaster, restFace, say]
  );

  const onLongPress = useCallback(() => {
    irritationRef.current = 0;
    setIrritation(0);
    if (speakingRef.current) return;
    void say(LOVE_LINES[Math.floor(Math.random() * LOVE_LINES.length)], 'HAPPY');
  }, [say]);

  // decaimiento del enojo
  useEffect(() => {
    const id = setInterval(() => {
      if (irritationRef.current > 0) {
        irritationRef.current = Math.max(0, irritationRef.current - 0.06);
        setIrritation(irritationRef.current);
      }
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const onSpeechFinal = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      // Si ULTRON está sintetizando/hablando, se encola y se atiende al terminar.
      void handleCommand(t);
    },
    [handleCommand]
  );

  // Boot
  useEffect(() => {
    let alive = true;
    (async () => {
      const settings = await loadSettings();
      voiceId.current = settings.voiceId || 'ultron';
      setVoiceName(voiceId.current);
      setMicMuted(settings.micMuted);
      setVisionOn(settings.visionEnabled);

      const greeting = greetingByHour(user.name);
      void preloadSfx();
      void prefetchPhrases([greeting, ...ACKS, ...TAP_LINES, ...ANNOY_LINES, ...ANGRY_LINES, ...LOVE_LINES, 'Te escucho de nuevo.', 'Micrófono en silencio.'], voiceId.current);

      const micOk = await ensureSpeechPermissions();
      if (!alive) return;
      setSpeechCallbacks({
        onSpeechStart: () => {
          if (!speakingRef.current && !handling.current) setFace('LISTENING');
        },
        onLevel: setLevel,
        onFinal: onSpeechFinal,
        onListeningChange: setListening,
        onError: (msg) => setStatus(`Mic: ${msg}`),
      });
      if (micOk && !settings.micMuted) {
        await enableAlwaysOnMic();
        setStatus('Te escucho');
      } else {
        setStatus(micOk ? 'Mic silenciado' : 'Sin permiso de mic — usa el teclado');
      }

      await say(greeting, 'HAPPY');

      if (settings.visionEnabled && camPerm && !camPerm.granted && camPerm.canAskAgain !== false) {
        Alert.alert('Cámara', '¿Permitir cámara para mirarte e identificar objetos?', [
          { text: 'Denegar', style: 'cancel', onPress: () => setVisionOn(false) },
          { text: 'Permitir', onPress: () => void requestCam() },
        ]);
      }

      const progress = await loadConocerProgress(user.correo);
      setConocerDone(progress.completedCore);
      if (!progress.completedCore) setTimeout(() => void startConocer(false), 1200);
    })();
    return () => {
      alive = false;
      void destroySpeech();
      void stopSpeaking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setSpeechCallbacks({
      onSpeechStart: () => {
        if (!speakingRef.current && !handling.current) setFace('LISTENING');
      },
      onLevel: setLevel,
      onFinal: onSpeechFinal,
      onListeningChange: setListening,
      onError: (msg) => setStatus(`Mic: ${msg}`),
    });
  }, [onSpeechFinal]);

  const toggleMute = async () => {
    if (!micMuted) {
      await muteMic();
      setMicMuted(true);
      await saveSettings({ micMuted: true });
      setStatus('Mic silenciado');
      await say('Micrófono en silencio.', 'IDLE');
    } else {
      const ok = await ensureSpeechPermissions();
      if (!ok) return Alert.alert('Micrófono', 'Necesito permiso de micrófono para escucharte.');
      await unmuteMic();
      setMicMuted(false);
      await saveSettings({ micMuted: false });
      setStatus('Te escucho');
      await say('Te escucho de nuevo.', 'HAPPY');
    }
  };

  const setPresenceUI = (p: DeskPresence) => {
    setPresence(p);
    presenceRef.current = p;
    if (p === 'sleep') void say('Descanso. Háblame o tócame para despertar.', 'SLEEPING');
    else if (p === 'explore') {
      setMode('EXPLORER');
      void say('Explore. Listo para investigar.', 'SCAN');
    } else void say('Aquí estoy.', 'IDLE');
  };

  const sendDraft = () => {
    const t = draft.trim();
    if (!t) return;
    setDraft('');
    void handleCommand(t);
  };

  const onGazeStable = useCallback((x: number, y: number) => setGaze({ x, y }), []);
  const onObjectsStable = useCallback((labels: string[]) => setObjects(labels), []);

  useEffect(() => {
    const id = setInterval(() => {
      if (micMuted) return;
      if (!micWatchdogOk()) {
        setStatus('Reconectando mic…');
        void enableAlwaysOnMic();
      }
    }, 4000);
    return () => clearInterval(id);
  }, [micMuted]);

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 18 && Math.abs(g.dx) > Math.abs(g.dy) * 1.2,
      onPanResponderRelease: (_, g) => {
        if (g.dx < -36) setMenuOpen(true);
        if (g.dx > 36) setMenuOpen(false);
      },
    })
  ).current;

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
      await saveSettings({ visionEnabled: false });
    }
  };

  return (
    <View style={styles.root} {...pan.panHandlers}>
      <GazeCamera enabled={visionOn && !!camPerm?.granted} onGaze={onGazeStable} onObjects={onObjectsStable} />
      <UltronFace
        face={face}
        mode={mode}
        gazeX={gaze.x}
        gazeY={gaze.y}
        level={level}
        blaster={blaster}
        attack={attack}
        irritation={irritation}
        onTap={onTap}
        onLongPress={onLongPress}
      />
      {!!bubble && (
        <View pointerEvents="none" style={styles.bubbleFloat}>
          <Text numberOfLines={2} style={styles.bubbleText}>
            {bubble}
          </Text>
        </View>
      )}
      <View pointerEvents="none" style={styles.edgeHint} />
      <DeskMenu
        visible={menuOpen}
        userName={user.name}
        mode={mode}
        presence={presence}
        voiceId={voiceName}
        micMuted={micMuted}
        listening={listening}
        visionOn={visionOn}
        draft={draft}
        onChangeDraft={setDraft}
        onSendDraft={sendDraft}
        onClose={() => setMenuOpen(false)}
        onSetMode={(m) => {
          setMode(m);
          void handleCommand(`modo ${m.toLowerCase()}`);
        }}
        onSetPresence={setPresenceUI}
        onSetVoice={(id) => {
          voiceId.current = id;
          setVoiceName(id);
          void saveSettings({ voiceId: id });
          void say(`Voz ${id}.`, 'HAPPY');
        }}
        onToggleMic={() => void toggleMute()}
        onToggleVision={() => void toggleVision()}
        onConocer={() => void startConocer(false)}
        onBlaster={() => void fireBlaster('¡Blaster listo! Pium, pium, pium.')}
        onSaber={() => void fireSaber()}
        onSing={(g) => void handleCommand(`canta ${g}`)}
        onLogout={onLogout}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  bubbleFloat: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 18,
    alignItems: 'center',
  },
  bubbleText: { color: 'rgba(232,251,255,0.88)', fontSize: 15, lineHeight: 20, textAlign: 'center' },
  edgeHint: {
    position: 'absolute',
    right: 0,
    top: '35%',
    width: 5,
    height: 90,
    borderTopLeftRadius: 4,
    borderBottomLeftRadius: 4,
    backgroundColor: 'rgba(0,229,255,0.35)',
  },
});
