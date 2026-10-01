/**
 * Lo que se contesta al instante (lib/respuestas-fijas.ts) y la ficha de manos (lib/manos-ficha.ts).
 * José (1-oct): «grabar bien todo, que tengamos suficientes; preguntas comunes y no dejar pocas, para
 * rotar esas palabras y que no se sienta grabado… audio tags con lo que está haciendo… darles manos,
 * que sepan lo que pueden, y ejecutar en todos».
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { frasesFijas, intencionDe, respuestaFija, type Intencion } from '../lib/respuestas-fijas';
import { FICHA, fichaManosPrompt, quePuedoDecir } from '../lib/manos-ficha';
import { ETIQUETAS_VERIFICADAS } from '../mobile/src/compa/etiquetasVoz';
import { MANOS } from '../lib/manos-app';
import { quitarExpresiones } from '../lib/expresiones';

const PERSONAS = ['aura', 'ojos', 'claudio', 'antonio', 'electrum'] as const;
const INTENCIONES: Intencion[] = [
  'saludo', 'como_estas', 'estoy_bien', 'gracias', 'adios', 'quien_eres', 'quien_te_creo', 'que_puedes', 'que_haces',
  'me_escuchas', 'hora', 'fecha', 'espera', 'elogio', 'perdon', 'risa', 'eres_robot',
];
let semilla = 11;
const azar = () => ((semilla = (semilla * 9301 + 49297) % 233280) / 233280);

test('reconoce lo común solo si el mensaje ENTERO es eso', () => {
  const si: Array<[string, Intencion]> = [
    ['hola', 'saludo'], ['Hola AU-RA', 'saludo'], ['buenos días', 'saludo'], ['¿cómo estás?', 'como_estas'], ['qué tal', 'como_estas'],
    ['estoy bien', 'estoy_bien'], ['muy bien gracias', 'estoy_bien'], ['gracias', 'gracias'], ['adiós', 'adios'], ['nos vemos', 'adios'],
    ['¿quién eres?', 'quien_eres'], ['¿cómo te llamas?', 'quien_eres'], ['¿quién te creó?', 'quien_te_creo'], ['¿qué puedes hacer?', 'que_puedes'],
    ['¿qué haces?', 'que_haces'], ['¿en qué andas?', 'que_haces'], ['¿me escuchas?', 'me_escuchas'], ['¿estás ahí?', 'me_escuchas'], ['aló', 'me_escuchas'],
    ['¿qué hora es?', 'hora'], ['¿qué día es hoy?', 'fecha'], ['espera un momento', 'espera'], ['eres genial', 'elogio'], ['te quiero', 'elogio'],
    ['perdón', 'perdon'], ['jajaja', 'risa'], ['¿eres un robot?', 'eres_robot'], ['Oye Claudio, ¿qué hora es?', 'hora'],
    ['what time is it', 'hora'], ['who are you', 'quien_eres'], ['can you hear me', 'me_escuchas'], ['thank you', 'gracias'],
  ];
  for (const [t, i] of si) assert.equal(intencionDe(t), i, t);
  // Lo que puede ser el «sí» de algo pendiente, una orden o un apuro: nunca entra.
  for (const t of ['ok', 'listo', 'dale', 'sí', 'no', 'bien', 'ayuda', 'help', 'abre spotify', 'hola, mándale un mensaje a Beto', 'gracias, mándalo', '¿qué hora es en Madrid?', 'llámame', 'recuérdame a las tres', ''])
    assert.equal(intencionDe(t), null, t);
});

test('hay de sobra para rotar: muchas frases por intención y ninguna se repite seguida para la misma persona', () => {
  for (const p of PERSONAS)
    for (const i of INTENCIONES)
      for (const idioma of ['es', 'en'] as const) {
        const n = frasesFijas(i, p, idioma).length;
        const minimo = ['saludo', 'como_estas', 'gracias', 'adios', 'me_escuchas'].includes(i) && (p === 'aura' || p === 'claudio' || p === 'antonio') ? 8 : 2;
        assert.ok(n >= minimo, `${p}/${i}/${idioma}: solo ${n}`);
      }
  // Diez saludos seguidos a la misma persona: ninguno igual al anterior y salen muchos distintos.
  const dichos: string[] = [];
  for (let k = 0; k < 10; k++) dichos.push(respuestaFija('hola', { avatar: 'aura', nombre: 'José', quien: 'rotar@x', azar })!.texto);
  for (let k = 1; k < dichos.length; k++) assert.notEqual(dichos[k], dichos[k - 1]);
  assert.ok(new Set(dichos).size >= 7, `variedad: ${new Set(dichos).size}/10`);
});

test('personalizado: el saludo siempre lleva su nombre, y el género de cada avatar concuerda', () => {
  for (const p of PERSONAS)
    for (const idioma of ['es', 'en'] as const) for (const f of frasesFijas('saludo', p, idioma)) assert.match(f, /\{n\}/, `${p}/${idioma}: «${f}» sin nombre`);
  for (let k = 0; k < 30; k++) {
    const r = respuestaFija('hola', { avatar: 'claudio', nombre: 'Majo Pérez', quien: `g${k}`, azar })!;
    assert.match(r.texto, /Majo/);
    assert.doesNotMatch(r.texto, /Pérez|\{|\}/);
    assert.doesNotMatch(r.texto, /\blista\b|contenta|atenta/, `Claudio habla en masculino: ${r.texto}`);
  }
  for (let k = 0; k < 30; k++) assert.doesNotMatch(respuestaFija('¿cómo estás?', { avatar: 'aura', quien: `a${k}`, azar })!.texto, /\blisto\b|contento|atento/);
  // Sin nombre, la frase queda bien igual (sin «, » colgando).
  assert.doesNotMatch(respuestaFija('hola', { avatar: 'aura', azar })!.texto, /, [!?.]|,\s*$|\{n\}/);
});

test('las etiquetas de voz van con lo que dice, verificadas, y el Guardián y Dr Electrum no se ríen', () => {
  const verificadas = new Set<string>(ETIQUETAS_VERIFICADAS);
  for (const p of PERSONAS)
    for (const i of INTENCIONES) {
      const msg = { saludo: 'hola', como_estas: '¿cómo estás?', estoy_bien: 'estoy bien', gracias: 'gracias', adios: 'adiós', quien_eres: '¿quién eres?', quien_te_creo: '¿quién te creó?', que_puedes: '¿qué puedes hacer?', que_haces: '¿qué haces?', me_escuchas: '¿me escuchas?', hora: '¿qué hora es?', fecha: '¿qué día es hoy?', espera: 'espera', elogio: 'eres genial', perdon: 'perdón', risa: 'jajaja', eres_robot: '¿eres un robot?' }[i];
      for (let k = 0; k < 6; k++) {
        const r = respuestaFija(msg, { avatar: p, quien: `${p}${i}${k}`, azar })!;
        assert.equal(r.intencion, i, `${p}: «${msg}»`);
        const e = /^\[([^\]]+)\]/.exec(r.voz)?.[1];
        if (e) {
          assert.ok(verificadas.has(e), `[${e}] sin verificar`);
          if (p === 'ojos' || p === 'electrum') assert.doesNotMatch(e, /laugh|chuckle|giggle|playful|cheerful|delighted|enthusiastic/, `${p}: [${e}]`);
        }
        // Lo que se lee no lleva la etiqueta; lo que se dice es lo mismo con ella.
        assert.doesNotMatch(r.texto, /\[/);
        assert.equal(quitarExpresiones(r.voz).trim(), r.texto);
      }
    }
});

test('la hora y la fecha son las de Honduras (UTC−6)', () => {
  const ahora = new Date('2026-10-01T22:05:00Z'); // 4:05 p. m. en Tegucigalpa
  assert.match(respuestaFija('¿qué hora es?', { ahora, azar })!.texto, /4:05 de la tarde/);
  assert.match(respuestaFija('what time is it', { idioma: 'en', ahora, azar })!.texto, /4:05 p\.m\./);
  assert.match(respuestaFija('¿qué día es hoy?', { ahora, azar })!.texto, /jueves.*1 de octubre/);
  const noche = new Date('2026-10-02T04:30:00Z'); // 10:30 p. m. del 1-oct en Honduras
  assert.match(respuestaFija('¿qué día es hoy?', { ahora: noche, azar })!.texto, /jueves.*1 de octubre/);
  // «¿Cómo amaneciste?» solo en la mañana; de noche, «buenas noches».
  for (let k = 0; k < 40; k++) {
    const t = respuestaFija('hola', { ahora: noche, quien: `n${k}`, azar })!.texto;
    assert.doesNotMatch(t, /amaneciste|Buenos días|Buenas tardes/, t);
  }
});

test('«¿qué puedes hacer?» dice lo que esa plataforma hace de verdad, rotando, y Dr Electrum habla de usted', () => {
  const web = respuestaFija('¿qué puedes hacer?', { plataforma: 'web', quien: 'w', azar })!.texto;
  assert.doesNotMatch(web, /recordarte|llamarte|mensajes|chats/, `la web no llama ni manda mensajes: ${web}`);
  const pc = respuestaFija('¿qué puedes hacer?', { plataforma: 'windows', quien: 'pc', azar })!.texto;
  assert.match(pc, /programas|ventanas|música|volumen|escribir|Google|archivos|capturas|recordarte|correo|PULSE2CHAT|botones/);
  for (let k = 0; k < 10; k++) {
    const doc = respuestaFija('¿qué puede hacer?', { avatar: 'electrum', quien: `e${k}`, azar });
    assert.equal(doc?.intencion, 'que_puedes', '«¿qué puede hacer?» (de usted) también entra');
    assert.match(doc!.texto, /concesiones|expedientes|áreas|geología|coordenadas|cálculos|metales|informes/);
    assert.doesNotMatch(doc!.texto, /\b(dime|te|tú|tus)\b/i, `Dr Electrum trata de usted: ${doc!.texto}`);
  }
  assert.equal(intencionDe('¿me escucha?'), 'me_escuchas');
  assert.equal(intencionDe('¿quién es usted?'), 'quien_eres');
});

test('la ficha de manos: cada mano existe de verdad en su plataforma, y entra en el prompt', () => {
  const capacidades = readFileSync('lib/capacidades.ts', 'utf8');
  const tipos = readFileSync('lib/perfiles/tipos.ts', 'utf8');
  const acciones = readFileSync('lib/acciones-app.ts', 'utf8');
  const windows = readFileSync('windows/src/Aura.Windows.Core/Manos.cs', 'utf8');
  const electrum = readFileSync('server/electrum/manos.ts', 'utf8') + readFileSync('lib/manos/compartidas.ts', 'utf8');
  const existe = (de: string, donde: 'app' | 'web' | 'windows' | 'electrum') => {
    if (donde === 'windows') return new RegExp(`\\b${de}\\b`).test(windows);
    if (donde === 'electrum') return electrum.includes(`nombre: '${de}'`);
    return (MANOS as readonly string[]).includes(de) || acciones.includes(`tipo: '${de}'`) || tipos.includes(`'${de}'`) || capacidades.includes(`id: '${de}'`);
  };
  for (const [donde, manos] of Object.entries(FICHA) as Array<[keyof typeof FICHA, (typeof FICHA)['app']]>)
    for (const m of manos) assert.ok(existe(m.de, donde), `${donde}: «${m.es}» dice usar «${m.de}», que no existe ahí`);
  assert.match(fichaManosPrompt('web'), /no llamas, no mandas mensajes de PULSE2CHAT/);
  assert.match(fichaManosPrompt('app', 'en'), /YOUR HANDS HERE/);
  assert.match(fichaManosPrompt('windows'), /programas/);
  // Rota: dos veces seguidas no nombra siempre lo mismo.
  const listas = new Set(Array.from({ length: 8 }, () => quePuedoDecir('app', 'es', azar)));
  assert.ok(listas.size >= 4, `«¿qué puedes hacer?» rota: ${listas.size}/8`);
  // El servidor pone la ficha en el system y contesta el banco antes de preparar el turno.
  const server = readFileSync('server.ts', 'utf8');
  assert.match(server, /fichaManosPrompt\(/);
  assert.ok(server.indexOf('respuestaFija(String(body?.message') < server.indexOf('const p = await prepararTurno(body, opciones);', server.indexOf('respuestaFija(String(body?.message')));
});
