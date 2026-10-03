/**
 * El retrato chico de cada avatar, para la entrada, la bienvenida y el menú.
 *
 *  · Guardián: dos anillos celestes con su pupila, sobre negro (como su cara en la mesa).
 *  · AU-RA: su orbe de partículas, el de la mesa (José, 3-oct: «la imagen debe cambiar de Aura con la
 *    que es»). Es una foto del orbe real (src/14-orbe/orbe.html) sacada en Chromium.
 *  · Claudio y ANT-ONIO: su foto (la de ANT-ONIO sale de su modelo 3D).
 */
import { Image, StyleSheet, View } from 'react-native';
import { avatarPorId, type AvatarId } from './catalogo';
import { fotosRetrato } from './ClaudioRetrato';

function Ojos({ color, fondo, lado }: { color: string; fondo: string; lado: number }) {
  const ojo = Math.round(lado * 0.3);
  const borde = Math.max(2, Math.round(ojo * 0.12));
  const pupila = Math.round(ojo * 0.3);
  return (
    <View style={[s.caja, { backgroundColor: fondo }]}>
      <View style={[s.fila, { gap: Math.round(lado * 0.1) }]}>
        {[0, 1].map((i) => (
          <View key={i} style={{ width: ojo, height: ojo, borderRadius: ojo / 2, borderWidth: borde, borderColor: color, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: pupila, height: pupila, borderRadius: pupila / 2, backgroundColor: color }} />
          </View>
        ))}
      </View>
    </View>
  );
}

const ORBE_AURA = require('../../assets/avatares/aura/orbe.webp');

export function MiniAvatar({ id, lado }: { id: AvatarId; lado: number }) {
  const a = avatarPorId(id);
  if (id === 'aura') {
    return (
      <View style={[s.caja, { backgroundColor: '#05070C' }]}>
        <Image source={ORBE_AURA} resizeMode="contain" style={s.img} accessibilityIgnoresInvertColors />
      </View>
    );
  }
  const fotos = fotosRetrato(id);
  if (fotos) {
    return (
      <View style={[s.caja, { backgroundColor: a.tema.fondo }]}>
        <Image source={fotos.base} resizeMode="contain" style={s.img} />
      </View>
    );
  }
  return <Ojos color={a.tema.acento} fondo={a.tema.fondo} lado={lado} />;
}

const s = StyleSheet.create({
  caja: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center' },
  fila: { flexDirection: 'row', alignItems: 'center' },
  img: { width: '100%', height: '100%' },
});
