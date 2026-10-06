/**
 * LANG-02 · «el último correo de AYER» escoge dentro de ayer (hora de Honduras), no el más nuevo de todos.
 *
 * Reproducción sobre 5754c78: `pideUltimoCorreo('el último correo de ayer')` es true (bien: es UNO solo), pero
 * `leerUltimo` abría el más reciente de todas las cuentas sin mirar «ayer»: con uno de hoy más nuevo, leía el de hoy.
 *
 * Reloj fijo (`_relojDePrueba`): martes 6 de octubre de 2026, 3:00 p. m. en Tegucigalpa (21:00 UTC). Buzón falso
 * (`_buzonDePrueba`), dos cuentas, sin IMAP ni red.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'correo-intervalo-'));
Object.assign(process.env, {
  CORREO_CLAVE_CIFRADO: 'llave-de-prueba-intervalo',
  ULTRON_CORREO_DIR: DIR,
  ULTRON_TAREA_CURSO_DIR: path.join(DIR, 'tarea'),
  ULTRON_ABIERTOS_DIR: path.join(DIR, 'abiertos'),
  ULTRON_MEMORIA_BUCKET: '',
});
after(() => fs.rmSync(DIR, { recursive: true, force: true }));

const C: Record<string, any> = await import('../server/correo');
const I: Record<string, any> = await import('../lib/correo/intervalo');
const { agregarCuenta, _olvidarCuentas } = await import('../lib/correo/cuentas');
const { tareaDe, _olvidarTareas } = await import('../lib/tarea-en-curso');

const PROV = (host: string) => ({ nombre: 'Sintético', imap: { host: `imap.${host}`, puerto: 993, seguro: true }, smtp: { host: `smtp.${host}`, puerto: 465, seguro: true }, auth: 'clave', usuario: 'correo', guardaEnviados: false }) as any;
const YO = 'jose@prueba.invalid';
const AMB = 'mesa';
const TRABAJO = 'trabajo@empresa.invalid';
const PERSONAL = 'jose@casa.invalid';

/** «2026-10-05 21:30» en hora de Honduras → ISO UTC. */
const hn = (s: string) => new Date(`${s.replace(' ', 'T')}:00-06:00`).toISOString();
/**
 * El «hoy» de la prueba es un día que YA pasó (anteayer en Honduras), a las 3:00 p. m.: así ningún correo de la prueba
 * queda «en el futuro» del reloj real (el filtro anti-spam de fechas futuras) y la prueba vale igual corrida a cualquier
 * hora, con el reloj fijo (`_relojDePrueba`) o sin él.
 */
const DIA = 24 * 3600_000;
const HOY0 = I.medianocheHN(Date.now()) - 2 * DIA;
const en = (dia: number, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(HOY0 + dia * DIA + (h * 60 + m) * 60_000).toISOString();
};
const AHORA = Date.parse(en(0, '15:00'));

type Fila = { uid: number; de: string; deCorreo: string; asunto: string; fecha: string; noLeido: boolean; texto: string };
const DATOS = (): Record<string, Fila[]> => ({
  [TRABAJO]: [
    { uid: 50, de: 'Ana Paz', deCorreo: 'ana@paz.invalid', asunto: 'Hoy nuevo', fecha: en(0, '14:30'), noLeido: true, texto: 'Lo de hoy.' },
    { uid: 49, de: 'Beto', deCorreo: 'beto@x.invalid', asunto: 'Ayer noche', fecha: en(-1, '20:00'), noLeido: false, texto: 'Lo de anoche temprano.' },
    { uid: 48, de: 'Ana Paz', deCorreo: 'ana@paz.invalid', asunto: 'Ayer mañana', fecha: en(-1, '09:00'), noLeido: false, texto: 'Lo de ayer en la mañana.' },
    { uid: 47, de: 'Proveedor', deCorreo: 'p@x.invalid', asunto: 'Hace tres días', fecha: en(-3, '11:00'), noLeido: false, texto: 'Viejo.' },
    // Sin fecha (ni INTERNALDATE ni encabezado): nunca cuenta dentro de un intervalo.
    { uid: 51, de: 'Sin Fecha', deCorreo: 'sf@x.invalid', asunto: 'Sin fecha', fecha: '', noLeido: true, texto: '¿Cuándo llegó?' },
  ],
  [PERSONAL]: [
    // 21:30 de ayer en Honduras = 03:30 UTC de hoy: por UTC sería «hoy»; en Tegucigalpa es AYER (y el más nuevo de ayer).
    { uid: 9, de: 'Carla', deCorreo: 'carla@x.invalid', asunto: 'Ayer personal', fecha: en(-1, '21:30'), noLeido: false, texto: 'Lo último de ayer.' },
    { uid: 8, de: 'Notaría', deCorreo: 'n@x.invalid', asunto: 'Hoy temprano', fecha: en(0, '07:10'), noLeido: false, texto: 'De esta mañana.' },
  ],
});

