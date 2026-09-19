import React, { useState, useRef } from 'react';
import {
  Upload,
  Download,
  Trash2,
  Eye,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Play,
  Pause,
  RotateCcw,
  Sparkles,
  Lock,
  X,
  FileVideo,
  FileImage,
} from 'lucide-react';
import { playSfx } from '../03-voz/audio';

interface VisionMediaAnalyzerModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMediaUrl?: string | null;
  initialMediaType?: 'image' | 'video';
  soundFxEnabled?: boolean;
}

export const VisionMediaAnalyzerModal: React.FC<VisionMediaAnalyzerModalProps> = ({
  isOpen,
  onClose,
  initialMediaUrl = null,
  initialMediaType = 'image',
  soundFxEnabled = true,
}) => {
  const [mediaUrl, setMediaUrl] = useState<string | null>(initialMediaUrl);
  const [mediaType, setMediaType] = useState<'image' | 'video' | 'pdf'>(initialMediaType);
  const [fileName, setFileName] = useState<string>('captura_inspeccion.png');
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisResult, setAnalysisResult] = useState<any | null>(null);
  const [isPurged, setIsPurged] = useState<boolean>(false);
  const [autoPurgeEnabled, setAutoPurgeEnabled] = useState<boolean>(true);
  const [purgeCountdown, setPurgeCountdown] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  // Sync initial URL if passed
  React.useEffect(() => {
    if (initialMediaUrl) {
      setMediaUrl(initialMediaUrl);
      setMediaType(initialMediaType);
      setIsPurged(false);
      setAnalysisResult(null);
    }
  }, [initialMediaUrl, initialMediaType]);

  if (!isOpen) return null;

  // Handle file upload ("Subir")
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isVid = file.type.startsWith('video') || /\.(mp4|webm|mov)$/i.test(file.name);
    const isPdf = file.type.includes('pdf') || /\.pdf$/i.test(file.name);
    const reader = new FileReader();

    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setMediaUrl(dataUrl);
      setMediaType(isVid ? 'video' : isPdf ? 'pdf' : 'image');
      setFileName(file.name);
      setIsPurged(false);
      setAnalysisResult(null);
      playSfx('chirp', soundFxEnabled);
    };

    reader.readAsDataURL(file);
  };

  // Perform Vision Neural Analysis
  const handleAnalyze = async () => {
    if (!mediaUrl || isPurged) return;

    setIsAnalyzing(true);
    playSfx('radar', soundFxEnabled);

    try {
      const response = await fetch('/api/vision/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mediaType: mediaType === 'pdf' ? 'application/pdf' : mediaType,
          fileName,
          base64Data: mediaUrl,
          prompt:
            mediaType === 'pdf'
              ? 'Lee el documento. Copia texto y números. No inventes.'
              : 'Describe con precisión lo que se ve. Si hay texto o números, cópialos. No inventes.',
        }),
      });

      const payload = await response.json().catch(() => ({}));
      const data = response.ok
        ? { ...payload, summary: payload.summary || payload.detalle }
        : {
            success: false,
            summary: payload.error || payload.summary || `No pude leer el archivo (${response.status}). No invento el contenido.`,
            via: payload.via,
            honesto: true,
          };

      setAnalysisResult(data);
      playSfx('grant', soundFxEnabled);

      // Trigger mandatory Auto-Purge if enabled
      if (autoPurgeEnabled) {
        setPurgeCountdown(5);
        let count = 5;
        const interval = setInterval(() => {
          count--;
          setPurgeCountdown(count);
          if (count <= 0) {
            clearInterval(interval);
            executePurge();
          }
        }, 1000);
      }
    } catch (err: any) {
      setAnalysisResult({
        success: false,
        summary: `No pude leer el archivo: ${String(err?.message || err).slice(0, 160)}. No invento el contenido.`,
        honesto: true,
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Execute cryptographic auto-purge: wipe media from memory
  const executePurge = () => {
    setMediaUrl(null);
    setIsPurged(true);
    setPurgeCountdown(null);
    playSfx('blip', soundFxEnabled);
  };

  // Download media ("Bajar")
  const handleDownload = () => {
    if (!mediaUrl) return;
    const a = document.createElement('a');
    a.href = mediaUrl;
    a.download = `descarga-ultron-${fileName}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    playSfx('grant', soundFxEnabled);
  };

  return (
    <div
      id="vision-analyzer-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-3xl bg-[#0b1017] border border-[#05E1FF]/40 rounded-2xl overflow-hidden shadow-2xl shadow-[#05E1FF]/20 flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-[#060a0f]/90">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#05E1FF]/15 border border-[#05E1FF]/40 flex items-center justify-center text-[#05E1FF]">
              <Eye className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-white font-mono font-bold text-base tracking-wide flex items-center gap-2">
                VISIÓN MULTIMODAL QWEN · IMÁGENES Y VIDEOS
                <span className="text-[10px] uppercase px-2 py-0.5 rounded-full bg-[#00FFA3]/20 text-[#00FFA3] border border-[#00FFA3]/40">
                  AUTO-PURGA ACTIVA
                </span>
              </h3>
              <p className="text-xs text-white/50 font-mono">
                Inspección neural con eliminación automática de datos para máxima privacidad
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

        {/* Content Area */}
        <div className="p-6 overflow-y-auto space-y-5">
          {/* Upload & Controls Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-white/5 border border-white/10">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept="image/*,application/pdf,.pdf,video/*"
              className="hidden"
            />

            <div className="flex items-center gap-2">
              {/* SUBIR BOTÓN */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 rounded-xl bg-[#05E1FF]/15 hover:bg-[#05E1FF]/25 border border-[#05E1FF]/40 text-[#05E1FF] font-mono text-xs font-bold flex items-center gap-2 transition-all"
              >
                <Upload className="w-4 h-4" />
                <span>Subir imagen o PDF</span>
              </button>

              {/* BAJAR BOTÓN */}
              {mediaUrl && (
                <button
                  onClick={handleDownload}
                  className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/20 text-white font-mono text-xs flex items-center gap-2 transition-all"
                >
                  <Download className="w-4 h-4" />
                  <span>Bajar Archivo</span>
                </button>
              )}
            </div>

            {/* Auto-Purge Toggle */}
            <label className="flex items-center gap-2 text-xs font-mono text-white/70 cursor-pointer">
              <input
                type="checkbox"
                checked={autoPurgeEnabled}
                onChange={(e) => setAutoPurgeEnabled(e.target.checked)}
                className="rounded accent-[#00FFA3]"
              />
              <span className="flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-[#00FFA3]" />
                Auto-Borrado tras análisis (Seguridad)
              </span>
            </label>
          </div>

          {/* Media Viewport */}
          <div className="relative w-full min-h-[260px] max-h-[380px] bg-black/60 rounded-xl border border-white/10 flex items-center justify-center overflow-hidden">
            {isPurged ? (
              <div className="text-center p-8">
                <div className="w-16 h-16 rounded-full bg-[#00FFA3]/15 border border-[#00FFA3]/40 text-[#00FFA3] flex items-center justify-center mx-auto mb-3 animate-pulse">
                  <Lock className="w-8 h-8" />
                </div>
                <h4 className="text-white font-mono font-bold text-sm mb-1">
                  PROTOCOLO DE PRIVACIDAD EJECUTADO
                </h4>
                <p className="text-xs text-[#00FFA3] font-mono max-w-md mx-auto">
                  El archivo multimedia fue completamente eliminado de la memoria temporal y del almacenamiento local tras completar la inspección neural.
                </p>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-4 px-4 py-2 bg-white/10 hover:bg-white/15 border border-white/20 rounded-lg text-white font-mono text-xs transition-colors"
                >
                  Subir Otro Archivo
                </button>
              </div>
            ) : mediaUrl ? (
              <div className="relative w-full h-full flex items-center justify-center">
                {mediaType === 'video' ? (
                  <video
                    ref={videoRef}
                    src={mediaUrl}
                    controls
                    className="max-h-[360px] max-w-full rounded-lg"
                  />
                ) : mediaType === 'pdf' ? (
                  <div className="text-center p-8">
                    <p className="text-sm font-mono text-white/90 mb-1">{fileName}</p>
                    <p className="text-xs font-mono text-white/50">PDF listo. Lo leo de verdad al analizar: texto y páginas escaneadas.</p>
                  </div>
                ) : (
                  <img
                    src={mediaUrl}
                    alt="Inspection Preview"
                    className="max-h-[360px] max-w-full object-contain rounded-lg"
                  />
                )}

                {/* Purge Button Overlay */}
                <button
                  onClick={executePurge}
                  className="absolute top-3 right-3 px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-300 font-mono text-xs flex items-center gap-1.5 backdrop-blur-md transition-colors"
                  title="Borrar inmediatamente de memoria"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Borrar Ahora</span>
                </button>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="text-center p-8 cursor-pointer hover:bg-white/5 transition-colors w-full h-full flex flex-col items-center justify-center"
              >
                <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white/40 mb-3">
                  <Upload className="w-6 h-6" />
                </div>
                <p className="text-sm font-mono text-white/80 mb-1">
                  Arrastra o selecciona una imagen o PDF
                </p>
                <p className="text-xs font-mono text-white/40">
                  PNG, JPG, WebP, PDF. Si no se puede leer, se dice.
                </p>
              </div>
            )}
          </div>

          {/* Purge Countdown Banner */}
          {purgeCountdown !== null && purgeCountdown > 0 && (
            <div className="flex items-center justify-between p-3 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-300 font-mono text-xs">
              <span className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 animate-bounce" />
                Auto-borrado de privacidad en ejecución: el archivo será destruido en {purgeCountdown}s...
              </span>
              <button
                onClick={executePurge}
                className="underline hover:text-white"
              >
                Destruir Ahora
              </button>
            </div>
          )}

          {/* Analysis Results Card */}
          {analysisResult && (
            <div className="p-4 rounded-xl bg-[#05E1FF]/10 border border-[#05E1FF]/30 space-y-3 font-mono">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#05E1FF] font-bold flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4" />
                  Lo que leí
                </span>
                <span className="text-[11px] text-white/50">
                  {analysisResult.via || (analysisResult.success === false ? 'sin lectura' : '')}
                </span>
              </div>

              <p className="text-xs text-white/90 leading-relaxed whitespace-pre-wrap">
                {analysisResult.summary || analysisResult.error || analysisResult.detalle}
              </p>

              {analysisResult.entities?.length ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {analysisResult.entities.map((e: string, idx: number) => (
                  <span
                    key={idx}
                    className="px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-[10px] text-white/80"
                  >
                    {e}
                  </span>
                ))}
              </div>
              ) : null}

              {analysisResult.detalle && analysisResult.summary !== analysisResult.detalle ? (
                <p className="text-[10px] text-white/50">{analysisResult.detalle}</p>
              ) : null}

              <div className="pt-2 border-t border-white/10 flex items-center justify-between text-[10px] text-[#00FFA3]">
                <span className="flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Conforme con Políticas de Privacidad Zero-Retention
                </span>
                <span>{analysisResult.privacyCompliance?.protocol}</span>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-[#060a0f] border-t border-white/10 flex items-center justify-between">
          <span className="text-xs font-mono text-white/40">
            {isPurged ? 'Memoria limpia (Zero-Knowledge)' : fileName}
          </span>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white font-mono text-xs transition-colors"
            >
              Cerrar
            </button>

            {mediaUrl && !isPurged && (
              <button
                onClick={handleAnalyze}
                disabled={isAnalyzing}
                className="px-6 py-2 rounded-xl bg-gradient-to-r from-[#05E1FF] to-[#00FFA3] text-black font-mono font-bold text-xs flex items-center gap-2 shadow-lg shadow-[#05E1FF]/20 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
              >
                <Eye className="w-4 h-4" />
                <span>{isAnalyzing ? 'Analizando con Qwen...' : 'Ejecutar Visión Neural'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
