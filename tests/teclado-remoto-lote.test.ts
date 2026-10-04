/**
 * EL TECLADO REMOTO COMO UNA SECUENCIA (auditoría del 4-oct, A3 / paquete P3).
 *
 * Antes, «Enviar» del visor (VisorComputadora.tsx, confirmarTexto) vaciaba el campo y mandaba los eventos uno tras otro
 * sin esperar la imagen de después: `café ☕` + Enter mandaba el texto y el Enter se rechazaba (`tras_entrada`); pegar
 * `uno\ndos` mandaba los dos textos sin el Enter de en medio, y lo no aplicado se perdía con el campo vacío.
 *
 * Aquí, con la lógica real (mobile/src/lib/entradaRemota.ts: BufferTeclado, SesionRemota, LoteTeclado y la secuencia
 * extraída del visor, confirmarEscritura / seguirEscritura / resolverEscritura / recuperarEscritura) y un nodo
 * simulado cuya imagen llega con retraso (50, 500 y 1500 ms):
 *  · el contenido y el orden se conservan y cada evento llega UNA vez;
 *  · un rechazo pausa y conserva lo no aplicado, que se puede seguir o recuperar al campo;
 *  · desconexión o cambio de control a mitad: se pausa, nada sigue solo y el Enter no se repite;
 *  · un ACK perdido queda incierto: no se repite hasta que la persona diga si llegó;
 *  · IME, acentos (NFC), emoji y banderas enteros;
 *  · la guarda de frame fresco sigue ahí (control negativo: el Enter directo, sin imagen nueva, se rechaza).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BufferTeclado,
  LoteTeclado,
  SesionRemota,
  avisoDeLote,
  confirmarEscritura,
  descartarEscritura,
  recuperarEscritura,
  resolverEscritura,
  seguirEscritura,
  type EntradaRemota,
  type FrameMeta,
} from '../mobile/src/lib/entradaRemota';

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const meta = (seq: number, epoca = 1): FrameMeta => ({ seq, ts: Date.now(), ancho: 1280, alto: 800, viewportRevision: 0, epoca, privado: false, edadMs: 0 });
const enter = { type: 'key', payload: { tecla: 'enter', mods: [] } };
const texto = (t: string) => ({ type: 'text_commit', payload: { texto: t } });

type Falla = { antes?: unknown; despues?: unknown } | null;

/**
 * Un visor con su sesión y su lote contra un nodo simulado. El nodo anota lo que APLICA (lo que de verdad pasó en el
 * escritorio); la imagen de después llega `demoraMs` después de pedirla, como la captura del visor.
 */
function montaje(o: { demoraMs: number; plazoImagenMs?: number; fallar?: (e: EntradaRemota) => Falla; retener?: (e: EntradaRemota) => Promise<void> | null }) {
  let seqImagen = 10;
  const nodo: { type: string; payload: any; epoca: number; seq: number }[] = [];
  const enviadas: EntradaRemota[] = [];
  let parar = false;
  const sesion = new SesionRemota({
    tareaId: 'tarea-sintetica-1',
    clientId: 'visor-prueba01',
    enviar: async (e) => {
      enviadas.push(e);
      await o.retener?.(e);
      const f = o.fallar?.(e) ?? null;
      if (f?.antes) throw f.antes;
      nodo.push({ type: e.type, payload: e.payload, epoca: e.controlEpoch, seq: e.inputSequence });
      if (f?.despues) throw f.despues;
      return { secuencia: e.inputSequence, estado: 'aplicada', ts: Date.now(), frame_seq: seqImagen, epoca: e.controlEpoch };
    },
  });
  const imagen = () => {
    if (!parar) sesion.alFrame(meta(++seqImagen, sesion.epoca ?? 1), Date.now());
  };
  const pedidas: number[] = [];
  const lote = new LoteTeclado({
    sesion,
    plazoImagenMs: o.plazoImagenMs ?? 5000,
    pedirImagen: () => {
      pedidas.push(Date.now());
      setTimeout(imagen, o.demoraMs);
    },
  });
  sesion.alControl(1);
  sesion.alFrame(meta(seqImagen), Date.now());
  const buffer = new BufferTeclado();
  return {
    sesion,
    lote,
    buffer,
    nodo,
    enviadas,
    pedidas,
    imagen,
    sinImagenes: () => (parar = true),
    conImagenes: () => (parar = false),
    deTeclado: () => nodo.filter((n) => n.type !== 'release_all').map((n) => ({ type: n.type, payload: n.payload })),
  };
}

