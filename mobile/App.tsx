import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet, Animated, Easing,
  Vibration, KeyboardAvoidingView, Platform, Dimensions,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { Accelerometer } from "expo-sensors";
import { Audio } from "expo-av";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as FileSystem from "expo-file-system";

const API = "https://ultron-looi-desk.onrender.com";
const { width: W } = Dimensions.get("window");
const EYE = Math.min(110, W * 0.22);

type Face = "IDLE" | "THINK" | "SPEAK" | "LISTEN";

export default function App() {
  const [face, setFace] = useState<Face>("IDLE");
  const [text, setText] = useState("");
  const [bubble, setBubble] = useState("José. Listo.");
  const [lip, setLip] = useState(0.08);
  const [perm, requestPerm] = useCameraPermissions();
  const camRef = useRef<CameraView>(null);
  const tilt = useRef({ x: 0, y: 0 }).current;
  const blink = useRef(new Animated.Value(1)).current;
  const breath = useRef(new Animated.Value(0)).current;
  const pupil = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    Audio.setAudioModeAsync({ playsInSilentModeIOS: true, staysActiveInBackground: false }).catch(() => {});
    Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    ).start();
    const loopBlink = () => {
      Animated.sequence([
        Animated.delay(2400 + Math.random() * 3200),
        Animated.timing(blink, { toValue: 0.06, duration: 60, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1, duration: 100, useNativeDriver: true }),
      ]).start(() => loopBlink());
    };
    loopBlink();
  }, [blink, breath]);

  useEffect(() => {
    Accelerometer.setUpdateInterval(70);
    const sub = Accelerometer.addListener(({ x, y }) => {
      tilt.x = Math.max(-1, Math.min(1, x));
      tilt.y = Math.max(-1, Math.min(1, -y));
      pupil.setValue({ x: tilt.x * EYE * 0.12, y: tilt.y * EYE * 0.1 });
    });
    return () => sub.remove();
  }, [pupil, tilt]);

  const speakWav = async (b64: string) => {
    try { await soundRef.current?.unloadAsync(); } catch {}
    const path = FileSystem.cacheDirectory + "ultron.wav";
    await FileSystem.writeAsStringAsync(path, b64, { encoding: FileSystem.EncodingType.Base64 });
    const sound = new Audio.Sound();
    soundRef.current = sound;
    await sound.loadAsync({ uri: path });
    setFace("SPEAK");
    sound.setOnPlaybackStatusUpdate((st) => {
      if (!st.isLoaded) return;
      if (st.isPlaying && st.durationMillis) {
        const t = (st.positionMillis || 0) / 180;
        setLip(0.15 + 0.55 * Math.abs(Math.sin(t)));
      }
      if (st.didJustFinish) {
        setLip(0.08);
        setFace("IDLE");
      }
    });
    await sound.playAsync();
  };

  const grabCam = async (): Promise<string | undefined> => {
    try {
      const shot = await camRef.current?.takePictureAsync({ base64: true, quality: 0.4, skipProcessing: true });
      if (shot?.base64) return "data:image/jpeg;base64," + shot.base64;
    } catch {}
    return undefined;
  };

  const ask = useCallback(async (cmd: string) => {
    const q = cmd.trim();
    if (!q) return;
    setText("");
    setFace("THINK");
    setBubble("…");
    Vibration.vibrate(10);
    try {
      const wantVision = /ves|mira|foto|c[aá]mara|imagen|qu[eé] hay/i.test(q);
      const image = wantVision ? await grabCam() : undefined;
      const r = await fetch(API + "/api/turno", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q, image }),
      });
      const j = await r.json();
      const reply = String(j.reply || j.error || "Sin respuesta");
      setBubble(reply);
      const tts = await fetch(API + "/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: reply.slice(0, 360), voice: "formal" }),
      });
      if (tts.ok) {
        const buf = await tts.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = "";
        for (let i = 0; i < bytes.length; i += 0x8000) {
          binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
        }
        await speakWav((global as any).btoa(binary));
      } else setFace("IDLE");
    } catch (e: any) {
      setBubble(String(e?.message || e).slice(0, 160));
      setFace("IDLE");
    }
  }, []);

  const scale = breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.025] });

  return (
    <KeyboardAvoidingView style={st.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <StatusBar style="light" hidden />
      {perm?.granted ? (
        <CameraView ref={camRef} style={st.cam} facing="front" />
      ) : (
        <Pressable style={st.camAsk} onPress={() => requestPerm()}>
          <Text style={st.camAskTxt}>Permitir cámara</Text>
        </Pressable>
      )}

      <Animated.View style={[st.face, { transform: [{ scale }] }]}>
        <Eye blink={blink} pupil={pupil} />
        <Eye blink={blink} pupil={pupil} />
      </Animated.View>
      <View style={[st.mouthWrap, { height: 10 + lip * 16 }]}>
        <View style={[st.mouth, { height: 3 + lip * 10 }]} />
      </View>
      <Text style={st.faceTag}>{face}</Text>
      <Text style={st.bubble} numberOfLines={5}>{bubble}</Text>

      <View style={st.dock}>
        {[["oro","precio del oro"],["plata","precio de la plata"],["L","lempira a dolar"],["ves?","qué ves"]].map(([l,c]) => (
          <Pressable key={l} style={st.chip} onPress={() => ask(c)}>
            <Text style={st.chipTxt}>{l}</Text>
          </Pressable>
        ))}
      </View>
      <View style={st.row}>
        <TextInput
          style={st.input}
          placeholder="Decile algo"
          placeholderTextColor="#556"
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => ask(text)}
          returnKeyType="send"
        />
        <Pressable style={st.go} onPress={() => ask(text)}>
          <Text style={st.goTxt}>{face === "THINK" ? "…" : "OK"}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function Eye({ blink, pupil }: { blink: Animated.Value; pupil: Animated.ValueXY }) {
  return (
    <View style={st.well}>
      <Animated.View style={[st.lid, { transform: [{ scaleY: blink }] }]}>
        <View style={st.glow} />
        <View style={st.iris}>
          <Animated.View style={[st.pupil, { transform: pupil.getTranslateTransform() }]} />
          <View style={st.glint} />
        </View>
      </Animated.View>
    </View>
  );
}

const CYAN = "#05E1FF";
const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  cam: { position: "absolute", width: 8, height: 8, opacity: 0.02, top: 0, left: 0 },
  camAsk: { position: "absolute", top: 44, right: 16, padding: 8 },
  camAskTxt: { color: "#6ab", fontSize: 12 },
  face: { flexDirection: "row", gap: EYE * 0.38, marginBottom: 8 },
  well: { width: EYE, height: EYE, alignItems: "center", justifyContent: "center" },
  lid: {
    width: EYE * 0.96, height: EYE * 0.96, borderRadius: EYE,
    backgroundColor: "#02080c", overflow: "hidden",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1.5, borderColor: "rgba(5,225,255,0.55)",
  },
  glow: { position: "absolute", width: EYE, height: EYE, borderRadius: EYE, backgroundColor: "rgba(5,225,255,0.07)" },
  iris: { width: EYE * 0.58, height: EYE * 0.58, borderRadius: EYE, backgroundColor: "#04424c", alignItems: "center", justifyContent: "center" },
  pupil: { width: EYE * 0.24, height: EYE * 0.24, borderRadius: EYE, backgroundColor: "#000" },
  glint: { position: "absolute", top: EYE * 0.1, left: EYE * 0.14, width: EYE * 0.1, height: EYE * 0.1, borderRadius: EYE, backgroundColor: "#e8ffff" },
  mouthWrap: { width: EYE * 0.7, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  mouth: { width: EYE * 0.42, backgroundColor: CYAN, borderRadius: 3 },
  faceTag: { color: "#245", fontSize: 10, letterSpacing: 2, marginBottom: 8 },
  bubble: { color: "#d7f6ff", fontSize: 16, textAlign: "center", paddingHorizontal: 22, minHeight: 80 },
  dock: { flexDirection: "row", gap: 8, marginBottom: 12 },
  chip: { borderColor: "rgba(5,225,255,0.4)", borderWidth: 1, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 18 },
  chipTxt: { color: CYAN, fontSize: 13 },
  row: { flexDirection: "row", width: "88%", gap: 8, marginBottom: 30 },
  input: { flex: 1, color: "#fff", borderColor: "#1c3338", borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, height: 46 },
  go: { width: 54, height: 46, backgroundColor: CYAN, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  goTxt: { color: "#000", fontWeight: "800" },
});
