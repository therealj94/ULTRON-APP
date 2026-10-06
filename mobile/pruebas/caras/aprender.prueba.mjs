/**
 * Pruebas en Node de la cámara honesta con las caras (José, 6-oct, en la mesa con su hija y la 5.6.0: «la cámara aún
 * tiene fallas»). Lo que pasó y lo que aquí queda fijado (datos inventados: la dueña Marta, su hija Bea; en la memoria
 * familiar, Nora e Ivón):
 *
 *   · «Me acompaña mi hija» → adivinó nombres de la memoria para una cara sin reconocer. Ahora la mesa lo atiende con el
 *     motor de caras: «veo a alguien que todavía no conozco, ¿cómo se llama…?», sin ningún nombre que el motor no
 *     confirmó, y queda esperando el nombre (src/caras/aprenderPorVoz.ts, caras.ts);
 *   · aprender esa cara por voz: el nombre de la dueña → «Bea, ¿te puedo recordar?» → SOLO el «sí» de Bea la guarda
 *     (poses, la cara que NO es la dueña, consentimiento con la frase); «no», silencio u otra cosa: nada;
 *   · «Reconoce a Bea» / «¿quién es ella?» van al motor, no al cerebro («no puedo identificar personas por su cara»);
 *   · dos personas: una persona no está en dos caras (seguimiento.ts, quienesEnFoto); el motor elige la cara de la caja
 *     aunque el recorte la deje contra el borde (motorCarasHtml.ts ELEGIR_CARA_JS); la miga dice qué pasó con cada recorte;
 *   · «Mira, mira», «¿me ves?», «mira esto» miran de verdad (intenciones.ts, camaraModo.ts pideMirar, DeskScreen);
 *   · la foto sacada justo cuando la mesa empieza a hablar se guarda y sube al callarse (lib/subidaEscena.ts);
 *   · revisión del 6-oct: la espera del nombre no se traga órdenes ni preguntas ni crea nombres basura («Hora», «Esa»,
 *     «Niña»); con la dueña sin guardar no se guarda su cara con el nombre de otra persona; «te presento a esa» no presenta
 *     a nadie y «sí, pero no» no es un «sí».
 *
 *   cd mobile && npx tsx pruebas/caras/aprender.prueba.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AMBIGUO_PRESENTADA,
  ESPERA_NOMBRE_MS,
  OfertaAprender,
  caraDelPresentado,
  esConsentimiento,
  fraseOfertaAprender,
  frasePresentes,
  nombreConMarca,
  nombreDeRespuesta,
  ofertaSinDuena,
  ofreceAprender,
  pedidoDeCaras,
  quienesEnFoto,
  respuestaQuien,
} from '../../src/caras/caras.ts';
import { AprenderPorVoz, interrumpeEspera } from '../../src/caras/aprenderPorVoz.ts';
import { Seguidor } from '../../src/caras/seguimiento.ts';
import { DiagnosticoReconocer } from '../../src/caras/pistaNativa.ts';
import { fraseEscenaCaras } from '../../src/caras/escenaCaras.ts';
import { ELEGIR_CARA_JS } from '../../src/caras/motorCarasHtml.ts';
import { interpretar } from '../../src/lib/intenciones.ts';
import { pedidoDeCamara, pideMirar } from '../../src/lib/camaraModo.ts';
import { pedidoLocalPrivado, negadoVaAlCerebro } from '../../src/lib/privadoLocal.ts';
import { SubidaEscena, PENDIENTE_MAX_MS } from '../../src/lib/subidaEscena.ts';
import { CercoCamara } from '../../src/lib/cercoCamara.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MOVIL = path.resolve(AQUI, '../..');
const leer = (f) => fs.readFileSync(path.join(MOVIL, f), 'utf8');

let fallos = 0;
let n = 0;
const pruebas = [];
const prueba = (nombre, f) => pruebas.push([nombre, f]);

/** Un vector de cara de 128 números (cada «persona» apunta a otro lado). */
const vec = (k, ruido = 0) => Array.from({ length: 128 }, (_, i) => (i === k ? 0.6 : 0.01) + (i === (k + 1) % 128 ? ruido : 0));
const cara = (v, x = 0.3, w = 0.2) => ({ caja: { x, y: 0.2, w, h: w }, vector: v, puntaje: 0.9 });
const MARTA = { id: 'm', nombre: 'Marta', relacion: 'yo', vectores: [vec(1)] };
/** Lo que hay en la memoria familiar de la dueña: nombres que NUNCA pueden salir para una cara sin reconocer. */
const FAMILIA = ['Nora', 'Ivón', 'Bea'];

/** La mesa de mentira: lo que dice, lo que guarda y quién está a la vista (lo que el motor confirmó). */
function mesa(o = {}) {
  const dicho = [];
  const guardadas = [];
  const conocidas = [...(o.conocidas || [MARTA])];
  let poses = 0;
  const io = {
    decir: async (t) => void dicho.push(t),
    en: () => false,
    nombreDuena: () => 'Marta',
    asegurarCamara: async () => o.camara !== false,
    presentes: async () => o.vista || { r: [{ nombre: 'Marta', relacion: 'yo' }], sinNombre: 1 },
    conocidas: () => conocidas,
    tomarPoses: async (elegir) => {
      poses += 1;
      // Cinco fotos con Marta (más grande) y la presentada al lado.
      const tomas = [];
      for (let k = 0; k < 5; k++) {
        const c = elegir(o.fotoPose || [cara(vec(1), 0.1, 0.4), cara(vec(7, k * 0.01), 0.6, 0.22)]);
        if (c) tomas.push(c);
      }
      return tomas;
    },
    guardar: async (x) => {
      guardadas.push(x);
      conocidas.push({ id: `c${conocidas.length}`, nombre: x.nombre, relacion: x.relacion, vectores: x.vectores, ...(x.parentesco ? { parentesco: x.parentesco } : {}) });
    },
    saludado: () => {},
    conoceme: async () => void dicho.push('«conóceme»'),
  };
  let ahora = 0;
  const a = new AprenderPorVoz(io, () => ahora);
  return { a, dicho, guardadas, poses: () => poses, avanzar: (ms) => (ahora += ms) };
}
const sinFamilia = (t) => FAMILIA.every((nom) => !t.includes(nom));

