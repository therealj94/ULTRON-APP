/** Entrada de Dr Electrum FP. Es la raíz de su propio despliegue: ver lib/plataforma.ts. */
import { recogerLlaveDelEnlace } from './acceso';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { fijarPerfilLocal } from '../src/perfil';
import '../src/index.css';
import 'maplibre-gl/dist/maplibre-gl.css';
// Después de la hoja de MapLibre a propósito: la nuestra la sobrescribe, y el orden lo decide el
// orden de estos imports. Es la misma lección que nos costó el mapa negro: quien carga último manda.
import './mapa/mapa.css';

// Ámbar de mineral desde el primer fotograma: la cara es de Electrum, no de Genesis.
fijarPerfilLocal({
  id: 'electrum',
  cerebro: 'Dr Electrum',
  plataforma: 'Dr Electrum FP',
  proposito: 'Estación de trabajo minera: catastro, expedientes y panel de especialistas.',
  acento: '#FFAE3B',
  demo: true,
});

recogerLlaveDelEnlace();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
