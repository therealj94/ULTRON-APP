/**
 * CONVERSACIÓN FLUIDA: hablar de corrido con el avatar, como el modo voz de ChatGPT.
 *
 * Mientras está activa, el micrófono y la voz no pasan por la mesa: van por WebRTC a ElevenLabs
 * (con cancelación de eco, así el avatar no se oye a sí mismo). ElevenLabs reconoce la voz, decide
 * cuándo terminaste de hablar, le pide la respuesta a NUESTRO cerebro (server/voz-agente.ts) y la
 * dice con la voz v4 del avatar. Si le hablas encima, se calla y te escucha.
 *
 * Este componente no dibuja nada: abre y cierra la sesión, y avisa a la mesa lo que pasa (quién
 * habla, lo que se dijo, el volumen de la voz para mover la boca). La mesa pone la cara y el chat.
 */
import { useEffect, useRef } from 'react';
import { ConversationProvider, useConversation } from '@elevenlabs/react-native';
import { api } from '../lib/api';
import { nivelExterno } from '../lib/tts';
import { miga } from '../lib/reporte';
import type { AvatarId } from '../avatares/catalogo';
import type { Idioma } from '../i18n';

export type EstadoConversacion = 'conectando' | 'escuchando' | 'hablando' | 'cerrada' | 'error';

type Props = {
  activa: boolean;
  /** El micrófono de ESTA sesión en silencio (el botón del micrófono de la mesa, mientras se conversa). */
  silenciado?: boolean;
  avatar: AvatarId;
  idioma: Idioma;
  onEstado: (e: EstadoConversacion, detalle?: string) => void;
  /** Una frase terminada: la tuya (`usuario`) o la del avatar (`ultron`). */
  onMensaje: (rol: 'usuario' | 'ultron', texto: string) => void;
};

export function ModoConversacion(p: Props) {
  return (
    <ConversationProvider>
      <Sesion {...p} />
    </ConversationProvider>
  );
}

function Sesion({ activa, silenciado = false, avatar, idioma, onEstado, onMensaje }: Props) {
  const conv = useConversation();
  const cbs = useRef({ onEstado, onMensaje });
  cbs.current = { onEstado, onMensaje };
  const abierta = useRef(false);
  const silencio = useRef(silenciado);
  silencio.current = silenciado;

  // Silenciar corta de verdad el micrófono de WebRTC (no solo el ícono).
  useEffect(() => {
    if (!activa || !abierta.current) return;
    try {
      conv.setMuted(silenciado);
    } catch {
      /* sin sesión todavía: se aplica al conectar */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [silenciado, activa]);

  useEffect(() => {
    if (!activa) return;
    let vivo = true;
    let nivel: ReturnType<typeof setInterval> | null = null;
    (async () => {
      cbs.current.onEstado('conectando');
      try {
        // El permiso de un solo uso y el pase de quién habla los da nuestro servidor (la llave de
        // ElevenLabs nunca llega al teléfono).
        const r = await api<{ token: string; pase: string }>('/api/voz/agente', { method: 'POST', body: JSON.stringify({ avatar, idioma }) }, 15_000);
        if (!vivo) return;
        conv.startSession({
          conversationToken: r.token,
          connectionType: 'webrtc',
          dynamicVariables: { pase: r.pase },
          onConnect: () => {
            abierta.current = true;
            if (silencio.current) {
              try {
                conv.setMuted(true);
              } catch {}
            }
            miga('conversación fluida: conectada');
            cbs.current.onEstado('escuchando');
          },
          onModeChange: ({ mode }) => cbs.current.onEstado(mode === 'speaking' ? 'hablando' : 'escuchando'),
          onMessage: (m) => {
            const texto = String(m.message || '').trim();
            if (texto) cbs.current.onMensaje(m.source === 'user' ? 'usuario' : 'ultron', texto);
          },
          onError: (mensaje) => {
            miga(`conversación fluida: error ${String(mensaje).slice(0, 80)}`);
            cbs.current.onEstado('error', String(mensaje));
          },
          onDisconnect: () => {
            abierta.current = false;
            cbs.current.onEstado('cerrada');
          },
        });
        // La boca sigue el volumen real de la voz del avatar (20 Hz).
        nivel = setInterval(() => {
          try {
            nivelExterno(Math.min(1, conv.getOutputVolume() * 1.6));
          } catch {
            /* sin sesión todavía */
          }
        }, 50);
      } catch (e: any) {
        if (!vivo) return;
        miga(`conversación fluida: no abrió (${String(e?.message || e).slice(0, 80)})`);
        cbs.current.onEstado('error', String(e?.message || e));
      }
    })();
    return () => {
      vivo = false;
      if (nivel) clearInterval(nivel);
      nivelExterno(0);
      try {
        void conv.endSession();
      } catch {
        /* ya cerrada */
      }
      abierta.current = false;
    };
    // La sesión se abre una vez por activación (y si cambia el avatar o el idioma, se reabre).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activa, avatar, idioma]);

  return null;
}
