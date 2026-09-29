/**
 * Los avatares de la app de AU-RA (mobile/src/avatares): qué foto de Claudio sale en cada estado,
 * cómo sigue la boca a la voz y cómo se reparte la pantalla según el avatar y la orientación.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AVATARES, distribucion, normalizarAvatarId, usaBancoDeVoz } from '../mobile/src/avatares/catalogo';
import { aperturaBoca, bocaSigueVoz, fotoCuerpo, fotoPorMirada, fotoRetrato } from '../mobile/src/avatares/expresiones';

test('tres avatares, ids únicos; lo desconocido es AU-RA', () => {
  assert.deepEqual(AVATARES.map((a) => a.id), ['aura', 'claudio', 'claudio-pie']);
  assert.equal(normalizarAvatarId('claudio-pie'), 'claudio-pie');
  assert.equal(normalizarAvatarId('electrum'), 'aura');
  assert.equal(normalizarAvatarId(undefined), 'aura');
  // Los clips grabados son de Dora: solo AU-RA los usa.
  assert.equal(usaBancoDeVoz('aura'), true);
  assert.equal(usaBancoDeVoz('claudio'), false);
});

test('pantalla: horizontal a pantalla completa; vertical, cuadro con chat abajo; el de pie al revés', () => {
  assert.deepEqual(distribucion('aura', true), { tipo: 'completa', chat: 'flota' });
  assert.deepEqual(distribucion('claudio', false), { tipo: 'cuadro', chat: 'abajo' });
  assert.deepEqual(distribucion('claudio-pie', false), { tipo: 'completa', chat: 'flota' });
  assert.deepEqual(distribucion('claudio-pie', true), { tipo: 'cuadro', chat: 'lado' });
});

test('cada estado de la cara tiene su foto de Claudio, y solo la de siempre mueve la boca', () => {
  assert.equal(fotoRetrato('LAUGH'), 'risa');
  assert.equal(fotoRetrato('SURPRISED'), 'sorpresa');
  assert.equal(fotoRetrato('THINKING'), 'pensando');
  assert.equal(fotoRetrato('SLEEPING'), 'sueno');
  assert.equal(fotoRetrato('SING'), 'canta');
  assert.equal(fotoRetrato('SPEAKING'), 'base');
  assert.equal(bocaSigueVoz('SPEAKING'), true);
  assert.equal(bocaSigueVoz('LAUGH'), false);
  assert.equal(fotoPorMirada(-0.8), 'mira');
  assert.equal(fotoPorMirada(0.1), null);
});

test('la boca sube por umbrales y no tiembla alrededor de uno (histéresis)', () => {
  assert.equal(aperturaBoca(0, 0), 0);
  assert.equal(aperturaBoca(0.2, 0), 1);
  assert.equal(aperturaBoca(0.9, 0), 3);
  // Estando en 1, bajar un poco del umbral (0,16) no la cierra; bajar más, sí.
  assert.equal(aperturaBoca(0.13, 1), 1);
  assert.equal(aperturaBoca(0.08, 1), 0);
  assert.equal(fotoCuerpo(false, 3), 'base');
  assert.equal(fotoCuerpo(true, 0), 'cierra');
  assert.equal(fotoCuerpo(true, 3), 'habla2');
});

test('las fotos que piden los componentes existen en el APK', () => {
  const raiz = path.join(process.cwd(), 'mobile');
  for (const archivo of ['src/avatares/ClaudioRetrato.tsx', 'src/avatares/ClaudioDePie.tsx']) {
    const src = fs.readFileSync(path.join(raiz, archivo), 'utf8');
    const pedidas = [...src.matchAll(/require\('\.\.\/\.\.\/(assets\/[^']+)'\)/g)].map((m) => m[1]);
    assert.ok(pedidas.length >= 4, archivo);
    for (const p of pedidas) assert.ok(fs.existsSync(path.join(raiz, p)), `falta ${p}`);
  }
});
