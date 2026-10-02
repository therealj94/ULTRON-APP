/**
 * Una lista de opciones de UNA sola respuesta (el idioma, la iniciativa): tarjetas grandes con su título y
 * una línea que explica; la elegida se pinta de dorado con su palomita. Cada una mide 56 dp o más.
 */
import { Pressable, StyleSheet, View } from 'react-native';
import { MEDIDA, useTema } from '../../nucleo/tema';
import { Palomita, Texto, vibrar } from '../../ui';

export type Opcion<T extends string> = { id: T; titulo: string; detalle?: string };

export function OpcionUnica<T extends string>({ opciones, valor, onElegir }: { opciones: readonly Opcion<T>[]; valor: T | undefined; onElegir: (v: T) => void }) {
  const tema = useTema();
  return (
    <View style={{ gap: 10 }} accessibilityRole="radiogroup">
      {opciones.map((o) => {
        const activo = o.id === valor;
        return (
          <Pressable
            key={o.id}
            onPress={() => {
              vibrar('seleccion');
              onElegir(o.id);
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected: activo }}
            accessibilityLabel={o.detalle ? `${o.titulo}. ${o.detalle}` : o.titulo}
            style={[s.opcion, { borderColor: activo ? tema.acento : tema.borde, backgroundColor: activo ? tema.acentoFondo : tema.superficie, borderWidth: activo ? 2 : 1 }]}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Texto v="cuerpoFuerte">{o.titulo}</Texto>
              {!!o.detalle && (
                <Texto v="chica" color="texto2">
                  {o.detalle}
                </Texto>
              )}
            </View>
            <Palomita hecho={activo} tam={24} color={tema.acento} colorMarca={tema.sobreAcento} />
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  opcion: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: MEDIDA.radio.m, paddingHorizontal: 16, paddingVertical: 14, minHeight: 56 },
});
