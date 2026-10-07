#!/usr/bin/env node
/**
 * ¿LA CUENTA DE PRUEBA ES SEGURA? Antes de tocar el emulador, contra producción y sin la app.
 *
 * La prueba del emulador habla con AU-RA de verdad (https://aura-fp.onrender.com). Para que nunca mande un WhatsApp,
 * un correo o una llamada de verdad, ni escriba en la memoria de José, entra con una cuenta DEDICADA (los secretos
 * AURA_PRUEBA_CORREO y AURA_PRUEBA_CLAVE) y antes se comprueba aquí que:
 *
 *   1. NO es de la junta, por dos lados:
 *      a. el correo no está en la lista de la junta que llega por secreto (AURA_CORREOS_JUNTA: correos separados por
 *         comas, espacios o líneas): con uno de esos ni se intenta entrar. La lista NO vive en el repositorio (es
 *         público): antes salía de mobile/src/config.ts (DESK_USERS), que quedó vacío y dejaba esta guarda en nada;
 *      b. y lo que manda: el SERVIDOR la ve como `miembro` (GET /api/ultron/sesion → user.nivel), no como junta, y su
 *         rol no es de la junta. Esto vale aunque la lista falte o esté vieja;
 *   2. la clave entra (POST /api/ultron/entrar, el mismo que usa la pantalla «Otras formas de entrar»);
 *   3. (1b) el nivel del servidor, justo después de entrar;
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

/** Los correos de la junta que llegan por secreto (AURA_CORREOS_JUNTA): separados por comas, espacios, `;` o líneas. */
export function correosDeLaJunta(texto) {
  return new Set((String(texto || '').match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).map((c) => c.trim().toLowerCase()));
}

/** ¿El correo está en la lista de la junta? (sin entrar con él) */
export function esDeLaListaDeLaJunta(correo, junta) {
  return junta.has(String(correo || '').trim().toLowerCase());
}

/**
 * Lo que dice el SERVIDOR de la sesión de la cuenta de prueba (GET /api/ultron/sesion). Solo `miembro` pasa: la junta,
 * un nivel desconocido o un rol de la junta, no. null = segura; si no, el motivo.
 */
export function motivoDelNivel(sesion, correo) {
  const u = sesion?.user || {};
  if (!sesion?.authenticated || String(u.correo || '').trim().toLowerCase() !== String(correo || '').trim().toLowerCase()) return 'La sesión no se pudo comprobar.';
  if (u.nivel !== 'miembro') return `La cuenta de prueba tiene nivel «${u.nivel || 'desconocido'}» en el servidor: debe ser «miembro» (fuera del padrón de la junta).`;
  if (/junta/i.test(String(u.rol || ''))) return `La cuenta de prueba tiene rol «${u.rol}»: es de la junta.`;
  return null;
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
  // 1a. La lista de la junta llega por secreto (nunca escrita en el repositorio). Sin ella, manda el nivel del servidor (1b).
  const junta = correosDeLaJunta(process.env.AURA_CORREOS_JUNTA);
  informe.comprobado.listaJunta = junta.size;
  if (esDeLaListaDeLaJunta(CORREO, junta)) {
    informe.motivo = 'AURA_PRUEBA_CORREO está en AURA_CORREOS_JUNTA: es una cuenta de la junta. La prueba nunca entra con ella.';
    return salida(informe);
  }
  informe.comprobado.noEstaEnLaListaDeLaJunta = true;

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

    // 1b. El nivel que le da el SERVIDOR: solo «miembro» pasa.
    const s = await pedir('/api/ultron/sesion', { token });
    const u = s.json?.user || {};
    informe.comprobado.nivel = u.nivel || 'desconocido';
    informe.comprobado.rol = u.rol || '';
    const noMiembro = s.status !== 200 ? `La sesión no se pudo comprobar (HTTP ${s.status}).` : motivoDelNivel(s.json, CORREO);
    if (noMiembro) {
      informe.motivo = noMiembro;
      return salida(informe);
    }
    informe.comprobado.noEsDeLaJunta = true;

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
