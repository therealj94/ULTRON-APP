// El visor de la computadora MONTADO (auditoría 8+, P3/A3 «Componente montado»): app/VisorComputadora.tsx corre de
// verdad (estado, efectos, sondeos, re-render) contra un /api/computadora falso con un nodo que anota cada entrada que
// aplica y cuya imagen «de después» tarda 50/500/1500 ms. La prueba escribe por los manejadores REALES del componente
// (el campo: onChangeText / onSubmitEditing; los botones: onPress) y mira lo que llega al nodo y lo que enseña el campo.
//
//   · `café ☕` + Enter y el pegado `uno\ndos`: llegan una sola vez, en orden, sin perder nada; el Enter sale solo con
//     la imagen de después (la guarda de frame fresco se cumple esperando, no se quita); el campo no se vacía antes.
//   · Un rechazo pausa el lote y lo que falta se recupera: «Seguir», «Editar» y «Descartar» existen y hacen lo suyo.
//   · Cortarse la red, irse la app atrás o perder el control a mitad pausa; al volver NADA sale solo.
//   · Un ACK perdido queda incierto: no se repite hasta que la persona dice si llegó.
//   · Cerrar la vista no para la tarea (ningún /parar) ni suelta el control; lo que faltaba espera al reabrir.
//
//   node construir.cjs && node lote.cjs
//   VISOR=/ruta/otro-paquete.cjs node lote.cjs     (el mismo arnés contra otro código: ver construir.cjs)
const assert = require('node:assert/strict');

// El paquete se carga ANTES del reloj falso: React (scheduler) y el renderizador guardan los temporizadores de verdad.
const M = require(process.env.VISOR || './out/visor.cjs');
const { VisorComputadora, VISOR, MONTAR } = M;
const { React, montar, buscar, textoDe } = MONTAR;
const inmediato = setImmediate;

/* ── reloj falso (lo que usa el componente: setTimeout, setInterval y Date.now) ── */
let ahora = 1_760_000_000_000;
let timers = [];
let tid = 0;
globalThis.setTimeout = (fn, ms = 0, ...args) => {
  const id = ++tid;
  timers.push({ id, at: ahora + Math.max(0, Number(ms) || 0), fn: () => fn(...args) });
  return id;
};
globalThis.clearTimeout = (id) => {
  timers = timers.filter((t) => t.id !== id);
};
globalThis.setInterval = (fn, ms = 0, ...args) => {
  const id = ++tid;
  timers.push({ id, at: ahora + Math.max(1, Number(ms) || 0), cada: Math.max(1, Number(ms) || 0), fn: () => fn(...args) });
  return id;
};
globalThis.clearInterval = globalThis.clearTimeout;
Date.now = () => ahora;

/** Deja correr promesas y renders pendientes (React agenda con setImmediate en node). */
async function vaciar() {
  for (let i = 0; i < 30; i++) await new Promise((r) => inmediato(r));
}
async function avanzar(ms) {
  const fin = ahora + ms;
  await vaciar();
  for (;;) {
    timers.sort((a, b) => a.at - b.at || a.id - b.id);
    const t = timers[0];
    if (!t || t.at > fin) break;
    ahora = t.at;
    if (t.cada) t.at += t.cada;
    else timers.shift();
    t.fn();
    await vaciar();
  }
  ahora = fin;
  await vaciar();
}
/** Avanza de 10 en 10 ms hasta que `cond` se cumpla (o se acabe el plazo); `cadaPaso` mira invariantes en el camino. */
async function hasta(cond, maxMs, cadaPaso) {
  for (let t = 0; t <= maxMs; t += 10) {
    cadaPaso?.();
    if (cond()) return true;
    await avanzar(10);
  }
  return false;
}

/* ── el servidor y el nodo falsos ── */
const BASE = 'https://aura.prueba';
const CAPACIDADES = ['pausar', 'confirmar', 'control', 'entrada', 'seguro'];

/**
 * /api/computadora de mentira. El nodo captura una pantalla nueva en cada petición, salvo durante `demora` ms tras
 * aplicar una entrada: entonces devuelve la de antes (la misma `seq` que dio en el ACK). Así la imagen de DESPUÉS de
 * cada entrada llega `demora` ms tarde, como un escritorio que tarda en repintar.
 */
