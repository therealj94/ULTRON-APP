/** Una frase, un turno (server/turno-unico.ts): los reintentos de la app no corren otro turno. */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  claveTurno,
  crearTurnosUnicos,
  efectoDelTurno,
  enTurnoUnico,
  idTurnoValido,
  reclamarTurno,
  _olvidarTurnos,
  _cuantosTurnos,
  MAX_TURNOS,
  type TurnoGuardado,
} from '../server/turno-unico';
import { almacenEnMemoria, almacenS3, claveDe, type RegistroLease } from '../lib/durable';
import { conS3Falso } from './s3-condicional-falso';

// Lo durable de los turnos va a una carpeta de prueba (sin S3 configurado, el disco local).
const dirDurable = fs.mkdtempSync(path.join(os.tmpdir(), 'turno-durable-'));
process.env.ULTRON_DURABLE_DIR = dirDurable;
process.env.ULTRON_MEMORIA_BUCKET = '';
after(() => fs.rmSync(dirDurable, { recursive: true, force: true }));

const respuesta = (reply = 'Listo, ya está.'): TurnoGuardado => ({ reply, voz: reply, emocion: 'neutral', via: 'qwen', herramientas: [], acciones: [] });

test('el id: solo un texto corto y limpio; la clave lleva quién habla', () => {
  assert.equal(idTurnoValido('abc12345'), 'abc12345');
  assert.equal(idTurnoValido('corto'), null);
  assert.equal(idTurnoValido(12345678), null);
  assert.equal(idTurnoValido('con espacios dentro'), null);
  assert.equal(claveTurno('Majo@Orden.org', 'abc12345'), 'majo@orden.org|abc12345');
  assert.equal(claveTurno('majo@orden.org', undefined), null, 'sin id, como antes');
  assert.notEqual(claveTurno('a@x.org', 'abc12345'), claveTurno('b@x.org', 'abc12345'), 'el mismo id de otra persona es otro turno');
});

test('sin clave (cliente viejo): siempre se corre', async () => {
  _olvidarTurnos();
  const r = await reclamarTurno(null);
  assert.ok('terminar' in r);
  assert.equal(_cuantosTurnos(), 0);
});

test('el reintento de un turno que ya contestó recibe la misma respuesta, sin correr otro', async () => {
  _olvidarTurnos();
  const clave = claveTurno('majo@orden.org', 'frase-0001');
  const primero = await reclamarTurno(clave);
  assert.ok('terminar' in primero);
  primero.terminar(respuesta('El oro está en 4 163 dólares.'));
  const otra = await reclamarTurno(clave);
  assert.ok('previo' in otra);
  assert.equal(otra.previo.reply, 'El oro está en 4 163 dólares.');
});

test('el reintento de un turno EN CURSO lo espera (no corre uno en paralelo)', async () => {
  _olvidarTurnos();
  const clave = claveTurno('majo@orden.org', 'frase-0002');
  const primero = await reclamarTurno(clave);
  assert.ok('terminar' in primero);
  const reintento = reclamarTurno(clave);
  setTimeout(() => primero.terminar(respuesta('Te escribí a Beto.')), 20);
  const r = await reintento;
  assert.ok('previo' in r, 'esperó al de antes');
  assert.equal(r.previo.reply, 'Te escribí a Beto.');
});

test('si el turno anterior terminó sin respuesta, el reintento corre uno nuevo (para eso reintenta)', async () => {
  _olvidarTurnos();
  const clave = claveTurno('majo@orden.org', 'frase-0003');
  const primero = await reclamarTurno(clave);
  assert.ok('terminar' in primero);
  const reintento = reclamarTurno(clave);
  primero.terminar(null);
  const r = await reintento;
  assert.ok('terminar' in r, 'corre el suyo');
  // Terminar dos veces no cambia nada.
  r.terminar(respuesta('Ahora sí.'));
  r.terminar(null);
  const tercero = await reclamarTurno(clave);
  assert.ok('previo' in tercero && tercero.previo.reply === 'Ahora sí.');
});

test('un turno colgado no deja al reintento esperando para siempre: recibe «en curso», no otro turno', async () => {
  _olvidarTurnos();
  const clave = claveTurno('majo@orden.org', 'frase-0004');
  await reclamarTurno(clave);
  const r = await reclamarTurno(clave, 30);
  assert.ok('enCurso' in r, 'no espera para siempre, pero tampoco corre otro');
});

