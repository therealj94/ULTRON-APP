/**
 * Ejecutor de código Python (Fase 5).
 * - Por defecto: python3 local en /tmp, timeout 10s, sin red extra.
 * - Si EJECUTOR_DOCKER=1 y docker está, usa el sandbox del prompt (network=none, 256m, 1 cpu).
 * - Si EJECUTOR_URL apunta a un Flask (scripts/ejecutor.py), se proxifica.
 * No se instala nada en el nodo Qwen (regla: no tocarlo).
 *
 * Límites que se aplican MIENTRAS corre, no al final:
 *  · la salida se cuenta en bytes al llegar; pasado TOPE_CAPTURA_BYTES se mata el proceso (todo su
 *    grupo) y se devuelve lo guardado: un `while True: print(...)` no llena la memoria del servidor;
 *  · en Docker el contenedor lleva nombre y se mata con `docker kill` (matar el cliente no para el
 *    contenedor);
 *  · como mucho EJECUTOR_MAX ejecuciones a la vez (por omisión 2);
 *  · del ejecutor remoto se lee la respuesta con el mismo tope de bytes.
 */

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { modoDesarrollo } from './entorno';

export type Ejecucion = {
  stdout: string;
  stderr: string;
  exit_code: number;
  ok: boolean;
  via: 'docker' | 'local' | 'remoto' | 'omitido';
  error?: string;
};

const MAX_OUT = 5000;
const TIMEOUT_MS = 10_000;
/** Lo más que se escucha de stdout+stderr: pasado esto se mata el proceso. */
export const TOPE_CAPTURA_BYTES = 256 * 1024;

/**
 * Guarda como mucho `max` caracteres de lo que llega y cuenta los bytes que pasaron. Lo que excede
 * no se acumula (antes `stdout += …` crecía sin límite hasta el final).
 */
export function capturaAcotada(max = MAX_OUT) {
  let texto = '';
  let bytes = 0;
  return {
    sumar(d: Buffer | string) {
      bytes += typeof d === 'string' ? Buffer.byteLength(d) : d.length;
      if (texto.length < max) texto += d.toString().slice(0, max - texto.length);
    },
    texto: () => texto,
    bytes: () => bytes,
  };
}

/* Ejecuciones a la vez: las que pasan esperan turno. */
let corriendo = 0;
const esperando: Array<() => void> = [];
function maxConcurrentes(): number {
  const n = Number(process.env.EJECUTOR_MAX);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 2;
}
async function conTurno<T>(fn: () => Promise<T>): Promise<T> {
  if (corriendo >= maxConcurrentes()) await new Promise<void>((r) => esperando.push(r));
  corriendo++;
  try {
    return await fn();
  } finally {
    corriendo--;
    esperando.shift()?.();
  }
}

/**
 * Activo por defecto SOLO si hay dónde correr con aislamiento: EJECUTOR_URL (sandbox remoto)
 * o EJECUTOR_DOCKER=1. python3 en el propio host solo en modo desarrollo (AURA_DEV=1 o
 * NODE_ENV=test, lib/entorno.ts): ahí corre con el mismo usuario que el servidor y ve todas las
 * claves. Sin la marca —también sin NODE_ENV— no corre nada en el host.
 */
export function ejecutorActivo(): boolean {
  const v = process.env.EJECUTOR_ACTIVO;
  if (v === 'false' || v === '0') return false;
  if (process.env.EJECUTOR_URL) return true;
  if (process.env.EJECUTOR_DOCKER === '1' || process.env.EJECUTOR_DOCKER === 'true') return true;
  return modoDesarrollo();
}

function localPermitido(): boolean {
  return modoDesarrollo();
}

function recortar(s: string) {
  return String(s || '').slice(0, MAX_OUT);
}

async function spawnCapture(cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number; topeBytes?: number; alMatar?: () => void }): Promise<Ejecucion> {
  return new Promise((resolve) => {
    // Grupo propio (detached): matar al grupo mata también lo que el código haya lanzado.
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { PATH: process.env.PATH || '/usr/bin:/bin', LANG: 'C.UTF-8', NODE_ENV: 'sandbox' } as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    const out = capturaAcotada();
    const err = capturaAcotada();
    const tope = opts.topeBytes ?? TOPE_CAPTURA_BYTES;
    let terminado = false;
    const matar = () => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {
          /* ya no está */
        }
      }
      try {
        opts.alMatar?.();
      } catch {
        /* */
      }
    };
    const fin = (e: Ejecucion) => {
      if (terminado) return;
      terminado = true;
      clearTimeout(t);
      resolve(e);
    };
    const t = setTimeout(() => {
      matar();
      fin({ stdout: out.texto(), stderr: err.texto() || 'Timeout de 10s', exit_code: 124, ok: false, via: 'local', error: 'Timeout de 10s' });
    }, opts.timeoutMs || TIMEOUT_MS);
    const vigilar = () => {
      if (out.bytes() + err.bytes() <= tope) return;
      child.stdout?.removeAllListeners('data');
      child.stderr?.removeAllListeners('data');
      matar();
      fin({ stdout: out.texto(), stderr: err.texto(), exit_code: 137, ok: false, via: 'local', error: `La salida pasó el tope de ${Math.round(tope / 1024)} KB: se detuvo.` });
    };
    child.stdout?.on('data', (d) => {
      out.sumar(d);
      vigilar();
    });
    child.stderr?.on('data', (d) => {
      err.sumar(d);
      vigilar();
    });
    child.on('error', (e) => {
      fin({ stdout: '', stderr: recortar(String(e.message)), exit_code: 127, ok: false, via: 'local', error: String(e.message) });
    });
    child.on('close', (code) => {
      const exit_code = code ?? 1;
      fin({ stdout: out.texto(), stderr: err.texto(), exit_code, ok: exit_code === 0, via: 'local' });
    });
  });
}

