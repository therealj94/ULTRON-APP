#!/usr/bin/env node
/**
 * Comprobación del intérprete de escena (src/lib/escena.ts): mismo contrato que la web.
 * Transpila el .ts con el `typescript` del proyecto (sin tsx ni ts-node) y afirma:
 *  - espejado de x para la cámara frontal y dimensiones de ML Kit según orientación del cuadro;
 *  - yaw/pitch relativos a la cámara (anguloEsperado): quien mira la pantalla desde un borde cuenta como «mira»;
 *  - histéresis llego / se_fue / sonrie / mira / cerca / dos_personas (con su histéresis de SALIDA);
 *  - huecos de muestreo (cara dormida: cámara apagada ~9,5 s de cada 12 s) tratados como DESCONOCIDO,
 *    no como ausencia: ni `se_fue` ni `llego` falsos al volver;
 *  - corte corto: un cuadro perdido no deja `principal` en null ni dice «No veo a nadie ahora.»;
 *  - alisado (EMA) del giro de cabeza antes de la histéresis de `mirando`/`cabeza`;
 *  - modo «inmediato» (cara dormida) y respaldo por etiquetas del servidor;
 *  - frases en español, en primera persona (AU-RA habla), sin inventar identidad;
 *  - «a veces no sabía que lo miraba» (José, 5-oct): la ventana de `mirando` corrida hacia la pantalla
 *    (la cámara está arriba de ella) y el `minFaceSize` de ML Kit que perdía caras a ~1,8 m;
 *  - la cámara trasera: sin espejo, sin `mirando` y la frase lo dice.
 *
 *   node scripts/check-escena.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const src = fs.readFileSync(path.join(root, 'src', 'lib', 'escena.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'escena-'));
const file = path.join(tmp, 'escena.mjs');
fs.writeFileSync(file, js);
const M = await import(pathToFileURL(file).href);
const { MaquinaEscena, describirEscena, ladoDesdeUltron, espejarX, normalizarY, dimensionesMlkit, observacionMlkit, anguloEsperado, fovDiagonalDesdeHorizontal, escenaDesdeEtiquetas, UMBRALES, UMBRALES_FOTOS, FOV_DIAGONAL_GRADOS } = M;
const { desfasePantalla, anchoCaraRelativo, distanciaDeCara, MIN_CARA_MLKIT } = M;
/** El yaw en horizontal pierde el desfase de la cámara de costado (sin signo): ver «A veces no sabía que lo miraba». */
const yawHorizontal = (crudo, tam, w, h) => Math.sign(crudo) * Math.max(0, Math.abs(crudo) - desfasePantalla(tam, w, h));

let fails = 0;
const check = (nombre, ok, detalle = '') => {
  if (!ok) fails += 1;
  console.log(`${ok ? 'ok ' : 'FAIL'}  ${nombre}${detalle ? ' → ' + detalle : ''}`);
};
const cara = (extra = {}) => ({ cx: 0.5, cy: 0.5, tam: 0.25, yaw: 0, pitch: 0, sonrisa: 0, sorpresa: 0, bocaAbierta: 0, parpadeo: 0, ...extra });
const obs = (ts, c, personas = c ? 1 : 0) => ({ ts, motor: 'mlkit', personas, cara: c });
function correr(m, desde, hasta, paso, c, personas, opciones) {
  const eventos = [];
  let ultima = m.escena;
  for (let t = desde; t <= hasta; t += paso) {
    ultima = m.procesar(obs(t, c, personas), opciones);
    eventos.push(...ultima.eventos);
  }
  return { eventos, escena: ultima };
}
const principal = (p = {}) => ({ x: 0, y: 0, tam: 0.25, mirando: false, sonrisa: 0, sorpresa: 0, ojosCerrados: false, bocaAbierta: 0, cabeza: 'centro', ...p });

