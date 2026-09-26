import React from 'react';
import { Camera, Download, Trash2, X, Image as ImageIcon } from 'lucide-react';
import { CapturedPhoto } from '../types';
import { nombreModo } from './SettingsSheet';

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
    a.download = `aura-foto-${photo.id}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const latestPhoto = photos[0]; // App agrega cada foto nueva al principio.

  return (
    <div
      id="ultron-photo-modal"
      className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/55 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div className="w-full max-w-2xl bg-[#232528] border border-[#46484D] rounded-2xl p-6 shadow-[0_8px_24px_rgba(0,0,0,0.34)] flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#46484D] pb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#3D3829] flex items-center justify-center text-[#E0C27F]">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display font-semibold text-xl text-[#ECE8E2]">Fotos</h2>
              <span className="text-[13px] text-[#B9B2A8] block">Las que tomaste en esta sesión</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar fotos"
            className="w-9 h-9 rounded-full bg-[#3A3C41] hover:bg-[#3D3829] flex items-center justify-center text-[#B9B2A8] hover:text-[#ECE8E2] transition-colors cursor-pointer"
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
                alt={latestPhoto.caption || 'Última foto'}
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
              <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-[#232528]/85 text-[12px] font-medium text-[#E0C27F]">
                Modo {nombreModo(latestPhoto.mode).toLowerCase()}
              </div>
              <div className="absolute bottom-2 right-2 text-[12px] text-[#ECE8E2] bg-[#232528]/85 px-2 rounded-full">
                {latestPhoto.timestamp}
              </div>
            </div>

            <div className="flex-1 flex flex-col justify-between">
              <div className="flex flex-col gap-1.5">
                <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#B9B2A8]">Última foto</span>
                <h3 className="font-display font-semibold text-[#ECE8E2] text-base">
                  {latestPhoto.caption || 'Foto'}
                </h3>
              </div>

              <div className="flex items-center gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => handleDownload(latestPhoto)}
                  className="flex-1 py-2 px-3 rounded-full bg-[#D6B56C] hover:bg-[#E0C27F] text-[#232528] font-semibold text-[13px] transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Descargar
                </button>
                <button
                  type="button"
                  onClick={() => onDeletePhoto(latestPhoto.id)}
                  title="Borrar foto"
                  aria-label="Borrar foto"
                  className="w-9 h-9 rounded-full bg-[#3A3C41] border border-[#46484D] text-[#D9825F] hover:bg-[#3D3829] transition-all flex items-center justify-center cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="py-8 text-center flex flex-col items-center gap-2 border border-dashed border-[#46484D] rounded-xl bg-[#34363A]/90">
            <ImageIcon className="w-10 h-10 text-[#B9B2A8]" />
            <p className="text-sm text-[#ECE8E2]">Todavía no hay fotos.</p>
            <p className="text-[13px] text-[#B9B2A8]">Decile a AU-RA «sacame una foto» o tocá el botón de abajo.</p>
          </div>
        )}

        {/* Gallery Thumbnails List */}
        {photos.length > 1 && (
          <div className="flex flex-col gap-2">
            <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#B9B2A8]">
              Todas ({photos.length})
            </span>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {photos.map((p) => (
                <div
                  key={p.id}
                  className="relative aspect-video rounded-lg overflow-hidden border border-[#46484D] bg-[#232528] hover:border-[#D6B56C] transition-all"
                >
                  <img
                    src={p.dataUrl}
                    alt={`Foto de las ${p.timestamp}`}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                  {/* Siempre a la vista: en una tableta táctil no hay hover. */}
                  <div className="absolute bottom-1 right-1 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleDownload(p)}
                      aria-label={`Descargar foto de las ${p.timestamp}`}
                      title="Descargar"
                      className="w-7 h-7 rounded-full bg-[#D6B56C] text-[#232528] flex items-center justify-center shadow-[0_2px_6px_rgba(0,0,0,0.4)] cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeletePhoto(p.id)}
                      aria-label={`Borrar foto de las ${p.timestamp}`}
                      title="Borrar"
                      className="w-7 h-7 rounded-full bg-[#34363A] text-[#D9825F] flex items-center justify-center shadow-[0_2px_6px_rgba(0,0,0,0.4)] cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Bottom Actions */}
        <div className="flex items-center justify-between pt-2 border-t border-[#46484D]">
          <span className="text-[13px] text-[#B9B2A8]">
            Quedan solo aquí, hasta recargar o cerrar la sesión.
          </span>
          <button
            type="button"
            onClick={() => {
              onClose();
              onTriggerNewPhoto();
            }}
            className="py-2 px-4 rounded-full bg-[#3D3829] border border-[#46484D] text-[#E0C27F] hover:bg-[#46402E] font-semibold text-[13px] transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <Camera className="w-4 h-4" />
            Tomar foto
          </button>
        </div>
      </div>
    </div>
  );
};
