/**
 * EL CUERPO 3D EN LA MESA (DeskScreen) para los avatares que se ven con fotos: Claudio y ANT-ONIO.
 *
 * La mesa habla en su idioma (el FaceState de la voz y el cerebro, la emoción del turno, la mirada de
 * la cámara); aquí se traduce al estado del contrato (contrato.ts, estadoDesdeMesa) y se le da a
 * AvatarVivo, con las fotos de siempre como respaldo (ClaudioRetrato acostado, ClaudioDePie derecho):
 * si no hay modelo, falla o el teléfono no da los cuadros, se ven las fotos exactamente como antes.
 *
 * Si el avatar tiene su cuerpo en VIDEO (avatares/video: clips animados de Claudio y ANT-ONIO), ese va
 * primero: saluda al aparecer, escucha, habla, piensa, se ríe y señala con el mismo estado. El 3D queda
 * para los avatares sin video, y las fotos siempre de respaldo.
 *
 * El toque es el de la mesa (onTap / onLongPress: la reacción de la cara y la voz); además, el
 * cuerpo hace su gesto de «le gusta» por la zona que tocó. En video, los toques los decide la capa de
 * efectos (avatares/video/efectos): una onda, un golpe variado del video y, con cuatro toques seguidos,
 * el sable de luz o los blasters; esa ráfaga le pide a la mesa su frase de molesto (`onRafaga`) en vez del
 * onTap de ese toque. La capa no toma el dedo: el toque sigue siendo de este Pressable.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, type LayoutChangeEvent } from 'react-native';
import { AvatarVivo, type ControlCuerpo } from './AvatarVivo';
import { estadoDesdeMesa, type VozMesa } from './contrato';
import { CuerpoVideo, type ControlVideo } from '../avatares/video/CuerpoVideo';
import { hayVideo } from '../avatares/video/clips';
import { pedirGolpe } from '../avatares/video/pistas';
import { CapaEfectos, type ControlEfectos } from '../avatares/video/efectos/CapaEfectos';
import type { Efecto } from '../avatares/video/efectos/toques';
import type { AvatarId } from '../avatares/catalogo';
import type { Camara, EstadoAvatar } from './tipos';

type Props = {
  avatar: AvatarId;
  /** Retrato (acostado) o de cuerpo entero (derecho). */
  camara: Camara;
  face: string;
  emocion: string;
  /**
   * Lo que de verdad suena (avatar3d/sonando.ts y la conversación fluida): el cuerpo habla SOLO con esto,
   * nunca por la cara (José, 5-oct: «habla cuando no está diciendo nada»). Sin audio, `pensando` lo pone a pensar.
   */
  voz: VozMesa;
  mirada: { x: number; y: number; activa: boolean };
  /** Las fotos de siempre: lo que se ve sin 3D. */
  respaldo: ReactNode;
  onTap: () => void;
  onLongPress: () => void;
  /**
   * false: la mesa está tapada (los chats o Ajustes encima; la pila nativa la deja montada debajo).
   * Sin escena 3D gastando batería detrás: la única que vive es la de la compañera que se ve.
   */
  activo?: boolean;
  /** Sube cada vez que la persona toca un atajo: el avatar lo señala. */
  senal?: number;
  /** Hay una conversación o una llamada con el micrófono: los toques solo hacen efectos sutiles, sin sonido. */
  conversando?: boolean;
  /** La mesa disparó su blaster o su sable (comando de voz, o el enojo de muchos toques): el video lo muestra. */
  ataque?: 'saber' | 'blaster' | null;
  /** Cuatro toques seguidos sacaron el sable o los blasters (en video): la mesa dice su frase de molesto. */
  onRafaga?: (efecto: Efecto) => void;
};

export function CuerpoMesa({ avatar, camara, face, emocion, voz, mirada, respaldo, onTap, onLongPress, activo = true, senal = 0, conversando = false, ataque = null, onRafaga }: Props) {
  const [lugar, setLugar] = useState({ w: 0, h: 0 });
  const [gesto, setGesto] = useState<EstadoAvatar['gesto']>(null);
  // Si el video no se puede usar en este teléfono, el cuerpo 3D (que mueve brazos y cuerpo) en vez de
  // las fotos quietas. Sin modelo 3D, las fotos de siempre.
  const [sinVideo, setSinVideo] = useState(false);
  const cuerpo = useRef<ControlCuerpo>(null);
  const efectos = useRef<ControlEfectos>(null);
  // El cuerpo en video: además de la zona del toque, le dice a la capa de efectos dónde está la mano del sable.
  const video = useRef<ControlVideo>(null);
  const medir = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (Math.abs(width - lugar.w) > 1 || Math.abs(height - lugar.h) > 1) setLugar({ w: Math.round(width), h: Math.round(height) });
  };
  const { x, y, activa } = mirada;
  useEffect(() => {
    if (senal > 0) setGesto((g) => ({ nombre: 'senalar', n: (g?.n ?? 0) + 1 }));
  }, [senal]);
  const { sonando, agenteHabla = false, pensando = false } = voz;
  const estado = useMemo(
    () => estadoDesdeMesa(face, emocion, { mirar: { x, y, activa }, gesto, voz: { sonando, agenteHabla, pensando } }),
    [face, emocion, x, y, activa, gesto, sonando, agenteHabla, pensando]
  );

  const conVideo = hayVideo(avatar) && !sinVideo;
  const contexto = useMemo(
    () => ({ hablando: estado.hablando, escuchando: estado.escuchando, pensando: estado.pensando, dormido: estado.silenciado, conversando }),
    [estado.hablando, estado.escuchando, estado.pensando, estado.silenciado, conversando]
  );

  const tocar = async (px: number, py: number) => {
    // En video: la capa de efectos decide (onda, golpe variado, sable o blasters). Si está apagada, lo de siempre.
    const r = conVideo ? efectos.current?.tocar(px, py) : null;
    if (r) {
      if (r.tipo === 'secuencia' && r.voz && onRafaga) onRafaga(r.efecto);
      else onTap();
      return;
    }
    onTap();
    const zona = await (conVideo ? video.current : cuerpo.current)?.zonaEn(px, py);
    if (!zona) return;
    const nombre = zona === 'mejilla' ? 'toque_mejilla' : zona === 'panza' ? 'toque_panza' : 'toque_cabeza';
    setGesto((g) => ({ nombre, n: (g?.n ?? 0) + 1 }));
  };

  return (
    <Pressable
      onLayout={medir}
      onPress={(e) => void tocar(e.nativeEvent.locationX, e.nativeEvent.locationY)}
      onLongPress={onLongPress}
      delayLongPress={500}
      style={StyleSheet.absoluteFill}
      accessibilityRole="imagebutton"
    >
      {lugar.w > 0 && lugar.h > 0 ? (
        conVideo ? (
          <CapaEfectos ref={efectos} avatar={avatar} lugar={camara} ancho={lugar.w} alto={lugar.h} contexto={contexto} activo={activo} ataque={ataque} onGolpe={pedirGolpe} cuerpo={video}>
            <CuerpoVideo ref={video} avatar={avatar} camara={camara} estado={estado} ancho={lugar.w} alto={lugar.h} respaldo={respaldo} activo={activo} saludar onFallo={() => setSinVideo(true)} />
          </CapaEfectos>
        ) : (
          <AvatarVivo ref={cuerpo} avatar={avatar} camara={camara} estado={estado} ancho={lugar.w} alto={lugar.h} fpsMax={60} respaldo={respaldo} activo={activo} />
        )
      ) : (
        respaldo
      )}
    </Pressable>
  );
}
