/**
 * P1 / A1 (auditoría del 4-oct): la VISTA AUTORIZADA del contexto. Un dato que la persona marcó «No usarlo»
 * (alcance `limitado`) no entra en NINGUNA copia activa del turno —su respuesta del perfil, lo que sé de ti,
 * los resúmenes de conversaciones de antes, lo que lee la iniciativa—, ni en texto ni en voz. La ficha
 * editable lo sigue mostrando (limitar no es borrar) y reactivarlo lo devuelve. Se apoya en el estado
 * durable del dato: sobrevive a un reinicio.
 *
 * Disco temporal, sin S3 ni red.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'contexto-aut-'));
for (const [k, v] of Object.entries({ ULTRON_CONOCER_DIR: 'co', ULTRON_EPISODIOS_DIR: 'ep', ULTRON_SUPRESIONES_DIR: 'su', ULTRON_PERFILES_DIR: 'pe', ULTRON_ABIERTOS_DIR: 'ab', ULTRON_INICIATIVA_DIR: 'in', ULTRON_MISIONES_DIR: 'mi', ULTRON_AVISOS_DIR: 'av', ULTRON_MEMORIA_MIEMBROS_DIR: 'mm' })) process.env[k] = path.join(dir, v);
Object.assign(process.env, { ULTRON_MEMORIA_BUCKET: '', PERFIL_DISCO_DURABLE: '1' });
const fetchOriginal = globalThis.fetch;
let intentosDeRed = 0;
globalThis.fetch = (async () => {
  intentosDeRed++;
  throw new Error('sin red en esta prueba');
}) as typeof fetch;
after(() => {
  globalThis.fetch = fetchOriginal;
  fs.rmSync(dir, { recursive: true, force: true });
});

const K = await import('../lib/conocer-persona');
const E = await import('../lib/episodios');
const P = await import('../lib/perfil-persona');
const O = await import('../lib/olvido');
const S = await import('../lib/supresiones');
const I = await import('../lib/iniciativa');
const { huellaDe } = await import('../lib/cerebro-comun');
const CT = await import('../server/contexto-turno');
const { piezasDelTurno } = await import('../server/prompt-turno');

const CIUDAD = /Puerto Sintetico/;
const reiniciar = () => {
  K._olvidarCacheConocer();
  E._olvidarEpisodios();
  P._olvidarCachePerfiles();
  S._olvidarCacheSupresiones();
};

function sembrarEpisodio(persona: string, resumen: string, t: number) {
  const caj = { version: 1, episodios: [{ id: 'ep_viejo', desde: t, hasta: t + 60_000, resumen, temas: ['pesca'], personas: [], abiertos: [], turnos: 4, via: 'modelo' }] };
  fs.mkdirSync(process.env.ULTRON_EPISODIOS_DIR!, { recursive: true });
  fs.writeFileSync(path.join(process.env.ULTRON_EPISODIOS_DIR!, `${huellaDe('episodios', persona)}.json`), JSON.stringify(caj));
}

/** Lo que el turno le da al modelo (system + mensaje), armado como en server.ts prepararTurno. */
async function turno(p: string, compacto: boolean) {
  const perfil = compacto ? (P.perfilEnCache(p) ?? (await P.leerPerfil(p))) : await P.leerPerfil(p);
  const b = CT.bloquesPersonales({ dueno: p, perfil, compacto, consulta: 'la pesca de los sábados', conPregunta: !compacto });
  const pz = piezasDelTurno({ nivel: 'miembro', canal: 'mesa', modo: 'normal', mando: false, quien: null, quienMem: null, hechos: [], compacto, bloquePerfil: b.bloquePerfil, conocer: b.conocer, conocerFirma: b.conocerFirma, bloqueCerebro: b.bloqueCerebro });
  return { todo: `${pz.fijo}\n${pz.delTurno}`, ...b };
}

