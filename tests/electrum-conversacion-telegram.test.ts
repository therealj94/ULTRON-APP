/**
 * Dos fallos vistos en producción por Telegram (26-sep), investigando caliza coralina:
 *
 *  · «Si hacerme un pdf» terminó en «No me salió ninguna respuesta»: el informe solo sabía armar la
 *    ficha de una concesión o la cartera. Ahora hay informe de conversación: lo que el Doctor ya
 *    respondió, tal cual, con sus fuentes.
 *  · El hilo de Telegram vivía solo en memoria: cada redespliegue lo borraba. Ahora se guarda en
 *    cognitivo.hilo y se trae de vuelta (esto necesita ELECTRUM_DB_URL; sin ella, se salta).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { informeConversacion } from '../server/electrum/informe';
import { manosDe } from '../server/electrum/manos';
import { cargarHilo, claveHilo, hiloDe, olvidarHilo, recordarHilo, relojDeHilo } from '../server/electrum/hilo';
import { hayBase } from '../server/electrum/db';
import { sql } from '../lib/cognitivo/base';

const HILO = [
  { role: 'user' as const, content: 'Busco caliza coralina en Honduras para bloques de 3 por 2 metros' },
  { role: 'assistant' as const, content: 'Caliza coralina hay en Roatán y en la franja norte. Fuente: https://sinit.hn/catalogo-capas/.' },
  { role: 'user' as const, content: 'profundizá' },
  { role: 'assistant' as const, content: 'En Roatán el problema es el acceso, no la roca (https://sinit.hn/catalogo-capas/ y http://geoportal.icf.gob.hn/geoportal/main).' },
];

test('informe de conversación: las respuestas tal cual, con su pregunta y las fuentes sin repetir', () => {
  const r = informeConversacion({ historial: HILO, titulo: 'Caliza coralina en Honduras', quien: 'José' });
  assert.ok(!('error' in r));
  if ('error' in r) return;
  assert.equal(r.pdf.subarray(0, 5).toString(), '%PDF-');
  assert.match(r.nombre, /^caliza-coralina-en-honduras-\d{4}-\d{2}-\d{2}\.pdf$/);
  assert.match(r.dicho, /2 respuestas y 2 fuentes citadas/);
});

test('informe de conversación sin nada conversado: lo dice en vez de armar un PDF vacío', () => {
  const r = informeConversacion({ historial: [{ role: 'user', content: 'hacerme un pdf' }] });
  assert.ok('error' in r);
});

test('informe_pdf tipo conversacion usa el hilo del turno y no necesita el catastro', async () => {
  const [h] = manosDe(['informe_pdf']);
  const r = await h.ejecutar(
    { tipo: 'conversacion', titulo: 'Caliza coralina' },
    { quien: 'jose', nivel: 'lee', plataforma: 'electrum', canal: 'telegram', mensaje: 'si hacerme un pdf', historial: HILO },
  );
  assert.equal(r.ok, true, r.texto);
  assert.match(String((r.ui as any)?.informe?.url), /^\/api\/electrum\/informe\//);
});

test('el hilo de Telegram sobrevive a un redespliegue', { skip: hayBase() ? false : 'sin ELECTRUM_DB_URL' }, async () => {
  const clave = claveHilo(`tg:prueba-${Date.now()}`, 'telegram');
  try {
    recordarHilo(clave, 'busco caliza coralina', 'Hay en Roatán.');
    // Lo que hace un redespliegue: la memoria se vacía.
    for (let i = 0; i < 50; i++) {
      const [f] = await sql<{ n: number }>(`SELECT jsonb_array_length(turnos)::int AS n FROM cognitivo.hilo WHERE clave = $1`, [clave]);
      if (f?.n === 2) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    olvidarHilo();
    assert.deepEqual(hiloDe(clave), []);
    const vuelto = await cargarHilo(clave);
    assert.deepEqual(vuelto.map((t) => t.texto), ['busco caliza coralina', 'Hay en Roatán.']);
    // Y «olvidá lo que hablamos» lo borra también de la base.
    olvidarHilo(clave);
    for (let i = 0; i < 50; i++) {
      const [f] = await sql(`SELECT 1 FROM cognitivo.hilo WHERE clave = $1`, [clave]);
      if (!f) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.deepEqual(await cargarHilo(clave), []);
  } finally {
    await sql(`DELETE FROM cognitivo.hilo WHERE clave = $1`, [clave]).catch(() => {});
  }
});

test('en la base el hilo va con los secretos tapados, y el caducado se borra', { skip: hayBase() ? false : 'sin ELECTRUM_DB_URL' }, async () => {
  const clave = claveHilo(`tg:secreto-${Date.now()}`, 'telegram');
  const esperar = async (cond: () => Promise<boolean>) => {
    for (let i = 0; i < 50 && !(await cond()); i++) await new Promise((r) => setTimeout(r, 20));
  };
  try {
    recordarHilo(clave, 'mi clave es Sup3rSecreta-2026 y la base postgres://yo:pwd123@db.example/x', 'No la guardo.');
    await esperar(async () => !!(await sql(`SELECT 1 FROM cognitivo.hilo WHERE clave = $1`, [clave]))[0]);
    const [f] = await sql<{ turnos: any }>(`SELECT turnos FROM cognitivo.hilo WHERE clave = $1`, [clave]);
    const guardado = JSON.stringify(f.turnos);
    assert.doesNotMatch(guardado, /Sup3rSecreta-2026/);
    assert.doesNotMatch(guardado, /pwd123/);
    assert.match(hiloDe(clave)[0].texto, /Sup3rSecreta-2026/, 'en memoria sigue entero para este rato');
    // Siete horas después: caducado, se devuelve vacío y se borra de la base.
    olvidarHilo();
    const real = Date.now();
    relojDeHilo(() => real + 7 * 60 * 60 * 1000);
    assert.deepEqual(await cargarHilo(clave), []);
    await esperar(async () => !(await sql(`SELECT 1 FROM cognitivo.hilo WHERE clave = $1`, [clave]))[0]);
    assert.equal((await sql(`SELECT 1 FROM cognitivo.hilo WHERE clave = $1`, [clave]))[0], undefined);
  } finally {
    relojDeHilo(() => Date.now());
    await sql(`DELETE FROM cognitivo.hilo WHERE clave = $1`, [clave]).catch(() => {});
  }
});

// Auditoría H17: la conversación de la mesa también sobrevive a un redespliegue y a cambiar de aparato.
test('el hilo de la mesa también se guarda en la base', { skip: hayBase() ? false : 'sin ELECTRUM_DB_URL' }, async () => {
  const clave = claveHilo(`prueba-mesa-${Date.now()}`, 'mesa');
  try {
    recordarHilo(clave, '¿qué vence este año?', 'Vencen 12 concesiones.');
    for (let i = 0; i < 50; i++) {
      const [f] = await sql<{ n: number }>(`SELECT jsonb_array_length(turnos)::int AS n FROM cognitivo.hilo WHERE clave = $1`, [clave]);
      if (f?.n === 2) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    olvidarHilo();
    assert.deepEqual((await cargarHilo(clave)).map((t) => t.texto), ['¿qué vence este año?', 'Vencen 12 concesiones.']);
  } finally {
    await sql(`DELETE FROM cognitivo.hilo WHERE clave = $1`, [clave]).catch(() => {});
  }
});
