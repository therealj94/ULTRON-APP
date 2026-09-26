/**
 * La cara de Skia con red de seguridad.
 *
 * Skia y Reanimated son módulos nativos nuevos en la APK. Si en algún teléfono no cargan (o el dibujo
 * lanza), AU-RA no se puede quedar sin cara ni cerrarse: se avisa con `onFallo` y DeskScreen vuelve a
 * la cara de siempre (UltronFace). Por eso CaraSkia se carga con require dentro de un try y no con un
 * import arriba: un import que falla tumba el módulo entero, y con él la pantalla.
 *
 * Un error dentro del worklet de dibujo (hilo de la interfaz) no pasa por React y el Limite no lo ve:
 * CaraSkia lo atrapa allí y lo avisa con `onFalloDibujo`, que termina en el mismo `onFallo`.
 */
import { Component, useEffect, type ReactNode } from 'react';
import type { CaraSkiaProps } from './CaraSkia';

type Props = Omit<CaraSkiaProps, 'onFalloDibujo'> & { onFallo: (motivo: string) => void };

let modulo: typeof import('./CaraSkia') | null = null;
let errorCarga: string | null = null;

function cargar() {
  if (modulo || errorCarga) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    modulo = require('./CaraSkia') as typeof import('./CaraSkia');
  } catch (e) {
    errorCarga = e instanceof Error ? e.message : String(e);
  }
}

class Limite extends Component<{ onFallo: (motivo: string) => void; children: ReactNode }, { roto: boolean }> {
  state = { roto: false };
  static getDerivedStateFromError() {
    return { roto: true };
  }
  componentDidCatch(e: unknown) {
    this.props.onFallo(e instanceof Error ? e.message : String(e));
  }
  render() {
    return this.state.roto ? null : this.props.children;
  }
}

export function CaraSegura({ onFallo, ...props }: Props) {
  cargar();
  useEffect(() => {
    if (errorCarga) onFallo(errorCarga);
  }, [onFallo]);
  if (!modulo) return null;
  const Cara = modulo.CaraSkia;
  return (
    <Limite onFallo={onFallo}>
      {/* Lo que se rompe en el hilo de la interfaz (el worklet del dibujo) no llega al Limite: llega por aquí. */}
      <Cara {...props} onFalloDibujo={onFallo} />
    </Limite>
  );
}
