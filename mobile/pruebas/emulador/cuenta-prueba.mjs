#!/usr/bin/env node
/**
 * ¿LA CUENTA DE PRUEBA ES SEGURA? Antes de tocar el emulador, contra producción y sin la app.
 *
 * La prueba del emulador habla con AU-RA de verdad (https://aura-fp.onrender.com). Para que nunca mande un WhatsApp,
 * un correo o una llamada de verdad, ni escriba en la memoria de José, entra con una cuenta DEDICADA (los secretos
 * AURA_PRUEBA_CORREO y AURA_PRUEBA_CLAVE) y antes se comprueba aquí que:
 *
 *   1. el correo NO es de la junta que la app conoce (mobile/src/config.ts: DESK_USERS y EMAIL_ALIASES): ni se
 *      intenta entrar con él;
 *   2. la clave entra (POST /api/ultron/entrar, el mismo que usa la pantalla «Otras formas de entrar»);
 *   3. el servidor la ve como `miembro`, no como junta (GET /api/ultron/sesion);
 *   4. no tiene WhatsApp vinculado (GET /api/whatsapp/estado → vinculado: false);
 *   5. no tiene correos conectados (GET /api/correo/cuentas → ninguna);
 *   6. su computadora en la nube no tiene una tarea en curso (GET /api/computadora; solo informa).
 *
 * Al terminar cierra la sesión que abrió (POST /api/ultron/salir). Ante la duda (el servidor no contesta, una
 * respuesta rara), NO es segura: los escenarios con cuenta se saltan y el resumen dice por qué.
 *
 * Salida: JSON por stdout (sin el correo) y, en GitHub Actions, `segura=true|false` y `motivo=…` en GITHUB_OUTPUT.
 * Nunca imprime el correo ni la clave.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.env.AURA_URL || 'https://aura-fp.onrender.com').replace(/\/+$/, '');
const CORREO = String(process.env.AURA_PRUEBA_CORREO || '').trim().toLowerCase();
const CLAVE = String(process.env.AURA_PRUEBA_CLAVE || '');
const AQUI = path.dirname(fileURLToPath(import.meta.url));

/** Los correos de la junta que la app trae escritos (la lista de cuentas y sus alias). */
export function correosDeLaJunta(configTs) {
  return new Set((String(configTs).match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).map((c) => c.toLowerCase()));
}

async function pedir(ruta, { metodo = 'GET', token = '', cuerpo, ms = 30_000 } = {}) {
  const r = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    signal: AbortSignal.timeout(ms),
  });
  let json = null;
  try {
    json = await r.json();
  } catch {
    json = null;
  }
  return { status: r.status, json };
}

function salida(o) {
  const linea = JSON.stringify(o, null, 2);
  process.stdout.write(linea + '\n');
  const gh = process.env.GITHUB_OUTPUT;
  if (gh) fs.appendFileSync(gh, `segura=${o.segura ? 'true' : 'false'}\nmotivo=${String(o.motivo).replace(/\n/g, ' ')}\n`);
}

async function principal() {
  const informe = { segura: false, motivo: '', servidor: BASE, comprobado: {} };
  if (!CORREO || !CLAVE) {
    informe.motivo = 'Faltan los secretos AURA_PRUEBA_CORREO y/o AURA_PRUEBA_CLAVE.';
    return salida(informe);
  }
  let junta = new Set();
  try {
    junta = correosDeLaJunta(fs.readFileSync(path.join(AQUI, '../../src/config.ts'), 'utf8'));
  } catch {
    informe.motivo = 'No pude leer mobile/src/config.ts para descartar las cuentas de la junta.';
    return salida(informe);
  }
  if (junta.has(CORREO)) {
    informe.motivo = 'AURA_PRUEBA_CORREO es una cuenta de la junta (José o Medardo). La prueba nunca entra con ella.';
    return salida(informe);
  }
  informe.comprobado.noEsDeLaJunta = true;

  let token = '';
  try {
    // Render puede estar dormido: la primera respuesta tarda.
    const e = await pedir('/api/ultron/entrar', { metodo: 'POST', cuerpo: { correo: CORREO, clave: CLAVE }, ms: 90_000 });
    if (e.status !== 200 || !e.json?.token) {
      const codigo = e.json?.codigo || e.json?.code || '';
      informe.motivo = `La cuenta de prueba no entra (HTTP ${e.status}${codigo ? `, ${codigo}` : ''}).`;
      return salida(informe);
    }
    token = e.json.token;
    informe.comprobado.entra = true;

    const s = await pedir('/api/ultron/sesion', { token });
    const u = s.json?.user || {};
    if (s.status !== 200 || !s.json?.authenticated || String(u.correo || '').toLowerCase() !== CORREO) {
      informe.motivo = `La sesión no se pudo comprobar (HTTP ${s.status}).`;
      return salida(informe);
    }
    informe.comprobado.nivel = u.nivel || 'desconocido';
    informe.comprobado.rol = u.rol || '';
    if (u.nivel !== 'miembro') {
      informe.motivo = `La cuenta de prueba tiene nivel «${u.nivel || 'desconocido'}»: debe ser «miembro» (fuera del padrón de la junta).`;
      return salida(informe);
    }

    const w = await pedir('/api/whatsapp/estado', { token });
    if (w.status !== 200 || !w.json) {
      informe.motivo = `No pude comprobar el WhatsApp de la cuenta (HTTP ${w.status}).`;
      return salida(informe);
    }
    informe.comprobado.whatsapp = { disponible: !!w.json.disponible, permitido: !!w.json.permitido, vinculado: !!w.json.vinculado };
    if (w.json.vinculado) {
      informe.motivo = 'La cuenta de prueba tiene WhatsApp vinculado: desvincúlalo antes (Ajustes → WhatsApp).';
      return salida(informe);
    }

    const c = await pedir('/api/correo/cuentas', { token });
    if (c.status !== 200 || !Array.isArray(c.json?.cuentas)) {
      informe.motivo = `No pude comprobar los correos conectados de la cuenta (HTTP ${c.status}).`;
      return salida(informe);
    }
    informe.comprobado.correosConectados = c.json.cuentas.length;
    if (c.json.cuentas.length > 0) {
      informe.motivo = `La cuenta de prueba tiene ${c.json.cuentas.length} correo(s) conectado(s): desconéctalos antes.`;
      return salida(informe);
    }

    const pc = await pedir('/api/computadora', { token });
    if (pc.status === 200 && pc.json) {
      informe.comprobado.computadora = { configuradaEnElServidor: !!pc.json.configurada, tareaEnCurso: !!pc.json.actual, pendientes: Array.isArray(pc.json.pendientes) ? pc.json.pendientes.length : 0 };
    } else {
      informe.comprobado.computadora = { leida: false, status: pc.status };
    }

    informe.segura = true;
    informe.motivo = 'Cuenta de prueba de nivel miembro, sin WhatsApp ni correos conectados.';
    return salida(informe);
  } catch (e) {
    informe.motivo = `El servidor no contestó a tiempo (${String(e?.name || e?.message || e).slice(0, 80)}).`;
    return salida(informe);
  } finally {
    if (token) await pedir('/api/ultron/salir', { metodo: 'POST', token }).catch(() => null);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await principal();
