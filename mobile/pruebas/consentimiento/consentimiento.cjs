// La hoja «Por confirmar» MONTADA (tanda F1, A-7): caras/HojaConsentimiento.tsx corre de verdad (estado, efectos,
// re-render) contra un /api/caras y /api/voces falsos. La prueba toca por los manejadores REALES del componente (onPress
// de las filas y de los botones) y mira lo que llega al servidor y lo que enseña la hoja.
//
//   · Al abrir la mesa, un posible menor por confirmar trae UN aviso suave (con su parentesco); «Ahora no» lo cierra y al
//     volver a abrir la mesa no sale otra vez; alguien nuevo por confirmar sí lo trae (solo esa persona).
//   · «Más → Caras»: la lista con la insignia «Por confirmar» solo en quien la espera; tocarla abre su hoja (a quién se
//     guardó, quién la presentó, cuándo, «Puede ser menor de edad»); «Sí, guardar» → POST /api/caras/:id/confirmar y la
//     insignia se va; useCaras se entera (para releer con los vectores).
//   · «Más → Voces»: «Borrar» → DELETE /api/voces/:id y sale de la lista. Un error del servidor se dice y la hoja sigue.
//   · Sin la hoja montada, «Más» usa su aviso de siempre (abrirHojaBio → false).
//   · El teléfono no compara con quien espera la confirmación (caras.ts identificar).
//
//   node construir.cjs && node consentimiento.cjs
const assert = require('node:assert/strict');

const M = require(process.env.CONSENTIMIENTO || './out/consentimiento.cjs');
const { ConsentimientoBiometria, PC, CARAS, MONTAR } = M;
const { React, montar, buscar, textoDe } = MONTAR;

let pasan = 0;
let fallos = 0;
async function prueba(nombre, f) {
  try {
    await f();
    pasan++;
    console.log(`  ok  ${nombre}`);
  } catch (e) {
    fallos++;
    console.log(`  MAL ${nombre}\n      ${String(e?.stack || e?.message || e).split('\n').slice(0, 6).join('\n      ')}`);
  }
}

/** Deja correr promesas y renders pendientes (React agenda con setImmediate en node). */
async function vaciar() {
  for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r));
}

/* ── el servidor falso ── */
const T = Date.UTC(2026, 9, 8, 21, 5);
const servidor = {
  caras: [],
  voces: [],
  pedidos: [],
  fallarConfirmar: false,
};
function reiniciarServidor() {
  servidor.caras = [
    { id: 'c-jose', nombre: 'José', relacion: 'yo', vectores: [[0.1]], creado: T - 9e7 },
    { id: 'c-ana', nombre: 'Ana', relacion: 'conocido', parentesco: 'esposa', vectores: [[0.2]], creado: T - 8e7 },
    { id: 'c-nora', nombre: 'Nora', relacion: 'conocido', parentesco: 'hija', vectores: [], creado: T, porConfirmar: true, menor: true, presentadoPor: 'José', presentadoEn: T },
  ];
  servidor.voces = [{ id: 'v-leo', nombre: 'Leo', relacion: 'conocido', parentesco: 'nieto', muestras: 3, creado: T, porConfirmar: true, menor: true, presentadoPor: 'José', presentadoEn: T }];
  servidor.pedidos = [];
  servidor.fallarConfirmar = false;
}
const resp = (cuerpo, status = 200) => ({ ok: status < 400, status, json: async () => cuerpo });
globalThis.fetch = async (url, init = {}) => {
  const ruta = String(url).replace('https://aura.prueba', '');
  const metodo = init.method || 'GET';
  servidor.pedidos.push(`${metodo} ${ruta}`);
  if (metodo === 'GET' && ruta === '/api/caras') return resp({ personas: servidor.caras, honesto: true });
  if (metodo === 'GET' && ruta === '/api/voces') return resp({ personas: servidor.voces, motor: 'listo', honesto: true });
  let m = /^\/api\/(caras|voces)\/([^/]+)\/confirmar$/.exec(ruta);
  if (metodo === 'POST' && m) {
    if (servidor.fallarConfirmar) return resp({ error: 'No pude guardar el cambio de forma segura; intenta otra vez en un momento.', honesto: true }, 503);
    const lista = servidor[m[1]];
    const p = lista.find((x) => x.id === decodeURIComponent(m[2]));
    if (!p) return resp({ error: 'No conozco esa cara.' }, 404);
    delete p.porConfirmar;
    delete p.menor;
    return resp({ ok: true, honesto: true });
  }
  m = /^\/api\/(caras|voces)\/([^/]+)$/.exec(ruta);
  if (metodo === 'DELETE' && m) {
    const lista = servidor[m[1]];
    const i = lista.findIndex((x) => x.id === decodeURIComponent(m[2]));
    if (i < 0) return resp({ error: 'No conozco esa voz.' }, 404);
    const [p] = lista.splice(i, 1);
    return resp({ ok: true, nombre: p.nombre, honesto: true });
  }
  return resp({ error: 'no' }, 404);
};

