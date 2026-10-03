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
import {
  archivoCache,
  archivoFoto,
  chatDeContacto,
  mediaReintentable,
  normalizarContactos,
  coincide,
  colaLimitada,
  colorAvatar,
  colorNombre,
  digitosDeJid,
  digitosLlamada,
  duracionTexto,
  enlacesWhatsapp,
  etiquetaConDuracion,
  etiquetaDiaWA,
  etiquetaMedia,
  filasWA,
  formaDe,
  fusionarInfoChat,
  horaLista,
  horaWA,
  huellaChats,
  huellaMensajes,
  inicialesWA,
  juntar,
  juntarChats,
  mensajeErrorMedia,
  mensajeErrorWA,
  MENSAJES_POR_VUELTA,
  nombreChat,
  nombrePersona,
  normalizarChats,
  numeroChat,
  paletaWA,
  previa,
  previaTexto,
  previaWA,
  sondeoListaWA,
  sondeoWA,
  subtituloChat,
  telefonoBonito,
  telefonoValido,
  textoBurbuja,
  totalNoLeidos,
  unirMensajes,
  vistaDe,
} from '../logica.ts';
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
  assert.equal(nombreChat({ nombre: '', jid: '50499990000@s.whatsapp.net' }), '+504 9999-0000', 'el número, bonito');
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
  // Otra cuenta: PULSE2CHAT y Correos (José, 2-oct), sin la página ni la pestaña de WhatsApp.
  assert.match(envoltorio, /conWhatsapp \? \['pulse', 'whatsapp', 'correos', 'cartera'\] : \['pulse', 'correos', 'cartera'\]/);
  assert.match(envoltorio, /\{conWhatsapp \? \(\s*<View style=\{\{ width, flex: 1 \}\}>\s*<PantallaWhatsapp /, 'la página de WhatsApp solo con permiso');
  assert.match(envoltorio, /<PantallaChats onAbrir=\{onAbrir\} onAtras=\{onAtras\} cambio=\{cambio\} \/>/);
  assert.match(envoltorio, /pagingEnabled/, 'se cambia deslizando');
  assert.doesNotMatch(envoltorio, /\.catch\(\(\) => vivo && setEstado\(\{ disponible: false, permitido: false/, 'un fallo de red no esconde WhatsApp');
  assert.match(envoltorio, /setTimeout\(\(\) => preguntar\(intento \+ 1\)/, 'si falla la red, vuelve a preguntar');
  assert.match(envoltorio, /clearTimeout\(espera\)/, 'al salir no queda un reintento colgado');
  const pantalla = leer('whatsapp/PantallaWhatsapp.tsx');
  assert.match(pantalla, /Vincular con el número de teléfono/, 'el código sirve en el mismo teléfono');
  const chat = leer('whatsapp/ConversacionWA.tsx');
  assert.match(chat, /API\.leidoWA/, 'abrir un chat lo marca leído');
  assert.match(chat, /registrarAtras\(/, '«atrás» cierra el chat (y antes la foto o el video)');
  assert.match(chat, /sondeoWA\('listo', true\)/, 'el chat abierto se renueva rápido');
});

prueba('las fotos se bajan con la sesión renovable, no con <Image headers> (la causa de que no cargaran)', () => {
  const leer = (r) => fs.readFileSync(path.join(AQUI, '..', '..', r), 'utf8');
  const todo = ['whatsapp/PantallaWhatsapp.tsx', 'whatsapp/ConversacionWA.tsx', 'whatsapp/PiezasWA.tsx', 'whatsapp/api.ts'].map(leer).join('\n');
  assert.doesNotMatch(todo, /headers:\s*token|source=\{foto\}|fuenteMedia/, 'ya no se pasa el token a <Image> (vence y la foto queda en blanco)');
  const medios = leer('whatsapp/medios.ts');
  assert.match(medios, /r\.status === 401 && intento === 0 && \(await renovarSesion\(\)\)/, 'ante un 401 renueva la sesión y reintenta una vez');
  assert.match(medios, /api\('\/api\/whatsapp\/estado'/, 'renueva como api() (con la clave guardada)');
  assert.match(medios, /colaLimitada\(4\)/, 'las fotos de perfil salen de a cuatro');
  assert.match(medios, /cacheDirectory/, 'se guardan en el caché del teléfono');
  const piezas = leer('whatsapp/PiezasWA.tsx');
  assert.match(piezas, /useMediaWA\(m, !!m\.conMedia\)/, 'la foto se baja sola aunque no traiga miniatura');
  assert.match(piezas, /blurRadius/, 'la miniatura borrosa mientras baja la foto');
});

prueba('números y nombres: nunca vacío, nunca un «@lid» disfrazado de número', () => {
  assert.equal(telefonoBonito('50499998888'), '+504 9999-8888');
  assert.equal(telefonoBonito('+1 305 555 1234'), '+1 305-555-1234');
  assert.equal(telefonoBonito('34612345678'), '+34 612 34 56 78');
  assert.equal(telefonoBonito('hola'), '');
  assert.equal(digitosDeJid('50499998888:12@s.whatsapp.net'), '50499998888', 'sin el aparato');
  assert.equal(digitosDeJid('123456789012345@lid'), '', 'un @lid no es un número de teléfono');
  assert.equal(digitosDeJid('120363000000@g.us'), '');
  assert.equal(nombreChat({ nombre: '', jid: '123456789012345@lid' }), 'Contacto', 'sin número ni nombre: «Contacto», no un número falso');
  assert.equal(nombreChat({ nombre: '', jid: '123456789012345@lid', numero: '+504 9999-8888' }), '+504 9999-8888', 'el número que manda el servidor');
  assert.equal(nombreChat({ nombre: '   ', jid: '120363000000@g.us', grupo: true }), 'Grupo');
  assert.equal(nombreChat({ nombre: '', jid: '' }), 'Contacto');
  assert.equal(nombreChat({ nombre: '', jid: '' }, 'en'), 'Contact');
  assert.equal(nombreChat({ nombre: '50499998888', jid: '50499998888@s.whatsapp.net' }), '+504 9999-8888', 'un nombre que es un número se ve bonito');
  assert.equal(nombreChat({ nombre: 'Familia 2026', jid: 'x@g.us', grupo: true }), 'Familia 2026');
  assert.equal(nombrePersona(''), 'Alguien');
  assert.equal(nombrePersona('50499998888'), '+504 9999-8888');
  assert.equal(numeroChat({ jid: '50499998888@s.whatsapp.net', grupo: false }), '50499998888');
  assert.equal(numeroChat({ jid: 'x@g.us', grupo: true, numero: '+504 1' }), '', 'los grupos no tienen número');
  assert.equal(subtituloChat({ nombre: 'Beto', jid: '50499998888@s.whatsapp.net', grupo: false }), '+504 9999-8888', 'el número debajo del nombre');
  assert.equal(subtituloChat({ nombre: '', jid: '50499998888@s.whatsapp.net', grupo: false }), '', 'si el nombre ya es el número, no se repite');
  assert.equal(subtituloChat({ nombre: 'Familia', jid: 'x@g.us', grupo: true }), 'grupo');
  for (const c of normalizarChats([{ jid: 'a@lid' }, { jid: 'b@g.us', nombre: null }, { jid: '50499998888@s.whatsapp.net', ultimo: null }])) assert.ok(nombreChat(c).length > 0, `nombre para ${c.jid}`);
});

prueba('llamar abre su app de WhatsApp en ese contacto (whatsmeow no llama)', () => {
  assert.equal(digitosLlamada({ jid: '50499998888@s.whatsapp.net', grupo: false }), '50499998888');
  assert.equal(digitosLlamada({ jid: 'x@lid', grupo: false, numero: '+504 9999-8888' }), '50499998888');
  assert.equal(digitosLlamada({ jid: 'x@g.us', grupo: true }), null, 'en grupos no hay botón');
  assert.equal(digitosLlamada({ jid: 'x@lid', grupo: false }), null, 'sin número no hay botón');
  assert.deepEqual(enlacesWhatsapp('50499998888'), { app: 'whatsapp://send?phone=50499998888', web: 'https://wa.me/50499998888' });
  const chat = fs.readFileSync(path.join(AQUI, '..', 'ConversacionWA.tsx'), 'utf8');
  assert.match(chat, /Las llamadas se hacen en tu app de WhatsApp/, 'se explica una vez');
  assert.match(chat, /\{digitos \? \(/, 'sin número (o en grupo) no hay botones de llamar');
});

prueba('las horas como WhatsApp: hoy la hora, «Ayer», si no la fecha; los días del chat', () => {
  const ahora = new Date(2026, 9, 2, 18, 30).getTime();
  assert.equal(horaWA(new Date(2026, 9, 2, 9, 5).getTime()), '09:05');
  assert.equal(horaLista(new Date(2026, 9, 2, 14, 5).getTime(), ahora), '14:05');
  assert.equal(horaLista(new Date(2026, 9, 1, 23, 59).getTime(), ahora), 'Ayer');
  assert.equal(horaLista(new Date(2026, 9, 1, 23, 59).getTime(), ahora, 'en'), 'Yesterday');
  assert.equal(horaLista(new Date(2026, 8, 28, 10, 0).getTime(), ahora), '28/09/26');
  assert.equal(horaLista(0, ahora), '');
  assert.equal(etiquetaDiaWA(new Date(2026, 9, 2, 1, 0).getTime(), ahora), 'Hoy');
  assert.equal(etiquetaDiaWA(new Date(2026, 9, 1, 1, 0).getTime(), ahora), 'Ayer');
  assert.equal(etiquetaDiaWA(new Date(2026, 8, 28, 1, 0).getTime(), ahora), 'Lunes', 'esta semana, el día');
  assert.equal(etiquetaDiaWA(new Date(2026, 8, 2, 1, 0).getTime(), ahora), '2 de septiembre');
  assert.equal(etiquetaDiaWA(new Date(2025, 11, 24, 1, 0).getTime(), ahora), '24 de diciembre de 2025');
});

prueba('la vista previa con su icono (foto, nota de voz, documento, sticker)', () => {
  assert.deepEqual(previaWA({ ultimo: '📷 Foto', ultimoMio: false, grupo: false }), { quien: '', icono: 'foto', texto: 'Foto' });
  assert.deepEqual(previaWA({ ultimo: '📷 Foto · la casa', ultimoMio: false, grupo: true, ultimoDe: 'Mamá' }), { quien: 'Mamá', icono: 'foto', texto: 'la casa' });
  assert.deepEqual(previaWA({ ultimo: '🎤 Nota de voz', ultimoMio: true, grupo: false }), { quien: 'Tú', icono: 'audio', texto: 'Nota de voz' });
  assert.deepEqual(previaWA({ ultimo: '📄 Documento · contrato', ultimoMio: false, grupo: false }), { quien: '', icono: 'documento', texto: 'contrato' });
  assert.equal(previaWA({ ultimo: 'Sticker', ultimoMio: false, grupo: false }).icono, 'sticker');
  assert.deepEqual(previaWA({ ultimo: '🚫 Mensaje eliminado', ultimoMio: true, grupo: false }), { quien: '', icono: 'eliminado', texto: 'Se eliminó este mensaje' });
  assert.deepEqual(previaWA({ ultimo: 'hola\n¿cómo vas?', ultimoMio: false, grupo: false }), { quien: '', icono: null, texto: 'hola ¿cómo vas?' });
  assert.equal(previaWA({ ultimo: '🎤 Nota de voz', ultimoMio: false, grupo: false }, 'en').texto, 'Voice note');
  assert.equal(previaWA({ ultimo: 'x', ultimoMio: false, grupo: true, ultimoDe: '50499998888' }).quien, '+504 9999-8888');
  assert.equal(previaTexto({ ultimo: '📷 Foto', ultimoMio: true, grupo: false }), 'Tú: Foto');
  assert.equal(previaWA({ ultimo: undefined, ultimoMio: false, grupo: false }).texto, '', 'sin último mensaje no se cae');
  assert.equal(etiquetaConDuracion('audio', 12), 'Nota de voz 0:12');
  assert.equal(etiquetaConDuracion('video', 65, 'en'), 'Video 1:05');
});

prueba('el círculo sin foto: iniciales y un color fijo por chat', () => {
  assert.equal(inicialesWA('María José López'), 'ML');
  assert.equal(inicialesWA('beto'), 'B');
  assert.equal(inicialesWA('🙂 Ana'), 'A', 'los emojis no son iniciales');
  assert.equal(inicialesWA('+504 9999-8888'), '', 'un número lleva la silueta');
  assert.equal(inicialesWA(''), '');
  assert.equal(colorAvatar('a@s.whatsapp.net'), colorAvatar('a@s.whatsapp.net'));
  assert.match(colorAvatar('x'), /^#[0-9A-F]{6}$/i);
  assert.notEqual(colorNombre('a', true), undefined);
  assert.match(colorNombre('b', false), /^#[0-9A-F]{6}$/i);
});

prueba('los colores de WhatsApp en claro y oscuro', () => {
  const claro = paletaWA(false);
  const oscuro = paletaWA(true);
  assert.equal(claro.cabecera, '#008069');
  assert.equal(oscuro.cabecera, '#1F2C34');
  assert.equal(claro.chat, '#EFEAE2');
  assert.equal(oscuro.chat, '#0B141A');
  assert.equal(claro.mia, '#D9FDD3');
  assert.equal(oscuro.mia, '#005C4B');
  assert.equal(claro.otra, '#FFFFFF');
  assert.equal(oscuro.otra, '#202C33');
  assert.equal(claro.globo, '#25D366');
});

prueba('cada mensaje con su forma, y el caché con nombres de archivo seguros', () => {
  assert.equal(formaDe({ tipo: 'imagen' }), 'imagen');
  assert.equal(formaDe({ tipo: 'sticker' }), 'sticker');
  assert.equal(formaDe({ tipo: 'texto', eliminado: true }), 'eliminado');
  assert.equal(formaDe({ tipo: 'ubicacion' }), 'otro');
  assert.equal(formaDe({ tipo: '' }), 'texto');
  assert.equal(archivoCache('504@s.whatsapp.net', '3EB0:AB/..', 'imagen'), 'm-504_s.whatsapp.net-3EB0_AB_...jpg');
  assert.equal(archivoCache('c', 'i', 'documento', 'contrato.PDF'), 'm-c-i.pdf');
  assert.equal(archivoCache('c', 'i', 'audio'), 'm-c-i.ogg');
  assert.ok(!/[/@:]/.test(archivoFoto('504@s.whatsapp.net:1')));
});

prueba('lo que se dice cuando una foto no baja', () => {
  assert.match(mensajeErrorMedia(413, ''), /16 MB/);
  assert.match(mensajeErrorMedia(404, 'WhatsApp no lo dio (puede haber vencido): 410 gone'), /ya no lo tiene/);
  assert.match(mensajeErrorMedia(0, ''), /Sin conexión/);
  assert.match(mensajeErrorMedia(401, ''), /sesión/);
  assert.equal(mensajeErrorMedia(502, 'El puente de WhatsApp no contestó (timeout).'), 'El puente de WhatsApp no contestó (timeout).');
  assert.match(mensajeErrorMedia(500, 'HTTP 500'), /No se pudo cargar/);
});

prueba('«Nuevo chat»: los contactos del teléfono abren su conversación (la que ya existe, si la hay)', () => {
  const ks = normalizarContactos([{ jid: '50499998888@s.whatsapp.net', nombre: 'Beto', numero: '+504 9999-8888' }, { nombre: 'sin jid' }, { jid: '50433332222@s.whatsapp.net' }]);
  assert.equal(ks.length, 2);
  assert.deepEqual(ks[1], { jid: '50433332222@s.whatsapp.net', nombre: '', numero: '' });
  assert.equal(normalizarContactos(undefined).length, 0);
  const chats = normalizarChats([{ jid: '1@lid', nombre: 'Beto', numero: '+504 9999-8888', hora: 9, ultimo: 'hola' }]);
  assert.equal(chatDeContacto(ks[0], chats).jid, '1@lid', 'si ya hay chat con ese número, se abre ese');
  const nuevo = chatDeContacto(ks[1], chats);
  assert.equal(nuevo.jid, '50433332222@s.whatsapp.net');
  assert.equal(nuevo.grupo, false);
  assert.equal(nombreChat(nuevo), '+504 3333-2222', 'sin nombre: su número');
  const lista = fs.readFileSync(path.join(AQUI, '..', 'PantallaWhatsapp.tsx'), 'utf8');
  assert.match(lista, /<NuevoChatWA /, 'el botón «Nuevo chat» abre los contactos');
  assert.match(fs.readFileSync(path.join(AQUI, '..', 'api.ts'), 'utf8'), /\/api\/whatsapp\/contactos/);
});

prueba('una foto que ya no está (410) se dice sin «reintentar»; las viejas pueden tardar', () => {
  assert.equal(mensajeErrorMedia(410, 'esa foto ya no está en WhatsApp; ábrela en tu teléfono'), 'Esa foto ya no está en WhatsApp; ábrela en tu teléfono');
  assert.match(mensajeErrorMedia(410, ''), /ya no está en WhatsApp/);
  assert.equal(mediaReintentable(410), false);
  assert.equal(mediaReintentable(413), false);
  assert.equal(mediaReintentable(412), false);
  assert.equal(mediaReintentable(502), true);
  assert.equal(mediaReintentable(0), true);
  assert.match(fs.readFileSync(path.join(AQUI, '..', 'medios.ts'), 'utf8'), /MEDIA_TOPE_MS = 90_000/, 'el puente puede tardar ~80 s en traer una foto vieja');
});

prueba('la fila de espera: a lo más N a la vez, y lo último pedido va primero', async () => {
  const cola = colaLimitada(2);
  let activas = 0;
  let maximo = 0;
  const orden = [];
  const tarea = (n) => () =>
    new Promise((listo) => {
      activas++;
      maximo = Math.max(maximo, activas);
      orden.push(n);
      setTimeout(() => {
        activas--;
        listo(n);
      }, 5);
    });
  const r = await Promise.all([1, 2, 3, 4, 5].map((n) => cola(tarea(n))));
  assert.deepEqual(r, [1, 2, 3, 4, 5]);
  assert.equal(maximo, 2);
  assert.deepEqual(orden, [1, 2, 5, 4, 3], 'con la fila llena, lo recién mostrado va primero');
  await assert.rejects(cola(() => Promise.reject(new Error('x'))));
  assert.equal(await cola(async () => 'sigue'), 'sigue', 'un fallo no traba la fila');
});

prueba('la lista: nunca se cae un chat; buscar por nombre, número o mensaje; chats viejos del servidor', () => {
  const cs = normalizarChats([{ jid: '50499998888@s.whatsapp.net', nombre: 'Beto', ultimo: 'nos vemos', hora: 5 }, { jid: 'a@lid' }, { nombre: 'sin jid' }, null, { jid: 'g@g.us', noLeidos: '3' }]);
  assert.equal(cs.length, 3, 'solo se descarta lo que no tiene jid');
  assert.equal(cs[1].ultimo, '');
  assert.equal(cs[2].grupo, true);
  assert.equal(cs[2].noLeidos, 3);
  assert.equal(normalizarChats(null).length, 0);
  assert.ok(coincide(cs[0], 'beto'));
  assert.ok(coincide(cs[0], '9999 8888'), 'por número, con espacios');
  assert.ok(coincide(cs[0], 'vemos'));
  assert.ok(!coincide(cs[0], 'zzz'));
  assert.ok(coincide(cs[1], ''));
  assert.deepEqual(juntarChats([cs[0]], [cs[0], cs[1]]).map((c) => c.jid), [cs[0].jid, cs[1].jid]);
  assert.notEqual(huellaChats([cs[0]]), huellaChats([{ ...cs[0], noLeidos: 1 }]));
  const m = { id: '1', texto: 'a', tipo: 'texto' };
  assert.equal(huellaMensajes([m]), huellaMensajes([{ ...m }]));
  assert.notEqual(huellaMensajes([m]), huellaMensajes([{ ...m, eliminado: true }]));
  // Codex en #128: una segunda edición del mismo largo, o el nombre del que escribió en un grupo que se
  // resuelve después, también cambian la huella (si no, la conversación abierta se queda con lo viejo).
  const ed = { ...m, texto: 'hola', editado: true, nombreDe: '' };
  assert.notEqual(huellaMensajes([ed]), huellaMensajes([{ ...ed, texto: 'holi' }]));
  assert.notEqual(huellaMensajes([ed]), huellaMensajes([{ ...ed, nombreDe: 'Beto' }]));
  assert.notEqual(huellaChats([{ ...cs[0], ultimo: 'nos vemos' }]), huellaChats([{ ...cs[0], ultimo: 'nos vamos' }]), 'el último mensaje, aunque tenga el mismo largo');
});

/* ── de punta a punta contra el contrato del puente (2-oct, «WhatsApp funcionando al 100») ── */

prueba('puente caído NO es «desvinculado»: no pide vincular otra vez, sigue mostrando lo último y reintenta', () => {
  // server/whatsapp.ts: si el puente no contesta, /api/whatsapp/estado manda vinculado:false CON error.
  const servidor = fs.readFileSync(path.join(AQUI, '..', '..', '..', '..', 'server', 'whatsapp.ts'), 'utf8');
  assert.match(servidor, /vinculado: false, error: String\(e\?\.message \|\| e\)/, 'el contrato: el fallo del puente llega como vinculado:false con error');
  assert.equal(vistaDe({ disponible: true, permitido: true, vinculado: false, error: 'El puente de WhatsApp no contestó (timeout).' }), 'caido');
  assert.equal(vistaDe({ disponible: true, permitido: true, vinculado: false }), 'vincular', 'sin error sí es que no está vinculado');
  assert.equal(sondeoWA('caido', false), 10000, 'reintenta solo, sin martillar');
  const pantalla = fs.readFileSync(path.join(AQUI, '..', 'PantallaWhatsapp.tsx'), 'utf8');
  assert.match(pantalla, /vista === 'caido' && !conLista \? \(/, 'sin chats guardados: «tu WhatsApp no contesta» con reintentar');
  assert.match(pantalla, /const conLista = vista === 'listo' \|\| \(vista === 'caido' && !!chats\?\.length\)/, 'con chats: se siguen viendo');
  assert.match(pantalla, /if \(v === 'vincular'\) \{[\s\S]*?setChats\([\s\S]*?setAbierto\(null\)/, 'desvinculado de verdad: se limpia la lista y se cierra el chat abierto');
});

prueba('la lista tapada por un chat se renueva despacio; el chat abierto, rápido', () => {
  assert.equal(sondeoListaWA('listo', true), 15000);
  assert.equal(sondeoListaWA('listo', false), sondeoWA('listo', false));
  assert.equal(sondeoListaWA('vincular', true), 3000, 'mientras vincula, rápido igual');
  assert.match(fs.readFileSync(path.join(AQUI, '..', 'PantallaWhatsapp.tsx'), 'utf8'), /sondeoListaWA\(vistaRef\.current, !!abiertoRef\.current\)/);
});

prueba('abrir un chat: lo que dice el servidor del chat no borra lo que ya se sabía (un chat nuevo vuelve vacío)', () => {
  const actual = { jid: '50499998888@s.whatsapp.net', nombre: 'Beto', grupo: false, noLeidos: 2, hora: 9, ultimo: 'hola', ultimoMio: false, numero: '+50499998888', foto: true };
  // El puente, para un chat que no tiene guardado, manda el Chat vacío: jid «», foto null.
  assert.equal(fusionarInfoChat(actual, { jid: '', nombre: '', grupo: false, noLeidos: 0, hora: 0, ultimo: '', numero: '', foto: null }), actual);
  assert.equal(fusionarInfoChat(actual, null), actual);
  const f = fusionarInfoChat(actual, { jid: '1@lid', nombre: 'Beto Paz', numero: '', foto: null, grupo: false });
  assert.equal(f.jid, actual.jid, 'el jid con que se abrió no cambia');
  assert.equal(f.nombre, 'Beto Paz', 'el nombre nuevo sí');
  assert.equal(f.numero, '+50499998888', 'un número vacío no borra el que había');
  assert.equal(f.foto, true, 'un null no borra que tiene foto');
  assert.equal(fusionarInfoChat(actual, { jid: 'x', foto: false }).foto, false, 'si ahora no tiene foto, se sabe');
  assert.equal(fusionarInfoChat({ ...actual, grupo: false }, { jid: 'g@g.us', grupo: true }).grupo, true);
  assert.match(fs.readFileSync(path.join(AQUI, '..', 'ConversacionWA.tsx'), 'utf8'), /setInfo\(\(c\) => fusionarInfoChat\(c, r\.chat\)\)/);
});

prueba('subir en un chat trae los mensajes anteriores (?antes=), sin repetir ni desordenar', () => {
  const m = (id, hora) => ({ id, hora, chat: 'c', de: '', nombreDe: '', mio: false, tipo: 'texto', texto: id });
  const viejos = [m('a', 1), m('b', 2), m('c', 3)];
  const recientes = [m('c', 3), m('d', 4)];
  assert.deepEqual(unirMensajes(viejos, recientes).map((x) => x.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(unirMensajes([], recientes).map((x) => x.id), ['c', 'd']);
  // Una edición que llega en la vuelta reciente gana sobre la copia vieja.
  assert.equal(unirMensajes([m('c', 3)], [{ ...m('c', 3), texto: 'editado' }]).find((x) => x.id === 'c').texto, 'editado');
  assert.equal(MENSAJES_POR_VUELTA, 60, 'lo mismo que pide el servidor al puente');
  const chat = fs.readFileSync(path.join(AQUI, '..', 'ConversacionWA.tsx'), 'utf8');
  assert.match(chat, /onEndReached=\{\(\) => void cargarViejos\(\)\}/, 'la lista va invertida: el «final» es arriba');
  assert.match(chat, /API\.mensajesWA\(chat\.jid, masViejo\)/);
  assert.match(fs.readFileSync(path.join(AQUI, '..', 'api.ts'), 'utf8'), /&antes=\$\{Math\.floor\(antes\)\}/);
  const servidor = fs.readFileSync(path.join(AQUI, '..', '..', '..', '..', 'server', 'whatsapp.ts'), 'utf8');
  assert.match(servidor, /mensajesWA\(chat, 60, Number\(req\.query\.antes\) \|\| 0\)/, 'el servidor pasa `antes` al puente');
});

prueba('los errores dichos para la persona: puente caído, desvinculado (412), sesión, sin red', () => {
  assert.match(mensajeErrorWA(503, 'El puente de WhatsApp no contestó (timeout).'), /no contesta ahora/);
  assert.match(mensajeErrorWA(502, 'El puente de WhatsApp no contestó (fetch failed).'), /no contesta ahora/);
  assert.match(mensajeErrorWA(412, 'no hay un WhatsApp vinculado'), /se desvinculó/);
  assert.match(mensajeErrorWA(401, ''), /sesión/);
  assert.match(mensajeErrorWA(0, 'Aborted'), /Sin conexión/);
  assert.equal(mensajeErrorWA(400, 'el mensaje es muy largo (máximo 4000 letras)'), 'El mensaje es muy largo (máximo 4000 letras)');
  assert.match(mensajeErrorWA(500, 'HTTP 500'), /Algo falló/);
  assert.match(mensajeErrorWA(412, '', 'en'), /unlinked/);
  // El mensaje que no salió dice por qué (antes solo «No se envió»).
  const piezas = fs.readFileSync(path.join(AQUI, '..', 'PiezasWA.tsx'), 'utf8');
  assert.match(piezas, /\{m\.fallo\}/);
  assert.match(fs.readFileSync(path.join(AQUI, '..', 'ConversacionWA.tsx'), 'utf8'), /fallo: mensajeErrorWA\(/);
});

prueba('una nota de voz o un video que ya no están (410) se nombran como lo que son', () => {
  assert.match(mensajeErrorMedia(410, 'esa foto ya no está en WhatsApp; ábrela en tu teléfono', 'es', 'audio'), /^Esa nota de voz ya no está/);
  assert.match(mensajeErrorMedia(410, '', 'es', 'video'), /^Ese video ya no está/);
  assert.match(mensajeErrorMedia(410, '', 'es', 'documento'), /^Ese archivo ya no está/);
  assert.equal(mensajeErrorMedia(410, 'esa foto ya no está en WhatsApp; ábrela en tu teléfono', 'es', 'imagen'), 'Esa foto ya no está en WhatsApp; ábrela en tu teléfono');
  assert.match(mensajeErrorMedia(412, '', 'es', 'audio'), /no está vinculado/, '412: no se reintenta');
  assert.match(fs.readFileSync(path.join(AQUI, '..', 'medios.ts'), 'utf8'), /mensajeErrorMedia\(status, e\?\.message, .*?, m\.tipo\)/);
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
