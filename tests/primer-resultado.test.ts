/**
 * EL PRIMER RESULTADO, MEDIDO (auditoría externa del 4-oct, P4 · R1; lib/primer-resultado.ts):
 *   · la petición precargada NO es el primer resultado;
 *   · un error, una respuesta vacía, vencida o «sigo con eso» no cuentan como útiles;
 *   · un resultado parcial guarda QUÉ fuente o parte faltó;
 *   · el tiempo hasta el valor y el esfuerzo (toques, saltos, conectar omitido) se calculan, sin contenido;
 *   · el registro es de UNA cuenta: otra no lo lee;
 *   · al reabrir, el primer pedido pendiente se recupera (a la caja, o el mismo idTurno dentro de su vida);
 *   · la copia del teléfono (mobile/src/lib/primerResultado.ts) dice exactamente lo mismo.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aplicar,
  avancePrimer,
  clasificarTareas,
  clasificarTurno,
  clavePrimer,
  coberturaTareas,
  debePreguntar,
  hayResultado,
  leerPrimer,
  lineaMetrica,
  MAX_TAREAS_PRIMER,
  metricas,
  NO_ENCONTRADA_LECTURAS,
  NO_ENCONTRADA_MS,
  nuevoPrimer,
  OBJETIVO_MS,
  queRecuperar,
  trasSoloRepetir,
  VIDA_TURNO_MS,
  type EventoPrimer,
  type PrimerResultado,
} from '../lib/primer-resultado';
import * as MOVIL from '../mobile/src/lib/primerResultado';
import { crearClienteTrabajos, estadoInicial, lista, reducir, type TareaVista } from '../mobile/src/lib/trabajos';

const T0 = 1_760_000_000_000;
const PETICION = 'Compara estas opciones y déjame una recomendación con fuentes: laptop A, B o C. Lo que más pesa: hasta L 15,000.';

/** Recorre la primera vez como lo haría una cuenta nueva: objetivo, restricción, salta conectar, «Usar mi petición ahora». */
function primeraVez(cuenta = 'Ana@Ejemplo.com'): PrimerResultado {
  let r: PrimerResultado | null = nuevoPrimer(cuenta, T0);
  const pasos: EventoPrimer[] = [
    { tipo: 'toque', accion: 'seguir', paso: 'objetivo' },
    { tipo: 'toque', accion: 'seguir', paso: 'restriccion' },
    { tipo: 'toque', accion: 'saltar', paso: 'conectar' },
    { tipo: 'toque', accion: 'seguir', paso: 'listo' },
    { tipo: 'preparar', peticion: PETICION },
  ];
  pasos.forEach((ev, i) => (r = aplicar(r, ev, T0 + (i + 1) * 10_000)));
  return r!;
}

test('la petición precargada no es el primer resultado', () => {
  const r = primeraVez();
  assert.equal(r.estado, 'preparada');
  assert.equal(r.peticion, PETICION);
  assert.equal(debePreguntar(r), false, 'no se pregunta «¿te sirvió?» por un borrador');
  const m = metricas(r);
  assert.equal(m.util, false);
  assert.equal(m.msHastaValor, null);
  assert.equal(m.msHastaResultado, null);
  // Un resultado sin envío no se acepta: el turno solo cuenta sobre una petición enviada.
  assert.equal(aplicar(r, { tipo: 'turno', resultado: { clase: 'util', verificado: false } }, T0 + 60_000), r);
});

test('error, vacía, vencida o «sigo con eso» no son útiles', () => {
  assert.deepEqual(clasificarTurno({ reply: '', error: 'Sin conexión al cerebro' }), { clase: 'fallida', motivo: 'Sin conexión al cerebro' });
  assert.deepEqual(clasificarTurno({ reply: '   ' }), { clase: 'fallida', motivo: 'sin respuesta' });
  assert.deepEqual(clasificarTurno({ reply: 'algo', vencida: true }), { clase: 'ignorar' });
  assert.deepEqual(clasificarTurno({ reply: 'Sigo con eso que me pediste.', pendiente: true }), { clase: 'pendiente' });
  assert.deepEqual(clasificarTurno(null), { clase: 'ignorar' });
  // Cortada a media respuesta: hay algo, pero es parcial y dice por qué.
  assert.deepEqual(clasificarTurno({ reply: 'La A es mejor porque', parcial: true, cierre: 'eof', error: 'el turno se cortó sin terminar' }), { clase: 'parcial', faltantes: ['el turno se cortó sin terminar'] });
  assert.deepEqual(clasificarTurno({ reply: 'La A, por precio y batería.', cierre: 'done' }), { clase: 'util', verificado: false });

  let r: PrimerResultado | null = primeraVez();
  r = aplicar(r, { tipo: 'enviar', idTurno: 't1', texto: PETICION }, T0 + 70_000);
  r = aplicar(r, { tipo: 'turno', idTurno: 't1', resultado: clasificarTurno({ reply: '', error: 'timeout' }) }, T0 + 80_000);
  assert.equal(r!.estado, 'fallida');
  assert.equal(metricas(r!).util, false);
  assert.equal(debePreguntar(r), false);
  // Lo siguiente que mande es un reintento; ese sí da el resultado.
  r = aplicar(r, { tipo: 'enviar', idTurno: 't2', texto: PETICION }, T0 + 90_000);
  assert.equal(r!.intentos, 1);
  r = aplicar(r, { tipo: 'turno', idTurno: 't2', resultado: clasificarTurno({ reply: 'Te recomiendo la B.' }), trazaId: 'traza-1' }, T0 + 100_000);
  assert.equal(r!.estado, 'util');
  assert.equal(r!.trazaId, 'traza-1');
  // Un resultado de un turno viejo no pisa nada.
  assert.equal(aplicar(r, { tipo: 'turno', idTurno: 't1', resultado: { clase: 'fallida', motivo: 'x' } }, T0 + 110_000), r);
});

