/**
 * UNA SUGERENCIA A LA VEZ, y solo cuando hay calma (José, 3-oct: «que aparezcan recomendaciones pero no
 * tengamos montón de botones»). En lugar de la fila de atajos fija, encima de la barra aparece una sola
 * píldora con algo del oficio del avatar («Mi día», «¿Qué ves?»…). Se va cuando alguien habla, piensa o
 * hay una frase a medias, y vuelve a los pocos segundos de silencio con la siguiente. Tocarla es lo mismo
 * que decirlo. Con «reducir movimiento» no se anima: solo aparece y desaparece.
 */
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text } from 'react-native';
import { de } from '../i18n';
import type { Accion, TemaAvatar } from '../avatares/catalogo';

/** Silencio que espera antes de sugerir: no se mete en la conversación. */
export const SUGERIR_TRAS_MS = 4_000;
/** Cada cuánto cambia de sugerencia mientras sigue la calma. */
export const CAMBIAR_CADA_MS = 12_000;

type Props = {
  acciones: readonly Accion[];
  tema: TemaAvatar;
  /** Hay calma: nadie habla, no piensa, no hay frase a medias ni hoja abierta. */
  calma: boolean;
  onAccion: (pedido: string) => void;
};

export function SugerenciaMesa({ acciones, tema, calma, onAccion }: Props) {
  const [i, setI] = useState(0);
  const [visible, setVisible] = useState(false);
  const op = useRef(new Animated.Value(0)).current;
  const quieto = useRef(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((q) => (quieto.current = q))
      .catch(() => undefined);
  }, []);

  // Aparece tras unos segundos de calma y va cambiando; se esconde en cuanto se acaba la calma.
  useEffect(() => {
    if (!calma || !acciones.length) {
      setVisible(false);
      return;
    }
    const t = setTimeout(() => setVisible(true), SUGERIR_TRAS_MS);
    const c = setInterval(() => setI((n) => n + 1), CAMBIAR_CADA_MS);
    return () => {
      clearTimeout(t);
      clearInterval(c);
    };
  }, [calma, acciones.length]);

  useEffect(() => {
    if (quieto.current) return op.setValue(visible ? 1 : 0);
    Animated.timing(op, { toValue: visible ? 1 : 0, duration: visible ? 420 : 160, useNativeDriver: true }).start();
  }, [visible, i, op]);

  if (!acciones.length) return null;
  const a = acciones[i % acciones.length];
  return (
    <Animated.View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={[s.caja, { opacity: op, transform: [{ translateY: op.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }]}
    >
      <Pressable
        onPress={() => {
          setVisible(false);
          setI((n) => n + 1);
          onAccion(de(a.pedido));
        }}
        android_ripple={{ color: tema.acentoFondo }}
        style={({ pressed }) => [s.pildora, { borderColor: tema.acento, backgroundColor: pressed ? tema.acentoFondo : 'rgba(14,15,17,0.72)' }]}
        accessibilityRole="button"
        accessibilityLabel={de(a.etiqueta)}
        accessibilityHint={de({ es: 'Sugerencia: tocar es como decirlo', en: 'Suggestion: tapping is like saying it' })}
      >
        <Text style={[s.chispa, { color: tema.acento }]}>✦</Text>
        <Text style={[s.texto, { color: tema.acentoTexto }]} numberOfLines={1}>
          {de(a.etiqueta)}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  caja: { alignItems: 'center' },
  pildora: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, borderRadius: 24, borderWidth: 1, paddingHorizontal: 18, overflow: 'hidden', maxWidth: '92%' },
  chispa: { fontSize: 14 },
  texto: { fontSize: 15, fontWeight: '700' },
});
