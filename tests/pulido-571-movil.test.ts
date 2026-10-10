/**
 * EL PULIDO DE LA APK 5.7.1 (AU-RA):
 *
 *  · Fase 0 de la revisión del diseño (riesgos vistos en el código, no reproducidos en un teléfono): el área de toque de
 *    los botones chico y fantasma (≥ 48 dp de verdad), «reducir movimiento» en la AU-RA chiquita (al montarse y al
 *    cambiarlo), el borde derecho de la mesa que competía con el «atrás» de Android y las medidas de la burbuja con el
 *    teclado abierto, la letra al 200 % y el teléfono acostado.
 *  · La llamada del avatar que se queda detrás: la guardia NATIVA (compa/fondoLlamada.ts + GuardiaLlamadaAura.kt) la
 *    cuelga a su hora aunque los relojes de JS estén congelados, y avisa el cierre al servidor desde el nativo.
 *  · «Llámame» desde la burbuja con la app nunca abierta: la burbuja se lo pasa a la app (burbuja/llamameBurbuja.ts).
 *
 * Lo nativo no se compila aquí (sin Android SDK): se comprueban sus piezas en el Kotlin y, con las dependencias del
 * teléfono, el manifiesto que deja el plugin (se saltan sin ellas, como tests/asistente-digital-movil.test.ts).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { GRACIA_BURBUJA_MS, GRACIA_EN_LLAMADA_MS, GRACIA_FONDO_MS, GuardiaFondoLlamada, VENTANA_PROPIA_MS, cierreNativo } from '../mobile/src/compa/fondoLlamada';
import { BuzonLlamame, VIGENCIA_LLAMAME_MS, esLlamame, llamameDelTurno } from '../mobile/src/burbuja/llamameBurbuja';
import { capacidadesDeSuperficie } from '../mobile/src/telefono/capacidades';
import { ORBE_MIN, TOQUE_MIN as TOQUE_BURBUJA, medidasBurbuja } from '../mobile/src/burbuja/medidas';
import { TOQUE_MIN, medidasBoton, type VarianteToque } from '../mobile/src/ui/toque';
import { RESPIRO_QUIETO, buclesOrbeMini } from '../mobile/src/avatar3d/movimientoOrbe';
import { claseDeAccion } from '../lib/superficie';

const requerir = createRequire(import.meta.url);
const raizMovil = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../mobile');
const leer = (r: string) => fs.readFileSync(path.join(raizMovil, r), 'utf8');
/** El código sin sus comentarios (los comentarios cuentan la historia: nombran lo que ya no se usa). */
const sinComentarios = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

let plugin: any = null;
let sinExpo: string | false = false;
try {
  plugin = requerir(path.join(raizMovil, 'plugins/asistente-digital.js'));
} catch (e: any) {
  if (e?.code !== 'MODULE_NOT_FOUND') throw e;
  sinExpo = 'faltan las dependencias del teléfono (expo/config-plugins): corre en «Calidad (antes de publicar la app)»';
}
const PAQUETE = 'link.ordenglobal.ultronfp';

/* ── la guardia nativa ───────────────────────────────────────────────────────────────────────── */

