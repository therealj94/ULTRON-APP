/**
 * Las herramientas de un turno hablado (lib/herramientas-turno.ts), con frases de verdad, como las dice José en
 * Honduras (auditoría del 10-oct: el 55 % de los turnos hablados llevó solo `buscar_web`; lo del teléfono, ninguna; un
 * «sí, mándalo» a la oferta de otro grupo perdía su herramienta en el filtro de «fuera de tema»).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { herramientasDelTurno, type ManosDelTurno } from '../lib/cerebro-manos';
import {
  HERRAMIENTAS_NUCLEO,
  HERRAMIENTAS_NUCLEO_EXTRA,
  herramientasDeLaOferta,
  herramientasSegunFrase,
  lineaHerramientasOfrecidas,
  nombresDelNucleo,
} from '../lib/herramientas-turno';

const COMPLETO: ManosDelTurno = {
  app: true,
  manos: ['llamar', 'leer', 'buscar', 'idioma', 'perfil', 'recordatorio', 'llamame', 'cartera', 'pagar', 'marcar'],
  sistema: true,
  computadora: true,
  correo: true,
  whatsapp: true,
  sesion: true,
  triaje: true,
  investigar: true,
  documentos: true,
  calendario: true,
} as ManosDelTurno;
const TODAS = herramientasDelTurno(COMPLETO);
const CONTACTOS = ['Mamá', 'Marisol', 'Beto', 'Ana'];
const nombre = (t: any) => String(t.toolSpec?.name || '');
const elegir = (mensaje: string, extra: Partial<Parameters<typeof herramientasSegunFrase>[1]> = {}) => {
  const e = herramientasSegunFrase(TODAS, { mensaje, contactos: CONTACTOS, ...extra });
  return { ...e, nombres: e.herramientas.map(nombre) };
};

test('el turno completo tiene las 29 y todo el núcleo', () => {
  assert.equal(TODAS.length, 29);
  for (const n of HERRAMIENTAS_NUCLEO) assert.ok(TODAS.some((t) => nombre(t) === n), n);
});

test('el núcleo va siempre, también en la charla, y pesa menos de la mitad de todas', () => {
  for (const m of ['¿Cómo te fue hoy?', 'Estoy cansado, fue un día largo', 'Cuéntame un chiste', '¿Qué opinas de la música de los noventa?']) {
    const e = elegir(m);
    for (const n of HERRAMIENTAS_NUCLEO) assert.ok(e.nombres.includes(n), `${m}: falta ${n}`);
    assert.equal(e.todas, false, m);
    assert.equal(e.nucleo, HERRAMIENTAS_NUCLEO.length, m);
  }
  const nucleo = TODAS.filter((t) => HERRAMIENTAS_NUCLEO.includes(nombre(t)));
  const car = JSON.stringify(nucleo).length;
  const todas = JSON.stringify(TODAS).length;
  assert.ok(car < todas * 0.5, `núcleo ${car} car. de ${todas}`);
});

test('pedidos de verdad (español de Honduras) → sus herramientas y su grupo de intención', () => {
  type Caso = [string, string[], string[], Partial<Parameters<typeof herramientasSegunFrase>[1]>?];
  const casos: Caso[] = [
    ['pon música', ['abrir_pantalla', 'buscar_web'], ['telefono']],
    ['ponme una de Los Bukis en Spotify', ['abrir_pantalla'], ['telefono']],
    ['pausa', ['tarea', 'abrir_pantalla'], ['telefono']],
    ['pausá la canción', ['abrir_pantalla'], ['telefono']],
    ['abre Spotify', ['abrir_pantalla', 'ajustar_app'], ['app', 'telefono']],
    ['despiértame a las 5:40', ['recordatorio', 'llamarme'], ['recordatorio']],
    ['¿cómo llego a la colonia Kennedy?', ['buscar_web'], ['telefono']],
    ['mándale a mi mamá por WhatsApp que ya voy en camino', ['whatsapp', 'circulo', 'chat_aura'], ['whatsapp', 'mensajes', 'circulo']],
    ['recuérdame sacar la basura a las 7', ['recordatorio', 'llamarme'], ['recordatorio']],
    ['llámame en 10', ['llamarme', 'circulo'], ['llamada']],
    ['llámame en diez minutos', ['llamarme'], ['llamada', 'recordatorio']],
    ['agéndame con el ingeniero el jueves a las 3', ['agendar', 'agenda'], ['calendario']],
    ['márcale a Beto', ['llamar_contacto', 'llamar_numero'], ['llamada']],
    ['¿qué me escribió Marisol?', ['whatsapp', 'leer_mensajes'], ['mensajes']],
    ['revisá mi correo, porfa', ['correo', 'ordenar_mensajes'], ['correo']],
    ['sí, mándalo', ['correo', 'contactos_vip'], ['correo'], { anterior: 'Le redacté el correo al ingeniero con el presupuesto. ¿Te lo mando por correo?' }],
    ['dale', ['correo', 'ordenar_mensajes'], ['correo'], { anterior: '¿Quieres que le conteste el correo a Beto?' }],
    ['y que me traiga pan', ['whatsapp', 'ordenar_mensajes'], ['whatsapp'], { anterior: 'Listo, le dejé el WhatsApp a Marisol: «Ya voy». ¿Lo envío?' }],
  ];
  for (const [m, necesita, grupos, extra] of casos) {
    const e = elegir(m, extra);
    for (const n of necesita) assert.ok(e.nombres.includes(n), `${m}: falta ${n} (lleva ${e.nombres.join(', ')})`);
    for (const g of grupos) assert.ok(e.grupos.includes(g), `${m}: falta el grupo ${g} (${e.grupos.join(', ')})`);
    for (const n of HERRAMIENTAS_NUCLEO) assert.ok(e.nombres.includes(n), `${m}: núcleo ${n}`);
    assert.equal(e.todas, false, `${m}: no van todas`);
  }
});

test('la intención se sigue viendo en los grupos (para el log y para el filtro de tema)', () => {
  assert.ok(elegir('recuérdame tomarme la pastilla').grupos.includes('recordatorio'));
  assert.ok(elegir('mándale a mi mamá por WhatsApp que ya voy').grupos.includes('whatsapp'));
  assert.ok(elegir('agéndame una cita el lunes').grupos.includes('calendario'));
  assert.ok(elegir('¿cómo llego a Valle de Ángeles?').grupos.includes('telefono'));
  assert.deepEqual(elegir('¿Cómo te fue hoy?').grupos, []);
  // La charla tras una oferta de WhatsApp no arrastra el grupo de mensajes.
  const anterior = 'Te quedó pendiente enviarle un WhatsApp a Marisol sobre la reunión.';
  const otra = elegir('Cámbiame el tema a oscuro', { anterior });
  assert.ok(!otra.grupos.includes('whatsapp') && !otra.grupos.includes('mensajes'), otra.grupos.join(','));
});

test('lo del teléfono ya no se queda sin manos: lleva las del teléfono (HERRAMIENTAS_NUCLEO_EXTRA) y el núcleo, nunca todas', () => {
  const sinExtra = elegir('pon música');
  assert.equal(sinExtra.todas, false);
  assert.ok(sinExtra.grupos.includes('telefono'));
  assert.ok(sinExtra.nombres.length > 1, 'antes: solo buscar_web');
  // Una mano nueva del teléfono entra sola en el núcleo.
  const falsa = { toolSpec: { name: 'musica_telefono', description: 'x', inputSchema: { json: { type: 'object', properties: {} } } } } as any;
  const antes = [...HERRAMIENTAS_NUCLEO_EXTRA];
  HERRAMIENTAS_NUCLEO_EXTRA.push('musica_telefono');
  try {
    assert.ok(nombresDelNucleo().includes('musica_telefono'));
    for (const m of ['pon música', 'pausa', 'abre Spotify', '¿cómo llego a la Kennedy?', '¿Cómo te fue hoy?']) {
      const e = herramientasSegunFrase([...TODAS, falsa], { mensaje: m });
      assert.ok(e.herramientas.some((t) => nombre(t) === 'musica_telefono'), m);
      assert.equal(e.todas, false, m);
    }
  } finally {
    HERRAMIENTAS_NUCLEO_EXTRA.splice(0, HERRAMIENTAS_NUCLEO_EXTRA.length, ...antes);
  }
});

test('ante la duda, todas (sigue igual)', () => {
  assert.equal(elegir('Encárgate de eso que te dije').todas, true);
  assert.equal(elegir('Sí, hazlo', { anterior: '¿Quieres que lo organice por ti?' }).todas, true);
});

test('herramientasDeLaOferta: un «sí» corto a la oferta de AU-RA conserva las de su grupo; cambiar de tema, no', () => {
  const correo = '¿Te lo mando por correo al ingeniero?';
  for (const m of ['sí', 'dale', 'mándalo', 'sí, mándalo', 'va pues']) assert.ok(herramientasDeLaOferta(m, correo).includes('correo'), m);
  const wa = '¿Le escribo a Marisol por WhatsApp que la reunión pasa a las 3?';
  assert.ok(herramientasDeLaOferta('sí', wa).includes('whatsapp'));
  // Lo que sigue a un WhatsApp sin palabras de mensajes.
  assert.ok(herramientasDeLaOferta('y que traiga pan', 'Listo, le dejé el WhatsApp a Marisol. ¿Lo envío?').includes('whatsapp'));
  assert.ok(herramientasDeLaOferta('agrégale que llego a las 8', 'Le preparé el WhatsApp a Beto: «voy tarde».').includes('whatsapp'));
  // No: un «no», otra pregunta larga, o sin AU-RA antes.
  assert.deepEqual(herramientasDeLaOferta('no', wa), []);
  assert.deepEqual(herramientasDeLaOferta('¿Y tú cómo pasaste la semana?', wa), []);
  assert.deepEqual(herramientasDeLaOferta('sí', undefined), []);
  assert.deepEqual(herramientasDeLaOferta('y qué tal el clima', '¿Cómo te fue en la mina?'), []);
});

test('la línea del log: «herramientas ofrecidas N/29 (núcleo+intención)»', () => {
  const e = elegir('mándale a mi mamá por WhatsApp que ya voy');
  assert.match(lineaHerramientasOfrecidas(e, TODAS.length), /^herramientas ofrecidas \d+\/29 \(núcleo 11\+intención .*whatsapp/);
  assert.match(lineaHerramientasOfrecidas(elegir('¿Cómo te fue hoy?'), 29), /^herramientas ofrecidas 11\/29 \(núcleo 11\+intención ninguna\)$/);
  assert.match(lineaHerramientasOfrecidas(elegir('Encárgate de eso que te dije'), 29), /^herramientas ofrecidas 29\/29 \(todas/);
});

test('server.ts: la línea por turno, la re-pregunta con todas y sin filtro de tema, y la oferta que el filtro respeta', () => {
  const s = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  assert.match(s, /lineaHerramientasOfrecidas\(eleccionManos, herramientasTodas\.length\)/);
  assert.match(s, /re-pregunta saltó el filtro de tema/);
  assert.match(s, /deLaOferta\.has\(nombre\)/);
  // La re-pregunta usa TODAS y su `usar` ya no descarta por tema.
  const i = s.indexOf('promesa = await cumplirLoDicho({');
  const trozo = s.slice(i, i + 1600);
  assert.match(trozo, /herramientasTodas,\s*senal/);
  assert.doesNotMatch(trozo, /if \(fueraDeTema\(h\.nombre, h\.input\)\) return false/);
});

test('las manos del teléfono del núcleo son las mismas que define el cerebro (lib/cerebro-manos.ts HERRAMIENTAS_TELEFONO)', async () => {
  const { HERRAMIENTAS_NUCLEO_EXTRA } = await import('../lib/herramientas-turno');
  const { HERRAMIENTAS_TELEFONO } = await import('../lib/cerebro-manos');
  assert.deepEqual([...HERRAMIENTAS_NUCLEO_EXTRA].sort(), [...HERRAMIENTAS_TELEFONO].sort());
});
