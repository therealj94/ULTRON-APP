/**
 * A QUIÉN SE LE MARCA (auditoría del 7-oct, A-4): los contactos con número de la persona, para resolver «don Carlos del
 * banco» en un número (lib/marcar.ts resolverParaMarcar).
 *
 *   · los chats de uno a uno y los contactos guardados de su WhatsApp (el puente: server/whatsapp.ts), si lo tiene;
 *   · su círculo cercano (lib/circulo.ts: su teléfono o su WhatsApp);
 *   · los contactos que el teléfono contó en /api/app/contexto (lib/acciones-app.ts): los nombres siempre (para decir
 *     «a X lo tengo en tus chats de AU-RA, sin número») y el número si lo trae.
 * Sin expo-contacts ni permiso nuevo del teléfono. Todo con tope de tiempo: si algo no contesta, se resuelve con lo que
 * haya y, si no alcanza, se pregunta el número (nunca se inventa uno).
 */
import type { ContextoApp } from '../lib/acciones-app';
import { circuloDe } from '../lib/circulo';
import { esSoloNumero, numeroDe, resolverParaMarcar, type ContactoTel, type ResolucionMarcar } from '../lib/marcar';
import { contactosParaMarcarWA } from './whatsapp';

type PersonaConNumero = { nombre: string; alias?: string[]; canales: { telefono?: string; whatsapp?: string } };

/** `p`, o `vacio` si tarda más de `ms` (el reloj se suelta en cuanto contesta). Nunca lanza. */
function conTope<T>(p: Promise<T>, ms: number, vacio: T): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const tope = new Promise<T>((r) => {
    t = setTimeout(() => r(vacio), ms);
  });
  return Promise.race([p.catch(() => vacio), tope]).finally(() => clearTimeout(t));
}

/** Lo que se busca en el puente: lo dicho sin «a», «mi», «don»… (las palabras que identifican). */
function terminoDe(dicho: string): string {
  return String(dicho || '')
    .replace(/^\s*(a mi|a|al|el|la|mi|mis)\s+/i, '')
    .replace(/^\s*(don|doña|dona|doctor|doctora|ingeniero|ingeniera|licenciado|licenciada)\s+/i, '')
    .trim()
    .slice(0, 60);
}

export type DepsMarcar = {
  whatsapp?: (quien: string, buscar: string, ms: number) => Promise<Array<{ nombre: string; numero: string }>>;
  circulo?: (dueno: string) => Promise<PersonaConNumero[]>;
};

/** Los contactos con número que pueden ser «lo dicho». Nunca lanza. */
export async function contactosParaMarcar(o: { dueno: string; dicho: string; contexto?: ContextoApp | null; ms?: number }, d: DepsMarcar = {}): Promise<ContactoTel[]> {
  const ms = o.ms ?? 2500;
  const termino = terminoDe(o.dicho);
  const deApp: ContactoTel[] = (o.contexto?.contactos || []).filter((c) => c.telefono).map((c) => ({ nombre: c.nombre, numero: c.telefono!, fuente: 'app' }));
  if (!o.dueno || !termino) return deApp;
  const wa = d.whatsapp || contactosParaMarcarWA;
  const ci = d.circulo || ((dueno: string) => circuloDe(dueno) as Promise<PersonaConNumero[]>);
  const [deWa, personas] = await Promise.all([conTope(wa(o.dueno, termino, ms), ms + 200, [] as Array<{ nombre: string; numero: string }>), conTope(ci(o.dueno), ms, [] as PersonaConNumero[])]);
  const deCirculo: ContactoTel[] = [];
  for (const p of personas) {
    // El jid de WhatsApp («50499990000@s.whatsapp.net») lleva el número con su país.
    const crudo = p.canales?.telefono || String(p.canales?.whatsapp || '').replace(/@.*$/, '');
    const numero = numeroDe(/^\d{11,15}$/.test(crudo) ? `+${crudo}` : crudo);
    if (!numero) continue;
    deCirculo.push({ nombre: p.nombre, numero, fuente: 'circulo', ...(p.alias?.length ? { alias: p.alias.filter(Boolean) } : {}) });
  }
  return [...deApp, ...deCirculo, ...deWa.map((c) => ({ nombre: c.nombre, numero: c.numero, fuente: 'whatsapp' as const }))];
}

/** A quién se refiere lo dicho, con sus contactos (o el número tal cual). */
export async function resolverMarcar(o: { dueno: string; dicho: string; contexto?: ContextoApp | null; ms?: number }, d: DepsMarcar = {}): Promise<ResolucionMarcar> {
  if (esSoloNumero(o.dicho)) return resolverParaMarcar(o.dicho, []);
  const contactos = await contactosParaMarcar(o, d);
  return resolverParaMarcar(o.dicho, contactos, { nombresApp: (o.contexto?.contactos || []).map((c) => c.nombre) });
}
