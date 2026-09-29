/**
 * La app de AU-RA tiene tres avatares (Guardián, AU-RA y Claudio) y cada uno suena distinto en
 * español y en inglés (server/eleven.ts). Un avatar o idioma desconocido nunca cambia la voz.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cantar, oracionPorTema, ORACION_DEL_DIA_EN } from '../server/voz';
import { afinarParaBocaIngles } from '../server/habla';
import { lineaAvatar, normalizarAvatar, normalizarIdioma, vozEleven, VOCES_ELEVEN, VOZ_CLAUDIO_ELEVEN, VOZ_ELECTRUM_ELEVEN } from '../server/eleven';

test('avatar: solo los tres conocidos; «claudio-pie» (4.5) es Claudio; cualquier otra cosa es AU-RA', () => {
  assert.equal(normalizarAvatar('claudio'), 'claudio');
  assert.equal(normalizarAvatar(' CLAUDIO-PIE '), 'claudio');
  assert.equal(normalizarAvatar('ojos'), 'ojos');
  assert.equal(normalizarAvatar('Guardián'), 'ojos');
  assert.equal(normalizarAvatar(undefined), 'aura');
  assert.equal(normalizarAvatar('electrum'), 'aura');
  assert.equal(normalizarAvatar(['claudio']), 'aura');
});

test('idioma: inglés solo si lo pide; todo lo demás es español', () => {
  assert.equal(normalizarIdioma('en'), 'en');
  assert.equal(normalizarIdioma('en-US'), 'en');
  assert.equal(normalizarIdioma('EN'), 'en');
  assert.equal(normalizarIdioma('es'), 'es');
  assert.equal(normalizarIdioma('fr'), 'es');
  assert.equal(normalizarIdioma(['en']), 'es');
  assert.equal(normalizarIdioma(undefined), 'es');
});

test('voz por avatar e idioma: seis voces distintas; Dr Electrum no cambia', () => {
  const claves = Object.keys(process.env).filter((k) => k.startsWith('ELEVENLABS_VOZ_'));
  const antes = Object.fromEntries(claves.map((k) => [k, process.env[k]]));
  for (const k of claves) delete process.env[k];
  try {
    const todas = new Set<string>();
    for (const a of ['ojos', 'aura', 'claudio'] as const) {
      for (const i of ['es', 'en'] as const) {
        const v = vozEleven('ultron', a, i);
        assert.equal(v, VOCES_ELEVEN[a][i]);
        assert.match(String(v), /^[A-Za-z0-9]{20}$/);
        todas.add(String(v));
      }
    }
    assert.equal(todas.size, 6, 'cada avatar e idioma con su propia voz');
    assert.equal(VOZ_CLAUDIO_ELEVEN, '5hNQxGboC72zatTcGoJN');
    assert.equal(vozEleven('ultron', 'aura'), VOCES_ELEVEN.aura.es);
    // El avatar es cosa de la app de AU-RA: al doctor no le cambia la voz.
    assert.equal(vozEleven('electrum', 'claudio', 'en'), VOZ_ELECTRUM_ELEVEN);
    // Se cambian sin tocar código; la variable vieja vale para el español.
    process.env.ELEVENLABS_VOZ_CLAUDIO = 'vieja';
    assert.equal(vozEleven('ultron', 'claudio', 'es'), 'vieja');
    assert.equal(vozEleven('ultron', 'claudio', 'en'), VOCES_ELEVEN.claudio.en);
    process.env.ELEVENLABS_VOZ_CLAUDIO_EN = 'nueva';
    assert.equal(vozEleven('ultron', 'claudio', 'en'), 'nueva');
  } finally {
    for (const k of Object.keys(process.env).filter((k) => k.startsWith('ELEVENLABS_VOZ_'))) delete process.env[k];
    for (const k of claves) process.env[k] = antes[k];
  }
});

test('el cerebro sabe quién está en la mesa, su oficio y en qué idioma contestar', () => {
  assert.match(lineaAvatar('claudio'), /Te llamas Claudio, no AU-RA/);
  assert.match(lineaAvatar('claudio'), /marketing/);
  assert.match(lineaAvatar('ojos'), /Guardián/);
  assert.match(lineaAvatar('ojos'), /cámara/);
  assert.match(lineaAvatar('aura'), /agenda/);
  assert.doesNotMatch(lineaAvatar('aura'), /INGLÉS/);
  assert.match(lineaAvatar('aura', 'en'), /Responde SIEMPRE en inglés/);
  for (const a of ['ojos', 'aura', 'claudio'] as const) assert.ok(lineaAvatar(a, 'en').length < 900);
});

test('en inglés la boca no pasa cifras a palabras en español', () => {
  assert.equal(afinarParaBocaIngles('**AU-RA** has 25 km — jajaja'), 'Aura has 25 km, ha ha');
  assert.match(oracionPorTema('my family', 'en'), /Lord Jesus, today I bring you this: my family\./);
  assert.match(oracionPorTema('mi familia'), /Señor Jesús, hoy te traigo esto: mi familia\./);
  assert.match(ORACION_DEL_DIA_EN, /Amen\.$/);
});

test('el repertorio grabado es de AU-RA: Claudio y el Guardián no lo cantan con la voz de ella', async () => {
  // Sin tocar la red: con otro avatar, un id del repertorio no busca ni sirve la grabación.
  assert.equal(await cantar({ id: 'jesus', avatar: 'claudio' }), null);
  assert.equal(await cantar({ id: 'waymaker', avatar: 'claudio-pie' }), null);
  assert.equal(await cantar({ id: 'waymaker', avatar: 'ojos' }), null);
});