test('parcial con la fuente que faltó, y tareas: completada con evidencia = verificada', () => {
  // Tarea durable: la respuesta abrió una tarea que sigue → el resultado es el de la tarea.
  const turno = clasificarTurno({ reply: 'Lo estoy comparando.', tareas: [{ id: 'tk1', title: 'Comparar laptops', state: 'running', version: 1, updatedAt: '' }] });
  assert.deepEqual(turno, { clase: 'en-tarea', tareas: ['tk1'] });
  let r: PrimerResultado | null = aplicar(primeraVez(), { tipo: 'enviar', idTurno: 't1', texto: PETICION }, T0 + 70_000);
  r = aplicar(r, { tipo: 'turno', idTurno: 't1', resultado: turno }, T0 + 75_000);
  assert.equal(r!.estado, 'en-tarea');
  assert.equal(debePreguntar(r), false, 'una tarea en marcha todavía no es resultado');
  // Sigue corriendo: no hay resultado ni pregunta; solo se anota el progreso (en curso), y repetirlo no cambia nada.
  const corriendo = aplicar(r, { tipo: 'tareas', tareas: [{ id: 'tk1', state: 'verifying' }] }, T0 + 80_000)!;
  assert.equal(corriendo.estado, 'en-tarea');
  assert.equal(corriendo.resultadoMs, undefined);
  assert.equal(debePreguntar(corriendo), false);
  assert.deepEqual(corriendo.avance, [{ id: 'tk1', estado: 'en-curso' }]);
  assert.equal(aplicar(corriendo, { tipo: 'tareas', tareas: [{ id: 'tk1', state: 'verifying' }] }, T0 + 90_000), corriendo);
  const parcial = aplicar(r, { tipo: 'tareas', tareas: [{ id: 'tk1', state: 'partial', result: { evidence: [], partial: ['No pude leer la fuente: tienda B (timeout)'] } }] }, T0 + 120_000)!;
  assert.equal(parcial.estado, 'parcial');
  assert.deepEqual(parcial.faltantes, ['No pude leer la fuente: tienda B (timeout)']);
  assert.equal(metricas(parcial).fuentesFallidas, 1);
  assert.equal(metricas(parcial).util, false);
  assert.equal(metricas(parcial).msHastaValor, null, 'parcial no es valor útil');
  assert.equal(metricas(parcial).msHastaResultado, 120_000);
  assert.equal(debePreguntar(parcial), true, 'con resultado parcial sí se pregunta');

  const ok = aplicar(r, { tipo: 'tareas', tareas: [{ id: 'tk1', state: 'completed', result: { evidence: [{ id: 'e1' }] } }, { id: 'otra', state: 'failed' }] }, T0 + 130_000)!;
  assert.equal(ok.estado, 'util');
  assert.equal(ok.verificado, true);
  assert.equal(ok.cobertura, 'completa');
  assert.deepEqual(ok.avance, [{ id: 'tk1', estado: 'completada', evidencia: true }], 'la ajena («otra», fallida) no cuenta: solo las esperadas');
  assert.deepEqual(clasificarTareas([{ id: 'a', state: 'completed', result: { evidence: [] } }]), { clase: 'util', verificado: false, avance: [{ id: 'a', estado: 'completada' }] });
  assert.deepEqual(clasificarTareas([{ id: 'a', state: 'respondida' }]), { clase: 'util', verificado: false, avance: [{ id: 'a', estado: 'respondida' }] });
  assert.deepEqual(clasificarTareas([{ id: 'a', state: 'failed', title: 'Leer correo' }]), { clase: 'fallida', motivo: 'la tarea no terminó', avance: [{ id: 'a', estado: 'fallida' }] });
  assert.deepEqual(clasificarTareas([{ id: 'a', state: 'completed' }, { id: 'b', state: 'failed', title: 'Fuente C' }]), {
    clase: 'parcial',
    faltantes: ['Fuente C'],
    verificado: false,
    avance: [
      { id: 'a', estado: 'completada' },
      { id: 'b', estado: 'fallida' },
    ],
  });
  assert.deepEqual(clasificarTareas([{ id: 'a', state: 'partial', estadoReal: 'respondida' }]), { clase: 'util', verificado: false, avance: [{ id: 'a', estado: 'respondida' }] });
});

test('tiempo hasta el valor y esfuerzo, sin nada de lo pedido en la métrica', () => {
  let r: PrimerResultado | null = primeraVez();
  r = aplicar(r, { tipo: 'enviar', idTurno: 't1', texto: `${PETICION} Y que tenga buena batería.` }, T0 + 70_000);
  r = aplicar(r, { tipo: 'turno', idTurno: 't1', resultado: { clase: 'util', verificado: false } }, T0 + 190_000);
  r = aplicar(r, { tipo: 'opinar', sirvio: true }, T0 + 200_000);
  // Una sola opinión.
  assert.equal(aplicar(r, { tipo: 'opinar', sirvio: false }, T0 + 210_000), r);
  const m = metricas(r!);
  assert.equal(m.util, true);
  assert.equal(m.msHastaValor, 190_000);
  assert.equal(m.msEnvioAResultado, 120_000);
  assert.equal(m.msPrimeraVez, 50_000);
  assert.equal(m.dentroObjetivo, true);
  assert.equal(m.toques, 4);
  assert.equal(m.saltos, 1);
  assert.equal(m.conectar, 'saltada');
  assert.equal(m.editada, true);
  assert.equal(m.sirvio, true);
  assert.equal(m.intentos, 0);
  const linea = lineaMetrica(m);
  assert.match(linea, /primer resultado: util/);
  assert.match(linea, /hasta valor 3 min 10 s \(≤5 min\)/);
  assert.match(linea, /conectar saltada/);
  assert.match(linea, /sirvió sí/);
  for (const palabra of ['laptop', 'batería', 'Compara', '15,000', 'ana@']) assert.ok(!linea.includes(palabra), `la métrica no lleva «${palabra}»`);
  assert.ok(!JSON.stringify(m).includes('laptop'));
  // Más de cinco minutos: fuera del objetivo, y se dice.
  const lento = aplicar(aplicar(primeraVez(), { tipo: 'enviar', idTurno: 'x', texto: PETICION }, T0 + 60_000), { tipo: 'turno', resultado: { clase: 'util', verificado: false } }, T0 + OBJETIVO_MS + 1)!;
  assert.equal(metricas(lento).dentroObjetivo, false);
});

test('cambiar de cuenta no pasa el primer resultado de una a otra', () => {
  const a = primeraVez('ana@ejemplo.com');
  const raw = JSON.stringify(a);
  assert.notEqual(clavePrimer('ana@ejemplo.com'), clavePrimer('beto@ejemplo.com'));
  assert.equal(clavePrimer(' Ana@Ejemplo.com '), clavePrimer('ana@ejemplo.com'));
  assert.equal(leerPrimer(raw, 'beto@ejemplo.com'), null, 'B no lee el de A aunque le llegue el mismo texto');
  assert.equal(leerPrimer(raw, ''), null);
  assert.deepEqual(leerPrimer(raw, 'ANA@ejemplo.com'), a);
  assert.equal(queRecuperar(leerPrimer(raw, 'beto@ejemplo.com'), T0).accion, 'nada');
  // Guardado roto u otra versión: se empieza sin nada, sin lanzar.
  assert.equal(leerPrimer('{roto', 'ana@ejemplo.com'), null);
  assert.equal(leerPrimer(JSON.stringify({ ...a, v: 99 }), 'ana@ejemplo.com'), null, 'una versión desconocida no se lee');
  assert.equal(leerPrimer(JSON.stringify({ ...a, estado: 'inventado' }), 'ana@ejemplo.com'), null);
});