function servidor({ demora }) {
  const s = {
    demora,
    enLinea: true,
    latencia: 20,
    estado: 'trabajando',
    epoca: 0,
    seq: 100,
    frameTs: ahora,
    retenerHasta: 0,
    ultimaSecuencia: 0,
    aplicadas: [], // lo que el nodo aplicó: { type, payload, inputSequence, epoca, t }
    peticiones: [], // { metodo, ruta, cuerpo, t }
    rechazar: null, // (entrada) => true: el nodo no la aplica (409)
    perderAck: null, // (entrada) => true: la aplica y la respuesta no vuelve
    trasAplicar: null, // (entrada) => void
  };
  s.tecleado = () => s.aplicadas.filter((e) => e.type === 'text_commit' || e.type === 'key').map((e) => (e.type === 'key' ? (e.payload.mods?.length ? e.payload.mods.join('+') + '+' : '') + (e.payload.tecla === 'enter' ? '⏎' : e.payload.tecla) : e.payload.texto));
  s.tecleadoCon = () => s.aplicadas.filter((e) => e.type === 'text_commit' || e.type === 'key');
  s.pedidas = (metodo, fin) => s.peticiones.filter((p) => p.metodo === metodo && p.ruta.split('?')[0].endsWith(fin));

  s.atender = (metodo, ruta, cuerpo) => {
    const [camino] = ruta.split('?');
    if (metodo === 'GET' && camino === '/api/computadora') return { status: 200, data: { conectada: true, capacidades: CAPACIDADES } };
    const m = /^\/api\/computadora\/tareas\/([^/]+)(?:\/(\w+))?$/.exec(camino);
    if (!m) return { status: 404, data: { error: 'no existe' } };
    const [, id, que] = m;
    if (!que && metodo === 'GET')
      return { status: 200, data: { tarea: { id, instruccion: 'Escribir en el editor', estado: s.estado, pasos: [], respuesta: null, error: null, segundos: 12, epoca: s.epoca, seguro: false } } };
    if (que === 'pantalla') {
      if (ahora >= s.retenerHasta) {
        s.seq += 1;
        s.frameTs = ahora;
      }
      return { status: 200, data: { imagen: 'AAAA', frame: { seq: s.seq, ts: s.frameTs, ancho: 1280, alto: 800, viewportRevision: 0, epoca: s.epoca, privado: false, edadMs: ahora - s.frameTs } } };
    }
    if (que === 'control' && metodo === 'POST') {
      if (cuerpo?.tomar) {
        s.estado = 'control';
        s.epoca += 1;
        s.ultimaSecuencia = 0;
        return { status: 200, data: { ok: true, epoca: s.epoca, fase: 'listo' } };
      }
      s.estado = 'trabajando';
      return { status: 200, data: { ok: true } };
    }
    if (que === 'entrada' && metodo === 'POST') {
      const e = cuerpo;
      if (s.estado !== 'control' || e.controlEpoch !== s.epoca) return { status: 409, data: { code: 'epoca_revocada', error: 'Otro dispositivo tiene el control.' } };
      if (!(e.inputSequence > s.ultimaSecuencia)) return { status: 409, data: { code: 'secuencia', error: 'Secuencia repetida.' } };
      if (s.rechazar?.(e)) {
        s.rechazar = null;
        return { status: 409, data: { code: 'rechazada', error: 'El nodo no aplicó la entrada.' } };
      }
      s.ultimaSecuencia = e.inputSequence;
      s.aplicadas.push({ type: e.type, payload: e.payload, inputSequence: e.inputSequence, epoca: e.controlEpoch, t: ahora });
      const ack = { secuencia: e.inputSequence, estado: 'aplicada', ts: ahora, frame_seq: s.seq, epoca: s.epoca };
      if (e.type !== 'release_all') s.retenerHasta = ahora + s.demora;
      s.trasAplicar?.(e);
      if (s.perderAck?.(e)) {
        s.perderAck = null;
        return { status: 200, data: { ack }, perdida: true };
      }
      return { status: 200, data: { ack } };
    }
    if (que === 'parar' && metodo === 'POST') {
      s.estado = 'parada';
      return { status: 200, data: { ok: true } };
    }
    if (metodo === 'POST') return { status: 200, data: { ok: true } };
    return { status: 404, data: { error: 'no existe' } };
  };

  s.fetch = (url, init = {}) =>
    new Promise((resolve, reject) => {
      const ruta = String(url).replace(BASE, '');
      const metodo = init.method || 'GET';
      const cuerpo = init.body ? JSON.parse(init.body) : null;
      s.peticiones.push({ metodo, ruta, cuerpo, t: ahora });
      init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
      const red = () => reject(new TypeError('Network request failed'));
      // Ida (media latencia): sin red no llega. Vuelta (la otra media): si se cortó entre medias, lo hecho no se sabe.
      setTimeout(() => {
        if (!s.enLinea) return red();
        let r;
        try {
          r = s.atender(metodo, ruta, cuerpo);
        } catch (e) {
          r = { status: 500, data: { error: String(e) } };
        }
        setTimeout(() => {
          if (r.perdida || !s.enLinea) return red();
          resolve({ ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.data });
        }, s.latencia / 2);
      }, s.latencia / 2);
    });
  return s;
}

