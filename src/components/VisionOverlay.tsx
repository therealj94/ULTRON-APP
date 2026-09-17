import React, { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Scan, ShieldCheck, Eye, Compass, Sparkles, Coffee, Hand, Zap } from 'lucide-react';
import { OpticalFaceTracker, FaceTrackResult } from '../utils/faceTracker';
import { DetectedObject } from '../types';

interface VisionOverlayProps {
  isActive: boolean;
  onClose: () => void;
  onGazeUpdate?: (gaze: { x: number; y: number; active: boolean }) => void;
  onPresenceEvent?: (event: { type: 'wave' | 'drink'; spatialZone: string }) => void;
  onTriggerPhoto?: () => void;
  onTriggerDrink?: () => void;
  onTriggerWave?: () => void;
  onTriggerBlaster?: () => void;
}

export const VisionOverlay: React.FC<VisionOverlayProps> = ({
  isActive,
  onClose,
  onGazeUpdate,
  onPresenceEvent,
  onTriggerPhoto,
  onTriggerDrink,
  onTriggerWave,
  onTriggerBlaster,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const trackerRef = useRef<OpticalFaceTracker | null>(null);
  const [streamActive, setStreamActive] = useState(false);
  const [telemetry, setTelemetry] = useState({
    faceConfidence: 98.4,
    x: 0,
    y: 0,
    detected: false,
    fps: 60,
    spatialZone: 'CENTER',
    distance: 'OPTIMAL',
    objects: [] as DetectedObject[],
  });

  // Track state to debounce automatic gesture reactions
  const lastGestureTime = useRef<number>(0);

  // Initialize and run tracker
  useEffect(() => {
    if (!isActive) return;

    if (!trackerRef.current) {
      trackerRef.current = new OpticalFaceTracker();
    }

    const tracker = trackerRef.current;

    tracker.start((res: FaceTrackResult) => {
      setTelemetry({
        faceConfidence: +res.confidence.toFixed(1),
        x: +res.x.toFixed(2),
        y: +res.y.toFixed(2),
        detected: res.detected,
        fps: res.fps,
        spatialZone: res.spatialZone,
        distance: res.distance,
        objects: res.objects,
      });

      if (onGazeUpdate) {
        onGazeUpdate({
          x: res.x,
          y: res.y,
          active: res.detected,
        });
      }

      // Check gestures and trigger reactive interactions (debounced 4s)
      const now = performance.now();
      if (now - lastGestureTime.current > 4000) {
        if (res.isWaving) {
          lastGestureTime.current = now;
          onPresenceEvent?.({ type: 'wave', spatialZone: res.spatialZone });
        } else if (res.hasDrink) {
          lastGestureTime.current = now;
          onPresenceEvent?.({ type: 'drink', spatialZone: res.spatialZone });
        }
      }
    });

    return () => {
      tracker.stop();
    };
  }, [isActive, onGazeUpdate, onPresenceEvent]);

  // Handle webcam stream
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        if (trackerRef.current) {
          trackerRef.current.setVideoElement(videoRef.current);
        }
        setStreamActive(true);
      }
    } catch {
      setStreamActive(false);
    }
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
    setStreamActive(false);
    if (onGazeUpdate) {
      onGazeUpdate({ x: 0, y: 0, active: false });
    }
  };

  const toggleRealCamera = () => {
    if (streamActive) {
      stopCamera();
    } else {
      startCamera();
    }
  };

  // Auto-request camera when user opens vision overlay
  useEffect(() => {
    if (isActive && !streamActive) {
      startCamera();
    }
    return () => {
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  if (!isActive) return null;

  // Position reticle based on real detected head position
  const reticleOffsetX = telemetry.x * 120;
  const reticleOffsetY = telemetry.y * 70;

  return (
    <div
      id="ultron-vision-overlay"
      className="absolute inset-0 z-20 pointer-events-none flex flex-col justify-between p-4"
    >
      {/* Real camera video feed in bottom corner */}
      <div className="absolute bottom-16 right-6 flex flex-col items-end gap-1.5 pointer-events-auto">
        <video
          ref={videoRef}
          playsInline
          muted
          className={`w-44 h-32 object-cover rounded-xl border-2 border-[#05E1FF]/60 shadow-[0_0_25px_rgba(5,225,255,0.3)] ${
            streamActive ? 'block' : 'hidden'
          }`}
        />
        {streamActive && (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-black/80 border border-[#05E1FF]/40 text-[10px] font-mono text-[#05E1FF]">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>SENSOR ÓPTICO ACTIVO</span>
          </div>
        )}
      </div>

      {/* Top telemetry banner */}
      <div className="flex flex-wrap items-center justify-between gap-2 pointer-events-auto">
        <div className="flex items-center gap-3 px-3.5 py-1.5 bg-black/80 border border-[#05E1FF]/40 rounded-xl text-xs font-mono text-[#05E1FF] backdrop-blur-md shadow-[0_0_15px_rgba(5,225,255,0.2)]">
          <div className="flex items-center gap-1.5">
            <Scan className="w-3.5 h-3.5 animate-spin" />
            <span className="font-bold">VISOR ESPACIAL ULTRON</span>
          </div>
          <span className="text-[#8FA3B0]">|</span>
          <div className="flex items-center gap-1 text-emerald-400">
            <Eye className="w-3.5 h-3.5" />
            <span>{telemetry.detected ? `ZONA: ${telemetry.spatialZone}` : 'BUSCANDO PRESENCIA...'}</span>
          </div>
          <span className="text-[#8FA3B0]">|</span>
          <span className="text-[#05E1FF]">DIST: {telemetry.distance}</span>
          <span className="text-[#8FA3B0]">|</span>
          <span className="text-[#05E1FF]">FPS: {telemetry.fps}</span>
        </div>

        {/* Quick Trigger Action Bar */}
        <div className="flex items-center gap-2">
          {onTriggerPhoto && (
            <button
              type="button"
              onClick={onTriggerPhoto}
              title="Tomar fotografía con Ultron"
              className="px-2.5 py-1.5 bg-black/80 border border-[#05E1FF]/50 rounded-xl text-xs font-mono text-[#05E1FF] hover:bg-[#05E1FF]/20 transition-all flex items-center gap-1.5 backdrop-blur-md shadow-[0_0_10px_rgba(5,225,255,0.2)] cursor-pointer"
            >
              <Camera className="w-3.5 h-3.5" />
              <span>Foto</span>
            </button>
          )}

          {onTriggerDrink && (
            <button
              type="button"
              onClick={onTriggerDrink}
              title="Tomar refresco / agua"
              className="px-2.5 py-1.5 bg-black/80 border border-[#00FFA3]/50 rounded-xl text-xs font-mono text-[#00FFA3] hover:bg-[#00FFA3]/20 transition-all flex items-center gap-1.5 backdrop-blur-md cursor-pointer"
            >
              <Coffee className="w-3.5 h-3.5" />
              <span>Bebida</span>
            </button>
          )}

          {onTriggerWave && (
            <button
              type="button"
              onClick={onTriggerWave}
              title="Saludar con la mano"
              className="px-2.5 py-1.5 bg-black/80 border border-[#FFD800]/50 rounded-xl text-xs font-mono text-[#FFD800] hover:bg-[#FFD800]/20 transition-all flex items-center gap-1.5 backdrop-blur-md cursor-pointer"
            >
              <Hand className="w-3.5 h-3.5" />
              <span>Saludar</span>
            </button>
          )}

          {onTriggerBlaster && (
            <button
              type="button"
              onClick={onTriggerBlaster}
              title="Activar cañones blaster"
              className="px-2.5 py-1.5 bg-black/80 border border-red-500/50 rounded-xl text-xs font-mono text-red-400 hover:bg-red-500/20 transition-all flex items-center gap-1.5 backdrop-blur-md cursor-pointer"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Blaster</span>
            </button>
          )}

          <button
            type="button"
            onClick={toggleRealCamera}
            className="px-3 py-1.5 bg-black/80 border border-[#05E1FF]/50 rounded-xl text-xs font-mono text-[#05E1FF] hover:bg-[#05E1FF]/20 transition-all flex items-center gap-1.5 backdrop-blur-md cursor-pointer"
          >
            {streamActive ? <CameraOff className="w-3.5 h-3.5" /> : <Camera className="w-3.5 h-3.5" />}
            {streamActive ? 'Desactivar Cámara' : 'Activar Cámara'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 bg-black/80 border border-[#8FA3B0]/40 rounded-xl text-xs font-mono text-[#8FA3B0] hover:text-[#05E1FF] hover:border-[#05E1FF]/40 transition-all backdrop-blur-md cursor-pointer"
          >
            Ocultar HUD
          </button>
        </div>
      </div>

      {/* Dynamic tracking reticle that moves with user's actual face */}
      <div
        className="relative w-64 h-64 mx-auto my-auto border border-[#05E1FF]/30 rounded-2xl flex items-center justify-center transition-transform duration-100 ease-out"
        style={{
          transform: `translate(${reticleOffsetX}px, ${reticleOffsetY}px)`,
        }}
      >
        {/* Corner reticle brackets */}
        <div className="absolute top-0 left-0 w-5 h-5 border-t-2 border-l-2 border-[#05E1FF] shadow-[0_0_8px_#05E1FF]" />
        <div className="absolute top-0 right-0 w-5 h-5 border-t-2 border-r-2 border-[#05E1FF] shadow-[0_0_8px_#05E1FF]" />
        <div className="absolute bottom-0 left-0 w-5 h-5 border-b-2 border-l-2 border-[#05E1FF] shadow-[0_0_8px_#05E1FF]" />
        <div className="absolute bottom-0 right-0 w-5 h-5 border-b-2 border-r-2 border-[#05E1FF] shadow-[0_0_8px_#05E1FF]" />

        {/* Center reticle crosshair */}
        <div className="w-2.5 h-2.5 rounded-full bg-[#05E1FF] animate-ping" />

        {/* Gaze vector tag & Object labels */}
        <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 whitespace-nowrap">
          <div className="text-[11px] font-mono text-[#05E1FF] flex items-center gap-1.5 bg-black/85 px-3 py-1 rounded-full border border-[#05E1FF]/40 shadow-[0_0_15px_rgba(5,225,255,0.25)]">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>USUARIO DETECTADO ({telemetry.faceConfidence}%)</span>
            <span className="text-[#8FA3B0]">·</span>
            <span className="text-xs">ZONA: {telemetry.spatialZone}</span>
          </div>

          {/* Detected Objects Pills */}
          {telemetry.objects.length > 0 && (
            <div className="flex items-center gap-1.5 mt-0.5">
              {telemetry.objects.map((obj, i) => (
                <span
                  key={i}
                  className="px-2 py-0.5 rounded-full bg-[#05E1FF]/20 border border-[#05E1FF]/50 text-[10px] font-mono text-white flex items-center gap-1"
                >
                  <Sparkles className="w-2.5 h-2.5 text-[#05E1FF]" />
                  {obj.label} ({Math.round(obj.confidence * 100)}%)
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bottom telemetry footer */}
      <div className="flex items-center justify-between text-[11px] font-mono text-[#8FA3B0] bg-black/60 px-4 py-1.5 rounded-xl border border-[#05E1FF]/20 backdrop-blur-sm pointer-events-auto">
        <div className="flex items-center gap-2">
          <Compass className="w-3.5 h-3.5 text-[#05E1FF]" />
          <span>SEGUIMIENTO ESPACIAL: OJOS ENFOCADOS EN POSICIÓN ({telemetry.spatialZone})</span>
        </div>
        <div className="text-[#05E1FF]">STAND HORIZON: 0° CALIBRADO</div>
      </div>
    </div>
  );
};