test('al reabrir se recupera el primer pedido pendiente', () => {
  // Cerró la app con la petición preparada y sin mandar: vuelve a la caja.
  const prep = leerPrimer(JSON.stringify(primeraVez()), 'ana@ejemplo.com');
  assert.deepEqual(queRecuperar(prep, T0 + 3_600_000), { accion: 'rellenar', texto: PETICION });
  // La mandó y cerró antes de la respuesta: el MISMO idTurno, dentro de la vida del turno durable.
  const env = aplicar(prep, { tipo: 'enviar', idTurno: 't-abc', texto: PETICION }, T0 + 70_000)!;
  const reabierto = leerPrimer(JSON.stringify(env), 'ana@ejemplo.com');
  assert.deepEqual(queRecuperar(reabierto, T0 + 70_000 + 60_000), { accion: 'reconsultar', idTurno: 't-abc', texto: PETICION });
  // Volver a pedir con ese id no es otro intento, y la respuesta repetida da el resultado.
  const otraVez = aplicar(reabierto, { tipo: 'enviar', idTurno: 't-abc', texto: PETICION }, T0 + 140_000);
  assert.equal(otraVez, reabierto);
  const listo = aplicar(otraVez, { tipo: 'turno', idTurno: 't-abc', resultado: clasificarTurno({ reply: 'La B, con estas fuentes…' }) }, T0 + 150_000)!;
  assert.equal(listo.estado, 'util');
  assert.equal(listo.intentos, 0);
  assert.equal(queRecuperar(listo, T0 + 160_000).accion, 'nada');
  // Pasada la vida del turno no se repite solo: a la caja.
  assert.deepEqual(queRecuperar(reabierto, T0 + 70_000 + VIDA_TURNO_MS + 1), { accion: 'rellenar', texto: PETICION });
  // Con tareas abiertas, se esperan las tareas (las lee /api/trabajos).
  const enTarea = aplicar(env, { tipo: 'turno', idTurno: 't-abc', resultado: { clase: 'en-tarea', tareas: ['tk1'] } }, T0 + 80_000)!;
  assert.deepEqual(queRecuperar(leerPrimer(JSON.stringify(enTarea), 'ana@ejemplo.com'), T0 + 9e9), { accion: 'esperar-tareas', tareas: ['tk1'] });
  // Saltó el objetivo: no hay nada que recuperar hasta que mande algo.
  const sin = aplicar(nuevoPrimer('ana@ejemplo.com', T0), { tipo: 'preparar', peticion: '' }, T0 + 1)!;
  assert.equal(sin.estado, 'sin-peticion');
  assert.equal(queRecuperar(sin, T0 + 2).accion, 'nada');
});

test('R1 (revisión 9): al reabrir, «solo repetir»; si el pedido no llegó vuelve a la caja y NADA corre solo', () => {
  // Enviado y sin respuesta al cerrar: se pregunta por ese idTurno (no se manda otra vez a ciegas).
  const env = aplicar(aplicar(primeraVez(), { tipo: 'preparar', peticion: PETICION }, T0 + 60_000)!, { tipo: 'enviar', idTurno: 't-abc', texto: PETICION }, T0 + 70_000)!;
  assert.deepEqual(queRecuperar(env, T0 + 80_000), { accion: 'reconsultar', idTurno: 't-abc', texto: PETICION });
  // El servidor no lo tiene: a la caja, sabiendo que no llegó.
  assert.deepEqual(trasSoloRepetir({ status: 404, json: { codigo: 'no_existe', noExiste: true } }), { accion: 'rellenar', noLlego: true });
  // Lo tiene (o lo dejó incierto): se repite con `soloRepetir`, nunca un turno nuevo.
  assert.deepEqual(trasSoloRepetir({ status: 200, json: { reply: 'Te recomiendo la B.', repetido: true } }), { accion: 'repetir' });
  assert.deepEqual(trasSoloRepetir({ status: 200, json: { reply: 'No sé si quedó hecho.', repetido: true, reconciliando: true } }), { accion: 'repetir' });
  assert.deepEqual(trasSoloRepetir({ status: 409, json: { codigo: 'en-curso', enCurso: true } }), { accion: 'repetir' });
  // Sin red, un servidor de antes (404 sin código, o un 200 que no es una respuesta repetida) o un error: a la caja sin saber.
  for (const r of [null, undefined, { status: 404, json: {} }, { status: 200, json: { reply: 'recién corrido' } }, { status: 500, json: { error: 'x' } }, { status: 401, json: {} }]) {
    assert.deepEqual(trasSoloRepetir(r as any), { accion: 'rellenar', noLlego: false }, JSON.stringify(r));
  }
  // «No llegó» marca el primer pedido como fallido: la próxima vez vuelve a la caja directamente.
  const fallida = aplicar(env, { tipo: 'turno', idTurno: 't-abc', resultado: { clase: 'fallida', motivo: 'el pedido no llegó al servidor' } }, T0 + 90_000)!;
  assert.equal(fallida.estado, 'fallida');
  assert.deepEqual(queRecuperar(fallida, T0 + 100_000), { accion: 'rellenar', texto: PETICION });
  assert.deepEqual(MOVIL.trasSoloRepetir({ status: 404, json: { codigo: 'no_existe' } }), { accion: 'rellenar', noLlego: true });
});

/* ── R1 (auditoría del 5-oct): cobertura de TODAS las tareas del primer pedido ───────────────────────── */

const TERMINAL_VISTA = new Set(['completed', 'respondida', 'partial', 'failed', 'cancelled']);
/** Una tarea como la da GET /api/trabajos (TaskSnapshot), sintética. */
function vista(id: string, state: TareaVista['state'], o: { evidencia?: boolean; version?: number; partial?: string[] } = {}): TareaVista {
  return {
    id,
    version: o.version ?? 2,
    state,
    terminal: TERMINAL_VISTA.has(state),
    source: 'durable',
    title: `Tarea ${id}`,
    objective: '',
    acceptance: [],
    environment: { kind: 'nube', id: 'n', displayName: 'Nube' },
    updatedAt: '2026-10-05T06:00:00Z',
    controls: { pause: false, resume: false, cancel: false },
    result: TERMINAL_VISTA.has(state) ? { id: `r-${id}`, summary: 'listo', evidence: o.evidencia ? [{ id: `e-${id}`, tipo: 'url', etiqueta: 'fuente' }] : [], partial: o.partial || [], pending: [], at: '' } : null,
  };
}

/** Respuestas por ruta, cambiables en mitad de la prueba. Una función que lanza = sin red. */
type Resp = { status: number; json: any } | (() => never);
function transporte(rutas: Record<string, Resp>) {
  const pedidas: string[] = [];
  const pedir = async (ruta: string) => {
    pedidas.push(ruta);
    const clave = Object.keys(rutas).find((k) => ruta.split('?')[0] === k.split('?')[0] && (!k.includes('?') || ruta.includes(k.split('?')[1])));
    const r = clave ? rutas[clave] : { status: 404, json: { codigo: 'no-esta' } };
    if (typeof r === 'function') return r();
    return r;
  };
  return { pedir, pedidas, rutas };
}
const sinRed = (() => {
  throw new Error('Network request failed');
}) as () => never;

