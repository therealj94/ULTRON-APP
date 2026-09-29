/**
 * Tres botones de la barra, junto al micrófono:
 *  · «Voces»: con un toque, nadie habla (se lee todo). Es la misma llave que «Voz» del panel.
 *  · «Interrumpir»: si está encendido, hablarle encima lo calla y lo pone a escuchar, como en una
 *    llamada; apagado, la voz termina lo que dice aunque se hable al lado.
 *  · «Mesa»: abre la mesa técnica —Dr Electrum, Don Chema y la Ing. Tatiana discuten cada pregunta
 *    hasta cerrarla—.
 */
import { useEffect, useState } from 'react';
import { escucharMudo, estaMudo, silenciar } from './voz';
import { abrirMesa, escucharMesa, mesaAbierta } from '../personajes/mesa';

const AMBAR = '#FFAE3B';
const pastilla =
  'pointer-events-auto flex items-center gap-1.5 whitespace-nowrap rounded-full border bg-black/55 px-2.5 py-1.5 font-mono text-[10.5px] tracking-[0.1em] uppercase backdrop-blur-md transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FFAE3B]';

export function BotonVoces() {
  const [mudo, setMudo] = useState(estaMudo());
  useEffect(() => escucharMudo(setMudo), []);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!mudo}
      onClick={() => silenciar(!mudo)}
      data-tour="voces"
      className={pastilla}
      style={mudo ? { borderColor: 'rgba(255,255,255,.14)', color: '#9FB0B8' } : { borderColor: `${AMBAR}66`, color: AMBAR }}
      title={mudo ? 'En silencio: nadie habla, todo se lee. Tocá para que vuelvan a hablar.' : 'Hablan en voz alta. Tocá para explorar en silencio.'}
    >
      <span aria-hidden>{mudo ? '🔇' : '🔊'}</span>
      <span className="hidden sm:inline">{mudo ? 'Silencio' : 'Voces'}</span>
    </button>
  );
}

export function BotonInterrumpir({ activo, onCambiar }: { activo: boolean; onCambiar: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={activo}
      onClick={() => onCambiar(!activo)}
      data-tour="interrumpir"
      className={pastilla}
      style={activo ? { borderColor: `${AMBAR}66`, color: AMBAR } : { borderColor: 'rgba(255,255,255,.14)', color: '#9FB0B8' }}
      title={activo ? 'Si le habla encima, se calla y le escucha. Tocá para que termine siempre lo que dice.' : 'Termina lo que dice aunque le hable. Tocá para poder interrumpirlo hablando.'}
    >
      <span aria-hidden>✋</span>
      <span className="hidden md:inline">Interrumpir</span>
      <span className="relative h-3.5 w-6 rounded-full" style={{ background: activo ? `${AMBAR}cc` : 'rgba(255,255,255,.18)' }} aria-hidden>
        <span className="absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white shadow transition-all" style={{ left: activo ? 12 : 2 }} />
      </span>
    </button>
  );
}

export function BotonMesa() {
  const [abierta, setAbierta] = useState(mesaAbierta());
  useEffect(() => escucharMesa(setAbierta), []);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={abierta}
      onClick={() => abrirMesa(!abierta)}
      data-tour="mesa"
      className={pastilla}
      style={abierta ? { borderColor: '#5CD6C4aa', color: '#5CD6C4' } : { borderColor: 'rgba(255,255,255,.14)', color: '#9FB0B8' }}
      title={abierta ? 'Mesa técnica abierta: cada pregunta la discuten los tres. Tocá para cerrarla.' : 'Abrir la mesa técnica: Dr Electrum, Don Chema y la Ing. Tatiana discuten lo que pregunte.'}
    >
      <span aria-hidden>👥</span>
      <span className="hidden sm:inline">Mesa</span>
    </button>
  );
}