console.log('\n— Espejado y ML Kit —');
check('espejarX(0.5) = 0', espejarX(0.5) === 0);
check('cara a la izquierda del cuadro → x positivo (derecha de la pantalla)', espejarX(0.2) > 0.55 && espejarX(0.2) < 0.65, String(espejarX(0.2)));
check('normalizarY(1) = 1', normalizarY(1) === 1 && normalizarY(0) === -1);
check('dimensiones: cuadro landscape-* → lados intercambiados', JSON.stringify(dimensionesMlkit(640, 480, 'landscape-left')) === '{"w":480,"h":640}');
check('dimensiones: cuadro portrait → tal cual', JSON.stringify(dimensionesMlkit(640, 480, 'portrait')) === '{"w":640,"h":480}');
{
  const caras = [
    { bounds: { x: 64, y: 120, width: 120, height: 160 }, yawAngle: 12, pitchAngle: -3, smilingProbability: 0.9, leftEyeOpenProbability: 0.95, rightEyeOpenProbability: 0.85 },
    { bounds: { x: 400, y: 200, width: 40, height: 50 }, yawAngle: 0, pitchAngle: 0, smilingProbability: -1, leftEyeOpenProbability: -1, rightEyeOpenProbability: -1 },
  ];
  const o = observacionMlkit(caras, 640, 480, 'portrait', 1000);
  check('observacionMlkit: 2 personas, principal = la más grande', o.personas === 2 && Math.abs(o.cara.cx - (64 + 60) / 640) < 1e-9 && Math.abs(o.cara.tam - 160 / 480) < 1e-9, JSON.stringify(o.cara));
  {
    // yaw absoluto = -yawAngle = -12; se descuenta el ángulo con que la cámara ve ese punto (cx≈0,19 → ≈ -19,6°).
    const esp = anguloEsperado(o.cara.cx, o.cara.cy, 640, 480);
    check('observacionMlkit: yaw invertido y relativo (−yawAngle − esperado − desfase de costado)', Math.abs(o.cara.yaw - yawHorizontal(-12 - esp.yaw, o.cara.tam, 640, 480)) < 1e-9 && Math.abs(o.cara.pitch - (-3 - esp.pitch)) < 1e-9, `yaw=${o.cara.yaw.toFixed(1)} esp=${esp.yaw.toFixed(1)}`);
  }
  check('observacionMlkit: sonrisa y parpadeo', o.cara.sonrisa === 0.9 && Math.abs(o.cara.parpadeo - 0.1) < 1e-9, `parpadeo=${o.cara.parpadeo}`);
  const vacio = observacionMlkit([], 640, 480, 'landscape-right', 1);
  check('observacionMlkit: sin caras', vacio.personas === 0 && vacio.cara === null);
  const sinClasif = observacionMlkit([caras[1]], 640, 480, 'portrait', 1);
  check('observacionMlkit: -1 en clasificación → 0', sinClasif.cara.sonrisa === 0 && sinClasif.cara.parpadeo === 0);
}

