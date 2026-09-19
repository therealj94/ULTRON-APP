/**
 * Pendientes de junta. JSON en data/tareas.json. Sin fingir un gestor externo.
 */

import fs from 'node:fs';
import path from 'node:path';

export type Tarea = {
  id: string;
  texto: string;
  hecha: boolean;
  t: number;
  dueno?: string;
};

const FILE = path.join(process.cwd(), 'data', 'tareas.json');

function leer(): Tarea[] {
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

function escribir(xs: Tarea[]) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(xs.slice(-80), null, 2));
}

export function listarTareas(): Tarea[] {
  return leer();
}

export function agregarTarea(texto: string, dueno?: string): Tarea {
  const t: Tarea = {
    id: Date.now().toString(36),
    texto: String(texto || '').trim().slice(0, 280),
    hecha: false,
    t: Date.now(),
    dueno,
  };
  const xs = leer();
  xs.push(t);
  escribir(xs);
  return t;
}

export function marcarTarea(id: string, hecha = true): Tarea | null {
  const xs = leer();
  const t = xs.find((x) => x.id === id || x.texto === id);
  if (!t) return null;
  t.hecha = hecha;
  escribir(xs);
  return t;
}

export function resumenTareas(): string {
  const xs = leer();
  const abiertas = xs.filter((x) => !x.hecha);
  if (!xs.length) return 'TAREAS: ninguna.';
  if (!abiertas.length) return `TAREAS: ${xs.length} hechas, ninguna abierta.`;
  return `TAREAS ABIERTAS (${abiertas.length}):\n` + abiertas.slice(-8).map((x) => `- [${x.id}] ${x.texto}`).join('\n');
}
