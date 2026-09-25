/**
 * MCP — las herramientas del cerebro, para otros agentes.
 *
 * Model Context Protocol es el idioma en que Claude Desktop, Claude Code, Cursor y cualquier agente
 * moderno piden herramientas a un servidor. Con esto, un analista puede preguntarle al catastro de
 * Dr Electrum desde su propio asistente, o un agente de AU-RA en otra máquina puede consultar las
 * fichas de la memoria estructurada, sin copiar datos ni abrir la base.
 *
 * Qué expone: SOLO herramientas de LECTURA de esta plataforma. Escribir, mandar mensajes o tocar el
 * sistema se hace desde la app, con una persona identificada detrás; un token en un archivo de
 * configuración no es eso. Las que solo mueven la pantalla (el mapa, el PDF para descargar) tampoco:
 * afuera no hay pantalla.
 *
 * Quién llama: `MCP_TOKEN` (portador, 24+ caracteres) va atado a una persona del padrón,
 * `MCP_QUIEN`. Cada llamada queda en la traza (canal `mcp`) a su nombre y pasa por el motor de
 * reglas como cualquier otra. Sin las dos variables, o si esa persona no tiene acceso a esta
 * plataforma, `/mcp` no existe (404): un servidor MCP abierto a medias es peor que ninguno.
 *
 * Transporte: HTTP «streamable» sin estado, respuestas JSON (spec 2025-03-26 en adelante). No hay
 * canal SSE porque no hay nada que empujar: GET y DELETE responden 405, como dice la especificación.
 */
import crypto from 'node:crypto';
import type express from 'express';
import type { Herramienta } from '../lib/agente/tipos';
import { efectoDe } from '../lib/agente/tipos';
import { validar } from '../lib/agente/protocolo';
import { nivelDe, personaPorId, type Nivel } from '../lib/acceso';
import { PLATAFORMA, type Plataforma } from '../lib/plataforma';
import { autorizar, textoDeDecision } from '../lib/cognitivo/politica';
import { enTurno, iniciarTraza } from '../lib/cognitivo/traza';
import { COMPARTIDAS } from '../lib/manos/compartidas';
import { MEMORIA_ESTRUCTURADA } from '../lib/manos/memoria';
import { TODAS as MANOS_ELECTRUM } from './electrum/manos';

export const VERSIONES_MCP = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const SOLO_PANTALLA = new Set(['mapa_volar', 'mapa_capa', 'informe_pdf']);
const TOPE_POR_MINUTO = Number(process.env.MCP_TOPE_MINUTO || 60);
const MAX_LOTE = 20;

/** Lo que se ofrece por MCP en esta plataforma: lectura, y nada que solo sirva para pintar. */
export function herramientasMcp(plataforma: Plataforma): Herramienta[] {
  const base = plataforma === 'electrum' ? MANOS_ELECTRUM : Object.values(COMPARTIDAS);
  const vistas = new Set<string>();
  return [...base, ...MEMORIA_ESTRUCTURADA].filter((h) => {
    if (vistas.has(h.nombre)) return false;
    vistas.add(h.nombre);
    return h.plataformas.includes(plataforma) && efectoDe(h) === 'lectura' && !SOLO_PANTALLA.has(h.nombre);
  });
}

type Config = { token: string; quien: string; nivel: Nivel; plataforma: Plataforma; origenes: string[] };

