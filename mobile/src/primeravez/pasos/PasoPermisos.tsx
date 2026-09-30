/**
 * (g) Los permisos: todos los que usa la app, explicados, con su botón ✔ y «Permitir todo».
 */
import { View } from 'react-native';
import { tr } from '../../i18n';
import { MEDIDA } from '../../nucleo/tema';
import { ListaPermisos } from '../ListaPermisos';
import { EncabezadoPaso } from '../piezas';
import type { PropsPaso } from './tipos';

export function PasoPermisos(_: PropsPaso) {
  return (
    <View style={{ gap: MEDIDA.espacio.xl }}>
      <EncabezadoPaso etiqueta={tr('Tu privacidad', 'Your privacy')} titulo={tr('Lo que AURA necesita', 'What AURA needs')} texto={tr('Solo lo que usa, y tú decides. Lo cambias cuando quieras en Ajustes.', 'Only what she uses, and you decide. Change it anytime in Settings.')} />
      <ListaPermisos />
    </View>
  );
}
