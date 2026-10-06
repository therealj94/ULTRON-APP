/**
 * WHATSAPP EN EL CENTRO (src/whatsapp, src/vistas/whatsapp.ts y mensajeria.ts): la hora de Honduras, lo que
 * se dice de cada mensaje, la lista (renglón, orden, sin leer), los pasos (vincular → listo), el envío
 * optimista, el modo muestra y que el puente lo atienda AURA (la lista cerrada de C#, el switch y PUENTE.md).
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { armar, CENTRO, RAIZ } from './ayudas.mjs';

let F; // formato (puro)
let M; // muestra (el modo sin .exe)

const W = join(CENTRO, 'src', 'whatsapp');
// 2-oct-2026 14:05 en Honduras = 20:05 UTC.
const AHORA = Date.UTC(2026, 9, 2, 20, 5);
const HORA = 3_600_000;
const DIA = 24 * HORA;

before(async () => {
  F = await armar(join(W, 'formato.ts'));
  M = await armar(join(W, 'muestra.ts'));
});

test('la hora es la de Honduras (UTC−6), no la del equipo', () => {
  assert.equal(F.horaHN(AHORA), '14:05');
  assert.equal(F.horaHN(Date.UTC(2026, 9, 3, 5, 59)), '23:59', '05:59 UTC del 3 sigue siendo el 2 en Honduras');
  assert.equal(F.horaHN(0), '');
  assert.equal(F.cuandoChat(AHORA - 10 * 60_000, AHORA), 'hoy 13:55');
  // Medianoche de Honduras (06:00 UTC): las 23:30 de ayer son «ayer» aunque en UTC ya sea el mismo día.
  assert.equal(F.cuandoChat(Date.UTC(2026, 9, 2, 5, 30), AHORA), 'ayer');
  assert.equal(F.cuandoChat(Date.UTC(2026, 9, 2, 6, 1), AHORA), 'hoy 00:01');
  assert.equal(F.cuandoChat(AHORA - 5 * DIA, AHORA), '27 sep');
  assert.equal(F.cuandoChat(Date.UTC(2025, 11, 31, 18), AHORA), '31/12/25');
  assert.equal(F.cuandoChat(AHORA - DIA, AHORA, true), 'yesterday');
  assert.equal(F.cuandoChat(0, AHORA), '');
  assert.equal(F.diasAtras(AHORA, AHORA), 0);
  assert.equal(F.etiquetaDia(AHORA, AHORA), 'Hoy');
  assert.equal(F.etiquetaDia(AHORA - DIA, AHORA), 'Ayer');
  assert.equal(F.etiquetaDia(AHORA - 4 * DIA, AHORA), 'lunes 28 de septiembre');
  assert.equal(F.etiquetaDia(Date.UTC(2025, 2, 10, 18), AHORA), '10 de marzo de 2025');
});

test('lo que se dice de cada mensaje que no es texto', () => {
  assert.equal(F.duracion(12), '0:12');
  assert.equal(F.duracion(725), '12:05');
  assert.equal(F.duracion(3723), '1:02:03');
  assert.equal(F.duracion(undefined), '0:00');
  assert.equal(F.etiquetaTipo({ tipo: 'audio', duracion: 12 }), '🎤 Nota de voz (0:12)');
  assert.equal(F.etiquetaTipo({ tipo: 'texto' }), '');
  assert.equal(F.etiquetaTipo({ tipo: 'imagen' }), '📷 Foto');
  assert.equal(F.etiquetaTipo({ tipo: 'video', duracion: 30 }), '🎥 Video (0:30)');
  assert.equal(F.etiquetaTipo({ tipo: 'documento', archivo: 'contrato.pdf' }), '📄 contrato.pdf');
  assert.equal(F.etiquetaTipo({ tipo: 'documento' }), '📄 Documento');
  assert.equal(F.etiquetaTipo({ tipo: 'ubicacion' }), '📍 Ubicación');
  assert.equal(F.etiquetaTipo({ tipo: 'contacto' }), '👤 Contacto');
  assert.equal(F.etiquetaTipo({ tipo: 'encuesta' }), '📊 Encuesta');
  assert.equal(F.etiquetaTipo({ tipo: 'sticker' }), '💟 Sticker');
  assert.equal(F.etiquetaTipo({ tipo: 'raro' }), '📎 Mensaje');
  // Eliminado gana a cualquier tipo.
  assert.equal(F.etiquetaTipo({ tipo: 'imagen', eliminado: true }), '🚫 Mensaje eliminado');
  assert.equal(F.etiquetaTipo({ tipo: 'audio', duracion: 5 }, true), '🎤 Voice note (0:05)');
});

test('la lista: renglón, orden, sin leer, búsqueda, caras y números', () => {
  assert.equal(F.vistaPrevia({ ultimo: 'Ya voy', ultimoMio: true, grupo: false }), 'Tú: Ya voy');
  assert.equal(F.vistaPrevia({ ultimo: 'Mañana a las 9', ultimoMio: false, grupo: true, ultimoDe: 'Mario Zelaya' }), 'Mario: Mañana a las 9');
  assert.equal(F.vistaPrevia({ ultimo: 'hola', ultimoMio: false, grupo: true, ultimoDe: '+504 9999-0000' }), '+504 9999-0000: hola');
  assert.equal(F.vistaPrevia({ ultimo: 'hola\n\n  qué tal', ultimoMio: false, grupo: false }), 'hola qué tal');
  assert.equal(F.vistaPrevia({ ultimo: '', ultimoMio: true, grupo: false }), '');
  assert.ok(F.vistaPrevia({ ultimo: 'x'.repeat(300), ultimoMio: false, grupo: false }).length <= 90);

  const c = (jid, nombre, hora, noLeidos = 0) => ({ jid, nombre, grupo: false, noLeidos, hora, ultimo: '', ultimoMio: false });
  const lista = [c('1@s.whatsapp.net', 'Beto', 100, 2), c('2@s.whatsapp.net', 'Ana', 300), c('3@s.whatsapp.net', 'Zoe', 200, 120), c('4@s.whatsapp.net', 'Abel', 200, -3)];
  assert.deepEqual(F.ordenarChats(lista).map((x) => x.nombre), ['Ana', 'Abel', 'Zoe', 'Beto'], 'más reciente primero; a igual hora, por nombre');
  assert.equal(lista[0].nombre, 'Beto', 'ordenar no cambia la lista original');
  assert.equal(F.totalNoLeidos(lista), 122, 'los negativos no restan');
  assert.equal(F.totalNoLeidos(null), 0);
  assert.equal(F.insignia(0), '');
  assert.equal(F.insignia(7), '7');
  assert.equal(F.insignia(120), '99+');

  const conNumeros = [{ ...c('50499887766@s.whatsapp.net', 'Karla Martínez', 1) }, { ...c('50433445566@s.whatsapp.net', 'Mamá', 1) }];
  assert.deepEqual(F.filtrarChats(conNumeros, 'martinez').map((x) => x.nombre), ['Karla Martínez'], 'sin tildes ni mayúsculas');
  assert.deepEqual(F.filtrarChats(conNumeros, 'MAMA').map((x) => x.nombre), ['Mamá']);
  assert.deepEqual(F.filtrarChats(conNumeros, '9988').map((x) => x.nombre), ['Karla Martínez'], 'por número');
  assert.equal(F.filtrarChats(conNumeros, '').length, 2);

  assert.equal(F.iniciales('Karla Martínez'), 'KM');
  assert.equal(F.iniciales('Karla 💛'), 'K');
  assert.equal(F.iniciales('+504 9876-5432'), '#');
  assert.equal(F.iniciales(''), '#');
  assert.equal(F.numeroDeJid('50499887766@s.whatsapp.net'), '+504 9988-7766');
  assert.equal(F.numeroDeJid('15551234567@s.whatsapp.net'), '+15551234567');
  assert.equal(F.numeroDeJid('120363041122334455@g.us'), '', 'un grupo no tiene número');
});

test('los pasos: oculto, sin puente, vincular (QR cada 3 s) y listo', () => {
  assert.equal(F.fase(undefined), 'cargando');
  assert.equal(F.fase(null), 'oculto', 'sin respuesta (sin sesión, sin servidor): no se muestra nada');
  assert.equal(F.fase({ permitido: false, disponible: true, vinculado: true }), 'oculto', 'otra cuenta: ni la pestaña');
  assert.equal(F.fase({ permitido: true, disponible: false }), 'sin-puente');
  assert.equal(F.fase({ permitido: true, disponible: true, vinculado: false }), 'vincular');
  assert.equal(F.fase({ permitido: true, disponible: true, vinculado: true }), 'listo');

  assert.equal(F.sondeoEstado({ permitido: true, disponible: true, vinculado: false, vinculando: true }), 3000);
  assert.equal(F.sondeoEstado({ permitido: true, disponible: true, vinculado: true }), 30000);
  assert.equal(F.sondeoEstado({ permitido: false }), 0);
  assert.equal(F.sondeoEstado(null), 0);
  assert.ok(F.SONDEO.chats === 5000 && F.SONDEO.hilo === 3000, 'lista cada 5 s, conversación cada 3 s');

  const sinQr = { permitido: true, disponible: true, vinculado: false };
  assert.equal(F.pedirQr(sinQr, false, true), true, 'al llegar a vincular (ya aceptado) se pide el QR una vez');
  assert.equal(F.pedirQr(sinQr, false, false), false, 'sin aceptar, abrir el panel no pide nada (no abre una cuenta en el puente)');
  assert.equal(F.pedirQr(sinQr, true, true), false, 'no en bucle (el servidor limita /vincular)');
  assert.equal(F.pedirQr({ ...sinQr, qr: 'data:image/png;base64,AA' }, false, true), false);
  assert.equal(F.pedirQr({ ...sinQr, vinculando: true }, false, true), false);
  assert.equal(F.pedirQr({ ...sinQr, vinculado: true }, false, true), false);
  assert.match(F.textoConsentimiento(), /se guardan en el servidor de AU-RA.*se borra todo.*podría limitar tu cuenta/);

  assert.equal(F.codigoBonito('abcdefgh'), 'ABCD-EFGH');
  assert.equal(F.codigoBonito('ABCD-EFGH'), 'ABCD-EFGH');
  assert.deepEqual(F.telefonoParaVincular('9999-0000'), { numero: '50499990000', valido: true }, '8 cifras: Honduras');
  assert.deepEqual(F.telefonoParaVincular('+504 9999 0000'), { numero: '50499990000', valido: true });
  assert.equal(F.telefonoParaVincular('1234').valido, false);
  assert.equal(F.telefonoParaVincular('1'.repeat(16)).valido, false);

  assert.equal(F.textoEnviable('hola'), true);
  assert.equal(F.textoEnviable('   \n '), false);
  assert.equal(F.textoEnviable('x'.repeat(4000)), true);
  assert.equal(F.textoEnviable('x'.repeat(4001)), false);
});

test('la conversación: envío optimista sin duplicar, lo de antes y las tandas', () => {
  const s = (id, hora, x = {}) => ({ id, chat: 'k@s.whatsapp.net', de: 'k@s.whatsapp.net', nombreDe: 'Karla', mio: false, hora, tipo: 'texto', texto: id, ...x });
  const l = F.mensajeLocal('k@s.whatsapp.net', 'ya voy', 1, AHORA);
  assert.ok(l.id.startsWith(F.PREFIJO_LOCAL) && l.pendiente && l.mio);
  const servidor = [s('a', AHORA - 60_000), s('b', AHORA - 30_000)];
  assert.deepEqual(F.fusionarMensajes(servidor, [l]).map((m) => m.id), ['a', 'b', l.id], 'lo escrito aparece ya, al final');
  // El sondeo trae el mío antes de que conteste el envío: no sale dos veces.
  const conMio = [...servidor, s('srv-1', AHORA + 800, { mio: true, de: '', texto: 'ya voy' })];
  assert.deepEqual(F.fusionarMensajes(conMio, [l]).map((m) => m.id), ['a', 'b', 'srv-1']);
  // Dos pendientes iguales y uno solo en el servidor: queda uno pendiente.
  const l2 = F.mensajeLocal('k@s.whatsapp.net', 'ya voy', 2, AHORA + 1000);
  assert.deepEqual(F.fusionarMensajes(conMio, [l, l2]).map((m) => m.id), ['a', 'b', 'srv-1', l2.id]);
  // Un fallido se queda (con su error) hasta que lo quites.
  const fallido = { ...l, pendiente: false, fallido: true, motivo: 'sin red' };
  assert.equal(F.fusionarMensajes(conMio, [fallido]).filter((m) => m.fallido).length, 1);
  // Lo de antes, sin repetir y en orden.
  const juntos = F.juntarAnteriores([s('z', AHORA - 9e6), s('a', AHORA - 60_000)], [...servidor, l]);
  assert.deepEqual(juntos.map((m) => m.id), ['z', 'a', 'b', l.id]);
  assert.equal(F.hayNuevoSuyo(servidor, AHORA - 45_000), true);
  assert.equal(F.hayNuevoSuyo(servidor, AHORA), false);
  assert.equal(F.hayNuevoSuyo([s('m', AHORA + 5, { mio: true })], AHORA), false, 'lo mío no cuenta');

  // Tandas: mismo remitente, mismo día de Honduras y < 5 min; separador por día; el autor en los grupos.
  const msgs = [
    s('1', AHORA - DIA, { de: 'm@s', nombreDe: 'Mario' }),
    s('2', AHORA - 60_000, { de: 'm@s', nombreDe: 'Mario' }),
    s('3', AHORA - 30_000, { de: 'm@s', nombreDe: 'Mario' }),
    s('4', AHORA - 20_000, { de: 'a@s', nombreDe: 'Andrea' }),
    s('5', AHORA, { mio: true, de: '' }),
  ];
  const filas = F.filasConversacion(msgs, true, AHORA);
  assert.deepEqual(filas.map((f) => (f.tipo === 'dia' ? `[${f.texto}]` : `${f.m.id}${f.primera ? 'P' : ''}${f.ultima ? 'U' : ''}${f.autor ? 'A' : ''}`)), ['[Ayer]', '1PUA', '[Hoy]', '2PA', '3U', '4PUA', '5PU']);
  assert.ok(F.filasConversacion(msgs, false, AHORA).every((f) => f.tipo === 'dia' || !f.autor), 'fuera de un grupo no va el nombre');
});

test('el modo muestra: vincula con QR o código, lista, conversación, enviar y su error', async () => {
  M._reiniciarMuestra(false);
  let e = await M.muestraWhatsApp('whatsapp.estado');
  assert.equal(F.fase(e), 'vincular');
  const v = await M.muestraWhatsApp('whatsapp.vincular', {});
  assert.match(v.qr, /^data:image\//);
  e = await M.muestraWhatsApp('whatsapp.estado');
  assert.ok(e.vinculando && /^data:image\//.test(e.qr), 'mientras vincula, el QR viene en el estado');
  const c = await M.muestraWhatsApp('whatsapp.vincular', { telefono: '50499990000' });
  assert.match(F.codigoBonito(c.codigo), /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  for (let i = 0; i < 5; i++) e = await M.muestraWhatsApp('whatsapp.estado');
  assert.equal(F.fase(e), 'listo', '«lo escaneaste» tras unas preguntas');
  const { chats } = await M.muestraWhatsApp('whatsapp.chats', null);
  assert.ok(chats.length >= 5 && chats.some((x) => x.grupo) && F.totalNoLeidos(chats) > 0);
  const { mensajes } = await M.muestraWhatsApp('whatsapp.mensajes', { chat: chats[0].jid });
  assert.ok(mensajes.some((m) => m.eliminado) && mensajes.some((m) => m.editado) && mensajes.some((m) => m.tipo === 'audio'));
  for (let i = 1; i < mensajes.length; i++) assert.ok(mensajes[i - 1].hora <= mensajes[i].hora, 'del más viejo al más nuevo');
  const r = await M.muestraWhatsApp('whatsapp.enviar', { chat: chats[0].jid, texto: 'hola' });
  assert.equal(r.mensaje.texto, 'hola');
  await assert.rejects(M.muestraWhatsApp('whatsapp.enviar', { chat: chats[0].jid, texto: 'esto va a fallar' }), /no contestó/);
  await assert.rejects(M.muestraWhatsApp('whatsapp.enviar', { chat: chats[0].jid, texto: 'x'.repeat(4001) }), /muy largo/);
  await M.muestraWhatsApp('whatsapp.leido', { chat: chats[0].jid });
  assert.equal((await M.muestraWhatsApp('whatsapp.chats', null)).chats.find((x) => x.jid === chats[0].jid).noLeidos, 0);
  await M.muestraWhatsApp('whatsapp.desvincular');
  assert.equal(F.fase(await M.muestraWhatsApp('whatsapp.estado')), 'vincular');
});

test('el puente: los whatsapp.* los atiende AURA (lista cerrada, switch, validación) y están en PUENTE.md', () => {
  const METODOS = ['whatsapp.estado', 'whatsapp.vincular', 'whatsapp.desvincular', 'whatsapp.chats', 'whatsapp.mensajes', 'whatsapp.enviar', 'whatsapp.leido', 'whatsapp.media'];
  const lista = readFileSync(join(RAIZ, 'windows', 'src', 'Aura.Windows.Core', 'PuenteCentro.cs'), 'utf8');
  const metodos = lista.slice(lista.indexOf('HashSet<string> Metodos'), lista.indexOf('};', lista.indexOf('HashSet<string> Metodos')));
  const centro = readFileSync(join(RAIZ, 'windows', 'src', 'Aura.Windows', 'Notch', 'NotchWindow.Centro.cs'), 'utf8');
  const wa = readFileSync(join(RAIZ, 'windows', 'src', 'Aura.Windows', 'Notch', 'NotchWindow.WhatsApp.cs'), 'utf8');
  const puente = readFileSync(join(CENTRO, 'PUENTE.md'), 'utf8');
  const vista = readFileSync(join(CENTRO, 'src', 'vistas', 'whatsapp.ts'), 'utf8') + readFileSync(join(CENTRO, 'src', 'vistas', 'mensajeria.ts'), 'utf8');
  for (const m of METODOS) {
    assert.ok(metodos.includes(`"${m}"`), `PuenteCentro.Metodos: ${m}`);
    assert.ok(centro.includes(`"${m}"`), `ManejarCentro lo manda a ManejarWhatsApp: ${m}`);
    assert.ok(wa.includes(`case "${m}"`), `ManejarWhatsApp: ${m}`);
    assert.ok(puente.includes('`' + m + '`'), `PUENTE.md: ${m}`);
    assert.ok(vista.includes(`'${m}'`), `la página lo usa: ${m}`);
  }
  // Lo que valida C# antes de salir: chat, texto ≤ 4000, media ≤ 8 MB.
  const reglas = readFileSync(join(RAIZ, 'windows', 'src', 'Aura.Windows.Core', 'PuenteWhatsApp.cs'), 'utf8');
  assert.match(reglas, /TextoMax = 4000/);
  assert.match(reglas, /MediaMax = 8L \* 1024 \* 1024/);
  assert.match(wa, /PuenteWhatsApp\.Texto\(/);
  assert.match(wa, /PuenteWhatsApp\.Chat\(/);
  assert.match(wa, /PuenteWhatsApp\.MediaMax/);
  // La prueba de C# también lo mira.
  const pruebas = readFileSync(join(RAIZ, 'windows', 'tests', 'Program.cs'), 'utf8');
  assert.ok(pruebas.includes('whatsapp.enviar') && pruebas.includes('PuenteWhatsApp.'), 'tests/Program.cs');
});

test('la sección: WhatsApp vive junto a PULSE2CHAT, se cambia arriba o deslizando, y solo si está permitido', () => {
  const main = readFileSync(join(CENTRO, 'src', 'main.ts'), 'utf8');
  const mx = readFileSync(join(CENTRO, 'src', 'vistas', 'mensajeria.ts'), 'utf8');
  assert.match(main, /id: 'pulse'.*crear: vistaMensajeria/, 'la sección pulse es la de mensajería');
  assert.match(main, /id === 'whatsapp'\) id = 'pulse'/, '«whatsapp» lleva a la misma sección');
  assert.match(mx, /role: 'tablist'/);
  assert.match(mx, /'ArrowRight'/);
  assert.match(mx, /'wheel'/, 'dos dedos de lado en el panel táctil');
  assert.match(mx, /'pointerup'/, 'el dedo en una pantalla táctil');
  assert.match(mx, /barra\.hidden = !si/, 'sin permiso no hay pestañas');
});