async function hasta(cond: () => boolean, ms = 4000) {
  const fin = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > fin) throw new Error('no llegó a tiempo');
    await dormir(5);
  }
}

for (const demoraMs of [50, 500, 1500]) {
  test(`A3: «café ☕» + Enter con la imagen a ${demoraMs} ms: texto y Enter llegan, en orden, una sola vez`, async () => {
    const m = montaje({ demoraMs });
    m.buffer.cambiar('café ☕', []);
    const r = await confirmarEscritura(m.buffer, m.lote, true);
    assert.deepEqual(r, { ok: true, aplicados: 2 });
    assert.deepEqual(m.deTeclado(), [texto('café ☕'), enter]);
    assert.equal(m.enviadas.length, 2, 'ni un envío de más (nada se rechazó ni se repitió)');
    assert.deepEqual(
      m.nodo.map((n) => n.seq),
      [1, 2],
      'secuencias consecutivas'
    );
    assert.equal(m.buffer.texto, '', 'todo llegó: ahora sí se vacía el campo');
    assert.equal(m.buffer.enviando, null);
    assert.equal(m.lote.abierto(), false);
  });

  test(`A3: pegar «uno\\ndos» con la imagen a ${demoraMs} ms: uno, Enter, dos — en orden y una vez`, async () => {
    const m = montaje({ demoraMs });
    m.buffer.cambiar('uno\ndos', []);
    const r = await confirmarEscritura(m.buffer, m.lote, false);
    assert.deepEqual(r, { ok: true, aplicados: 3 });
    assert.deepEqual(m.deTeclado(), [texto('uno'), enter, texto('dos')]);
    assert.equal(m.enviadas.length, 3);
    assert.equal(m.buffer.texto, '');
  });
}

test('control negativo: la guarda de frame fresco sigue — un Enter directo tras el texto, sin imagen nueva, se rechaza y no sale', async () => {
  const m = montaje({ demoraMs: 50 });
  assert.equal((await m.sesion.entrada('text_commit', { texto: 'café ☕' })).ok, true);
  assert.deepEqual(await m.sesion.entrada('key', { tecla: 'enter', mods: [] }), { ok: false, motivo: 'tras_entrada' });
  assert.deepEqual(m.deTeclado(), [texto('café ☕')]);
  m.imagen();
  assert.equal((await m.sesion.entrada('key', { tecla: 'enter', mods: [] })).ok, true, 'con la imagen de después, sí');
});

test('el campo no se vacía antes de saber cómo le fue: confirmar deja el texto como «enviando» y no saca otro lote', () => {
  const b = new BufferTeclado();
  b.cambiar('café ☕', []);
  assert.deepEqual(b.confirmar(true), [texto('café ☕'), enter]);
  assert.equal(b.texto, 'café ☕', 'sigue ahí mientras va');
  assert.equal(b.enviando, 'café ☕');
  assert.deepEqual(b.confirmar(true), [], 'con uno en camino no sale otro');
  b.aplicado();
  assert.equal(b.texto, '');
  assert.equal(b.enviando, null);
});

test('rechazo: el Enter rechazado y lo de después quedan guardados; «Seguir» los manda una vez y en orden', async () => {
  let rechazar = true;
  const m = montaje({
    demoraMs: 50,
    fallar: (e) => (e.type === 'key' && rechazar ? ((rechazar = false), { antes: Object.assign(new Error('La pantalla cambió.'), { status: 409, data: { code: 'viewport' } }) }) : null),
  });
  m.buffer.cambiar('uno\ndos', []);
  const r = await confirmarEscritura(m.buffer, m.lote, false);
  assert.equal(r.ok, false);
  assert.deepEqual(r, { ok: false, motivo: 'viewport', aplicados: 1, pendientes: 2, incierto: false });
  assert.deepEqual(m.deTeclado(), [texto('uno')], 'el nodo solo aplicó «uno»: «dos» NO salió sin su Enter');
  assert.deepEqual(m.lote.pendientes, [enter, texto('dos')], 'lo no aplicado se conserva');
  assert.equal(m.buffer.texto, '\ndos', 'el campo enseña lo que falta');
  assert.notEqual(m.buffer.enviando, null, 'y sigue quieto (no se pierde ni se edita a medias)');
  assert.ok(avisoDeLote(m.lote)?.[0].includes('Seguir'));
  const r2 = await seguirEscritura(m.buffer, m.lote);
  assert.deepEqual(r2, { ok: true, aplicados: 3 });
  assert.deepEqual(m.deTeclado(), [texto('uno'), enter, texto('dos')]);
  assert.equal(m.nodo.filter((n) => n.type === 'key').length, 1, 'un solo Enter');
  assert.equal(m.buffer.texto, '');
});

