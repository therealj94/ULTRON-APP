/**
 * EL INDICADOR MÍNIMO (AUR08, sección 6): «Trabajando · 2» o «Necesito una decisión · 1», arriba (nunca
 * encima del teclado ni de la barra de escribir). No parpadea con cada sondeo (lib/trabajos.ts
 * `indicadorEstable`); el puntito respira solo mientras algo trabaja y nadie espera una decisión, y con
 * «reducir movimiento» queda quieto. Sin nada activo no se muestra. Al tocarlo se abre el panel de tareas.
 */
import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { tr } from '../i18n';
import { useTema } from '../nucleo/tema';
import { movimientoIndicador } from '../lib/trabajos';

type Props = {
  texto: string | null;
  resumen: { trabajando: number; decisiones: number };
  reducido: boolean;
  onAbrir: () => void;
  style?: StyleProp<ViewStyle>;
};

export function IndicadorTrabajos({ texto, resumen, reducido, onAbrir, style }: Props) {
  const tema = useTema();
  const pulso = useRef(new Animated.Value(1)).current;
  const mover = movimientoIndicador(resumen, reducido);
  useEffect(() => {
    if (!mover) {
      pulso.stopAnimation();
      pulso.setValue(1);
      return;
    }
    const bucle = Animated.loop(
      Animated.sequence([
        Animated.timing(pulso, { toValue: 0.35, duration: 900, useNativeDriver: true }),
        Animated.timing(pulso, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    );
    bucle.start();
    return () => bucle.stop();
  }, [mover, pulso]);
  if (!texto) return null;
  const decision = resumen.decisiones > 0;
  return (
    <Pressable
      onPress={onAbrir}
      accessibilityRole="button"
      accessibilityLabel={`${texto}. ${tr('Abrir el panel de tareas', 'Open the task panel')}`}
      hitSlop={8}
      style={[s.caja, { backgroundColor: decision ? tema.acentoFondo : tema.superficie2, borderColor: decision ? tema.acento : tema.borde }, style]}
    >
      <Animated.View style={[s.punto, { backgroundColor: decision ? tema.acento : tema.exito, opacity: pulso }]} />
      <Text style={[s.texto, { color: decision ? tema.acentoTexto : tema.texto }]} numberOfLines={1}>
        {texto}
      </Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  caja: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, minHeight: 40, borderRadius: 999, borderWidth: 1, maxWidth: 260 },
  punto: { width: 8, height: 8, borderRadius: 4 },
  texto: { fontSize: 13, fontWeight: '700', flexShrink: 1 },
});
