/**
 * El catálogo de etiquetas de audio de la voz v4 (mobile/src/compa/etiquetasVoz.ts) y la variedad de
 * las frases de espera. José (1-oct): «todas las voces con audio tags… más random tags, muchos
 * diferentes, no escuchemos siempre lo mismo»; «el esperar una respuesta, "déjame ver", es molesto».
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ETIQUETAS_VERIFICADAS, MemoriaEtiquetas, conEtiqueta, etiquetasDe } from '../mobile/src/compa/etiquetasVoz';
import { ESTADOS_FRASE, MemoriaFrases, arranqueDe, fraseDeEstado, frasesDe } from '../mobile/src/compa/frasesEstado';
import { TONOS_VOZ, quitarExpresiones } from '../lib/expresiones';
import { etiquetaV4, guionEleven } from '../server/eleven';
import { buildPersonality } from '../server/desk';

const AVATARES = ['ojos', 'aura', 'claudio', 'antonio'] as const;
const ESPERA = ['pensando', 'revisando', 'buscando', 'calculando', 'leyendo', 'mirando', 'seguimiento', 'conectando'] as const;

test('el catálogo solo usa etiquetas verificadas, y el servidor las pasa tal cual a la voz v4', () => {
  const verificadas = new Set<string>(ETIQUETAS_VERIFICADAS);
  for (const e of ETIQUETAS_VERIFICADAS) assert.equal(etiquetaV4(e), e, `el servidor deja pasar [${e}]`);
  for (const estado of ESTADOS_FRASE)
    for (const a of AVATARES) for (const t of etiquetasDe(estado, a)) assert.ok(verificadas.has(t), `${estado}/${a}: [${t}] no está verificada`);
  // Cada momento de espera tiene de dónde escoger (no siempre la misma).
  for (const estado of ESPERA) for (const a of AVATARES) assert.ok(etiquetasDe(estado, a).length >= 3, `${estado}/${a}: pocas etiquetas`);
});

test('cada uno con su forma de ser: el Guardián nunca se ríe; Claudio es pícaro; ANT-ONIO, enérgico', () => {
  for (const estado of ESTADOS_FRASE) assert.ok(!etiquetasDe(estado, 'ojos').some((t) => /laugh|chuckle|giggle|scoff/.test(t)), estado);
  assert.ok(etiquetasDe('buscando', 'claudio').includes('mischievously'));
  assert.ok(etiquetasDe('buscando', 'antonio').includes('enthusiastic'));
  assert.ok(!etiquetasDe('buscando', 'aura').includes('mischievously'), 'lo de Claudio no se le pega a AU-RA');
});

test('no se oye siempre lo mismo: las etiquetas no se repiten seguidas y salen muchas distintas', () => {
  const m = new MemoriaEtiquetas();
  let semilla = 7;
  const azar = () => ((semilla = (semilla * 9301 + 49297) % 233280) / 233280);
  const dichas: string[] = [];
  for (let k = 0; k < 40; k++) {
    const t = conEtiqueta('Buscando…', 'buscando', 'claudio', { azar, memoria: m });
    const e = /^\[([^\]]+)\]/.exec(t)?.[1];
    if (e) dichas.push(e);
  }
  assert.ok(dichas.length >= 20 && dichas.length < 40, `casi siempre lleva etiqueta, pero no todas: ${dichas.length}/40`);
  for (let i = 1; i < dichas.length; i++) assert.notEqual(dichas[i], dichas[i - 1], `repitió [${dichas[i]}] seguida`);
  assert.ok(new Set(dichas).size >= 6, `variedad: ${[...new Set(dichas)].join(', ')}`);
  // Si la frase ya empieza con «Mmm», no le toca el tarareo encima.
  for (let k = 0; k < 30; k++) assert.doesNotMatch(conEtiqueta('Mmm, a ver…', 'pensando', 'aura', { azar: () => k / 31, memoria: m }), /^\[hums\]/);
  // Nunca dos etiquetas.
  assert.equal(conEtiqueta('[calm] Ya casi.', 'seguimiento', 'aura', { azar: () => 0.1, memoria: m }), '[calm] Ya casi.');
});

test('las frases de espera: sin «déjame ver» y sin abrir igual dos veces seguidas', () => {
  for (const estado of ESPERA)
    for (const a of AVATARES) {
      for (const f of frasesDe(estado, a, 'es')) assert.doesNotMatch(f, /d[eé]jame ver\b/i, `${estado}/${a}: ${f}`);
      for (const f of frasesDe(estado, a, 'en')) assert.doesNotMatch(f, /let me see[.…]*$/i, `${estado}/${a}: ${f}`);
    }
  for (const a of AVATARES) {
    const m = new MemoriaFrases();
    let antes = '';
    for (let k = 0; k < 40; k++) {
      const f = fraseDeEstado(k % 3 ? 'pensando' : 'revisando', a, 'es', { memoria: m }).texto;
      assert.notEqual(arranqueDe(f), antes, `${a}: dos seguidas abren con «${antes}»`);
      antes = arranqueDe(f);
    }
  }
});

test('el cerebro: no abre con «déjame ver» y conoce las marcas de tono, que la voz actúa y la pantalla no enseña', () => {
  const p = buildPersonality({ nombre: 'José', canal: 'mesa', modo: 'GUARDIAN', mando: true } as any);
  assert.doesNotMatch(p, /un «mmm» o un «déjame ver» antes de la respuesta es humano/);
  assert.match(p, /nunca empieces dos respuestas seguidas igual/);
  for (const t of TONOS_VOZ) {
    assert.ok(p.includes(`[${t}]`), `el prompt enseña [${t}]`);
    assert.ok(etiquetaV4(t), `[${t}] tiene su etiqueta v4`);
    assert.equal(quitarExpresiones(`[${t}] Hola.`).trim(), 'Hola.', `[${t}] no se lee en pantalla`);
  }
  // La mesa (texto a voz) la pasa a su etiqueta en inglés.
  assert.equal(guionEleven('[con picardía] Ya lo tengo.', 'neutral', (x) => x.trim()), '[mischievously] Ya lo tengo.');
  assert.equal(guionEleven('Mira [tarareo] esto.', 'neutral', (x) => x.trim()), 'Mira [hums] esto.');
});
