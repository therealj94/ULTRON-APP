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
  assert.equal(await MI.modoInvitadoDelTurno(cuerpo({ quienHabla: { id: 'no-existe' } })), null, 'un id que no es de su cajón no cuenta');
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
  const tCorta = await frase(null, 'muy_corta');
  assert.equal((await VT.quienHablaDelTurno(ident, tCorta, 'Marta', false, true)).quienHabla, undefined, 'muy corta: no se sabe');
  const tDudosa = await frase(null, 'dudosa');
  assert.equal((await VT.quienHablaDelTurno(ident, tDudosa, 'Marta', false, true)).quienHabla, undefined, 'dudosa: no se dice desconocida');
  const tElla = await frase({ id: 'y', nombre: 'Marta', relacion: 'yo' }, 'reconocida');
  assert.equal((await VT.quienHablaDelTurno(ident, tElla, 'Marta', false, true)).quienHabla, undefined, 'la dueña');
  // Viaja tal cual en el cuerpo del turno.
  assert.deepEqual(VT.campoQuienHabla({ desconocida: true }), { desconocida: true });
  assert.deepEqual(VT.campoQuienHabla({ id: 'a', reciente: true }), { id: 'a', reciente: true });
  assert.equal(VT.campoQuienHabla({ desconocida: 'sí' }), undefined);
});
