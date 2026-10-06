/**
 * Revisión del 6-oct (bloqueante 2, «ningún dato privado para invitados»): server/modo-invitado.ts, el corte único.
 * Cuándo es invitado (voz conocida que no es la dueña, la precaución `reciente`, la escena, o una voz desconocida con
 * la de la dueña guardada), qué se le quita al cuerpo del turno y qué herramientas quedan. El prompt de verdad, con el
 * servidor de verdad: tests/modo-invitado-servidor.test.ts. Datos sintéticos.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modo-invitado-'));
process.env.ULTRON_VOCES_DIR = path.join(dir, 'voces');
process.env.ULTRON_MEMORIA_BUCKET = '';
process.env.COMPUTADORA_URL = 'http://127.0.0.1:9';
process.env.COMPUTADORA_CLAVE = 'clave-de-prueba';
process.env.CORREO_CLAVE_CIFRADO = 'llave-de-prueba';
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const MI = await import('../server/modo-invitado');
const V = await import('../lib/voces-miembro');
const { MODELO_VOZ } = await import('../lib/voces-motor');
const { herramientasDelTurno } = await import('../lib/cerebro-manos');
const { construirMensajes } = await import('../lib/qwen');

const DUENA = 'duena-invitado@ejemplo.test';
const sesion = { correo: DUENA, nombre: 'Marta' };
const huella = (k: number) => Array.from({ length: MODELO_VOZ.dim }, (_, i) => (i === k ? 0.9 : 0.01));
const alta = (relacion: 'yo' | 'conocido', nombre = '') => {
  const a = V.validarAltaVoz({ nombre, relacion, consentimiento: relacion === 'yo' ? { como: 'dueño' } : { como: 'voz', frase: 'sí' } }, 'Marta');
  assert.ok(a.ok);
  return a as any;
};
const yo = await V.agregarVoz(DUENA, alta('yo'), [huella(1)]);
const ana = await V.agregarVoz(DUENA, alta('conocido', 'Ana'), [huella(2)]);

/** Un cuerpo de turno de la app de Marta, con todo lo privado que puede traer. */
const cuerpo = (extra: Record<string, unknown> = {}) => ({
  message: '¿qué tengo pendiente hoy?',
  origen: 'app',
  hablado: true,
  sesion,
  correo: DUENA,
  usuario: 'Marta',
  nivel: 'junta',
  memoria: ['Marta toma pastillas para la presión a las 8'],
  historial: [{ rol: 'user', texto: 'léeme el correo del banco' }, { rol: 'ultron', texto: 'Tu saldo es 12 000' }],
  interrumpido: { oido: 'Tu saldo es' },
  decisionVista: { tareaId: 'tk', decisionId: 'dc', huella: 'f'.repeat(64) },
  aparato: 'tel-1',
  idioma: 'es',
  ...extra,
});

test('cuándo es invitado: voz conocida que no es la dueña, la precaución, la escena o una voz desconocida; la dueña o lo escrito, no', async () => {
  assert.deepEqual(await MI.modoInvitadoDelTurno(cuerpo({ quienHabla: { id: ana.id } })), { motivo: 'voz-conocida', quien: 'Ana' });
  assert.deepEqual(await MI.modoInvitadoDelTurno(cuerpo({ quienHabla: { id: ana.id, reciente: true } })), { motivo: 'voz-reciente', quien: 'Ana' });
  assert.deepEqual(await MI.modoInvitadoDelTurno(cuerpo({ quienHabla: { desconocida: true } })), { motivo: 'voz-desconocida' });
  assert.deepEqual(await MI.modoInvitadoDelTurno(cuerpo({ escena: 'Por la voz, habla Ana (tu amiga), no Marta. Una sala.' })), { motivo: 'escena' });
  // La dueña misma (su id de voz), sin señal (un turno escrito), o una señal que no viene de la app con sesión: no.
  assert.equal(await MI.modoInvitadoDelTurno(cuerpo({ quienHabla: { id: yo.id } })), null);
  assert.equal(await MI.modoInvitadoDelTurno(cuerpo({ hablado: false })), null);
  assert.equal(await MI.modoInvitadoDelTurno(cuerpo({ quienHabla: { desconocida: true }, origen: undefined })), null, 'la web no lo manda');
  assert.equal(await MI.modoInvitadoDelTurno(cuerpo({ quienHabla: { desconocida: true }, sesion: null })), null, 'sin sesión no hay dueña');
  // Revisión 7 (G2): un id que el teléfono da como «no es la dueña» y no se puede comprobar (ya no está en su cajón): invitado.
  assert.deepEqual(await MI.modoInvitadoDelTurno(cuerpo({ quienHabla: { id: 'no-existe' } })), { motivo: 'voz-incierta' }, 'sin comprobar, invitado (antes: la dueña)');
});

