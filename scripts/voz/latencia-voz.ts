/**
 * EL BANCO DE LATENCIA DE LA VOZ (José, 6-oct: «que sea tan rápido contestar una conversación que nadie note que es
 * una IA»). Mide, con el código de verdad, cada tramo de «la persona calla → suena la voz de AU-RA»:
 *
 *   oído      cuándo se cierra la frase tras callar (mobile/src/lib/turboMotor.ts con el reloj simulado y un Scribe
 *             Turbo de mentira que da parciales y el texto final como el de verdad: 36–57 ms tras el commit)
 *   servidor  lo que tarda server.ts en preparar el turno y soltar el primer texto (el servidor de verdad contra un
 *             Bedrock falso que contesta al instante: es el costo propio del servidor, sin modelo)
 *   modelo    la primera palabra y la primera frase decible de cada modelo de Bedrock, con el PEDIDO REAL que arma
 *             server.ts (capturado del Bedrock falso: system, hilo, herramientas)
 *   voz       la primera frase en audio (ElevenLabs con-tiempos, como la pide el teléfono) con cada modelo de voz
 *
 * y arma el presupuesto por tramo (mediana y p75) para cada combinación.
 *
 *   npx tsx scripts/voz/latencia-voz.ts capturar  [--salida pedidos.json]       pedidos reales + costo del servidor
 *   npx tsx scripts/voz/latencia-voz.ts modelos   --de pedidos.json [--modelos a,b] [--n 3] [--sin-herramientas]
 *   npx tsx scripts/voz/latencia-voz.ts voz       [--modelos eleven_v4_turbo,eleven_flash_v2_5] [--n 3]
 *   npx tsx scripts/voz/latencia-voz.ts oido      [--antes]                        (sin red; --antes: el cierre viejo)
 *   npx tsx scripts/voz/latencia-voz.ts presupuesto --de resultados.json
 *
 * Bedrock con las credenciales de AWS del entorno; ElevenLabs con ELEVEN_API_KEY. Nunca imprime una clave. Lo
 * capturado (el prompt) se guarda donde diga --salida: no lo subas al repositorio.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import http2 from 'node:http2';
import { spawn, type ChildProcess } from 'node:child_process';
import type { AddressInfo } from 'node:net';

const args = process.argv.slice(2);
const cmd = args[0] || 'ayuda';
const opt = (k: string, d = '') => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? String(args[i + 1] ?? '') : d;
};
const bandera = (k: string) => args.includes(`--${k}`);

export const mediana = (a: number[]) => percentil(a, 0.5);
export function percentil(a: number[], p: number): number {
  const v = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!v.length) return NaN;
  const i = Math.min(v.length - 1, Math.max(0, Math.ceil(p * v.length) - 1));
  return v[i];
}
const ms = (n: number) => (Number.isFinite(n) ? `${Math.round(n)}` : '—');

/** Lo que el teléfono corta como primera frase (mobile/src/lib/tts.ts StreamSpeaker: punto, o coma pasados 28). */
export function primeraFraseDecible(texto: string): string | null {
  const limpio = texto.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trimStart();
  const punto = /^([\s\S]*?[.!?…])(\s+|$)/.exec(limpio);
  if (punto && punto[1].trim().length >= 6 && punto[2]) return punto[1];
  const coma = /^([\s\S]{27,}?[^\d\s][,;:])(\s+)/.exec(limpio);
  return coma ? coma[1] : null;
}

/* ------------------------------------------------------------------ capturar: el servidor de verdad */

