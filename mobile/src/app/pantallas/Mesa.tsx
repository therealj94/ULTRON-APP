/**
 * La ruta Mesa: la mesa de los avatares (src/screens/DeskScreen.tsx) montada tal cual, con su
 * PulseProvider (el chat y las llamadas viven con ella, como antes).
 *
 *   · Dentro del PulseProvider va el puente del chat: lo que AURA pida por el bus («abre el chat»,
 *     «abre la conversación con Beto») llega aquí y se abre con `usePulse().abrir()`.
 *   · La mesa decide su orientación (bienvenida acostada, después libre). Al ir a Ajustes la pantalla
 *     se suelta; al volver, se restituye lo que la mesa tenía.
 *   · Es un escenario oscuro en los dos temas: barras del sistema escondidas (lo pone la navegación).
 */
import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { modoActual, orientar, type ModoOrientacion } from '../../lib/orientacion';
import { DeskScreen } from '../../screens/DeskScreen';
import { PulseProvider, usePulse } from '../../pulse/PulseProvider';
import { usePedidoChat } from '../acciones';
import type { RaizParams } from '../rutas';
import { salirDeLaSesion, tomarRecienElegido, useUsuario } from '../sesion';

type Props = NativeStackScreenProps<RaizParams, 'Mesa'>;

/** Recoge los pedidos de chat de la carcasa (necesita estar dentro del PulseProvider). */
function PuenteChat() {
  const { abrir } = usePulse();
  usePedidoChat(abrir);
  return null;
}

export function Mesa(_: Props) {
  const usuario = useUsuario();
  // Se lee una sola vez al montar: la presentación del avatar es solo al llegar de la primera vez.
  const [recienElegido] = useState(tomarRecienElegido);
  const modoAlSalir = useRef<ModoOrientacion | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (modoAlSalir.current) void orientar(modoAlSalir.current);
      return () => {
        modoAlSalir.current = modoActual();
        void orientar('libre');
      };
    }, [])
  );

  if (!usuario) return null;
  return (
    <PulseProvider>
      <PuenteChat />
      <DeskScreen user={usuario} recienElegido={recienElegido} onLogout={salirDeLaSesion} />
    </PulseProvider>
  );
}
