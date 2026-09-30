/**
 * «AURA TE LLAMA»: lo que se ve cuando suena la llamada de un recordatorio («llámame a las 5 para
 * recordarme…») con la app abierta, o cuando Android abrió la app a pantalla completa con el teléfono
 * bloqueado. Dos botones, como una llamada: Contestar (se abre la conversación y AURA te lo dice) y
 * Rechazar (no vuelve a llamar; el recordatorio queda escrito en el aviso).
 *
 * El estado vive en recordatorios.ts (`llamadaSonando`); los botones hacen lo mismo que los del aviso
 * (recordatoriosNativo.ts). Se dibuja encima de todo, desde VozProvider.
 */
import { useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { tr } from '../i18n';
import { useTema } from '../nucleo/tema';
import { escucharSonando, llamadaSonando } from './recordatorios';
import { contestar, rechazar } from './recordatoriosNativo';

export function LlamadaAura() {
  const p = useTema();
  const l = useSyncExternalStore(escucharSonando, llamadaSonando, llamadaSonando);
  if (!l) return null;
  return (
    <View style={[s.velo, { backgroundColor: p.velo }]} accessibilityViewIsModal>
      <View style={[s.tarjeta, { backgroundColor: p.superficie, borderColor: p.borde }]}>
        <Text style={[s.quien, { color: p.acentoTexto }]}>AURA</Text>
        <Text style={[s.titulo, { color: p.texto }]}>{tr('te está llamando', 'is calling you')}</Text>
        <Text style={[s.texto, { color: p.texto2 }]} numberOfLines={3}>
          {tr(`Para recordarte: ${l.texto}`, `To remind you: ${l.texto}`)}
        </Text>
        <View style={s.botones}>
          <Pressable
            onPress={() => void rechazar(l)}
            style={[s.boton, { backgroundColor: p.avisoFondo }]}
            accessibilityRole="button"
            accessibilityLabel={tr('Rechazar la llamada de AURA', 'Decline AURA’s call')}
          >
            <Text style={[s.botonTxt, { color: p.aviso }]}>{tr('Rechazar', 'Decline')}</Text>
          </Pressable>
          <Pressable
            onPress={() => void contestar(l)}
            style={[s.boton, { backgroundColor: p.exitoFondo }]}
            accessibilityRole="button"
            accessibilityLabel={tr('Contestar la llamada de AURA', 'Answer AURA’s call')}
          >
            <Text style={[s.botonTxt, { color: p.exito }]}>{tr('Contestar', 'Answer')}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  velo: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 1000, elevation: 1000 },
  tarjeta: { width: '100%', maxWidth: 380, borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, padding: 24, alignItems: 'center' },
  quien: { fontSize: 30, fontWeight: '800', letterSpacing: 2 },
  titulo: { fontSize: 18, fontWeight: '600', marginTop: 4 },
  texto: { fontSize: 16, textAlign: 'center', marginTop: 14 },
  botones: { flexDirection: 'row', gap: 14, marginTop: 24, alignSelf: 'stretch' },
  boton: { flex: 1, borderRadius: 999, paddingVertical: 14, alignItems: 'center' },
  botonTxt: { fontSize: 17, fontWeight: '700' },
});