/** Una charla típica de José en la mesa (sin herramientas) y unos pedidos con manos, en orden, con su hilo. */
export const CHARLA = [
  'Buenas, ¿cómo va todo por allá?',
  '¿Qué opinas de que llueva tanto esta semana?',
  'Fíjate que hoy me levanté cansado, dormí mal.',
  '¿Tú crees que vale la pena aprender inglés a mi edad?',
  'Cuéntame algo interesante del oro.',
  '¿Y por qué el oro no se oxida?',
  'Ja, qué bueno. ¿Y tú qué harías un domingo libre?',
  'Dame un consejo para no estresarme tanto.',
];
export const CON_MANOS = ['Recuérdame mañana a las cinco llamar al banco.', 'Llámame en diez minutos.', 'Mándale un WhatsApp a Beto que ya voy.'];
/** Lo que el Bedrock falso contesta a cada frase de CHARLA: el hilo del turno siguiente se parece al de verdad. */
const RESPUESTAS_CHARLA = [
  'Todo tranquilo por acá, José. ¿Y tú cómo amaneciste?',
  'Uy, sí, esta semana no ha parado. A mí me gusta el sonido, pero entiendo que para salir es un fastidio.',
  'Ay, qué pesado. Cuando uno duerme mal todo cuesta el doble. ¿Algo te tenía preocupado?',
  'Claro que sí. El cerebro aprende a cualquier edad, solo cambia el método: poquito cada día y hablando sin miedo.',
  'Que todo el oro que se ha sacado en la historia cabría en un cubo de unos veintidós metros de lado.',
  'Porque es un metal noble: casi no reacciona con el oxígeno ni con el agua, por eso brilla igual siglos después.',
  'Me iría a caminar sin prisa y después a escuchar música. ¿Y tú?',
  'Uno sencillo: antes de reaccionar, respira hondo tres veces y pregúntate si eso importará en un mes.',
];