/** La guardia con un reloj de JS que se puede congelar y un «nativo» de mentira que corre siempre. */
function montarGuardia(o: { contestada?: boolean; burbuja?: boolean } = {}) {
  let ahora = 1_000_000;
  let congelado = false;
  let appState = 'active';
  let llamada = true;
  let contestada = o.contestada ?? true;
  const timers = new Map<number, { cuando: number; f: () => void }>();
  let n = 0;
  const nativo = { armado: null as null | { hasta: number }, armados: [] as number[], desarmados: 0 };
  const colgadas: string[] = [];
  const guardia = new GuardiaFondoLlamada({
    hayLlamada: () => llamada,
    contestada: () => contestada,
    estadoApp: () => appState,
    burbuja: () => !!o.burbuja,
    colgar: (d) => {
      colgadas.push(d);
      llamada = false;
    },
    ahora: () => ahora,
    setTimeout: (f, ms) => {
      timers.set(++n, { cuando: ahora + ms, f });
      return n;
    },
    clearTimeout: (h) => void timers.delete(h as number),
    armarNativo: (ms) => {
      nativo.armados.push(ms);
      nativo.armado = { hasta: ahora + ms };
    },
    desarmarNativo: () => {
      nativo.desarmados++;
      nativo.armado = null;
    },
  });
  /** Pasa el tiempo: los relojes de JS solo si no están congelados; el nativo, siempre (dispara su evento). */
  const pasar = (ms: number) => {
    const fin = ahora + ms;
    for (;;) {
      const js = congelado ? [] : [...timers.entries()].filter(([, t]) => t.cuando <= fin).sort((a, b) => a[1].cuando - b[1].cuando);
      const nat = nativo.armado && nativo.armado.hasta <= fin ? nativo.armado.hasta : Infinity;
      const prox = Math.min(js[0]?.[1].cuando ?? Infinity, nat);
      if (prox === Infinity) break;
      ahora = Math.max(ahora, prox);
      if (nat === prox) {
        nativo.armado = null;
        guardia.disparoNativo();
        continue;
      }
      const [id, t] = js[0];
      timers.delete(id);
      t.f();
    }
    ahora = fin;
  };
  const app = (st: string) => {
    appState = st;
    guardia.estado(st);
  };
  return {
    guardia,
    nativo,
    colgadas,
    pasar,
    app,
    congelar: (si: boolean) => (congelado = si),
    contestar: () => (contestada = true),
    sinLlamada: () => (llamada = false),
    ahora: () => ahora,
  };
}

test('guardia nativa: contestada y detrás con los relojes de JS congelados, cuelga a los 30 s (no al volver)', () => {
  const g = montarGuardia();
  g.app('background');
  g.congelar(true);
  assert.deepEqual(g.nativo.armados, [GRACIA_EN_LLAMADA_MS], 'se arma con la gracia de una llamada contestada');
  g.pasar(GRACIA_EN_LLAMADA_MS - 100);
  assert.deepEqual(g.colgadas, [], 'antes del plazo, nada');
  g.pasar(200);
  assert.equal(g.colgadas.length, 1, 'a los 30 s cuelga, con JS congelado');
  assert.match(g.colgadas[0], /guardia nativa/);
  // Al volver ya no hay nada que colgar ni que desarmar dos veces.
  g.app('active');
  assert.equal(g.colgadas.length, 1);
});

test('guardia nativa: sonando son 3 s; volver antes la desarma y no cuelga nada', () => {
  const g = montarGuardia({ contestada: false });
  g.app('background');
  assert.deepEqual(g.nativo.armados, [GRACIA_FONDO_MS]);
  g.congelar(true);
  g.pasar(1_000);
  g.app('active');
  assert.equal(g.nativo.armado, null, 'volver la desarma');
  assert.equal(g.nativo.desarmados, 1);
  g.pasar(GRACIA_EN_LLAMADA_MS * 2);
  assert.deepEqual(g.colgadas, []);
});

test('guardia nativa: una transición propia corre el plazo hasta el final de su ventana; con la burbuja, la gracia larga', () => {
  const g = montarGuardia({ contestada: false });
  g.app('background');
  g.guardia.propia('contestó desde el aviso');
  assert.equal(g.nativo.armados.at(-1), VENTANA_PROPIA_MS + GRACIA_FONDO_MS, 'la ventana propia y después la gracia');
  g.congelar(true);
  g.pasar(VENTANA_PROPIA_MS + GRACIA_FONDO_MS - 100);
  assert.deepEqual(g.colgadas, []);
  g.pasar(200);
  assert.equal(g.colgadas.length, 1);

  const b = montarGuardia({ contestada: true, burbuja: true });
  b.app('background');
  assert.equal(b.nativo.armados[0], Math.max(GRACIA_EN_LLAMADA_MS, GRACIA_BURBUJA_MS));
});

