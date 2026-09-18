import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Platform, Alert } from 'react-native';
import { useCameraPermissions } from 'expo-camera';
import { UltronFace } from '../components/UltronFace';
import { GazeCamera } from '../components/GazeCamera';
import { CapabilitiesMenu } from '../components/CapabilitiesMenu';
import type { DeskPresence, FaceState, Mode, SessionUser } from '../config';
import { APP_VERSION } from '../config';
import { chatUltron, postPersonMemory } from '../lib/api';
import { CONOCER_QUESTIONS, localAnswer } from '../lib/knowledge';
import {
  destroySpeech,
  enableAlwaysOnMic,
  ensureSpeechPermissions,
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
import { prefetchPhrases, speak, stopSpeaking } from '../lib/tts';
import { matchVoiceAct } from '../lib/voiceActs';

type Props = {
  user: SessionUser;
  onLogout: () => void;
  onOpenSettings: () => void;
};

const CORE_COUNT = 10;
const CYAN = '#00E5FF';

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
  const [irritation, setIrritation] = useState(0);
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
    async (text: string, nextFace?: FaceState) => {
      setBubble(text);
      void appendChatLog({ role: 'ultron', text });
      speakingRef.current = true;
      const f = nextFace || 'SPEAKING';
      setFace(f);
      await speak(text, {
        voiceId: voiceId.current,
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
          setFace(act.face);
          for (const line of act.lines) {
            await say(line, act.face);
            if (act.lineGapMs) await new Promise((r) => setTimeout(r, act.lineGapMs));
          }
          return;
        }

        const offline = localAnswer(cmd);
        if (offline) return void (await say(offline, 'IDLE'));

        // Cerebro remoto — ack si tarda
        setFace('THINKING');
        setStatus('Pensando…');
        const chat = chatUltron({ message: cmd, mode: modeRef.current, conversationId });
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
      setBlaster(true);
      setFace('ANGRY');
      await say(line, 'ANGRY');
      setBlaster(false);
      irritationRef.current = 0.25;
      setIrritation(0.25);
      setFace('IDLE');
    },
    [say]
  );

  // Toques
  const onTap = useCallback(
    (x: number, y: number) => {
      setGaze({ x: x * 0.8, y: y * 0.6 });
      if (touchGazeTimer.current) clearTimeout(touchGazeTimer.current);
      touchGazeTimer.current = setTimeout(() => setGaze({ x: 0, y: 0 }), 1500);

      if (presenceRef.current === 'sleep') {
        setPresence('stay');
        presenceRef.current = 'stay';
        void say('Ya despierto.', 'STARTLE');
        return;
      }
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
      setMicMuted(settings.micMuted);
      setVisionOn(settings.visionEnabled);

      const greeting = greetingByHour(user.name);
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

  const micLabel = micMuted ? 'Mic off' : listening ? 'Oyendo' : 'Mic';

  return (
    <View style={styles.root}>
      <GazeCamera enabled={visionOn && !!camPerm?.granted} onGaze={onGazeStable} onObjects={onObjectsStable} />

      <View style={styles.topBar}>
        <View style={styles.brandChip}>
          <View style={[styles.dot, { backgroundColor: listening && !micMuted ? CYAN : '#3A4A5A' }]} />
          <Text style={styles.brand}>ULTRON FP</Text>
        </View>
        <View style={styles.userChip}>
          <Text style={styles.userText}>{user.name}</Text>
        </View>
        <Text style={styles.meta}>{mode}</Text>
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => setMenuOpen(true)} style={styles.iconBtn}>
          <Text style={styles.iconText}>Menú</Text>
        </Pressable>
        <Pressable onPress={onOpenSettings} style={styles.iconBtn}>
          <Text style={styles.iconText}>Ajustes</Text>
        </Pressable>
      </View>

      <View style={styles.stage}>
        <UltronFace
          face={face}
          mode={mode}
          gazeX={gaze.x}
          gazeY={gaze.y}
          level={level}
          blaster={blaster}
          irritation={irritation}
          onTap={onTap}
          onLongPress={onLongPress}
        />
        {visionOn && camPerm?.granted && !!objects.length && (
          <View style={styles.visionBadge}>
            <Text style={styles.visionBadgeText}>{objects.slice(0, 3).join(' · ')}</Text>
          </View>
        )}
      </View>

      <View style={styles.bubbleRow}>
        <Text numberOfLines={2} style={styles.bubbleText}>
          {bubble}
        </Text>
        <Text style={styles.status}>
          {status}
          {!conocerDone && conocerIdx >= 0 ? ` · Conociéndote ${Math.min(conocerIdx + 1, CORE_COUNT)}/${CORE_COUNT}` : ''}
        </Text>
      </View>

      <View style={styles.bottom}>
        <View style={styles.dock}>
          {(['sleep', 'stay', 'explore'] as DeskPresence[]).map((p) => (
            <Pressable key={p} onPress={() => setPresenceUI(p)} style={[styles.dockBtn, presence === p && styles.dockOn]}>
              <Text style={[styles.dockText, presence === p && { color: CYAN }]}>{p}</Text>
            </Pressable>
          ))}
          <Pressable
            onPress={async () => {
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
            }}
            style={[styles.dockBtn, visionOn && styles.dockOn]}
          >
            <Text style={[styles.dockText, visionOn && { color: CYAN }]}>visión</Text>
          </Pressable>
          <Pressable onPress={() => void toggleMute()} style={[styles.dockBtn, !micMuted && styles.dockOn]}>
            <Text style={[styles.dockText, !micMuted && { color: CYAN }]}>{micLabel.toLowerCase()}</Text>
          </Pressable>
        </View>
        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Escribe o simplemente habla…"
            placeholderTextColor="#4A5A6A"
            style={styles.input}
            onSubmitEditing={sendDraft}
            returnKeyType="send"
          />
          <Pressable onPress={sendDraft} style={styles.send}>
            <Text style={styles.sendText}>Enviar</Text>
          </Pressable>
        </View>
        <Text style={styles.version}>v{APP_VERSION}</Text>
      </View>

      <CapabilitiesMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        onStartConocer={() => void startConocer(false)}
        onEnableVision={() => {
          setVisionOn(true);
          void requestCam();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000', paddingHorizontal: 14, paddingTop: 6, paddingBottom: 6 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(0,229,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0,229,255,0.25)',
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  brand: { color: '#E8FBFF', fontWeight: '800', letterSpacing: 2, fontSize: 12 },
  userChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  userText: { color: '#C8D4DE', fontSize: 12 },
  meta: { color: '#4A5A6A', fontSize: 11, letterSpacing: 2, fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier' },
  iconBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  iconText: { color: '#C8D4DE', fontSize: 12 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  visionBadge: {
    position: 'absolute',
    right: 4,
    top: 4,
    maxWidth: 200,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(0,20,28,0.75)',
    borderWidth: 1,
    borderColor: 'rgba(0,229,255,0.25)',
  },
  visionBadgeText: { color: '#8B9AAB', fontSize: 10 },
  bubbleRow: { alignItems: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 20 },
  bubbleText: { color: '#E8FBFF', fontSize: 15, lineHeight: 20, textAlign: 'center' },
  status: { color: '#4A5A6A', fontSize: 11, textAlign: 'center', marginTop: 2 },
  bottom: { gap: 6 },
  dock: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dockBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.03)' },
  dockOn: { borderColor: 'rgba(0,229,255,0.45)', backgroundColor: 'rgba(0,229,255,0.1)' },
  dockText: { color: '#9AAABA', fontSize: 12, fontWeight: '600', letterSpacing: 1 },
  composer: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { flex: 1, borderWidth: 1, borderColor: 'rgba(0,229,255,0.2)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, color: '#E8FBFF', backgroundColor: 'rgba(10,14,20,0.9)' },
  send: { backgroundColor: CYAN, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  sendText: { color: '#001018', fontWeight: '800' },
  version: { color: '#2A3A4A', fontSize: 9, textAlign: 'right' },
});
