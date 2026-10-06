/**
 * CamaraMesa — la cámara que monta la mesa: la nueva en vivo (CamaraVivo, modules/aura-camara) o la de
 * fotos de siempre (CamaraVision). Mismas props que CamaraVision: DeskScreen solo cambia el nombre.
 *
 * Quién decide: lib/guardiaCamara.ts (el binario la trae, el interruptor del servidor, el ajuste «Cámara
 * rápida (nueva)», la guardia contra cierres). Si la nueva falla en la sesión (error del nativo, sin
 * cuadros), se pasa a la de fotos al momento y hasta reabrir la app.
 */
import { useCallback, useEffect, useState } from 'react';
import { CamaraVision, type CamaraVisionProps } from './CamaraVision';
import { CamaraVivo, type CamaraVivoProps } from './CamaraVivo';
import { camaraFallo, decidirCamara, suscribirCamara, type DecisionCamara } from '../lib/guardiaCamara';
import { miga } from '../lib/reporte';

export type CamaraMesaProps = Omit<CamaraVisionProps, 'caras'> & { caras?: CamaraVivoProps['caras'] };

export function CamaraMesa(props: CamaraMesaProps) {
  const [decision, setDecision] = useState<DecisionCamara | null>(null);

  const decidir = useCallback(() => {
    void decidirCamara()
      .then((d) => {
        setDecision((antes) => {
          if (!antes || antes.usar !== d.usar) miga(`mesa: cámara ${d.usar === 'vivo' ? 'nueva (en vivo)' : 'de fotos'} (${d.motivo})`);
          return d;
        });
      })
      .catch(() => setDecision({ usar: 'fotos', motivo: 'fallo', remota: { activa: true } }));
  }, []);

  useEffect(() => {
    decidir();
    return suscribirCamara(decidir);
  }, [decidir]);

  // Unos milisegundos (leer el disco) sin cámara: mejor que montar la de fotos y desmontarla enseguida.
  if (!decision) return null;
  if (decision.usar === 'vivo') return <CamaraVivo {...props} remota={decision.remota} onFallo={camaraFallo} />;
  return <CamaraVision {...props} />;
}
