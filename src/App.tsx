import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Mode, FaceState, BoardPermissionRequest, CapturedPhoto, ElevenLabsVoiceConfig } from './types';
import { FaceCanvas } from './02-cara/FaceCanvas';
import { caraDeTexto } from './02-cara/emocion';
import { DockDrawer } from './07-pantallas/DockDrawer';
import { SettingsSheet } from './07-pantallas/SettingsSheet';
import { PermissionModal } from './07-pantallas/PermissionModal';
import { BackendBridgeModal } from './07-pantallas/BackendBridgeModal';
import { AndroidBlueprintModal } from './07-pantallas/AndroidBlueprintModal';
import { VisionOverlay } from './07-pantallas/VisionOverlay';
import { BiometricAuthModal } from './07-pantallas/BiometricAuthModal';
import { PhotoCaptureModal } from './07-pantallas/PhotoCaptureModal';
import { UltronVaultModal } from './07-pantallas/UltronVaultModal';
import { VoicePickerModal } from './07-pantallas/VoicePickerModal';
import { CameraCountdownModal } from './07-pantallas/CameraCountdownModal';
import { VisionMediaAnalyzerModal } from './07-pantallas/VisionMediaAnalyzerModal';
import { PlaywrightBrowserModal } from './07-pantallas/PlaywrightBrowserModal';
import { GlobalOrderBrainModal } from './07-pantallas/GlobalOrderBrainModal';
import { AwsDeploymentModal } from './07-pantallas/AwsDeploymentModal';
import { TutorialModal } from './07-pantallas/TutorialModal';
import { playSfx } from './03-voz/audio';
import { speakUtterance, cancelSpeech, initSpeechRecognizer, SpeechRecognizerHandle } from './03-voz/speech';
import { speakWithElevenLabsOrFallback, stopCurrentVoice, DEFAULT_ELEVENLABS_VOICES } from './03-voz/elevenlabs';
import { vozPorId, VozId } from './03-voz/voces';
import { stopVoice, playWavBlob, enqueueWav, newTtsAbort, onLip, playFile, colaVacia } from './03-voz/player';
import { clipDeTexto, saludoHora, siguienteChiste } from './03-voz/banco';
import { bargeIn } from './03-voz/barge';
import { pedirTurno } from './04-cerebro/turno';
import { grabFrame } from './04-cerebro/grabFrame';
import { guardarHecho } from './09-estado/memoria';
import { headersMesa } from './10-infra/sesionCliente';
const pendienteCerebro = { hecho: '' };
import { downloadStandaloneSimulator } from './08-servicios/exporter';
import { Maximize2, Minimize2, BatteryMedium, Wifi, Sparkles, SlidersHorizontal, Cpu, Glasses, RotateCw, Fingerprint, Camera, Zap, Globe, BookOpen, Eye as EyeIcon, Cloud, ShieldCheck, HelpCircle, RotateCcw } from 'lucide-react';