/* ── entender lo que se dice ─────────────────────────────────────────────────────────────── */

prueba('por voz: «me acompaña mi hija», «reconoce a Bea», «¿reconoces a mi hija?», «¿quién es ella?» son de las caras (antes iban al cerebro)', () => {
  assert.deepEqual(pedidoDeCaras('Me acompaña mi hija.'), { tipo: 'acompanante', parentesco: 'hija' });
  assert.deepEqual(pedidoDeCaras('Está conmigo mi esposo Beto'), { tipo: 'acompanante', parentesco: 'esposo', nombre: 'Beto' });
  assert.deepEqual(pedidoDeCaras('me acompaña mi hija, que se llama bea'), { tipo: 'acompanante', parentesco: 'hija', nombre: 'Bea' });
  assert.deepEqual(pedidoDeCaras('me acompaña mi hija hoy'), { tipo: 'acompanante', parentesco: 'hija' }, '«hoy» no es un nombre');
  assert.deepEqual(pedidoDeCaras('Mi hija está aquí'), { tipo: 'acompanante', parentesco: 'hija' });
  assert.deepEqual(pedidoDeCaras('te presento a mi hija'), { tipo: 'acompanante', parentesco: 'hija' }, '«hija» no es un nombre: antes guardaba a alguien llamado «hija»');
  assert.deepEqual(pedidoDeCaras('Reconoce a Bea.'), { tipo: 'reconocer', nombre: 'Bea' });
  assert.deepEqual(pedidoDeCaras('¿Reconoces a mi hija?'), { tipo: 'reconocer', parentesco: 'hija' });
  assert.deepEqual(pedidoDeCaras('reconoce a mi hija Bea'), { tipo: 'reconocer', nombre: 'Bea', parentesco: 'hija' });
  assert.deepEqual(pedidoDeCaras('Aprende la cara de Bea'), { tipo: 'reconocer', nombre: 'Bea' });
  assert.deepEqual(pedidoDeCaras('aprende su cara'), { tipo: 'reconocer' });
  assert.deepEqual(pedidoDeCaras('¿Quién es ella?'), { tipo: 'quien' });
  assert.deepEqual(pedidoDeCaras('¿la reconoces?'), { tipo: 'quien' });
  assert.equal(pedidoDeCaras('¿quién es el presidente de Honduras?'), null, 'no es una cara');
  assert.equal(pedidoDeCaras('reconoce a la gente que llega'), null, 'sin nombre ni parentesco: no');
  // Lo que ya había sigue igual.
  assert.deepEqual(pedidoDeCaras('Reconóceme'), { tipo: 'conoceme' });
  assert.deepEqual(pedidoDeCaras('Te presento a mi esposa Ana'), { tipo: 'presentar', nombre: 'Ana', parentesco: 'esposa' });
  // Pasan por «¿quién habla?» (nunca para invitados); «me acompaña…» negado a un invitado va al cerebro, no se niega seco.
  assert.equal(pedidoLocalPrivado('Reconoce a Bea'), true);
  assert.equal(pedidoLocalPrivado('Me acompaña mi hija'), true);
  assert.equal(negadoVaAlCerebro('Me acompaña mi hija'), true);
  assert.equal(negadoVaAlCerebro('Reconoce a Bea'), false);
});

prueba('la respuesta a «¿cómo se llama?»: el nombre (con o sin «se llama», con parentesco), «no», un «sí» sin nombre, u otra cosa', () => {
  assert.deepEqual(nombreDeRespuesta('Se llama Bea.'), { tipo: 'nombre', nombre: 'Bea' });
  assert.deepEqual(nombreDeRespuesta('Bea'), { tipo: 'nombre', nombre: 'Bea' });
  assert.deepEqual(nombreDeRespuesta('bea maría'), { tipo: 'nombre', nombre: 'Bea María' });
  assert.deepEqual(nombreDeRespuesta('Es mi hija Bea'), { tipo: 'nombre', nombre: 'Bea', parentesco: 'hija' });
  assert.deepEqual(nombreDeRespuesta('Bea, mi hija'), { tipo: 'nombre', nombre: 'Bea', parentesco: 'hija' });
  assert.deepEqual(nombreDeRespuesta('Sí, se llama Bea'), { tipo: 'nombre', nombre: 'Bea' });
  assert.deepEqual(nombreDeRespuesta('su nombre es Bea'), { tipo: 'nombre', nombre: 'Bea' });
  assert.deepEqual(nombreDeRespuesta('No, mejor no'), { tipo: 'no' });
  assert.deepEqual(nombreDeRespuesta('sí'), { tipo: 'si' });
  assert.equal(nombreDeRespuesta('¿cuánto está el oro hoy en Tegucigalpa?'), null, 'otra frase: no es un nombre');
  assert.equal(nombreDeRespuesta('gracias'), null);
  // La oferta espera un rato y vence sola.
  let t = 0;
  const of = new OfertaAprender(() => t);
  of.empezar('hija');
  assert.deepEqual(of.pendiente(), { parentesco: 'hija' });
  t = ESPERA_NOMBRE_MS + 1;
  assert.equal(of.pendiente(), null);
});

