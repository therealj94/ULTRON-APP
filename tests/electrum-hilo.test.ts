/**
 * EL HILO DE DR ELECTRUM.
 *
 * Lo que se fija acá es lo que hace que una pregunta de seguimiento signifique algo, y —sobre todo—
 * el defecto que la primera versión de la memoria introducía sin que se viera: Telegram pegaba el
 * hilo entero DENTRO del mensaje del usuario, y como el panel de especialistas se elige contando
 * palabras del oficio sobre el texto que llega, seis líneas hablando de un pórfido hacían que una
 * pregunta legal convocara al geólogo y dejara al legal minero fuera.
 *
 * Las dos últimas pruebas levantan un nodo de mentira y miran los mensajes DE VERDAD que saldrían
 * hacia el modelo. Comprobar la función que arma el historial no alcanzaría: lo que importa es que
 * el turno los mande con su rol y que la pregunta llegue sola a `convocar`.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  claveHilo,
  claveHiloDe,
  quienDelHilo,
  fusionarHiloElectrum,
  hiloDe,
  hiloDelCliente,
  olvidarHilo,
  recordarHilo,
  relojDeHilo,
  type TurnoHilo,
} from '../server/electrum/hilo';
import { convocar } from '../server/electrum/especialistas';

const persona = (texto: string): TurnoHilo => ({ rol: 'persona', texto });
const doctor = (texto: string): TurnoHilo => ({ rol: 'electrum', texto });

test('guardar y recuperar el hilo', async (t) => {
  t.afterEach(() => {
    olvidarHilo();
    relojDeHilo(() => Date.now());
  });

  await t.test('la ida y la vuelta quedan juntas y en orden', () => {
    const k = claveHilo('jose', 'mesa');
    recordarHilo(k, '¿qué concesiones hay en Danlí?', 'Hay tres: Cerro Partido, Quebrada Seca y La Esperanza.');
    assert.deepEqual(hiloDe(k), [
      { rol: 'persona', texto: '¿qué concesiones hay en Danlí?' },
      { rol: 'electrum', texto: 'Hay tres: Cerro Partido, Quebrada Seca y La Esperanza.' },
    ]);
  });

  await t.test('el hilo de uno no es el del otro', () => {
    recordarHilo(claveHilo('jose', 'mesa'), 'lo mío', 'contestado a José');
    recordarHilo(claveHilo('medardo', 'mesa'), 'lo suyo', 'contestado a Medardo');
    assert.equal(hiloDe(claveHilo('jose', 'mesa'))[0].texto, 'lo mío');
    assert.equal(hiloDe(claveHilo('medardo', 'mesa'))[0].texto, 'lo suyo');
  });

  await t.test('la mesa y Telegram son dos conversaciones de la misma persona', () => {
    recordarHilo(claveHilo('jose', 'mesa'), 'en la pantalla', 'ok pantalla');
    assert.deepEqual(hiloDe(claveHilo('jose', 'telegram')), []);
  });

  await t.test('no crece sin final: se queda con los últimos 24', () => {
    const k = claveHilo('jose', 'mesa');
    for (let i = 0; i < 40; i++) recordarHilo(k, `pregunta ${i}`, `respuesta ${i}`);
    const h = hiloDe(k);
    assert.equal(h.length, 24);
    assert.equal(h[h.length - 2].texto, 'pregunta 39');
  });

  await t.test('a las seis horas se olvida solo', () => {
    let t0 = 1_000_000;
    relojDeHilo(() => t0);
    const k = claveHilo('jose', 'mesa');
    recordarHilo(k, 'el expediente de Quebrada Seca', 'es de Minera Demo S.A.');
    assert.equal(hiloDe(k).length, 2);
    t0 += 6 * 60 * 60 * 1000 + 1;
    assert.deepEqual(hiloDe(k), [], 'un hilo de anteayer no es contexto, y lleva nombres adentro');
  });
});

/* ------------------------------------------------------------------ visitantes de la demo */

/**
 * Quien entra con la llave de la demostración no tiene sesión, así que no tiene nombre. Antes eso
 * los metía a todos en `anonimo·mesa`: un cliente veía como «lo que venían hablando» lo que otro
 * había consultado, y el «Borrá lo que hablamos» de uno le borraba la conversación al resto.
 */
