/**
 * P1 / A1 (auditoría del 4-oct): la VISTA AUTORIZADA del contexto. Un dato que la persona marcó «No usarlo»
 * (alcance `limitado`) no entra en NINGUNA copia activa del turno —su respuesta del perfil, lo que sé de ti,
 * los resúmenes de conversaciones de antes, lo que lee la iniciativa—, ni en texto ni en voz. La ficha
 * editable lo sigue mostrando (limitar no es borrar) y reactivarlo lo devuelve. Se apoya en el estado
 * durable del dato: sobrevive a un reinicio.
 *
 * Disco temporal, sin S3 ni red.
 */
import './datos-prueba'; // la junta inventada de las pruebas (lo real vive en Render)
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'contexto-aut-'));
for (const [k, v] of Object.entries({ ULTRON_CONOCER_DIR: 'co', ULTRON_EPISODIOS_DIR: 'ep', ULTRON_SUPRESIONES_DIR: 'su', ULTRON_PERFILES_DIR: 'pe', ULTRON_ABIERTOS_DIR: 'ab', ULTRON_INICIATIVA_DIR: 'in', ULTRON_MISIONES_DIR: 'mi', ULTRON_AVISOS_DIR: 'av', ULTRON_MEMORIA_MIEMBROS_DIR: 'mm', ULTRON_CIRCULO_DIR: 'ci', ULTRON_TAREA_CURSO_DIR: 'tc' })) process.env[k] = path.join(dir, v);
// La memoria de la junta (lib/memoria.ts) vive en <cwd>/data: la prueba trabaja en el disco temporal.
process.chdir(dir);
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
  // Por frases: la que nombra lo limitado sale entera; la otra se queda (ronda 10).
  sembrarEpisodio(p, 'Contó que vive en Puerto Sintetico. Sale a la pesca los sábados.', Date.now() - 86_400_000);
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
  const hilo = [{ rol: 'user', texto: 'vivo en Puerto Sintetico. Me gusta caminar cerca del muelle' }];
  const ctx = I.contextoIniciativa({ correo: p }, { perfil, hilo, reservas: await P.reservasDe(p) });
  assert.doesNotMatch(ctx, CIUDAD);
  assert.match(ctx, /muelle/, 'lo demás de lo que dijo sigue');
  // Sin poder leer lo limitado (fallo cerrado), la iniciativa no lee su hilo.
  assert.doesNotMatch(I.contextoIniciativa({ correo: p }, { perfil, hilo, reservas: null }), /muelle|Sintetico/);
  // Lo que «ya sabe» de ella al resumir un tramo: lo limitado no va al modelo.
  assert.ok(!K.datosUsables(p).some((d) => d.id === dato.id));
  assert.ok(K.datosConocidos(p).some((d) => d.id === dato.id), 'sigue guardado');
});

/* ------------------------------------------------------------------ GRAVE-3 (revisión del 5-oct): su memoria y su hilo */

const M = await import('../lib/memoria-miembro');
const MJ = await import('../lib/memoria');
const SI = await import('../server/iniciativa');
const MS = await import('../lib/misiones');
const { fusionarHilo } = await import('../lib/conversacion');
const PERRO = /Canelo/;

/**
 * Lo que el turno le da al modelo con SU memoria y SU hilo, armado como server.ts prepararTurno: la vista del
 * turno filtra la conversación que va como mensajes y bloquesPersonales arma la memoria (miembro o junta).
 * `todo` es el system completo + su firma + el mensaje del turno + los mensajes del hilo.
 */
async function turnoConMemoria(o: { dueno: string; nivel: 'miembro' | 'junta'; correoMem: string; quienMem: string | null; hiloCrudo: { rol: string; texto: string }[]; compacto: boolean; message: string }) {
  await CT.precargarVista(o.dueno);
  const vista = CT.vistaAutorizada(o.dueno);
  const durable = vista.turnos(o.hiloCrudo, o.message);
  const hilo = fusionarHilo({ durable, mensaje: o.message, maxCaracteres: o.compacto ? 600 : 1800 });
  const perfil = o.correoMem ? await P.leerPerfil(o.correoMem) : null;
  const b = CT.bloquesPersonales({
    dueno: o.dueno,
    perfil,
    compacto: o.compacto,
    consulta: o.message,
    conPregunta: !o.compacto,
    vista,
    memoria: { nivel: o.nivel, quienMem: o.quienMem, correoMem: o.correoMem, nombre: 'Ana', hiloEnMensajes: hilo.length > 0 },
  });
  const pz = piezasDelTurno({
    nivel: o.nivel,
    canal: 'mesa',
    modo: 'normal',
    mando: false,
    quien: o.quienMem,
    quienMem: o.quienMem,
    hechos: [],
    compacto: o.compacto,
    hiloEnMensajes: hilo.length > 0,
    bloquePerfil: b.bloquePerfil,
    conocer: b.conocer,
    conocerFirma: b.conocerFirma,
    bloqueCerebro: b.bloqueCerebro,
    memoria: b.memoria,
  });
  return { todo: `${pz.fijo}\n${pz.firma}\n${pz.delTurno}\n${JSON.stringify(hilo)}`, memoria: b.memoria };
}