prueba('lo que dice la mesa de las caras: los nombres que el motor confirmó y, a quien no conoce, la oferta; nunca uno de la memoria', () => {
  const r = respuestaQuien({ r: [{ nombre: 'Marta', relacion: 'yo' }], sinNombre: 1 });
  assert.equal(r.texto, 'Veo a Marta: eres tú, y a alguien que todavía no conozco. ¿Cómo se llama? Si quieres, aprendo su cara y la recuerdo.');
  assert.equal(r.ofrecer, true);
  assert.ok(sinFamilia(r.texto));
  assert.equal(respuestaQuien({ r: [], sinNombre: 2 }).texto, fraseOfertaAprender());
  assert.deepEqual(respuestaQuien({ r: [{ nombre: 'Bea', relacion: 'conocido', parentesco: 'hija' }], sinNombre: 0 }), { texto: 'Veo a Bea, tu hija.', ofrecer: false });
  assert.equal(respuestaQuien({ r: [], sinNombre: 0 }).texto, 'No veo a nadie frente a la cámara.');
  assert.equal(fraseOfertaAprender('hija'), 'Veo a alguien que todavía no conozco. ¿Cómo se llama tu hija? Si quieres, aprendo su cara y la recuerdo.');
  // La frase de la oferta (de la mesa o del cerebro, si dice lo que el servidor le pide) se reconoce como oferta.
  assert.equal(ofreceAprender(fraseOfertaAprender('hija')), true);
  assert.equal(ofreceAprender('Veo a alguien que todavía no conozco. ¿Cómo se llama? Así la recuerdo.'), true);
  assert.equal(ofreceAprender('Hola, Bea. ¿Te puedo recordar? Dime «sí» o «no».'), false, 'la pregunta del consentimiento no es la oferta');
});

/* ── el turno con una cara que no conoce, y aprenderla por voz ──────────────────────────────── */

prueba('«Me acompaña mi hija» con una cara sin reconocer: no adivina (ni Nora ni Ivón) y ofrece aprenderla; nada se guarda todavía', async () => {
  const m = mesa();
  const p = pedidoDeCaras('Me acompaña mi hija.');
  assert.equal(await m.a.acompanante(p), true, 'lo atiende la mesa, no el cerebro');
  assert.equal(m.dicho.length, 1);
  assert.equal(m.dicho[0], 'Veo a alguien que todavía no conozco. ¿Cómo se llama tu hija? Si quieres, aprendo su cara y la recuerdo.');
  assert.ok(sinFamilia(m.dicho[0]), 'ningún nombre de la memoria familiar');
  assert.ok(m.a.oferta.pendiente(), 'espera el nombre');
  assert.equal(m.guardadas.length, 0);
  // Sin nadie sin nombre a la vista, «me acompaña mi hija» es charla: sigue al cerebro.
  const solo = mesa({ vista: { r: [{ nombre: 'Marta', relacion: 'yo' }], sinNombre: 0 } });
  assert.equal(await solo.a.acompanante(p), false);
  assert.equal(solo.dicho.length, 0);
});

prueba('aprender la cara por voz: el nombre de la dueña → «Bea, ¿te puedo recordar?» → el «sí» de Bea → poses, su cara (no la de Marta) y guardada con la frase', async () => {
  const m = mesa();
  await m.a.acompanante(pedidoDeCaras('Me acompaña mi hija.'));
  assert.equal(m.a.esperaNombre('Se llama Bea'), true, 'la mesa lo pasa por «¿quién habla?» (solo la dueña da el nombre)');
  assert.equal(await m.a.respuesta('Se llama Bea'), true);
  assert.match(m.dicho.at(-1), /^Hola, Bea\. ¿Te puedo recordar\? Solo guardo unos números de tu cara, no fotos, y Marta puede borrarlos cuando quiera\. Dime «sí» o «no»\.$/);
  assert.equal(m.guardadas.length, 0, 'el nombre de la dueña no basta: falta el «sí» de Bea');
  assert.equal(m.a.presentacion.pendiente(), 'Bea');
  assert.equal(await m.a.respuesta('Sí, claro'), true);
  assert.equal(m.poses(), 1, 'con Bea frente a la cámara, las poses del motor de caras');
  assert.equal(m.guardadas.length, 1);
  const g = m.guardadas[0];
  assert.equal(g.nombre, 'Bea');
  assert.equal(g.relacion, 'conocido');
  assert.equal(g.parentesco, 'hija', 'el parentesco de «me acompaña mi hija»');
  assert.deepEqual(g.consentimiento, { como: 'voz', frase: 'Sí, claro' }, 'su «sí», como constancia');
  assert.ok(g.vectores.length >= 1 && g.vectores.every((v) => v[7] > 0.5 && v[1] < 0.5), 'los vectores son de la cara de Bea, no los de Marta');
  assert.match(m.dicho.at(-1), /^¡Mucho gusto, Bea! Ya te recuerdo\./);
});

