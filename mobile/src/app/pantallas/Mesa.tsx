/**
 * La ruta Mesa: la mesa de los avatares (src/screens/DeskScreen.tsx) montada tal cual. El chat, las
 * llamadas y la voz de AURA viven un piso más arriba (AppAura), para toda la sesión: el botón Chat de
 * la mesa abre las pantallas del chat y una llamada suena en cualquier pantalla.
 *
 *   · La mesa decide su orientación (bienvenida acostada, después libre). Al ir a Ajustes la pantalla
 *     se suelta; al volver, se restituye lo que la mesa tenía.
 *   · Es un escenario oscuro en los dos temas: barras del sistema escondidas (lo pone la navegación).
 */
import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { modoActual, orientar, type ModoOrientacion } from '../../lib/orientacion';
import { DeskScreen } from '../../screens/DeskScreen';
import type { RaizParams } from '../rutas';
import { salirDeLaSesion, tomarRecienElegido, useUsuario } from '../sesion';

type Props = NativeStackScreenProps<RaizParams, 'Mesa'>;

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
  return <DeskScreen user={usuario} recienElegido={recienElegido} onLogout={salirDeLaSesion} />;
}
