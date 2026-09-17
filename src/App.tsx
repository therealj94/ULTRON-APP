import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Mode, FaceState, BoardPermissionRequest, CapturedPhoto, ElevenLabsVoiceConfig } from './types';
import { FaceCanvas } from './components/FaceCanvas';
import { DockDrawer } from './components/DockDrawer';
import { SettingsSheet } from './components/SettingsSheet';
import { PermissionModal } from './components/PermissionModal';
import { BackendBridgeModal } from './components/BackendBridgeModal';
import { AndroidBlueprintModal } from './components/AndroidBlueprintModal';
import { VisionOverlay } from './components/VisionOverlay';
import { BiometricAuthModal } from './components/BiometricAuthModal';
import { PhotoCaptureModal } from './components/PhotoCaptureModal';
import { UltronVaultModal } from './components/UltronVaultModal';
import { ElevenLabsVoiceModal } from './components/ElevenLabsVoiceModal';
import { CameraCountdownModal } from './components/CameraCountdownModal';
import { VisionMediaAnalyzerModal } from './components/VisionMediaAnalyzerModal';
import { PlaywrightBrowserModal } from './components/PlaywrightBrowserModal';
import { GlobalOrderBrainModal } from './components/GlobalOrderBrainModal';
import { AwsDeploymentModal } from './components/AwsDeploymentModal';
import { TutorialModal } from './components/TutorialModal';
import { playSfx } from './utils/audio';
import { cancelSpeech, initSpeechRecognizer, SpeechRecognizerHandle } from './utils/speech';
import { DEFAULT_ELEVENLABS_VOICES, speakWithElevenLabsOrFallback, stopCurrentVoice } from './utils/elevenlabs';
import { downloadStandaloneSimulator } from './utils/exporter';
import { Maximize2, Minimize2, Camera, ShieldCheck, Sparkles, RotateCcw, Mic, MicOff } from 'lucide-react';
import { AgenticHarnessModal } from './components/AgenticHarnessModal';
import { analyzeConversationTopic, SemanticClassification } from './utils/qwenHarness';
import { streamUltronChat } from './utils/ultronChat';
import { LoginScreen } from './components/LoginScreen';
import { OrientationGate } from './components/OrientationGate';
import { LooiSidebar, DeskPresence } from './components/LooiSidebar';
import { SpeechBubble } from './components/SpeechBubble';
import { isHeyUltron, stripHeyUltron } from './utils/wakeWord';