test('A1 composición del turno (texto y voz): perfil, lo que sé y los resúmenes de antes no usan lo limitado; tras reinicio igual; reactivado vuelve', async () => {
  const p = 'compone@prueba.local';
  await P.actualizarPerfil(p, { encuesta: { vive: 'Puerto Sintetico', comida: 'Baleadas' } });
  const { dato } = await O.anotarDatoManual(p, { categoria: 'rutinas', dato: 'Vive en Puerto Sintetico', clave: 'vive', origen: 'primeravez' });
  sembrarEpisodio(p, 'Contó que vive en Puerto Sintetico y que sale a la pesca los sábados.', Date.now() - 86_400_000);
  reiniciar();
  await P.leerPerfil(p);
  await E.precargarCerebro(p);
  for (const compacto of [false, true]) {
    const t = await turno(p, compacto);
    assert.match(t.bloquePerfil, CIUDAD, `control (${compacto ? 'voz' : 'texto'}): el perfil lo usa`);
    assert.match(t.conocer, CIUDAD, 'control: lo que sé');
    assert.match(t.bloqueCerebro, CIUDAD, 'control: el resumen de antes');
  }

  const l = await O.limitar(p, dato.id, 'limitado');
  assert.equal(l.durable, true);
  const comprobar = async (cuando: string) => {
    for (const compacto of [false, true]) {
      const t = await turno(p, compacto);
      const que = `${cuando} · ${compacto ? 'voz' : 'texto'}`;
      assert.doesNotMatch(t.todo, CIUDAD, que);
      assert.match(t.bloquePerfil, /Baleadas/, `${que}: lo demás del perfil sigue`);
      assert.match(t.bloqueCerebro, /pesca/, `${que}: lo demás del resumen sigue`);
    }
    // La ficha editable no cambia: limitar no es borrar.
    const ficha = await P.leerPerfilSeguro(p);
    assert.ok(ficha.ok && ficha.perfil?.encuesta.vive === 'Puerto Sintetico', `${cuando}: la ficha lo muestra`);
    const sabe = (await K.queSeDe(p)).porCategoria.rutinas.find((d) => d.id === dato.id);
    assert.equal(sabe?.alcance, 'limitado');
  };
  await comprobar('limitado');
  reiniciar();
  // Recién reiniciado, el camino rápido de la voz no tiene lo que limitó en caché: no arriesga nada.
  assert.doesNotMatch(JSON.stringify(CT.bloquesPersonales({ dueno: p, perfil: null, compacto: true, consulta: 'pesca' })), CIUDAD);
  await P.leerPerfil(p);
  await E.precargarCerebro(p);
  await comprobar('tras reiniciar');

  await O.limitar(p, dato.id, 'general');
  for (const compacto of [false, true]) assert.match((await turno(p, compacto)).todo, CIUDAD, `reactivado (${compacto ? 'voz' : 'texto'})`);
  assert.equal(intentosDeRed, 0);
});

test('A1 la iniciativa tampoco lee lo limitado en lo último que dijo ni en sus misiones; el resumen de un tramo no se lo pasa al modelo', async () => {
  const p = 'ini-hilo@prueba.local';
  await P.actualizarPerfil(p, { apodo: 'Pesca' });
  const { dato } = await O.anotarDatoManual(p, { categoria: 'rutinas', dato: 'Vive en Puerto Sintetico', clave: 'vive' });
  await O.limitar(p, dato.id, 'limitado');
  const perfil = await P.leerPerfil(p);
  const hilo = [{ rol: 'user', texto: 'vivo en Puerto Sintetico, cerca del muelle' }];
  const ctx = I.contextoIniciativa({ correo: p }, { perfil, hilo, reservas: await P.reservasDe(p) });
  assert.doesNotMatch(ctx, CIUDAD);
  assert.match(ctx, /muelle/, 'lo demás de lo que dijo sigue');
  // Sin poder leer lo limitado (fallo cerrado), la iniciativa no lee su hilo.
  assert.doesNotMatch(I.contextoIniciativa({ correo: p }, { perfil, hilo, reservas: null }), /muelle|Sintetico/);
  // Lo que «ya sabe» de ella al resumir un tramo: lo limitado no va al modelo.
  assert.ok(!K.datosUsables(p).some((d) => d.id === dato.id));
  assert.ok(K.datosConocidos(p).some((d) => d.id === dato.id), 'sigue guardado');
});
