/**
 * El idioma: Español o English. Al tocarlo cambia TODA la app al instante (esta pantalla incluida), la voz
 * de los avatares y sus respuestas; con sesión queda en el perfil (AppAura: alElegirIdioma). También se
 * puede decir («inglés», «Spanish»).
 */
import { View } from 'react-native';
import { tr, useIdioma, type Idioma } from '../../i18n';
import { MEDIDA } from '../../nucleo/tema';
import { Aparecer, elegirIdioma } from '../../ui';
import { ResponderHablando } from '../../bienvenida/ResponderHablando';
import { EncabezadoPaso } from '../piezas';
import { PALABRAS_IDIOMA, opcionDeDictado } from '../flujo';
import { OpcionUnica } from './OpcionUnica';
import type { PropsPaso } from './tipos';

export function PasoIdioma(_: PropsPaso) {
  const idioma = useIdioma();
  const elegir = (i: Idioma) => void elegirIdioma(i);
  return (
    <View style={{ gap: MEDIDA.espacio.xl }}>
      <EncabezadoPaso etiqueta={tr('Idioma', 'Language')} titulo={tr('¿En qué idioma hablamos?', 'Which language shall we speak?')} texto={tr('Cambia la app, la voz y mis respuestas. Lo cambias cuando quieras en Ajustes.', 'It changes the app, the voice and my answers. Change it anytime in Settings.')} />
      <Aparecer retraso={140}>
        <OpcionUnica<Idioma>
          opciones={[
            { id: 'es', titulo: 'Español', detalle: 'Te hablo en español' },
            { id: 'en', titulo: 'English', detalle: 'I’ll talk to you in English' },
          ]}
          valor={idioma}
          onElegir={elegir}
        />
      </Aparecer>
      <Aparecer retraso={200}>
        <ResponderHablando
          pistas={['español', 'inglés', 'English', 'Spanish']}
          onDicho={(t) => {
            const i = opcionDeDictado(t, PALABRAS_IDIOMA);
            if (i) elegir(i);
          }}
        />
      </Aparecer>
    </View>
  );
}
