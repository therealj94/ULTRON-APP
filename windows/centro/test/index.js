// `node --test test/` (y `npm test`) en Node 22 toma la carpeta como UN módulo, su index.js: este
// archivo junta las pruebas para que ese comando las corra todas en un solo proceso.
import './candado.test.mjs';
import './llamada.test.mjs';
import './recorrido.test.mjs';
import './whatsapp.test.mjs';
