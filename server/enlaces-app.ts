/**
 * LA VUELTA DE LA WALLET POR HTTPS (App Links de Android).
 *
 * La wallet devolvía el pase de Genesis ID a `ultronfp://sso?pase=…&estado=…`. Un esquema propio no
 * tiene dueño: cualquier app puede declarar `ultronfp://` y Android le ofrece el enlace. El reto
 * (PKCE) ya dejaba ese pase inservible para quien lo robara, pero la entrada se caía igual.
 *
 * Ahora la app nueva pide la vuelta a `https://aura-fp.onrender.com/sso`. Ese dominio es nuestro, y
 * Android solo le entrega el enlace a la app que el dominio reconoce en
 * `/.well-known/assetlinks.json` (paquete + huella del certificado con que se firmó la APK). Otra app
 * puede declarar el mismo dominio, pero sin nuestra firma Android no la verifica.
 *
 *   · GET /.well-known/assetlinks.json → la declaración para `link.ordenglobal.ultronfp` con las
 *     huellas de ANDROID_CERT_SHA256 (separadas por comas). Sin la variable, 404: una huella
 *     inventada o la de la keystore debug (que es pública) no protege nada.
 *   · GET /sso → si el enlace se abre en el navegador (la app no está instalada o Android todavía no
 *     verificó el dominio), una página mínima con un botón que abre AU-RA con `intent://` atado al
 *     PAQUETE: ahí Android no le pregunta a ninguna otra app que tenga `ultronfp://`. Si la entrada
 *     empezó en la WEB (iPhone, escritorio; un intento registrado en server/sso-web.ts), la vuelta se
 *     queda en el servidor para que la web la recoja con su verificador, sin intent ni pase en la página.
 *
 * El pase viaja en la query de /sso: la página no lo muestra, no se guarda en caché, no se manda a
 * otros sitios como Referer y este servidor no registra la query de ninguna petición (no hay
 * registrador de peticiones; que nadie ponga uno que escriba `req.url` sin quitar esta ruta).
 */
import { createHash } from 'node:crypto';
import type { Express, Response } from 'express';
import { depositarVuelta, esIntentoWeb } from './sso-web';

export const PAQUETE_AURA = 'link.ordenglobal.ultronfp';
const ESQUEMA_AURA = 'ultronfp';

/**
 * Las huellas SHA-256 de ANDROID_CERT_SHA256, en la forma que pide Android («AB:CD:…», mayúsculas).
 * Se aceptan con o sin dos puntos (apksigner las imprime sin ellos); lo que no mide 32 bytes se
 * descarta en vez de publicarse torcido.
 */
export function huellasCertificado(valor: string | undefined = process.env.ANDROID_CERT_SHA256): string[] {
  const vistas = new Set<string>();
  for (const parte of String(valor || '').split(',')) {
    const hex = parte.replace(/[\s:]/g, '').toUpperCase();
    if (!/^[0-9A-F]{64}$/.test(hex)) continue;
    vistas.add(hex.match(/../g)!.join(':'));
  }
  return [...vistas];
}

/** Lo que Android lee para verificar el dominio (Digital Asset Links). */
export function declaracionAssetLinks(huellas: string[]) {
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: PAQUETE_AURA, sha256_cert_fingerprints: huellas },
    },
  ];
}

/*
 * Lo único que se reenvía a la app: los parámetros del contrato con la wallet, con la forma que
 * pueden tener. El `estado` lo inventa el teléfono (base64url); el pase es un token (base64url, con
 * puntos si es de tres partes); el error, un código en minúsculas (`cancelado`, `sin-gid`…).
 */
const FORMA: Record<'pase' | 'estado' | 'error', RegExp> = {
  pase: /^[A-Za-z0-9._~+/=-]{1,4096}$/,
  estado: /^[A-Za-z0-9_-]{8,128}$/,
  error: /^[a-z][a-z0-9-]{0,39}$/,
};
type Vuelta = Partial<Record<keyof typeof FORMA, string>>;

/**
 * La query de /sso validada, o null si trae cualquier cosa que no sea exactamente la vuelta de la
 * wallet: una clave de más, una repetida, un valor con otra forma, sin `estado`, o pase y error a la
 * vez. Se lee de la URL cruda (no de `req.query`, que convierte `a[b]=c` en objetos).
 */
export function vueltaValida(urlCruda: string): Vuelta | null {
  const i = urlCruda.indexOf('?');
  if (i < 0) return null;
  let q: URLSearchParams;
  try {
    q = new URLSearchParams(urlCruda.slice(i + 1).split('#')[0]);
  } catch {
    return null;
  }
  const v: Vuelta = {};
  for (const [k, valor] of q) {
    if (!(k in FORMA)) return null;
    const clave = k as keyof typeof FORMA;
    if (v[clave] !== undefined || !FORMA[clave].test(valor)) return null;
    v[clave] = valor;
  }
  if (!v.estado || Boolean(v.pase) === Boolean(v.error)) return null;
  return v;
}

/** `intent://` al paquete de AU-RA: Chrome abre ESA app (o su ficha en la tienda), ninguna otra. */
export function intentDeVuelta(v: Vuelta): string {
  const q = (['pase', 'error', 'estado'] as const)
    .filter((k) => v[k] !== undefined)
    .map((k) => `${k}=${encodeURIComponent(v[k] as string)}`)
    .join('&');
  return `intent://sso?${q}#Intent;scheme=${ESQUEMA_AURA};package=${PAQUETE_AURA};end`;
}

