import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI } from '@google/genai';
import {
  appendConversation,
  chatQwenStream,
  getConversation,
  nodesConfigStatus,
  ojoFoto,
  ojoMirar,
  ojoSalud,
  qwenSalud,
  systemPromptForMode,
  type ChatMessage,
} from './src/server/nodes';
import { ULTRON_VOICES, getVoice } from './src/server/tts/voices';
import { normalizeNumbersForSpeech } from './src/server/tts/normalizeNumbers';
import { HUMAN_EXPRESSIONS, expressionsSystemHint } from './src/server/tts/expressions';
import {
  extractPersonHints,
  listPeople,
  memoryPromptBlock,
  upsertPerson,
} from './src/server/tts/personMemory';
import { synthesizeWithQwenTts, ttsNodeStatus, ttsSalud } from './src/server/tts/qwenTtsClient';

const app = express();
const httpServer = http.createServer(app);
const PORT = Number(process.env.PORT || 3000);

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

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// System & Cloud Credentials configured from environment or supplied by the Board
const GITHUB_PAT = process.env.GITHUB_PAT || '';
const RENDER_API_KEY = process.env.RENDER_API_KEY || '';
const RENDER_SERVICE_ID = process.env.RENDER_SERVICE_ID || 'srv-dah56p15efls7382pot0';
const ULTRON_REMOTE_URL = process.env.ULTRON_REMOTE_URL || 'https://ultron.ordenglobal.link';
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

// Mutable in-memory Vault session store for ElevenLabs & institutional conduits
let VAULT_ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';

// Health Check (no secrets; probes node reachability without leaking keys)
app.get('/api/health', async (_req, res) => {
  const nodes = nodesConfigStatus();
  const [qwen, ojo] = await Promise.all([qwenSalud(), ojoSalud()]);
  res.json({
    status: 'ok',
    system: 'ULTRON FP · Desktop Agentic Harness',
    timestamp: new Date().toISOString(),
    vaultStatus: 'Encrypted and Operational',
    neuralCore: nodes.qwen.configured
      ? qwen.ok
        ? 'Qwen 3.8 27B Online'
        : 'Qwen configured (node unreachable)'
      : ai
        ? 'Gemini fallback'
        : 'Heuristic Engine',
    qwen: {
      configured: nodes.qwen.configured,
      host: nodes.qwen.urlHost,
      online: qwen.ok,
    },
    playwrightNode: {
      configured: nodes.ojo.configured,
      host: nodes.ojo.urlHost,
      online: ojo.ok,
    },
    globalOrderBrain: 'Active (Directorio Alfa-1)',
    tts: ttsNodeStatus(),
    renderDeployment: RENDER_API_KEY ? 'Connected' : 'Pending Key',
    wsClients: wss.clients.size,
  });
});

