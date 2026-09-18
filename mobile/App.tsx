import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, Animated, Easing,
  Vibration, KeyboardAvoidingView, Platform, Dimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Accelerometer } from 'expo-sensors';
import { Audio } from 'expo-av';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as FileSystem from 'expo-file-system';
import { MODES, ModeId, SING_INSTRUCT } from './src/modes';

const API = 'https://ultron-looi-desk.onrender.com';
const { width: W } = Dimensions.get('window');
const EYE = Math.min(118, W * 0.24);
type Face = 'IDLE' | 'THINK' | 'SPEAK' | 'LISTEN' | 'SLEEP';

export default function App() {
  const [face, setFace] = useState<Face>('IDLE');
  const [mode, setMode] = useState<ModeId>('GUARDIAN');
  const [text, setText] = useState('');
  const [bubble, setBubble] = useState('José. Listo.');
  const [lip, setLip] = useState(0.08);
  const [recOn, setRecOn] = useState(false);
  const [perm, requestPerm] = useCameraPermissions();
  const camRef = useRef<CameraView>(null);
  const recRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const histRef = useRef<{ rol: string; texto: string }[]>([]);
  const tilt = useRef({ x: 0, y: 0 }).current;
  const blink = useRef(new Animated.Value(1)).current;
  const winkL = useRef(new Animated.Value(1)).current;
  const winkR = useRef(new Animated.Value(1)).current;
  const breath = useRef(new Animated.Value(0)).current;
  const squash = useRef(new Animated.Value(1)).current;
  const pupil = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const faceRef = useRef(face);
  faceRef.current = face;
  const theme = MODES[mode];

  useEffect(() => {
    Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true }).catch(() => {});
    Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: 2800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: 2800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    ).start();
    let alive = true;
    const loopBlink = () => {
      if (!alive || faceRef.current === 'SLEEP') return;
      Animated.sequence([
        Animated.delay(2800 + Math.random() * 3400),
        Animated.timing(blink, { toValue: 0.08, duration: 150, easing: Easing.in, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1, duration: 190, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]).start(() => loopBlink());
    };
    loopBlink();
    return () => { alive = false; };
  }, [blink, breath]);

  useEffect(() => {
    Accelerometer.setUpdateInterval(80);
    const sub = Accelerometer.addListener(({ x, y }) => {
      if (faceRef.current === 'SLEEP') return;
      pupil.setValue({
        x: Math.max(-1, Math.min(1, x)) * EYE * 0.12,
        y: Math.max(-1, Math.min(1, -y)) * EYE * 0.1,
      });
    });
    return () => sub.remove();
  }, [pupil]);

  const playPress = () => {
    Vibration.vibrate(8);
    Animated.sequence([
      Animated.spring(squash, { toValue: 0.92, useNativeDriver: true, speed: 28, bounciness: 0 }),
      Animated.spring(squash, { toValue: 1, useNativeDriver: true, speed: 12, bounciness: 8 }),
    ]).start();
  };

  const doWink = (side: 'L' | 'R' | 'both' = 'R') => {
    const run = (v: Animated.Value) =>
      Animated.sequence([
        Animated.timing(v, { toValue: 0.06, duration: 160, useNativeDriver: true }),
        Animated.delay(80),
        Animated.timing(v, { toValue: 1, duration: 220, useNativeDriver: true }),
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
      if (st.isPlaying && st.durationMillis) {
        setLip(0.18 + 0.55 * Math.abs(Math.sin((st.positionMillis || 0) / 160)));
      }
      if (st.didJustFinish) { setLip(0.08); setFace('IDLE'); }
    });
    await sound.playAsync();
  };

  const grabCam = async () => {
    try {
      const shot = await camRef.current?.takePictureAsync({ base64: true, quality: 0.45, skipProcessing: true });
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
    playPress();
    const sing = !!opts?.sing || /canta|cantar|canci[oó]n|himno/i.test(q);
    try {
      const wantVision = /ves|mira|foto|c[aá]mara|imagen|qu[eé] hay/i.test(q);
      const image = wantVision ? await grabCam() : undefined;
      const r = await fetch(API + '/api/turno', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: sing ? q + ' Responde con una estrofa corta para cantar, versos con punto.' : q,
          mode: modeRef.current,
          image,
          historial: histRef.current,
        }),
      });
      const j = await r.json();
      const reply = String(j.reply || j.error || 'Sin respuesta');
      setBubble(reply);
      histRef.current = [...histRef.current, { rol: 'user', texto: q }, { rol: 'ultron', texto: reply }].slice(-12);
      const tts = await fetch(API + '/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: reply.slice(0, 420),
          voice: modeRef.current === 'CREATIVE' ? 'tierna' : 'formal',
          instruct: sing ? SING_INSTRUCT : MODES[modeRef.current].instruct,
        }),
      });
      if (tts.ok) {
        const bytes = new Uint8Array(await tts.arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
          binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
        }
        await speakWav((global as any).btoa(binary));
      } else setFace('IDLE');
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
      const stt = await fetch(API + '/api/stt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: b64, mime: 'audio/m4a' }),
      });
      const j = await stt.json();
      const said = String(j.text || '').trim();
      if (!said) {
        setBubble(j.error || 'No entendí. Escribilo.');
        setFace('IDLE');
        return;
      }
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
    playPress();
    doWink(Math.random() < 0.5 ? 'L' : 'R');
  };

  const onFaceLong = () => {
    setFace((f) => {
      if (f === 'SLEEP') {
        blink.setValue(1);
        setBubble('Despierto.');
        return 'IDLE';
      }
      Animated.timing(blink, { toValue: 0.12, duration: 400, useNativeDriver: true }).start();
      setBubble('Reposo.');
      return 'SLEEP';
    });
  };

  const scale = Animated.multiply(
    breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] }),
    squash
  );

  return (
    <KeyboardAvoidingView style={st.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" hidden />
      {perm?.granted ? <CameraView ref={camRef} style={st.cam} facing="front" /> : (
        <Pressable style={st.camAsk} onPress={() => requestPerm()}><Text style={st.camAskTxt}>Cámara</Text></Pressable>
      )}
      <Pressable onPress={onFacePress} onLongPress={onFaceLong} delayLongPress={420}>
        <Animated.View style={[st.face, { transform: [{ scale }] }]}>
          <Eye color={theme.color} open={Animated.multiply(blink, winkL)} pupil={pupil} />
          <Eye color={theme.color} open={Animated.multiply(blink, winkR)} pupil={pupil} />
        </Animated.View>
      </Pressable>
      <View style={[st.mouthWrap, { height: 12 + lip * 18 }]}>
        <View style={[st.mouth, { height: 3 + lip * 12, backgroundColor: theme.color }]} />
      </View>
      <Text style={[st.faceTag, { color: theme.color }]}>{face} · {theme.label}</Text>
      <Text style={st.bubble} numberOfLines={5}>{bubble}</Text>
      <View style={st.modes}>
        {(Object.keys(MODES) as ModeId[]).map((id) => (
          <Pressable key={id} onPress={() => { setMode(id); setBubble(MODES[id].hint); doWink('both'); }}
            style={[st.modeChip, mode === id && { borderColor: MODES[id].color }]}>
            <Text style={[st.modeTxt, { color: mode === id ? MODES[id].color : '#667' }]}>{MODES[id].label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={st.dock}>
        {[['oro','precio del oro'],['plata','precio de la plata'],['L','lempira a dolar'],['ves','qué ves'],['canta','canta una estrofa corta de buenos días']].map(([l,c]) => (
          <Pressable key={l} style={[st.chip, { borderColor: theme.color + '66' }]} onPress={() => ask(c, { sing: l === 'canta' })}>
            <Text style={[st.chipTxt, { color: theme.color }]}>{l}</Text>
          </Pressable>
        ))}
      </View>
      <View style={st.row}>
        <Pressable style={[st.mic, recOn && st.micOn]} onPressIn={startRec} onPressOut={stopRec}>
          <Text style={st.micTxt}>{recOn ? '●' : 'MIC'}</Text>
        </Pressable>
        <TextInput style={st.input} placeholder="Decile algo" placeholderTextColor="#556" value={text} onChangeText={setText} onSubmitEditing={() => ask(text)} returnKeyType="send" />
        <Pressable style={[st.go, { backgroundColor: theme.color }]} onPress={() => ask(text)}>
          <Text style={st.goTxt}>{face === 'THINK' ? '…' : 'OK'}</Text>
        </Pressable>
      </View>
      <Text style={st.hint}>Mantení MIC · toque = wink · largo = dormir</Text>
    </KeyboardAvoidingView>
  );
}

function Eye({ color, open, pupil }: { color: string; open: any; pupil: Animated.ValueXY }) {
  return (
    <View style={st.well}>
      <Animated.View style={[st.lid, { borderColor: color + '99', transform: [{ scaleY: open }] }]}>
        <View style={[st.glow, { backgroundColor: color + '14' }]} />
        <View style={st.iris}>
          <Animated.View style={[st.pupil, { transform: pupil.getTranslateTransform() }]} />
          <View style={st.glint} />
        </View>
      </Animated.View>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  cam: { position: 'absolute', width: 10, height: 10, opacity: 0.03, top: 0, left: 0 },
  camAsk: { position: 'absolute', top: 44, right: 16, padding: 8 },
  camAskTxt: { color: '#6ab', fontSize: 12 },
  face: { flexDirection: 'row', gap: EYE * 0.38, marginBottom: 8 },
  well: { width: EYE, height: EYE, alignItems: 'center', justifyContent: 'center' },
  lid: { width: EYE * 0.96, height: EYE * 0.96, borderRadius: EYE, backgroundColor: '#02080c', overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  glow: { position: 'absolute', width: EYE, height: EYE, borderRadius: EYE },
  iris: { width: EYE * 0.58, height: EYE * 0.58, borderRadius: EYE, backgroundColor: '#04424c', alignItems: 'center', justifyContent: 'center' },
  pupil: { width: EYE * 0.24, height: EYE * 0.24, borderRadius: EYE, backgroundColor: '#000' },
  glint: { position: 'absolute', top: EYE * 0.1, left: EYE * 0.14, width: EYE * 0.1, height: EYE * 0.1, borderRadius: EYE, backgroundColor: '#e8ffff' },
  mouthWrap: { width: EYE * 0.7, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  mouth: { width: EYE * 0.42, borderRadius: 3 },
  faceTag: { fontSize: 11, letterSpacing: 1.4, marginBottom: 8 },
  bubble: { color: '#d7f6ff', fontSize: 16, textAlign: 'center', paddingHorizontal: 22, minHeight: 76 },
  modes: { flexDirection: 'row', gap: 6, marginBottom: 10 },
  modeChip: { borderWidth: 1, borderColor: '#222', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14 },
  modeTxt: { fontSize: 11 },
  dock: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginBottom: 12, paddingHorizontal: 12 },
  chip: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16 },
  chipTxt: { fontSize: 13 },
  row: { flexDirection: 'row', width: '90%', gap: 8, alignItems: 'center' },
  mic: { width: 52, height: 46, borderRadius: 12, borderWidth: 1, borderColor: '#844', alignItems: 'center', justifyContent: 'center' },
  micOn: { backgroundColor: '#4a1010', borderColor: '#f44' },
  micTxt: { color: '#f88', fontWeight: '800', fontSize: 11 },
  input: { flex: 1, color: '#fff', borderColor: '#1c3338', borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, height: 46 },
  go: { width: 52, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  goTxt: { color: '#000', fontWeight: '800' },
  hint: { color: '#334', fontSize: 10, marginTop: 8, marginBottom: 18 },
});
