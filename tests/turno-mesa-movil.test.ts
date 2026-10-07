/**
 * A-2 · CADA TURNO DE LA MESA CON SU FICHA (mobile/src/lib/turnoMesa.ts).
 *
 * Antes la mesa cortaba con un booleano compartido que el turno siguiente ponía en `false` por convención: lo tardío del
 * turno N leía la bandera del N+1 y podía hablar, un «callar» dicho mientras buscaba quién habla se borraba al arrancar, y
 * el turno con foto (JSON) no se podía cortar con una frase nueva. Aquí: cortar el N nunca toca al N+1, lo tardío del N se
 * calla, la espera del JSON (y de la cámara) se suelta al instante, y las reglas G2 de lib/fraseNueva.ts siguen (el relleno
 * no corta; con una herramienta con efectos, nunca).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CORTADO, TurnoMesa } from '../mobile/src/lib/turnoMesa';
import { fraseDuranteTurno } from '../mobile/src/lib/fraseNueva';

/** Una promesa que se resuelve a mano (el stream o el JSON del servidor). */
function aMano<T>() {
  let resolver!: (v: T) => void;
  let rechazar!: (e: unknown) => void;
  const promise = new Promise<T>((r, j) => ((resolver = r), (rechazar = j)));
  return { promise, resolver, rechazar };
}
const tic = () => new Promise((r) => setImmediate(r));

describe('la ficha del turno', () => {
  it('cortar el turno N nunca toca al N+1; lo tardío del N ve que ya no es vigente', () => {
    const mesa = new TurnoMesa();
    const n = mesa.empezar();
    let abortos = 0;
    n.ponerCorte(() => abortos++);
    assert.equal(mesa.pensando(), true);
    assert.equal(mesa.cancelar('frase_nueva'), true);
    assert.equal(abortos, 1, 'el stream del N se corta');
    assert.equal(n.cancelado, true);
    assert.equal(n.motivo, 'frase_nueva');
    assert.equal(mesa.cancelar('callar'), false, 'una sola vez');
    assert.equal(abortos, 1);
    // El N+1 empieza limpio: antes, el reset de la bandera compartida «descortaba» al N.
    const n1 = mesa.empezar();
    assert.equal(n1.cancelado, false);
    assert.equal(n1.vigente, true);
    assert.equal(n.cancelado, true, 'el N sigue cortado');
    assert.equal(n.vigente, false);
    assert.notEqual(n.id, n1.id);
    // Un turno que terminó sin cortarse tampoco habla después de que empiece otro.
    const mesa2 = new TurnoMesa();
    const viejo = mesa2.empezar();
    mesa2.terminar(viejo);
    assert.equal(viejo.vigente, false, 'terminado: lo tardío no habla');
    const nuevo = mesa2.empezar();
    mesa2.terminar(viejo); // un terminar tardío del viejo no suelta al nuevo
    assert.equal(mesa2.actual, nuevo);
    assert.equal(nuevo.vigente, true);
  });

  it('un callback tardío del N (el relleno, el narrador) que llega con el N+1 en curso no habla; el del N+1 sí', async () => {
    const mesa = new TurnoMesa();
    const dichos: string[] = [];
    // Como askBrain: cada cierre captura SU ficha.
    const turno = (nombre: string) => {
      const tk = mesa.empezar();
      return { tk, decir: () => tk.vigente && dichos.push(nombre) };
    };
    const n = turno('relleno del N');
    mesa.cancelar('frase_nueva');
    const n1 = turno('relleno del N+1');
    n.decir(); // llega tarde
    n1.decir();
    assert.deepEqual(dichos, ['relleno del N+1']);
  });

  it('«callar» antes de que salga el stream (mientras busca quién habla) no se borra: el stream que arranca se corta solo', () => {
    const mesa = new TurnoMesa();
    const tk = mesa.empezar();
    mesa.cancelar('callar');
    let abortado = false;
    tk.ponerCorte(() => (abortado = true));
    assert.equal(abortado, true);
    assert.equal(tk.enCamino, false);
    assert.equal(mesa.pensando(), false);
  });

  it('hasta: devuelve lo que llega; cortado, CORTADO al instante y lo que llegue después se ignora', async () => {
    const mesa = new TurnoMesa();
    const tk = mesa.empezar();
    const a = aMano<string>();
    const p = tk.hasta(a.promise);
    assert.equal(tk.enCamino, true, 'mientras espera, cuenta como en camino');
    a.resolver('respuesta');
    assert.equal(await p, 'respuesta');
    assert.equal(tk.enCamino, false, 'terminó: ya no hay nada que cortar');
    // Cortado mientras espera.
    const b = aMano<string>();
    const q = tk.hasta(b.promise);
    mesa.cancelar('callar');
    assert.equal(await q, CORTADO);
    b.resolver('tarde');
    await tic();
    // Ya cortado: ni espera. Y un rechazo tardío queda atendido (si no, el proceso caería por un rechazo sin manejar).
    const c = aMano<string>();
    assert.equal(await tk.hasta(c.promise), CORTADO);
    c.rechazar(new Error('x'));
    await tic();
    // Un rechazo mientras espera pasa a quien espera.
    const t2 = new TurnoMesa().empezar();
    const d = aMano<string>();
    const r = t2.hasta(d.promise);
    d.rechazar(new Error('sin red'));
    await assert.rejects(r, /sin red/);
    assert.equal(t2.enCamino, false);
  });

  it('cortar después de que la espera terminó no llama a nada viejo', async () => {
    const mesa = new TurnoMesa();
    const tk = mesa.empezar();
    const a = aMano<number>();
    const p = tk.hasta(a.promise);
    a.resolver(1);
    assert.equal(await p, 1);
    let abortos = 0;
    tk.ponerCorte(() => abortos++);
    tk.ponerCorte(null); // el stream terminó
    mesa.cancelar('oido');
    assert.equal(abortos, 0);
  });
});

