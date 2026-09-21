/**
 * El informe: qué garantiza y qué no.
 *
 * Lo que se prueba acá no es que salga bonito —eso se mira con `scripts/qa/electrum-informe.mjs`—
 * sino la regla que sostiene todo el diseño: **el modelo no pone cifras en un PDF.** Un documento
 * se imprime y se lleva a una reunión; una cifra inventada con membrete no es una respuesta
 * desafortunada, es un papel falso.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compartirInforme,
  contradicciones,
  guardarInforme,
  informeCompartido,
  olvidarInformes,
  tomarInforme,
} from '../server/electrum/informe';
import { MANOS } from '../server/electrum/manos';
import type { FilaConcesion } from '../server/electrum/db';

const base: FilaConcesion = {
  id: 1,
  expediente: 'EXP-2019-041',
  nombre: 'Cerro Partido',
  titular: 'Compañía Demo Andina Ltda.',
  departamento: 'Choluteca',
  municipio: 'El Corpus',
  tipo: 'explotación',
  mineral: 'oro',
  estado: 'vigente',
  otorgada: '2019-03-01',
  vence: '2029-03-01',
  hectareas: 400.3,
  hectareas_dec: 400.0,
};

test('el informe levanta lo que el padrón esconde', async (t) => {
  await t.test('vigente con fecha pasada es una contradicción, no un detalle', () => {
    const c = contradicciones({ ...base, vence: '2020-01-01' });
    assert.ok(c.some((x) => /VIGENTE/.test(x) && /pas/.test(x)), c.join(' | '));
  });

  await t.test('lo que vence pronto se avisa antes de que sea tarde', () => {
    // La cuenta va a medianoche UTC, que es lo que trae el padrón: si son las seis de la tarde,
    // «dentro de sesenta días» son cincuenta y nueve días enteros. Por eso se comprueba el rango.
    const dentroDe = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
    const aviso = contradicciones({ ...base, vence: dentroDe }).find((x) => /dentro de \d+ días/.test(x));
    assert.ok(aviso, 'tiene que avisar de un vencimiento a sesenta días');
    const dias = Number(aviso!.match(/dentro de (\d+) días/)![1]);
    assert.ok(dias === 59 || dias === 60, `dijo ${dias}`);

    // Y a un año y pico no molesta: avisar de todo es no avisar de nada.
    const lejos = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);
    assert.deepEqual(contradicciones({ ...base, vence: lejos }), []);
  });

  await t.test('una diferencia de área por encima del redondeo se señala', () => {
    // Medio por ciento es más de lo que explica redondear un plano: ahí hay un lindero movido.
    assert.equal(contradicciones({ ...base, hectareas: 400.3, hectareas_dec: 400.0 }).length, 0, '0,075 % es redondeo');
    assert.ok(
      contradicciones({ ...base, hectareas: 420, hectareas_dec: 400 }).some((x) => /no coincide/.test(x)),
      '5 % no es redondeo'
    );
  });

  await t.test('sin titular, se dice', () => {
    assert.ok(contradicciones({ ...base, titular: null }).some((x) => /titular/.test(x)));
  });

  await t.test('una ficha limpia no inventa avisos', () => {
    assert.deepEqual(contradicciones(base), []);
  });
});

test('la mano del informe no acepta cifras del modelo', async (t) => {
  await t.test('su esquema solo deja elegir QUÉ informe y aportar una lectura', () => {
    const props = Object.keys(MANOS.informe_pdf.esquema.properties).sort();
    assert.deepEqual(props, ['concesion_id', 'lectura', 'nombre', 'tipo']);
    // Si algún día aparece acá un campo de números, el reparto se rompió.
    assert.match(MANOS.informe_pdf.esquema.properties.lectura.description, /NO pongas cifras/);
  });

  await t.test('es de Electrum y no cambia el mundo, así que la puede pedir quien solo consulta', () => {
    assert.deepEqual(MANOS.informe_pdf.plataformas, ['electrum']);
    assert.ok(!MANOS.informe_pdf.escribe);
  });
});

/** El nombre del PDF si se pudo recoger; si no, el motivo. Para leer las pruebas de un vistazo. */
const recoger = (id: string, quien: string | null = null) => {
  const r = tomarInforme(id, quien);
  return r.estado === 'ok' ? r.informe.nombre : r.estado;
};

test('la entrega del informe', async (t) => {
  await t.test('se guarda, se recoge una vez y se puede volver a recoger', () => {
    olvidarInformes();
    const id = guardarInforme({ pdf: Buffer.from('%PDF-'), nombre: 'x.pdf', dicho: 'listo' }, 'jose');
    assert.equal(recoger(id, 'jose'), 'x.pdf');
    assert.equal(recoger(id, 'jose'), 'x.pdf', 'recogerlo no lo consume: bajarlo dos veces es normal');
    assert.equal(recoger('inventado', 'jose'), 'no-esta');
  });

  await t.test('no se acumulan sin fin', () => {
    olvidarInformes();
    const ids: string[] = [];
    for (let i = 0; i < 60; i += 1) ids.push(guardarInforme({ pdf: Buffer.alloc(8), nombre: `${i}.pdf`, dicho: '' }, null));
    assert.equal(recoger(ids[59]), '59.pdf', 'el último sigue ahí');
    assert.equal(recoger(ids[0]), 'no-esta', 'los primeros se soltaron');
  });
});

/* ------------------------------------------------- de quién es un informe */

test('un informe es de quien lo pidió', async (t) => {
  t.beforeEach(() => olvidarInformes());

  await t.test('otro miembro de la junta no se lo puede bajar', () => {
    // El autor se guardaba desde el principio y no se comparaba con nadie: cualquiera con acceso a
    // Electrum y el identificador se bajaba el informe de otro. Un informe de cartera lleva nombres
    // de concesionarios y hectáreas; «difícil de adivinar» no es un permiso.
    const id = guardarInforme({ pdf: Buffer.from('%PDF-'), nombre: 'cartera.pdf', dicho: '' }, 'jose');
    assert.equal(recoger(id, 'medardo'), 'ajeno');
    assert.equal(recoger(id, null), 'ajeno', 'sin identificar tampoco');
    assert.equal(recoger(id, 'jose'), 'cartera.pdf', 'el suyo sí');
  });

  await t.test('compartirlo con la junta lo abre, y solo puede hacerlo su autor', () => {
    const id = guardarInforme({ pdf: Buffer.from('%PDF-'), nombre: 'cartera.pdf', dicho: '' }, 'jose');
    assert.equal(compartirInforme(id, 'medardo'), 'ajeno', 'no es suyo: no le toca compartirlo');
    assert.equal(recoger(id, 'medardo'), 'ajeno');
    assert.equal(compartirInforme(id, 'jose'), 'hecho');
    assert.equal(recoger(id, 'medardo'), 'cartera.pdf', 'compartido a propósito, ya se puede');
    assert.equal(informeCompartido(id), true);
  });

  await t.test('un informe sin autor —de Telegram sin identificar— no se le reserva a nadie', () => {
    const id = guardarInforme({ pdf: Buffer.from('%PDF-'), nombre: 'suelto.pdf', dicho: '' }, null);
    assert.equal(recoger(id, 'medardo'), 'suelto.pdf');
  });

  await t.test('compartir algo que ya caducó no inventa un informe', () => {
    assert.equal(compartirInforme('inventado', 'jose'), 'no-esta');
  });
});
