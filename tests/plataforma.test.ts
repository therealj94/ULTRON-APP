/**
 * UN DESPLIEGUE, UN PRODUCTO.
 *
 * El mismo proceso servía AU-RA FP en `/` y Dr Electrum escondido en `/electrum.html`. Cómodo para
 * desarrollar y equivocado para vender: quien recibía «el enlace de Dr Electrum» aterrizaba en otra
 * plataforma, con otro nombre y otro color.
 *
 * Pero lo que de verdad fija esta prueba no es la marca. Un despliegue de Dr Electrum montaba
 * `/api/ejecutar` —el ejecutor de código de AU-RA—, `/api/render/deploy`, `/api/taller` y
 * `/api/vault/*`. Estaban detrás de permisos; la mejor defensa de una ruta peligrosa es que no esté
 * en ese servidor.
 *
 * La segunda parte —el servidor de verdad— existe porque el filtro podría estar perfecto y las
 * rutas montarse igual si alguien lo pusiera después de ellas. Se comprueba contra el binario.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** El módulo lee el entorno al cargarse, así que cada plataforma necesita su propia instancia. */
async function comoSi(plataforma: string) {
  process.env.PLATAFORMA = plataforma;
  return (await import(`../lib/plataforma.ts?${Math.random()}`)) as typeof import('../lib/plataforma');
}

test('qué deja pasar cada plataforma', async (t) => {
  t.after(() => {
    delete process.env.PLATAFORMA;
  });

  await t.test('Dr Electrum cierra la API de AU-RA', async () => {
    const p = await comoSi('electrum');
    for (const r of [
      '/api/ejecutar',
      '/api/render/deploy',
      '/api/taller',
      '/api/vault/status',
      '/api/vault/elevenlabs',
      '/api/turno',
      '/api/turno/stream',
      '/api/memoria',
      '/api/sistema',
      '/api/playwright/scrape',
      '/api/telegram/webhook',
      '/api/cantar',
      '/api/stt',
    ]) {
      assert.equal(p.rutaPermitida(r), false, `${r} no puede existir en un despliegue de Dr Electrum`);
    }
  });

  await t.test('y deja pasar lo suyo', async () => {
    const p = await comoSi('electrum');
    for (const r of [
      '/api/electrum/turno',
      '/api/electrum/salud',
      '/api/electrum/subir',
      '/api/electrum/informe/abc',
      '/api/electrum/telegram/webhook',
      '/api/health',
    ]) {
      assert.equal(p.rutaPermitida(r), true, `${r} es suya`);
    }
  });

  await t.test('la puerta se comparte: la sesión es una sola', async () => {
    const p = await comoSi('electrum');
    // `/api/ultron/entrar` se queda porque la APK ya publicada la usa. Quitarla dejaría sin entrar
    // a los teléfonos instalados, que no se actualizan porque cambiemos de opinión con los nombres.
    for (const r of ['/api/ultron/entrar', '/api/ultron/salir', '/api/ultron/sesion', '/api/ultron/biometric-login']) {
      assert.equal(p.rutaPermitida(r), true, `${r} hace falta para entrar`);
    }
    assert.equal(p.rutaPermitida('/api/ultron/salud'), false, 'lo demás de AU-RA, no');
  });

  await t.test('es una lista de permitidos: lo que se invente mañana no entra solo', async () => {
    const p = await comoSi('electrum');
    assert.equal(p.rutaPermitida('/api/ruta-que-alguien-agregue-el-mes-que-viene'), false);
  });

  await t.test('y al revés: AU-RA FP no sirve el catastro', async () => {
    const p = await comoSi('ultron');
    assert.equal(p.rutaPermitida('/api/electrum/turno'), false);
    assert.equal(p.rutaPermitida('/api/electrum/salud'), false);
    assert.equal(p.rutaPermitida('/api/ejecutar'), true, 'eso sí es suyo');
  });

  await t.test('sin variable es Dr Electrum, que es el que hoy vive en Render', async () => {
    delete process.env.PLATAFORMA;
    const p = (await import(`../lib/plataforma.ts?${Math.random()}`)) as typeof import('../lib/plataforma');
    assert.equal(p.PLATAFORMA, 'electrum');
    assert.equal(p.PAGINA_RAIZ, 'electrum.html');
  });
});

/* ------------------------------------------------- contra el servidor de verdad */

const SERVIDOR = path.join(process.cwd(), 'dist', 'server.cjs');
const PUERTO = 7803;
const BASE = `http://127.0.0.1:${PUERTO}`;
const hay = fs.existsSync(SERVIDOR);
let proc: ChildProcess | null = null;

async function esperar(intentos = 40) {
  for (let i = 0; i < intentos; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return true;
    } catch {
      /* todavía no */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

test(
  'el despliegue de Dr Electrum, contra el binario',
  { skip: hay ? false : 'sin dist/server.cjs: correr `npm run build` antes' },
  async (t) => {
    proc = spawn('node', [SERVIDOR], {
      env: { ...process.env, PLATAFORMA: 'electrum', NODE_ENV: 'production', PORT: String(PUERTO) },
      stdio: 'ignore',
      detached: true,
    });
    assert.ok(await esperar(), 'el servidor no levantó');

    await t.test('el ejecutor de código de AU-RA no existe acá', async () => {
      const r = await fetch(`${BASE}/api/ejecutar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      assert.equal(r.status, 404);
      const j: any = await r.json().catch(() => ({}));
      assert.match(String(j.error || ''), /Dr Electrum FP/);
    });

    await t.test('ni el redespliegue, ni el taller, ni la bóveda', async () => {
      for (const r of ['/api/render/deploy', '/api/taller', '/api/vault/status']) {
        assert.equal((await fetch(`${BASE}${r}`)).status, 404, r);
      }
    });

    await t.test('la puerta de Electrum responde por su nombre y por el viejo', async () => {
      for (const r of ['/api/electrum/entrar', '/api/ultron/entrar']) {
        const res = await fetch(`${BASE}${r}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        // 400 = «faltan correo y clave»: la ruta existe. Un 404 diría que no.
        assert.equal(res.status, 400, r);
      }
    });

    t.after(() => {
      if (proc?.pid) {
        try {
          process.kill(-proc.pid);
        } catch {
          /* ya murió */
        }
      }
    });
  }
);
