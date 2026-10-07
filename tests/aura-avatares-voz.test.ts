/**
 * La app de AU-RA tiene cuatro avatares (Guardián, AU-RA, Claudio y ANT-ONIO) y cada uno suena
 * distinto en español y en inglés (server/eleven.ts). Un avatar o idioma desconocido nunca cambia la
 * voz, y agregar uno no cambia las de los demás.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cantar, oracionPorTema, ORACION_DEL_DIA_EN } from '../server/voz';
import { afinarParaBocaIngles } from '../server/habla';
import { lineaAvatar, NOMBRE_AVATAR, normalizarAvatar, normalizarIdioma, vozEleven, VOCES_ELEVEN, VOZ_CLAUDIO_ELEVEN, VOZ_ELECTRUM_ELEVEN } from '../server/eleven';
import { AGENTES_ENV, MODO_DE_AVATAR, agenteDe } from '../server/voz-agente';
import { AVATARES_AGENTE, PALABRAS_ASR, avataresPedidos } from '../scripts/elevenlabs-agentes';

const AVATARES = ['ojos', 'aura', 'claudio', 'antonio'] as const;

test('avatar: solo los cuatro conocidos; «claudio-pie» (4.5) es Claudio; cualquier otra cosa es AU-RA', () => {
  assert.equal(normalizarAvatar('claudio'), 'claudio');
  assert.equal(normalizarAvatar(' CLAUDIO-PIE '), 'claudio');
  assert.equal(normalizarAvatar('ojos'), 'ojos');
  assert.equal(normalizarAvatar('Guardián'), 'ojos');
  assert.equal(normalizarAvatar('antonio'), 'antonio');
  assert.equal(normalizarAvatar(' ANT-ONIO '), 'antonio');
  assert.equal(normalizarAvatar('hormiga'), 'antonio');
  assert.equal(normalizarAvatar(undefined), 'aura');
  assert.equal(normalizarAvatar('electrum'), 'aura');
  assert.equal(normalizarAvatar(['claudio']), 'aura');
  assert.equal(normalizarAvatar(['antonio']), 'aura');
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

test('las voces de Guardián, AU-RA y Claudio siguen siendo las mismas (ANT-ONIO no las tocó); los agentes, por entorno', () => {
  // Si alguien cambia uno de estos ids, esta prueba tiene que fallar: son las voces que eligió José.
  assert.deepEqual(VOCES_ELEVEN.ojos, { es: 'jR5VcWrKqhJJTTbtXtU5', en: '1krh7GKGPtz8i429a6kk' });
  assert.deepEqual(VOCES_ELEVEN.aura, { es: 'AoT6sxPBYB0OGpSnIiwc', en: 'NPil3puXYP3J45yudmVD' });
  assert.deepEqual(VOCES_ELEVEN.claudio, { es: '5hNQxGboC72zatTcGoJN', en: 'mm5ADfbOYUswycjGCmWd' });
  assert.deepEqual(VOCES_ELEVEN.antonio, { es: 'wXojZ3FhzsE0AumH6Oym', en: 'I1ejplf72DWHJzwAiw4n' });
  assert.deepEqual(Object.keys(VOCES_ELEVEN), [...AVATARES]);
  // Los agentes ya no viven en el repositorio (es público): cada uno en su variable de Render (auditoría C-1).
  assert.deepEqual(AGENTES_ENV.ojos, { es: 'ELEVENLABS_AGENTE_OJOS_ES', en: 'ELEVENLABS_AGENTE_OJOS_EN' });
  assert.deepEqual(AGENTES_ENV.antonio, { es: 'ELEVENLABS_AGENTE_ANTONIO_ES', en: 'ELEVENLABS_AGENTE_ANTONIO_EN' });
  assert.deepEqual(Object.keys(AGENTES_ENV), [...AVATARES]);
  const antes = process.env.ELEVENLABS_AGENTE_CLAUDIO_EN;
  process.env.ELEVENLABS_AGENTE_CLAUDIO_EN = 'agent_inventado_claudio_en';
  assert.equal(agenteDe('claudio', 'en'), 'agent_inventado_claudio_en');
  delete process.env.ELEVENLABS_AGENTE_CLAUDIO_EN;
  assert.equal(agenteDe('claudio', 'en'), '', 'sin la variable no hay agente (la ruta contesta 503), no un id escrito en el código');
  if (antes !== undefined) process.env.ELEVENLABS_AGENTE_CLAUDIO_EN = antes;
  assert.deepEqual(NOMBRE_AVATAR.antonio, { es: 'ANT-ONIO', en: 'ANT-ONIO' });
  assert.deepEqual(MODO_DE_AVATAR, { ojos: 'GUARDIAN', aura: 'CONVERSACION', claudio: 'CREATIVE', antonio: 'ANALYTICAL' });
});

test('el script de agentes: los cuatro por omisión; --solo toca uno y rechaza lo desconocido; el ASR oye «ANT-ONIO»', () => {
  assert.deepEqual(AVATARES_AGENTE, [...AVATARES]);
  assert.deepEqual(avataresPedidos(['node', 'x']), [...AVATARES]);
  assert.deepEqual(avataresPedidos(['node', 'x', '--solo', 'antonio']), ['antonio']);
  assert.deepEqual(avataresPedidos(['node', 'x', '--solo', 'Claudio']), ['claudio']);
  assert.throws(() => avataresPedidos(['node', 'x', '--solo', 'electrum']), /desconocido/);
  assert.throws(() => avataresPedidos(['node', 'x', '--solo']), /desconocido/);
  for (const p of ['ANT-ONIO', 'Antonio', 'AU-RA', 'Claudio']) assert.ok(PALABRAS_ASR.includes(p), p);
});

test('voz por avatar e idioma: ocho voces distintas; Dr Electrum no cambia', () => {
  const claves = Object.keys(process.env).filter((k) => k.startsWith('ELEVENLABS_VOZ_'));
  const antes = Object.fromEntries(claves.map((k) => [k, process.env[k]]));
  for (const k of claves) delete process.env[k];
  try {
    const todas = new Set<string>();
    for (const a of AVATARES) {
      for (const i of ['es', 'en'] as const) {
        const v = vozEleven('ultron', a, i);
        assert.equal(v, VOCES_ELEVEN[a][i]);
        assert.match(String(v), /^[A-Za-z0-9]{20}$/);
        todas.add(String(v));
      }
    }
    assert.equal(todas.size, 8, 'cada avatar e idioma con su propia voz');
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
  assert.match(lineaAvatar('antonio'), /Te llamas ANT-ONIO, no AU-RA/);
  assert.match(lineaAvatar('antonio'), /organizar y resolver/);
  assert.match(lineaAvatar('antonio', 'en'), /Responde SIEMPRE en inglés/);
  for (const a of AVATARES) assert.ok(lineaAvatar(a, 'en').length < 900, a);
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
  assert.equal(await cantar({ id: 'jesus', avatar: 'antonio' }), null);
});
