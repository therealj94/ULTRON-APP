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
 * La boca (avatar3d/senalVoz.ts, sincronia.ts): el volumen REAL de la voz del agente se lee cada
 * 33 ms (≈ un cuadro), abre rápido y cierra suave (Envolvente) y se cierra en seco si la
 * interrumpen o deja de hablar. LiveKit mide ese volumen sobre la pista ya decodificada, antes del
 * búfer de salida del teléfono (~20–40 ms en Android), que el SDK no deja medir: la boca va, a lo
 * sumo, ese poco por delante del sonido, dentro de lo que el ojo acepta (adelantarse molesta menos
 * que atrasarse); no se le agrega retardo. Si algún cuerpo dibuja visemas (el 3D, la figurita), se
 * lee también el espectro por bandas; y si ElevenLabs manda la alineación por letra
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
import { Envolvente, PASO_BOCA_MS } from '../avatar3d/sincronia';
import type { EstadoVoz } from '../compa/sesion';
import { abrirSesionVoz, type CerrarSesionVoz, type ConvMin } from '../compa/sesionVoz';
import type { VinculoMotor } from '../compa/vinculoMotor';

export type EstadoConversacion = EstadoVoz;

/** Lo que el VozProvider puede pedirle a la sesión abierta. Cada uno dice si llegó (false: no hay sesión). */
export type ControlesSesion = {
  /** Un texto escrito, como si la persona lo hubiera dicho. */
  enviarTexto: (texto: string) => boolean;
  /** Un dato para el agente que NO es un turno (p. ej. «el mensaje se envió»): lo tiene en cuenta al hablar. */
  avisar: (texto: string) => boolean;
  /** La persona está activa (escribiendo): el agente no la interrumpe. */
  actividad: () => void;
  /**
   * Callar lo que la conversación está diciendo AHORA, sin colgar ni silenciar el micrófono (P2): la frase
   * siguiente se oye. Sin sesión, no suena nada de ella: `{ ok: true }`.
   */
  callarSalida: () => { ok: boolean; detalle?: string };
};

type Props = {
  gen: number;
  silenciada: boolean;
  /** El permiso de un solo uso (token de ElevenLabs + pase firmado de quién habla). */
  permiso: () => Promise<{ token: string; pase: string; cid?: string; motor?: 'speech-engine'; primerMensaje?: string }>;
  onEstado: (gen: number, e: EstadoConversacion, detalle?: string) => void;
  /** Una frase terminada: la tuya (`usuario`) o la del avatar (`ultron`). */
  onMensaje: (gen: number, rol: 'usuario' | 'ultron', texto: string) => void;
  /** Le hablaron encima y se calló. */
  onInterrupcion: (gen: number) => void;
  /**
   * Volúmenes a ~20 Hz: su voz (0..1, la boca) y la de la persona (0..1, el anillo que late). `cruda`: el
   * valor del micrófono tal cual lo da el SDK (se congela si dejan de llegar muestras; sin sesión, undefined).
   * `gen`: de qué sesión (AUR10): el VozProvider descarta lo de una vieja.
   */
  onNiveles: (salida: number, entrada: number, cruda?: number, gen?: number) => void;
  controles: MutableRefObject<ControlesSesion | null>;
  /** El audio del teléfono: lo toma, lo soltó, o se pidió cerrar (y se soltará en seguida). */
  onAudio?: (gen: number, que: 'toma' | 'suelta' | 'cerrando') => void;
  /** Terminó una sesión que se pidió abrir: su pase, para avisarle al servidor. Una vez por sesión. */
  onFin?: (gen: number, pase: string) => void;
  /**
   * Llegó el permiso y empieza a conectar el WebRTC: «conectando» son dos esperas con plazos distintos
   * (compa/sesion.ts, CALL02), y el control tiene que saber en cuál está.
   */
  onPermiso?: (gen: number) => void;
  /**
   * Motor nuevo (prototipo de Speech Engine): ata la conversación de ElevenLabs al pase. Si devuelve lo que
   * contestó el servidor (compa/vinculoMotor.ts), un «no» honesto termina la sesión (compa/sesionVoz.ts).
   */
  onVincular?: (gen: number, pase: string, conversacion: string) => void | Promise<VinculoMotor | void>;
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

function Sesion({ gen, silenciada, permiso, onEstado, onMensaje, onInterrupcion, onNiveles, controles, onAudio, onFin, onPermiso, onVincular }: Props) {
  const conv = useConversation();
  /** Cuándo llegó lo último que ElevenLabs oyó de la persona (para la miga de cuánto tardó en hablar). */
  const oidoEn = useRef(0);
  const cbs = useRef({ onEstado, onMensaje, onInterrupcion, onNiveles, permiso, onAudio, onFin, onPermiso, onVincular });
  cbs.current = { onEstado, onMensaje, onInterrupcion, onNiveles, permiso, onAudio, onFin, onPermiso, onVincular };
  const abierta = useRef(false);
  const hablando = useRef(false);
  const silencio = useRef(silenciada);
  silencio.current = silenciada;
  const convRef = useRef(conv);
  convRef.current = conv;
  /** La sesión de esta generación (compa/sesionVoz.ts): colgarla o callar su salida. */
  const sesionRef = useRef<CerrarSesionVoz | null>(null);

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
      callarSalida: () => sesionRef.current?.callarSalida() ?? { ok: true },
    };
    return () => {
      controles.current = null;
    };
  }, [controles]);

  // La sesión entera (permiso, SDK, reloj de la boca, cierre) vive en compa/sesionVoz.ts, sin React: así se
  // prueba con dobles que colgar en cualquier fase no deja nada vivo y que lo tardío no revive nada (AUR10).
  useEffect(() => {
    const sesion = abrirSesionVoz({
      gen,
      conv: () => convRef.current as unknown as ConvMin,
      permiso: () => cbs.current.permiso(),
      cbs: () => cbs.current,
      silenciada: () => silencio.current,
      abierta,
      hablando,
      oidoEn,
      reloj: Date.now,
      intervalo: (f, ms) => setInterval(f, ms),
      limpiarIntervalo: (id) => clearInterval(id as ReturnType<typeof setInterval>),
      boca: new Envolvente(),
      envolventeLibre,
      senal: senalVoz,
      miga,
      pasoMs: PASO_BOCA_MS,
      sinVolumenMs: SIN_VOLUMEN_MS,
    });
    sesionRef.current = sesion;
    return () => {
      sesionRef.current = null;
      sesion();
    };
    // Una sesión por generación: el VozProvider la remonta (key) para abrir otra.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