describe('con las reglas de la frase nueva (G2), como las usa la mesa', () => {
  const decidir = (mesa: TurnoMesa, cmd: string, hablando = false) => fraseDuranteTurno({ cmd, pendiente: null, pensando: mesa.pensando(), hablando, efecto: mesa.efecto() });

  it('el turno con FOTO (JSON) se corta como cualquiera: una frase nueva lo suelta al instante', async () => {
    const mesa = new TurnoMesa();
    const tk = mesa.empezar();
    const json = aMano<{ reply: string }>();
    const espera = tk.hasta(json.promise); // askBrain: out = await tk.hasta(turno(base, genTurno))
    const d = decidir(mesa, '¿Qué tenemos pendiente hoy?');
    assert.equal(d.cortar, true, 'antes: pensando=false con foto y no se cortaba');
    mesa.cancelar('frase_nueva');
    const t0 = Date.now();
    assert.equal(await espera, CORTADO);
    assert.ok(Date.now() - t0 < 100, 'sin esperar al servidor (antes hasta 35 s)');
    json.resolver({ reply: 'lo que veo es…' }); // llega tarde: nadie lo dice
    // La frase nueva va en el turno siguiente, limpio.
    const sig = mesa.empezar();
    assert.equal(sig.vigente, true);
  });

  it('el relleno («¿me oyes?», «ajá») no corta; con una herramienta con efectos en curso, nada corta', async () => {
    const mesa = new TurnoMesa();
    const tk = mesa.empezar();
    let abortos = 0;
    tk.ponerCorte(() => abortos++);
    assert.deepEqual(decidir(mesa, '¿Me oyes?'), { cortar: false, pendiente: '', descartada: true });
    assert.equal(decidir(mesa, 'ajá').cortar, false);
    // Progreso: empezó un envío (la mesa marca el efecto con el evento `empece` de una herramienta que no es web/leer).
    tk.marcarEfecto();
    assert.equal(mesa.efecto(), true);
    assert.deepEqual(decidir(mesa, '¿Qué tenemos pendiente hoy?'), { cortar: false, pendiente: '¿Qué tenemos pendiente hoy?' });
    assert.equal(abortos, 0);
    // El efecto es de ESE turno: el siguiente empieza sin él.
    mesa.terminar(tk);
    const sig = mesa.empezar();
    assert.equal(mesa.efecto(), false);
    assert.equal(sig.efecto, false);
  });

  it('ya hablando, una frase nueva no corta (se junta y va después); sin nada en camino tampoco', () => {
    const mesa = new TurnoMesa();
    const tk = mesa.empezar();
    tk.ponerCorte(() => undefined);
    assert.equal(decidir(mesa, '¿Qué tenemos pendiente hoy?', true).cortar, false);
    tk.ponerCorte(null);
    assert.equal(mesa.pensando(), false);
    assert.equal(decidir(mesa, '¿Qué tenemos pendiente hoy?').cortar, false);
  });
});
