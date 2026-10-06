/**
 * LO OPCIONAL DEL TURNO HABLADO TIENE UN SOLO PLAZO (server/enriquecer-voz.ts; auditoría VOZ-04). Antes cada paso que
 * espera a la base o a la red (memoria, hilo, lo limitado, tarea en curso, iniciativa, fichas…) tenía SU tope de 300 ms
 * y se esperaban uno detrás de otro: cuatro sin resolver consumían 1,2 s antes de la primera palabra. Ahora el plazo es
 * uno, desde que empieza el turno: cada paso espera solo lo que queda. Lo que ya llegó se usa aunque el plazo se haya
 * acabado; lo que no, se deja (sigue en segundo plano y el turno siguiente lo encuentra hecho).
 *
 * Con un reloj falso (nada de esperas de verdad).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TOPE_ENRIQUECER_VOZ_MS, plazoDeEnriquecer } from '../server/enriquecer-voz';
import { TOPE_PASO_VOZ_MS } from '../server/enriquecer-voz';

/** Un reloj falso con su propia fila de temporizadores. */
function relojFalso() {
  let ahora = 0;
  let fila: { en: number; f: () => void; id: number }[] = [];
  let sig = 1;
  return {
    ahora: () => ahora,
    setTimeout: (f: () => void, ms: number) => {
      const t = { en: ahora + ms, f, id: sig++ };
      fila.push(t);
      return t.id as any;
    },
    clearTimeout: (id: any) => {
      fila = fila.filter((t) => t.id !== id);
    },
    async avanzar(ms: number) {
      const hasta = ahora + ms;
      for (;;) {
        fila.sort((a, b) => a.en - b.en);
        const t = fila[0];
        if (!t || t.en > hasta) break;
        fila.shift();
        ahora = t.en;
        t.f();
        for (let i = 0; i < 100; i++) await Promise.resolve();
      }
      ahora = hasta;
      for (let i = 0; i < 100; i++) await Promise.resolve();
    },
  };
}
const nunca = <T>() => new Promise<T>(() => {});

describe('enriquecer el turno hablado: un plazo común', () => {
  it('cuatro pasos opcionales sin resolver, en serie, cuestan UN plazo (no 4 × 300 ms)', async () => {
    const r = relojFalso();
    const plazo = plazoDeEnriquecer(true, { reloj: r });
    let fin = -1;
    void (async () => {
      await plazo.aTiempo('memoria', nunca(), undefined);
      await plazo.aTiempo('hilo', nunca(), undefined);
      await plazo.aTiempo('lo limitado', nunca(), undefined);
      await plazo.aTiempo('iniciativa', nunca(), '');
      fin = r.ahora();
    })();
    await r.avanzar(2_000);
    assert.equal(fin, TOPE_ENRIQUECER_VOZ_MS, `terminó a los ${fin} ms`);
    assert.ok(fin < 4 * TOPE_PASO_VOZ_MS, 'antes: 1,2 s');
    assert.deepEqual(plazo.vencidos(), ['memoria', 'hilo', 'lo limitado', 'iniciativa']);
  });

  it('lo que ya llegó se usa aunque el plazo se haya acabado; lo que no, se deja con su respaldo al instante', async () => {
    const r = relojFalso();
    const plazo = plazoDeEnriquecer(true, { reloj: r });
    const listo = Promise.resolve('perfil');
    await r.avanzar(TOPE_ENRIQUECER_VOZ_MS + 50);
    const t0 = r.ahora();
    assert.equal(await plazo.aTiempo('perfil', listo, null), 'perfil');
    assert.equal(await plazo.aTiempo('fichas', nunca<string[]>(), [] as string[]).then((x) => x.length), 0);
    assert.equal(r.ahora(), t0, 'sin plazo restante no se espera nada');
  });

  it('un paso que llega a tiempo da su valor; uno que falla da su respaldo (nunca rompe el turno)', async () => {
    const r = relojFalso();
    const plazo = plazoDeEnriquecer(true, { reloj: r });
    const tarde = new Promise<string>((ok) => r.setTimeout(() => ok('tarea'), 100));
    const p = plazo.aTiempo('tarea en curso', tarde, '');
    await r.avanzar(150);
    assert.equal(await p, 'tarea');
    assert.equal(await plazo.aTiempo('memoria', Promise.reject(new Error('S3')), 'respaldo'), 'respaldo');
  });

  it('`sinEspera` (la iniciativa en una charla simple): solo si ya estaba lista', async () => {
    const r = relojFalso();
    const plazo = plazoDeEnriquecer(true, { reloj: r });
    assert.equal(await plazo.aTiempo('iniciativa', Promise.resolve('MISIONES'), '', { sinEspera: true }), 'MISIONES');
    const t0 = r.ahora();
    const tarde = new Promise<string>((ok) => r.setTimeout(() => ok('MISIONES'), 10));
    assert.equal(await plazo.aTiempo('iniciativa', tarde, '', { sinEspera: true }), '');
    assert.equal(r.ahora(), t0);
  });

  it('escrito (no hablado): se espera lo que haga falta, con sus errores (la mesa escrita puede esperar)', async () => {
    const r = relojFalso();
    const plazo = plazoDeEnriquecer(false, { reloj: r });
    const tarde = new Promise<string>((ok) => r.setTimeout(() => ok('memoria'), 5_000));
    const p = plazo.aTiempo('memoria', tarde, 'respaldo');
    await r.avanzar(6_000);
    assert.equal(await p, 'memoria');
    await assert.rejects(plazo.aTiempo('x', Promise.reject(new Error('falla')), 'r'), /falla/);
  });

  it('server.ts: lo opcional del turno usa el plazo común, y la memoria y la del miembro arrancan juntas', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
    const prep = src.slice(src.indexOf('async function prepararTurno('), src.indexOf('const delCerebro = hechoCerebro('));
    for (const paso of ['perfil', 'memoria', 'memoria del miembro', 'hilo', 'lo limitado']) assert.match(prep, new RegExp(`enriquecer\\.aTiempo\\('${paso}'`), paso);
    assert.doesNotMatch(prep, /aTiempoParaVoz\(voz, '(memoria|hilo|lo limitado|perfil)'/, 'ya no cada uno con su tope');
    // Las dos memorias se piden antes de esperar ninguna.
    const iMem = prep.indexOf('const memoriaPedida =');
    const iMiembro = prep.indexOf('const miembroPedido =');
    const iEspera = prep.indexOf("enriquecer.aTiempo('memoria'");
    assert.ok(iMem > 0 && iMiembro > 0 && iMem < iEspera && iMiembro < iEspera);
  });
});
