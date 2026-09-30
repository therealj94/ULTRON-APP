/**
 * La presencia de AURA en React: la preferencia (del perfil), la pantalla visible (del bus) y el
 * modo que toca en cada lugar (presencia.ts decide). Y el aviso de que AURA está «en otro lado» (el
 * panel o la pantalla completa montados), para que la compañera que camina se esconda y no haya dos.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { alCambiarPerfil, guardarPerfil, perfilActual } from '../lib/perfil';
import { canal } from '../compa/canales';
import { useVozOpcional } from '../compa/VozProvider';
import { escuchar, type Pantalla } from '../nucleo/contrato';
import { estadoAvatar } from './contrato';
import { modoEfectivo, PRESENCIA_POR_OMISION } from './presencia';
import type { ModoPresencia } from './tipos';

/** Lo elegido antes de que haya perfil (o si no se pudo guardar): vive en memoria. */
const elegidaSinPerfil = canal<ModoPresencia | undefined>(undefined);

export function preferenciaPresencia(): ModoPresencia {
  return perfilActual()?.presencia ?? elegidaSinPerfil.ultimo() ?? PRESENCIA_POR_OMISION;
}

/** Cambia cómo quiere tener a AURA (el botón del panel, la pantalla completa o la voz). Se guarda en el perfil. */
export function fijarPresencia(m: ModoPresencia) {
  elegidaSinPerfil.emitir(m);
  guardarPerfil({ presencia: m });
}

function suscribirPreferencia(f: () => void) {
  const a = alCambiarPerfil(f);
  const b = elegidaSinPerfil.escuchar(f);
  return () => {
    a();
    b();
  };
}

export function usePreferenciaPresencia(): ModoPresencia {
  return useSyncExternalStore(suscribirPreferencia, preferenciaPresencia, preferenciaPresencia);
}

/* ── la pantalla visible (la anuncian la carcasa y las del chat por el bus) ─────────────────── */

/**
 * La pantalla de arriba y, en los chats, el hilo abierto (null: la lista). La pila nativa deja
 * montadas las pantallas de abajo (la lista debajo del hilo, los chats debajo de Ajustes): solo la
 * que se ve pone a AURA al lado.
 */
type Visible = { pantalla: Pantalla | null; chat: string | null };
const pantallaVisible = canal<Visible>({ pantalla: null, chat: null });
escuchar('pantalla', (p) => pantallaVisible.emitir({ pantalla: p.pantalla, chat: p.chatAbierto?.correo?.toLowerCase() || null }));

export function usePantallaVisible(): Visible {
  return useSyncExternalStore(pantallaVisible.escuchar, pantallaVisible.ultimo, pantallaVisible.ultimo);
}

/** El modo que toca en la pantalla visible. */
export function useModoPresencia(): ModoPresencia | 'oculta' {
  const preferencia = usePreferenciaPresencia();
  const { pantalla } = usePantallaVisible();
  const voz = useVozOpcional();
  return modoEfectivo({ preferencia, pantalla, enLlamada: !!voz?.vista.suspendida });
}

/**
 * ¿Esta pantalla del chat es la que se ve? `chat`: el correo del hilo (la conversación) o null (la
 * lista). Solo entonces monta su panel.
 */
export function useEsLaVisible(pantalla: Pantalla, chat: string | null): boolean {
  const v = usePantallaVisible();
  return v.pantalla === pantalla && v.chat === (chat ? chat.toLowerCase() : null);
}

/** Lo que siente el alma (la compañera), para dibujarlo en otro cuerpo. */
export function useEstadoAvatar() {
  return useSyncExternalStore(estadoAvatar.escuchar, estadoAvatar.ultimo, estadoAvatar.ultimo);
}

/* ── AURA está en otro lado ──────────────────────────────────────────────────────────────── */

/** Cuántos cuerpos de AURA fuera del paseo hay montados (el panel, la pantalla completa). */
export const cuerposAparte = canal(0);

/** El panel y la pantalla completa se anotan mientras se ven. */
export function useAnotarCuerpoAparte(activo: boolean) {
  useEffect(() => {
    if (!activo) return;
    cuerposAparte.emitir(cuerposAparte.ultimo() + 1);
    return () => cuerposAparte.emitir(Math.max(0, cuerposAparte.ultimo() - 1));
  }, [activo]);
}