test('revisión 7 (G2): la voz sin confirmar (`incierta`) es invitado; el cajón lento (>800 ms) o S3 que falla no hacen dueña a una voz ajena', async () => {
  assert.deepEqual(await MI.modoInvitadoDelTurno(cuerpo({ quienHabla: { incierta: true } })), { motivo: 'voz-incierta' });
  assert.equal(await MI.modoInvitadoDelTurno(cuerpo({ quienHabla: { incierta: true }, origen: undefined })), null, 'solo desde la app con sesión');
  assert.equal(await MI.modoInvitadoDelTurno(cuerpo({ quienHabla: { incierta: true }, sesion: null })), null);
  // El cajón tarda más de 800 ms (S3 lento tras un reinicio): antes, la voz de Ana contaba como la dueña.
  V._olvidarCacheVoces();
  V._s3LecturaDePrueba({ listo: () => true, get: (() => new Promise((r) => setTimeout(() => r({ ok: true, json: null, detalle: '', missing: true }), 1500))) as any });
  try {
    assert.deepEqual(await MI.modoInvitadoDelTurno(cuerpo({ quienHabla: { id: ana.id } })), { motivo: 'voz-incierta' }, 'lento: invitado');
    V._olvidarCacheVoces();
    V._s3LecturaDePrueba({ listo: () => true, get: (async () => ({ ok: false, json: null, detalle: 'S3 503' })) as any });
    assert.deepEqual(await MI.modoInvitadoDelTurno(cuerpo({ quienHabla: { id: ana.id } })), { motivo: 'voz-incierta' }, 'S3 falla: invitado');
  } finally {
    V._s3LecturaDePrueba(null);
    V._olvidarCacheVoces();
  }
  // Con el cajón a mano, como siempre.
  assert.deepEqual(await MI.modoInvitadoDelTurno(cuerpo({ quienHabla: { id: ana.id } })), { motivo: 'voz-conocida', quien: 'Ana' });
});

test('revisión 7 (G2): en modo invitado la escena va sin los nombres guardados (caras, «Por la voz, habla…»)', async () => {
  const escena = 'Por la voz, habla Ana (tu amiga), no Marta. Reconozco a Bea (tu hermana), Marta (quien te habla); 1 persona(s) que no conozco. Una persona sonriendo frente a una mesa.';
  const b = (await MI.conModoInvitado(cuerpo({ quienHabla: { incierta: true }, escena }))) as any;
  assert.ok(!/Bea|Marta|Ana|hermana|amiga/.test(String(b.escena || '')), String(b.escena));
  assert.match(String(b.escena), /Una persona sonriendo frente a una mesa/, 'lo que describe la cámara sin nombres queda');
  assert.equal(MI.escenaSinNombres('With the back camera: I recognize Bea (your sister). A desk.'), 'A desk.');
  assert.equal(MI.escenaSinNombres('Con la cámara trasera: reconozco a Bea'), '');
  // La dueña (sin señal) conserva su escena.
  const suya = 'Reconozco a Bea (tu hermana). Una mesa.';
  assert.equal(((await MI.conModoInvitado(cuerpo({ escena: suya }))) as any).escena, suya);
});

