/**
 * Las frases de error de la app de Dr Electrum (mobile/src/electrum/frases.ts).
 *
 * La pantalla enseñaba «Network request failed», «Error 502» o «speech-timeout». Esto fija que cada
 * caso sale como una frase que dice qué pasó y qué hacer, y que ninguna deja pasar el texto técnico.
 * El módulo no importa React Native: se prueba acá, sin teléfono.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ErrorHttp, SinPuerta, fraseDeDictado, fraseDeError, porQueNoAbre } from '../mobile/src/electrum/frases';

/** Lo que nunca debería ver la persona. */
const TECNICO = /network request failed|failed to fetch|error \d{3}|http \d{3}|aborted|typeerror|undefined|speech-timeout|\bnetwork\b|E_LOCATION|ERR_/i;

function sinJerga(frase: string) {
  assert.ok(frase.length > 20, `frase demasiado corta: «${frase}»`);
  assert.doesNotMatch(frase, TECNICO, `se coló jerga: «${frase}»`);
}

test('sin red: el fetch de React Native rechaza con TypeError y sale «revisá la señal»', () => {
  const f = fraseDeError(new TypeError('Network request failed'), 'contestar');
  sinJerga(f);
  assert.match(f, /^No pude contestarte\./);
  assert.match(f, /señal/);
  assert.match(f, /credencial no tiene nada que ver/);
  // El navegador lo dice distinto; la frase es la misma.
  assert.match(fraseDeError(new TypeError('Failed to fetch'), 'foto'), /^No pude subir la foto\. No alcancé el servidor/);
});

test('se cortó por tiempo (AbortController de conTope): «tardó demasiado», no «sin red»', () => {
  const abort = Object.assign(new Error('Aborted'), { name: 'AbortError' });
  const f = fraseDeError(abort, 'contestar');
  sinJerga(f);
  assert.match(f, /tardó demasiado/);
  assert.doesNotMatch(f, /No alcancé/);
});

test('servidor caído (502/503) o con un fallo propio (500): es la plataforma, no la persona', () => {
  for (const status of [502, 503]) {
    const f = fraseDeError(new ErrorHttp(status, 'upstream connect error'), 'contestar');
    sinJerga(f);
    assert.match(f, /no está disponible/);
    assert.match(f, /No es tu credencial ni tu señal/);
    // El detalle del servidor en un 5xx puede ser técnico: no se enseña.
    assert.doesNotMatch(f, /upstream/);
  }
  const f500 = fraseDeError(new ErrorHttp(500, 'TypeError: cannot read properties of undefined'), 'foto');
  sinJerga(f500);
  assert.match(f500, /^No pude subir la foto\. El servidor tuvo un problema/);
  assert.match(fraseDeError(new ErrorHttp(504), 'contestar'), /tardó demasiado/);
});

test('401 de la puerta (SinPuerta): «volvé a entrar»', () => {
  const f = fraseDeError(new SinPuerta(), 'contestar');
  sinJerga(f);
  assert.match(f, /Volvé a entrar/);
});

test('403 dentro es de NIVEL: se enseña el porqué del servidor, y no se echa a nadie', () => {
  const nivel = 'Tu acceso es de consulta: podés mirarlo todo, pero no cargar al cerebro. Pedile a José nivel de trabajo.';
  assert.equal(fraseDeError(new ErrorHttp(403, nivel), 'foto'), nivel);
  const sinDetalle = fraseDeError(new ErrorHttp(403), 'foto');
  sinJerga(sinDetalle);
  assert.match(sinDetalle, /Pedile a José/);
  assert.doesNotMatch(sinDetalle, /Volvé a entrar/);
});

test('en la entrada, 401/403 es «correo o clave», no «sesión caducada»', () => {
  for (const status of [401, 403]) {
    const f = fraseDeError(new ErrorHttp(status, 'unauthorized'), 'entrar');
    sinJerga(f);
    assert.match(f, /correo con esa clave/);
    assert.doesNotMatch(f, /unauthorized/);
  }
});

