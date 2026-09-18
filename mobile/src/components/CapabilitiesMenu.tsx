import { Modal, View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';

const CAPABILITIES = [
  {
    title: 'Conversación continua',
    detail: 'Sin palabra clave: habla y te respondo. El botón Mic solo silencia.',
  },
  {
    title: 'Tócame',
    detail: 'Un toque: reacción. Muchos toques: me enojo… y disparo de broma. Mantén pulsado: cariño.',
  },
  {
    title: 'Mirada con cámara',
    detail: 'Los ojos te siguen e identifican objetos (lápiz, teléfono, persona…).',
  },
  {
    title: 'Quiero conocerte',
    detail: '10 preguntas iniciales. No se repiten cuando ya contestaste.',
  },
  {
    title: 'Gestos de humor',
    detail: '«ponte feliz», «canta», «enójate», «guiño», «bosteza»…',
  },
  {
    title: 'Modos',
    detail: 'Guardian, Explorer, Creative, Conocer, Strategic…',
  },
  {
    title: 'Memoria local',
    detail: 'Recuerda hechos tuyos en el teléfono + servidor cuando hay red.',
  },
  {
    title: 'Chat con cerebro',
    detail: 'Preguntas libres → Qwen. Sin red usa respuestas locales.',
  },
  {
    title: 'Sleep / Stay / Explore',
    detail: 'Presencia del escritorio. En Sleep despierta al hablarle o tocarlo.',
  },
];

type Props = {
  visible: boolean;
  onClose: () => void;
  onStartConocer: () => void;
  onEnableVision: () => void;
};

export function CapabilitiesMenu({ visible, onClose, onStartConocer, onEnableVision }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Qué puede hacer ULTRON</Text>
          <Text style={styles.sub}>Explora capacidades del escritorio nativo</Text>
          <ScrollView style={{ maxHeight: 280 }} contentContainerStyle={{ gap: 10 }}>
            {CAPABILITIES.map((c) => (
              <View key={c.title} style={styles.card}>
                <Text style={styles.cardTitle}>{c.title}</Text>
                <Text style={styles.cardDetail}>{c.detail}</Text>
              </View>
            ))}
          </ScrollView>
          <View style={styles.actions}>
            <Pressable
              style={styles.primary}
              onPress={() => {
                onStartConocer();
                onClose();
              }}
            >
              <Text style={styles.primaryText}>Quiero conocerte</Text>
            </Pressable>
            <Pressable
              style={styles.secondary}
              onPress={() => {
                onEnableVision();
                onClose();
              }}
            >
              <Text style={styles.secondaryText}>Activar visión</Text>
            </Pressable>
            <Pressable style={styles.ghost} onPress={onClose}>
              <Text style={styles.ghostText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  sheet: {
    width: '100%',
    maxWidth: 520,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(0,229,255,0.28)',
    backgroundColor: 'rgba(8,12,18,0.98)',
    padding: 18,
    gap: 10,
  },
  title: { color: '#E8FBFF', fontSize: 20, fontWeight: '800', letterSpacing: 1 },
  sub: { color: '#7A8B9C', fontSize: 12, marginBottom: 4 },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    padding: 12,
  },
  cardTitle: { color: '#00E5FF', fontWeight: '700', marginBottom: 4 },
  cardDetail: { color: '#C8D4DE', fontSize: 13, lineHeight: 18 },
  actions: { gap: 8, marginTop: 8 },
  primary: {
    backgroundColor: '#00E5FF',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryText: { color: '#001018', fontWeight: '800' },
  secondary: {
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,229,255,0.35)',
  },
  secondaryText: { color: '#00E5FF', fontWeight: '700' },
  ghost: { paddingVertical: 8, alignItems: 'center' },
  ghostText: { color: '#8B9AAB' },
});