async function capturar() {
  const RAIZ = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-latencia-'));
  const SECRETO = 'secreto-de-banco-largo-para-el-servidor-entero-5-0';
  process.env.ULTRON_SESION_SECRETO = SECRETO;
  process.env.ULTRON_SESIONES_CERRADAS_ARCHIVO = path.join(tmp, 'cerradas-banco.json');
  process.env.ULTRON_MEMORIA_BUCKET = '';
  const { emitirSesion } = await import('../../server/seguridad');
  const { EventStreamCodec } = await import('@smithy/core/event-streams');
  const utf8 = { a: (b: Uint8Array) => Buffer.from(b).toString('utf8'), de: (s: string) => new Uint8Array(Buffer.from(s, 'utf8')) };
  const codec = new EventStreamCodec(utf8.a, utf8.de);
  const evento = (tipo: string, cuerpo: unknown) =>
    Buffer.from(
      codec.encode({
        headers: { ':message-type': { type: 'string', value: 'event' }, ':event-type': { type: 'string', value: tipo }, ':content-type': { type: 'string', value: 'application/json' } },
        body: utf8.de(JSON.stringify(cuerpo)),
      })
    );
  const pedidos: { modelo: string; body: any; en: number }[] = [];
  const bedrock = http2.createServer((req, res) => {
    let c = '';
    req.on('data', (d) => (c += d));
    req.on('end', () => {
      const modelo = /\/model\/([^/]+)\/converse-stream/.exec(decodeURIComponent(req.url || ''))?.[1] || '?';
      const body = JSON.parse(c || '{}');
      pedidos.push({ modelo, body, en: Date.now() });
      const ultimo = String(body.messages?.at(-1)?.content?.[0]?.text || '');
      const k = CHARLA.findIndex((c) => ultimo.includes(c));
      res.writeHead(200, { 'content-type': 'application/vnd.amazon.eventstream' });
      res.write(evento('messageStart', { role: 'assistant' }));
      for (const t of `[EMO: neutral] ${RESPUESTAS_CHARLA[k] || 'Listo, José.'}`.match(/.{1,12}/gs) || []) res.write(evento('contentBlockDelta', { contentBlockIndex: 0, delta: { text: t } }));
      res.write(evento('contentBlockStop', { contentBlockIndex: 0 }));
      res.write(evento('messageStop', { stopReason: 'end_turn' }));
      res.end(evento('metadata', { usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, metrics: { latencyMs: 1 } }));
    });
  });
  const nodo = http.createServer((req, res) => {
    let c = '';
    req.on('data', (d) => (c += d));
    req.on('end', () => {
      if (req.url === '/api/precalentar') return res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
      if (!JSON.parse(c || '{}').stream) return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ message: { content: '{}' } }));
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.end(JSON.stringify({ message: { content: '[EMO: neutral] Hola.' }, done: true }) + '\n');
    });
  });
  const puente = http.createServer((req, res) => {
    req.resume();
    res.writeHead(200, { 'content-type': 'application/json', 'x-cuenta': String(req.headers['x-cuenta'] || '') }).end(JSON.stringify({ vinculado: true, conectado: true, chats: [] }));
  });
  const laya = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => res.writeHead(503).end());
  });
  for (const s of [bedrock, nodo, puente, laya] as Array<http.Server | http2.Http2Server>) await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const puerto = (s: http.Server | http2.Http2Server) => (s.address() as AddressInfo).port;
  const PORT = 8700 + Math.floor(Math.random() * 200);
  const BASE = `http://127.0.0.1:${PORT}`;
  const CORREO = 'jose.banco@ordenglobal.org';
  let stdout = '';
  const proc: ChildProcess = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), '--import', path.join(RAIZ, 'tests', 'red-lenta.ts'), path.join(RAIZ, 'server.ts')], {
    cwd: tmp,
    env: {
      PATH: process.env.PATH || '',
      HOME: tmp,
      NODE_ENV: 'production',
      PORT: String(PORT),
      PLATAFORMA: 'ultron',
      ULTRON_SESION_SECRETO: SECRETO,
      ULTRON_SESIONES_CERRADAS_ARCHIVO: path.join(tmp, 'cerradas.json'),
      ULTRON_PERFILES_DIR: path.join(tmp, 'perfiles'),
      ULTRON_NODO_URL: `http://127.0.0.1:${puerto(nodo)}`,
      ULTRON_NODO_SECRETO: 'banco',
      ULTRON_LAYA_URL: `http://127.0.0.1:${puerto(laya)}`,
      ULTRON_LAYA_CLAVE: 'laya-falsa',
      MODELO_CHICO_MODO: 'apagado',
      TSX_TSCONFIG_PATH: path.join(RAIZ, 'tsconfig.json'),
      RED_LENTA_MS: '0',
      CEREBRO_VOZ: 'nova',
      // --real: el servidor contra el Bedrock DE VERDAD (las credenciales del entorno, nunca impresas): mide servidor +
      // modelo de punta a punta. Sin --real, el Bedrock falso (captura del pedido y costo propio del servidor).
      ...(bandera('real')
        ? {
            AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID || '',
            AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY || '',
            ...(process.env.AWS_SESSION_TOKEN ? { AWS_SESSION_TOKEN: process.env.AWS_SESSION_TOKEN } : {}),
            ...(process.env.AWS_CA_BUNDLE ? { AWS_CA_BUNDLE: process.env.AWS_CA_BUNDLE } : {}),
            ...(process.env.HTTPS_PROXY ? { HTTPS_PROXY: process.env.HTTPS_PROXY } : {}),
            ...(process.env.NODE_EXTRA_CA_CERTS ? { NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS } : {}),
          }
        : { AWS_ACCESS_KEY_ID: 'AKIABANCO', AWS_SECRET_ACCESS_KEY: 'banco', AWS_ENDPOINT_URL_BEDROCK_RUNTIME: `http://127.0.0.1:${puerto(bedrock)}` }),
      AWS_REGION: 'us-west-2',
      // --charla no: la ruta de antes (todo primero a GLM-5), para comparar.
      ...(opt('charla') ? { CEREBRO_VOZ_CHARLA: opt('charla') } : {}),
      WHATSAPP_PUENTE_URL: `http://127.0.0.1:${puerto(puente)}`,
      WHATSAPP_PUENTE_CLAVE: 'clave-puente',
      WHATSAPP_DUENOS: CORREO,
      COMPUTADORA_URL: 'http://127.0.0.1:9',
      COMPUTADORA_CLAVE: 'x',
      ULTRON_PADRON: `jose | José | ${CORREO} | | ultron=lee`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  proc.stdout?.on('data', (d) => (stdout = (stdout + d).slice(-400_000)));
  // Los intentos de cada modelo (lib/cerebro-rapido.ts, console.warn): con --ver se enseñan al momento.
  proc.stderr?.on('data', (d) => {
    if (!bandera('ver')) return;
    for (const l of String(d).split('\n')) if (/\[cerebro manos\]|\[voz\]/.test(l)) console.log(`    ${l.trim().slice(0, 300)}`);
  });
  const canal = new AbortController();
  const cerrar = () => {
    canal.abort();
    try {
      process.kill(-proc.pid!);
    } catch {
      /* ya se fue */
    }
    for (const s of [nodo, puente, laya]) {
      s.closeAllConnections?.();
      s.close();
    }
    bedrock.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  };
  try {
    let listo = false;
    for (let i = 0; i < 240 && !listo; i++) {
      try {
        listo = (await fetch(`${BASE}/api/health`)).ok;
      } catch {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    if (!listo) throw new Error('el servidor no levantó');
    const yo = emitirSesion({ correo: CORREO, nombre: 'José', rol: 'Junta' });
    const h = { 'content-type': 'application/json', 'x-ultron-sesion': yo.token, 'x-aura-origen': 'app', 'x-aura-aparato': 'aparato-banco' };
    void fetch(`${BASE}/api/app/acciones`, { headers: h, signal: canal.signal })
      .then(async (r) => {
        for await (const _ of r.body as any) void _;
      })
      .catch(() => undefined);
    const contactos = ['Ana', 'Beto', 'Mamá', 'Carlos Banco', 'Doctor Ríos', 'Luis', 'María', 'Pedro', 'Sofía', 'Tío Juan'].map((nombre, i) => ({ nombre, correo: `contacto${i}@ejemplo.org` }));
    await fetch(`${BASE}/api/app/contexto`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ pantalla: 'mesa', contactos, manos: ['llamar', 'leer', 'buscar', 'idioma', 'perfil', 'recordatorio', 'recordatorio_llamada', 'llamame', 'cartera', 'pagar', 'controles', 'enviar_exacto'] }),
    });
    const escena = 'Reconozco a José (quien te habla). Veo a una persona cerca, mira la pantalla.';
    const salida: { mensaje: string; conManos: boolean; body: any; servidor: { primerTextoMs: number; alModeloMs: number; via: string } }[] = [];
    const historial: { rol: string; texto: string }[] = [];
    for (const [i, mensaje] of [...CHARLA, ...CON_MANOS].entries()) {
      const antes = pedidos.length;
      const t0 = Date.now();
      const r = await fetch(`${BASE}/api/turno/stream`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ message: mensaje, hablado: true, idioma: 'es', avatar: 'aura', escena, historial: historial.slice(-12), idTurno: `banco-${Date.now()}-${i}` }),
      });
      let primer = NaN;
      let txt = '';
      for await (const trozo of r.body as any) {
        txt += Buffer.from(trozo).toString('utf8');
        if (!Number.isFinite(primer) && /event: delta/.test(txt)) primer = Date.now() - t0;
      }
      const done = /event: done\ndata: (.*)/.exec(txt);
      const via = done ? String(JSON.parse(done[1]).via || '') : '?';
      const nuevo = pedidos.slice(antes)[0];
      salida.push({ mensaje, conManos: i >= CHARLA.length, body: nuevo?.body || null, servidor: { primerTextoMs: primer, alModeloMs: nuevo ? nuevo.en - t0 : NaN, via } });
      historial.push({ rol: 'usuario', texto: mensaje }, { rol: 'ultron', texto: RESPUESTAS_CHARLA[i] || 'Listo, José.' });
      console.log(`${mensaje.slice(0, 50).padEnd(52)} servidor→modelo ${ms(nuevo ? nuevo.en - t0 : NaN)} ms · primer texto ${ms(primer)} ms · ${via}`);
    }
    const lineas = stdout.split('\n').filter((l) => /\[mesa\] turno/.test(l));
    for (const l of lineas.slice(-3)) console.log(l);
    const destino = opt('salida', path.join(os.tmpdir(), 'aura-pedidos-voz.json'));
    fs.writeFileSync(destino, JSON.stringify(salida));
    const al = salida.filter((s) => !s.conManos).map((s) => s.servidor.alModeloMs);
    const primeros = salida.filter((s) => !s.conManos).map((s) => s.servidor.primerTextoMs);
    if (!bandera('real')) console.log(`\nservidor (preparar hasta pedir al modelo), charla: mediana ${ms(mediana(al))} ms · p75 ${ms(percentil(al, 0.75))} ms`);
    console.log(`servidor${bandera('real') ? ' + Bedrock de verdad' : ''}, charla: primer texto (delta) mediana ${ms(mediana(primeros))} ms · p75 ${ms(percentil(primeros, 0.75))} ms · n=${primeros.length}`);
    console.log(`guardado en ${destino}`);
  } finally {
    cerrar();
  }
}