export default function App() {
  // Session State
  const [face, setFace] = useState<FaceState>('IDLE');
  const [mode, setMode] = useState<Mode>('GUARDIAN');
  const [energy, setEnergy] = useState<number>(85);
  const [isBooting, setIsBooting] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isKioskFrame, setIsKioskFrame] = useState<boolean>(false);
  const [hasVisor, setHasVisor] = useState<boolean>(false);
  const [orientation, setOrientation] = useState<'horizontal' | 'vertical'>('horizontal');
  const [screenFlash, setScreenFlash] = useState<'none' | 'warn' | 'danger'>('none');
  const [commandListening, setCommandListening] = useState(false);
  const speakingRef = useRef(false);
  const lastSpokenRef = useRef({ text: '', at: 0 });
  const listenModeRef = useRef<'wake' | 'command'>('wake');

  // Camera Sensor & Gaze Tracking
  const [cameraGaze, setCameraGaze] = useState<{ x: number; y: number; active: boolean }>({
    x: 0,
    y: 0,
    active: false,
  });

  // Agentic Harness & Qwen 3.8 27B State
  const [autoModeSwitch, setAutoModeSwitch] = useState<boolean>(true);
  const [harnessModalOpen, setHarnessModalOpen] = useState<boolean>(false);
  const [conversationId] = useState(() => `desk-${Date.now().toString(36)}`);
  const chatAbortRef = useRef<AbortController | null>(null);

  // Audio & Hardware State
  const [micEnabled, setMicEnabled] = useState<boolean>(false); // push-to-talk: off al abrir
  const [speakerEnabled, setSpeakerEnabled] = useState<boolean>(true);
  const [soundFxEnabled, setSoundFxEnabled] = useState<boolean>(true);
  const [visionEnabled, setVisionEnabled] = useState<boolean>(false); // cámara OFF al abrir
  const [resetTrigger, setResetTrigger] = useState<number>(0);

  // ElevenLabs Voice Configuration — Nexo by default
  const [activeVoice, setActiveVoice] = useState<ElevenLabsVoiceConfig>(DEFAULT_ELEVENLABS_VOICES[0]);
  const bootDoneRef = useRef(false);
  const presenceCooldownRef = useRef(0);
  const speakSafetyRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  const [sessionReady, setSessionReady] = useState(false);
  const [currentUser, setCurrentUser] = useState<{
    name: string;
    role: string;
    authenticated: boolean;
    correo?: string;
  }>({
    name: '',
    role: '',
    authenticated: false,
  });
  const [deskPresence, setDeskPresence] = useState<DeskPresence>('stay');
  const [fullBubbleText, setFullBubbleText] = useState('');
  const [wantDetail, setWantDetail] = useState<'ask' | 'summary' | 'full' | null>(null);

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
    setFullBubbleText(text);
    setBubbleVisible(true);
    if (bubbleTimeoutRef.current) clearTimeout(bubbleTimeoutRef.current);
    bubbleTimeoutRef.current = setTimeout(() => {
      setBubbleVisible(false);
    }, Math.max(durationMs, 5000));
  }, []);

  // Voice: una sola voz a la vez. Frases cortas → local; resto ElevenLabs.
  const vocalize = useCallback(
    (text: string, faceOverride: FaceState = 'SPEAKING', opts?: { forceEleven?: boolean; allowRepeat?: boolean }) => {
      const clean = text.trim();
      if (!clean) return;

      const now = Date.now();
      // Evitar hablar dos veces el mismo texto seguido
      if (
        !opts?.allowRepeat &&
        lastSpokenRef.current.text === clean &&
        now - lastSpokenRef.current.at < 4500
      ) {
        return;
      }
      // Si ya hay voz activa, cortar y no apilar
      stopCurrentVoice();
      chatAbortRef.current?.abort();

      lastSpokenRef.current = { text: clean, at: now };
      showBubble(clean, Math.min(12000, 2200 + clean.length * 45));
      if (!speakerEnabled) return;

      if (speakSafetyRef.current) clearTimeout(speakSafetyRef.current);
      speakingRef.current = true;
      setFace(faceOverride);

      const releaseFace = () => {
        if (speakSafetyRef.current) {
          clearTimeout(speakSafetyRef.current);
          speakSafetyRef.current = null;
        }
        speakingRef.current = false;
        setFace((curr) => (curr === faceOverride || curr === 'SPEAKING' ? 'IDLE' : curr));
      };

      speakSafetyRef.current = setTimeout(releaseFace, 12000);

      void speakWithElevenLabsOrFallback(
        clean,
        activeVoice,
        {
          onStart: () => {
            speakingRef.current = true;
            setFace(faceOverride);
          },
          onEnd: releaseFace,
          onError: () => releaseFace(),
        },
        { forceEleven: opts?.forceEleven }
      );
    },
    [showBubble, speakerEnabled, activeVoice]
  );

  // Sesión previa (si existe) — no saludar hasta login listo
  useEffect(() => {
    fetch('/api/ultron/sesion')
      .then((res) => res.json())
      .then((data) => {
        if (data.authenticated && data.user) {
          setCurrentUser({
            name: data.user.nombre || 'José',
            role: data.user.rol || 'Junta Directiva · Orden Global',
            authenticated: true,
            correo: data.user.correo,
          });
          setSessionReady(true);
        }
      })
      .catch(() => {});
  }, []);

  // Boot corto solo después del login
  useEffect(() => {
    if (!sessionReady || bootDoneRef.current) return;
    const timer = setTimeout(() => {
      if (bootDoneRef.current) return;
      bootDoneRef.current = true;
      setIsBooting(false);
      playSfx('boot', true);
      vocalize(`Hola ${currentUser.name || ''}. ULTRON listo.`);
    }, 900);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionReady]);

  // Add log to bridge telemetry
  const logBridgeEvent = useCallback((direction: 'in' | 'out', payload: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setBridgeLog((prev) => [{ timestamp, direction, payload }, ...prev.slice(0, 30)]);
  }, []);

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
    setDeskPresence('stay');
    playSfx('wake', soundFxEnabled);
    vocalize('Listo.');
  }, [soundFxEnabled, vocalize]);

  const handleSleep = useCallback(() => {
    setFace('SLEEPING');
    setDeskPresence('sleep');
    setCommandListening(false);
    setMicEnabled(false);
    listenModeRef.current = 'wake';
    playSfx('sleep', soundFxEnabled);
    // Sin frase larga; confirmación local corta
    vocalize('Modo sleep.', 'SLEEPING');
  }, [soundFxEnabled, vocalize]);

  // Trigger expressive photo capture with shutter effect
  const handleTriggerPhoto = useCallback(() => {
    playSfx('shutter', soundFxEnabled);
    setIsCameraFlashing(true);
    vocalize('¡Sonríe! Tomando captura de alta resolución.');

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
    vocalize('Refresco electro-químico servido. ¡Salud!');

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
    }, 2800);
  }, [soundFxEnabled, vocalize]);

  // Trigger Combat Blaster Mode (with auto-disarm timeout)
  const handleTriggerCombat = useCallback(() => {
    if (combatTimerRef.current) clearTimeout(combatTimerRef.current);
    setIsCombatBlasterActive(true);
    setFace('FURY');
    playSfx('angry', soundFxEnabled);
    vocalize('¡Alerta!');

    combatTimerRef.current = setTimeout(() => {
      setIsCombatBlasterActive(false);
      setScreenFlash('none');
      setFace('IDLE');
    }, 3200);
  }, [soundFxEnabled, vocalize]);

  // Force Reset & Normalize Ultron back to calm IDLE state (silencioso por defecto)
  const handleNormalize = useCallback((opts?: { silent?: boolean }) => {
    if (combatTimerRef.current) clearTimeout(combatTimerRef.current);
    if (drinkTimerRef.current) clearTimeout(drinkTimerRef.current);
    if (waveTimerRef.current) clearTimeout(waveTimerRef.current);

    setIsCombatBlasterActive(false);
    setIsDrinking(false);
    setIsWaving(false);
    setIsCameraFlashing(false);
    setScreenFlash('none');
    setFace('IDLE');
    setResetTrigger((prev) => prev + 1);
    stopCurrentVoice();
    speakingRef.current = false;
    playSfx('tap', soundFxEnabled);
    if (!opts?.silent) {
      // Sin “me reset”: solo confirma corto si el usuario lo pidió por voz
      vocalize('Listo.');
    }
  }, [soundFxEnabled, vocalize]);

  // Handle presence events from optical tracking (cooldown anti-loop)
  const handlePresenceEvent = useCallback((event: { type: 'wave' | 'drink'; spatialZone: string }) => {
    const now = Date.now();
    if (now - presenceCooldownRef.current < 8000) return;
    presenceCooldownRef.current = now;
    if (event.type === 'wave') {
      handleTriggerWave();
    } else if (event.type === 'drink') {
      handleTriggerDrink();
    }
  }, [handleTriggerWave, handleTriggerDrink]);

  // Escucha continua: wake "hey ultron" (también en sleep) + modo comando
  useEffect(() => {
    if (!sessionReady) {
      if (speechRecognizerRef.current) {
        speechRecognizerRef.current.stop();
        speechRecognizerRef.current = null;
      }
      return;
    }

    const enterCommandMode = (hint?: string) => {
      if (deskPresence === 'sleep') {
        setDeskPresence('stay');
      }
      listenModeRef.current = 'command';
      setCommandListening(true);
      setMicEnabled(true);
      setFace('LISTENING');
      showBubble(hint || 'Te escucho…', 4000);
      playSfx('listen', soundFxEnabled);
    };

    const rec = initSpeechRecognizer(
      (text, isFinal) => {
        if (!text.trim()) return;
        const raw = text.trim();

        // En sleep solo reacciona a hey ultron
        if (deskPresence === 'sleep' && !isHeyUltron(raw)) {
          return;
        }

        // Barge-in: si está hablando y dice hey ultron → corta y escucha
        if (speakingRef.current && isHeyUltron(raw)) {
          cancelSpeech();
          stopCurrentVoice();
          speakingRef.current = false;
          chatAbortRef.current?.abort();
          enterCommandMode('Hey Ultron — te escucho');
          const rest = stripHeyUltron(raw);
          if (isFinal && rest.length > 2) {
            listenModeRef.current = 'wake';
            setCommandListening(false);
            setMicEnabled(false);
            handleVoiceCommand(rest);
          }
          return;
        }

        if (listenModeRef.current === 'wake' || deskPresence === 'sleep') {
          if (isHeyUltron(raw)) {
            if (speakingRef.current) {
              cancelSpeech();
              stopCurrentVoice();
              speakingRef.current = false;
              chatAbortRef.current?.abort();
            }
            enterCommandMode('Hey Ultron — te escucho');
            const rest = stripHeyUltron(raw);
            if (isFinal && rest.length > 2) {
              listenModeRef.current = 'wake';
              setCommandListening(false);
              setMicEnabled(false);
              handleVoiceCommand(rest);
            }
          }
          return;
        }

        // Modo comando
        if (isFinal) {
          listenModeRef.current = 'wake';
          setCommandListening(false);
          setMicEnabled(false);
          const cmd = stripHeyUltron(raw) || raw;
          if (cmd.length > 1) handleVoiceCommand(cmd);
        } else {
          showBubble(raw, 2500);
          setFace((f) => (f === 'SPEAKING' ? f : 'LISTENING'));
        }
      },
      () => {
        if (listenModeRef.current === 'command' && !speakingRef.current) {
          setFace('LISTENING');
        }
      },
      () => {},
      () => {}
    );

    if (rec) {
      speechRecognizerRef.current = rec;
      rec.start();
    }

    return () => {
      if (speechRecognizerRef.current) {
        speechRecognizerRef.current.stop();
        speechRecognizerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionReady, deskPresence]);

  // Manual Trigger Voice (botón mic / push-to-talk)
  const triggerVoicePipeline = () => {
    if (deskPresence === 'sleep') {
      setDeskPresence('stay');
      setFace('IDLE');
    }
    playSfx('tap', soundFxEnabled);
    cancelSpeech();
    stopCurrentVoice();
    speakingRef.current = false;
    listenModeRef.current = 'command';
    setCommandListening(true);
    setMicEnabled(true);
    setFace('LISTENING');
    showBubble('Te escucho…', 4000);
  };

  const handleDeskPresence = (p: DeskPresence) => {
    setDeskPresence(p);
    if (p === 'sleep') {
      setMicEnabled(false);
      setCommandListening(false);
      listenModeRef.current = 'wake';
      setVisionEnabled(false);
      handleSleep();
    } else if (p === 'stay') {
      setFace('IDLE');
      setMicEnabled(false);
      setCommandListening(false);
      listenModeRef.current = 'wake';
      vocalize('Modo stay.');
    } else {
      setMode('EXPLORER');
      setFace('HAPPY');
      setCommandListening(false);
      listenModeRef.current = 'wake';
      vocalize('Modo explore.');
    }
  };

  const handlePokeWarn = () => {
    setScreenFlash('warn');
    playSfx('warning', soundFxEnabled);
    setTimeout(() => setScreenFlash('none'), 900);
  };

  const handlePokeBlaster = () => {
    setScreenFlash('danger');
    setIsCombatBlasterActive(true);
    setFace('FURY');
    // Auto reset silencioso tras blasters
    if (combatTimerRef.current) clearTimeout(combatTimerRef.current);
    combatTimerRef.current = setTimeout(() => {
      setScreenFlash('none');
      handleNormalize({ silent: true });
    }, 3200);
  };

  // Thinking & Speaking Simulation
  const proceedThinkingAndSpeaking = (textToSpeak: string) => {
    setFace('THINKING');
    playSfx('think', soundFxEnabled);
    setTimeout(() => {
      vocalize(textToSpeak);
    }, 900);
  };

  const dispatchToolName = useCallback(
    (tool: string, args?: Record<string, unknown>) => {
      logBridgeEvent('out', `Tool Call: ${tool}()`);
      if (tool === 'take_camera_photo_countdown') {
        setIsCameraCountdownModalOpen(true);
      } else if (tool === 'browse_web_page_playwright') {
        setIsPlaywrightBrowserOpen(true);
      } else if (tool === 'analyze_vision_media' || tool === 'open_vision_analyzer') {
        setIsVisionAnalyzerOpen(true);
      } else if (tool === 'query_global_order_brain') {
        setIsGlobalOrderBrainOpen(true);
      } else if (tool === 'trigger_blaster_combat') {
        handleTriggerCombat();
      } else if (tool === 'drink_refreshment') {
        handleTriggerDrink();
      } else if (tool === 'wave_greeting') {
        handleTriggerWave();
      } else if (tool === 'open_biometric_auth') {
        setIsBiometricOpen(true);
      } else if (tool === 'open_cloud_deployment') {
        setIsVaultModalOpen(true);
      }
      void args;
    },
    [handleTriggerCombat, handleTriggerDrink, handleTriggerWave, logBridgeEvent]
  );

  /** Cerebro real: Qwen vía proxy Express (SSE). Herramientas locales se despachan aparte. */
  const askUltronBrain = useCallback(
    async (cmd: string, localTool?: string) => {
      chatAbortRef.current?.abort();
      const ac = new AbortController();
      chatAbortRef.current = ac;
      setFace('THINKING');
      playSfx('think', soundFxEnabled);
      showBubble('Pensando…', 8000);
      logBridgeEvent('out', `Qwen ← "${cmd.slice(0, 120)}"`);

      try {
        const result = await streamUltronChat({
          message: cmd,
          mode,
          conversationId,
          signal: ac.signal,
          onToken: () => {
            setFace('SPEAKING');
          },
        });

        if (result.error && !result.reply) {
          logBridgeEvent('in', `Qwen error: ${result.error}`);
          const classification = analyzeConversationTopic(cmd.toLowerCase());
          if (classification) {
            if (autoModeSwitch && classification.mode !== mode) {
              setMode(classification.mode);
              playSfx(classification.mode === 'GOLD' ? 'gold' : 'mode', soundFxEnabled);
            }
            if (classification.toolCall) dispatchToolName(classification.toolCall.name);
            vocalize(classification.thought);
            return;
          }
          proceedThinkingAndSpeaking(`Nodo ocupado (${result.error}). Reintento disponible.`);
          return;
        }

        if (result.toolCall?.name) {
          dispatchToolName(result.toolCall.name, result.toolCall.arguments);
        } else if (localTool) {
          dispatchToolName(localTool);
        }

        logBridgeEvent('in', `Qwen [${result.model || 'nodo'}]: ${(result.reply || '').slice(0, 160)}`);
        vocalize(result.reply || 'Listo.');
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        logBridgeEvent('in', `Qwen fallo: ${String(err?.message || err)}`);
        proceedThinkingAndSpeaking('No pude contactar el nodo Qwen. Sistemas locales activos.');
      }
    },
    [
      autoModeSwitch,
      conversationId,
      dispatchToolName,
      logBridgeEvent,
      mode,
      soundFxEnabled,
      vocalize,
    ]
  );

  // Dispatcher for voice commands
  const handleVoiceCommand = (cmd: string) => {
    const q = cmd.toLowerCase();
    logBridgeEvent('out', `Comando de voz: "${q}"`);

    // 1. Camera Photo with 3-2-1 Countdown & Live Stream
    if (/foto|captura|fotograf|selfie|picture|cámara|sonríe/.test(q)) {
      setIsCameraCountdownModalOpen(true);
      void askUltronBrain(cmd, 'take_camera_photo_countdown');
      return;
    }

    // 2. Playwright Web Scraping on AWS EC2
    if (/web|página|navega|playwright|sitio|url|investiga|noticia/.test(q)) {
      setIsPlaywrightBrowserOpen(true);
      void askUltronBrain(cmd, 'browse_web_page_playwright');
      return;
    }

    // 3. Vision Media Analysis with Auto-Purge Privacy
    if (/visión|imagen|video|inspeccion|subir|bajar|multimodal|purga/.test(q)) {
      setIsVisionAnalyzerOpen(true);
      void askUltronBrain(cmd, 'open_vision_analyzer');
      return;
    }

    // 4. Cerebro de Inteligencia Estratégica de Orden Global
    if (/orden global|doctrina|geopolítica|tratado|resolución|estatuto|soberanía/.test(q)) {
      setIsGlobalOrderBrainOpen(true);
      void askUltronBrain(cmd, 'query_global_order_brain');
      return;
    }

    // Interactive Drink / Soda
    if (/agua|refresco|bebida|sed|drink|toma/.test(q)) {
      handleTriggerDrink();
      return;
    }

    // Music / headphones expression
    if (/música|musica|canción|cancion|headphones|auricular/.test(q)) {
      setFace('MUSIC');
      vocalize('Poniendo vibes. Auriculares on.');
      setTimeout(() => setFace('IDLE'), 4500);
      return;
    }

    // Confused
    if (/confund|no entiendo|\bhuh\b|no te entiendo/.test(q)) {
      setFace('CONFUSED');
      vocalize('Hmm, ¿puedes repetir más claro?');
      setTimeout(() => setFace('IDLE'), 3500);
      return;
    }

    // Scan
    if (/escanea|escáner|escaner|laser|láser|scan/.test(q)) {
      setFace('SCAN');
      vocalize('Escaneando el escritorio.');
      setTimeout(() => setFace('IDLE'), 4000);
      return;
    }

    // Offline / dead face
    if (/offline|apagado|muerto|desconect/.test(q)) {
      setFace('OFFLINE');
      vocalize('Modo offline simulado.');
      setTimeout(() => setFace('IDLE'), 3500);
      return;
    }

    // Interactive Hand Wave Greeting
    if (/^(hola|saluda|saludo|wave|mano)\b/.test(q) || /saluda|choca la mano/.test(q)) {
      handleTriggerWave();
      return;
    }

    // Combat Blaster Mode
    if (/dispara|arma|pistola|combate|blaster|shoot|fury/.test(q)) {
      handleTriggerCombat();
      return;
    }

    // Biometric Auth Modal
    if (/biometr|huella|seguridad|auth|identidad/.test(q)) {
      setIsBiometricOpen(true);
      vocalize('Iniciando escáner biométrico dactilar.');
      return;
    }

    // ElevenLabs Voices
    if (/voz|voces|elevenlabs|tonalidad/.test(q)) {
      setIsVaultModalOpen(true);
      vocalize('Abriendo la Bóveda de ULTRON FP en el canal de síntesis ElevenLabs.');
      return;
    }

    // Bóveda Central de ULTRON FP, APIs y Conduits
    if (/bóveda|boveda|clave|credencial|conduit|api|llave/.test(q)) {
      setIsVaultModalOpen(true);
      vocalize('Abriendo la Bóveda Central de ULTRON FP. Acceso institucional a credenciales y conduits.');
      return;
    }

    // Backend e Infraestructura
    if (/aws|github|render|despliegue|servidor|nube|sagemaker/.test(q)) {
      setIsVaultModalOpen(true);
      vocalize('Abriendo la Bóveda Central de ULTRON FP. Conexiones backend e infraestructura sincronizadas.');
      return;
    }

    // WhatsApp Dispatch (Requires Board Permission)
    if (/whats|wsp/.test(q)) {
      if (grantedPerms.wa) {
        vocalize('Despachando resumen ejecutivo a WhatsApp.');
      } else {
        setPendingPermission({
          id: 'perm_wa',
          serviceKey: 'wa',
          title: 'DESPACHO WHATSAPP · JUNTA DIRECTIVA',
          description: 'Esta acción transmitirá la minuta ejecutiva cifrada a los teléfonos de la junta directiva.',
          payloadSummary: 'Minuta_Directorio_v3.pdf · 7 destinatarios autorizados',
        });
        setFace('LISTENING');
      }
      return;
    }

    // Corporate Email Draft (Requires Board Permission)
    if (/correo|mail|email/.test(q)) {
      if (grantedPerms.em) {
        vocalize('Borrador institucional generado y archivado en servidor.');
      } else {
        setPendingPermission({
          id: 'perm_em',
          serviceKey: 'em',
          title: 'DESPACHO CORREO INSTITUCIONAL',
          description: 'Generación y envío del memorándum de junta con firma corporativa.',
          payloadSummary: 'Para: consejo@corporacion.global · Asunto: Resoluciones del Directorio',
        });
        setFace('LISTENING');
      }
      return;
    }

    // Visor sunglasses commands
    if (/gafas|lentes|visor|sunglasses/.test(q)) {
      setHasVisor((prev) => {
        const next = !prev;
        playSfx('visor', soundFxEnabled);
        vocalize(next ? 'Visor equipado.' : 'Visor guardado.');
        return next;
      });
      return;
    }

    // Local semantic mode switch (fast) + Qwen for the spoken reply
    if (autoModeSwitch) {
      const classification = analyzeConversationTopic(q);
      if (classification && classification.mode !== mode) {
        setMode(classification.mode);
        playSfx(classification.mode === 'GOLD' ? 'gold' : 'mode', soundFxEnabled);
        logBridgeEvent(
          'in',
          `Modo → ${classification.mode} (${classification.intent})`
        );
      }
      if (classification?.toolCall) {
        dispatchToolName(classification.toolCall.name);
      }
    }

    // Mode switching via command
    if (/modo/.test(q)) {
      const targetMode = (['GUARDIAN', 'MINING', 'GOLD', 'CREATIVE', 'ANALYTICAL', 'STRATEGIC', 'EXPLORER'] as Mode[]).find((m) =>
        q.includes(m.toLowerCase())
      );
      if (targetMode) {
        setMode(targetMode);
        playSfx('mode', soundFxEnabled);
        vocalize(`Modo ${targetMode} activado.`);
        return;
      }
    }

    // Sleep / Wake commands
    if (/dormir|reposo|apagar/.test(q)) {
      handleSleep();
      return;
    }
    if (/despertar|activa/.test(q)) {
      handleWake();
      return;
    }

    // Default: real Qwen brain (corto). Resumen/completo si el usuario lo pide.
    if (/completo|entero|todo el detalle|lee todo|versión completa|version completa/.test(q)) {
      setWantDetail('full');
      void askUltronBrain(`${cmd}\n\n[Usuario pidió la versión completa, puedes extender hasta 2 párrafos.]`);
      return;
    }
    if (/resumen|resum|corto|breve|solo resumen/.test(q)) {
      setWantDetail('summary');
      void askUltronBrain(`${cmd}\n\n[Usuario pidió SOLO resumen en una frase.]`);
      return;
    }
    setWantDetail('ask');
    void askUltronBrain(cmd);
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

  const handleLoginSuccess = (user: { name: string; role: string; correo: string }) => {
    setCurrentUser({
      name: user.name,
      role: user.role,
      authenticated: true,
      correo: user.correo,
    });
    setSessionReady(true);
    playSfx('grant', true);
  };

  return (
    <OrientationGate>
    <div
      id="ultron-app-root"
      className="relative w-screen h-screen overflow-hidden bg-black flex items-center justify-center select-none"
    >
      {!sessionReady && <LoginScreen onAuthenticated={handleLoginSuccess} />}

        {/* Stand Frame */}
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
        {/* Face canvas */}
        <FaceCanvas
          face={face}
          mode={mode}
          energy={energy}
          soundFxEnabled={soundFxEnabled}
          hasVisor={hasVisor}
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
              caption: `Captura ULTRON FP · Expresión ${face} · Modo ${mode}`,
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
          onPokeWarn={handlePokeWarn}
          onPokeBlaster={handlePokeBlaster}
        />

        {/* Flash amarillo (2 toques) / rojo (3 toques + blaster) */}
        {screenFlash !== 'none' && (
          <div
            className={`pointer-events-none absolute inset-0 z-40 transition-opacity duration-200 ${
              screenFlash === 'warn' ? 'bg-[#F5C542]/35' : 'bg-[#E84A4A]/45'
            }`}
          />
        )}

        {/* Clean top strip */}
        <div className="absolute top-3 left-4 right-[88px] z-20 flex items-center justify-between pointer-events-none">
          <div className="flex items-center gap-2 pointer-events-auto">
            <div className="ui-chip ui-chip--live font-display font-semibold tracking-[0.14em]">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
              ULTRON FP
            </div>
            {currentUser.authenticated && (
              <div className="ui-chip hidden sm:inline-flex">
                <ShieldCheck className="w-3 h-3 text-[var(--ok)]" />
                {currentUser.name}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 pointer-events-auto">
            {face === 'LISTENING' && (
              <div className="ui-chip ui-chip--live font-display tracking-[0.16em]">ESCUCHANDO</div>
            )}
            {face === 'SPEAKING' && (
              <div className="ui-chip ui-chip--live font-display tracking-[0.16em]">HABLANDO</div>
            )}
            <button
              type="button"
              onClick={() => {
                setVisionEnabled((prev) => !prev);
                playSfx('tap', soundFxEnabled);
              }}
              title={visionEnabled ? 'Apagar cámara' : 'Activar cámara (manual)'}
              className={`p-2 rounded-full border transition-all cursor-pointer ${
                visionEnabled
                  ? 'border-[#05E1FF] bg-[#05E1FF]/20 text-[#05E1FF]'
                  : 'border-[#8FA3B0]/30 bg-black/60 text-[#8FA3B0] hover:text-[#05E1FF]'
              }`}
            >
              <Camera className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => handleNormalize({ silent: true })}
              title="Normalizar (silencioso)"
              className="p-2 rounded-full border border-emerald-400/40 bg-black/60 text-emerald-400 hover:bg-emerald-400/20 transition-all cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
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

        {/* Speech bubble abajo-derecha (no tapa los ojos) */}
        <SpeechBubble
          text={bubbleText}
          visible={bubbleVisible && deskPresence !== 'sleep'}
          hint={
            fullBubbleText.length > 180
              ? 'Toca: ¿quieres el completo o solo el resumen?'
              : 'Di «hey Ultron» o usa el mic'
          }
          onExpand={() => {
            if (fullBubbleText.length > 180) {
              setWantDetail('ask');
              showBubble(
                '¿Quieres que lea el completo o solo un resumen corto?',
                8000
              );
              vocalize('¿Quieres el completo o solo el resumen?');
            } else {
              showBubble(fullBubbleText, 6000);
            }
          }}
          compact={wantDetail !== 'full'}
        />

        {/* Micrófono manual — esquina inferior izquierda */}
        <button
          type="button"
          onClick={() => {
            if (commandListening || micEnabled) {
              listenModeRef.current = 'wake';
              setCommandListening(false);
              setMicEnabled(false);
              setFace('IDLE');
              showBubble('Mic off', 1500);
            } else {
              triggerVoicePipeline();
            }
          }}
          title={commandListening ? 'Dejar de escuchar' : 'Activar micrófono (o di hey Ultron)'}
          className={`pointer-events-auto absolute bottom-5 left-5 z-30 flex h-14 w-14 items-center justify-center rounded-full border-2 transition-all ${
            commandListening || micEnabled
              ? 'border-[#3EC9D6] bg-[#3EC9D6]/25 text-[#7AE4EF] shadow-[0_0_20px_rgba(62,201,214,0.45)]'
              : 'border-white/15 bg-[#0c1016]/85 text-[#8B9AAB] hover:border-[#3EC9D6]/50 hover:text-[#E8EEF4]'
          }`}
        >
          {commandListening || micEnabled ? <Mic className="h-6 w-6" /> : <MicOff className="h-6 w-6" />}
        </button>

        {/* Sidebar: sleep / stay / explore + menú */}
        <LooiSidebar
          presence={deskPresence}
          onPresenceChange={handleDeskPresence}
          onOpenMenu={() => setDockOpen(true)}
        />

        {/* Personality Mode Tag */}
        <div
          id="ultron-mode-tag"
          className="absolute left-1/2 bottom-[8%] -translate-x-1/2 z-10 font-display font-bold tracking-[0.38em] text-sm text-[#05E1FF]/70 pointer-events-none flex items-center gap-2"
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
            handleNormalize({ silent: true });
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

        {/* Agentic Harness Modal (Qwen 3.8 27B) */}
        <AgenticHarnessModal
          isOpen={harnessModalOpen}
          onClose={() => setHarnessModalOpen(false)}
          currentMode={mode}
          autoModeSwitch={autoModeSwitch}
          onToggleAutoModeSwitch={() => setAutoModeSwitch((prev) => !prev)}
          hasVisor={hasVisor}
          onToggleVisor={() => {
            setHasVisor((prev) => {
              const next = !prev;
              playSfx('visor', soundFxEnabled);
              return next;
            });
          }}
          onApplyClassification={(classification: SemanticClassification) => {
            if (classification.mode !== mode) {
              setMode(classification.mode);
              playSfx(classification.mode === 'GOLD' ? 'gold' : 'mode', soundFxEnabled);
            }
            if (classification.toolCall) {
              logBridgeEvent('out', `Tool Dispatched: ${classification.toolCall.name}()`);
            }
          }}
          onSpeak={(text) => vocalize(text)}
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
        <ElevenLabsVoiceModal
          isOpen={isVoiceModalOpen}
          onClose={() => setIsVoiceModalOpen(false)}
          activeVoice={activeVoice}
          onSelectVoice={(v) => {
            setActiveVoice(v);
            vocalize(`Voz de ElevenLabs configurada a ${v.name}.`);
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
          isOpen={isVisionAnalyzerOpen}
          onClose={() => setIsVisionAnalyzerOpen(false)}
          initialMediaUrl={visionMediaData.url}
          initialMediaType={visionMediaData.type}
          onSpeak={(t) => vocalize(t)}
        />

        {/* Playwright Headless Web Scraper & Browser on AWS */}
        <PlaywrightBrowserModal
          isOpen={isPlaywrightBrowserOpen}
          onClose={() => setIsPlaywrightBrowserOpen(false)}
          onSpeak={(t) => vocalize(t)}
        />

        {/* Global Order Intelligence Strategic Brain Modal */}
        <GlobalOrderBrainModal
          isOpen={isGlobalOrderBrainOpen}
          onClose={() => setIsGlobalOrderBrainOpen(false)}
          onSpeakDoctrine={(t) => vocalize(t, 'SPEAKING', { forceEleven: true })}
        />

        {/* Cloud Infrastructure & Live Render Deployment Modal */}
        <AwsDeploymentModal
          isOpen={isAwsDeploymentModalOpen}
          onClose={() => setIsAwsDeploymentModalOpen(false)}
          onSpeak={(t) => vocalize(t)}
          soundFxEnabled={soundFxEnabled}
        />

        {/* Interactive Controls & Features Tutorial Modal */}
        <TutorialModal
          isOpen={isTutorialOpen}
          onClose={() => setIsTutorialOpen(false)}
          soundFxEnabled={soundFxEnabled}
        />

        {/* Initial Boot Screen */}
        <div
          id="ultron-boot-screen"
          className={`absolute inset-0 z-50 flex items-center justify-center transition-opacity duration-700 ${
            isBooting ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
          style={{ background: 'radial-gradient(80% 60% at 50% 40%, rgba(62,201,214,0.08), #07090c 70%)' }}
        >
          <div className="flex flex-col items-center gap-3">
            <svg width="72" height="56" viewBox="0 0 68 52" fill="none">
              <path d="M6 36C6 14 62 14 62 36" stroke="#3EC9D6" strokeWidth="2" opacity="0.9" />
              <circle cx="34" cy="34" r="11" stroke="#3EC9D6" strokeWidth="1.8" />
              <circle cx="34" cy="34" r="3" fill="#3EC9D6" />
            </svg>
            <h1 className="font-display font-bold tracking-[0.28em] text-2xl text-[var(--ink)]">
              ULTRON FP
            </h1>
            <p className="font-body text-xs text-[var(--muted)] tracking-[0.18em] uppercase">
              Desk assistant
            </p>
          </div>
        </div>
      </div>
    </div>
    </OrientationGate>
  );
}
