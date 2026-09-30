/**
 * LA BOCA A TIEMPO CON LA VOZ, medida (sin teléfono): un audio de prueba sintetizado con su alineación
 * por letra, reproducido con un reloj como el de expo-av (avisos de posición cada 40–120 ms, con
 * atraso de entrega), y la cadena de verdad de la app:
 *
 *   servidor (lib/alineacion.ts: cabecera) → teléfono (sincronia.ts: leerAlineacion, RelojReproduccion,
 *   BocaAlineada, Envolvente; lib/tts.ts cada PASO_BOCA_MS) → senalVoz → Avatar3D (puente, un envío
 *   por cuadro o al cambiar de forma) → escena (suavizado de la boca, 60 cuadros por segundo)
 *
 * Mide el desfase entre la energía del audio que SUENA y la boca que SE VE (correlación cruzada) y
 * cuánto tarda en cerrarse la boca al cortar la voz. Lo mismo para la conversación fluida (el volumen
 * de LiveKit leído cada 33 ms, con el búfer de salida del teléfono).
 *
 *   cd mobile && npx tsx src/avatar3d/pruebas/sincronia.prueba.mjs
 *
 * Objetivos (pedido de José): desfase < 80 ms; boca cerrada < 100 ms después de cortar.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cabeceraAlineacion } from '../../../../lib/alineacion.ts';
import { ADELANTO_MS, BocaAlineada, Envolvente, PASO_BOCA_MS, RelojReproduccion, leerAlineacion } from '../sincronia.ts';
import { SenalVoz } from '../senalVoz.ts';
import { visemaDeLetra } from '../visemas.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '../../../..');

// Los números de la escena y del puente, leídos de su código (si cambian allá, la prueba mide lo nuevo).
const escena = fs.readFileSync(path.join(RAIZ, 'src/12-avatar3d/escena.ts'), 'utf8');
const BOCA_ABRE = Number(/const BOCA_ABRE = (\d+)/.exec(escena)[1]);
const BOCA_CIERRA = Number(/const BOCA_CIERRA = (\d+)/.exec(escena)[1]);
const puente = fs.readFileSync(path.join(RAIZ, 'mobile/src/avatar3d/Avatar3D.tsx'), 'utf8');
const BOCA_CADA_MS = Number(/const BOCA_CADA_MS = (\d+)/.exec(puente)[1]);

/** Un azar con semilla: la misma prueba da siempre lo mismo. */
function azar(semilla) {
  let x = semilla >>> 0;
  return () => ((x = (Math.imul(x ^ (x >>> 15), 2246822507) + 0x9e3779b9) >>> 0) / 2 ** 32);
}

/* ── el audio de prueba: una frase con su alineación y su señal ───────────────────────────── */

const FRASE = 'Hola, mamá. ¿Cómo estás hoy? Vamos a organizar tu día, paso a paso, sin prisa.';

function alineacionDe(texto, r) {
  const chars = [...texto];
  const starts = [];
  const ends = [];
  let t = 0.12;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const pausa = /[.?!]/.test(c) ? 0.32 : c === ',' ? 0.18 : c === ' ' ? 0.035 : /[¿¡]/.test(c) ? 0.01 : 0;
    const dura = pausa || (/[aeiouáéíóú]/i.test(c) ? 0.075 + r() * 0.05 : 0.045 + r() * 0.03);
    starts.push(t);
    ends.push(t + dura);
    t += dura;
  }
  return { characters: chars, character_start_times_seconds: starts, character_end_times_seconds: ends };
}

