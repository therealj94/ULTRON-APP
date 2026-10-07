#!/usr/bin/env node
/**
 * LO QUE SE VE EN LA MESA, LEÍDO DE LA JERARQUÍA DE VISTAS (`maestro hierarchy`, JSON).
 *
 * La prueba del emulador (correr.sh) no adivina: después de cada mensaje lee la pantalla de verdad y saca de ahí
 * el chat de la mesa (modo trabajo, components/ChatMesa.tsx), con quién se habla (la cabecera «Hablando con …») y
 * si el avatar sigue pensando. Funciona con la app publicada HOY (por las etiquetas de accesibilidad: «Mensaje»,
 * «Hablando con AU-RA…») y, cuando la OTA traiga los testID (`mesa-transcripcion`, `mesa-msg-usuario`,
 * `mesa-msg-avatar`, `mesa-avatar`), los usa para no confundir lo tuyo con lo del avatar.
 *
 *   node transcripcion.mjs leer <jerarquia.json>
 *   node transcripcion.mjs respuesta <jerarquia.json> <mensaje> <enviados.txt>
 *   node transcripcion.mjs veredicto <escenario> <datos1.json> [datos2.json]
 *
 * Solo lee archivos y escribe JSON por stdout. Sin dependencias.
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

/* ── utilidades ─────────────────────────────────────────────────────────────────────────────── */