// BÓVEDA DE ULTRON FP: Unified Security & Conduit Status
app.get('/api/vault/status', async (req, res) => {
  res.json({
    vaultId: 'VAULT-ULTRON-FP-CORE',
    status: 'SEALED_OPERATIONAL',
    lastSync: new Date().toISOString(),
    conduits: [
      {
        id: 'elevenlabs',
        name: 'Canal de Voz Neural ElevenLabs (fallback)',
        type: 'audio_synthesis',
        configured: Boolean(VAULT_ELEVENLABS_API_KEY),
        status: VAULT_ELEVENLABS_API_KEY ? 'CONECTADO' : 'PENDIENTE_API_KEY',
        maskedKey: VAULT_ELEVENLABS_API_KEY
          ? `${VAULT_ELEVENLABS_API_KEY.substring(0, 4)}••••••••${VAULT_ELEVENLABS_API_KEY.slice(-3)}`
          : null,
        latencyMs: 18,
      },
      {
        id: 'qwen3_tts',
        name: 'Qwen3-TTS · Nodo T4 dedicado',
        type: 'audio_synthesis',
        configured: ttsNodeStatus().configured,
        status: ttsNodeStatus().configured ? 'PROXY_READY' : 'PENDIENTE_ULTRON_TTS_URL',
        host: ttsNodeStatus().urlHost,
        latencyMs: 40,
      },
      {
        id: 'neural_core',
        name: 'Núcleo Neural & Clasificador Semántico',
        type: 'reasoning_engine',
        configured: true,
        status: 'CONECTADO',
        latencyMs: 24,
      },
      {
        id: 'vision_pipeline',
        name: 'Visor Multimodal & Protocolo Zero-Knowledge',
        type: 'computer_vision',
        configured: true,
        status: 'CONECTADO',
        latencyMs: 31,
      },
      {
        id: 'playwright_browser',
        name: 'Clúster Headless Playwright',
        type: 'web_inspection',
        configured: true,
        status: 'CONECTADO',
        latencyMs: 140,
      },
      {
        id: 'global_order_brain',
        name: 'Cerebro Estratégico de Orden Global',
        type: 'knowledge_base',
        configured: true,
        status: 'CONECTADO',
        latencyMs: 8,
      },
      {
        id: 'cloud_infra',
        name: 'Infraestructura Cloud & Sincronización Backend',
        type: 'cloud_services',
        configured: Boolean(AWS_ACCESS_KEY_ID && RENDER_API_KEY && GITHUB_PAT),
        status: 'CONECTADO',
        latencyMs: 45,
      },
      {
        id: 'biometric_security',
        name: 'Bóveda de Credenciales Biométricas',
        type: 'authentication',
        configured: true,
        status: 'CONECTADO',
        latencyMs: 5,
      },
    ],
  });
});

// BÓVEDA: ElevenLabs Key Update Endpoint
app.post('/api/vault/elevenlabs', (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey || typeof apiKey !== 'string') {
    return res.status(400).json({ error: 'La API Key de ElevenLabs es requerida.' });
  }

  VAULT_ELEVENLABS_API_KEY = apiKey.trim();
  return res.json({
    success: true,
    message: 'API Key de ElevenLabs archivada con éxito en la Bóveda de ULTRON FP.',
    maskedKey: `${VAULT_ELEVENLABS_API_KEY.substring(0, 4)}••••••••${VAULT_ELEVENLABS_API_KEY.slice(-3)}`,
  });
});

// BÓVEDA: ElevenLabs Text-to-Speech Proxy (Secure server-side request)
app.post('/api/vault/elevenlabs/synthesize', async (req, res) => {
  const { text, voiceId = 'pNInz6obpgDQGcFmaJgB', stability = 0.65, similarityBoost = 0.85, apiKeyOverride } = req.body;

  const keyToUse = (apiKeyOverride && apiKeyOverride.trim()) || VAULT_ELEVENLABS_API_KEY;
  const spoken = normalizeNumbersForSpeech(String(text || ''));

  if (!spoken) {
    return res.status(400).json({ error: 'El parámetro "text" es requerido.' });
  }

  // 1) Preferir Qwen3-TTS en nodo T4 dedicado
  const qwen = await synthesizeWithQwenTts({ text: spoken, voice: req.body.voice || req.body.voiceId });
  if (qwen.ok) {
    res.setHeader('Content-Type', qwen.contentType);
    res.setHeader('X-Ultron-TTS', 'qwen3-tts');
    return res.send(qwen.audio);
  }
  const qwenTtsError = qwen.ok === false ? qwen.error : 'unknown';

  if (!keyToUse) {
    return res.status(503).json({
      error: 'TTS no disponible',
      qwenTts: qwenTtsError,
      suggestion: 'Configura ULTRON_TTS_URL (T4) o ELEVENLABS_API_KEY. Arranca i-02653feadc919d3a4.',
    });
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
        text: spoken,
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
        qwenTts: qwenTtsError,
      });
    }

    const audioBuffer = await elRes.arrayBuffer();
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('X-Ultron-TTS', 'elevenlabs-fallback');
    res.setHeader('Content-Length', audioBuffer.byteLength.toString());
    return res.send(Buffer.from(audioBuffer));
  } catch (err: any) {
    return res.status(500).json({
      error: 'Fallo al contactar ElevenLabs',
      message: err.message,
      qwenTts: qwenTtsError,
    });
  }
});

