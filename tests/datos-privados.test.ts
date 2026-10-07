/**
 * LO PERSONAL VIVE FUERA DEL REPO (lib/datos-privados.ts, auditoría del 7-oct, C-1). Sin las variables de Render el
 * servidor NO se cae: arranca cerrado (padrón de arranque vacío, sin cuentas de junta, sin alias, sin nombres en el
 * cerebro, sin agentes de voz) y deja UNA línea clara en el registro por variable. Con ellas, se usan tal cual.
 * Datos inventados.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const VARIABLES = [
  'ULTRON_PADRON_BASE', 'ULTRON_PADRON', 'AURA_JUNTA', 'AURA_CORREOS_ALIAS', 'AURA_HECHOS_SEMILLA', 'AURA_PERSONAS_CLAVE',
  'AURA_NOMBRES_JUNTA', 'AURA_NOMBRES_JUNTA_PUBLICO', 'AURA_CONOCIMIENTO_PERSONAS', 'AURA_CONOCIMIENTO_PERSONAS_PUBLICO',
  'AURA_ORACION_BENDICE', 'AURA_CANCION_DE', 'CUENTAS_APROBADOR', 'ELEVENLABS_AGENTE_AURA_ES',
];
for (const k of VARIABLES) delete process.env[k];

// Lo que se avisa al cargar (el cerebro se arma al importar) y después.
const avisos: string[] = [];
const warnReal = console.warn;
console.warn = (...a: unknown[]) => void avisos.push(a.map(String).join(' '));
const { padron, identificar, reiniciarPadron } = await import('../lib/acceso');
const { normalizarCorreo, cuentaDeJunta } = await import('../server/desk');
const { semillaLarga, esHechoLargo } = await import('../server/hechos');
const { CONOCIMIENTO_OG } = await import('../src/05-cerebro-og/conocimiento');
const { CONOCIMIENTO_OG_PUBLICO } = await import('../src/05-cerebro-og/conocimiento-publico');
const { agenteDe } = await import('../server/voz-agente');
const { ORACION_DEL_DIA, cancionPorPedido } = await import('../server/voz');
const { aprobadores } = await import('../server/cuentas-rutas');
const { quienesMandan } = await import('../lib/junta');
const { _olvidarAvisosEnv } = await import('../lib/datos-privados');
console.warn = warnReal;

/** Lo que se escribe en console.warn mientras corre `fn`. */
function registro(fn: () => unknown): string[] {
  const lineas: string[] = [];
  console.warn = (...a: unknown[]) => void lineas.push(a.map(String).join(' '));
  try {
    fn();
  } finally {
    console.warn = warnReal;
  }
  return lineas;
}

test('sin las variables: arranca cerrado, sin nombres, y lo dice en el registro (sin caerse)', () => {
  reiniciarPadron();
  const lineas = registro(() => {
    assert.deepEqual(padron(), [], 'nadie es junta por omisión');
    assert.equal(identificar({ correo: 'cualquiera@ordenglobal.org' }), null);
    assert.equal(normalizarCorreo('Viejo@Gmail.com'), 'viejo@gmail.com', 'sin alias');
    assert.equal(cuentaDeJunta('alguien@ordenglobal.org'), undefined);
    assert.deepEqual(semillaLarga(), []);
    assert.equal(esHechoLargo('recuerda que la junta es el jueves'), true, 'lo genérico sigue');
    assert.equal(agenteDe('aura', 'es'), '', 'sin agente: la conversación fluida contesta 503');
    assert.deepEqual(aprobadores(), []);
    assert.equal(quienesMandan(), 'alguien de la junta con mando');
  });
  assert.match(CONOCIMIENTO_OG, /PERSONAS\n- Sitio ordenglobal\.org/, 'el bloque de personas, vacío');
  assert.match(CONOCIMIENTO_OG_PUBLICO, /PERSONAS\n- Sitio ordenglobal\.org/);
  assert.match(ORACION_DEL_DIA, /\[reverent\] Bendice a cada persona de esta junta, a sus familias/);
  const todo = [...avisos, ...lineas].join('\n');
  for (const v of ['ULTRON_PADRON_BASE', 'AURA_CORREOS_ALIAS', 'AURA_JUNTA', 'AURA_HECHOS_SEMILLA', 'AURA_CONOCIMIENTO_PERSONAS', 'AURA_CONOCIMIENTO_PERSONAS_PUBLICO', 'ELEVENLABS_AGENTE_AURA_ES', 'CUENTAS_APROBADOR']) {
    assert.match(todo, new RegExp(`\\[AU-RA\\] ${v} sin poner`), v);
  }
  // Una vez por variable, no en cada petición.
  assert.equal(registro(() => agenteDe('aura', 'es')).length, 0);
});