/** El primer pedido abre A y B, las dos en curso. */
function enTareaAB(): PrimerResultado {
  let r: PrimerResultado | null = aplicar(primeraVez(), { tipo: 'enviar', idTurno: 't1', texto: PETICION }, T0 + 70_000);
  r = aplicar(r, { tipo: 'turno', idTurno: 't1', resultado: clasificarTurno({ reply: 'Voy con las dos.', tareas: [{ id: 'A', state: 'running' }, { id: 'B', state: 'running' }] }) }, T0 + 75_000);
  assert.equal(r!.estado, 'en-tarea');
  assert.deepEqual(r!.tareas, ['A', 'B']);
  return r!;
}

/**
 * La mesa (DeskScreen) de verdad, sin React: el cliente HTTP real (listar + reductor del panel → `trabajos.tareas`) y
 * la vuelta `seguirTareasPrimer` que el efecto de la pantalla llama tal cual, contra un registro por cuenta.
 */
async function vueltaMesa(r: PrimerResultado, pedir: (ruta: string) => Promise<{ status: number; json: any }>, ahora: number, o: { vigente?: () => boolean } = {}) {
  const cli = crearClienteTrabajos(pedir);
  const l = await cli.listar();
  let s = estadoInicial();
  s = l.ok ? reducir(s, { tipo: 'lista', tareas: l.tareas, en: ahora, completo: l.completo, aviso: l.aviso }) : reducir(s, { tipo: 'error', mensaje: 'mensaje' in l ? l.mensaje : '', en: ahora });
  let out: PrimerResultado | null = r;
  const anotadas: EventoPrimer[] = [];
  const anoto = await MOVIL.seguirTareasPrimer({
    ids: r.tareas || [],
    idTurno: r.idTurno,
    lista: lista(s),
    leer: (id) => cli.leer(id),
    vigente: o.vigente || (() => true),
    anotar: (ev) => {
      anotadas.push(ev);
      out = MOVIL.aplicar(out, ev, ahora);
    },
  });
  return { r: out as PrimerResultado, l, anoto, anotadas };
}

test('R1: lista parcial + A completada con evidencia + B 503 → sigue en tarea, sin éxito verificado ni «¿Te sirvió?»', async () => {
  const r = enTareaAB();
  const red = transporte({
    '/api/trabajos': { status: 200, json: { tareas: [vista('A', 'completed', { evidencia: true })], completo: false, aviso: 'No pude leer una de tus tareas.' } },
    '/api/trabajos/B': { status: 503, json: { error: 'no disponible', code: 'almacen_no_disponible' } },
  });
  const v = await vueltaMesa(r, red.pedir, T0 + 120_000);
  assert.equal(v.l.ok && v.l.completo, false, 'el listado vino parcial');
  assert.ok(red.pedidas.some((x) => x.startsWith('/api/trabajos/B')), 'B, que no vino en la lista, se pidió por su id');
  assert.equal(v.r.estado, 'en-tarea', 'un 503 no es ni éxito ni fracaso de B');
  assert.equal(v.r.verificado, undefined);
  assert.equal(v.r.resultadoMs, undefined);
  assert.equal(hayResultado(v.r), false);
  assert.equal(debePreguntar(v.r), false, 'sin «¿Te sirvió?» terminal');
  const m = metricas(v.r);
  assert.equal(m.util, false);
  assert.equal(m.verificado, false);
  assert.equal(m.msHastaValor, null);
  assert.equal(m.cobertura, null);
  assert.match(lineaMetrica(m), /primer resultado: en-tarea/);
  assert.doesNotMatch(lineaMetrica(m), /verificado/);
  // Progreso a la vista sin congelar nada: A terminó con evidencia, B sin leer.
  assert.deepEqual(v.r.avance, [
    { id: 'A', estado: 'completada', evidencia: true },
    { id: 'B', estado: 'sin-leer' },
  ]);
  assert.deepEqual(avancePrimer(v.r), { listas: 1, total: 2, sinLeer: 1 });
  assert.deepEqual(m.tareas, { total: 2, terminadasBien: 1, conEvidencia: 1, sinLeer: 1 });
  // Tal cual lo hacía la pantalla antes (las lecturas nulas se tiraban y se pasaba solo A, sin ids): el clasificador
  // compartido tampoco lo da por bueno.
  const viejo = aplicar(r, { tipo: 'tareas', tareas: [vista('A', 'completed', { evidencia: true })] }, T0 + 120_000)!;
  assert.equal(viejo.estado, 'en-tarea');
  assert.equal(debePreguntar(viejo), false);
  assert.deepEqual(clasificarTareas([vista('A', 'completed', { evidencia: true })], ['A', 'B']).clase, 'pendiente');

  // B reaparece COMPLETADA (con evidencia): un solo cierre, útil y verificado, con cobertura completa.
  red.rutas['/api/trabajos/B'] = { status: 200, json: { tarea: vista('B', 'completed', { evidencia: true }) } };
  const ok = await vueltaMesa(v.r, red.pedir, T0 + 200_000);
  assert.equal(ok.r.estado, 'util');
  assert.equal(ok.r.verificado, true);
  assert.equal(ok.r.cobertura, 'completa');
  assert.equal(ok.r.resultadoMs, T0 + 200_000);
  assert.equal(debePreguntar(ok.r), true);
  assert.match(lineaMetrica(metricas(ok.r)), /primer resultado: util verificado .*cobertura completa · tareas 2\/2 bien, 2 con evidencia, 0 sin leer/);
  // Otra vuelta no lo cierra dos veces (mismo objeto: no se escribe ni se reporta otra vez).
  const otra = await vueltaMesa(ok.r, red.pedir, T0 + 260_000);
  assert.equal(otra.r, ok.r);
  assert.equal(otra.r.resultadoMs, T0 + 200_000);
});

