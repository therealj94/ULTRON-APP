/**
 * La barra de arriba: identidad a la izquierda, controles del escenario a la derecha.
 *
 * Los controles aparecen solo cuando hay trabajo abierto. Con la cara en el centro no hay nada que
 * controlar, y una barra llena de botones apagados enseña complejidad sin dar nada a cambio.
 */
import type { ReactNode } from 'react';
import type { Escenario } from '../App';
import type { Fondo, Motor } from '../mapa/Mapa';

type Props = {
  escenario: Escenario;
  motor: Motor;
  fondo: Fondo;
  panel: 'chat' | 'expedientes';
  hayGoogle: boolean;
  onEscenario: (e: Escenario) => void;
  onMotor: (m: Motor) => void;
  onFondo: (f: Fondo) => void;
  onPanel: (p: 'chat' | 'expedientes') => void;
};

const AMBAR = '#FFAE3B';

function Grupo({ children }: { children: ReactNode }) {
  return <div className="flex items-center shrink-0 rounded-full border border-white/12 bg-black/55 backdrop-blur-md overflow-hidden">{children}</div>;
}

function Opcion({
  activa,
  onClick,
  children,
  titulo,
  desactivada,
}: {
  activa: boolean;
  onClick: () => void;
  children: ReactNode;
  titulo?: string;
  desactivada?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={desactivada}
      title={titulo}
      className={`px-3 py-1.5 text-[11px] font-mono tracking-[0.12em] uppercase transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-35 ${
        activa ? 'text-black' : 'text-[#9FB0B8] hover:text-white'
      }`}
      style={activa ? { background: AMBAR } : undefined}
    >
      {children}
    </button>
  );
}

export function Barra({ escenario, motor, fondo, panel, hayGoogle, onEscenario, onMotor, onFondo, onPanel }: Props) {
  const enTrabajo = escenario === 'trabajo';
  return (
    <div className="absolute top-0 left-0 right-0 z-40 flex items-center justify-between gap-3 px-3 py-2.5 pointer-events-none">
      <button
        type="button"
        onClick={() => onEscenario(enTrabajo ? 'cara' : 'trabajo')}
        className="pointer-events-auto flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/12 bg-black/55 backdrop-blur-md cursor-pointer"
        title={enTrabajo ? 'Volver a la cara' : 'Abrir el mapa'}
      >
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: AMBAR }} />
        <span className="font-display font-bold tracking-[0.2em] text-[11px]" style={{ color: AMBAR }}>
          DR ELECTRUM
        </span>
      </button>

      {/* A 400 px los tres grupos no caben: se arrastran en vez de cortarse. */}
      <div
        className="flex items-center gap-2 transition-opacity duration-300 overflow-x-auto max-w-[calc(100vw-9rem)] md:max-w-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ opacity: enTrabajo ? 1 : 0, pointerEvents: enTrabajo ? 'auto' : 'none' }}
      >
        <Grupo>
          <Opcion activa={fondo === 'satelite'} onClick={() => onFondo('satelite')}>
            Satélite
          </Opcion>
          <Opcion activa={fondo === 'calles'} onClick={() => onFondo('calles')}>
            Calles
          </Opcion>
        </Grupo>

        <Grupo>
          <Opcion activa={motor === 'maplibre'} onClick={() => onMotor('maplibre')} titulo="Motor de trabajo: aguanta miles de polígonos">
            MapLibre
          </Opcion>
          <Opcion
            activa={motor === 'google'}
            onClick={() => onMotor('google')}
            desactivada={!hayGoogle}
            titulo={hayGoogle ? 'Satélite de Google y Street View' : 'Falta la clave de Google Maps'}
          >
            Google
          </Opcion>
        </Grupo>

        <Grupo>
          <Opcion activa={panel === 'chat'} onClick={() => onPanel('chat')}>
            Consulta
          </Opcion>
          <Opcion activa={panel === 'expedientes'} onClick={() => onPanel('expedientes')}>
            Expedientes
          </Opcion>
        </Grupo>
      </div>
    </div>
  );
}
