/** Inicio: saludo, accesos rápidos y el resumen del día (cartera, música, agenda, correo, avisos). */
import { h, boton, tarjeta, icono } from '../ui';
import { pedir, al } from '../puente';
import { estado, T, NOMBRES } from '../estado';
import { avatar3d } from '../avatar3d';

function saludo() {
  const hora = new Date().getHours();
  return hora < 12 ? T('Buenos días', 'Good morning') : hora < 19 ? T('Buenas tardes', 'Good afternoon') : T('Buenas noches', 'Good evening');
}

const dinero = (n: number) => n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: n < 100 ? 2 : 0 });

export function vistaInicio(): HTMLElement {
  const e = estado();
  const nombre = e.sesion?.nombre?.split(' ')[0] ?? '';
  const av = avatar3d(e.avatar, 'avatar3d grande');
  const ir = (s: string) => window.dispatchEvent(new CustomEvent('centro:ir', { detail: s }));

  const carteraCuerpo = h('div', null, h('span', { class: 'cargando' }));
  const musicaCuerpo = h('div', null, h('span', { class: 'cargando' }));
  const diaCuerpo = h('div', null, h('span', { class: 'cargando' }));

  const acceso = (ico: string, titulo: string, sub: string, f: () => void) =>
    h('button', { class: 'tarjeta', style: 'text-align:left;cursor:pointer;display:flex;gap:14px;align-items:center;margin:0', title: sub, on: { click: f } },
      h('span', { class: 'foto', style: 'background:var(--acento-suave);color:var(--acento)' }, icono(ico, 20)),
      h('span', null, h('strong', null, titulo), h('br'), h('small', { class: 'tenue' }, sub)));

  const vista = h('div', { class: 'vista' },
    h('div', { style: 'display:grid;grid-template-columns:1fr 260px;gap:18px;align-items:center;margin-bottom:10px' },
      h('div', null,
        h('p', { class: 'tenue', style: 'margin:0 0 4px' }, new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })),
        h('h1', { style: 'font:600 34px/1.1 var(--titulo);margin:0' }, `${saludo()}${nombre ? ', ' + nombre : ''}.`),
        h('p', { class: 'tenue', style: 'margin:8px 0 18px' }, T(`${NOMBRES[e.avatar] ?? 'AURA'} está arriba, en el notch. Dile «Oye AURA» o usa Ctrl+Alt+Espacio.`, `${NOMBRES[e.avatar] ?? 'AURA'} is up in the notch.`)),
        h('div', { class: 'fila', style: 'flex-wrap:wrap' },
          boton(T('Hablar ahora', 'Talk now'), () => pedir('chat.hablar'), { tipo: 'acento', icono: 'mic', titulo: T('AURA te escucha (Ctrl+Alt+Espacio)', 'AURA listens') }),
          boton(T('Escribirle', 'Type to her'), () => ir('chat'), { icono: 'chat' }))),
      h('div', { style: 'height:260px' }, av.el)),
    h('div', { class: 'rejilla', style: 'margin-bottom:14px' },
      acceso('pulse', 'PULSE2CHAT', T('Chats, llamadas y videollamadas', 'Chats, calls, video'), () => ir('pulse')),
      acceso('musica', T('Música', 'Music'), T('Lo que suena y Spotify', 'Now playing and Spotify'), () => ir('musica')),
      acceso('cartera', T('Cartera', 'Wallet'), T('Tus saldos de Veta Wallet', 'Your Veta Wallet balances'), () => ir('cartera'))),
    h('div', { class: 'rejilla' },
      tarjeta(T('Cartera', 'Wallet'), carteraCuerpo),
      tarjeta(T('Sonando', 'Now playing'), musicaCuerpo),
      tarjeta(T('Tu día', 'Your day'), diaCuerpo)));

  async function refrescar() {
    // Cartera
    try {
      const c = await pedir<any>('cartera.saldos');
      carteraCuerpo.replaceChildren(!c?.direccion
        ? h('div', null, h('p', { class: 'tenue' }, T('Pega tu dirección de Veta Wallet para ver tus saldos (solo lectura).', 'Paste your Veta Wallet address to see balances (read-only).')), boton(T('Configurar', 'Set up'), () => ir('cartera')))
        : h('div', null, h('div', { class: 'cifra' }, dinero(c.total)),
            h('p', { class: 'tenue', style: 'margin:6px 0 0' }, (c.saldos as any[]).filter((s) => s.cantidad > 0).slice(0, 3).map((s) => `${Number(s.cantidad).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${s.simbolo}`).join(' · ') || T('Sin saldos todavía.', 'No balances yet.'))));
    } catch (err: any) { carteraCuerpo.replaceChildren(h('p', { class: 'tenue' }, err.message)); }
    // Música
    try {
      const m = await pedir<any>('spotify.estado');
      const s = m?.sonando ?? m?.local;
      musicaCuerpo.replaceChildren(s?.titulo
        ? h('div', { class: 'fila' }, s.portada ? h('img', { src: s.portada, alt: '', style: 'width:54px;height:54px;border-radius:10px' }) : h('span', { class: 'foto' }, icono('musica')),
            h('div', null, h('strong', null, s.titulo), h('br'), h('small', { class: 'tenue' }, s.artista || s.app || '')))
        : h('div', null, h('p', { class: 'tenue' }, T('No suena nada ahora.', 'Nothing playing.')), boton(T('Buscar música', 'Find music'), () => ir('musica'))));
    } catch (err: any) { musicaCuerpo.replaceChildren(h('p', { class: 'tenue' }, err.message)); }
    // El día: agenda, correos y avisos de las apps
    try {
      const d = await pedir<any>('inicio.dia');
      const items: HTMLElement[] = [];
      for (const ev of d?.eventos ?? []) items.push(h('div', { class: 'fila', style: 'margin-bottom:6px' }, h('span', { class: 'etiqueta' }, ev.hora), h('span', null, ev.titulo)));
      if (d?.correos != null) items.push(h('p', { class: 'tenue', style: 'margin:8px 0 0' }, T(`${d.correos} correos sin leer`, `${d.correos} unread emails`)));
      if (d?.avisos?.length) items.push(h('p', { class: 'tenue', style: 'margin:4px 0 0' }, T('Últimos avisos: ', 'Latest: ') + d.avisos.join(' · ')));
      diaCuerpo.replaceChildren(...(items.length ? items : [h('p', { class: 'tenue' }, T('Nada pendiente. Conecta Google o Outlook en Ajustes para ver tu agenda y correo.', 'Nothing pending. Connect Google or Outlook in Settings.'))]));
    } catch (err: any) { diaCuerpo.replaceChildren(h('p', { class: 'tenue' }, err.message)); }
  }
  refrescar();
  al('musica', () => refrescar());
  setInterval(() => { if (vista.isConnected) refrescar(); }, 60_000);
  return vista;
}
