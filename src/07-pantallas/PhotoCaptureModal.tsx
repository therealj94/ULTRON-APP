import React from 'react';
import { Camera, Download, Trash2, X, Image as ImageIcon, Sparkles } from 'lucide-react';
import { CapturedPhoto } from '../types';

interface PhotoCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  photos: CapturedPhoto[];
  onDeletePhoto: (id: string) => void;
  onTriggerNewPhoto: () => void;
}

export const PhotoCaptureModal: React.FC<PhotoCaptureModalProps> = ({
  isOpen,
  onClose,
  photos,
  onDeletePhoto,
  onTriggerNewPhoto,
}) => {
  if (!isOpen) return null;

  const handleDownload = (photo: CapturedPhoto) => {
    const a = document.createElement('a');
    a.href = photo.dataUrl;
    a.download = `ultron-snapshot-${photo.id}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const latestPhoto = photos[photos.length - 1];

  return (
    <div
      id="ultron-photo-modal"
      className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/55 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div className="w-full max-w-2xl bg-[#34363A] border border-[#46484D] rounded-2xl p-6 shadow-[0_8px_24px_rgba(0,0,0,0.34)] flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#46484D] pb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#D6B56C]/10 border border-[#46484D] flex items-center justify-center text-[#E0C27F]">
              <Camera className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <span className="text-[12px] font-mono tracking-normal text-[#B9B2A8] block uppercase">
                GALERÍA ÓPTICA · CAPTURAS CYBER
              </span>
              <h2 className="font-display font-bold text-lg text-[#E0C27F] tracking-wider">
                FOTOS & INSTANTÁNEAS AU-RA
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded text-[#B9B2A8] hover:text-[#ECE8E2] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Latest Snapshot Hero Card */}
        {latestPhoto ? (
          <div className="flex flex-col md:flex-row gap-4 p-4 rounded-xl bg-[#34363A]/90 border border-[#46484D]">
            <div className="relative w-full md:w-1/2 aspect-video bg-[#232528] rounded-lg overflow-hidden border border-[#46484D] group">
              <img
                src={latestPhoto.dataUrl}
                alt="AU-RA Snapshot"
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
              <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-[#34363A]/90 border border-[#46484D] text-[13px] font-mono text-[#E0C27F]">
                MODO: {latestPhoto.mode}
              </div>
              <div className="absolute bottom-2 right-2 text-[13px] font-mono text-[#B9B2A8] bg-[#34363A]/90 px-1.5 rounded">
                {latestPhoto.timestamp}
              </div>
            </div>

            <div className="flex-1 flex flex-col justify-between">
              <div className="flex flex-col gap-1.5">
                <div className="text-xs font-mono text-[#B9B2A8] flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-[#E0C27F]" />
                  <span>ÚLTIMA FOTO CAPTURADA</span>
                </div>
                <h3 className="font-display font-semibold text-[#ECE8E2] text-sm">
                  {latestPhoto.caption || 'Instantánea del Asistente AU-RA'}
                </h3>
                <p className="text-xs text-[#B9B2A8] font-mono leading-relaxed">
                  Resolución procesada con marco cibernético, firma de junta directiva y balance óptico adaptativo.
                </p>
              </div>

              <div className="flex items-center gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => handleDownload(latestPhoto)}
                  className="flex-1 py-2 px-3 rounded-lg bg-[#D6B56C]/20 border border-[#46484D] text-[#E0C27F] hover:bg-[#D6B56C]/30 font-display font-semibold text-xs tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  DESCARGAR FOTO
                </button>
                <button
                  type="button"
                  onClick={() => onDeletePhoto(latestPhoto.id)}
                  title="Eliminar foto"
                  className="p-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[#E0726B] hover:bg-red-500/20 transition-all cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="py-8 text-center flex flex-col items-center gap-2 border border-dashed border-[#46484D] rounded-xl bg-[#34363A]/90">
            <ImageIcon className="w-10 h-10 text-[#B9B2A8]" />
            <p className="text-sm font-mono text-[#B9B2A8]">No hay fotos capturadas aún.</p>
            <p className="text-xs text-[#B9B2A8]">Dile a AU-RA: "Toma una foto" o presiona el botón inferior.</p>
          </div>
        )}

        {/* Gallery Thumbnails List */}
        {photos.length > 1 && (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-mono text-[#B9B2A8] tracking-wider uppercase">
              HISTORIAL DE INSTANTÁNEAS ({photos.length})
            </span>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {photos.map((p) => (
                <div
                  key={p.id}
                  className="relative aspect-video rounded-lg overflow-hidden border border-[#46484D] bg-[#232528] group hover:border-[#46484D] transition-all"
                >
                  <img
                    src={p.dataUrl}
                    alt="AU-RA Gallery"
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute inset-0 bg-[#34363A]/90 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleDownload(p)}
                      className="p-1.5 rounded-full bg-[#D6B56C] text-[#232528] hover:scale-110 transition-transform"
                    >
                      <Download className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeletePhoto(p.id)}
                      className="p-1.5 rounded-full bg-[#C4523E] text-white hover:scale-110 transition-transform"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Bottom Actions */}
        <div className="flex items-center justify-between pt-2 border-t border-[#46484D]">
          <span className="text-[13px] font-mono text-[#B9B2A8]">
            Obturador óptico con flash de alta velocidad
          </span>
          <button
            type="button"
            onClick={() => {
              onClose();
              onTriggerNewPhoto();
            }}
            className="py-2 px-4 rounded-lg bg-[#D6B56C]/20 border border-[#46484D] text-[#E0C27F] hover:bg-[#D6B56C]/30 font-display font-semibold text-xs tracking-wider transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <Camera className="w-4 h-4" />
            TOMAR NUEVA FOTO AHORA
          </button>
        </div>
      </div>
    </div>
  );
};