console.log('\n— Ángulo esperado (mirada relativa a la cámara) —');
{
  const c = anguloEsperado(0.5, 0.5, 640, 480);
  check('centro del cuadro → 0°', Math.abs(c.yaw) < 1e-9 && Math.abs(c.pitch) < 1e-9);
  const izq = anguloEsperado(0.15, 0.5, 640, 480);
  check('borde izquierdo del cuadro (cx 0,15) → yaw esperado ≈ -22°', izq.yaw < -19 && izq.yaw > -25, izq.yaw.toFixed(1));
  const arriba = anguloEsperado(0.5, 0.1, 640, 480);
  check('parte alta del cuadro → pitch esperado negativo (baja la cabeza)', arriba.pitch < -12 && arriba.pitch > -20, arriba.pitch.toFixed(1));
  const vert = anguloEsperado(0.15, 0.5, 480, 640);
  check('cuadro vertical: el eje corto abarca menos grados', Math.abs(vert.yaw) < Math.abs(izq.yaw));
  check('FOV inválido → el típico', Math.abs(anguloEsperado(0.15, 0.5, 640, 480, 0).yaw - izq.yaw) < 1e-9);
  const d = fovDiagonalDesdeHorizontal(60, 640, 480);
  check('60° horizontales en 4:3 ≈ 72° diagonales (por defecto)', Math.abs(d - FOV_DIAGONAL_GRADOS) < 1, d.toFixed(1));
  // Persona en el borde izquierdo del cuadro (sin espejar) mirando fijo a la pantalla: ML Kit la ve girada
  // hacia la derecha de la imagen (Euler Y ≈ +22). Con yaw absoluto |−22| > miraYawOn nunca «miraría».
  const borde = [{ bounds: { x: 32, y: 160, width: 128, height: 160 }, yawAngle: 22, pitchAngle: 0, smilingProbability: 0, leftEyeOpenProbability: 1, rightEyeOpenProbability: 1 }];
  const ob = observacionMlkit(borde, 640, 480, 'portrait', 0);
  check('borde + Euler Y +22 → yaw relativo ≈ 0', Math.abs(ob.cara.yaw) < 3, ob.cara.yaw.toFixed(1));
  const m = new MaquinaEscena();
  let ultima;
  for (let t = 0; t <= 1200; t += 100) ultima = m.procesar(observacionMlkit(borde, 640, 480, 'portrait', t));
  // cx 0,15 del cuadro crudo → espejado x>0 (derecha de la pantalla) → para AU-RA «a mi izquierda».
  check('…y la máquina la da por mirando la pantalla (a mi izquierda)', ultima.principal.mirando === true && /a mi izquierda, mirando la pantalla/.test(ultima.descripcion), ultima.descripcion);
  const centroGirado = [{ ...borde[0], bounds: { x: 256, y: 160, width: 128, height: 160 } }];
  const oc = observacionMlkit(centroGirado, 640, 480, 'portrait', 0);
  check('misma cabeza girada 22° pero en el centro → yaw ≈ -(22 − desfase de costado)', Math.abs(oc.cara.yaw - yawHorizontal(-22, oc.cara.tam, 640, 480)) < 1e-9, oc.cara.yaw.toFixed(1));
  const muyGirada = observacionMlkit([{ ...centroGirado[0], yawAngle: 30 }], 640, 480, 'portrait', 0);
  check('…y girada 30° en el centro no mira (|yaw| > miraYawOn)', Math.abs(muyGirada.cara.yaw) > UMBRALES.miraYawOn, muyGirada.cara.yaw.toFixed(1));
  // Y el mismo caso al otro lado del cuadro (cx ≈ 0,85 → para AU-RA «a mi derecha»).
  const bordeDer = [{ ...borde[0], bounds: { x: 480, y: 160, width: 128, height: 160 }, yawAngle: -22 }];
  const md = new MaquinaEscena();
  let ud;
  for (let t = 0; t <= 1200; t += 100) ud = md.procesar(observacionMlkit(bordeDer, 640, 480, 'portrait', t));
  check('borde opuesto mirando a la cámara → mirando=true, «a mi derecha»', ud.principal.mirando === true && /a mi derecha, mirando la pantalla/.test(ud.descripcion), ud.descripcion);
  check('la frase de la máquina nunca habla de «tu» lado', !/\btu\b|a tu (derecha|izquierda)/.test(ultima.descripcion + ' ' + ud.descripcion), ud.descripcion);
}