test('EXEC01: cansarse de esperar no da la propiedad: el original sigue siendo el único dueño y su respuesta es la que vale', async () => {
  _olvidarTurnos();
  const clave = claveTurno('majo@orden.org', 'frase-0005');
  const primero = await reclamarTurno(clave);
  assert.ok('terminar' in primero);
  // Dos reintentos que se cansan de esperar (tiempo acelerado): ninguno se vuelve ejecutor.
  const [a, b] = await Promise.all([reclamarTurno(clave, 20), reclamarTurno(clave, 25)]);
  assert.ok('enCurso' in a && 'enCurso' in b, 'ninguno corre el turno otra vez');
  // El original termina después: su respuesta es la que reciben los reintentos que llegan luego.
  primero.terminar(respuesta('Le mandé el WhatsApp a Beto.'));
  const c = await reclamarTurno(clave, 20);
  assert.ok('previo' in c && c.previo.reply === 'Le mandé el WhatsApp a Beto.');
  assert.equal(_cuantosTurnos(), 1);
});

test('EXEC01: un turno en curso no se poda por tamaño (otro dueño podría entrar)', async () => {
  _olvidarTurnos();
  const clave = claveTurno('majo@orden.org', 'frase-largo-1');
  const primero = await reclamarTurno(clave);
  assert.ok('terminar' in primero);
  for (let i = 0; i < MAX_TURNOS + 20; i++) {
    const r = await reclamarTurno(claveTurno('majo@orden.org', `otra-${String(i).padStart(6, '0')}`));
    if ('terminar' in r) r.terminar(respuesta());
  }
  const r = await reclamarTurno(clave, 10);
  assert.ok('enCurso' in r, 'sigue siendo del primero');
});

test('tamaño acotado', async () => {
  _olvidarTurnos();
  for (let i = 0; i < MAX_TURNOS + 50; i++) {
    const r = await reclamarTurno(claveTurno('majo@orden.org', `frase-${String(i).padStart(6, '0')}`));
    if ('terminar' in r) r.terminar(respuesta());
  }
  assert.ok(_cuantosTurnos() <= MAX_TURNOS);
});

/* ------------------------------------------------------------------ AUR06: reinicio y otra réplica */

test('AUR06 repro: tras un reinicio (el Map se pierde), el mismo idTurno NO corre otra vez mientras el primero sigue', async () => {
  _olvidarTurnos();
  const clave = claveTurno('majo@orden.org', 'reinicio-0001');
  const primero = await reclamarTurno(clave);
  assert.ok('terminar' in primero, 'el primero corre');
  // «Reinicio»: el proceso nuevo no tiene el Map. Antes, aquí el reintento recibía `terminar` y corría el turno dos veces.
  _olvidarTurnos();
  const segundo = await reclamarTurno(clave, 40);
  assert.ok(!('terminar' in segundo), 'el reintento tras el reinicio no corre otro turno');
});

test('AUR06 repro: un turno que ya contestó, tras un reinicio, el reintento recibe la misma respuesta', async () => {
  _olvidarTurnos();
  const clave = claveTurno('majo@orden.org', 'reinicio-0002');
  const primero = await reclamarTurno(clave);
  assert.ok('terminar' in primero);
  await primero.terminar(respuesta('Le escribí a Beto.'));
  _olvidarTurnos();
  const segundo = await reclamarTurno(clave, 40);
  assert.ok('previo' in segundo, 'repite, no corre');
  assert.equal(segundo.previo.reply, 'Le escribí a Beto.');
});

/** Dos «réplicas» (o un proceso viejo y uno nuevo) sobre el mismo almacén, con un reloj que se puede adelantar (`reloj.t += ms`). */
function replicas(almacen = almacenEnMemoria() as ReturnType<typeof almacenEnMemoria> | ReturnType<typeof almacenS3>) {
  const reloj = { t: 0 };
  const cfg = { almacen: () => almacen, leaseMs: 1_000, renovarMs: 60_000, sondeoMs: 5, ahora: () => Date.now() + reloj.t };
  return { reloj, A: crearTurnosUnicos({ ...cfg, proceso: 'replica-A' }), B: crearTurnosUnicos({ ...cfg, proceso: 'replica-B' }), almacen };
}