/* ── lo que se ve ── */
const hoja = (raiz) => buscar(raiz, (n) => n.type === 'Hoja')[0] || null;
const boton = (raiz, titulo) => buscar(raiz, (n) => n.type === 'Boton' && n.props.titulo === titulo)[0] || null;
const filas = (raiz) => buscar(raiz, (n) => n.type === 'Pressable');
const fila = (raiz, nombre) => filas(raiz).find((n) => String(n.props.accessibilityLabel || '').startsWith(nombre)) || null;
const tocar = async (nodo) => {
  assert.ok(nodo, 'el mando existe');
  assert.equal(typeof nodo.props.onPress, 'function', 'el mando se puede tocar');
  nodo.props.onPress();
  await vaciar();
};
const CORREO = 'jose@prueba.local';
const almacen = () => globalThis.__as.m;

(async () => {
  console.log('La hoja «Por confirmar» (caras y voces)\n');

  await prueba('sin la hoja montada, «Más» usa su aviso de siempre', async () => {
    assert.equal(PC.abrirHojaBio({ tipo: 'cara', titulo: 'x' }), false);
  });

  await prueba('lo puro: filas (primero lo que espera), insignia, detalle y lo que dice AURA al guardar a un posible menor', async () => {
    const fs = PC.filasBio('cara', [
      { id: 'b', nombre: 'Bea', relacion: 'conocido' },
      { id: 'n', nombre: 'Nora', relacion: 'conocido', parentesco: 'hija', porConfirmar: true, menor: true, presentadoPor: 'José', presentadoEn: T },
      { id: 'y', nombre: 'José', relacion: 'yo' },
      { id: '', nombre: 'sin id', relacion: 'conocido' },
    ]);
    assert.deepEqual(
      fs.map((f) => f.nombre),
      ['Nora', 'José', 'Bea']
    );
    assert.equal(PC.insignia(fs[0]), 'Por confirmar');
    assert.equal(PC.insignia(fs[2]), '');
    const d = PC.detalleConfirmar(fs[0]);
    assert.equal(d.titulo, '¿Guardo a Nora?');
    assert.equal(d.lineas[0], 'Guardé la cara de Nora (tu hija).');
    assert.equal(d.lineas[1], 'La presentó José.');
    assert.match(d.lineas[2], /^Cuándo: \d{1,2} oct, \d{1,2}:\d\d [ap]\. m\.$/);
    assert.equal(d.lineas[3], 'Puede ser menor de edad.');
    const dicho = PC.fraseGuardadoPorConfirmar('Nora', 'cara', 'José');
    assert.match(dicho, /no te reconozco hasta que José lo confirme en su pantalla/);
    assert.doesNotMatch(dicho, /ya te recuerdo|ya te reconozco/i, 'no promete lo que todavía no hace');
  });

  await prueba('el teléfono no compara con quien espera la confirmación (identificar / distanciaMasCercana)', async () => {
    const v = Array.from({ length: 128 }, (_, i) => Math.round(Math.sin(i) * 0.3 * 1e4) / 1e4);
    const nora = { id: 'n', nombre: 'Nora', relacion: 'conocido', vectores: [v], porConfirmar: true };
    assert.equal(CARAS.identificar(v, [nora]), null, 'por confirmar: no se reconoce aunque los vectores estén');
    assert.equal(CARAS.distanciaMasCercana(v, [nora]), Infinity);
    assert.equal(CARAS.identificar(v, [{ ...nora, porConfirmar: false }])?.nombre, 'Nora', 'confirmada, sí');
  });

  reiniciarServidor();
  let m = montar(React.createElement(ConsentimientoBiometria, { correo: CORREO }));
  await vaciar();

  await prueba('al abrir la mesa: un aviso suave, con quién espera y por qué', async () => {
    const h = hoja(m.raiz);
    assert.ok(h, 'el aviso está a la vista');
    assert.equal(h.props.titulo, 'Algo por confirmar');
    assert.equal(h.props.subtitulo, 'Guardé a Nora (tu hija) y Leo (tu nieto). Como pueden ser menores de edad, no las reconozco ni digo su nombre hasta que tú lo confirmes aquí, en tu pantalla.');
    assert.ok(boton(m.raiz, 'Revisar') && boton(m.raiz, 'Ahora no'));
    assert.ok(almacen().has(PC.CLAVE_AVISADOS), 'queda anotado que ya se avisó');
  });

  await prueba('«Ahora no» lo cierra; al volver a abrir la mesa no sale otra vez', async () => {
    await tocar(boton(m.raiz, 'Ahora no'));
    assert.equal(hoja(m.raiz)?.props.titulo, undefined);
    m.desmontar();
    await vaciar();
    m = montar(React.createElement(ConsentimientoBiometria, { correo: CORREO }));
    await vaciar();
    assert.equal(hoja(m.raiz)?.props.titulo, undefined, 'una sola vez');
    assert.equal(m.errores.length, 0, String(m.errores[0] || ''));
  });

  await prueba('«Más → Caras»: la insignia «Por confirmar» solo en quien la espera', async () => {
    const cambios = [];
    const dejar = PC.escucharCambiosBio((t) => cambios.push(t));
    let olvido = 0;
    assert.equal(
      PC.abrirHojaBio({ tipo: 'cara', titulo: 'Reconocer caras · activado', texto: 'Di «conóceme»…', mandos: [{ titulo: 'Olvidar todas', peligro: true, alTocar: () => olvido++ }] }),
      true,
      'la hoja de la mesa escucha'
    );
    await vaciar();
    const h = hoja(m.raiz);
    assert.equal(h?.props.titulo, 'Reconocer caras · activado');
    assert.deepEqual(
      filas(m.raiz).map((f) => f.props.accessibilityLabel),
      ['Nora, tu hija · no la reconozco hasta que confirmes, Por confirmar', 'José, Tú', 'Ana, tu esposa']
    );
    const insignias = buscar(m.raiz, (n) => n.type === 'Text' && textoDe(n) === 'Por confirmar');
    assert.equal(insignias.length, 1, 'una insignia: la de Nora');
    assert.equal(fila(m.raiz, 'Ana').props.onPress, undefined, 'a quien no espera nada no se le abre la hoja de confirmar');

    // Tocar a Nora: su hoja de confirmar.
    await tocar(fila(m.raiz, 'Nora'));
    const c = hoja(m.raiz);
    assert.equal(c.props.titulo, '¿Guardo a Nora?');
    const dice = textoDe(c);
    for (const t of ['Guardé la cara de Nora (tu hija).', 'La presentó José.', 'Cuándo: ', 'Puede ser menor de edad.', 'no uso esta cara para reconocer a nadie ni digo su nombre']) assert.ok(dice.includes(t), `dice «${t}»`);
    assert.ok(boton(m.raiz, 'Sí, guardar') && boton(m.raiz, 'Borrar'));

    // «Sí, guardar»: al servidor, y la insignia se va.
    await tocar(boton(m.raiz, 'Sí, guardar'));
    assert.ok(servidor.pedidos.includes('POST /api/caras/c-nora/confirmar'), servidor.pedidos.join(' | '));
    assert.equal(hoja(m.raiz)?.props.titulo, 'Reconocer caras · activado', 'vuelve a la lista');
    assert.equal(buscar(m.raiz, (n) => n.type === 'Text' && textoDe(n) === 'Por confirmar').length, 0, 'sin insignia');
    assert.deepEqual(cambios, ['cara'], 'useCaras se entera para releer (con los vectores)');

    // Los mandos de siempre siguen.
    await tocar(boton(m.raiz, 'Olvidar todas'));
    assert.equal(olvido, 1);
    assert.equal(hoja(m.raiz)?.props.titulo, undefined);
    dejar();
  });

  await prueba('«Más → Voces»: un error se dice y la hoja sigue; «Borrar» la quita de verdad', async () => {
    PC.abrirHojaBio({ tipo: 'voz', titulo: 'Reconocer voces · activado' });
    await vaciar();
    await tocar(fila(m.raiz, 'Leo'));
    assert.equal(hoja(m.raiz)?.props.titulo, '¿Guardo a Leo?');
    assert.ok(textoDe(hoja(m.raiz)).includes('Guardé la voz de Leo (tu nieto).'));
    servidor.fallarConfirmar = true;
    await tocar(boton(m.raiz, 'Sí, guardar'));
    assert.equal(hoja(m.raiz)?.props.titulo, '¿Guardo a Leo?', 'sigue en su hoja');
    assert.ok(textoDe(hoja(m.raiz)).includes('No pude guardar el cambio de forma segura'), 'y dice por qué');
    assert.equal(servidor.voces[0].porConfirmar, true, 'nada cambió en el servidor');
    servidor.fallarConfirmar = false;
    await tocar(boton(m.raiz, 'Borrar'));
    assert.ok(servidor.pedidos.includes('DELETE /api/voces/v-leo'), servidor.pedidos.join(' | '));
    assert.equal(servidor.voces.length, 0);
    assert.equal(hoja(m.raiz)?.props.titulo, 'Reconocer voces · activado');
    assert.equal(fila(m.raiz, 'Leo')?.props.accessibilityLabel, undefined, 'ya no está en la lista');
    await tocar({ props: { onPress: hoja(m.raiz).props.onCerrar } });
    assert.equal(hoja(m.raiz)?.props.titulo, undefined);
  });

  await prueba('alguien nuevo por confirmar: al abrir la mesa otra vez, el aviso solo de esa persona; «Revisar» lleva a su hoja', async () => {
    servidor.caras.push({ id: 'c-mia', nombre: 'Mía', relacion: 'conocido', parentesco: 'sobrina', vectores: [], creado: T, porConfirmar: true, menor: true, presentadoPor: 'José', presentadoEn: T });
    m.desmontar();
    await vaciar();
    m = montar(React.createElement(ConsentimientoBiometria, { correo: CORREO }));
    await vaciar();
    assert.equal(hoja(m.raiz)?.props.subtitulo, 'Guardé a Mía (tu sobrina). Como puede ser menor de edad, no la reconozco ni digo su nombre hasta que tú lo confirmes aquí, en tu pantalla.');
    await tocar(boton(m.raiz, 'Revisar'));
    assert.equal(hoja(m.raiz)?.props.titulo, '¿Guardo a Mía?');
    await tocar(boton(m.raiz, 'Sí, guardar'));
    assert.ok(servidor.pedidos.includes('POST /api/caras/c-mia/confirmar'));
    assert.equal(hoja(m.raiz)?.props.titulo, undefined, 'sin nada más por confirmar, se cierra');
    // Otra cuenta en el mismo teléfono: lo avisado de José no cuenta para ella.
    assert.equal(PC.porAvisar([{ tipo: 'cara', id: 'c-x', nombre: 'X', relacion: 'conocido', porConfirmar: true, menor: true }], JSON.parse(almacen().get(PC.CLAVE_AVISADOS)), 'otra@prueba.local').length, 1);
    assert.equal(m.errores.length, 0, String(m.errores[0] || ''));
  });

  m.desmontar();
  console.log(`\n${pasan} bien, ${fallos} mal`);
  process.exit(fallos ? 1 : 0);
})();