test('cada visitante sin sesión lleva su propio hilo', async (t) => {
  t.afterEach(() => olvidarHilo());
  const visita = (ip: string, agente: string) => ({ ip, headers: { 'user-agent': agente } });
  const a = visita('190.5.1.10', 'Mozilla/5.0 (iPhone) Safari');
  const b = visita('190.5.1.11', 'Mozilla/5.0 (Windows) Chrome');

  await t.test('dos visitantes, dos hilos', () => {
    recordarHilo(claveHiloDe(null, a, 'mesa'), 'el expediente de Quebrada Seca', 'es de Minera Demo S.A.');
    assert.deepEqual(hiloDe(claveHiloDe(null, b, 'mesa')), [], 'el segundo no ve lo que consultó el primero');
    assert.equal(hiloDe(claveHiloDe(null, a, 'mesa')).length, 2, 'y el primero sigue con lo suyo');
  });

  await t.test('la misma IP con otro navegador es otro visitante', () => {
    const mismoIpOtroNavegador = visita('190.5.1.10', 'Mozilla/5.0 (Android) Firefox');
    assert.notEqual(claveHiloDe(null, a, 'mesa'), claveHiloDe(null, mismoIpOtroNavegador, 'mesa'));
  });

  await t.test('la huella es estable dentro del proceso y no lleva la IP en claro', () => {
    assert.equal(quienDelHilo(null, a), quienDelHilo(null, visita('190.5.1.10', 'Mozilla/5.0 (iPhone) Safari')));
    assert.match(quienDelHilo(null, a), /^visita:[0-9a-f]{24}$/);
    assert.ok(!claveHiloDe(null, a, 'mesa').includes('190.5.1.10'));
  });

  await t.test('borrar el hilo de uno no toca el del otro', () => {
    recordarHilo(claveHiloDe(null, a, 'mesa'), 'lo de A', 'contestado a A');
    recordarHilo(claveHiloDe(null, b, 'mesa'), 'lo de B', 'contestado a B');
    olvidarHilo(claveHiloDe(null, a, 'mesa'));
    assert.deepEqual(hiloDe(claveHiloDe(null, a, 'mesa')), []);
    assert.equal(hiloDe(claveHiloDe(null, b, 'mesa'))[0].texto, 'lo de B');
  });

  await t.test('con sesión manda la persona, venga del aparato que venga', () => {
    assert.equal(claveHiloDe('jose', a, 'mesa'), claveHilo('jose', 'mesa'));
    assert.equal(claveHiloDe('jose', b, 'mesa'), claveHilo('jose', 'mesa'));
  });
});

test('lo que manda el navegador no se cree a ojos cerrados', async (t) => {
  await t.test('lo que no tiene forma de turno se descarta', () => {
    assert.deepEqual(hiloDelCliente(null), []);
    assert.deepEqual(hiloDelCliente('hola'), []);
    assert.deepEqual(hiloDelCliente([null, 3, { texto: '' }, {}]), []);
  });

  await t.test('acepta el nombre de la web y el del teléfono', () => {
    assert.deepEqual(hiloDelCliente([{ rol: 'electrum', texto: 'a' }]), [{ rol: 'electrum', texto: 'a' }]);
    assert.deepEqual(hiloDelCliente([{ de: 'electrum', texto: 'b' }]), [{ rol: 'electrum', texto: 'b' }]);
    assert.deepEqual(hiloDelCliente([{ rol: 'cualquiera', texto: 'c' }]), [{ rol: 'persona', texto: 'c' }]);
  });

  await t.test('un mensaje enorme no se lleva la ventana del modelo', () => {
    const r = hiloDelCliente([{ rol: 'persona', texto: 'x'.repeat(50_000) }]);
    assert.equal(r[0].texto.length, 1500);
  });
});

test('fusionar lo del servidor con lo de la pantalla', async (t) => {
  await t.test('manda el servidor cuando tiene conversación', () => {
    const r = fusionarHiloElectrum({
      servidor: [persona('del servidor'), doctor('respuesta del servidor')],
      cliente: [persona('del navegador'), doctor('respuesta del navegador')],
      mensaje: '¿y el segundo?',
    });
    assert.equal(r[0].content, 'del servidor');
  });

  await t.test('entra el del navegador cuando Render acaba de reiniciar', () => {
    const r = fusionarHiloElectrum({
      servidor: [],
      cliente: [persona('del navegador'), doctor('respuesta del navegador')],
      mensaje: '¿y el segundo?',
    });
    assert.equal(r.length, 2);
    assert.equal(r[0].content, 'del navegador');
  });

  await t.test('los roles son los que el modelo entiende', () => {
    const r = fusionarHiloElectrum({ servidor: [persona('p'), doctor('d')], mensaje: 'x' });
    assert.deepEqual(r, [
      { role: 'user', content: 'p' },
      { role: 'assistant', content: 'd' },
    ]);
  });

  await t.test('la pregunta de ahora no se cuela dos veces', () => {
    // La pantalla pinta la pregunta ANTES de mandarla, así que puede venir ya en el hilo. Dejarla
    // haría que el modelo la viera repetida y creyera que se la insistieron.
    const r = fusionarHiloElectrum({
      servidor: [],
      cliente: [persona('primera'), doctor('contesto'), persona('¿y el segundo?')],
      mensaje: '¿y el segundo?',
    });
    assert.equal(r.length, 2);
    assert.equal(r[r.length - 1].role, 'assistant');
  });

  await t.test('el historial nunca empieza por una respuesta sin pregunta', () => {
    const r = fusionarHiloElectrum({ servidor: [], cliente: [doctor('suelta'), persona('p'), doctor('d')], mensaje: 'x' });
    assert.equal(r[0].role, 'user');
  });
});

