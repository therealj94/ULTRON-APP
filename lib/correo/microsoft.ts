/**
 * ENTRAR AL CORREO DE MICROSOFT (Outlook, Hotmail, Live, Microsoft 365) con OAuth2.
 *
 * Microsoft apagó las contraseñas para IMAP/SMTP: hay que pedir un permiso con OAuth2. Se usa el flujo de
 * «código en otro aparato» (device code, el de las teles y las consolas): la app muestra un código, la
 * persona lo escribe en microsoft.com/devicelogin con su cuenta, y el servidor recibe un token de
 * acceso y uno de renovación. No hace falta página de retorno ni guardar contraseñas.
 *
 * Permisos (los que Microsoft documenta para IMAP y SMTP con OAuth): IMAP.AccessAsUser.All, SMTP.Send y
 * offline_access (para renovar sin volver a preguntar).
 *
 * Requiere MS_CLIENT_ID: una app registrada en portal.azure.com (gratis) con «cuentas personales y de
 * organización» y «flujos de cliente público» activados. Sin ella, Outlook se ofrece como no disponible.
 */
import { clave } from '../boveda';

const AUTORIDAD = 'https://login.microsoftonline.com/common/oauth2/v2.0';
export const PERMISOS_MICROSOFT = 'offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send';

export function microsoftConfigurado(): boolean {
  return !!clave('ms_client_id');
}

export type CodigoDispositivo = { codigoDispositivo: string; codigoUsuario: string; url: string; venceEn: number; intervalo: number; mensaje: string };
export type TokensMicrosoft = { acceso: string; renovacion: string; venceEl: number };

type Fetch = typeof fetch;

async function formulario(url: string, datos: Record<string, string>, traer: Fetch = fetch): Promise<any> {
  const r = await traer(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(datos).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const j: any = await r.json().catch(() => ({}));
  return { status: r.status, ...j };
}

/** Pide el código que la persona escribe en microsoft.com/devicelogin. */
export async function pedirCodigo(traer: Fetch = fetch): Promise<CodigoDispositivo> {
  const j = await formulario(`${AUTORIDAD}/devicecode`, { client_id: clave('ms_client_id'), scope: PERMISOS_MICROSOFT }, traer);
  if (!j.device_code) throw new Error(j.error_description || j.error || 'Microsoft no dio el código');
  return {
    codigoDispositivo: j.device_code,
    codigoUsuario: j.user_code,
    url: j.verification_uri || 'https://microsoft.com/devicelogin',
    venceEn: Number(j.expires_in) || 900,
    intervalo: Number(j.interval) || 5,
    mensaje: j.message || '',
  };
}

/**
 * Una consulta: ¿ya entró? `pendiente` mientras la persona no termina; los tokens cuando sí; un error si
 * venció o lo rechazó.
 */
export async function consultarCodigo(codigoDispositivo: string, traer: Fetch = fetch): Promise<{ estado: 'pendiente' } | { estado: 'listo'; tokens: TokensMicrosoft } | { estado: 'error'; error: string }> {
  const j = await formulario(
    `${AUTORIDAD}/token`,
    { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: clave('ms_client_id'), device_code: codigoDispositivo },
    traer
  );
  if (j.access_token) return { estado: 'listo', tokens: aTokens(j) };
  if (j.error === 'authorization_pending' || j.error === 'slow_down') return { estado: 'pendiente' };
  const porque: Record<string, string> = {
    expired_token: 'El código venció. Pide otro.',
    authorization_declined: 'Se rechazó el permiso en Microsoft.',
    bad_verification_code: 'El código no es válido.',
  };
  return { estado: 'error', error: porque[j.error] || j.error_description || j.error || 'Microsoft no contestó' };
}

/** Un token de acceso nuevo con el de renovación (Microsoft puede devolver también un renovación nuevo). */
export async function renovar(renovacion: string, traer: Fetch = fetch): Promise<TokensMicrosoft> {
  const j = await formulario(
    `${AUTORIDAD}/token`,
    { grant_type: 'refresh_token', client_id: clave('ms_client_id'), refresh_token: renovacion, scope: PERMISOS_MICROSOFT },
    traer
  );
  if (!j.access_token) throw new Error(j.error_description || j.error || 'No pude renovar el permiso de Microsoft');
  return aTokens(j, renovacion);
}

function aTokens(j: any, renovacionVieja = ''): TokensMicrosoft {
  return { acceso: j.access_token, renovacion: j.refresh_token || renovacionVieja, venceEl: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
}
