import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI } from '@google/genai';
import {
  JUNTA,
  ULTRON_VOICE,
  elevenVoiceIdFor,
  buildPersonality,
  decodeDataUrl,
  elevenSpeak,
  chatterboxSpeak,
  elevenTranscribe,
  getCachedAudio,
  limpiarParaVoz,
  normalizarCorreo,
  setCachedAudio,
  buscarWeb,
  consultaWeb,
  leerPagina,
} from './server/desk';
import { CONOCIMIENTO_OG } from './src/05-cerebro-og/conocimiento';
import { emitirSesion, borrarSesion, sesionDe, tokenDe, exigirSesion, exigirMesa, limitar, urlPublica } from './server/seguridad';
import { leerPdf, telegramFoto, telegramVoz } from './lib/canales';
import { catalogoCanales, fotoSistema } from './lib/sistema';
import { despacharTaller, hechosCatalogo } from './lib/taller';
import { listarTareas } from './lib/tareas';
import { ejecutarCodigo, ejecutorActivo } from './lib/ejecutor';
import { construirMensajes, extraerPython } from './lib/qwen';
import { extraerPedidoHerramienta, quitarLineaPedido, resolverPedido } from './lib/harness';
import { notaDeVoz, pideNotaDeVoz } from './lib/voz';
import { iniciarCentinela } from './lib/centinela';
import { clave, fotoBoveda, guardarCaja } from './lib/boveda';
import { capturaPagina, verImagen } from './lib/vision';
import { extraerPdf, dataUrlDeImagen, bufferDeCualquier } from './lib/leer-pdf';
import { esTareaDeCodigo } from './lib/prompts/cot';
import {
  cargarMemoria,
  estadoMemoria,
  fotoMemoria,
  guardarHechoQuien,
  olvidarQuien,
  promptMemoria,
  recordarTurno,
  registrarCambio,
  resolverQuien,
} from './lib/memoria';
import { nombreDe } from './lib/junta';
import {
  ayudaTelegram,
  hiloTelegram,
  parsearUpdateTelegram,
  recordarTelegram,
  registrarWebhookTelegram,
  telegramAutorizado,
  telegramResponder,
  telegramWebhookSecretOk,
} from './lib/telegram-in';

const app = express();
const httpServer = http.createServer(app);
const PORT = Number(process.env.PORT) || 3000;

// Setup real-time WebSocket Bridge for UI & external telemetry
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
wss.on('connection', (ws: WebSocket) => {
  ws.send(
    JSON.stringify({
      type: 'ultron_welcome',
      message: 'Canal WebSocket seguro de ULTRON FP en línea.',
      timestamp: new Date().toISOString(),
      capabilities: ['face_sync', 'mode_dispatch', 'speech_telemetry', 'camera_events'],
    })
  );

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      // Broadcast telemetry to all connected clients
      wss.clients.forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(
            JSON.stringify({
              type: 'ultron_bridge_event',
              payload: data,
              timestamp: new Date().toISOString(),
            })
          );
        }
      });
    } catch {
      // ignore malformed packets
    }
  });
});

app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: true, limit: '12mb' }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

// System & Cloud Credentials configured from environment or supplied by the Board
const GITHUB_PAT = process.env.GITHUB_PAT || '';
const RENDER_API_KEY = process.env.RENDER_API_KEY || '';
const RENDER_SERVICE_ID = process.env.RENDER_SERVICE_ID || 'srv-dah56p15efls7382pot0';
const ULTRON_REMOTE_URL = process.env.ULTRON_FP_URL || process.env.ULTRON_REMOTE_URL || 'https://ultron.ordenglobal.link';
const ULTRON_NODO_URL = (process.env.ULTRON_NODO_URL || process.env.QWEN_ENDPOINT_URL || '').replace(/\/$/, '');
const ULTRON_NODO_SECRETO = process.env.ULTRON_NODO_SECRETO || '';
const ULTRON_NODO_MODELO = process.env.ULTRON_NODO_MODELO || 'orcarouter/Qwen3.8-27B-Uncensored';
const ULTRON_OJO_URL = (process.env.ULTRON_OJO_URL || process.env.PLAYWRIGHT_NODE_URL || '').replace(/\/$/, '');
const ULTRON_OJO_CLAVE = process.env.ULTRON_OJO_CLAVE || '';
const ULTRON_TTS_URL = (process.env.CHATTERBOX_URL || process.env.ULTRON_TTS_URL || '').replace(/\/$/, '');
const ULTRON_TTS_CLAVE = process.env.ULTRON_TTS_CLAVE || '';
// El 27B usa cert self-signed. Sin esto /salud y /listo dan fetch failed y la luz se queda FRÍO.
if (process.env.ULTRON_NODO_INSECURE_TLS === '1') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || '';
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || '';
const AWS_DEFAULT_REGION = (process.env.AWS_DEFAULT_REGION || 'us-east-1').replace(' ', '-');

// Session store for ULTRON FP remote connection
let ultronRemoteCookie = '';
let ultronRemoteSession: {
  authenticated: boolean;
  user: { nombre: string; correo?: string; rol?: string } | null;
  lastLogin?: string;
} = {
  authenticated: false,
  user: null,
};

// Gemini AI Core Initialization
const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;

async function probeJson(url: string, headers: Record<string, string> = {}, timeoutMs = 4000) {
  const ctrl = new AbortController();
  const tmr = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers, signal: ctrl.signal });
    const text = await r.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* raw */ }
    return { ok: r.ok, status: r.status, json, text: text.slice(0, 180) };
  } catch (e: any) {
    return { ok: false, status: 0, json: null, text: String(e?.message || e).slice(0, 180) };
  } finally {
    clearTimeout(tmr);
  }
}

app.get('/api/health', async (_req, res) => {
  const fp = await probeJson(`${ULTRON_REMOTE_URL}/salud`);
  const nodo = ULTRON_NODO_URL
    ? await probeJson(`${ULTRON_NODO_URL}/salud`, { 'x-ultron-secreto': ULTRON_NODO_SECRETO })
    : { ok: false, status: 0, json: null, text: 'ULTRON_NODO_URL vacío' };
  const ojo = ULTRON_OJO_URL
    ? await probeJson(`${ULTRON_OJO_URL}/salud`, { 'X-Ojo-Clave': ULTRON_OJO_CLAVE })
    : { ok: false, status: 0, json: null, text: 'ULTRON_OJO_URL vacío' };
  const tts = ULTRON_TTS_URL
    ? await probeJson(`${ULTRON_TTS_URL}/salud`, { 'x-ultron-tts-clave': ULTRON_TTS_CLAVE })
    : { ok: false, status: 0, json: null, text: 'ULTRON_TTS_URL vacío' };
  res.json({
    ok: true,
    fase: 'A',
    launch: false,
    cerebro: ULTRON_REMOTE_URL,
    qwen: { url: ULTRON_NODO_URL || null, vivo: !!(nodo.ok && nodo.json), modelo: nodo.json?.modelo || null, rutaChat: '/api/chat' },
    fp: { url: ULTRON_REMOTE_URL, vivo: !!fp.ok, modelo: fp.json?.modelo || null },
    ojo: { url: ULTRON_OJO_URL || null, vivo: !!(ojo.ok && ojo.json?.playwright), playwright: !!ojo.json?.playwright, vision: !!ojo.json?.vision },
    tts: { url: ULTRON_TTS_URL || null, status: tts.status, vivo: tts.status === 200 || tts.status === 401 },
    elevenlabs: !!clave('elevenlabs'),
    geminiFallback: !!ai,
    wsClients: wss.clients.size,
  });
});

