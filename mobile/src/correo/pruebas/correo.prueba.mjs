/**
 * Pruebas en Node de la pestaña Correos (correo/logica.ts): quién lo manda y cuándo, las conversaciones,
 * lo citado, los adjuntos, qué lleva una respuesta (a quién, con copia a quién, asunto, cita, hilo), qué
 * se pregunta antes de mandar, y que nada sale sin el toque de «Mandar».
 *
 *   cd mobile && npx tsx src/correo/pruebas/correo.prueba.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  armarRespuesta,
  asuntoNormal,
  asuntoRespuesta,
  asuntoVisible,
  avisoConfirmacion,
  avisoEnviado,
  borradorNuevo,
  citar,
  claseAdjunto,
  coincideHilo,
  colorCorreo,
  cuentaDeRef,
  fechaCorreo,
  fechaLarga,
  hilos,
  inicialesCorreo,
  leerDestinos,
  limpiarTexto,
  marcarLeido,
  mensajeErrorCorreo,
  noLeidosTotal,
  normalizarBandeja,
  normalizarMensaje,
  problemaBorrador,
  remitente,
  separarCitas,
  tamanoArchivo,
  textoFinal,
  vistaCorreos,
} from '../logica.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const leer = (r) => fs.readFileSync(path.join(AQUI, '..', '..', r), 'utf8');
const pruebas = [];
const prueba = (n, f) => pruebas.push([n, f]);

const iso = (a, m, d, h = 9, min = 0) => new Date(a, m - 1, d, h, min).toISOString();
const AHORA = new Date(2026, 9, 2, 18, 30).getTime(); // viernes 2 de octubre de 2026

prueba('quién lo manda: el nombre limpio; sin nombre, lo de antes de la @; nunca vacío', () => {
  assert.equal(remitente({ de: 'Beto Paz', deCorreo: 'beto@empresa.hn' }), 'Beto Paz');
  assert.equal(remitente({ de: '"Banco Atlántida"', deCorreo: 'avisos@banco.hn' }), 'Banco Atlántida', 'sin comillas');
  assert.equal(remitente({ de: 'beto@empresa.hn', deCorreo: 'beto@empresa.hn' }), 'beto', 'si el nombre es la dirección, la parte de antes de la @');
  assert.equal(remitente({ de: 'Ana <ana@x.hn>', deCorreo: 'ana@x.hn' }), 'Ana', 'sin la dirección pegada');
  assert.equal(remitente({ de: '', deCorreo: '' }), 'Sin remitente');
  assert.equal(remitente({ de: '', deCorreo: '' }, 'en'), 'Unknown sender');
  assert.equal(inicialesCorreo('Beto Paz'), 'BP');
  assert.equal(inicialesCorreo('beto.paz'), 'BP');
  assert.equal(inicialesCorreo('ana@x.hn'), 'A');
  assert.equal(inicialesCorreo(''), '');
  assert.equal(colorCorreo('Beto@x.hn'), colorCorreo('beto@x.hn'), 'el mismo color para la misma persona');
});

prueba('las fechas como en una bandeja: hoy la hora, «Ayer», el día de la semana, «2 oct», «02/10/25»', () => {
  assert.equal(fechaCorreo(iso(2026, 10, 2, 14, 5), AHORA), '14:05');
  assert.equal(fechaCorreo(iso(2026, 10, 1, 23, 59), AHORA), 'Ayer');
  assert.equal(fechaCorreo(iso(2026, 10, 1, 23, 59), AHORA, 'en'), 'Yesterday');
  assert.equal(fechaCorreo(iso(2026, 9, 28), AHORA), 'lun', 'esta semana, el día');
  assert.equal(fechaCorreo(iso(2026, 8, 15), AHORA), '15 ago');
  assert.equal(fechaCorreo(iso(2026, 8, 15), AHORA, 'en'), 'Aug 15');
  assert.equal(fechaCorreo(iso(2025, 10, 2), AHORA), '02/10/25');
  assert.equal(fechaCorreo('', AHORA), '');
  assert.equal(fechaCorreo('no es fecha', AHORA), '');
  assert.equal(fechaLarga(iso(2026, 10, 2, 14, 5)), 'viernes 2 de octubre de 2026, 14:05');
  assert.equal(fechaLarga(iso(2026, 10, 2, 14, 5), 'en'), 'Friday, October 2, 2026, 14:05');
});

prueba('conversaciones: mismo asunto sin «Re:/RV:/Fwd:» y misma cuenta; la más nueva primero; sin leer y quiénes', () => {
  assert.equal(asuntoNormal('RE: Re:  Factura   de octubre'), 'factura de octubre');
  assert.equal(asuntoNormal('RV: [2] FW: Contrato'), 'contrato');
  assert.equal(asuntoNormal('Fwd: Re[3]: Pago'), 'pago');
  const ms = [
    { ref: 'a:1', cuenta: 'yo@x.hn', de: 'Beto', deCorreo: 'beto@e.hn', asunto: 'Factura', fecha: iso(2026, 10, 1, 9), noLeido: false },
    { ref: 'a:2', cuenta: 'yo@x.hn', de: 'Ana', deCorreo: 'ana@e.hn', asunto: 'Re: Factura', fecha: iso(2026, 10, 2, 10), noLeido: true },
    { ref: 'a:3', cuenta: 'yo@x.hn', de: 'Banco', deCorreo: 'b@b.hn', asunto: 'Tu estado de cuenta', fecha: iso(2026, 10, 2, 8), noLeido: true },
    { ref: 'b:1', cuenta: 'otra@y.hn', de: 'Beto', deCorreo: 'beto@e.hn', asunto: 'RE: factura', fecha: iso(2026, 10, 2, 7), noLeido: false },
    { ref: 'a:4', cuenta: 'yo@x.hn', de: 'X', deCorreo: 'x@x.hn', asunto: '', fecha: iso(2026, 9, 30), noLeido: false },
    { ref: 'a:5', cuenta: 'yo@x.hn', de: 'Y', deCorreo: 'y@x.hn', asunto: '(sin asunto)', fecha: iso(2026, 9, 29), noLeido: false },
  ];
  const hs = hilos(ms);
  assert.deepEqual(hs.map((h) => h.mensajes.map((m) => m.ref).join('+')), ['a:2+a:1', 'a:3', 'b:1', 'a:4', 'a:5'], 'la otra cuenta va aparte; sin asunto, cada uno solo');
  assert.equal(hs[0].ultimo.ref, 'a:2', 'el que se ve y se abre es el más nuevo');
  assert.equal(hs[0].noLeidos, 1);
  assert.deepEqual(hs[0].participantes, ['Ana', 'Beto']);
  assert.ok(coincideHilo(hs[0], 'beto'), 'busca también en los de dentro de la conversación');
  assert.ok(coincideHilo(hs[1], 'ESTADO'));
  assert.ok(!coincideHilo(hs[1], 'zzz'));
  assert.equal(noLeidosTotal(ms), 2);
  const leidos = marcarLeido(ms, 'a:2');
  assert.equal(noLeidosTotal(leidos), 1, 'al abrirlo queda leído en la lista');
  assert.equal(leidos[2], ms[2], 'lo demás no se toca');
  assert.equal(cuentaDeRef('a1b2:42'), 'a1b2');
  assert.equal(asuntoVisible(''), '(sin asunto)');
  assert.equal(asuntoVisible('', 'en'), '(no subject)');
});

prueba('el texto bien presentado: lo citado aparte, sin líneas en blanco de más', () => {
  const t = 'Hola José,\r\n\r\n\r\n\r\nTe confirmo el jueves.   \nSaludos\n\nEl lun, 28 sept 2026 a las 9:00, José <j@x.hn> escribió:\n> ¿Nos vemos?\n> Gracias';
  const { cuerpo, citado } = separarCitas(t);
  assert.equal(cuerpo, 'Hola José,\n\nTe confirmo el jueves.\nSaludos');
  assert.match(citado, /^El lun, 28 sept 2026 a las 9:00, José <j@x\.hn> escribió:\n> ¿Nos vemos\?/);
  assert.deepEqual(separarCitas('Uno\n> cita al final\n> sigue'), { cuerpo: 'Uno', citado: '> cita al final\n> sigue' });
  assert.equal(separarCitas('a > b\n> en medio\nsigue el texto').citado, '', 'una línea con «>» a mitad del texto no es una cita');
  assert.equal(separarCitas('---------- Forwarded message ---------\nDe: Ana').cuerpo, '---------- Forwarded message ---------\nDe: Ana', 'un reenvío sin nada escrito se ve entero');
  assert.equal(separarCitas('Ok\n\nFrom: Ana <a@x.hn>\nSent: …').citado.startsWith('From: Ana'), true);
  assert.equal(limpiarTexto('  a  \n\n\n\nb  '), 'a\n\nb');
});

prueba('adjuntos: su clase, su extensión y su tamaño', () => {
  assert.deepEqual(claseAdjunto({ nombre: 'factura.PDF', tipo: 'application/octet-stream' }), { clase: 'pdf', ext: 'PDF' });
  assert.equal(claseAdjunto({ nombre: 'foto', tipo: 'image/jpeg' }).clase, 'imagen');
  assert.equal(claseAdjunto({ nombre: 'cuentas.xlsx', tipo: '' }).clase, 'hoja');
  assert.equal(claseAdjunto({ nombre: 'contrato.docx', tipo: '' }).clase, 'documento');
  assert.equal(claseAdjunto({ nombre: 'todo.zip', tipo: '' }).clase, 'comprimido');
  assert.equal(claseAdjunto({ nombre: 'x', tipo: 'application/x-raro' }).clase, 'otro');
  assert.equal(tamanoArchivo(512), '512 B');
  assert.equal(tamanoArchivo(840 * 1024), '840 KB');
  assert.equal(tamanoArchivo(1.4 * 1024 * 1024), '1,4 MB');
  assert.equal(tamanoArchivo(1.4 * 1024 * 1024, 'en'), '1.4 MB');
  assert.equal(tamanoArchivo(-3), '0 B');
});

const original = normalizarMensaje({
  ref: 'c1:9',
  cuentaId: 'c1',
  cuenta: 'yo@x.hn',
  de: 'Beto Paz',
  deCorreo: 'beto@empresa.hn',
  responderA: 'facturas@empresa.hn',
  para: 'Yo <yo@x.hn>, Carla <carla@empresa.hn>',
  paraCorreos: ['yo@x.hn', 'carla@empresa.hn'],
  cc: 'Dani <dani@e.hn>',
  ccCorreos: ['dani@e.hn', 'YO@x.hn', 'facturas@empresa.hn'],
  asunto: 'Factura 88',
  fecha: iso(2026, 10, 2, 14, 5),
  texto: 'Hola,\nte mando la factura.\n\nSaludos',
  adjuntos: [{ nombre: 'f88.pdf', tipo: 'application/pdf', bytes: 2048 }, null],
  messageId: '<m9@empresa.hn>',
  referencias: ['<m1@empresa.hn>', '<m9@empresa.hn>'],
});

prueba('lo que llega del servidor: nunca se cae un correo por un campo que falte', () => {
  const b = normalizarBandeja({ mensajes: [{ ref: 'a:1', de: 'X' }, { de: 'sin ref' }, null], cuentas: [{ id: 'a', correo: 'yo@x.hn', proveedor: { nombre: 'Gmail' } }, { id: 'b' }], errores: [{ cuenta: 'z@z.hn', error: 'no contestó' }, {}] });
  assert.equal(b.mensajes.length, 1);
  assert.equal(b.mensajes[0].asunto, '');
  assert.equal(b.cuentas.length, 1, 'la cuenta sin correo no sirve');
  assert.equal(b.errores.length, 1);
  assert.deepEqual(normalizarBandeja(undefined), { mensajes: [], cuentas: [], errores: [] });
  assert.equal(normalizarMensaje({ de: 'sin ref' }), null);
  assert.equal(original.adjuntos.length, 1, 'un adjunto vacío no rompe la lista');
  assert.equal(normalizarMensaje({ ref: 'q7:1', deCorreo: 'a@b.hn' }).cuentaId, 'q7', 'la cuenta sale de la referencia');
  assert.equal(normalizarMensaje({ ref: 'q7:1', deCorreo: 'a@b.hn' }).responderA, 'a@b.hn');
});

prueba('responder: a su «Responder a», «Re:» una vez, el original citado y en el mismo hilo', () => {
  const r = armarRespuesta(original, 'responder', 'yo@x.hn');
  assert.equal(r.para, 'facturas@empresa.hn', 'si puso «Responder a», va ahí');
  assert.equal(r.cc, '', 'responder (no a todos) no lleva copia');
  assert.equal(r.asunto, 'Re: Factura 88');
  assert.equal(asuntoRespuesta('RE: Factura 88'), 'RE: Factura 88', 'no se repite el «Re:»');
  assert.equal(asuntoRespuesta(''), 'Re:');
  assert.equal(r.enRespuestaA, '<m9@empresa.hn>');
  assert.deepEqual(r.referencias, ['<m1@empresa.hn>', '<m9@empresa.hn>'], 'las referencias del hilo, sin repetir, y el original al final');
  assert.equal(r.cuentaId, 'c1', 'sale de la misma cuenta donde llegó');
  assert.match(r.cita, /^El viernes 2 de octubre de 2026, 14:05, Beto Paz <beto@empresa\.hn> escribió:\n> Hola,\n> te mando la factura\.\n>\n> Saludos$/);
  assert.match(citar(original, 'en'), /^On Friday, October 2, 2026, 14:05, Beto Paz <beto@empresa\.hn> wrote:/);
  assert.equal(r.modo, 'responder');
});

prueba('responder a todos: los de «Para» y «Cc» en copia, menos tú y sin repetir', () => {
  const r = armarRespuesta(original, 'todos', 'yo@x.hn');
  assert.equal(r.para, 'facturas@empresa.hn');
  assert.equal(r.cc, 'carla@empresa.hn, dani@e.hn', 'sin ti (aunque venga en mayúsculas) y sin repetir al de «Para»');
  // Un correo que mandaste tú (en la bandeja): la respuesta va a quien se lo mandaste.
  const mio = { ...original, deCorreo: 'yo@x.hn', responderA: 'yo@x.hn', paraCorreos: ['beto@empresa.hn'], ccCorreos: [] };
  assert.equal(armarRespuesta(mio, 'responder', 'yo@x.hn').para, 'beto@empresa.hn');
  const sinId = armarRespuesta({ ...original, messageId: '', referencias: [] }, 'responder', 'yo@x.hn');
  assert.equal(sinId.enRespuestaA, undefined);
  assert.deepEqual(sinId.referencias, []);
});

prueba('el texto que sale: lo escrito y, si se dejó, la cita debajo', () => {
  const r = { ...armarRespuesta(original, 'responder', 'yo@x.hn'), texto: 'Recibida, gracias.\n\n' };
  assert.equal(textoFinal(r, false), 'Recibida, gracias.');
  assert.match(textoFinal(r, true), /^Recibida, gracias\.\n\nEl viernes 2 de octubre de 2026, 14:05, Beto Paz/);
  assert.equal(textoFinal(borradorNuevo('c1'), true), '', 'uno nuevo no trae cita');
});

prueba('direcciones: «Nombre <a@b>», comas, punto y coma o renglones; las malas se dicen', () => {
  assert.deepEqual(leerDestinos('Beto <Beto@Empresa.hn>, ana@x.hn; ana@x.hn\ncarla@e.hn'), { ok: ['beto@empresa.hn', 'ana@x.hn', 'carla@e.hn'], malas: [] });
  assert.deepEqual(leerDestinos('beto, ana@x'), { ok: [], malas: ['beto', 'ana@x'] });
  assert.deepEqual(leerDestinos(''), { ok: [], malas: [] });
});

prueba('antes de mandar: qué falta, y el aviso con desde, para, copia, asunto y el comienzo del texto', () => {
  const b = { ...borradorNuevo('c1'), para: 'beto@empresa.hn', cc: 'carla@e.hn, beto@empresa.hn', asunto: '', texto: 'Hola Beto, ¿nos vemos el jueves?' };
  assert.equal(problemaBorrador(b), null);
  assert.match(problemaBorrador({ ...b, cuentaId: '' }), /desde qué cuenta/);
  assert.match(problemaBorrador({ ...b, para: '' }), /Para quién/);
  assert.match(problemaBorrador({ ...b, para: 'beto' }), /«beto» no es una dirección/);
  assert.match(problemaBorrador({ ...b, texto: '  ' }), /vacío/);
  assert.match(problemaBorrador({ ...b, para: Array.from({ length: 21 }, (_, i) => `p${i}@x.hn`).join(',') }), /demasiadas/);
  assert.match(problemaBorrador({ ...b, para: '' }, 'en'), /Who is it for/);
  const a = avisoConfirmacion(b, 'yo@x.hn');
  assert.equal(a.titulo, '¿Mandar este correo?');
  assert.equal(a.cuerpo, 'Desde: yo@x.hn\nPara: beto@empresa.hn\nCon copia: carla@e.hn\nAsunto: (sin asunto)\n\n«Hola Beto, ¿nos vemos el jueves?»');
  const largo = avisoConfirmacion({ ...b, cc: '', texto: 'x'.repeat(300) }, 'yo@x.hn', 'en');
  assert.match(largo.cuerpo, /^From: yo@x\.hn\nTo: beto@empresa\.hn\nSubject: \(no subject\)\n\n«x{137}…»$/);
  assert.equal(avisoEnviado({ aceptados: ['beto@empresa.hn'], rechazados: [] }), 'Enviado a beto@empresa.hn.');
  assert.equal(avisoEnviado({ aceptados: ['beto@empresa.hn'], rechazados: ['nadie@e.hn'] }), 'Enviado a beto@empresa.hn. No le llegó a nadie@e.hn.');
});

prueba('qué se ve y los errores dichos para la persona', () => {
  assert.equal(vistaCorreos({ bandeja: null, error: '' }), 'cargando');
  assert.equal(vistaCorreos({ bandeja: null, error: 'Sin conexión' }), 'error');
  assert.equal(vistaCorreos({ bandeja: { mensajes: [], cuentas: [], errores: [] }, error: '' }), 'sin_cuentas');
  assert.equal(vistaCorreos({ bandeja: { mensajes: [], cuentas: [{ id: 'a', correo: 'a@b.hn', proveedor: { nombre: '' } }], errores: [] }, error: '' }), 'lista');
  assert.match(mensajeErrorCorreo(0, 'Aborted'), /Sin conexión/);
  assert.match(mensajeErrorCorreo(401, ''), /sesión/);
  assert.match(mensajeErrorCorreo(428, ''), /no se mandó nada/);
  assert.equal(mensajeErrorCorreo(502, 'No salió: el servidor rechazó nadie@e.hn.'), 'No salió: el servidor rechazó nadie@e.hn.');
  assert.match(mensajeErrorCorreo(502, 'HTTP 502'), /no contestó/);
});

prueba('la pantalla: tercera pestaña de los chats, y nada sale sin el «Mandar» del aviso', () => {
  const pestañas = leer('whatsapp/ChatsConWhatsapp.tsx');
  assert.match(pestañas, /<PantallaCorreos /, 'la pestaña Correos está en los chats');
  assert.match(pestañas, /conWhatsapp \? \['pulse', 'whatsapp', 'correos', 'cartera'\] : \['pulse', 'correos', 'cartera'\]/, 'WhatsApp solo si la cuenta lo tiene; Correos para todos');
  const api = leer('correo/api.ts');
  assert.match(api, /confirmado: true/);
  const redactar = leer('correo/RedactarCorreo.tsx');
  // La única llamada que manda está dentro del «Mandar» del aviso.
  assert.equal((redactar.match(/mandarCorreoConfirmado\(/g) || []).length, 1);
  assert.match(redactar, /Alert\.alert\(aviso\.titulo, aviso\.cuerpo, \[[\s\S]*?\{ text: tr\('Mandar', 'Send'\), onPress: \(\) => void mandar\(\) \}/);
  assert.match(redactar, /¿Descartar el correo\?/, 'salir con algo escrito pregunta');
  const pantalla = leer('correo/PantallaCorreos.tsx');
  assert.match(pantalla, /Ajustes → Tus correos/, 'sin cuentas, explica dónde conectarla');
  assert.match(pantalla, /<HojaCorreos/, 'y la conecta desde ahí mismo (la API de ajustes/Correos.tsx)');
  assert.match(pantalla, /RefreshControl/, 'deslizar para refrescar');
  const leerTsx = leer('correo/LeerCorreo.tsx');
  assert.match(leerTsx, /registrarAtras\(/, '«atrás» cierra el correo, no la ventana de los chats');
  assert.match(leerTsx, /Responder a todos/);
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
console.log(`\n${ok}/${pruebas.length} pruebas de Correos en la app`);
if (ok !== pruebas.length) process.exit(1);
