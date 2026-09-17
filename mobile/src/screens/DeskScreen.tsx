import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  Platform,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { UltronFace } from '../components/UltronFace';
import type { DeskPresence, FaceState, Mode, SessionUser } from '../config';
import { APP_VERSION } from '../config';
import { chatUltron, postPersonMemory } from '../lib/api';
import { CONOCER_QUESTIONS, localAnswer } from '../lib/knowledge';
import {
  abortListening,
  ensureSpeechPermissions,
  startListening,
  stopListening,
  useSpeechRecognitionEvent,
} from '../lib/speech';
import {
  appendChatLog,
  loadSettings,
  markConocerOfferedToday,
  upsertPersonFact,
  wasConocerOfferedToday,
} from '../lib/storage';
import { speak, stopSpeaking } from '../lib/tts';
import { matchVoiceAct } from '../lib/voiceActs';
import { isHeyUltron, stripHeyUltron } from '../lib/wakeWord';

type Props = {
  user: SessionUser;
  onLogout: () => void;
  onOpenSettings: () => void;
};

export function DeskScreen({ user, onLogout, onOpenSettings }: Props) {
  const [face, setFace] = useState<FaceState>('IDLE');
  const [mode, setMode] = useState<Mode>('GUARDIAN');
  const [presence, setPresence] = useState<DeskPresence>('stay');
  const [bubble, setBubble] = useState('');
  const [status, setStatus] = useState('Listo');
  const [draft, setDraft] = useState('');
  const [listening, setListening] = useState(false);
  const [booting, setBooting] = useState(true);
  const [showVision, setShowVision] = useState(false);
  const [conocerIdx, setConocerIdx] = useState(-1);
  const [camPerm, requestCam] = useCameraPermissions();
  const conversationId = useRef(`native-${Date.now().toString(36)}`).current;
  const listenMode = useRef<'wake' | 'command'>('wake');
  const speakingRef = useRef(false);
  const voiceId = useRef('jarvis');
  const handling = useRef(false);

  const say = useCallback(async (text: string, nextFace?: FaceState) => {
    setBubble(text);
    await appendChatLog({ role: 'ultron', text });
    speakingRef.current = true;
    if (nextFace) setFace(nextFace);
    else setFace('SPEAKING');
    await speak(text, {
      voiceId: voiceId.current,
      onStart: () => setFace(nextFace || 'SPEAKING'),
      onEnd: () => {
        speakingRef.current = false;
        setFace((f) => (f === 'SPEAKING' || f === nextFace ? (presence === 'sleep' ? 'SLEEPING' : 'LISTENING') : f));
      },
    });
  }, [presence]);

  const handleCommand = useCallback(
    async (raw: string) => {
      const cmd = raw.trim();
      if (!cmd || handling.current) return;
      handling.current = true;
      setStatus(`Comando: ${cmd.slice(0, 48)}`);
      await appendChatLog({ role: 'user', text: cmd });

      try {
        // Presence shortcuts
        if (/^(duerme|a dormir|modo sleep|vete a dormir)/i.test(cmd)) {
          setPresence('sleep');
          setFace('SLEEPING');
          listenMode.current = 'wake';
          await say('Modo sleep. Di hey ULTRON para despertarme.', 'SLEEPING');
          return;
        }
        if (/^(despierta|wake|levantate|modo stay)/i.test(cmd)) {
          setPresence('stay');
          await say('Despierto. Te escucho.', 'HAPPY');
          return;
        }
        if (/modo explore|explorar/i.test(cmd)) {
          setPresence('explore');
          setMode('EXPLORER');
          await say('Modo explore. Listo para investigar.', 'SCAN');
          return;
        }
        if (/modo guardian/i.test(cmd)) {
          setMode('GUARDIAN');
          await say('Modo GUARDIAN activo.', 'IDLE');
          return;
        }
        if (/modo conocer|conocerme|conocernos/i.test(cmd)) {
          setMode('CONOCER');
          setConocerIdx(0);
          await say(CONOCER_QUESTIONS[0].prompt, 'HAPPY');
          return;
        }
        if (/logout|cerrar sesion|cerrar sesión|salir sesion/i.test(cmd)) {
          await say('Cerrando sesión. Hasta pronto.', 'IDLE');
          onLogout();
          return;
        }
        if (/camara|cámara|vision|visión/i.test(cmd)) {
          if (!camPerm?.granted) await requestCam();
          setShowVision((v) => !v);
          await say(showVision ? 'Visión desactivada.' : 'Visión activada.', 'SCAN');
          return;
        }

        // Conocer answers
        if (mode === 'CONOCER' && conocerIdx >= 0 && conocerIdx < CONOCER_QUESTIONS.length) {
          const q = CONOCER_QUESTIONS[conocerIdx];
          await upsertPersonFact({
            nombre: user.name,
            correo: user.correo,
            rol: user.role,
            key: q.memoryKey,
            value: cmd,
          });
          await postPersonMemory({
            nombre: user.name,
            correo: user.correo,
            rol: user.role,
            hecho: { key: q.memoryKey, value: cmd, source: 'conocer' },
          });
          const next = conocerIdx + 1;
          if (next >= CONOCER_QUESTIONS.length) {
            setConocerIdx(-1);
            setMode('GUARDIAN');
            await say('Gracias. Ya te conozco mejor. Lo guardé en memoria local y en el servidor.', 'HAPPY');
          } else {
            setConocerIdx(next);
            await say(`Anotado. ${CONOCER_QUESTIONS[next].prompt}`, 'LISTENING');
          }
          return;
        }

        const act = matchVoiceAct(cmd);
        if (act) {
          setFace(act.face);
          for (let i = 0; i < act.lines.length; i++) {
            await say(act.lines[i], act.face);
            if (act.lineGapMs) await new Promise((r) => setTimeout(r, act.lineGapMs));
          }
          return;
        }

        const offline = localAnswer(cmd);
        if (offline) {
          await say(offline, 'IDLE');
          return;
        }

        setFace('THINKING');
        setStatus('Pensando…');
        const result = await chatUltron({ message: cmd, mode, conversationId });
        if (result.error || !result.reply) {
          await say(
            result.error
              ? `Sin cerebro remoto (${result.error}). Prueba gestos de voz o preguntas locales.`
              : 'No recibí respuesta. Intenta de nuevo.',
            'CONFUSED'
          );
          return;
        }
        if (result.mode) setMode(result.mode as Mode);
        if (result.face) setFace(result.face);
        await say(result.reply, result.face || 'SPEAKING');
      } finally {
        handling.current = false;
        listenMode.current = presence === 'sleep' ? 'wake' : 'command';
      }
    },
    [camPerm?.granted, conocerIdx, mode, onLogout, presence, requestCam, say, showVision, user]
  );

  // Speech events
  useSpeechRecognitionEvent('result', (ev) => {
    const text = ev.results?.[0]?.transcript || ev.transcript || '';
    if (!text) return;

    if (presence === 'sleep' || listenMode.current === 'wake') {
      if (ev.isFinal === false) return;
      if (isHeyUltron(text)) {
        setPresence('stay');
        listenMode.current = 'command';
        setFace('LISTENING');
        const rest = stripHeyUltron(text);
        void say('Te escucho.', 'LISTENING').then(() => {
          if (rest.length > 2) void handleCommand(rest);
        });
      }
      return;
    }

    if (speakingRef.current) return;

    if (ev.isFinal === false) {
      setStatus(text.slice(0, 60));
      setFace('LISTENING');
      return;
    }
    const cmd = isHeyUltron(text) ? stripHeyUltron(text) : text;
    if (cmd.length > 1) void handleCommand(cmd);
  });

  useSpeechRecognitionEvent('start', () => setListening(true));
  useSpeechRecognitionEvent('end', () => setListening(false));
  useSpeechRecognitionEvent('error', (e) => {
    setListening(false);
    if (e?.error) setStatus(`Mic: ${e.error}`);
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      const settings = await loadSettings();
      voiceId.current = settings.voiceId || 'jarvis';
      await ensureSpeechPermissions();
      if (!alive) return;
      setBooting(false);
      setFace('HAPPY');
      await say(
        `Bienvenido, ${user.name}. ULTRON FP nativo listo. Escribe comandos abajo — la voz TTS responde.`,
        'HAPPY'
      );
      listenMode.current = 'command';
      setFace('LISTENING');
      setStatus('Escribe un comando (quién eres, ponte feliz, modo conocer…)');
      if (!(await wasConocerOfferedToday())) {
        await markConocerOfferedToday();
        setTimeout(() => {
          void say('Si quieres, escribe «modo conocer» y te haré unas preguntas.', 'IDLE');
        }, 3500);
      }
    })();
    return () => {
      alive = false;
      abortListening();
      void stopSpeaking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendDraft = () => {
    const t = draft.trim();
    if (!t) return;
    setDraft('');
    void handleCommand(t);
  };

  return (
    <View style={styles.root}>
      <View style={styles.topBar}>
        <Text style={styles.brand}>ULTRON FP</Text>
        <Text style={styles.meta}>
          {mode} · {presence} · v{APP_VERSION}
          {listening ? ' · MIC' : ''}
        </Text>
        <View style={styles.topActions}>
          <Pressable onPress={onOpenSettings} style={styles.chip}>
            <Text style={styles.chipText}>Ajustes</Text>
          </Pressable>
          <Pressable onPress={onLogout} style={styles.chip}>
            <Text style={styles.chipText}>Salir</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.stage}>
        <UltronFace face={face} />
        {showVision && camPerm?.granted && (
          <View style={styles.camBox}>
            <CameraView style={StyleSheet.absoluteFill} facing="front" />
          </View>
        )}
      </View>

      {!!bubble && (
        <View style={styles.bubble}>
          <ScrollView style={{ maxHeight: 72 }}>
            <Text style={styles.bubbleText}>{bubble}</Text>
          </ScrollView>
        </View>
      )}

      <Text style={styles.status}>{status}</Text>

      <View style={styles.dock}>
        <Pressable
          onPress={() => {
            setPresence('sleep');
            setFace('SLEEPING');
            listenMode.current = 'wake';
            void say('Sleep.', 'SLEEPING');
          }}
          style={styles.dockBtn}
        >
          <Text style={styles.dockText}>Sleep</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            setPresence('stay');
            listenMode.current = 'command';
            setFace('LISTENING');
            startListening({ continuous: true });
            void say('Stay.', 'LISTENING');
          }}
          style={[styles.dockBtn, presence === 'stay' && styles.dockOn]}
        >
          <Text style={styles.dockText}>Stay</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            setPresence('explore');
            setMode('EXPLORER');
            void say('Explore.', 'SCAN');
          }}
          style={[styles.dockBtn, presence === 'explore' && styles.dockOn]}
        >
          <Text style={styles.dockText}>Explore</Text>
        </Pressable>
        <Pressable
          onPress={async () => {
            if (!camPerm?.granted) await requestCam();
            setShowVision((v) => !v);
          }}
          style={[styles.dockBtn, showVision && styles.dockOn]}
        >
          <Text style={styles.dockText}>Visión</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            if (listening) stopListening();
            else startListening({ continuous: true });
          }}
          style={[styles.dockBtn, listening && styles.dockOn]}
        >
          <Text style={styles.dockText}>{listening ? 'Mic·ON' : 'Mic'}</Text>
        </Pressable>
      </View>

      <View style={styles.composer}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Escribe un comando…"
          placeholderTextColor="#5A6A7A"
          style={styles.input}
          onSubmitEditing={sendDraft}
          returnKeyType="send"
        />
        <Pressable onPress={sendDraft} style={styles.send}>
          <Text style={styles.sendText}>Enviar</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  brand: { color: '#E8FBFF', fontWeight: '800', letterSpacing: 4, fontSize: 14 },
  meta: { color: '#5A6A7A', fontSize: 11, flex: 1, fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier' },
  topActions: { flexDirection: 'row', gap: 8 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  chipText: { color: '#C8D4DE', fontSize: 12 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  camBox: {
    position: 'absolute',
    right: 8,
    top: 8,
    width: 120,
    height: 90,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(0,229,255,0.35)',
  },
  bubble: {
    alignSelf: 'center',
    maxWidth: '90%',
    backgroundColor: 'rgba(10,14,20,0.92)',
    borderColor: 'rgba(0,229,255,0.25)',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 4,
  },
  bubbleText: { color: '#E8FBFF', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  status: { color: '#5A6A7A', fontSize: 11, textAlign: 'center', marginBottom: 6 },
  dock: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' },
  dockBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  dockOn: { borderColor: 'rgba(0,229,255,0.5)', backgroundColor: 'rgba(0,229,255,0.12)' },
  dockText: { color: '#C8D4DE', fontSize: 12, fontWeight: '600' },
  composer: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'rgba(0,229,255,0.22)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#E8FBFF',
    backgroundColor: 'rgba(10,14,20,0.9)',
  },
  send: {
    backgroundColor: '#00E5FF',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  sendText: { color: '#001018', fontWeight: '800' },
});