test('guardia nativa: sin llamada no se arma; un aviso que llega con la app delante no cuelga', () => {
  const g = montarGuardia();
  g.sinLlamada();
  g.app('background');
  assert.deepEqual(g.nativo.armados, []);

  const h = montarGuardia();
  h.app('background');
  h.app('active');
  assert.equal(h.guardia.disparoNativo(), false, 'ya delante: el aviso tardío no cuelga');
  assert.deepEqual(h.colgadas, []);
  // Soltar (se desmonta la voz) desarma lo que quedara.
  h.app('background');
  h.guardia.soltar();
  assert.equal(h.nativo.armado, null);
});

test('el cierre que manda el nativo: solo https y con pase, la misma ruta que JS', () => {
  const c = cierreNativo({ base: 'https://aura-fp.onrender.com/', pase: 'p.abc', cabeceras: { 'x-ultron-sesion': 'tok', 'x-aura-aparato': 'tel-1', vacia: '' } });
  assert.ok(c);
  assert.equal(c.url, 'https://aura-fp.onrender.com/api/voz/agente/cerrar');
  assert.deepEqual(JSON.parse(c.cuerpo), { pase: 'p.abc' });
  assert.equal(c.cabeceras['x-ultron-sesion'], 'tok');
  assert.equal(c.cabeceras['Content-Type'], 'application/json');
  assert.ok(!('vacia' in c.cabeceras));
  assert.equal(cierreNativo({ base: 'http://inseguro', pase: 'p', cabeceras: {} }), null);
  assert.equal(cierreNativo({ base: 'https://x', pase: '', cabeceras: {} }), null);
  // La ruta existe en el servidor con ese cuerpo.
  assert.match(fs.readFileSync(path.join(raizMovil, '../server/voz-agente.ts'), 'utf8'), /app\.post\('\/api\/voz\/agente\/cerrar'[\s\S]{0,400}req\.body\?\.pase/);
});

test('el Kotlin de la guardia: Handler del hilo principal, se cancela al volver, solo https, sin servicio ni WorkManager', () => {
  const kt = leer('plugins/asistente-digital-nativo/java/GuardiaLlamadaAura.kt');
  assert.match(kt, /^package __PAQUETE__\.asistente$/m);
  assert.match(kt, /class GuardiaLlamadaAura\(private val ctx: ReactApplicationContext\) : ReactContextBaseJavaModule\(ctx\), LifecycleEventListener/);
  assert.match(kt, /Handler\(Looper\.getMainLooper\(\)\)/);
  assert.match(kt, /override fun onHostResume\(\) \{\s*delante = true\s*cancelar\(\)/, 'volver delante cancela el plazo');
  assert.match(kt, /if \(delante\) return@post/, 'con la app delante no se arma');
  assert.match(kt, /url\.startsWith\("https:\/\/"\)/);
  assert.match(kt, /requestMethod = "POST"/);
  assert.match(kt, /@ReactMethod\s+fun armar\(ms: Double, cierre: ReadableMap\?\)/);
  assert.match(kt, /@ReactMethod\s+fun desarmar\(\)/);
  assert.match(kt, /@ReactMethod\s+fun tomarDisparo\(promesa: Promise\)/);
  assert.doesNotMatch(sinComentarios(kt), /startForeground|WorkManager|AlarmManager/);
  // El evento y el nombre del módulo, los mismos que lee JS.
  const js = leer('src/compa/guardiaNativa.ts');
  const evento = /const val EVENTO = "([^"]+)"/.exec(kt)?.[1];
  assert.ok(evento && js.includes(`EVENTO_GUARDIA_LLAMADA = '${evento}'`));
  const nombre = /const val NOMBRE = "([^"]+)"/.exec(kt)?.[1];
  assert.ok(nombre && js.includes(`'${nombre}'`) && js.includes(`.${nombre}`));
  // La sirve el paquete que ya registra MainApplication (sin tocar getPackages otra vez).
  const paquete = leer('plugins/asistente-digital-nativo/java/TelefonoAura.kt');
  assert.match(paquete, /GuardiaLlamadaAura\.NOMBRE -> GuardiaLlamadaAura\(reactContext\)/);
  assert.match(paquete, /GuardiaLlamadaAura\.NOMBRE to ReactModuleInfo\(GuardiaLlamadaAura\.NOMBRE, GuardiaLlamadaAura::class\.java\.name, false, false, false, false\)/);
  // Dr Electrum y las APK de antes: sin módulo, la guardia de JS de siempre.
  assert.match(js, /if \(Platform\.OS !== 'android' \|\| ES_ELECTRUM\) return \(cache = null\)/);
});