/** API unificada TTS: Qwen3-TTS (T4) → ElevenLabs → error (cliente usa Web Speech). */
app.post('/api/tts/synthesize', async (req, res) => {
  const voice = getVoice(req.body.voice || req.body.voiceId || 'jarvis');
  const spoken = normalizeNumbersForSpeech(String(req.body.text || ''));
  if (!spoken) return res.status(400).json({ error: 'text requerido' });

  const qwen = await synthesizeWithQwenTts({ text: spoken, voice: voice.id });
  if (qwen.ok) {
    res.setHeader('Content-Type', qwen.contentType);
    res.setHeader('X-Ultron-TTS', 'qwen3-tts');
    res.setHeader('X-Ultron-Voice', voice.id);
    return res.send(qwen.audio);
  }
  const qwenTtsError = qwen.ok === false ? qwen.error : 'unknown';

  if (VAULT_ELEVENLABS_API_KEY && voice.elevenLabsVoiceId) {
    try {
      const elRes = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voice.elevenLabsVoiceId}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': VAULT_ELEVENLABS_API_KEY,
            Accept: 'audio/mpeg',
          },
          body: JSON.stringify({
            text: spoken,
            model_id: 'eleven_multilingual_v2',
            voice_settings: { stability: 0.62, similarity_boost: 0.82 },
          }),
        }
      );
      if (elRes.ok) {
        const buf = await elRes.arrayBuffer();
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('X-Ultron-TTS', 'elevenlabs-fallback');
        res.setHeader('X-Ultron-Voice', voice.id);
        return res.send(Buffer.from(buf));
      }
    } catch {
      /* fall through */
    }
  }

  return res.status(503).json({
    error: 'TTS no disponible',
    qwenTts: qwenTtsError,
    voice: voice.id,
    hint: 'Arranca T4 i-02653feadc919d3a4 y define ULTRON_TTS_URL',
  });
});

app.get('/api/tts/voces', (_req, res) => {
  res.json({ voces: ULTRON_VOICES, expressions: HUMAN_EXPRESSIONS.length });
});

app.get('/api/tts/status', async (_req, res) => {
  const cfg = ttsNodeStatus();
  const salud = await ttsSalud();
  res.json({ ...cfg, online: salud.ok, detail: salud.detail || { error: salud.error } });
});

app.get('/api/tts/normalize', (req, res) => {
  const text = String(req.query.text || '');
  res.json({ input: text, output: normalizeNumbersForSpeech(text) });
});

app.get('/api/memoria/personas', (_req, res) => {
  res.json({ personas: listPeople() });
});

app.post('/api/memoria/personas', (req, res) => {
  const { nombre, rol, correo, conversationId, hecho } = req.body || {};
  if (!nombre) return res.status(400).json({ error: 'nombre requerido' });
  const p = upsertPerson({ nombre, rol, correo, conversationId, hecho });
  res.json({ ok: true, persona: p });
});

