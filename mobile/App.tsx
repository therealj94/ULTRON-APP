import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, Animated, Easing,
  Vibration, KeyboardAvoidingView, Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Accelerometer } from 'expo-sensors';
import { Audio } from 'expo-av';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as FileSystem from 'expo-file-system';
import { Face, EYE } from './src/Face';
import { MODES, ModeId, SING_INSTRUCT } from './src/modes';
import { turno, ttsWav, stt, bufToB64, Hist } from './src/api';

type FaceId = 'IDLE' | 'THINK' | 'SPEAK' | 'LISTEN' | 'SLEEP';

export default function App() {
  const [face, setFace] = useState<FaceId>('IDLE');
  const [mode, setMode] = useState<ModeId>('GUARDIAN');
  const [text, setText] = useState('');
  const [bubble, setBubble] = useState('Listo.');
  const [lip, setLip] = useState(0.08);
  const [recOn, setRecOn] = useState(false);
  const [perm, requestPerm] = useCameraPermissions();
  const camRef = useRef<CameraView>(null);
  const recRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const histRef = useRef<Hist[]>([]);
  const blink = useRef(new Animated.Value(1)).current;
  const winkL = useRef(new Animated.Value(1)).current;
  const winkR = useRef(new Animated.Value(1)).current;
  const breath = useRef(new Animated.Value(0)).current;
  const squash = useRef(new Animated.Value(1)).current;
  const pupil = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const modeRef = useRef(mode);
  const faceRef = useRef(face);
  modeRef.current = mode;
  faceRef.current = face;
  const theme = MODES[mode];

  useEffect(() => {
    Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true }).catch(() => {});
    Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    ).start();
    let alive = true;
    const loop = () => {
      if (!alive || faceRef.current === 'SLEEP') return;
      Animated.sequence([
        Animated.delay(2600 + Math.random() * 3600),
        Animated.timing(blink, { toValue: 0.02, duration: 160, easing: Easing.in, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1, duration: 210, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]).start(() => loop());
    };
    loop();
    return () => { alive = false; };
  }, [blink, breath]);

  useEffect(() => {
    Accelerometer.setUpdateInterval(80);
    const sub = Accelerometer.addListener(({ x, y }) => {
      if (faceRef.current === 'SLEEP') return;
      pupil.setValue({
        x: Math.max(-1, Math.min(1, x)) * EYE * 0.11,
        y: Math.max(-1, Math.min(1, -y)) * EYE * 0.09,
      });
    });
    return () => sub.remove();
  }, [pupil]);

  const pressAnim = () => {
    Vibration.vibrate(8);
    Animated.sequence([
      Animated.spring(squash, { toValue: 0.93, useNativeDriver: true, speed: 26, bounciness: 0 }),
      Animated.spring(squash, { toValue: 1, useNativeDriver: true, speed: 11, bounciness: 9 }),
    ]).start();
  };

  const doWink = (side: 'L' | 'R' | 'both' = 'R') => {
    const run = (v: Animated.Value) =>
      Animated.sequence([
        Animated.timing(v, { toValue: 0.02, duration: 170, useNativeDriver: true }),
        Animated.delay(90),
        Animated.timing(v, { toValue: 1, duration: 240, useNativeDriver: true }),
      ]).start();
    if (side === 'both') { run(winkL); run(winkR); }
    else run(side === 'L' ? winkL : winkR);
  };

  const speakWav = async (b64: string) => {
    try { await soundRef.current?.unloadAsync(); } catch {}
    const path = FileSystem.cacheDirectory + 'ultron.wav';
    await FileSystem.writeAsStringAsync(path, b64, { encoding: FileSystem.EncodingType.Base64 });
    const sound = new Audio.Sound();
    soundRef.current = sound;
    await sound.loadAsync({ uri: path });
    setFace('SPEAK');
    sound.setOnPlaybackStatusUpdate((st) => {
      if (!st.isLoaded) return;
      if (st.isPlaying) setLip(0.2 + 0.5 * Math.abs(Math.sin((st.positionMillis || 0) / 170)));
      if (st.didJustFinish) { setLip(0.08); setFace('IDLE'); }
    });
    await sound.playAsync();
  };

  const grabCam = async () => {
    try {
      const shot = await camRef.current?.takePictureAsync({ base64: true, quality: 0.4, skipProcessing: true });
      if (shot?.base64) return 'data:image/jpeg;base64,' + shot.base64;
    } catch {}
    return undefined;
  };

  const ask = useCallback(async (cmd: string, opts?: { sing?: boolean }) => {
    const q = cmd.trim();
    if (!q) return;
    setText('');
    setFace('THINK');
    setBubble('…');
    pressAnim();
    const sing = !!opts?.sing || /canta|cantar|canci[oó]n/i.test(q);
    try {
      const wantVision = /ves|mira|foto|c[aá]mara|imagen|qu[eé] hay/i.test(q);
      const image = wantVision ? await grabCam() : undefined;
      const reply = await turno(
        sing ? q + ' Estrofa corta para cantar, versos con punto.' : q,
        { mode: modeRef.current, image, historial: histRef.current }
      );
      setBubble(reply);
      histRef.current = [...histRef.current, { rol: 'user', texto: q }, { rol: 'ultron', texto: reply }].slice(-12);
      const m = MODES[modeRef.current];
      const buf = await ttsWav(reply, m.voice, sing ? SING_INSTRUCT : m.instruct);
      await speakWav(bufToB64(buf));
    } catch (e: any) {
      setBubble(String(e?.message || e).slice(0, 160));
      setFace('IDLE');
    }
  }, []);

  const startRec = async () => {
    try {
      const p = await Audio.requestPermissionsAsync();
      if (!p.granted) { setBubble('Sin micrófono no te oigo.'); return; }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await rec.startAsync();
      recRef.current = rec;
      setRecOn(true);
      setFace('LISTEN');
      setBubble('Te oigo…');
      Vibration.vibrate(12);
    } catch (e: any) {
      setBubble('Mic: ' + String(e?.message || e).slice(0, 80));
    }
  };

  const stopRec = async () => {
    const rec = recRef.current;
    recRef.current = null;
    setRecOn(false);
    if (!rec) return;
    try {
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      if (!uri) { setFace('IDLE'); return; }
      setFace('THINK');
      setBubble('Pasando voz…');
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const said = await stt(b64);
      if (!said) { setBubble('No entendí. Escribilo.'); setFace('IDLE'); return; }
      setBubble('Oí: ' + said);
      await ask(said);
    } catch (e: any) {
      setBubble(String(e?.message || e).slice(0, 140));
      setFace('IDLE');
    }
  };

  const onFacePress = () => {
    if (face === 'SLEEP') {
      setFace('IDLE');
      blink.setValue(1);
      setBubble('Despierto.');
      return;
    }
    pressAnim();
    doWink(Math.random() < 0.5 ? 'L' : 'R');
  };

  const onFaceLong = () => {
    setFace((f) => {
      if (f === 'SLEEP') {
        blink.setValue(1);
        setBubble('Despierto.');
        return 'IDLE';
      }
      Animated.timing(blink, { toValue: 0.05, duration: 420, useNativeDriver: true }).start();
      setBubble('Reposo.');
      return 'SLEEP';
    });
  };

  return (
    <KeyboardAvoidingView style={st.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" hidden />
      {perm?.granted ? (
        <CameraView ref={camRef} style={st.cam} facing="front" />
      ) : (
        <Pressable style={st.camAsk} onPress={() => requestPerm()}>
          <Text style={st.camAskTxt}>Cámara</Text>
        </Pressable>
      )}

      <Pressable onPress={onFacePress} onLongPress={onFaceLong} delayLongPress={420}>
        <Face color={theme.color} blink={blink} winkL={winkL} winkR={winkR} squash={squash} breath={breath} pupil={pupil} lip={lip} />
      </Pressable>
      <Text style={[st.tag, { color: theme.color }]}>{face} · {theme.label}</Text>
      <Text style={st.bubble} numberOfLines={5}>{bubble}</Text>

      <View style={st.modes}>
        {(Object.keys(MODES) as ModeId[]).map((id) => (
          <Pressable key={id} onPress={() => { setMode(id); setBubble(MODES[id].hint); doWink('both'); }}
            style={[st.modeChip, mode === id && { borderColor: MODES[id].color }]}>
            <Text style={{ color: mode === id ? MODES[id].color : '#556', fontSize: 11 }}>{MODES[id].label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={st.dock}>
        {[['oro', 'precio del oro'], ['plata', 'precio de la plata'], ['L', 'lempira a dolar'], ['ves', 'qué ves'], ['canta', 'canta una estrofa corta de buenos días']].map(([l, c]) => (
          <Pressable key={l} style={[st.chip, { borderColor: theme.color + '55' }]} onPress={() => ask(c, { sing: l === 'canta' })}>
            <Text style={[st.chipT, { color: theme.color }]}>{l}</Text>
          </Pressable>
        ))}
      </View>

      <View style={st.row}>
        <Pressable style={[st.mic, recOn && st.micOn]} onPressIn={startRec} onPressOut={stopRec}>
          <Text style={st.micT}>{recOn ? '●' : 'MIC'}</Text>
        </Pressable>
        <TextInput style={st.input} placeholder="Decile algo" placeholderTextColor="#445" value={text}
          onChangeText={setText} onSubmitEditing={() => ask(text)} returnKeyType="send" />
        <Pressable style={[st.go, { backgroundColor: theme.color }]} onPress={() => ask(text)}>
          <Text style={st.goT}>{face === 'THINK' ? '…' : 'OK'}</Text>
        </Pressable>
      </View>
      <Text style={st.hint}>MIC mantené · toque wink · largo duerme · no es la web</Text>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  cam: { position: 'absolute', width: 8, height: 8, opacity: 0.02, top: 0, left: 0 },
  camAsk: { position: 'absolute', top: 48, right: 16, padding: 8 },
  camAskTxt: { color: '#6ab', fontSize: 12 },
  tag: { fontSize: 11, letterSpacing: 1.5, marginTop: 10, marginBottom: 8 },
  bubble: { color: '#d7f6ff', fontSize: 16, textAlign: 'center', paddingHorizontal: 22, minHeight: 78 },
  modes: { flexDirection: 'row', gap: 6, marginBottom: 10 },
  modeChip: { borderWidth: 1, borderColor: '#222', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14 },
  dock: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginBottom: 12, paddingHorizontal: 10 },
  chip: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16 },
  chipT: { fontSize: 13 },
  row: { flexDirection: 'row', width: '90%', gap: 8, alignItems: 'center' },
  mic: { width: 52, height: 46, borderRadius: 12, borderWidth: 1, borderColor: '#844', alignItems: 'center', justifyContent: 'center' },
  micOn: { backgroundColor: '#4a1010', borderColor: '#f44' },
  micT: { color: '#f88', fontWeight: '800', fontSize: 11 },
  input: { flex: 1, color: '#fff', borderColor: '#1c3338', borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, height: 46 },
  go: { width: 52, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  goT: { color: '#000', fontWeight: '800' },
  hint: { color: '#334', fontSize: 10, marginTop: 8, marginBottom: 16 },
});
