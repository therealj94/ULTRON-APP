/**
 * (a) EL PRIMER RESULTADO, antes de configurar nada (documento maestro, sección 14; recorrido R1): «¿Qué te
 * gustaría resolver primero? Puedes empezar sin conectar ninguna cuenta». Una opción de un toque (comparar,
 * organizar el día, un recordatorio, un mensaje, averiguar algo, el correo, WhatsApp) o con sus palabras. Se
 * puede saltar (arriba). Lo elegido arma la primera petición (flujo.ts peticionInicial) y decide el plan:
 * la restricción, y la cuenta o el permiso solo si hacen falta.
 */
import { StyleSheet, View } from 'react-native';
import { de, tr } from '../../i18n';
import { MEDIDA } from '../../nucleo/tema';
import { Aparecer, Campo, Chip } from '../../ui';
import { ResponderHablando } from '../../bienvenida/ResponderHablando';
import { EncabezadoPaso } from '../piezas';
import { OBJETIVOS, type ObjetivoId } from '../flujo';
import type { PropsPaso } from './tipos';

export function PasoObjetivo({ borrador, cambiar, avanzar }: PropsPaso) {
  const elegir = (id: ObjetivoId) => cambiar({ objetivo: borrador.objetivo === id ? undefined : id, restriccion: undefined });
  return (
    <View style={{ gap: MEDIDA.espacio.xl }}>
      <EncabezadoPaso
        etiqueta={tr('Tu primer resultado', 'Your first result')}
        titulo={tr('¿Qué te gustaría resolver primero?', 'What would you like to solve first?')}
        texto={tr(
          'Puedes empezar sin conectar ninguna cuenta. Elige una o escríbela con tus palabras; te la dejo lista para mandar.',
          'You can start without connecting any account. Pick one or write it in your own words; I’ll have it ready to send.'
        )}
      />
      <Aparecer retraso={140}>
        <View style={s.chips}>
          {OBJETIVOS.map((o) => (
            <Chip key={o.id} texto={de(o.titulo)} activo={borrador.objetivo === o.id} onPress={() => elegir(o.id)} />
          ))}
        </View>
      </Aparecer>
      <Aparecer retraso={200}>
        <Campo
          etiqueta={borrador.objetivo ? tr('Detalles (opcional)', 'Details (optional)') : tr('Con tus palabras', 'In your own words')}
          value={borrador.objetivoTexto || ''}
          onChangeText={(t) => cambiar({ objetivoTexto: t.slice(0, 200) })}
          placeholder={tr('Ej.: compara tres laptops para la oficina', 'E.g.: compare three laptops for the office')}
          autoCapitalize="sentences"
          autoCorrect
          returnKeyType="next"
          onSubmitEditing={avanzar}
          maxLength={200}
        />
      </Aparecer>
      <Aparecer retraso={260}>
        <ResponderHablando onDicho={(t) => cambiar({ objetivoTexto: `${borrador.objetivoTexto ? `${borrador.objetivoTexto} ` : ''}${t}`.slice(0, 200) })} pistas={OBJETIVOS.map((o) => de(o.titulo))} />
      </Aparecer>
    </View>
  );
}

const s = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