prueba('aprender por voz: «no», silencio u otra cosa → nada se guarda; un «sí» de la dueña sin nombre pregunta el nombre; su propio nombre es «conóceme»', async () => {
  for (const respuesta of ['No, gracias', '¿qué hora es?']) {
    const m = mesa();
    await m.a.acompanante(pedidoDeCaras('Me acompaña mi hija.'));
    await m.a.respuesta('Bea');
    await m.a.respuesta(respuesta);
    assert.equal(m.guardadas.length, 0, respuesta);
    assert.equal(m.poses(), 0, `${respuesta}: ni las poses`);
  }
  // El «sí» llega tarde (pasó el plazo): ya no vale.
  const tarde = mesa();
  await tarde.a.acompanante(pedidoDeCaras('Me acompaña mi hija.'));
  await tarde.a.respuesta('Bea');
  tarde.avanzar(31_000);
  assert.equal(await tarde.a.respuesta('sí'), false, 'vencida: el «sí» sigue su camino');
  assert.equal(tarde.guardadas.length, 0);
  // La dueña contesta «sí» a la oferta, sin nombre: se le pregunta el nombre.
  const si = mesa();
  await si.a.acompanante(pedidoDeCaras('Me acompaña mi hija.'));
  await si.a.respuesta('sí');
  assert.equal(si.dicho.at(-1), '¿Cómo se llama?');
  assert.ok(si.a.oferta.pendiente());
  // La dueña dice «no»: se suelta.
  const no = mesa();
  await no.a.acompanante(pedidoDeCaras('Me acompaña mi hija.'));
  await no.a.respuesta('No');
  assert.equal(no.a.oferta.pendiente(), null);
  // Su propio nombre y su cara sin guardar: «conóceme» (no se la guarda como conocida de sí misma).
  const yo = mesa({ conocidas: [], vista: { r: [], sinNombre: 1 } });
  await yo.a.quien();
  await yo.a.respuesta('Marta');
  assert.equal(yo.dicho.at(-1), '«conóceme»');
  // Otra frase cualquiera suelta la oferta y sigue su camino.
  const otra = mesa();
  await otra.a.acompanante(pedidoDeCaras('Me acompaña mi hija.'));
  assert.equal(await otra.a.respuesta('cuéntame cómo va el proyecto de la planta este trimestre'), false);
  assert.equal(otra.a.oferta.pendiente(), null);
});

prueba('«Reconoce a Bea» y «¿quién es ella?»: el motor mira; si la conoce y la ve, su nombre; si no la conoce, «todavía no conozco su cara» y la presentación', async () => {
  const m = mesa();
  await m.a.reconocer(pedidoDeCaras('Reconoce a Bea.'));
  assert.match(m.dicho[0], /^Todavía no conozco la cara de Bea\. Hola, Bea\. ¿Te puedo recordar\?/);
  assert.doesNotMatch(m.dicho.join(' '), /no puedo identificar/i);
  const bea = { id: 'b', nombre: 'Bea', relacion: 'conocido', parentesco: 'hija', vectores: [vec(7)] };
  const ve = mesa({ conocidas: [MARTA, bea], vista: { r: [{ nombre: 'Marta', relacion: 'yo' }, { nombre: 'Bea', relacion: 'conocido', parentesco: 'hija' }], sinNombre: 0 } });
  await ve.a.reconocer(pedidoDeCaras('¿Reconoces a mi hija?'));
  assert.equal(ve.dicho[0], 'Sí, veo a Bea, tu hija.');
  const nove = mesa({ conocidas: [MARTA, bea], vista: { r: [{ nombre: 'Marta', relacion: 'yo' }], sinNombre: 0 } });
  await nove.a.reconocer({ nombre: 'Bea' });
  assert.equal(nove.dicho[0], 'Ahora no veo a Bea frente a la cámara.');
  const q = mesa();
  await q.a.quien();
  assert.equal(q.dicho[0], 'Veo a Marta: eres tú, y a alguien que todavía no conozco. ¿Cómo se llama? Si quieres, aprendo su cara y la recuerdo.');
  assert.ok(q.a.oferta.pendiente());
});

prueba('la presentada: con dos caras desconocidas de tamaño parecido, ninguna (mejor no guardar la cara equivocada)', async () => {
  assert.equal(caraDelPresentado([cara(vec(7), 0.1, 0.25), cara(vec(9), 0.6, 0.24)], [MARTA]), null);
  assert.deepEqual(caraDelPresentado([cara(vec(7), 0.1, 0.4), cara(vec(9), 0.6, 0.2)], [MARTA]).vector, vec(7), `la de delante, si es ≥ ${AMBIGUO_PRESENTADA}× más grande`);
  const m = mesa({ fotoPose: [cara(vec(7), 0.1, 0.25), cara(vec(9), 0.6, 0.24)] });
  await m.a.presentar('Bea', 'hija');
  await m.a.respuesta('sí');
  assert.equal(m.guardadas.length, 0);
  assert.match(m.dicho.at(-1), /Que solo quede tu cara frente a la cámara y dime «sí» otra vez/);
});

/* ── dos personas ────────────────────────────────────────────────────────────────────────── */

prueba('dos personas: una persona no está en dos caras; la otra queda «que no conozco» y la escena lo dice (antes solo «Reconozco a Marta»)', () => {
  const s = new Seguidor();
  const marta = { id: 'm', nombre: 'Marta', relacion: 'yo', distancia: 0.25, margen: 1, unica: true };
  const [pm, pb] = s.actualizar([{ x: 0.1, y: 0.2, w: 0.2, h: 0.25 }, { x: 0.6, y: 0.2, w: 0.18, h: 0.22 }], 1000, [1, 2]);
  s.votar(pm.id, marta, 1000);
  s.votar(pm.id, marta, 1100);
  // El recorte de la otra cara salió con el nombre de Marta (la vecina en el margen, o el parecido): no se le da.
  const v1 = s.votar(pb.id, { ...marta, distancia: 0.33 }, 1200);
  const v2 = s.votar(pb.id, { ...marta, distancia: 0.34 }, 1300);
  assert.equal(v2.identidad, null, 'Marta ya está en la otra cara');
  assert.equal(v1.ajeno || v2.ajeno, true, 'la miga sabrá por qué');
  s.votar(pb.id, null, 1400);
  const p = s.presentes(1500);
  assert.deepEqual(p.r.map((x) => x.nombre), ['Marta']);
  assert.equal(p.desconocidas + p.pendientes, 1, 'la segunda persona está, sin nombre');
  assert.equal(fraseEscenaCaras(p).startsWith('Reconozco a Marta (quien te habla); 1 persona(s)'), true, fraseEscenaCaras(p));
  // Si la segunda se parece MÁS, el nombre pasa a ella y la primera queda sin nombre (no dos «Marta»).
  const s2 = new Seguidor();
  const [a, b] = s2.actualizar([{ x: 0.1, y: 0.2, w: 0.2, h: 0.25 }, { x: 0.6, y: 0.2, w: 0.2, h: 0.25 }], 0, [1, 2]);
  s2.votar(a.id, { ...marta, distancia: 0.29 }, 0);
  s2.votar(a.id, { ...marta, distancia: 0.29 }, 10);
  s2.votar(b.id, { ...marta, distancia: 0.12 }, 20);
  s2.votar(b.id, { ...marta, distancia: 0.12 }, 30);
  assert.equal(s2.presentes(40).r.length, 1);
  assert.equal(a.identidad, null);
  assert.equal(b.identidad?.nombre, 'Marta');
});