test('la voz cablea la guardia nativa: la arma con el cierre, la oye y la toma al volver', () => {
  const v = leer('src/compa/VozProvider.tsx');
  assert.match(v, /armarNativo: \(ms: number\) =>/);
  assert.match(v, /nativa\.armar\(ms, cierre\)/);
  assert.match(v, /if \(yo !== armado\) return;/, 'un desarmar que llega mientras se arma gana');
  assert.match(v, /alDispararGuardia\(alDisparoNativo\)/);
  assert.match(v, /guardia\.disparoNativo\(\)/);
  assert.match(v, /\?\.tomarDisparo\(\)\s*\.then\(\(en\) =>/);
  assert.match(v, /paseVivo\.current = p\.pase \|\| null/);
});

test('manifiesto: la guardia no añade servicios ni permisos; el Kotlin se copia con el paquete', { skip: sinExpo }, async () => {
  const raizAndroid = fs.mkdtempSync(path.join(os.tmpdir(), 'pulido-571-'));
  const config = plugin({ name: 'AU-RA FP', slug: 'ultron-fp', scheme: 'ultronfp', android: { package: PAQUETE } });
  const modRequest = { platform: 'android', projectRoot: raizMovil, platformProjectRoot: raizAndroid, introspect: false };
  await config.mods.android.dangerous({ ...config, modResults: {}, modRequest: { ...modRequest, modName: 'dangerous' } });
  const base = {
    manifest: {
      $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
      application: [
        {
          $: { 'android:name': '.MainApplication' },
          activity: [{ $: { 'android:name': '.MainActivity' }, 'intent-filter': [{ action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }], category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }] }] }],
          service: [{ $: { 'android:name': 'app.notifee.core.ForegroundService', 'android:foregroundServiceType': 'microphone|camera' } }],
        },
      ],
    },
  };
  const r = await config.mods.android.manifest({ ...config, modResults: base, modRequest: { ...modRequest, modName: 'manifest' } });
  const m = r.modResults.manifest;
  const servicios = m.application[0].service.map((s: any) => s.$['android:name']);
  assert.deepEqual(
    servicios.filter((n: string) => /Guardia|Llamada/i.test(n)),
    [],
    'ningún servicio nuevo para la guardia'
  );
  const notifee = m.application[0].service.find((s: any) => s.$['android:name'] === 'app.notifee.core.ForegroundService');
  assert.equal(notifee.$['android:foregroundServiceType'], 'microphone|camera', 'el servicio de las llamadas, intacto');
  const permisos = (m['uses-permission'] || []).map((p: any) => p.$['android:name']);
  assert.ok(!permisos.includes('android.permission.FOREGROUND_SERVICE_PHONE_CALL'), 'nunca phoneCall');
  const kt = fs.readFileSync(path.join(raizAndroid, 'app/src/main/java', ...PAQUETE.split('.'), 'asistente', 'GuardiaLlamadaAura.kt'), 'utf8');
  assert.match(kt, new RegExp(`^package ${PAQUETE.replace(/\./g, '\\.')}\\.asistente$`, 'm'));
  assert.doesNotMatch(kt, /__PAQUETE__/);
});

/* ── «llámame» desde la burbuja ──────────────────────────────────────────────────────────────── */

