import React, { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff } from 'lucide-react';
import { MotorVision, type EstadoMotor, type Mirada } from '../02-cara/vision/motor';
import type { Escena } from '../02-cara/vision/escena';

export type { Escena } from '../02-cara/vision/escena';

interface VisionOverlayProps {
  isActive: boolean;
  /** true (por defecto): solo el <video> oculto; false: HUD con PIP y estado. */
  stealth?: boolean;
  onClose: () => void;
  /** Mirada suavizada hacia la cara principal (x,y ya espejados; active solo con cara). */
  onGazeUpdate?: (gaze: Mirada) => void;
  /**
   * Escena interpretada: como máximo cada 500 ms, y de inmediato cuando hay eventos. Al apagar la cámara
   * (isActive → false, «Pausar» o permiso negado) se emite UNA vez `{ motor: 'ninguno', descripcion: 'La cámara
   * está apagada.' }` para que nadie se quede con la última escena como hecho.
   */
  onEscena?: (e: Escena) => void;
  /** Compatibilidad: 'wave' cuando la escena reporta `saluda`. Ya no se inventa 'drink'. */
  onPresenceEvent?: (event: { type: 'wave' | 'drink'; spatialZone: string }) => void;
  onTriggerPhoto?: () => void;
  onTriggerDrink?: () => void;
  onTriggerWave?: () => void;
  onTriggerBlaster?: () => void;
}

/** Gancho de QA (?qa=1): expone la última escena en window.__ultronEscena y la loguea. */
const QA = typeof window !== 'undefined' && /[?&]qa=1/.test(window.location.search);

const ESCENA_APAGADA: Escena = {
  personas: 0,
  principal: null,
  eventos: [],
  descripcion: 'La cámara está apagada.',
  motor: 'ninguno',
  ts: 0,
};

