/**
 * CONTRASTE POR TOKEN (auditoría A17).
 *
 * El placeholder del dock era #8A847C sobre #34363A: 3,27:1, por debajo del 4,5:1 que pide WCAG
 * para texto normal. La causa no era un gris mal elegido en un sitio: los colores estaban escritos a
 * mano en cada componente y nadie los medía. Ahora viven en src/01-diseno/aura.ts y esta prueba los
 * mide, en claro y en oscuro, con la fórmula de WCAG (no a ojo).
 *
 * También fija que los colores no vuelvan a escribirse sueltos en las pantallas de AU-RA: si un
 * componente pinta un hex, esa combinación no pasa por aquí.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PARES, TEMAS, contraste, variablesDe, type NombreTema } from '../src/01-diseno/aura';

const TEMAS_TODOS = Object.keys(TEMAS) as NombreTema[];

test('la fórmula es la de WCAG (casos conocidos)', () => {
  assert.equal(contraste('#000000', '#FFFFFF').toFixed(2), '21.00');
  assert.equal(contraste('#FFFFFF', '#FFFFFF').toFixed(2), '1.00');
  // El caso de la auditoría: el placeholder de antes no llegaba.
  assert.equal(contraste('#8A847C', '#34363A').toFixed(2), '3.27');
  assert.ok(contraste('#8A847C', '#34363A') < 4.5);
});

for (const tema of TEMAS_TODOS) {
  test(`tema ${tema}: cada par de la lista llega a su mínimo`, () => {
    const t = TEMAS[tema];
    const fallos: string[] = [];
    for (const par of PARES) {
      const c = contraste(t[par.texto], t[par.fondo]);
      if (c < par.minimo) fallos.push(`${par.texto} (${t[par.texto]}) sobre ${par.fondo} (${t[par.fondo]}) = ${c.toFixed(2)}:1 < ${par.minimo} · ${par.uso}`);
    }
    assert.deepEqual(fallos, []);
  });

  test(`tema ${tema}: el placeholder y el texto secundario pasan 4,5:1 en todas sus superficies`, () => {
    const t = TEMAS[tema];
    for (const texto of ['tinta-2', 'tinta-3'] as const) {
      for (const fondo of ['fondo', 'panel', 'panel-2', 'panel-hondo'] as const) {
        const c = contraste(t[texto], t[fondo]);
        assert.ok(c >= 4.5, `${tema}: ${texto} sobre ${fondo} = ${c.toFixed(2)}:1`);
      }
    }
  });

  test(`tema ${tema}: las variables CSS salen de los tokens`, () => {
    const v = variablesDe(tema);
    assert.equal(v['--aura-tinta-3'], TEMAS[tema]['tinta-3']);
    assert.equal(v['--aura-tipo-cuerpo'], '16px');
    assert.equal(v['--aura-espacio-tactil'], '44px');
  });
}

test('los dos temas tienen los mismos tokens', () => {
  assert.deepEqual(Object.keys(TEMAS.claro).sort(), Object.keys(TEMAS.oscuro).sort());
});

test('tema.css no define colores: los toma de los tokens', () => {
  const css = fs.readFileSync(path.join(process.cwd(), 'src/11-sala/tema.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const hex = css.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.deepEqual(hex, [], 'un color escrito en tema.css se saltaría la prueba de contraste');
});

test('las pantallas de AU-RA no pintan hex sueltos (usan var(--aura-*))', () => {
  const carpetas = ['src/07-pantallas', 'src/13-trabajo'];
  const hallados: string[] = [];
  for (const c of carpetas) {
    for (const f of fs.readdirSync(path.join(process.cwd(), c))) {
      if (!/\.tsx?$/.test(f)) continue;
      const src = fs.readFileSync(path.join(process.cwd(), c, f), 'utf8');
      for (const m of src.matchAll(/(?:bg|text|border|placeholder|from|to|ring|outline)-\[#[0-9a-fA-F]{3,8}\]/g)) hallados.push(`${c}/${f}: ${m[0]}`);
    }
  }
  assert.deepEqual(hallados, []);
});