/** La señal (1 ms por muestra) que suena: vocales fuertes, fricativas suaves, P/B/M casi nada. */
function energiaDe(al, largo) {
  const e = new Float64Array(largo);
  const chars = al.characters;
  for (let i = 0; i < chars.length; i++) {
    const v = visemaDeLetra(chars, i);
    const amp = v == null ? 0.5 : { sil: 0, PP: 0.05, FF: 0.3, TH: 0.3, DD: 0.35, kk: 0.4, CH: 0.35, SS: 0.3, nn: 0.4, RR: 0.45, aa: 1, E: 0.85, I: 0.7, O: 0.9, U: 0.65 }[v];
    const a = Math.round(al.character_start_times_seconds[i] * 1000);
    const b = Math.round(al.character_end_times_seconds[i] * 1000);
    for (let t = a; t < b && t < largo; t++) {
      // Rampas de 8 ms: una voz no salta de golpe.
      const rampa = Math.min(1, (t - a) / 8, (b - t) / 8);
      e[t] = Math.max(e[t], amp * rampa);
    }
  }
  return e;
}

/** El desfase (ms) que más parece la boca a la energía: > 0, la boca va atrasada. */
function desfase(audio, boca, maxMs = 250) {
  let mejor = 0;
  let mejorC = -Infinity;
  const n = Math.min(audio.length, boca.length);
  const media = (x) => x.reduce((s, v) => s + v, 0) / x.length;
  const ma = media(audio.subarray(0, n));
  const mb = media(boca.subarray(0, n));
  for (let lag = -maxMs; lag <= maxMs; lag++) {
    let c = 0;
    for (let t = maxMs; t < n - maxMs; t++) c += (audio[t] - ma) * (boca[t + lag] - mb);
    if (c > mejorC) {
      mejorC = c;
      mejor = lag;
    }
  }
  return mejor;
}

/* ── la escena: el puente y el suavizado de la boca, cuadro a cuadro ─────────────────────── */

/**
 * Lo que se VE: la boca de senalVoz cruza el puente (Avatar3D: un visema nuevo o el cierre al
 * momento; lo demás, como mucho cada BOCA_CADA_MS) con `retardo` ms de camino, y la escena la suaviza
 * a 60 cuadros por segundo con sus mismas tasas.
 */
function escenaQueMira(bocas, largo, retardo = 8) {
  const envios = [];
  let previo = { nivel: -1, visema: 'sil' };
  let enviadoEn = -1e9;
  for (const { t, b } of bocas) {
    const cerrar = b.nivel < 0.02 && previo.nivel >= 0.02;
    const otra = b.visema !== previo.visema;
    const cambio = Math.abs(b.nivel - previo.nivel) >= 0.03;
    if (!cerrar && !otra && (!cambio || t - enviadoEn < BOCA_CADA_MS)) continue;
    enviadoEn = t;
    previo = b;
    envios.push({ t: t + retardo, nivel: b.nivel });
  }
  const visto = new Float64Array(largo);
  let objetivo = 0;
  let actual = 0;
  let k = 0;
  let ultimoCuadro = 0;
  for (let t = 0; t < largo; t++) {
    while (k < envios.length && envios[k].t <= t) objetivo = Math.min(1, envios[k++].nivel * 1.35);
    if (t - ultimoCuadro >= 1000 / 60) {
      const dt = (t - ultimoCuadro) / 1000;
      ultimoCuadro = t;
      const r = objetivo < actual ? BOCA_CIERRA : BOCA_ABRE;
      actual += (objetivo - actual) * (1 - Math.exp(-r * dt));
    }
    visto[t] = actual;
  }
  return visto;
}

/* ── la voz de la mesa: /api/tts con sus tiempos ─────────────────────────────────────────── */

