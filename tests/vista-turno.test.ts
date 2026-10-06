/**
 * LA CÁMARA EN VIVO SIN TRABAR LA MESA (José, 6-oct, Samsung SM-S942B con la 5.5.0).
 *
 *   mesa: contestó con voz 38871 ms después de la frase · esc 28828/v1 env 28829 …
 *
 * El turno de «¿qué ves?» esperaba la foto y al servidor (hasta 35 s) antes de salir; el servidor fallaba siempre y
 * la subida de la cámara insistía cada 20 s. Aquí, sin teléfono:
 *
 *  · mobile/src/lib/vistaTurno.ts: el turno NUNCA espera a la visión más de ~1,5 s; «¿qué ves?» con una vista fresca
 *    contesta sin foto ni servidor; si el servidor tarda, el turno sale con la foto y la vista llega después;
 *  · mobile/src/lib/subidaEscena.ts + intervaloServidor: la escena se refresca sola cuando ML Kit ve un cambio
 *    (sin «Comenta lo que ve» también) y, con el servidor fallando, cada fallo espacia la siguiente subida;
 *  · mobile/src/lib/pulsoJs.ts DetectorBloqueo y mobile/src/lib/salidasPrevias.ts: las migas que distinguen un hilo de
 *    JS trabado y un «no responde» de Android (ANR) de un crash.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VISTA_TURNO, VistaFresca, vistaParaTurno, type RespuestaDeVista } from '../mobile/src/lib/vistaTurno';
import { SubidaEscena } from '../mobile/src/lib/subidaEscena';
import { CercoCamara } from '../mobile/src/lib/cercoCamara';
import { SUBIDA, intervaloServidor, type VistaCamara } from '../mobile/src/lib/vistaCamara';
import { DetectorBloqueo, PulsoJs } from '../mobile/src/lib/pulsoJs';
import { PRIMERA_VEZ_MS, lineaSalida, salidasNuevas } from '../mobile/src/lib/salidasPrevias';

const B64 = 'A'.repeat(6000);
const vista = (escena = 'Un hombre con camisa azul frente a una laptop'): VistaCamara => ({
  escena,
  lugar: 'oficina',
  personas: [{ que_hace: 'trabaja', donde: 'centro' }],
  objetos: [{ nombre: 'laptop', donde: 'izquierda' }],
  textos: [],
  precios: [],
  principal: '',
  cajasFiables: false,
  formato: 'json',
});
const respuesta = (v = vista()): RespuestaDeVista => ({ vista: v, visto: `Escena: ${v.escena}. Contesta lo que se ve en dos frases.`, etiquetas: ['persona', 'laptop'], estructurada: true });
const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const nunca = <T>() => new Promise<T>(() => {});

/* ── el turno de «¿qué ves?» ─────────────────────────────────────────────────────────────── */

test('«¿qué ves?» con una vista fresca de la misma cámara: al instante, sin foto ni servidor', async () => {
  const g = new VistaFresca();
  g.guardar({ vista: vista(), visto: 'Escena: un hombre frente a una laptop.', ts: 100_000, lado: 'frontal', personas: 1, foto: B64 });
  let fotos = 0;
  let pedidos = 0;
  const io = { ahora: () => 108_000, foto: async () => (fotos++, B64), ver: async () => (pedidos++, respuesta()) };
  const r = await vistaParaTurno(io, 'escena', { lado: 'frontal', personas: 1, guardadas: g });
  assert.equal(r.tipo, 'fresca');
  assert.equal(fotos + pedidos, 0, 'ni foto ni servidor');
  if (r.tipo === 'fresca') {
    assert.equal(r.edadMs, 8000);
    assert.match(r.visto, /laptop/);
    assert.equal(r.foto, B64, 'con su foto para «Lo que vi»');
  }
  // Otra cámara, otra gente o vieja: no vale.
  assert.equal(g.fresca({ ahora: 108_000, lado: 'trasera' }), null);
  assert.equal(g.fresca({ ahora: 108_000, lado: 'frontal', personas: 2 }), null, 'llegó alguien: la escena ya es otra');
  assert.equal(g.fresca({ ahora: 100_000 + VISTA_TURNO.frescaMs + 1, lado: 'frontal' }), null);
  // Para leer o «qué es esto» se pide una foto nueva (lo que se acerca no estaba en la de antes).
  const leer = await vistaParaTurno(io, 'leer', { lado: 'frontal', personas: 1, guardadas: g, esperaMs: 200 });
  assert.equal(leer.tipo, 'vista');
  assert.equal(fotos, 1);
});