console.log('\n— «A veces no sabía que lo miraba»: la pantalla está debajo de la cámara —');
{
  // Teléfono en vertical (foto 720×1280). La cámara va ~6 cm arriba de la pantalla: quien mira la cara del
  // avatar baja la cabeza unos grados respecto a la línea hacia la cámara, más cuanto más cerca.
  const W = 720;
  const H = 1280;
  const cerca = desfasePantalla(0.45, W, H);
  const media = desfasePantalla(0.25, W, H);
  const lejos = desfasePantalla(0.1, W, H);
  check('desfase: cerca > media > lejos, y nunca más de 12°', cerca > media && media > lejos && cerca <= 12 && lejos > 0, `${cerca.toFixed(1)} / ${media.toFixed(1)} / ${lejos.toFixed(1)}`);
  check('distancia por el tamaño de cara: 0,45 del alto ≈ 30-40 cm; 0,1 ≈ 1,4-1,8 m', distanciaDeCara(0.45, W, H) > 0.28 && distanciaDeCara(0.45, W, H) < 0.42 && distanciaDeCara(0.1, W, H) > 1.3 && distanciaDeCara(0.1, W, H) < 1.9, `${distanciaDeCara(0.45, W, H).toFixed(2)} m / ${distanciaDeCara(0.1, W, H).toFixed(2)} m`);
  // Teléfono en la mano (~28 cm: cara = 50 % del alto), ojos a la altura de la pantalla (la cara sale algo
  // por DEBAJO del centro de la foto, cy ≈ 0,62). Relativo a la línea hacia la cámara, quien mira la pantalla
  // da un pitch de unos −12° (la cámara está arriba) más el ruido de ML Kit 'fast': de −13 a −21.
  const ruido = [-13, -19, -16, -21, -14, -18, -15, -20, -17, -13, -19, -16];
  const caja = { x: 180, y: 474, width: 360, height: 640 };
  const cx = (caja.x + caja.width / 2) / W;
  const cy = (caja.y + caja.height / 2) / H;
  const esp = anguloEsperado(cx, cy, W, H);
  const caraCerca = (rel) => [{ bounds: caja, yawAngle: 0, pitchAngle: rel + esp.pitch, smilingProbability: 0, leftEyeOpenProbability: 1, rightEyeOpenProbability: 1 }];
  const m = new MaquinaEscena(UMBRALES_FOTOS);
  let e;
  let cambios = 0;
  let antes = null;
  ruido.forEach((p, i) => {
    e = m.procesar(observacionMlkit(caraCerca(p), W, H, 'portrait', i * 400), { inmediato: i === 0 });
    if (antes !== null && e.principal && e.principal.mirando !== antes) cambios += 1;
    if (e.principal) antes = e.principal.mirando;
  });
  check('cerca, mirando la pantalla con ruido: «mirando» (un solo cambio, el de encender) y sin parpadeos', e.principal?.mirando === true && cambios <= 1 && /mirando la pantalla/.test(e.descripcion), `${e.descripcion} (cambios ${cambios})`);
  const corregidos = ruido.map((p) => observacionMlkit(caraCerca(p), W, H, 'portrait', 0).cara.pitch);
  check('con el desfase, todas las muestras caen dentro de miraPitchOn', corregidos.every((p) => Math.abs(p) < UMBRALES.miraPitchOn), corregidos.map((p) => p.toFixed(0)).join(' '));
  check('…sin él, 9 de 12 quedaban fuera (lo que veía José: «a veces no sabía que lo miraba»)', ruido.filter((p) => Math.abs(p) >= UMBRALES.miraPitchOn).length === 9);
  const abajo = new MaquinaEscena(UMBRALES_FOTOS);
  let ea;
  for (let i = 0; i < 10; i++) ea = abajo.procesar(observacionMlkit(caraCerca(-38), W, H, 'portrait', i * 400), { inmediato: i === 0 });
  check('mirando la mesa (cabeza −38°): no mira la pantalla', ea.principal?.mirando === false, ea.descripcion);
  const arriba = new MaquinaEscena(UMBRALES_FOTOS);
  let eu;
  for (let i = 0; i < 10; i++) eu = arriba.procesar(observacionMlkit(caraCerca(24), W, H, 'portrait', i * 400), { inmediato: i === 0 });
  check('mirando por encima del teléfono (+24°): no mira la pantalla', eu.principal?.mirando === false, eu.descripcion);
}

console.log('\n— Caras más lejos: minFaceSize de ML Kit —');
{
  // En vertical el ancho de la foto es el lado corto (720 de 720×1280): la cara de 15 cm cae de 0,12 pasando ~1,8 m.
  const a = (d) => anchoCaraRelativo(d, 720, 1280);
  check('a 60 cm la cara ocupa ≥ 0,25 del ancho', a(0.6) >= 0.25, a(0.6).toFixed(3));
  check('a 2 m la cara es < 0,12 (el mínimo de antes la perdía) y > 0,08 (el de ahora la ve)', a(2) < 0.12 && a(2) > MIN_CARA_MLKIT, a(2).toFixed(3));
  check('MIN_CARA_MLKIT = 0,08 (hasta ~2,7 m en vertical)', MIN_CARA_MLKIT === 0.08 && a(2.7) >= MIN_CARA_MLKIT * 0.97, a(2.7).toFixed(3));
}

