/**
 * La iniciativa: cuánto quiere que AURA le proponga por su cuenta (server/iniciativa.ts). Las propuestas
 * llegan como una tarjeta arriba en la mesa (Sí, hazlo · Luego · No) o como aviso con la app cerrada.
 * Se cambia después en Ajustes → Iniciativa de AURA. También se puede decir («poca», «apagada»).
 */
import { View } from 'react-native';
import { de, tr } from '../../i18n';
import type { NivelIniciativa } from '../../nucleo/contrato';
import { MEDIDA } from '../../nucleo/tema';
import { Aparecer } from '../../ui';
import { ResponderHablando } from '../../bienvenida/ResponderHablando';
import { EncabezadoPaso } from '../piezas';
import { OPCIONES_INICIATIVA, PALABRAS_INICIATIVA, opcionDeDictado } from '../flujo';
import { OpcionUnica } from './OpcionUnica';
import type { PropsPaso } from './tipos';

export function PasoIniciativa({ borrador, cambiar }: PropsPaso) {
  const elegir = (n: NivelIniciativa) => cambiar({ iniciativa: n });
  return (
    <View style={{ gap: MEDIDA.espacio.xl }}>
      <EncabezadoPaso
        etiqueta={tr('Iniciativa', 'Initiative')}
        titulo={tr('¿Cuánto quieres que te proponga?', 'How much should I suggest?')}
        texto={tr('A veces te propongo algo sin que me lo pidas: una tarjeta arriba en la mesa con «Sí, hazlo», «Luego» o «No». Nunca de noche.', 'Sometimes I’ll suggest something without being asked: a card at the top of the desk with “Yes, do it”, “Later” or “No”. Never at night.')}
      />
      <Aparecer retraso={140}>
        <OpcionUnica<NivelIniciativa> opciones={OPCIONES_INICIATIVA.map((o) => ({ id: o.id, titulo: de(o.titulo), detalle: de(o.detalle) }))} valor={borrador.iniciativa} onElegir={elegir} />
      </Aparecer>
      <Aparecer retraso={200}>
        <ResponderHablando
          pistas={['alta', 'media', 'baja', 'apagada']}
          onDicho={(t) => {
            const n = opcionDeDictado(t, PALABRAS_INICIATIVA);
            if (n) elegir(n);
          }}
        />
      </Aparecer>
    </View>
  );
}
