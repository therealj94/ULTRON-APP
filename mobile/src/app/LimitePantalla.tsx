/**
 * La red de seguridad de cada pantalla (como el Limite de cara/CaraSegura.tsx, pero para la ruta
 * entera). Antes un error al dibujar cualquier pantalla tumbaba la app completa: ahora esa pantalla
 * enseña «Algo falló aquí» con «Reintentar» (y «Volver» si hay adónde), y lo demás sigue vivo (el chat,
 * la voz, una llamada en curso viven un piso más arriba, en AppAura).
 *
 * Lo que se rompió se deja en las migas y se manda como error no fatal (lib/reporte.ts).
 * El aviso usa solo piezas básicas de React Native: si la pantalla cayó por un componente de la ui,
 * el aviso no puede depender de él.
 */
import { Component, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { tr } from '../i18n';
import { useTema } from '../nucleo/tema';
import { reportarErrorPantalla } from '../lib/reporte';

type Props = { pantalla: string; puedeVolver?: () => boolean; onVolver?: () => void; children: ReactNode };

export class LimitePantalla extends Component<Props, { roto: boolean }> {
  state = { roto: false };
  static getDerivedStateFromError() {
    return { roto: true };
  }
  componentDidCatch(e: unknown) {
    reportarErrorPantalla(this.props.pantalla, e);
  }
  render() {
    if (!this.state.roto) return this.props.children;
    const volver = this.props.onVolver && this.props.puedeVolver?.() ? this.props.onVolver : undefined;
    return <AvisoRoto onReintentar={() => this.setState({ roto: false })} onVolver={volver} />;
  }
}

function AvisoRoto({ onReintentar, onVolver }: { onReintentar: () => void; onVolver?: () => void }) {
  const t = useTema();
  return (
    <View style={[s.raiz, { backgroundColor: t.fondo }]} accessibilityRole="alert">
      <Text style={[s.titulo, { color: t.texto }]}>{tr('Algo falló en esta pantalla', 'Something went wrong on this screen')}</Text>
      <Text style={[s.detalle, { color: t.texto2 }]}>
        {tr('Lo demás de la app sigue funcionando. Prueba otra vez; si se repite, cierra la app y vuelve a abrirla.', 'The rest of the app is still working. Try again; if it keeps happening, close the app and open it again.')}
      </Text>
      <Pressable onPress={onReintentar} accessibilityRole="button" style={[s.boton, { backgroundColor: t.acento }]}>
        <Text style={[s.botonTexto, { color: t.sobreAcento }]}>{tr('Reintentar', 'Try again')}</Text>
      </Pressable>
      {onVolver ? (
        <Pressable onPress={onVolver} accessibilityRole="button" style={s.botonFantasma}>
          <Text style={[s.botonTexto, { color: t.acentoTexto }]}>{tr('Volver', 'Go back')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  raiz: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 },
  titulo: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  detalle: { fontSize: 15, lineHeight: 21, textAlign: 'center', marginBottom: 8 },
  boton: { minWidth: 180, paddingVertical: 14, paddingHorizontal: 24, borderRadius: 14, alignItems: 'center' },
  botonFantasma: { minWidth: 180, paddingVertical: 12, paddingHorizontal: 24, alignItems: 'center' },
  botonTexto: { fontSize: 16, fontWeight: '700' },
});
