/**
 * PULSE2CHAT por voz (desde el notch): «llama a Karla», «videollamada con Karla», «mándale un mensaje a
 * Karla que…», «mándale 10 ORIGEN a Karla» (abre el envío para firmarlo en Veta Wallet). AURA (C#) ya confirmó los mensajes con un «sí»; aquí se busca a la persona entre tus
 * contactos y conversaciones y se hace. Lo que pasa se cuenta en el notch.
 */
import { al, pedir } from './puente';
import * as RELEVO from './pulse/relevo';
import { llamar } from './pulse';
import { abrirPagar } from './vistas/pulse';
import { montoValido } from './pulse/pagar';

const norma = (s: string) => RELEVO.normalizar(s).replace(/\s+/g, ' ').trim();

/** La persona que más se parece a lo dicho: nombre exacto, nombre que empieza así, o el correo. */
export async function buscarContacto(dicho: string): Promise<RELEVO.Persona | null> {
  const q = norma(dicho);
  if (!q) return null;
  const vistos = new Map<string, RELEVO.Persona>();
  for (const p of RELEVO.contactosConocidos()) vistos.set(p.correo, p);
  try { for (const p of (await RELEVO.circulo()).amigos) vistos.set(p.correo, p); } catch { /* sin red: los conocidos */ }
  try { for (const c of await RELEVO.conversaciones()) if (!c.esGrupo) vistos.set(c.correo, c); } catch { /* idem */ }
  const personas = [...vistos.values()];
  const puntos = (p: RELEVO.Persona) => {
    const n = norma(p.nombre || ''), c = p.correo.toLowerCase();
    if (n === q) return 100;
    if (n.split(' ')[0] === q) return 90;
    if (n.startsWith(q)) return 80;
    if (c.startsWith(q.replace(/ /g, ''))) return 70;
    if (n.includes(q)) return 50;
    return 0;
  };
  const mejor = personas.map((p) => ({ p, s: puntos(p) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  if (!mejor.length) return null;
  // Dos con el mismo puntaje alto (dos «Karla»): mejor no adivinar.
  if (mejor.length > 1 && mejor[0].s === mejor[1].s && mejor[0].s < 100) return null;
  return mejor[0].p;
}

type Accion = { tipo: 'llamada' | 'mensaje' | 'pago'; video?: boolean; con: string; texto?: string; monto?: string; moneda?: string };

al<Accion>('pulse.accion', async (a) => {
  const aviso = (titulo: string, cuerpo: string) => pedir('notch.aviso', { titulo, cuerpo }).catch(() => {});
  if (!RELEVO.quien()) { aviso('PULSE2CHAT', 'Conecta PULSE2CHAT primero (Centro → PULSE2CHAT).'); pedir('ventana.mostrar', { seccion: 'pulse' }).catch(() => {}); return; }
  const p = await buscarContacto(a.con);
  if (!p) { aviso('PULSE2CHAT', `No encontré a «${a.con}» entre tus contactos (o hay dos con ese nombre).`); pedir('ventana.mostrar', { seccion: 'pulse' }).catch(() => {}); return; }
  const nombre = p.nombre || p.correo;
  if (a.tipo === 'pago') {
    // No se manda nada aquí: se abre el hilo y el envío para revisarlo; se firma en Veta Wallet.
    pedir('ventana.mostrar', { seccion: 'pulse' }).catch(() => {});
    window.dispatchEvent(new CustomEvent('centro:ir', { detail: 'pulse' }));
    setTimeout(() => window.dispatchEvent(new CustomEvent('p2c:abrir', { detail: { correo: p.correo } })), 150);
    void abrirPagar(p.correo, nombre, montoValido(String(a.monto || '')) || '', String(a.moneda || 'ORIGEN').toUpperCase());
    return;
  }
  if (a.tipo === 'llamada') {
    pedir('ventana.mostrar', { seccion: 'pulse' }).catch(() => {});
    llamar(p.correo, !!a.video);
    return;
  }
  try {
    const r = await RELEVO.enviar(p.correo, String(a.texto || '').slice(0, 2000));
    aviso(`Mensaje a ${nombre}`, r.e2e ? 'Enviado, cifrado de punta a punta.' : 'Enviado (esa persona aún no tiene cifrado en ningún aparato).');
  } catch (e: any) {
    aviso(`No pude mandarlo a ${nombre}`, e?.message || 'Sin conexión con PULSE2CHAT.');
  }
});
