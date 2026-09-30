/**
 * «Más»: las utilidades de la mesa agrupadas en un solo botón del dock, para que no compitan con
 * Escribir y el micrófono. Cada interruptor dice en palabras cómo está, no solo con color.
 */
import React from 'react';
import { Volume2, VolumeX, Eye, EyeOff, Camera, Moon, Sun, Smartphone, Maximize2, Minimize2, X } from 'lucide-react';
import { Dialogo } from './Dialogo';

type Props = {
  abierto: boolean;
  onCerrar: () => void;
  speakerEnabled: boolean;
  visionEnabled: boolean;
  isSleeping: boolean;
  isKioskFrame: boolean;
  isFullscreen: boolean;
  onToggleSpeaker: () => void;
  onToggleVision: () => void;
  onOpenCamera: () => void;
  onToggleSleep: () => void;
  onToggleKioskFrame: () => void;
  onToggleFullscreen: () => void;
};

function Fila(p: { icono: React.ReactNode; titulo: string; estado?: string; pulsado?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={p.onClick}
      aria-pressed={p.pulsado}
      className="w-full min-h-[52px] px-3 rounded-2xl flex items-center gap-3 text-left text-(--aura-tinta) hover:bg-(--aura-oro-suave) cursor-pointer"
    >
      <span className={`w-10 h-10 rounded-full grid place-items-center shrink-0 ${p.pulsado ? 'bg-(--aura-oro) text-(--aura-sobre-oro)' : 'bg-(--aura-panel-2) text-(--aura-tinta-2)'}`} aria-hidden="true">
        {p.icono}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[16px] font-medium">{p.titulo}</span>
        {p.estado && <span className="block text-[14px] text-(--aura-tinta-2)">{p.estado}</span>}
      </span>
    </button>
  );
}

export function MenuMas(p: Props) {
  const puedePantalla = typeof document !== 'undefined' && !!document.documentElement.requestFullscreen;
  const y = (f: () => void, cerrar = false) => () => {
    f();
    if (cerrar) p.onCerrar();
  };
  return (
    <Dialogo
      abierto={p.abierto}
      onCerrar={p.onCerrar}
      idTitulo="aura-mas-titulo"
      id="aura-menu-mas"
      claseCapa="items-end justify-center sm:justify-end px-3 pb-[calc(96px+env(safe-area-inset-bottom))] sm:pr-6"
      clase="aura-hoja aura-sube w-full max-w-sm rounded-[24px] p-2 flex flex-col gap-0.5"
    >
      <div className="flex items-center justify-between pl-3 pr-1 pt-1">
        <h2 id="aura-mas-titulo" className="aura-sobretitulo">
          Más opciones
        </h2>
        <button type="button" onClick={p.onCerrar} className="aura-redondo plano" aria-label="Cerrar Más opciones">
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>
      <Fila
        icono={p.speakerEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
        titulo="Voz de AU-RA"
        estado={p.speakerEnabled ? 'Activada: contesta en voz alta' : 'Silenciada: solo texto'}
        pulsado={p.speakerEnabled}
        onClick={y(p.onToggleSpeaker)}
      />
      <Fila
        icono={p.visionEnabled ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
        titulo="Que te vea por la cámara"
        estado={p.visionEnabled ? 'Encendida: la detección corre en este navegador' : 'Apagada'}
        pulsado={p.visionEnabled}
        onClick={y(p.onToggleVision)}
      />
      <Fila icono={<Camera className="w-5 h-5" />} titulo="Foto 3-2-1" estado="Tomar una foto con cuenta atrás" onClick={y(p.onOpenCamera, true)} />
      <Fila
        icono={p.isSleeping ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        titulo={p.isSleeping ? 'Despertar a AU-RA' : 'Poner en reposo'}
        estado={p.isSleeping ? 'Está dormida' : 'Deja de reaccionar hasta que la despiertes'}
        pulsado={p.isSleeping}
        onClick={y(p.onToggleSleep, true)}
      />
      <Fila icono={<Smartphone className="w-5 h-5" />} titulo="Marco de mesa" estado={p.isKioskFrame ? 'Con marco' : 'Sin marco'} pulsado={p.isKioskFrame} onClick={y(p.onToggleKioskFrame)} />
      {puedePantalla && (
        <Fila
          icono={p.isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
          titulo={p.isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
          onClick={y(p.onToggleFullscreen, true)}
        />
      )}
    </Dialogo>
  );
}