export const normal = (s) => String(s ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
/** Para comparar sin mayúsculas ni tildes («quédate» = «quedate»). */
export const plano = (s) => normal(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** «AU-RA», «Aura», «AURA» → «AURA». */
export const nombreAvatar = (s) => plano(s).replace(/[^a-z]/g, '').toUpperCase();

/** La salida de `maestro hierarchy` puede traer líneas antes del JSON: se toma desde la primera «{». */
export function leerJerarquia(texto) {
  const t = String(texto || '');
  const i = t.indexOf('{');
  if (i < 0) throw new Error('la jerarquía no trae JSON');
  const j = t.lastIndexOf('}');
  return JSON.parse(t.slice(i, j + 1));
}

function limites(b) {
  const m = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(String(b || ''));
  return m ? { x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4] } : null;
}

/** Todos los nodos en orden de lectura (DFS), cada uno con sus ancestros. */
export function aplanar(raiz) {
  const lista = [];
  const visitar = (n, ancestros) => {
    if (!n || typeof n !== 'object') return;
    const a = n.attributes || {};
    const nodo = {
      texto: normal(a.text),
      accesible: normal(a.accessibilityText),
      pista: normal(a.hintText),
      id: String(a['resource-id'] || ''),
      clase: String(a.class || ''),
      limites: limites(a.bounds),
      ancestros,
    };
    lista.push(nodo);
    for (const h of n.children || []) visitar(h, [...ancestros, nodo]);
  };
  visitar(raiz, []);
  return lista;
}

const esScrollVertical = (n) => /ScrollView$/.test(n.clase) && !/Horizontal/.test(n.clase);
const area = (n) => (n.limites ? Math.max(0, n.limites.x2 - n.limites.x1) * Math.max(0, n.limites.y2 - n.limites.y1) : 0);
/** El id del testID (Android lo puede dar como «paquete:id/nombre» o solo «nombre»). */
const idCorto = (id) => String(id || '').split('/').pop();

/* ── lo que hay en pantalla ────────────────────────────────────────────────────────────────── */

const VACIO = /^(Háblale o escríbele a|Talk or write to) /;
/** El estado de la cabecera («· pensando») o del HUD («AU-RA · pensando»); nunca una burbuja que empiece así. */
const ESTADO_PENSANDO = /(^|\s)·\s*(pensando|thinking)\b/i;

export function analizar(raiz, { enviados = [], mensaje = '' } = {}) {
  const nodos = aplanar(raiz);
  // Con quién se habla: la cabecera del chat de la mesa («Hablando con AU-RA. Tocar para cambiar de avatar»).
  let avatar = '';
  for (const n of nodos) {
    const m = /^(?:Hablando con|Talking to) (.+?)\. /.exec(n.accesible);
    if (m) {
      avatar = m[1];
      break;
    }
  }
  if (!avatar) {
    // A pantalla completa (modo charla): el estado «AU-RA · te escucho».
    for (const n of nodos) {
      const m = /^(Guardián|Guardian|AU-RA|Claudio|ANT-ONIO) · /.exec(n.texto);
      if (m) {
        avatar = m[1];
        break;
      }
    }
  }
  const pensando = nodos.some((n) => ESTADO_PENSANDO.test(n.texto));
  const entrada = nodos.find((n) => idCorto(n.id) === 'mesa-entrada' || (/EditText/.test(n.clase) && /^(Mensaje|Message)$/.test(n.accesible)));
  const barraMesa = nodos.some((n) => /^(Más opciones|More: live)/.test(n.accesible));

  // El chat: por su testID; si no, el desplazable que contiene el mensaje enviado; si no, el desplazable vertical
  // más grande que queda por encima del campo de escribir.
  const msgN = normal(mensaje);
  let lista = nodos.find((n) => idCorto(n.id) === 'mesa-transcripcion');
  if (!lista && msgN) {
    const propio = [...nodos].reverse().find((n) => n.texto === msgN);
    if (propio) lista = [...propio.ancestros].reverse().find(esScrollVertical);
  }
  if (!lista) {
    const tope = entrada?.limites?.y1 ?? Infinity;
    lista = nodos.filter((n) => esScrollVertical(n) && (n.limites?.y2 ?? 0) <= tope + 4).sort((a, b) => area(b) - area(a))[0];
  }
  const enviadosN = new Set(enviados.map(normal).filter(Boolean));
  const textos = [];
  if (lista) {
    for (const n of nodos) {
      if (!n.texto || !n.ancestros.includes(lista) || /EditText/.test(n.clase) || VACIO.test(n.texto)) continue;
      const burbuja = [...n.ancestros].reverse().find((a) => /^mesa-msg-/.test(idCorto(a.id)));
      const rol = burbuja ? (idCorto(burbuja.id) === 'mesa-msg-usuario' ? 'usuario' : 'avatar') : enviadosN.has(n.texto) ? 'usuario' : 'avatar';
      textos.push({ rol, texto: n.texto });
    }
  }
  return { avatar, pensando, chat: !!entrada, mesa: !!entrada || barraMesa, textos };
}

/**
 * La respuesta a `mensaje`: lo que dijo el avatar después de la ÚLTIMA vez que aparece ese mensaje tuyo, hasta tu
 * siguiente mensaje (`respuesta`), y todo lo que dijo el avatar después aunque en medio haya otro mensaje tuyo
 * (`todoDespues`: la pregunta de verdad seguida de «¿me oyes?»).
 */
export function respuestaA(analisis, mensaje) {
  const m = normal(mensaje);
  const t = analisis.textos;
  let i = -1;
  for (let k = t.length - 1; k >= 0; k--) {
    if (t[k].rol === 'usuario' && t[k].texto === m) {
      i = k;
      break;
    }
  }
  if (i < 0) return { encontrado: false, respuesta: '', todoDespues: '' };
  const resp = [];
  let k = i + 1;
  for (; k < t.length && t[k].rol !== 'usuario'; k++) resp.push(t[k].texto);
  const todo = t.slice(i + 1).filter((x) => x.rol !== 'usuario').map((x) => x.texto);
  return { encontrado: true, respuesta: resp.join('\n'), todoDespues: todo.join('\n') };
}

/* ── los veredictos de cada escenario ──────────────────────────────────────────────────────── */

const esAura = (a) => nombreAvatar(a) === 'AURA';

/** { estado: 'PASA' | 'FALLA', detalle } a partir de los datos guardados por correr.sh. */
export function veredicto(escenario, d1, d2) {
  const corto = (s, n = 160) => {
    const x = normal(s);
    return x.length > n ? `${x.slice(0, n)}…` : x;
  };
  if (escenario === '1') {
    if (!d1?.mesa) return { estado: 'FALLA', detalle: 'La mesa no está en pantalla después de entrar.' };
    if (!d1.chat) return { estado: 'FALLA', detalle: 'La mesa abrió pero sin el campo «Mensaje» del chat (modo trabajo).' };
    return { estado: 'PASA', detalle: `Mesa visible, chat abierto, avatar «${d1.avatar || '¿?'}».` };
  }
  if (escenario === '2') {
    // d1: tras «Necesito que cambies a Claudio»; d2: tras «no, quédate».
    if (!d1?.respuesta) return { estado: 'FALLA', detalle: 'Sin respuesta visible a «Necesito que cambies a Claudio».' };
    if (!esAura(d1.avatar)) return { estado: 'FALLA', detalle: `El avatar cambió sin confirmar: ahora es «${d1.avatar || '¿?'}». Respondió: «${corto(d1.respuesta)}»` };
    const pregunta = /[¿?]/.test(d1.respuesta) && /claudio/i.test(plano(d1.respuesta));
    if (!pregunta) return { estado: 'FALLA', detalle: `No preguntó antes de cambiar. Respondió: «${corto(d1.respuesta)}»` };
    if (!d2) return { estado: 'FALLA', detalle: 'No se pudo leer la mesa después de «no, quédate».' };
    if (!esAura(d2.avatar)) return { estado: 'FALLA', detalle: `Tras «no, quédate» el avatar es «${d2.avatar || '¿?'}», no AU-RA.` };
    return { estado: 'PASA', detalle: `Preguntó «${corto(d1.respuesta, 100)}» y tras «no, quédate» sigue AU-RA.` };
  }
  if (escenario === '3') {
    if (!d1?.respuesta || !d2?.respuesta) return { estado: 'FALLA', detalle: `Falta una respuesta (1.ª: ${d1?.respuesta ? 'sí' : 'no'}, 2.ª: ${d2?.respuesta ? 'sí' : 'no'}).` };
    const yaDije = [d1.respuesta, d2.respuesta].find((r) => /ya te lo (he )?dicho|ya te lo dije/.test(plano(r)));
    if (yaDije) return { estado: 'FALLA', detalle: `Dijo «ya te lo dije»: «${corto(yaDije)}»` };
    if (plano(d1.respuesta) === plano(d2.respuesta)) return { estado: 'FALLA', detalle: `La 2.ª respuesta es el mismo párrafo: «${corto(d2.respuesta)}»` };
    return { estado: 'PASA', detalle: `1.ª «${corto(d1.respuesta, 90)}» · 2.ª «${corto(d2.respuesta, 90)}»` };
  }
  if (escenario === '4') {
    // d1: tras la pregunta de verdad + «¿me oyes?». Vale cualquier texto del avatar después de la pregunta.
    const despues = d1?.encontrado ? d1.todoDespues : (d1?.textos || []).filter((t) => t.rol !== 'usuario').map((t) => t.texto).join('\n');
    if (/tegucigalpa/.test(plano(despues))) return { estado: 'PASA', detalle: `La pregunta de verdad tuvo respuesta: «${corto(despues, 140)}»` };
    return { estado: 'FALLA', detalle: despues ? `La pregunta de verdad quedó sin contestar; después dijo: «${corto(despues)}»` : 'Sin ninguna respuesta visible después de la pregunta.' };
  }
  return { estado: 'FALLA', detalle: `escenario desconocido: ${escenario}` };
}

/* ── línea de órdenes ──────────────────────────────────────────────────────────────────────── */

function leerEnviados(ruta) {
  try {
    return fs.readFileSync(ruta, 'utf8').split('\n').map(normal).filter(Boolean);
  } catch {
    return [];
  }
}
const leerJson = (ruta) => (ruta && fs.existsSync(ruta) ? JSON.parse(fs.readFileSync(ruta, 'utf8')) : null);

function principal([orden, ...args]) {
  if (orden === 'leer') {
    const a = analizar(leerJerarquia(fs.readFileSync(args[0], 'utf8')), { enviados: leerEnviados(args[1]) });
    return a;
  }
  if (orden === 'respuesta') {
    const [ruta, mensaje, enviados] = args;
    const a = analizar(leerJerarquia(fs.readFileSync(ruta, 'utf8')), { enviados: leerEnviados(enviados), mensaje });
    return { ...respuestaA(a, mensaje), avatar: a.avatar, pensando: a.pensando, chat: a.chat, mesa: a.mesa, textos: a.textos };
  }
  if (orden === 'veredicto') {
    const [esc, r1, r2] = args;
    return veredicto(esc, leerJson(r1), leerJson(r2));
  }
  throw new Error('uso: transcripcion.mjs leer|respuesta|veredicto …');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    process.stdout.write(JSON.stringify(principal(process.argv.slice(2))) + '\n');
  } catch (e) {
    process.stdout.write(JSON.stringify({ error: String(e?.message || e) }) + '\n');
    process.exitCode = 1;
  }
}