async function dockerDisponible(): Promise<boolean> {
  try {
    const r = await spawnCapture('docker', ['info'], { timeoutMs: 3000 });
    return r.ok;
  } catch {
    return false;
  }
}

async function ejecutarDocker(codigo: string): Promise<Ejecucion> {
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ultron-'));
  const ruta = path.join(tmpdir, 'codigo.py');
  fs.writeFileSync(ruta, codigo, 'utf8');
  // Con nombre: al pasar el tiempo o el tope se para el CONTENEDOR (matar el cliente no lo para).
  const nombre = `ultron-ej-${crypto.randomBytes(6).toString('hex')}`;
  try {
    const r = await spawnCapture(
      'docker',
      [
        'run',
        '--rm',
        '--name',
        nombre,
        '--network=none',
        '--memory=256m',
        '--cpus=1',
        '--read-only',
        '--tmpfs',
        '/tmp:rw,noexec,nosuid,size=64m',
        '-v',
        `${ruta}:/app/codigo.py:ro`,
        'python:3.12-slim',
        'python',
        '/app/codigo.py',
      ],
      {
        timeoutMs: TIMEOUT_MS,
        alMatar: () => {
          spawn('docker', ['kill', nombre], { stdio: 'ignore' }).on('error', () => undefined);
        },
      }
    );
    return { ...r, via: 'docker' };
  } finally {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  }
}

async function ejecutarLocal(codigo: string): Promise<Ejecucion> {
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ultron-'));
  const ruta = path.join(tmpdir, 'codigo.py');
  fs.writeFileSync(ruta, codigo, 'utf8');
  try {
    const r = await spawnCapture('python3', [ruta], { cwd: tmpdir, timeoutMs: TIMEOUT_MS });
    return r;
  } finally {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  }
}

/** Lee el cuerpo con tope de bytes: una respuesta enorme del remoto no se junta entera en memoria. */
async function cuerpoAcotado(r: Response, tope = TOPE_CAPTURA_BYTES): Promise<string> {
  if (!r.body) return '';
  const lector = r.body.getReader();
  const trozos: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    bytes += value.length;
    if (bytes > tope) {
      await lector.cancel().catch(() => undefined);
      throw new Error(`La respuesta del ejecutor pasó el tope de ${Math.round(tope / 1024)} KB.`);
    }
    trozos.push(value);
  }
  return Buffer.concat(trozos).toString('utf8');
}

/**
 * La cabecera del secreto compartido con el sandbox remoto (Fase 0.5). Antes EJECUTOR_URL se llamaba
 * sin nada: quien encontrara el servicio corría Python en él. Con EJECUTOR_SECRETO puesto viaja en cada
 * llamada, como `x-ultron-secreto` al nodo; el servicio debe exigirlo (docs/entregas/FASE-0.md).
 */
export function cabecerasEjecutor(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const secreto = String(env.EJECUTOR_SECRETO || '').trim();
  return { 'Content-Type': 'application/json', ...(secreto ? { 'x-ejecutor-secreto': secreto } : {}) };
}

async function ejecutarRemoto(codigo: string, url: string): Promise<Ejecucion> {
  const r = await fetch(`${url.replace(/\/$/, '')}/ejecutar`, {
    method: 'POST',
    headers: cabecerasEjecutor(),
    body: JSON.stringify({ codigo }),
    signal: AbortSignal.timeout(TIMEOUT_MS + 2000),
  });
  let j: any = {};
  try {
    j = JSON.parse(await cuerpoAcotado(r));
  } catch (e: any) {
    const msg = String(e?.message || e);
    return { stdout: '', stderr: recortar(msg), exit_code: 1, ok: false, via: 'remoto', error: /tope/.test(msg) ? msg : 'respuesta ilegible' };
  }
  return {
    stdout: recortar(j.stdout || ''),
    stderr: recortar(j.stderr || j.error || ''),
    exit_code: Number(j.exit_code ?? (j.ok ? 0 : 1)),
    ok: !!j.ok,
    via: 'remoto',
    error: j.error,
  };
}

export async function ejecutarCodigo(codigo: string): Promise<Ejecucion> {
  return conTurno(() => ejecutarCodigoYa(codigo));
}

async function ejecutarCodigoYa(codigo: string): Promise<Ejecucion> {
  const src = String(codigo || '').trim();
  if (!src) return { stdout: '', stderr: 'Código vacío', exit_code: 400, ok: false, via: 'omitido', error: 'Código vacío' };
  if (src.length > 80_000) return { stdout: '', stderr: 'Código demasiado largo', exit_code: 413, ok: false, via: 'omitido', error: 'Código demasiado largo' };
  if (!ejecutorActivo()) return { stdout: '', stderr: 'EJECUTOR_ACTIVO=false', exit_code: 0, ok: false, via: 'omitido', error: 'omitido' };

  const remoto = (process.env.EJECUTOR_URL || '').replace(/\/$/, '');
  if (remoto) return ejecutarRemoto(src, remoto);

  if (process.env.EJECUTOR_DOCKER === '1' || process.env.EJECUTOR_DOCKER === 'true') {
    if (await dockerDisponible()) return ejecutarDocker(src);
    return { stdout: '', stderr: 'Docker no disponible', exit_code: 503, ok: false, via: 'omitido', error: 'Docker no disponible' };
  }
  if (!localPermitido()) {
    return { stdout: '', stderr: 'Sin sandbox en producción (configura EJECUTOR_URL o EJECUTOR_DOCKER=1)', exit_code: 503, ok: false, via: 'omitido', error: 'sin sandbox' };
  }
  return ejecutarLocal(src);
}

