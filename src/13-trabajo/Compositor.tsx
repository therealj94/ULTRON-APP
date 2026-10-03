/**
 * El campo para escribirle a AU-RA, con Enviar. Lo usan la hoja «Escribir» (al conversar) y el
 * panel de trabajo (siempre a la vista). La etiqueta es visible para lectores de pantalla y el
 * placeholder solo da ejemplos: no reemplaza a la etiqueta.
 */
import React, { useEffect, useState } from 'react';
import { Send } from 'lucide-react';

type Props = {
  onEnviar: (texto: string) => void;
  /** Para enfocar el campo desde fuera (al abrir Escribir). */
  campoRef?: { current: HTMLInputElement | null };
  /** Lo que el micrófono está oyendo, mientras lo oye. */
  oyendo?: string;
  /** Lo que va a la derecha del botón Enviar (micrófono, «Más»). */
  despues?: React.ReactNode;
  id?: string;
  /**
   * Un texto que se le propone escribir («Cambia el correo para Ana: », tras «Editar» en el panel de
   * tareas). Queda en el campo, con el foco; nunca se envía solo. `n` distingue dos propuestas iguales.
   */
  propuesta?: { texto: string; n: number } | null;
};

export function Compositor({ onEnviar, campoRef, oyendo, despues, id = 'dock-cmd-input', propuesta }: Props) {
  const [valor, setValor] = useState('');
  useEffect(() => {
    if (!propuesta?.texto) return;
    setValor(propuesta.texto);
    requestAnimationFrame(() => campoRef?.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propuesta?.n]);
  const enviar = (e: React.FormEvent) => {
    e.preventDefault();
    const t = valor.trim();
    if (!t) return;
    onEnviar(t);
    setValor('');
  };
  return (
    <form onSubmit={enviar} className="flex flex-col gap-1.5">
      <label htmlFor={id} className="sr-only">
        Escribirle a AU-RA
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          ref={campoRef as any}
          type="text"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder="Escribile a AU-RA…"
          autoComplete="off"
          enterKeyHint="send"
          className="aura-campo aura-seleccionable"
        />
        <button type="submit" className="aura-primario !px-4 sm:!px-5" aria-label="Enviar">
          <Send className="w-4 h-4" aria-hidden="true" />
          <span className="hidden sm:inline">Enviar</span>
        </button>
        {despues}
      </div>
      {oyendo ? (
        <p className="text-[14px] text-(--aura-tinta-2) px-3" aria-live="polite">
          Oyendo: «{oyendo}»
        </p>
      ) : null}
    </form>
  );
}
