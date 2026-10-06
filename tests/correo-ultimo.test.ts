/**
 * «Revisa el último correo que recibí» (prueba de José en Android, 5-oct, APK 5.3.0 + OTA).
 *
 * Lo que pasó: el cerebro pidió `correo revisar`, que listó los 12 sin leer y abrió una TAREA EN CURSO de 12 pasos
 * («revisar los 12 correos sin leer»). La persona solo quería UNO: el más reciente.
 *
 * Lo que tiene que ser verdad ahora (con `_buzonDePrueba`, sin IMAP ni red):
 *  · `pideUltimoCorreo` reconoce «el último correo / el más reciente / el último que me llegó / lo último que recibí»
 *    y «my latest email / the last email I got», y NO «revisa mis correos», «qué correos tengo», «los últimos correos»
 *    ni «el último de Ana» (ese es de un remitente: lo resuelve `correo leer`);
 *  · si el cerebro pide `revisar` pero lo que dijo la persona en el turno es «el último correo», el servidor abre el más
 *    reciente de TODAS sus cuentas (por fecha, leído o no), dice de qué cuenta es y NO abre ninguna tarea en curso;
 *  · `correo leer el último` sin lista también abre el más reciente (antes preguntaba «¿cuál?»);
 *  · «revisa mis correos» sigue listando y abriendo la tarea de siempre;
 *  · las instrucciones del modelo (harness y cerebro con manos) dicen «el último correo» → correo leer último.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'correo-ultimo-'));
Object.assign(process.env, {
  CORREO_CLAVE_CIFRADO: 'llave-de-prueba-ultimo',
  ULTRON_CORREO_DIR: DIR,
  ULTRON_TAREA_CURSO_DIR: path.join(DIR, 'tarea'),
  ULTRON_ABIERTOS_DIR: path.join(DIR, 'abiertos'),
  ULTRON_MEMORIA_BUCKET: '',
});
after(() => fs.rmSync(DIR, { recursive: true, force: true }));

// Namespace: si una función todavía no existe, la prueba falla en su aserción (no al importar).
const C: Record<string, any> = await import('../server/correo');
const { agregarCuenta, _olvidarCuentas } = await import('../lib/correo/cuentas');
const { tareaDe, _olvidarTareas } = await import('../lib/tarea-en-curso');
const { INSTRUCCION_CORREO } = await import('../lib/harness');
const { herramientasDelTurno } = await import('../lib/cerebro-manos');

const PROV = (host: string) => ({ nombre: 'Sintético', imap: { host: `imap.${host}`, puerto: 993, seguro: true }, smtp: { host: `smtp.${host}`, puerto: 465, seguro: true }, auth: 'clave', usuario: 'correo', guardaEnviados: false }) as any;
const YO = 'jose@prueba.invalid';
const AMB = 'mesa';

const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
type Fila = { uid: number; de: string; deCorreo: string; asunto: string; fecha: string; noLeido: boolean; texto: string };

/** Dos cuentas: la de trabajo con 3 sin leer (viejos) y la personal con el MÁS NUEVO de todos, ya leído. */
function buzon(cuentas: Record<string, Fila[]>) {
  const abiertos: string[] = [];
  return {
    abiertos,
    b: {
      listar: async (_q: string, c: { id: string; correo: string }, o: { soloNoLeidos?: boolean; n?: number; buscar?: string } = {}) => {
        let xs = [...(cuentas[c.correo] || [])].sort((a, b) => b.fecha.localeCompare(a.fecha));
        if (o.soloNoLeidos) xs = xs.filter((x) => x.noLeido);
        if (o.buscar) xs = xs.filter((x) => `${x.de} ${x.asunto}`.toLowerCase().includes(o.buscar!.toLowerCase()));
        return xs.slice(0, o.n ?? 10).map((x) => ({ ref: `${c.id}:${x.uid}`, cuenta: c.correo, de: x.de, deCorreo: x.deCorreo, asunto: x.asunto, fecha: x.fecha, noLeido: x.noLeido }));
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

const TRABAJO = 'trabajo@empresa.invalid';
const PERSONAL = 'jose@casa.invalid';
const DATOS = (): Record<string, Fila[]> => ({
  [TRABAJO]: [
    { uid: 11, de: 'Ana Paz', deCorreo: 'ana@paz.invalid', asunto: 'Reunión del lunes', fecha: hace(90), noLeido: true, texto: '¿Nos vemos el lunes?' },
    { uid: 12, de: 'Banco Atlántida', deCorreo: 'avisos@banco.invalid', asunto: 'Estado de cuenta', fecha: hace(180), noLeido: true, texto: 'Su estado de cuenta.' },
    { uid: 13, de: 'Beto', deCorreo: 'beto@x.invalid', asunto: 'Planos', fecha: hace(300), noLeido: true, texto: 'Te mando los planos.' },
  ],
  [PERSONAL]: [
    { uid: 7, de: 'Notaría López', deCorreo: 'notaria@lopez.invalid', asunto: 'Escritura lista', fecha: hace(5), noLeido: false, texto: 'Su escritura ya está lista para firmar el jueves.' },
    { uid: 6, de: 'Carla', deCorreo: 'carla@x.invalid', asunto: 'Fotos', fecha: hace(400), noLeido: true, texto: 'Ahí van las fotos.' },
  ],
});

async function preparar() {
  _olvidarCuentas();
  _olvidarTareas();
  C._olvidarCorreo();
  const f = buzon(DATOS());
  C._buzonDePrueba(f.b);
  await agregarCuenta(YO, TRABAJO, PROV('empresa.invalid'), 'clave');
  await agregarCuenta(YO, PERSONAL, PROV('casa.invalid'), 'clave');
  return f;
}

test('pideUltimoCorreo: «el último correo», «el más reciente», «lo último que recibí», "my latest email"; no la lista ni un remitente', () => {
  assert.equal(typeof C.pideUltimoCorreo, 'function', 'existe pideUltimoCorreo');
  const si = [
    'revisa el último correo que recibí',
    'Revisa el ultimo correo que recibi',
    'léeme el correo más reciente',
    'cuál es mi último correo',
    '¿qué dice el último que me llegó?',
    'lo último que recibí en el correo',
    'ábreme el más nuevo',
    'lee el último mail',
    'check my latest email',
    'read me the last email I got',
    "what's my most recent email",
    'open the newest email',
  ];
  const no = [
    'revisa mis correos',
    'qué correos tengo',
    '¿tengo correos nuevos?',
    'léeme los últimos correos',
    'los 5 correos más recientes',
    'léeme el último de Ana',
    'el último correo de Banco Atlántida',
    'check my emails',
    'my latest emails',
    'the last email from Ana',
    '',
  ];
  for (const x of si) assert.equal(C.pideUltimoCorreo(x), true, `sí: «${x}»`);
  for (const x of no) assert.equal(C.pideUltimoCorreo(x), false, `no: «${x}»`);
});

test('«revisa el último correo que recibí»: aunque el cerebro pida revisar, abre EL más reciente (de todas sus cuentas) y no abre ninguna tarea', async () => {
  const f = await preparar();
  try {
    const r = await C.correrCorreoConEstado(YO, 'revisar', AMB, { pedido: 'Revisa el último correo que recibí' });
    assert.equal(r.estado, 'succeeded', r.texto);
    assert.match(r.texto, /de Notaría López <notaria@lopez\.invalid>/, 'el más nuevo de todos, aunque ya estaba leído');
    assert.match(r.texto, /«Escritura lista»/);
    assert.match(r.texto, /firmar el jueves/, 'lo abre: trae el texto');
    assert.match(r.texto, /jose@casa\.invalid/, 'dice a qué cuenta llegó');
    assert.doesNotMatch(r.texto, /TAREA EN CURSO|CÓMO DECIRLO: cuántos son/, 'no lista ni abre tarea');
    assert.doesNotMatch(r.texto, /Reunión del lunes|Estado de cuenta|Planos/, 'no trae la lista de sin leer');
    assert.equal(tareaDe(YO, AMB), null, 'ninguna tarea en curso por un solo correo');
    assert.deepEqual(f.abiertos, [`${PERSONAL}:7`]);
    // Y «sigue» lee el resto de ESE correo; «contéstale» le contesta a ese (queda como el que está leyendo).
    assert.match(String(r.recibo?.referencia || ''), /:7$/);
    // En inglés, igual.
    _olvidarTareas();
    const en = await C.correrCorreoConEstado(YO, 'revisar', AMB, { pedido: 'check my latest email' });
    assert.match(en.texto, /Escritura lista/);
    assert.equal(tareaDe(YO, AMB), null);
  } finally {
    C._buzonDePrueba(null);
  }
});

test('«léeme el último» sin lista: correo leer abre el más reciente de todas las cuentas (antes preguntaba «¿cuál?»)', async () => {
  const f = await preparar();
  try {
    for (const ref of ['el último', 'último', 'el más reciente', 'el último correo que recibí']) {
      C._olvidarCorreo();
      f.abiertos.length = 0;
      const r = await C.correrCorreoConEstado(YO, `leer ${ref}`, AMB);
      assert.equal(r.estado, 'succeeded', `«${ref}»: ${r.texto}`);
      assert.match(r.texto, /Escritura lista/, `«${ref}»`);
      assert.deepEqual(f.abiertos, [`${PERSONAL}:7`]);
    }
    assert.equal(tareaDe(YO, AMB), null);
    // «el último de Ana» sigue siendo de Ana (un remitente), no el más nuevo de todos.
    C._olvidarCorreo();
    const ana = await C.correrCorreoConEstado(YO, 'leer el último de Ana', AMB);
    assert.match(ana.texto, /Reunión del lunes/);
  } finally {
    C._buzonDePrueba(null);
  }
});

test('«revisa mis correos» / «qué correos tengo»: la lista de siempre, con su tarea', async () => {
  for (const pedido of ['revisa mis correos', 'qué correos tengo', undefined]) {
    const f = await preparar();
    try {
      const r = await C.correrCorreoConEstado(YO, 'revisar', AMB, pedido === undefined ? undefined : { pedido });
      assert.match(r.texto, /^CORREO \(sin leer: 4;/, String(pedido));
      assert.match(r.texto, /TAREA EN CURSO: «revisar los 4 correos sin leer»/);
      assert.equal(tareaDe(YO, AMB)?.pasos.length, 4);
      assert.equal(f.abiertos.length, 0, 'revisar no abre ninguno');
    } finally {
      C._buzonDePrueba(null);
    }
  }
});

test('el modelo sabe: «el último correo» → correo leer último (harness y cerebro con manos)', () => {
  assert.match(INSTRUCCION_CORREO, /«el último correo»[^.]*correo leer último/);
  const t = herramientasDelTurno({ app: false, manos: [], sistema: false, computadora: false, correo: true, whatsapp: false, sesion: true, triaje: false } as any).find((x: any) => x.toolSpec?.name === 'correo') as any;
  assert.match(String(t?.toolSpec?.description || ''), /«el último correo»[^.]*leer «último»/);
});

/* ------------------------------------------------------------------ revisión del 5-oct (MEDIO-1, MEDIO-2, MENOR) */

test('MEDIO-1: pideUltimoCorreo no confunde «la última semana», «la última vez», el último DE alguien ni lo enviado', () => {
  const tabla: Array<[string, boolean]> = [
    // Sigue siendo «el último correo» (uno solo, de cualquiera).
    ['revisa el último correo que recibí', true],
    ['el más reciente', true],
    ['lo último que me llegó', true],
    ['my latest email', true],
    ['the last email I got', true],
    // Un rango de tiempo o «la última vez» es la lista, no el último.
    ['revisa mis correos de la última semana', false],
    ['revisa mis correos de la última hora', false],
    ['revisa mis correos, la última vez no me dijiste nada', false],
    ['revisa mis correos del último mes', false],
    // El último de alguien es OTRO pedido (lo resuelve `correo leer` con la referencia).
    ['el último correo que me mandó Ana', false],
    ['el último correo que me mandó el banco', false],
    ['léeme lo último que me escribió Ana', false],
    // Lo enviado no es lo recibido.
    ['el último correo enviado', false],
    ['the last email I sent', false],
  ];
  const mal = tabla.filter(([frase, esperado]) => C.pideUltimoCorreo(frase) !== esperado).map(([frase, esperado]) => `«${frase}» debía ser ${esperado}`);
  assert.deepEqual(mal, []);
});

test('MEDIO-2: leer un correo (o seguir) deja un recibo de LECTURA: la voz lo dice entero, con su «¿sigo?»', async () => {
  await preparar();
  try {
    const r = await C.correrCorreoConEstado(YO, 'leer el último', AMB);
    assert.equal(r.recibo?.lectura, true, 'leer: recibo de lectura');
    const ultimo = await C.correrCorreoConEstado(YO, 'revisar', AMB, { pedido: 'revisa el último correo que recibí' });
    assert.equal(ultimo.recibo?.lectura, true, 'el camino de «el último correo»: recibo de lectura');
    const lista = await C.correrCorreoConEstado(YO, 'revisar', AMB, { pedido: 'revisa mis correos' });
    assert.notEqual(lista.recibo?.lectura, true, 'la lista no es una lectura');
  } finally {
    C._buzonDePrueba(null);
  }
  // Un correo largo: «correo seguir» también es lectura.
  _olvidarCuentas();
  _olvidarTareas();
  C._olvidarCorreo();
  const largo = 'Le escribo para confirmarle los detalles del envío de la próxima semana, que incluye los repuestos del molino y las piezas de la bomba. '.repeat(12);
  const g = buzon({ [TRABAJO]: [{ uid: 21, de: 'Proveedor', deCorreo: 'p@x.invalid', asunto: 'Envío', fecha: hace(3), noLeido: true, texto: largo }] });
  C._buzonDePrueba(g.b);
  try {
    await agregarCuenta(YO, TRABAJO, PROV('empresa.invalid'), 'clave');
    const r = await C.correrCorreoConEstado(YO, 'leer el último', AMB);
    assert.equal(r.recibo?.lectura, true);
    const s = await C.correrCorreoConEstado(YO, 'seguir', AMB);
    assert.equal(s.estado, 'succeeded', s.texto);
    assert.equal(s.recibo?.lectura, true, 'seguir: recibo de lectura');
    // Con ese recibo en el turno, la voz no lleva tope: el trozo entero (600) y el «¿sigo?» se dicen.
    const M: Record<string, any> = await import('../lib/cerebro-manos');
    // Revisión independiente del 5-oct (MENOR-D): una lectura ya no quita el tope; lleva el de lectura (650), donde caben
    // el trozo entero (600) y su «¿sigo?», pero no los 2 800 caracteres que puede traer el turno.
    assert.equal(typeof M.topeTrasPaso, 'function', 'existe topeTrasPaso');
    assert.equal(M.topeTrasPaso(M.topeDeVoz('sigue', true), { herramienta: 'correo', estado: s.estado, recibo: s.recibo }), M.TOPE_VOZ_LECTURA);
    const trozo = largo.slice(0, 600).trim();
    const dicho = `Es del proveedor, sobre el envío. ${trozo} ¿Sigo?`;
    const tope = M.topeTrasPaso(M.topeDeVoz('revisa el último correo', true), { herramienta: 'correo', estado: r.estado, recibo: r.recibo });
    assert.equal(M.recorteDeVoz(dicho, tope), dicho, 'se dice entero: el trozo completo y «¿Sigo?»');
    // Lo que trae `correo leer` (hasta 2 800 caracteres): el principio y el «¿Sigo?», sin pasar de 650.
    assert.ok(r.texto.length > 1500, String(r.texto.length));
    const todo = `Es del proveedor, sobre el envío. ${largo.slice(0, 2800).trim()} ¿Sigo?`;
    const voz = M.recorteDeVoz(todo, tope);
    assert.ok(voz.length <= M.TOPE_VOZ_LECTURA, String(voz.length));
    assert.match(voz, /¿Sigo\?$/);
  } finally {
    C._buzonDePrueba(null);
  }
});

test('MENOR: un correo con fecha falsa en el futuro (spam) no pasa por «el último»', async () => {
  _olvidarCuentas();
  _olvidarTareas();
  C._olvidarCorreo();
  const futuro = new Date(Date.now() + 5 * 365 * 24 * 3600_000).toISOString();
  const g = buzon({
    [TRABAJO]: [
      { uid: 31, de: 'Premio Seguro', deCorreo: 'spam@x.invalid', asunto: '¡GANASTE!', fecha: futuro, noLeido: true, texto: 'Reclama tu premio.' },
      { uid: 30, de: 'Ana Paz', deCorreo: 'ana@paz.invalid', asunto: 'Planilla', fecha: hace(2), noLeido: true, texto: 'Te mando la planilla.' },
    ],
  });
  C._buzonDePrueba(g.b);
  try {
    await agregarCuenta(YO, TRABAJO, PROV('empresa.invalid'), 'clave');
    const r = await C.correrCorreoConEstado(YO, 'leer el último', AMB);
    assert.match(r.texto, /«Planilla»/, r.texto);
    assert.doesNotMatch(r.texto, /GANASTE/);
  } finally {
    C._buzonDePrueba(null);
  }
});

test('MENOR-F (revisión independiente del 5-oct): «el último correo de la mañana» es el último, no uno «de» alguien', () => {
  const tabla: Array<[string, boolean]> = [
    ['el último correo de la mañana', true],
    ['léeme el último correo de esta tarde', true],
    ['el último correo de anoche', true],
    ['el último correo de hoy', true],
    ['my latest email from this morning', true],
    // Un remitente sigue siendo OTRO pedido (lo resuelve `correo leer` con la referencia).
    ['el último correo de Ana', false],
    ['el último correo del banco', false],
    ['el último correo de la empresa', false],
  ];
  const mal = tabla.filter(([frase, esperado]) => C.pideUltimoCorreo(frase) !== esperado).map(([frase, esperado]) => `«${frase}» debía ser ${esperado}`);
  assert.deepEqual(mal, []);
});

test('MENOR-F: «el último correo de la mañana» abre el último DE LA MAÑANA (sin lista ni tarea)', async () => {
  // LANG-02: con reloj fijo (11:30 a. m. en Honduras). Antes abría el más nuevo de todos aunque hubiera llegado de noche:
  // ahora escoge dentro de «la mañana» de hoy (hora de Honduras).
  _olvidarCuentas();
  _olvidarTareas();
  C._olvidarCorreo();
  const hn = (s: string) => new Date(`${s.replace(' ', 'T')}:00-06:00`).toISOString();
  const g = buzon({
    [TRABAJO]: [
      { uid: 41, de: 'Ana Paz', deCorreo: 'ana@paz.invalid', asunto: 'De la mañana', fecha: hn('2026-10-06 10:30'), noLeido: true, texto: 'Buenos días.' },
      { uid: 40, de: 'Beto', deCorreo: 'beto@x.invalid', asunto: 'De anoche', fecha: hn('2026-10-05 22:00'), noLeido: true, texto: 'Buenas noches.' },
    ],
  });
  C._buzonDePrueba(g.b);
  C._relojDePrueba(() => Date.parse(hn('2026-10-06 11:30')));
  try {
    await agregarCuenta(YO, TRABAJO, PROV('empresa.invalid'), 'clave');
    const r = await C.correrCorreoConEstado(YO, 'revisar', AMB, { pedido: 'revisa el último correo de la mañana' });
    assert.equal(r.estado, 'succeeded', r.texto);
    assert.match(r.texto, /ES EL ÚLTIMO QUE RECIBIÓ/, r.texto);
    assert.deepEqual(g.abiertos, [`${TRABAJO}:41`]);
    assert.equal(tareaDe(YO, AMB), null, 'no abre una tarea');
  } finally {
    C._buzonDePrueba(null);
    C._relojDePrueba(null);
  }
});
