/**
 * Los botones del chat con el tema vivo: lleno (dorado, uno por vista), contorno (la segunda opción,
 * p. ej. «Rechazar») y texto. Se hunden con resorte (Tocable) y aguantan un estado «cargando».
 */
import { ActivityIndicator, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { MEDIDA, useTema } from '../../nucleo/tema';
import { Icono, type NombreIcono } from './Icono';
import { Tocable } from './Tocable';

type Props = {
  titulo: string;
  onPress: () => void;
  variante?: 'lleno' | 'contorno' | 'texto';
  icono?: NombreIcono;
  cargando?: boolean;
  deshabilitado?: boolean;
  chico?: boolean;
  caja?: StyleProp<ViewStyle>;
};

export function BotonChat({ titulo, onPress, variante = 'lleno', icono, cargando, deshabilitado, chico, caja }: Props) {
  const p = useTema();
  const lleno = variante === 'lleno';
  const color = lleno ? p.sobreAcento : variante === 'contorno' ? p.texto : p.acentoTexto;
  const alto = chico ? 36 : 50;
  return (
    <Tocable
      onPress={cargando ? undefined : onPress}
      deshabilitado={deshabilitado}
      etiqueta={titulo}
      vibrar
      caja={caja}
      style={{
        height: alto,
        paddingHorizontal: chico ? MEDIDA.espacio.l : MEDIDA.espacio.xl,
        borderRadius: MEDIDA.radio.redondo,
        backgroundColor: lleno ? p.acento : 'transparent',
        borderWidth: variante === 'contorno' ? 1 : 0,
        borderColor: p.borde,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
      }}
    >
      {cargando ? (
        <ActivityIndicator color={color} />
      ) : (
        <>
          {icono ? (
            <View style={{ marginRight: MEDIDA.espacio.s }}>
              <Icono nombre={icono} tam={chico ? 16 : 20} color={color} grosor={2} />
            </View>
          ) : null}
          <Text style={{ color, fontSize: chico ? MEDIDA.letra.chica + 1 : MEDIDA.letra.cuerpo + 1, fontWeight: '700' }} numberOfLines={1}>
            {titulo}
          </Text>
        </>
      )}
    </Tocable>
  );
}
