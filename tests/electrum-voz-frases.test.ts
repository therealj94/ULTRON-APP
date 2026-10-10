/**
 * LA RESPUESTA DE DR ELECTRUM FRASE POR FRASE (server/electrum/voz-frases.ts) Y LA GUARDA DE HONESTIDAD CON SUS RECIBOS
 * (server/electrum/honestidad.ts).
 *
 *  · el stream corta por los cortes del contrato (lib/trozos.ts) y emite { i, texto, voz }: sin códigos de cita sin
 *    verificar, sin etiquetas, y la voz además sin markdown ni citas legibles;
 *  · lo que una vuelta dice antes de pedir una herramienta también sale; lo que da algo por hecho, no (lo decide la
 *    guarda del final);
 *  · al final sale lo que falte del texto de autoridad, sin repetir lo que ya sonó;
 *  · «te generé el informe», «lo puse en el mapa», «te mandé la alerta» sin recibo se cambian por la verdad.
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CortadorFrases, fraseARetener, partirEnFrases, sinCitasParaVoz, textoDeFrase, type Frase } from '../server/electrum/voz-frases';
import {
  afirmacionesElectrum,
  anotarRecibosElectrum,
  guardaHonestidadElectrum,
  recibosElectrum,
  recibosRecientesElectrum,
  _olvidarRecibosElectrum,
} from '../server/electrum/honestidad';
import { cortesDesde, puntoDeCorte } from '../lib/trozos';
import { codigosAVoz } from '../server/habla';
import { modeloEleven, modeloRespaldo } from '../server/eleven';

function cortador(o: { previas?: string[] } = {}) {
  const frases: Frase[] = [];
  const c = new CortadorFrases({ emitir: (f) => frases.push(f), idioma: 'es', mensaje: '¿Dónde queda Clavo Rico?', previas: o.previas });
  return { c, frases };
}

describe('frase por frase', () => {
  it('cortesDesde da cada corte, y el último es el de puntoDeCorte', () => {
    const t = 'Primera frase. Segunda frase. Terce';
    const cortes = cortesDesde(t, 0);
    assert.deepEqual(
      cortes.map((f) => t.slice(0, f).trim().split('. ').length),
      [1, 2]
    );
    assert.equal(cortes[cortes.length - 1], puntoDeCorte(t, 0) + 1);
  });

  it('la vuelta que pide una herramienta se dice; la final sale frase a frase, sin códigos de cita', () => {
    const { c, frases } = cortador();
    for (const t of ['Déjame mirar ', 'el catastro']) c.empujar(t);
    assert.equal(frases.length, 0, 'sin punto, todavía no');
    c.finDeRonda();
    assert.deepEqual(frases.map((f) => f.texto), ['Déjame mirar el catastro']);
    for (const t of ['[thoughtful] Clavo Rico tiene 120 ha [D12-p5]. ', 'Está **vigente** hasta 2027', '. Ojo con el traslape.']) c.empujar(t);
    // El punto al final de lo llegado ya cierra la frase (contrato de mobile/src/lib/cortesVoz.ts).
    assert.deepEqual(
      frases.map((f) => f.i),
      [0, 1, 2, 3]
    );
    assert.equal(frases[1].texto, 'Clavo Rico tiene 120 ha.');
    assert.equal(frases[1].voz, 'Clavo Rico tiene 120 ha.');
    assert.equal(frases[2].texto, 'Está **vigente** hasta 2027.', 'la pantalla conserva su formato');
    assert.equal(frases[2].voz, 'Está vigente hasta 2027.', 'la voz, sin markdown');
    c.finDeRonda();
    assert.equal(frases.length, 4, 'al cerrar la vuelta no quedaba nada');
    assert.equal(frases[3].texto, 'Ojo con el traslape.');
    // El texto de autoridad: las citas ya verificadas. Lo que ya sonó no se repite.
    const extra = c.finalizar('Clavo Rico tiene 120 ha (Informe JICA Fase III, p. 5). Está **vigente** hasta 2027. Ojo con el traslape.');
    assert.equal(extra, 0);
    assert.equal(c.cuantas, 4);
  });

  it('lo que da algo por hecho no suena mientras llega: lo dice el final, ya corregido', () => {
    const { c, frases } = cortador();
    c.empujar('Listo, te generé el informe en PDF. Tiene tres páginas.');
    c.finDeRonda();
    assert.equal(frases.length, 0, 'retenida desde la afirmación');
    c.finalizar('Todavía no generé ese informe; si lo querés, pedímelo y lo armo. Tiene tres páginas.');
    // La primera frase larga se suelta en su cláusula (COMA_PRIMERA), como la cortaría la app.
    assert.deepEqual(
      frases.map((f) => f.texto),
      ['Todavía no generé ese informe;', 'si lo querés, pedímelo y lo armo.', 'Tiene tres páginas.']
    );
  });

  it('lo del mapa y lo repetido también esperan a las guardas', () => {
    assert.equal(fraseARetener('Ahí la tenés resaltada en el mapa.'), true);
    assert.equal(fraseARetener('Te dejé los mapas geológicos en pantalla.'), true);
    const previa = 'La concesión Clavo Rico tiene ciento veinte hectáreas y vence en marzo de dos mil veintisiete.';
    assert.equal(fraseARetener(previa, [previa]), true);
    assert.equal(fraseARetener('Clavo Rico es de oro.'), false);
  });

  it('si el final cambió lo que venía, sale desde la primera frase distinta', () => {
    const { c, frases } = cortador();
    c.empujar('Clavo Rico es de oro. Tiene 120 ha. ');
    c.finDeRonda();
    c.finalizar('Clavo Rico es de oro. Tiene 118 ha según la última medición.');
    assert.deepEqual(
      frases.map((f) => f.texto),
      ['Clavo Rico es de oro.', 'Tiene 120 ha.', 'Tiene 118 ha según la última medición.']
    );
  });

  it('lo dicho hasta una coma: al final sale solo lo que faltaba de esa frase', () => {
    const { c, frases } = cortador();
    // La primera frase se suelta en su coma (contrato de cortesVoz: COMA_PRIMERA).
    c.empujar('La concesión que me preguntás está en Olancho, ');
    assert.equal(frases.length, 1);
    assert.equal(frases[0].texto, 'La concesión que me preguntás está en Olancho,');
    c.finalizar('La concesión que me preguntás está en Olancho, cerca de Juticalpa. Es de oro.');
    assert.deepEqual(
      frases.map((f) => f.texto),
      ['La concesión que me preguntás está en Olancho,', 'cerca de Juticalpa.', 'Es de oro.']
    );
  });

  it('sin nada en vivo (el nodo contestó entero al final), el final sale entero, frase por frase', () => {
    const { c, frases } = cortador();
    c.finalizar('Primero, el catastro. Después, el mapa.');
    assert.deepEqual(
      frases.map((f) => f.texto),
      ['Primero, el catastro.', 'Después, el mapa.']
    );
  });

  it('un pedido de herramienta escrito en el texto nunca se dice', () => {
    const { c, frases } = cortador();
    c.empujar('Voy a buscarla. <tool_call>{"name": "catastro_buscar", "arguments": {"texto": "x"}}</tool_call>');
    c.finDeRonda();
    assert.deepEqual(
      frases.map((f) => f.texto),
      ['Voy a buscarla.']
    );
  });

  it('las citas legibles y las fuentes no se dicen', () => {
    assert.equal(sinCitasParaVoz('Son 3,4 g/t (Informe JICA, p. 31) según la web (fuente: inhgeomin.gob.hn).'), 'Son 3,4 g/t según la web.');
    assert.equal(textoDeFrase('[EMO: neutral] Hola [D3].'), 'Hola.');
    assert.deepEqual(partirEnFrases('Una. Dos.'), ['Una.', ' Dos.']);
  });
});

describe('la voz de Electrum: códigos y primera frase', () => {
  it('un código con cero delante se dice cifra por cifra; las cantidades no', () => {
    assert.equal(codigosAVoz('El expediente 0442 de 2019'), 'El expediente 0 4 4 2 de 2019');
    assert.equal(codigosAVoz('PL-0087-2019'), 'PL-0 0 8 7-2019');
    assert.equal(codigosAVoz('Ley de 3,05 g/t y 1.050 t'), 'Ley de 3,05 g/t y 1.050 t');
  });

  it('ya no hay primera frase rápida: todo el turno con el modelo expresivo; el rápido solo de respaldo', () => {
    assert.equal(modeloEleven(), 'eleven_v4_turbo');
    assert.equal(modeloRespaldo(), 'eleven_flash_v2_5', 'el de respaldo, si v4 falla a mitad del turno');
  });
});

describe('honestidad con los recibos de Electrum', () => {
  beforeEach(() => _olvidarRecibosElectrum());

  it('los recibos salen de la traza y de las órdenes del mapa', () => {
    const r = recibosElectrum(
      [
        { herramienta: 'catastro_buscar', ok: true },
        { herramienta: 'informe_pdf', ok: false },
      ],
      [{ herramienta: 'catastro_buscar', accion: 'volar', concesion_id: 7 }]
    );
    assert.deepEqual(r.map((x) => x.clase).sort(), ['lectura', 'mapa']);
    assert.deepEqual(
      recibosElectrum([{ herramienta: 'informe_pdf', ok: true }, { herramienta: 'entidad_registrar', ok: true }]).map((x) => x.clase).sort(),
      ['guardado', 'informe', 'lectura']
    );
  });

  it('afirma sin recibo: se cambia por la verdad, en su lugar', () => {
    const r = guardaHonestidadElectrum('Listo, te generé el informe en PDF. Clavo Rico tiene 120 ha.', { recibos: recibosElectrum([{ herramienta: 'catastro_buscar', ok: true }]) });
    assert.equal(r.cambiada, true);
    assert.equal(r.texto, 'Todavía no generé ese informe; si lo querés, pedímelo y lo armo. Clavo Rico tiene 120 ha.');
    const m = guardaHonestidadElectrum('La puse en el mapa para que la veas.', { recibos: [] });
    assert.equal(m.texto, 'Todavía no está marcado en el mapa.');
    const a = guardaHonestidadElectrum('Ya te mandé la alerta del vencimiento.', { recibos: [{ clase: 'lectura' }] });
    assert.match(a.texto, /No dejé ninguna alerta puesta/);
    const g = guardaHonestidadElectrum('Guardé el expediente en tu carpeta.', { recibos: [] });
    assert.equal(g.texto, 'Todavía no lo guardé.');
  });

  it('con recibo, no se toca', () => {
    const recibos = recibosElectrum([{ herramienta: 'informe_pdf', ok: true }], [{ accion: 'volar', concesion_id: 7 }]);
    for (const t of ['Te generé el informe: tiene tres páginas.', 'Te la marqué en el mapa.']) {
      assert.equal(guardaHonestidadElectrum(t, { recibos }).cambiada, false, t);
    }
  });

  it('lo que lee un dato, lo negado o lo que pregunta no es una afirmación', () => {
    for (const t of [
      'El informe generado por INHGEOMIN en 2019 dice que hay oro.',
      'Saqué del informe de JICA que la ley es de 3,4 g/t.',
      'No te generé ningún informe todavía.',
      '¿Querés que te genere el informe?',
      'Si querés, te lo pongo en el mapa.',
      // De usted, «le dije» es a quien tiene enfrente: no es un envío a un tercero.
      'Como le dije, la concesión vence en 2027.',
    ]) {
      assert.deepEqual(afirmacionesElectrum(t), [], t);
    }
  });

  it('lo de antes respalda solo si la persona pregunta por eso', () => {
    anotarRecibosElectrum('ana', recibosElectrum([{ herramienta: 'informe_pdf', ok: true }]));
    assert.equal(recibosRecientesElectrum('ana').length, 1);
    const previos = recibosRecientesElectrum('ana');
    assert.equal(guardaHonestidadElectrum('Sí, te generé el informe.', { recibos: [], previos, mensaje: '¿Ya generaste el informe?' }).cambiada, false);
    assert.equal(guardaHonestidadElectrum('Listo, te generé el informe.', { recibos: [], previos, mensaje: 'Generame otro informe de Olancho' }).cambiada, true);
  });

  it('en inglés, la verdad en inglés', () => {
    const r = guardaHonestidadElectrum("I've generated the report for you.", { recibos: [], idioma: 'en' });
    assert.equal(r.texto, "I haven't generated that report yet; ask me and I'll put it together.");
  });
});
