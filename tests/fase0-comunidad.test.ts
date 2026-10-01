/**
 * Fase 0, hallazgo de Codex en #104: sacar a alguien del padrón no puede ABRIRLE AU-RA.
 *
 * Antes, un correo que el padrón no conoce caía en «miembro de la comunidad» y abría la mesa. Si a una
 * persona aprobada (o a una cuenta solo de Dr Electrum) la sacaban del padrón, su token firmado seguía
 * vigente 14 días y pasaba a abrir AU-RA. Ahora el miembro de la comunidad lleva la marca firmada en su
 * sesión (la pone AU-RA al dejarlo entrar), y sin ella un correo desconocido no abre nada.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { emitirSesion, mesaAutorizada, sesionAbreAura, sesionDe } from '../server/seguridad';
import { fijarCuentasAprobadas } from '../lib/acceso';

const conToken = (token: string) => ({ headers: { 'x-ultron-sesion': token }, body: {}, path: '/api/turno' }) as any;

function sinLlaves<T>(fn: () => T): T {
  const antes = { NODE_ENV: process.env.NODE_ENV, AURA_DEV: process.env.AURA_DEV, ULTRON_MESA_CLAVE: process.env.ULTRON_MESA_CLAVE };
  process.env.NODE_ENV = 'production';
  delete process.env.AURA_DEV;
  delete process.env.ULTRON_MESA_CLAVE;
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(antes)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
}

test('a quien sacan del padrón, su token vigente ya no le abre AU-RA', () =>
  sinLlaves(() => {
    const correo = 'aprobada.prueba@ejemplo.org';
    fijarCuentasAprobadas([{ id: 'aprobada-prueba', nombre: 'Aprobada', correos: [correo], acceso: { ultron: 'lee' } } as any]);
    const s = emitirSesion({ correo, nombre: 'Aprobada', rol: 'Miembro' });
    assert.equal(mesaAutorizada(conToken(s.token)), true, 'aprobada: abre la mesa');
    fijarCuentasAprobadas([]);
    assert.equal(mesaAutorizada(conToken(s.token)), false, 'sacada del padrón: su token ya no abre');
  }));

test('una cuenta solo de Dr Electrum que borran no pasa a ser miembro de AU-RA', () =>
  sinLlaves(() => {
    const correo = 'solo.electrum.prueba@ejemplo.org';
    fijarCuentasAprobadas([{ id: 'solo-electrum', nombre: 'Ingeniero', correos: [correo], acceso: { electrum: 'lee' } } as any]);
    const s = emitirSesion({ correo, nombre: 'Ingeniero', rol: 'Dr Electrum FP' });
    assert.equal(mesaAutorizada(conToken(s.token)), false, 'solo Electrum: no abre AU-RA');
    fijarCuentasAprobadas([]);
    assert.equal(mesaAutorizada(conToken(s.token)), false, 'borrada: tampoco');
  }));

test('el miembro de la comunidad (sesión marcada por AU-RA) sí abre la mesa', () =>
  sinLlaves(() => {
    const correo = 'miembro.prueba@ejemplo.org';
    const s = emitirSesion({ correo, nombre: 'Miembro', rol: 'Miembro' }, { comunidad: true });
    assert.equal(s.comunidad, true);
    assert.equal(mesaAutorizada(conToken(s.token)), true);
    // Si después lo agregan al padrón sin AU-RA, manda el padrón.
    fijarCuentasAprobadas([{ id: 'miembro-prueba', nombre: 'Miembro', correos: [correo], acceso: { electrum: 'lee' } } as any]);
    assert.equal(mesaAutorizada(conToken(s.token)), false, 'el padrón lo deja fuera de AU-RA');
    fijarCuentasAprobadas([]);
  }));

test('la marca va firmada: no se puede agregar a mano', () =>
  sinLlaves(() => {
    const s = emitirSesion({ correo: 'falsa.prueba@ejemplo.org', nombre: 'Falsa', rol: 'Miembro' });
    const [v, cuerpo, firma] = s.token.split('.');
    const datos = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
    const trucado = `${v}.${Buffer.from(JSON.stringify({ ...datos, com: 1 })).toString('base64url')}.${firma}`;
    assert.equal(sesionDe(conToken(trucado)), null, 'firma rota: no hay sesión');
    assert.equal(mesaAutorizada(conToken(trucado)), false);
    assert.equal(mesaAutorizada(conToken(s.token)), false, 'sin marca y fuera del padrón: no abre');
  }));

test('sesionAbreAura: los códigos temporales nunca, la junta siempre', () => {
  assert.equal(sesionAbreAura('x@temporal.drelectrum', true), false);
  assert.equal(sesionAbreAura('j.ordonez@ordenglobal.org'), true);
  assert.equal(sesionAbreAura('nadie.prueba@ejemplo.org'), false);
  assert.equal(sesionAbreAura('nadie.prueba@ejemplo.org', true), true);
});
