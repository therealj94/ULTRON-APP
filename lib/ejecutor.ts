/**
 * Ejecutor de código Python (Fase 5).
 * - Por defecto: python3 local en /tmp, timeout 10s, sin red extra.
 * - Si EJECUTOR_DOCKER=1 y docker está, usa el sandbox del prompt (network=none, 256m, 1 cpu).
 * - Si EJECUTOR_URL apunta a un Flask (scripts/ejecutor.py), se proxifica.
 * No se instala nada en el nodo Qwen (regla: no tocarlo).
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

/**
 * Activo por defecto SOLO si hay dónde correr con aislamiento: EJECUTOR_URL (sandbox remoto)
 * o EJECUTOR_DOCKER=1. python3 en el propio host (Render) solo con EJECUTOR_LOCAL=1 y fuera
 * de producción: ahí corre con el mismo usuario que el servidor y ve todas las claves.
 */
export function ejecutorActivo(): boolean {
  const v = process.env.EJECUTOR_ACTIVO;
  if (v === 'false' || v === '0') return false;
  if (process.env.EJECUTOR_URL) return true;
  if (process.env.EJECUTOR_DOCKER === '1' || process.env.EJECUTOR_DOCKER === 'true') return true;
  if (process.env.EJECUTOR_LOCAL === '1') return process.env.NODE_ENV !== 'production';
  return process.env.NODE_ENV !== 'production';
}

function localPermitido(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return true;
}

function recortar(s: string) {
  return String(s || '').slice(0, MAX_OUT);
}

async function spawnCapture(cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number }): Promise<Ejecucion> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { PATH: process.env.PATH || '/usr/bin:/bin', LANG: 'C.UTF-8', NODE_ENV: 'sandbox' } as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const t = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ stdout: recortar(stdout), stderr: recortar(stderr || 'Timeout de 10s'), exit_code: 124, ok: false, via: 'local', error: 'Timeout de 10s' });
    }, opts.timeoutMs || TIMEOUT_MS);
    child.stdout?.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', (e) => {
      clearTimeout(t);
      resolve({ stdout: '', stderr: recortar(String(e.message)), exit_code: 127, ok: false, via: 'local', error: String(e.message) });
    });
    child.on('close', (code) => {
      clearTimeout(t);
      const exit_code = code ?? 1;
      resolve({ stdout: recortar(stdout), stderr: recortar(stderr), exit_code, ok: exit_code === 0, via: 'local' });
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
  try {
    const r = await spawnCapture(
      'docker',
      [
        'run',
        '--rm',
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
      { timeoutMs: TIMEOUT_MS }
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

async function ejecutarRemoto(codigo: string, url: string): Promise<Ejecucion> {
  const r = await fetch(`${url.replace(/\/$/, '')}/ejecutar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo }),
    signal: AbortSignal.timeout(TIMEOUT_MS + 2000),
  });
  const j: any = await r.json().catch(() => ({}));
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

