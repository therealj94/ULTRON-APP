import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Camera,
  X,
  Download,
  RotateCcw,
  Sparkles,
  ShieldCheck,
  Zap,
  Volume2,
  Eye,
  CheckCircle2,
} from 'lucide-react';
import { playSfx } from '../03-voz/audio';

interface CameraCountdownModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPhotoSaved: (photo: { id: string; dataUrl: string; timestamp: string; caption?: string }) => void;
  onAnalyzePhoto?: (dataUrl: string) => void;
  autoStartCountdown?: boolean;
  soundFxEnabled?: boolean;
}

export const CameraCountdownModal: React.FC<CameraCountdownModalProps> = ({
  isOpen,
  onClose,
  onPhotoSaved,
  onAnalyzePhoto,
  autoStartCountdown = false,
  soundFxEnabled = true,
}) => {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [isFlashing, setIsFlashing] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [downloadSuccess, setDownloadSuccess] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize camera stream when modal opens
  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err: any) {
      console.error('Camera access error:', err);
      setCameraError(
        'No se pudo acceder a la cámara. Verifica los permisos del navegador o selecciona otra cámara.'
      );
    }
  }, [facingMode]);

  // Clean up tracks when closing modal
  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setCountdown(null);
    setIsFlashing(false);
  }, [stream]);

  useEffect(() => {
    if (isOpen) {
      setCapturedImage(null);
      setDownloadSuccess(false);
      startCamera();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isOpen, startCamera, stopCamera]);

  // Perform the physical snapshot capture
  const takeSnapshot = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    // Flash screen
    setIsFlashing(true);
    playSfx('shutter', soundFxEnabled);

    const canvas = document.createElement('canvas');
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Mirror user camera for natural selfie orientation
      if (facingMode === 'user') {
        ctx.translate(width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, 0, 0, width, height);

      // Reset transform for cyber HUD overlay stamp
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      // Cyber LOOI Watermark Stamp in bottom corner
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(24, height - 60, 360, 36);
      ctx.strokeStyle = '#05E1FF';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(24, height - 60, 360, 36);

      ctx.fillStyle = '#05E1FF';
      ctx.font = 'bold 14px monospace';
      ctx.fillText(`AU-RA FP · LOOI CAM [${new Date().toLocaleTimeString()}]`, 36, height - 37);

      const dataUrl = canvas.toDataURL('image/png', 0.95);
      setCapturedImage(dataUrl);

      // Save to parent list
      const photoObj = {
        id: `photo_${Date.now()}`,
        dataUrl,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        caption: `Cámara Frontal HD · Captura de Junta Directiva`,
      };
      onPhotoSaved(photoObj);
    }

    setTimeout(() => {
      setIsFlashing(false);
    }, 200);
  }, [facingMode, onPhotoSaved, soundFxEnabled]);

  // Start 3-2-1 countdown
  const startCountdown = useCallback(() => {
    if (countdownIntervalRef.current) return;

    let count = 3;
    setCountdown(count);
    playSfx('chirp', soundFxEnabled);

    countdownIntervalRef.current = setInterval(() => {
      count--;
      if (count > 0) {
        setCountdown(count);
        playSfx('chirp', soundFxEnabled);
      } else if (count === 0) {
        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current);
          countdownIntervalRef.current = null;
        }
        setCountdown(null);
        takeSnapshot();
      }
    }, 1000);
  }, [soundFxEnabled, takeSnapshot]);

  // Handle auto-start if invoked by voice
  useEffect(() => {
    if (isOpen && autoStartCountdown && !capturedImage && stream) {
      const timer = setTimeout(() => {
        startCountdown();
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [isOpen, autoStartCountdown, capturedImage, stream, startCountdown]);

  // Download captured photo
  const handleDownload = () => {
    if (!capturedImage) return;
    const a = document.createElement('a');
    a.href = capturedImage;
    a.download = `ultron-looi-camera-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setDownloadSuccess(true);
    playSfx('grant', soundFxEnabled);
    setTimeout(() => setDownloadSuccess(false), 3000);
  };

  // Reset to live camera
  const handleRetake = () => {
    setCapturedImage(null);
    setDownloadSuccess(false);
    startCamera();
  };

  if (!isOpen) return null;

  return (
    <div
      id="camera-countdown-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200"
    >
      {/* Blinding Flash Overlay */}
      {isFlashing && (
        <div className="fixed inset-0 z-50 bg-white pointer-events-none transition-opacity duration-200 opacity-100" />
      )}

      <div className="relative w-full max-w-3xl bg-[#0b1017] border border-[#05E1FF]/40 rounded-2xl overflow-hidden shadow-2xl shadow-[#05E1FF]/20 flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-[#060a0f]/90">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#05E1FF]/15 border border-[#05E1FF]/40 flex items-center justify-center text-[#05E1FF]">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-white font-mono font-bold text-base tracking-wide flex items-center gap-2">
                LOOI OPTICAL SHUTTER · CÁMARA EN VIVO
                <span className="text-[10px] uppercase px-2 py-0.5 rounded-full bg-[#05E1FF]/20 text-[#05E1FF] border border-[#05E1FF]/40">
                  FHD 1080P
                </span>
              </h3>
              <p className="text-xs text-white/50 font-mono">
                {capturedImage ? 'Fotografía capturada · Lista para guardar' : 'Alinea tu rostro dentro del retículo cibernético'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-white/70 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Video / Snapshot Viewport */}
        <div className="relative flex-1 bg-black overflow-hidden flex items-center justify-center min-h-[380px] max-h-[520px]">
          {cameraError ? (
            <div className="text-center p-8 max-w-md">
              <div className="w-14 h-14 rounded-full bg-red-500/20 border border-red-500/40 text-red-400 flex items-center justify-center mx-auto mb-4">
                <Camera className="w-7 h-7" />
              </div>
              <p className="text-red-300 font-mono text-sm mb-4">{cameraError}</p>
              <button
                onClick={startCamera}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg text-white font-mono text-xs transition-colors"
              >
                Reintentar Conexión
              </button>
            </div>
          ) : capturedImage ? (
            /* Captured Result */
            <div className="relative w-full h-full flex items-center justify-center">
              <img
                src={capturedImage}
                alt="Captured Snapshot"
                className="max-h-[500px] w-auto object-contain rounded-lg shadow-lg"
              />
              <div className="absolute top-4 left-4 bg-black/70 backdrop-blur-md px-3 py-1.5 rounded-md border border-[#00FFA3]/40 text-[#00FFA3] font-mono text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                <span>CAPTURA COMPLETADA</span>
              </div>
            </div>
          ) : (
            /* Live Camera Stream */
            <div className="relative w-full h-full flex items-center justify-center">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover ${facingMode === 'user' ? 'scale-x-[-1]' : ''}`}
              />

              {/* Cyber HUD Reticle & Corner Brackets */}
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                {/* Center target box */}
                <div className="relative w-64 h-64 border border-[#05E1FF]/30 rounded-2xl flex items-center justify-center">
                  <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-[#05E1FF]" />
                  <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-[#05E1FF]" />
                  <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-[#05E1FF]" />
                  <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-[#05E1FF]" />

                  {/* Crosshair */}
                  <div className="w-3 h-3 rounded-full bg-[#05E1FF]/40 animate-ping" />
                  <div className="w-1.5 h-1.5 rounded-full bg-[#05E1FF]" />

                  {/* Face Guide Label */}
                  <span className="absolute -top-7 text-[10px] font-mono tracking-widest text-[#05E1FF]/80 uppercase bg-black/60 px-2 py-0.5 rounded border border-[#05E1FF]/20">
                    TARGET: ENCUADRE ROSTRO
                  </span>
                </div>

                {/* Outer Framing Telemetry */}
                <div className="absolute top-4 left-4 flex flex-col gap-1 font-mono text-[10px] text-[#05E1FF]/70 bg-black/60 backdrop-blur-sm p-2 rounded border border-white/10">
                  <span>SENSOR: SONY STARVIS CMOS</span>
                  <span>OPTICS: AUTO-FOCUS ULTRA-LOW NOISE</span>
                  <span>FPS: 60 LOCKED</span>
                </div>

                <div className="absolute bottom-4 left-4 flex items-center gap-2 font-mono text-[11px] text-white/70 bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded-full border border-white/10">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <span>EN VIVO · ÓPTICA ACTIVA</span>
                </div>
              </div>

              {/* Glowing Countdown Center Overlay */}
              {countdown !== null && (
                <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/40 backdrop-blur-xs animate-in zoom-in duration-200">
                  <div className="relative flex items-center justify-center">
                    <div className="w-32 h-32 rounded-full border-4 border-[#05E1FF] animate-spin border-t-transparent" />
                    <span className="absolute font-mono font-black text-7xl text-[#05E1FF] drop-shadow-[0_0_25px_rgba(5,225,255,0.9)] animate-pulse">
                      {countdown}
                    </span>
                  </div>
                  <span className="mt-4 text-white font-mono text-sm tracking-widest uppercase bg-black/70 px-4 py-1.5 rounded-full border border-[#05E1FF]/40">
                    ¡SONRÍE AL ROBOT LOOI!
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Controls Footer */}
        <div className="p-4 bg-[#060a0f] border-t border-white/10 flex flex-wrap items-center justify-between gap-3">
          {capturedImage ? (
            /* Actions for Captured Photo */
            <div className="w-full flex flex-wrap items-center justify-between gap-3">
              <button
                onClick={handleRetake}
                className="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/15 text-white/80 hover:text-white font-mono text-xs flex items-center gap-2 transition-all"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Tomar Otra Foto</span>
              </button>

              <div className="flex items-center gap-3">
                {onAnalyzePhoto && (
                  <button
                    onClick={() => {
                      onAnalyzePhoto(capturedImage);
                      onClose();
                    }}
                    className="px-4 py-2.5 rounded-xl bg-[#05E1FF]/15 hover:bg-[#05E1FF]/25 border border-[#05E1FF]/40 text-[#05E1FF] font-mono text-xs font-bold flex items-center gap-2 transition-all shadow-sm shadow-[#05E1FF]/20"
                  >
                    <Eye className="w-4 h-4" />
                    <span>Analizar con Visión IA</span>
                  </button>
                )}

                <button
                  onClick={handleDownload}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#00FFA3] to-[#05E1FF] text-black font-mono font-bold text-xs flex items-center gap-2 shadow-lg shadow-[#00FFA3]/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
                >
                  <Download className="w-4 h-4" />
                  <span>{downloadSuccess ? '¡Guardada en Descargas!' : 'Guardar / Descargar Foto'}</span>
                </button>
              </div>
            </div>
          ) : (
            /* Live Camera Controls */
            <div className="w-full flex items-center justify-between">
              <button
                onClick={() => setFacingMode((prev) => (prev === 'user' ? 'environment' : 'user'))}
                className="px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white font-mono text-xs flex items-center gap-2 transition-colors"
                title="Cambiar orientación de cámara"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{facingMode === 'user' ? 'Frontal' : 'Trasera'}</span>
              </button>

              <div className="flex items-center gap-3">
                {/* Instant Snapshot */}
                <button
                  onClick={takeSnapshot}
                  disabled={Boolean(countdown !== null)}
                  className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white font-mono text-xs flex items-center gap-2 transition-all disabled:opacity-50"
                >
                  <Zap className="w-4 h-4 text-amber-400" />
                  <span>Captura Instantánea</span>
                </button>

                {/* 3-2-1 Countdown Trigger */}
                <button
                  onClick={startCountdown}
                  disabled={Boolean(countdown !== null)}
                  className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-[#05E1FF] to-[#00FFA3] text-black font-mono font-black text-sm flex items-center gap-2 shadow-lg shadow-[#05E1FF]/30 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
                >
                  <Camera className="w-4 h-4" />
                  <span>{countdown !== null ? `Contando (${countdown})...` : 'Tomar Foto (Contador 3s)'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
