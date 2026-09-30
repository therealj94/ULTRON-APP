#!/usr/bin/env node
/**
 * EL RESPALDO 2D DE UN AVATAR QUE SOLO EXISTE EN 3D (hoy, ANT-ONIO): sus fotos, sacadas de su .glb.
 *
 *   node scripts/avatar3d-fotos.mjs antonio
 *
 * Claudio tiene las ilustraciones de José (assets/avatares/claudio y claudio-pie); ANT-ONIO no tiene
 * dibujos propios, así que sus fotos se renderizan con la MISMA escena que va en la APK
 * (mobile/src/avatar3d/escenaHtml.ts) y su modelo (mobile/assets/avatar3d/antonio.glb), en un
 * Chromium sin pantalla, con fondo transparente. Salen con los nombres y medidas de las de Claudio,
 * así el retrato (ClaudioRetrato), el de pie (ClaudioDePie), la compañera y la figurita 2D las usan
 * igual: se ven si el teléfono no aguanta el 3D o mientras arranca.
 *
 *   retrato 768×768 (assets/avatares/<avatar>/): base, canta, risa, sorpresa, pensando, sueno, mira,
 *           aparta, perfil y habla1–3 (la boca de menos a más abierta);
 *   de pie  720×1080 (assets/avatares/<avatar>-pie/): base, cierra (boca junta), habla1, habla2.
 *
 * Hace falta playwright-core y un Chromium (PLAYWRIGHT_BROWSERS_PATH o CHROME=/ruta); sharp para WebP.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOVIL = path.join(RAIZ, 'mobile');

const QUIETA = { expresion: 'tranquila', hablando: false, escuchando: false, silenciado: false, pensando: false, caminando: false, dir: 1, mirar: { x: 0, y: 0, activa: false }, gesto: null, globo: '' };
const habla = (nivel, visema = 'aa') => ({ estado: { hablando: true }, boca: { nivel, visema, peso: 1 } });

/** Cada foto: el estado del alma y la boca (lo mismo que recibe el cuerpo en el teléfono). */
export const FOTOS = {
  retrato: {
    base: {},
    canta: { estado: { expresion: 'contenta', hablando: true }, boca: { nivel: 0.55, visema: 'O', peso: 1 } },
    risa: { estado: { expresion: 'contenta' } },
    sorpresa: { estado: { expresion: 'sorprendida' } },
    pensando: { estado: { expresion: 'piensa' } },
    sueno: { estado: { expresion: 'dormida', silenciado: true } },
    mira: { estado: { mirar: { x: -0.95, y: 0.05, activa: true } } },
    aparta: { estado: { expresion: 'triste' } },
    perfil: { estado: { mirar: { x: 1, y: 0, activa: true } } },
    habla1: habla(0.3),
    habla2: habla(0.6),
    habla3: habla(0.95),
  },
  pie: {
    base: {},
    cierra: habla(0.8, 'PP'),
    habla1: habla(0.45),
    habla2: habla(0.9),
  },
};

function buscarChrome() {
  if (process.env.CHROME && fs.existsSync(process.env.CHROME)) return process.env.CHROME;
  for (const base of [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(process.env.HOME || '', '.cache/ms-playwright'), '/opt/pw-browsers'].filter(Boolean)) {
    if (!fs.existsSync(base)) continue;
    for (const d of fs.readdirSync(base).sort().reverse()) {
      const p = path.join(base, d, 'chrome-linux/chrome');
      if (d.startsWith('chromium') && fs.existsSync(p)) return p;
    }
  }
  return undefined;
}

export async function fotografiar(avatar) {
  const { chromium } = await import('playwright-core');
  const sharp = (await import('sharp')).default;
  const glb = fs.readFileSync(path.join(MOVIL, `assets/avatar3d/${avatar}.glb`));
  const rutaMapeo = path.join(MOVIL, `assets/avatar3d/${avatar}.mapeo.json`);
  const mapeo = fs.existsSync(rutaMapeo) ? JSON.parse(fs.readFileSync(rutaMapeo, 'utf8')) : null;
  const fuente = fs.readFileSync(path.join(MOVIL, 'src/avatar3d/escenaHtml.ts'), 'utf8');
  const html = JSON.parse(/export const ESCENA_HTML = (".*");\s*$/m.exec(fuente)[1]);
  const nav = await chromium.launch({ executablePath: buscarChrome(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const hechas = [];
  try {
    for (const [tipo, fotos] of Object.entries(FOTOS)) {
      const [ancho, alto, camara, carpeta] = tipo === 'retrato' ? [768, 768, 'retrato', avatar] : [720, 1080, 'cuerpo', `${avatar}-pie`];
      const destino = path.join(MOVIL, 'assets/avatares', carpeta);
      fs.mkdirSync(destino, { recursive: true });
      for (const [nombre, f] of Object.entries(fotos)) {
        // Una página por foto: el reloj de la animación arranca siempre de cero (la misma pose).
        const pag = await nav.newPage({ viewport: { width: ancho / 2, height: alto / 2 }, deviceScaleFactor: 2 });
        await pag.setContent(html);
        await pag.waitForFunction(() => (window.__avatarSalida || []).some((m) => m.tipo === 'lista' || m.tipo === 'fallo'));
        await pag.evaluate((m) => window.__avatar({ tipo: 'config', camara: m.camara, fpsMax: 60, dprMax: 2, mapeo: m.mapeo, reducido: false }), { camara, mapeo });
        const PASO = 3 * 65536;
        const total = Math.ceil(glb.length / PASO);
        for (let i = 0; i < total; i++) await pag.evaluate((m) => window.__avatar(m), { tipo: 'trozo', i, total, b64: glb.subarray(i * PASO, (i + 1) * PASO).toString('base64') });
        await pag.evaluate((n) => window.__avatar({ tipo: 'fin', bytes: n }), glb.length);
        await pag.waitForFunction(() => (window.__avatarSalida || []).some((m) => m.tipo === 'listo' || m.tipo === 'fallo'), null, { timeout: 90_000 });
        const fallo = await pag.evaluate(() => (window.__avatarSalida || []).find((m) => m.tipo === 'fallo'));
        if (fallo) throw new Error(`${avatar}/${nombre}: ${fallo.motivo}`);
        await pag.evaluate(
          ([e, b]) => {
            window.__avatarPrueba.calidad('alta');
            window.__avatar({ tipo: 'estado', estado: e });
            if (b) window.__avatar({ tipo: 'boca', ...b });
            window.__avatarPrueba.avanzar(1.2);
          },
          [{ ...QUIETA, ...(f.estado || {}) }, f.boca || null]
        );
        const png = await pag.screenshot({ omitBackground: true });
        await pag.close();
        const archivo = path.join(destino, `${nombre}.webp`);
        await sharp(png).resize(ancho, alto).webp({ quality: 80, alphaQuality: 90, effort: 6 }).toFile(archivo);
        hechas.push(archivo);
      }
    }
  } finally {
    await nav.close();
  }
  return hechas;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const avatar = process.argv[2] || 'antonio';
  const hechas = await fotografiar(avatar);
  const kb = hechas.reduce((s, f) => s + fs.statSync(f).size, 0) / 1024;
  console.log(`${avatar}: ${hechas.length} fotos · ${kb.toFixed(0)} KB\n${hechas.map((f) => '  ' + path.relative(RAIZ, f)).join('\n')}`);
}
