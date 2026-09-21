/**
 * Subirle algo al cerebro: la puerta, y lo que pasa al repetir.
 *
 * La deduplicación de geometrías ya existía; lo que no existía era la honestidad de la LISTA. Se
 * creaba una fila de capa por cada carga aunque no entrara una sola geometría, así que subir el
 * mismo catastro tres veces dejaba tres «catastro · 2 entidades» y quien lo miraba contaba seis
 * concesiones donde había dos.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { identificar, puedeEscribir, reiniciarPadron } from '../lib/acceso';
import { huellaDe, inspeccionar } from '../server/electrum/aprender';

test('quién puede alimentar el cerebro de Dr Electrum', async (t) => {
  await t.test('la llave de demostración deja mirar, no cargar', () => {
    reiniciarPadron();
    // La llave no identifica a nadie: abre la puerta con nivel de consulta y ahí se queda.
    assert.equal(puedeEscribir(null, 'electrum'), false);
  });

  await t.test('José carga; un nombre escrito a mano, no', () => {
    reiniciarPadron();
    assert.equal(puedeEscribir(identificar({ correo: 'j.ordonez@ordenglobal.org' }), 'electrum'), true);
    assert.equal(puedeEscribir(identificar({ nombre: 'José' }), 'electrum'), false);
  });

  await t.test('quien solo tiene ULTRON no carga el cerebro del otro', () => {
    const antes = process.env.ULTRON_PADRON;
    process.env.ULTRON_PADRON = 'ana | Ana | ana@ordenglobal.org | | ultron=mando';
    reiniciarPadron();
    try {
      const id = identificar({ correo: 'ana@ordenglobal.org' });
      assert.equal(puedeEscribir(id, 'ultron'), true);
      assert.equal(puedeEscribir(id, 'electrum'), false, 'mando en una plataforma no es nada en la otra');
    } finally {
      if (antes === undefined) delete process.env.ULTRON_PADRON;
      else process.env.ULTRON_PADRON = antes;
      reiniciarPadron();
    }
  });

  await t.test('nivel de trabajo carga pero no manda', () => {
    const antes = process.env.ULTRON_PADRON;
    process.env.ULTRON_PADRON = 'perez | Pérez | perez@mina.hn | | electrum=escribe';
    reiniciarPadron();
    try {
      const id = identificar({ correo: 'perez@mina.hn' });
      assert.equal(puedeEscribir(id, 'electrum'), true);
    } finally {
      if (antes === undefined) delete process.env.ULTRON_PADRON;
      else process.env.ULTRON_PADRON = antes;
      reiniciarPadron();
    }
  });
});

/**
 * El ensayo previo de una carga grande.
 *
 * Con 1,2 GB de expedientes lo que hay que saber ANTES de empezar no es cuántos archivos hay, sino
 * cuántos van a entrar. Un montón de expedientes mineros son escaneos sin capa de texto y no entran;
 * si eso se descubre al final, se perdió la carga entera. El ensayo pasa por el mismo código que la
 * carga real justamente para que no pueda contradecirla.
 */
test('el ensayo dice la verdad sobre lo que entraría', async (t) => {
  await t.test('un documento con texto se cuenta con sus páginas y fragmentos', async () => {
    const texto =
      'La concesion Los Andes presenta una ley media ponderada de tres coma cuatro gramos por tonelada ' +
      'de oro sobre una potencia media de cuatro coma dos metros, medida en veinte sondajes diamantinos.';
    const i = await inspeccionar('informe.txt', Buffer.from(texto));
    assert.equal(i.veredicto, 'indexable');
    assert.equal(i.paginas, 1);
    assert.ok(i.fragmentos >= 1);
    assert.ok(i.caracteres > 100);
  });

  await t.test('un escaneo sin texto se marca como escaneo, no como archivo cargado', async () => {
    // Un PDF de una página con un rectángulo pintado y ni un operador de texto: un escaneo, en esencia.
    const flujo = Buffer.from('0.5 0.5 0.5 rg 50 50 500 700 re f');
    const objs = [
      Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
      Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
      Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << >> >>'),
      Buffer.concat([Buffer.from(`<< /Length ${flujo.length} >>\nstream\n`), flujo, Buffer.from('\nendstream')]),
    ];
    let pdf = Buffer.from('%PDF-1.4\n');
    const offs: number[] = [];
    objs.forEach((o, i) => {
      offs.push(pdf.length);
      pdf = Buffer.concat([pdf, Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from('\nendobj\n')]);
    });
    const x = pdf.length;
    let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const o of offs) xref += `${String(o).padStart(10, '0')} 00000 n \n`;
    pdf = Buffer.concat([pdf, Buffer.from(`${xref}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`)]);

    const i = await inspeccionar('escaneo.pdf', pdf);
    assert.equal(i.veredicto, 'escaneo');
    assert.equal(i.fragmentos, 0);
    assert.match(i.dicho, /escaneo/i);
  });

  await t.test('lo demasiado corto no se cuenta como si fuera a entrar', async () => {
    assert.equal((await inspeccionar('nota.txt', Buffer.from('Ver anexo.\n'))).veredicto, 'corto');
  });

  await t.test('la huella es del contenido, no del nombre', () => {
    const a = Buffer.from('mismo papel');
    assert.equal(huellaDe(a), huellaDe(Buffer.from('mismo papel')));
    assert.notEqual(huellaDe(a), huellaDe(Buffer.from('otro papel')));
  });
});