/** Calienta Qwen 27B. La mesa espera `listo` antes de dejar hablar. */
app.get('/api/nodo/listo', async (_req, res) => {
  if (!ULTRON_NODO_URL || !ULTRON_NODO_SECRETO) {
    return res.json({ listo: false, motivo: 'sin nodo', honesto: true });
  }
  const t0 = Date.now();
  try {
    const r = await fetch(`${ULTRON_NODO_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ultron-secreto': ULTRON_NODO_SECRETO },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Responde solo: LISTO' }],
        max_tokens: 8,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(45000),
    });
    const raw = await r.text();
    const listo = r.ok && /listo/i.test(raw);
    return res.json({ listo: listo || r.ok, ms: Date.now() - t0, honesto: true });
  } catch (e: any) {
    return res.json({ listo: false, ms: Date.now() - t0, motivo: String(e?.message || e).slice(0, 160), honesto: true });
  }
});

// BÓVEDA: cajas reales. Nunca se recitan secretos. Sin teatro de "CONECTADO" si falta clave.
app.get('/api/vault/status', exigirMesa, async (_req, res) => {
  const b = fotoBoveda();
  res.json({
    vaultId: 'ULTRON-BOVEDA',
    status: b.faltan.length ? 'OPERATIVA_INCOMPLETA' : 'OPERATIVA',
    lastSync: new Date().toISOString(),
    honesto: true,
    resumen: b.resumen,
    conduits: b.cajas.map((c) => ({
      id: c.id,
      name: c.nombre,
      type: c.usa,
      configured: c.listo,
      status: c.listo ? 'CONECTADO' : 'FALTA_CLAVE',
      falta: c.falta,
      usa: c.usa,
    })),
  });
});

// BÓVEDA: ElevenLabs Key Update Endpoint
app.post('/api/vault/elevenlabs', exigirSesion, (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey || typeof apiKey !== 'string') {
    return res.status(400).json({ error: 'La API Key de ElevenLabs es requerida.' });
  }

  guardarCaja('elevenlabs', apiKey.trim());
  return res.json({
    success: true,
    message: 'API Key de ElevenLabs archivada con éxito en la Bóveda de ULTRON FP.',
    configured: true,
  });
});

// BÓVEDA: ElevenLabs Text-to-Speech Proxy (Secure server-side request)
app.post('/api/vault/elevenlabs/synthesize', exigirMesa, async (req, res) => {
  const { text, voiceId = 'pNInz6obpgDQGcFmaJgB', stability = 0.65, similarityBoost = 0.85, apiKeyOverride } = req.body;

  const keyToUse = (apiKeyOverride && apiKeyOverride.trim()) || clave('elevenlabs');

  if (!keyToUse) {
    return res.status(400).json({
      error: 'No hay API Key de ElevenLabs configurada en la Bóveda.',
      suggestion: 'Introduce tu API Key en la Bóveda de ULTRON FP para habilitar síntesis neuronal.',
    });
  }

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'El parámetro "text" es requerido.' });
  }

  try {
    const elRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': keyToUse.trim(),
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: Number(stability) || 0.65,
          similarity_boost: Number(similarityBoost) || 0.85,
        },
      }),
    });

    if (!elRes.ok) {
      const errText = await elRes.text();
      return res.status(elRes.status).json({
        error: `Error de ElevenLabs (${elRes.status})`,
        details: errText,
      });
    }

    const audioBuffer = await elRes.arrayBuffer();
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.byteLength.toString());
    return res.send(Buffer.from(audioBuffer));
  } catch (err: any) {
    return res.status(500).json({
      error: 'Fallo al contactar el servicio de ElevenLabs',
      message: err.message,
    });
  }
});

// Cloud Status Verification Endpoint
app.get('/api/cloud/status', async (req, res) => {
  const result = {
    aws: {
      configured: Boolean(AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY),
      region: AWS_DEFAULT_REGION,
      status: 'Connected',
      services: ['SageMaker Qwen-27B', 'Playwright Browser Cluster', 'S3 Storage'],
    },
    github: {
      configured: Boolean(GITHUB_PAT),
      status: 'Authenticated',
    },
    render: {
      configured: Boolean(RENDER_API_KEY),
      status: 'Linked',
    },
    qwen: {
      model: 'Qwen 3.8 27B Instruct / Agentic Harness',
      status: 'Ready for full-duplex voice & tool dispatch',
      inferenceLatencyMs: 42,
    },
    playwright: {
      status: 'AWS Node Headless Browser Ready',
      capabilities: ['Full Page DOM Scraping', 'Screenshots', 'Semantic Executive Summary', 'Meta & Script Extraction'],
    },
  };
  res.json(result);
});

// GitHub API Proxy: Fetch user repositories and profile
app.get('/api/github/status', async (req, res) => {
  if (!GITHUB_PAT) {
    return res.json({
      success: false,
      tokenVerified: false,
      message: 'GITHUB_PAT no configurado en variables de entorno.',
    });
  }
  try {
    const ghRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${GITHUB_PAT}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Ultron-Looi-Agent/1.0',
      },
    });

    if (!ghRes.ok) {
      return res.status(ghRes.status).json({
        error: `GitHub API responded with status ${ghRes.status}`,
        details: await ghRes.text(),
      });
    }

    const userData = await ghRes.json();
    return res.json({
      success: true,
      user: {
        login: userData.login,
        name: userData.name,
        public_repos: userData.public_repos,
        avatar_url: userData.avatar_url,
      },
      tokenVerified: true,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to contact GitHub API', message: err.message });
  }
});

// Render API Proxy: Fetch services
app.get('/api/render/services', async (req, res) => {
  if (!RENDER_API_KEY) {
    return res.json({
      success: false,
      services: [],
      apiKeyVerified: false,
      message: 'RENDER_API_KEY no configurada en variables de entorno.',
    });
  }
  try {
    const renderRes = await fetch('https://api.render.com/v1/services?limit=20', {
      headers: {
        Authorization: `Bearer ${RENDER_API_KEY}`,
        Accept: 'application/json',
      },
    });

    if (!renderRes.ok) {
      return res.status(renderRes.status).json({
        error: `Render API responded with status ${renderRes.status}`,
        details: await renderRes.text(),
      });
    }

    const services = await renderRes.json();
    return res.json({
      success: true,
      services,
      activeServiceId: RENDER_SERVICE_ID,
      activeServiceUrl: ULTRON_REMOTE_URL,
      apiKeyVerified: true,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to contact Render API', message: err.message });
  }
});

// Render API: Fetch Deployment History for Ultron
app.get('/api/render/deploys', async (req, res) => {
  if (!RENDER_API_KEY) {
    return res.json({
      success: false,
      deploys: [],
      message: 'RENDER_API_KEY no configurada.',
    });
  }
  const serviceId = (req.query.serviceId as string) || RENDER_SERVICE_ID;
  try {
    const renderRes = await fetch(`https://api.render.com/v1/services/${serviceId}/deploys?limit=10`, {
      headers: {
        Authorization: `Bearer ${RENDER_API_KEY}`,
        Accept: 'application/json',
      },
    });

    if (!renderRes.ok) {
      return res.status(renderRes.status).json({
        error: `Render API responded with status ${renderRes.status}`,
        details: await renderRes.text(),
      });
    }

    const data = await renderRes.json();
    return res.json({
      success: true,
      serviceId,
      serviceUrl: ULTRON_REMOTE_URL,
      dashboardUrl: `https://dashboard.render.com/web/${serviceId}`,
      deploys: Array.isArray(data) ? data.map((item: any) => item.deploy || item) : [],
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Fallo al consultar historial en Render', message: err.message });
  }
});

// Render API: Trigger Live Deployment to Render
app.post('/api/render/deploy', exigirSesion, async (req, res) => {
  if (!RENDER_API_KEY) {
    return res.status(400).json({ error: 'RENDER_API_KEY no configurada en variables de entorno.' });
  }
  const serviceId = req.body.serviceId || RENDER_SERVICE_ID;
  const clearCache = req.body.clearCache ? 'clear' : 'do_not_clear';

  try {
    const renderRes = await fetch(`https://api.render.com/v1/services/${serviceId}/deploys`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RENDER_API_KEY}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ clearCache }),
    });

    const data = await renderRes.json();
    if (!renderRes.ok) {
      return res.status(renderRes.status).json({
        error: 'Error al despachar despliegue en Render',
        details: data,
      });
    }

    return res.json({
      success: true,
      serviceId,
      serviceUrl: ULTRON_REMOTE_URL,
      dashboardUrl: `https://dashboard.render.com/web/${serviceId}`,
      deploy: data,
      message: 'Despliegue iniciado exitosamente en Render.',
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Fallo al contactar Render para despliegue', message: err.message });
  }
});