function buzon(cuentas: Record<string, Fila[]>) {
  const abiertos: string[] = [];
  const pedidos: any[] = [];
  return {
    abiertos,
    pedidos,
    b: {
      listar: async (_q: string, c: { id: string; correo: string }, o: { soloNoLeidos?: boolean; n?: number; buscar?: string; desde?: Date; hasta?: Date; cobertura?: any } = {}) => {
        pedidos.push({ cuenta: c.correo, n: o.n, buscar: o.buscar, desde: o.desde, hasta: o.hasta });
        let xs = [...(cuentas[c.correo] || [])].sort((a, b) => b.fecha.localeCompare(a.fecha));
        if (o.soloNoLeidos) xs = xs.filter((x) => x.noLeido);
        if (o.buscar) xs = xs.filter((x) => `${x.de} ${x.deCorreo} ${x.asunto}`.toLowerCase().includes(o.buscar!.toLowerCase()));
        const fuera = xs.slice(0, o.n ?? 10);
        if (o.cobertura) Object.assign(o.cobertura, { total: xs.length, revisados: fuera.length });
        return fuera.map((x) => ({ ref: `${c.id}:${x.uid}`, cuenta: c.correo, de: x.de, deCorreo: x.deCorreo, asunto: x.asunto, fecha: x.fecha, noLeido: x.noLeido }));
      },
      leer: async (_q: string, c: { id: string; correo: string }, uid: number) => {
        const x = (cuentas[c.correo] || []).find((f) => f.uid === uid);
        if (!x) return null;
        abiertos.push(`${c.correo}:${uid}`);
        return { ref: `${c.id}:${uid}`, cuenta: c.correo, de: x.de, deCorreo: x.deCorreo, asunto: x.asunto, fecha: x.fecha, noLeido: false, para: YO, cc: '', paraCorreos: [YO], ccCorreos: [], texto: x.texto, adjuntos: [], messageId: '', referencias: [] };
      },
    },
  };
}

async function preparar(datos = DATOS()) {
  _olvidarCuentas();
  _olvidarTareas();
  C._olvidarCorreo();
  const f = buzon(datos);
  C._buzonDePrueba(f.b);
  C._relojDePrueba?.(() => AHORA);
  await agregarCuenta(YO, TRABAJO, PROV('empresa.invalid'), 'clave');
  await agregarCuenta(YO, PERSONAL, PROV('casa.invalid'), 'clave');
  return f;
}
function limpiar() {
  C._buzonDePrueba(null);
  C._relojDePrueba?.(null);
}

test('LANG-02: «el último correo de ayer» (el cerebro pide revisar) abre el más reciente DE AYER, no el de hoy', async () => {
  const f = await preparar();
  try {
    const r = await C.correrCorreoConEstado(YO, 'revisar', AMB, { pedido: 'revisa el último correo de ayer' });
    assert.equal(r.estado, 'succeeded', r.texto);
    assert.deepEqual(f.abiertos, [`${PERSONAL}:9`], r.texto);
    assert.match(r.texto, /«Ayer personal»/);
    assert.doesNotMatch(r.texto, /«Hoy nuevo»|«Hoy temprano»/);
    assert.match(r.texto, /DE AYER/, 'dice que es el último de ayer');
    assert.match(r.texto, /jose@casa\.invalid/, 'dice a qué cuenta llegó (varias cuentas)');
    assert.equal(tareaDe(YO, AMB), null, 'sin tarea');
  } finally {
    limpiar();
  }
});