export default function App() {
  // Session State
  const [face, setFace] = useState<FaceState>('IDLE');
  const [mode, setMode] = useState<Mode>('GUARDIAN');
  const [energy, setEnergy] = useState<number>(85);
  const [isBooting, setIsBooting] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isKioskFrame, setIsKioskFrame] = useState<boolean>(false);
  const FUN_MODE = true;
  useEffect(() => { onLip(setLipLevel); return () => onLip(null); }, []);
  useEffect(() => {
    ['/voz/bohemian.mp3', '/voz/ligera.mp3', '/voz/bittersweet.mp3', '/voz/runaway.mp3', '/voz/bruno.mp3', '/voz/dias.mp3', '/voz/tardes.mp3', '/voz/noches.mp3', '/voz/discurso.mp3', '/voz/quien.mp3', '/voz/puedo.mp3'].forEach((src) => {
      const a = new Audio();
      a.preload = 'auto';
      a.src = src;
    });
  }, []);
  const [hasVisor, setHasVisor] = useState<boolean>(false);
  const [lipLevel, setLipLevel] = useState(0);
  const [orientation, setOrientation] = useState<'horizontal' | 'vertical'>('horizontal'); // Horizontal (desk LOOI) or Vertical (mobile)

  // Camera Sensor & Gaze Tracking
  const [cameraGaze, setCameraGaze] = useState<{ x: number; y: number; active: boolean }>({
    x: 0,
    y: 0,
    active: false,
  });

  // Agentic Harness & Qwen 3.8 27B State
  const [autoModeSwitch, setAutoModeSwitch] = useState<boolean>(true);
  const [harnessModalOpen, setHarnessModalOpen] = useState<boolean>(false);

  // Audio & Hardware State
  const [micEnabled, setMicEnabled] = useState<boolean>(false);
  const [speakerEnabled, setSpeakerEnabled] = useState<boolean>(true);
  const [soundFxEnabled, setSoundFxEnabled] = useState<boolean>(true);
  const [visionEnabled, setVisionEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem('ultron_vision') === '1'; } catch { return false; }
  });
  const [cerebroListo, setCerebroListo] = useState<'frio' | 'calentando' | 'listo'>('frio');
  const cerebroListoRef = useRef(cerebroListo);
  cerebroListoRef.current = cerebroListo;
  const [resetTrigger, setResetTrigger] = useState<number>(0);

  const historialRef = useRef<{ rol: string; texto: string }[]>([]);
  const [vozId, setVozId] = useState<VozId>(() => {
    try {
      const saved = localStorage.getItem('ultron_voz');
      if (saved === 'marco' || saved === 'luna' || saved === 'looi') return saved;
    } catch { /* */ }
    return 'luna';
  });
  const [activeVoice, setActiveVoice] = useState(DEFAULT_ELEVENLABS_VOICES[1]);

  // Expressive Interactive Actions
  const [isDrinking, setIsDrinking] = useState<boolean>(false);
  const [isWaving, setIsWaving] = useState<boolean>(false);
  const [isCameraFlashing, setIsCameraFlashing] = useState<boolean>(false);
  const [isCombatBlasterActive, setIsCombatBlasterActive] = useState<boolean>(false);
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);

  // UI Overlays & Modals
  const [isTutorialOpen, setIsTutorialOpen] = useState<boolean>(false);
  const [dockOpen, setDockOpen] = useState<boolean>(false);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [backendBridgeOpen, setBackendBridgeOpen] = useState<boolean>(false);
  const [androidBlueprintOpen, setAndroidBlueprintOpen] = useState<boolean>(false);
  const [isBiometricOpen, setIsBiometricOpen] = useState<boolean>(false);
  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState<boolean>(false);
  const [isVaultModalOpen, setIsVaultModalOpen] = useState<boolean>(false);
  const [isVoiceModalOpen, setIsVoiceModalOpen] = useState<boolean>(false);
  const [isCameraCountdownModalOpen, setIsCameraCountdownModalOpen] = useState<boolean>(false);
  const [isVisionAnalyzerOpen, setIsVisionAnalyzerOpen] = useState<boolean>(false);
  const [visionMediaData, setVisionMediaData] = useState<{ url: string | null; type: 'image' | 'video' }>({
    url: null,
    type: 'image',
  });
  const [isPlaywrightBrowserOpen, setIsPlaywrightBrowserOpen] = useState<boolean>(false);
  const [isGlobalOrderBrainOpen, setIsGlobalOrderBrainOpen] = useState<boolean>(false);
  const [isAwsDeploymentModalOpen, setIsAwsDeploymentModalOpen] = useState<boolean>(false);
  const [pendingPermission, setPendingPermission] = useState<BoardPermissionRequest | null>(null);

  // Current Authenticated User (Render / Ultron FP & Biometrics)
  const [currentUser, setCurrentUser] = useState<{
    name: string;
    role: string;
    authenticated: boolean;
  }>({
    name: 'José',
    role: 'Junta Directiva · Orden Global',
    authenticated: false,
  });

  // Action timers to ensure animations always complete and return to IDLE
  const combatTimerRef = useRef<NodeJS.Timeout | null>(null);
  const drinkTimerRef = useRef<NodeJS.Timeout | null>(null);
  const waveTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Speech bubble text
  const [bubbleText, setBubbleText] = useState<string>('');
  const [bubbleVisible, setBubbleVisible] = useState<boolean>(false);
  const bubbleTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Permissions granted in session
  const [grantedPerms, setGrantedPerms] = useState<{ wa: boolean; em: boolean; cal: boolean }>({
    wa: false,
    em: false,
    cal: false,
  });

  // Backend Bridge Configuration & Telemetry
  const defaultWs =
    typeof window !== 'undefined'
      ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`
      : 'ws://127.0.0.1:3000/ws';
  const [wsUrl, setWsUrl] = useState<string>(defaultWs);
  const [bridgeStatus, setBridgeStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [bridgeLog, setBridgeLog] = useState<Array<{ timestamp: string; direction: 'in' | 'out'; payload: string }>>([]);
  const wsRef = useRef<WebSocket | null>(null);

  // Speech Recognition instance
  const speechRecognizerRef = useRef<SpeechRecognizerHandle | null>(null);

  // Display speech bubble helper
  const showBubble = useCallback((text: string, durationMs = 3200) => {
    setBubbleText(text);
    setBubbleVisible(true);
    if (bubbleTimeoutRef.current) clearTimeout(bubbleTimeoutRef.current);
    bubbleTimeoutRef.current = setTimeout(() => {
      setBubbleVisible(false);
    }, durationMs);
  }, []);

  // Voice utterance helper (with ElevenLabs fallback)
  const vocalize = useCallback(
    (text: string, faceOverride: FaceState = 'SPEAKING') => {
      if (!speakerEnabled) return;
      const clip = clipDeTexto(text);
      if (clip) {
        setFace(clip.id === 'je' ? 'HAPPY' : faceOverride === 'SPEAKING' && /canta|bitter|queen|ligera|runaway/.test(text) ? 'HAPPY' : faceOverride);
        showBubble(text);
        setFace('HAPPY');
        playFile(clip.file, () => setFace('IDLE'), () => speakUtterance(text, { enabled: true, onEnd: () => setFace('IDLE') }));
        return;
      }
      setFace('THINKING');

      const browserFallback = () =>
        speakUtterance(text, { enabled: true, onEnd: () => setFace('IDLE') });

      const voz = vozPorId(vozId);
      const ac = newTtsAbort();
      const speakBlob = (blob: Blob, last: boolean) => {
        const play = colaVacia() ? playWavBlob : enqueueWav;
        return play(blob, () => { if (last) setFace('IDLE'); }, browserFallback);
      };
      fetch('/api/tts/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          voice: voz.id,
          instruct: voz.instruct,
          engine: 'auto',
          voiceId: voz.elevenVoiceId,
        }),
        signal: ac.signal,
      })
        .then(async (r) => {
          const ctype = r.headers.get('content-type') || '';
          if (!r.ok) throw new Error('tts-stream-off');
          if (ctype.includes('audio')) {
            setFace(faceOverride);
            showBubble(text);
            const blob = await r.blob();
            await playWavBlob(blob, () => setFace('IDLE'), browserFallback);
            return;
          }
          const reader = r.body?.getReader();
          if (!reader) throw new Error('no-body');
          const dec = new TextDecoder();
          let buf = '';
          let first = true;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const parts = buf.split('\n\n');
            buf = parts.pop() || '';
            for (const part of parts) {
              const line = part.replace(/^data:\s*/, '').trim();
              if (!line) continue;
              let j: any;
              try { j = JSON.parse(line); } catch { continue; }
              if (j.done) continue;
              if (j.audio) {
                const raw = atob(j.audio);
                const arr = new Uint8Array(raw.length);
                for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
                const blob = new Blob([arr], { type: 'audio/wav' });
                if (first) {
                  first = false;
                  setFace(faceOverride);
                  await playWavBlob(blob);
                } else {
                  enqueueWav(blob);
                }
              }
            }
          }
          if (first) throw new Error('empty-stream');
        })
        .catch((err: any) => {
          if (err?.name === 'AbortError') return;
          if (activeVoice?.apiKey) {
            speakWithElevenLabsOrFallback(text, activeVoice, {
              onStart: () => setFace(faceOverride),
              onEnd: () => setFace('IDLE'),
              onError: browserFallback,
            });
          } else {
            browserFallback();
          }
        });
    },
    [showBubble, speakerEnabled, activeVoice, vozId]
  );

  // Add log to bridge telemetry
  const logBridgeEvent = useCallback((direction: 'in' | 'out', payload: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setBridgeLog((prev) => [{ timestamp, direction, payload }, ...prev.slice(0, 30)]);
  }, []);

  // Boot: ojos + chequeo silencioso. Sin muro de sistema.
  useEffect(() => {
    let cancelled = false;
    const nombre = currentUser.name || 'José';

    fetch('/api/ultron/sesion', { headers: headersMesa() })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.authenticated && data.user) {
          setCurrentUser({
            name: data.user.nombre || 'José',
            role: data.user.rol || 'Junta Directiva · Orden Global',
            authenticated: true,
          });
        }
      })
      .catch(() => {});

    Promise.race([
      fetch('/api/health').then((r) => r.json()).catch(() => null),
      new Promise((resolve) => setTimeout(() => resolve(null), 2500)),
    ]).then((health: any) => {
      if (cancelled) return;
      setIsBooting(false);
      playSfx('boot', true);
      setCerebroListo('calentando');
      setMicEnabled(true);
      vocalize('Espera. Estamos calentando el motor de veintisiete B.');
      fetch('/api/nodo/listo')
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return;
          if (d?.listo) {
            setCerebroListo('listo');
            vocalize(saludoHora().id);
          } else {
            setCerebroListo('calentando');
          }
        })
        .catch(() => { if (!cancelled) setCerebroListo('frio'); });
    });

    const fallback = setTimeout(() => {
      if (cancelled) return;
      setIsBooting(false);
    }, 3200);

    return () => {
      cancelled = true;
      clearTimeout(fallback);
    };
  }, []);

  useEffect(() => {
    if (cerebroListo === 'listo') return;
    const id = setInterval(() => {
      fetch('/api/nodo/listo')
        .then((r) => r.json())
        .then((d) => {
          if (d?.listo) {
            setCerebroListo((s) => {
              if (s !== 'listo') vocalize(saludoHora().id);
              return 'listo';
            });
            setMicEnabled(true);
          } else {
            setCerebroListo((s) => (s === 'listo' ? s : 'calentando'));
          }
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(id);
  }, [cerebroListo]);

  // Handle Fullscreen Toggle
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // Change Face with optional auto-reset to IDLE
  const handleFaceChange = useCallback(
    (newFace: FaceState, durationMs?: number) => {
      setFace(newFace);
      if (durationMs && durationMs > 0) {
        setTimeout(() => {
          setFace((curr) => (curr === newFace ? 'IDLE' : curr));
        }, durationMs);
      }
    },
    []
  );

  // Wake and Sleep
  const handleWake = useCallback(() => {
    setFace('IDLE');
    playSfx('wake', soundFxEnabled);
    vocalize('Aquí.');
  }, [soundFxEnabled, vocalize]);

  const handleSleep = useCallback(() => {
    setFace('SLEEPING');
    playSfx('sleep', soundFxEnabled);
  }, [soundFxEnabled]);

  // Trigger expressive photo capture with shutter effect
  const handleTriggerPhoto = useCallback(() => {
    playSfx('shutter', soundFxEnabled);
    setIsCameraFlashing(true);
    vocalize('Foto.');

    setTimeout(() => {
      setIsCameraFlashing(false);
    }, 450);
  }, [soundFxEnabled, vocalize]);

  // Trigger holographic drink
  const handleTriggerDrink = useCallback(() => {
    if (drinkTimerRef.current) clearTimeout(drinkTimerRef.current);
    setIsDrinking(true);
    setFace('HAPPY');
    playSfx('purr', soundFxEnabled);
    vocalize('Salud.');

    drinkTimerRef.current = setTimeout(() => {
      setIsDrinking(false);
      setFace('IDLE');
    }, 4500);
  }, [soundFxEnabled, vocalize]);

  // Trigger robotic wave greeting
  const handleTriggerWave = useCallback(() => {
    if (waveTimerRef.current) clearTimeout(waveTimerRef.current);
    setIsWaving(true);
    setFace('HAPPY');
    playSfx('wink', soundFxEnabled);
    vocalize('Hola.');

    waveTimerRef.current = setTimeout(() => {
      setIsWaving(false);
      setFace('IDLE');
    }, 3800);
  }, [soundFxEnabled, vocalize]);

  // Trigger Combat Blaster Mode (with auto-disarm timeout)
  const handleTriggerCombat = useCallback(() => {
    if (combatTimerRef.current) clearTimeout(combatTimerRef.current);
    setIsCombatBlasterActive(true);
    setFace('FURY');
    playSfx('angry', soundFxEnabled);
    vocalize('Blaster.');

    combatTimerRef.current = setTimeout(() => {
      setIsCombatBlasterActive(false);
      setFace('IDLE');
    }, 3200);
  }, [soundFxEnabled, vocalize]);

  // Force Reset & Normalize Ultron back to calm IDLE state
  const handleNormalize = useCallback(() => {
    if (combatTimerRef.current) clearTimeout(combatTimerRef.current);
    if (drinkTimerRef.current) clearTimeout(drinkTimerRef.current);
    if (waveTimerRef.current) clearTimeout(waveTimerRef.current);

    setIsCombatBlasterActive(false);
    setIsDrinking(false);
    setIsWaving(false);
    setIsCameraFlashing(false);
    setFace('IDLE');
    setResetTrigger((prev) => prev + 1);
    stopCurrentVoice();
    stopVoice();
    playSfx('tap', soundFxEnabled);
    vocalize('Listo.');
  }, [soundFxEnabled, vocalize]);

  // Handle presence events from optical tracking
  const handlePresenceEvent = useCallback((event: { type: 'wave' | 'drink'; spatialZone: string }) => {
    if (event.type === 'wave') {
      handleTriggerWave();
    } else if (event.type === 'drink') {
      handleTriggerDrink();
    }
  }, [handleTriggerWave, handleTriggerDrink]);

  const lastFaceSeenRef = useRef<number>(0);
  const sawFaceOnceRef = useRef(false);
  const sleptByAbsenceRef = useRef(false);

  useEffect(() => {
    if (cameraGaze.active) {
      sawFaceOnceRef.current = true;
      lastFaceSeenRef.current = Date.now();
      if (sleptByAbsenceRef.current && face === 'SLEEPING') {
        sleptByAbsenceRef.current = false;
        handleWake();
      }
    }
  }, [cameraGaze.active, face, handleWake]);

  useEffect(() => {
    const id = setInterval(() => {
      if (isBooting || dockOpen || settingsOpen) return;
      if (!sawFaceOnceRef.current) return;
      if (face === 'SPEAKING' || face === 'THINKING' || face === 'LISTENING') return;
      if (!cameraGaze.active && lastFaceSeenRef.current && Date.now() - lastFaceSeenRef.current > 45000 && face !== 'SLEEPING') {
        sleptByAbsenceRef.current = true;
        setFace('SLEEPING');
      }
    }, 2000);
    return () => clearInterval(id);
  }, [cameraGaze.active, face, isBooting, dockOpen, settingsOpen]);

  // Speech Recognition hook with full barge-in interruption
  useEffect(() => {
    if (!micEnabled) {
      if (speechRecognizerRef.current) {
        speechRecognizerRef.current.stop();
        speechRecognizerRef.current = null;
      }
      return;
    }

    const rec = initSpeechRecognizer(
      (text, isFinal) => {
        if (!text.trim()) return;
        if (isFinal) {
          if (cerebroListoRef.current !== 'listo') {
            showBubble(cerebroListoRef.current === 'calentando' ? 'Calentando el 27B… espera la luz cian.' : 'Cerebro frío. Espera.');
            return;
          }
          setFace(caraDeTexto(text));
          handleVoiceCommand(text.trim());
        } else {
          // Live stream transcript
          showBubble(text, 2500);
          setFace('LISTENING');
        }
      },
      () => {
        bargeIn();
        setFace('LISTENING');
        showBubble('Escuchando...');
      },
      () => {
        // Recognition ended / auto-restarted
      },
      (err) => {
        const msg = String((err as any)?.error || (err as any)?.message || err);
        if (/not-allowed|mic-denied|denied/i.test(msg)) {
          showBubble('Permite el micrófono en el navegador para hablarme.');
          setMicEnabled(false);
        }
      }
    );

    if (rec) {
      speechRecognizerRef.current = rec;
      rec.start();
    } else {
      showBubble('Este navegador no oye voz. Usá Chrome o el botón de hablar.');
    }

    return () => {
      if (speechRecognizerRef.current) {
        speechRecognizerRef.current.stop();
        speechRecognizerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micEnabled]);

  // Manual Trigger Voice
  const triggerVoicePipeline = () => {
    if (cerebroListoRef.current !== 'listo') {
      showBubble(cerebroListoRef.current === 'calentando' ? 'Aún calienta. Espera la luz cian.' : 'Cerebro no listo.');
      playSfx('tap', soundFxEnabled);
      return;
    }
    if (!micEnabled) {
      setMicEnabled(true);
      playSfx('wake', soundFxEnabled);
      vocalize('Micrófono activado. Te escucho.');
      return;
    }

    playSfx('tap', soundFxEnabled);
    setFace('LISTENING');
    showBubble('Te escucho');
    if (speechRecognizerRef.current) {
      speechRecognizerRef.current.start();
    }
  };

  // Thinking & Speaking Simulation
  const proceedThinkingAndSpeaking = (textToSpeak: string) => {
    setFace('THINKING');
    playSfx('think', soundFxEnabled);
    setTimeout(() => {
      vocalize(textToSpeak);
    }, 900);
  };

  const askCerebro = (cmd: string) => {
    setFace(caraDeTexto(cmd) === 'LISTENING' ? 'THINKING' : caraDeTexto(cmd));
    stopVoice();
    const rec = cmd.match(/recuerda(?: que)? (.+)/i);
    if (rec) {
      guardarHecho(rec[1], { usuario: currentUser.name });
      pendienteCerebro.hecho = rec[1];
    } else if (/junta|rol|medardo|guarda|anota|se llama|orden global|prospera|mina|aucorp|ordenex/i.test(cmd) && cmd.length > 12) {
      guardarHecho(cmd, { usuario: currentUser.name });
      pendienteCerebro.hecho = cmd;
    }
    const quiereVer = /qu[eé] ves|qu[eé] hay aqu[ií]|imagen|c[aá]mara|le[eé] (esto|la foto)/i.test(cmd);
    const image = quiereVer ? grabFrame() : null;
    pedirTurno({ message: cmd, mode, historial: historialRef.current, image, usuario: currentUser.name })
      .then((data) => {
        if (data.error === 'sesión requerida' || /sesión requerida|privado|sesion_requerida/i.test(String(data.error || ''))) {
          setIsBiometricOpen(true);
          vocalize('ULTRON es privado. Entra con tu sesión de junta.');
          return;
        }
        const text = data.reply || data.error || 'Qwen no contestó.';
        historialRef.current = [...historialRef.current, { rol: 'user', texto: cmd }, { rol: 'ultron', texto: String(text) }].slice(-12);
        fetch('/api/memoria', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headersMesa() },
          body: JSON.stringify({ corta: historialRef.current, usuario: currentUser.name }),
        }).catch(() => {});
        if (data.foto) logBridgeEvent('in', `foto ${data.foto}`);
        logBridgeEvent('in', `${data.modelo || 'turno'} ${data.ms || ''}ms`);
        const pregunta =
          pendienteCerebro.hecho && /orden global|junta|mina|prospera|aucorp|token|fund|cofund|concesi/i.test(cmd)
            ? ' ¿Lo actualizo en el cerebro Genesis Core?'
            : '';
        vocalize(String(text) + pregunta);
      })
      .catch((e) => {
        setFace('CONCERNED');
        const local = /orden global|origen|veta|5550|b[oó]veda|genesis|auka/i.test(cmd)
          ? 'Orden Global: junta José y Medardo, cadena 5550, ORIGEN es un gramín de oro en bóveda, Veta es la wallet. El 27B no contestó ahora; eso sí consta.'
          : `Sin cerebro: ${String(e?.message || e).slice(0, 120)}`;
        vocalize(local);
      });
  };

  // Dispatcher: gags locales sí; datos SIEMPRE al cerebro.
  const handleVoiceCommand = (cmd: string) => {
    const q = cmd.toLowerCase();
    logBridgeEvent('out', `Comando de voz: "${q}"`);

    if (/actualiza(r)? (el )?cerebro|guarda(lo)? en genesis|s[ií],? (actualiza|guarda|aprend[eé])|aprend[eé] eso|m[eé]telo al cerebro/.test(q)) {
      const hecho = pendienteCerebro.hecho || historialRef.current.filter((h) => h.rol === 'user').slice(-1)[0]?.texto || '';
      if (!hecho) {
        vocalize('Decime el hecho y después “actualiza el cerebro”.');
        return;
      }
      guardarHecho(`[Genesis] ${hecho}`);
      pendienteCerebro.hecho = '';
      vocalize('Quedó en Genesis Core. La próxima pregunta ya lo usa.');
      return;
    }
    if (/^(toma una )?foto$|selfie|sonríe/.test(q) && !/precio|web|página/.test(q)) {
      setIsCameraCountdownModalOpen(true);
      return;
    }
    if (/agua|refresco|bebida|tomas agua/.test(q) && !/precio/.test(q)) {
      handleTriggerDrink();
      return;
    }
    if (/^(hola ultron|saluda|choca)$/.test(q)) {
      handleTriggerWave();
      return;
    }
    if (/blaster|cañones|modo combate/.test(q)) {
      handleTriggerCombat();
      return;
    }
    if (/\b(jedi|sable|espada l[aá]ser)\b/.test(q)) {
      setFace('JEDI');
      vocalize('Sable listo.');
      return;
    }
    if (/emociones|men[uú] de emociones|qu[eé] emociones/.test(q)) {
      vocalize('Puedo: idle, escuchar, pensar, hablar, feliz, preocupado, enojado, furia, dormir, susto, ronroneo, guiño, curiosidad y jedi. Decime el nombre.');
      return;
    }
    const caraVoz: { re: RegExp; face: FaceState; dicho: string }[] = [
      { re: /\benojad/, face: 'ANGRY', dicho: 'Enojado.' },
      { re: /\bfuria|\bfurioso/, face: 'FURY', dicho: 'Furia.' },
      { re: /\bfeliz|\bcontento|\balegre/, face: 'HAPPY', dicho: 'Feliz.' },
      { re: /\bpreocup/, face: 'CONCERNED', dicho: 'Preocupado.' },
      { re: /\bcurios/, face: 'CURIOSITY', dicho: 'Curioso.' },
      { re: /\bgui[nñ]o/, face: 'WINK', dicho: 'Guiño.' },
      { re: /\bronroneo|\bpurr/, face: 'PURR', dicho: 'Así.' },
      { re: /\bsusto|\basust/, face: 'STARTLE', dicho: 'Susto.' },
      { re: /\bpensando|\bpensar/, face: 'THINKING', dicho: 'Pensando.' },
    ];
    for (const c of caraVoz) {
      if (c.re.test(q) && q.length < 48) {
        setFace(c.face);
        vocalize(c.dicho);
        return;
      }
    }
    if (/gafas|lentes|visor/.test(q)) {
      setHasVisor((prev) => {
        const next = !prev;
        playSfx('visor', soundFxEnabled);
        vocalize(next ? 'Gafas puestas.' : 'Gafas guardadas.');
        return next;
      });
      return;
    }
    if (/dormir|reposo/.test(q)) {
      handleSleep();
      return;
    }
    if (/despertar/.test(q)) {
      handleWake();
      return;
    }
    if (/chiste|cont[aá]me un chiste|hazme re[ií]r|otro chiste/.test(q)) {
      setFace('HAPPY');
      vocalize(siguienteChiste().id);
      return;
    }
    if (/discurso|v[eé]ndete|qui[eé]n eres de verdad|tu misi[oó]n/.test(q)) {
      vocalize('discurso');
      return;
    }
    if (/qui[eé]n eres|qu[eé] eres|qui[eé]n sos|qu[eé] es ultron/.test(q)) {
      vocalize('quien');
      return;
    }
    if (/qu[eé] puedes|qu[eé] hac[eé]s|capacidades|qu[eé] sabes hacer/.test(q)) {
      vocalize('puedo');
      return;
    }
    if (/\bcanta|\bcanci[oó]n|\bfavorita|bruno|die with/.test(q)) {
      const clip =
        clipDeTexto(q) ||
        clipDeTexto(
          /bruno|die with|canta\s*5|mundo/.test(q)
            ? 'bruno'
            : /queen|bohemian|canta\s*1/.test(q)
              ? 'bohemian'
              : /ligera|soda|canta\s*2/.test(q)
                ? 'ligera'
                : /jos[eé]|runaway|kanye|canta\s*4/.test(q)
                  ? 'runaway'
                  : 'bittersweet'
        );
      if (clip) {
        setFace('HAPPY');
        vocalize(clip.id === 'bittersweet' ? 'favorita de Medardo bittersweet' : clip.id);
        return;
      }
    }

    const modoVoz: { re: RegExp; mode: Mode; dicho: string }[] = [
      { re: /modo explorador|explorador/, mode: 'EXPLORER', dicho: 'Modo explorador.' },
      { re: /modo guardi[aá]n|guardi[aá]n/, mode: 'GUARDIAN', dicho: 'Modo guardián.' },
      { re: /modo miner[ií]a|miner[ií]a/, mode: 'MINING', dicho: 'Modo minería.' },
      { re: /modo oro|modo gold/, mode: 'GOLD', dicho: 'Modo oro.' },
      { re: /modo creativo/, mode: 'CREATIVE', dicho: 'Modo creativo.' },
      { re: /modo anal[ií]tico/, mode: 'ANALYTICAL', dicho: 'Modo analítico.' },
      { re: /modo estrat[eé]gico/, mode: 'STRATEGIC', dicho: 'Modo estratégico.' },
    ];
    for (const m of modoVoz) {
      if (m.re.test(q)) {
        setMode(m.mode);
        playSfx(m.mode === 'GOLD' ? 'gold' : 'mode', soundFxEnabled);
        vocalize(m.dicho);
        return;
      }
    }

    askCerebro(cmd);
  };

  // Permission Responses
  const handleDenyPermission = () => {
    setPendingPermission(null);
    setFace('CONCERNED');
    playSfx('deny', soundFxEnabled);
    vocalize('Sin autorización expresa de la junta, no puedo despachar.');
    logBridgeEvent('out', 'Permiso denegado por el usuario.');
  };

  const handleGrantPermission = () => {
    if (pendingPermission) {
      setGrantedPerms((prev) => ({ ...prev, [pendingPermission.serviceKey]: true }));
      logBridgeEvent('out', `Permiso ${pendingPermission.serviceKey} CONCEDIDO.`);
    }
    setPendingPermission(null);
    setFace('SPEAKING');
    playSfx('grant', soundFxEnabled);
    vocalize('Autorizado por el directorio. Despacho ejecutado.');
  };

  // WebSocket Backend Bridge Lifecycle
  const handleConnectWs = () => {
    setBridgeStatus('connecting');
    logBridgeEvent('out', `Intentando conexión WebSocket a ${wsUrl}...`);

    try {
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        setBridgeStatus('connected');
        playSfx('grant', soundFxEnabled);
        logBridgeEvent('in', 'Conexión WebSocket establecida con éxito.');
        vocalize('Enlace con cerebro exterior establecido.');
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          logBridgeEvent('in', event.data);
          handleSimulateIncoming(data);
        } catch {
          logBridgeEvent('in', `Mensaje no JSON: ${event.data}`);
        }
      };

      socket.onerror = () => {
        setBridgeStatus('error');
        logBridgeEvent('in', 'Error en socket. Verifique si el servidor Qwen/FastAPI está corriendo.');
      };

      socket.onclose = () => {
        setBridgeStatus('disconnected');
        logBridgeEvent('in', 'WebSocket cerrado.');
      };
    } catch (err) {
      setBridgeStatus('error');
      logBridgeEvent('in', `Fallo al inicializar WebSocket: ${String(err)}`);
    }
  };

  const handleDisconnectWs = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setBridgeStatus('disconnected');
    logBridgeEvent('out', 'Desconectado manualmente.');
  };

  // Ingest incoming data (from live WS or from the simulator panel)
  const handleSimulateIncoming = (data: {
    face?: FaceState;
    mode?: Mode;
    speak?: string;
    gaze?: { x: number; y: number };
  }) => {
    if (data.mode) {
      setMode(data.mode);
      playSfx('mode', soundFxEnabled);
    }
    if (data.face) {
      setFace(data.face);
    }
    if (data.speak) {
      vocalize(data.speak, data.face || 'SPEAKING');
    }
  };

  return (
    <div
      id="ultron-app-root"
      className="relative w-screen h-screen overflow-hidden bg-black flex items-center justify-center select-none"
    >
      {/* Stand Frame Container: Supports both Horizontal (Desk Kiosk LOOI Stand) and Vertical (Handheld Smartphone) */}
      <div
        id="ultron-stand-container"
        className={`relative overflow-hidden transition-all duration-300 flex items-center justify-center ${
          orientation === 'vertical'
            ? 'w-full max-w-[430px] h-[92vh] rounded-[36px] border-[10px] border-[#181d22] shadow-[0_25px_70px_rgba(0,0,0,0.95),0_0_30px_rgba(5,225,255,0.2)] ring-1 ring-white/10'
            : isKioskFrame
            ? 'w-full max-w-[96vw] max-h-[88vh] aspect-[16/10] rounded-[28px] border-[10px] border-[#15191e] shadow-[0_20px_60px_rgba(0,0,0,0.9),0_0_20px_rgba(5,225,255,0.15)] ring-1 ring-white/10'
            : 'w-full h-full max-w-full max-h-full'
        }`}
      >
        {/* Procedural Living Face Canvas with LOOI OLED & Interaction Physics */}
        <FaceCanvas
          lipLevel={lipLevel}
          showHud={false}
          face={face}
          mode={mode}
          energy={energy}
          soundFxEnabled={soundFxEnabled}
          hasVisor={FUN_MODE && hasVisor}
          cameraGaze={cameraGaze}
          isDrinking={isDrinking}
          isWaving={isWaving}
          isCameraFlashing={isCameraFlashing}
          isCombatBlasterActive={isCombatBlasterActive}
          resetTrigger={resetTrigger}
          onBlasterCombatEnd={() => {
            setIsCombatBlasterActive(false);
            setFace('IDLE');
          }}
          onSnapshotReady={(dataUrl) => {
            const newPhoto: CapturedPhoto = {
              id: Date.now().toString(),
              dataUrl,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
              mode,
              caption: `Captura LOOI Desktop Agent · Expresión ${face} · Modo ${mode}`,
            };
            setPhotos((prev) => [newPhoto, ...prev]);
            setIsPhotoModalOpen(true);
          }}
          onFaceChange={handleFaceChange}
          onModeChange={(newMode) => {
            setMode(newMode);
            playSfx(newMode === 'GOLD' ? 'gold' : 'mode', soundFxEnabled);
          }}
          onToggleVisor={() => {
            setHasVisor((prev) => {
              const next = !prev;
              playSfx('visor', soundFxEnabled);
              return next;
            });
          }}
          onSwipeUp={() => {
            setDockOpen(true);
            setSettingsOpen(false);
          }}
          onSwipeDown={() => {
            setSettingsOpen(true);
            setDockOpen(false);
          }}
          onTriggerVoice={() => triggerVoicePipeline()}
          onSpeak={(text) => vocalize(text)}
          onWake={handleWake}
          onSleep={handleSleep}
          onCloseOverlays={() => {
            setDockOpen(false);
            setSettingsOpen(false);
          }}
        />

        {/* Clean Executive Telemetry & Controls Bar */}
        <div className="absolute top-4 left-5 right-5 z-20 flex items-center justify-between pointer-events-none">
          {/* Left: Brand & Remote Status Link to ultron.ordenglobal.link */}
          <div className="flex items-center gap-2.5 pointer-events-auto">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/60 border border-[#05E1FF]/30 backdrop-blur-md shadow-[0_0_15px_rgba(5,225,255,0.15)]">
              <span className="w-2 h-2 rounded-full bg-[#05E1FF] animate-pulse" />
              <span className="font-display font-bold tracking-[0.2em] text-[#05E1FF] text-xs">
                ULTRON FP
              </span>
            </div>

            {/* Direct Link & Connection Indicator to Render */}
            <a
              href="https://ultron.ordenglobal.link"
              target="_blank"
              rel="noopener noreferrer"
              title="Nodo Central de Orden Global (Render - ultron.ordenglobal.link). Clic para abrir."
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/50 border border-emerald-400/30 text-[10px] font-mono text-emerald-400 hover:bg-emerald-400/10 transition-colors"
            >
              <Globe className="w-3 h-3" />
              <span>ORDEN GLOBAL</span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            </a>
          </div>

          {/* Right: Essential, decluttered controls */}
          <div className="flex items-center gap-2 pointer-events-auto">
            {/* Listening indicator */}
            {face === 'LISTENING' && (
              <div className="font-display font-bold tracking-[0.25em] text-[#05E1FF] text-[10px] hidden md:block px-2.5 py-1 rounded-full bg-[#05E1FF]/10 border border-[#05E1FF]/30 animate-pulse">
                RECEPTANDO VOZ
              </div>
            )}

            {/* Biometric / Session Access Button */}
            <button
              type="button"
              onClick={() => setIsBiometricOpen(true)}
              title={
                currentUser.authenticated
                  ? `Sesión activa: ${currentUser.name} (${currentUser.role})`
                  : 'Autenticación Biométrica y Acceso a Render (ultron.ordenglobal.link)'
              }
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-mono transition-all cursor-pointer ${
                currentUser.authenticated
                  ? 'bg-[#00FF88]/15 border border-[#00FF88]/50 text-[#00FF88] shadow-[0_0_12px_rgba(0,255,136,0.25)]'
                  : 'bg-black/60 border border-[#05E1FF]/40 text-[#05E1FF] hover:bg-[#05E1FF]/15 shadow-[0_0_10px_rgba(5,225,255,0.2)]'
              }`}
            >
              {currentUser.authenticated ? (
                <>
                  <ShieldCheck className="w-3.5 h-3.5 text-[#00FF88]" />
                  <span className="font-bold">{currentUser.name.toUpperCase()}</span>
                </>
              ) : (
                <>
                  <Fingerprint className="w-3.5 h-3.5 text-[#05E1FF]" />
                  <span className="font-bold">ACCESO</span>
                </>
              )}
            </button>

            <button
              type="button"
              title={
                cerebroListo === 'listo'
                  ? 'Cerebro listo — puedes hablar'
                  : cerebroListo === 'calentando'
                    ? 'Qwen 27B calentando… no preguntes aún'
                    : 'Cerebro frío'
              }
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-[10px] font-mono ${
                cerebroListo === 'listo'
                  ? 'border-[#05E1FF] bg-[#05E1FF]/20 text-[#05E1FF] shadow-[0_0_12px_rgba(5,225,255,0.45)]'
                  : cerebroListo === 'calentando'
                    ? 'border-amber-400/60 bg-amber-400/10 text-amber-300'
                    : 'border-red-500/40 bg-red-500/10 text-red-400'
              }`}
            >
              <span
                className={`inline-block w-2 h-2 rounded-full ${
                  cerebroListo === 'listo' ? 'bg-[#05E1FF] animate-pulse' : cerebroListo === 'calentando' ? 'bg-amber-400 animate-pulse' : 'bg-red-500'
                }`}
              />
              {cerebroListo === 'listo' ? 'LISTO' : cerebroListo === 'calentando' ? 'CALENTA' : 'FRÍO'}
            </button>

            {/* Camera Optical Tracking Toggle */}
            <button
              type="button"
              onClick={() => {
                setVisionEnabled((prev) => {
                  const next = !prev;
                  try { localStorage.setItem('ultron_vision', next ? '1' : '0'); } catch { /* */ }
                  return next;
                });
                playSfx('tap', soundFxEnabled);
              }}
              title={visionEnabled ? 'Cámara frontal activa (siguiendo rostro)' : 'Activar cámara frontal'}
              className={`p-2 rounded-full border transition-all cursor-pointer ${
                visionEnabled
                  ? 'border-[#05E1FF] bg-[#05E1FF]/20 text-[#05E1FF] shadow-[0_0_10px_rgba(5,225,255,0.3)]'
                  : 'border-[#8FA3B0]/30 bg-black/60 text-[#8FA3B0] hover:text-[#05E1FF]'
              }`}
            >
              <Camera className="w-3.5 h-3.5" />
            </button>

            {/* Normalizer / Disarm Reset Button */}
            <button
              type="button"
              onClick={handleNormalize}
              title="Normalizar estado, replegar armas y volver a reposo IDLE"
              className="p-2 rounded-full border border-emerald-400/40 bg-black/60 text-emerald-400 hover:bg-emerald-400/20 transition-all cursor-pointer shadow-[0_0_10px_rgba(52,211,153,0.15)]"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>

            {/* Panel Button (Opens Dock Drawer with all modular tools) */}
            <button
              type="button"
              onClick={() => setDockOpen((prev) => !prev)}
              title="Abrir panel central con herramientas: Bóveda, Playwright, Visión, Blaster"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#05E1FF]/40 bg-[#05E1FF]/10 text-[#05E1FF] hover:bg-[#05E1FF]/25 text-xs font-display font-bold tracking-wider transition-all cursor-pointer shadow-[0_0_12px_rgba(5,225,255,0.2)]"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">PANEL</span>
            </button>

            {/* Battery Indicator */}
            <span className="text-[11px] text-[#8FA3B0] hidden md:flex items-center gap-1 pl-1">
              <BatteryMedium className="w-3.5 h-3.5 text-[#05E1FF]" />
              {Math.round(energy)}%
            </span>

            {/* Fullscreen Kiosk Toggle */}
            <button
              type="button"
              onClick={toggleFullscreen}
              title="Pantalla Completa"
              className="p-2 rounded-full text-[#8FA3B0] hover:text-[#05E1FF] hover:bg-[#05E1FF]/10 transition-colors cursor-pointer bg-black/40 border border-white/10"
            >
              {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Central Speech Bubble */}
        <div
          id="ultron-speech-bubble"
          className={`absolute left-1/2 bottom-[17%] -translate-x-1/2 z-20 max-w-[85vw] sm:max-w-xl text-center px-4 py-2 rounded-full border border-[#05E1FF]/30 bg-black/75 backdrop-blur-sm text-sm font-mono text-[#dff8ff] transition-all duration-300 pointer-events-none shadow-[0_0_20px_rgba(5,225,255,0.2)] ${
            bubbleVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
          }`}
        >
          {bubbleText}
        </div>

        {/* Personality Mode Tag */}
        <div
          id="ultron-mode-tag"
          className="absolute left-1/2 bottom-[10%] -translate-x-1/2 z-10 font-display font-bold tracking-[0.38em] text-[11px] text-[#05E1FF]/35 pointer-events-none flex items-center gap-2"
        >
          <span>{mode}</span>
          {mode === 'GOLD' && <Sparkles className="w-3.5 h-3.5 text-[#F5C542]" />}
        </div>

        {/* Floating Quick Drawer Swipe Indicator */}
        <div
          className={`absolute bottom-2 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-1 opacity-40 hover:opacity-100 transition-opacity cursor-pointer ${
            dockOpen || settingsOpen ? 'hidden' : 'block'
          }`}
          onClick={() => setDockOpen(true)}
          title="Desliza hacia arriba para controles y voz"
        >
          <div className="w-10 h-1 rounded-full bg-[#05E1FF]/50" />
        </div>

        {/* Vision & Optical Tracking HUD Overlay with Spatial Tracking and Quick Actions */}
        <VisionOverlay
          isActive={visionEnabled}
          stealth
          onClose={() => setVisionEnabled(false)}
          onGazeUpdate={setCameraGaze}
          onPresenceEvent={handlePresenceEvent}
          onTriggerPhoto={handleTriggerPhoto}
          onTriggerDrink={handleTriggerDrink}
          onTriggerWave={handleTriggerWave}
          onTriggerBlaster={handleTriggerCombat}
        />

        {/* Slide-Up Dock Drawer */}
        <DockDrawer
          isOpen={dockOpen}
          onClose={() => setDockOpen(false)}
          micEnabled={micEnabled}
          speakerEnabled={speakerEnabled}
          visionEnabled={visionEnabled}
          isSleeping={face === 'SLEEPING'}
          isKioskFrame={isKioskFrame}
          soundFxEnabled={soundFxEnabled}
          hasVisor={hasVisor}
          onToggleMic={() => {
            setMicEnabled((prev) => !prev);
            playSfx('tap', soundFxEnabled);
          }}
          onToggleSpeaker={() => {
            setSpeakerEnabled((prev) => !prev);
            playSfx('tap', soundFxEnabled);
          }}
          onToggleVision={() => {
            setVisionEnabled((prev) => !prev);
            playSfx('tap', soundFxEnabled);
          }}
          onToggleVisor={() => {
            setHasVisor((prev) => {
              const next = !prev;
              playSfx('visor', soundFxEnabled);
              return next;
            });
          }}
          onOpenAgenticHarness={() => {
            setDockOpen(false);
            setHarnessModalOpen(true);
          }}
          onOpenBiometric={() => {
            setDockOpen(false);
            setIsBiometricOpen(true);
          }}
          onOpenPhotos={() => {
            setDockOpen(false);
            setIsPhotoModalOpen(true);
          }}
          onOpenVoices={() => {
            setDockOpen(false);
            setIsVoiceModalOpen(true);
          }}
          onOpenVault={() => {
            setDockOpen(false);
            setIsVaultModalOpen(true);
          }}
          onOpenTutorial={() => {
            setDockOpen(false);
            setIsTutorialOpen(true);
          }}
          onResetToNormal={() => {
            setDockOpen(false);
            handleNormalize();
          }}
          onOpenCloudModal={() => {
            setDockOpen(false);
            setIsAwsDeploymentModalOpen(true);
          }}
          onOpenCameraCountdown={() => {
            setDockOpen(false);
            setIsCameraCountdownModalOpen(true);
          }}
          onOpenVisionAnalyzer={() => {
            setDockOpen(false);
            setIsVisionAnalyzerOpen(true);
          }}
          onOpenPlaywrightBrowser={() => {
            setDockOpen(false);
            setIsPlaywrightBrowserOpen(true);
          }}
          onOpenGlobalOrderBrain={() => {
            setDockOpen(false);
            setIsGlobalOrderBrainOpen(true);
          }}
          onTriggerDrink={() => {
            setDockOpen(false);
            handleTriggerDrink();
          }}
          onTriggerWave={() => {
            setDockOpen(false);
            handleTriggerWave();
          }}
          onTriggerCombat={() => {
            setDockOpen(false);
            handleTriggerCombat();
          }}
          onToggleSleep={() => {
            setDockOpen(false);
            if (face === 'SLEEPING') {
              handleWake();
            } else {
              handleSleep();
            }
          }}
          onToggleKioskFrame={() => {
            setIsKioskFrame((prev) => !prev);
            playSfx('tap', soundFxEnabled);
          }}
          onSubmitCommand={(cmd) => {
            setDockOpen(false);
            handleVoiceCommand(cmd);
          }}
        />

        {/* Slide-Down Settings Sheet */}
        <SettingsSheet
          isOpen={settingsOpen}
          currentMode={mode}
          currentFace={face}
          soundFxEnabled={soundFxEnabled}
          speakerEnabled={speakerEnabled}
          onClose={() => setSettingsOpen(false)}
          onSelectMode={(newMode) => {
            setMode(newMode);
            playSfx(newMode === 'GOLD' ? 'gold' : 'mode', soundFxEnabled);
            vocalize(`Modo ${newMode} configurado.`);
          }}
          onSelectFace={(newFace) => {
            handleFaceChange(newFace, newFace === 'IDLE' ? 0 : 2500);
          }}
          onToggleSoundFx={() => setSoundFxEnabled((prev) => !prev)}
          onToggleSpeaker={() => setSpeakerEnabled((prev) => !prev)}
          onOpenBackendBridge={() => {
            setSettingsOpen(false);
            setBackendBridgeOpen(true);
          }}
          onOpenAndroidBlueprint={() => {
            setSettingsOpen(false);
            setAndroidBlueprintOpen(true);
          }}
          onOpenBiometric={() => {
            setSettingsOpen(false);
            setIsBiometricOpen(true);
          }}
          onOpenVoices={() => {
            setSettingsOpen(false);
            setIsVoiceModalOpen(true);
          }}
          onOpenVault={() => {
            setSettingsOpen(false);
            setIsVaultModalOpen(true);
          }}
          onOpenPhotos={() => {
            setSettingsOpen(false);
            setIsPhotoModalOpen(true);
          }}
          onDownloadSimulator={() => {
            setSettingsOpen(false);
            downloadStandaloneSimulator();
          }}
        />

        {/* Permission Gate Modal */}
        <PermissionModal
          request={pendingPermission}
          onDeny={handleDenyPermission}
          onGrant={handleGrantPermission}
        />

        {/* Backend Bridge Drawer / Modal */}
        <BackendBridgeModal
          isOpen={backendBridgeOpen}
          onClose={() => setBackendBridgeOpen(false)}
          wsUrl={wsUrl}
          onChangeWsUrl={setWsUrl}
          status={bridgeStatus}
          onConnect={handleConnectWs}
          onDisconnect={handleDisconnectWs}
          onSimulateIncoming={handleSimulateIncoming}
          log={bridgeLog}
        />

        {/* Android Native Architecture Blueprint Modal */}
        <AndroidBlueprintModal
          isOpen={androidBlueprintOpen}
          onClose={() => setAndroidBlueprintOpen(false)}
        />

        {/* Biometric Authentication Modal */}
        <BiometricAuthModal
          isOpen={isBiometricOpen}
          onClose={() => setIsBiometricOpen(false)}
          soundFxEnabled={soundFxEnabled}
          onSpeak={(t) => vocalize(t)}
          onAuthSuccess={(name, role) => {
            setCurrentUser({ name, role, authenticated: true });
            vocalize(`Acceso confirmado. Bienvenido ${name}. Privilegios ejecutivos desbloqueados.`);
            setFace('HAPPY');
            playSfx('grant', soundFxEnabled);
          }}
        />

        {/* Photo Capture & Gallery Modal */}
        <PhotoCaptureModal
          isOpen={isPhotoModalOpen}
          onClose={() => setIsPhotoModalOpen(false)}
          photos={photos}
          onDeletePhoto={(id) => setPhotos((prev) => prev.filter((p) => p.id !== id))}
          onTriggerNewPhoto={handleTriggerPhoto}
        />

        {/* ElevenLabs Neural Voices Modal */}
        <VoicePickerModal
          isOpen={isVoiceModalOpen}
          actual={vozId}
          onClose={() => setIsVoiceModalOpen(false)}
          onSelect={(id) => {
            setVozId(id);
            try { localStorage.setItem('ultron_voz', id); } catch { /* */ }
            setIsVoiceModalOpen(false);
            const v = vozPorId(id);
            vocalize(id === 'looi' ? 'Aquí. En la mesa.' : `Voz ${v.etiqueta}.`);
          }}
        />

        {/* Bóveda Central de ULTRON FP (APIs, ElevenLabs y Conduits Seguros) */}
        <UltronVaultModal
          isOpen={isVaultModalOpen}
          onClose={() => setIsVaultModalOpen(false)}
          activeVoice={activeVoice}
          onSaveVoiceConfig={(v) => {
            setActiveVoice(v);
            vocalize(`Voz configurada a ${v.name}. Credenciales archivadas en la Bóveda.`);
          }}
          onSpeak={(t) => vocalize(t)}
        />

        {/* Live Camera Countdown (3-2-1) & Photo Snapshot Modal */}
        <CameraCountdownModal
          isOpen={isCameraCountdownModalOpen}
          onClose={() => setIsCameraCountdownModalOpen(false)}
          onPhotoCaptured={(photo) => {
            setPhotos((prev) => [photo, ...prev]);
            vocalize('Fotografía capturada y archivada en la memoria segura.');
          }}
          onAnalyzeWithVision={(photoDataUrl) => {
            setVisionMediaData({ url: photoDataUrl, type: 'image' });
            setIsVisionAnalyzerOpen(true);
            vocalize('Cargando fotografía en el motor de visión con auto-purga.');
          }}
        />

        {/* Vision Media Analyzer (Images & Videos) with Zero-Knowledge Auto-Purge */}
        <VisionMediaAnalyzerModal
          isOpen={false}
          onClose={() => setIsVisionAnalyzerOpen(false)}
          initialMediaUrl={visionMediaData.url}
          initialMediaType={visionMediaData.type}
          onSpeak={(t) => vocalize(t)}
        />

        {/* Playwright Headless Web Scraper & Browser on AWS */}
        <PlaywrightBrowserModal
          isOpen={false}
          onClose={() => setIsPlaywrightBrowserOpen(false)}
          onSpeak={(t) => vocalize(t)}
        />

        {/* Global Order Intelligence Strategic Brain Modal */}
        <GlobalOrderBrainModal
          isOpen={false}
          onClose={() => setIsGlobalOrderBrainOpen(false)}
          onSpeak={(t) => vocalize(t)}
        />

        {/* Cloud Infrastructure & Live Render Deployment Modal */}
        <AwsDeploymentModal
          isOpen={false}
          onClose={() => setIsAwsDeploymentModalOpen(false)}
          onSpeak={(t) => vocalize(t)}
          soundFxEnabled={soundFxEnabled}
        />

        {/* Interactive Controls & Features Tutorial Modal */}
        <TutorialModal
          isOpen={false}
          onClose={() => setIsTutorialOpen(false)}
          soundFxEnabled={soundFxEnabled}
        />

        {/* Initial Boot Screen */}
        <div
          id="ultron-boot-screen"
          className={`absolute inset-0 z-50 flex items-center justify-center bg-black transition-opacity duration-700 ${
            isBooting ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
        >
          <div className="flex flex-col items-center gap-6">
            <div className="flex gap-10">
              <span className="block w-16 h-16 rounded-full bg-[#05E1FF] shadow-[0_0_28px_#05E1FF] animate-pulse" />
              <span className="block w-16 h-16 rounded-full bg-[#05E1FF] shadow-[0_0_28px_#05E1FF] animate-pulse" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
