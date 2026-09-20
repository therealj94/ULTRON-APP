/** Entrada de Dr Electrum FP. La app vive en /electrum; ULTRON FP sigue en la raíz. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { fijarPerfilLocal } from '../src/perfil';
import '../src/index.css';
import 'maplibre-gl/dist/maplibre-gl.css';

// Ámbar de mineral desde el primer fotograma: la cara es de Electrum, no de Genesis.
fijarPerfilLocal({
  id: 'electrum',
  cerebro: 'Dr Electrum',
  plataforma: 'Dr Electrum FP',
  proposito: 'Estación de trabajo minera: catastro, expedientes y panel de especialistas.',
  acento: '#FFAE3B',
  demo: true,
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