prueba('dos personas en UNA foto (respaldo, «¿quién es ella?»): cada cara por separado; dos parecidas a la misma, una sola con su nombre', () => {
  const bea = { id: 'b', nombre: 'Bea', relacion: 'conocido', vectores: [vec(7)] };
  const ambas = quienesEnFoto([cara(vec(1)), cara(vec(7), 0.6)], [MARTA, bea]);
  assert.deepEqual(ambas.r.map((x) => x.nombre).sort(), ['Bea', 'Marta'], 'las dos reconocidas, cada una la suya');
  assert.equal(ambas.sinNombre, 0);
  const una = quienesEnFoto([cara(vec(1)), cara(vec(7), 0.6)], [MARTA]);
  assert.deepEqual(una.r.map((x) => x.nombre), ['Marta']);
  assert.equal(una.sinNombre, 1, 'la que no está guardada: «que no conozco»');
  const dobles = quienesEnFoto([cara(vec(1)), cara(vec(1, 0.05), 0.6)], [MARTA]);
  assert.equal(dobles.r.length, 1);
  assert.equal(dobles.sinNombre, 1, 'no dos «Marta»');
  assert.equal(frasePresentes(una.r, una.sinNombre), 'Reconozco a Marta (quien te habla); 1 persona(s) que no conozco');
});

prueba('el motor elige la cara de la CAJA aunque el recorte la deje contra el borde (antes: «sin cara» o la vecina)', () => {
  const elegirCara = new Function(`${ELEGIR_CARA_JS}; return elegirCara;`)();
  // Lienzo de 320: la cara de la caja quedó arriba a la izquierda (recortada contra el borde de la foto) y la vecina,
  // más cerca del centro del lienzo.
  const caraCaja = { x: 0, y: 0, w: 130, h: 130 };
  const vecina = { x: 150, y: 120, w: 120, h: 120 };
  const esperada = { cx: 62, cy: 62, lado: 140 };
  assert.equal(elegirCara([vecina, caraCaja], esperada), 1, 'la de la caja');
  // Lo de antes (la más cercana al centro, ≤ 0,3 del ancho) elegía a la vecina: el voto de otra persona.
  const centro = (b) => Math.hypot(b.x + b.w / 2 - 160, b.y + b.h / 2 - 160);
  assert.ok(centro(vecina) < centro(caraCaja) && centro(vecina) <= 320 * 0.3, 'el criterio viejo se iba con la vecina');
  // Sola contra el borde: antes «sin cara» (lejos del centro); ahora se encuentra.
  assert.ok(centro(caraCaja) > 320 * 0.3, 'el criterio viejo la descartaba');
  assert.equal(elegirCara([caraCaja], esperada), 0);
  // Nada cerca de donde dice la caja, o una cara mucho más chica (del fondo): ninguna.
  assert.equal(elegirCara([{ x: 250, y: 250, w: 60, h: 60 }], esperada), -1);
  assert.equal(elegirCara([{ x: 50, y: 50, w: 30, h: 30 }], esperada), -1);
  assert.equal(elegirCara([], esperada), -1);
  assert.match(leer('src/caras/motorCarasHtml.ts'), /var k = elegirCara\(rs\.map/, 'la página usa la misma función');
});

prueba('la miga de «sin nombre» dice qué pasó con TODOS los recortes (antes: «9 recortes: 4 sin cara, 0 "no sé"» y nada de los otros 5)', () => {
  const d = new DiagnosticoReconocer();
  for (let i = 0; i < 4; i++) d.analizado(3, { cara: false, reconocida: false });
  for (let i = 0; i < 5; i++) d.analizado(3, { cara: true, reconocida: true, distancia: 0.3, ajeno: i < 4 });
  assert.equal(d.linea(3, 0.5), '9 recortes: 4 sin cara, 0 «no sé», 5 con nombre (4 con el nombre de otra cara a la vista)');
  assert.match(leer('src/caras/useCaras.tsx'), /const v = seguidor\.votar\(de\.pista, r, f\.ts\);\n\s+diagnostico\.analizado\(de\.pista, \{[^}]*ajeno: !!v\.ajeno \}\);/, 'useCaras vota y después anota (con «ajeno»)');
});

/* ── «mira» mira ─────────────────────────────────────────────────────────────────────────── */