test('un JSON roto vale como si faltara: se avisa y se sigue cerrado', () => {
  _olvidarAvisosEnv();
  process.env.ULTRON_PADRON_BASE = '[{"id": "roto"';
  reiniciarPadron();
  const lineas = registro(() => assert.deepEqual(padron(), []));
  assert.match(lineas.join('\n'), /ULTRON_PADRON_BASE sin poner \(o ilegible\).*el JSON no se pudo leer/);
  delete process.env.ULTRON_PADRON_BASE;
});

test('con las variables: se usan tal cual (padrón, alias, junta, semilla, nombres, canciones, agentes)', () => {
  process.env.ULTRON_PADRON_BASE = JSON.stringify([
    { id: 'tomas', nombre: 'Tomás', correos: ['t.prueba@ordenglobal.org'], apodos: ['t'], acceso: { ultron: 'mando', electrum: 'mando' } },
    { id: 'lidia', nombre: 'Lidia', correos: [], apodos: ['zuniga'], acceso: { ultron: 'lee' } },
  ]);
  process.env.AURA_CORREOS_ALIAS = JSON.stringify({ 'tomas.viejo@gmail.com': 't.prueba@ordenglobal.org' });
  process.env.AURA_JUNTA = JSON.stringify({ 't.prueba@ordenglobal.org': { nombre: 'Tomás', rol: 'Junta de prueba' } });
  process.env.AURA_HECHOS_SEMILLA = JSON.stringify(['Tomás: fundador de prueba.']);
  process.env.AURA_PERSONAS_CLAVE = 'zuniga';
  process.env.AURA_CANCION_DE = JSON.stringify({ lidia: 'cuna' });
  process.env.CUENTAS_APROBADOR = 't.prueba@ordenglobal.org, otra@ordenglobal.org';
  process.env.ELEVENLABS_AGENTE_AURA_ES = 'agent_inventado';
  reiniciarPadron();
  assert.equal(identificar({ correo: 't.prueba@ordenglobal.org' })?.persona.id, 'tomas');
  assert.equal(identificar({ nombre: 'Zuniga' })?.persona.id, 'lidia');
  assert.equal(normalizarCorreo('Tomas.Viejo@gmail.com'), 't.prueba@ordenglobal.org');
  assert.deepEqual(cuentaDeJunta('t.prueba@ordenglobal.org'), { nombre: 'Tomás', rol: 'Junta de prueba' });
  assert.deepEqual(semillaLarga().map((h) => h.hecho), ['Tomás: fundador de prueba.']);
  assert.equal(esHechoLargo('ayer hablé con Zúñiga del contrato'), true);
  assert.equal(cancionPorPedido('canta la de lidia')?.id, 'cuna');
  assert.deepEqual(aprobadores(), ['t.prueba@ordenglobal.org', 'otra@ordenglobal.org']);
  assert.equal(agenteDe('aura', 'es'), 'agent_inventado');
  assert.equal(quienesMandan(), 'Tomás');
  for (const k of VARIABLES) delete process.env[k];
  reiniciarPadron();
});
