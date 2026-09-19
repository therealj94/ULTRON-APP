import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extraerPedidoHerramienta, quitarLineaPedido, resolverPedido, INSTRUCCION_HARNESS } from '../lib/harness';
import { construirMensajes } from '../lib/qwen';

describe('Harness agentic', () => {
  it('parsea PEDIR_HERRAMIENTA al final', () => {
    const t = 'No tengo el dato.\nPEDIR_HERRAMIENTA: web precio del oro';
    const p = extraerPedidoHerramienta(t);
    assert.equal(p?.herramienta, 'web');
    assert.equal(p?.arg, 'precio del oro');
    assert.equal(quitarLineaPedido(t).includes('PEDIR_HERRAMIENTA'), false);
    assert.ok(quitarLineaPedido(t).includes('No tengo el dato'));
  });

  it('no inventa pedido si no hay línea', () => {
    assert.equal(extraerPedidoHerramienta('El oro está en los HECHOS.'), null);
  });

  it('resolverPedido no llama runners con consulta vacía', async () => {
    let web = 0;
    const r = await resolverPedido(
      { herramienta: 'web', arg: '  ' },
      {
        web: async () => {
          web++;
          return 'no';
        },
        sistema: async () => 'no',
        leer: async () => 'no',
        ejecutor: async () => 'no',
      }
    );
    assert.equal(web, 0);
    assert.match(r, /consulta vacía/);
  });

  it('inyecta harness en Telegram y código, no en saludo de mesa', () => {
    const tg = construirMensajes({ personalidad: 'p', user: 'busca noticias de cobre', canal: 'telegram' });
    assert.equal(tg.meta.harness, true);
    assert.ok(tg.messages[0].content.includes(INSTRUCCION_HARNESS.slice(0, 30)));

    const code = construirMensajes({ personalidad: 'p', user: 'escribe una función en python' });
    assert.equal(code.meta.harness, true);

    const mesa = construirMensajes({ personalidad: 'p', user: 'buenas tardes jefe' });
    assert.equal(mesa.meta.harness, false);
    assert.ok(!mesa.messages[0].content.includes('PEDIR_HERRAMIENTA: web'));

    const mesaDato = construirMensajes({ personalidad: 'p', user: 'qué es el proyecto Jarvis' });
    assert.equal(mesaDato.meta.harness, true);
  });
});