test('R1: B reaparece fallida o parcial → cierre coherente (parcial, sin verificado), nunca el éxito de A sola', async () => {
  const lista1 = { status: 200, json: { tareas: [vista('A', 'completed', { evidencia: true })], completo: false } };
  for (const [b, faltan] of [
    [vista('B', 'failed'), ['Tarea B']],
    [vista('B', 'partial', { partial: ['No pude leer la fuente: tienda B (timeout)'] }), ['No pude leer la fuente: tienda B (timeout)']],
    [vista('B', 'cancelled'), ['Tarea B']],
  ] as const) {
    const red = transporte({ '/api/trabajos': lista1, '/api/trabajos/B': { status: 503, json: {} } });
    const antes = await vueltaMesa(enTareaAB(), red.pedir, T0 + 120_000);
    assert.equal(antes.r.estado, 'en-tarea');
    red.rutas['/api/trabajos/B'] = { status: 200, json: { tarea: b } };
    const fin = await vueltaMesa(antes.r, red.pedir, T0 + 300_000);
    assert.equal(fin.r.estado, 'parcial', b.state);
    assert.equal(fin.r.verificado, false);
    assert.deepEqual(fin.r.faltantes, faltan);
    assert.equal(fin.r.cobertura, 'completa');
    assert.equal(metricas(fin.r).util, false);
    assert.equal(metricas(fin.r).msHastaValor, null, 'parcial no es valor útil');
    assert.deepEqual(metricas(fin.r).tareas, { total: 2, terminadasBien: 1, conEvidencia: 1, sinLeer: 0 });
  }
  // Las dos mal: fallida (no es resultado; lo siguiente que mande es un reintento).
  const red = transporte({ '/api/trabajos': { status: 200, json: { tareas: [vista('A', 'failed'), vista('B', 'failed')], completo: true } } });
  const mal = await vueltaMesa(enTareaAB(), red.pedir, T0 + 300_000);
  assert.equal(mal.r.estado, 'fallida');
  assert.equal(debePreguntar(mal.r), false);
  // Y el reintento empieza limpio: las tareas, el avance y el cierre del intento anterior no son de este.
  const re = aplicar(mal.r, { tipo: 'enviar', idTurno: 't2', texto: PETICION }, T0 + 310_000)!;
  assert.equal(re.estado, 'enviada');
  for (const k of ['tareas', 'avance', 'cobertura', 'verificado', 'motivo', 'sinSeguir'] as const) assert.equal(re[k], undefined, k);
});

test('R1: sin red, 404, respuesta rara y lista vacía → nunca se asume que la que falta terminó bien', async () => {
  // El cliente distingue: ok (y es ESA tarea) / no existe / error.
  const t = transporte({
    '/api/trabajos/OK': { status: 200, json: { tarea: vista('OK', 'running') } },
    '/api/trabajos/OTRA': { status: 200, json: { tarea: vista('AJENA', 'completed', { evidencia: true }) } },
    '/api/trabajos/VACIA': { status: 200, json: {} },
    '/api/trabajos/CAIDA': { status: 503, json: { error: 'x' } },
    '/api/trabajos/SESION': { status: 401, json: {} },
    '/api/trabajos/RED': sinRed,
  });
  const cli = crearClienteTrabajos(t.pedir);
  assert.equal((await cli.leer('OK')).estado, 'ok');
  assert.deepEqual(await cli.leer('NOESTA'), { estado: 'no-existe' });
  assert.deepEqual(await cli.leer('OTRA'), { estado: 'error', status: 200 }, 'una respuesta con OTRO id no es esa tarea');
  assert.deepEqual(await cli.leer('VACIA'), { estado: 'error', status: 200 });
  assert.deepEqual(await cli.leer('CAIDA'), { estado: 'error', status: 503 });
  assert.deepEqual(await cli.leer('SESION'), { estado: 'error', status: 401, sinSesion: true });
  assert.deepEqual(await cli.leer('RED'), { estado: 'error' });
  // `ver` sigue igual para quien ya lo usa.
  assert.equal(await cli.ver('CAIDA'), null);
  assert.equal(await cli.ver('RED'), null);
  assert.equal((await cli.ver('OK'))?.id, 'OK');

  const casos: [string, Record<string, Resp>][] = [
    ['sin red (lista y B)', { '/api/trabajos': sinRed, '/api/trabajos/A': { status: 200, json: { tarea: vista('A', 'completed', { evidencia: true }) } }, '/api/trabajos/B': sinRed }],
    ['B 404', { '/api/trabajos': { status: 200, json: { tareas: [vista('A', 'completed', { evidencia: true })], completo: true } } }],
    ['lista vacía (503 del servidor) y B sin red', { '/api/trabajos': { status: 503, json: { tareas: [], completo: false, error: 'No pude leer tus tareas' } }, '/api/trabajos/A': { status: 200, json: { tarea: vista('A', 'completed', { evidencia: true }) } }, '/api/trabajos/B': sinRed }],
    ['lista vacía «completa» y B 404', { '/api/trabajos': { status: 200, json: { tareas: [], completo: true } }, '/api/trabajos/A': { status: 200, json: { tarea: vista('A', 'completed', { evidencia: true }) } } }],
    ['B leída devuelve otra tarea', { '/api/trabajos': { status: 200, json: { tareas: [vista('A', 'completed', { evidencia: true })], completo: false } }, '/api/trabajos/B': { status: 200, json: { tarea: vista('A', 'completed', { evidencia: true }) } } }],
  ];
  for (const [nombre, rutas] of casos) {
    const v = await vueltaMesa(enTareaAB(), transporte(rutas).pedir, T0 + 120_000);
    assert.equal(v.r.estado, 'en-tarea', nombre);
    assert.equal(debePreguntar(v.r), false, nombre);
    assert.equal(metricas(v.r).verificado, false, nombre);
    assert.equal(v.r.avance?.find((a) => a.id === 'B')?.estado, 'sin-leer', nombre);
  }
  // Lo que junta la mesa dice POR QUÉ falta cada una (para el diagnóstico), sin dejarla pasar.
  const j = await MOVIL.reunirTareasPrimer(['A', 'B', 'C'], [vista('A', 'completed')], async (id) => (id === 'B' ? { estado: 'no-existe' } : (() => { throw new Error('red'); })()));
  assert.deepEqual(j.tareas.map((x) => x.id), ['A']);
  assert.deepEqual(j.noExisten, ['B']);
  assert.deepEqual(j.sinLeer, ['C']);
});

