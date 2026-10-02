/**
 * Entrar a AU-RA con Genesis ID (server/genesis.ts), contra la ruta de verdad y un Genesis falso.
 *
 * Lo que tiene que ser verdad:
 *   · el pase se le da a Genesis CON el verificador del reto, y con la clave de AU-RA;
 *   · un pase sin destino «aura», o que Genesis rechaza, no abre nada;
 *   · pase válido + persona en el padrón → sesión, sin contraseña;
 *   · pase válido + persona fuera del padrón → entra como MIEMBRO (sesión de comunidad, nunca junta)
 *     y se le abre su cuenta de miembro con el nombre de Genesis;
 *   · el padrón la conoce pero sin AU-RA → NO hay sesión: queda la solicitud para José;
 *   · con AURA_GENESIS_ABIERTO=0, la puerta cerrada de antes: fuera del padrón, solo la solicitud;
 *   · Genesis caído o mal configurado se dice como culpa nuestra (503), no como pase malo.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { montarRutasGenesis, verificarPase, cumpleDeGenesis } from '../server/genesis';

const VERIF = 'v'.repeat(43);
const PERFIL = { verificada: true, nombre: 'ANA MARÍA LÓPEZ' };
type Resp = { status: number; body: any };
let respuesta: Resp = { status: 200, body: {} };
const pedidasAGenesis: any[] = [];

const genesisFalso: typeof fetch = (async (url: any, init: any) => {
  pedidasAGenesis.push({ url: String(url), clave: init?.headers?.['X-API-Key'], cuerpo: JSON.parse(init?.body || '{}') });
  return new Response(JSON.stringify(respuesta.body), { status: respuesta.status, headers: { 'Content-Type': 'application/json' } });
}) as any;

const valido = (extra: Record<string, unknown> = {}) => ({
  status: 200,
  body: { valido: true, gid: 'GEN-ANA1-ANA2-A', correo: 'ana@prueba.local', aud: ['aura', 'pulse2chat'], perfil: PERFIL, ...extra },
});

type Sembrar = (correo: string, g: { nombreGenesis: string; cumple: string | null; apodo: string }) => Promise<unknown>;
type Opciones = {
  sembrarPerfil?: Sembrar;
  registrarMiembro?: (m: { correo: string; nombre: string; gid: string }) => Promise<unknown>;
  /** Correos que el padrón conoce pero SIN acceso a AU-RA (p. ej. solo Dr Electrum). */
  apartados?: string[];
  suspendidas?: string[];
  esperaSembrarMs?: number;
};

