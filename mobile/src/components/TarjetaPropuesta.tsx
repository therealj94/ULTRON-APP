/**
 * LA TARJETA DE PROPUESTA DE LA MESA: lo que AURA propone por su cuenta (compa/iniciativa.ts), arriba, sin
 * tapar al avatar ni la barra. José (2-oct): «que no tenga yo que decirle qué hacer, que me proponga».
 *
 *   ┌───────────────────────────────────────────┐
 *   │ ✦ AURA · PARA TU MISIÓN                 ✕ │
 *   │ ¿Cómo vas con «Vender el carro»? Lo …     │
 *   │ [ Sí, hazlo ]   [ Luego ]   No            │
 *   └───────────────────────────────────────────┘
 *
 * Entra deslizándose y fundiéndose (Animated de React Native, sin depender de nada nuevo). «✕» es lo mismo
 * que «Luego». No suena: la mesa decide si vibra al llegar (no lo hace en una conversación de voz).
 * La mesa es un escenario oscuro en los dos temas: los colores son los de la mesa (tema.ts) con el acento
 * del avatar.
 */
import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { T, SOMBRA } from '../tema';
import { tr } from '../i18n';
import type { TemaAvatar } from '../avatares/catalogo';
import { etiquetaClase, textoBoton, type PropuestaAura, type RespuestaBoton } from '../compa/iniciativa';

type Props = {
  propuesta: PropuestaAura;
  nombreAvatar: string;
  tema: TemaAvatar;
  idioma: 'es' | 'en';
  onResponder: (r: RespuestaBoton) => void;
  /** Distancia desde arriba (debajo del aviso de su computadora si está). */
  arriba: number;
};

export function TarjetaPropuesta({ propuesta, nombreAvatar, tema, idioma, onResponder, arriba }: Props) {
  const entrada = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    entrada.setValue(0);
    Animated.spring(entrada, { toValue: 1, damping: 18, stiffness: 160, mass: 1, useNativeDriver: true }).start();
  }, [propuesta.id, entrada]);

  return (
    <Animated.View
      style={[
        s.envoltura,
        { top: arriba, opacity: entrada, transform: [{ translateY: entrada.interpolate({ inputRange: [0, 1], outputRange: [-18, 0] }) }] },
      ]}
      pointerEvents="box-none"
    >
      <View style={[s.tarjeta, { borderColor: tema.acento }]} accessibilityLiveRegion="polite">
        <View style={s.cabeza}>
          <Text style={[s.etiqueta, { color: tema.acentoTexto }]} numberOfLines={1}>
            ✦ {nombreAvatar.toUpperCase()} · {etiquetaClase(propuesta.clase, idioma).toUpperCase()}
          </Text>
          <Pressable onPress={() => onResponder('luego')} hitSlop={12} style={s.cerrar} accessibilityRole="button" accessibilityLabel={tr('Cerrar: luego', 'Close: later')}>
            <Text style={s.cerrarTexto}>✕</Text>
          </Pressable>
        </View>
        <Text style={s.texto}>{propuesta.texto}</Text>
        <View style={s.botones}>
          <Pressable
            onPress={() => onResponder('si')}
            style={({ pressed }) => [s.boton, { backgroundColor: tema.acento }, pressed && s.hundido]}
            accessibilityRole="button"
            accessibilityLabel={textoBoton('si', idioma)}
          >
            <Text style={[s.botonTexto, { color: tema.sobreAcento }]}>{textoBoton('si', idioma)}</Text>
          </Pressable>
          <Pressable
            onPress={() => onResponder('luego')}
            style={({ pressed }) => [s.boton, s.contorno, { borderColor: tema.acento }, pressed && s.hundido]}
            accessibilityRole="button"
            accessibilityLabel={textoBoton('luego', idioma)}
          >
            <Text style={[s.botonTexto, { color: tema.acentoTexto }]}>{textoBoton('luego', idioma)}</Text>
          </Pressable>
          <Pressable onPress={() => onResponder('no')} style={({ pressed }) => [s.botonNo, pressed && s.hundido]} accessibilityRole="button" accessibilityLabel={textoBoton('no', idioma)}>
            <Text style={s.botonNoTexto}>{textoBoton('no', idioma)}</Text>
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  envoltura: { position: 'absolute', left: 16, right: 16, alignItems: 'center', zIndex: 45, elevation: 9 },
  tarjeta: {
    width: '100%',
    maxWidth: 520,
    borderRadius: 22,
    borderWidth: 1.5,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
    gap: 8,
    backgroundColor: 'rgba(18,19,22,0.94)',
    ...SOMBRA,
  },
  cabeza: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  etiqueta: { flex: 1, fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  cerrar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: T.panel },
  cerrarTexto: { color: T.texto2, fontSize: 12 },
  texto: { color: '#F2EEE8', fontSize: 15.5, lineHeight: 22, fontWeight: '500' },
  botones: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap' },
  // minHeight 44: el mínimo cómodo para un dedo.
  boton: { minHeight: 44, paddingHorizontal: 18, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  contorno: { borderWidth: 1.5, backgroundColor: 'transparent' },
  botonTexto: { fontSize: 14.5, fontWeight: '800' },
  botonNo: { minHeight: 44, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  botonNoTexto: { color: T.texto2, fontSize: 14.5, fontWeight: '700' },
  hundido: { opacity: 0.8, transform: [{ scale: 0.97 }] },
});