console.log('\n— Cámara trasera —');
{
  const W = 720;
  const H = 1280;
  // Alguien a la izquierda de la foto, mirando a la cámara de atrás (de frente a ella).
  const c = [{ bounds: { x: 60, y: 400, width: 220, height: 300 }, yawAngle: 0, pitchAngle: 0, smilingProbability: 0.9, leftEyeOpenProbability: 1, rightEyeOpenProbability: 1 }];
  const m = new MaquinaEscena(UMBRALES_FOTOS);
  let e;
  const eventos = [];
  for (let i = 0; i < 8; i++) {
    e = m.procesar(observacionMlkit(c, W, H, 'portrait', i * 400, undefined, { trasera: true }), { inmediato: i === 0 });
    eventos.push(...e.eventos);
  }
  check('trasera: llega, pero nunca «mirando» ni evento «mira»', e.personas === 1 && e.principal.mirando === false && !eventos.includes('mira'), JSON.stringify(eventos));
  check('trasera: x sin espejo (izquierda de la foto → x negativa)', e.principal.x < -0.3, e.principal.x.toFixed(2));
  check('trasera: la frase dice la cámara y el lado de la foto, sin «pantalla» ni «mi»', /^Con la cámara trasera veo a una persona, a la izquierda, sonriendo\.$/.test(e.descripcion) && e.trasera === true, e.descripcion);
  check('trasera: sin nadie', describirEscena({ personas: 0, principal: null, motor: 'mlkit', trasera: true }) === 'Con la cámara trasera no veo a nadie ahora.');
  check('trasera: dos personas', describirEscena({ personas: 2, principal: principal(), motor: 'mlkit', trasera: true }) === 'Con la cámara trasera veo a dos personas.');
  const o = observacionMlkit(c, W, H, 'portrait', 0, undefined, { trasera: true });
  check('trasera: sin desfase de pantalla (el pitch es solo relativo a la cámara)', Math.abs(o.cara.pitch - (0 - anguloEsperado(o.cara.cx, o.cara.cy, W, H).pitch)) < 1e-9);
}

console.log('\n— Descripción —');
check('0 personas', describirEscena({ personas: 0, principal: null, motor: 'mlkit' }) === 'No veo a nadie ahora.');
check('cámara apagada', describirEscena({ personas: 0, principal: null, motor: 'ninguno' }) === 'La cámara está apagada.');
check('lado en primera persona (x>0 = a mi izquierda)', ladoDesdeUltron(0.5) === 'a mi izquierda' && ladoDesdeUltron(-0.5) === 'a mi derecha' && ladoDesdeUltron(0.1) === 'frente a mí');
check('2 caras contadas sin principal confirmada → «Veo a dos personas.»', describirEscena({ personas: 2, principal: null, motor: 'mlkit' }) === 'Veo a dos personas.');
check('1 cara sin principal confirmada → nadie todavía', describirEscena({ personas: 1, principal: null, motor: 'mlkit' }) === 'No veo a nadie ahora.');
check(
  '1 persona cerca, x<0 (a la izquierda de la pantalla = a mi derecha), sonriendo y mirando',
  describirEscena({ personas: 1, principal: principal({ x: -0.6, tam: 0.5, sonrisa: 0.8, mirando: true }), motor: 'mlkit' }) === 'Veo a una persona cerca, a mi derecha, sonriendo y mirando la pantalla.'
);
check('1 persona frente, sin gestos', describirEscena({ personas: 1, principal: principal(), motor: 'mlkit' }) === 'Veo a una persona, frente a mí.');
check(
  'lejos, x>0 (a mi izquierda), mirando a otro lado; nunca «tu derecha»',
  describirEscena({ personas: 1, principal: principal({ x: 0.7, tam: 0.1, cabeza: 'izquierda' }), motor: 'mlkit' }) === 'Veo a una persona lejos, a mi izquierda, mirando hacia otro lado.'
);
{
  const d = describirEscena({ personas: 2, principal: principal(), motor: 'mlkit' });
  check('2 personas sin inventar nada', d === 'Veo a dos personas.' && !/hombre|mujer|niñ|señor|años/i.test(d), d);
  check('ninguna frase habla de «tu» lado', !/\btu\b/.test(d + describirEscena({ personas: 1, principal: principal({ x: 0.9 }), motor: 'mlkit' }) + describirEscena({ personas: 1, principal: principal({ x: -0.9 }), motor: 'mlkit' })));
}
{
  const d = describirEscena({ personas: 1, principal: principal({ sonrisa: 0.9, mirando: true }), motor: 'servidor', etiquetas: ['persona', 'taza', 'teléfono'] });
  check('servidor: etiquetas, sin gestos', d === 'Veo a una persona; en la mesa: taza, teléfono.' && !/sonriendo|mirando/.test(d), d);
}

