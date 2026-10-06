/**
 * EL TURNO ESPECULATIVO EN EL TELÉFONO (mobile/src/lib/turnoEspeculativo.ts). El oído avisa que la idea parece cerrada
 * (onEspeculativa) y la mesa empieza el turno ya; cuando la frase final llega, la mesa lo TOMA si es la misma frase con el
 * mismo contexto (quién habla, hilo, modo) y le pide al servidor que lo confirme. Lo que llegó mientras tanto se entrega
 * en orden a quien lo toma. Si no es la misma, se corta (el servidor no hace nada) y la mesa pide el turno de siempre.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TurnoEspeculativo, mismaFrase } from '../mobile/src/lib/turnoEspeculativo';

type H = { onEmocion?: (e: any) => void; onDelta: (p: string) => void; onReplace?: (t: string) => void; onTools?: (t: string[]) => void };

function banco(o: { ahora?: () => number; confirma?: boolean } = {}) {
  const pedidos: { opts: any; h: H; abortado: boolean; resolver: (r: any) => void }[] = [];
  const confirmados: string[] = [];
  const cancelados: string[] = [];
  const esp = new TurnoEspeculativo({
    arrancar: (opts, h) => {
      let resolver!: (r: any) => void;
      const promise = new Promise<any>((r) => (resolver = r));
      const p = { opts, h, abortado: false, resolver };
      pedidos.push(p);
      return { promise, abort: () => (p.abortado = true) };
    },
    confirmar: async (idTurno) => {
      confirmados.push(idTurno);
      return o.confirma !== false;
    },
    cancelar: (idTurno) => cancelados.push(idTurno),
    ahora: o.ahora,
  });
  return { esp, pedidos, confirmados, cancelados };
}

const base = (message: string, extra: Record<string, unknown> = {}) => ({ message, mode: 'GUARDIAN' as any, userName: 'José', correo: 'j@x.org', historial: [{ rol: 'usuario' as const, texto: message }], hablado: true, ...extra });

describe('turno especulativo (teléfono)', () => {
  it('la misma frase: se toma, lo que llegó antes se entrega en orden y se confirma con SU idTurno', async () => {
    const b = banco();
    assert.ok(b.esp.empezar(base('¿Qué opinas de la lluvia?'), 'id-esp'));
    assert.equal(b.pedidos.length, 1);
    assert.equal(b.pedidos[0].opts.especulativo, true, 'el servidor sabe que es especulativo');
    assert.equal(b.pedidos[0].opts.idTurno, 'id-esp');
    b.pedidos[0].h.onEmocion?.('feliz');
    b.pedidos[0].h.onDelta('Me encanta ');
    const visto: string[] = [];
    const st = b.esp.tomar(base('¿Qué opinas de la lluvia?'), { onEmocion: (e) => visto.push(`emo:${e}`), onDelta: (p) => visto.push(p), onTools: (t) => visto.push(`tools:${t}`) });
    assert.ok(st, 'se toma');
    assert.equal(st!.idTurno, 'id-esp');
    assert.deepEqual(visto, ['emo:feliz', 'Me encanta '], 'lo de antes, en orden');
    b.pedidos[0].h.onDelta('la lluvia.');
    assert.deepEqual(visto, ['emo:feliz', 'Me encanta ', 'la lluvia.'], 'y lo que sigue, directo');
    await Promise.resolve();
    assert.deepEqual(b.confirmados, ['id-esp']);
    b.pedidos[0].resolver({ reply: 'Me encanta la lluvia.', emocion: 'feliz', cierre: 'done' });
    assert.equal((await st!.promise).reply, 'Me encanta la lluvia.');
    assert.equal(b.esp.activo(), false);
  });

  it('otra frase, otro hablante o el hilo cambió: no se toma y se corta (el servidor no hace nada)', () => {
    for (const [final, extra] of [
      ['¿Qué opinas de la lluvia de ayer?', {}],
      ['¿Qué opinas de la lluvia?', { quienHabla: { id: 'ana' } }],
      ['¿Qué opinas de la lluvia?', { historial: [{ rol: 'ultron', texto: 'x' }, { rol: 'usuario', texto: '¿Qué opinas de la lluvia?' }] }],
      ['¿Qué opinas de la lluvia?', { image: 'data:image/jpeg;base64,xx' }],
      ['¿Qué opinas de la lluvia?', { mode: 'GOLD' }],
    ] as const) {
      const b = banco();
      b.esp.empezar(base('¿Qué opinas de la lluvia?'), 'id-1');
      assert.equal(b.esp.tomar(base(final, extra as any), { onDelta: () => {} }), null, `${final} ${JSON.stringify(extra)}`);
      assert.equal(b.pedidos[0].abortado, true);
      assert.deepEqual(b.cancelados, ['id-1']);
    }
  });

  it('mismaFrase: igual sin mayúsculas, tildes ni puntuación; nada más', () => {
    assert.ok(mismaFrase('¿Qué opinas de la lluvia?', 'que opinas de la lluvia'));
    assert.ok(!mismaFrase('¿Qué opinas de la lluvia?', '¿Qué opinas de la lluvia de ayer?'));
    assert.ok(!mismaFrase('Llámame.', 'Llámame en diez minutos.'));
  });

  it('cancelar (siguió hablando) corta el pedido; uno nuevo reemplaza al anterior', () => {
    const b = banco();
    b.esp.empezar(base('Hoy fui al centro.'), 'a');
    b.esp.cancelar();
    assert.equal(b.pedidos[0].abortado, true);
    assert.equal(b.esp.activo(), false);
    b.esp.empezar(base('Hoy fui al centro.'), 'b');
    b.esp.empezar(base('Hoy fui al centro y compré pan.'), 'c');
    assert.equal(b.pedidos[1].abortado, true, 'el anterior se corta');
    assert.equal(b.pedidos[2].abortado, false);
  });

  it('vencido (nadie lo tomó a tiempo) no se toma', () => {
    let t = 0;
    const b = banco({ ahora: () => t });
    b.esp.empezar(base('¿Y tú?'), 'v');
    t += 10_000;
    assert.equal(b.esp.tomar(base('¿Y tú?'), { onDelta: () => {} }), null);
    assert.equal(b.pedidos[0].abortado, true);
  });

  it('el pedido especulativo ya falló: no se toma (la mesa pide el de siempre)', async () => {
    const b = banco();
    b.esp.empezar(base('¿Y tú?'), 'f');
    b.pedidos[0].resolver({ reply: '', emocion: 'neutral', error: 'x', cierre: 'error' });
    await new Promise((r) => setTimeout(r, 1));
    assert.equal(b.esp.tomar(base('¿Y tú?'), { onDelta: () => {} }), null);
  });

  it('la traza dice «esp N»: el turno ya corría como especulativo desde hacía N ms (la respuesta, no el relleno)', async () => {
    const { TrazaTurno } = await import('../mobile/src/lib/trazaTurno');
    const t = new TrazaTurno();
    t.empezar(1000);
    t.dato('espMs', 180);
    t.marcar('texto', 1100);
    assert.match(t.linea(1500) || '', /^mesa: contestó con voz 500 ms después de la frase · txt 100 esp 180$/);
  });

  it('el servidor no confirma: se corta (el turno de siempre lo recupera por su idTurno)', async () => {
    const b = banco({ confirma: false });
    b.esp.empezar(base('¿Y tú?'), 'n');
    const st = b.esp.tomar(base('¿Y tú?'), { onDelta: () => {} });
    assert.ok(st);
    await new Promise((r) => setTimeout(r, 1));
    assert.equal(b.pedidos[0].abortado, true);
  });
});