test('el buzón del «llámame»: lo toma una vez quien lo atiende, caduca y avisa al que ya escucha', () => {
  const b = new BuzonLlamame();
  assert.equal(b.tomar(0), false);
  let avisos = 0;
  const fuera = b.escuchar(() => avisos++);
  b.pedir(1_000);
  assert.equal(avisos, 1, 'en caliente: el VozProvider montado lo oye en el acto');
  assert.equal(b.pendiente(1_500), true, 'mirar no lo consume');
  assert.equal(b.tomar(2_000), true);
  assert.equal(b.tomar(2_001), false, 'una sola vez');
  fuera();
  b.pedir(10_000);
  assert.equal(avisos, 1);
  assert.equal(b.tomar(10_000 + VIGENCIA_LLAMAME_MS + 1), false, 'pasado el minuto ya no suena');
});

test('en frío: la burbuja ve el «llámame» de su turno, lo deja en el buzón y la app lo toma al montarse; en caliente no se atiende dos veces', async () => {
  // El puente de acciones se carga sin que tsc de la raíz lo siga (es código de la app, con su tsconfig estricto).
  const ruta = '../mobile/src/compa/acciones';
  const { accionNueva } = (await import(ruta)) as { accionNueva: (id?: string | null, accion?: unknown) => boolean };
  assert.equal(esLlamame({ id: 'a1', accion: { tipo: 'llamame' } }), true);
  assert.equal(esLlamame({ tipo: 'abrir_app', app: 'spotify' }), false);
  // En frío: nadie lo atendió antes (no hay canal de acciones sin la app): la burbuja lo atiende.
  const buzon = new BuzonLlamame();
  const turno = [{ id: 'pulido-571-frio', accion: { tipo: 'llamame' } }];
  assert.equal(llamameDelTurno(turno, (id, a) => accionNueva(id, a)), true);
  buzon.pedir(5_000);
  // La app se abre por el enlace; su VozProvider se monta después y lo toma.
  assert.equal(buzon.tomar(7_000), true);
  // En caliente: el canal de la app de atrás ya lo atendió con el mismo id: el turno de la burbuja no lo repite.
  assert.equal(accionNueva('pulido-571-caliente', { tipo: 'llamame' }), true, 'lo atendió el SSE de la app');
  assert.equal(llamameDelTurno([{ id: 'pulido-571-caliente', accion: { tipo: 'llamame' } }], (id, a) => accionNueva(id, a)), false);
  assert.equal(llamameDelTurno(null, () => true), false);
});