console.log('\n— Histéresis —');
{
  const m = new MaquinaEscena();
  const antes = correr(m, 0, 500, 100, cara());
  check('llego no dispara a los 500 ms', !antes.eventos.includes('llego') && antes.escena.personas === 0 && antes.escena.principal === null);
  const despues = correr(m, 600, 800, 100, cara());
  check('llego tras 0,6 s de cara continua', despues.eventos.filter((e) => e === 'llego').length === 1 && despues.escena.personas === 1, JSON.stringify(despues.eventos));
  check('descripción tras llegar', /^Veo a una persona/.test(despues.escena.descripcion), despues.escena.descripcion);
  const fuera = correr(m, 900, 2800, 100, null);
  check('se_fue solo tras 2 s sin cara', fuera.eventos.filter((e) => e === 'se_fue').length === 1 && fuera.escena.personas === 0, JSON.stringify(fuera.eventos));
}
{
  const m = new MaquinaEscena();
  correr(m, 0, 1000, 100, cara());
  const s1 = correr(m, 1100, 1300, 100, cara({ sonrisa: 0.6 }));
  const s2 = correr(m, 1400, 1600, 100, cara({ sonrisa: 0.4 }));
  const s3 = correr(m, 1700, 1900, 100, cara({ sonrisa: 0.2 }));
  check('sonrie al cruzar 0,55', s1.eventos.includes('sonrie'));
  check('entre 0,3 y 0,55 no cambia', !s2.eventos.length, JSON.stringify(s2.eventos));
  check('deja_de_sonreir bajo 0,3', s3.eventos.includes('deja_de_sonreir'));
}
{
  const m = new MaquinaEscena();
  correr(m, 0, 1000, 100, cara({ yaw: 40 }));
  const a = correr(m, 1100, 1500, 100, cara({ yaw: 5 }));
  const b = correr(m, 1600, 2000, 100, cara({ yaw: 24 }));
  const c = correr(m, 2100, 2500, 100, cara({ yaw: 35 }));
  check('mira al centrar la cabeza (sostén 250 ms)', a.eventos.includes('mira') && a.escena.principal.mirando === true);
  check('sigue mirando entre 20° y 28°', !b.eventos.includes('aparta_mirada') && b.escena.principal.mirando === true);
  check('aparta_mirada pasados 28°', c.eventos.includes('aparta_mirada') && c.escena.principal.mirando === false);
}
{
  const m = new MaquinaEscena();
  correr(m, 0, 1000, 100, cara({ tam: 0.25 }));
  const c1 = correr(m, 1100, 2500, 100, cara({ tam: 0.5 }));
  const c2 = correr(m, 2600, 4000, 100, cara({ tam: 0.1 }));
  check('cerca al superar 0,45', c1.eventos.includes('cerca') && /cerca/.test(c1.escena.descripcion));
  check('lejos al bajar de 0,12', c2.eventos.includes('lejos') && /lejos/.test(c2.escena.descripcion));
}
{
  const m = new MaquinaEscena();
  const d = correr(m, 0, 1500, 100, cara(), 2);
  check('dos_personas estable 1 s (una sola vez)', d.eventos.filter((e) => e === 'dos_personas').length === 1 && /dos personas/.test(d.escena.descripcion), d.escena.descripcion);
  const m2 = new MaquinaEscena();
  const temprano = m2.procesar(obs(0, cara(), 2));
  check('2 caras antes de «llego»: personas=2 y la frase lo dice (no «nadie»)', temprano.personas === 2 && temprano.principal === null && temprano.descripcion === 'Veo a dos personas.', temprano.descripcion);
}
{
  const m = new MaquinaEscena();
  const { escena } = correr(m, 0, 800, 100, cara({ cx: 0.2, cy: 0.75 }));
  check('publica x espejado (+) y y sin espejar (+)', escena.principal.x > 0.5 && escena.principal.y > 0.4, JSON.stringify(escena.principal));
}
{
  const m = new MaquinaEscena();
  const e1 = m.procesar(obs(0, cara()), { inmediato: true });
  check('dormido: llego inmediato', e1.eventos.includes('llego') && e1.personas === 1);
  const e2 = m.procesar(obs(5000, cara()), { inmediato: true });
  check('dormido: la misma persona no vuelve a «llegar»', !e2.eventos.includes('llego') && e2.personas === 1, JSON.stringify(e2.eventos));
  // Tras el hueco, la ausencia se mide con cuadros REALES: una ventana entera (2 fps) sin cara → se_fue.
  const ventana = correr(m, 10000, 12000, 500, null, 0, { inmediato: true });
  check('dormido: una ventana entera sin cara → se_fue', ventana.eventos.filter((e) => e === 'se_fue').length === 1 && ventana.escena.personas === 0, JSON.stringify(ventana.eventos));
}

