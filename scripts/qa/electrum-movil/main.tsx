import { createRoot } from 'react-dom/client';
import { EntrarScreen } from '@movil/src/electrum/EntrarScreen';
import { CampoScreen } from '@movil/src/electrum/CampoScreen';
import ElectrumApp from '@movil/src/electrum/ElectrumApp';

const cual = new URLSearchParams(location.search).get('p') || 'arranque';
const Pantalla = cual === 'entrar' ? <EntrarScreen onDentro={() => {}} /> : cual === 'campo' ? <CampoScreen onSalir={() => {}} /> : <ElectrumApp />;
// react-native-web traduce `flex:1` a CSS flex, y para crecer necesita un padre que también lo
// sea. El #root de esta página es un div normal, así que sin este envoltorio la pantalla se
// encoge al tamaño de su contenido y deja media hoja en blanco. Es del banco de pruebas, no de
// la app: en el teléfono la raíz de React Native ya es un contenedor flex.
createRoot(document.getElementById('root')!).render(
  <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>{Pantalla}</div>
);
