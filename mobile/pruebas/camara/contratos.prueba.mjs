/**
 * Pruebas en Node de los CONTRATOS DE LA CÁMARA EN VIVO del master §25 (CAM-A…CAM-G y el interruptor remoto), sin
 * teléfono: la implementación real con su IO por fuera (reloj, foto, servidor, disco simulados) y costuras leídas
 * del código donde lo que se prueba es una conexión (React, Kotlin). Cada prueba importa lo suyo por separado: si un
 * módulo falta, falla solo esa prueba (así se ve qué fallaba antes del cambio).
 *
 *   cd mobile && npx tsx pruebas/camara/contratos.prueba.mjs
 *
 * Lo que NO prueba (pendiente de hardware): latencia captura→pose real, el reloj del sensor de cada teléfono
 * (SENSOR_INFO_TIMESTAMP_SOURCE), la compilación del Kotlin (la hace el CI) ni la voz con la cámara encendida.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MOVIL = path.resolve(AQUI, '../..');
const RAIZ = path.resolve(MOVIL, '..');
const leer = (f) => fs.readFileSync(path.join(MOVIL, f), 'utf8');
const leerRaiz = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const KT = 'modules/aura-camara/android/src/main/java/expo/modules/auracamara/';
const m = (f) => import(path.join(MOVIL, f));

let fallos = 0;
let n = 0;
const pruebas = [];
const prueba = (nombre, f) => pruebas.push([nombre, f]);

/** Un evento del nativo como lo arma AuraCamaraView.emitirSiCambio. */
const evento = (ts, extra = {}) => ({ caras: [{ id: 1, foto: { x: 0.4, y: 0.3, w: 0.2, h: 0.27 }, yaw: 0, pitch: 0, roll: 0, sonrisa: 0.1, ojos: 0.9 }], w: 400, h: 300, iw: 640, ih: 480, ms: 18, fps: 15, ts, lado: 'frontal', espejo: true, ...extra });
const vista = (extra = {}) => ({ escena: 'una mesa', lugar: '', personas: [], objetos: [{ nombre: 'taza', donde: '', caja: { x: 0.1, y: 0.7, w: 0.1, h: 0.1 } }], textos: [], precios: [], principal: '', cajasFiables: true, formato: 'json', ...extra });
const B64 = 'x'.repeat(5000);
/** Una promesa que se resuelve a mano (el servidor que tarda). */
function pendiente() {
  let resolver;
  const p = new Promise((r) => (resolver = r));
  return { p, resolver };
}

/* ── CAM-A: la mirada, separada del render de React ─────────────────────────────────────────── */