/* ── montar y tocar ── */
let nTarea = 0;
const rn = globalThis.__rnVisor;

async function abrir(s, tareaId) {
  globalThis.fetch = s.fetch;
  rn.estado = 'active';
  rn.alertas.length = 0;
  VISOR.abrirVisor(tareaId);
  const m = montar(React.createElement(VisorComputadora, {}));
  m.s = s;
  await avanzar(300);
  return m;
}
async function nuevo(demora) {
  VISOR.olvidarVisor?.();
  const s = servidor({ demora });
  const m = await abrir(s, `t${++nTarea}`);
  m.tareaId = `t${nTarea}`;
  await pulsar(m, 'Tomar el control');
  assert.ok(await hasta(() => !!campo(m), 3000), 'con el control aparece el campo para escribir');
  await avanzar(1000); // la primera imagen de esta época
  return m;
}
const texto = (m) => textoDe(m.raiz);
const campo = (m) => buscar(m.raiz, (n) => n.type === 'TextInput')[0] || null;
const boton = (m, lector) => buscar(m.raiz, (n) => n.type === 'Pressable' && n.props.accessibilityLabel === lector)[0] || null;
async function pulsar(m, lector) {
  const b = boton(m, lector);
  assert.ok(b, `existe el botón «${lector}»`);
  assert.equal(typeof b.props.onPress, 'function', `el botón «${lector}» está habilitado`);
  b.props.onPress();
  await vaciar();
}
async function escribir(m, t) {
  const c = campo(m);
  assert.ok(c, 'hay campo');
  c.props.onChangeText(t);
  await vaciar();
  assert.equal(campo(m).props.value, t, 'el campo enseña lo escrito');
}
async function enter(m) {
  campo(m).props.onSubmitEditing({ nativeEvent: { text: campo(m).props.value } });
  await vaciar();
}
const SEGUIR = 'Seguir mandando lo que falta';
const EDITAR = 'Devolver lo que falta al campo para editarlo';
const DESCARTAR = 'Descartar lo que falta';
const SI_LLEGO = 'Sí llegó: no lo repitas';
const VOLVER = 'Volver al chat (la tarea sigue)';
const libre = (m) => !/Escribiendo…/.test(texto(m));
/** Nada sale solo: el nodo no recibe ni una tecla más en `ms`. */
async function nadaSaleSolo(m, ms, por) {
  const antes = m.s.tecleado().join('|');
  await avanzar(ms);
  assert.equal(m.s.tecleado().join('|'), antes, `nada sale solo ${por}`);
}
/**
 * Manda lo que hay en el campo y espera a que el nodo tenga `esperado` (todo lo tecleado hasta ahí). Mientras no llegó
 * TODO, el campo sigue enseñando el texto y no se edita (no se vacía antes de saber cómo le fue).
 */
async function mandarYEsperar(m, mandar, textoCampo, esperado, plazo = 15000) {
  await mandar();
  // Lo que enseñó el campo mientras faltaba algo por llegar (se mira en cada paso; se reporta después de lo que llegó).
  const malCampo = new Set();
  const ok = await hasta(
    () => m.s.tecleado().length >= esperado.length && campo(m)?.props.value === '' && libre(m),
    plazo,
    () => {
      const c = campo(m);
      if (m.s.tecleado().length < esperado.length && c) {
        if (c.props.value !== textoCampo) malCampo.add(`valor ${JSON.stringify(c.props.value)} con ${JSON.stringify(m.s.tecleado())} en el nodo`);
        if (c.props.editable !== false) malCampo.add(`editable mientras sale (con ${JSON.stringify(m.s.tecleado())} en el nodo)`);
      }
    }
  );
  assert.deepEqual(m.s.tecleado(), esperado, 'llega todo, una sola vez y en orden');
  assert.deepEqual([...malCampo], [], 'el campo no se vacía ni se edita antes de la confirmación');
  assert.ok(ok, 'al confirmarse todo, el campo queda vacío');
}