/* ------------------------------------------------------------------ el defecto que importa */

test('el hilo NO se pega dentro de la pregunta', async (t) => {
  const previo =
    'LO QUE VENÍAN HABLANDO:\n' +
    'José: contame del yacimiento y la veta de ese pórfido\n' +
    'vos: es epitermal de alta sulfuración; la alteración es argílica avanzada\n' +
    'José: ¿y el método de explotación?\n' +
    'vos: por la geometría del cuerpo iría tajo a cielo abierto, con banco de 10 m; la dilución ronda el 8%\n' +
    'José: ¿qué flota de acarreo?\n' +
    'vos: camiones de 40 t; el descapote inicial es lo que se come el capital\n\n';
  const pregunta = '¿y cuándo vence?';

  await t.test('la pregunta sola convoca a quien toca', () => {
    assert.deepEqual(convocar(pregunta).map((e) => e.id), ['legal']);
  });

  await t.test('con el hilo pegado, el legal minero ni aparece', () => {
    // Esta es la razón de existir del módulo del hilo. Si algún día alguien vuelve a concatenar el
    // historial dentro del mensaje, esta prueba sigue en verde pero la de abajo se cae.
    const conHilo = convocar(previo + pregunta).map((e) => e.id);
    assert.ok(!conHilo.includes('legal'), 'el defecto es real: el legal queda fuera de su propia pregunta');
  });
});

/* ------------------------------------------------------------------ el turno de verdad */

/**
 * Un nodo de mentira que guarda lo que le mandan y contesta cualquier cosa.
 *
 * Uno solo para todo el archivo, y levantado ANTES del único `import` de `turno.ts`: `lib/nodo` lee
 * la URL del entorno al cargarse, y como los módulos se cachean, un segundo nodo en otra prueba
 * dejaría a la segunda llamada hablándole a un puerto ya cerrado. Se descubrió de la peor manera:
 * la prueba se colgó sesenta segundos esperando un servidor que ya no existía.
 */
const NODO: any[] = [];
const srv = http.createServer((req, res) => {
  let cuerpo = '';
  req.on('data', (c) => (cuerpo += c));
  req.on('end', () => {
    NODO.push(JSON.parse(cuerpo || '{}'));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ message: { content: 'Vence el 3 de marzo de 2027.' } }));
  });
});
await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
process.env.ULTRON_NODO_URL = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
process.env.ULTRON_NODO_SECRETO = 'prueba';
const { turnoElectrum } = await import('../server/electrum/turno');
// El nodo de mentira sirve también a la prueba contra el binario; se cierra cuando termina todo.
after(() => srv.close());

test('el turno manda el historial con su rol y la pregunta sola', async (t) => {
  NODO.length = 0;
  const historial = fusionarHiloElectrum({
    servidor: [
      persona('contame del yacimiento y la veta de ese pórfido'),
      doctor('es epitermal de alta sulfuración, con alteración argílica avanzada'),
      persona('¿y el método de explotación?'),
      doctor('tajo a cielo abierto, banco de 10 m, dilución cerca del 8%'),
    ],
    mensaje: '¿y cuándo vence?',
  });

  const salida = await turnoElectrum(
    '¿y cuándo vence?',
    { quien: null, nivel: 'lee', plataforma: 'electrum', canal: 'mesa', mensaje: '¿y cuándo vence?' },
    { historial }
  );
  const mensajes = NODO[0]?.messages || [];

  await t.test('el modelo recibió la conversación, no un pegote', () => {
    assert.deepEqual(
      mensajes.map((m: any) => m.role),
      ['system', 'user', 'assistant', 'user', 'assistant', 'user']
    );
  });

  await t.test('la última es la pregunta de ahora', () => {
    assert.match(mensajes[mensajes.length - 1].content, /¿y cuándo vence\?$/);
  });

  await t.test('ningún mensaje del usuario lleva el historial adentro', () => {
    for (const m of mensajes.filter((x: any) => x.role === 'user')) {
      assert.ok(!/LO QUE VENÍAN HABLANDO/.test(m.content));
    }
  });

  await t.test('el panel es el de la pregunta, no el del pasado', () => {
    // Con el hilo pegado esto daba «Ingeniero de Minas y Geólogo» para una pregunta de vigencia.
    assert.equal(salida.panel, 'Legal Minero');
  });

  await t.test('el system le avisa que esto viene de antes', () => {
    assert.match(mensajes[0].content, /ESTO VIENE DE ANTES/);
  });
});