test('GRAVE-3 miembro: lo limitado que pidió recordar y lo que dijo en el hilo no llega al prompt (texto, voz, iniciativa); lo general sí', async () => {
  const p = 'miembro-memoria@prueba.local';
  const { dato } = await O.anotarDatoManual(p, { categoria: 'rutinas', dato: 'Vive en Puerto Sintetico', clave: 'vive', origen: 'primeravez' });
  // «recuerda que…» en la mesa: el teléfono lo manda en `memoria` y server.ts lo guarda como hecho del miembro.
  await M.guardarHechoMiembro(p, 'Recuerda que vivo en Puerto Sintetico');
  await M.guardarHechoMiembro(p, 'Recuerda que mi perro se llama Canelo');
  // Por frases (ronda 10): la que nombra lo limitado sale entera, la otra se queda.
  await M.recordarTurnoMiembro({ correo: p, rol: 'user', texto: 'Te cuento que vivo en Puerto Sintetico. Canelo ladra mucho', esperar: true });
  await M.recordarTurnoMiembro({ correo: p, rol: 'ultron', texto: 'Qué bonito Puerto Sintetico; saludos a Canelo.', esperar: true });
  const hiloCrudo = () => M.hiloMiembro(p).map((t) => ({ rol: t.rol, texto: t.texto }));
  const arma = (compacto: boolean) => turnoConMemoria({ dueno: p, nivel: 'miembro', correoMem: p, quienMem: null, hiloCrudo: hiloCrudo(), compacto, message: 'hola' });

  // Control: antes de limitarlo, su memoria y su hilo lo usan.
  for (const compacto of [false, true]) assert.match((await arma(compacto)).todo, CIUDAD, `control (${compacto ? 'voz' : 'texto'})`);

  await O.limitar(p, dato.id, 'limitado');
  for (const compacto of [false, true]) {
    const t = await arma(compacto);
    const que = compacto ? 'voz' : 'texto';
    assert.doesNotMatch(t.todo, CIUDAD, `${que}: ni lo que pidió recordar, ni su hilo, ni los mensajes`);
    assert.match(t.todo, PERRO, `${que}: lo general sigue`);
    assert.match(t.memoria!.firma, PERRO, `${que}: lo general sigue en la firma`);
  }
  // La iniciativa: lo último que dijo (su hilo de miembro) tampoco lo lleva; lo general sí.
  let dicho = '';
  const ahora = Date.parse('2026-10-05T16:00:00Z');
  await SI.proponerPara({ correo: p, nombre: 'Ana', nivel: 'miembro' }, { reloj: () => ahora, modelo: async (_s, user) => ((dicho = user), '[]') });
  assert.ok(dicho, 'la iniciativa pensó');
  assert.doesNotMatch(dicho, CIUDAD, 'iniciativa');
  assert.match(dicho, PERRO, 'iniciativa: lo general de lo que dijo sigue');
  // Lo que ve la persona (GET /api/memoria) no cambia: limitar no es borrar.
  assert.match(JSON.stringify(M.fotoMemoriaMiembro(p)), CIUDAD);

  // Recién reiniciado y sin saber aún qué limitó: su memoria no entra (fallo cerrado) y se dice que no está a mano.
  K._olvidarCacheConocer();
  S._olvidarCacheSupresiones();
  const ciega = CT.bloquesPersonales({ dueno: p, perfil: null, compacto: true, consulta: 'hola', memoria: { nivel: 'miembro', quienMem: null, correoMem: p, nombre: 'Ana', hiloEnMensajes: false } });
  assert.doesNotMatch(JSON.stringify(ciega), /Sintetico|Canelo/);
  assert.match(ciega.memoria!.completa, /no disponible en este turno/);

  // Reactivado («general»): vuelve.
  await O.limitar(p, dato.id, 'general');
  for (const compacto of [false, true]) assert.match((await arma(compacto)).todo, CIUDAD, `reactivado (${compacto ? 'voz' : 'texto'})`);
  assert.equal(intentosDeRed, 0);
});

