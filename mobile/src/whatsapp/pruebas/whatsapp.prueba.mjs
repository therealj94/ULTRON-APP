/**
 * Pruebas en Node de WhatsApp en la app (whatsapp/logica.ts): qué pantalla toca, cómo se dice cada
 * mensaje, cómo se agrupan las burbujas, lo que va saliendo y el «atrás» de un chat abierto.
 *
 *   cd mobile && npx tsx src/whatsapp/pruebas/whatsapp.prueba.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { duracionTexto, etiquetaMedia, filasWA, juntar, nombreChat, previa, sondeoWA, telefonoValido, textoBurbuja, totalNoLeidos, vistaDe } from '../logica.ts';
import { atrasWhatsapp, registrarAtras } from '../atras.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const pruebas = [];
const prueba = (n, f) => pruebas.push([n, f]);

prueba('qué pantalla toca: oculto para otra cuenta, vincular, listo', () => {
  assert.equal(vistaDe(null), 'revisando');
  assert.equal(vistaDe({ disponible: true, permitido: false, vinculado: false }), 'oculto', 'otra cuenta: ni la pestaña');
  assert.equal(vistaDe({ disponible: false, permitido: true, vinculado: false }), 'sin_puente');
  assert.equal(vistaDe({ disponible: true, permitido: true, vinculado: false }), 'vincular');
  assert.equal(vistaDe({ disponible: true, permitido: true, vinculado: true }), 'listo');
});

prueba('cada mensaje dicho como en WhatsApp', () => {
  assert.equal(duracionTexto(12), '0:12');
  assert.equal(duracionTexto(185), '3:05');
  assert.equal(duracionTexto(3723), '1:02:03');
  assert.equal(etiquetaMedia({ tipo: 'audio', duracion: 12 }), '🎤 Nota de voz (0:12)');
  assert.equal(etiquetaMedia({ tipo: 'imagen' }), '📷 Foto');
  assert.equal(etiquetaMedia({ tipo: 'documento', archivo: 'contrato.pdf' }), '📄 contrato.pdf');
  assert.equal(etiquetaMedia({ tipo: 'ubicacion', texto: 'Parque Central' }), '📍 Parque Central');
  assert.equal(etiquetaMedia({ tipo: 'texto', texto: 'hola' }), null);
  assert.equal(etiquetaMedia({ tipo: 'audio', duracion: 5 }, 'en'), '🎤 Voice note (0:05)');
  assert.equal(textoBurbuja({ tipo: 'imagen', texto: 'la casa' }), 'la casa', 'el pie de foto va en la burbuja');
  assert.equal(textoBurbuja({ tipo: 'ubicacion', texto: 'Parque' }), '', 'la ubicación ya va en la etiqueta');
  assert.equal(textoBurbuja({ tipo: 'texto', texto: 'x', eliminado: true }), '');
});

prueba('la lista: nombres, vista previa y sin leer', () => {
  assert.equal(nombreChat({ nombre: '', jid: '50499990000@s.whatsapp.net' }), '+50499990000');
  assert.equal(nombreChat({ nombre: 'Beto', jid: 'x' }), 'Beto');
  assert.equal(previa({ ultimoMio: true, grupo: false, ultimo: 'Sí llego' }), 'Tú: Sí llego');
  assert.equal(previa({ ultimoMio: false, grupo: true, ultimoDe: 'Mamá', ultimo: '📷 Foto' }), 'Mamá: 📷 Foto');
  assert.equal(previa({ ultimoMio: false, grupo: false, ultimo: 'hola' }), 'hola');
  assert.equal(totalNoLeidos([{ noLeidos: 2 }, { noLeidos: 0 }, { noLeidos: 1 }]), 2, 'cuenta chats, no mensajes');
});

prueba('las burbujas: un separador por día, pegadas las seguidas, nombre en grupos', () => {
  const d = new Date(2026, 9, 2, 9, 0).getTime();
  const ms = [
    { id: '1', de: 'b', mio: false, hora: d, tipo: 'texto', texto: 'hola' },
    { id: '2', de: 'b', mio: false, hora: d + 60_000, tipo: 'texto', texto: '¿llegas?' },
    { id: '3', de: 'yo', mio: true, hora: d + 120_000, tipo: 'texto', texto: 'sí' },
    { id: '4', de: 'b', mio: false, hora: d + 20 * 60_000, tipo: 'texto', texto: 'ok' },
    { id: '5', de: 'b', mio: false, hora: d + 86_400_000, tipo: 'texto', texto: 'buen día' },
  ];
  const f = filasWA(ms, true);
  assert.deepEqual(f.map((x) => (x.tipo === 'dia' ? 'D' : `${x.m.id}${x.pegadaArriba ? 'p' : ''}${x.conNombre ? 'n' : ''}`)), ['D', '1n', '2p', '3', '4n', 'D', '5n']);
  assert.ok(filasWA(ms, false).every((x) => x.tipo === 'dia' || !x.conNombre), 'en un chat de dos, sin nombres');
});

prueba('lo que va saliendo: lo confirmado reemplaza al pendiente; lo que falló se queda', () => {
  const t = Date.now();
  const puente = [{ id: 'A', mio: true, texto: 'Sí llego', hora: t + 500 }];
  const locales = [
    { id: 'l1', mio: true, texto: 'Sí llego', hora: t, enviando: true },
    { id: 'l2', mio: true, texto: 'otro', hora: t + 1, enviando: true },
    { id: 'l3', mio: true, texto: 'Sí llego', hora: t + 2, fallo: 'No salió' },
  ];
  assert.deepEqual(juntar(puente, locales).map((m) => m.id), ['l2', 'l3', 'A'].sort((a, b) => ({ A: t + 500, l2: t + 1, l3: t + 2 })[a] - ({ A: t + 500, l2: t + 1, l3: t + 2 })[b]));
});

prueba('número para el código y cada cuánto pregunta', () => {
  assert.equal(telefonoValido('+504 9999-8888'), '50499998888');
  assert.equal(telefonoValido('9999-8888'), '99998888');
  assert.equal(telefonoValido('0504 9999 8888'), null, 'sin el 0 de salida');
  assert.equal(telefonoValido('123'), null);
  assert.ok(sondeoWA('listo', true) < sondeoWA('listo', false));
  assert.equal(sondeoWA('vincular', false), 3000, 'mientras vincula, el QR se renueva rápido');
});

prueba('«atrás» con un chat abierto lo cierra a él, no la ventana', () => {
  assert.equal(atrasWhatsapp(), false, 'sin chat abierto: la ventana se cierra como siempre');
  let cerrado = 0;
  const quitar = registrarAtras(() => (cerrado++, true));
  assert.equal(atrasWhatsapp(), true);
  assert.equal(cerrado, 1);
  quitar();
  assert.equal(atrasWhatsapp(), false);
});

prueba('las dos entradas de chats llevan la pestaña de WhatsApp; otra cuenta ve PULSE2CHAT igual que antes', () => {
  const leer = (r) => fs.readFileSync(path.join(AQUI, '..', '..', r), 'utf8');
  assert.match(leer('pulse/PulseChat.tsx'), /<ChatsConWhatsapp /);
  assert.match(leer('pulse/PulseChat.tsx'), /atrasWhatsapp\(\)/);
  assert.match(leer('app/pantallas/Chats.tsx'), /<ChatsConWhatsapp/);
  const envoltorio = leer('whatsapp/ChatsConWhatsapp.tsx');
  assert.match(envoltorio, /if \(!conWhatsapp\) return <PantallaChats onAbrir=\{onAbrir\} onAtras=\{onAtras\} \/>;/);
  assert.match(envoltorio, /pagingEnabled/, 'se cambia deslizando');
  assert.doesNotMatch(envoltorio, /\.catch\(\(\) => vivo && setEstado\(\{ disponible: false, permitido: false/, 'un fallo de red no esconde WhatsApp');
  assert.match(envoltorio, /setTimeout\(\(\) => preguntar\(intento \+ 1\)/, 'si falla la red, vuelve a preguntar');
  assert.match(envoltorio, /clearTimeout\(espera\)/, 'al salir no queda un reintento colgado');
  const pantalla = leer('whatsapp/PantallaWhatsapp.tsx');
  assert.match(pantalla, /Vincular con el número de teléfono/, 'el código sirve en el mismo teléfono');
  assert.match(pantalla, /API\.leidoWA/, 'abrir un chat lo marca leído');
});

let ok = 0;
for (const [n, f] of pruebas) {
  try {
    await f();
    ok++;
    console.log(`ok - ${n}`);
  } catch (e) {
    console.log(`FALLA - ${n}\n  ${e.message}`);
  }
}
console.log(`\n${ok}/${pruebas.length} pruebas de WhatsApp en la app`);
if (ok !== pruebas.length) process.exit(1);
