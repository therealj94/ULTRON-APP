import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Camera, X, Download, RotateCcw, Zap, Eye, CheckCircle2 } from 'lucide-react';
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
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  // El stream vive en un ref: si stopCamera dependiera del estado `stream`, cada setStream
  // re-disparaba el efecto (getUserMedia otra vez, foto borrada, streams sin cerrar).
  const streamRef = useRef<MediaStream | null>(null);
  // Cada pedido de cámara lleva un número: si se cerró mientras getUserMedia esperaba, se descarta.
  const pedidoRef = useRef(0);

  const soltarStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  // Initialize camera stream when modal opens
  const startCamera = useCallback(async () => {
    setCameraError(null);
    const n = ++pedidoRef.current;
    soltarStream();
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      if (n !== pedidoRef.current) {
        // Llegó tarde (se cerró o se pidió otra): no dejar la cámara prendida.
        mediaStream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = mediaStream;
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err: any) {
      if (n !== pedidoRef.current) return;
      console.error('Camera access error:', err);
      setCameraError('No pude abrir la cámara. Revisá los permisos del navegador o probá con la otra cámara.');
    }
  }, [facingMode]);

  // Clean up tracks when closing modal
  const stopCamera = useCallback(() => {
    pedidoRef.current++;
    soltarStream();
    setStream(null);
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setCountdown(null);
    setIsFlashing(false);
  }, []);

  // Solo al abrir/cerrar o al cambiar de cámara (startCamera cambia únicamente con facingMode).
  useEffect(() => {
    if (!isOpen) return;
    setCapturedImage(null);
    setDownloadSuccess(false);
    void startCamera();
    return () => {
      stopCamera();
    };
  }, [isOpen, startCamera, stopCamera]);

  // El <video> se vuelve a montar al volver de la foto o de un error: reengancharle el stream.
  useEffect(() => {
    if (videoRef.current && stream && videoRef.current.srcObject !== stream) videoRef.current.srcObject = stream;
  }, [stream, capturedImage, cameraError]);

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

      // Sin espejo para la firma
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      // Firma discreta abajo: AU-RA y la hora
      ctx.fillStyle = 'rgba(35, 37, 40, 0.7)';
      ctx.fillRect(24, height - 60, 220, 36);
      ctx.fillStyle = '#E0C27F';
      ctx.font = '600 14px Figtree, system-ui, sans-serif';
      ctx.fillText(`AU-RA · ${new Date().toLocaleTimeString()}`, 36, height - 37);

      const dataUrl = canvas.toDataURL('image/png', 0.95);
      setCapturedImage(dataUrl);

      // Save to parent list
      const photoObj = {
        id: `photo_${Date.now()}`,
        dataUrl,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        caption: facingMode === 'user' ? 'Cámara frontal' : 'Cámara trasera',
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
    a.download = `aura-foto-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-md p-4 animate-in fade-in duration-200"
    >
      {/* Flash de la foto */}
      {isFlashing && (
        <div className="fixed inset-0 z-50 bg-[#34363A] pointer-events-none transition-opacity duration-200 opacity-100" />
      )}

      <div className="relative w-full max-w-3xl bg-[#232528] border border-[#46484D] rounded-2xl overflow-hidden shadow-[0_12px_40px_rgba(0,0,0,0.48)] flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#46484D] bg-[#34363A]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-[#3D3829] flex items-center justify-center text-[#E0C27F]">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-[#ECE8E2] font-display font-semibold text-lg">Cámara</h3>
              <p className="text-[13px] text-[#B9B2A8]">
                {capturedImage ? 'Foto tomada. Podés guardarla o tomar otra.' : 'Mirá a la cámara y tocá «Tomar foto».'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar cámara"
            className="w-9 h-9 rounded-full bg-[#3A3C41] hover:bg-[#3D3829] flex items-center justify-center text-[#B9B2A8] hover:text-[#ECE8E2] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Video / Snapshot Viewport */}
        <div className="relative flex-1 bg-[#232528] overflow-hidden flex items-center justify-center min-h-[380px] max-h-[520px]">
          {cameraError ? (
            <div className="text-center p-8 max-w-md">
              <div className="w-14 h-14 rounded-full bg-[#34363A] border border-[#46484D] text-[#D9825F] flex items-center justify-center mx-auto mb-4">
                <Camera className="w-7 h-7" />
              </div>
              <p className="text-[#ECE8E2] text-sm mb-4">{cameraError}</p>
              <button
                type="button"
                onClick={startCamera}
                className="px-4 py-2 bg-[#34363A] hover:bg-[#3D3829] border border-[#46484D] rounded-full text-[#ECE8E2] text-[13px] font-semibold transition-colors cursor-pointer"
              >
                Reintentar
              </button>
            </div>
          ) : capturedImage ? (
            /* Captured Result */
            <div className="relative w-full h-full flex items-center justify-center">
              <img
                src={capturedImage}
                alt="Foto tomada"
                className="max-h-[500px] w-auto object-contain rounded-lg shadow-lg"
              />
              <div className="absolute top-4 left-4 bg-[#2F3A30] px-3 py-1.5 rounded-full border border-[#3F4D3F] text-[#A9C3A4] text-[13px] font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                <span>Foto tomada</span>
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

              {/* Guía de encuadre */}
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="relative w-64 h-64 rounded-[32px] border-2 border-[#D6B56C]/60" />

                <div className="absolute bottom-4 left-4 flex items-center gap-2 text-[13px] font-medium text-[#ECE8E2] bg-[#232528]/85 px-3 py-1.5 rounded-full">
                  <span className="w-2 h-2 rounded-full bg-[#D9825F] animate-pulse" />
                  <span>En vivo</span>
                </div>
              </div>

              {/* Glowing Countdown Center Overlay */}
              {countdown !== null && (
                <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#232528]/60 animate-in zoom-in duration-200" aria-live="assertive">
                  <div className="relative flex items-center justify-center">
                    <div className="w-32 h-32 rounded-full border-4 border-[#D6B56C] animate-spin border-t-transparent" />
                    <span className="absolute font-display font-bold text-7xl text-[#E0C27F] drop-shadow-[0_8px_24px_rgba(0,0,0,0.34)]">
                      {countdown}
                    </span>
                  </div>
                  <span className="mt-4 text-[#ECE8E2] text-[15px] font-semibold bg-[#34363A] px-4 py-1.5 rounded-full border border-[#46484D]">
                    ¡Sonreí!
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Controls Footer */}
        <div className="p-4 bg-[#34363A] border-t border-[#46484D] flex flex-wrap items-center justify-between gap-3">
          {capturedImage ? (
            /* Actions for Captured Photo */
            <div className="w-full flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleRetake}
                className="px-4 py-2.5 rounded-full bg-[#3A3C41] hover:bg-[#3D3829] border border-[#46484D] text-[#ECE8E2] text-[13px] font-semibold flex items-center gap-2 transition-all cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Tomar otra</span>
              </button>

              <div className="flex items-center gap-3">
                {onAnalyzePhoto && (
                  <button
                    type="button"
                    onClick={() => {
                      onAnalyzePhoto(capturedImage);
                      onClose();
                    }}
                    className="px-4 py-2.5 rounded-full bg-[#3D3829] hover:bg-[#46402E] border border-[#46484D] text-[#E0C27F] text-[13px] font-semibold flex items-center gap-2 transition-all cursor-pointer"
                  >
                    <Eye className="w-4 h-4" />
                    <span>¿Qué ves en la foto?</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleDownload}
                  className="px-5 py-2.5 rounded-full bg-[#D6B56C] hover:bg-[#E0C27F] text-[#232528] text-[13px] font-semibold flex items-center gap-2 shadow-[0_6px_18px_rgba(0,0,0,0.3)] active:scale-[0.98] transition-all cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>{downloadSuccess ? 'Guardada en Descargas' : 'Descargar'}</span>
                </button>
              </div>
            </div>
          ) : (
            /* Live Camera Controls */
            <div className="w-full flex items-center justify-between">
              <button
                type="button"
                onClick={() => setFacingMode((prev) => (prev === 'user' ? 'environment' : 'user'))}
                className="px-3.5 py-2 rounded-full bg-[#3A3C41] hover:bg-[#3D3829] border border-[#46484D] text-[#B9B2A8] hover:text-[#ECE8E2] text-[13px] font-medium flex items-center gap-2 transition-colors cursor-pointer"
                title="Cambiar de cámara"
                aria-label={facingMode === 'user' ? 'Cámara frontal: cambiar a la trasera' : 'Cámara trasera: cambiar a la frontal'}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{facingMode === 'user' ? 'Frontal' : 'Trasera'}</span>
              </button>

              <div className="flex items-center gap-3">
                {/* Instant Snapshot */}
                <button
                  type="button"
                  onClick={takeSnapshot}
                  disabled={Boolean(countdown !== null)}
                  className="px-4 py-2.5 rounded-full bg-[#3A3C41] hover:bg-[#3D3829] border border-[#46484D] text-[#ECE8E2] text-[13px] font-semibold flex items-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
                >
                  <Zap className="w-4 h-4 text-[#E0C27F]" />
                  <span>Ahora</span>
                </button>

                {/* 3-2-1 Countdown Trigger */}
                <button
                  type="button"
                  onClick={startCountdown}
                  disabled={Boolean(countdown !== null)}
                  className="px-6 py-2.5 rounded-full bg-[#D6B56C] hover:bg-[#E0C27F] text-[#232528] font-semibold text-sm flex items-center gap-2 shadow-[0_6px_18px_rgba(0,0,0,0.3)] active:scale-[0.98] transition-all disabled:opacity-50 cursor-pointer"
                >
                  <Camera className="w-4 h-4" />
                  <span>{countdown !== null ? `En ${countdown}…` : 'Tomar foto'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