test('la burbuja declara «llámame» (lo completa abriendo la app) y lo pasa a la app en vez de dejarlo en revisión', () => {
  const caps = capacidadesDeSuperficie('burbuja', { android: true, electrum: false });
  assert.ok(caps.includes('llamame'));
  assert.equal(claseDeAccion('llamame', 'burbuja', caps), 'local');
  assert.deepEqual(capacidadesDeSuperficie('burbuja', { android: true, electrum: true }), [], 'Dr Electrum: nada');
  const turno = leer('src/burbuja/turnoBurbuja.ts');
  assert.match(turno, /!esAccionTelefono\(accionDe\(x\)\) && !esLlamame\(x\)/, 'el «llámame» no deja la burbuja «esperando revisión»');
  assert.match(turno, /llamameDelTurno\(r\.acciones, \(id, accion\) => accionNueva\(id, accion\)\)/);
  const b = leer('src/burbuja/Burbuja.tsx');
  assert.match(b, /if \(r\.llamame\) \{\s*\/\/[^\n]*\n\s*llamarEnLaAppRef\.current\(\);/);
  assert.match(b, /const llamarEnLaApp = \(\) => \{\s*buzonLlamame\.pedir\(Date\.now\(\)\);[\s\S]*?cerrar\('abrir-app'\);\s*void Linking\.openURL\(enlaceHablar\('burbuja'\)\)/);
  const v = leer('src/compa/VozProvider.tsx');
  assert.match(v, /if \(!usuarioActual\(\) \|\| !buzonLlamame\.tomar\(Date\.now\(\)\)\) return;/, 'solo con la cuenta puesta');
  assert.match(v, /buzonLlamame\.escuchar\(alLlamameDeBurbuja\);\s*alLlamameDeBurbuja\(\);/, 'en caliente y al montarse (en frío)');
  assert.match(v, /guardia\.propia\('la llamada suena: la app viene delante', VENTANA_TRAER_MS\)/);
});

/* ── Fase 0 ──────────────────────────────────────────────────────────────────────────────────── */

test('Fase 0 · botones: el área de toque de cada variante es de al menos 48 dp (lo que se ve, igual)', () => {
  const variantes: VarianteToque[] = ['principal', 'secundario', 'fantasma', 'peligro', 'texto', 'contorno'];
  for (const v of variantes)
    for (const tam of ['normal', 'chico'] as const) {
      const m = medidasBoton(v, tam);
      assert.ok(m.toque >= TOQUE_MIN, `${v}/${tam}`);
      assert.ok(m.toque >= m.alto);
    }
  assert.deepEqual(medidasBoton('secundario', 'chico'), { alto: 42, toque: 48 });
  assert.deepEqual(medidasBoton('fantasma'), { alto: 44, toque: 48 });
  assert.deepEqual(medidasBoton('principal'), { alto: 54, toque: 54 });
  const boton = leer('src/ui/Boton.tsx');
  assert.match(boton, /style=\{holgura \? \[s\.toque, \{ minHeight: toque \}\] : cara\}/);
  assert.doesNotMatch(sinComentarios(boton), /hitSlop/, 'el hitSlop no pasa del padre en Android: no se usa');
});

test('Fase 0 · AU-RA chiquita: sin bucles con «reducir movimiento» (ni mientras no se sabe) y lo oye cambiar', () => {
  assert.deepEqual(buclesOrbeMini({ activo: true, quieto: null, pensando: true }), { respira: false, gira: false }, 'todavía no se sabe: quieta');
  assert.deepEqual(buclesOrbeMini({ activo: true, quieto: true, pensando: true }), { respira: false, gira: false });
  assert.deepEqual(buclesOrbeMini({ activo: true, quieto: false, pensando: false }), { respira: true, gira: false });
  assert.deepEqual(buclesOrbeMini({ activo: true, quieto: false, pensando: true }), { respira: true, gira: true });
  assert.deepEqual(buclesOrbeMini({ activo: false, quieto: false, pensando: true }), { respira: false, gira: false });
  assert.ok(RESPIRO_QUIETO > 0 && RESPIRO_QUIETO < 1);
  const orbe = leer('src/avatar3d/OrbeMini.tsx');
  assert.match(orbe, /AccessibilityInfo\.isReduceMotionEnabled\(\)/);
  assert.match(orbe, /AccessibilityInfo\.addEventListener\('reduceMotionChanged'/);
  assert.match(orbe, /sub\.remove\(\)/);
  assert.doesNotMatch(orbe, /quieto\.current/, 'nada de leerlo una vez en un ref');
});

test('Fase 0 · mesa: el borde derecho ya no capta arrastres (el «atrás» de Android); «Más» por una pestaña y por la barra', () => {
  const desk = leer('src/screens/DeskScreen.tsx');
  assert.doesNotMatch(sinComentarios(desk), /PanResponder/);
  assert.doesNotMatch(desk, /edgePan/);
  assert.match(desk, /<Pressable\s+onPress=\{abrirMasPorBorde\}\s+style=\{styles\.edgeTab\}/);
  assert.match(desk, /edgeTab: \{ width: 48, height: 96/);
  assert.match(desk, /onMas=\{\(\) => setMasAbierto\(true\)\}/, 'el «Más» visible de la barra sigue');
});

/** Lo de la burbuja no se encima ni se sale: controles, campo, estado, orbe y transcripción. */
function revisarBurbuja(nombre: string, e: Parameters<typeof medidasBurbuja>[0]) {
  const m = medidasBurbuja(e);
  const techo = e.alto - e.arriba;
  const modo = e.modo ?? 'normal';
  if (modo === 'escribir') {
    assert.ok(m.campo.abajo + m.campo.alto <= techo, `${nombre}: el campo de escribir cabe`);
    assert.ok(m.campo.alto >= TOQUE_BURBUJA);
  } else {
    assert.ok(m.abrir.abajo >= m.controles.abajo + m.controles.alto, `${nombre}: «Abrir» sobre los controles`);
    assert.ok(m.abrir.abajo + m.abrir.alto <= techo, `${nombre}: «Abrir» cabe`);
  }
  if (m.estado.visible) {
    assert.ok(m.estado.abajo + m.estado.alto <= techo, `${nombre}: la línea de estado no se sale por arriba`);
    if (modo === 'escribir') assert.ok(m.estado.abajo >= m.campo.abajo + m.campo.alto, `${nombre}: el estado sobre el campo`);
    else assert.ok(m.estado.abajo >= m.abrir.abajo + m.abrir.alto, `${nombre}: el estado sobre «Abrir»`);
  }
  if (m.lado > 0) {
    assert.ok(m.lado >= ORBE_MIN, `${nombre}: el orbe, entero o nada`);
    assert.ok(m.orbe.y >= e.arriba, `${nombre}: el orbe no queda bajo la barra de estado`);
    assert.ok(e.alto - (m.orbe.y + m.lado) >= m.estado.abajo + m.estado.alto, `${nombre}: el orbe sobre el estado`);
  }
  if (m.transcripcion.altoMax > 0) {
    assert.ok(m.transcripcion.abajo >= e.alto - m.orbe.y, `${nombre}: la transcripción sobre el orbe`);
    assert.ok(m.transcripcion.abajo + m.transcripcion.altoMax <= techo, `${nombre}: la transcripción bajo la barra de estado`);
  }
  return m;
}

test('Fase 0 · burbuja: con el teclado abierto, la letra al 200 % y acostado, nada se encima ni se sale', () => {
  const S26 = { ancho: 412, alto: 915, arriba: 32, abajo: 24 };
  const ACOSTADO = { ancho: 915, alto: 412, arriba: 0, abajo: 16 };
  const normal = revisarBurbuja('vertical', S26);
  assert.ok(normal.lado > 150 && normal.estado.conDetalle, 'en vertical, todo como antes');
  const grande = revisarBurbuja('letra 2.0', { ...S26, escalaTexto: 2 });
  assert.ok(grande.lado > 0 && grande.transcripcion.altoMax >= 150);
  const acostado = revisarBurbuja('acostado', ACOSTADO);
  assert.ok(acostado.transcripcion.altoMax >= 48, 'acostado la transcripción se ve (antes se escondía)');
  const acostadoGrande = revisarBurbuja('acostado, letra 2.0', { ...ACOSTADO, escalaTexto: 2 });
  assert.equal(acostadoGrande.lado, 0, 'acostado con letra grande el orbe cede entero (antes quedaba cortado arriba)');
  assert.ok(acostadoGrande.transcripcion.altoMax >= 48);
  revisarBurbuja('teclado, letra 2.0', { ...S26, escalaTexto: 2, modo: 'escribir', teclado: 300 });
  const acostadoTeclado = revisarBurbuja('acostado con teclado', { ...ACOSTADO, modo: 'escribir', teclado: 180 });
  assert.equal(acostadoTeclado.estado.visible, true);
  const sinSitio = revisarBurbuja('acostado con teclado y letra 2.0', { ...ACOSTADO, escalaTexto: 2, modo: 'escribir', teclado: 250 });
  assert.equal(sinSitio.estado.visible, false, 'sin sitio la línea de estado no se dibuja: el campo manda');
  // Burbuja.tsx usa esas banderas y la transcripción se desplaza en vez de cortarse.
  const b = leer('src/burbuja/Burbuja.tsx');
  assert.match(b, /\{\(modo === 'camara' \|\| m\.estado\.visible\) && \(/);
  assert.match(b, /\(modo === 'camara' \|\| m\.estado\.conDetalle\)/);
  assert.match(b, /<ScrollView style=\{s\.tarjetaScroll\}/);
  assert.match(b, /control: \{ flex: 1, alignItems: 'center', minWidth: 64, maxWidth: 96/);
  assert.match(b, /pildora: \{\s*flexShrink: 1,/);
});
