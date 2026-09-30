/**
 * (d) El tema: Oscuro, Claro o Sistema. Cada opción es un teléfono en miniatura pintado con esa
 * paleta (el de Sistema, mitad y mitad). Al tocarla, TODA la app cambia al instante —esta misma
 * pantalla incluida—: la vista previa es la app de verdad.
 */
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { tr } from '../../i18n';
import type { Tema } from '../../nucleo/contrato';
import { CLARO, MEDIDA, OSCURO, fijarTema, useTema, type Paleta } from '../../nucleo/tema';
import { Aparecer, Icono, Palomita, Texto, oroDe, vibrar, type NombreIcono } from '../../ui';
import { LinearGradient } from 'expo-linear-gradient';
import { EncabezadoPaso } from '../piezas';
import type { PropsPaso } from './tipos';

function Pantallita({ p }: { p: Paleta }) {
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: p.fondo, padding: 10, gap: 7 }]}>
      <View style={{ height: 7, width: '55%', borderRadius: 4, backgroundColor: p.texto, opacity: 0.85 }} />
      <View style={{ height: 5, width: '80%', borderRadius: 3, backgroundColor: p.texto3 }} />
      <View style={{ flex: 1, borderRadius: 10, backgroundColor: p.superficie, borderWidth: 1, borderColor: p.borde, padding: 7, gap: 5 }}>
        <View style={{ height: 5, width: '70%', borderRadius: 3, backgroundColor: p.texto2 }} />
        <View style={{ height: 5, width: '45%', borderRadius: 3, backgroundColor: p.texto3 }} />
        <View style={{ alignSelf: 'flex-end', height: 14, width: '55%', borderRadius: 7, backgroundColor: p.burbujaMia, marginTop: 'auto' }} />
      </View>
      <View style={{ height: 16, borderRadius: 8, overflow: 'hidden' }}>
        <LinearGradient colors={oroDe(p.oscuro)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      </View>
    </View>
  );
}

function Opcion({ id, icono, titulo, activo, onPress }: { id: Tema; icono: NombreIcono; titulo: string; activo: boolean; onPress: () => void }) {
  const tema = useTema();
  const e = useSharedValue(1);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: e.value }] }));
  return (
    <Animated.View style={[{ flex: 1 }, a]}>
      <Pressable
        onPress={onPress}
        onPressIn={() => {
          e.value = withSpring(0.95, MEDIDA.resorte.vivo);
        }}
        onPressOut={() => {
          e.value = withSpring(1, MEDIDA.resorte.vivo);
        }}
        style={{ alignItems: 'center', gap: 10 }}
        accessibilityRole="radio"
        accessibilityState={{ selected: activo }}
        accessibilityLabel={titulo}
      >
        <View style={[s.telefono, { borderColor: activo ? tema.acento : tema.borde, borderWidth: activo ? 2.5 : 1.5 }]}>
          {id === 'sistema' ? (
            <>
              <Pantallita p={OSCURO} />
              <View style={[StyleSheet.absoluteFill, { left: '50%', overflow: 'hidden' }]}>
                <View style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: '200%' }}>
                  <Pantallita p={CLARO} />
                </View>
              </View>
            </>
          ) : (
            <Pantallita p={id === 'claro' ? CLARO : OSCURO} />
          )}
          <View style={s.marca}>
            <Palomita hecho={activo} tam={24} vibra={false} />
          </View>
        </View>
        <View style={s.etiqueta}>
          <Icono nombre={icono} tam={16} color={activo ? tema.acentoTexto : tema.texto3} />
          <Texto v="cuerpoFuerte" color={activo ? 'texto' : 'texto2'}>
            {titulo}
          </Texto>
        </View>
      </Pressable>
    </Animated.View>
  );
}

export function PasoTema({ borrador, cambiar }: PropsPaso) {
  const elegir = (t: Tema) => {
    if (t === borrador.tema) return;
    vibrar('medio');
    fijarTema(t);
    cambiar({ tema: t });
  };
  return (
    <View style={{ gap: MEDIDA.espacio.xxl }}>
      <EncabezadoPaso etiqueta={tr('Apariencia', 'Appearance')} titulo={tr('¿De día o de noche?', 'Day or night?')} texto={tr('Elige cómo se ve tu app. «Sistema» sigue al teléfono.', 'Choose how your app looks. “System” follows your phone.')} />
      <Aparecer retraso={140}>
        <View style={s.fila} accessibilityRole="radiogroup">
          <Opcion id="oscuro" icono="luna" titulo={tr('Oscuro', 'Dark')} activo={borrador.tema === 'oscuro'} onPress={() => elegir('oscuro')} />
          <Opcion id="claro" icono="sol" titulo={tr('Claro', 'Light')} activo={borrador.tema === 'claro'} onPress={() => elegir('claro')} />
          <Opcion id="sistema" icono="telefono" titulo={tr('Sistema', 'System')} activo={borrador.tema === 'sistema'} onPress={() => elegir('sistema')} />
        </View>
      </Aparecer>
      <Aparecer retraso={220}>
        <Texto v="chica" color="texto3" centro>
          {tr('La mesa de los avatares es un escenario y siempre se ve de noche.', 'The avatars’ desk is a stage and always looks like night.')}
        </Texto>
      </Aparecer>
    </View>
  );
}

const s = StyleSheet.create({
  fila: { flexDirection: 'row', gap: 12 },
  telefono: { width: '100%', aspectRatio: 0.56, maxWidth: 130, borderRadius: 18, overflow: 'hidden' },
  marca: { position: 'absolute', top: 8, right: 8 },
  etiqueta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
