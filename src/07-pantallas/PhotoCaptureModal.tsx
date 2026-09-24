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
      className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-[#3A322C]/40 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div className="w-full max-w-2xl bg-white border border-[#EDE0CC] rounded-2xl p-6 shadow-[0_8px_24px_rgba(90,60,25,0.14)] flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#EDE0CC] pb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#E2A83E]/10 border border-[#EDE0CC] flex items-center justify-center text-[#A8701A]">
              <Camera className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <span className="text-[12px] font-mono tracking-normal text-[#6B6056] block uppercase">
                GALERÍA ÓPTICA · CAPTURAS CYBER
              </span>
              <h2 className="font-display font-bold text-lg text-[#A8701A] tracking-wider">
                FOTOS & INSTANTÁNEAS AU-RA
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded text-[#6B6056] hover:text-[#3A322C] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Latest Snapshot Hero Card */}
        {latestPhoto ? (
          <div className="flex flex-col md:flex-row gap-4 p-4 rounded-xl bg-white/90 border border-[#EDE0CC]">
            <div className="relative w-full md:w-1/2 aspect-video bg-[#FEF9F3] rounded-lg overflow-hidden border border-[#EDE0CC] group">
              <img
                src={latestPhoto.dataUrl}
                alt="AU-RA Snapshot"
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
              <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-white/90 border border-[#EDE0CC] text-[13px] font-mono text-[#A8701A]">
                MODO: {latestPhoto.mode}
              </div>
              <div className="absolute bottom-2 right-2 text-[13px] font-mono text-[#6B6056] bg-white/90 px-1.5 rounded">
                {latestPhoto.timestamp}
              </div>
            </div>

            <div className="flex-1 flex flex-col justify-between">
              <div className="flex flex-col gap-1.5">
                <div className="text-xs font-mono text-[#6B6056] flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-[#A8701A]" />
                  <span>ÚLTIMA FOTO CAPTURADA</span>
                </div>
                <h3 className="font-display font-semibold text-[#3A322C] text-sm">
                  {latestPhoto.caption || 'Instantánea del Asistente AU-RA'}
                </h3>
                <p className="text-xs text-[#6B6056] font-mono leading-relaxed">
                  Resolución procesada con marco cibernético, firma de junta directiva y balance óptico adaptativo.
                </p>
              </div>

              <div className="flex items-center gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => handleDownload(latestPhoto)}
                  className="flex-1 py-2 px-3 rounded-lg bg-[#E2A83E]/20 border border-[#EDE0CC] text-[#A8701A] hover:bg-[#E2A83E]/30 font-display font-semibold text-xs tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  DESCARGAR FOTO
                </button>
                <button
                  type="button"
                  onClick={() => onDeletePhoto(latestPhoto.id)}
                  title="Eliminar foto"
                  className="p-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[#B3413D] hover:bg-red-500/20 transition-all cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="py-8 text-center flex flex-col items-center gap-2 border border-dashed border-[#EDE0CC] rounded-xl bg-white/90">
            <ImageIcon className="w-10 h-10 text-[#6B6056]" />
            <p className="text-sm font-mono text-[#6B6056]">No hay fotos capturadas aún.</p>
            <p className="text-xs text-[#6B6056]">Dile a AU-RA: "Toma una foto" o presiona el botón inferior.</p>
          </div>
        )}

        {/* Gallery Thumbnails List */}
        {photos.length > 1 && (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-mono text-[#6B6056] tracking-wider uppercase">
              HISTORIAL DE INSTANTÁNEAS ({photos.length})
            </span>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {photos.map((p) => (
                <div
                  key={p.id}
                  className="relative aspect-video rounded-lg overflow-hidden border border-[#EDE0CC] bg-[#FEF9F3] group hover:border-[#EDE0CC] transition-all"
                >
                  <img
                    src={p.dataUrl}
                    alt="AU-RA Gallery"
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute inset-0 bg-white/90 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleDownload(p)}
                      className="p-1.5 rounded-full bg-[#E2A83E] text-white hover:scale-110 transition-transform"
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
        <div className="flex items-center justify-between pt-2 border-t border-[#EDE0CC]">
          <span className="text-[13px] font-mono text-[#6B6056]">
            Obturador óptico con flash de alta velocidad
          </span>
          <button
            type="button"
            onClick={() => {
              onClose();
              onTriggerNewPhoto();
            }}
            className="py-2 px-4 rounded-lg bg-[#E2A83E]/20 border border-[#EDE0CC] text-[#A8701A] hover:bg-[#E2A83E]/30 font-display font-semibold text-xs tracking-wider transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <Camera className="w-4 h-4" />
            TOMAR NUEVA FOTO AHORA
          </button>
        </div>
      </div>
    </div>
  );
};