test('sin historial el system no habla de conversación previa', async () => {
  NODO.length = 0;
  await turnoElectrum('¿cuándo vence Cerro Partido?', {
    quien: null,
    nivel: 'lee',
    plataforma: 'electrum',
    canal: 'mesa',
    mensaje: '¿cuándo vence Cerro Partido?',
  });
  const mensajes = NODO[0]?.messages || [];
  assert.deepEqual(
    mensajes.map((m: any) => m.role),
    ['system', 'user']
  );
  assert.ok(!/ESTO VIENE DE ANTES/.test(mensajes[0].content));
});

/* ------------------------------------------------------------------ contra el servidor compilado */

const SERVIDOR = path.join(process.cwd(), 'dist', 'server.cjs');
const HAY_BINARIO = fs.existsSync(SERVIDOR);

/**
 * Lo mismo, de punta a punta: dos visitantes con la llave de la demo contra el binario, y el nodo de
 * mentira de arriba mirando qué historial le llega al modelo en cada turno. Es la única forma de
 * saber que TODAS las rutas (turno, turno en vivo y el borrado) usan la misma llave de hilo.
 */
test('servidor: los visitantes de la demo no se ven entre sí', { skip: HAY_BINARIO ? false : 'sin dist/server.cjs: correr `npm run build` antes' }, async (t) => {
  const puerto = 7840 + Math.floor(Math.random() * 40);
  const base = `http://127.0.0.1:${puerto}`;
  const proc: ChildProcess = spawn('node', [SERVIDOR], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(puerto),
      PLATAFORMA: 'electrum',
      ELECTRUM_CLAVE: 'llave-de-la-demo',
      ULTRON_SESION_SECRETO: 'llave-de-sesion-de-la-prueba-0123456789',
      ULTRON_NODO_URL: process.env.ULTRON_NODO_URL,
      ULTRON_NODO_SECRETO: 'prueba',
      ELECTRUM_DB_URL: '',
      ELECTRUM_BOT_TOKEN: '',
      TELEGRAM_BOT_TOKEN: '',
      ULTRON_MEMORIA_BUCKET: '',
      AWS_ACCESS_KEY_ID: '',
      AWS_SECRET_ACCESS_KEY: '',
    },
    stdio: 'ignore',
    detached: true,
  });
  t.after(() => {
    try {
      process.kill(-proc.pid!);
    } catch {
      /* ya se fue */
    }
  });
  let listo = false;
  for (let i = 0; i < 60 && !listo; i++) {
    try {
      listo = (await fetch(`${base}/api/health`)).ok;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  assert.ok(listo, 'el servidor no levantó');

  const cabeceras = (agente: string) => ({ 'Content-Type': 'application/json', 'x-electrum-llave': 'llave-de-la-demo', 'User-Agent': agente });
  const ANA = 'Mozilla/5.0 (iPhone) visitante-ana';
  const BETO = 'Mozilla/5.0 (Windows) visitante-beto';
  /** Un turno y lo que el modelo recibió en él (todo lo que le llegó al nodo, junto). */
  const turno = async (agente: string, mensaje: string, ruta = '/api/electrum/turno') => {
    NODO.length = 0;
    const r = await fetch(`${base}${ruta}`, { method: 'POST', headers: cabeceras(agente), body: JSON.stringify({ mensaje }) });
    assert.equal(r.status, 200, `${ruta} contestó ${r.status}`);
    await r.text();
    return JSON.stringify(NODO);
  };

  await t.test('lo que pregunta Ana no le llega como contexto a Beto', async () => {
    await turno(ANA, 'soy Ana y miro el expediente Quebrada Seca');
    const vioBeto = await turno(BETO, '¿qué concesiones hay en Danlí?');
    assert.ok(!vioBeto.includes('Quebrada Seca'), 'el modelo de Beto no recibió la conversación de Ana');
    const vioAna = await turno(ANA, '¿y cuándo vence?', '/api/electrum/turno/stream');
    assert.ok(vioAna.includes('Quebrada Seca'), 'el turno en vivo de Ana sí trae su propio hilo');
  });

  await t.test('el borrado de Ana solo borra lo de Ana', async () => {
    const r = await fetch(`${base}/api/electrum/hilo`, { method: 'DELETE', headers: cabeceras(ANA) });
    assert.equal(r.status, 200);
    const vioAna = await turno(ANA, '¿de qué hablábamos?');
    assert.ok(!vioAna.includes('Quebrada Seca'), 'el hilo de Ana quedó limpio');
    const vioBeto = await turno(BETO, '¿y la segunda?');
    assert.ok(vioBeto.includes('Danlí'), 'el de Beto sigue entero');
  });
});
