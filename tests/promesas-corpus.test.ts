/**
 * Auditoría externa del 6-oct (§5 LANG-01): la corrección local de promesas borraba frases VERDADERAS. «No le mandé
 * nada», «Dijo que lo llame mañana», «Ana me pidió que le mande la factura», «Nunca abrí tu correo» salían como «Eso
 * todavía no lo hice: desde aquí no tengo cómo». Una negación, lo que dijo otra persona o lo citado no afirman que AU-RA
 * hizo algo (lib/cerebro-manos.ts `sinLoQueNoAfirma`).
 *
 * Corpus: negación, citas, discurso referido, pasado confirmado (con recibo), de antes de este turno, futuro sin
 * capacidad, borrador pendiente, «NADA», pregunta, lo que se entrega ahí mismo y acción con recibo real o falso. Sin una
 * afirmación indebida, la frase entera y sus cifras quedan; con una, se corrige solo esa (y antes de que suene: el stream
 * la retiene con `daPorHecho`). Consistente con la revisión 7 (M1/M2): las promesas falsas de verdad se siguen corrigiendo.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { corregirPromesaSinHerramienta, daPorHecho, debeCorregirSinHerramienta, prometeSinHacer, type CumplirLoDicho } from '../lib/cerebro-manos';

const LOCAL: CumplirLoDicho = { correccion: 'local', cumplida: false, candidatas: [], ms: 0 };
const MSJ = '¿qué pasó con lo de Ana?';
const corrige = (dicho: string, o: { borradorPendiente?: boolean; pasos?: Array<{ herramienta?: string; estado?: string }>; promesa?: CumplirLoDicho } = {}) => {
  const debe = debeCorregirSinHerramienta({ promesa: o.promesa ?? LOCAL, usoManos: false, borradorPendiente: !!o.borradorPendiente, pasos: o.pasos || [], dicho, mensaje: MSJ });
  return debe ? corregirPromesaSinHerramienta(dicho, 'es', { sinHerramienta: true, borradorPendiente: o.borradorPendiente, mensaje: MSJ }).texto : dicho;
};
const queda = (dicho: string, o: Parameters<typeof corrige>[1] = {}) => assert.equal(corrige(dicho, o), dicho, `se tocó una frase verdadera: ${dicho}`);

test('negación: lo que AU-RA dice que NO hizo queda entero', () => {
  for (const f of ['No le mandé nada.', 'Nunca abrí tu correo.', 'Todavía no le escribí a Bruno.', 'Ni le escribí ni lo llamé.', 'No te llamé porque estabas ocupada.', 'Aún no te puse la alarma de las 6:30.', 'No he podido llamarlo.']) {
    queda(f);
    assert.equal(prometeSinHacer(f), false, f);
    assert.equal(daPorHecho(f), false, f);
  }
});

test('discurso referido y citas: lo que dijo, pidió o quiere otra persona no es algo que AU-RA hizo', () => {
  for (const f of [
    'Dijo que lo llame mañana.',
    'Ana me pidió que le mande la factura.',
    'José quiere que le llame mañana a las 9.',
    'Ana dice que ya le llegó la factura de 1 200 lempiras.',
    'Bruno ya lo recibió, según me dijo Ana.',
    'Ana me contó que ya le respondió a Bruno.',
    'Bruno dijo: «ya te lo mandé».',
    'Ana te escribió: "ya le mandé el contrato a Bruno, son 3 páginas".',
  ]) {
    queda(f);
    assert.equal(prometeSinHacer(f), false, f);
  }
});

test('pregunta, lo de antes de este turno y lo que se entrega ahí mismo: quedan, con sus cifras', () => {
  for (const f of ['¿Quieres que le mande la factura a Ana?', 'Ayer te mandé el informe de 3 páginas.', 'Hace rato le escribí a Bruno lo de los 500.', 'Te mando el resumen: son 4 correos nuevos de 3 personas.', 'Te leo lo que veo: dos personas y una mesa.']) queda(f);
});

test('borrador pendiente y «NADA»: la pregunta de aprobación queda; si el modelo dice que no prometió nada, nada se corrige', () => {
  queda('Sigue esperando el correo para Ana. ¿Lo envío?', { borradorPendiente: true });
  queda('Está en tu ventana de decisión: tócale Sí y lo mando.', { borradorPendiente: true });
  queda('Listo, ya se lo mandé a Bruno.', { promesa: { ...LOCAL, correccion: 'repregunta', nada: true } });
});

test('acción con recibo real: queda; con recibo falso (falló, u otra herramienta): se corrige solo lo falso', () => {
  const dicho = 'Listo, ya le mandé el WhatsApp a Bruno.';
  queda(dicho, { pasos: [{ herramienta: 'whatsapp', estado: 'succeeded' }] });
  assert.match(corrige(dicho, { pasos: [{ herramienta: 'whatsapp', estado: 'failed' }] }), /Eso todavía no lo hice/);
  assert.match(corrige(dicho, { pasos: [{ herramienta: 'web', estado: 'succeeded' }] }), /Eso todavía no lo hice/, 'el clima que sí se buscó no vuelve verdad el mensaje');
});

test('afirmaciones falsas de verdad: se corrigen, sin borrar lo verdadero de alrededor ni inventar qué pasó', () => {
  assert.match(corrige('Te llamo en 30 segundos.'), /^Eso todavía no lo hice/);
  const mezcla = 'Tienes 3 correos nuevos de 2 personas. Ya le respondí a Bruno.';
  const c = corrige(mezcla);
  assert.match(c, /^Tienes 3 correos nuevos de 2 personas\./, 'lo verdadero y sus cifras quedan');
  assert.doesNotMatch(c, /respondí/);
  assert.match(c, /Eso todavía no lo hice/);
  // La negación termina en su cláusula: lo de después de la coma sí afirma.
  assert.match(corrige('No te preocupes, ya se lo mandé a Bruno.'), /Eso todavía no lo hice/);
  // «Te dije que ya lo mandé» (yo): es una afirmación de AU-RA.
  assert.equal(prometeSinHacer('Te dije que ya se lo mandé a Bruno.'), true);
  // Y el stream la retiene antes de que suene (no después).
  for (const f of ['Ya le respondí a Bruno.', 'Listo, le avisé a Ana.', 'Ya hice la reservación.']) assert.equal(daPorHecho(f), true, f);
  const src = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');
  assert.match(src, /trozoPromete\(cuerpo\.slice\(enviado, corte \+ 1\)\) \|\| daPorHecho\(cuerpo\.slice\(enviado, corte \+ 1\)\)/, 'el stream retiene lo que da por hecho');
});
