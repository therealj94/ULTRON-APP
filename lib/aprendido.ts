/**
 * LARGO PLAZO append-only. data/cerebro-aprendido.txt — una línea por hecho, máx 80.
 * No guarda secretos. Hechos de junta sí.
 */

import fs from 'node:fs';
import path from 'node:path';

const FILE = path.join(process.cwd(), 'data', 'cerebro-aprendido.txt');
const MAX = 80;

export function archivoAprendido() {
  return FILE;
}

export function leerAprendido(): string[] {
  try {
    return fs
      .readFileSync(FILE, 'utf8')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('#'))
      .slice(-MAX);
  } catch {
    return [];
  }
}

export function appendAprendido(hecho: string): string[] {
  const line = String(hecho || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 400);
  if (!line) return leerAprendido();
  if (/api[_-]?key|secret|password|akid|akia/i.test(line)) return leerAprendido();
  const prev = leerAprendido().filter((x) => x !== line);
  const next = [...prev, line].slice(-MAX);
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, next.join('\n') + '\n');
  return next;
}

export function bloqueLargoPlazo(extra: string[] = []): string {
  const seen = new Set<string>();
  const lineas: string[] = [];
  for (const h of [...leerAprendido(), ...extra]) {
    const t = String(h || '').trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    lineas.push(t);
  }
  const last = lineas.slice(-MAX);
  if (!last.length) return '(nada aprendido aún)';
  return last.map((h) => `- ${h}`).join('\n');
}
