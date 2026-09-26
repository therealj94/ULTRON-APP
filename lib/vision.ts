/**
 * Ver imágenes de verdad: ojo Playwright primero, Gemini de reserva. Si no hay clave, se dice —
 * en el registro, con el nombre de la variable; a quien mandó la foto, con una frase que entienda.
 */

import { clave } from './boveda';
import { destinoPublico } from './red-publica';
import { presupuesto, type Presupuesto } from './presupuesto';

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

/**
 * La frase para quien mandó la foto cuando no se pudo ver. Fija y sin nombres de variables: antes
 * una cuota agotada de Gemini (429) terminaba diciéndole «Falta GEMINI_API_KEY» —mentira, la llave
 * estaba— y encima le enseñaba cómo se llaman las piezas del servidor. El detalle va al registro.
 */
export const NO_PUDE_VER = 'No pude ver la imagen ahora mismo.';

/** Sin cliente esperando (Telegram, cargas): lo que sumaban los dos topes de siempre. */
const PRESUPUESTO_SIN_APURO_MS = 56_000;

async function verConOjo(imagen: string, prompt: string, reloj: Presupuesto): Promise<Vista | null> {
  const url = clave('ojo_url').replace(/\/$/, '');
  const claveOjo = clave('ojo_clave');
  if (!url || !claveOjo) return null;
  const r = await fetch(`${url}/ver`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Ojo-Clave': claveOjo },
    body: JSON.stringify({ imagen, prompt }),
    signal: reloj.senal(28000),
  });
  if (!r.ok) {
    console.warn('[vision ojo]', r.status, (await r.text().catch(() => '')).slice(0, 160));
    return null;
  }
  const j: any = await r.json().catch(() => ({}));
  const texto = String(j.texto || j.descripcion || j.summary || '').trim();
  if (!texto) return null;
  return { texto: texto.slice(0, 2200), via: `${url}/ver` };
}

async function verConGemini(imagen: string, prompt: string, reloj: Presupuesto): Promise<Vista | null> {
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
      signal: reloj.senal(28000),
    }
  );
  // Cuota (429), llave vencida (403), modelo retirado (404): se registra el código que dio Gemini,
  // que es lo único que dice qué arreglar. Antes esto se tragaba y parecía «falta configuración».
  if (!r.ok) {
    console.warn('[vision gemini]', model, r.status, (await r.text().catch(() => '')).slice(0, 160));
    return null;
  }
  const j: any = await r.json().catch(() => ({}));
  const texto = String(j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '').trim();
  if (!texto) {
    console.warn('[vision gemini]', model, 'contestó sin texto', String(j?.promptFeedback?.blockReason || j?.candidates?.[0]?.finishReason || '').slice(0, 60));
    return null;
  }
  return { texto: texto.slice(0, 2200), via: `gemini:${model}` };
}

/**
 * `via` es `ninguno` si no hay ningún ojo configurado, `tiempo` si el cliente ya no esperaba, y
 * `error` si los que había fallaron. En los tres casos `texto` es `NO_PUDE_VER`.
 */
export function vistaFallida(v: Vista): boolean {
  return v.via === 'ninguno' || v.via === 'error' || v.via === 'tiempo';
}

export async function verImagen(imagen: string, prompt?: string, opts: { presupuesto?: Presupuesto } = {}): Promise<Vista> {
  const p = prompt || 'Describe solo lo visible: personas, gestos, objetos, texto y números. No inventes.';
  const reloj = opts.presupuesto || presupuesto(PRESUPUESTO_SIN_APURO_MS);
  const ojoListo = !!(clave('ojo_url') && clave('ojo_clave'));
  const geminiListo = !!clave('gemini');
  if (!ojoListo && !geminiListo) {
    console.warn('[vision] sin ojo: falta ULTRON_OJO_URL+ULTRON_OJO_CLAVE o GEMINI_API_KEY');
    return { texto: NO_PUDE_VER, via: 'ninguno' };
  }
  const intentos: [string, boolean, typeof verConOjo][] = [
    ['ojo', ojoListo, verConOjo],
    ['gemini', geminiListo, verConGemini],
  ];
  for (const [nombre, listo, ver] of intentos) {
    if (!listo) continue;
    if (!reloj.alcanza()) {
      console.warn(`[vision] sin tiempo para ${nombre}: el cliente ya no espera esta respuesta`);
      return { texto: NO_PUDE_VER, via: 'tiempo' };
    }
    try {
      const vista = await ver(imagen, p, reloj);
      if (vista) return vista;
    } catch (e: any) {
      console.warn(`[vision] ${nombre} falló:`, String(e?.message || e).slice(0, 120));
    }
  }
  return { texto: NO_PUDE_VER, via: reloj.alcanza() ? 'error' : 'tiempo' };
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