export const VisionOverlay: React.FC<VisionOverlayProps> = ({ isActive, stealth = true, onClose, onGazeUpdate, onEscena, onPresenceEvent }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const motorRef = useRef<MotorVision | null>(null);
  /** Stream y <video> realmente en uso: NO dependen de videoRef, que React vacía al desmontar el <video>. */
  const streamRef = useRef<MediaStream | null>(null);
  const videoUsadoRef = useRef<HTMLVideoElement | null>(null);
  /** Generación de arranque: cada start/stop la incrementa; un getUserMedia que resuelve tarde se descarta. */
  const genRef = useRef(0);
  const [streamActive, setStreamActive] = useState(false);
  const [estado, setEstado] = useState<EstadoMotor>({ motor: 'cargando', delegado: null, fps: 0 });
  const [escena, setEscena] = useState<Escena | null>(null);

  // Callbacks por ref: el motor no se reinicia cuando App re-renderiza con funciones nuevas.
  const onGazeRef = useRef(onGazeUpdate);
  const onEscenaRef = useRef(onEscena);
  const onPresenceRef = useRef(onPresenceEvent);
  onGazeRef.current = onGazeUpdate;
  onEscenaRef.current = onEscena;
  onPresenceRef.current = onPresenceEvent;

  const avisoApagada = useRef(false);

  /** Escena final de apagado: una sola vez por apagado (o por permiso negado). */
  const emitirApagada = () => {
    if (avisoApagada.current) return;
    avisoApagada.current = true;
    const e: Escena = { ...ESCENA_APAGADA, ts: Date.now() };
    if (QA) {
      (window as any).__ultronEscena = e;
      console.info('[vision] escena', e.motor, 'personas', 0, '', e.descripcion);
    }
    onEscenaRef.current?.(e);
  };

  const pararTracks = (s: MediaStream | null | undefined) => {
    s?.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch {
        /* ya parado */
      }
    });
  };

  const startCamera = async () => {
    const video = videoRef.current;
    if (!video) return;
    const gen = ++genRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } },
        audio: false,
      });
      // Si nos desactivaron (o re-arrancaron) mientras pedíamos permiso, soltamos este stream y salimos.
      if (gen !== genRef.current || !videoRef.current) {
        pararTracks(stream);
        return;
      }
      // Nunca dos streams vivos: si por lo que sea quedó uno anterior, se para antes de asignar el nuevo.
      if (streamRef.current && streamRef.current !== stream) pararTracks(streamRef.current);
      streamRef.current = stream;
      videoUsadoRef.current = video;
      video.srcObject = stream;
      video.play().catch(() => {});
      (window as any).__ultronVideo = video;
      setStreamActive(true);
      avisoApagada.current = false;

      if (!motorRef.current) {
        motorRef.current = new MotorVision({
          fpsObjetivo: 18,
          intervaloEstadoMs: 500,
          onGaze: (g) => onGazeRef.current?.(g),
          onEscena: (e) => {
            setEscena(e);
            if (QA) {
              (window as any).__ultronEscena = e;
              console.info('[vision] escena', e.motor, 'personas', e.personas, e.eventos.length ? e.eventos.join(',') : '', e.descripcion);
            }
            onEscenaRef.current?.(e);
            if (e.eventos.includes('saluda')) {
              const zona = e.principal ? (e.principal.x < -0.25 ? 'LEFT' : e.principal.x > 0.25 ? 'RIGHT' : 'CENTER') : 'CENTER';
              onPresenceRef.current?.({ type: 'wave', spatialZone: zona });
            }
          },
          onEstado: (s) => {
            setEstado(s);
            if (QA) console.info('[vision] estado', s.motor, s.delegado ?? '-', s.fps, 'fps');
          },
        });
      }
      await motorRef.current.arrancar(video);
    } catch (e) {
      if (gen !== genRef.current) return; // ya nos apagaron: no avisar de una cámara que nadie pidió
      // Permiso negado / sin cámara: se avisa una sola vez.
      setStreamActive(false);
      console.info('[vision] cámara no disponible:', (e as Error)?.name ?? e);
      emitirApagada();
    }
  };

  /**
   * Libera TODO sin depender de videoRef: corre también desde el cleanup del useEffect, cuando React
   * ya desmontó el <video> (isActive → false) y videoRef.current es null.
   */
  const stopCamera = () => {
    genRef.current++;
    const habiaCamara = !!motorRef.current || !!streamRef.current;
    motorRef.current?.detener();
    motorRef.current = null;
    pararTracks(streamRef.current);
    streamRef.current = null;
    const video = videoUsadoRef.current ?? videoRef.current;
    if (video) {
      // Por si el <video> tuviera un stream que no pasó por streamRef (no debería), se para también.
      const so = video.srcObject;
      if (so && so !== streamRef.current) pararTracks(so as MediaStream);
      video.srcObject = null;
    }
    videoUsadoRef.current = null;
    const w = window as any;
    if (w.__ultronVideo && (w.__ultronVideo === video || !document.contains(w.__ultronVideo))) w.__ultronVideo = undefined;
    setStreamActive(false);
    setEscena(null);
    setEstado({ motor: 'cargando', delegado: null, fps: 0 });
    onGazeRef.current?.({ x: 0, y: 0, active: false });
    // La última escena («Veo a una persona…») no puede quedar como hecho: se avisa que la cámara está apagada.
    if (habiaCamara) emitirApagada();
  };

  const toggleRealCamera = () => {
    if (streamActive) stopCamera();
    else startCamera();
  };

  // Al activar: pedir cámara y arrancar el motor. Al desactivar: liberar todo (landmarker, tracks).
  useEffect(() => {
    if (!isActive) return;
    startCamera();
    return () => {
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  if (!isActive) return null;

  if (stealth) {
    return <video ref={videoRef} className="absolute w-px h-px opacity-0 pointer-events-none" playsInline muted autoPlay />;
  }

  const detected = !!escena?.principal;
  const etiquetaMotor = estado.motor === 'mediapipe' ? `MediaPipe${estado.delegado ? ' · ' + estado.delegado : ''}` : estado.motor === 'optico' ? 'Óptico (respaldo)' : estado.motor === 'cargando' ? 'Cargando modelo…' : 'Sin cámara';

  return (
    <div id="ultron-vision-overlay" className="absolute inset-0 z-20 pointer-events-none flex flex-col justify-between p-4">
      <div className="flex items-center justify-between pointer-events-auto">
        <div className="flex items-center gap-2 px-3 py-1 bg-[#34363A]/90 border border-[#46484D] rounded-full text-[11px] font-mono text-[#E0C27F] backdrop-blur-md shadow-[0_8px_24px_rgba(0,0,0,0.34)]">
          <span className={`w-2 h-2 rounded-full ${detected ? 'bg-emerald-400 animate-pulse' : 'bg-[#D6B56C]/40'}`} />
          <span>{escena ? escena.descripcion : 'Sensor calibrando'}</span>
          <span className="text-[#B9B2A8]">·</span>
          <span className="text-[#B9B2A8] text-[10px]">{etiquetaMotor}</span>
          <span className="text-[#B9B2A8]">·</span>
          <span className="text-[#B9B2A8] text-[10px]">{estado.fps} FPS</span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={toggleRealCamera}
            title={streamActive ? 'Pausar transmisión de cámara' : 'Activar transmisión de cámara'}
            className="px-2.5 py-1 bg-[#34363A]/90 border border-[#46484D] rounded-lg text-[11px] font-mono text-[#E0C27F] hover:bg-[#D6B56C]/15 transition-all flex items-center gap-1 backdrop-blur-md cursor-pointer"
          >
            {streamActive ? <CameraOff className="w-3.5 h-3.5" /> : <Camera className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{streamActive ? 'Pausar' : 'Cámara'}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Cerrar seguimiento"
            className="p-1.5 bg-[#34363A]/90 border border-[#46484D] rounded-lg text-[#B9B2A8] hover:text-[#ECE8E2] hover:border-[#46484D] transition-all backdrop-blur-md cursor-pointer"
          >
            <CameraOff className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="absolute bottom-6 right-6 flex flex-col items-end gap-1.5 pointer-events-auto">
        <div className="relative group">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className={`w-36 h-26 object-cover rounded-xl border border-[#46484D] shadow-[0_8px_24px_rgba(0,0,0,0.34)] scale-x-[-1] transition-all duration-300 ${
              streamActive ? 'block opacity-90 hover:opacity-100' : 'hidden'
            }`}
          />
          {streamActive && detected && (
            <div className="absolute top-1.5 left-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#34363A]/90 border border-emerald-400/40 text-[9px] font-mono text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>{escena?.principal?.mirando ? 'TE MIRA' : 'ENFOCADO'}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