test('R1: duplicados, ajenas, fuera de orden y varias páginas → cobertura por TODOS los ids esperados', async () => {
  const A = vista('A', 'completed', { evidencia: true });
  const B = vista('B', 'completed', { evidencia: true });
  // Un duplicado de A no cubre B; una ajena tampoco.
  assert.equal(clasificarTareas([A, A], ['A', 'B']).clase, 'pendiente');
  assert.equal(clasificarTareas([A, vista('X', 'completed', { evidencia: true })], ['A', 'B']).clase, 'pendiente');
  assert.deepEqual(coberturaTareas([A, A, vista('X', 'failed')], ['A', 'B', 'A']), [
    { id: 'A', estado: 'completada', evidencia: true },
    { id: 'B', estado: 'sin-leer' },
  ]);
  // Fuera de orden: cuenta igual; el avance sigue el orden de los esperados.
  assert.deepEqual(clasificarTareas([B, A], ['A', 'B']), {
    clase: 'util',
    verificado: true,
    avance: [
      { id: 'A', estado: 'completada', evidencia: true },
      { id: 'B', estado: 'completada', evidencia: true },
    ],
  });
  // El mismo id dos veces: gana la terminal (no vuelve atrás) y la versión más alta; si se contradicen, no se sabe.
  assert.equal(coberturaTareas([vista('A', 'running', { version: 9 }), vista('A', 'completed', { version: 3 })], ['A'])[0].estado, 'completada');
  assert.equal(coberturaTareas([vista('A', 'failed', { version: 2 }), vista('A', 'completed', { version: 4 })], ['A'])[0].estado, 'completada');
  assert.equal(coberturaTareas([vista('A', 'failed', { version: 4 }), vista('A', 'completed', { version: 4 })], ['A'])[0].estado, 'sin-leer');
  // Evidencia solo si la tiene la que cuenta (no la toma prestada de un duplicado).
  assert.equal(coberturaTareas([vista('A', 'completed', { version: 4 }), vista('A', 'completed', { version: 4, evidencia: true })], ['A'])[0].evidencia, undefined);
  // «Sin confirmar» (de una lista parcial anterior): si no es terminal puede ser vieja → sin leer; terminal, cuenta.
  assert.equal(coberturaTareas([{ ...vista('A', 'running'), sinConfirmar: true }], ['A'])[0].estado, 'sin-leer');
  assert.equal(coberturaTareas([{ ...vista('A', 'completed'), sinConfirmar: true }], ['A'])[0].estado, 'completada');
  // El turno que enlaza la misma tarea dos veces espera UNA, no dos.
  assert.deepEqual(clasificarTurno({ reply: 'Voy.', tareas: [{ id: 'A', state: 'running' }, { id: 'A', state: 'running' }, { id: 'B', state: 'queued' }] }), { clase: 'en-tarea', tareas: ['A', 'B'] });

  // Varias páginas: A en la primera, B en la segunda → todas a la vista, sin leer por id, un cierre.
  const pags = transporte({
    '/api/trabajos?cursor': { status: 200, json: { tareas: [B], completo: true, siguiente: null } },
    '/api/trabajos': { status: 200, json: { tareas: [A], completo: true, siguiente: 'c2' } },
  });
  const v = await vueltaMesa(enTareaAB(), pags.pedir, T0 + 200_000);
  assert.equal(v.l.ok && v.l.completo, true);
  assert.ok(!pags.pedidas.some((x) => /^\/api\/trabajos\/[AB]/.test(x)), 'las dos vinieron en la lista');
  assert.equal(v.r.estado, 'util');
  assert.equal(v.r.verificado, true);
  // La segunda página falla y B tampoco se lee: parcial de verdad → sigue esperando.
  const caida = transporte({
    '/api/trabajos?cursor': { status: 503, json: {} },
    '/api/trabajos': { status: 200, json: { tareas: [A], completo: true, siguiente: 'c2' } },
    '/api/trabajos/B': { status: 503, json: {} },
  });
  const w = await vueltaMesa(enTareaAB(), caida.pedir, T0 + 200_000);
  assert.equal(w.l.ok && w.l.completo, false);
  assert.equal(w.r.estado, 'en-tarea');
  assert.equal(debePreguntar(w.r), false);

  // Más tareas de las que se siguen: no se recortan en silencio; nunca un éxito completo.
  const muchas = Array.from({ length: MAX_TAREAS_PRIMER + 3 }, (_, i) => ({ id: `t${i}`, state: 'running' }));
  const turno = clasificarTurno({ reply: 'Voy con todas.', tareas: muchas });
  assert.equal(turno.clase, 'en-tarea');
  assert.equal(turno.clase === 'en-tarea' && turno.tareas.length, MAX_TAREAS_PRIMER);
  assert.equal(turno.clase === 'en-tarea' && turno.sinSeguir, 3);
  let r: PrimerResultado | null = aplicar(aplicar(primeraVez(), { tipo: 'enviar', idTurno: 'tm', texto: PETICION }, T0 + 1)!, { tipo: 'turno', idTurno: 'tm', resultado: turno }, T0 + 2);
  assert.equal(r!.sinSeguir, 3);
  assert.equal(avancePrimer(r)!.total, MAX_TAREAS_PRIMER + 3);
  r = aplicar(r, { tipo: 'tareas', tareas: r!.tareas!.map((id) => vista(id, 'completed', { evidencia: true })), ids: r!.tareas, idTurno: 'tm' }, T0 + 3);
  assert.equal(r!.estado, 'parcial');
  assert.equal(r!.verificado, false);
  assert.equal(r!.cobertura, 'excedida');
  assert.deepEqual(r!.faltantes, ['3 tareas más del pedido que no pude seguir']);
  assert.equal(leerPrimer(JSON.stringify(r), 'ana@ejemplo.com')!.sinSeguir, 3, 'se guarda y se relee');
});

test('R1: reabrir, otro intento o cambio de cuenta durante la consulta → lo tardío no entra', async () => {
  // Lo leído para el turno t1 (A y B) llega cuando el registro ya espera otro intento (t2, con C y D).
  let r: PrimerResultado | null = enTareaAB();
  r = aplicar(r, { tipo: 'tareas', tareas: [vista('A', 'failed'), vista('B', 'failed')], ids: ['A', 'B'], idTurno: 't1' }, T0 + 100_000);
  assert.equal(r!.estado, 'fallida');
  r = aplicar(r, { tipo: 'enviar', idTurno: 't2', texto: PETICION }, T0 + 110_000);
  r = aplicar(r, { tipo: 'turno', idTurno: 't2', resultado: { clase: 'en-tarea', tareas: ['C', 'D'] } }, T0 + 120_000)!;
  const tarde = [vista('A', 'completed', { evidencia: true }), vista('B', 'completed', { evidencia: true })];
  assert.equal(aplicar(r, { tipo: 'tareas', tareas: tarde, ids: ['A', 'B'], idTurno: 't1' }, T0 + 130_000), r, 'otro intento (otros ids, otro turno)');
  assert.equal(aplicar(r, { tipo: 'tareas', tareas: [vista('C', 'completed'), vista('D', 'completed')], ids: ['C', 'D'], idTurno: 't1' }, T0 + 130_000), r, 'otro turno');
  assert.equal(aplicar(r, { tipo: 'tareas', tareas: [vista('C', 'completed'), vista('D', 'completed')], ids: ['C'], idTurno: 't2' }, T0 + 130_000), r, 'otro conjunto');
  assert.equal(aplicar(r, { tipo: 'tareas', tareas: tarde }, T0 + 130_000)!.estado, 'en-tarea', 'sin etiqueta: tampoco cubre C y D');
  // Reabrir: se espera a las MISMAS tareas, y una vuelta de la mesa sobre ellas sí cuenta.
  const reabierto = leerPrimer(JSON.stringify(r), 'ana@ejemplo.com')!;
  assert.deepEqual(queRecuperar(reabierto, T0 + 9e9), { accion: 'esperar-tareas', tareas: ['C', 'D'] });
  const red = transporte({ '/api/trabajos': { status: 200, json: { tareas: [vista('C', 'completed'), vista('D', 'respondida')], completo: true } } });
  const v = await vueltaMesa(reabierto, red.pedir, T0 + 200_000);
  assert.equal(v.r.estado, 'util');
  assert.equal(v.r.verificado, false, 'sin evidencia de las dos no hay verificado');

  // Cambio de cuenta (o la pantalla se fue) MIENTRAS se lee B: la vuelta no anota nada.
  let vigente = true;
  const lenta = transporte({
    '/api/trabajos': { status: 200, json: { tareas: [vista('A', 'completed', { evidencia: true })], completo: false } },
    '/api/trabajos/B': { status: 200, json: { tarea: vista('B', 'completed', { evidencia: true }) } },
  });
  const pedirLento = async (ruta: string) => {
    if (ruta.startsWith('/api/trabajos/B')) vigente = false; // entra otra cuenta justo ahora
    return lenta.pedir(ruta);
  };
  const ab = enTareaAB();
  const w = await vueltaMesa(ab, pedirLento, T0 + 200_000, { vigente: () => vigente });
  assert.equal(w.anoto, false);
  assert.equal(w.anotadas.length, 0);
  assert.equal(w.r, ab, 'el registro no cambió');
  // Y el registro de A no lo lee B aunque le llegue el mismo texto.
  assert.equal(leerPrimer(JSON.stringify(ab), 'beto@ejemplo.com'), null);
});

