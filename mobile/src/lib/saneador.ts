/**
 * LO QUE EL DIAGNÓSTICO NO PUEDE LLEVAR (auditoría A23). Antes de mandar a /api/diag el mensaje de un
 * error, su pila o una miga, se tapa lo sensible: tokens, claves, correos, parámetros de URL, números
 * de teléfono y cadenas opacas largas. Es la MISMA regla que aplica el servidor (lib/diag-saneador.ts):
 * una prueba (tests/diag-saneador.test.ts) comprueba que los dos tapan igual. Sin nada nativo.
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
