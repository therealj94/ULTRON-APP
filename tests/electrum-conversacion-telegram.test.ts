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
import { cargarHilo, claveHilo, hiloDe, olvidarHilo, recordarHilo } from '../server/electrum/hilo';
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

test('los hilos de la pantalla no van a la base: el cliente ya lleva su copia', { skip: hayBase() ? false : 'sin ELECTRUM_DB_URL' }, async () => {
  const clave = claveHilo(`jose-${Date.now()}`, 'mesa');
  recordarHilo(clave, 'hola', 'buenas');
  await new Promise((r) => setTimeout(r, 100));
  const [f] = await sql(`SELECT 1 FROM cognitivo.hilo WHERE clave = $1`, [clave]);
  assert.equal(f, undefined);
  olvidarHilo(clave);
});
