/**
 * El tema de los botones es uno solo para la web y la app, y cada tipo se lee (WCAG AA, 4,5:1).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { TEMA_BOTON } from '../src-electrum/ui/temaBoton';

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

test('tema de botones: la copia de la app es idéntica a la de la web', () => {
  const web = fs.readFileSync(path.join(raiz, 'src-electrum/ui/temaBoton.ts'), 'utf8');
  const app = fs.readFileSync(path.join(raiz, 'mobile/src/electrum/temaBoton.ts'), 'utf8');
  assert.equal(app, web, 'Copia src-electrum/ui/temaBoton.ts sobre mobile/src/electrum/temaBoton.ts');
});

function luminancia(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/** El fondo de la app, detrás de un botón transparente. */
const FONDO_PAGINA = '#07090B';

test('tema de botones: el texto de cada tipo pasa AA contra su cara', () => {
  for (const [tipo, c] of Object.entries(TEMA_BOTON.tipos)) {
    const cara = c.fondo === 'transparent' ? FONDO_PAGINA : c.fondo;
    const r = contraste(c.texto, cara);
    assert.ok(r >= 4.5, `${tipo}: ${c.texto} sobre ${cara} da ${r.toFixed(2)}:1`);
  }
  assert.ok(contraste(TEMA_BOTON.deshabilitado.texto, TEMA_BOTON.deshabilitado.fondo) >= 4.5);
});
