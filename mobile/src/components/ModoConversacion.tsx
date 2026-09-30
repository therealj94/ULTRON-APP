/**
 * CONVERSACIÓN FLUIDA: una sesión de ElevenLabs Agents, hablar de corrido con el avatar.
 *
 * Mientras está montada, el micrófono y la voz no pasan por la mesa: van por WebRTC a ElevenLabs
 * (con cancelación de eco, así el avatar no se oye a sí mismo). ElevenLabs reconoce la voz, decide
 * cuándo terminaste de hablar, le pide la respuesta a NUESTRO cerebro (server/voz-agente.ts) y la
 * dice con la voz v4 del avatar. Si le hablas encima, se calla y te escucha.
 *
 * Ya no la monta la mesa: la monta el VozProvider (src/compa/VozProvider.tsx), que vive encima de
 * todas las pantallas, así AURA sigue oyendo y hablando en los chats. Cada apertura es una GENERACIÓN
 * y se monta con `key={gen}`: un ConversationProvider nuevo, sin el candado (`lockRef`) de un arranque
 * anterior que descartaba en silencio el `startSession` siguiente (M4). Todo lo que avisa lleva su
 * `gen`, y el control ignora lo de una generación vieja.
 *
 * Silenciar es de verdad (B5): `isMuted` controlado del proveedor corta el micrófono de WebRTC y el
 * volumen de salida baja a 0, sin cerrar la sesión (al despertarla escucha en el acto).
 *
 * El audio (B3 de la revisión 5): el SDK para la sesión de audio del teléfono DESPUÉS de desconectar.
 * Este componente avisa `onAudio` al tomarlo (justo antes de `startSession`), al soltarlo
 * (`onDisconnect`, o un fallo al abrir) y al pedir el cierre (desmontarse); el VozProvider lo pasa al
 * bus (`voz`) y una llamada espera a que quede libre antes de arrancar su audio.
 *
 * Al terminar una sesión que llegó a abrirse, `onFin` avisa con su pase (el VozProvider se lo cuenta
 * al servidor: POST /api/voz/agente/cerrar).
 *
 * La forma de la boca (avatar3d/senalVoz.ts): si algún cuerpo dibuja visemas (el 3D), cada 50 ms se
 * lee también el espectro de la voz del agente; y si ElevenLabs manda la alineación por letra
 * (`onAudioAlignment`, solo cuando el audio viaja en eventos), se pasa tal cual. Sin nadie que lo
 * pida, el espectro no se mide (tiene costo: LiveKit lo calcula en nativo).
 *
 * Este componente no dibuja nada.
 */
import { useEffect, useRef, type MutableRefObject } from 'react';
import { ConversationProvider, useConversation } from '@elevenlabs/react-native';
import { envolventeLibre } from '../lib/lipsync';
import { miga } from '../lib/reporte';
import { senalVoz } from '../avatar3d/senalVoz';
import type { EstadoVoz } from '../compa/sesion';

export type EstadoConversacion = EstadoVoz;

/** Lo que el VozProvider puede pedirle a la sesión abierta. Cada uno dice si llegó (false: no hay sesión). */
export type ControlesSesion = {
  /** Un texto escrito, como si la persona lo hubiera dicho. */
  enviarTexto: (texto: string) => boolean;
  /** Un dato para el agente que NO es un turno (p. ej. «el mensaje se envió»): lo tiene en cuenta al hablar. */
  avisar: (texto: string) => boolean;
  /** La persona está activa (escribiendo): el agente no la interrumpe. */
  actividad: () => void;
};