test('LANG-02: el modelo pide «leer último» (o «leer el último de ayer»): igual, dentro de ayer', async () => {
  for (const [arg, pedido] of [
    ['leer último', 'léeme el último correo de ayer'],
    ['leer el último de ayer', undefined],
    ['leer el último correo de ayer', 'el último correo de ayer'],
  ] as Array<[string, string | undefined]>) {
    const f = await preparar();
    try {
      const r = await C.correrCorreoConEstado(YO, arg, AMB, pedido ? { pedido } : {});
      assert.deepEqual(f.abiertos, [`${PERSONAL}:9`], `${arg} / ${pedido}: ${r.texto}`);
    } finally {
      limpiar();
    }
  }
});

test('LANG-02: con remitente — «el último de Ana de ayer» es el de Ana DE AYER, no el de Ana de hoy', async () => {
  for (const [arg, pedido] of [
    ['leer el último de Ana de ayer', undefined],
    ['leer el último de Ana', 'léeme el último correo de Ana de ayer'],
  ] as Array<[string, string | undefined]>) {
    const f = await preparar();
    try {
      const r = await C.correrCorreoConEstado(YO, arg, AMB, pedido ? { pedido } : {});
      assert.deepEqual(f.abiertos, [`${TRABAJO}:48`], `${arg} / ${pedido}: ${r.texto}`);
      assert.match(r.texto, /«Ayer mañana»/);
    } finally {
      limpiar();
    }
  }
  // Sin «ayer», «el último de Ana» sigue siendo el más nuevo de Ana (el camino de siempre).
  const f = await preparar();
  try {
    await C.correrCorreoConEstado(YO, 'leer el último de Ana', AMB);
    assert.deepEqual(f.abiertos, [`${TRABAJO}:50`]);
  } finally {
    limpiar();
  }
});

test('LANG-02: «la última semana», «esta mañana», «anoche»: cada uno su intervalo', async () => {
  assert.equal(C.pideUltimoCorreo('el último correo de la última semana'), true);
  const casos: Array<[string, string]> = [
    ['revisa el último correo de la última semana', `${TRABAJO}:50`],
    ['revisa el último correo de esta mañana', `${PERSONAL}:8`],
    ['el último correo de anoche', `${PERSONAL}:9`],
    ['el último correo de ayer en la mañana', `${TRABAJO}:48`],
    ['my latest email from yesterday', `${PERSONAL}:9`],
  ];
  for (const [pedido, esperado] of casos) {
    const f = await preparar();
    try {
      const r = await C.correrCorreoConEstado(YO, 'revisar', AMB, { pedido });
      assert.deepEqual(f.abiertos, [esperado], `${pedido}: ${r.texto}`);
    } finally {
      limpiar();
    }
  }
});

test('LANG-02: futuro imposible — «el último correo de mañana» no abre nada (ni el de hoy en su lugar)', async () => {
  for (const pedido of ['el último correo de mañana', 'revisa el último correo de esta noche', 'my latest email from tomorrow']) {
    const f = await preparar();
    try {
      const r = await C.correrCorreoConEstado(YO, 'revisar', AMB, { pedido });
      assert.deepEqual(f.abiertos, [], `${pedido}: ${r.texto}`);
      assert.match(r.texto, /todavía no llega/, pedido);
    } finally {
      limpiar();
    }
  }
});

test('LANG-02: una cuenta nombrada — «el último de ayer en trabajo@…» solo mira esa cuenta', async () => {
  const f = await preparar();
  try {
    const r = await C.correrCorreoConEstado(YO, 'revisar', AMB, { pedido: `el último correo de ayer en ${TRABAJO}` });
    assert.deepEqual(f.abiertos, [`${TRABAJO}:49`], r.texto);
    assert.ok(f.pedidos.every((p) => p.cuenta === TRABAJO), 'no consultó la otra cuenta');
  } finally {
    limpiar();
  }
});

