import type express from 'express';

/*
 * DOMINIO PRINCIPAL.
 *
 * Con `DOMINIO_PRINCIPAL` (p. ej. electrum.ordenglobal.link), quien abre la app por otra dirección
 * —el enlace de Render, ultron-looi-desk.onrender.com— pasa a la principal con un 301.
 *
 * Solo se mueven las páginas que abre una persona (GET que pide HTML). Las llamadas de máquinas
 * siguen contestando donde llegan: la API, el MCP y su OAuth, los webhooks. Un conector o un bot
 * configurado con el enlace viejo no se rompe por una redirección que no sabe seguir con POST.
 */
const MAQUINAS = /^\/(api|mcp|oauth|authorize|token|register|\.well-known|telegram|webhook)(\/|$)/i;

export function dominioPrincipal(): string {
  return String(process.env.DOMINIO_PRINCIPAL || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
}

export function redirigirADominio(req: express.Request, res: express.Response, next: express.NextFunction) {
  const principal = dominioPrincipal();
  if (!principal) return next();
  const host = String(req.hostname || '').toLowerCase();
  if (!host || host === principal || host === 'localhost' || /^[\d.]+$/.test(host)) return next();
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (MAQUINAS.test(req.path)) return next();
  if (!/text\/html/i.test(String(req.headers.accept || ''))) return next();
  return res.redirect(301, `https://${principal}${req.originalUrl}`);
}