/* ------------------------------------------------------------------ modelos: Bedrock de verdad */

/** `razon`: caracteres de razonamiento (reasoningContent) que el modelo escribió antes de contestar. */
type MedidaModelo = { primeraMs: number; fraseMs: number; totalMs: number; texto: string; herramienta?: string; error?: string; razon?: number };

async function medirModelo(cliente: any, Cmd: any, modelo: string, body: any, sinHerramientas: boolean, cache: boolean): Promise<MedidaModelo> {
  const t0 = performance.now();
  let primera = NaN;
  let frase = NaN;
  let texto = '';
  let herramienta: string | undefined;
  let razon = 0;
  const system = cache ? [...(body.system || []), { cachePoint: { type: 'default' } }] : body.system;
  try {
    const r = await cliente.send(
      new Cmd({
        modelId: modelo,
        system,
        messages: body.messages,
        ...(!sinHerramientas && body.toolConfig ? { toolConfig: body.toolConfig } : {}),
        inferenceConfig: { maxTokens: 400, temperature: 0.5 },
      }),
      { abortSignal: AbortSignal.timeout(20_000) }
    );
    for await (const ev of r.stream || []) {
      const err = ev.internalServerException || ev.modelStreamErrorException || ev.throttlingException || ev.validationException || ev.serviceUnavailableException;
      if (err) throw new Error(String(err.message || 'error'));
      const ini = ev.contentBlockStart?.start?.toolUse;
      if (ini) {
        herramienta = String(ini.name || '');
        if (!Number.isFinite(primera)) primera = performance.now() - t0;
      }
      const rz = (ev.contentBlockDelta?.delta as any)?.reasoningContent?.text;
      if (rz) razon += rz.length;
      const d = ev.contentBlockDelta?.delta?.text;
      if (d) {
        texto += d;
        if (!Number.isFinite(primera) && texto.replace(/\[[^\]]*\]?/g, '').trim()) primera = performance.now() - t0;
        if (!Number.isFinite(frase) && primeraFraseDecible(texto)) frase = performance.now() - t0;
      }
    }
    const total = performance.now() - t0;
    if (!Number.isFinite(frase) && texto.trim()) frase = total;
    return { primeraMs: primera, fraseMs: frase, totalMs: total, texto, herramienta, razon };
  } catch (e: any) {
    return { primeraMs: NaN, fraseMs: NaN, totalMs: performance.now() - t0, texto, error: String(e?.name || '') + ': ' + String(e?.message || e).slice(0, 140) };
  }
}

