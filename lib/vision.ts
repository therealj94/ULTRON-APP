/**
 * Ver imágenes de verdad: el ojo del nodo primero, Gemini y Bedrock de reserva (el orden se cambia con
 * ULTRON_VISION_ORDEN). Si no hay ninguno, se dice — en el registro, con el nombre de la variable; a quien
 * mandó la foto, con una frase que entienda.
 *
 * 6-oct (José, «la cámara se traba»): en producción TODAS las vistas estructuradas fallaban. El nodo del ojo
 * contesta 200 con `{ok:false, texto:<error del proveedor>}` cuando su modelo (Hugging Face) falla, y aquí se
 * tomaba ese error como lo visto; Gemini no está configurado en Render, así que no había reserva. Ahora un
 * `ok:false` es un fallo (va al registro), una vista inútil pasa al siguiente ojo y Bedrock (el mismo AWS del
 * cerebro rápido) mira con gemma-3-12b en ~2 s.
 */

import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { clave } from './boveda';
import { destinoPublico } from './red-publica';
import { presupuesto, type Presupuesto } from './presupuesto';
import { pareceErrorDeServicio, parsearVista, promptCompacto, promptEstructurado, vistaVacia, type FocoVision, type VistaEstructurada } from './vision-estructurada';

export type Vista = { texto: string; via: string; foto?: Buffer };

/** Pedir JSON (vista estructurada): Gemini lo fuerza con `responseMimeType` y el tope de texto sube. */
type OpcionesOjo = { json?: boolean };
/** Un JSON con el texto de un documento entero no cabe en los 2200 de una descripción. */
const TOPE_TEXTO = 2200;
const TOPE_JSON = 7000;
/**
 * Lo más que se espera al nodo del ojo por una vista en JSON: con el pedido corto contesta en 2-5 s; si se
 * pasa de esto, su modelo está atascado y Bedrock contesta en ~2 s con lo que queda del reloj.
 */
const OJO_JSON_MS = 9000;
const OJO_TEXTO_MS = 28000;

function dataUrlAPartes(raw: string): { mime: string; b64: string } {
  // El tipo puede traer parámetros («image/jpeg;name=x»): se ignoran, pero no rompen el corte.
  const m = String(raw || '').match(/^data:([^;,]+)[^,]*?;base64,([\s\S]+)$/);
  if (m) return { mime: m[1], b64: m[2] };
  return { mime: 'image/jpeg', b64: String(raw || '').replace(/^base64,/, '') };
}

function bufferDeCualquierFoto(j: any): Buffer | undefined {
  const b64 = j?.imagen || j?.image || j?.png || j?.jpeg || j?.foto;
  if (typeof b64 === 'string' && b64.length > 80) {
    const clean = b64.replace(/^data:[^,]*?;base64,/, '');
    try {
      const buf = Buffer.from(clean, 'base64');
      if (buf.length > 80) return buf;
    } catch {
      /* */
    }
  }
  if (j?.bytes && typeof j.bytes === 'object') {
    try {
      const buf = Buffer.from(j.bytes);
      if (buf.length > 80) return buf;
    } catch {
      /* */
    }
  }
  return undefined;
}

/**
 * La frase para quien mandó la foto cuando no se pudo ver. Fija y sin nombres de variables: antes
 * una cuota agotada de Gemini (429) terminaba diciéndole «Falta GEMINI_API_KEY» —mentira, la llave
 * estaba— y encima le enseñaba cómo se llaman las piezas del servidor. El detalle va al registro.
 */
export const NO_PUDE_VER = 'No pude ver la imagen ahora mismo.';

/** Sin cliente esperando (Telegram, cargas): lo que sumaban los dos topes de siempre. */
const PRESUPUESTO_SIN_APURO_MS = 56_000;

async function verConOjo(imagen: string, prompt: string, reloj: Presupuesto, o: OpcionesOjo = {}): Promise<Vista | null> {
  const url = clave('ojo_url').replace(/\/$/, '');
  const claveOjo = clave('ojo_clave');
  if (!url || !claveOjo) return null;
  const r = await fetch(`${url}/ver`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Ojo-Clave': claveOjo },
    body: JSON.stringify({ imagen, prompt }),
    signal: reloj.senal(o.json ? OJO_JSON_MS : OJO_TEXTO_MS),
  });
  if (!r.ok) {
    console.warn('[vision ojo]', r.status, (await r.text().catch(() => '')).slice(0, 160));
    return null;
  }
  const j: any = await r.json().catch(() => ({}));
  const texto = String(j.texto || j.descripcion || j.summary || '').trim();
  // El nodo contesta 200 aunque su modelo falle: `ok:false` y el error del proveedor en `texto` (créditos
  // agotados, modelo caído). Eso no es lo que vio: al registro, y que mire el siguiente.
  if (j.ok === false) {
    console.warn('[vision ojo] su modelo no contestó:', texto.slice(0, 160));
    return null;
  }
  if (!texto) return null;
  return { texto: texto.slice(0, o.json ? TOPE_JSON : TOPE_TEXTO), via: `${url}/ver` };
}

