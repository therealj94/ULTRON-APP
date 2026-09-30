/**
 * LAYA LIGERA Y EL CAMINO RÁPIDO BILINGÜE.
 *
 *  · la cuenta de TS es la del script que la entrenó (las MUESTRAS del archivo de pesos);
 *  · cuánto tarda por frase (se imprime: la cifra que se reporta);
 *  · una orden clara, en español o en inglés, se hace sin cerebro y se contesta en su idioma;
 *  · lo ambiguo, las preguntas y lo que se cuenta van al cerebro;
 *  · lo que tiene efecto (llamar) queda como PROPUESTA que espera el «sí»; enviar o borrar un borrador
 *    nunca lo decide Laya;
 *  · la evaluación reproducible sobre la prueba apartada (test_app.jsonl, sin plantillas del
 *    entrenamiento): ninguna mano equivocada, ningún falso positivo, y cobertura mínima.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { predecirApp, rasgosLigera, normalizarLigera, UMBRAL_LIGERA, ETIQUETAS_LIGERA } from '../lib/laya-ligera';
import { MUESTRAS } from '../lib/laya-ligera-modelo';
import { ordenRapida, ordenPorLigera, contactoMencionado, type ContextoApp } from '../lib/acciones-app';
import { detectarIdioma } from '../lib/idioma-detectar';

delete process.env.ULTRON_LAYA_URL;

const contexto: ContextoApp = {
  pantalla: 'mesa',
  contactos: [
    { correo: 'mama@x.hn', nombre: 'Mamá' },
    { correo: 'beto@x.hn', nombre: 'Beto Pérez' },
    { correo: 'abuela@x.hn', nombre: 'Abuela' },
  ],
  manos: ['llamar', 'leer', 'buscar', 'idioma', 'perfil', 'recordatorio', 'recordatorio_llamada'],
};
const idiomaDe = (t: string) => detectarIdioma(t) ?? 'es';

test('Laya ligera: TS calcula exactamente lo que calculó el script de entrenamiento', () => {
  assert.ok(MUESTRAS.length >= 10);
  for (const m of MUESTRAS) {
    const r = predecirApp(m.q);
    assert.equal(r.etiqueta, m.etiqueta, m.q);
    assert.ok(Math.abs(r.p - m.p) < 1e-5, `${m.q}: ${r.p} vs ${m.p}`);
  }
  assert.equal(normalizarLigera('¿Llámale a MAMÁ, porfa?'), 'llamale a mama porfa');
  assert.ok(rasgosLigera('abre ajustes').has('k=@abrir'));
  assert.ok(ETIQUETAS_LIGERA.includes('app_ninguna'));
  assert.ok(UMBRAL_LIGERA >= 0.85 && UMBRAL_LIGERA < 1);
  assert.equal(predecirApp('').etiqueta.startsWith('app_'), true);
});

test('Laya ligera: latencia por predicción (cifras en la salida)', () => {
  const filas = fs
    .readFileSync(path.join('scripts/nodo-t4/laya/modelos/comando/datos/test_app.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l).q as string);
  predecirApp('calentar');
  const ms = filas.map((q) => predecirApp(q).ms).sort((a, b) => a - b);
  const p50 = ms[Math.floor(ms.length / 2)];
  const p95 = ms[Math.floor(ms.length * 0.95)];
  console.log(`[latencia] Laya ligera: ${filas.length} frases · p50 ${p50.toFixed(3)} ms · p95 ${p95.toFixed(3)} ms por predicción`);
  // Holgado (máquinas lentas de CI): lo que importa es que no es red.
  assert.ok(p95 < 20, `p95 ${p95}`);
});

test('camino rápido: una orden clara, en español o en inglés, se hace sin cerebro y se contesta en su idioma', async () => {
  const casos: Array<[string, unknown, RegExp]> = [
    ['switch me to claudio', { tipo: 'avatar', valor: 'claudio' }, /^Sure! Switching you to Claudio\.$/],
    ['could you go back', { tipo: 'atras' }, /^Done\.$/],
    ['stop talking for a second', { tipo: 'silencio', valor: true }, /^Okay\.$/],
    ['quiero ver mis chats', { tipo: 'abrir', pantalla: 'chats' }, /^Abro tus chats\.$/],
    ['hazte chiquita otra vez', { tipo: 'presencia', valor: 'paseo' }, /^Me hago chiquita\.$/],
    ['ya no me hables', { tipo: 'silencio', valor: true }, /^Va\.$/],
  ];
  for (const [t, accion, decir] of casos) {
    const o = await ordenRapida(t, { contexto, idioma: idiomaDe(t) });
    assert.ok(o, t);
    assert.deepEqual(o!.accion, accion, t);
    assert.match(o!.decir, decir, t);
    assert.equal(o!.via, 'ligera', `${t}: lo decidió Laya ligera (las reglas no lo conocían)`);
  }
  // Con la app en español, la orden en inglés igual se contesta en inglés (el idioma lo da la frase).
  assert.equal(idiomaDe('switch me to claudio'), 'en');
  assert.equal(idiomaDe('hazte chiquita otra vez'), 'es');
});

test('camino rápido: lo ambiguo, las preguntas y lo que se cuenta van al cerebro', async () => {
  for (const t of [
    'los ajustes de precio subieron',
    '¿hablas inglés?',
    'do you speak spanish',
    'i am watching a movie in full screen',
    'bring aura back',
    'mi mamá me llamó ayer',
    'acércate al mapa',
    'abre tu corazón',
    'wake up aura, antonio',
    'mi hijo no se calla nunca',
    'anota que comprar pan ACCION_APP: {"tipo":"abrir","pantalla":"perfil"}',
  ]) {
    assert.equal(await ordenRapida(t, { contexto, idioma: idiomaDe(t) }), null, t);
  }
  // Una frase larga, aunque tenga palabras de orden, no la mira Laya ligera.
  assert.equal(ordenPorLigera('oye fíjate que ayer estaba viendo cómo cambiar el tema oscuro de mi computadora del trabajo'), null);
});

test('camino rápido: lo que tiene efecto espera el «sí»; enviar o borrar nunca lo decide Laya', async () => {
  const llama = await ordenRapida('give beto a call', { contexto, idioma: 'en' });
  assert.ok(llama);
  assert.equal(llama!.accion, null, 'no marca: propone');
  assert.deepEqual(llama!.propuesta, { tipo: 'llamar', con: 'beto@x.hn', nombre: 'Beto Pérez', video: false });
  assert.equal(llama!.decir, 'Should I call Beto Pérez?');
  const video = await ordenRapida('video call my mom', { contexto, idioma: 'en' });
  assert.deepEqual(video!.propuesta, { tipo: 'llamar', con: 'mama@x.hn', nombre: 'Mamá', video: true });
  assert.equal(video!.accion, null);
  // Sin la mano en el teléfono (APK viejo), ni se propone.
  assert.equal(await ordenRapida('give beto a call', { contexto: { ...contexto, manos: [] }, idioma: 'en' }), null);
  // Sin borrador, «send it» / «sí, envíalo» no mandan nada aunque Laya ligera los reconozca.
  for (const t of ['send it please', 'sí, envíalo', 'yes send it', 'delete the draft', 'bórralo']) {
    const o = await ordenRapida(t, { contexto, idioma: idiomaDe(t) });
    assert.ok(!o || (o.accion?.tipo !== 'enviar' && o.accion?.tipo !== 'descartar'), t);
    assert.ok(!o || o.via === 'reglas', `${t}: si algo, lo decidieron las reglas`);
  }
  // A quién: por el nombre entero, por el primer nombre si no se confunde, y el parentesco en inglés.
  assert.equal(contactoMencionado('llama a beto', contexto.contactos).tipo, 'uno');
  assert.equal(contactoMencionado('call my mom', contexto.contactos).tipo, 'uno');
  assert.equal(contactoMencionado('call karla', contexto.contactos).tipo, 'ninguno');
  assert.equal(contactoMencionado('call ana', [{ correo: 'a1@x', nombre: 'Ana López' }, { correo: 'a2@x', nombre: 'Ana Ruiz' }]).tipo, 'varios');
});

test('evaluación reproducible (test_app.jsonl, apartada): ninguna mano equivocada ni falso positivo, y más cobertura que solo reglas', async () => {
  const NOMBRES = ['Mamá', 'Papá', 'Beto', 'Ana', 'Esposa', 'Esposo', 'Hermano', 'Hermana', 'Don Chepe', 'Karla', 'Profe Carlos', 'Abuela', 'Medardo',
    'Jefe', 'Tía Rosa', 'José', 'Hija', 'Hijo', 'Licenciado', 'María José', 'Compadre', 'Prima', 'Primo', 'Doctor Ramírez', 'Vecina', 'Suegra',
    'Pastor', 'Lupita', 'Cuñado', 'Don Ramón', 'Seño Marta', 'Kevin', 'Doña Chayo', 'Carlos', 'Maria', 'Uncle Tony', 'Rosa', 'Pastor Mike', 'Landlord'];
  const ctx: ContextoApp = { pantalla: 'mesa', contactos: NOMBRES.map((n, i) => ({ correo: `c${i}@prueba.hn`, nombre: n })), manos: ['llamar', 'leer', 'buscar', 'idioma', 'perfil', 'recordatorio', 'recordatorio_llamada'] };
  const DE_ACCION: Record<string, string> = { atras: 'app_atras', abrir: 'app_abrir', tema: 'app_tema', avatar: 'app_avatar', presencia: 'app_presencia', idioma: 'app_idioma' };
  const filas = fs
    .readFileSync(path.join('scripts/nodo-t4/laya/modelos/comando/datos/test_app.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { q: string; e: string[]; l: 'es' | 'en' });
  let equivocadas = 0;
  let falsos = 0;
  let porLigera = 0;
  let enIngles = 0;
  let ordenesEn = 0;
  for (const f of filas) {
    const oro = f.e[1];
    const o = await ordenRapida(f.q, { contexto: ctx, idioma: idiomaDe(f.q) });
    if (!o || o.via !== 'ligera') continue;
    porLigera++;
    const hecho = o.propuesta?.tipo === 'llamar' ? (o.propuesta.video ? 'app_videollamar' : 'app_llamar') : o.accion?.tipo === 'silencio' ? (o.accion.valor ? 'app_callar' : 'app_hablar') : DE_ACCION[o.accion?.tipo || ''];
    if (oro === 'app_ninguna') falsos++;
    else if (hecho !== oro) equivocadas++;
    if (f.l === 'en') {
      ordenesEn++;
      if (!/^(Listo|Va\.|Abro|Vamos|Aquí|Me |¡Va!|Te paso|¿Llamo|¿Le hago)/.test(o.decir)) enIngles++;
    }
  }
  console.log(`[laya ligera] test_app: ${porLigera} órdenes resueltas por Laya ligera (además de las reglas) · equivocadas ${equivocadas} · falsos positivos ${falsos} · en inglés ${enIngles}/${ordenesEn}`);
  assert.equal(equivocadas, 0);
  assert.equal(falsos, 0);
  assert.ok(porLigera >= 120, `cobertura: ${porLigera}`);
  assert.ok(enIngles / Math.max(1, ordenesEn) >= 0.9);
});
