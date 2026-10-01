#!/usr/bin/env -S npx tsx
/**
 * Crea (o actualiza) los ocho agentes de ElevenLabs de la conversación fluida de AU-RA FP: uno por
 * avatar (Guardián, AU-RA, Claudio, ANT-ONIO) e idioma (español, inglés). Cada agente escucha, detecta el
 * turno, se deja interrumpir y habla con la voz v4 del avatar; para pensar llama a nuestro cerebro
 * (server/voz-agente.ts, `/api/voz/llm`) como «LLM propio».
 *
 *   ELEVENLABS_API_KEY=… ULTRON_SESION_SECRETO=… npx tsx scripts/elevenlabs-agentes.ts [--url https://aura-fp.onrender.com] [--solo antonio]
 *
 * `--solo <avatar>` crea o actualiza SOLO los agentes de ese avatar (los demás no se tocan) y, si el
 * secreto «aura-llm» ya existe, lo usa tal cual en vez de reescribirlo.
 *
 * ULTRON_SESION_SECRETO tiene que ser el MISMO que usa el servidor en Render: de él se deriva la
 * llave que ElevenLabs manda en cada turno (secretoDerivado). La llave se guarda en los secretos de
 * ElevenLabs; no se imprime. Es idempotente: si un agente con ese nombre ya existe, lo actualiza.
 * Imprime los ids para pegarlos en AGENTES (server/voz-agente.ts).
 */
import { pathToFileURL } from 'node:url';
import { secretoDerivado } from '../server/seguridad';
import { CASCADA_ELEVENLABS_MS, ETIQUETA_SECRETO_LLM, PASE_TTL_MS, RELLENO_AGENTE_MS } from '../server/voz-agente';
import { NOMBRE_AVATAR, VOCES_ELEVEN, type AvatarVoz, type Idioma } from '../server/eleven';

const API = 'https://api.elevenlabs.io/v1';
const key = () => String(process.env.ELEVENLABS_API_KEY || '').trim();
const iUrl = process.argv.indexOf('--url');
const BASE = (iUrl > 0 ? process.argv[iUrl + 1] : 'https://aura-fp.onrender.com').replace(/\/+$/, '');

export const AVATARES_AGENTE: AvatarVoz[] = ['ojos', 'aura', 'claudio', 'antonio'];

/** Qué avatares tocar: todos, o solo el de `--solo <avatar>` (uno que no existe es un error, no «todos»). */
export function avataresPedidos(argv: readonly string[]): AvatarVoz[] {
  const i = argv.indexOf('--solo');
  if (i < 0) return AVATARES_AGENTE;
  const uno = String(argv[i + 1] || '').trim().toLowerCase() as AvatarVoz;
  if (!AVATARES_AGENTE.includes(uno)) throw new Error(`--solo: avatar desconocido (${AVATARES_AGENTE.join(', ')})`);
  return [uno];
}

/** Solo lo que dice QUÉ falló: un código corto que ElevenLabs pone en `detail.status`, si es eso. */
const CODIGO = /^[a-z0-9_.-]{1,60}$/i;

/**
 * El error de una llamada a ElevenLabs, dicho SIN su cuerpo (auditoría del 29-sep). El cuerpo de un
 * error puede traer la configuración entera del agente, el valor de un secreto que se acaba de
 * mandar o datos de la cuenta, y este script se corre en terminales que se copian a chats. Se dice
 * el método, la ruta (sin la consulta), el estado y, si ElevenLabs lo da, su código corto.
 */
export function errorSeguro(metodo: string, ruta: string, status: number, cuerpo: unknown): Error & { status: number } {
  const d: any = (cuerpo as any)?.detail;
  const codigo = typeof d?.status === 'string' && CODIGO.test(d.status) ? d.status : typeof d?.[0]?.type === 'string' && CODIGO.test(d[0].type) ? d[0].type : '';
  const sinConsulta = String(ruta).split('?')[0];
  return Object.assign(new Error(`${metodo} ${sinConsulta} → ${status}${codigo ? ` (${codigo})` : ''}`), { status });
}