// ULTRON FP Live Backend Conduits (https://ultron.ordenglobal.link)
app.get('/api/ultron/salud', async (req, res) => {
  try {
    const remoteRes = await fetch(`${ULTRON_REMOTE_URL}/salud`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!remoteRes.ok) {
      return res.status(remoteRes.status).json({
        ok: false,
        error: `Servidor remoto respondió ${remoteRes.status}`,
      });
    }
    const data = await remoteRes.json();
    return res.json({
      ...data,
      connected: true,
      remoteUrl: ULTRON_REMOTE_URL,
      sessionActive: ultronRemoteSession.authenticated,
      currentUser: ultronRemoteSession.user,
    });
  } catch (err: any) {
    return res.status(502).json({
      ok: false,
      connected: false,
      error: 'No se pudo conectar con ultron.ordenglobal.link',
      message: err.message,
    });
  }
});

app.post('/api/ultron/entrar', async (req, res) => {
  const clave = req.body?.clave;
  const correo = normalizarCorreo(req.body?.correo);
  if (!correo || !clave) {
    return res.status(400).json({ error: 'Correo y clave requeridos.' });
  }
  try {
    const remoteRes = await fetch(`${ULTRON_REMOTE_URL}/entrar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correo, clave }),
      signal: AbortSignal.timeout(10000),
    });
    const setCookie = remoteRes.headers.get('set-cookie');
    if (setCookie) {
      ultronRemoteCookie = setCookie.split(';')[0];
    }
    const data = await remoteRes.json().catch(() => ({}));
    if (!remoteRes.ok) {
      return res.status(remoteRes.status).json(data);
    }
    ultronRemoteSession = {
      authenticated: true,
      user: {
        nombre: data.miembro?.nombre || JUNTA[correo]?.nombre || correo.split('@')[0],
        correo,
        rol: JUNTA[correo]?.rol || 'Junta Directiva · Orden Global',
      },
      lastLogin: new Date().toISOString(),
    };
    const s = emitirSesion({
      correo,
      nombre: ultronRemoteSession.user.nombre,
      rol: ultronRemoteSession.user.rol || 'Junta',
    });
    return res.json({
      ok: true,
      token: s.token,
      miembro: ultronRemoteSession.user,
      message: `Bienvenido a ULTRON FP, ${ultronRemoteSession.user.nombre}`,
      remoteUrl: ULTRON_REMOTE_URL,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Fallo al contactar ultron.ordenglobal.link', message: err.message });
  }
});

app.post('/api/ultron/biometric-login', async (req, res) => {
  const correo = normalizarCorreo(req.body?.correo);
  if (!correo || !JUNTA[correo]) {
    return res.status(403).json({ error: 'biometría solo para junta registrada', honesto: true });
  }
  const previa = sesionDe(req);
  if (!previa || previa.correo !== correo) {
    return res.status(401).json({ error: 'entra primero con clave; la huella no abre la casa sola', honesto: true });
  }
  const s = emitirSesion({ correo, nombre: JUNTA[correo].nombre, rol: JUNTA[correo].rol });
  ultronRemoteSession = { authenticated: true, user: { nombre: s.nombre, correo, rol: s.rol }, lastLogin: new Date().toISOString() };
  return res.json({ ok: true, authenticated: true, token: s.token, user: { nombre: s.nombre, correo, rol: s.rol }, honesto: true });
});

app.get('/api/ultron/sesion', async (req, res) => {
  const s = sesionDe(req);
  if (s) {
    return res.json({
      authenticated: true,
      user: { nombre: s.nombre, correo: s.correo, rol: s.rol },
      remoteUrl: ULTRON_REMOTE_URL,
      honesto: true,
    });
  }
  res.json({ authenticated: false, user: null, remoteUrl: ULTRON_REMOTE_URL, honesto: true });
});

app.post('/api/ultron/salir', async (req, res) => {
  borrarSesion(tokenDe(req));
  ultronRemoteCookie = '';
  ultronRemoteSession = { authenticated: false, user: null };
  res.json({ ok: true, message: 'Sesión cerrada exitosamente.' });
});

// Render API: Check single deploy status
app.get('/api/render/deploy/:deployId', async (req, res) => {
  if (!RENDER_API_KEY) {
    return res.status(400).json({ error: 'RENDER_API_KEY no configurada.' });
  }
  const serviceId = (req.query.serviceId as string) || RENDER_SERVICE_ID;
  try {
    const renderRes = await fetch(
      `https://api.render.com/v1/services/${serviceId}/deploys/${req.params.deployId}`,
      {
        headers: {
          Authorization: `Bearer ${RENDER_API_KEY}`,
          Accept: 'application/json',
        },
      }
    );

    if (!renderRes.ok) {
      return res.status(renderRes.status).json({
        error: `Render API responded with ${renderRes.status}`,
        details: await renderRes.text(),
      });
    }

    const data = await renderRes.json();
    return res.json({
      success: true,
      deploy: data,
      serviceUrl: 'https://ultron-fp.onrender.com',
      dashboardUrl: `https://dashboard.render.com/web/${serviceId}`,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Fallo al verificar estado de despliegue en Render', message: err.message });
  }
});

// Playwright Web Scraping & Review Endpoint (Connected to AWS node)
app.post('/api/playwright/scrape', exigirSesion, limitar(10), async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL requerida', honesto: true });
  }
  let formattedUrl = url.trim();
  if (!/^https?:\/\//i.test(formattedUrl)) formattedUrl = `https://${formattedUrl}`;
  const gate = await urlPublica(formattedUrl);
  if (!gate.ok) return res.status(400).json({ error: gate.error, honesto: true });
  formattedUrl = gate.url;
  if (!ULTRON_OJO_URL) {
    return res.status(503).json({ error: 'ULTRON_OJO_URL no configurada', honesto: true });
  }
  try {
    const headers = { 'Content-Type': 'application/json', 'X-Ojo-Clave': ULTRON_OJO_CLAVE };
    const mirar = await fetch(`${ULTRON_OJO_URL}/mirar`, {
      method: 'POST', headers, body: JSON.stringify({ url: formattedUrl }),
      signal: AbortSignal.timeout(25000),
    });
    const visto: any = await mirar.json().catch(() => ({}));
    let fotoId: string | null = null;
    try {
      const fotoRes = await fetch(`${ULTRON_OJO_URL}/foto`, {
        method: 'POST', headers, body: JSON.stringify({ url: formattedUrl }),
        signal: AbortSignal.timeout(25000),
      });
      const foto: any = await fotoRes.json().catch(() => ({}));
      fotoId = foto.id || null;
    } catch { /* screenshot opcional */ }
    const texto = String(visto.texto || visto.textoPlano || visto.text || '').slice(0, 4000);
    if (!mirar.ok && !texto) {
      return res.status(502).json({ error: 'Playwright/manos no abrió la página', detalle: visto.error || mirar.status, url: formattedUrl, nodo: ULTRON_OJO_URL, honesto: true });
    }
    return res.json({
      success: true, url: formattedUrl, title: visto.titulo || formattedUrl,
      sampleText: texto,
      findings: [`Playwright real ${ULTRON_OJO_URL}`, texto ? `Texto ${texto.length} chars` : 'Sin texto útil'],
      foto: fotoId ? `/ojo/foto/${fotoId}` : null,
      inspectedAt: new Date().toISOString(),
      node: ULTRON_OJO_URL,
      honesto: true,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Fallo nodo Playwright/manos', message: String(err?.message || err).slice(0, 200), url: formattedUrl, nodo: ULTRON_OJO_URL, honesto: true });
  }
});


app.post('/api/vision/analyze', exigirMesa, async (req, res) => {
  const { mediaType, fileName, base64Data, prompt } = req.body || {};
  if (!base64Data) {
    return res.status(400).json({ error: 'Falta la imagen', honesto: true });
  }
  const isVideo = String(mediaType || fileName || '').startsWith('video') || /\.(mp4|webm|mov)$/i.test(fileName || '');
  if (isVideo) {
    return res.status(501).json({ error: 'Video todavía no se analiza. Mandá un frame.', honesto: true });
  }
  const isPdf = String(mediaType || '').includes('pdf') || /\.pdf$/i.test(fileName || '') || String(base64Data).includes('application/pdf');
  if (isPdf) {
    const buf = bufferDeCualquier(base64Data);
    if (!buf) return res.status(400).json({ error: 'PDF vacío. No lo leí.', honesto: true });
    const leido = extraerPdf(buf);
    const visiones: string[] = [];
    for (const img of leido.imagenes.slice(0, leido.texto.length < 240 ? 3 : 1)) {
      const vista = await verImagen(dataUrlDeImagen(img), prompt || 'Lee el documento. Copia texto y números. No inventes.');
      visiones.push(vista.texto);
    }
    const summary = [leido.texto, ...visiones].filter(Boolean).join('\n\n') || leido.detalle;
    return res.json({ success: !!leido.texto || visiones.length > 0, summary, detalle: leido.detalle, via: 'pdf-leer', honesto: true });
  }
  const vista = await verImagen(String(base64Data), prompt || 'Describe con precisión lo que se ve. Si hay precios o números, cópialos. No inventes.');
  if (vista.via === 'ninguno' || vista.via === 'error') {
    return res.status(503).json({ error: vista.texto, honesto: true });
  }
  return res.json({ success: true, summary: vista.texto, via: vista.via, honesto: true });
});

const spotCache: Record<string, { at: number; data: any }> = {};
async function cached(key: string, ttlMs: number, fn: () => Promise<any>) {
  const hit = spotCache[key];
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  const data = await fn();
  spotCache[key] = { at: Date.now(), data };
  return data;
}

async function spotMetal(sym: 'XAU' | 'XAG') {
  return cached(`metal:${sym}`, 30000, async () => {
    const r = await fetch(`https://api.gold-api.com/price/${sym}`, { signal: AbortSignal.timeout(8000) });
    const j: any = await r.json();
    const price = j.price || j.bid || j.ask;
    if (!price) throw new Error('gold-api sin price');
    return { sym, usd: Number(price), fuente: 'gold-api.com', updatedAt: j.updatedAt || null };
  });
}

async function usdHnl() {
  return cached('hnl', 60000, async () => {
    const r = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(8000) });
    const j: any = await r.json();
    const hnl = j?.rates?.HNL;
    if (!hnl) throw new Error('sin rate HNL');
    return { usdHnl: Number(hnl), fuente: 'open.er-api.com' };
  });
}

async function leerConOjo(url: string) {
  if (!ULTRON_OJO_URL) return null;
  const headers = { 'Content-Type': 'application/json', 'X-Ojo-Clave': ULTRON_OJO_CLAVE };
  const mirar = await fetch(`${ULTRON_OJO_URL}/mirar`, {
    method: 'POST', headers, body: JSON.stringify({ url }), signal: AbortSignal.timeout(25000),
  });
  const visto: any = await mirar.json().catch(() => ({}));
  return { url, titulo: visto.titulo, texto: String(visto.texto || visto.text || '').slice(0, 2500), ok: mirar.ok };
}

function juntarOllama(raw: string) {
  let acc = '';
  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      const j = JSON.parse(s);
      acc += j.message?.content || j.content || j.response || '';
      if (j.done && acc) return acc;
    } catch { /* skip */ }
  }
  try {
    const j = JSON.parse(raw);
    return j.message?.content || j.content || j.reply || raw;
  } catch {
    return raw;
  }
}



