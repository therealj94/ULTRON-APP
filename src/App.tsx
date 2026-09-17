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
import { speakUtterance, cancelSpeech, initSpeechRecognizer, SpeechRecognizerHandle } from './utils/speech';
import { DEFAULT_ELEVENLABS_VOICES, speakWithElevenLabsOrFallback, stopCurrentVoice } from './utils/elevenlabs';
import { downloadStandaloneSimulator } from './utils/exporter';
import { Maximize2, Minimize2, BatteryMedium, Wifi, Sparkles, SlidersHorizontal, Cpu, Glasses, RotateCw, Fingerprint, Camera, Zap, Globe, BookOpen, Eye as EyeIcon, Cloud, ShieldCheck, HelpCircle, RotateCcw } from 'lucide-react';
import { AgenticHarnessModal } from './components/AgenticHarnessModal';
import { analyzeConversationTopic, SemanticClassification } from './utils/qwenHarness';

export default function App() {
  // Session State
  const [face, setFace] = useState<FaceState>('IDLE');
  const [mode, setMode] = useState<Mode>('GUARDIAN');
  const [energy, setEnergy] = useState<number>(85);
  const [isBooting, setIsBooting] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isKioskFrame, setIsKioskFrame] = useState<boolean>(false);
  const [hasVisor, setHasVisor] = useState<boolean>(false); // LOOI Cyber Sunglasses (Photo 2)
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
  const [micEnabled, setMicEnabled] = useState<boolean>(true);
  const [speakerEnabled, setSpeakerEnabled] = useState<boolean>(true);
  const [soundFxEnabled, setSoundFxEnabled] = useState<boolean>(true);
  const [visionEnabled, setVisionEnabled] = useState<boolean>(true);
  const [resetTrigger, setResetTrigger] = useState<number>(0);

  // ElevenLabs Voice Configuration
  const [activeVoice, setActiveVoice] = useState<ElevenLabsVoiceConfig>(DEFAULT_ELEVENLABS_VOICES[0]);

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
      showBubble(text);
      if (speakerEnabled) {
        setFace(faceOverride);
        if (activeVoice?.apiKey) {
          speakWithElevenLabsOrFallback(text, activeVoice, {
            onStart: () => setFace(faceOverride),
            onEnd: () => setFace('IDLE'),
            onError: () => {
              speakUtterance(text, {
                enabled: true,
                onEnd: () => setFace('IDLE'),
              });
            },
          });
        } else {
          speakUtterance(text, {
            enabled: true,
            onEnd: () => {
              setFace('IDLE');
            },
          });
        }
      }
    },
    [showBubble, speakerEnabled, activeVoice]
  );

  // Add log to bridge telemetry
  const logBridgeEvent = useCallback((direction: 'in' | 'out', payload: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setBridgeLog((prev) => [{ timestamp, direction, payload }, ...prev.slice(0, 30)]);
  }, []);

  // Boot sequence and remote Ultron session check
  useEffect(() => {
    // Check if session exists in Ultron FP (Render)
    fetch('/api/ultron/sesion')
      .then((res) => res.json())
      .then((data) => {
        if (data.authenticated && data.user) {
          setCurrentUser({
            name: data.user.nombre || 'José',
            role: data.user.rol || 'Junta Directiva · Orden Global',
            authenticated: true,
          });
        }
      })
      .catch(() => {});

    const timer = setTimeout(() => {
      setIsBooting(false);
      playSfx('boot', true);
      vocalize('Junta directiva en línea. Sistema ULTRON activo.');
    }, 1400);

    return () => clearTimeout(timer);
  }, [vocalize]);

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
    vocalize('Sistemas activos y listos para la sesión.');
  }, [soundFxEnabled, vocalize]);

  const handleSleep = useCallback(() => {
    setFace('SLEEPING');
    playSfx('sleep', soundFxEnabled);
    vocalize('Entrando en modo de reposo y ahorro energético.', 'SLEEPING');
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
    vocalize('¡Hola! Saludos cordiales a la junta directiva.');

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
    vocalize('¡Alerta de combate! Cañones blaster desplegados.');

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
    playSfx('tap', soundFxEnabled);
    vocalize('Sistemas defensivos retraídos. Estado normalizado.');
  }, [soundFxEnabled, vocalize]);

  // Handle presence events from optical tracking
  const handlePresenceEvent = useCallback((event: { type: 'wave' | 'drink'; spatialZone: string }) => {
    if (event.type === 'wave') {
      handleTriggerWave();
    } else if (event.type === 'drink') {
      handleTriggerDrink();
    }
  }, [handleTriggerWave, handleTriggerDrink]);

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
          handleVoiceCommand(text.trim());
        } else {
          // Live stream transcript
          showBubble(text, 2500);
          setFace('LISTENING');
        }
      },
      () => {
        // Immediate Barge-in interruption: user started speaking, silence assistant voice instantly!
        cancelSpeech();
        stopCurrentVoice();
        setFace('LISTENING');
        showBubble('Escuchando...');
      },
      () => {
        // Recognition ended / auto-restarted
      },
      () => {
        // Recognition error
      }
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
  }, [micEnabled]);

  // Manual Trigger Voice
  const triggerVoicePipeline = () => {
    if (!micEnabled) {
      setMicEnabled(true);
      playSfx('wake', soundFxEnabled);
      vocalize('Micrófono activado. Te escucho.');
      return;
    }

    playSfx('tap', soundFxEnabled);
    setFace('LISTENING');
    showBubble('Escuchando orden...');
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

  // Dispatcher for voice commands
  const handleVoiceCommand = (cmd: string) => {
    const q = cmd.toLowerCase();
    logBridgeEvent('out', `Comando de voz: "${q}"`);

    // 1. Camera Photo with 3-2-1 Countdown & Live Stream
    if (/foto|captura|fotograf|selfie|picture|cámara|sonríe/.test(q)) {
      setIsCameraCountdownModalOpen(true);
      vocalize('Encendiendo cámara frontal. Preparando cuenta regresiva de tres segundos.');
      return;
    }

    // 2. Playwright Web Scraping on AWS EC2
    if (/web|página|navega|playwright|sitio|url|investiga|noticia/.test(q)) {
      setIsPlaywrightBrowserOpen(true);
      vocalize('Despachando nodo Playwright en AWS para inspección y análisis web.');
      return;
    }

    // 3. Vision Media Analysis with Auto-Purge Privacy
    if (/visión|imagen|video|inspeccion|subir|bajar|multimodal|purga/.test(q)) {
      setIsVisionAnalyzerOpen(true);
      vocalize('Abriendo visor de visión neural con protocolo de auto-purga para máxima privacidad.');
      return;
    }

    // 4. Cerebro de Inteligencia Estratégica de Orden Global
    if (/orden global|doctrina|geopolítica|tratado|resolución|estatuto|soberanía/.test(q)) {
      setIsGlobalOrderBrainOpen(true);
      vocalize('Accediendo al archivo de Inteligencia Estratégica del Cerebro de Orden Global.');
      return;
    }

    // Interactive Drink / Soda
    if (/agua|refresco|bebida|sed|drink|toma/.test(q)) {
      handleTriggerDrink();
      return;
    }

    // Interactive Hand Wave Greeting
    if (/hola|saluda|saludo|wave|mano/.test(q)) {
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
    if (/bóveda|boveda|clave|credencial|conduit|api|llave|seguridad/.test(q)) {
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
        vocalize(next ? 'Gafas cibernéticas LOOI equipadas.' : 'Gafas guardadas.');
        return next;
      });
      return;
    }

    // Agentic Harness Semantic Mode Detection (Qwen 3.8 27B)
    if (autoModeSwitch) {
      const classification = analyzeConversationTopic(q);
      if (classification) {
        logBridgeEvent(
          'in',
          `Qwen Intent: ${classification.intent} (${Math.round(classification.confidence * 100)}%) -> MODO ${classification.mode}`
        );
        if (classification.mode !== mode) {
          setMode(classification.mode);
          playSfx(classification.mode === 'GOLD' ? 'gold' : 'mode', soundFxEnabled);
        }
        if (classification.toolCall) {
          const tool = classification.toolCall.name;
          logBridgeEvent('out', `Tool Call: ${tool}()`);
          if (tool === 'take_camera_photo_countdown') {
            setIsCameraCountdownModalOpen(true);
          } else if (tool === 'browse_web_page_playwright') {
            setIsPlaywrightBrowserOpen(true);
          } else if (tool === 'analyze_vision_media') {
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
        }
        setFace('SPEAKING');
        vocalize(classification.thought);
        return;
      }
    }

    // Corporate Weather
    if (/clima|tiempo|temperatura/.test(q)) {
      vocalize('27 grados en la sede corporativa. Cielo despejado y atmósfera estable.');
      return;
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

    // Financial Audit / Gold
    if (/auditor|balance|oro|gold/.test(q)) {
      setMode('GOLD');
      playSfx('grant', soundFxEnabled);
      vocalize('Balance de reservas auditado. Calificación triple A.');
      return;
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

    // Generic acknowledgment
    proceedThinkingAndSpeaking(`Orden procesada: "${cmd}".`);
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

            {/* Camera Optical Tracking Toggle */}
            <button
              type="button"
              onClick={() => {
                setVisionEnabled((prev) => !prev);
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
          className="absolute left-1/2 bottom-[10%] -translate-x-1/2 z-10 font-display font-bold tracking-[0.38em] text-base text-[#05E1FF]/80 pointer-events-none flex items-center gap-2"
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
          onSpeak={(t) => vocalize(t)}
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
          className={`absolute inset-0 z-50 flex items-center justify-center bg-black transition-opacity duration-700 ${
            isBooting ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
        >
          <div className="flex flex-col items-center gap-3">
            <svg width="76" height="60" viewBox="0 0 68 52" fill="none" className="animate-pulse">
              <path d="M6 36C6 14 62 14 62 36" stroke="#05E1FF" strokeWidth="2.5" />
              <circle cx="34" cy="34" r="11" stroke="#05E1FF" strokeWidth="2" />
              <circle cx="34" cy="34" r="3" fill="#05E1FF" />
            </svg>
            <h1 className="font-display font-bold tracking-[0.45em] text-2xl text-[#05E1FF]">
              ULTRON FP
            </h1>
            <p className="font-mono text-xs text-[#8FA3B0] tracking-widest uppercase">
              ASISTENTE DE JUNTA DIRECTIVA
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