test('AUR06: dos réplicas (S3 con If-None-Match) reciben el mismo idTurno a la vez: un solo turno corre; la otra repite su respuesta', async () => {
  await conS3Falso(async () => {
    const { A, B } = replicas(almacenS3());
    const clave = claveTurno('majo@orden.org', 'replica-0001');
    const [ra, rb] = await Promise.all([A.reclamarTurno(clave, 2_000), B.reclamarTurno(clave, 2_000)].map(async (p, i) => {
      const r = await p;
      // El que gana corre «el turno» y contesta después de un rato.
      if ('terminar' in r) setTimeout(() => void r.terminar(respuesta(`Lo hizo la réplica ${i ? 'B' : 'A'}.`)), 30);
      return r;
    }));
    const corrieron = [ra, rb].filter((r) => 'terminar' in r).length;
    assert.equal(corrieron, 1, 'solo una réplica corre el turno');
    const otra = [ra, rb].find((r) => !('terminar' in r))!;
    assert.ok('previo' in otra, 'la otra esperó (sondeando el registro) y repite la respuesta');
    assert.match(otra.previo.reply, /^Lo hizo la réplica [AB]\.$/);
  });
});

test('AUR06: el dueño muere SIN haber despachado nada: al vencer su lease, el siguiente corre el turno (es seguro)', async () => {
  const { A, B, reloj } = replicas();
  const clave = claveTurno('majo@orden.org', 'muere-sin-efecto');
  const a = await A.reclamarTurno(clave);
  assert.ok('terminar' in a);
  A.olvidar(); // se murió: no renueva
  const antes = await B.reclamarTurno(clave, 20);
  assert.ok('enCurso' in antes, 'mientras su lease vale, nadie más lo corre');
  reloj.t += 1_500;
  const b = await B.reclamarTurno(clave, 20);
  assert.ok('terminar' in b, 'vencido y sin efectos: se puede correr otra vez');
  await b.terminar(respuesta('Ahora sí.'));
  // El viejo que despierta tarde ya no pisa nada: su efecto y su final no valen.
  assert.equal(await a.terminar.efecto('correo'), false);
  await a.terminar(respuesta('Respuesta vieja.'));
  const c = await A.reclamarTurno(clave, 20);
  assert.ok('previo' in c && c.previo.reply === 'Ahora sí.');
});

test('AUR06: el dueño muere DESPUÉS de despachar un efecto: el siguiente NO lo re-ejecuta, recibe «desconocido»', async () => {
  const { A, B, reloj } = replicas();
  const clave = claveTurno('majo@orden.org', 'muere-con-efecto');
  const a = await A.reclamarTurno(clave);
  assert.ok('terminar' in a);
  assert.equal(await a.terminar.efecto('computadora'), true, 'quedó persistido antes de actuar');
  A.olvidar();
  reloj.t += 1_500;
  const b = await B.reclamarTurno(clave, 20);
  assert.ok('desconocido' in b, 'no se corre a ciegas');
  assert.deepEqual(b.desconocido.efectos, ['computadora']);
  const otra = await B.reclamarTurno(clave, 20);
  assert.ok('desconocido' in otra, 'se queda incierto: tampoco el siguiente reintento lo corre');
});

test('AUR06 fencing: si otro tomó el turno (el dueño se colgó y su lease venció), el viejo no despacha efectos', async () => {
  const { A, B, reloj } = replicas();
  const clave = claveTurno('majo@orden.org', 'colgado-0001');
  const a = await A.reclamarTurno(clave);
  assert.ok('terminar' in a);
  reloj.t += 1_500; // A sigue vivo pero se colgó sin renovar
  const b = await B.reclamarTurno(clave, 20);
  assert.ok('terminar' in b, 'B lo toma (A no había despachado nada)');
  assert.equal(await a.terminar.efecto('whatsapp'), false, 'el token viejo ya no inicia operaciones');
  assert.equal(await b.terminar.efecto('whatsapp'), true);
});