function mesa({ semilla = 7, cortarEn = null } = {}) {
  const r = azar(semilla);
  const alEleven = alineacionDe(FRASE, r);
  // Del servidor al teléfono: la cabecera, y el teléfono la lee.
  const cab = cabeceraAlineacion(alEleven);
  const al = leerAlineacion(cab);
  assert.ok(al, 'la cabecera se lee');
  const largo = Math.ceil(alEleven.character_end_times_seconds.at(-1) * 1000) + 600;
  const energia = energiaDe(alEleven, largo);
  const boca = new BocaAlineada(al);
  const reloj = new RelojReproduccion();
  const suave = new Envolvente();
  const senal = new SenalVoz(() => 0);
  const bocas = [];
  senal.boca.escuchar((b) => bocas.push({ t: tAhora, b }));
  let tAhora = 0;
  // expo-av: la posición real del audio, avisada cada 40–120 ms y entregada 5–20 ms tarde.
  let proxAviso = 0;
  let proxTick = 0;
  let antes = 0;
  let cortado = false;
  for (let t = 0; t < largo; t++) {
    tAhora = t;
    const sonando = !cortado && t < largo - 300;
    if (t >= proxAviso) {
      const atraso = 5 + r() * 15;
      reloj.aviso(Math.max(0, t - atraso), t, sonando);
      proxAviso = t + 40 + r() * 80;
    }
    if (cortarEn != null && t === cortarEn) {
      // stopSpeaking(): la boca se cierra en el acto.
      cortado = true;
      reloj.aviso(t, t, false);
      suave.cortar();
      senal.formaReproducida(null);
      senal.nivel(0);
    }
    if (t >= proxTick) {
      const dt = t - antes;
      antes = t;
      proxTick = t + PASO_BOCA_MS + (r() - 0.5) * 8;
      if (!reloj.activo) {
        suave.cortar();
        senal.formaReproducida(null);
        senal.nivel(0);
      } else {
        const b = boca.en(reloj.posicion(t) + ADELANTO_MS);
        senal.formaReproducida(b.visema);
        senal.nivel(Math.round(suave.seguir(b.nivel, dt) * 50) / 50);
      }
    }
  }
  return { energia, visto: escenaQueMira(bocas, largo), largo };
}

/* ── la conversación fluida: el volumen de LiveKit cada 33 ms ────────────────────────────── */

function conversacion({ semilla = 11, salidaMs = 30, cortarEn = null } = {}) {
  const r = azar(semilla);
  const alEleven = alineacionDe(FRASE, r);
  const largo = Math.ceil(alEleven.character_end_times_seconds.at(-1) * 1000) + 600;
  // Lo que suena por el parlante sale `salidaMs` después de lo que mide LiveKit (el búfer de salida).
  const medida = energiaDe(alEleven, largo);
  const suena = new Float64Array(largo);
  for (let t = salidaMs; t < largo; t++) suena[t] = medida[t - salidaMs];
  const suave = new Envolvente();
  const senal = new SenalVoz(() => 0);
  const bocas = [];
  let tAhora = 0;
  senal.boca.escuchar((b) => bocas.push({ t: tAhora, b }));
  let proxTick = 0;
  let antes = 0;
  let cortado = false;
  for (let t = 0; t < largo; t++) {
    tAhora = t;
    if (cortarEn != null && t === cortarEn) {
      cortado = true;
      suave.cortar(); // onInterruption
      senal.cortar();
    }
    if (t >= proxTick) {
      const dt = t - antes;
      antes = t;
      proxTick = t + PASO_BOCA_MS + (r() - 0.5) * 8;
      // getOutputVolume: el promedio de la ventana del analizador (~21 ms).
      let v = 0;
      for (let k = Math.max(0, t - 21); k <= t; k++) v += medida[k];
      v = cortado ? 0 : v / 22;
      senal.nivel(Math.round(suave.seguir(Math.min(1, v * 1.1), dt) * 50) / 50);
    }
  }
  return { energia: suena, visto: escenaQueMira(bocas, largo), largo };
}

/* ── las pruebas ─────────────────────────────────────────────────────────────────────────── */

let fallos = 0;
const informe = {};
function prueba(nombre, f) {
  try {
    f();
    console.log(`  ok    ${nombre}`);
  } catch (e) {
    fallos++;
    console.log(`  FALLA ${nombre}\n        ${String(e?.message || e)}`);
  }
}

/** Cuánto tarda la boca visible en quedar casi cerrada (< 10 % de lo que abría) después de `t0`. */
function cierre(visto, t0) {
  const antes = Math.max(...visto.subarray(t0 - 60, t0 + 1));
  for (let t = t0; t < visto.length; t++) if (visto[t] <= Math.max(0.02, antes * 0.1)) return t - t0;
  return Infinity;
}