test('rechazo: lo no aplicado se puede recuperar al campo, editable, y volver a mandar', async () => {
  const m = montaje({
    demoraMs: 50,
    fallar: (e) => (e.type === 'key' ? { antes: Object.assign(new Error('No puedes escribir ahí.'), { status: 409, data: { code: 'entrada_invalida' } }) } : null),
  });
  m.buffer.cambiar('café ☕', []);
  const r = await confirmarEscritura(m.buffer, m.lote, true);
  assert.equal(r.ok, false);
  assert.deepEqual(m.deTeclado(), [texto('café ☕')]);
  assert.deepEqual(m.lote.pendientes, [enter]);
  assert.deepEqual(recuperarEscritura(m.buffer, m.lote), { texto: '', conEnter: true }, 'lo que faltaba era el Enter final');
  assert.equal(m.buffer.enviando, null, 'el campo vuelve a ser editable');
  assert.equal(m.lote.abierto(), false);
  // Con texto que no llegó, vuelve tal cual (acentos y emoji incluidos).
  const m2 = montaje({ demoraMs: 50, fallar: (e) => (e.type === 'text_commit' && e.payload.texto === 'dos 👨‍👩‍👧' ? { antes: Object.assign(new Error('no'), { status: 409, data: { code: 'viewport' } }) } : null) });
  m2.buffer.cambiar('uno\ndos 👨‍👩‍👧', []);
  await confirmarEscritura(m2.buffer, m2.lote, true);
  assert.deepEqual(m2.deTeclado(), [texto('uno'), enter]);
  assert.deepEqual(recuperarEscritura(m2.buffer, m2.lote), { texto: 'dos 👨‍👩‍👧', conEnter: true });
  assert.equal(m2.buffer.texto, 'dos 👨‍👩‍👧');
});

test('desconexión a mitad (esperando la imagen para el Enter): se pausa, nada sigue solo al volver y el Enter sale una vez', async () => {
  const m = montaje({ demoraMs: 500 });
  m.buffer.cambiar('café ☕', []);
  const p = confirmarEscritura(m.buffer, m.lote, true);
  await hasta(() => m.lote.estado() === 'esperando_imagen');
  m.sinImagenes();
  m.sesion.alDesconectar();
  const r = await p;
  assert.deepEqual(r, { ok: false, motivo: 'desconectado', aplicados: 1, pendientes: 1, incierto: false });
  assert.deepEqual(m.deTeclado(), [texto('café ☕')], 'el Enter no salió');
  // Vuelve la red: se sueltan teclas allá (release_all) y llegan imágenes; el lote NO sigue solo.
  m.conImagenes();
  await m.sesion.alReconectar();
  m.imagen();
  await dormir(700);
  m.imagen();
  assert.deepEqual(m.deTeclado(), [texto('café ☕')], 'sin reconciliar no se manda nada');
  assert.equal(m.nodo.filter((n) => n.type === 'release_all').length, 1);
  const r2 = await seguirEscritura(m.buffer, m.lote);
  assert.equal(r2.ok, true);
  assert.deepEqual(m.deTeclado(), [texto('café ☕'), enter]);
});

test('desconexión mientras un evento va en camino: su ACK llega, pero lo siguiente (el Enter) ya no sale solo', async () => {
  let soltar: () => void = () => {};
  const m = montaje({ demoraMs: 50, retener: (e) => (e.type === 'text_commit' && e.payload.texto === 'uno' ? new Promise<void>((r) => (soltar = r)) : null) });
  m.buffer.cambiar('uno\ndos', []);
  const p = confirmarEscritura(m.buffer, m.lote, false);
  await hasta(() => m.enviadas.length === 1);
  m.sesion.alDesconectar();
  soltar();
  const r = await p;
  assert.deepEqual(r, { ok: false, motivo: 'desconectado', aplicados: 1, pendientes: 2, incierto: false });
  m.imagen();
  await dormir(200);
  m.imagen();
  assert.deepEqual(m.deTeclado(), [texto('uno')], 'ni el Enter ni «dos» salieron solos');
  assert.equal((await seguirEscritura(m.buffer, m.lote)).ok, true);
  assert.deepEqual(m.deTeclado(), [texto('uno'), enter, texto('dos')]);
});

