/**
 * Estados honestos de PULSE2CHAT (auditoría visual del 7-oct, A2, A3, A10):
 *   · «Cifrado de punta a punta» solo donde es verdad: dentro de PULSE2CHAT, nunca encima de las pestañas que
 *     también llevan a WhatsApp y a los correos (que no lo son).
 *   · Sin red: la lista de la última vez (sin el texto de los mensajes) con el aviso, nunca «Agrega a alguien».
 *   · Un mensaje que no salió trae un botón «Reintentar» a la vista (y en WhatsApp también).
 *
 *   cd mobile && npx tsx src/pulse/pruebas/estados.prueba.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esDeLoGuardado, listaGuardadaDe, MAX_GUARDADAS, paraGuardarLista } from '../listaSinRed.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const leer = (r) => fs.readFileSync(path.join(AQUI, '..', '..', r), 'utf8');

let fallos = 0;
let n = 0;
function prueba(nombre, f) {
  n++;
  try {
    f();
    console.log('ok -', nombre);
  } catch (e) {
    fallos++;
    console.log('FALLA -', nombre, '\n ', String(e?.message || e));
  }
}

const conv = (correo, o = {}) => ({ correo, nombre: correo.split('@')[0], sinLeer: 0, ultimo: null, ...o });

prueba('lo guardado para verlo sin red NO lleva lo que dijo nadie (el chat es de punta a punta)', () => {
  const lista = [
    conv('ana@x.com', { sinLeer: 2, foto: 'f.jpg', ultimo: { id: 'm1', de: 'ana@x.com', para: 'yo@x.com', cuando: 50, texto: 'la clave del banco es 1234', e2e: true } }),
    conv('grupo@x.com', { esGrupo: true }),
  ];
  const g = paraGuardarLista('u1', lista, 7);
  assert.equal(g.conversaciones.length, 1, 'los grupos no (se ven en la app Orden Global)');
  const c = g.conversaciones[0];
  assert.equal(c.ultimo.texto, '', 'sin el texto del mensaje');
  assert.equal(c.ultimo.cuando, 50, 'sí la hora (para ordenar y decir «Ayer»)');
  assert.equal(c.sinLeer, 2);
  assert.equal(c.foto, 'f.jpg');
  assert.ok(!JSON.stringify(g).includes('1234'), 'nada descifrado va al teléfono');
  assert.ok(esDeLoGuardado(c.ultimo));
  assert.ok(!esDeLoGuardado(lista[0].ultimo));
});

prueba('es de UNA cuenta, y lo que no tiene forma no se lee', () => {
  const g = paraGuardarLista('u1', [conv('ana@x.com')]);
  assert.equal(paraGuardarLista('', [conv('a@x.com')]), null);
  assert.equal(paraGuardarLista('u1', null), null);
  assert.equal(listaGuardadaDe(JSON.parse(JSON.stringify(g)), 'u1').conversaciones[0].correo, 'ana@x.com');
  assert.equal(listaGuardadaDe(g, 'u2'), null, 'otra cuenta no lo lee');
  assert.equal(listaGuardadaDe({ ...g, v: 9 }, 'u1'), null);
  assert.equal(listaGuardadaDe({ v: 1, quien: 'u1', conversaciones: [{ nombre: 'sin correo' }, conv('b@x.com', { ultimo: { texto: 'se cuela', cuando: 1 } })] }, 'u1').conversaciones.map((c) => [c.correo, c.ultimo?.texto]).join(), 'b@x.com,', 'ni filas sin correo ni texto colado');
  const muchas = Array.from({ length: 300 }, (_, i) => conv(`p${i}@x.com`));
  assert.equal(paraGuardarLista('u1', muchas).conversaciones.length, MAX_GUARDADAS);
  const guardada = leer('pulse/listaGuardada.ts');
  assert.match(guardada, /RELEVO\.alSalir\(/, 'al salir del chat se borra');
  assert.match(guardada, /seudonimoDe\(correo\)/, 'marcada con el seudónimo de la cuenta, no con el correo');
});

prueba('la lista: sin red enseña lo guardado con el aviso; sin nada guardado, «Sin conexión» con Reintentar (nunca «Agrega a alguien»)', () => {
  const p = leer('pulse/PantallaChats.tsx');
  assert.match(p, /leerListaGuardada\(yo\)/);
  assert.match(p, /CHATS\.sembrarLista\(g\.conversaciones\)/);
  assert.match(p, /guardarLista\(yo, lista\.conversaciones\)/);
  assert.match(p, /Te muestro lo último guardado/);
  assert.match(p, /vacio && sinRed \? \(\s*<SinRed p=\{p\} \/>\s*\) : vacio \? \(\s*<Vacio /, 'sin red y sin nada: SinRed, antes que el vacío de «Agrega a alguien»');
  assert.match(p, /CHATS\.refrescarLista\(\)/, '«Reintentar ahora» pregunta en el acto');
  const chats = leer('pulse/chats.ts');
  assert.match(chats, /export function sembrarLista\(/);
  assert.match(chats, /v\.conversaciones !== null && \(v\.conversaciones\.length \|\| !v\.error\)/, 'lo guardado no pisa una lista traída del relevo');
});

prueba('«Cifrado de punta a punta» solo dentro de PULSE2CHAT, no encima de WhatsApp y los correos (A2)', () => {
  const p = leer('pulse/PantallaChats.tsx');
  const cabecera = p.slice(p.indexOf('<View style={[s.cabecera'), p.indexOf('<AuraAlLado pantalla="chats"'));
  assert.ok(cabecera.length > 100, 'encontré la cabecera');
  assert.ok(!/punta a punta/.test(cabecera), 'la cabecera (encima de las pestañas) no lo dice');
  assert.match(p, /PULSE2CHAT va cifrado de punta a punta/, 'dentro de PULSE2CHAT sí');
  for (const r of ['whatsapp/PantallaWhatsapp.tsx', 'whatsapp/ConversacionWA.tsx', 'correo/PantallaCorreos.tsx']) assert.ok(!/punta a punta|end-to-end/i.test(leer(r)), `${r} no dice que es de punta a punta`);
});

prueba('un mensaje que no salió trae «Reintentar» a la vista, en PULSE2CHAT y en WhatsApp (A10)', () => {
  const b = leer('pulse/ui/Burbuja.tsx');
  assert.match(b, /accessibilityLabel=\{tr\('Reintentar el envío', 'Retry sending'\)\}/);
  assert.match(b, /tr\('Reintentar', 'Retry'\)/, 'el botón dice lo que hace');
  assert.match(b, /onPress=\{\(\) => onReintentar\?\.\(m\.id\)\}/);
  assert.match(b, /onPress=\{\(\) => onDescartar\?\.\(m\.id\)\}/, 'y «Quitar»');
  const w = leer('whatsapp/PiezasWA.tsx');
  assert.ok(/onPress=\{\(\) => onReintentar\(m\.texto\)\}[\s\S]{0,800}tr\('Reintentar', 'Retry'\)/.test(w), 'WhatsApp: el botón «Reintentar»');
  const c = leer('pulse/PantallaConversacion.tsx');
  assert.match(c, /CHATS\.reintentar\(correo, id\)/);
});

console.log(`\n${n - fallos}/${n} pruebas de los estados de los chats`);
process.exit(fallos ? 1 : 0);