test('GRAVE-3 junta: su memoria privada y su hilo pasan por la vista; los hechos de la junta (organización) no se tocan', async () => {
  const quien = 'jose';
  const { dato } = await O.anotarDatoManual(quien, { categoria: 'rutinas', dato: 'Vive en Puerto Sintetico', clave: 'vive' });
  await O.limitar(quien, dato.id, 'limitado');
  const t = Date.now() - 60_000;
  MJ.resetMemoriaTest({
    version: 1,
    perfiles: {
      jose: {
        corta: [
          { rol: 'user', texto: 'Recuerda que vivo en Puerto Sintetico', t, canal: 'telegram' },
          { rol: 'ultron', texto: 'Anotado lo de Puerto Sintetico y lo de Canelo.', t: t + 1, canal: 'telegram' },
        ],
        larga: [
          { hecho: 'Recuerda que vivo en Puerto Sintetico', t, quien: 'jose', canal: 'telegram' },
          { hecho: 'Recuerda que mi perro se llama Canelo', t, quien: 'jose', canal: 'telegram' },
        ],
      },
    },
    junta: { larga: [{ hecho: 'La junta revisa el informe trimestral de la mina', t, quien: 'junta', canal: 'mesa' }] },
    cambios: [],
  });
  const arma = (compacto: boolean, message: string) => turnoConMemoria({ dueno: quien, nivel: 'junta', correoMem: '', quienMem: quien, hiloCrudo: MJ.hiloDe(quien), compacto, message });
  for (const compacto of [false, true]) {
    const r = await arma(compacto, '¿qué tenemos hoy?');
    const que = compacto ? 'voz' : 'texto';
    assert.doesNotMatch(r.todo, CIUDAD, que);
    assert.match(r.todo, PERRO, `${que}: lo general de su memoria sigue`);
    assert.match(r.todo, /informe trimestral/, `${que}: lo de la junta sigue`);
  }
  await O.limitar(quien, dato.id, 'general');
  assert.match((await arma(false, 'hola')).todo, CIUDAD, 'reactivado');
  MJ.resetMemoriaTest();
});