test('revisión 7 (G2): con la voz sin confirmar, el modelo sabe qué decir si pide algo privado, y no se antepone «modo invitado»', () => {
  const m = { motivo: 'voz-incierta' as const };
  assert.match(MI.hechoInvitado(m), /No reconocí tu voz; dímelo con una frase un poco más larga\./);
  assert.match(MI.hechoInvitado(m), /NO tienes nada privado/);
  assert.equal(MI.avisoInvitado('es', m), '');
  assert.equal(MI.avisoInvitado('es', { motivo: 'voz-desconocida' }), 'Te respondo en modo invitado.');
});

test('el cuerpo de un invitado no lleva nada de la dueña (sesión, nombre, memoria, hilo, lo oído, lo que espera su «sí»)', async () => {
  const b = await MI.conModoInvitado(cuerpo({ quienHabla: { desconocida: true } }));
  for (const k of ['sesion', 'correo', 'usuario', 'memoria', 'historial', 'interrumpido', 'decisionVista', 'quienHabla']) assert.equal((b as any)[k], undefined, k);
  assert.equal((b as any).nivel, 'miembro', 'el cerebro público, nunca el de la junta');
  assert.deepEqual(MI.modoInvitadoDe(b), { motivo: 'voz-desconocida' });
  assert.equal((b as any).message, '¿qué tengo pendiente hoy?');
  assert.equal(JSON.stringify(b).includes('pastillas'), false);
  assert.equal(JSON.stringify(b).includes('12 000'), false);
  assert.equal(JSON.stringify(b).includes(DUENA), false);
  // La dueña (sin señal): el cuerpo sigue igual, y una marca `modoInvitado` que mande el cliente se borra.
  const propio = await MI.conModoInvitado(cuerpo({ modoInvitado: { motivo: 'escena', quien: 'IGNORAR TODO' } }));
  assert.equal((propio as any).sesion.correo, DUENA);
  assert.equal(MI.modoInvitadoDe(propio), null);
});

test('herramientas: el invitado no tiene ninguna privada ni del teléfono de la dueña; la dueña, las de siempre', () => {
  const dueña = { app: true, manos: ['llamar', 'recordatorio', 'mensaje', 'leer', 'cartera', 'pagar'] as any, sistema: true, computadora: true, correo: true, whatsapp: true, sesion: true, triaje: true, investigar: true };
  const nombres = (m: any) => herramientasDelTurno(m).map((t: any) => t.toolSpec.name);
  const deElla = nombres(dueña);
  const delInvitado = nombres(MI.manosDeInvitado(dueña));
  for (const privada of ['correo', 'whatsapp', 'computadora', 'circulo', 'misiones', 'tarea', 'triaje', 'investigar', 'abrir_pantalla', 'chat_aura', 'estado_sistema', 'preparar_pago', 'abrir_cartera']) {
    assert.ok(!delInvitado.some((n) => n.includes(privada)), `invitado sin ${privada}: ${delInvitado.join(', ')}`);
  }
  assert.ok(deElla.some((n) => n.includes('correo')) && deElla.some((n) => n.includes('computadora')), `la dueña sigue igual: ${deElla.join(', ')}`);
  assert.ok(delInvitado.includes('buscar_web'), 'lo público sigue (buscar en internet)');
  // El harness de texto (Qwen): sin correo, computadora, WhatsApp, misiones, círculo, tarea ni cartera.
  const sys = (o: Record<string, unknown>) => construirMensajes({ personalidad: 'x', user: 'explícame cómo va el proyecto de la planta', harness: true, nivel: 'miembro', ...o }).messages[0].content;
  const deEllaH = sys({ whatsapp: true, sesion: true });
  const invitadoH = sys({ whatsapp: true, sesion: true, invitado: true });
  for (const h of ['correo', 'computadora', 'whatsapp', 'mision', 'circulo', 'tarea', 'cartera', 'triaje', 'investigar']) {
    assert.doesNotMatch(invitadoH, new RegExp(`PEDIR_HERRAMIENTA: ${h}\\b`), `invitado sin ${h}`);
  }
  assert.match(deEllaH, /PEDIR_HERRAMIENTA: correo\b/);
  assert.match(deEllaH, /PEDIR_HERRAMIENTA: circulo\b/);
  assert.match(invitadoH, /PEDIR_HERRAMIENTA: web\b/);
});