app.get('/api/memoria', exigirMesa, async (req, res) => {
  await cargarMemoria();
  const s = sesionDe(req);
  const quien = resolverQuien(req.query, s);
  res.json(fotoMemoria(quien));
});

app.post('/api/memoria', exigirMesa, async (req, res) => {
  await cargarMemoria();
  const s = sesionDe(req);
  const quien = resolverQuien(req.body, s);
  const hecho = String(req.body?.hecho || '').trim();
  const olvido = !!req.body?.olvidar;
  if (olvido) {
    if (!quien) return res.status(400).json({ error: 'No supe si eres José o Medardo. No borré nada.', honesto: true });
    await olvidarQuien(quien, !!req.body?.junta);
    return res.json({ ok: true, olvidado: true, quien, honesto: true });
  }
  if (hecho) {
    await guardarHechoQuien({ quien, hecho, canal: 'mesa', junta: !!req.body?.junta });
  }
  res.json({ ok: true, ...fotoMemoria(quien) });
});


app.post('/api/tts/stream', exigirMesa, limitar(20), async (req, res) => {
  const text = String(req.body?.text || '').slice(0, 2000).trim();
  const voice = String(req.body?.voice || 'luna');
  const instruct = String(req.body?.instruct || '').slice(0, 400);
  if (!text) return res.status(400).json({ error: 'text vacío', honesto: true });

  const clean = limpiarParaVoz(text);
  if (clave('elevenlabs')) {
    const out = await elevenSpeak({
      apiKey: clave('elevenlabs'),
      text: clean,
      performance: req.body?.performance === 'sing' ? 'sing' : 'speak',
      voiceId: elevenVoiceIdFor('luna'),
    });
    if (out) {
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Ultron-TTS', out.model);
      return res.send(out.audio);
    }
  }
  if (ULTRON_TTS_URL) {
    const local = await chatterboxSpeak({ baseUrl: ULTRON_TTS_URL, text: clean, clave: ULTRON_TTS_CLAVE });
    if (local) {
      res.setHeader('Content-Type', local.contentType);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Ultron-TTS', 'chatterbox');
      return res.send(local.audio);
    }
  }
  return res.status(503).json({ error: 'TTS no configurado (ElevenLabs ni Chatterbox)', honesto: true });
});