async function modelos() {
  const { BedrockRuntimeClient, ConverseStreamCommand } = await import('@aws-sdk/client-bedrock-runtime');
  const cliente = new BedrockRuntimeClient({ region: process.env.CEREBRO_VOZ_REGION || 'us-west-2', maxAttempts: 1 });
  const de = opt('de', path.join(os.tmpdir(), 'aura-pedidos-voz.json'));
  const capturados: { mensaje: string; conManos: boolean; body: any }[] = JSON.parse(fs.readFileSync(de, 'utf8')).filter((c: any) => c.body);
  const lista = opt('modelos', 'zai.glm-5,moonshotai.kimi-k2.5').split(',').filter(Boolean);
  const n = Number(opt('n', '2'));
  const sinHerr = bandera('sin-herramientas');
  const soloCharla = bandera('solo-charla');
  const cache = bandera('cache');
  const ver = bandera('ver');
  const resultados: Record<string, MedidaModelo[]> = {};
  for (const modelo of lista) {
    resultados[modelo] = [];
    for (const c of capturados) {
      if (soloCharla && c.conManos) continue;
      for (let i = 0; i < n; i++) {
        const m = await medirModelo(cliente, ConverseStreamCommand, modelo, c.body, sinHerr, cache);
        resultados[modelo].push(m);
        if (m.error) {
          console.log(`${modelo}: ${m.error}`);
          break;
        }
        if (ver && i === 0) console.log(`  ${modelo} «${c.mensaje.slice(0, 40)}» ${ms(m.primeraMs)} ms${m.razon ? ` (razonó ${m.razon} car.)` : ''} → ${m.herramienta ? `[${m.herramienta}] ` : ''}${m.texto.replace(/\s+/g, ' ').slice(0, 160)}`);
      }
      if (resultados[modelo].at(-1)?.error) break;
    }
    const ok = resultados[modelo].filter((m) => !m.error);
    const p = ok.map((m) => m.primeraMs);
    const f = ok.map((m) => m.fraseMs);
    console.log(
      `${modelo.padEnd(44)} n=${String(ok.length).padStart(2)} primera palabra ${ms(mediana(p)).padStart(5)} / p75 ${ms(percentil(p, 0.75)).padStart(5)} ms · primera frase ${ms(mediana(f)).padStart(5)} / p75 ${ms(percentil(f, 0.75)).padStart(5)} ms`
    );
  }
  const archivo = opt('guardar');
  if (archivo) fs.writeFileSync(archivo, JSON.stringify(resultados));
}