async function verConGemini(imagen: string, prompt: string, reloj: Presupuesto, o: OpcionesOjo = {}): Promise<Vista | null> {
  const key = clave('gemini');
  if (!key) return null;
  const { mime, b64 } = dataUrlAPartes(imagen);
  const model = process.env.GEMINI_VISION_MODEL || 'gemini-2.0-flash';
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ inline_data: { mime_type: mime, data: b64 } }, { text: prompt }],
          },
        ],
        // Con JSON pedido, Gemini lo devuelve sin ``` ni prosa; temperatura baja para que lea, no adorne.
        ...(o.json ? { generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } } : {}),
      }),
      signal: reloj.senal(28000),
    }
  );
  // Cuota (429), llave vencida (403), modelo retirado (404): se registra el código que dio Gemini,
  // que es lo único que dice qué arreglar. Antes esto se tragaba y parecía «falta configuración».
  if (!r.ok) {
    console.warn('[vision gemini]', model, r.status, (await r.text().catch(() => '')).slice(0, 160));
    return null;
  }
  const j: any = await r.json().catch(() => ({}));
  const texto = String(j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '').trim();
  if (!texto) {
    console.warn('[vision gemini]', model, 'contestó sin texto', String(j?.promptFeedback?.blockReason || j?.candidates?.[0]?.finishReason || '').slice(0, 60));
    return null;
  }
  return { texto: texto.slice(0, o.json ? TOPE_JSON : TOPE_TEXTO), via: `gemini:${model}` };
}

/**
 * `via` es `ninguno` si no hay ningún ojo configurado, `tiempo` si el cliente ya no esperaba, y
 * `error` si los que había fallaron. En los tres casos `texto` es `NO_PUDE_VER`.
 */
export function vistaFallida(v: Vista): boolean {
  return v.via === 'ninguno' || v.via === 'error' || v.via === 'tiempo';
}

/* ── Bedrock: la reserva con el mismo AWS del cerebro rápido ─────────────────────────────────── */

/** gemma-3-12b en Bedrock: el pedido corto en 1,6-2,2 s (medido el 6-oct en us-west-2), sin cuota de Hugging Face. */
export const MODELO_VISION_BEDROCK = 'google.gemma-3-12b-it';

type ClienteBedrock = { send: (cmd: ConverseCommand, o?: { abortSignal?: AbortSignal }) => Promise<any> };
let clienteBedrock: ClienteBedrock | null = null;
let clienteBedrockRegion = '';
let clienteBedrockDePrueba: ClienteBedrock | null = null;

/** Las pruebas cambian el cliente (sin red); null vuelve al de verdad. */
export function ponerClienteBedrockVision(c: ClienteBedrock | null) {
  clienteBedrockDePrueba = c;
}

/**
 * ¿Hay Bedrock para ver, con qué modelo y región? `ULTRON_VISION_BEDROCK`: «no» lo apaga; un id de modelo lo
 * cambia. Hacen falta credenciales de AWS (las mismas del cerebro rápido y la memoria S3). Dentro de `node --test`
 * no se usa salvo que se pida: las pruebas no salen a la red aunque la máquina tenga AWS.
 */
export function bedrockVision(env: NodeJS.ProcessEnv = process.env): { modelo: string; region: string } | null {
  const pedido = String(env.ULTRON_VISION_BEDROCK || '').trim();
  if (/^(0|no|off|false|apagado)$/i.test(pedido)) return null;
  const modelo = pedido && !/^(1|si|sí|on|true)$/i.test(pedido) ? pedido : MODELO_VISION_BEDROCK;
  if (clienteBedrockDePrueba) return { modelo, region: 'prueba' };
  if (env.NODE_TEST_CONTEXT && !pedido) return null;
  const credenciales =
    !!(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) ||
    !!env.AWS_PROFILE ||
    !!env.AWS_WEB_IDENTITY_TOKEN_FILE ||
    !!env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
    !!env.AWS_CONTAINER_CREDENTIALS_FULL_URI;
  if (!credenciales) return null;
  return { modelo, region: String(env.ULTRON_VISION_BEDROCK_REGION || env.CEREBRO_VOZ_REGION || 'us-west-2') };
}