/* ── las pruebas ── */
let fallos = 0;
const pruebas = [];
const prueba = (nombre, f) => pruebas.push([nombre, f]);

for (const demora of [50, 500, 1500]) {
  prueba(`montado: «café ☕»+Enter y el pegado «uno\\ndos» con la imagen de después a ${demora} ms: una vez, en orden, nada perdido`, async () => {
    const m = await nuevo(demora);
    const s = m.s;
    await escribir(m, 'café ☕');
    await mandarYEsperar(m, () => enter(m), 'café ☕', ['café ☕', '⏎']);
    // El pegado de dos líneas por el campo y el botón de mandar (sin Enter final).
    await escribir(m, 'uno\ndos');
    await mandarYEsperar(m, () => pulsar(m, 'Mandar el texto (sin Enter)'), 'uno\ndos', ['café ☕', '⏎', 'uno', '⏎', 'dos']);
    // Cada Enter (y, dentro del mismo lote, lo que sigue a un Enter) salió con la imagen de DESPUÉS de lo anterior: la
    // guarda de frame fresco no se saltó. (El primer evento de un lote nuevo es texto: no es riesgoso.)
    const ev = s.tecleadoCon();
    for (let i = 1; i < ev.length; i++) {
      const mismoLote = i !== 2; // lote 1: «café ☕», ⏎ · lote 2: «uno», ⏎, «dos»
      if (ev[i].type === 'key' || (mismoLote && ev[i - 1].type === 'key')) assert.ok(ev[i].t - ev[i - 1].t >= demora, `el evento ${i} esperó la imagen de después (${ev[i].t - ev[i - 1].t} ms ≥ ${demora} ms)`);
    }
    const seqs = ev.map((e) => e.inputSequence);
    assert.equal(new Set(seqs).size, seqs.length, 'ninguna secuencia repetida');
    await nadaSaleSolo(m, 8000, 'después de confirmar (nada se repite)');
    assert.deepEqual(m.errores, [], 'sin errores de React');
    m.desmontar();
  });
}

async function rechazado() {
  const m = await nuevo(500);
  m.s.rechazar = (e) => e.type === 'key';
  await escribir(m, 'uno\ndos');
  await pulsar(m, 'Mandar el texto (sin Enter)');
  assert.ok(await hasta(() => !!boton(m, SEGUIR), 15000), 'el rechazo pausa el lote y ofrece «Seguir»');
  assert.deepEqual(m.s.tecleado(), ['uno'], 'lo de antes del rechazo llegó; nada después');
  assert.match(texto(m), /No se aplicó: lo que falta quedó guardado/);
  assert.equal(campo(m).props.value, '\ndos', 'el campo enseña lo que falta (el Enter rechazado y «dos»)');
  assert.equal(campo(m).props.editable, false, 'en pausa, el campo sigue quieto hasta seguir o editar');
  assert.ok(boton(m, EDITAR) && boton(m, DESCARTAR), 'están «Editar» y «Descartar»');
  await nadaSaleSolo(m, 8000, 'tras un rechazo');
  return m;
}

prueba('montado: un rechazo pausa y «Seguir» manda lo que falta, una vez', async () => {
  const m = await rechazado();
  await pulsar(m, SEGUIR);
  assert.ok(await hasta(() => m.s.tecleado().length === 3 && campo(m).props.value === '' && libre(m), 15000), 'sigue y termina');
  assert.deepEqual(m.s.tecleado(), ['uno', '⏎', 'dos']);
  assert.ok(!boton(m, SEGUIR), 'sin pausa al terminar');
  m.desmontar();
});

prueba('montado: un rechazo pausa y «Editar» devuelve lo que falta al campo, editable; se puede mandar después', async () => {
  const m = await rechazado();
  await pulsar(m, EDITAR);
  assert.equal(campo(m).props.value, '\ndos', 'lo que falta, en el campo');
  assert.notEqual(campo(m).props.editable, false, 'y se puede editar');
  assert.ok(!boton(m, SEGUIR), 'el lote ya no está en pausa');
  await nadaSaleSolo(m, 5000, 'al editar');
  await mandarYEsperar(m, () => pulsar(m, 'Mandar el texto (sin Enter)'), '\ndos', ['uno', '⏎', 'dos']);
  m.desmontar();
});

