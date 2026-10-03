/**
 * Los avatares de la app de AU-RA (mobile/src/avatares): qué foto de Claudio (y de ANT-ONIO) sale en
 * cada estado, cómo sigue la boca a la voz y cómo se reparte la pantalla según el avatar y la
 * orientación.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AVATARES, avatarPorId, conFotos, distribucion, normalizarAvatarId } from '../mobile/src/avatares/catalogo';
import { aperturaBoca, bocaSigueVoz, fotoCuerpo, fotoPorMirada, fotoRetrato } from '../mobile/src/avatares/expresiones';

test('cuatro avatares (Guardián, AU-RA, Claudio, ANT-ONIO); los ids de siempre no cambian; lo desconocido es AU-RA', () => {
  // Los tres de antes, en su orden y con sus ids (van guardados en perfiles y teléfonos); ANT-ONIO al final.
  assert.deepEqual(AVATARES.map((a) => a.id), ['ojos', 'aura', 'claudio', 'antonio']);
  assert.equal(normalizarAvatarId('claudio-pie'), 'claudio');
  assert.equal(normalizarAvatarId('claudio'), 'claudio');
  assert.equal(normalizarAvatarId('ojos'), 'ojos');
  assert.equal(normalizarAvatarId('aura'), 'aura');
  assert.equal(normalizarAvatarId('antonio'), 'antonio');
  assert.equal(normalizarAvatarId('ant-onio'), 'antonio');
  assert.equal(normalizarAvatarId('electrum'), 'aura');
  assert.equal(normalizarAvatarId(undefined), 'aura');
  assert.equal(normalizarAvatarId(['antonio']), 'aura');
});

test('cada avatar tiene su interfaz: color propio, oficio y atajos en los dos idiomas', () => {
  const acentos = new Set(AVATARES.map((a) => a.tema.acento));
  assert.equal(acentos.size, AVATARES.length, 'un color distinto por avatar');
  assert.equal(avatarPorId('ojos').tema.acento, '#5CE1FF', 'el Guardián es celeste, como su cara');
  assert.equal(avatarPorId('aura').tema.acento, '#D6B56C', 'AU-RA sigue dorada');
  assert.equal(avatarPorId('claudio').tema.acento, '#FF9A4D', 'Claudio sigue naranja');
  assert.equal(avatarPorId('antonio').tema.acento, '#45C9DE', 'ANT-ONIO es cian, como su ropa');
  for (const a of AVATARES) {
    assert.ok(a.acciones.length >= 3, `${a.id}: atajos`);
    for (const t of [a.nombre, a.oficio, a.descripcion, a.voz, a.presentacion, ...a.acciones.flatMap((x) => [x.etiqueta, x.pedido])]) {
      assert.ok(t.es.trim() && t.en.trim(), `${a.id}: falta un idioma`);
    }
  }
  // Los atajos que son comandos de la mesa van en español en los dos idiomas (intenciones.ts).
  assert.equal(avatarPorId('ojos').acciones.find((x) => x.id === 'ver')?.pedido.en, 'qué ves');
  assert.match(avatarPorId('claudio').oficio.es, /marketing/);
  assert.match(avatarPorId('aura').oficio.es, /compañera/);
  assert.match(avatarPorId('antonio').oficio.es, /resolver/);
});

test('pantalla: todos a pantalla completa; Claudio y ANT-ONIO de pie si está derecho', () => {
  assert.deepEqual(distribucion('aura', true), { tipo: 'completa', chat: 'flota', pose: null });
  // José, 3-oct: AU-RA y el Guardián a pantalla completa también de pie (el chat en cuadro, solo trabajando).
  assert.deepEqual(distribucion('aura', false), { tipo: 'completa', chat: 'flota', pose: null });
  assert.deepEqual(distribucion('ojos', false), { tipo: 'completa', chat: 'flota', pose: null });
  assert.deepEqual(distribucion('ojos', true), { tipo: 'completa', chat: 'flota', pose: null });
  assert.deepEqual(distribucion('claudio', true), { tipo: 'completa', chat: 'flota', pose: 'retrato' });
  assert.deepEqual(distribucion('claudio', false), { tipo: 'completa', chat: 'flota', pose: 'pie' });
  assert.deepEqual(distribucion('antonio', true), { tipo: 'completa', chat: 'flota', pose: 'retrato' });
  assert.deepEqual(distribucion('antonio', false), { tipo: 'completa', chat: 'flota', pose: 'pie' });
  assert.deepEqual(AVATARES.filter((a) => conFotos(a.id)).map((a) => a.id), ['claudio', 'antonio']);
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
  // ANT-ONIO tiene el mismo juego que Claudio (sus fotos salen de su modelo 3D: scripts/avatar3d-fotos.mjs).
  const nombres = (d: string) => fs.readdirSync(path.join(raiz, 'assets/avatares', d)).sort();
  assert.deepEqual(nombres('antonio'), nombres('claudio'));
  assert.deepEqual(nombres('antonio-pie'), nombres('claudio-pie'));
});