const FORMATOS_BEDROCK: Record<string, 'jpeg' | 'png' | 'webp' | 'gif'> = { 'image/jpeg': 'jpeg', 'image/jpg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

/** Los primeros bytes dicen qué es la foto aunque el data URL diga otra cosa. */
function formatoDeBytes(b: Buffer, mime: string): 'jpeg' | 'png' | 'webp' | 'gif' {
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpeg';
  if (b[0] === 0x89 && b[1] === 0x50) return 'png';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (b.subarray(0, 3).toString('latin1') === 'GIF') return 'gif';
  return FORMATOS_BEDROCK[mime] || 'jpeg';
}

async function verConBedrock(imagen: string, prompt: string, reloj: Presupuesto, o: OpcionesOjo = {}): Promise<Vista | null> {
  const conf = bedrockVision();
  if (!conf) return null;
  const { mime, b64 } = dataUrlAPartes(imagen);
  const bytes = Buffer.from(b64, 'base64');
  if (bytes.length < 80) return null;
  let cliente = clienteBedrockDePrueba;
  if (!cliente) {
    if (!clienteBedrock || clienteBedrockRegion !== conf.region) {
      clienteBedrock = new BedrockRuntimeClient({ region: conf.region, maxAttempts: 1 });
      clienteBedrockRegion = conf.region;
    }
    cliente = clienteBedrock;
  }
  const r = await cliente.send(
    new ConverseCommand({
      modelId: conf.modelo,
      messages: [{ role: 'user', content: [{ image: { format: formatoDeBytes(bytes, mime), source: { bytes } } }, { text: prompt }] }],
      // La vista corta cabe en ~250 fichas; la descripción libre, en las 400 de siempre.
      inferenceConfig: { maxTokens: o.json ? 320 : 400, temperature: 0.2 },
    }),
    { abortSignal: reloj.senal(15000) }
  );
  const texto = String((r?.output?.message?.content || []).map((c: any) => c?.text || '').join('') || '').trim();
  if (!texto) {
    console.warn('[vision bedrock]', conf.modelo, 'contestó sin texto', String(r?.stopReason || '').slice(0, 40));
    return null;
  }
  return { texto: texto.slice(0, o.json ? TOPE_JSON : TOPE_TEXTO), via: `bedrock:${conf.modelo}` };
}

/* ── la cadena de ojos ──────────────────────────────────────────────────────────────────────── */

export type NombreOjo = 'ojo' | 'gemini' | 'bedrock';
const ORDEN_OMISION: NombreOjo[] = ['ojo', 'gemini', 'bedrock'];

/** El orden en que se pregunta (ULTRON_VISION_ORDEN=«bedrock,ojo»…); lo que falte del de siempre va detrás. */
export function ordenOjos(env: NodeJS.ProcessEnv = process.env): NombreOjo[] {
  const pedido = String(env.ULTRON_VISION_ORDEN || '')
    .toLowerCase()
    .split(/[\s,;]+/)
    .filter((x): x is NombreOjo => (ORDEN_OMISION as string[]).includes(x));
  return [...new Set([...pedido, ...ORDEN_OMISION])];
}

const VER: Record<NombreOjo, typeof verConOjo> = { ojo: verConOjo, gemini: verConGemini, bedrock: verConBedrock };

function ojoListo(n: NombreOjo): boolean {
  if (n === 'ojo') return !!(clave('ojo_url') && clave('ojo_clave'));
  if (n === 'gemini') return !!clave('gemini');
  return !!bedrockVision();
}

type PedidoOjos = {
  /** El pedido para cada ojo (Gemini lee el largo con cajas; el nodo y Bedrock, el corto). */
  prompt: (n: NombreOjo) => string;
  json?: boolean;
  reloj: Presupuesto;
  /** ¿Sirve lo que contestó? Si no, se pregunta al siguiente (una vista vacía no es «ver»). */
  sirve?: (v: Vista) => boolean;
};

async function verConLosOjos(imagen: string, p: PedidoOjos): Promise<Vista> {
  const listos = ordenOjos().filter(ojoListo);
  if (!listos.length) {
    console.warn('[vision] sin ojo: falta ULTRON_OJO_URL+ULTRON_OJO_CLAVE, GEMINI_API_KEY o credenciales de AWS (Bedrock)');
    return { texto: NO_PUDE_VER, via: 'ninguno' };
  }
  for (const nombre of listos) {
    if (!p.reloj.alcanza()) {
      console.warn(`[vision] sin tiempo para ${nombre}: el cliente ya no espera esta respuesta`);
      return { texto: NO_PUDE_VER, via: 'tiempo' };
    }
    const t0 = Date.now();
    try {
      const vista = await VER[nombre](imagen, p.prompt(nombre), p.reloj, { json: p.json });
      if (!vista) continue;
      if (p.sirve && !p.sirve(vista)) {
        console.warn(`[vision] ${nombre} contestó algo que no sirve como vista (${Date.now() - t0} ms): ${vista.texto.replace(/\s+/g, ' ').slice(0, 120)}`);
        continue;
      }
      return vista;
    } catch (e: any) {
      const tipo = e?.name && e.name !== 'Error' ? `${e.name}: ` : '';
      console.warn(`[vision] ${nombre} falló (${Date.now() - t0} ms):`, `${tipo}${String(e?.message || e)}`.slice(0, 160));
    }
  }
  return { texto: NO_PUDE_VER, via: p.reloj.alcanza() ? 'error' : 'tiempo' };
}

export async function verImagen(imagen: string, prompt?: string, opts: { presupuesto?: Presupuesto; json?: boolean } = {}): Promise<Vista> {
  const pedido = prompt || 'Describe solo lo visible: personas, gestos, objetos, texto y números. No inventes.';
  return verConLosOjos(imagen, { prompt: () => pedido, json: opts.json, reloj: opts.presupuesto || presupuesto(PRESUPUESTO_SIN_APURO_MS) });
}

/**
 * ¿Las cajas de este ojo se pueden dibujar? Gemini aprendió a señalar con `box_2d` en 0-1000; del nodo
 * propio no se sabe qué modelo corre, así que sus cajas solo se pintan si se declara con
 * ULTRON_OJO_CAJAS=1. Sin eso sirven para decir «a la izquierda», no para dibujar.
 */
export function cajasConfiablesDe(via: string): boolean {
  if (via.startsWith('gemini:')) return true;
  return /\/ver$/.test(via) && process.env.ULTRON_OJO_CAJAS === '1';
}

export type VistaVista = { vista: VistaEstructurada | null; via: string; fallo: boolean };

/**
 * Ver con orden (lib/vision-estructurada.ts): el pedido según la pregunta (corto para el nodo y Bedrock,
 * largo con cajas para Gemini), JSON y su parseo. Un ojo cuya respuesta no da una vista (vacía, o un aviso
 * del servicio rescatado como prosa) cuenta como fallo de ESE ojo y se pregunta al siguiente. `fallo` si
 * ninguno vio; `vista` null en ese caso.
 */
export async function verEstructurado(imagen: string, foco: FocoVision = 'escena', opts: { presupuesto?: Presupuesto } = {}): Promise<VistaVista> {
  const vistas = new Map<Vista, VistaEstructurada>();
  const v = await verConLosOjos(imagen, {
    prompt: (n) => (n === 'gemini' ? promptEstructurado(foco) : promptCompacto(foco)),
    json: true,
    reloj: opts.presupuesto || presupuesto(PRESUPUESTO_SIN_APURO_MS),
    sirve: (crudo) => {
      const vista = parsearVista(crudo.texto, { cajasConfiables: cajasConfiablesDe(crudo.via) });
      if (vistaVacia(vista) || (vista.formato === 'texto' && pareceErrorDeServicio(crudo.texto))) return false;
      vistas.set(crudo, vista);
      return true;
    },
  });
  const vista = vistas.get(v);
  if (vistaFallida(v) || !vista) return { vista: null, via: v.via, fallo: true };
  return { vista, via: v.via, fallo: false };
}

export async function capturaPagina(url: string): Promise<{ url: string; texto: string; titulo?: string; foto?: Buffer }> {
  const base = clave('ojo_url').replace(/\/$/, '');
  const claveOjo = clave('ojo_clave');
  if (!base || !claveOjo) return { url, texto: 'Falta el ojo (ULTRON_OJO_URL + CLAVE). No abrí la página.' };
  // Las redirecciones se resuelven aquí, comprobando cada salto: al navegador del nodo le llega el
  // destino final, no un enlace que rebote al metadata de AWS o a la red interna del nodo.
  const destino = await destinoPublico(url);
  if (destino.ok === false) return { url, texto: `No abrí la página: ${destino.error}.` };
  url = destino.url;
  const headers = { 'Content-Type': 'application/json', 'X-Ojo-Clave': claveOjo };
  let texto = '';
  let titulo: string | undefined;
  try {
    const mirar = await fetch(`${base}/mirar`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(25000),
    });
    const visto: any = await mirar.json().catch(() => ({}));
    titulo = visto.titulo || visto.title;
    texto = String(visto.texto || visto.text || visto.textoPlano || '').slice(0, 2500);
  } catch (e: any) {
    texto = `Ojo /mirar falló: ${String(e?.message || e).slice(0, 120)}`;
  }
  let foto: Buffer | undefined;
  try {
    const fotoRes = await fetch(`${base}/foto`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(25000),
    });
    const j: any = await fotoRes.json().catch(() => ({}));
    foto = bufferDeCualquierFoto(j);
  } catch {
    /* captura opcional */
  }
  return { url, texto, titulo, foto };
}
