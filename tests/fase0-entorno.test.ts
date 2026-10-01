/**
 * Fase 0.2 — el servidor falla cerrado.
 *
 * Antes cada puerta preguntaba `NODE_ENV !== 'production'`: un servidor arrancado SIN `NODE_ENV`
 * abría la mesa a cualquiera, trataba como junta a quien no traía nada, dejaba Dr Electrum sin llave
 * y corría python en el host. Ahora el hueco de desarrollo solo existe con marca explícita
 * (`AURA_DEV=1` o `NODE_ENV=test`, lib/entorno.ts) y `NODE_ENV=production` gana siempre.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { modoDesarrollo } from '../lib/entorno';
import { mesaAutorizada, plataformaAutorizada } from '../server/seguridad';
import { nivelDePeticion } from '../server/nivel';
import { basePublica } from '../server/mcp-oauth';

const VARS = ['NODE_ENV', 'AURA_DEV', 'ULTRON_MESA_CLAVE', 'ELECTRUM_CLAVE', 'URL_PUBLICA'] as const;

function conEntorno<T>(cambios: Partial<Record<(typeof VARS)[number], string | undefined>>, fn: () => T): T {
  const antes = Object.fromEntries(VARS.map((k) => [k, process.env[k]]));
  for (const k of VARS) delete process.env[k];
  for (const [k, v] of Object.entries(cambios)) if (v !== undefined) process.env[k] = v;
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(antes)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
}

const anonimo = () => ({ headers: { host: 'aura.ejemplo' }, body: {}, path: '/api/x', protocol: 'http', get: (h: string) => (h === 'host' ? 'aura.ejemplo' : undefined) }) as any;

test('modoDesarrollo: solo con marca explícita; production gana', () => {
  assert.equal(modoDesarrollo({}), false, 'sin NODE_ENV ya no es desarrollo');
  assert.equal(modoDesarrollo({ NODE_ENV: 'development' }), false, 'development no es una marca');
  assert.equal(modoDesarrollo({ NODE_ENV: 'staging' }), false);
  assert.equal(modoDesarrollo({ AURA_DEV: '1' }), true);
  assert.equal(modoDesarrollo({ AURA_DEV: 'true' }), false, 'solo «1»');
  assert.equal(modoDesarrollo({ NODE_ENV: 'test' }), true);
  assert.equal(modoDesarrollo({ NODE_ENV: 'production', AURA_DEV: '1' }), false);
});

test('sin NODE_ENV y sin llaves: la mesa, la junta y Dr Electrum quedan cerradas', () =>
  conEntorno({}, () => {
    assert.equal(mesaAutorizada(anonimo()), false, 'la mesa no se abre sin sesión');
    assert.equal(nivelDePeticion(anonimo()), 'miembro', 'quien no trae nada no es junta');
    assert.equal(plataformaAutorizada(anonimo(), 'electrum'), false, 'Dr Electrum pide sesión o llave');
    assert.equal(plataformaAutorizada(anonimo(), 'ultron'), false);
    assert.equal(basePublica(anonimo()), 'https://aura.ejemplo', 'OAuth se anuncia en https');
  }));

test('NODE_ENV=production con AURA_DEV=1 olvidado: sigue cerrado', () =>
  conEntorno({ NODE_ENV: 'production', AURA_DEV: '1' }, () => {
    assert.equal(mesaAutorizada(anonimo()), false);
    assert.equal(nivelDePeticion(anonimo()), 'miembro');
    assert.equal(plataformaAutorizada(anonimo(), 'electrum'), false);
  }));

test('con AURA_DEV=1 (tu máquina) el hueco de desarrollo sigue como antes', () =>
  conEntorno({ AURA_DEV: '1' }, () => {
    assert.equal(mesaAutorizada(anonimo()), true);
    assert.equal(nivelDePeticion(anonimo()), 'junta');
    assert.equal(plataformaAutorizada(anonimo(), 'electrum'), true);
    assert.equal(basePublica(anonimo()), 'http://aura.ejemplo');
  }));

test('con llave puesta no hay hueco ni en desarrollo', () =>
  conEntorno({ AURA_DEV: '1', ULTRON_MESA_CLAVE: 'clave-de-mesa-de-prueba-1234567890', ELECTRUM_CLAVE: 'llave-demo-electrum-1234567890' }, () => {
    assert.equal(mesaAutorizada(anonimo()), false);
    assert.equal(nivelDePeticion(anonimo()), 'miembro');
    assert.equal(plataformaAutorizada(anonimo(), 'electrum'), false);
  }));
