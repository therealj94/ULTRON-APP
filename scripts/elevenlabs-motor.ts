#!/usr/bin/env -S npx tsx
/**
 * EL RECURSO DE PRUEBA DE SPEECH ENGINE (docs/voz/SPEECH-ENGINE.md). NO SE CORRE SIN EL VISTO BUENO DE JOSÉ:
 * con `--crear` crea en ElevenLabs un secreto nuevo («aura-motor») y UN recurso de Speech Engine nuevo, aparte
 * de todo lo que funciona (no toca agentes, voces, números ni bases de conocimiento). Sin `--crear` solo lee el
 * agente de siempre de ese avatar e idioma (GET) e imprime lo que se crearía, con el secreto tapado.
 *
 *   ELEVENLABS_API_KEY=… ULTRON_SESION_SECRETO=… npx tsx scripts/elevenlabs-motor.ts [--avatar aura] [--idioma es] [--url https://aura-fp.onrender.com] [--crear]
 *
 * La voz, el modelo de voz y el modelo de turno se COPIAN del agente de siempre (así la comparación es de la
 * misma voz y el mismo oído; y aquí no se escribe ningún modelo). Lo demás es lo de los agentes
 * (scripts/elevenlabs-agentes.ts): palabras del oído, asentir, turno especulativo y «rápido», el corte a 12 s
 * y la duración de un pase. Lo que Speech Engine no tiene (el relleno de ElevenLabs, el LLM de respaldo) no
 * se pide: el relleno lo dice nuestro servidor (el puente) y el respaldo vive en nuestro cerebro.
 *
 * Imprime el id `seng_…` para ELEVENLABS_SPEECH_ENGINE_<AVATAR>_<IDIOMA> en Render. Nunca la llave ni el secreto.
 */
import { pathToFileURL } from 'node:url';
import { secretoDerivado } from '../server/seguridad';
import { CASCADA_ELEVENLABS_MS, PASE_TTL_MS, agenteDe } from '../server/voz-agente';
import { ETIQUETA_SECRETO_MOTOR, RUTA_MOTOR } from '../server/voz-motor';
import { VOCES_ELEVEN, normalizarAvatar, normalizarIdioma, type AvatarVoz, type Idioma } from '../server/eleven';
import { ASENTIR, PALABRAS_ASR, errorSeguro } from './elevenlabs-agentes';

const API = 'https://api.elevenlabs.io/v1';
const key = () => String(process.env.ELEVENLABS_API_KEY || '').trim();
export const NOMBRE_SECRETO_MOTOR = 'aura-motor';

/** La URL del WebSocket del motor a partir de la del servidor (https → wss). */
export function urlMotor(base: string): string {
  const u = new URL(base);
  if (u.protocol !== 'https:') throw new Error('la URL del servidor tiene que ser https (ElevenLabs entra por wss)');
  return `wss://${u.host}${RUTA_MOTOR}`;
}

/**
 * Lo que se le manda a POST /v1/speech-engine (https://elevenlabs.io/docs/api-reference/speech-engine/create).
 * `agente`: la configuración del agente de siempre (GET /v1/convai/agents/{id}), de donde se copian la voz y
 * los modelos.
 */
export function cuerpoMotor(o: { avatar: AvatarVoz; idioma: Idioma; base: string; secretId: string; agente: any }) {
  const cc = o.agente?.conversation_config || {};
  const tts = cc.tts || {};
  const turn = cc.turn || {};
  return {
    name: `AU-RA FP · prueba Speech Engine (${o.avatar}, ${o.idioma})`,
    speech_engine: {
      ws_url: urlMotor(o.base),
      // La segunda llave (secreto de ElevenLabs) y quién habla (el pase, variable dinámica), como el agente.
      request_headers: { 'X-Aura-Motor': { secret_id: o.secretId }, 'X-Pase': { variable_name: 'pase' } },
    },
    // La primera frase la pide el teléfono (Speech Engine no tiene una propia).
    overrides: { first_message: true },
    language: o.idioma,
    tts: { ...(tts.model_id ? { model_id: tts.model_id } : {}), voice_id: tts.voice_id || VOCES_ELEVEN[o.avatar][o.idioma] },
    asr: { provider: 'scribe_realtime', quality: 'high', keywords: PALABRAS_ASR },
    turn: {
      ...(turn.turn_model ? { turn_model: turn.turn_model } : {}),
      turn_eagerness: turn.turn_eagerness || 'eager',
      speculative_turn: turn.speculative_turn ?? true,
      interruption_ignore_terms: ASENTIR[o.idioma],
      interruption_ignore_term_languages: [o.idioma],
      merge_with_default_ignore_terms: true,
    },
    vad: { background_voice_detection: true },
    conversation: { max_duration_seconds: Math.floor(PASE_TTL_MS / 1000) },
    cascade_timeout_seconds: CASCADA_ELEVENLABS_MS / 1000,
  };
}

async function api(ruta: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`${API}${ruta}`, { ...init, headers: { 'xi-api-key': key(), 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw errorSeguro(String(init.method || 'GET'), ruta, r.status, j);
  return j;
}

const arg = (n: string, d = '') => {
  const i = process.argv.indexOf(n);
  return i > 0 ? String(process.argv[i + 1] || d) : d;
};

async function main() {
  if (!key() || !process.env.ULTRON_SESION_SECRETO) {
    console.error('Faltan ELEVENLABS_API_KEY y ULTRON_SESION_SECRETO en el entorno.');
    process.exit(1);
  }
  const avatar = normalizarAvatar(arg('--avatar', 'aura'));
  const idioma = normalizarIdioma(arg('--idioma', 'es'));
  const base = arg('--url', 'https://aura-fp.onrender.com');
  const crear = process.argv.includes('--crear');
  const agente = await api(`/convai/agents/${encodeURIComponent(agenteDe(avatar, idioma))}`);
  if (!crear) {
    console.log('Sin --crear: esto es lo que se crearía (el secreto, tapado). Nada se cambió en ElevenLabs.');
    console.log(JSON.stringify(cuerpoMotor({ avatar, idioma, base, secretId: '<secreto aura-motor>', agente }), null, 2));
    return;
  }
  const lista = await api('/convai/secrets');
  const viejo = (lista.secrets || []).find((s: any) => s.name === NOMBRE_SECRETO_MOTOR);
  const secretId = viejo
    ? viejo.secret_id
    : (await api('/convai/secrets', { method: 'POST', body: JSON.stringify({ type: 'new', name: NOMBRE_SECRETO_MOTOR, value: secretoDerivado(ETIQUETA_SECRETO_MOTOR) }) })).secret_id;
  const creado = await api('/speech-engine', { method: 'POST', body: JSON.stringify(cuerpoMotor({ avatar, idioma, base, secretId, agente })) });
  console.log(`✓ Speech Engine de prueba: ${creado.speech_engine_id}`);
  console.log(`  En Render: ELEVENLABS_SPEECH_ENGINE_${avatar.toUpperCase()}_${idioma.toUpperCase()}=${creado.speech_engine_id} y AURA_MOTOR_VOZ=speech-engine`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((e: any) => {
    console.error(`No se pudo: ${String(e?.message || e).slice(0, 300)}`);
    process.exit(1);
  });
}
