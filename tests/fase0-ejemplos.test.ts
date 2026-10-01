/**
 * Fase 0.7 — los archivos de ejemplo no llevan direcciones reales.
 *
 * El repo es público y `.env.example` traía las IPs del nodo Qwen, del ojo y de la T4: un mapa de la
 * infraestructura para quien lo leyera. Las direcciones reales viven solo en Render y en los nodos.
 * Se admiten la propia máquina (127.0.0.1, 0.0.0.0, localhost) y los rangos de documentación
 * (RFC 5737: 192.0.2.x, 198.51.100.x, 203.0.113.x), que no son de nadie.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '..');

/** Los .env.example que están en el repo (el de la raíz y los de infra/). */
function ejemplos(): string[] {
  const salida = execFileSync('git', ['ls-files', '--', '.env.example', '*.env.example', '**/.env.example'], { cwd: RAIZ, encoding: 'utf8' });
  const lista = [...new Set(salida.split('\n').filter(Boolean))];
  // Sin git (un tarball), al menos el de la raíz.
  return lista.length ? lista : ['.env.example'];
}

const PERMITIDA = (ip: string) => ip === '127.0.0.1' || ip === '0.0.0.0' || /^(192\.0\.2|198\.51\.100|203\.0\.113)\.\d+$/.test(ip);

/** Las IPv4 de un texto: con puntos (1.2.3.4) y con guiones de sslip.io/nip.io (1-2-3-4.sslip.io). */
function ipsEn(texto: string): string[] {
  const conPuntos = texto.match(/(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g) || [];
  const conGuiones = [...texto.matchAll(/(?<![\d-])(\d{1,3})-(\d{1,3})-(\d{1,3})-(\d{1,3})\.(?:sslip|nip)\.io/g)].map((m) => m.slice(1, 5).join('.'));
  return [...conPuntos, ...conGuiones];
}

test('ipsEn ve las dos formas', () => {
  assert.deepEqual(ipsEn('https://10.1.2.3:8443 y https://9-8-7-6.sslip.io/laya'), ['10.1.2.3', '9.8.7.6']);
  assert.deepEqual(ipsEn('versión 1.2.3 y http://127.0.0.1:3000'), ['127.0.0.1']);
});

test('ningún .env.example del repo trae una IPv4 real', () => {
  const archivos = ejemplos();
  assert.ok(archivos.includes('.env.example'), 'el .env.example de la raíz existe');
  for (const f of archivos) {
    const reales = ipsEn(fs.readFileSync(path.join(RAIZ, f), 'utf8')).filter((ip) => !PERMITIDA(ip));
    assert.deepEqual(reales, [], `${f} trae direcciones reales`);
  }
});