const escaparHtml = (s: string) =>
  s.replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' })[c] as string);

/*
 * El estilo va en línea y la CSP lo permite por su huella: la página no carga nada de fuera, no
 * tiene scripts ni formularios, y nada la puede meter en un marco.
 */
const ESTILO = [
  ':root{color-scheme:light dark;--fondo:#f6f4ef;--texto:#232528;--suave:#5f6368;--acento:#9a7420;--sobre:#fff}',
  '@media (prefers-color-scheme:dark){:root{--fondo:#232528;--texto:#f1efe9;--suave:#a9abb0;--acento:#e2bd6b;--sobre:#232528}}',
  '*{box-sizing:border-box}',
  'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--fondo);color:var(--texto);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:24px 16px}',
  'main{max-width:420px;width:100%;text-align:center}',
  'h1{font-size:1.45rem;font-weight:600;margin:0 0 12px}',
  'p{margin:0 0 20px;color:var(--suave)}',
  '.marca{letter-spacing:.18em;font-size:.75rem;color:var(--acento);margin-bottom:20px}',
  '.boton{display:inline-block;background:var(--acento);color:var(--sobre);text-decoration:none;font-weight:600;padding:14px 28px;border-radius:999px}',
  '.nota{font-size:.85rem;margin-top:24px}',
].join('');
const CSP = [
  "default-src 'none'",
  `style-src 'sha256-${createHash('sha256').update(ESTILO).digest('base64')}'`,
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** La página de /sso. Nada de la query aparece en ella salvo dentro del `intent://` ya validado. */
export function paginaSso(v: Vuelta | null): string {
  const cuerpo = v
    ? `<h1>Abrí AU-RA para terminar de entrar</h1>
<p>Tu wallet ya respondió. Tocá el botón para volver a la app y terminar la entrada con tu Genesis ID.</p>
<a class="boton" href="${escaparHtml(intentDeVuelta(v))}">Abrir AU-RA</a>
<p class="nota">Funciona en el teléfono Android donde tenés instalada AU-RA FP. Si no se abre, abrí la app y tocá «Entrar con Genesis ID» otra vez.</p>`
    : `<h1>Abrí AU-RA para terminar de entrar</h1>
<p>Este enlace no trae una respuesta válida de tu wallet. Abrí AU-RA FP en tu teléfono y tocá «Entrar con Genesis ID» otra vez.</p>`;
  return pagina(cuerpo);
}

/**
 * La página de /sso cuando la entrada empezó en la WEB (server/sso-web.ts; IOS01): la vuelta ya quedó en
 * el servidor, atada a su intento. Nada de la query aparece aquí, ni siquiera en un enlace: «Volver a
 * AU-RA» lleva a la raíz y la web recoge la vuelta con su verificador.
 */
export function paginaSsoWeb(v: Vuelta): string {
  const cuerpo = v.pase
    ? `<h1>Listo: tu wallet respondió</h1>
<p>Volvé a AU-RA para terminar de entrar con tu Genesis ID.</p>
<a class="boton" href="/">Volver a AU-RA</a>
<p class="nota">Si empezaste desde el ícono de AU-RA en tu iPhone, volvé a ese ícono: termina solo. Este enlace vence en unos minutos.</p>`
    : `<h1>La entrada no se completó</h1>
<p>Tu wallet no terminó de dar el permiso. Volvé a AU-RA para ver qué pasó y probar otra vez.</p>
<a class="boton" href="/">Volver a AU-RA</a>`;
  return pagina(cuerpo);
}

function pagina(cuerpo: string): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>AU-RA FP</title>
<style>${ESTILO}</style>
</head>
<body>
<main>
<div class="marca">AU-RA FP</div>
${cuerpo}
</main>
</body>
</html>
`;
}

/** Ni el navegador ni un proxy guardan una respuesta que puede llevar un pase en su URL. */
function sinCache(res: Response) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
}

export function montarEnlacesApp(app: Express) {
  app.get('/.well-known/assetlinks.json', (_req, res) => {
    const huellas = huellasCertificado();
    if (!huellas.length) {
      sinCache(res);
      return res.status(404).type('application/json').send(JSON.stringify({ error: 'Sin huella de certificado configurada.' }));
    }
    // Android la pide al instalar y cada tanto; una hora de caché basta y un cambio de firma se nota pronto.
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.status(200).type('application/json').send(JSON.stringify(declaracionAssetLinks(huellas)));
  });

  app.get('/sso', (req, res) => {
    sinCache(res);
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    const v = vueltaValida(req.originalUrl || req.url || '');
    // La entrada empezó en la web (iPhone, escritorio): la vuelta se queda en el servidor, atada a su
    // intento, y la web la recoge con su verificador. Sin intento web, lo de siempre (Android).
    if (v && esIntentoWeb(v.estado)) {
      depositarVuelta(v);
      return res.status(200).type('html').send(paginaSsoWeb(v));
    }
    res.status(v ? 200 : 400).type('html').send(paginaSso(v));
  });
}