async function montar(padron: string[], o: Sembrar | Opciones = {}) {
  const op: Opciones = typeof o === 'function' ? { sembrarPerfil: o } : o;
  const app = express();
  app.use(express.json());
  const solicitudes: any[] = [];
  const sesiones: any[] = [];
  const cuentas: any[] = [];
  const pasa: express.RequestHandler = (_q, _s, n) => n();
  montarRutasGenesis(app, {
    limitar: () => pasa,
    normalizarCorreo: (c) => String(c || '').trim().toLowerCase(),
    tieneAcceso: (c) => padron.includes(c),
    // Como seguridad.esDeComunidad: miembro solo quien el padrón no conoce.
    deComunidad: (c) => !padron.includes(c) && !(op.apartados || []).includes(c),
    suspendida: async (c) => (op.suspendidas || []).includes(c),
    // Como nombreYRolDe del servidor: fuera del padrón, el rol de miembro.
    nombreYRol: (correo, nombre) => ({ nombre: nombre || correo, rol: padron.includes(correo) ? 'AU-RA FP' : 'Miembro · Genesis ID' }),
    emitirSesion: (u, opciones) => {
      sesiones.push({ ...u, comunidad: !!opciones?.comunidad });
      return { token: 'sesion-' + u.correo };
    },
    pedirAcceso: async (s) => {
      solicitudes.push(s);
      return true;
    },
    registrarMiembro:
      op.registrarMiembro ??
      (async (m) => {
        cuentas.push(m);
      }),
    fetch: genesisFalso,
    sembrarPerfil: op.sembrarPerfil,
    esperaSembrarMs: op.esperaSembrarMs,
  });
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const entrar = async (cuerpo: unknown) => {
    const r = await fetch(`${base}/api/genesis/entrar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
    return { status: r.status, body: (await r.json()) as any };
  };
  return { base, entrar, solicitudes, sesiones, cuentas, cerrar: () => new Promise((r) => srv.close(r)) };
}

test.beforeEach(() => {
  process.env.GENESIS_API_KEY_AURA = 'clave-aura';
  delete process.env.AURA_GENESIS_ABIERTO;
  pedidasAGenesis.length = 0;
});

test('en el padrón: entra sin contraseña, y Genesis recibió pase, verificador y la clave de AU-RA', async () => {
  const m = await montar(['ana@prueba.local']);
  try {
    respuesta = valido();
    const r = await m.entrar({ pase: 'PASE', verificador: VERIF });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.token, 'sesion-ana@prueba.local');
    assert.equal(r.body.miembro.gid, 'GEN-ANA1-ANA2-A');
    assert.equal(r.body.miembro.nombre, 'Ana', 'saluda por el primer nombre, no por el nombre legal entero');
    assert.deepEqual(pedidasAGenesis[0].cuerpo, { token: 'PASE', verificador: VERIF });
    assert.equal(pedidasAGenesis[0].clave, 'clave-aura');
    assert.match(pedidasAGenesis[0].url, /\/api\/v1\/sso\/verificar$/);
    assert.equal(m.solicitudes.length, 0);
  } finally {
    await m.cerrar();
  }
});

test('AURA_GENESIS_ABIERTO=0 (puerta cerrada): fuera del padrón no hay sesión, queda la solicitud con el GID', async () => {
  process.env.AURA_GENESIS_ABIERTO = '0';
  const m = await montar([]);
  try {
    respuesta = valido();
    const r = await m.entrar({ pase: 'PASE', verificador: VERIF });
    assert.equal(r.status, 403);
    assert.equal(r.body.codigo, 'PENDIENTE');
    assert.equal(r.body.token, undefined);
    assert.equal(m.sesiones.length, 0);
    assert.equal(m.solicitudes.length, 1);
    assert.equal(m.solicitudes[0].correo, 'ana@prueba.local');
    assert.match(m.solicitudes[0].motivo, /GEN-ANA1-ANA2-A/);
    assert.equal(m.cuentas.length, 0, 'con la puerta cerrada no se abre cuenta de miembro');
  } finally {
    await m.cerrar();
  }
});

test('AURA_GENESIS_ABIERTO=1 (lo de antes) sigue abriendo', async () => {
  process.env.AURA_GENESIS_ABIERTO = '1';
  const m = await montar([]);
  try {
    respuesta = valido();
    const r = await m.entrar({ pase: 'PASE', verificador: VERIF });
    assert.equal(r.status, 200);
    assert.equal(m.solicitudes.length, 0);
  } finally {
    await m.cerrar();
  }
});

test('lo que no abre nada', async () => {
  const m = await montar(['ana@prueba.local']);
  try {
    respuesta = valido({ aud: undefined });
    assert.equal((await m.entrar({ pase: 'PASE', verificador: VERIF })).body.codigo, 'PASE_INVALIDO', 'pase sin destino');
    respuesta = valido({ aud: ['ordenex'] });
    assert.equal((await m.entrar({ pase: 'PASE', verificador: VERIF })).body.codigo, 'PASE_INVALIDO', 'pase para otra app');
    respuesta = { status: 401, body: { valido: false, codigo: 'USADO' } };
    const usado = await m.entrar({ pase: 'PASE', verificador: VERIF });
    assert.equal(usado.status, 401);
    assert.equal(usado.body.codigo, 'PASE_INVALIDO');
    respuesta = valido({ perfil: { ...PERFIL, verificada: false } });
    assert.equal((await m.entrar({ pase: 'PASE', verificador: VERIF })).body.codigo, 'SIN_VERIFICAR');
    const sinVerif = await m.entrar({ pase: 'PASE', verificador: 'corto' });
    assert.equal(sinVerif.status, 400, 'sin verificador ni se le pregunta a Genesis');
    assert.equal(m.sesiones.length, 0);
  } finally {
    await m.cerrar();
  }
});

test('Genesis caído o la clave mal configurada: 503, culpa nuestra', async () => {
  respuesta = { status: 502, body: {} };
  assert.deepEqual(await verificarPase('P', VERIF, genesisFalso), { estado: 503, codigo: 'GENESIS_CAIDO', detalle: 'HTTP 502' });
  respuesta = valido({ perfil: undefined });
  assert.equal(((await verificarPase('P', VERIF, genesisFalso)) as any).codigo, 'MAL_CONFIGURADO');
  const roto: typeof fetch = (async () => {
    throw new Error('sin red');
  }) as any;
  assert.equal(((await verificarPase('P', VERIF, roto)) as any).codigo, 'GENESIS_CAIDO');
  delete process.env.GENESIS_API_KEY_AURA;
  delete process.env.GENESIS_API_KEY;
  assert.equal(((await verificarPase('P', VERIF, genesisFalso)) as any).codigo, 'SIN_GENESIS');
});

test('la configuración que ve la app no lleva nada secreto', async () => {
  const m = await montar([]);
  try {
    const r = await fetch(`${m.base}/api/genesis/config`);
    const j: any = await r.json();
    assert.deepEqual(Object.keys(j).sort(), ['abierto', 'disponible', 'walletWeb']);
    assert.equal(j.disponible, true);
    assert.match(j.walletWeb, /#sso-aura$/);
    assert.doesNotMatch(JSON.stringify(j), /clave-aura/);
  } finally {
    await m.cerrar();
  }
});

test('nombre completo y cumple (alcance gid.cumple): vuelven en genesis {nombre, cumple} y siembran el perfil', async () => {
  const sembrados: any[] = [];
  const m = await montar(['ana@prueba.local'], async (correo, g) => {
    sembrados.push({ correo, ...g });
  });
  try {
    respuesta = valido({ perfil: { ...PERFIL, cumple: '03-14' } });
    const r = await m.entrar({ pase: 'PASE', verificador: VERIF });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.genesis, { nombre: 'Ana María López', cumple: '03-14' });
    assert.equal(r.body.miembro.nombre, 'Ana', 'el saludo sigue con el primer nombre');
    assert.deepEqual(sembrados, [{ correo: 'ana@prueba.local', nombreGenesis: 'Ana María López', cumple: '03-14', apodo: 'Ana' }]);

    // Sin el alcance (Genesis no manda cumple), nada: ni se inventa ni falla.
    respuesta = valido();
    const sin = await m.entrar({ pase: 'PASE', verificador: VERIF });
    assert.deepEqual(sin.body.genesis, { nombre: 'Ana María López', cumple: null });
    assert.equal(sembrados.at(-1).cumple, null);
  } finally {
    await m.cerrar();
  }
});

test('si sembrar el perfil falla, igual entra; y con la puerta cerrada, fuera del padrón no se siembra nada', async () => {
  let llamadas = 0;
  const m = await montar(['ana@prueba.local'], async () => {
    llamadas++;
    throw new Error('disco lleno');
  });
  try {
    respuesta = valido({ perfil: { ...PERFIL, cumple: '03-14' } });
    const r = await m.entrar({ pase: 'PASE', verificador: VERIF });
    assert.equal(r.status, 200);
    assert.ok(r.body.token);
    assert.equal(llamadas, 1);
  } finally {
    await m.cerrar();
  }
  llamadas = 0;
  process.env.AURA_GENESIS_ABIERTO = '0';
  const fuera = await montar([], async () => {
    llamadas++;
  });
  try {
    respuesta = valido({ perfil: { ...PERFIL, cumple: '03-14' } });
    assert.equal((await fuera.entrar({ pase: 'PASE', verificador: VERIF })).status, 403);
    assert.equal(llamadas, 0, 'las reglas de acceso no cambian: sin acceso no hay perfil');
  } finally {
    await fuera.cerrar();
  }
});

test('el cumple de Genesis: solo MM-DD válido (de una fecha entera se toma mes y día)', () => {
  assert.equal(cumpleDeGenesis('03-14'), '03-14');
  assert.equal(cumpleDeGenesis('1994-03-14'), '03-14');
  assert.equal(cumpleDeGenesis('02-30'), null);
  assert.equal(cumpleDeGenesis('14/03'), null);
  assert.equal(cumpleDeGenesis(undefined), null);
  assert.equal(cumpleDeGenesis(314), null);
});

test('entrar no espera a que S3 termine de sembrar el perfil: pasado el tope entra y el sembrado sigue', async () => {
  let terminado = false;
  const m = await montar(['ana@prueba.local'], () => new Promise<void>((r) => setTimeout(() => ((terminado = true), r()), 8000).unref()));
  try {
    respuesta = valido({ perfil: { ...PERFIL, cumple: '03-14' } });
    const t0 = Date.now();
    const r = await m.entrar({ pase: 'PASE', verificador: VERIF });
    const ms = Date.now() - t0;
    assert.equal(r.status, 200);
    assert.ok(r.body.token);
    assert.ok(ms < 3000, `entró en ${ms} ms (antes esperaba al GET y al PUT de S3, hasta 12 s cada uno)`);
    assert.equal(terminado, false, 'el sembrado sigue en segundo plano');
  } finally {
    await m.cerrar();
  }
});

/* ------------------------------------------------------------------ cualquiera con wallet + Genesis ID */

test('sin variable (por omisión): quien no está en el padrón entra como MIEMBRO, con su cuenta y su apodo', async () => {
  const sembrados: any[] = [];
  const m = await montar([], { sembrarPerfil: async (correo, g) => void sembrados.push({ correo, ...g }) });
  try {
    respuesta = valido({ correo: 'Ana@Prueba.Local' });
    const r = await m.entrar({ pase: 'PASE', verificador: VERIF });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.token, 'sesion-ana@prueba.local');
    assert.equal(r.body.nivel, 'miembro');
    assert.equal(r.body.miembro.rol, 'Miembro · Genesis ID', 'nunca el rol de la junta');
    assert.equal(r.body.miembro.nombre, 'Ana');
    assert.equal(m.sesiones.length, 1);
    assert.equal(m.sesiones[0].comunidad, true, 'la sesión lleva firmada la marca de comunidad');
    assert.deepEqual(m.cuentas, [{ correo: 'ana@prueba.local', nombre: 'Ana María López', gid: 'GEN-ANA1-ANA2-A' }]);
    assert.equal(sembrados[0].apodo, 'Ana', 'el apodo del perfil: el primer nombre de Genesis');
    assert.equal(m.solicitudes.length, 0, 'no hace falta aprobar a nadie');
  } finally {
    await m.cerrar();
  }
});

test('la configuración dice abierto por omisión, y cerrado con 0 / false / no', async () => {
  const m = await montar([]);
  try {
    const leer = async () => ((await (await fetch(`${m.base}/api/genesis/config`)).json()) as any).abierto;
    assert.equal(await leer(), true);
    for (const v of ['0', 'false', 'NO', ' cerrado ']) {
      process.env.AURA_GENESIS_ABIERTO = v;
      assert.equal(await leer(), false, v);
    }
    process.env.AURA_GENESIS_ABIERTO = '1';
    assert.equal(await leer(), true);
  } finally {
    await m.cerrar();
  }
});

test('en el padrón: entra como siempre, sin marca de comunidad y sin cuenta de miembro', async () => {
  const m = await montar(['ana@prueba.local']);
  try {
    respuesta = valido();
    const r = await m.entrar({ pase: 'PASE', verificador: VERIF });
    assert.equal(r.status, 200);
    assert.equal(r.body.nivel, 'junta');
    assert.equal(m.sesiones[0].comunidad, false);
    assert.equal(m.cuentas.length, 0, 'la cuenta de quien está en el padrón no se toca');
  } finally {
    await m.cerrar();
  }
});

test('el padrón lo conoce pero sin AU-RA (solo Dr Electrum): no se emite una sesión que no abre nada; queda la solicitud', async () => {
  const m = await montar([], { apartados: ['ana@prueba.local'] });
  try {
    respuesta = valido();
    const r = await m.entrar({ pase: 'PASE', verificador: VERIF });
    assert.equal(r.status, 403);
    assert.equal(r.body.codigo, 'PENDIENTE');
    assert.equal(m.sesiones.length, 0);
    assert.equal(m.cuentas.length, 0);
    assert.equal(m.solicitudes.length, 1);
  } finally {
    await m.cerrar();
  }
});

test('suspendida: no entra ni como miembro', async () => {
  const m = await montar([], { suspendidas: ['ana@prueba.local'] });
  try {
    respuesta = valido();
    const r = await m.entrar({ pase: 'PASE', verificador: VERIF });
    assert.equal(r.status, 403);
    assert.equal(r.body.codigo, 'SUSPENDIDA');
    assert.equal(m.sesiones.length, 0);
    assert.equal(m.cuentas.length, 0);
  } finally {
    await m.cerrar();
  }
});

test('abrir la puerta no relaja el pase: usado, para otra app, sin reto o sin verificar no abre cuenta ni sesión', async () => {
  const m = await montar([]);
  try {
    respuesta = { status: 401, body: { valido: false, codigo: 'USADO' } };
    assert.equal((await m.entrar({ pase: 'PASE', verificador: VERIF })).body.codigo, 'PASE_INVALIDO', 'pase ya gastado');
    respuesta = { status: 401, body: { valido: false, codigo: 'RETO' } };
    assert.equal((await m.entrar({ pase: 'PASE', verificador: VERIF })).body.codigo, 'PASE_INVALIDO', 'verificador que no es el del reto');
    respuesta = valido({ aud: ['pulse2chat'] });
    assert.equal((await m.entrar({ pase: 'PASE', verificador: VERIF })).body.codigo, 'PASE_INVALIDO', 'pase sin destino aura');
    respuesta = valido({ aud: undefined });
    assert.equal((await m.entrar({ pase: 'PASE', verificador: VERIF })).body.codigo, 'PASE_INVALIDO', 'pase sin destino');
    respuesta = valido({ perfil: { ...PERFIL, verificada: false } });
    assert.equal((await m.entrar({ pase: 'PASE', verificador: VERIF })).body.codigo, 'SIN_VERIFICAR', 'identidad sin verificar (o bloqueada)');
    assert.equal((await m.entrar({ pase: 'PASE' })).status, 400, 'sin verificador ni se le pregunta a Genesis');
    assert.equal(m.sesiones.length, 0);
    assert.equal(m.cuentas.length, 0);
    // Y el verificador viaja a Genesis siempre: es Genesis quien compara el reto.
    assert.ok(pedidasAGenesis.every((p) => p.cuerpo.verificador === VERIF));
  } finally {
    await m.cerrar();
  }
});

test('si abrir la cuenta de miembro falla o tarda, igual entra (con tope)', async () => {
  const falla = await montar([], { registrarMiembro: async () => Promise.reject(new Error('base caída')) });
  try {
    respuesta = valido();
    const r = await falla.entrar({ pase: 'PASE', verificador: VERIF });
    assert.equal(r.status, 200);
    assert.equal(falla.sesiones[0].comunidad, true);
  } finally {
    await falla.cerrar();
  }
  const lenta = await montar([], {
    registrarMiembro: () => new Promise<void>((r) => setTimeout(r, 8000).unref()),
    esperaSembrarMs: 200,
  });
  try {
    respuesta = valido();
    const t0 = Date.now();
    const r = await lenta.entrar({ pase: 'PASE', verificador: VERIF });
    assert.equal(r.status, 200);
    assert.ok(Date.now() - t0 < 3000);
  } finally {
    await lenta.cerrar();
  }
});
