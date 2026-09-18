import React, { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Scan, ShieldCheck, Eye, Compass, Sparkles, Coffee, Hand, Zap } from 'lucide-react';
import { OpticalFaceTracker, FaceTrackResult } from '../utils/faceTracker';
import { DetectedObject } from '../types';

interface VisionOverlayProps {
  isActive: boolean;
  stealth?: boolean;
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
  stealth = true,
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

  if (stealth) {
    return (
      <video
        ref={videoRef}
        className="absolute w-px h-px opacity-0 pointer-events-none"
        playsInline
        muted
        autoPlay
      />
    );
  }

  return (
    <div
      id="ultron-vision-overlay"
      className="absolute inset-0 z-20 pointer-events-none flex flex-col justify-between p-4"
    >
      {/* Top minimal status indicator */}
      <div className="flex items-center justify-between pointer-events-auto">
        <div className="flex items-center gap-2 px-3 py-1 bg-black/60 border border-[#05E1FF]/30 rounded-full text-[11px] font-mono text-[#05E1FF] backdrop-blur-md shadow-[0_0_12px_rgba(5,225,255,0.15)]">
          <span className={`w-2 h-2 rounded-full ${telemetry.detected ? 'bg-emerald-400 animate-pulse' : 'bg-[#05E1FF]/40'}`} />
          <span>{telemetry.detected ? `Seguimiento Activo (${telemetry.spatialZone})` : 'Sensor Óptico Calibrando'}</span>
          <span className="text-[#8FA3B0]">·</span>
          <span className="text-[#8FA3B0] text-[10px]">{telemetry.fps} FPS</span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={toggleRealCamera}
            title={streamActive ? 'Pausar transmisión de cámara' : 'Activar transmisión de cámara'}
            className="px-2.5 py-1 bg-black/60 border border-[#05E1FF]/40 rounded-lg text-[11px] font-mono text-[#05E1FF] hover:bg-[#05E1FF]/15 transition-all flex items-center gap-1 backdrop-blur-md cursor-pointer"
          >
            {streamActive ? <CameraOff className="w-3.5 h-3.5" /> : <Camera className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{streamActive ? 'Pausar' : 'Cámara'}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Cerrar seguimiento"
            className="p-1.5 bg-black/60 border border-[#8FA3B0]/30 rounded-lg text-[#8FA3B0] hover:text-[#05E1FF] hover:border-[#05E1FF]/40 transition-all backdrop-blur-md cursor-pointer"
          >
            <CameraOff className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Floating PIP Camera in bottom-right corner */}
      <div className="absolute bottom-6 right-6 flex flex-col items-end gap-1.5 pointer-events-auto">
        <div className="relative group">
          <video
            ref={videoRef}
            playsInline
            muted
            className={`w-36 h-26 object-cover rounded-xl border border-[#05E1FF]/40 shadow-[0_0_20px_rgba(5,225,255,0.2)] scale-x-[-1] transition-all duration-300 ${
              streamActive ? 'block opacity-90 hover:opacity-100' : 'hidden'
            }`}
          />
          {streamActive && telemetry.detected && (
            <div className="absolute top-1.5 left-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/75 border border-emerald-400/40 text-[9px] font-mono text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>ENFOCADO</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