test('R1: registros v1 ya guardados → se leen sin inventar evidencia ni tocar la opinión, y las métricas los separan', () => {
  const v1 = { ...enTareaAB(), v: 1, estado: 'util', resultadoMs: T0 + 120_000, verificado: true, sirvio: true, opinadoMs: T0 + 130_000, tareas: ['A'] };
  const r = leerPrimer(JSON.stringify(v1), 'ana@ejemplo.com')!;
  assert.equal(r.v, 2);
  assert.equal(r.estado, 'util');
  assert.equal(r.cobertura, 'previa');
  assert.equal(r.verificado, true, 'no se le quita ni se le pone evidencia');
  assert.equal(r.sirvio, true, 'la opinión se queda');
  assert.equal(aplicar(r, { tipo: 'opinar', sirvio: false }, T0 + 200_000), r, 'y no se pisa');
  assert.equal(aplicar(r, { tipo: 'tareas', tareas: [vista('A', 'completed'), vista('B', 'failed')] }, T0 + 200_000), r, 'no se corrige hacia atrás');
  const m = metricas(r);
  assert.equal(m.cobertura, 'previa');
  assert.equal(m.tareas, null);
  assert.match(lineaMetrica(m), /cobertura previa/);
  // Uno v1 sin opinar ni resultado (aún en tarea): sigue, ya con las reglas de ahora.
  const abierto = leerPrimer(JSON.stringify({ ...enTareaAB(), v: 1 }), 'ana@ejemplo.com')!;
  assert.equal(abierto.cobertura, undefined);
  assert.equal(aplicar(abierto, { tipo: 'tareas', tareas: [vista('A', 'completed', { evidencia: true })] }, T0 + 200_000)!.estado, 'en-tarea');
  const cerrado = aplicar(abierto, { tipo: 'tareas', tareas: [vista('A', 'completed', { evidencia: true }), vista('B', 'completed', { evidencia: true })] }, T0 + 200_000)!;
  assert.equal(cerrado.cobertura, 'completa');
  // Uno nuevo se guarda como v2 y se relee igual (avance incluido).
  assert.deepEqual(leerPrimer(JSON.stringify(cerrado), 'ana@ejemplo.com'), cerrado);
  assert.equal(JSON.parse(JSON.stringify(cerrado)).v, 2);
  // Un avance guardado roto o con ids repetidos no pasa.
  const roto = leerPrimer(JSON.stringify({ ...cerrado, avance: [{ id: 'A', estado: 'inventado' }, { id: 'B', estado: 'completada' }, { id: 'B', estado: 'fallida' }, null] }), 'ana@ejemplo.com')!;
  assert.deepEqual(roto.avance, [{ id: 'B', estado: 'completada' }]);
});

test('R1: tres señales por separado: terminó, evidencia y opinión (ninguna implica otra)', () => {
  const sinEvidencia = aplicar(enTareaAB(), { tipo: 'tareas', tareas: [vista('A', 'completed'), vista('B', 'completed')], ids: ['A', 'B'], idTurno: 't1' }, T0 + 200_000)!;
  assert.equal(sinEvidencia.estado, 'util');
  assert.equal(sinEvidencia.verificado, false, 'terminar no es evidencia');
  assert.equal(sinEvidencia.sirvio, undefined, 'ni opinión');
  const dijoSi = aplicar(sinEvidencia, { tipo: 'opinar', sirvio: true }, T0 + 210_000)!;
  assert.equal(dijoSi.verificado, false, '«sí, me sirvió» no es evidencia');
  assert.equal(metricas(dijoSi).verificado, false);
  assert.equal(metricas(dijoSi).sirvio, true);
  const conEvidencia = aplicar(enTareaAB(), { tipo: 'tareas', tareas: [vista('A', 'completed', { evidencia: true }), vista('B', 'completed', { evidencia: true })], ids: ['A', 'B'], idTurno: 't1' }, T0 + 200_000)!;
  const dijoNo = aplicar(conEvidencia, { tipo: 'opinar', sirvio: false }, T0 + 210_000)!;
  assert.equal(dijoNo.verificado, true, 'la evidencia no cambia con la opinión');
  assert.equal(dijoNo.estado, 'util');
  assert.equal(metricas(dijoNo).sirvio, false, 'evidencia no es satisfacción');
  // Opinar antes de que haya resultado (en tarea) no hace nada.
  const espera = enTareaAB();
  assert.equal(aplicar(espera, { tipo: 'opinar', sirvio: true }, T0 + 90_000), espera);
});

