import React, { useRef } from 'react';
import { Sparkles, Music2, X } from 'lucide-react';
import { playSfx } from '../03-voz/audio';
import { Dialogo } from './Dialogo';
import { Compositor } from '../13-trabajo/Compositor';

interface Props {
  isOpen: boolean;
  soundFxEnabled: boolean;
  onClose: () => void;
  onSubmitCommand: (cmd: string) => void;
  /** El botón Escribir: al cerrar, el foco vuelve ahí. */
  volverA?: { current: HTMLElement | null };
  /** Un texto propuesto para el campo (lo manda la persona; nunca sale solo). */
  propuesta?: { texto: string; n: number } | null;
}

const CHIPS = [
  { label: 'Oro', cmd: 'precio del oro hoy' },
  { label: 'Plata', cmd: 'precio de la plata' },
  { label: 'Lempira', cmd: 'lempira a dólar' },
  { label: 'Qué ves', cmd: 'qué ves en la cámara' },
  { label: 'Sistema', cmd: 'cómo está el sistema' },
  { label: 'Chiste', cmd: 'cuéntame un chiste' },
];

/**
 * «Escribir» mientras se conversa: una hoja abajo con el campo (que recibe el foco al abrir) y unos
 * atajos. Los interruptores que antes vivían aquí (micrófono, voz, cámara, foto, reposo, marco)
 * pasaron al menú «Más» del dock: aquí solo se escribe.
 */
export const DockDrawer: React.FC<Props> = (p) => {
  const campo = useRef<HTMLInputElement>(null);
  const pedir = (c: string) => {
    playSfx('tap', p.soundFxEnabled);
    p.onSubmitCommand(c);
  };
  return (
    <Dialogo
      abierto={p.isOpen}
      onCerrar={p.onClose}
      idTitulo="aura-escribir-titulo"
      inicial={campo}
      volverA={p.volverA}
      id="ultron-dock-drawer"
      claseCapa="items-end justify-center px-3 pb-[calc(12px+env(safe-area-inset-bottom))]"
      clase="aura-hoja aura-sube w-full max-w-2xl rounded-[28px] p-4 sm:p-5 flex flex-col gap-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="aura-escribir-titulo" className="font-display font-semibold text-[18px] text-(--aura-tinta)">
          Escribirle a AU-RA
        </h2>
        <button type="button" onClick={p.onClose} className="aura-redondo plano" aria-label="Cerrar Escribir">
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>
      <Compositor campoRef={campo} onEnviar={(t) => pedir(t)} propuesta={p.propuesta} />
      <div>
        <p id="aura-atajos" className="text-[13px] text-(--aura-tinta-2) mb-1.5">
          Atajos
        </p>
        <ul className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" role="list" aria-labelledby="aura-atajos">
          {CHIPS.map((c) => (
            <li key={c.label}>
              <button type="button" onClick={() => pedir(c.cmd)} className="aura-chip">
                <Sparkles className="w-4 h-4" aria-hidden="true" />
                <span>{c.label}</span>
              </button>
            </li>
          ))}
          <li>
            <button type="button" onClick={() => pedir('canta quiero conocer a Jesús')} className="aura-chip">
              <Music2 className="w-4 h-4" aria-hidden="true" />
              <span>Canta</span>
            </button>
          </li>
        </ul>
      </div>
    </Dialogo>
  );
};