type Props = {
  gen: number;
  silenciada: boolean;
  /** El permiso de un solo uso (token de ElevenLabs + pase firmado de quién habla). */
  permiso: () => Promise<{ token: string; pase: string; cid?: string }>;
  onEstado: (gen: number, e: EstadoConversacion, detalle?: string) => void;
  /** Una frase terminada: la tuya (`usuario`) o la del avatar (`ultron`). */
  onMensaje: (gen: number, rol: 'usuario' | 'ultron', texto: string) => void;
  /** Le hablaron encima y se calló. */
  onInterrupcion: (gen: number) => void;
  /** Volúmenes a ~20 Hz: su voz (0..1, la boca) y la de la persona (0..1, el anillo que late). */
  onNiveles: (salida: number, entrada: number) => void;
  controles: MutableRefObject<ControlesSesion | null>;
  /** El audio del teléfono: lo toma, lo soltó, o se pidió cerrar (y se soltará en seguida). */
  onAudio?: (gen: number, que: 'toma' | 'suelta' | 'cerrando') => void;
  /** Terminó una sesión que se pidió abrir: su pase, para avisarle al servidor. Una vez por sesión. */
  onFin?: (gen: number, pase: string) => void;
};

export function ModoConversacion(p: Props) {
  return (
    <ConversationProvider isMuted={p.silenciada}>
      <Sesion {...p} />
    </ConversationProvider>
  );
}

/** Sin volumen real de la salida más de esto mientras habla, la boca sigue una envolvente de habla (lipsync.ts). */
const SIN_VOLUMEN_MS = 600;

