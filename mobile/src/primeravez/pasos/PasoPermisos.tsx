/**
 * (g) Los permisos, justo cuando hacen falta (AUR11, documento maestro sección 14): solo los que pide lo que
 * la persona quiere resolver primero (los avisos para un recordatorio: flujo.ts permisosDelPlan), explicados,
 * con su botón ✔. Los demás se piden donde se usan (el micrófono en la mesa) y todos están en Ajustes.
 */
import { View } from 'react-native';
import { tr } from '../../i18n';
import { MEDIDA } from '../../nucleo/tema';
import { ListaPermisos } from '../ListaPermisos';
import { EncabezadoPaso } from '../piezas';
import { permisosDelPlan } from '../flujo';
import type { PropsPaso } from './tipos';

export function PasoPermisos({ borrador }: PropsPaso) {
  const solo = permisosDelPlan(borrador);
  return (
    <View style={{ gap: MEDIDA.espacio.xl }}>
      <EncabezadoPaso
        etiqueta={tr('Tu privacidad', 'Your privacy')}
        titulo={tr('Lo que hace falta para eso', 'What that needs')}
        texto={tr('Solo esto, para lo que me pediste, y tú decides. Lo demás te lo pido cuando haga falta; todo se cambia en Ajustes.', 'Just this, for what you asked, and you decide. Anything else I’ll ask when it’s needed; change it all in Settings.')}
      />
      <ListaPermisos solo={solo.length ? solo : undefined} conBotonTodo={false} />
    </View>
  );
}