test('el servidor que no contesta (el 503 de 30 s del 6-oct) no traba el turno: sale con la foto y la vista llega después', async () => {
  let soltar: (r: RespuestaDeVista | null) => void = () => {};
  const tarde = new Promise<RespuestaDeVista | null>((r) => (soltar = r));
  const io = { ahora: Date.now, foto: async () => B64, ver: () => tarde };
  const t0 = Date.now();
  const r = await vistaParaTurno(io, 'escena', { lado: 'frontal', guardadas: new VistaFresca(), esperaMs: 300 });
  const ms = Date.now() - t0;
  assert.equal(r.tipo, 'foto');
  assert.ok(ms < 800, `esperó ${ms} ms; el tope era 300`);
  if (r.tipo !== 'foto') return;
  assert.equal(r.motivo, 'tarde');
  assert.equal(r.foto, B64, 'la foto va en el turno: el servidor la mira dentro');
  soltar(respuesta());
  const despues = await r.tarde;
  assert.equal(despues?.vista?.escena, vista().escena, 'lo que vuelva se aplica después (Lo que vi, la vista fresca)');
});

test('revisión del 6-oct: la vista que llega tarde se guarda con la cámara y la gente de cuando se SACÓ la foto', async () => {
  let soltar: (r: RespuestaDeVista | null) => void = () => {};
  const tarde = new Promise<RespuestaDeVista | null>((r) => (soltar = r));
  let ahora = { lado: 'frontal', personas: 1 };
  const io = { ahora: Date.now, foto: async () => B64, escena: () => ({ ...ahora }), ver: () => tarde };
  const r = await vistaParaTurno(io, 'escena', { lado: 'frontal', personas: 1, guardadas: new VistaFresca(), esperaMs: 100 });
  assert.equal(r.tipo, 'foto');
  if (r.tipo !== 'foto') return;
  // Mientras el servidor miraba: cambió a la trasera y llegó alguien.
  ahora = { lado: 'trasera', personas: 2 };
  soltar(respuesta());
  await r.tarde;
  assert.deepEqual(r.alSacar, { lado: 'frontal', personas: 1 }, 'lo de la foto, no lo del momento de la respuesta');
  // Con la del turno a tiempo, igual.
  const ok = await vistaParaTurno({ ahora: Date.now, foto: async () => B64, escena: () => ({ lado: 'trasera', personas: 0 }), ver: async () => respuesta() }, 'escena', { lado: 'trasera', guardadas: new VistaFresca(), esperaMs: 500 });
  assert.equal(ok.tipo, 'vista');
  if (ok.tipo === 'vista') assert.deepEqual(ok.alSacar, { lado: 'trasera', personas: 0 });
  // Sin `escena` (quien no lo pasa): lo que pidió el turno.
  const sin = await vistaParaTurno({ ahora: Date.now, foto: async () => B64, ver: async () => respuesta() }, 'escena', { lado: 'frontal', personas: 3, guardadas: new VistaFresca(), esperaMs: 500 });
  if (sin.tipo === 'vista') assert.deepEqual(sin.alSacar, { lado: 'frontal', personas: 3 });
  // DeskScreen guarda con eso (antes: `lado: ladoCamaraRef.current` y las personas del momento de la respuesta).
  const desk = readFileSync(new URL('../mobile/src/screens/DeskScreen.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(desk, /vistaFresca\.guardar\(\{[^}]*lado: ladoCamaraRef\.current/, 'ninguna vista se guarda con el lado del momento de guardarla');
  assert.match(desk, /vistaFresca\.guardar\(\{ vista: r\.vista, visto: r\.estructurada \? r\.visto : '', ts: tomadaEn, lado: ladoFoto, personas: personasFoto, foto \}\)/);
  assert.match(desk, /lado: vt\.alSacar\.lado, personas: vt\.alSacar\.personas/);
});

test('revisión del 6-oct: la vista fresca (foto + lo visto) no sobrevive a un cambio de cuenta ni a desmontar la mesa', async () => {
  const { vistaFresca } = await import('../mobile/src/lib/vistaTurno');
  const { fijarCuenta, _reiniciarCuenta } = await import('../mobile/src/lib/cuenta');
  _reiniciarCuenta();
  fijarCuenta('ana@prueba.local');
  const guardar = () => vistaFresca.guardar({ vista: vista(), visto: 'Escena de Ana.', ts: Date.now(), lado: 'frontal', personas: 1, foto: B64 });
  guardar();
  assert.ok(vistaFresca.fresca({ ahora: Date.now(), lado: 'frontal' }));
  fijarCuenta('beto@prueba.local');
  assert.equal(vistaFresca.ultimaVista(), null, 'entró otra persona: la foto y lo visto de Ana ya no están');
  guardar();
  fijarCuenta(null);
  assert.equal(vistaFresca.ultimaVista(), null, 'al cerrar sesión, tampoco');
  _reiniciarCuenta();
  const desk = readFileSync(new URL('../mobile/src/screens/DeskScreen.tsx', import.meta.url), 'utf8');
  assert.match(desk, /useEffect\(\(\) => \(\) => vistaFresca\.invalidar\(\), \[\]\);/, 'la mesa la suelta al desmontarse');
});

test('con los topes de la app: nunca más de ~1,5 s por la visión ni ~1,5 s por la foto, aunque nada conteste', async () => {
  assert.ok(VISTA_TURNO.esperaMs <= 1500 && VISTA_TURNO.fotoMs <= 1500);
  const t0 = Date.now();
  const sinServidor = await vistaParaTurno({ ahora: Date.now, foto: async () => B64, ver: () => nunca() }, 'escena', { lado: 'frontal', guardadas: new VistaFresca() });
  assert.equal(sinServidor.tipo, 'foto');
  const t1 = Date.now();
  const sinFoto = await vistaParaTurno({ ahora: Date.now, foto: () => nunca(), ver: async () => respuesta() }, 'escena', { lado: 'frontal', guardadas: new VistaFresca() });
  assert.equal(sinFoto.tipo, 'sin_foto');
  const t2 = Date.now();
  assert.ok(t1 - t0 < VISTA_TURNO.esperaMs + 400, `servidor colgado: ${t1 - t0} ms`);
  assert.ok(t2 - t1 < VISTA_TURNO.fotoMs + 400, `foto colgada: ${t2 - t1} ms`);
});

test('el servidor contesta a tiempo: el turno lleva lo visto como texto (la foto no viaja dos veces); si no pudo ver, la foto', async () => {
  const ok = await vistaParaTurno({ ahora: Date.now, foto: async () => B64, ver: async () => (await dormir(20), respuesta()) }, 'precio', { lado: 'trasera', guardadas: new VistaFresca(), esperaMs: 500 });
  assert.equal(ok.tipo, 'vista');
  if (ok.tipo === 'vista') assert.match(ok.visto, /Contesta/);
  const fallo = await vistaParaTurno({ ahora: Date.now, foto: async () => B64, ver: async () => null }, 'escena', { lado: 'frontal', guardadas: new VistaFresca(), esperaMs: 500 });
  assert.equal(fallo.tipo, 'foto');
  if (fallo.tipo === 'foto') assert.equal(fallo.motivo, 'sin_vista');
});

/* ── la escena se refresca sola, barata ──────────────────────────────────────────────────── */

test('sin «Comenta lo que ve»: una vista al abrir y otra solo cuando ML Kit ve un cambio (como mucho cada 15 s)', async () => {
  let ahora = 100_000;
  let cambioEn = 0;
  let personas = 1;
  const aplicadas: { ts: number; foto?: string }[] = [];
  let pedidos = 0;
  const s = new SubidaEscena(
    {
      ahora: () => ahora,
      foto: async () => ({ b64: B64, ts: ahora, lado: 'frontal' }),
      ver: async () => (pedidos++, vista()),
      estado: () => ({ dormida: false, personas, necesitaEscena: false, ocupada: false, cambioEn }),
      aplicar: (v) => aplicadas.push(v),
    },
    new CercoCamara('frontal')
  );
  await s.tic();
  assert.equal(pedidos, 1, 'la primera, para tener qué decir si preguntan');
  assert.equal(aplicadas[0].foto, B64, 'la vista va con su foto (vista fresca y «Lo que vi»)');
  for (let i = 0; i < 60; i++) {
    ahora += 1000;
    await s.tic();
  }
  assert.equal(pedidos, 1, 'escena quieta: no se sube nada más');
  personas = 2;
  cambioEn = ahora;
  ahora += 1000;
  await s.tic();
  assert.equal(pedidos, 2, 'llegó alguien: otra vista');
  cambioEn = ahora + 500;
  ahora += 3000;
  await s.tic();
  assert.equal(pedidos, 2, `otro cambio enseguida: espera ${SUBIDA.vivoMs} ms`);
  ahora += SUBIDA.vivoMs;
  await s.tic();
  assert.equal(pedidos, 3);
});

test('revisión del 6-oct: mover el teléfono solo cuenta si se queda quieto en la posición nueva, y hay tope por hora', async () => {
  let ahora = 100_000;
  let movidaEn = 0;
  let cambioEn = 0;
  const subidas: number[] = [];
  const descartes: string[] = [];
  const s = new SubidaEscena(
    {
      ahora: () => ahora,
      foto: async () => ({ b64: B64, ts: ahora, lado: 'frontal' }),
      ver: async () => (subidas.push(ahora), vista(`escena ${subidas.length}`)),
      estado: () => ({ dormida: false, personas: 1, necesitaEscena: false, ocupada: false, cambioEn, movidaEn }),
      aplicar: () => {},
      descartada: (m) => descartes.push(m),
    },
    new CercoCamara('frontal')
  );
  await s.tic();
  assert.equal(subidas.length, 1, 'la primera vista');
  // Caminando con el teléfono en la mano 2 minutos: se mueve cada segundo. Antes: una subida cada 15 s.
  for (let i = 0; i < 120; i++) {
    ahora += 1000;
    movidaEn = ahora;
    await s.tic();
  }
  assert.equal(subidas.length, 1, `en movimiento no se sube nada (${subidas.length - 1} de más)`);
  // Se queda quieto en la posición nueva: una vista, cuando se asentó.
  for (let i = 0; i < 5; i++) {
    ahora += 1000;
    await s.tic();
  }
  assert.equal(subidas.length, 2, 'asentado en la escena nueva: una vista');
  assert.ok(subidas[1] - movidaEn >= SUBIDA.quietoTrasMoverMs, 'después de quedarse quieto');
  // El tope por hora: una escena que cambia sin parar (ML Kit ve llegar e irse gente) no pasa de SUBIDA.vivoMaxHora.
  const desde = ahora;
  for (let i = 0; i < 3600; i++) {
    ahora += 1000;
    cambioEn = ahora - 1;
    await s.tic();
  }
  const enLaHora = subidas.filter((t) => t > desde && t <= desde + 3_600_000).length;
  assert.equal(SUBIDA.vivoMaxHora, 40, 'el tope documentado');
  assert.ok(enLaHora <= SUBIDA.vivoMaxHora, `${enLaHora} subidas en una hora (antes, hasta 240)`);
  assert.ok(enLaHora >= SUBIDA.vivoMaxHora - 2, `y sí sube hasta el tope (${enLaHora})`);
  assert.equal(descartes.filter((m) => /tope de 40 subidas en vivo por hora/.test(m)).length >= 1, true, 'queda en las migas');
  assert.ok(descartes.length < 10, 'una miga por vez que se llega al tope, no una por segundo');
  // «Comenta lo que ve» (lo pidió la persona) no tiene este tope.
  const conComenta: number[] = [];
  let t2 = 100_000;
  const s2 = new SubidaEscena(
    { ahora: () => t2, foto: async () => ({ b64: B64, ts: t2, lado: 'frontal' }), ver: async () => (conComenta.push(t2), { ...vista(`c ${conComenta.length}`), lugar: `lugar ${conComenta.length}`, objetos: ['a', 'b', 'c'].map((x) => ({ nombre: `${x}${conComenta.length}`, donde: 'izquierda' })), personas: [] }), estado: () => ({ dormida: false, personas: 1, necesitaEscena: true, ocupada: false }), aplicar: () => {} },
    new CercoCamara('frontal')
  );
  for (let i = 0; i < 3600; i++) {
    await s2.tic();
    t2 += 1000;
  }
  assert.ok(conComenta.length > SUBIDA.vivoMaxHora, `con «Comenta lo que ve», su ritmo de siempre (${conComenta.length})`);
});

test('con el servidor fallando (503 seguidos), cada fallo espacia la siguiente subida; al volver, el ritmo de siempre', async () => {
  let ahora = 100_000;
  let falla = true;
  const subidas: number[] = [];
  const s = new SubidaEscena(
    {
      ahora: () => ahora,
      foto: async () => ({ b64: B64, ts: ahora, lado: 'frontal' }),
      ver: async () => (subidas.push(ahora), falla ? null : vista()),
      estado: () => ({ dormida: false, personas: 1, necesitaEscena: true, ocupada: false }),
      aplicar: () => {},
    },
    new CercoCamara('frontal')
  );
  for (let i = 0; i < 600; i++) {
    await s.tic();
    ahora += 1000;
  }
  // Antes: 30 subidas en 10 minutos (una cada 20 s, José, 6-oct). Ahora: 20 s, 40 s, 80 s, 120 s, 120 s…
  assert.ok(subidas.length <= 8, `${subidas.length} subidas en 10 min con el servidor caído`);
  const gaps = subidas.slice(1).map((t, i) => t - subidas[i]);
  assert.ok(gaps.every((g, i) => i === 0 || g >= gaps[i - 1]), `cada vez más espaciadas: ${gaps.join(', ')}`);
  assert.ok(Math.max(...gaps) <= SUBIDA.fallosMaxMs + 1000);
  falla = false;
  ahora += SUBIDA.fallosMaxMs;
  await s.tic();
  const n = subidas.length;
  ahora += SUBIDA.conPersonaMs;
  await s.tic();
  assert.equal(subidas.length, n + 1, 'con el servidor de vuelta, cada 20 s como siempre');
  assert.equal(intervaloServidor({ mlkit: true, dormida: false, conPersona: true, necesitaEscena: true, sinCambios: 0, fallos: 0 }), SUBIDA.conPersonaMs);
  assert.equal(intervaloServidor({ mlkit: true, dormida: false, conPersona: true, necesitaEscena: false, sinCambios: 0 }), Infinity, 'sin cambio ni «Comenta», nada');
  assert.equal(intervaloServidor({ mlkit: true, dormida: false, conPersona: true, necesitaEscena: false, sinCambios: 0, cambio: true }), SUBIDA.vivoMs);
  assert.equal(intervaloServidor({ mlkit: true, dormida: false, conPersona: true, necesitaEscena: false, sinCambios: 0, cambio: true, ocupada: true }), Infinity, 'la voz primero');
});

/* ── las migas de un bloqueo ─────────────────────────────────────────────────────────────── */

test('el hilo de JS trabado ≥ 1,5 s es una miga; ≥ 5 s, grave (Android puede decir «no responde»); sin repetir cada tic', () => {
  const p = new PulsoJs(200);
  assert.equal(p.tic(1000), 0);
  assert.equal(p.tic(1200), 0);
  assert.equal(p.tic(3900), 2500, 'el tic devuelve cuánto llegó tarde');
  const d = new DetectorBloqueo();
  assert.equal(d.revisar(300, 1000), null, 'un tropiezo no es un bloqueo');
  assert.deepEqual(d.revisar(2500, 2000), { ms: 2500, grave: false });
  assert.equal(d.revisar(1800, 4000), null, 'otro menor enseguida: no se repite');
  assert.deepEqual(d.revisar(6100, 5000), { ms: 6100, grave: true }, 'uno peor sí, aunque sea enseguida');
  assert.deepEqual(d.revisar(1600, 20_000), { ms: 1600, grave: false }, 'pasado el rato, cuenta otra vez');
});

test('cómo terminó antes según Android: un «anr» de hoy se cuenta una vez; lo que la persona cerró, no', () => {
  const ahora = Date.UTC(2026, 9, 6, 17, 30);
  const lista = [
    { motivo: 'la-persona', ts: ahora - 60_000, importancia: 400 },
    { motivo: 'anr', ts: ahora - 12 * 60_000, descripcion: 'Input dispatching timed out (Waiting to send non-key event)', importancia: 100, rssKb: 420_000 },
    { motivo: 'memoria', ts: ahora - PRIMERA_VEZ_MS - 60_000 },
  ];
  const primera = salidasNuevas(lista, 0, ahora);
  assert.deepEqual(
    primera.nuevas.map((s) => s.motivo),
    ['anr'],
    'la primera vez: solo las de las últimas 48 h y con problema'
  );
  assert.equal(primera.hasta, ahora - 60_000);
  assert.equal(lineaSalida(primera.nuevas[0], ahora), 'salida previa: anr hace 12 min, en primer plano, 410 MB · Input dispatching timed out (Waiting to send non-key event)');
  assert.deepEqual(salidasNuevas(lista, primera.hasta, ahora).nuevas, [], 'ya contadas: no se repiten');
  const otra = salidasNuevas([{ motivo: 'crash-nativo', ts: ahora + 5000 }, ...lista], primera.hasta, ahora + 10_000);
  assert.deepEqual(
    otra.nuevas.map((s) => s.motivo),
    ['crash-nativo']
  );
});
