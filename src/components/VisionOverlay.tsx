import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { Camera, CameraOff, AlertTriangle } from 'lucide-react';
import { OpticalFaceTracker, FaceTrackResult } from '../utils/faceTracker';
import { DetectedObject } from '../types';

export type VisionOverlayHandle = {
  captureFrame: () => string | null;
  isStreamActive: () => boolean;
  ensureCamera: () => Promise<boolean>;
};

interface VisionOverlayProps {
  isActive: boolean;
  onClose: () => void;
  onGazeUpdate?: (gaze: { x: number; y: number; active: boolean }) => void;
  onPresenceEvent?: (event: { type: 'wave' | 'drink'; spatialZone: string }) => void;
  onTriggerPhoto?: () => void;
  onTriggerDrink?: () => void;
  onTriggerWave?: () => void;
  onTriggerBlaster?: () => void;
  onCameraStatus?: (ok: boolean, error?: string) => void;
}

export const VisionOverlay = forwardRef<VisionOverlayHandle, VisionOverlayProps>(function VisionOverlay(
  {
    isActive,
    onClose,
    onGazeUpdate,
    onPresenceEvent,
    onCameraStatus,
  },
  ref
) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const trackerRef = useRef<OpticalFaceTracker | null>(null);
  const [streamActive, setStreamActive] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
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

  const lastGestureTime = useRef<number>(0);

  const captureFrame = (): string | null => {
    const video = videoRef.current;
    if (!video || !streamActive || video.readyState < 2) return null;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  };

  const startCamera = async (): Promise<boolean> => {
    try {
      setCamError(null);
      let stream: MediaStream | null = null;
      const attempts: MediaStreamConstraints[] = [
        { video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
        { video: { facingMode: { ideal: 'user' } }, audio: false },
        { video: true, audio: false },
      ];
      let lastErr: any = null;
      for (const constraints of attempts) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          break;
        } catch (e) {
          lastErr = e;
        }
      }
      if (!stream) throw lastErr || new Error('getUserMedia failed');

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        if (trackerRef.current) {
          trackerRef.current.setVideoElement(videoRef.current);
        }
        setStreamActive(true);
        onCameraStatus?.(true);
        return true;
      }
      return false;
    } catch (e: any) {
      setStreamActive(false);
      const msg =
        e?.name === 'NotAllowedError'
          ? 'Permiso de cámara denegado. Actívalo en el navegador/APK.'
          : 'No se pudo acceder a la cámara.';
      setCamError(msg);
      onCameraStatus?.(false, msg);
      return false;
    }
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
    setStreamActive(false);
    onGazeUpdate?.({ x: 0, y: 0, active: false });
  };

  useImperativeHandle(ref, () => ({
    captureFrame,
    isStreamActive: () => streamActive,
    ensureCamera: async () => {
      if (streamActive) return true;
      return startCamera();
    },
  }));

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

      onGazeUpdate?.({
        x: res.x,
        y: res.y,
        active: res.detected,
      });

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

  useEffect(() => {
    if (isActive) {
      void startCamera();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  if (!isActive) return null;

  return (
    <div
      id="ultron-vision-overlay"
      className="absolute inset-0 z-[15] pointer-events-none flex flex-col justify-between p-4"
    >
      <div className="flex items-center justify-between pointer-events-auto">
        <div className="flex items-center gap-2 px-3 py-1 bg-black/60 border border-[#00E5FF]/30 rounded-full text-[11px] font-mono text-[#00E5FF] backdrop-blur-md shadow-[0_0_12px_rgba(0,229,255,0.15)]">
          <span
            className={`w-2 h-2 rounded-full ${
              streamActive
                ? telemetry.detected
                  ? 'bg-emerald-400 animate-pulse'
                  : 'bg-[#00E5FF] animate-pulse'
                : 'bg-red-400'
            }`}
          />
          <span>
            {!streamActive
              ? 'Cámara off'
              : telemetry.detected
              ? `Te veo (${telemetry.spatialZone})`
              : 'Óptica activa · busca rostro'}
          </span>
          <span className="text-[#8FA3B0]">·</span>
          <span className="text-[#8FA3B0] text-[10px]">{telemetry.fps} FPS</span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => (streamActive ? stopCamera() : void startCamera())}
            className="px-2.5 py-1 bg-black/60 border border-[#00E5FF]/40 rounded-lg text-[11px] font-mono text-[#00E5FF] hover:bg-[#00E5FF]/15 transition-all flex items-center gap-1 backdrop-blur-md cursor-pointer"
          >
            {streamActive ? <CameraOff className="w-3.5 h-3.5" /> : <Camera className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{streamActive ? 'Pausar' : 'Cámara'}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 bg-black/60 border border-[#8FA3B0]/30 rounded-lg text-[#8FA3B0] hover:text-[#00E5FF] hover:border-[#00E5FF]/40 transition-all backdrop-blur-md cursor-pointer"
          >
            ✕
          </button>
        </div>
      </div>

      {camError && (
        <div className="pointer-events-auto mx-auto mt-2 flex max-w-sm items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-950/50 px-3 py-2 text-[11px] text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{camError}</span>
          <button
            type="button"
            className="ml-auto underline"
            onClick={() => void startCamera()}
          >
            Reintentar
          </button>
        </div>
      )}

      {/* PIP camera preview — AI can see this stream */}
      <div className="pointer-events-none absolute bottom-20 right-4 overflow-hidden rounded-2xl border border-[#00E5FF]/35 shadow-[0_0_24px_rgba(0,229,255,0.25)]">
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          className={`h-28 w-40 object-cover ${streamActive ? 'opacity-100' : 'opacity-40'}`}
          style={{ transform: 'scaleX(-1)' }}
        />
        <div className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-mono text-[#00E5FF]">
          <span className={`h-1.5 w-1.5 rounded-full ${streamActive ? 'bg-red-500 animate-pulse' : 'bg-gray-500'}`} />
          LIVE
        </div>
      </div>
    </div>
  );
});