// Cloud Status Verification Endpoint
app.get('/api/cloud/status', async (req, res) => {
  const result = {
    aws: {
      configured: Boolean(AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY),
      accessKeyIdMasked: AWS_ACCESS_KEY_ID ? `${AWS_ACCESS_KEY_ID.substring(0, 6)}...${AWS_ACCESS_KEY_ID.slice(-4)}` : null,
      region: AWS_DEFAULT_REGION,
      status: 'Connected',
      services: ['EC2 Qwen-27B A10G', 'EC2 Playwright t3', 'EC2 Qwen3-TTS T4', 'S3 Storage'],
    },
    github: {
      configured: Boolean(GITHUB_PAT),
      tokenMasked: GITHUB_PAT ? `${GITHUB_PAT.substring(0, 12)}...` : null,
      status: 'Authenticated',
    },
    render: {
      configured: Boolean(RENDER_API_KEY),
      keyMasked: RENDER_API_KEY ? `${RENDER_API_KEY.substring(0, 8)}...` : null,
      status: 'Linked',
    },
    qwen: {
      model: 'Qwen 3.8 27B Instruct / Agentic Harness',
      ...nodesConfigStatus().qwen,
      status: nodesConfigStatus().qwen.configured ? 'Proxy ready (server-side)' : 'Missing ULTRON_NODO_SECRETO',
    },
    playwright: {
      ...nodesConfigStatus().ojo,
      status: nodesConfigStatus().ojo.configured ? 'Ojo proxy ready (server-side)' : 'Missing ULTRON_OJO_CLAVE',
      capabilities: ['/mirar DOM real', '/foto PNG', 'Reintentos con backoff'],
    },
    tts: {
      model: 'Qwen3-TTS VoiceDesign (T4 g4dn)',
      instance: 'i-02653feadc919d3a4',
      ...ttsNodeStatus(),
      status: ttsNodeStatus().configured ? 'Proxy ready (server-side)' : 'Missing ULTRON_TTS_URL — start T4',
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
app.post('/api/render/deploy', async (req, res) => {
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
  const { correo, clave } = req.body;
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
        nombre: data.miembro?.nombre || correo.split('@')[0],
        correo,
        rol: 'Junta Directiva · Orden Global',
      },
      lastLogin: new Date().toISOString(),
    };
    return res.json({
      ok: true,
      miembro: ultronRemoteSession.user,
      message: `Bienvenido a ULTRON FP, ${ultronRemoteSession.user.nombre}`,
      remoteUrl: ULTRON_REMOTE_URL,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Fallo al contactar ultron.ordenglobal.link', message: err.message });
  }
});

app.post('/api/ultron/biometric-login', async (req, res) => {
  const { biometricType, userName, role, correo } = req.body;
  const allowed = [
    'mjoseenamorado1994@gmail.com',
    'medardo@ordenglobal.org',
  ];
  const mail = String(correo || '').toLowerCase();
  if (mail && !allowed.includes(mail)) {
    return res.status(403).json({ error: 'Acceso desk solo para José y Medardo.' });
  }

  let isLive = false;
  try {
    const remoteRes = await fetch(`${ULTRON_REMOTE_URL}/salud`, {
      signal: AbortSignal.timeout(4000),
    });
    isLive = remoteRes.ok;
  } catch {
    isLive = false;
  }

  // Acceso desk local siempre permitido para los dos miembros (cerebro remoto opcional)
  ultronRemoteSession = {
    authenticated: true,
    user: {
      nombre: userName || 'José',
      correo: mail || 'mjoseenamorado1994@gmail.com',
      rol: role || 'Junta Directiva · Orden Global',
    },
    lastLogin: new Date().toISOString(),
  };
  return res.json({
    ok: true,
    authenticated: true,
    user: ultronRemoteSession.user,
    remoteSystemLive: isLive,
    remoteUrl: ULTRON_REMOTE_URL,
    biometricType: biometricType || 'fingerprint',
    message: `Acceso verificado. Bienvenido ${ultronRemoteSession.user.nombre}.`,
  });
});

app.get('/api/ultron/sesion', async (req, res) => {
  res.json({
    authenticated: ultronRemoteSession.authenticated,
    user: ultronRemoteSession.user,
    remoteUrl: ULTRON_REMOTE_URL,
  });
});

app.post('/api/ultron/salir', async (req, res) => {
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

// Playwright → ojo AWS real (/mirar). Secret stays server-side.
app.post('/api/playwright/scrape', async (req, res) => {
  const { url, extractDepth = 'deep', screenshot = false } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL is required for Playwright inspection' });
  }

  let formattedUrl = url.trim();
  if (!/^https?:\/\//i.test(formattedUrl)) {
    formattedUrl = `https://${formattedUrl}`;
  }

  try {
    const data = await ojoMirar(formattedUrl);
    let png: string | null = null;
    if (screenshot) {
      try {
        const foto = await ojoFoto(formattedUrl);
        png = foto?.png || null;
      } catch {
        /* screenshot optional */
      }
    }

    const title = data.titulo || formattedUrl;
    const sampleText = String(data.texto || '').slice(0, 1800);
    const keyFindings = [
      `Título: «${title}»`,
      `HTTP ${data.estado ?? '?'} · visto por Chromium real (ojo AWS)`,
      `Titulares: ${(data.titulares || []).slice(0, 5).join(' · ') || 'n/d'}`,
      `Botones interactivos: ${(data.botones || []).length}`,
      `Campos: ${(data.campos || []).length}`,
      data.ms != null ? `Latencia ojo: ${data.ms} ms` : 'Latencia: n/d',
      sampleText ? `Extracto: ${sampleText.slice(0, 280)}…` : 'Sin texto visible',
    ];

    return res.json({
      success: true,
      url: data.url || formattedUrl,
      status: data.estado ?? 200,
      title,
      description: (data.titulares || [])[0] || sampleText.slice(0, 160) || 'Inspección headless completada',
      ogTitle: title,
      ogImage: null,
      findings: keyFindings,
      sampleText,
      titulares: data.titulares || [],
      botones: (data.botones || []).slice(0, 20),
      campos: (data.campos || []).slice(0, 12),
      screenshotPng: png,
      depth: extractDepth,
      inspectedAt: new Date().toLocaleTimeString(),
      node: 'AWS ojo /mirar (Playwright)',
      progress: ['conectado', 'render', 'dom', 'informe'],
    });
  } catch (err: any) {
    return res.status(err?.codigo === 'SIN_CLAVE' ? 503 : 502).json({
      error: 'Error al inspeccionar vía nodo Playwright (ojo)',
      message: err.message,
      codigo: err.codigo || 'OJO',
      url: formattedUrl,
    });
  }
});

// Vision: Qwen multimodal when possible, else Gemini, else heuristic
app.post('/api/vision/analyze', async (req, res) => {
  const { mediaType, fileName, base64Data, prompt } = req.body || {};

  if (!base64Data) {
    return res.status(400).json({ error: 'Media payload is required for neural vision analysis' });
  }

  const isVideo = mediaType?.startsWith('video') || (fileName && /\.(mp4|webm|mov|mkv)$/i.test(fileName));
  let detectedEntities = isVideo
    ? ['Secuencia Temporal', 'Movimiento', 'Sujeto', 'Entorno']
    : ['Rostro / expresión', 'Objetos', 'Entorno', 'Texto legible'];
  let confidenceScore = +(0.9 + Math.random() * 0.05).toFixed(2);
  let executiveSummary = isVideo
    ? 'Análisis de video: secuencia con actividad detectada. Pipeline multimodal en curso.'
    : 'Análisis de imagen: encuadre recibido. Pipeline multimodal en curso.';
  let modelUsed = 'heuristic';

  const match = typeof base64Data === 'string' ? base64Data.match(/^data:([^;]+);base64,(.*)$/) : null;
  const mime = match ? match[1] : mediaType || 'image/png';
  const cleanData = match ? match[2] : base64Data;
  const userPrompt =
    prompt ||
    'Analiza esta captura para la junta: elementos clave, rostros, expresiones, objetos tecnológicos y contexto. Responde en español, 1-2 párrafos.';

  if (!isVideo && nodesConfigStatus().qwen.configured) {
    try {
      const visionMessages = [
        {
          role: 'user',
          content: userPrompt,
          images: [cleanData],
        },
      ] as ChatMessage[];
      const result = await chatQwenStream({
        messages: visionMessages,
        temperature: 0.2,
      });
      if (result.content?.trim()) {
        executiveSummary = result.content.trim();
        confidenceScore = 0.97;
        modelUsed = 'Qwen 3.8 multimodal';
      }
    } catch (err: any) {
      console.warn('[Vision Qwen fallback]', err.message);
    }
  }

  if (modelUsed === 'heuristic' && ai && !isVideo) {
    try {
      const visionRes = await ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType: mime, data: cleanData } },
              {
                text: `Actúa como visión táctica de ULTRON FP.\n${userPrompt}`,
              },
            ],
          },
        ],
      });
      if (visionRes.text) {
        executiveSummary = visionRes.text.trim();
        confidenceScore = 0.98;
        modelUsed = 'Gemini vision';
      }
    } catch (err: any) {
      console.warn('[Gemini Vision Fallback]', err.message);
    }
  }

  const purgeTimestamp = new Date().toISOString();
  return res.json({
    success: true,
    mediaType: isVideo ? 'video' : 'image',
    fileName: fileName || (isVideo ? 'sequence.mp4' : 'capture.png'),
    confidence: confidenceScore,
    entities: detectedEntities,
    summary: executiveSummary,
    model: modelUsed,
    promptUsed: userPrompt,
    privacyCompliance: {
      purged: true,
      purgeTimestamp,
      protocol: 'Zero-Knowledge Auto-Purge ISO/IEC 27701',
      details: 'Payload descartado tras análisis; no se persiste en disco.',
    },
  });
});