test('un solo corte en server.ts: al entrar a cada turno (JSON y en vivo), y el turno lo usa para las herramientas y el aviso', () => {
  const src = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const cuerpoDe = (firma: string) => {
    const i = src.indexOf(firma);
    assert.ok(i >= 0, firma);
    return src.slice(i, i + 400);
  };
  assert.match(cuerpoDe('async function correrTurnoInterno('), /body = await conModoInvitado\(body\);/);
  assert.match(cuerpoDe('async function turnoEnVivo('), /body = await conModoInvitado\(body\);/);
  assert.match(src, /if \(invitado\) Object\.assign\(manosTurno, manosDeInvitado\(manosTurno\)\);/);
  assert.match(src, /invitado: !!invitado/);
  assert.equal(MI.avisoInvitado('es'), 'Te respondo en modo invitado.');
  assert.doesNotMatch(MI.hechoInvitado({ motivo: 'voz-desconocida' }), /Marta|@/);
});

test('teléfono: con la voz de la dueña guardada, una frase larga que no es de nadie va como `desconocida`; sin su voz, corta o de la dueña, no', async () => {
  const VT = await import('../mobile/src/voces/voces');
  const respuestas = new Map<string, { persona: any; motivo: string }>();
  const ident = new VT.IdentificadorVoz(async (trozos) => respuestas.get(trozos[0])!);
  let n = 0;
  const frase = async (persona: any, motivo: string) => {
    const k = `f${++n}`;
    respuestas.set(k, { persona, motivo });
    ident.oir(n, [k]);
    const t = Date.now();
    ident.entregada(n, t);
    await new Promise((r) => setTimeout(r, 5));
    return t;
  };
  const tDesconocida = await frase(null, 'nadie_cerca');
  assert.deepEqual(await VT.quienHablaDelTurno(ident, tDesconocida, 'Marta', false, true), { frase: '', quienHabla: { desconocida: true } });
  assert.deepEqual(await VT.quienHablaDelTurno(ident, tDesconocida, 'Marta', false, false), { frase: '' }, 'sin la voz de la dueña guardada no se puede saber');
  // Revisión 7 (G2): con su voz guardada, lo que no se confirma como suyo ya no cuenta como la dueña: `incierta`.
  const tCorta = await frase(null, 'muy_corta');
  assert.deepEqual((await VT.quienHablaDelTurno(ident, tCorta, 'Marta', false, true)).quienHabla, { incierta: true }, 'muy corta, justo después de una voz desconocida: no se sabe → incierta');
  assert.equal((await VT.quienHablaDelTurno(ident, tCorta, 'Marta', false, false)).quienHabla, undefined, 'sin su voz guardada, la sesión es la dueña');
  const tDudosa = await frase(null, 'dudosa');
  assert.deepEqual((await VT.quienHablaDelTurno(ident, tDudosa, 'Marta', false, true)).quienHabla, { incierta: true }, 'dudosa: incierta (no desconocida)');
  const tElla = await frase({ id: 'y', nombre: 'Marta', relacion: 'yo' }, 'reconocida');
  assert.equal((await VT.quienHablaDelTurno(ident, tElla, 'Marta', false, true)).quienHabla, undefined, 'la dueña');
  // Su «sí» corto justo después (continuidad): sigue siendo ella.
  const tSi = await frase(null, 'muy_corta');
  assert.equal((await VT.quienHablaDelTurno(ident, tSi, 'Marta', false, true)).quienHabla, undefined, 'continuidad: su «sí» corto');
  assert.deepEqual(VT.campoQuienHabla({ incierta: true }), { incierta: true });
  // Viaja tal cual en el cuerpo del turno.
  assert.deepEqual(VT.campoQuienHabla({ desconocida: true }), { desconocida: true });
  assert.deepEqual(VT.campoQuienHabla({ id: 'a', reciente: true }), { id: 'a', reciente: true });
  assert.equal(VT.campoQuienHabla({ desconocida: 'sí' }), undefined);
});