test('el control pasa a otro dispositivo a mitad: se pausa sin mandar; «Seguir» sin control no manda; con el control otra vez, el Enter sale una vez y con la época nueva', async () => {
  const m = montaje({ demoraMs: 500 });
  m.buffer.cambiar('uno\ndos', []);
  const p = confirmarEscritura(m.buffer, m.lote, false);
  await hasta(() => m.lote.estado() === 'esperando_imagen');
  m.sesion.sinControl();
  const r = await p;
  assert.deepEqual(r, { ok: false, motivo: 'sin_control', aplicados: 1, pendientes: 2, incierto: false });
  assert.deepEqual(m.deTeclado(), [texto('uno')]);
  const antes = m.enviadas.length;
  const r2 = await seguirEscritura(m.buffer, m.lote);
  assert.equal(r2.ok, false);
  assert.equal(m.enviadas.length, antes, 'sin control no sale nada');
  m.sesion.alControl(2);
  m.imagen();
  const r3 = await seguirEscritura(m.buffer, m.lote);
  assert.equal(r3.ok, true);
  assert.deepEqual(m.deTeclado(), [texto('uno'), enter, texto('dos')]);
  assert.deepEqual(
    m.nodo.filter((n) => n.type === 'key').map((n) => n.epoca),
    [2],
    'un solo Enter, de la época nueva'
  );
});

test('ACK perdido: el Enter queda INCIERTO; no se repite al seguir ni al volver la red hasta que la persona diga si llegó', async () => {
  let perder = true;
  const m = montaje({ demoraMs: 50, fallar: (e) => (e.type === 'key' && perder ? ((perder = false), { despues: Object.assign(new Error('sin red'), { status: undefined }) }) : null) });
  m.buffer.cambiar('café ☕', []);
  const r = await confirmarEscritura(m.buffer, m.lote, true);
  assert.deepEqual(r, { ok: false, motivo: 'desconectado', aplicados: 1, pendientes: 0, incierto: true });
  assert.equal(m.nodo.filter((n) => n.type === 'key').length, 1, 'el nodo sí lo aplicó (no se sabe aquí)');
  assert.deepEqual(m.lote.incierto, enter);
  assert.match(avisoDeLote(m.lote)![0], /No sé si llegó ⏎/);
  await m.sesion.alReconectar();
  m.imagen();
  const r2 = await seguirEscritura(m.buffer, m.lote);
  assert.deepEqual(r2, { ok: false, motivo: 'incierto', aplicados: 1, pendientes: 0, incierto: true });
  assert.equal(m.nodo.filter((n) => n.type === 'key').length, 1, '«Seguir» no repite lo incierto');
  // La persona mira la pantalla: sí llegó. Se cierra sin mandar nada más.
  resolverEscritura(m.buffer, m.lote, true);
  assert.equal(m.lote.abierto(), false);
  assert.equal(m.buffer.texto, '');
  assert.equal(m.nodo.filter((n) => n.type === 'key').length, 1, 'un solo Enter en total');
});

test('ACK perdido y la persona dice que NO llegó: entonces (y solo entonces) sale otra vez, una vez', async () => {
  let perder = true;
  const m = montaje({
    demoraMs: 50,
    // El servidor dice que el nodo no contestó (502 «incierta»): tampoco se sabe si se aplicó.
    fallar: (e) => (e.type === 'text_commit' && perder ? ((perder = false), { antes: Object.assign(new Error('No sé si llegó.'), { status: 502, data: { code: 'incierta' } }) }) : null),
  });
  m.buffer.cambiar('uno\ndos', []);
  const r = await confirmarEscritura(m.buffer, m.lote, false);
  assert.equal(r.ok, false);
  assert.equal(m.lote.incierto?.type, 'text_commit');
  assert.deepEqual(m.lote.pendientes, [enter, texto('dos')], 'lo de después espera detrás de lo incierto');
  assert.equal(m.deTeclado().length, 0);
  resolverEscritura(m.buffer, m.lote, false);
  m.imagen();
  const r2 = await seguirEscritura(m.buffer, m.lote);
  assert.equal(r2.ok, true);
  assert.deepEqual(m.deTeclado(), [texto('uno'), enter, texto('dos')]);
});