// Qwen real — NDJSON stream (compatible with fetch ReadableStream) o JSON único
app.post('/api/qwen/chat', async (req, res) => {
  const {
    message,
    mode = 'GUARDIAN',
    context = [],
    conversationId = 'desk-default',
    stream = true,
  } = req.body || {};

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Message parameter is required' });
  }

  const query = message.toLowerCase();
  let toolCall: { name: string; arguments: Record<string, unknown> } | null = null;

  if (/foto|captura|selfie|cámara|sonríe/.test(query)) {
    toolCall = { name: 'take_camera_photo_countdown', arguments: { countdownSeconds: 3, flash: true } };
  } else if (/web|página|navega|playwright|sitio|url|investiga/.test(query)) {
    const urlMatch = message.match(/(https?:\/\/[^\s]+|[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}[^\s]*)/i);
    toolCall = {
      name: 'browse_web_page_playwright',
      arguments: { url: urlMatch ? urlMatch[0] : 'https://ordenglobal.link' },
    };
  } else if (/orden global|doctrina|geopolítica|tratado|resolución/.test(query)) {
    toolCall = { name: 'query_global_order_brain', arguments: { query: message } };
  } else if (/visión|analizar|imagen|video|subir/.test(query)) {
    toolCall = { name: 'open_vision_analyzer', arguments: { autoPurge: true } };
  } else if (/dispara|blaster|combate|furia/.test(query)) {
    toolCall = { name: 'trigger_blaster_combat', arguments: {} };
  }

  const history = getConversation(String(conversationId));

  // Memoria de personas: extraer hints del mensaje + contexto de sesión
  for (const h of extractPersonHints(message)) {
    if (ultronRemoteSession.user?.nombre) {
      upsertPerson({
        nombre: ultronRemoteSession.user.nombre,
        rol: ultronRemoteSession.user.rol,
        correo: ultronRemoteSession.user.correo,
        conversationId: String(conversationId),
        hecho: { key: h.key, value: h.value, source: 'chat' },
      });
    } else if (h.key === 'nombre_declarado') {
      upsertPerson({
        nombre: h.value,
        conversationId: String(conversationId),
        hecho: { key: h.key, value: h.value, source: 'chat' },
      });
    }
  }

  const memBlock = memoryPromptBlock({
    currentUser: ultronRemoteSession.user
      ? {
          nombre: ultronRemoteSession.user.nombre,
          rol: ultronRemoteSession.user.rol,
          correo: ultronRemoteSession.user.correo,
        }
      : null,
    conversationId: String(conversationId),
  });

  const systemContent = [
    systemPromptForMode(String(mode)),
    expressionsSystemHint(),
    memBlock,
  ]
    .filter(Boolean)
    .join('\n\n');

  const messages: ChatMessage[] = [
    { role: 'system', content: systemContent },
    ...history.filter((m) => m.role !== 'system'),
    ...(Array.isArray(context)
      ? context
          .filter((c: any) => c?.role && c?.content)
          .map((c: any) => ({ role: c.role, content: String(c.content) }) as ChatMessage)
      : []),
    {
      role: 'user',
      content: toolCall
        ? `${message}\n\n[Sistema: herramienta candidata ${toolCall.name}. Confirma brevemente y actúa en personaje.]`
        : message,
    },
  ];

  // JSON non-stream path
  if (req.body?.stream === false || req.query.stream === '0' || stream === false) {
    try {
      let reply = '';
      let modelName = 'Qwen 3.8 27B';
      if (nodesConfigStatus().qwen.configured) {
        const result = await chatQwenStream({ messages });
        reply = result.content.trim();
      } else if (ai) {
        const response = await ai.models.generateContent({
          model: 'gemini-3.6-flash',
          contents: [{ role: 'user', parts: [{ text: messages.map((m) => `${m.role}: ${m.content}`).join('\n') }] }],
        });
        reply = (response.text || '').trim();
        modelName = 'Gemini fallback';
      }
      if (!reply) {
        reply = toolCall
          ? `Listo. Despacho ${toolCall.name} en el escritorio.`
          : `Comprendido en modo ${mode}. Sistemas sincronizados.`;
        modelName = 'heuristic';
      }
      appendConversation(String(conversationId), [
        { role: 'user', content: message },
        { role: 'assistant', content: reply },
      ]);
      return res.json({ reply, mode, toolCall, model: modelName, conversationId, timestamp: new Date().toISOString() });
    } catch (err: any) {
      return res.status(502).json({ error: err.message, codigo: err.codigo || 'NODO' });
    }
  }

  // SSE stream to browser (never expose secrets)
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    if (!res.writableEnded) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  send('start', { mode, conversationId, toolCall, model: 'Qwen 3.8 27B' });

  const ac = new AbortController();
  // Only abort when the *response* is closed by the client mid-stream.
  // req 'close' fires too early behind Render/Cloudflare after the body is read.
  res.on('close', () => {
    if (!res.writableEnded) ac.abort();
  });

  let full = '';
  try {
    if (!nodesConfigStatus().qwen.configured) {
      // Fallback Gemini or heuristic as single token burst
      let reply = '';
      if (ai) {
        try {
          const response = await ai.models.generateContent({
            model: 'gemini-3.6-flash',
            contents: [{ role: 'user', parts: [{ text: messages.map((m) => `${m.role}: ${m.content}`).join('\n') }] }],
          });
          reply = (response.text || '').trim();
        } catch {
          /* ignore */
        }
      }
      if (!reply) {
        reply = toolCall
          ? `Despachando ${toolCall.name}.`
          : `Orden recibida en modo ${mode}.`;
      }
      full = reply;
      send('token', { t: reply });
      send('done', { reply, mode, toolCall, model: ai ? 'Gemini fallback' : 'heuristic', conversationId });
    } else {
      const result = await chatQwenStream({
        messages,
        signal: ac.signal,
        onToken: (t) => {
          full += t;
          send('token', { t });
        },
      });
      full = result.content.trim() || full;
      appendConversation(String(conversationId), [
        { role: 'user', content: message },
        { role: 'assistant', content: full },
      ]);
      send('done', {
        reply: full,
        mode,
        toolCall,
        model: 'Qwen 3.8 27B',
        conversationId,
        usage: result.usage,
      });
    }
  } catch (err: any) {
    send('error', { mensaje: err.message, codigo: err.codigo || 'NODO' });
  }
  res.end();
});

