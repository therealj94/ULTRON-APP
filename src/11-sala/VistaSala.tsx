/**
 * La sala como componente de React. Recibe el estado de la mesa como props y se lo pasa al motor;
 * el motor no re-renderiza nada de React (la boca va a 60 Hz y no puede pasar por setState).
 *
 * Si el aparato no tiene WebGL (o lo pierde después), llama a `onFallo` y quien la usa vuelve a la cara 2D.
 */
import React, { useEffect, useRef } from 'react';
import type { FaceState } from '../types';
import type { Emocion } from '../../lib/emocion';
import { crearSala, type SalaControl, type ZonaToque } from './sala';
import type { Postura, Tarea } from './tareas';

export type PedidoTarea = { tarea: Tarea; texto?: string; n: number };

export type SalaProps = {
  face: FaceState;
  emocion: Emocion;
  lipLevel: number;
  cameraGaze: { x: number; y: number; active: boolean };
  postura: Postura;
  pedido: PedidoTarea | null;
  /** Cambiarlo hace que vuelva a entrar caminando. */
  entrada: number;
  onTocar?: (zona: ZonaToque) => void;
  onDeslizar?: (dir: 'arriba' | 'abajo') => void;
  onFallo: (motivo: string) => void;
  children?: React.ReactNode;
};

export default function Sala(p: SalaProps) {
  const host = useRef<HTMLDivElement>(null);
  const ctl = useRef<SalaControl | null>(null);
  const cb = useRef(p);
  cb.current = p;

  useEffect(() => {
    if (!host.current) return;
    try {
      ctl.current = crearSala(host.current, {
        reducido: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
        postura: cb.current.postura,
        onTocar: (z) => cb.current.onTocar?.(z),
        onDeslizar: (d) => cb.current.onDeslizar?.(d),
        onFallo: (m) => cb.current.onFallo(m),
      });
      ctl.current.estado(cb.current.face, cb.current.emocion);
    } catch (e: any) {
      cb.current.onFallo(String(e?.message || e));
    }
    return () => {
      ctl.current?.destruir();
      ctl.current = null;
    };
  }, []);

  useEffect(() => ctl.current?.estado(p.face, p.emocion), [p.face, p.emocion]);
  useEffect(() => ctl.current?.boca(p.lipLevel), [p.lipLevel]);
  // La visión (y la cara 2D) usan y positiva = abajo, como la pantalla; la sala usa y positiva =
  // arriba, como three.js. Se invierte aquí, en la frontera, para que no mire al revés.
  useEffect(() => ctl.current?.mirar(p.cameraGaze.x, -p.cameraGaze.y, p.cameraGaze.active), [p.cameraGaze.x, p.cameraGaze.y, p.cameraGaze.active]);
  useEffect(() => ctl.current?.postura(p.postura), [p.postura]);
  useEffect(() => {
    if (p.pedido) ctl.current?.tarea(p.pedido.tarea, p.pedido.texto);
  }, [p.pedido?.n]);
  useEffect(() => {
    if (p.entrada > 0) ctl.current?.entrar();
  }, [p.entrada]);

  return (
    <div ref={host} id="aura-sala" className="sin-seleccion absolute inset-0">
      {p.children}
    </div>
  );
}