test('cerrar la vista a mitad pausa el lote (el Enter no sale) y no toca la tarea; al reabrir, «Seguir» lo termina', async () => {
  const m = montaje({ demoraMs: 1500 });
  m.buffer.cambiar('café ☕', []);
  const p = confirmarEscritura(m.buffer, m.lote, true);
  await hasta(() => m.lote.estado() === 'esperando_imagen');
  m.lote.pausar('cerrado');
  const r = await p;
  assert.deepEqual(r, { ok: false, motivo: 'cerrado', aplicados: 1, pendientes: 1, incierto: false });
  await dormir(1700);
  assert.deepEqual(m.deTeclado(), [texto('café ☕')], 'la imagen llegó después y aun así no salió el Enter');
  assert.ok(m.enviadas.every((e) => ['text_commit', 'key', 'release_all'].includes(e.type)), 'nada de parar/cancelar: solo entradas');
  const r2 = await seguirEscritura(m.buffer, m.lote);
  assert.equal(r2.ok, true);
  assert.deepEqual(m.deTeclado(), [texto('café ☕'), enter]);
});

test('sin imagen dentro del plazo: se pausa con lo que falta (no se relaja la guarda ni se manda a ciegas)', async () => {
  const m = montaje({ demoraMs: 50, plazoImagenMs: 300 });
  m.sinImagenes();
  m.buffer.cambiar('uno\ndos', []);
  const r = await confirmarEscritura(m.buffer, m.lote, false);
  assert.deepEqual(r, { ok: false, motivo: 'tras_entrada', aplicados: 1, pendientes: 2, incierto: false });
  assert.deepEqual(m.deTeclado(), [texto('uno')]);
  m.conImagenes();
  assert.equal((await seguirEscritura(m.buffer, m.lote)).ok, true);
  assert.deepEqual(m.deTeclado(), [texto('uno'), enter, texto('dos')]);
});

test('IME, acentos y emoji: la composición final, en NFC, sin partir emoji, banderas ni familias, aunque pase de 500', async () => {
  const m = montaje({ demoraMs: 50 });
  // El teclado compone (Android/iOS): el campo cambia varias veces; solo sale lo final.
  for (const parcial of ['c', 'ca', 'caf', 'cafe', 'café']) m.buffer.cambiar(parcial, []);
  const largo = 'café ☕ ' + 'ñ'.repeat(493) + '👨‍👩‍👧🇭🇳 fin';
  m.buffer.cambiar(largo, []);
  const r = await confirmarEscritura(m.buffer, m.lote, true);
  assert.equal(r.ok, true);
  const llegados = m.deTeclado();
  assert.deepEqual(llegados.at(-1), enter, 'el Enter al final, una vez');
  const textos = llegados.filter((e) => e.type === 'text_commit').map((e) => e.payload.texto as string);
  assert.ok(textos.length >= 2, 'en trozos');
  assert.equal(textos.join(''), largo.normalize('NFC'), 'el texto entero, compuesto (é, no e + ´)');
  assert.ok(textos.every((t) => t.length <= 500));
  assert.ok(!textos.some((t) => /^[‍\u{1f3fb}-\u{1f3ff}️]/u.test(t)), 'ningún trozo empieza a mitad de un emoji');
  assert.ok(textos.some((t) => t.includes('👨‍👩‍👧')), 'la familia entera en un trozo');
  assert.ok(textos.some((t) => t.includes('🇭🇳')), 'la bandera entera en un trozo');
  assert.equal(m.nodo.filter((n) => n.type === 'key').length, 1);
});

test('entrada segura: lo pendiente nunca se repite en avisos y se tira al terminarla', async () => {
  const m = montaje({ demoraMs: 50, fallar: (e) => (e.type === 'text_commit' ? { antes: Object.assign(new Error('x'), { status: 502, data: { code: 'incierta' } }) } : null) });
  m.buffer.cambiar('clave-sintetica-123', []);
  const r = await confirmarEscritura(m.buffer, m.lote, true, { privado: true });
  assert.equal(r.ok, false);
  const aviso = avisoDeLote(m.lote)!;
  assert.ok(!aviso.join(' ').includes('clave-sintetica'), 'el aviso no enseña la contraseña');
  assert.match(aviso[0], /•••/);
  descartarEscritura(m.buffer, m.lote);
  assert.equal(m.buffer.texto, '');
  assert.equal(m.lote.abierto(), false);
  assert.equal(m.lote.incierto, null);
});

test('mientras el lote va, otro «Enviar» no mezcla su texto (se espera a que termine)', async () => {
  const m = montaje({ demoraMs: 500 });
  m.buffer.cambiar('uno', []);
  const p = confirmarEscritura(m.buffer, m.lote, true);
  await hasta(() => m.lote.estado() === 'esperando_imagen');
  const otro = await confirmarEscritura(m.buffer, m.lote, true);
  assert.equal(otro.ok, false);
  assert.equal((otro as any).motivo, 'ocupado');
  assert.equal((await p).ok, true);
  assert.deepEqual(m.deTeclado(), [texto('uno'), enter]);
});