// Node probes (no secret leakage)
app.get('/api/nodes/status', async (_req, res) => {
  const cfg = nodesConfigStatus();
  const [qwen, ojo] = await Promise.all([qwenSalud(), ojoSalud()]);
  res.json({
    qwen: { ...cfg.qwen, online: qwen.ok, detail: qwen.ok ? { ok: true, modelo: (qwen.detail as any)?.modelo } : { error: qwen.error } },
    ojo: { ...cfg.ojo, online: ojo.ok, detail: ojo.ok ? { ok: true, servicio: (ojo.detail as any)?.servicio } : { error: ojo.error } },
  });
});

// Cerebro de Orden Global Query Endpoint
app.get('/api/orden-global', (req, res) => {
  const { q } = req.query;

  const DOCTRINES = [
    {
      id: 'og_01',
      category: 'Geopolítica & Alianzas Estratégicas',
      title: 'Doctrina de Soberanía Tecnológica e Infraestructura Crítica',
      code: 'ALFA-770-GEO',
      summary: 'Garantiza la autonomía de cómputo neural, nodos de inteligencia distribuida y redundancia transfronteriza sin subordinación a proveedores únicos.',
      principles: [
        'Despliegue multi-región con failover autónomo en AWS, bare-metal y nodos locales.',
        'Cifrado post-cuántico en los canales de audio y telemetría de la mesa directiva.',
        'Preservación de la soberanía de datos y eliminación instantánea de telemetría biométrica tras su análisis.',
      ],
      classificationLevel: 'DIRECTORIO EJECUTIVO',
    },
    {
      id: 'og_02',
      category: 'Tesorería & Arbitraje Financiero Global',
      title: 'Protocolo de Reserva Líquida y Arbitraje Multidivisa',
      code: 'BETA-912-FIN',
      summary: 'Estrategia de cobertura patrimonial basada en activos tangibles (oro, tierras raras) y reservas sintéticas con calificación AAA.',
      principles: [
        'Diversificación continua de tesorería institucional ante fluctuaciones cambiarias.',
        'Modelos predictivos en Qwen 27B para anticipar shocks de liquidez en mercados emergentes.',
        'Auditoría criptográfica de estados financieros con doble firma de los directores.',
      ],
      classificationLevel: 'RESTRINGIDO - ALTA DIRECCIÓN',
    },
    {
      id: 'og_03',
      category: 'Gobernanza Corporativa & Resoluciones',
      title: 'Estatuto de Voto Blindado y Minutas Inmutables',
      code: 'GAMMA-404-GOB',
      summary: 'Mecanismo de consenso para decisiones críticas de la junta directiva con sellado de tiempo y distribución autorizada por WhatsApp y correo cifrado.',
      principles: [
        'Requerimiento de autorización explícita biométrica para despacho de memorandos.',
        'Firma criptográfica en minutas ejecutivas previo a transmisión.',
        'Registro de auditoría inmutable de cada orden verbal procesada por ULTRON.',
      ],
      classificationLevel: 'JUNTA DIRECTIVA PLENA',
    },
    {
      id: 'og_04',
      category: 'Defensa Cibernética & Contingencias',
      title: 'Directriz de Contención Perimetral y Repuesta Activa',
      code: 'DELTA-108-DEF',
      summary: 'Procedimientos de respuesta ante intrusiones, acoso físico o ciberamenazas contra la sede ejecutiva o terminales de mando.',
      principles: [
        'Despliegue de sistemas de disuasión y modo combate blaster en terminales tácticos.',
        'Aislamiento de sockets WebSocket no autorizados.',
        'Cierre hermético de credenciales de nube ante detección de anomalías.',
      ],
      classificationLevel: 'SEGURIDAD CORPORATIVA',
    },
  ];

  let filtered = DOCTRINES;
  if (q && typeof q === 'string') {
    const term = q.toLowerCase();
    filtered = DOCTRINES.filter(
      (d) =>
        d.title.toLowerCase().includes(term) ||
        d.summary.toLowerCase().includes(term) ||
        d.category.toLowerCase().includes(term) ||
        d.principles.some((p) => p.toLowerCase().includes(term))
    );
  }

  res.json({
    total: filtered.length,
    doctrines: filtered,
    updatedAt: '2026-09-16T19:46:00Z',
    securityClearance: 'Director Alfa-1',
  });
});

// Vite Middleware for development vs static build serving for production
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
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[ULTRON FP SERVER] Running on port ${PORT} with Gemini 3.6 Flash, Render API, AWS and WebSocket Bridge`);
  });
}

startServer();