prueba('«Mira, mira», «mira esto», «¿me ves?» son mirar (vista fresca o foto), no al cerebro sin foto ni «ya te estoy viendo»', () => {
  for (const f of ['Mira, mira', 'mira', 'Mira esto', '¿Me ves?', '¿me estás viendo?', 'mira aquí', '¿Qué ves?']) assert.equal(interpretar(f).tipo, 'que_ves', f);
  for (const f of ['mira, te cuento lo de la reunión de mañana con el banco', 'mírame']) assert.notEqual(interpretar(f).tipo, 'que_ves', f);
  assert.equal(pideMirar('puedes verme'), true);
  assert.equal(pideMirar('mírame'), true);
  assert.equal(pideMirar('mira esto'), true);
  assert.equal(pideMirar('enciende la cámara'), false, 'encenderla no es mirar');
  assert.equal(pedidoDeCamara('mira esto'), 'encender', 'con la cámara apagada, «mira esto» la enciende (para mirar)');
  const ds = leer('src/screens/DeskScreen.tsx');
  assert.match(ds, /const pc = intent\.tipo === 'vision_on' \? 'encender' : intent\.tipo === 'que_ves' \? null : pedidoDeCamara\(cmd\);/, '«mira esto» no se queda en «encender»');
  assert.match(ds, /if \(camara\.encendida\(\)\) return void \(await \(pideMirar\(cmd\) \? whatDoYouSee\(\) : say\(/, 'ya encendida: mira de verdad');
  assert.match(ds, /case 'que_ves':\n\s+return void \(await whatDoYouSee\(intent\.foco\)\);/);
  // Lo que se le pide al cerebro con lo visto ya no le dice que no puede identificar a nadie.
  assert.doesNotMatch(ds, /'Dime en dos frases qué ves por la cámara: quién está \(sin identificar a nadie por su cara\)/);
  assert.match(ds, /quién está \(por su nombre solo si ESCENA dice que lo reconoces; a quien no reconoces, «alguien que todavía no conozco», sin adivinar nombres\)/);
  // El nombre de la oferta pasa por «¿quién habla?»; lo que dice la mesa o el cerebro puede abrir la oferta.
  assert.match(ds, /if \(pedidoLocalPrivado\(cmd\) \|\| caras\.esperaNombre\(cmd\)\) \{/);
  assert.match(ds, /if \(texto && !parcial\) carasRef\.current\?\.alResponder\(texto\);/);
});

/* ── la vista mientras la mesa habla ─────────────────────────────────────────────────────── */

prueba('la foto sacada cuando la mesa empieza a hablar se guarda y sube al callarse (la MISMA foto, con su hora de captura); vieja o con la escena cambiada, no', async () => {
  const B64 = 'x'.repeat(5000);
  const hacer = () => {
    let ahora = 100_000;
    let ocupada = false;
    let cambioEn = 0;
    const llamadas = { foto: 0, ver: 0 };
    const aplicadas = [];
    const descartes = [];
    let resolverFoto;
    const s = new SubidaEscena(
      {
        ahora: () => ahora,
        foto: () => (llamadas.foto++, new Promise((r) => (resolverFoto = r))),
        ver: async () => (llamadas.ver++, { escena: 'dos personas en una mesa', lugar: '', personas: [{}, {}], objetos: [], textos: [], precios: [], principal: '', cajasFiables: false, formato: 'json' }),
        estado: () => ({ dormida: false, personas: 2, necesitaEscena: true, ocupada, cambioEn }),
        aplicar: (v) => aplicadas.push(v),
        descartada: (m) => descartes.push(m),
      },
      new CercoCamara('frontal')
    );
    return { s, llamadas, aplicadas, descartes, set: (o) => ((ahora = o.ahora ?? ahora), (ocupada = o.ocupada ?? ocupada), (cambioEn = o.cambioEn ?? cambioEn)), foto: (f) => resolverFoto(f) };
  };
  const m = hacer();
  const subida = m.s.tic();
  m.set({ ocupada: true }); // la mesa empieza a hablar mientras se saca la foto
  m.foto({ b64: B64, ts: 100_000, lado: 'frontal' });
  await subida;
  assert.equal(m.llamadas.ver, 0, 'con la mesa hablando no se sube (la voz primero)');
  assert.match(m.descartes[0], /la guardo para cuando calle/);
  m.set({ ahora: 108_000 });
  assert.equal(m.s.tic(), null, 'sigue hablando: espera');
  m.set({ ocupada: false, ahora: 109_000 });
  await m.s.tic();
  assert.equal(m.llamadas.foto, 1, 'no se sacó otra: la guardada');
  assert.equal(m.llamadas.ver, 1);
  assert.equal(m.aplicadas.length, 1);
  assert.equal(m.aplicadas[0].ts, 100_000, 'con su hora de captura (lo que se veía mientras hablaba)');
  // Vieja (más de PENDIENTE_MAX_MS) o con la escena cambiada después: se tira y se saca otra como siempre.
  for (const [nombre, despues] of [['vieja', { ahora: 100_000 + PENDIENTE_MAX_MS + 1, ocupada: false }], ['cambió', { ahora: 105_000, ocupada: false, cambioEn: 103_000 }]]) {
    const v = hacer();
    const sub = v.s.tic();
    v.set({ ocupada: true });
    v.foto({ b64: B64, ts: 100_000, lado: 'frontal' });
    await sub;
    v.set(despues);
    v.s.tic();
    assert.equal(v.llamadas.ver, 0, nombre);
    assert.equal(v.aplicadas.length, 0, nombre);
    assert.match(v.descartes.at(-1), /ya es vieja/, nombre);
  }
});

/* ── revisión del 6-oct (NO PUBLICABLE → arreglos): cada prueba falla con 436ec0a ──────────────── */

prueba('revisión (MEDIO 2): la espera del nombre no toma órdenes, preguntas ni palabras sueltas como nombres («Hora», «Hoy», «Esa», «Niña», «Ahorita», «Apaga La Cámara», «Olvida»)', () => {
  for (const f of ['qué hora es', '¿Qué hora es?', 'qué día es hoy', 'esa', 'ese', 'Ella', 'la niña', 'La nena', 'mi hija', 'mamá', 'apaga la cámara', 'olvida a Bea', 'cállate', 'stop', 'adiós', 'Hoy', 'Hora', 'buenas noches', 'Muy bien', 'oye', 'espera', 'cuelga', 'Dímelo', 'te digo luego', 'Es hora de irnos'])
    assert.notEqual(nombreDeRespuesta(f)?.tipo, 'nombre', `${f} → ${JSON.stringify(nombreDeRespuesta(f))}`);
  for (const f of ['ahorita no', 'Ahora no', 'todavía no', 'no sé', 'mejor no']) assert.deepEqual(nombreDeRespuesta(f), { tipo: 'no' }, f);
  // Los nombres de verdad siguen saliendo: «se llama X», «es X» al inicio, o el nombre solo.
  assert.deepEqual(nombreDeRespuesta('Lucía'), { tipo: 'nombre', nombre: 'Lucía' });
  assert.deepEqual(nombreDeRespuesta('Don Pedro'), { tipo: 'nombre', nombre: 'Don Pedro' });
  assert.deepEqual(nombreDeRespuesta('mi hija se llama Bea'), { tipo: 'nombre', nombre: 'Bea', parentesco: 'hija' });
  assert.deepEqual(nombreDeRespuesta('ella es Bea'), { tipo: 'nombre', nombre: 'Bea' });
  assert.deepEqual(nombreDeRespuesta('pues Bea'), { tipo: 'nombre', nombre: 'Bea' });
  assert.equal(nombreDeRespuesta('Bea es la que más canta'), null, 'una frase con un nombre dentro no es la respuesta');
});

prueba('revisión (MEDIO 2): con la espera del nombre o del «sí» abierta, una orden o una pregunta va PRIMERO: suelta la espera y sigue su camino (antes «apaga la cámara» y «olvida a Bea» se perdían)', async () => {
  for (const orden of ['apaga la cámara', 'Olvida a Bea', 'cállate', 'para', 'cuelga', '¿qué hora es?', 'qué día es hoy', 'cierra la vista', 'olvida mi voz']) {
    const m = mesa();
    await m.a.acompanante(pedidoDeCaras('Me acompaña mi hija.'));
    const dichos = m.dicho.length;
    assert.equal(await m.a.respuesta(orden), false, `${orden}: la frase sigue su camino (useCaras → pedidoDeCaras, DeskScreen → la cámara)`);
    assert.equal(m.a.oferta.pendiente(), null, `${orden}: la espera se suelta`);
    assert.equal(m.dicho.length, dichos, `${orden}: la mesa no dice nada encima`);
    assert.equal(m.a.presentacion.pendiente(), null, `${orden}: no presentó a nadie`);
    assert.equal(interrumpeEspera(orden), true, orden);
  }
  // «Olvida a Bea» llega entero a pedidoDeCaras (useCaras.manejar lo atiende después de respuesta()).
  assert.deepEqual(pedidoDeCaras('Olvida a Bea'), { tipo: 'olvidar', nombre: 'Bea' });
  assert.match(leer('src/caras/useCaras.tsx'), /if \(await porVoz\.respuesta\(dicho\)\) return true;\n\s+const p = pedidoDeCaras\(dicho\);/);
  // Esperando el «sí» de la presentada: la orden no se toma como «no escuché un sí»; se cumple, y nada se guarda.
  const m = mesa();
  await m.a.presentar('Bea', 'hija');
  const dichos = m.dicho.length;
  assert.equal(await m.a.respuesta('apaga la cámara'), false);
  assert.equal(m.dicho.length, dichos);
  assert.equal(m.guardadas.length, 0);
  assert.equal(m.a.presentacion.pendiente(), null);
  // Lo que sí es la respuesta no se interrumpe: un nombre, «se llama…», «sí», «no».
  for (const f of ['Bea', 'Lucía', 'sí', 'No', 'ahorita no']) assert.equal(interrumpeEspera(f), false, f);
  for (const f of ['Se llama Bea', 'Es mi hija Bea', 'sí, se llama Bea']) assert.equal(nombreConMarca(f), true, f);
});

prueba('revisión (MEDIO 2): un invitado que dice una frase corta durante la espera no recibe «eso es de la dueña» (solo si de verdad da un nombre)', async () => {
  const m = mesa();
  await m.a.acompanante(pedidoDeCaras('Me acompaña mi hija.'));
  for (const f of ['hola', 'gracias', 'qué hora es', 'ahorita no', 'la niña', 'esa', 'sí', 'no', 'cállate', 'apaga la cámara', 'Muy bien'])
    assert.equal(m.a.esperaNombre(f), false, `${f}: no pasa por «¿quién habla?» como un nombre`);
  for (const f of ['Bea', 'Se llama Bea', 'es mi hija Bea']) assert.equal(m.a.esperaNombre(f), true, `${f}: un nombre, solo la dueña`);
});

prueba('revisión (MEDIO 3): con la dueña SIN guardar y dos caras, ninguna (antes, la más grande: la de la dueña, guardada como su hija)', async () => {
  const duena = cara(vec(1), 0.1, 0.4);
  const hija = cara(vec(7), 0.6, 0.2);
  assert.equal(caraDelPresentado([duena, hija], []), null, 'no hay cómo saber cuál es la dueña');
  assert.equal(caraDelPresentado([hija], []).vector, hija.vector, 'una sola cara (confirmada antes por la dueña): esa');
  // De punta a punta: la dueña sin guardar, Bea dice «sí», pero en las poses salen dos caras → nada se guarda.
  const m = mesa({ conocidas: [], fotoPose: [duena, hija] });
  await m.a.presentar('Bea', 'hija');
  await m.a.respuesta('sí');
  assert.equal(m.guardadas.length, 0, 'ni la cara de la dueña ni la de Bea');
  assert.match(m.dicho.at(-1), /a Marta todavía no la conozco: no sé cuál es la tuya.*«conóceme»/);
});

prueba('revisión (MEDIO 3): «me acompaña mi hija» con la dueña sin guardar: con una cara (puede ser la suya) pide confirmar antes de presentar; con dos, no ofrece', async () => {
  // Una cara sin nombre (la de la dueña, con la hija fuera de cuadro): no se ofrece aprender a ciegas.
  const una = mesa({ conocidas: [], vista: { r: [], sinNombre: 1 } });
  assert.equal(await una.a.acompanante(pedidoDeCaras('Me acompaña mi hija.')), true);
  assert.doesNotMatch(una.dicho[0], /aprendo su cara/);
  assert.match(una.dicho[0], /a ti todavía no te conozco: puede ser la tuya\. Si la que está sola frente a la cámara es tu hija, sin ti, dime «sí» y su nombre; si eres tú, di «conóceme»/);
  assert.equal(una.a.oferta.pendiente()?.soloNueva, true);
  // El nombre solo no basta: falta el «sí» a que esa cara es la de Bea.
  await una.a.respuesta('Bea');
  assert.equal(una.a.presentacion.pendiente(), null, 'todavía no se presenta a nadie');
  assert.match(una.dicho.at(-1), /¿La única cara frente a la cámara es la de Bea, sin ti\? Dime «sí»/);
  assert.equal(una.a.esperaNombre('sí'), true, 'ese «sí» lo da la dueña (pasa por «¿quién habla?»)');
  await una.a.respuesta('sí');
  assert.equal(una.a.presentacion.pendiente(), 'Bea', 'confirmado: ahora sí, «Bea, ¿te puedo recordar?»');
  assert.equal(una.guardadas.length, 0);
  // «Sí, se llama Bea» ya confirma.
  const si = mesa({ conocidas: [], vista: { r: [], sinNombre: 1 } });
  await si.a.acompanante(pedidoDeCaras('Me acompaña mi hija.'));
  await si.a.respuesta('Sí, se llama Bea');
  assert.equal(si.a.presentacion.pendiente(), 'Bea');
  // «No»: nada.
  const no = mesa({ conocidas: [], vista: { r: [], sinNombre: 1 } });
  await no.a.acompanante(pedidoDeCaras('Me acompaña mi hija Bea'));
  assert.match(no.dicho[0], /¿La única cara frente a la cámara es la de Bea, sin ti\?/, 'con el nombre dicho, solo el «sí»');
  await no.a.respuesta('no');
  assert.equal(no.a.presentacion.pendiente(), null);
  assert.equal(no.a.oferta.pendiente(), null);
  // Dos caras sin nombre y la dueña sin guardar: no se sabe cuál es la nueva; no se espera ningún nombre.
  const dos = mesa({ conocidas: [], vista: { r: [], sinNombre: 2 } });
  await dos.a.acompanante(pedidoDeCaras('Me acompaña mi hija.'));
  assert.match(dos.dicho[0], /no sé cuál es tu hija\. Primero dime «conóceme», o que quede solo tu hija frente a la cámara/);
  assert.equal(dos.a.oferta.pendiente(), null);
  await dos.a.quien();
  assert.equal(dos.a.oferta.pendiente(), null, '«¿quién es ella?» tampoco');
  // La oferta del cerebro («¿cómo se llama? … la recuerdo») con dos caras y la dueña sin guardar: no abre la espera.
  dos.a.ofrecida(undefined, 2);
  assert.equal(dos.a.oferta.pendiente(), null);
  dos.a.ofrecida(undefined, 1);
  assert.equal(dos.a.oferta.pendiente()?.soloNueva, true);
  // Con la dueña guardada, como siempre.
  const guardada = mesa();
  guardada.a.ofrecida(undefined, 2);
  assert.deepEqual(guardada.a.oferta.pendiente(), {});
  assert.equal(ofertaSinDuena(1, { parentesco: 'hija' }).espera, true);
});

prueba('revisión (LEVE): «te presento a esa» no es una presentación; «sí, pero no» no es un «sí»; «recuérdame lo del banco» tampoco', () => {
  assert.equal(pedidoDeCaras('te presento a esa'), null);
  assert.equal(pedidoDeCaras('Te presento a esta persona'), null);
  assert.equal(pedidoDeCaras('te presento a ella'), null);
  assert.deepEqual(pedidoDeCaras('Te presento a Don Pedro'), { tipo: 'presentar', nombre: 'Don Pedro' });
  assert.deepEqual(pedidoDeCaras('te presento a Bea'), { tipo: 'presentar', nombre: 'Bea' });
  for (const f of ['sí, pero no', 'Sí… no sé', 'sí, espera', 'sí, pero mejor luego', 'recuérdame lo del banco', 'puedes recordarme otro día']) assert.equal(esConsentimiento(f), null, f);
  assert.equal(esConsentimiento('claro que no'), 'no');
  for (const f of ['Sí', 'sí, claro', 'claro que sí', 'recuérdame', 'sí, puedes recordarme']) assert.equal(esConsentimiento(f), 'si', f);
});

for (const [nombre, f] of pruebas) {
  n += 1;
  try {
    await f();
    console.log(`ok    ${nombre}`);
  } catch (e) {
    fallos += 1;
    console.log(`FALLA ${nombre}\n      ${e?.message || e}`);
  }
}
console.log(`\n${n - fallos}/${n} pruebas bien`);
process.exit(fallos ? 1 : 0);