prueba('CAM-A mirada: con eventos a 15 Hz el cuerpo recibe una pose nueva en casi cada cuadro de 33 ms (antes ≤ 4 Hz), suave y con velocidad acotada', async () => {
  const costura = leer('src/screens/DeskScreen.tsx');
  const onGaze = costura.slice(costura.indexOf('const onGazeCam = useCallback'), costura.indexOf('const onGazeCam = useCallback') + 700);
  assert.doesNotMatch(onGaze, /< 250/, 'sin el tope de 250 ms en el camino de la cámara');
  assert.doesNotMatch(onGaze, /setGaze\(/, 'la cámara no pasa por el estado de React');
  assert.match(onGaze, /miradaCam\.objetivo\(/);
  assert.match(costura, /fuenteMirada=\{miradaCam\}/, 'el cuerpo 3D lee el controlador');
  const a3 = leer('src/avatar3d/Avatar3D.tsx');
  assert.match(a3, /fuenteMirada\.paso\(Date\.now\(\), \{ reducido \}\)/, 'en su cuadro, con movimiento reducido');
  assert.match(a3, /tipo: 'mirar'/);
  assert.match(leerRaiz('src/12-avatar3d/escena.ts'), /case 'mirar':/, 'la escena 3D interpola la mirada que llega');
  const { ControladorMirada, MIRADA, poseCambio } = await m('src/lib/miradaAvatar.ts');
  const c = new ControladorMirada();
  let previa = null;
  let enviados = 0;
  let maxPaso = 0;
  let ultimoX = 0;
  // La persona se mueve de -0.5 a 0.5 en 1 s; la cámara manda 15 eventos/s; el cuerpo lee cada 33 ms.
  for (let t = 0; t <= 1000; t += 33) {
    const k = Math.floor(t / 66.7);
    c.objetivo(-0.5 + k / 15, 0.1, true, k * 66.7);
    const p = c.paso(t);
    maxPaso = Math.max(maxPaso, Math.abs(p.x - ultimoX));
    ultimoX = p.x;
    if (poseCambio(previa, p)) {
      enviados += 1;
      previa = p;
    }
  }
  assert.ok(enviados >= 25, `poses mandadas en 1 s: ${enviados} (el camino viejo daba ≤ 4)`);
  assert.ok(maxPaso <= MIRADA.velMax * 0.033 + 1e-9, `velocidad acotada: ${maxPaso}`);
});

prueba('CAM-A mirada: zona muerta, límites de giro, sostener al perderla y volver al centro; movimiento reducido', async () => {
  const { ControladorMirada, MIRADA } = await m('src/lib/miradaAvatar.ts');
  const c = new ControladorMirada();
  let t = 0;
  const correr = (ms, f) => {
    let p;
    for (const fin = t + ms; t < fin; t += 33) {
      f?.(t);
      p = c.paso(t);
    }
    return p;
  };
  // Llega al objetivo y un temblor de ±0,01 del detector no la mueve.
  let p = correr(1500, (ts) => c.objetivo(0.4, 0.2, true, ts));
  assert.ok(Math.abs(p.x - 0.4) < MIRADA.zonaMuerta + 0.001, `llegó: ${p.x}`);
  const quieta = p.x;
  p = correr(600, (ts) => c.objetivo(quieta + (Math.floor(ts / 66) % 2 ? 0.01 : -0.01), 0.2, true, ts));
  assert.equal(p.x, quieta, 'zona muerta: el temblor no mueve la cabeza');
  // Límite: el objetivo en el borde no pasa de limiteX/limiteY.
  p = correr(2000, (ts) => c.objetivo(1, -1, true, ts));
  assert.ok(Math.abs(p.x) <= MIRADA.limiteX + 1e-9 && Math.abs(p.y) <= MIRADA.limiteY + 1e-9, `límites: ${p.x}, ${p.y}`);
  // Pérdida: sostiene donde estaba ~700 ms y después vuelve al centro; recién ahí activa=false.
  const antes = p.x;
  c.objetivo(0, 0, false, t);
  p = correr(MIRADA.sostenerMs - 100);
  assert.equal(p.x, antes, 'sostiene');
  assert.equal(p.activa, true);
  p = correr(3000);
  assert.ok(Math.abs(p.x) < 0.03 && Math.abs(p.y) < 0.03, `vuelve al centro: ${p.x}`);
  assert.equal(p.activa, false, 'sin nadie: el cuerpo retoma su mirada viva');
  // Sin eventos en edadMaxMs (la cámara se calló): se da por perdida aunque nadie dijo «activa: false».
  correr(1000, (ts) => c.objetivo(0.5, 0, true, ts));
  p = correr(MIRADA.edadMaxMs + MIRADA.sostenerMs + 3000);
  assert.equal(p.activa, false, 'sin noticias, neutral');
  // Movimiento reducido: menos giro y más lento; `seguir: false` lo apaga.
  const r = new ControladorMirada();
  let pr;
  for (let ts = 0; ts < 3000; ts += 33) {
    r.objetivo(1, 1, true, ts);
    pr = r.paso(ts, { reducido: true });
  }
  assert.ok(pr.x <= MIRADA.reducido.limiteX + 1e-9 && pr.y <= MIRADA.reducido.limiteY + 1e-9, `reducido: ${pr.x}, ${pr.y}`);
  assert.equal(r.paso(3100, { seguir: false }).activa, false);
});

/* ── CAM-B: la voz primero también en la escena de la cámara en vivo ─────────────────────────── */

prueba('CAM-B escena: con la mesa ocupada no se saca ni se sube foto; si empieza a hablar mientras se sacaba, no se sube', async () => {
  // Antes: CamaraVivo llamaba a intervaloServidor sin `ocupada` (CamaraVision sí la pasaba).
  const v = leer('src/components/CamaraVivo.tsx');
  assert.match(v, /ocupada: !!\(cb\.current\.ocupada\?\.\(\) \|\| cb\.current\.caras\?\.mesaOcupada\?\.\(\)\)/, 'CamaraVivo le pasa la mesa ocupada');
  assert.doesNotMatch(v, /intervaloServidor\(\{ mlkit: true, dormida: dormidoRef\.current, conPersona: personas > 0, necesitaEscena: observarRef\.current, sinCambios \}\)/, 'ya no sin `ocupada`');
  const { SubidaEscena } = await m('src/lib/subidaEscena.ts');
  const { CercoCamara } = await m('src/lib/cercoCamara.ts');
  let ahora = 100_000;
  let ocupada = true;
  const llamadas = { foto: 0, ver: 0 };
  const foto = pendiente();
  const s = new SubidaEscena(
    {
      ahora: () => ahora,
      foto: () => (llamadas.foto++, foto.p),
      ver: async () => (llamadas.ver++, vista()),
      estado: () => ({ dormida: false, personas: 1, necesitaEscena: true, ocupada }),
      aplicar: () => assert.fail('no se aplica nada'),
    },
    new CercoCamara('frontal')
  );
  assert.equal(s.tic(), null, 'ocupada: ni foto');
  assert.equal(llamadas.foto, 0);
  ocupada = false;
  const subida = s.tic();
  assert.ok(subida, 'libre: toca subir');
  ocupada = true; // empieza a hablar mientras se saca la foto
  foto.resolver({ b64: B64, ts: ahora, lado: 'frontal' });
  await subida;
  assert.equal(llamadas.ver, 0, 'no se sube con la mesa hablando');
  // Al terminar de hablar, vuelve a intentarlo enseguida (no espera 20 s más).
  ocupada = false;
  ahora += 1000;
  assert.ok(s.tic(), 'reintenta al quedar libre');
});

/* ── CAM-C: hora de captura, origen inmutable, cercas ───────────────────────────────────────── */

prueba('CAM-C eventos: lleva época/cuadro/hora del sensor; época vieja, fuera de orden, captura vieja o del futuro → descartado; APK vieja sigue andando', async () => {
  const { eventoValido } = await m('src/lib/camaraNativa.ts');
  const e = eventoValido(evento(10_000, { epoca: 3, cuadro: 7, tsMono: 5_000, base: 'sensor' }));
  assert.equal(e.epoca, 3, 'el origen del cuadro llega a JS');
  assert.equal(e.cuadro, 7);
  assert.equal(e.tsMono, 5_000);
  assert.equal(e.base, 'sensor');
  const { CercoCamara, ORIGEN } = await m('src/lib/cercoCamara.ts');
  const c = new CercoCamara('frontal');
  assert.equal(c.admitirEvento(e, 10_050), 'ok');
  assert.equal(c.admitirEvento(eventoValido(evento(10_060, { epoca: 3, cuadro: 7 })), 10_070), 'desordenado', 'el mismo cuadro dos veces');
  assert.equal(c.admitirEvento(eventoValido(evento(10_080, { epoca: 2, cuadro: 99 })), 10_090), 'epoca-vieja', 'de un enlace anterior de CameraX');
  assert.equal(c.admitirEvento(eventoValido(evento(10_100, { epoca: 4, cuadro: 1 })), 10_110), 'ok', 'enlace nuevo: los cuadros empiezan de cero');
  assert.equal(c.admitirEvento(eventoValido(evento(10_000, { epoca: 4, cuadro: 2 })), 10_000 + ORIGEN.eventoMaxMs + 1), 'viejo', 'captura vieja (cola del puente)');
  assert.equal(c.admitirEvento(eventoValido(evento(20_000, { epoca: 4, cuadro: 3 })), 10_000), 'futuro');
  assert.equal(c.admitirEvento(eventoValido(evento(10_200, { lado: 'trasera', epoca: 4, cuadro: 4 })), 10_210), 'otro-lado');
  // Una APK anterior (sin época ni cuadro): vale con lado y edad.
  const viejo = new CercoCamara('frontal');
  assert.equal(viejo.admitirEvento(eventoValido(evento(50_000)), 50_100), 'ok');
  assert.equal(viejo.admitirEvento(eventoValido(evento(50_000)), 50_000 + ORIGEN.eventoMaxMs + 10), 'viejo');
  // Otra vista nativa montada: su época empieza de nuevo en 1 y no se confunde con la anterior.
  c.montada();
  assert.equal(c.admitirEvento(eventoValido(evento(60_000, { epoca: 1, cuadro: 1 })), 60_010), 'ok');
});

prueba('CAM-C recortes y reconocimiento: el recorte de otra cámara/época o viejo no se reconoce; lo que vuelve del motor tras cambiar algo no vota', async () => {
  // Costuras: useCaras cerca DESPUÉS del await; CamaraVivo manda la hora del cuadro y su cerca.
  const uc = leer('src/caras/useCaras.tsx');
  assert.match(uc, /const gen = generacion\.sello\(\);[\s\S]{0,400}await analizarVigente\([\s\S]{0,200}motor\.current\?\.analizar\(f\.b64, f\.cajas[\s\S]{0,200}generacion\.vigente\(gen\) && reconoceRef\.current && \(f\.vigente \? f\.vigente\(\) : true\)/);
  assert.match(uc, /useEffect\(\(\) => generacion\.subir\(\), \[generacion, montarMotor, o\.lado, o\.correo\]\)/, 'cámara, cuenta o activación nuevas: otra generación');
  const v = leer('src/components/CamaraVivo.tsx');
  assert.doesNotMatch(v, /recibirFoto\(\{[^}]*\}\], ts: Date\.now\(\) \}\)/, 'ya no se fecha al llegar');
  assert.match(v, /ts: r\.ts > 0 \? r\.ts : e\.ts, vigente: \(\) => cerco\.vigente\(sello\)/);
  assert.match(v, /cerco\.admitirEvento\(e, ahora\)/);
  const { CercoCamara, ORIGEN } = await m('src/lib/cercoCamara.ts');
  const { GeneracionCaras, analizarVigente } = await m('src/caras/cercoReconocer.ts');
  const c = new CercoCamara('frontal');
  c.admitirEvento({ lado: 'frontal', ts: 1000, epoca: 2, cuadro: 1 }, 1000);
  const s = c.sello();
  assert.equal(c.admitirResultado({ ts: 1000, epoca: 2, lado: 'frontal' }, s, 1200, ORIGEN.recorteMaxMs), 'ok');
  assert.equal(c.admitirResultado({ ts: 1000, epoca: 1, lado: 'frontal' }, s, 1200, ORIGEN.recorteMaxMs), 'epoca-vieja');
  assert.equal(c.admitirResultado({ ts: 1000, epoca: 2, lado: 'trasera' }, s, 1200, ORIGEN.recorteMaxMs), 'otro-lado');
  assert.equal(c.admitirResultado({ ts: 1000, epoca: 2, lado: 'frontal' }, s, 1000 + ORIGEN.recorteMaxMs + 1, ORIGEN.recorteMaxMs), 'viejo');
  c.poner('trasera');
  assert.equal(c.admitirResultado({ ts: 1000, epoca: 2, lado: 'frontal' }, s, 1200, ORIGEN.recorteMaxMs), 'cambio', 'se cambió de cámara mientras se recortaba');
  // El motor de caras tarda; en medio se apaga el reconocimiento / se cambia de cámara: el resultado no se aplica.
  const g = new GeneracionCaras();
  const motor = pendiente();
  const sello = g.sello();
  const r = analizarVigente(() => motor.p, () => g.vigente(sello));
  g.subir();
  motor.resolver([{ indice: 0, vector: [0.1] }]);
  assert.equal(await r, null, 'resultado tardío descartado');
  const g2 = new GeneracionCaras();
  const s2 = g2.sello();
  assert.deepEqual(await analizarVigente(async () => [1], () => g2.vigente(s2)), [1], 'vigente: se aplica');
});

prueba('CAM-C Kotlin: hora del sensor (imageInfo.timestamp, ns) antes de ML Kit, origen inmutable por enlace y cerca antes de emitir', () => {
  const kt = leer(`${KT}AuraCamaraView.kt`);
  const cuadro = leer(`${KT}Cuadro.kt`);
  assert.match(kt, /private data class Origen\(val epoca: Int, val lado: String, val espejo: Boolean\)/);
  assert.match(kt, /val origen = Origen\(epoca, lado, frontal\)/);
  assert.match(kt, /an\.setAnalyzer\(ejecutor\) \{ img -> analizar\(img, origen\) \}/, 'el analizador lleva el origen de SU enlace');
  const analizar = kt.slice(kt.indexOf('private fun analizar('), kt.indexOf('private fun contarCuadro'));
  assert.ok(analizar.indexOf('img.imageInfo.timestamp') > 0 && analizar.indexOf('img.imageInfo.timestamp') < analizar.indexOf('Tasks.await'), 'la hora de captura se toma ANTES de ML Kit');
  assert.doesNotMatch(analizar, /val cuando = System\.currentTimeMillis\(\)\n/, 'ya no se fecha después de ML Kit');
  assert.match(analizar, /if \(destruida \|\| origen\.epoca != epoca\) return/);
  assert.match(kt, /if \(!destruida && origen\.epoca == epoca && origen\.lado == lado\) onCaras\(evento\)/, 'cerca antes de emitir');
  assert.match(kt, /evento\["lado"\] = origen\.lado/, 'el lado del origen, no el mutable');
  assert.match(kt, /Geometria\.aVista\([^)]*origen\.espejo\)/);
  for (const k of ['epoca', 'cuadro', 'tsMono', 'base']) assert.match(kt, new RegExp(`evento\\["${k}"\\]`), `evento.${k}`);
  for (const k of ['epoca', 'cuadro', 'lado', 'ts']) assert.match(kt, new RegExp(`m\\["${k}"\\] = r\\.${k}`), `recorte/foto .${k}`);
  assert.match(cuadro, /object Reloj \{/);
  assert.match(cuadro, /fun capturaRealtimeNs\(sensorNs: Long, realtimeNs: Long, monoNs: Long/);
  assert.match(kt, /System\.nanoTime\(\)/, 'el monótono para sensores con reloj UNKNOWN');
});

/* ── CAM-D: la guardia que no se pudo escribir ──────────────────────────────────────────────── */

prueba('CAM-D guardia: si «montando» no queda en el disco se sabe (false), la fila sigue en orden y la cámara nativa no se monta', async () => {
  const g = leer('src/lib/guardiaCamara.ts');
  assert.match(g, /export async function camaraMontando\(\): Promise<boolean> \{\n\s+const ok = await escribirGuardia/);
  assert.doesNotMatch(g, /\.catch\(\(\) => \{\n\s+\/\* sin disco: la guardia vale solo en memoria \*\//, 'ya no se traga el fallo');
  const v = leer('src/components/CamaraVivo.tsx');
  assert.match(v, /void camaraMontando\(\)\.then\(\(ok\) => \{[\s\S]{0,200}if \(!ok\) return fallar\(/, 'sin marca: a la de fotos (onFallo → camaraFallo lo reporta)');
  assert.match(leer('src/components/CamaraMesa.tsx'), /onFallo=\{camaraFallo\}/);
  const { FilaGuardia } = await m('src/lib/camaraNativa.ts');
  const escrito = [];
  // El disco falla justo con la marca «montando» (AsyncStorage lleno o roto).
  const fila = new FilaGuardia(async (t) => {
    await new Promise((r) => setTimeout(r, 5));
    if (t.includes('montando')) throw new Error('disco lleno');
    escrito.push(t);
  });
  const a = fila.poner({ montando: 1 });
  const b = fila.poner({});
  assert.equal(await a, false, 'no quedó escrita: se dice');
  assert.equal(await b, true);
  assert.deepEqual(escrito, ['{}'], 'en orden: el «soltar» después del «montando»');
});

/* ── CAM-E: la respuesta de la cámara anterior ──────────────────────────────────────────────── */

prueba('CAM-E escena: una respuesta que vuelve después de cambiar frontal→trasera no se aplica a la escena nueva', async () => {
  const v = leer('src/components/CamaraVivo.tsx');
  assert.match(v, /\}, \[activa, montable, lado, cerco\]\);/, 'la subida se reinicia al cambiar de lado');
  assert.match(leer('src/components/CamaraVision.tsx'), /origen\.lado !== ladoRef\.current\) return;/, 'la de fotos tampoco aplica la vista de la otra cámara');
  const { SubidaEscena } = await m('src/lib/subidaEscena.ts');
  const { CercoCamara } = await m('src/lib/cercoCamara.ts');
  const cerco = new CercoCamara('frontal');
  const servidor = pendiente();
  const aplicadas = [];
  const s = new SubidaEscena(
    {
      ahora: () => 100_000,
      foto: async () => ({ b64: B64, ts: 100_000, lado: 'frontal' }),
      ver: () => servidor.p,
      estado: () => ({ dormida: false, personas: 1, necesitaEscena: true, ocupada: false }),
      aplicar: (v) => aplicadas.push(v),
    },
    cerco
  );
  const subida = s.tic();
  await new Promise((r) => setTimeout(r, 0));
  cerco.poner('trasera');
  servidor.resolver(vista());
  await subida;
  assert.equal(aplicadas.length, 0, 'la vista de la frontal no se aplica a la trasera');
  // Y una foto que el nativo saca ya con la otra cámara tampoco cuenta como de esta.
  const c2 = new CercoCamara('frontal');
  const s2 = new SubidaEscena(
    { ahora: () => 100_000, foto: async () => ({ b64: B64, ts: 100_000, lado: 'trasera' }), ver: async () => vista(), estado: () => ({ dormida: false, personas: 1, necesitaEscena: true, ocupada: false }), aplicar: (v) => aplicadas.push(v) },
    c2
  );
  await s2.tic();
  assert.equal(aplicadas.length, 0);
});

/* ── CAM-F: pendiente ≠ desconocido ≠ ausente; el nombre vence sin votos frescos ─────────────── */

prueba('CAM-F seguimiento: una pista nueva sin votos es PENDIENTE (no «0 desconocidas» como si no hubiera nadie)', async () => {
  const { Seguidor } = await m('src/caras/seguimiento.ts');
  const s = new Seguidor();
  s.actualizar([{ x: 0.3, y: 0.3, w: 0.2, h: 0.25 }], 1000, [5]);
  const p = s.presentes(1100);
  assert.equal(p.r.length, 0);
  assert.equal(p.desconocidas, 0, 'todavía no se le dice «no te conozco»');
  assert.equal(p.pendientes, 1, 'pero está, sin identificar');
  const { fraseEscenaCaras } = await m('src/caras/escenaCaras.ts');
  assert.match(fraseEscenaCaras(p), /1 persona\(s\) sin identificar todavía/);
  assert.match(fraseEscenaCaras(p, false, true), /^Con la cámara trasera: 1 persona/);
  assert.equal(fraseEscenaCaras({ r: [], desconocidas: 0, pendientes: 0 }), '', 'sin nadie, nada');
  const uc = leer('src/caras/useCaras.tsx');
  assert.match(uc, /return fraseEscenaCaras\(q, false, op\.current\.lado === 'trasera'\)/, 'el cerebro recibe también las pendientes');
  assert.match(uc, /p\.r\.length \|\| p\.desconocidas \|\| p\.pendientes \? p : respaldo\.presentes/);
});

prueba('CAM-F seguimiento: el nombre vence sin un voto fresco aunque el seguimiento siga llegando (antes seguía a los 40,5 s)', async () => {
  const { Seguidor, IDENTIDAD_FRESCA_MS, estadoIdentidad } = await m('src/caras/seguimiento.ts');
  const ana = { id: 'a', nombre: 'Ana', relacion: 'conocido', distancia: 0.3, margen: 0.05 };
  const caja = { x: 0.3, y: 0.3, w: 0.2, h: 0.25 };
  const s = new Seguidor();
  const [p] = s.actualizar([caja], 0, [9]);
  s.votar(p.id, ana, 0);
  s.votar(p.id, ana, 200);
  assert.equal(s.presentes(300).r[0]?.nombre, 'Ana');
  let visto14 = null;
  for (let t = 500; t <= 40_500; t += 500) {
    s.actualizar([caja], t, [9]);
    if (t === 14_500) visto14 = s.presentes(t).r.length;
  }
  assert.equal(visto14, 1, 'fresco: sigue');
  const fin = s.presentes(40_500);
  assert.equal(fin.r.length, 0, 'a los 40,5 s sin voto, sin nombre');
  assert.equal(fin.pendientes, 1, 'vencida = pendiente para el cerebro');
  assert.ok(IDENTIDAD_FRESCA_MS <= 15_000);
  assert.equal(s.visibles(40_500)[0].identidad, null, 'tampoco se dibuja con nombre');
  assert.equal(estadoIdentidad(s.visibles(40_500)[0], 40_500), 'vencida');
  // Un voto suelto dudoso después no lo revive con los votos viejos (que ya no cuentan).
  s.votar(p.id, ana, 41_000);
  assert.equal(s.presentes(41_100).r.length, 0, 'un voto dudoso solo no basta');
  s.votar(p.id, ana, 41_300);
  assert.equal(s.presentes(41_400).r[0]?.nombre, 'Ana', 'dos votos frescos: vuelve');
  // Con repasos (un voto cada 12 s) el nombre se queda.
  const s2 = new Seguidor();
  const [q] = s2.actualizar([caja], 0, [3]);
  s2.votar(q.id, ana, 0);
  s2.votar(q.id, ana, 100);
  for (let t = 500; t <= 40_000; t += 500) {
    s2.actualizar([caja], t, [3]);
    if (t % 12_000 === 0) s2.votar(q.id, ana, t);
  }
  assert.equal(s2.presentes(40_000).r.length, 1, 'con repasos frescos se queda');
});

/* ── CAM-G: los objetos del servidor, sobre su foto ─────────────────────────────────────────── */

prueba('CAM-G objetos: fechados al CAPTURAR; viejos (> 8 s), de otra cámara/época o con el teléfono movido → no se dibujan; nunca como seguimiento', async () => {
  const { marcasEnVivo } = await m('src/lib/vistaEnVivo.ts');
  const v = vista();
  const objetos = (o) => marcasEnVivo({ pistas: [], mirando: false, lado: 'frontal', ahora: 10_000, ...o }).filter((x) => x.tipo === 'objeto');
  // Antes: 20 s desde la LLEGADA, de cualquier cámara, aunque el teléfono se hubiera movido.
  assert.equal(objetos({ vista: { v, ts: 1_000 } }).length, 0, 'foto de hace 9 s: ya no');
  const { VISTA_SERVIDOR_MS } = await m('src/lib/cercoCamara.ts');
  assert.ok(VISTA_SERVIDOR_MS < 20_000);
  const fresca = objetos({ vista: { v, ts: 7_000, lado: 'frontal', epoca: 2 }, epoca: 2 });
  assert.equal(fresca.length, 1);
  assert.match(fresca[0].detalle, /foto · hace 3 s/, 'se dice que es de una foto y de cuándo');
  assert.equal(objetos({ vista: { v, ts: 9_000, lado: 'trasera' } }).length, 0, 'de la otra cámara');
  assert.equal(objetos({ vista: { v, ts: 9_000, epoca: 1 }, epoca: 2 }).length, 0, 'de otra época (se volvió a montar)');
  assert.equal(objetos({ vista: { v, ts: 9_000 }, movidaEn: 9_500 }).length, 0, 'el teléfono se movió después de la foto');
  assert.equal(objetos({ vista: { v, ts: 9_000 }, movidaEn: 8_000 }).length, 1, 'movido antes de la foto: vale');
  // La subida fecha la vista con la hora de captura de la foto, no con la de llegada.
  const { SubidaEscena } = await m('src/lib/subidaEscena.ts');
  const { CercoCamara, seMovioTelefono } = await m('src/lib/cercoCamara.ts');
  let ahora = 100_000;
  const aplicadas = [];
  const s = new SubidaEscena(
    { ahora: () => ahora, foto: async () => ({ b64: B64, ts: 99_800, lado: 'frontal' }), ver: async () => ((ahora = 104_000), vista()), estado: () => ({ dormida: false, personas: 1, necesitaEscena: true, ocupada: false }), aplicar: (x) => aplicadas.push(x) },
    new CercoCamara('frontal')
  );
  await s.tic();
  assert.equal(aplicadas[0].ts, 99_800, 'hora de la foto');
  assert.equal(aplicadas[0].lado, 'frontal');
  // Girar el teléfono cambia hacia dónde cae la gravedad aunque el largo siga en 1 g.
  assert.equal(seMovioTelefono({ x: 0, y: -1, z: 0 }, { x: 0.3, y: -0.95, z: 0 }), true);
  assert.equal(seMovioTelefono({ x: 0, y: -1, z: 0 }, { x: 0.01, y: -1, z: 0.01 }), false);
  assert.match(leer('src/components/CamaraVision.tsx'), /servidor\(b64, \{ ts: t0, lado: ladoFoto \}\)/, 'la de fotos también fecha al capturar');
  assert.match(leer('src/screens/DeskScreen.tsx'), /seMovioTelefono\(antes, \{ x, y, z \}\)/);
});

/* ── el interruptor remoto en sesiones largas ───────────────────────────────────────────────── */

prueba('interruptor remoto: se vuelve a consultar al volver al frente (≥ 1 min) y cada 10 min con la app delante', async () => {
  const g = leer('src/lib/guardiaCamara.ts');
  assert.match(g, /AppState\.addEventListener\('change', \(s\) => s === 'active' && quizas\('frente'\)\)/);
  assert.match(g, /setInterval\(\(\) => AppState\.currentState === 'active' && quizas\('tic'\), 60_000\)/);
  assert.match(g, /if \(cambio\) \{[\s\S]{0,120}avisar\(\);/, 'si cambia, la mesa vuelve a decidir (a la de fotos si la apagaron)');
  const { REMOTA, tocaRefrescarRemota } = await m('src/lib/camaraNativa.ts');
  assert.equal(tocaRefrescarRemota({ ahora: 30_000, ultima: 0, motivo: 'frente' }), false);
  assert.equal(tocaRefrescarRemota({ ahora: REMOTA.frenteMinMs, ultima: 0, motivo: 'frente' }), true);
  assert.equal(tocaRefrescarRemota({ ahora: REMOTA.ttlMs - 1, ultima: 0, motivo: 'tic' }), false);
  assert.equal(tocaRefrescarRemota({ ahora: REMOTA.ttlMs, ultima: 0, motivo: 'tic' }), true);
  assert.equal(tocaRefrescarRemota({ ahora: REMOTA.ttlMs, ultima: 0, motivo: 'tic', enCurso: true }), false, 'de a una');
});

/* ── la voz no espera a la cámara ───────────────────────────────────────────────────────────── */

prueba('voz primero: nada de la cámara nueva se espera en el camino del turno (mirada y escena corren aparte)', () => {
  const d = leer('src/screens/DeskScreen.tsx');
  const turno = d.slice(d.indexOf('const handleCommand'), d.indexOf('const handleCommand') + 30_000);
  assert.doesNotMatch(turno, /await [^;\n]*(miradaCam|SubidaEscena|fotoNativa|recorteNativo)/, 'el turno no espera nada de la cámara nueva');
  const sub = leer('src/lib/subidaEscena.ts');
  assert.doesNotMatch(sub, /react-native|setTimeout\(/, 'la subida no agenda nada por su cuenta: la llama un intervalo de 1 s');
});

for (const [nombre, f] of pruebas) {
  n += 1;
  try {
    await f();
    console.log(`ok    ${nombre}`);
  } catch (e) {
    fallos += 1;
    console.log(`FALLA ${nombre}\n      ${String(e?.message || e).split('\n')[0].slice(0, 300)}`);
  }
}
console.log(`\n${n - fallos}/${n} pruebas bien`);
process.exit(fallos ? 1 : 0);