test('AUR06: el lease se renueva mientras el turno corre (un turno largo no se le escapa a su dueño)', async () => {
  const almacen = almacenEnMemoria();
  const T = crearTurnosUnicos({ almacen: () => almacen, leaseMs: 200, renovarMs: 20, sondeoMs: 5, proceso: 'largo' });
  const otro = crearTurnosUnicos({ almacen: () => almacen, leaseMs: 200, renovarMs: 20, sondeoMs: 5, proceso: 'otro' });
  const clave = claveTurno('majo@orden.org', 'largo-00001');
  const a = await T.reclamarTurno(clave);
  assert.ok('terminar' in a);
  await new Promise((r) => setTimeout(r, 450));
  const b = await otro.reclamarTurno(clave, 30);
  assert.ok('enCurso' in b, 'pasado el lease original, sigue siendo del primero (lo renovó)');
  await a.terminar(respuesta('Terminé el largo.'));
  const c = await otro.reclamarTurno(clave, 30);
  assert.ok('previo' in c && c.previo.reply === 'Terminé el largo.');
  T.olvidar();
  otro.olvidar();
});

test('AUR06: terminar sin respuesta libera el turno también para otra réplica', async () => {
  const { A, B } = replicas();
  const clave = claveTurno('majo@orden.org', 'libre-00001');
  const a = await A.reclamarTurno(clave);
  assert.ok('terminar' in a);
  await a.terminar(null);
  const b = await B.reclamarTurno(clave, 20);
  assert.ok('terminar' in b, 'para eso reintenta');
});

test('AUR06: claves por persona: el mismo idTurno de otra persona es otro turno, también en el almacén', async () => {
  const { A, B } = replicas();
  const a = await A.reclamarTurno(claveTurno('a@x.org', 'compartido-1'));
  const b = await B.reclamarTurno(claveTurno('b@x.org', 'compartido-1'));
  assert.ok('terminar' in a && 'terminar' in b);
});

test('AUR06: con el almacén caído al reclamar, el turno corre como antes (solo el cerrojo del proceso)', async () => {
  await conS3Falso(async (s3) => {
    s3.escribe.ok = false;
    const T = crearTurnosUnicos({ almacen: () => almacenS3(), proceso: 'caido' });
    const clave = claveTurno('majo@orden.org', 'caido-00001');
    const a = await T.reclamarTurno(clave);
    assert.ok('terminar' in a && a.terminar.durable === false);
    // Contesta, pero sin registro durable no despacha nada con efecto (revisión externa, 4-oct).
    assert.equal(await a.terminar.efecto('correo'), false);
    const b = await T.reclamarTurno(clave, 20);
    assert.ok('enCurso' in b, 'el cerrojo en vivo sigue funcionando');
  });
});

test('AUR06: efectoDelTurno ve el turno en curso (AsyncLocalStorage); fuera de un turno con id, siempre true', async () => {
  const { A, B, reloj } = replicas();
  assert.equal(await efectoDelTurno('web'), true);
  const clave = claveTurno('majo@orden.org', 'contexto-001');
  const a = await A.reclamarTurno(clave);
  assert.ok('terminar' in a);
  const dentro = await enTurnoUnico(a.terminar, async () => {
    await new Promise((r) => setTimeout(r, 1));
    return efectoDelTurno('mision');
  });
  assert.equal(dentro, true);
  A.olvidar();
  reloj.t += 1_500;
  const b = await B.reclamarTurno(clave, 20);
  assert.ok('desconocido' in b && b.desconocido.efectos[0] === 'mision', 'lo despachado desde dentro quedó persistido');
});

test('AUR06: lo durable del turno va bajo turnos/<huella>/<idTurno> (sin el correo) y lleva token de fencing', async () => {
  const { A, almacen } = replicas();
  const clave = claveTurno('Majo@Orden.org', 'forma-00001');
  const a = await A.reclamarTurno(clave);
  assert.ok('terminar' in a);
  const k = claveDe('turnos', 'majo@orden.org', 'forma-00001');
  const guardado = JSON.parse((almacen as ReturnType<typeof almacenEnMemoria>).objetos.get(k)!);
  assert.equal(guardado.estado, 'en-curso');
  assert.equal(guardado.token, 1);
  assert.equal(guardado.titular, 'replica-A');
  assert.ok(!k.includes('majo'));
  const _tipo: RegistroLease | null = null;
  void _tipo;
});