test('LANG-02: un correo sin fecha nunca es «el de ayer» ni «el último», y se dice que no se contó', async () => {
  const f = await preparar({ [TRABAJO]: DATOS()[TRABAJO].filter((x) => x.uid === 51 || x.uid === 47), [PERSONAL]: [] });
  try {
    const r = await C.correrCorreoConEstado(YO, 'revisar', AMB, { pedido: 'el último correo de ayer' });
    assert.deepEqual(f.abiertos, [], r.texto);
    assert.match(r.texto, /no tiene ningún correo de ayer/, r.texto);
    assert.match(r.texto, /1 sin fecha no los conté/);
    // Sin intervalo, el que tiene fecha va antes que el que no.
    C._olvidarCorreo();
    await C.correrCorreoConEstado(YO, 'leer el último', AMB);
    assert.deepEqual(f.abiertos, [`${TRABAJO}:47`]);
  } finally {
    limpiar();
  }
});

test('LANG-02: resultado vacío — «el último correo de anteayer» sin correos ese día: lo dice y no abre otro', async () => {
  const f = await preparar();
  try {
    const r = await C.correrCorreoConEstado(YO, 'revisar', AMB, { pedido: 'el último correo de anteayer' });
    assert.equal(r.estado, 'succeeded', r.texto);
    assert.deepEqual(f.abiertos, []);
    assert.match(r.texto, /no tiene ningún correo de anteayer/);
    assert.match(r.texto, /No le abras otro/);
  } finally {
    limpiar();
  }
});

test('LANG-02: el atajo genérico sigue igual — «el último correo que recibí» es el más nuevo de todos', async () => {
  const f = await preparar();
  try {
    const r = await C.correrCorreoConEstado(YO, 'revisar', AMB, { pedido: 'revisa el último correo que recibí' });
    assert.deepEqual(f.abiertos, [`${TRABAJO}:50`], r.texto);
    assert.match(r.texto, /ES EL ÚLTIMO QUE RECIBIÓ:/);
  } finally {
    limpiar();
  }
});

test('LANG-02: intervaloDeCorreo en hora de Honduras (límites del día, semana, futuro)', () => {
  assert.equal(typeof I.intervaloDeCorreo, 'function');
  // Martes 6 de octubre de 2026, 3:00 p. m. en Tegucigalpa.
  const AHORA = Date.parse(hn('2026-10-06 15:00'));
  const ayer = I.intervaloDeCorreo('el último correo de ayer', AHORA);
  assert.equal(new Date(ayer.desde).toISOString(), hn('2026-10-05 00:00'));
  assert.equal(new Date(ayer.hasta).toISOString(), hn('2026-10-06 00:00'));
  assert.equal(I.dentroDe(ayer, Date.parse(hn('2026-10-05 23:59'))), true);
  assert.equal(I.dentroDe(ayer, Date.parse(hn('2026-10-06 00:00'))), false);
  assert.equal(I.dentroDe(ayer, Date.parse('2026-10-06T03:30:00Z')), true, '03:30 UTC del 6 es el 5 en Honduras');
  const semPasada = I.intervaloDeCorreo('el último de la semana pasada', AHORA);
  assert.equal(new Date(semPasada.desde).toISOString(), hn('2026-09-28 00:00'), 'lunes 28');
  assert.equal(new Date(semPasada.hasta).toISOString(), hn('2026-10-05 00:00'), 'lunes 5');
  assert.equal(I.intervaloDeCorreo('el último correo de mañana', AHORA).futuro, true);
  assert.equal(I.intervaloDeCorreo('el último correo de la mañana', AHORA).futuro, undefined, '«la mañana» es la parte del día');
  assert.equal(I.intervaloDeCorreo('el último correo de esta noche', AHORA).futuro, true, 'a las 3 p. m. la noche no ha llegado');
  assert.equal(I.intervaloDeCorreo('el último correo que recibí', AHORA), null, 'sin momento: el atajo genérico');
});