test('GRAVE-3 un solo sitio: server.ts no lee la memoria por fuera de la vista y su hilo pasa por ella', () => {
  const src = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  // assert.ok y no match: si falla, que no vuelque server.ts entero.
  assert.ok(!/promptMemoriaMiembro\s*\(|promptMemoria\s*\(/.test(src), 'la memoria del turno la arma server/contexto-turno.ts');
  assert.ok(/memoria: personal\.memoria/.test(src), 'piezasDelTurno recibe la memoria ya autorizada');
  assert.ok(/const durable = vista\.turnos\(/.test(src), 'el hilo durable pasa por la vista');
  assert.ok(/const clienteHilo = vista\.turnos\(/.test(src), 'el hilo del cliente pasa por la vista');
  assert.ok(/bloqueIniciativaTurno\(duenoComputadora, .*, vista\)/.test(src), 'las misiones del turno pasan por la vista');
});

test('MENOR iniciativa: sin saber qué limitó (reservas null), sus misiones y lo ya propuesto no entran, no son fuente ni respaldo, y se dice que no están', () => {
  const ahora = Date.parse('2026-10-05T15:00:00Z');
  const m = { id: 'm1', titulo: 'Mudanza a Puerto Sintetico', objetivo: 'Mudarme a Puerto Sintetico', pasos: [], proximoPaso: 'Buscar casa en Puerto Sintetico', estado: 'activa', notas: [], creada: ahora - 40 * 86_400_000, actualizada: ahora - 30 * 86_400_000 } as any;
  const historial = [{ id: 'x', tipo: 'ayuda', texto: '¿Te busco casas en Puerto Sintetico?', t: ahora - 3_600_000 }] as any;
  const sin = { ahora, misiones: [m], historial, reservas: null, zona: 'America/Tegucigalpa' };
  const ctx = I.contextoIniciativa({ correo: 'a@b.c' }, sin);
  assert.doesNotMatch(ctx, CIUDAD);
  assert.match(ctx, /MISIONES ABIERTAS: no disponibles/, 'no dice «ninguna»: no se sabe');
  assert.ok(![...I.candidatosDe(sin, ahora).keys()].some((k) => k.startsWith('mision:')), 'una misión no es fuente');
  const respaldo = I.propuestasDeRespaldo({ correo: 'a@b.c' }, sin);
  assert.doesNotMatch(JSON.stringify(respaldo), CIUDAD);
  assert.ok(!respaldo.some((p) => /ninguna misión activa/i.test(p.evidencia?.porQue || '')), 'no afirma que no tiene misiones');
  // El perfil de uso que falló cerrado (con `limitados` y sin `reservas`) también cuenta como «no se sabe».
  assert.doesNotMatch(I.contextoIniciativa({ correo: 'a@b.c' }, { ahora, misiones: [m], perfil: { encuesta: {}, limitados: ['encuesta.vive'] } as any }), CIUDAD);
  // Sabiendo qué limitó: la frase de la misión que lo nombra sale entera, y el respaldo no la ofrece con
  // «[dato reservado]».
  const con = { ...sin, reservas: [['puerto', 'sintetico']] };
  const ctxCon = I.contextoIniciativa({ correo: 'a@b.c' }, con);
  assert.doesNotMatch(ctxCon, CIUDAD);
  assert.match(ctxCon, /\[dato reservado\]/);
  assert.doesNotMatch(JSON.stringify(I.propuestasDeRespaldo({ correo: 'a@b.c' }, con)), /Sintetico|reservado/);
  // Sin nada limitado, igual que antes.
  assert.match(I.contextoIniciativa({ correo: 'a@b.c' }, { ...sin, reservas: [] }), CIUDAD);
});

test('MENOR iniciativa en el chat: las misiones del turno (bloqueIniciativaTurno) pasan por lo limitado; sin saberlo, no entran', async () => {
  const p = 'mision-chat@prueba.local';
  await MS.crearMision(p, { titulo: 'Mudanza a Puerto Sintetico', objetivo: 'Mudarme cerca del muelle', pasos: ['Buscar casa en Puerto Sintetico'] });
  const { dato } = await O.anotarDatoManual(p, { categoria: 'rutinas', dato: 'Vive en Puerto Sintetico', clave: 'vive' });
  assert.match(await SI.bloqueIniciativaTurno(p, null), CIUDAD, 'control: sin limitar, la misión entra');
  await O.limitar(p, dato.id, 'limitado');
  const durable = await SI.bloqueIniciativaTurno(p, null);
  assert.doesNotMatch(durable, CIUDAD, 'sin vista del turno: la del estado durable');
  assert.match(durable, /muelle/, 'lo demás de la misión sigue');
  await CT.precargarVista(p);
  assert.doesNotMatch(await SI.bloqueIniciativaTurno(p, null, CT.vistaAutorizada(p)), CIUDAD, 'con la vista del turno');
  const ciega = await SI.bloqueIniciativaTurno(p, null, { sabe: false, texto: () => '' });
  assert.doesNotMatch(ciega, /Sintetico|muelle/);
  assert.match(ciega, /no las tengo a mano/, 'se dice que no están, no que no tiene');
});

/* ------------------------------------------------------------------ ronda 10: por frase, con la clave, variantes y lo reaprendido */

const CORTES = '¿Qué tipo de concesión necesito para el puerto de Cortés?';

/**
 * Un dato limitado y lo que la persona dijo de él (lo pidió recordar y quedó en su hilo), junto con lo general
 * (su perro, la pregunta del puerto de Cortés). Devuelve lo que el turno le da al modelo, antes y después de
 * limitarlo, en texto y en voz.
 */
async function limitadoEnSuMemoria(p: string, d: { categoria: string; dato: string; clave: string }, dichos: string[]) {
  const { dato } = await O.anotarDatoManual(p, { ...d, origen: 'primeravez' });
  for (const t of [...dichos, 'mi perro se llama Canelo', CORTES]) {
    await M.guardarHechoMiembro(p, `José: ${t}`);
    await M.recordarTurnoMiembro({ correo: p, rol: 'user', texto: t, esperar: true });
  }
  const arma = (compacto: boolean) => turnoConMemoria({ dueno: p, nivel: 'miembro', correoMem: p, quienMem: null, hiloCrudo: M.hiloMiembro(p).map((t) => ({ rol: t.rol, texto: t.texto })), compacto, message: 'hola' });
  const antes = await arma(false);
  await O.limitar(p, dato.id, 'limitado');
  return { antes, texto: await arma(false), voz: await arma(true), dato };
}

test('R10 GRAVE-A: lo que solo se nombra por el valor de su clave, una empresa, una variante («diabético») o lo escrito junto no llega al prompt; lo general sí', async () => {
  const casos = [
    { p: 'r10-hija@prueba.local', d: { categoria: 'familia', dato: 'Su hija se llama Valentina', clave: 'hija:valentina' }, dichos: ['mi hija Valentina está enferma'], patron: /Valentina/ },
    { p: 'r10-empresa@prueba.local', d: { categoria: 'trabajo', dato: 'Trabaja en Minera Sintetica', clave: 'empresa:minera sintetica' }, dichos: ['trabajo en Minera Sintetica desde 2020'], patron: /Sintetica/i },
    { p: 'r10-salud@prueba.local', d: { categoria: 'salud', dato: 'Tiene diabetes tipo 2', clave: 'salud' }, dichos: ['soy diabético desde 2019', 'me inyecto insulina por la diabetes'], patron: /diab|insulina/i },
    { p: 'r10-junto@prueba.local', d: { categoria: 'rutinas', dato: 'Vive en Puerto Sintetico', clave: 'vive' }, dichos: ['me mudé a PuertoSintetico', 'vivo en Pto. Sintético'], patron: /Sint[eé]tico/i },
  ];
  for (const c of casos) {
    const r = await limitadoEnSuMemoria(c.p, c.d, c.dichos);
    assert.match(r.antes.todo, c.patron, `${c.d.dato}: control, antes de limitarlo entra`);
    for (const [que, t] of [['texto', r.texto], ['voz', r.voz]] as const) {
      assert.doesNotMatch(t.todo, c.patron, `${c.d.dato} (${que}): ni lo que pidió recordar, ni su hilo`);
      assert.match(t.todo, PERRO, `${c.d.dato} (${que}): lo general sigue`);
      assert.ok(t.todo.includes(CORTES), `${c.d.dato} (${que}): la pregunta del puerto de Cortés sigue entera`);
    }
  }
  assert.equal(intentosDeRed, 0);
});

test('R10 MEDIO-B: lo que AURA vuelve a aprender con otra categoría o clave no se guarda como general; una copia general de antes tampoco entra; lo que no lo repite sigue general', async () => {
  const p = 'r10-reaprende@prueba.local';
  const { dato } = await O.anotarDatoManual(p, { categoria: 'rutinas', dato: 'Vive en Puerto Sintetico', clave: 'vive', origen: 'primeravez' });
  // Una copia general aprendida ANTES de limitarlo (otra categoría y otra clave).
  await K.incorporarDatos(p, [{ categoria: 'familia', dato: 'Su familia vive con él en Puerto Sintetico', clave: 'hogar', confianza: 0.9 }], { fuente: 'modelo' });
  await O.limitar(p, dato.id, 'limitado');
  // Después, el que resume el tramo (lib/episodios.ts → incorporarDatos) lo vuelve a aprender con otras palabras.
  await K.incorporarDatos(
    p,
    [
      { categoria: 'otros', dato: 'Se mudó hace poco a Puerto Sintetico con su familia', clave: 'ciudad', confianza: 0.9 },
      { categoria: 'gustos', dato: 'Le gusta la pesca de los sábados', confianza: 0.9 },
    ],
    { fuente: 'modelo' }
  );
  const sabe = await K.queSeDe(p);
  const todos = Object.values(sabe.porCategoria).flat();
  assert.ok(!todos.some((d) => /mudó/.test(d.dato) && d.alcance === 'general'), 'lo reaprendido no se guarda como general');
  assert.equal(todos.find((d) => /pesca/.test(d.dato))?.alcance, 'general', 'lo que no lo repite, general');
  // Las reglas sobre lo que dice ahora («vivo en Puerto Sintetico»): tampoco se guarda aparte como general.
  const porReglas = K.datosPorReglas([{ rol: 'user', texto: 'Mi casa nueva: vivo en Puerto Sintetico' }]).map((d) => ({ ...d, categoria: 'otros', clave: 'casa' }));
  assert.ok(porReglas.length, 'las reglas lo sacan');
  await K.incorporarDatos(p, porReglas, { fuente: 'reglas' });
  assert.ok(!Object.values((await K.queSeDe(p)).porCategoria).flat().some((d) => d.alcance === 'general' && /Sintetico/.test(d.dato) && d.categoria !== 'familia'), 'lo que dijo ahora no vuelve como general');
  await CT.precargarVista(p);
  for (const compacto of [false, true]) {
    const t = await turno(p, compacto);
    assert.doesNotMatch(t.todo, CIUDAD, `${compacto ? 'voz' : 'texto'}: ni lo reaprendido ni la copia general de antes`);
    if (!compacto) assert.match(t.conocer, /pesca/, 'lo que sé sigue con lo general');
  }
  // Lo que «ya sabe» al resumir el próximo tramo tampoco lo lleva.
  assert.ok(!K.datosUsables(p).some((d) => /Sintetico/.test(d.dato)));
  assert.ok(K.datosUsables(p).some((d) => /pesca/.test(d.dato)));
  // Reactivado, vuelve (el dato y la copia de antes).
  await O.limitar(p, dato.id, 'general');
  assert.match((await turno(p, false)).todo, CIUDAD, 'reactivado');
});

test('R10 MENOR-E: una palabra común de lo limitado («tipo», «puerto») no saca nada por sí sola', async () => {
  const p = 'r10-comun@prueba.local';
  sembrarEpisodio(p, 'Habló del tipo de cambio del lempira. Preguntó por el puerto de Cortés.', Date.now() - 86_400_000);
  const a = await O.anotarDatoManual(p, { categoria: 'salud', dato: 'Tiene diabetes tipo 2', clave: 'salud' });
  const b = await O.anotarDatoManual(p, { categoria: 'rutinas', dato: 'Vive en Puerto Sintetico', clave: 'vive' });
  await O.anotarDatoManual(p, { categoria: 'trabajo', dato: 'Trabaja en la concesión de El Corpus', clave: 'oficio' });
  await M.guardarHechoMiembro(p, 'Recuerda que el lunes reviso qué tipo de permiso pide la concesión');
  await M.recordarTurnoMiembro({ correo: p, rol: 'user', texto: CORTES, esperar: true });
  await O.limitar(p, a.dato.id, 'limitado');
  await O.limitar(p, b.dato.id, 'limitado');
  await E.precargarCerebro(p);
  const r = await turnoConMemoria({ dueno: p, nivel: 'miembro', correoMem: p, quienMem: null, hiloCrudo: M.hiloMiembro(p).map((t) => ({ rol: t.rol, texto: t.texto })), compacto: false, message: 'hola' });
  assert.ok(r.todo.includes('qué tipo de permiso pide la concesión'), 'lo que pidió recordar sigue entero');
  assert.ok(r.todo.includes(CORTES), 'su hilo sigue entero');
  assert.match(r.todo, /tipo de cambio del lempira\. Preguntó por el puerto de Cortés\./, 'el resumen de antes sigue entero');
  assert.match(r.todo, /El Corpus/, 'un dato general sigue');
  assert.doesNotMatch(r.todo, /reservado/, 'nada se reservó');
  assert.equal(CT.vistaAutorizada(p).texto(CORTES), CORTES);
  // Y lo limitado sí sale, la frase entera, aunque venga junto a lo general.
  assert.equal(CT.vistaAutorizada(p).texto('Me inyecto insulina por la diabetes. ¿Y el puerto de Cortés?'), '[dato reservado] ¿Y el puerto de Cortés?');
});

/* ================================================================== R11 MEDIO-2: lo que devuelven sus herramientas */

const MI = await import('../lib/misiones');
const CI = await import('../lib/circulo');
const TC = await import('../lib/tarea-en-curso');

test('R11 MEDIO-2 mision: «mision listar» (lo que el modelo pide a mitad del turno) no devuelve lo limitado; con la vista del turno tampoco; reactivado vuelve', async () => {
  const p = 'r11-mision@prueba.local';
  await MI.crearMision(p, { titulo: 'Mudanza a Puerto Sintetico', objetivo: 'Mudarme a Puerto Sintetico antes de diciembre', pasos: ['Buscar casa en Puerto Sintetico', 'Cambiar dirección'] });
  await MI.crearMision(p, { titulo: 'Aprender a pescar', objetivo: 'Salir a pescar los sábados', pasos: ['Comprar caña'] });
  const { dato } = await O.anotarDatoManual(p, { categoria: 'rutinas', dato: 'Vive en Puerto Sintetico', clave: 'vive', origen: 'primeravez' });
  assert.match((await SI.correrMisionTurnoConEstado(p, 'listar')).texto, CIUDAD, 'control: sin limitar, la lista la nombra');
  await O.limitar(p, dato.id, 'limitado');
  await CT.precargarVista(p);
  const vista = CT.vistaAutorizada(p);
  for (const r of [await SI.correrMisionTurnoConEstado(p, 'listar'), await SI.correrMisionTurnoConEstado(p, 'listar', vista), await MI.correrMisionConEstado(p, 'listar')]) {
    assert.doesNotMatch(r.texto, CIUDAD, `la lista no lo devuelve: ${r.texto}`);
    assert.match(r.texto, /\[dato reservado\]/);
    assert.match(r.texto, /Aprender a pescar/, 'lo que no lo toca sigue');
    assert.equal(r.estado, 'succeeded', 'el estado no cambia');
  }
  // Crear una que lo nombra tampoco se lo devuelve (el recibo sí dice que quedó guardada).
  const c = await SI.correrMisionTurnoConEstado(p, 'crear Vender la casa de Puerto Sintetico | antes de mudarme | anunciarla', vista);
  assert.doesNotMatch(c.texto, CIUDAD);
  assert.equal(c.recibo?.efecto, 'guardado');
  // Lo que la persona nombra en lo que ACABA de decir no se le tapa en la respuesta a eso.
  const ahora = CT.vistaDeHerramientas(vista, '¿Cómo va la mudanza a Puerto Sintetico?');
  assert.match((await SI.correrMisionTurnoConEstado(p, 'listar', ahora)).texto, CIUDAD, 'lo trajo ella en este turno');
  assert.doesNotMatch((await SI.correrMisionTurnoConEstado(p, 'listar', CT.vistaDeHerramientas(vista, '¿qué misiones tengo?'))).texto, CIUDAD);
  // Sin saber qué limitó, nada de lo suyo.
  const ciega = K.resultadoAutorizado({ texto: 'MISIONES ABIERTAS (1): Mudanza a Puerto Sintetico', estado: 'succeeded' as const }, K.vistaDeTerminos(null), 'MISIONES');
  assert.doesNotMatch(ciega.texto, CIUDAD);
  assert.match(ciega.texto, /no puedo enseñarte lo suyo/);
  await O.limitar(p, dato.id, 'general');
  assert.match((await SI.correrMisionTurnoConEstado(p, 'listar')).texto, CIUDAD, 'reactivado, vuelve');
});

test('R11 MEDIO-2 circulo: con «hija:valentina» limitado, «circulo listar» no devuelve a Valentina; lo demás de su gente sí', async () => {
  const p = 'r11-circulo@prueba.local';
  assert.match((await CI.correrCirculoConEstado(p, 'agregar Valentina | hija | +50499990000')).texto, /Valentina/, 'control: al guardarla');
  await CI.correrCirculoConEstado(p, 'agregar Beto | compadre | +50499990001');
  const { dato } = await O.anotarDatoManual(p, { categoria: 'familia', dato: 'Su hija se llama Valentina', clave: 'hija:valentina', origen: 'primeravez' });
  assert.match((await CI.correrCirculoConEstado(p, 'listar')).texto, /Valentina/, 'control: sin limitar');
  await O.limitar(p, dato.id, 'limitado');
  await CT.precargarVista(p);
  const vista = CT.vistaAutorizada(p);
  for (const r of [await CI.correrCirculoConEstado(p, 'listar'), await CI.correrCirculoConEstado(p, 'listar', '', {}, vista)]) {
    assert.doesNotMatch(r.texto, /Valentina/, `el círculo no la devuelve: ${r.texto}`);
    assert.match(r.texto, /Beto/, 'su compadre sigue');
  }
  // «escríbele a Valentina»: lo pide ella ahora, y la respuesta a eso no se le tapa.
  assert.match((await CI.correrCirculoConEstado(p, 'listar', '', {}, CT.vistaDeHerramientas(vista, 'escríbele a Valentina que llego tarde'))).texto, /Valentina/);
});

test('R11 MEDIO-2 tarea en curso: el bloque de los HECHOS y «tarea ver» pasan por la vista del turno', async () => {
  const p = 'r11-tarea@prueba.local';
  const { dato } = await O.anotarDatoManual(p, { categoria: 'rutinas', dato: 'Vive en Puerto Sintetico', clave: 'vive', origen: 'primeravez' });
  await O.limitar(p, dato.id, 'limitado');
  await CT.precargarVista(p);
  await TC.precargarTareas(p);
  TC.iniciarTarea(p, '', { tipo: 'otra', titulo: 'Mudanza a Puerto Sintetico: avisar a todos', pasos: ['Avisar al banco de Puerto Sintetico', 'Llamar a la mamá'] });
  assert.match(TC.bloqueTarea(p, ''), CIUDAD, 'control: el bloque crudo');
  const vista = CT.vistaAutorizada(p);
  for (const compacto of [false, true]) {
    const b = TC.bloqueTarea(p, '', compacto, vista);
    assert.doesNotMatch(b, CIUDAD, `el bloque del turno (${compacto ? 'voz' : 'texto'}): ${b}`);
    assert.match(b, /\[dato reservado\]/);
  }
  for (const r of [await TC.correrTareaConEstado(p, '', 'ver'), await TC.correrTareaConEstado(p, '', 'ver', vista), await TC.correrTareaConEstado(p, '', 'hecho 1', vista)]) {
    assert.doesNotMatch(r.texto, CIUDAD, `la herramienta no lo devuelve: ${r.texto}`);
  }
  TC._olvidarTareas();
});

test('R11 MEDIO-2 un solo sitio: server.ts pasa la vista del turno al bloque de la tarea y a las herramientas con lo suyo', () => {
  const src = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  assert.ok(/bloqueTarea\(duenoComputadora, ambitoTurno, compacto, vista\)/.test(src), 'el bloque de la tarea, por la vista');
  assert.ok(/deLaTarea \? vista\.texto\(deLaTarea\)/.test(src), 'lo que contesta la tarea, por la vista');
  assert.ok(/vistaHerramientas: vistaDeHerramientas\(vista, message\)/.test(src), 'la vista de las herramientas sale de la del turno');
  assert.ok(/correrMisionTurnoConEstado\(dueno, arg, vista\)/.test(src), 'mision');
  assert.ok(/correrCirculoConEstado\(dueno, arg, ambito, \{\}, vista\)/.test(src), 'circulo');
  assert.ok(/correrTareaConEstado\(dueno, ambito, arg, vista\)/.test(src), 'tarea');
  assert.equal((src.match(/vista: p\.vistaHerramientas/g) || []).length, 2, 'los dos caminos del harness (JSON y stream)');
});

test('R11 MENOR-G: un nombre de pila muy común o una fecha solos no reservan («Envíale el contrato a Maria», «La reunión es el 12 de marzo»); con lo que ES el dato, sí; lo de la ronda 10 sigue reservado', () => {
  const limitados = [
    ['Tiene diabetes tipo 2', 'salud'],
    ['Vive en Puerto Sintetico', 'vive'],
    ['Su hija se llama Valentina', 'hija:valentina'],
    ['Trabaja en Minera Sintetica', 'empresa:minera sintetica'],
    ['Su esposa se llama María', 'esposa:maría'],
    ['Cumple años el 12 de marzo', 'cumpleanos'],
    ['Toma metformina 850 mg', 'salud:metformina'],
  ].map(([dato, clave], i) => ({ id: `d${i}`, categoria: 'familia', dato, clave, alcance: 'limitado' })) as any;
  const v = K.vistaDeTerminos(K.terminosReservados(limitados));
  // Pasan enteras: nada en ellas nombra lo limitado.
  for (const f of [
    'Envíale el contrato a Maria',
    'La santa María',
    'María Elena me llamó por la concesión',
    'La reunión es el 12 de marzo',
    'El 2 de mayo',
    'marzo fue bueno para las ventas',
    'Pagué 850 lempiras',
    'mi esposa vino a la reunión',
    '¿Cuál es el precio del oro hoy?',
    'El puerto de Cortés cerró ayer',
    'Tengo una reunión con Minera Aurífera',
  ]) assert.equal(v.texto(f), f, `«${f}» no repite nada limitado`);
  // Siguen reservadas: el nombre con lo que es («mi esposa María»), la fecha con «cumple»/«nací», lo de la ronda 10
  // y un nombre que no es de los muy comunes («Valentina»: ante la duda, se reserva).
  for (const f of [
    'Mi esposa María está enferma',
    'mi mujer Maria no vino',
    'Mi cumple es el 12 de marzo',
    'nací el 12 de marzo',
    'Cumple años: 12 de marzo',
    'mi hija Valentina está enferma',
    'Valentina está enferma',
    'trabajo en Minera Sintetica desde 2020',
    'la minera sintética pagó',
    'soy diabético desde 2019',
    'me mudé a PuertoSintetico',
    'vivo en Pto. Sintético',
    'tomo la metformina en la mañana',
  ]) assert.doesNotMatch(v.texto(f), /Mar[ií]a|marzo|Valentina|Sint[eé]tic|diab|metformina/i, `«${f}» sigue reservada`);
});
