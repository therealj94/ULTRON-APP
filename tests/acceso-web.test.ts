/**
 * LA PUERTA, VISTA DESDE EL NAVEGADOR.
 *
 * Dos fallos que esta prueba fija, los dos de la misma familia: contarle a la persona algo que no
 * pasó.
 *
 *  · **F08.** `puertaAbierta` devolvía un booleano y convertía cualquier fallo de red en `false`.
 *    Ese `false` se le enseñaba como «esa llave no abre» o «tu cuenta no tiene acceso». O sea que
 *    un wifi de hotel, un túnel o un servidor redesplegando se le contaban como un problema de
 *    permisos — y la reacción natural, pedirle otra llave a José, no arreglaba nada.
 *
 *  · **F09.** Al guardar la llave, el `sessionStorage` de reserva estaba dentro del `catch` del
 *    primero y sin proteger. Cuando los dos almacenes fallaban —ventana privada con almacenamiento
 *    bloqueado— la excepción salía disparada y dejaba el formulario en «Probando…» para siempre.
 *
 * El módulo es de navegador, así que aquí se le pone uno de mentira: `localStorage`,
 * `sessionStorage` y `fetch` se pueden romper a voluntad, que es justo lo que no se puede hacer
 * esperando a que falle de verdad.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

/** Un almacén que se puede averiar. */
function almacen(roto = false) {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => {
      if (roto) throw new Error('acceso denegado al almacenamiento');
      return m.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (roto) throw new Error('acceso denegado al almacenamiento');
      m.set(k, v);
    },
    removeItem: (k: string) => {
      if (roto) throw new Error('acceso denegado al almacenamiento');
      m.delete(k);
    },
    _m: m,
  };
}

/** Monta el navegador de mentira y devuelve el módulo recién cargado, sin caché entre pruebas. */
async function cargar(opts: { local?: boolean; sesion?: boolean; responder: () => Promise<Response> }) {
  const g = globalThis as any;
  g.localStorage = almacen(opts.local === false);
  g.sessionStorage = almacen(opts.sesion === false);
  g.window = { location: { href: 'http://x/electrum.html' }, history: { replaceState() {} } };
  g.fetch = opts.responder;
  // `?${Math.random()}` fuerza una instancia limpia: el módulo tiene estado (la memoria de reserva).
  return (await import(`../src-electrum/acceso.ts?${Math.random()}`)) as typeof import('../src-electrum/acceso');
}

const ok = () => Promise.resolve(new Response('{}', { status: 200 }));
const cierra = (codigo: number) => () => Promise.resolve(new Response('{}', { status: codigo }));
const revienta = () => Promise.reject(new TypeError('Failed to fetch'));

test('F08 · la puerta dice QUÉ pasó, no solo que no abre', async (t) => {
  await t.test('abre', async () => {
    const a = await cargar({ responder: ok });
    assert.deepEqual(await a.puertaAbierta(), { estado: 'abierta' });
  });

  await t.test('401 y 403 sí son falta de permiso', async () => {
    for (const c of [401, 403]) {
      const a = await cargar({ responder: cierra(c) });
      assert.equal((await a.puertaAbierta()).estado, 'sin-permiso');
    }
  });

  await t.test('un 503 es la plataforma, no la credencial', async () => {
    const a = await cargar({ responder: cierra(503) });
    const p = await a.puertaAbierta();
    assert.equal(p.estado, 'servicio-caido');
    // Lo que importa de verdad: lo que se le dice a la persona.
    const dicho = a.porQueNoAbre(p, 'llave');
    assert.match(dicho, /no es tu credencial/i);
    assert.ok(!/no abre|no tiene acceso/i.test(dicho), 'no se le puede echar la culpa a la llave');
  });

  await t.test('sin red no se acusa a la cuenta', async () => {
    const a = await cargar({ responder: revienta });
    const p = await a.puertaAbierta();
    assert.equal(p.estado, 'sin-red');
    const dicho = a.porQueNoAbre(p, 'sesion');
    assert.match(dicho, /conexi[oó]n/i);
    assert.ok(!/no tiene acceso|no abre/i.test(dicho), 'la credencial no tuvo nada que ver');
  });

  await t.test('tardar demasiado tampoco es no tener permiso', async () => {
    // Lo que produce el corte de doce segundos es un AbortError. Se emula ése en vez de esperarlos.
    const a = await cargar({
      responder: () => {
        const e = new Error('The operation was aborted');
        e.name = 'AbortError';
        return Promise.reject(e);
      },
    });
    const p = await a.puertaAbierta();
    assert.equal(p.estado, 'lento');
    const dicho = a.porQueNoAbre(p, 'llave');
    assert.match(dicho, /tard/i);
    assert.ok(!/no abre/i.test(dicho), 'la llave puede ser perfecta y el servidor estar dormido');
  });
});

test('F09 · con el almacenamiento bloqueado se entra igual', async (t) => {
  await t.test('guardar no lanza aunque fallen los dos almacenes', async () => {
    const a = await cargar({ local: false, sesion: false, responder: ok });
    // Antes esto tiraba una excepción que dejaba el formulario colgado en «Probando…».
    assert.doesNotThrow(() => a.guardarLlave('llave-demo'));
    assert.equal(a.guardarLlave('llave-demo'), 'memoria');
  });

  await t.test('y la credencial VALE para esta carga de página', async () => {
    const a = await cargar({ local: false, sesion: false, responder: ok });
    a.guardarLlave('llave-demo');
    assert.ok(a.hayCredencial(), 'sin esto, entrar en ventana privada era imposible');
    assert.equal(a.headersElectrum()['x-electrum-llave'], 'llave-demo');
  });

  await t.test('se puede saber que no va a sobrevivir a un F5, para decirlo', async () => {
    const roto = await cargar({ local: false, sesion: false, responder: ok });
    assert.equal(roto.almacenamientoFragil(), true);
    const sano = await cargar({ responder: ok });
    assert.equal(sano.almacenamientoFragil(), false);
  });

  await t.test('si solo falla localStorage, cae a la pestaña y no a la memoria', async () => {
    const a = await cargar({ local: false, responder: ok });
    assert.equal(a.guardarSesion('tok'), 'sesion');
    assert.equal(a.headersElectrum()['x-ultron-sesion'], 'tok');
  });

  await t.test('con todo sano, va al disco', async () => {
    const a = await cargar({ responder: ok });
    assert.equal(a.guardarSesion('tok'), 'local');
  });
});
