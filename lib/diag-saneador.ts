/**
 * EL DIAGNÓSTICO DE CAMPO SIN DATOS SENSIBLES (POST /api/diag; auditoría A23).
 *
 * El teléfono manda al servidor el mensaje de un error, su pila y sus migas. Un mensaje de excepción
 * puede llevar dentro lo que no debe llegar a un log: un token, una clave, un correo, la URL con sus
 * parámetros, un número de teléfono. Aquí:
 *  · solo pasan los campos conocidos (lista cerrada), cada uno con su largo máximo;
 *  · todo texto va en UNA línea (nadie escribe líneas falsas en el log) y se le tapa lo sensible.
 * El teléfono hace lo mismo antes de mandar (mobile/src/lib/saneador.ts, la misma regla): lo que no
 * sale del teléfono no hay que taparlo después. Una prueba comprueba que los dos tapan igual.
 */

/** Tapa lo sensible de un texto y lo deja en una sola línea de como mucho `max` caracteres. */
export function sanearTexto(v: unknown, max = 300): string {
  let t = String(v ?? '');
  t = t.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ');
  // Tokens con forma de JWT o de sesión firmada (tres partes base64url, como `u1.<cuerpo>.<firma>`).
  t = t.replace(/\b[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[token]');
  t = t.replace(/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, '$1 [oculto]');
  // clave=valor, "clave": "valor", clave: valor.
  t = t.replace(
    /\b(token|clave|password|passwd|pass|pwd|contrase(?:ñ|n)a|secret|secreto|api[_-]?key|key|llave|pase|authorization|cookie|sesion|x-ultron-sesion|verificador)(["']?\s*[:=]\s*["']?)[^\s"'&,;]+/gi,
    '$1$2[oculto]'
  );
  // Las URL se quedan sin parámetros (ahí viajan tokens y datos).
  t = t.replace(/\b(https?:\/\/[^\s?#"']+)\?[^\s#"']*/gi, '$1?[…]');
  t = t.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[correo]');
  // Teléfonos y números largos (9 o más cifras, con o sin separadores).
  t = t.replace(/\+?\d(?:[\s().-]?\d){8,}/g, '[número]');
  // Cadenas opacas largas (llaves, base64): no se sabe qué son, no se escriben.
  t = t.replace(/\b[A-Za-z0-9+/_-]{32,}={0,2}/g, '[secreto]');
  t = t.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max) : t;
}

export type Diag = {
  tipo: string;
  version: string;
  plataforma: string;
  dispositivo: string;
  sesion: string;
  fatal?: boolean;
  error?: string;
  stack?: string;
  murio_en?: string;
  nota?: string;
  migas: string[];
};

const TIPOS = ['estado', 'crash-previo', 'error-js', 'promesa'];

/** Lo que llega a /api/diag, reducido a los campos conocidos y saneado. */
export function sanearDiag(b: unknown): Diag {
  const x = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>;
  const tipo = TIPOS.includes(String(x.tipo)) ? String(x.tipo) : 'estado';
  const d: Diag = {
    tipo,
    version: sanearTexto(x.version ?? '?', 24),
    plataforma: sanearTexto(x.plataforma ?? '?', 24),
    dispositivo: sanearTexto(x.dispositivo ?? '?', 60),
    // La sesión del reporte es un id al azar de la app (no la de la cuenta): solo letras y números.
    sesion: String(x.sesion ?? '?').replace(/[^a-z0-9]/gi, '').slice(0, 16) || '?',
    migas: Array.isArray(x.migas) ? x.migas.slice(-40).map((m) => sanearTexto(m, 120)) : [],
  };
  if (x.fatal !== undefined) d.fatal = !!x.fatal;
  if (x.error !== undefined) d.error = sanearTexto(x.error, 300);
  if (x.stack !== undefined) d.stack = sanearTexto(x.stack, 900);
  if (x.murio_en !== undefined) d.murio_en = sanearTexto(x.murio_en, 120);
  if (x.nota !== undefined) d.nota = sanearTexto(x.nota, 300);
  return d;
}