prueba('montado: un rechazo pausa y «Descartar» tira lo que falta (y nada sale)', async () => {
  const m = await rechazado();
  await pulsar(m, DESCARTAR);
  assert.equal(campo(m).props.value, '', 'campo vacío');
  assert.notEqual(campo(m).props.editable, false, 'y editable');
  assert.ok(!boton(m, SEGUIR) && !boton(m, DESCARTAR), 'sin pausa');
  await nadaSaleSolo(m, 8000, 'tras descartar');
  assert.deepEqual(m.s.tecleado(), ['uno']);
  m.desmontar();
});

prueba('montado: se corta la red a mitad del lote → pausa; al volver la red NADA sale solo; «Seguir» completa una vez', async () => {
  const m = await nuevo(1500);
  m.s.trasAplicar = (e) => {
    if (e.type === 'text_commit' && e.payload.texto === 'uno') m.s.enLinea = false; // justo tras aplicar «uno» (su ACK se pierde)
  };
  await escribir(m, 'uno\ndos');
  await pulsar(m, 'Mandar el texto (sin Enter)');
  assert.ok(await hasta(() => !!boton(m, SEGUIR) || !!boton(m, SI_LLEGO), 15000), 'el lote se pausa al cortarse');
  assert.deepEqual(m.s.tecleado(), ['uno']);
  assert.equal(campo(m).props.value, '\ndos', 'lo que falta sigue a la vista');
  m.s.trasAplicar = null;
  m.s.enLinea = true;
  await nadaSaleSolo(m, 12000, 'al volver la red');
  // «uno» salió y su ACK no volvió: incierto. La persona mira y dice que sí llegó; luego sigue.
  if (boton(m, SI_LLEGO)) await pulsar(m, SI_LLEGO);
  await nadaSaleSolo(m, 3000, 'tras decir que llegó');
  await pulsar(m, SEGUIR);
  assert.ok(await hasta(() => m.s.tecleado().length === 3 && campo(m).props.value === '' && libre(m), 15000), 'completa');
  assert.deepEqual(m.s.tecleado(), ['uno', '⏎', 'dos'], '«uno» no se repitió');
  m.desmontar();
});

prueba('montado: la red se cae mientras espera la imagen del Enter → pausa «desconectado»; nada sale solo al volver', async () => {
  const m = await nuevo(1500);
  await escribir(m, 'uno\ndos');
  await pulsar(m, 'Mandar el texto (sin Enter)');
  assert.ok(await hasta(() => m.s.tecleado().length === 1, 3000), '«uno» llegó');
  await avanzar(100); // su ACK volvió; el Enter espera la imagen de después
  m.s.enLinea = false;
  assert.ok(await hasta(() => !!boton(m, SEGUIR), 15000), 'pausa');
  assert.match(texto(m), /Se cortó la conexión/);
  assert.equal(campo(m).props.value, '\ndos');
  m.s.enLinea = true;
  await nadaSaleSolo(m, 12000, 'al volver la red');
  assert.ok(boton(m, SEGUIR), 'sigue en pausa hasta que la persona lo diga');
  await pulsar(m, SEGUIR);
  assert.ok(await hasta(() => m.s.tecleado().length === 3 && libre(m), 15000));
  assert.deepEqual(m.s.tecleado(), ['uno', '⏎', 'dos']);
  m.desmontar();
});

prueba('montado: la app se va atrás a mitad del lote → pausa; al volver al frente nada sale solo', async () => {
  const m = await nuevo(1500);
  await escribir(m, 'uno\ndos');
  await pulsar(m, 'Mandar el texto (sin Enter)');
  assert.ok(await hasta(() => m.s.tecleado().length === 1, 3000));
  await avanzar(100);
  rn.estado = 'background';
  for (const f of [...rn.oyentesApp]) f('background');
  assert.ok(await hasta(() => !!boton(m, SEGUIR), 5000), 'pausa al irse atrás');
  rn.estado = 'active';
  for (const f of [...rn.oyentesApp]) f('active');
  await nadaSaleSolo(m, 10000, 'al volver al frente');
  assert.deepEqual(m.s.tecleado(), ['uno']);
  m.desmontar();
});