test('429: si el servidor dice cuánto esperar se enseña; si no, un genérico', () => {
  const conTiempo = 'Demasiados intentos con esta cuenta. Probá de nuevo en 5 minutos.';
  assert.equal(fraseDeError(new ErrorHttp(429, conTiempo), 'entrar'), conTiempo);
  const generico = fraseDeError(new ErrorHttp(429, 'demasiadas peticiones'), 'contestar');
  sinJerga(generico);
  assert.match(generico, /Esperá un minuto/);
});

test('otros 4xx: el motivo del servidor, precedido de qué no se pudo hacer', () => {
  assert.equal(fraseDeError(new ErrorHttp(413, 'La foto es muy pesada. Mandame una más chica.'), 'foto'), 'No pude subir la foto. La foto es muy pesada. Mandame una más chica.');
  const vacio = fraseDeError(new ErrorHttp(400), 'contestar');
  sinJerga(vacio);
  assert.match(vacio, /no aceptó el pedido/);
});

test('ubicación: permiso, GPS apagado, tiempo y lo desconocido', () => {
  const permiso = fraseDeError(Object.assign(new Error('Not authorized to use location services'), { code: 'ERR_LOCATION_UNAUTHORIZED' }), 'ubicacion');
  sinJerga(permiso);
  assert.match(permiso, /permiso de ubicación/);

  const apagado = fraseDeError(Object.assign(new Error('Location is unavailable. Make sure that location services are enabled'), { code: 'ERR_LOCATION_UNAVAILABLE' }), 'ubicacion');
  sinJerga(apagado);
  assert.match(apagado, /GPS está apagado/);

  const ios = fraseDeError(Object.assign(new Error('Location services are disabled'), { code: 'E_LOCATION_SERVICES_DISABLED' }), 'ubicacion');
  assert.equal(ios, apagado);

  const tarde = fraseDeError(new Error('Location request timed out'), 'ubicacion');
  sinJerga(tarde);
  assert.match(tarde, /GPS tardó/);

  const raro = fraseDeError(new Error('something odd'), 'ubicacion');
  sinJerga(raro);
  assert.match(raro, /^No pude fijar tu posición/);
});

test('un error que no se reconoce no enseña su mensaje', () => {
  const f = fraseDeError(new Error('undefined is not a function'), 'contestar');
  sinJerga(f);
  assert.match(f, /^No pude contestarte\. Algo falló/);
  sinJerga(fraseDeError('cadena suelta', 'foto'));
  sinJerga(fraseDeError(null, 'contestar'));
});

test('dictado: cada código del reconocedor es una frase; soltar sin hablar no avisa', () => {
  assert.equal(fraseDeDictado('no-speech'), null);
  assert.equal(fraseDeDictado('aborted'), null);
  const casos: Array<[string, RegExp]> = [
    ['speech-timeout', /No te oí/],
    ['not-allowed', /permiso de micrófono/],
    ['network', /necesita señal/],
    ['audio-capture', /otra app/],
    ['busy', /ocupado/],
    ['language-not-supported', /español/],
    ['interrupted', /llamada/],
    ['client', /El dictado falló/],
    ['cualquier-otro', /El dictado falló/],
  ];
  for (const [codigo, espera] of casos) {
    const f = fraseDeDictado(codigo);
    assert.ok(f, codigo);
    sinJerga(f!);
    assert.match(f!, espera, codigo);
  }
});

test('porQueNoAbre: el código del servidor caído va al registro, no a la pantalla', () => {
  const f = porQueNoAbre({ estado: 'servicio-caido', codigo: 502 });
  sinJerga(f);
  assert.doesNotMatch(f, /502/);
  assert.match(porQueNoAbre({ estado: 'sin-permiso' }), /padrón/);
  assert.match(porQueNoAbre({ estado: 'sin-red' }), /señal/);
  assert.match(porQueNoAbre({ estado: 'lento' }), /doce segundos/);
  assert.equal(porQueNoAbre({ estado: 'abierta' }), '');
});
