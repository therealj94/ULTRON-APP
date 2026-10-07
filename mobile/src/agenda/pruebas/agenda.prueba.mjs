/**
 * Pruebas en Node del calendario en el teléfono (sin teléfono): lo que dice cada fila de Ajustes → Calendario y la
 * vista «Hoy» (agenda/logica.ts), y que la app lo tenga a mano (Ajustes, «Más», la hoja global, el «abrir»).
 *
 *   cd mobile && npx tsx src/agenda/pruebas/agenda.prueba.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { accionDe, avisoAgenda, diasVisibles, resumenFila, sondeoMs, textoEstado, textoVacio } from '../logica.ts';
import { PANTALLAS_CEREBRO, esPantallaCerebro } from '../../compa/cerebro.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(AQUI, '../..');
const leer = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

let n = 0;
function prueba(nombre, f) {
  f();
  n++;
  console.log(`✓ ${nombre}`);
}

const ms = (o = {}) => ({ id: 'microsoft', nombre: 'Outlook / Microsoft 365', configurado: true, falta: [], conectado: false, reconectar: false, ...o });
const g = (o = {}) => ({ id: 'google', nombre: 'Google Calendar', configurado: false, falta: ['GOOGLE_WEB_CLIENT_ID', 'GOOGLE_WEB_CLIENT_SECRET'], conectado: false, reconectar: false, ...o });

prueba('estado honesto de cada proveedor', () => {
  assert.equal(textoEstado(ms({ conectado: true, cuenta: 'jose@outlook.test' })), 'Conectado · jose@outlook.test');
  assert.equal(textoEstado(ms({ reconectar: true })), 'El permiso venció o se quitó: hay que volver a conectarlo');
  assert.equal(textoEstado(g()), 'Falta configurar en el servidor (todavía no disponible)');
  assert.equal(textoEstado(ms()), 'Sin conectar');
  assert.equal(textoEstado(ms(), 'en'), 'Not connected');
});

prueba('qué botón lleva: sin configurar no promete nada', () => {
  assert.equal(accionDe(ms()), 'conectar');
  assert.equal(accionDe(ms({ reconectar: true })), 'reconectar');
  assert.equal(accionDe(ms({ conectado: true })), 'desconectar');
  assert.equal(accionDe(g()), null, 'falta configurar: sin botón');
});

prueba('la fila de Ajustes: «no pude leerlo» no es «sin conectar»', () => {
  assert.equal(resumenFila(null, true), '');
  assert.equal(resumenFila({ leidas: false, proveedores: [] }, false), 'No pude leerlo');
  assert.equal(resumenFila({ leidas: true, proveedores: [ms(), g()] }, false), 'Sin conectar');
  assert.equal(resumenFila({ leidas: true, proveedores: [ms({ configurado: false }), g()] }, false), 'No disponible');
  assert.equal(resumenFila({ leidas: true, proveedores: [ms({ conectado: true }), g()] }, false), 'Outlook');
  assert.equal(resumenFila({ leidas: true, proveedores: [ms({ conectado: true }), g({ configurado: true, conectado: true })] }, false), '2');
  assert.equal(resumenFila({ leidas: true, proveedores: [ms({ reconectar: true }), g()] }, false), 'Reconectar');
});

prueba('«Hoy»: sin calendario, con un calendario caído, vacío y la semana', () => {
  assert.match(avisoAgenda({ conectados: 0, dias: [], fallos: [] }), /Ajustes → Calendario/);
  assert.equal(avisoAgenda({ conectados: 1, dias: [], fallos: [] }), null);
  assert.match(avisoAgenda({ conectados: 2, dias: [], fallos: [{ proveedor: 'google', nombre: 'Google Calendar', siguiente: 'reconectar' }] }), /No pude leer Google Calendar \(reconéctalo en Ajustes\)/);
  const ev = { id: 'e', proveedor: 'microsoft', titulo: 'Reunión', inicio: 1, fin: 2, todoElDia: false, hora: '15:00–16:00' };
  const a = { conectados: 1, dias: [{ fecha: '2026-10-08', titulo: 'jueves 8 de octubre', eventos: [] }, { fecha: '2026-10-09', titulo: 'viernes 9 de octubre', eventos: [ev] }], fallos: [] };
  assert.equal(diasVisibles(a, 'hoy').length, 1, 'un día se muestra aunque esté vacío');
  assert.deepEqual(diasVisibles(a, 'semana').map((d) => d.fecha), ['2026-10-09'], 'la semana, solo los días con algo');
  assert.equal(textoVacio('hoy'), 'Hoy no tienes nada en el calendario.');
  assert.equal(sondeoMs(1), 3000);
  assert.equal(sondeoMs(5), 5000);
});

prueba('la app lo tiene a mano: Ajustes → Calendario, Más → Hoy, la hoja global y «abrir agenda»', () => {
  assert.ok(PANTALLAS_CEREBRO.includes('agenda') && esPantallaCerebro('agenda'));
  const ajustes = leer('ajustes/Ajustes.tsx');
  assert.match(ajustes, /<HojaCalendario visible=\{hoja === 'calendario'\}/);
  assert.match(ajustes, /onPress=\{\(\) => abrir\('calendario'\)\}/);
  const mas = leer('components/HojaMas.tsx');
  assert.match(mas, /id: 'agenda', icono: 'reloj', titulo: tr\('Hoy', 'Today'\)/);
  assert.match(leer('screens/DeskScreen.tsx'), /case 'agenda':\s*\n\s*return setHojaCerebro\('agenda'\);/);
  assert.match(leer('app/HojasCerebro.tsx'), /<HojaHoy visible=\{hojas\.abierta === 'agenda'\}/);
  assert.match(leer('app/hojas.ts'), /'agenda'/);
  // Solo JS (OTA): nada nativo nuevo; Google por el navegador con expo-web-browser (ya instalado).
  const api = leer('agenda/api.ts');
  assert.match(api, /from 'expo-web-browser'/);
  const pkg = JSON.parse(fs.readFileSync(path.join(SRC, '../package.json'), 'utf8'));
  assert.ok(pkg.dependencies['expo-web-browser'], 'expo-web-browser ya estaba');
});

console.log(`\n${n} pruebas del calendario en el teléfono: bien.`);