async function api(ruta: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`${API}${ruta}`, { ...init, headers: { 'xi-api-key': key(), 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const texto = await r.text();
  let j: any = null;
  try {
    j = JSON.parse(texto);
  } catch {
    j = null;
  }
  if (!r.ok) throw errorSeguro(String(init.method || 'GET'), ruta, r.status, j);
  return j;
}

/**
 * El secreto «aura-llm» en ElevenLabs: se crea si falta y se reemplaza si ya estaba. Con
 * `conservar` (el modo --solo), uno que ya existe se usa tal cual: no se toca lo de los demás agentes.
 */
async function secreto(conservar = false): Promise<string> {
  const nombre = 'aura-llm';
  const valor = secretoDerivado(ETIQUETA_SECRETO_LLM);
  const lista = await api('/convai/secrets');
  const viejo = (lista.secrets || []).find((s: any) => s.name === nombre);
  if (viejo && conservar) return viejo.secret_id;
  if (viejo) {
    await api(`/convai/secrets/${viejo.secret_id}`, { method: 'PATCH', body: JSON.stringify({ type: 'update', name: nombre, value: valor }) });
    return viejo.secret_id;
  }
  const nuevo = await api('/convai/secrets', { method: 'POST', body: JSON.stringify({ type: 'new', name: nombre, value: valor }) });
  return nuevo.secret_id;
}

const PRIMERA: Record<AvatarVoz, Record<Idioma, string>> = {
  ojos: { es: 'Te escucho.', en: 'I’m listening.' },
  aura: { es: 'Aquí estoy. Te escucho.', en: 'I’m here. I’m listening.' },
  claudio: { es: '¡Aquí estoy! Cuéntame.', en: 'I’m here! Tell me.' },
  antonio: { es: '¡Aquí ANT-ONIO! ¿En qué te echo una mano?', en: 'ANT-ONIO here! What can I help you with?' },
};

/** Lo que el reconocimiento tiene que oír bien (nombres propios de la app). */
export const PALABRAS_ASR = ['AU-RA', 'Aura', 'Claudio', 'ANT-ONIO', 'Antonio', 'Orden Global', 'Guardián', 'Genesis ID', 'Veta Wallet'];

/** Lo que no hay que tomar como interrupción: asentir mientras el avatar habla. */
/** Los rellenos de la espera (soft timeout), en cada idioma. */
export const RELLENOS: Record<'es' | 'en', string[]> = {
  es: ['Mmm… a ver.', 'Déjame ver.', 'A ver…', 'Un segundo.'],
  en: ['Hmm… let me see.', 'Let me check.', 'One sec.', 'Hmm…'],
};

const ASENTIR: Record<Idioma, string[]> = {
  es: ['ajá', 'sí', 'ok', 'okay', 'mhm', 'claro', 'ya', 'exacto', 'ah ok', 'vale'],
  en: ['uh-huh', 'yeah', 'yes', 'ok', 'okay', 'mhm', 'right', 'sure', 'got it'],
};

function config(avatar: AvatarVoz, idioma: Idioma, secretId: string, modeloTts: string) {
  const nombre = `AU-RA FP · ${NOMBRE_AVATAR[avatar][idioma]} (${idioma})`;
  return {
    name: nombre,
    conversation_config: {
      agent: {
        language: idioma,
        first_message: PRIMERA[avatar][idioma],
        dynamic_variables: { dynamic_variable_placeholders: { pase: '' } },
        prompt: {
          // Nuestro cerebro arma su propio prompt (avatar, idioma, memoria, herramientas); esto solo
          // queda de referencia en el panel de ElevenLabs.
          prompt: `Eres ${NOMBRE_AVATAR[avatar][idioma]} de AU-RA FP. El cerebro vive en el servidor de Orden Global.`,
          llm: 'custom-llm',
          custom_llm: {
            url: `${BASE}/api/voz/llm`,
            model_id: 'aura',
            api_key: { secret_id: secretId },
            api_type: 'chat_completions',
            request_headers: { 'X-Pase': { variable_name: 'pase' } },
          },
          backup_llm_config: { preference: 'disabled' },
          // Cuánto espera ElevenLabs al cerebro antes de cortar (1-oct: de 4 s por omisión a 12 s). Con 4 s
          // toda respuesta lenta obligaba a meter relleno antes del corte; el puente del servidor ya cubre.
          cascade_timeout_seconds: CASCADA_ELEVENLABS_MS / 1000,
        },
      },
      tts: { model_id: modeloTts, voice_id: VOCES_ELEVEN[avatar][idioma] },
      asr: { provider: 'scribe_realtime', quality: 'high', keywords: PALABRAS_ASR },
      turn: {
        turn_model: 'turn_v3',
        turn_eagerness: 'normal',
        // Turno especulativo (José, 1-oct): la respuesta se pide en la pausa. Las acciones esperan a que
        // el turno se confirme (server/voz-agente.ts, RetencionAcciones): una frase a medias no hace nada.
        speculative_turn: true,
        interruption_ignore_terms: ASENTIR[idioma],
        interruption_ignore_term_languages: [idioma],
        merge_with_default_ignore_terms: true,
        // El relleno de ElevenLabs, solo de RESPALDO: si nuestro servidor no mandó nada a los 4,5 s (el puente
        // habla a los 3 s). Antes a 2,5 s y sonaban dos rellenos seguidos (auditoría externa, 1-oct).
        soft_timeout_config: {
          timeout_seconds: RELLENO_AGENTE_MS / 1000,
          message: RELLENOS[idioma][0],
          additional_soft_timeout_messages: RELLENOS[idioma].slice(1),
          randomize_fillers: true,
          // Uno por respuesta (el puente y los seguimientos del servidor hacen el resto).
          max_soft_timeouts_per_generation: 1,
        },
      },
      // Lo mismo que dura un pase (PASE_TTL_MS en server/voz-agente.ts): más allá, la voz solo se despide.
      conversation: { max_duration_seconds: Math.floor(PASE_TTL_MS / 1000) },
    },
    platform_settings: { auth: { enable_auth: true } },
  };
}

async function main() {
  if (!key() || !process.env.ULTRON_SESION_SECRETO) {
    console.error('Faltan ELEVENLABS_API_KEY y ULTRON_SESION_SECRETO en el entorno.');
    process.exit(1);
  }
  const avatares = avataresPedidos(process.argv);
  const solo = avatares.length === 1 && process.argv.includes('--solo');
  const secretId = await secreto(solo);
  console.log(solo ? `secreto aura-llm listo (solo ${avatares[0]})` : 'secreto aura-llm listo');
  const existentes: any[] = (await api('/convai/agents?page_size=100')).agents || [];
  const ids: Record<string, Record<string, string>> = {};
  for (const avatar of avatares) {
    ids[avatar] = {};
    for (const idioma of ['es', 'en'] as Idioma[]) {
      let hecho: string | null = null;
      // v4 Turbo primero (la voz de la mesa); si la API aún no lo acepta en agentes, v3 conversacional.
      for (const modelo of ['eleven_v4_turbo', 'eleven_v3_conversational', 'eleven_flash_v2_5']) {
        const cuerpo = config(avatar, idioma, secretId, modelo);
        const ya = existentes.find((a) => a.name === cuerpo.name);
        try {
          if (ya) {
            await api(`/convai/agents/${ya.agent_id}`, { method: 'PATCH', body: JSON.stringify(cuerpo) });
            hecho = ya.agent_id;
          } else {
            hecho = (await api('/convai/agents/create', { method: 'POST', body: JSON.stringify(cuerpo) })).agent_id;
          }
          console.log(`✓ ${cuerpo.name}: ${hecho} (tts ${modelo})`);
          break;
        } catch (e: any) {
          if (e.status === 422 || e.status === 400) {
            console.warn(`  ${cuerpo.name}: ${modelo} no aceptado (${e.status}); pruebo el siguiente`);
            continue;
          }
          throw e;
        }
      }
      if (!hecho) throw new Error(`No pude crear el agente ${avatar}/${idioma}`);
      ids[avatar][idioma] = hecho;
    }
  }
  console.log(JSON.stringify(ids, null, 2));
}

// Solo al correrlo (no al importarlo, como hacen las pruebas de errorSeguro). Un fallo se dice con su
// mensaje, nunca con el objeto entero: Node imprimiría todas sus propiedades.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((e: any) => {
    console.error(`No se pudo: ${String(e?.message || e).slice(0, 300)}`);
    process.exit(1);
  });
}
