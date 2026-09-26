/**
 * La lógica de la pantalla del campo de la app de Dr Electrum (mobile/src/electrum/campo.ts).
 *
 * Cada prueba fija un fallo que se vio en el banco de pruebas del teléfono
 * (scripts/qa/electrum-movil/capturas.mjs) contra las formas reales que devuelve server.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  avisosVisibles,
  conPlazo,
  hiloParaMandar,
  informeDe,
  lineaDeEstado,
  nombreDeCarpeta,
  nombreDeFoto,
  nombreDeNivel,
  PlazoVencido,
  puedeCargar,
  rutaDeInforme,
  tamanoLegible,
  type TurnoCampo,
} from '../mobile/src/electrum/campo';
import { ErrorHttp, fraseDeError, SIN_NIVEL_PARA_CARGAR } from '../mobile/src/electrum/frases';

test('el hilo que viaja no lleva los fallos: ni la frase de error ni la pregunta que no llegó', () => {
  const turnos: TurnoCampo[] = [
    { de: 'persona', texto: '¿qué vence este año?' },
    { de: 'doctor', texto: 'Vencen tres: …', panel: 'Legal Minero' },
    { de: 'persona', texto: '¿y el segundo?', fallo: true },
    { de: 'doctor', texto: 'No pude contestarte. No alcancé el servidor…', fallo: true },
    { de: 'persona', texto: '(foto: foto-20260926-103000.jpg)' },
    { de: 'doctor', texto: 'Leí la foto y saqué 1.284 caracteres…' },
  ];
  assert.deepEqual(hiloParaMandar(turnos), [
    { de: 'persona', texto: '¿qué vence este año?' },
    { de: 'doctor', texto: 'Vencen tres: …' },
    { de: 'persona', texto: '(foto: foto-20260926-103000.jpg)' },
    { de: 'doctor', texto: 'Leí la foto y saqué 1.284 caracteres…' },
  ]);
  assert.deepEqual(hiloParaMandar([]), []);
  assert.deepEqual(hiloParaMandar([{ de: 'doctor', texto: '   ' }]), []);
});

test('la barra no enseña el error de Postgres ni una dirección interna', () => {
  // La forma de GET /api/electrum/salud con el catastro caído (`...saludBase()` en server.ts).
  const caido = { viva: false, motivo: 'connect ECONNREFUSED 10.208.3.14:5432', quien: 'José', nivel: 'mando' as const };
  const l = lineaDeEstado(caido);
  assert.equal(l, 'catastro fuera de línea · mando');
  assert.doesNotMatch(l, /ECONNREFUSED|10\.208|5432/);
  assert.equal(lineaDeEstado({ viva: false, motivo: 'sin ELECTRUM_DB_URL', nivel: 'escribe' }), 'catastro sin configurar · trabajo');
  assert.equal(lineaDeEstado({ viva: true, concesiones: 1043, nivel: 'mando' }), 'catastro conectado · 1043 concesiones · mando');
  assert.equal(lineaDeEstado({ viva: true, concesiones: null, nivel: 'lee' }), 'catastro conectado · consulta');
  assert.equal(lineaDeEstado(null), 'comprobando…');
  assert.match(lineaDeEstado('fallo'), /tocá para reintentar/);
});

test('la llave de demostración entra sin nivel y la barra dice «consulta»', () => {
  // `nivelDe(null)` en lib/acceso.ts: la llave no identifica a nadie, así que el nivel es null.
  assert.equal(nombreDeNivel(null), 'consulta');
  assert.equal(nombreDeNivel(undefined), 'consulta');
  assert.equal(nombreDeNivel('lee'), 'consulta');
  assert.equal(nombreDeNivel('escribe'), 'trabajo');
  assert.equal(nombreDeNivel('mando'), 'mando');
});

test('cargar una foto: se avisa antes solo cuando el servidor SEGURO la va a rechazar', () => {
  // /api/electrum/subir exige `puedeEscribir` (nivel escribe o mando).
  assert.equal(puedeCargar({ viva: true, nivel: null }), false);
  assert.equal(puedeCargar({ viva: true, nivel: 'lee' }), false);
  assert.equal(puedeCargar({ viva: false, nivel: 'escribe' }), true);
  assert.equal(puedeCargar({ viva: true, nivel: 'mando' }), true);
  // Sin saber (cargando o sin servidor), se deja intentar: decide el servidor.
  assert.equal(puedeCargar(null), null);
  assert.equal(puedeCargar('fallo'), null);
  assert.match(SIN_NIVEL_PARA_CARGAR, /consulta/);
  assert.match(SIN_NIVEL_PARA_CARGAR, /pedile a José/);
});

test('el nombre de la foto va en hora local y sin separadores a medias', () => {
  const d = new Date(2026, 8, 26, 9, 5, 7); // 26-sep-2026 09:05:07, hora del teléfono
  assert.equal(nombreDeFoto(d), 'foto-20260926-090507.jpg');
  assert.match(nombreDeFoto(new Date()), /^foto-\d{8}-\d{6}\.jpg$/);
});

test('de lo que avisa /subir se enseña lo útil, no el registro técnico', () => {
  const avisos = [
    { nivel: 'ojo', texto: 'Leído con gemini. Es una transcripción de una foto, no el documento original.' },
    { nivel: 'error', texto: 'visión: nodo-caído' },
    { nivel: 'info', texto: '  ' },
  ];
  assert.deepEqual(avisosVisibles(avisos), ['Leído con gemini. Es una transcripción de una foto, no el documento original.']);
  assert.deepEqual(avisosVisibles(undefined), []);
  assert.deepEqual(avisosVisibles('nada'), []);
});

test('el informe que arma `informe_pdf` se reconoce en el `ui` del turno', () => {
  // Lo que devuelve la herramienta (server/electrum/manos.ts) dentro de `ui`, junto a órdenes de mapa.
  const ui = [
    { accion: 'volar', concesion_id: 12, centro: [-87, 13] },
    { informe: { id: 'mfk2x9a1b2c3d4', nombre: 'Informe-Quebrada-Seca-II.pdf', url: '/api/electrum/informe/mfk2x9a1b2c3d4', bytes: 318422 } },
  ];
  assert.deepEqual(informeDe(ui), { id: 'mfk2x9a1b2c3d4', nombre: 'Informe-Quebrada-Seca-II.pdf', url: '/api/electrum/informe/mfk2x9a1b2c3d4', bytes: 318422 });
  assert.equal(informeDe([]), null);
  assert.equal(informeDe(undefined), null);
  assert.equal(informeDe([{ informe: 'no' }]), null);
});

test('la credencial solo viaja a una ruta de informe del propio servidor', () => {
  assert.equal(rutaDeInforme('/api/electrum/informe/abc123XY'), '/api/electrum/informe/abc123XY');
  for (const malo of ['https://otro.sitio/api/electrum/informe/abc123', '/api/electrum/informe/../salud', '/api/electrum/informe/abc?x=1', '//evil/api/electrum/informe/abcd', '', null]) {
    assert.equal(rutaDeInforme(malo), null, String(malo));
  }
  assert.equal(informeDe([{ informe: { id: 'x1', nombre: 'a.pdf', url: 'https://evil.example/robar', bytes: 10 } }]), null);
});

test('tamaño y carpeta, como se le dicen a la persona', () => {
  assert.equal(tamanoLegible(318422), '311 KB');
  assert.equal(tamanoLegible(512), '1 KB');
  assert.equal(tamanoLegible(1_468_006), '1,4 MB');
  assert.equal(tamanoLegible(0), '');
  assert.equal(nombreDeCarpeta('content://com.android.externalstorage.documents/tree/primary%3ADownload%2FInformes'), 'Download/Informes');
  assert.equal(nombreDeCarpeta('content://com.android.externalstorage.documents/tree/1A2B-3C4D%3ADocuments'), 'Documents');
  assert.equal(nombreDeCarpeta('rara'), 'la carpeta que elegiste');
});

test('el GPS con plazo: si no fija, sale un error que frases.ts lee como «tardó», no como otra cosa', async () => {
  const nunca = new Promise<number>(() => {});
  await assert.rejects(conPlazo(nunca, 20, 'GPS'), (e: unknown) => {
    assert.ok(e instanceof PlazoVencido);
    assert.equal(fraseDeError(e, 'ubicacion'), 'El GPS tardó demasiado en fijar la posición. Probá en un lugar más abierto.');
    return true;
  });
  assert.equal(await conPlazo(Promise.resolve(7), 1000), 7);
  await assert.rejects(conPlazo(Promise.reject(new Error('Location services are disabled')), 1000), /disabled/);
});

test('las frases nuevas: la cámara no es la subida, y el informe caducado dice por qué', () => {
  const cam = fraseDeError(new Error('Camera is not running'), 'camara');
  assert.match(cam, /^No pude tomar la foto\./);
  assert.doesNotMatch(cam, /señal/);
  const caducado = 'Ese informe ya no está. Se guardan media hora porque describen el catastro del momento; pedime otro.';
  assert.equal(fraseDeError(new ErrorHttp(404, caducado), 'informe'), `No pude guardar el informe. ${caducado}`);
});