/** La configuración, o por qué no se monta. */
export function configMcp(plataforma: Plataforma = PLATAFORMA): { ok: true; c: Config } | { ok: false; motivo: string } {
  const token = String(process.env.MCP_TOKEN || '');
  const quienId = String(process.env.MCP_QUIEN || '').trim();
  if (!token) return { ok: false, motivo: 'sin MCP_TOKEN' };
  if (token.length < 24) return { ok: false, motivo: 'MCP_TOKEN demasiado corto (mínimo 24 caracteres)' };
  if (!quienId) return { ok: false, motivo: 'sin MCP_QUIEN: cada llamada tiene que quedar a nombre de alguien' };
  const persona = personaPorId(quienId);
  const nivel = persona ? nivelDe(persona, plataforma) : null;
  if (!persona || !nivel) return { ok: false, motivo: `MCP_QUIEN=${quienId} no tiene acceso a ${plataforma}` };
  const origenes = String(process.env.MCP_ORIGENES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return { ok: true, c: { token, quien: persona.id, nivel, plataforma, origenes } };
}

function mismoToken(esperado: string, dado: string): boolean {
  const a = crypto.createHash('sha256').update(esperado).digest();
  const b = crypto.createHash('sha256').update(dado).digest();
  return crypto.timingSafeEqual(a, b);
}

const ventana: number[] = [];
function dentroDelTope(): boolean {
  const ahora = Date.now();
  while (ventana.length && ventana[0] < ahora - 60_000) ventana.shift();
  if (ventana.length >= TOPE_POR_MINUTO) return false;
  ventana.push(ahora);
  return true;
}
export function resetTopeMcpTest() {
  ventana.length = 0;
}

type Pedido = { jsonrpc: '2.0'; id?: string | number | null; method?: string; params?: any };
const fallo = (id: Pedido['id'], code: number, message: string) => ({ jsonrpc: '2.0' as const, id: id ?? null, error: { code, message } });
const bien = (id: Pedido['id'], result: unknown) => ({ jsonrpc: '2.0' as const, id: id ?? null, result });

function conTope<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([p, new Promise<T>((_, no) => (t = setTimeout(() => no(new Error(`tardó más de ${ms} ms`)), ms)))]).finally(() => clearTimeout(t));
}

async function llamar(c: Config, hs: Map<string, Herramienta>, nombre: string, args: Record<string, unknown>) {
  const h = hs.get(nombre);
  if (!h) return null;
  // El tope va ANTES de abrir la traza: lo rechazado no escribe nada (un lote de miles de
  // llamadas no puede llenar la base de trazas).
  if (!dentroDelTope()) return { content: [{ type: 'text', text: `Demasiadas llamadas: el tope es ${TOPE_POR_MINUTO} por minuto. Espera un momento.` }], isError: true };
  const traza = iniciarTraza({ plataforma: c.plataforma, canal: 'mcp', quien: c.quien, nivel: c.nivel, pregunta: `${nombre} ${JSON.stringify(args)}` });
  return enTurno(traza, async () => {
    const t0 = Date.now();
    let ok = false;
    let texto: string;
    const v = validar(h.esquema, args);
    if (v.ok === false) {
      texto = v.error;
    } else {
      const ctx = { quien: c.quien, nivel: c.nivel, plataforma: c.plataforma, canal: 'mesa' as const, mensaje: `${nombre} ${JSON.stringify(v.args)}`, prueba: null, riesgo: null };
      const dec = await autorizar({ herramienta: h.nombre, efecto: efectoDe(h), plataforma: c.plataforma, args: v.args, quien: c.quien, nivel: c.nivel, prueba: null, canal: 'mesa', riesgo: null, destino: null });
      if (dec.veredicto !== 'permitir') {
        texto = textoDeDecision({ herramienta: h.nombre }, dec);
      } else {
        try {
          const r = await conTope(h.ejecutar(v.args, ctx), h.msMaximo ?? 20_000);
          ok = r.ok;
          texto = r.texto;
        } catch (e: any) {
          texto = `«${h.nombre}» falló: ${String(e?.message || e).slice(0, 180)}`;
        }
      }
    }
    traza.paso({ herramienta: nombre, ok, ms: Date.now() - t0, resumen: texto, args, ronda: 1 });
    traza.cerrar({ respuesta: texto, via: 'mcp', ...(ok ? {} : { error: texto }) });
    return { content: [{ type: 'text', text: texto }], isError: !ok };
  });
}

