/**
 * (b) LA restricción que cambia el resultado, y solo esa (documento maestro, sección 14): presupuesto y uso
 * para comparar, qué y cuándo para un recordatorio, para quién y en qué tono para un mensaje… (flujo.ts
 * OBJETIVOS). Opciones de un toque o con sus palabras. Si no importa, «Saltar» (arriba).
 */
import { StyleSheet, View } from 'react-native';
import { de, tr } from '../../i18n';
import { MEDIDA } from '../../nucleo/tema';
import { Aparecer, Campo, Chip } from '../../ui';
import { ResponderHablando } from '../../bienvenida/ResponderHablando';
import { EncabezadoPaso } from '../piezas';
import { objetivoDe } from '../flujo';
import type { PropsPaso } from './tipos';

export function PasoRestriccion({ borrador, cambiar, avanzar }: PropsPaso) {
  const o = objetivoDe(borrador);
  const texto = borrador.restriccion || '';
  const alternar = (t: string) => {
    const partes = texto ? texto.split(', ') : [];
    cambiar({ restriccion: (partes.includes(t) ? partes.filter((x) => x !== t) : [...partes, t]).join(', ').slice(0, 160) });
  };
  return (
    <View style={{ gap: MEDIDA.espacio.xl }}>
      <EncabezadoPaso
        etiqueta={tr('Solo una cosa', 'Just one thing')}
        titulo={o ? de(o.restriccion.pregunta) : tr('¿Algo que cambie el resultado?', 'Anything that changes the result?')}
        texto={o ? `${de(o.restriccion.nota)} ${tr('Si no importa, sáltalo.', 'If it doesn’t matter, skip it.')}` : tr('Un plazo, un presupuesto, para quién es. Si no importa, sáltalo.', 'A deadline, a budget, who it’s for. If it doesn’t matter, skip it.')}
      />
      {!!o && (
        <Aparecer retraso={140}>
          <View style={s.chips}>
            {o.restriccion.sugerencias.map((sug) => {
              const t = de(sug);
              return <Chip key={sug.es} texto={t} activo={texto.split(', ').includes(t)} onPress={() => alternar(t)} />;
            })}
          </View>
        </Aparecer>
      )}
      <Aparecer retraso={200}>
        <Campo
          etiqueta={o ? de(o.restriccion.etiqueta) : tr('Ten en cuenta', 'Keep in mind')}
          value={texto}
          onChangeText={(t) => cambiar({ restriccion: t.slice(0, 160) })}
          placeholder={o ? de(o.restriccion.ejemplo) : tr('Ej.: para el viernes', 'E.g.: by Friday')}
          autoCapitalize="sentences"
          autoCorrect
          returnKeyType="next"
          onSubmitEditing={avanzar}
          maxLength={160}
        />
      </Aparecer>
      <Aparecer retraso={260}>
        <ResponderHablando onDicho={(t) => cambiar({ restriccion: `${texto ? `${texto}, ` : ''}${t}`.slice(0, 160) })} pistas={o ? o.restriccion.sugerencias.map((x) => de(x)) : []} />
      </Aparecer>
    </View>
  );
}

const s = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