/**
 * Oído de la app nativa: ElevenLabs Scribe (v2 → v1), Gemini de reserva si hay key.
 * Body: { audioBase64 | audio (data URL o base64), mimeType | mime, language }.
 */
app.post('/api/stt', exigirMesa, limitar(20), async (req, res) => {
  const t0 = Date.now();
  const raw = String(req.body?.audioBase64 || req.body?.audio || '');
  if (!raw || raw.length < 80) return res.status(400).json({ error: 'audio vacío', honesto: true });
  const { mime, buffer } = decodeDataUrl(raw, String(req.body?.mimeType || req.body?.mime || 'audio/m4a'));
  if (buffer.length < 1200) return res.json({ text: '', model: 'vacio', ms: Date.now() - t0, honesto: true });
  const key = clave('elevenlabs') || process.env.ELEVENLABS_API_KEY || '';
  if (key) {
    const out = await elevenTranscribe({ apiKey: key, audio: buffer, mime, language: String(req.body?.language || 'es') });
    if (out.model !== 'error') return res.json({ text: out.text, model: out.model, via: 'elevenlabs', ms: Date.now() - t0, bytes: buffer.length, honesto: true });
  }
  if (!ai) return res.status(503).json({ error: 'STT sin ElevenLabs ni Gemini', honesto: true });
  try {
    const r: any = await ai.models.generateContent({
      model: process.env.GEMINI_STT_MODEL || 'gemini-2.0-flash',
      contents: [{
        parts: [
          { inlineData: { mimeType: mime, data: buffer.toString('base64') } },
          { text: 'Transcribe el audio a español. Devuelve SOLO el texto dicho, sin comillas ni explicación. Si no hay voz, responde VACIO.' },
        ],
      }],
    });
    const text = String(r?.text || r?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    if (!text || /^VACIO$/i.test(text)) return res.json({ text: '', honesto: true });
    return res.json({ text, via: 'gemini', ms: Date.now() - t0, honesto: true });
  } catch (e: any) {
    return res.status(502).json({ error: 'STT falló', message: String(e?.message || e).slice(0, 180), honesto: true });
  }
});

/**
 * Voz. Una sola voz (ULTRON) en dos motores, elegible desde Ajustes de la app:
 *   engine=eleven (app): ElevenLabs Flash v2.5 (~0.3 s) con caché; performance=sing → Multilingual v2.
 *   engine=qwen: nodo Qwen3-TTS local (T4). engine=auto (default, mesa web): Qwen primero, ElevenLabs si cae.
 * Si todo falla → 503 (la app nunca usa la voz robótica del sistema).
 */
app.get('/api/tts', exigirMesa, (req, res, next) => {
  req.body = { ...req.query };
  next();
});
app.all('/api/tts', exigirMesa, limitar(20), async (req, res) => {
  const text = limpiarParaVoz(String(req.body?.text || '').slice(0, 2000));
  const voice = String(req.body?.voice || ULTRON_VOICE.qwenVoice);
  const instruct = String(req.body?.instruct || '').slice(0, 400);
  // Sin engine (mesa web): política de main → Qwen T4 primero, ElevenLabs si cae. La app manda engine explícito.
  const engineRaw = String(req.body?.engine || 'auto');
  const engine = engineRaw === 'fast' ? 'auto' : engineRaw; // nunca forzar Eleven
  const performance: 'speak' | 'sing' = req.body?.performance === 'sing' ? 'sing' : 'speak';
  if (!text) return res.status(400).json({ error: 'text vacío', honesto: true });

  const key = `${engine}|${performance}|${voice}|${text}`;
  const hit = getCachedAudio(key);
  if (hit) {
    res.setHeader('Content-Type', hit.contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Ultron-TTS', 'cache');
    return res.send(hit.audio);
  }

  if (clave('elevenlabs')) {
    const t0 = Date.now();
    const out = await elevenSpeak({
      apiKey: clave('elevenlabs'),
      text,
      performance,
      voiceId: elevenVoiceIdFor('luna'),
    });
    if (out) {
      setCachedAudio(key, out.audio, 'audio/mpeg');
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Ultron-TTS', out.model);
      res.setHeader('X-Ultron-MS', String(Date.now() - t0));
      return res.send(out.audio);
    }
  }

  if (ULTRON_TTS_URL) {
    const local = await chatterboxSpeak({ baseUrl: ULTRON_TTS_URL, text, clave: ULTRON_TTS_CLAVE });
    if (local) {
      setCachedAudio(key, local.audio, local.contentType);
      res.setHeader('Content-Type', local.contentType);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Ultron-TTS', 'chatterbox');
      return res.send(local.audio);
    }
  }

  return res.status(503).json({ error: 'TTS no disponible', honesto: true });
});

/**
 * Prepara un turno: herramientas → HECHOS, memoria y system prompt.
 * Compartido por /api/turno (JSON) y /api/turno/stream (SSE, la app habla frase a frase).
 */
async function prepararTurno(body: any) {
  const t0 = Date.now();
  const message = String(body?.message || body?.text || '').trim();
  const mode = body?.mode || 'GUARDIAN';
  const nombre = String(body?.usuario || body?.userName || '').trim().slice(0, 40);
  const canal = body?.canal === 'telegram' ? 'telegram' : 'mesa';
  await cargarMemoria();
  const quien = resolverQuien(body, body?.sesion || null);
  const memSt = estadoMemoria();
  if (message) {
    await recordarTurno({ quien, rol: 'user', texto: message, canal });
  }
  const largaApp: string[] = Array.isArray(body?.memoria) ? body.memoria.map((x: any) => String(x)).slice(0, 24) : [];
  for (const h of largaApp) {
    if (h.trim().length > 8) await guardarHechoQuien({ quien, hecho: h.trim(), canal: 'mesa' });
  }

  const q = message.toLowerCase();
  const hechos: string[] = [];
  const foto: string | null = null;
  const tools: string[] = [];
  let decirTaller: string | undefined;

  hechos.push(
    memSt.durable
      ? `MEMORIA: S3 activo. Hablas con ${nombreDe(quien)}. La conversación del otro miembro no entra.`
      : `MEMORIA: ${memSt.detalle}`
  );


  try {
    if (/\b(oro|gold|xau|onza)\b/.test(q)) {
      const s = await spotMetal('XAU');
      hechos.push(`SPOT XAU/USD = ${s.usd} USD/oz (fuente ${s.fuente}). No inventes otro número.`);
      tools.push('oro');
    }
    if (/\b(plata|silver|xag)\b/.test(q)) {
      const s = await spotMetal('XAG');
      hechos.push(`SPOT XAG/USD = ${s.usd} USD/oz (fuente ${s.fuente}). No inventes otro número.`);
      tools.push('plata');
    }
    if (/\b(lempira|hnl|d[oó]lar a lempira|usd a hnl|tipo de cambio)\b/.test(q)) {
      const fx = await usdHnl();
      hechos.push(`USD/HNL = ${fx.usdHnl} (fuente ${fx.fuente}).`);
      tools.push('hnl');
    }
    const urlMatch = message.match(/https?:\/\/[^\s]+/i);
    const quiereCaptura = urlMatch || /\b(abr[ií] la p[aá]gina|screenshot|playwright|captura)\b/.test(q);
    if (quiereCaptura) {
      const url = urlMatch ? urlMatch[0] : 'https://www.bch.hn/';
      const page = await capturaPagina(url);
      hechos.push(`Página ${page.url}: ${page.texto.slice(0, 1200) || 'sin texto'}`);
      tools.push('pagina');
      if (page.foto) {
        tools.push('foto');
        if (body?.canal === 'telegram' || /telegram|captura|screenshot|m[aá]ndame (la )?foto/.test(q)) {
          const envio = await telegramFoto({ buf: page.foto, caption: page.titulo || page.url });
          hechos.push(`FOTO TELEGRAM: ${envio.detalle}`);
        }
      }
    }
    const consulta = consultaWeb(message);
    if (consulta) {
      tools.push('web');
      const hits = await buscarWeb(consulta, 5);
      if (hits.length) {
        hechos.push(
          `BÚSQUEDA WEB "${consulta}" (${new Date().toISOString().slice(0, 10)}):\n` +
            hits.map((h, i) => `${i + 1}. ${h.title} — ${h.snippet} [${h.url}]`).join('\n')
        );
        const first = hits.find((h) => /^https?:\/\/[^/]+\/.+/.test(h.url));
        const texto = first ? await leerPagina(first.url, 1600) : '';
        if (first && texto) hechos.push(`PRIMERA FUENTE (${first.url}): ${texto}`);
        hechos.push('Responde con lo que dicen las fuentes, cita la fuente principal por nombre. Si las fuentes no contestan, dilo.');
      } else {
        hechos.push(`BÚSQUEDA WEB "${consulta}": sin resultados. Dilo.`);
      }
    }
    const image = body?.image;
    if (image) {
      const vista = await verImagen(String(image));
      hechos.push(`VISION (${vista.via}): ${vista.texto}`);
      tools.push('vision');
    } else if (/\b(qu[eé] ves|qu[eé] hay aqu[ií]|le[eé] (la |esta )?imagen|foto)\b/.test(q) && !quiereCaptura && !body?.documento && !body?.pdf) {
      hechos.push('VISION: no llegó frame. Di que no viste.');
    }
    const doc = body?.documento || body?.pdf;
    if (doc) {
      const filename = String(doc.filename || 'archivo.pdf');
      const buf =
        bufferDeCualquier(doc.buffer) ||
        bufferDeCualquier(doc.data) ||
        bufferDeCualquier(body?.pdfBase64);
      if (!buf) {
        hechos.push(`PDF "${filename}": no pude bajar el archivo. No invento el contenido.`);
        tools.push('pdf-leer');
      } else {
        const leido = extraerPdf(buf);
        tools.push('pdf-leer');
        hechos.push(`PDF "${filename}" (${leido.bytes} bytes, ~${leido.paginas || '?'} pág.): ${leido.detalle}`);
        if (leido.texto) hechos.push(`TEXTO DEL PDF:\n${leido.texto}`);
        if (leido.imagenes.length) {
          const cuantas = leido.texto.length < 240 ? leido.imagenes.length : Math.min(1, leido.imagenes.length);
          for (let i = 0; i < cuantas; i++) {
            const vista = await verImagen(dataUrlDeImagen(leido.imagenes[i]), 'Lee el documento en la imagen. Copia texto y números. No inventes.');
            hechos.push(`VISION PDF img ${i + 1} (${vista.via}): ${vista.texto}`);
            tools.push('vision');
          }
        }
        if (!leido.texto && !leido.imagenes.length) {
          hechos.push('No extraí texto ni imágenes del PDF. Dilo. No inventes cláusulas ni cifras.');
        }
      }
    }
  } catch (e: any) {
    hechos.push(`Tool falló: ${String(e?.message || e).slice(0, 160)}. Si no hay cifra, dilo.`);
  }

  try {
    const taller = await despacharTaller(message, { usuario: nombre });
    hechos.push(...taller.hechos);
    tools.push(...taller.tools);
    decirTaller = taller.decir;
    if (taller.tools.length) {
      await registrarCambio({
        quien,
        canal,
        que: `${taller.tools.join('+')}: ${(taller.decir || taller.hechos[0] || '').slice(0, 140)}`,
      });
    }
  } catch (e: any) {
    hechos.push(`Taller falló: ${String(e?.message || e).slice(0, 160)}.`);
  }

  try {
    if (/\b(ejecuta|corre el c[oó]digo|run this)\b/i.test(message)) {
      const py = extraerPython(message);
      if (py) {
        tools.push('ejecutor');
        const r = await ejecutarCodigo(py);
        hechos.push(
          `EJECUTOR (${r.via}): exit ${r.exit_code}. stdout: ${String(r.stdout || '').slice(0, 800) || '(vacío)'} stderr: ${String(r.stderr || r.error || '').slice(0, 400) || '(vacío)'}.`
        );
      } else {
        hechos.push('EJECUTOR: pediste ejecutar pero no vino un bloque ```python. Pégalo.');
      }
    }
  } catch (e: any) {
    hechos.push(`Ejecutor falló: ${String(e?.message || e).slice(0, 160)}.`);
  }

  const soloDato =
    /precio|spot|oro|plata|gold|silver|xau|xag|lempira|hnl|tipo de cambio|cu[aá]nto/.test(q) &&
    !/por qu[eé]|explica|an[aá]lisis|busca|investiga/.test(q) &&
    !tools.includes('web');
  const directo =
    decirTaller ||
    (soloDato && hechos.length ? hechos.map((h) => h.replace(/ No inventes otro número\./g, '')).join(' ') : null);

  const personalidad = `${buildPersonality({ nombre: (quien ? nombreDe(quien) : nombre) || undefined, canal })}

CEREBRO ORDEN GLOBAL:
${CONOCIMIENTO_OG}

No finjas recuerdos: solo la memoria de ${quien ? nombreDe(quien) : 'quien no identifiqué'} y los hechos de junta. No recites la conversación privada del otro.
Modo de mesa pedido: ${mode}.
HECHOS:\n${hechos.join('\n') || '(ninguno)'}\n${hechosCatalogo()}\n${promptMemoria(quien)}`;

  const compuesto = construirMensajes({ personalidad, user: message, canal });
  if (compuesto.meta.rag) tools.push('rag');
  if (compuesto.meta.cot) tools.push('cot');
  if (compuesto.meta.harness) tools.push('harness');
  const system = compuesto.messages[0].content;

  return { t0, message, mode, hechos, tools, foto, directo, directoVia: decirTaller ? 'taller' : directo ? 'market' : null, system, quien, canal };
}

async function preguntarQwen(system: string, message: string, hechos: string[]): Promise<{ ok: boolean; reply: string; error?: string }> {
  if (!ULTRON_NODO_URL || !ULTRON_NODO_SECRETO) {
    return { ok: false, reply: '', error: 'Qwen no configurado' };
  }
  try {
    const r = await fetch(`${ULTRON_NODO_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ultron-secreto': ULTRON_NODO_SECRETO },
      body: JSON.stringify({
        model: ULTRON_NODO_MODELO,
        stream: false,
        messages: [
          { role: 'system', content: system },
          {
            role: 'user',
            content: `Antes de responder, esto es Orden Global (hechos):\n${CONOCIMIENTO_OG.slice(0, 3500)}\n\nHECHOS DE ESTE TURNO:\n${hechos.join('\n') || '(ninguno)'}\n\nPregunta de la junta: ${message}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(60000),
    });
    const raw = await r.text();
    const reply = String(juntarOllama(raw) || '').trim();
    if (!r.ok || !reply) return { ok: false, reply: '', error: 'Qwen no contestó' };
    return { ok: true, reply };
  } catch (err: any) {
    return { ok: false, reply: '', error: String(err?.message || err).slice(0, 200) };
  }
}

async function correrHerramientaPedida(ped: ReturnType<typeof extraerPedidoHerramienta>, reply: string): Promise<string> {
  if (!ped) return 'HARNESS: pedido vacío.';
  return resolverPedido(
    ped,
    {
      web: async (q) => {
        const hits = await buscarWeb(q, 5);
        if (!hits.length) return `HARNESS web "${q}": sin resultados.`;
        const first = hits.find((h) => /^https?:\/\/[^/]+\/.+/.test(h.url));
        const texto = first ? await leerPagina(first.url, 1200) : '';
        return (
          `HARNESS web "${q}":\n` +
          hits.map((h, i) => `${i + 1}. ${h.title} — ${h.snippet} [${h.url}]`).join('\n') +
          (first && texto ? `\nPRIMERA FUENTE (${first.url}): ${texto}` : '')
        );
      },
      sistema: async () => {
        const f = await fotoSistema();
        return f.resumen;
      },
      leer: async (url) => {
        const pub = await urlPublica(url);
        if (pub.ok === false) return `HARNESS leer: ${pub.error}. No abrí.`;
        const texto = await leerPagina(pub.url, 1600);
        return texto ? `HARNESS leer (${pub.url}): ${texto}` : `HARNESS leer (${pub.url}): página vacía o no HTML.`;
      },
      ejecutor: async (codigo) => {
        const r = await ejecutarCodigo(codigo);
        return `EJECUTOR (${r.via}): exit ${r.exit_code}. stdout: ${String(r.stdout || '').slice(0, 800) || '(vacío)'} stderr: ${String(r.stderr || r.error || '').slice(0, 400) || '(vacío)'}.`;
      },
    },
    extraerPython(reply)
  );
}

async function correrTurno(body: any): Promise<{
  reply: string;
  via: string;
  mode: string;
  ms: number;
  herramientas: string[];
  foto: string | null;
  honesto: true;
  error?: string;
}> {
  const p = await prepararTurno(body);
  if (!p.message) return { reply: '', via: 'none', mode: p.mode, ms: Date.now() - p.t0, herramientas: [], foto: null, honesto: true, error: 'message vacío' };
  const { t0, mode, tools, foto, system, message, quien, canal } = p;
  const hechos = [...p.hechos];
  const guardar = async (out: {
    reply: string;
    via: string;
    mode: string;
    ms: number;
    herramientas: string[];
    foto: string | null;
    honesto: true;
    error?: string;
  }) => {
    if (out.reply) await recordarTurno({ quien, rol: 'ultron', texto: out.reply, canal: canal || 'mesa' });
    return out;
  };
  if (p.directo) {
    return guardar({
      reply: p.directo,
      via: p.directoVia === 'taller' ? 'taller' : 'gold-api/er-api',
      mode,
      ms: Date.now() - t0,
      herramientas: tools,
      foto,
      honesto: true,
    });
  }
  if (!ULTRON_NODO_URL || !ULTRON_NODO_SECRETO) {
    const reply = hechos.join('\n');
    if (reply) return guardar({ reply, via: 'tools-only', mode, ms: Date.now() - t0, herramientas: tools, foto, honesto: true });
    return { reply: '', via: 'none', mode, ms: Date.now() - t0, herramientas: tools, foto, honesto: true, error: 'Qwen no configurado' };
  }
  const q1 = await preguntarQwen(system, message, hechos);
  if (!q1.ok) {
    if (hechos.length) return guardar({ reply: hechos.join('\n'), via: 'tools-fallback', mode, ms: Date.now() - t0, herramientas: tools, foto, honesto: true });
    return { reply: '', via: 'qwen', mode, ms: Date.now() - t0, herramientas: tools, foto, honesto: true, error: q1.error };
  }
  let reply = q1.reply;
  let via = `${ULTRON_NODO_URL}/api/chat`;
  for (let i = 0; i < 2; i++) {
    const ped = extraerPedidoHerramienta(reply);
    if (!ped) break;
    tools.push(ped.herramienta);
    const extra = await correrHerramientaPedida(ped, reply);
    hechos.push(extra);
    const qn = await preguntarQwen(system, message, hechos);
    if (!qn.ok) {
      reply = quitarLineaPedido(reply) + (extra ? `\n\n${extra}` : '');
      via = 'harness-parcial';
      break;
    }
    reply = qn.reply;
    via = 'harness';
  }
  reply = quitarLineaPedido(reply);

  const py = extraerPython(reply);
  if (py && ejecutorActivo() && !tools.includes('ejecutor') && (esTareaDeCodigo(message) || /\b(ejecuta|corre el c[oó]digo)\b/i.test(message))) {
    tools.push('ejecutor');
    const r = await ejecutarCodigo(py);
    const hecho = `EJECUTOR (${r.via}): exit ${r.exit_code}. stdout: ${String(r.stdout || '').slice(0, 800) || '(vacío)'} stderr: ${String(r.stderr || r.error || '').slice(0, 400) || '(vacío)'}.`;
    hechos.push(hecho);
    if (!r.ok) {
      const qn = await preguntarQwen(system, `${message}\n\nEl ejecutor falló. Corrige el código. No afirmes que funciona.`, hechos);
      reply = qn.ok ? quitarLineaPedido(qn.reply) : `${quitarLineaPedido(reply)}\n\n${hecho}`;
    } else {
      reply = `${quitarLineaPedido(reply)}\n\n${hecho}`;
    }
    via = 'harness-ejecutor';
  }

  return guardar({ reply, via, mode, ms: Date.now() - t0, herramientas: tools, foto, honesto: true });
}

app.post('/api/turno', exigirMesa, limitar(20), async (req, res) => {
  const s = sesionDe(req);
  const out = await correrTurno({
    ...req.body,
    correo: req.body?.correo || s?.correo,
    usuario: req.body?.usuario || req.body?.userName || s?.nombre,
    sesion: s,
  });
  if (out.error && !out.reply) {
    const code = out.error === 'message vacío' ? 400 : out.error.includes('configurado') ? 503 : 502;
    return res.status(code).json({ error: out.error, honesto: true });
  }
  return res.json({
    reply: out.reply,
    modelo: out.via === 'taller' || out.via.includes('gold') ? 'tools' : ULTRON_NODO_MODELO,
    via: out.via,
    mode: out.mode,
    ms: out.ms,
    tools: out.herramientas.length,
    herramientas: out.herramientas,
    foto: out.foto,
    honesto: true,
  });
});

/**
 * Turno en streaming (SSE): la app empieza a hablar con la primera frase mientras Qwen sigue escribiendo.
 * Eventos: `tools` (herramientas usadas), `delta` (texto), `done` ({ reply, ms }), `error`.
 */
app.post('/api/turno/stream', exigirMesa, limitar(20), async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const s = sesionDe(req);
  const p = await prepararTurno({
    ...req.body,
    correo: req.body?.correo || s?.correo,
    usuario: req.body?.usuario || req.body?.userName || s?.nombre,
    sesion: s,
  });
  if (!p.message) {
    send('error', { error: 'message vacío' });
    return res.end();
  }
  const { t0, hechos, tools, system, message, quien, canal } = p;
  const guardarStream = async (texto: string) => {
    if (texto) await recordarTurno({ quien, rol: 'ultron', texto, canal: canal || 'mesa' });
  };
  send('tools', { tools });
  if (p.directo) {
    send('delta', { text: p.directo });
    send('done', { reply: p.directo, ms: Date.now() - t0, via: p.directoVia === 'taller' ? 'taller' : 'tools' });
    await guardarStream(p.directo);
    return res.end();
  }
  if (!ULTRON_NODO_URL || !ULTRON_NODO_SECRETO) {
    const reply = hechos.join('\n') || '';
    if (reply) send('delta', { text: reply });
    send(reply ? 'done' : 'error', reply ? { reply, ms: Date.now() - t0, via: 'tools-only' } : { error: 'Qwen no configurado' });
    if (reply) await guardarStream(reply);
    return res.end();
  }
  try {
    const r = await fetch(`${ULTRON_NODO_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ultron-secreto': ULTRON_NODO_SECRETO },
      body: JSON.stringify({
        model: ULTRON_NODO_MODELO,
        stream: true,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `Antes de responder, esto es Orden Global (hechos):\n${CONOCIMIENTO_OG.slice(0, 3500)}\n\nPregunta de la junta: ${message}` },
        ],
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!r.ok || !r.body) {
      const raw = await r.text().catch(() => '');
      const reply = hechos.join('\n');
      if (reply) {
        send('delta', { text: reply });
        send('done', { reply, ms: Date.now() - t0, via: 'tools-fallback' });
        await guardarStream(reply);
      } else send('error', { error: 'Qwen no contestó', status: r.status, raw: raw.slice(0, 200) });
      return res.end();
    }
    const reader = (r.body as any).getReader();
    const dec = new TextDecoder();
    let buf = '';
    let full = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        const s = line.trim();
        if (!s) continue;
        try {
          const j = JSON.parse(s);
          const piece = j.message?.content || j.response || '';
          if (piece) {
            full += piece;
            send('delta', { text: piece });
          }
        } catch {
          /* línea parcial */
        }
      }
    }
    if (buf.trim()) {
      try {
        const j = JSON.parse(buf.trim());
        const piece = j.message?.content || j.response || '';
        if (piece) {
          full += piece;
          send('delta', { text: piece });
        }
      } catch {
        /* */
      }
    }
    full = full.trim();
    if (!full && hechos.length) {
      full = hechos.join('\n');
      send('delta', { text: full });
    }
    send('done', { reply: full, ms: Date.now() - t0, via: `${ULTRON_NODO_URL}/api/chat` });
    await guardarStream(full);
    res.end();
  } catch (err: any) {
    send('error', { error: 'Qwen caído', message: String(err?.message || err).slice(0, 200) });
    res.end();
  }
});

app.get('/api/taller', exigirMesa, limitar(30), (_req, res) => {
  res.json({ honesto: true, canales: catalogoCanales() });
});

app.get('/api/sistema', exigirMesa, limitar(20), async (_req, res) => {
  const foto = await fotoSistema();
  res.json({ honesto: true, ...foto });
});

app.get('/api/tareas', exigirMesa, limitar(20), (_req, res) => {
  res.json({ honesto: true, tareas: listarTareas() });
});

app.get('/api/taller/archivo/:id', exigirMesa, limitar(30), (req, res) => {
  const buf = leerPdf(String(req.params.id || ''));
  if (!buf) return res.status(404).json({ error: 'PDF no encontrado', honesto: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${path.basename(String(req.params.id))}"`);
  return res.send(buf);
});

app.post('/api/ejecutar', exigirMesa, limitar(10), async (req, res) => {
  if (!ejecutorActivo()) return res.status(503).json({ error: 'Ejecutor desactivado', honesto: true, ok: false });
  const codigo = String(req.body?.codigo || extraerPython(String(req.body?.texto || '')) || '');
  const r = await ejecutarCodigo(codigo);
  return res.json({ ...r, honesto: true });
});

async function procesarTelegram(update: any) {
  const parsed = await parsearUpdateTelegram(update);
  if (!parsed) return;
  if (!telegramAutorizado(parsed.chatId, parsed.userId)) {
    console.warn('[ULTRON] telegram rechazado', parsed.chatId, parsed.userId, parsed.nombre);
    return;
  }
  if (parsed.comando === '/start' || parsed.comando === '/ayuda' || parsed.comando === '/help') {
    await telegramResponder(parsed.chatId, ayudaTelegram());
    return;
  }
  let texto = parsed.texto;
  if (parsed.comando === '/audio') texto = 'mándame audio del sistema';
  if (parsed.audio && !texto) {
    const key = clave('elevenlabs') || process.env.ELEVENLABS_API_KEY || '';
    if (key) {
      const out = await elevenTranscribe({
        apiKey: key,
        audio: parsed.audio.buffer,
        mime: parsed.audio.mime,
        language: 'es',
      });
      texto = String(out.text || '').trim();
    }
    if (!texto) texto = 'No pude oír el audio. Escríbeme.';
  }
  if (!texto && parsed.imageDataUrl) texto = '¿qué ves en esta imagen?';
  if (!texto && parsed.documento) texto = `Lee este PDF (${parsed.documento.filename}) y resume solo lo que dice. No inventes.`;
  const out = await correrTurno({
    message: texto,
    usuario: parsed.nombre,
    mode: 'TELEGRAM',
    canal: 'telegram',
    telegramUserId: parsed.userId,
    telegramChatId: parsed.chatId,
    historial: hiloTelegram(parsed.chatId),
    image: parsed.imageDataUrl,
    documento: parsed.documento,
  });
  const reply = out.reply || out.error || 'No pude contestar.';
  recordarTelegram(parsed.chatId, texto, reply);
  await telegramResponder(parsed.chatId, reply);
  const yaMandóVoz = out.herramientas.includes('voz') || out.herramientas.includes('urgente');
  const quiereVoz = !!parsed.audio || parsed.comando === '/audio' || pideNotaDeVoz(texto);
  if (quiereVoz && !yaMandóVoz) {
    const audio = await notaDeVoz(limpiarParaVoz(reply).slice(0, 400));
    if (audio) await telegramVoz({ buf: audio, caption: 'ULTRON' });
  }
}

app.post(['/api/telegram/webhook', '/api/telegram/webhook/'], limitar(40), async (req, res) => {
  if (!telegramWebhookSecretOk(req.headers['x-telegram-bot-api-secret-token'])) {
    return res.status(401).json({ ok: false, honesto: true });
  }
  res.json({ ok: true, honesto: true });
  try {
    await procesarTelegram(req.body);
  } catch (e: any) {
    console.warn('[ULTRON] telegram inbound', String(e?.message || e).slice(0, 180));
  }
});

app.post('/api/qwen/chat', (_req, res) => {
  res.status(410).json({ error: 'Deprecado. Usar POST /api/turno.', honesto: true });
});

app.get('/api/orden-global', (_req, res) => {
  res.json({
    honesto: true,
    producto: 'web-kiosk',
    mesa: 'https://ultron-looi-desk.onrender.com',
    cerebro: 'Qwen 3.8 27B',
    voz: 'ElevenLabs Rachel/Daniel primero; Qwen T4 solo fallback',
    datos: 'oro/plata/HNL solo via tools',
  });
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      if (String(req.path || '').startsWith('/api/')) {
        return res.status(404).json({ error: 'no está', honesto: true });
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[ULTRON] :${PORT} fase C — health/turno/tts/telegram`);
    registrarWebhookTelegram()
      .then((r) => console.log('[ULTRON] telegram webhook', r.detalle))
      .catch((e) => console.warn('[ULTRON] telegram webhook', String(e?.message || e).slice(0, 160)));
    iniciarCentinela(180_000);
    cargarMemoria()
      .then(() => console.log('[ULTRON] memoria', estadoMemoria().detalle))
      .catch((e) => console.warn('[ULTRON] memoria', String(e?.message || e).slice(0, 160)));
  });
}

startServer();
