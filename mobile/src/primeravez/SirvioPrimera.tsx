/**
 * «¿TE SIRVIÓ?» DEL PRIMER RESULTADO (auditoría del 4-oct, P4 · R1): un toque, una sola vez, cuando el primer
 * pedido ya dio algo (útil o parcial; nunca por la petición escrita en la caja). Es la misma pregunta que la
 * web hace sobre la última respuesta (src/13-trabajo/Conversacion.tsx). Si el resultado fue parcial, dice
 * QUÉ faltó (la fuente o la parte), para que no quede escondido.
 *
 * Mientras el primer pedido espera sus tareas y alguna ya terminó (auditoría del 5-oct, R1), solo el progreso
 * («1 de 2 tareas listas»): sin pregunta, porque el resultado todavía no es el de todas.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { tr } from '../i18n';
import { useTema } from '../nucleo/tema';
import { avancePrimer, type PrimerResultado } from '../lib/primerResultado';

type Props = { registro: PrimerResultado; onOpinar: (sirvio: boolean) => void };

export function SirvioPrimera({ registro, onOpinar }: Props) {
  const tema = useTema();
  const avance = avancePrimer(registro);
  if (avance) {
    const espera = avance.sinLeer
      ? tr(`No pude leer ${avance.sinLeer === 1 ? 'una de ellas' : `${avance.sinLeer} de ellas`}; lo sigo intentando.`, `Couldn’t read ${avance.sinLeer} of them; still trying.`)
      : tr('Espero a las demás antes de darlo por terminado.', 'Waiting for the rest before calling it done.');
    return (
      <View style={[s.caja, { backgroundColor: tema.superficie2, borderColor: tema.borde }]} accessibilityRole="summary" accessibilityLiveRegion="polite">
        <Text style={[s.pregunta, { color: tema.texto }]} numberOfLines={2}>
          {tr(`Tu primer pedido: ${avance.listas} de ${avance.total} tareas listas.`, `Your first request: ${avance.listas} of ${avance.total} tasks done.`)}
        </Text>
        <Text style={[s.faltan, { color: tema.texto2 }]} numberOfLines={2}>
          {espera}
        </Text>
      </View>
    );
  }
  const faltan = registro.estado === 'parcial' ? registro.faltantes || [] : [];
  return (
    <View style={[s.caja, { backgroundColor: tema.superficie2, borderColor: tema.borde }]} accessibilityRole="summary">
      {!!faltan.length && (
        <Text style={[s.faltan, { color: tema.texto2 }]} numberOfLines={2}>
          {tr('Faltó', 'Missing')}: {faltan.join(' · ')}
        </Text>
      )}
      <View style={s.fila} accessibilityRole="radiogroup" accessibilityLabel={tr('¿Te sirvió esta respuesta?', 'Was this answer useful?')}>
        <Text style={[s.pregunta, { color: tema.texto }]}>{tr('¿Te sirvió?', 'Was it useful?')}</Text>
        {([true, false] as const).map((si) => (
          <Pressable
            key={String(si)}
            onPress={() => onOpinar(si)}
            accessibilityRole="button"
            accessibilityLabel={si ? tr('Sí, me sirvió', 'Yes, it was useful') : tr('No me sirvió', 'It wasn’t useful')}
            hitSlop={6}
            style={({ pressed }) => [s.boton, { borderColor: tema.borde, backgroundColor: pressed ? tema.acentoFondo : 'transparent' }]}
          >
            <Text style={[s.botonTexto, { color: tema.acentoTexto }]}>{si ? tr('Sí', 'Yes') : tr('No', 'No')}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  caja: { borderRadius: 18, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6, maxWidth: 420, gap: 2 },
  faltan: { fontSize: 13, paddingTop: 2 },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pregunta: { fontSize: 15, flexShrink: 1 },
  boton: { minWidth: 48, minHeight: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  botonTexto: { fontSize: 15, fontWeight: '600' },
});
