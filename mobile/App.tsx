import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Animated, Easing, Vibration, KeyboardAvoidingView, Platform } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Accelerometer } from "expo-sensors";
import { Audio } from "expo-av";
import { CameraView, useCameraPermissions } from "expo-camera";

const API = "https://ultron-looi-desk.onrender.com";
type Face = "IDLE" | "THINK" | "SPEAK";

export default function App() {
  const [face, setFace] = useState<Face>("IDLE");
  const [text, setText] = useState("");
  const [bubble, setBubble] = useState("Ultron");
  const [lip, setLip] = useState(0);
  const [perm, requestPerm] = useCameraPermissions();
  const tilt = useRef({ x: 0, y: 0 }).current;
  const blink = useRef(new Animated.Value(1)).current;
  const breath = useRef(new Animated.Value(0)).current;
  const pupil = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    ).start();
    const loopBlink = () => {
      Animated.sequence([
        Animated.delay(2200 + Math.random() * 2800),
        Animated.timing(blink, { toValue: 0.08, duration: 70, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1, duration: 90, useNativeDriver: true }),
      ]).start(() => loopBlink());
    };
    loopBlink();
  }, [blink, breath]);

  useEffect(() => {
    Accelerometer.setUpdateInterval(80);
    const sub = Accelerometer.addListener(({ x, y }) => {
      tilt.x = Math.max(-1, Math.min(1, x));
      tilt.y = Math.max(-1, Math.min(1, -y));
      pupil.setValue({ x: tilt.x * 10, y: tilt.y * 8 });
    });
    return () => sub.remove();
  }, [pupil, tilt]);

  const speakWav = async (buf: ArrayBuffer) => {
    try { await soundRef.current?.unloadAsync(); } catch {}
    const sound = new Audio.Sound();
    soundRef.current = sound;
    const uri = "data:audio/wav;base64," + arrayBufferToBase64(buf);
    await sound.loadAsync({ uri });
    setFace("SPEAK");
    const iv = setInterval(async () => {
      const st = await sound.getStatusAsync();
      if (st.isLoaded) setLip(st.isPlaying ? 0.4 : 0);
    }, 90);
    sound.setOnPlaybackStatusUpdate((st) => {
      if (st.isLoaded && st.didJustFinish) {
        clearInterval(iv);
        setLip(0);
        setFace("IDLE");
      }
    });
    await sound.playAsync();
  };

  const ask = useCallback(async (cmd: string) => {
    const q = cmd.trim();
    if (!q) return;
    setText("");
    setFace("THINK");
    setBubble("...");
    try {
      const r = await fetch(API + "/api/turno", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q }),
      });
      const j = await r.json();
      const reply = String(j.reply || j.error || "Sin respuesta");
      setBubble(reply);
      const tts = await fetch(API + "/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: reply.slice(0, 400), voice: "formal" }),
      });
      if (tts.ok) await speakWav(await tts.arrayBuffer());
      else setFace("IDLE");
    } catch (e: any) {
      setBubble(String(e?.message || e).slice(0, 140));
      setFace("IDLE");
    }
  }, []);

  const openScale = breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] });

  return (
    <KeyboardAvoidingView style={st.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <StatusBar style="light" hidden />
      {perm?.granted ? <CameraView style={st.cam} facing="front" /> : (
        <Pressable style={st.camAsk} onPress={() => requestPerm()}><Text style={st.camAskTxt}>Camara</Text></Pressable>
      )}
      <Animated.View style={[st.face, { transform: [{ scale: openScale }] }]}>
        <Eye blink={blink} pupil={pupil} />
        <Eye blink={blink} pupil={pupil} />
      </Animated.View>
      <View style={[st.mouth, { height: 3 + lip * 14 }]} />
      <Text style={st.bubble} numberOfLines={4}>{bubble}</Text>
      <View style={st.dock}>
        {["precio del oro", "precio de la plata", "lempira a dolar"].map((c) => (
          <Pressable key={c} style={st.chip} onPress={() => { Vibration.vibrate(12); ask(c); }}>
            <Text style={st.chipTxt}>{c.split(" ").pop()}</Text>
          </Pressable>
        ))}
      </View>
      <View style={st.row}>
        <TextInput style={st.input} placeholder="Decile algo" placeholderTextColor="#667" value={text} onChangeText={setText} onSubmitEditing={() => ask(text)} returnKeyType="send" />
        <Pressable style={st.go} onPress={() => ask(text)}><Text style={st.goTxt}>{face === "THINK" ? "..." : "OK"}</Text></Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function Eye({ blink, pupil }: { blink: Animated.Value; pupil: Animated.ValueXY }) {
  return (
    <View style={st.eyeWell}>
      <Animated.View style={[st.lid, { transform: [{ scaleY: blink }] }]}>
        <View style={st.iris}>
          <Animated.View style={[st.pupil, { transform: pupil.getTranslateTransform() }]} />
          <View style={st.glint} />
        </View>
      </Animated.View>
    </View>
  );
}

function arrayBufferToBase64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  return (global as any).btoa(binary);
}

const CYAN = "#05E1FF";
const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  cam: { position: "absolute", width: 1, height: 1, opacity: 0 },
  camAsk: { position: "absolute", top: 48, right: 16, padding: 8 },
  camAskTxt: { color: "#445", fontSize: 12 },
  face: { flexDirection: "row", gap: 36, marginBottom: 18 },
  eyeWell: { width: 92, height: 92, alignItems: "center", justifyContent: "center" },
  lid: { width: 88, height: 88, borderRadius: 44, backgroundColor: "#021018", overflow: "hidden", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: CYAN },
  iris: { width: 54, height: 54, borderRadius: 27, backgroundColor: "#03313a", alignItems: "center", justifyContent: "center" },
  pupil: { width: 22, height: 22, borderRadius: 11, backgroundColor: "#000" },
  glint: { position: "absolute", top: 8, left: 12, width: 8, height: 8, borderRadius: 4, backgroundColor: "#dff" },
  mouth: { width: 42, backgroundColor: CYAN, borderRadius: 2, marginBottom: 24 },
  bubble: { color: "#cfe", fontSize: 15, textAlign: "center", paddingHorizontal: 24, minHeight: 72 },
  dock: { flexDirection: "row", gap: 8, marginBottom: 10 },
  chip: { borderColor: "rgba(5,225,255,0.35)", borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  chipTxt: { color: CYAN, fontSize: 12 },
  row: { flexDirection: "row", width: "88%", gap: 8, marginBottom: 28 },
  input: { flex: 1, color: "#fff", borderColor: "#234", borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, height: 44 },
  go: { width: 52, height: 44, backgroundColor: CYAN, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  goTxt: { color: "#000", fontWeight: "700" },
});
