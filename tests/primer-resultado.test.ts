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
  clasificarTareas,
  clasificarTurno,
  clavePrimer,
  debePreguntar,
  leerPrimer,
  lineaMetrica,
  metricas,
  nuevoPrimer,
  OBJETIVO_MS,
  queRecuperar,
  trasSoloRepetir,
  VIDA_TURNO_MS,
  type EventoPrimer,
  type PrimerResultado,
} from '../lib/primer-resultado';
import * as MOVIL from '../mobile/src/lib/primerResultado';

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
  // Sigue corriendo: nada cambia.
  assert.equal(aplicar(r, { tipo: 'tareas', tareas: [{ id: 'tk1', state: 'verifying' }] }, T0 + 80_000), r);
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
  assert.deepEqual(clasificarTareas([{ id: 'a', state: 'completed', result: { evidence: [] } }]), { clase: 'util', verificado: false });
  assert.deepEqual(clasificarTareas([{ id: 'a', state: 'respondida' }]), { clase: 'util', verificado: false });
  assert.deepEqual(clasificarTareas([{ id: 'a', state: 'failed', title: 'Leer correo' }]), { clase: 'fallida', motivo: 'la tarea no terminó' });
  assert.deepEqual(clasificarTareas([{ id: 'a', state: 'completed' }, { id: 'b', state: 'failed', title: 'Fuente C' }]), { clase: 'parcial', faltantes: ['Fuente C'], verificado: false });
  assert.deepEqual(clasificarTareas([{ id: 'a', state: 'partial', estadoReal: 'respondida' }]), { clase: 'util', verificado: false });
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
  assert.equal(leerPrimer(JSON.stringify({ ...a, v: 2 }), 'ana@ejemplo.com'), null);
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
