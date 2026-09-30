/**
 * El dedo sobre un cuerpo de AURA que no camina (el panel, la pantalla completa): los mismos gestos
 * que la compañera (compa/gestos.ts) —toque, doble toque, molestar, caricia— con la zona tocada, y se
 * los cuenta al alma por el contrato (`toqueAvatar`). Levantarla y arrastrarla no aplica: aquí está
 * acoplada.
 *
 * La zona: la del modelo 3D si está (raycast en la escena); si no, la de la figurita (mapeo.zona2D).
 */
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { PanResponder, type GestureResponderHandlers } from 'react-native';
import { Gestos, type SalidaGesto } from '../compa/gestos';
import { useVozOpcional } from '../compa/VozProvider';
import { toqueAvatar } from './contrato';
import { zona2D } from './mapeo';
import type { ControlCuerpo } from './AvatarVivo';
import type { GestoDedo, ZonaToque } from './tipos';

type Medida = { ancho: number; alto: number };

export function useTacto(cuerpo: RefObject<ControlCuerpo | null>, medida: Medida): GestureResponderHandlers {
  const voz = useVozOpcional();
  const vozRef = useRef(voz);
  vozRef.current = voz;
  const m = useRef(medida);
  m.current = medida;
  const gestos = useMemo(() => new Gestos({ radio: Math.max(30, Math.min(medida.ancho, medida.alto) * 0.3) }), [medida.ancho, medida.alto]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  return useMemo(() => {
    const zonaDe = async (x: number, y: number): Promise<ZonaToque> => {
      const z = await cuerpo.current?.zonaEn(x, y).catch(() => null);
      if (z) return z;
      const { ancho, alto } = m.current;
      const lado = Math.min(ancho, alto);
      return zona2D(x, y, ancho / 2, alto / 2, lado * 0.27);
    };
    const alGesto = (sal: SalidaGesto[]) => {
      for (const g of sal) {
        if (g.gesto !== 'toque' && g.gesto !== 'dobleToque' && g.gesto !== 'molestar' && g.gesto !== 'caricia') continue;
        const gesto: GestoDedo = g.gesto;
        void zonaDe(g.x, g.y).then((zona) => toqueAvatar.emitir({ gesto, zona }));
      }
    };
    const programar = () => {
      if (timer.current) clearTimeout(timer.current);
      const p = gestos.proximo();
      if (p === null) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        alGesto(gestos.vencer(Date.now()));
        programar();
      }, Math.max(0, p - Date.now()) + 5);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => false,
      onPanResponderGrant: (e) => {
        vozRef.current?.precalentar();
        alGesto(gestos.bajar(Date.now(), e.nativeEvent.locationX, e.nativeEvent.locationY));
        programar();
      },
      onPanResponderMove: (e) => {
        alGesto(gestos.mover(Date.now(), e.nativeEvent.locationX, e.nativeEvent.locationY));
        programar();
      },
      onPanResponderRelease: (e) => {
        alGesto(gestos.subir(Date.now(), e.nativeEvent.locationX, e.nativeEvent.locationY));
        programar();
      },
      onPanResponderTerminate: () => {
        alGesto(gestos.cancelar(Date.now()));
        programar();
      },
    }).panHandlers;
  }, [cuerpo, gestos]);
}