async function atender(c: Config, hs: Map<string, Herramienta>, m: Pedido): Promise<object | null> {
  // Un elemento de lote puede ser cualquier cosa (`[1]`, `["x"]`, `[null]`): `'id' in 1` lanza, y un
  // rechazo sin atrapar en Express 4 tumba el proceso entero. Se filtra antes de tocarlo.
  if (!m || typeof m !== 'object' || Array.isArray(m)) return fallo(null, -32600, 'Pedido JSON-RPC inválido');
  if (m.jsonrpc !== '2.0' || typeof m.method !== 'string') {
    // Una respuesta del cliente (no hay pedidos del servidor al cliente) o basura.
    return 'id' in m && !('result' in m || 'error' in m) ? fallo(m.id, -32600, 'Pedido JSON-RPC inválido') : null;
  }
  const esNotificacion = !('id' in m) || m.id === undefined;
  if (esNotificacion) return null;
  switch (m.method) {
    case 'initialize': {
      const pedida = String(m.params?.protocolVersion || '');
      return bien(m.id, {
        protocolVersion: VERSIONES_MCP.includes(pedida) ? pedida : VERSIONES_MCP[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: c.plataforma === 'electrum' ? 'dr-electrum' : 'au-ra', title: c.plataforma === 'electrum' ? 'Dr Electrum FP' : 'AU-RA FP', version: '1.0.0' },
        instructions:
          c.plataforma === 'electrum'
            ? 'Catastro minero de Honduras, expedientes, geometría y fichas de Dr Electrum. Solo lectura. Cita lo que devuelven las herramientas; no inventes datos de concesiones.'
            : 'Fichas de la memoria estructurada de AU-RA, cálculos de mina y precios de metales. Solo lectura.',
      });
    }
    case 'ping':
      return bien(m.id, {});
    case 'tools/list':
      return bien(m.id, {
        tools: [...hs.values()].map((h) => ({ name: h.nombre, description: h.descripcion, inputSchema: h.esquema, annotations: { readOnlyHint: true, openWorldHint: /^web_/.test(h.nombre) } })),
      });
    case 'tools/call': {
      const nombre = String(m.params?.name || '');
      const args = m.params?.arguments && typeof m.params.arguments === 'object' && !Array.isArray(m.params.arguments) ? m.params.arguments : {};
      const r = await llamar(c, hs, nombre, args);
      return r ? bien(m.id, r) : fallo(m.id, -32602, `No existe la herramienta «${nombre}» en este servidor.`);
    }
    default:
      return fallo(m.id, -32601, `Método no soportado: ${m.method}`);
  }
}

export function montarMcp(app: express.Express, plataforma: Plataforma = PLATAFORMA) {
  const conf = configMcp(plataforma);
  if (conf.ok === false) {
    if (process.env.MCP_TOKEN) console.warn(`[mcp] no se monta: ${conf.motivo}`);
    app.all('/mcp', (_req, res) => res.status(404).json({ error: 'MCP no está habilitado en este despliegue' }));
    return false;
  }
  const c = conf.c;
  const hs = new Map(herramientasMcp(plataforma).map((h) => [h.nombre, h]));

  app.all('/mcp', async (req, res) => {
    // Protección contra DNS rebinding (la exige la especificación): un navegador que llega con un
    // Origin que no está en la lista no pasa, aunque traiga el token.
    const origen = req.headers.origin;
    if (origen && !c.origenes.includes(origen)) return res.status(403).json(fallo(null, -32000, 'Origen no permitido'));
    const auth = String(req.headers.authorization || '');
    const dado = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!dado || !mismoToken(c.token, dado)) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="mcp"');
      return res.status(401).json(fallo(null, -32001, 'Falta el token o no es válido'));
    }
    if (req.method !== 'POST') return res.status(405).setHeader('Allow', 'POST').end();
    const version = req.headers['mcp-protocol-version'];
    if (typeof version === 'string' && !VERSIONES_MCP.includes(version)) {
      return res.status(400).json(fallo(null, -32600, `Versión de protocolo no soportada: ${version}`));
    }
    const cuerpo = req.body;
    if (!cuerpo || typeof cuerpo !== 'object') return res.status(400).json(fallo(null, -32700, 'Se esperaba JSON'));
    const lote = Array.isArray(cuerpo);
    const mensajes: Pedido[] = lote ? cuerpo : [cuerpo];
    if (!mensajes.length) return res.status(400).json(fallo(null, -32600, 'Lote vacío'));
    if (mensajes.length > MAX_LOTE) return res.status(413).json(fallo(null, -32600, `Lote demasiado grande (máximo ${MAX_LOTE})`));
    try {
      // En serie: el tope por minuto se cuenta de verdad y una llamada lenta no multiplica la carga.
      const respuestas: object[] = [];
      for (const m of mensajes) {
        const r = await atender(c, hs, m);
        if (r) respuestas.push(r);
      }
      if (!respuestas.length) return res.status(202).end();
      res.json(lote ? respuestas : respuestas[0]);
    } catch (e: any) {
      console.error('[mcp] fallo atendiendo:', String(e?.message || e).slice(0, 200));
      if (!res.headersSent) res.status(500).json(fallo(null, -32603, 'Error interno'));
    }
  });
  console.log(`[mcp] /mcp activo para ${plataforma}: ${hs.size} herramientas de lectura, a nombre de ${c.quien}`);
  return true;
}
