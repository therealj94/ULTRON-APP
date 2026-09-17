import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  Platform,
  Alert,
} from 'react-native';
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
  isMicWanted,
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
import { speak, stopSpeaking } from '../lib/tts';
import { matchVoiceAct } from '../lib/voiceActs';
import { isHeyUltron, stripHeyUltron } from '../lib/wakeWord';

type Props = {
  user: SessionUser;
  onLogout: () => void;
  onOpenSettings: () => void;
};

const CORE_COUNT = 10;

export function DeskScreen({ user, onLogout, onOpenSettings }: Props) {
  const [face, setFace] = useState<FaceState>('IDLE');
  const [mode, setMode] = useState<Mode>('GUARDIAN');
  const [presence, setPresence] = useState<DeskPresence>('stay');
  const [bubble, setBubble] = useState('');
  const [status, setStatus] = useState('Preparando micrófono…');
  const [draft, setDraft] = useState('');
  const [listening, setListening] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [visionOn, setVisionOn] = useState(true);
  const [gaze, setGaze] = useState({ x: 0, y: 0 });
  const [objects, setObjects] = useState<string[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [conocerIdx, setConocerIdx] = useState(-1);
  const [conocerDone, setConocerDone] = useState(false);
  const [camPerm, requestCam] = useCameraPermissions();
  const conversationId = useRef(`native-${Date.now().toString(36)}`).current;
  const listenMode = useRef<'wake' | 'command'>('command');
  const speakingRef = useRef(false);
  const voiceId = useRef('jarvis');
  const handling = useRef(false);
  const presenceRef = useRef<DeskPresence>('stay');
  const partialRef = useRef('');

  useEffect(() => {
    presenceRef.current = presence;
  }, [presence]);

  const say = useCallback(async (text: string, nextFace?: FaceState) => {
    setBubble(text);
    await appendChatLog({ role: 'ultron', text });
    speakingRef.current = true;
    pauseMicForTts(true);
    if (nextFace) setFace(nextFace);
    else setFace('SPEAKING');
    await speak(text, {
      voiceId: voiceId.current,
      onStart: () => setFace(nextFace || 'SPEAKING'),
      onEnd: () => {
        speakingRef.current = false;
        pauseMicForTts(false);
        setFace((f) =>
          f === 'SPEAKING' || f === nextFace
            ? presenceRef.current === 'sleep'
              ? 'SLEEPING'
              : 'LISTENING'
            : f
        );
      },
    });
  }, []);

  const startConocer = useCallback(
    async (force = false) => {
      const progress = await loadConocerProgress(user.correo);
      if (progress.completedCore && !force) {
        setConocerDone(true);
        await say(
          'Ya completamos las 10 preguntas principales. Si quieres saber más, escribe «conocer más».',
          'HAPPY'
        );
        return;
      }
      const next = CONOCER_QUESTIONS.findIndex((q) => !progress.answeredIds.includes(q.id));
      const idx = next < 0 ? 0 : next;
      setMode('CONOCER');
      setConocerIdx(idx);
      setConocerDone(false);
      listenMode.current = 'command';
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
      if (!cmd || handling.current) return;
      handling.current = true;
      setStatus(`Tú: ${cmd.slice(0, 52)}`);
      await appendChatLog({ role: 'user', text: cmd });

      try {
        if (/^(duerme|a dormir|modo sleep|vete a dormir)/i.test(cmd)) {
          setPresence('sleep');
          setFace('SLEEPING');
          listenMode.current = 'wake';
          await say('Modo sleep. Di hey ULTRON para despertarme.', 'SLEEPING');
          return;
        }
        if (/^(despierta|wake|levantate|modo stay)/i.test(cmd)) {
          setPresence('stay');
          listenMode.current = 'command';
          await say('Despierto. Te escucho.', 'HAPPY');
          return;
        }
        if (/modo explore|explorar/i.test(cmd)) {
          setPresence('explore');
          setMode('EXPLORER');
          listenMode.current = 'command';
          await say('Modo explore. Listo para investigar.', 'SCAN');
          return;
        }
        if (/menu|menú|opciones|capacidades|que puedes|qué puedes/i.test(cmd)) {
          setMenuOpen(true);
          await say('Aquí tienes el menú de capacidades.', 'IDLE');
          return;
        }
        if (/conocer mas|conocer más|saber mas|saber más/i.test(cmd)) {
          await startConocer(true);
          return;
        }
        if (/modo conocer|quiero conocerte|conocerme|conocernos/i.test(cmd)) {
          await startConocer(false);
          return;
        }
        if (/logout|cerrar sesion|cerrar sesión|salir sesion/i.test(cmd)) {
          await say('Hasta pronto.', 'IDLE');
          onLogout();
          return;
        }
        if (/vision|visión|camara|cámara/i.test(cmd)) {
          if (!camPerm?.granted) {
            const res = await requestCam();
            if (!res.granted) {
              await say('Necesito permiso de cámara. Actívalo cuando puedas.', 'CONCERNED');
              return;
            }
          }
          setVisionOn(true);
          await say('Visión activa. Te estoy mirando.', 'SCAN');
          return;
        }
        if (/que ves|qué ves|que hay|qué hay|objetos/i.test(cmd)) {
          if (objects.length) {
            await say(`Veo: ${objects.join(', ')}.`, 'SCAN');
          } else {
            await say('Aún no identifiqué objetos. Mantén la cámara un momento.', 'THINKING');
          }
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
          const progress = await loadConocerProgress(user.correo);
          const answeredIds = Array.from(new Set([...progress.answeredIds, q.id]));
          const completedCore = answeredIds.length >= CORE_COUNT;
          await saveConocerProgress({
            correo: user.correo,
            answeredIds,
            completedCore,
          });

          const next = CONOCER_QUESTIONS.findIndex((qq) => !answeredIds.includes(qq.id));
          if (completedCore && (next < 0 || next >= CORE_COUNT)) {
            setConocerIdx(-1);
            setConocerDone(true);
            setMode('GUARDIAN');
            await say(
              'Gracias. Completamos las 10 preguntas. No te las volveré a pedir. Si quieres más, di «conocer más».',
              'HAPPY'
            );
          } else if (next >= 0) {
            setConocerIdx(next);
            await say(`Anotado. Pregunta ${answeredIds.length + 1}: ${CONOCER_QUESTIONS[next].prompt}`, 'LISTENING');
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
              ? `Sin cerebro remoto ahora. Prueba gestos o preguntas locales. (${result.error})`
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
        if (presenceRef.current !== 'sleep') listenMode.current = 'command';
      }
    },
    [
      camPerm?.granted,
      conocerIdx,
      conversationId,
      mode,
      objects,
      onLogout,
      requestCam,
      say,
      startConocer,
      user,
    ]
  );

  const onSpeechFinal = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t || speakingRef.current) return;

      if (presenceRef.current === 'sleep' || listenMode.current === 'wake') {
        if (isHeyUltron(t)) {
          setPresence('stay');
          listenMode.current = 'command';
          const rest = stripHeyUltron(t);
          void say('Te escucho.', 'LISTENING').then(() => {
            if (rest.length > 2) void handleCommand(rest);
          });
        }
        return;
      }

      if (isHeyUltron(t)) {
        const rest = stripHeyUltron(t);
        if (rest.length > 2) void handleCommand(rest);
        else void say('Dime.', 'LISTENING');
        return;
      }
      if (t.length > 1) void handleCommand(t);
    },
    [handleCommand, say]
  );

  // Boot sensors + conocer gate
  useEffect(() => {
    let alive = true;
    (async () => {
      const settings = await loadSettings();
      voiceId.current = settings.voiceId || 'jarvis';
      setMicMuted(settings.micMuted);
      setVisionOn(settings.visionEnabled);

      // Cámara — solo pedir si el estado ya resolvió y no hay permiso
      if (settings.visionEnabled) {
        const camStatus = camPerm;
        if (camStatus && !camStatus.granted && camStatus.canAskAgain !== false) {
          await new Promise<void>((resolve) => {
            Alert.alert(
              'Cámara ULTRON FP',
              'Quiero mirarte a los ojos e identificar lo que hay frente a mí (persona, lápiz, teléfono…). ¿Permitir cámara?',
              [
                {
                  text: 'Denegar',
                  style: 'cancel',
                  onPress: () => {
                    setVisionOn(false);
                    resolve();
                  },
                },
                {
                  text: 'Permitir',
                  onPress: () => {
                    void requestCam().finally(() => resolve());
                  },
                },
              ]
            );
          });
        } else if (camStatus?.granted) {
          setVisionOn(true);
        }
      }

      const micOk = await ensureSpeechPermissions();
      if (!alive) return;

      setSpeechCallbacks({
        onPartial: (t) => {
          partialRef.current = t;
          setStatus(t.slice(0, 56));
          if (!speakingRef.current) setFace('LISTENING');
        },
        onFinal: onSpeechFinal,
        onListeningChange: setListening,
        onError: (msg) => setStatus(`Mic: ${msg}`),
      });

      if (micOk && !settings.micMuted) {
        await enableAlwaysOnMic();
        setStatus('Micrófono siempre activo · di hey ULTRON');
      } else {
        setStatus(micOk ? 'Mic silenciado' : 'Sin permiso de mic — usa el teclado');
      }

      setFace('HAPPY');
      await say(`Bienvenido, ${user.name}. Estoy contigo.`, 'HAPPY');

      const progress = await loadConocerProgress(user.correo);
      setConocerDone(progress.completedCore);
      if (!progress.completedCore) {
        setTimeout(() => {
          void startConocer(false);
        }, 1600);
      } else {
        setFace('LISTENING');
      }
    })();

    return () => {
      alive = false;
      void destroySpeech();
      void stopSpeaking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep speech callback fresh
  useEffect(() => {
    setSpeechCallbacks({
      onPartial: (t) => {
        partialRef.current = t;
        setStatus(t.slice(0, 56));
        if (!speakingRef.current) setFace('LISTENING');
      },
      onFinal: onSpeechFinal,
      onListeningChange: setListening,
      onError: (msg) => setStatus(`Mic: ${msg}`),
    });
  }, [onSpeechFinal]);

  const toggleMute = async () => {
    if (isMicWanted() && !micMuted) {
      await muteMic();
      setMicMuted(true);
      await saveSettings({ micMuted: true });
      setStatus('Mic silenciado');
      await say('Micrófono en silencio. Toca Mic para volver a oírme.', 'IDLE');
    } else {
      const ok = await ensureSpeechPermissions();
      if (!ok) {
        Alert.alert('Micrófono', 'Necesito permiso de micrófono para escucharte.', [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Reintentar', onPress: () => void ensureSpeechPermissions() },
        ]);
        return;
      }
      await unmuteMic();
      setMicMuted(false);
      await saveSettings({ micMuted: false });
      setStatus('Micrófono siempre activo');
      await say('Te escucho de nuevo.', 'LISTENING');
    }
  };

  const sendDraft = () => {
    const t = draft.trim();
    if (!t) return;
    setDraft('');
    void handleCommand(t);
  };

  const onGazeStable = useCallback((x: number, y: number) => setGaze({ x, y }), []);
  const onObjectsStable = useCallback((labels: string[]) => setObjects(labels), []);

  return (
    <View style={styles.root}>
      <GazeCamera
        enabled={visionOn && !!camPerm?.granted}
        onGaze={onGazeStable}
        onObjects={onObjectsStable}
      />

      <View style={styles.topBar}>
        <Text style={styles.brand}>ULTRON FP</Text>
        <Text style={styles.meta}>
          {mode} · {presence} · v{APP_VERSION}
          {listening && !micMuted ? ' · OYENDO' : micMuted ? ' · MUTE' : ''}
        </Text>
        <Pressable onPress={() => setMenuOpen(true)} style={styles.chip}>
          <Text style={styles.chipText}>Menú</Text>
        </Pressable>
        <Pressable onPress={onOpenSettings} style={styles.chip}>
          <Text style={styles.chipText}>Ajustes</Text>
        </Pressable>
      </View>

      <View style={styles.stage}>
        <UltronFace face={face} gazeX={gaze.x} gazeY={gaze.y} />
        {visionOn && camPerm?.granted && (
          <View style={styles.visionBadge}>
            <Text style={styles.visionBadgeText}>
              {objects.length ? objects.slice(0, 3).join(' · ') : 'visión activa'}
            </Text>
          </View>
        )}
      </View>

      {!!bubble && (
        <View style={styles.bubble}>
          <ScrollView style={{ maxHeight: 70 }}>
            <Text style={styles.bubbleText}>{bubble}</Text>
          </ScrollView>
        </View>
      )}

      <Text style={styles.status}>{status}</Text>
      {!conocerDone && conocerIdx >= 0 && (
        <Text style={styles.conocerHint}>
          Conociéndote {Math.min(conocerIdx + 1, CORE_COUNT)}/{CORE_COUNT}
        </Text>
      )}

      <View style={styles.dock}>
        <Pressable
          onPress={() => {
            setPresence('sleep');
            setFace('SLEEPING');
            listenMode.current = 'wake';
            void say('Sleep. Di hey ULTRON.', 'SLEEPING');
          }}
          style={styles.dockBtn}
        >
          <Text style={styles.dockText}>Sleep</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            setPresence('stay');
            listenMode.current = 'command';
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
            listenMode.current = 'command';
            void say('Explore.', 'SCAN');
          }}
          style={[styles.dockBtn, presence === 'explore' && styles.dockOn]}
        >
          <Text style={styles.dockText}>Explore</Text>
        </Pressable>
        <Pressable
          onPress={async () => {
            if (!visionOn) {
              if (!camPerm?.granted) {
                const r = await requestCam();
                if (!r.granted) {
                  Alert.alert('Cámara denegada', 'Sin cámara no puedo mirarte ni identificar objetos.');
                  return;
                }
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
          <Text style={styles.dockText}>Visión</Text>
        </Pressable>
        <Pressable onPress={() => void toggleMute()} style={[styles.dockBtn, !micMuted && styles.dockOn]}>
          <Text style={styles.dockText}>{micMuted ? 'Mic OFF' : 'Mic ON'}</Text>
        </Pressable>
      </View>

      <View style={styles.composer}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Escribe o habla… hey ULTRON"
          placeholderTextColor="#5A6A7A"
          style={styles.input}
          onSubmitEditing={sendDraft}
          returnKeyType="send"
        />
        <Pressable onPress={sendDraft} style={styles.send}>
          <Text style={styles.sendText}>Enviar</Text>
        </Pressable>
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
  root: { flex: 1, backgroundColor: '#000', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  brand: { color: '#E8FBFF', fontWeight: '800', letterSpacing: 4, fontSize: 14 },
  meta: {
    color: '#5A6A7A',
    fontSize: 11,
    flex: 1,
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier',
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  chipText: { color: '#C8D4DE', fontSize: 12 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  visionBadge: {
    position: 'absolute',
    right: 8,
    top: 8,
    maxWidth: 180,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(0,20,28,0.75)',
    borderWidth: 1,
    borderColor: 'rgba(0,229,255,0.25)',
  },
  visionBadgeText: { color: '#8B9AAB', fontSize: 10 },
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
  status: { color: '#5A6A7A', fontSize: 11, textAlign: 'center', marginBottom: 2 },
  conocerHint: { color: '#00E5FF', fontSize: 11, textAlign: 'center', marginBottom: 6 },
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