prueba('montado: otro dispositivo toma el control a mitad → pausa sin mandar; nada sale solo', async () => {
  const m = await nuevo(1500);
  m.s.trasAplicar = (e) => {
    if (e.type === 'text_commit' && e.payload.texto === 'uno') m.s.epoca += 1; // el control pasa a otra época
  };
  await escribir(m, 'uno\ndos');
  await pulsar(m, 'Mandar el texto (sin Enter)');
  await avanzar(10000);
  assert.deepEqual(m.s.tecleado(), ['uno'], 'ni el Enter ni «dos» salen con el control de otro');
  assert.ok(!campo(m), 'sin el control, el teclado se va');
  assert.ok(boton(m, 'Recuperar el control en este teléfono') || boton(m, 'Tomar el control'), 'ofrece recuperar el control');
  await nadaSaleSolo(m, 8000, 'tras perder el control');
  m.desmontar();
});

prueba('montado: un ACK perdido queda incierto; no se repite hasta que la persona dice si llegó', async () => {
  const m = await nuevo(500);
  m.s.perderAck = (e) => e.type === 'key';
  await escribir(m, 'uno\ndos');
  await pulsar(m, 'Mandar el texto (sin Enter)');
  assert.ok(await hasta(() => !!boton(m, SI_LLEGO), 15000), 'pregunta si llegó');
  assert.match(texto(m), /No sé si llegó ⏎/);
  assert.deepEqual(m.s.tecleado(), ['uno', '⏎'], 'el Enter llegó al nodo (su respuesta no)');
  await nadaSaleSolo(m, 10000, 'con algo incierto');
  await pulsar(m, SI_LLEGO);
  await pulsar(m, SEGUIR);
  assert.ok(await hasta(() => m.s.tecleado().length === 3 && campo(m).props.value === '' && libre(m), 15000));
  assert.deepEqual(m.s.tecleado(), ['uno', '⏎', 'dos'], 'el Enter, una sola vez');
  m.desmontar();
});

prueba('montado: cerrar la vista a mitad no para la tarea ni suelta el control; lo que faltaba espera al reabrir', async () => {
  const m = await nuevo(1500);
  await escribir(m, 'uno\ndos');
  await pulsar(m, 'Mandar el texto (sin Enter)');
  assert.ok(await hasta(() => m.s.tecleado().length === 1, 3000));
  await avanzar(100);
  await pulsar(m, VOLVER);
  assert.equal(VISOR.visorAhora().abierto, false, 'la vista se cerró');
  assert.ok(!campo(m), 'nada del visor queda montado');
  await nadaSaleSolo(m, 10000, 'con la vista cerrada');
  assert.deepEqual(m.s.tecleado(), ['uno']);
  assert.equal(m.s.pedidas('POST', '/parar').length, 0, 'cerrar no llama a /parar');
  assert.equal(m.s.pedidas('POST', '/control').filter((p) => p.cuerpo?.tomar === false).length, 0, 'cerrar no devuelve el control');
  assert.equal(m.s.estado, 'control', 'la tarea sigue con el control en tus manos');
  VISOR.abrirVisor(m.tareaId);
  assert.ok(await hasta(() => !!boton(m, SEGUIR), 5000), 'al reabrir, lo que faltaba espera con «Seguir»');
  assert.match(texto(m), /Lo que faltaba quedó guardado/);
  assert.equal(campo(m).props.value, '\ndos');
  await pulsar(m, SEGUIR);
  assert.ok(await hasta(() => m.s.tecleado().length === 3 && libre(m), 15000));
  assert.deepEqual(m.s.tecleado(), ['uno', '⏎', 'dos']);
  assert.equal(m.s.pedidas('POST', '/parar').length, 0, 'en ningún momento se paró la tarea');
  m.desmontar();
});

(async () => {
  for (const [nombre, f] of pruebas) {
    try {
      await f();
      console.log(`PASA   ${nombre}`);
    } catch (e) {
      fallos++;
      console.log(`FALLA  ${nombre}\n       → ${String(e?.message || e).split('\n').slice(0, 6).join('\n         ')}`);
    }
    timers = [];
  }
  console.log(`\n${pruebas.length - fallos}/${pruebas.length} pasan`);
  process.exit(fallos ? 1 : 0);
})();