console.log('\n— Hueco de muestreo (cámara dormida: 2,5 s encendida cada 12 s) —');
{
  // Ciclo real: ventana de 2,5 s a 2 fps con la persona delante, 9,5 s con el sensor APAGADO, y el primer
  // cuadro de la ventana siguiente sin cara (falso negativo). Ese hueco es DESCONOCIDO, no ausencia.
  const m = new MaquinaEscena();
  const w1 = correr(m, 0, 2500, 500, cara(), 1, { inmediato: true });
  check('ventana 1: llego', w1.eventos.includes('llego') && w1.escena.personas === 1);
  const tras = m.procesar(obs(12000, null), { inmediato: true });
  check('primer cuadro tras 9,5 s de cámara apagada: NO hay se_fue falso', !tras.eventos.includes('se_fue') && tras.personas === 1, JSON.stringify(tras.eventos) + ' ' + tras.descripcion);
  check('…y tampoco dice «No veo a nadie ahora.»', tras.principal !== null && tras.descripcion !== 'No veo a nadie ahora.', tras.descripcion);
  const w2 = correr(m, 12500, 14500, 500, cara(), 1, { inmediato: true });
  check('ventana 2 con la misma persona: NO hay llego falso', !w2.eventos.includes('llego') && w2.escena.personas === 1, JSON.stringify(w2.eventos));
  // Si de verdad se fue, la ventana siguiente entera sin cara sí lo dice (tiempo observado ≥ seFueMs).
  const w3 = correr(m, 24000, 26500, 500, null, 0, { inmediato: true });
  check('se fue de verdad: una ventana entera sin cara → se_fue', w3.eventos.filter((e) => e === 'se_fue').length === 1, JSON.stringify(w3.eventos));
}

