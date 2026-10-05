/**
 * EL VISOR DE SU COMPUTADORA (mobile/src/lib/entradaRemota.ts, AUR09): la lógica pura del visor dedicado.
 *  · UNA sola capa de transformación de coordenadas (toque → píxel lógico del escritorio) que no se desalinea con
 *    zoom, pan, rotación ni cambio de tamaño;
 *  · gestos: toque = clic, doble toque, toque largo = clic derecho, mantener y mover = arrastre, mover = scroll (que
 *    nunca se confunde con un clic) y dos dedos = zoom y pan de la vista (nunca tocan el escritorio);
 *  · teclado: el texto se manda compuesto (IME: la composición final, no keydown + texto duplicados), con acentos y
 *    emoji enteros; teclas especiales y combinaciones de una lista blanca (la misma del servidor y del nodo);
 *    modificadores que se sueltan en blur, desconexión, toma del control y error;
 *  · frescura: la edad del frame, aviso a más de 2 s y bloqueo de lo riesgoso mientras la imagen no es la de ahora;
 *  · la sesión: secuencia por control, un ACK por entrada, nada se reproduce tras reconectar.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AcumuladorScroll,
  BufferTeclado,
  FRAME_VIEJO_MS,
  Gestos,
  Modificadores,
  SesionRemota,
  aLogico,
  aNormalizado,
  aPantalla,
  alternarZoom,
  bloqueoDeEntrada,
  comboPermitido,
  desplazar,
  edadFrame,
  esRiesgosa,
  intervaloCaptura,
  limitarVista,
  modoDeControl,
  normalizarTexto,
  transformacion,
  trocearTexto,
  vistaAjustada,
  zoomEn,
  type FrameMeta,
} from '../mobile/src/lib/entradaRemota';
import { comboPermitido as comboServidor } from '../server/computadora';

const FRAME = { ancho: 1280, alto: 800 };
const VERTICAL = { ancho: 390, alto: 700 };
const HORIZONTAL = { ancho: 844, alto: 390 };

test('coordenadas: ajustar centra el escritorio y un toque cae en el píxel lógico correcto (ida y vuelta)', () => {
  const v = vistaAjustada(FRAME);
  const T = transformacion(VERTICAL, FRAME, v);
  // 390 de ancho para 1280: escala 0,3047; la imagen ocupa 390 x 243,75, centrada en vertical.
  assert.ok(Math.abs(T.s - 390 / 1280) < 1e-9);
  assert.ok(Math.abs(T.ty - (700 - 800 * T.s) / 2) < 1e-9);
  assert.deepEqual(aLogico(T, FRAME, 195, 350), { x: 640, y: 400 }, 'el centro de la pantalla es el centro del escritorio');
  assert.equal(aLogico(T, FRAME, 195, 10), null, 'fuera de la imagen (la franja de arriba) no es un clic');
  for (const [x, y] of [[0, 0], [1279, 799], [100, 700], [1000, 33]]) {
    const p = aPantalla(T, x + 0.5, y + 0.5);
    assert.deepEqual(aLogico(T, FRAME, p.x, p.y), { x, y }, `ida y vuelta ${x},${y}`);
  }
  assert.deepEqual(aNormalizado({ x: 640, y: 400 }, FRAME), { x: 500, y: 500 }, 'para el nodo de antes, en [0, 1000]');
});

test('coordenadas: con zoom, pan, rotación y cambio de tamaño el mismo punto lógico queda bajo el mismo lugar', () => {
  // (Donde la imagen con zoom todavía cabe en un eje, ese eje queda centrado: por eso el foco va a media altura.)
  let v = zoomEn(VERTICAL, FRAME, vistaAjustada(FRAME), 2.5, { x: 100, y: 350 });
  const antes = aLogico(transformacion(VERTICAL, FRAME, vistaAjustada(FRAME)), FRAME, 100, 350)!;
  const despues = aLogico(transformacion(VERTICAL, FRAME, v), FRAME, 100, 350)!;
  assert.ok(Math.abs(antes.x - despues.x) <= 1 && Math.abs(antes.y - despues.y) <= 1, 'el zoom mantiene el punto bajo el dedo');
  v = desplazar(VERTICAL, FRAME, v, -40, 0);
  // Rotar: la vista guarda su centro en píxeles LÓGICOS, así que el centro de la pantalla sigue siendo el mismo punto.
  const centroV = aLogico(transformacion(VERTICAL, FRAME, v), FRAME, VERTICAL.ancho / 2, VERTICAL.alto / 2)!;
  const centroH = aLogico(transformacion(HORIZONTAL, FRAME, v), FRAME, HORIZONTAL.ancho / 2, HORIZONTAL.alto / 2)!;
  assert.ok(Math.abs(centroV.x - centroH.x) <= 1 && Math.abs(centroV.y - centroH.y) <= 1, `rotar no desalinea (${JSON.stringify([centroV, centroH])})`);
  // En cualquier tamaño (teclado abierto: la caja se achica) la ida y vuelta es exacta.
  for (const caja of [VERTICAL, HORIZONTAL, { ancho: 390, alto: 380 }, { ancho: 1024, alto: 1366 }]) {
    const T = transformacion(caja, FRAME, limitarVista(caja, FRAME, v));
    for (const [x, y] of [[640, 400], [10, 790], [1270, 5]]) {
      const p = aPantalla(T, x + 0.5, y + 0.5);
      const q = aLogico(T, FRAME, p.x, p.y);
      if (p.x < 0 || p.y < 0 || p.x >= caja.ancho || p.y >= caja.alto) continue; // fuera de la caja con zoom
      assert.deepEqual(q, { x, y }, `${caja.ancho}x${caja.alto} ${x},${y}`);
    }
  }
  // El pan no saca la imagen de la caja, y el zoom va de 1 a 4.
  const lejos = limitarVista(VERTICAL, FRAME, { zoom: 9, centro: { x: -500, y: 9000 } });
  assert.equal(lejos.zoom, 4);
  const T = transformacion(VERTICAL, FRAME, lejos);
  assert.ok(T.tx <= 0 && T.tx + FRAME.ancho * T.s >= VERTICAL.ancho, 'la imagen cubre la caja a lo ancho');
  assert.deepEqual(alternarZoom(VERTICAL, FRAME, lejos), vistaAjustada(FRAME), 'el botón vuelve a ajustar');
  assert.equal(alternarZoom(VERTICAL, FRAME, vistaAjustada(FRAME)).zoom, 2);
});

test('gestos: un toque es un clic (tras esperar un posible doble), dos toques son doble clic, el largo es clic derecho', () => {
  let t = 0;
  const g = new Gestos({ reloj: () => t });
  assert.deepEqual(g.inicio([{ x: 100, y: 100 }]), []);
  t = 80;
  assert.deepEqual(g.mover([{ x: 103, y: 102 }]), [], 'un temblor no es scroll');
  assert.deepEqual(g.fin([]), [], 'todavía puede ser un doble toque');
  t = 200;
  assert.deepEqual(g.tick(), []);
  t = 400;
  assert.deepEqual(g.tick(), [{ tipo: 'toque', x: 100, y: 100 }]);
  assert.deepEqual(g.tick(), [], 'una sola vez');
  // Doble.
  t = 1000;
  g.inicio([{ x: 50, y: 50 }]);
  t = 1060;
  g.fin([]);
  t = 1150;
  g.inicio([{ x: 55, y: 52 }]);
  t = 1200;
  assert.deepEqual(g.fin([]), [{ tipo: 'doble', x: 50, y: 50 }]);
  t = 2000;
  assert.deepEqual(g.tick(), [], 'el doble no deja además un clic');
  // Largo sin moverse: clic derecho.
  t = 3000;
  g.inicio([{ x: 10, y: 20 }]);
  t = 3700;
  assert.deepEqual(g.fin([]), [{ tipo: 'derecho', x: 10, y: 20 }]);
});

test('gestos: mover es scroll y nunca un clic; mantener y mover es arrastre; dos dedos solo mueven la vista', () => {
  let t = 0;
  const g = new Gestos({ reloj: () => t });
  g.inicio([{ x: 100, y: 300 }]);
  t = 50;
  const s1 = g.mover([{ x: 100, y: 260 }]);
  assert.deepEqual(s1, [{ tipo: 'scroll', x: 100, y: 300, dx: 0, dy: -40 }]);
  t = 90;
  assert.deepEqual(g.mover([{ x: 100, y: 240 }]), [{ tipo: 'scroll', x: 100, y: 300, dx: 0, dy: -20 }]);
  t = 120;
  assert.deepEqual(g.fin([]), []);
  t = 1000;
  assert.deepEqual(g.tick(), [], 'un scroll no deja un clic pendiente');
  // Mantener (≥ 450 ms) y mover: arrastre de inicio a fin.
  t = 2000;
  g.inicio([{ x: 10, y: 10 }]);
  t = 2500;
  assert.deepEqual(g.mover([{ x: 60, y: 90 }]), []);
  t = 2600;
  assert.deepEqual(g.fin([]), [{ tipo: 'arrastre', x: 10, y: 10, x2: 60, y2: 90 }]);
  // Dos dedos: zoom con foco en el medio y pan; al soltar, ningún clic.
  t = 4000;
  g.inicio([{ x: 100, y: 100 }]);
  g.inicio([{ x: 100, y: 100 }, { x: 200, y: 100 }]);
  const z = g.mover([{ x: 50, y: 100 }, { x: 250, y: 100 }]);
  assert.equal(z[0].tipo, 'zoom');
  assert.ok(z[0].tipo === 'zoom' && Math.abs(z[0].factor - 2) < 1e-9 && z[0].foco.x === 150);
  g.fin([{ x: 250, y: 100 }]);
  g.mover([{ x: 300, y: 100 }]);
  g.fin([]);
  t = 6000;
  assert.deepEqual(g.tick(), [], 'tras una pinza no hay clic');
  // El scroll se cuenta en pasos de rueda: el dedo sube → la página baja (positivo).
  const a = new AcumuladorScroll(40);
  assert.equal(a.sumar(-30), 0);
  assert.equal(a.sumar(-30), 1);
  assert.equal(a.sumar(100), -2);
  assert.equal(a.sumar(-4000), 10, 'como mucho 10 por envío');
});

test('teclado: el texto va compuesto al confirmar (IME), con acentos y emoji enteros; nada de keydown + texto duplicado', () => {
  const b = new BufferTeclado();
  // Lo que hace un teclado con composición (Android/iOS): el campo cambia varias veces antes del texto final.
  for (const parcial of ['c', 'ca', 'caf', 'cafe', 'café']) assert.deepEqual(b.cambiar(parcial, []), null);
  assert.deepEqual(b.confirmar(false), [{ type: 'text_commit', payload: { texto: 'café' } }], 'una sola entrada, la final');
  assert.deepEqual(b.confirmar(false), [], 'va en camino: no sale otra vez');
  // A3: el campo no se vacía al confirmar, sino cuando el lote dice que llegó (tests/teclado-remoto-lote.test.ts).
  assert.equal(b.texto, 'café');
  b.aplicado();
  assert.equal(b.texto, '');
  b.cambiar('café ☕ 👨‍👩‍👧', []);
  assert.deepEqual(b.confirmar(true), [
    { type: 'text_commit', payload: { texto: 'café ☕ 👨‍👩‍👧' } },
    { type: 'key', payload: { tecla: 'enter', mods: [] } },
  ]);
  b.aplicado();
  assert.deepEqual(b.confirmar(true), [{ type: 'key', payload: { tecla: 'enter', mods: [] } }], 'campo vacío: solo Enter');
  b.aplicado();
  // Pegar varias líneas: texto, Enter, texto (los saltos son la tecla Enter, no caracteres).
  b.cambiar('uno\ndos', []);
  assert.deepEqual(b.confirmar(false).map((e) => e.type), ['text_commit', 'key', 'text_commit']);
  assert.equal(normalizarTexto('a\u0000b\tc\u007f'), 'abc');
  // Trozos de 500 sin partir un emoji ni una secuencia con ZWJ.
  const largo = 'x'.repeat(499) + '👨‍👩‍👧' + 'y';
  const trozos = trocearTexto(largo, 500);
  assert.equal(trozos.join(''), largo);
  assert.ok(trozos.every((x) => x.length <= 500));
  assert.equal(trozos[0], 'x'.repeat(499), 'el emoji de familia no se parte');
});

test('teclado: Ctrl/Shift/Alt de la lista blanca (la misma del servidor), y se sueltan en blur, desconexión, toma y error', () => {
  const m = new Modificadores();
  m.alternar('ctrl');
  const b = new BufferTeclado();
  b.cambiar('ho', []);
  // Con Ctrl armado, la letra que entra es la combinación (y no se queda en el campo).
  assert.deepEqual(b.cambiar('hoc', m.activos()), { type: 'key', payload: { tecla: 'c', mods: ['ctrl'] } });
  assert.equal(b.texto, 'ho');
  assert.deepEqual(m.consumir(), ['ctrl']);
  assert.deepEqual(m.activos(), [], 'se usa una vez');
  m.alternar('ctrl');
  m.alternar('alt');
  assert.equal(b.cambiar('hoq', m.activos()), null, 'Ctrl+Alt+Q no está en la lista: no se manda');
  assert.ok(m.soltarTodo(), 'blur / desconexión / toma / error: se sueltan');
  assert.deepEqual(m.activos(), []);
  assert.equal(m.soltarTodo(), false);
  for (const [mods, tecla] of [[[], 'enter'], [[], 'tab'], [[], 'escape'], [[], 'backspace'], [[], 'delete'], [[], 'left'], [['ctrl'], 'c'], [['ctrl'], 'v'], [['ctrl'], 'a'], [['ctrl'], 'z'], [['shift'], 'tab'], [['shift'], 'right'], [['alt'], 'left'], [['ctrl', 'shift'], 'z']] as const) {
    assert.ok(comboPermitido([...mods], tecla), `${mods.join('+')}+${tecla}`);
  }
  for (const [mods, tecla] of [[[], 'c'], [['ctrl', 'alt'], 'delete'], [['alt'], 'f4'], [['ctrl'], 'q'], [[], 'super'], [['meta'], 'l']] as const) {
    assert.ok(!comboPermitido([...mods] as any, tecla), `${mods.join('+')}+${tecla} no`);
  }
  // La misma lista que el servidor: todas las combinaciones posibles dan lo mismo.
  const teclas = ['enter', 'tab', 'escape', 'backspace', 'delete', 'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown', 'space', 'f5', 'f4', 'super', ...'abcdefghijklmnopqrstuvwxyz0123456789'];
  const juegos = [[], ['ctrl'], ['shift'], ['alt'], ['ctrl', 'shift'], ['ctrl', 'alt'], ['shift', 'alt'], ['ctrl', 'shift', 'alt']] as const;
  for (const j of juegos) for (const k of teclas) assert.equal(comboPermitido([...j], k), comboServidor([...j], k), `${j.join('+')}+${k}`);
});

const meta = (o: Partial<FrameMeta> = {}): FrameMeta => ({ seq: 10, ts: 0, ancho: 1280, alto: 800, viewportRevision: 2, epoca: 3, privado: false, edadMs: 300, ...o });

test('frescura: la edad del frame no depende de la hora del teléfono; a más de 2 s se avisa y lo riesgoso espera', () => {
  assert.equal(FRAME_VIEJO_MS, 2000);
  assert.equal(edadFrame(meta({ edadMs: 300 }), 1000, 1500), 800);
  assert.equal(edadFrame(meta({ edadMs: 300 }), 1000, 900), 300, 'un reloj que retrocede no da edad negativa');
  assert.ok(esRiesgosa('pointer', { accion: 'click' }));
  assert.ok(esRiesgosa('key', { tecla: 'enter', mods: [] }));
  assert.ok(esRiesgosa('key', { tecla: 'v', mods: ['ctrl'] }));
  assert.ok(!esRiesgosa('key', { tecla: 'tab', mods: [] }));
  assert.ok(!esRiesgosa('scroll', { dy: 1 }));
  assert.ok(!esRiesgosa('text_commit', { texto: 'hola' }));
  const base = { ahora: 1500, resyncDesde: null, ultimoAckFrame: null };
  const click = { tipo: 'pointer' as const, payload: { accion: 'click' } };
  assert.equal(bloqueoDeEntrada({ ...click, ...base, frame: null }), 'sin_frame');
  assert.equal(bloqueoDeEntrada({ ...click, ...base, frame: { meta: meta(), recibidoEn: 1000 } }), null);
  assert.equal(bloqueoDeEntrada({ ...click, ...base, ahora: 3000, frame: { meta: meta(), recibidoEn: 1000 } }), 'viejo');
  assert.equal(bloqueoDeEntrada({ tipo: 'scroll', payload: { dy: 1 }, ...base, ahora: 9000, frame: { meta: meta(), recibidoEn: 1000 } }), null, 'bajar sí');
  assert.equal(bloqueoDeEntrada({ ...click, ...base, resyncDesde: 10, frame: { meta: meta(), recibidoEn: 1000 } }), 'resync');
  assert.equal(bloqueoDeEntrada({ ...click, ...base, resyncDesde: 10, frame: { meta: meta({ seq: 11 }), recibidoEn: 1000 } }), null);
  assert.equal(bloqueoDeEntrada({ ...click, ...base, ultimoAckFrame: 10, frame: { meta: meta(), recibidoEn: 1000 } }), 'tras_entrada', 'tras un clic, el siguiente espera una imagen de después');
  assert.equal(bloqueoDeEntrada({ tipo: 'release_all', payload: {}, ...base, frame: null }), null, 'soltar todo, siempre');
  // Con el control, la captura va más seguido (y nunca dos a la vez); con AURA, despacio.
  assert.equal(intervaloCaptura('tu', 300), 400);
  assert.equal(intervaloCaptura('tu', 900), 250);
  assert.equal(intervaloCaptura('aura', 300), 2000);
  assert.equal(modoDeControl({ estado: 'control', conectado: true, pidiendo: false }), 'tu');
  assert.equal(modoDeControl({ estado: 'trabajando', conectado: true, pidiendo: true }), 'pidiendo');
  assert.equal(modoDeControl({ estado: 'control', conectado: false, pidiendo: false }), 'sin_conexion');
  assert.equal(modoDeControl({ estado: 'pausada', conectado: true, pidiendo: false }), 'aura');
});

test('sesión: secuencia por control, un ACK por entrada, lo bloqueado no gasta secuencia y nada se reproduce tras reconectar', async () => {
  const enviadas: any[] = [];
  let falla: any = null;
  let t = 1000;
  const s = new SesionRemota({
    tareaId: 'a1',
    clientId: 'visor-abc12345',
    reloj: () => t,
    enviar: async (e) => {
      enviadas.push(e);
      if (falla) throw falla;
      return { secuencia: e.inputSequence, estado: 'hecha', ts: 0, frame_seq: 10, epoca: e.controlEpoch };
    },
  });
  assert.deepEqual(await s.entrada('key', { tecla: 'tab', mods: [] }), { ok: false, motivo: 'sin_control' });
  s.alFrame(meta({ seq: 10, epoca: 2 }), t); // lo que se veía mientras AURA controlaba
  s.alControl(3);
  // Tras tomar el control hace falta una imagen nueva (resync) antes de clicar.
  assert.deepEqual(await s.entrada('pointer', { accion: 'click', x: 1, y: 1 }), { ok: false, motivo: 'resync' });
  // Una imagen con la época de antes (pedida antes de tomar el control y llegada después) tampoco vale.
  s.alFrame(meta({ seq: 11, epoca: 2 }), t);
  assert.deepEqual(await s.entrada('pointer', { accion: 'click', x: 1, y: 1 }), { ok: false, motivo: 'resync' });
  assert.equal(enviadas.length, 0, 'lo bloqueado no sale ni gasta secuencia');
  s.alFrame(meta({ seq: 11 }), t);
  const r1 = await s.entrada('pointer', { accion: 'click', x: 640, y: 400 });
  assert.equal(r1.ok, true);
  assert.deepEqual(
    { ...enviadas[0], payload: undefined },
    { remoteSessionId: 'a1', clientId: 'visor-abc12345', controlEpoch: 3, inputSequence: 1, viewportRevision: 2, type: 'pointer', payload: undefined }
  );
  assert.equal((await s.entrada('text_commit', { texto: 'hola' })).ok, true);
  assert.equal(enviadas[1].inputSequence, 2);
  // Se cortó la red: lo que estaba en cola no se reenvía; al volver se sueltan teclas (release_all) y se pide imagen.
  s.mods.alternar('shift');
  falla = Object.assign(new Error('sin red'), { status: undefined });
  // Salió y no volvió el ACK: «incierta» (A3), no se sabe si se aplicó y no se repite sola.
  assert.deepEqual(await s.entrada('key', { tecla: 'tab', mods: [] }), { ok: false, motivo: 'desconectado', incierta: true });
  assert.deepEqual(s.mods.activos(), [], 'el modificador pulsado se suelta al perder la red');
  falla = null;
  const antes = enviadas.length;
  await s.alReconectar();
  assert.equal(enviadas.length, antes + 1);
  assert.equal(enviadas.at(-1).type, 'release_all');
  assert.equal(enviadas.at(-1).inputSequence, 4, 'una secuencia nueva: la 3 (sin confirmar) no se repite');
  assert.equal(enviadas.filter((e) => e.inputSequence === 3).length, 1);
  assert.deepEqual(await s.entrada('pointer', { accion: 'click', x: 1, y: 1 }), { ok: false, motivo: 'resync' });
  // Otro dispositivo tomó el control: el nodo dice «cliente»; aquí se suelta todo y se deja de mandar.
  s.alFrame(meta({ seq: 12 }), t);
  falla = Object.assign(new Error('Otro dispositivo tiene el control ahora.'), { status: 409, data: { code: 'cliente' } });
  assert.deepEqual(await s.entrada('pointer', { accion: 'click', x: 1, y: 1 }), { ok: false, motivo: 'cliente', error: 'Otro dispositivo tiene el control ahora.' });
  assert.equal(s.epoca, null, 'sin control hasta tomarlo otra vez');
  // Un control nuevo empieza su propia secuencia.
  falla = null;
  s.alControl(4);
  s.alFrame(meta({ seq: 13, epoca: 4 }), t);
  await s.entrada('key', { tecla: 'tab', mods: [] });
  assert.deepEqual({ e: enviadas.at(-1).controlEpoch, n: enviadas.at(-1).inputSequence }, { e: 4, n: 1 });
});