/* ------------------------------------------------------------------ voz: ElevenLabs de verdad */

async function voz() {
  const KEY = process.env.ELEVEN_API_KEY || process.env.ELEVENLABS_API_KEY;
  if (!KEY) throw new Error('sin ELEVEN_API_KEY');
  const VOZ = 'AoT6sxPBYB0OGpSnIiwc'; // AU-RA en español (server/eleven.ts VOCES_ELEVEN.aura.es)
  const frases = ['¡Claro que sí!', 'Mira, eso depende de cuánto tiempo tengas libre,', 'Fíjate que el oro casi no reacciona con nada.'];
  const lista = opt('modelos', 'eleven_v4_turbo,eleven_flash_v2_5,eleven_turbo_v2_5').split(',');
  const n = Number(opt('n', '3'));
  for (const modelo of lista) {
    const tot: number[] = [];
    for (const texto of frases)
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOZ}/with-timestamps?output_format=mp3_44100_96`, {
          method: 'POST',
          headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: texto, model_id: modelo, language_code: 'es', voice_settings: { stability: 0.5, similarity_boost: 0.8 } }),
        });
        await r.arrayBuffer();
        if (r.ok) tot.push(performance.now() - t0);
      }
    console.log(`${modelo.padEnd(24)} con tiempos (como el teléfono): mediana ${ms(mediana(tot))} ms · p75 ${ms(percentil(tot, 0.75))} ms (n=${tot.length})`);
  }
}

/* ------------------------------------------------------------------ oído: el motor Turbo con reloj simulado */

/**
 * Una frase dicha: palabras con su momento (ms desde que empezó a hablar). El Scribe de mentira manda un parcial con
 * lo dicho hasta ahí cada ~`cadaParcial` ms con `retraso` de atraso, y el texto final ~50 ms después del commit.
 */
export type FraseSimulada = { palabras: string[]; msPorPalabra?: number; final?: string };

export async function simularOido(frases: FraseSimulada[], o: { tiempos?: Record<string, number>; retrasoParcial?: number; cadaParcial?: number } = {}) {
  const { MotorTurbo } = await import('../../mobile/src/lib/turboMotor');
  // Reloj simulado: setTimeout/clearTimeout propios para que el motor corra sin esperar de verdad.
  let ahora = 1_000_000;
  type T = { en: number; f: () => void; id: number };
  let cola: T[] = [];
  let sig = 1;
  const st = (f: () => void, d = 0) => {
    const t = { en: ahora + Math.max(0, d), f, id: sig++ };
    cola.push(t);
    return t.id as any;
  };
  const ct = (id: any) => {
    cola = cola.filter((t) => t.id !== id);
  };
  const origST = globalThis.setTimeout;
  const origCT = globalThis.clearTimeout;
  (globalThis as any).setTimeout = st;
  (globalThis as any).clearTimeout = ct;
  const avanzar = async (hasta: number) => {
    for (;;) {
      cola.sort((a, b) => a.en - b.en || a.id - b.id);
      const t = cola[0];
      if (!t || t.en > hasta) break;
      cola.shift();
      ahora = t.en;
      t.f();
      for (let i = 0; i < 20; i++) await Promise.resolve();
    }
    // Lo que quedó encadenado en promesas (entregar la frase, medirla) corre ANTES de mover el reloj.
    for (let i = 0; i < 20; i++) await Promise.resolve();
    ahora = hasta;
  };
  const medidas: number[] = [];
  const finales: string[] = [];
  /** Cuándo empezó el turno especulativo, en ms desde la última voz (como `trasCallarMs`). */
  const especuladas: number[] = [];
  let ultimaVoz = 0;
  let alTrozo: ((t: { audio: string; db: number }) => void) | null = null;
  let ws: any = null;
  let fraseActual: { texto: string } = { texto: '' };
  const retraso = o.retrasoParcial ?? 250;
  try {
    const motor = new MotorTurbo({
      abrirMic: async (f) => {
        alTrozo = f;
        return () => (alTrozo = null);
      },
      permiso: async () => ({ url: 'wss://turbo' }),
      transcribirWav: async () => '',
      crearWs: () => {
        ws = {
          readyState: 1,
          send: (m: string) => {
            const j = JSON.parse(m);
            if (j.commit) {
              const texto = fraseActual.texto;
              st(() => ws.onmessage?.({ data: JSON.stringify({ message_type: 'committed_transcript', text: texto }) }), 50);
            }
          },
          close() {},
          onopen: null,
          onmessage: null,
          onerror: null,
          onclose: null,
        };
        st(() => ws.onopen?.(), 30);
        return ws;
      },
      ahora: () => ahora,
      tiempos: o.tiempos,
    });
    motor.setCallbacks({ onMedida: (m) => medidas.push(m.trasCallarMs), onFinal: (t) => finales.push(t), onEspeculativa: () => especuladas.push(ahora - ultimaVoz) });
    motor.activar();
    await avanzar(ahora + 50);
    const trozo = (db: number) => alTrozo?.({ audio: 'AAAA', db });
    // Medio segundo de cuarto callado.
    for (let i = 0; i < 10; i++) {
      trozo(-62);
      await avanzar(ahora + 100);
    }
    for (const f of frases) {
      const porPalabra = f.msPorPalabra ?? 300;
      const dur = f.palabras.length * porPalabra;
      const inicio = ahora;
      fraseActual = { texto: f.final ?? f.palabras.join(' ') };
      let ultimoParcial = '';
      for (let t = 0; t < dur; t += 100) {
        ultimaVoz = ahora;
        trozo(-25);
        // El parcial con lo dicho hasta `t - retraso` (Turbo va un poco atrás).
        const dichas = Math.floor(Math.max(0, t - retraso) / porPalabra);
        const parcial = f.palabras.slice(0, dichas).join(' ');
        if (parcial && parcial !== ultimoParcial && t % (o.cadaParcial ?? 300) === 0) {
          ultimoParcial = parcial;
          ws?.onmessage?.({ data: JSON.stringify({ message_type: 'partial_transcript', text: parcial }) });
        }
        await avanzar(inicio + t + 100);
      }
      // Ya calló: el parcial completo llega con su atraso; el cuarto vuelve al silencio.
      const callo = ahora;
      st(() => ws?.onmessage?.({ data: JSON.stringify({ message_type: 'partial_transcript', text: f.palabras.join(' ') }) }), retraso);
      for (let t = 0; t < 2500; t += 100) {
        trozo(-62);
        await avanzar(callo + t + 100);
      }
    }
    motor.destruir();
  } finally {
    (globalThis as any).setTimeout = origST;
    (globalThis as any).clearTimeout = origCT;
  }
  return { medidas, finales, especuladas };
}

/** Frases típicas de la mesa: terminadas (pregunta, orden, charla) y unas que quedan a medias con pausa. */
export const FRASES_OIDO: FraseSimulada[] = [
  { palabras: '¿Cómo estás hoy'.split(' ') },
  { palabras: 'Cuéntame algo interesante del oro'.split(' ') },
  { palabras: 'Qué opinas de que llueva tanto'.split(' ') },
  { palabras: 'Llámame en diez minutos'.split(' ') },
  { palabras: 'Gracias'.split(' ') },
  { palabras: 'Fíjate que hoy me levanté cansado'.split(' ') },
  { palabras: 'Y tú qué harías un domingo libre'.split(' ') },
  { palabras: 'Dame un consejo para no estresarme'.split(' ') },
];

async function oido() {
  for (const [nombre, tiempos] of [
    ['antes (solo silencio)', { sondeoMs: 0 }],
    ['ahora (fin de turno semántico)', {}],
  ] as const) {
    const { medidas, especuladas } = await simularOido(FRASES_OIDO, { tiempos });
    console.log(
      `oído ${nombre.padEnd(32)} frase lista tras callar: mediana ${ms(mediana(medidas))} ms · p75 ${ms(percentil(medidas, 0.75))} ms · turno especulativo desde ${ms(mediana(especuladas))} ms · [${medidas.map((m) => Math.round(m)).join(', ')}]`
    );
  }
}

/* ------------------------------------------------------------------ */

const comandos: Record<string, () => Promise<void>> = { capturar, modelos, voz, oido };
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('latencia-voz.ts')) {
  const f = comandos[cmd];
  if (!f) {
    console.log('uso: npx tsx scripts/voz/latencia-voz.ts capturar|modelos|voz|oido [opciones] (ver el comentario de arriba)');
  } else
    f().then(
      () => process.exit(0),
      (e) => {
        console.error(String(e?.stack || e));
        process.exit(1);
      }
    );
}