console.log('\n— Corte corto (falso negativo de ML Kit) —');
{
  const m = new MaquinaEscena();
  correr(m, 0, 1000, 100, cara({ cx: 0.2 }));
  const perdido = m.procesar(obs(1100, null));
  check('un cuadro perdido: principal se congela (no null) y personas sigue en 1', perdido.principal !== null && perdido.personas === 1, JSON.stringify(perdido.principal));
  check('…y la frase NO dice «No veo a nadie ahora.»', perdido.descripcion !== 'No veo a nadie ahora.' && /^Veo a una persona/.test(perdido.descripcion), perdido.descripcion);
  const vuelve = m.procesar(obs(1200, cara({ cx: 0.2 })));
  check('al volver la cara no se reanuncia «llego»', !vuelve.eventos.includes('llego'), JSON.stringify(vuelve.eventos));
  // El congelado dura como mucho seFueMs: pasado eso, se_fue y principal a null de verdad.
  const fin = correr(m, 1300, 3300, 100, null);
  check('pasados 2 s sin cara sí hay se_fue y principal null', fin.eventos.includes('se_fue') && fin.escena.principal === null && fin.escena.descripcion === 'No veo a nadie ahora.', fin.escena.descripcion);
}

console.log('\n— dos_personas: histéresis de salida —');
{
  const m = new MaquinaEscena();
  const d1 = correr(m, 0, 1500, 100, cara(), 2);
  const corto = correr(m, 1600, 2500, 100, cara(), 1); // la 2ª cara falta 0,9 s (< dosPersonasOffMs)
  const revuelve = correr(m, 2600, 4000, 100, cara(), 2);
  check('dos_personas una vez', d1.eventos.filter((e) => e === 'dos_personas').length === 1);
  check('la 2ª cara parpadea < 1,5 s → NO se re-anuncia', !corto.eventos.includes('dos_personas') && !revuelve.eventos.includes('dos_personas'), JSON.stringify(revuelve.eventos));
  const largo = correr(m, 4100, 5800, 100, cara(), 1); // ahora sí falta > 1,5 s
  const otra = correr(m, 5900, 7200, 100, cara(), 2);
  check('tras 1,5 s sin la 2ª cara, dos_personas vuelve a anunciarse', !largo.eventos.includes('dos_personas') && otra.eventos.filter((e) => e === 'dos_personas').length === 1, JSON.stringify(otra.eventos));
  check('umbral de salida exportado', UMBRALES.dosPersonasOffMs === 1500);
}

console.log('\n— Alisado (EMA) del giro —');
{
  const m = new MaquinaEscena();
  correr(m, 0, 1000, 100, cara({ yaw: 0 }));
  const pico = m.procesar(obs(1100, cara({ yaw: 30 })));
  check('un cuadro suelto a 30° no mueve la cabeza del centro ni apaga «mirando»', pico.principal.cabeza === 'centro' && pico.principal.mirando === true, JSON.stringify(pico.principal));
  const sostenido = correr(m, 1200, 2200, 100, cara({ yaw: 30 }));
  check('…pero un giro sostenido sí: aparta_mirada y cabeza «derecha»', sostenido.eventos.includes('aparta_mirada') && sostenido.escena.principal.cabeza === 'derecha' && sostenido.escena.principal.mirando === false, JSON.stringify(sostenido.escena.principal));
  check('alisado exportado', UMBRALES.alisadoGiro === 0.35);
}

console.log('\n— Respaldo por servidor —');
{
  const e1 = escenaDesdeEtiquetas(['persona', 'taza'], 1000, null);
  check('servidor: persona → llego', e1.motor === 'servidor' && e1.personas === 1 && e1.eventos.includes('llego') && e1.principal !== null, e1.descripcion);
  const e2 = escenaDesdeEtiquetas(['taza'], 13000, e1);
  check('servidor: sin persona → se_fue', e2.personas === 0 && e2.eventos.includes('se_fue') && e2.descripcion === 'No veo a nadie; en la mesa: taza.', e2.descripcion);
  const e3 = escenaDesdeEtiquetas([], 25000, e2);
  check('servidor: nada', e3.descripcion === 'No veo a nadie ahora.' && !e3.eventos.length);
}
check('umbrales exportados', UMBRALES.llegoMs === 600 && UMBRALES.seFueMs === 2000);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} fallo(s)` : '\nTodo en orden.');
process.exit(fails ? 1 : 0);