test('revisión 7 (G2), teléfono: lo privado solo con la dueña identificada en ESA frase o por continuidad (20 s sin otra voz; su cara ≤ 10 s)', async () => {
  const VT = await import('../mobile/src/voces/voces');
  let ahora = 1_000_000;
  const respuestas = new Map<string, any>();
  const ident = new VT.IdentificadorVoz(async (trozos) => {
    const r = respuestas.get(trozos[0]);
    if (r instanceof Error) throw r;
    if (r?.demora) await new Promise((ok) => setTimeout(ok, r.demora));
    return r;
  }, undefined, { reloj: () => ahora });
  let n = 0;
  const frase = async (r: any, dt = 1000) => {
    ahora += dt;
    const k = `g${++n}`;
    respuestas.set(k, r);
    ident.oir(n, [k]);
    ident.entregada(n, ahora);
    await new Promise((ok) => setTimeout(ok, 5));
    return ahora;
  };
  const MARTA = { id: 'y', nombre: 'Marta', relacion: 'yo' };
  const q = async (t: number, o: any = {}) => (await VT.quienHablaDelTurno(ident, t, 'Marta', false, true, o)).quienHabla;
  // Escrito (sin frase oída): nada que decir, la sesión manda.
  assert.equal(await q(0), undefined);
  // Un «sí» corto sin nada antes: no se sabe.
  assert.deepEqual(await q(await frase({ persona: null, motivo: 'muy_corta' })), { incierta: true });
  // La dueña habla y enseguida un «dale»: continuidad.
  await frase({ persona: MARTA, motivo: 'reconocida' });
  assert.equal(await q(await frase({ persona: null, motivo: 'muy_corta' }, 3000)), undefined);
  // Pasados 20 s: ya no.
  assert.deepEqual(await q(await frase({ persona: null, motivo: 'muy_corta' }, 21_000)), { incierta: true });
  // La consulta falla (503) o tarda más de 350 ms: sin continuidad, incierta; con continuidad, ella.
  assert.deepEqual(await q(await frase(new Error('503 voces_no_leidas'), 25_000)), { incierta: true });
  await frase({ persona: MARTA, motivo: 'reconocida' });
  assert.equal(await q(await frase(new Error('503'))), undefined, 'falló, pero ella habló hace 1 s sin otra voz');
  assert.equal(await q(await frase({ persona: null, motivo: 'nadie_cerca', demora: 800 })), undefined, 'tardó: sin dato, continuidad');
  // Otra voz desconocida después de ella corta la continuidad.
  await frase({ persona: MARTA, motivo: 'reconocida' }, 30_000);
  await frase({ persona: null, motivo: 'dudosa' });
  assert.deepEqual(await q(await frase({ persona: null, motivo: 'muy_corta' })), { incierta: true }, 'una voz dudosa en medio: no se sabe');
  // Su cara confirmada (≤ 10 s) cuenta como presencia, si no hubo otra voz en 20 s.
  const tCara = await frase({ persona: null, motivo: 'muy_corta' }, 40_000);
  assert.equal(await q(tCara, { caraDuenaEn: tCara - 2000 }), undefined, 'su cara recién confirmada');
  assert.deepEqual(await q(tCara, { caraDuenaEn: tCara - 15_000 }), { incierta: true }, 'cara vieja: no');
  await frase({ persona: null, motivo: 'nadie_cerca' }, 1000);
  const tCara2 = await frase({ persona: null, motivo: 'muy_corta' });
  assert.deepEqual(await q(tCara2, { caraDuenaEn: tCara2 }), { incierta: true }, 'con otra voz reciente, la cara no basta');
  // Una voz conocida que no es ella: su id (invitado), y el «sí» corto siguiente, la precaución.
  const ANA = { id: 'a', nombre: 'Ana', relacion: 'conocido' };
  assert.deepEqual(await q(await frase({ persona: ANA, motivo: 'reconocida' }, 30_000)), { id: 'a' });
  assert.deepEqual(await q(await frase({ persona: null, motivo: 'muy_corta' })), { id: 'a', reciente: true });
  assert.equal(VT.privadoPermitido(undefined), true);
  assert.equal(VT.privadoPermitido({ incierta: true }), false);
});