prueba('cabecera: la alineación viaja del servidor al teléfono sin perder letras ni tiempos (ñ, tildes, ¿?)', () => {
  const al = alineacionDe('¿Añoró el pingüino a mamá? Sí.', azar(3));
  const leida = leerAlineacion(cabeceraAlineacion(al));
  assert.deepEqual(leida.chars, al.characters);
  leida.desde.forEach((d, i) => assert.ok(Math.abs(d - al.character_start_times_seconds[i] * 1000) <= 1, `comienzo ${i}`));
  leida.dura.forEach((d, i) => assert.ok(Math.abs(d - (al.character_end_times_seconds[i] - al.character_start_times_seconds[i]) * 1000) <= 1, `duración ${i}`));
  // Las etiquetas de v4 no son letras.
  const conEtiqueta = alineacionDe('[warmly] Hola', azar(4));
  assert.deepEqual(leerAlineacion(cabeceraAlineacion(conEtiqueta)).chars.join(''), ' Hola');
  assert.equal(leerAlineacion('2.abc.1.1'), null);
  assert.equal(leerAlineacion('1.YWI.1,1.1'), null, 'dos letras, un tiempo: no sirve');
  assert.equal(leerAlineacion(undefined), null);
});

prueba('mesa: la boca que se ve va con el audio que suena (desfase < 80 ms), en varias corridas', () => {
  const lags = [];
  for (const semilla of [7, 21, 42, 99, 123]) {
    const { energia, visto } = mesa({ semilla });
    lags.push(desfase(energia, visto));
  }
  informe.mesa = lags;
  for (const l of lags) assert.ok(Math.abs(l) < 80, `desfase ${l} ms (${lags.join(', ')})`);
});

prueba('mesa: al cortar la voz (stopSpeaking) la boca se cierra en menos de 100 ms', () => {
  const tiempos = [];
  for (const [semilla, en] of [
    [7, 900],
    [21, 1733],
    [42, 2500],
  ]) {
    const { visto } = mesa({ semilla, cortarEn: en });
    tiempos.push(cierre(visto, en));
  }
  informe.cierreMesa = tiempos;
  for (const c of tiempos) assert.ok(c < 100, `cierra en ${c} ms (${tiempos.join(', ')})`);
});

prueba('conversación: con el volumen real cada 33 ms, la boca va con lo que suena (desfase < 80 ms)', () => {
  const lags = [];
  for (const [semilla, salidaMs] of [
    [11, 20],
    [12, 30],
    [13, 45],
  ]) {
    const { energia, visto } = conversacion({ semilla, salidaMs });
    lags.push(desfase(energia, visto));
  }
  informe.conversacion = lags;
  for (const l of lags) assert.ok(Math.abs(l) < 80, `desfase ${l} ms (${lags.join(', ')})`);
});

prueba('conversación: si la interrumpen, la boca se cierra en menos de 100 ms', () => {
  const tiempos = [900, 1500, 2600].map((en) => cierre(conversacion({ cortarEn: en }).visto, en));
  informe.cierreConversacion = tiempos;
  for (const c of tiempos) assert.ok(c < 100, `cierra en ${c} ms (${tiempos.join(', ')})`);
});

prueba('envolvente: abre rápido (ataque) y cierra suave (caída); cortar es inmediato', () => {
  const e = new Envolvente();
  assert.ok(e.seguir(1, 33) > 0.9, 'en un cuadro ya abrió');
  const abierta = e.valor;
  assert.ok(e.seguir(0, 33) > abierta * 0.5, 'no se cierra de golpe entre sílabas');
  e.cortar();
  assert.equal(e.valor, 0);
});

console.log(`\n  medido: ${JSON.stringify(informe)} (ms; desfase > 0 = la boca atrasada)`);
console.log(fallos ? `\n${fallos} con fallos` : '\ntodo bien');
process.exit(fallos ? 1 : 0);