test('R1: la mesa usa ESTA vuelta (no tira las lecturas nulas) y la ata al turno y a la sesión', async () => {
  const fs = await import('node:fs');
  const desk = fs.readFileSync(new URL('../mobile/src/screens/DeskScreen.tsx', import.meta.url), 'utf8');
  const i = desk.indexOf('const idsPrimer');
  const bloque = desk.slice(i, desk.indexOf('const opinarPrimer', i));
  assert.match(bloque, /seguirTareasPrimer\(\{/);
  assert.match(bloque, /leer: \(id\) => clienteTrabajos\.leer\(id\)/);
  assert.match(bloque, /idTurno: turnoPrimer/);
  assert.match(bloque, /vigente: \(\) => vivo && sigueVigente\(gen\)/);
  assert.doesNotMatch(bloque, /clienteTrabajos\.ver\(|!!t\)/, 'ya no se descartan las lecturas fallidas');
  // El «¿Te sirvió?» solo con resultado; el progreso, sin pregunta.
  assert.match(desk, /debePreguntar\(primer\) \|\| \(avance && avance\.listas > 0\)/);
  const sirvio = fs.readFileSync(new URL('../mobile/src/primeravez/SirvioPrimera.tsx', import.meta.url), 'utf8');
  assert.match(sirvio, /const avance = avancePrimer\(registro\);\n\s+if \(avance\) \{[\s\S]*?return \(/, 'en tarea muestra el progreso y vuelve antes de la pregunta');
});

test('la copia del teléfono dice exactamente lo mismo que lib/', async () => {
  const fs = await import('node:fs');
  const cuerpo = (p: string) => {
    const s = fs.readFileSync(new URL(p, import.meta.url), 'utf8');
    return s.slice(s.indexOf(' */\n') + 4);
  };
  assert.equal(cuerpo('../mobile/src/lib/primerResultado.ts'), cuerpo('../lib/primer-resultado.ts'), 'la copia del teléfono es la misma (salvo su cabecera)');
  assert.equal(MOVIL.clavePrimer('a@b.c'), clavePrimer('a@b.c'));
  assert.equal(MOVIL.VIDA_TURNO_MS, VIDA_TURNO_MS);
});

test('R1 (revisión 13): un 404 SOSTENIDO (3 lecturas seguidas en ≥10 min) da la tarea por no encontrada → parcial con ella en lo que faltó, nunca útil; un 404 suelto o una racha cortada no bastan', async () => {
  assert.equal(NO_ENCONTRADA_LECTURAS, 3);
  assert.equal(NO_ENCONTRADA_MS, 10 * 60_000);
  assert.equal(MOVIL.NO_ENCONTRADA_MS, NO_ENCONTRADA_MS);
  // A terminada con evidencia en la lista; B da 404 (la ruta no existe en el transporte) en cada lectura.
  const red = transporte({ '/api/trabajos': { status: 200, json: { tareas: [vista('A', 'completed', { evidencia: true })], completo: true } } });
  const t1 = T0 + 120_000;
  let r = enTareaAB();
  // Tres 404 seguidos en pocos segundos: siguen «1 de 2» (puede ser que otra réplica aún no la vea).
  for (const t of [t1, t1 + 3000, t1 + 6000]) r = (await vueltaMesa(r, red.pedir, t)).r;
  assert.equal(r.estado, 'en-tarea');
  assert.deepEqual(r.avance?.find((a) => a.id === 'B'), { id: 'B', estado: 'sin-leer', ausente: { veces: 3, desde: t1 } });
  assert.deepEqual(avancePrimer(r), { listas: 1, total: 2, sinLeer: 1 });
  // La racha sobrevive a cerrar y reabrir la app (lo guardado por cuenta).
  r = leerPrimer(JSON.stringify(r), r.cuenta)!;
  assert.deepEqual(r.avance?.find((a) => a.id === 'B')?.ausente, { veces: 3, desde: t1 });
  // A los 10 min de la primera, otro 404: no encontrada → parcial (nunca útil), con ella en lo que faltó.
  const v = await vueltaMesa(r, red.pedir, t1 + NO_ENCONTRADA_MS);
  assert.equal(v.r.estado, 'parcial', JSON.stringify(v.r));
  assert.equal(v.r.verificado, false);
  assert.ok(v.r.faltantes?.includes('una tarea que ya no encuentro'), JSON.stringify(v.r.faltantes));
  assert.deepEqual(v.r.avance, [
    { id: 'A', estado: 'completada', evidencia: true },
    { id: 'B', estado: 'no-encontrada' },
  ]);
  assert.equal(v.r.cobertura, 'completa');
  assert.equal(hayResultado(v.r), true);
  assert.equal(metricas(v.r).util, false);
  assert.equal(metricas(v.r).verificado, false);
  // Cerrado: lo guardado se relee igual (el estado nuevo es válido) y ya no vuelve a «en tarea».
  assert.equal(leerPrimer(JSON.stringify(v.r), v.r.cuenta)?.avance?.[1].estado, 'no-encontrada');

  // Una racha CORTADA (un 503 o un fallo de red en medio) vuelve a empezar: dos 404, un 503 y un 404 a los 11 min → sigue.
  const rutas: Record<string, Resp> = { '/api/trabajos': { status: 200, json: { tareas: [vista('A', 'completed', { evidencia: true })], completo: true } } };
  const red2 = transporte(rutas);
  let c = enTareaAB();
  c = (await vueltaMesa(c, red2.pedir, t1)).r;
  c = (await vueltaMesa(c, red2.pedir, t1 + 3000)).r;
  rutas['/api/trabajos/B'] = { status: 503, json: { error: 'no disponible', code: 'almacen_no_disponible' } };
  c = (await vueltaMesa(c, red2.pedir, t1 + 6000)).r;
  assert.equal(c.avance?.find((a) => a.id === 'B')?.ausente, undefined, 'el 503 corta la racha');
  delete rutas['/api/trabajos/B'];
  c = (await vueltaMesa(c, red2.pedir, t1 + 11 * 60_000)).r;
  assert.equal(c.estado, 'en-tarea');
  assert.deepEqual(c.avance?.find((a) => a.id === 'B')?.ausente, { veces: 1, desde: t1 + 11 * 60_000 });
  // Dos 404 separados por 20 min tampoco: hacen falta tres.
  let d = enTareaAB();
  d = (await vueltaMesa(d, red.pedir, t1)).r;
  d = (await vueltaMesa(d, red.pedir, t1 + 20 * 60_000)).r;
  assert.equal(d.estado, 'en-tarea');
  // Si B aparece (se lee) después de la racha, cuenta lo leído: aquí terminó con evidencia → útil.
  const red3 = transporte({ '/api/trabajos': { status: 200, json: { tareas: [vista('A', 'completed', { evidencia: true }), vista('B', 'completed', { evidencia: true })], completo: true } } });
  const e = (await vueltaMesa(r, red3.pedir, t1 + NO_ENCONTRADA_MS)).r;
  assert.equal(e.estado, 'util');
  // La única tarea del pedido, no encontrada: no es un resultado (fallida: lo siguiente que mande es un reintento).
  let u: PrimerResultado | null = aplicar(primeraVez(), { tipo: 'enviar', idTurno: 't9', texto: PETICION }, T0 + 70_000);
  u = aplicar(u, { tipo: 'turno', idTurno: 't9', resultado: clasificarTurno({ reply: 'Voy.', tareas: [{ id: 'B', state: 'running' }] }) }, T0 + 75_000)!;
  const vacia = transporte({ '/api/trabajos': { status: 200, json: { tareas: [], completo: true } } });
  for (const t of [t1, t1 + 5 * 60_000, t1 + NO_ENCONTRADA_MS]) u = (await vueltaMesa(u!, vacia.pedir, t)).r;
  assert.equal(u!.estado, 'fallida');
  assert.equal(u!.motivo, 'no encuentro la tarea');
  assert.equal(hayResultado(u), false);
  // Las dos copias (lib y teléfono) cierran igual.
  const ev: EventoPrimer = { tipo: 'tareas', tareas: [vista('A', 'completed', { evidencia: true })], ids: ['A', 'B'], idTurno: 't1', noExisten: ['B'] };
  assert.deepEqual(MOVIL.aplicar(r, ev, t1 + NO_ENCONTRADA_MS), aplicar(r, ev, t1 + NO_ENCONTRADA_MS));
});