function Sesion({ gen, silenciada, permiso, onEstado, onMensaje, onInterrupcion, onNiveles, controles, onAudio, onFin }: Props) {
  const conv = useConversation();
  const cbs = useRef({ onEstado, onMensaje, onInterrupcion, onNiveles, permiso, onAudio, onFin });
  cbs.current = { onEstado, onMensaje, onInterrupcion, onNiveles, permiso, onAudio, onFin };
  const abierta = useRef(false);
  const hablando = useRef(false);
  const silencio = useRef(silenciada);
  silencio.current = silenciada;
  const convRef = useRef(conv);
  convRef.current = conv;

  // Silenciada, tampoco se la oye: el volumen de salida baja a 0 (el micrófono lo corta `isMuted`).
  useEffect(() => {
    if (!abierta.current) return;
    try {
      conv.setVolume({ volume: silenciada ? 0 : 1 });
    } catch {
      /* sin sesión todavía: se aplica al conectar */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [silenciada]);

  useEffect(() => {
    controles.current = {
      enviarTexto: (texto) => {
        if (!abierta.current) return false;
        try {
          convRef.current.sendUserMessage(texto);
          return true;
        } catch {
          return false;
        }
      },
      avisar: (texto) => {
        if (!abierta.current) return false;
        try {
          convRef.current.sendContextualUpdate(texto);
          return true;
        } catch {
          return false;
        }
      },
      actividad: () => {
        if (!abierta.current) return;
        try {
          convRef.current.sendUserActivity();
        } catch {
          /* sin sesión */
        }
      },
    };
    return () => {
      controles.current = null;
    };
  }, [controles]);

  useEffect(() => {
    let vivo = true;
    let nivel: ReturnType<typeof setInterval> | null = null;
    const avisar = (e: EstadoConversacion, detalle?: string) => vivo && cbs.current.onEstado(gen, e, detalle);
    // El audio y el fin se avisan AUNQUE esta generación ya no esté montada: el cierre de verdad
    // (onDisconnect) llega después de desmontarse, y es justo lo que espera una llamada.
    let audio: 'sin' | 'tomado' | 'suelto' = 'sin';
    let pase = '';
    /** El servidor se entera una sola vez, a lo primero: se desconectó o se pidió cerrar. */
    const fin = () => {
      if (pase) cbs.current.onFin?.(gen, pase);
      pase = '';
    };
    const soltarAudio = () => {
      fin();
      if (audio !== 'tomado') return;
      audio = 'suelto';
      cbs.current.onAudio?.(gen, 'suelta');
    };
    (async () => {
      avisar('conectando');
      try {
        const r = await cbs.current.permiso();
        if (!vivo) return;
        audio = 'tomado';
        pase = r.pase;
        cbs.current.onAudio?.(gen, 'toma');
        conv.startSession({
          conversationToken: r.token,
          connectionType: 'webrtc',
          dynamicVariables: { pase: r.pase },
          onConnect: () => {
            if (!vivo) return;
            abierta.current = true;
            if (silencio.current) {
              try {
                conv.setVolume({ volume: 0 });
              } catch {
                /* se reintenta con el próximo cambio */
              }
            }
            miga(`conversación fluida: conectada (gen ${gen})`);
            avisar('escuchando');
          },
          onModeChange: ({ mode }) => {
            hablando.current = mode === 'speaking';
            avisar(mode === 'speaking' ? 'hablando' : 'escuchando');
          },
          onMessage: (m) => {
            const texto = String(m.message || '').trim();
            if (texto && vivo) cbs.current.onMensaje(gen, m.source === 'user' ? 'usuario' : 'ultron', texto);
          },
          onInterruption: () => {
            if (vivo) cbs.current.onInterrupcion(gen);
          },
          onAudioAlignment: (al) => {
            if (vivo) senalVoz.alineacion(al);
          },
          onError: (mensaje) => {
            miga(`conversación fluida: error ${String(mensaje).slice(0, 80)}`);
            // Sin haber conectado, el error es que no abrió: el SDK ya soltó el audio antes de avisar.
            if (!abierta.current) soltarAudio();
            avisar('error', String(mensaje));
          },
          onDisconnect: () => {
            abierta.current = false;
            hablando.current = false;
            soltarAudio();
            avisar('cerrada');
          },
        });
        // La boca sigue el volumen real de la voz del avatar (20 Hz); si el teléfono no lo da, una
        // envolvente de habla mientras el agente habla. El de la persona, para el anillo que late.
        let sinVolumenDesde = 0;
        let envolvente: ((ms: number) => number) | null = null;
        let t0 = 0;
        nivel = setInterval(() => {
          let salida = 0;
          let entrada = 0;
          try {
            salida = Math.min(1, convRef.current.getOutputVolume() * 1.6);
            entrada = silencio.current ? 0 : Math.min(1, convRef.current.getInputVolume() * 2);
          } catch {
            /* sin sesión todavía */
          }
          const ahora = Date.now();
          if (hablando.current && salida < 0.01) {
            if (!sinVolumenDesde) sinVolumenDesde = ahora;
            if (ahora - sinVolumenDesde > SIN_VOLUMEN_MS) {
              if (!envolvente) {
                envolvente = envolventeLibre('speak', gen);
                t0 = ahora;
              }
              salida = envolvente(ahora - t0);
            }
          } else {
            sinVolumenDesde = 0;
            if (!hablando.current) envolvente = null;
          }
          // El espectro, antes del nivel: el nivel es el que publica la boca nueva.
          if (hablando.current && senalVoz.quiereForma()) {
            try {
              senalVoz.espectro(convRef.current.getOutputByteFrequencyData());
            } catch {
              /* sin espectro: la forma sale del volumen */
            }
          }
          cbs.current.onNiveles(silencio.current ? 0 : salida, entrada);
        }, 50);
      } catch (e: any) {
        soltarAudio();
        if (!vivo) return;
        miga(`conversación fluida: no abrió (${String(e?.message || e).slice(0, 80)})`);
        avisar('error', String(e?.message || e));
      }
    })();
    return () => {
      vivo = false;
      if (nivel) clearInterval(nivel);
      cbs.current.onNiveles(0, 0);
      try {
        conv.endSession();
      } catch {
        /* ya cerrada */
      }
      abierta.current = false;
      // El SDK suelta el audio cuando termina de desconectar (onDisconnect); si nunca avisa, el
      // VozProvider lo da por suelto a los pocos segundos.
      if (audio === 'tomado') cbs.current.onAudio?.(gen, 'cerrando');
      fin();
    };
    // Una sesión por generación: el VozProvider la remonta (key) para abrir otra.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
