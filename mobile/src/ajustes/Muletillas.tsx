/**
 * Ajustes → Voz y oído → «Muletillas al escuchar»: el «mjm» o «ajá» bajito, con la voz del avatar, cuando hablas largo
 * (lib/asentir.ts). Solo se muestra donde puede existir (Android con el micrófono del oído Turbo). Debajo dice por qué
 * no suenan si el teléfono no tiene cancelación de eco, si el servidor las apagó o si el oído no es Turbo, para que
 * nadie las prenda y no oiga nada sin saber por qué. Cambiarlo avisa a la mesa al momento (lib/muletillasAjuste.ts).
 */
import { useEffect, useState } from 'react';
import { tr } from '../i18n';
import { Fila, Interruptor } from '../ui';
import { estadoMuletillas, fijarMuletillas, leerMuletillas, suscribirMuletillas } from '../lib/muletillasAjuste';
import type { SttEngine } from '../lib/storage';

export function FilaMuletillas({ motor }: { motor: SttEngine }) {
  const [estado, setEstado] = useState(() => estadoMuletillas());
  const [leido, setLeido] = useState(false);
  useEffect(() => {
    let vivo = true;
    void leerMuletillas().then(() => {
      if (!vivo) return;
      setEstado(estadoMuletillas());
      setLeido(true);
    });
    const quitar = suscribirMuletillas(() => vivo && setEstado(estadoMuletillas()));
    return () => {
      vivo = false;
      quitar();
    };
  }, []);
  if (!estado.disponible || !leido) return null;
  const detalle =
    estado.motivo === 'sin_cancelacion_de_eco'
      ? tr('Este teléfono no tiene cancelación de eco: quedan apagadas para que no se oiga a sí misma.', 'This phone has no echo cancellation: they stay off so it doesn’t hear itself.')
      : estado.motivo === 'apagadas_por_el_servidor'
        ? tr('Apagadas por ahora desde el servidor.', 'Turned off for now from the server.')
        : motor !== 'turbo'
          ? tr('Funcionan con el oído Turbo.', 'Works with Turbo hearing.')
          : tr('Cuando hablas largo, dice «mjm» o «ajá» bajito con su voz, como alguien que te escucha. Si te molesta o te corta, apágalo.', 'When you talk for a while, it says “mhm” or “yeah” softly in its voice, like someone listening. If it bothers you or cuts you off, turn it off.');
  return (
    <Fila
      titulo={tr('Muletillas al escuchar', 'Listening sounds')}
      detalle={detalle}
      icono="microfono"
      derecha={
        <Interruptor
          valor={estado.valor}
          onCambiar={(v) => {
            if (v === estado.valor) return;
            void fijarMuletillas(v);
          }}
          etiqueta={tr('Muletillas al escuchar', 'Listening sounds')}
        />
      }
    />
  );
}
