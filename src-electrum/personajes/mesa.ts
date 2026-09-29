/**
 * LA MESA ABIERTA: mientras está abierta, cada pregunta la discuten Dr Electrum, Don Chema y la
 * Ing. Tatiana (el turno va con `mesa: true`), y sus caras quedan en pantalla escuchando entre una
 * pregunta y otra. Se cierra con su ✕, con el botón «Mesa» o diciendo «cierra la mesa».
 *
 * Y EL EQUIPO COMENTA: lo que se abre en pantalla (el timelapse, un documento, un perfil) se lo
 * pasa a quien sabe de eso con `comentar()`; el panel lo pide al servidor, lo enseña y lo dice.
 */

let abierta = false;
const oyentes = new Set<(v: boolean) => void>();

export const mesaAbierta = () => abierta;

export function abrirMesa(v: boolean) {
  if (v === abierta) return;
  abierta = v;
  oyentes.forEach((f) => f(v));
}

export function escucharMesa(f: (v: boolean) => void): () => void {
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
}

export type TemaComentario = 'timelapse' | 'documento' | 'perfil' | 'geologico' | 'foto' | 'ficha' | 'filtro' | 'lugar' | 'general';

/** Que el equipo comente lo que se acaba de ver. `contexto`: lo que se ve, con sus cifras. */
export function comentar(tema: TemaComentario, contexto: string) {
  window.dispatchEvent(new CustomEvent('electrum:comentario', { detail: { tema, contexto: String(contexto || '').slice(0, 3000) } }));
}
