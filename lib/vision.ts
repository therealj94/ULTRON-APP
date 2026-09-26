/**
 * Ver imágenes de verdad: ojo Playwright primero, Gemini de reserva. Si no hay clave, se dice.
 */

import { clave } from './boveda';
import { destinoPublico } from './red-publica';

export type Vista = { texto: string; via: string; foto?: Buffer };

function dataUrlAPartes(raw: string): { mime: string; b64: string } {
  const m = String(raw || '').match(/^data:([^;]+);base64,(.+)$/);
  if (m) return { mime: m[1], b64: m[2] };
  return { mime: 'image/jpeg', b64: String(raw || '').replace(/^base64,/, '') };
}

function bufferDeCualquierFoto(j: any): Buffer | undefined {
  const b64 = j?.imagen || j?.image || j?.png || j?.jpeg || j?.foto;
  if (typeof b64 === 'string' && b64.length > 80) {
    const clean = b64.replace(/^data:[^;]+;base64,/, '');
    try {
      const buf = Buffer.from(clean, 'base64');
      if (buf.length > 80) return buf;
    } catch {
      /* */
    }
  }
  if (j?.bytes && typeof j.bytes === 'object') {
    try {
      const buf = Buffer.from(j.bytes);
      if (buf.length > 80) return buf;
    } catch {
      /* */
    }
  }
  return undefined;
}

async function verConOjo(imagen: string, prompt: string): Promise<Vista | null> {
  const url = clave('ojo_url').replace(/\/$/, '');
  const claveOjo = clave('ojo_clave');
  if (!url || !claveOjo) return null;
  const r = await fetch(`${url}/ver`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Ojo-Clave': claveOjo },
    body: JSON.stringify({ imagen, prompt }),
    signal: AbortSignal.timeout(28000),
  });
  const j: any = await r.json().catch(() => ({}));
  const texto = String(j.texto || j.descripcion || j.summary || '').trim();
  if (!texto) return null;
  return { texto: texto.slice(0, 2200), via: `${url}/ver` };
}

async function verConGemini(imagen: string, prompt: string): Promise<Vista | null> {
  const key = clave('gemini');
  if (!key) return null;
  const { mime, b64 } = dataUrlAPartes(imagen);
  const model = process.env.GEMINI_VISION_MODEL || 'gemini-2.0-flash';
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ inline_data: { mime_type: mime, data: b64 } }, { text: prompt }],
          },
        ],
      }),
      signal: AbortSignal.timeout(28000),
    }
  );
  const j: any = await r.json().catch(() => ({}));
  const texto = String(j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '').trim();
  if (!texto) return null;
  return { texto: texto.slice(0, 2200), via: `gemini:${model}` };
}

export async function verImagen(imagen: string, prompt?: string): Promise<Vista> {
  const p = prompt || 'Describe solo lo visible: personas, gestos, objetos, texto y números. No inventes.';
  try {
    const ojo = await verConOjo(imagen, p);
    if (ojo) return ojo;
  } catch (e: any) {
    /* reserva */
  }
  try {
    const gem = await verConGemini(imagen, p);
    if (gem) return gem;
  } catch (e: any) {
    return {
      texto: `VISION: falló (${String(e?.message || e).slice(0, 120)}). No vi la imagen.`,
      via: 'error',
    };
  }
  const falta = [];
  if (!clave('ojo_url') || !clave('ojo_clave')) falta.push('ULTRON_OJO_URL+CLAVE');
  if (!clave('gemini')) falta.push('GEMINI_API_KEY');
  return {
    texto: `VISION: no pude leer la imagen. Falta ${falta.join(' o ') || 'el nodo de visión'}.`,
    via: 'ninguno',
  };
}

export async function capturaPagina(url: string): Promise<{ url: string; texto: string; titulo?: string; foto?: Buffer }> {
  const base = clave('ojo_url').replace(/\/$/, '');
  const claveOjo = clave('ojo_clave');
  if (!base || !claveOjo) return { url, texto: 'Falta el ojo (ULTRON_OJO_URL + CLAVE). No abrí la página.' };
  // Las redirecciones se resuelven aquí, comprobando cada salto: al navegador del nodo le llega el
  // destino final, no un enlace que rebote al metadata de AWS o a la red interna del nodo.
  const destino = await destinoPublico(url);
  if (destino.ok === false) return { url, texto: `No abrí la página: ${destino.error}.` };
  url = destino.url;
  const headers = { 'Content-Type': 'application/json', 'X-Ojo-Clave': claveOjo };
  let texto = '';
  let titulo: string | undefined;
  try {
    const mirar = await fetch(`${base}/mirar`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(25000),
    });
    const visto: any = await mirar.json().catch(() => ({}));
    titulo = visto.titulo || visto.title;
    texto = String(visto.texto || visto.text || visto.textoPlano || '').slice(0, 2500);
  } catch (e: any) {
    texto = `Ojo /mirar falló: ${String(e?.message || e).slice(0, 120)}`;
  }
  let foto: Buffer | undefined;
  try {
    const fotoRes = await fetch(`${base}/foto`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(25000),
    });
    const j: any = await fotoRes.json().catch(() => ({}));
    foto = bufferDeCualquierFoto(j);
  } catch {
    /* captura opcional */
  }
  return { url, texto, titulo, foto };
}
