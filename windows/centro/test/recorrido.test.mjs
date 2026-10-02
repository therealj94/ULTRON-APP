/**
 * EL RECORRIDO DE WINDOWS (src/recorrido): el guion, el motor (igual al del teléfono), la coreografía,
 * los archivos que necesita y que lo prometido exista en AURA para Windows.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { armar, CENTRO, MOVIL, RAIZ } from './ayudas.mjs';

let G; // guion
let M; // motor de Windows
let MM; // motor del teléfono
let K; // coreografía
let C; // cuerpo (sin DOM: estadoDe y la lista de clips)
let V; // director del video (el del teléfono)
let S; // sonidos

const R = join(CENTRO, 'src', 'recorrido');

before(async () => {
  G = await armar(join(R, 'guion.ts'));
  M = await armar(join(R, 'motor.ts'));
  MM = await armar(join(MOVIL, 'src', 'recorrido', 'motor.ts'));
  K = await armar(join(R, 'coreografia.ts'));
  C = await armar(join(R, 'cuerpo.ts'));
  V = await armar(join(MOVIL, 'src', 'avatares', 'video', 'guion.ts'));
  S = await armar(join(R, 'sonidos.ts'));
});

test('el guion: 12 escenas, cada línea con su texto en los dos idiomas, su paso y frases que la voz acepta', () => {
  assert.deepEqual(G.ESCENAS.map((e) => e.id), [...G.DEMOS]);
  let interacciones = 0;
  for (const e of G.ESCENAS) {
    assert.ok(e.lineas.length >= 2, `${e.id}: al menos dos líneas (conversan)`);
    assert.ok(e.lineas[0].paso, `${e.id}: la primera línea fija el paso`);
    const usados = new Set();
    for (const l of e.lineas) {
      assert.ok(['claudio', 'antonio'].includes(l.quien));
      for (const i of ['es', 'en']) {
        assert.ok(l.texto[i].trim().length > 8, `${e.id}: texto ${i}`);
        // voz.decir (C#) no pide frases de más de 400 letras.
        assert.ok(G.textoDe(l, i, 'José María').length <= 400, `${e.id}: frase demasiado larga`);
      }
      if (l.paso) {
        assert.ok(e.pasos.includes(l.paso), `${e.id}: el paso ${l.paso} existe`);
        usados.add(l.paso);
      }
      if (l.espera) {
        interacciones++;
        assert.ok(l.espera.etiqueta.es && l.espera.etiqueta.en);
        assert.ok(l.espera.ms > 0, `${e.id}: si nadie toca, sigue solo`);
      }
    }
    assert.deepEqual([...usados].sort(), [...e.pasos].sort(), `${e.id}: todos sus pasos se usan`);
    // Se turnan: nadie dice toda una escena solo.
    assert.ok(new Set(e.lineas.map((l) => l.quien)).size === 2, `${e.id}: hablan los dos`);
  }
  assert.equal(interacciones, 3, 'las teclas, el «Sí» y contestar');
});

test('el nombre: se saluda con el primero y, sin nombre, la frase queda bien', () => {
  const l = G.ESCENAS[0].lineas[0];
  assert.match(G.textoDe(l, 'es', 'José Ordóñez'), /¡Hola otra vez, José!/);
  assert.equal(G.textoDe(l, 'es', ''), '¡Hola otra vez! Ahora te enseño AURA en tu computadora.');
  assert.equal(G.textoDe(l, 'en', ''), 'Hi again! Now I’ll show you AURA on your computer.');
});

test('el motor de Windows contesta igual que el del teléfono a la misma serie de acciones', () => {
  let a = M.INICIO;
  let b = MM.INICIO;
  let semilla = 7;
  const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648);
  const tipos = ['termino', 'termino', 'termino', 'toque', 'esperaVencio', 'siguiente', 'anterior', 'ir', 'pausa', 'sigue'];
  for (let i = 0; i < 600; i++) {
    const t = tipos[Math.floor(azar() * tipos.length)];
    const acc = t === 'termino' || t === 'esperaVencio' ? { tipo: t, vuelta: azar() < 0.9 ? a.vuelta : a.vuelta - 1 } : t === 'ir' ? { tipo: t, e: Math.floor(azar() * 14) - 1 } : { tipo: t };
    a = M.reducir(a, acc, G.ESCENAS);
    b = MM.reducir(b, acc, G.ESCENAS);
    assert.deepEqual(a, b, `acción ${i}: ${JSON.stringify(acc)}`);
    assert.equal(M.progreso(a, G.ESCENAS), MM.progreso(b, G.ESCENAS));
  }
});

test('el motor llega al final y la espera sigue sola', () => {
  let s = M.INICIO;
  let n = 0;
  while (s.fase !== 'fin' && n++ < 200) {
    s = M.reducir(s, { tipo: 'termino', vuelta: s.vuelta }, G.ESCENAS);
    if (s.fase === 'espera') s = M.reducir(s, { tipo: 'esperaVencio', vuelta: s.vuelta }, G.ESCENAS);
  }
  assert.equal(s.fase, 'fin');
  assert.equal(n, G.ESCENAS.reduce((x, e) => x + e.lineas.length, 0));
});

test('la coreografía: cada paso tiene su momento, con efectos y sonidos que existen', () => {
  const css = readFileSync(join(R, 'recorrido.css'), 'utf8');
  for (const e of G.ESCENAS) {
    for (const p of e.pasos) {
      assert.ok(p in K.COREOGRAFIA[e.id], `${e.id}.${p} tiene momento`);
      const m = K.momentoDe(e.id, p);
      if (m.efecto) assert.ok(K.EFECTOS.includes(m.efecto), m.efecto);
      if (m.sonido) assert.ok(K.SONIDOS.includes(m.sonido), m.sonido);
    }
  }
  for (const f of K.EFECTOS) assert.ok(css.includes(`.fx-${f}`), `el efecto ${f} tiene su CSS`);
});

test('el vuelo: Claudio se mete al notch, habla desde ahí y vuelve cuando el notch se aparta', () => {
  const n = G.ESCENAS.find((e) => e.id === 'notch');
  assert.equal(K.enNotch('notch', n.pasos, 'reposo'), 'claudio');
  assert.equal(K.enNotch('notch', n.pasos, 'habla'), 'claudio');
  assert.equal(K.enNotch('notch', n.pasos, 'aparta'), null);
  // Quien está en el notch al hablar es quien dice esa línea (habla desde ahí).
  assert.equal(n.lineas.find((l) => l.paso === 'habla').quien, 'claudio');
  const f = G.ESCENAS.find((e) => e.id === 'final');
  assert.equal(K.enNotch('final', f.pasos, 'opciones'), 'claudio');
  assert.equal(K.enNotch('voz', G.ESCENAS[2].pasos, 'atajo'), null);
});

test('el cuerpo: los mismos clips del teléfono, y el director pone «habla» al hablar y el golpe del gesto', () => {
  for (const q of ['claudio', 'antonio']) {
    for (const c of C.CLIPS_RECORRIDO) assert.ok(existsSync(join(MOVIL, 'assets', 'avatares', 'video', `${q}-${c}.mp4`)), `${q}-${c}`);
    assert.ok(existsSync(join(MOVIL, 'assets', 'avatares', q, 'base.webp')));
  }
  // build.mjs copia exactamente esos clips.
  const build = readFileSync(join(CENTRO, 'build.mjs'), 'utf8');
  const lista = JSON.parse(build.match(/const CLIPS = (\[[^\]]+\])/)[1].replace(/'/g, '"'));
  assert.deepEqual(lista, [...C.CLIPS_RECORRIDO]);
  let t = 0;
  const d = new V.DirectorVideo({ hay: C.CLIPS_RECORRIDO, ahora: () => t });
  assert.equal(d.estado(C.estadoDe({ hablando: false, alFrente: true, gesto: { nombre: 'saludar', n: 1 } }))?.clip, 'saluda');
  t += 6000;
  assert.equal(d.termino(d.reproduccion.n)?.clip, 'reposo');
  assert.equal(d.estado(C.estadoDe({ hablando: true, alFrente: true }))?.clip, 'habla');
  // El que escucha, con su clip de escuchar (tras asentarse).
  const o = new V.DirectorVideo({ hay: C.CLIPS_RECORRIDO, ahora: () => t });
  o.estado(C.estadoDe({ hablando: false, alFrente: false }));
  t += 400;
  assert.equal(o.revisar()?.clip, 'escucha');
});

test('los sonidos: cada uno es un archivo de la app del teléfono', () => {
  const build = readFileSync(join(CENTRO, 'build.mjs'), 'utf8');
  for (const s of K.SONIDOS) {
    const archivo = S.archivoSonido(s).split('/').pop();
    const carpeta = build.match(new RegExp(`'${archivo.replace('.', '\\.')}': '([a-z]+)'`))?.[1];
    assert.ok(carpeta, `build.mjs copia ${archivo}`);
    assert.ok(existsSync(join(MOVIL, 'assets', carpeta, archivo)), `${carpeta}/${archivo}`);
  }
});

test('lo que se promete existe: atajos y funciones de AURA para Windows', () => {
  const readme = readFileSync(join(RAIZ, 'windows', 'README.md'), 'utf8');
  for (const atajo of ['Ctrl+Alt+Espacio', 'Ctrl+Alt+C', 'Ctrl+Alt+Esc']) assert.ok(readme.includes(atajo), atajo);
  for (const f of ['«Oye AURA»', 'WhatsApp, Teams, Outlook', 'silencia las notificaciones de WhatsApp', 'pon Bad Bunny en Spotify', '10 min antes', 'llama a Karla', '«no» rechaza', '¿Cuánto ORIGEN tengo?', 'Enviar se hace en Veta Wallet', 'nunca en contraseñas', 'activa el modo oscuro', 'sube el brillo', 'pon la ventana a la izquierda', 'silenciar el micrófono', 'pantalla completa se aparta'])
    assert.ok(readme.toLowerCase().includes(f.toLowerCase()), `README: ${f}`);
});

test('el puente: voz.decir y recorrido.abierto los atiende AURA, la prueba del CI y PUENTE.md', () => {
  const cs = readFileSync(join(RAIZ, 'windows', 'src', 'Aura.Windows', 'Notch', 'NotchWindow.Centro.cs'), 'utf8');
  const prueba = readFileSync(join(RAIZ, 'windows', 'src', 'Aura.Windows', 'CentroSelfTest.cs'), 'utf8');
  const puente = readFileSync(join(CENTRO, 'PUENTE.md'), 'utf8');
  for (const m of ['voz.decir', 'recorrido.abierto']) {
    assert.ok(cs.includes(`case "${m}"`), `C#: ${m}`);
    assert.ok(prueba.includes(`"${m}"`), `CentroSelfTest: ${m}`);
    assert.ok(puente.includes('`' + m + '`'), `PUENTE.md: ${m}`);
  }
  assert.ok(puente.includes('`ventana.escondida`'), 'PUENTE.md: ventana.escondida');
  // La lista cerrada del puente (CentroWindow y ManejarCentro rechazan lo que no está): sin esto, la voz y el
  // silencio del micrófono nunca llegaban a AURA (Codex en #120).
  const lista = readFileSync(join(RAIZ, 'windows', 'src', 'Aura.Windows.Core', 'PuenteCentro.cs'), 'utf8');
  const metodos = lista.slice(lista.indexOf('HashSet<string> Metodos'), lista.indexOf('};', lista.indexOf('HashSet<string> Metodos')));
  for (const m of ['voz.decir', 'recorrido.abierto']) assert.ok(metodos.includes(`"${m}"`), `PuenteCentro.Metodos: ${m}`);
});

test('una llamada que empieza a sonar cierra el recorrido (AURA tiene que oír el «sí»)', () => {
  const pulse = readFileSync(join(CENTRO, 'src', 'pulse', 'index.ts'), 'utf8');
  const rec = readFileSync(join(R, 'recorrido.ts'), 'utf8');
  const entrando = pulse.slice(pulse.indexOf("c.estado === 'entrando' && antes !== 'entrando'"), pulse.indexOf("if (antes === 'entrando'"));
  assert.ok(entrando.includes("dispatchEvent(new Event('centro:llamada'))"), 'PULSE2CHAT avisa al sonar');
  assert.match(rec, /addEventListener\('centro:llamada', alLlamar\)/);
  assert.match(rec, /removeEventListener\('centro:llamada', alLlamar\)/);
});

test('la voz: un audio que llega tarde (saltó, pausó o cerró) no suena', async () => {
  const N = await armar(join(R, 'voz.ts'));
  const creados = [];
  globalThis.cancelAnimationFrame ??= () => {};
  globalThis.Audio = class {
    constructor(src) { this.src = src; this.oyentes = {}; this.duration = 1; creados.push(this); }
    addEventListener(t, f) { (this.oyentes[t] ??= []).push(f); }
    play() { setTimeout(() => { (this.oyentes.playing || []).forEach((f) => f()); setTimeout(() => (this.oyentes.ended || []).forEach((f) => f()), 5); }, 1); return Promise.resolve(); }
    pause() {}
  };
  const lento = (ms) => () => new Promise((r) => setTimeout(() => r({ base64: Buffer.from('ID3').toString('base64'), mime: 'audio/mpeg' }), ms));
  // Cerró (callar) mientras venía el audio: no se crea ningún Audio y la frase contesta false.
  let n = N.narradorAura(lento(30));
  const a = n.hablar('hola', 'claudio', 'feliz', {});
  n.callar();
  assert.equal(await a, false);
  assert.equal(creados.length, 0);
  // Saltó a otra frase mientras venía la primera: solo suena la segunda.
  n = N.narradorAura((t) => lento(t === 'uno' ? 40 : 5)());
  const uno = n.hablar('uno', 'claudio', 'feliz', {});
  const dos = n.hablar('dos', 'antonio', 'feliz', {});
  assert.equal(await dos, true);
  assert.equal(await uno, false);
  assert.equal(creados.length, 1);
  delete globalThis.Audio;
});
