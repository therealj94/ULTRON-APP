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

  const esqueleto = () => h('div', { class: 'esqueleto', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'));
  const carteraCuerpo = h('div', { class: 'resumen cuerpo-vivo', 'aria-busy': 'true' }, esqueleto());
  const musicaCuerpo = h('div', { class: 'resumen cuerpo-vivo', 'aria-busy': 'true' }, esqueleto());
  const diaCuerpo = h('div', { class: 'resumen cuerpo-vivo', 'aria-busy': 'true' }, esqueleto());
  const listo = (el: HTMLElement, ...hijos: Node[]) => { el.removeAttribute('aria-busy'); el.replaceChildren(...hijos); };

  const acceso = (ico: string, titulo: string, sub: string, f: () => void) =>
    h('button', { class: 'tarjeta acceso', on: { click: f } },
      h('span', { class: 'foto dorada' }, icono(ico, 20)),
      h('span', { class: 'acceso-texto' }, h('strong', null, titulo), h('small', null, sub)),
      icono('flecha', 18));

  const vista = h('div', { class: 'vista' },
    h('div', { class: 'inicio-heroe' },
      h('div', null,
        h('span', { class: 'antetitulo' }, new Date().toLocaleDateString(e.idioma === 'en' ? 'en' : 'es', { weekday: 'long', day: 'numeric', month: 'long' })),
        h('h1', null, saludo(), nombre ? [', ', h('em', null, nombre)] : null, '.'),
        h('p', { class: 'sub' }, T(`${NOMBRES[e.avatar] ?? 'AURA'} está arriba, en el notch. Dile «Oye AURA» o usa `, `${NOMBRES[e.avatar] ?? 'AURA'} is up in the notch. Say “Hey AURA” or press `),
          h('kbd', null, 'Ctrl'), '+', h('kbd', null, 'Alt'), '+', h('kbd', null, T('Espacio', 'Space')), '.'),
        h('div', { class: 'fila' },
          boton(T('Hablar ahora', 'Talk now'), (ev) => escuchar(ev.currentTarget as HTMLButtonElement), { tipo: 'acento', icono: 'mic', titulo: T('AURA te escucha (Ctrl+Alt+Espacio)', 'AURA listens') }),
          boton(T('Escribirle', 'Type to her'), () => ir('chat'), { icono: 'chat' }),
          boton(T('Ver el recorrido', 'Watch the tour'), () => window.dispatchEvent(new Event('centro:recorrido')), { tipo: 'fantasma', icono: 'play', titulo: T('El recorrido con Claudio y ANT-ONIO: todo lo que hace AURA en tu computadora', 'The tour with Claudio and ANT-ONIO') }))),
      h('div', { class: 'inicio-avatar' }, av.el)),
    h('div', { class: 'rejilla', style: 'margin-bottom:var(--e-4)' },
      acceso('pulse', 'PULSE2CHAT', T('Chats, llamadas y videollamadas', 'Chats, calls, video'), () => ir('pulse')),
      acceso('musica', T('Música', 'Music'), T('Lo que suena y Spotify', 'Now playing and Spotify'), () => ir('musica')),
      acceso('cartera', T('Cartera', 'Wallet'), T('Tus saldos de Veta Wallet', 'Your Veta Wallet balances'), () => ir('cartera'))),
    h('div', { class: 'rejilla' },
      tarjeta(T('Cartera', 'Wallet'), carteraCuerpo),
      tarjeta(T('Sonando', 'Now playing'), musicaCuerpo),
      tarjeta(T('Tu día', 'Your day'), diaCuerpo)));

  /** «Hablar ahora»: el botón muestra que AURA escucha mientras el notch abre el micrófono. */
  async function escuchar(b: HTMLButtonElement) {
    b.classList.add('escuchando');
    try { await pedir('chat.hablar'); await new Promise((r) => setTimeout(r, 2400)); }
    catch { /* el notch dice qué pasó */ }
    finally { b.classList.remove('escuchando'); }
  }

  async function refrescar() {
    // Cartera
    try {
      const c = await pedir<any>('cartera.saldos');
      listo(carteraCuerpo, !c?.direccion
        ? h('div', null, h('p', { class: 'tenue' }, T('Pega tu dirección de Veta Wallet para ver tus saldos (solo lectura).', 'Paste your Veta Wallet address to see balances (read-only).')), boton(T('Configurar', 'Set up'), () => ir('cartera')))
        : h('div', null, h('div', { class: 'cifra' }, dinero(c.total)),
            h('p', { class: 'tenue', style: 'margin:6px 0 0' }, (c.saldos as any[]).filter((s) => s.cantidad > 0).slice(0, 3).map((s) => `${Number(s.cantidad).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${s.simbolo}`).join(' · ') || T('Sin saldos todavía.', 'No balances yet.'))));
    } catch (err: any) { listo(carteraCuerpo, h('p', { class: 'tenue' }, err.message)); }
    // Música
    try {
      const m = await pedir<any>('spotify.estado');
      const s = m?.sonando ?? m?.local;
      listo(musicaCuerpo, s?.titulo
        ? h('div', { class: 'fila' }, s.portada ? h('img', { src: s.portada, alt: '', style: 'width:54px;height:54px;border-radius:var(--r-sm);box-shadow:var(--sombra-2)' }) : h('span', { class: 'foto dorada' }, icono('musica')),
            h('div', null, h('strong', null, s.titulo), h('br'), h('small', { class: 'tenue' }, s.artista || s.app || '')))
        : h('div', null, h('p', { class: 'tenue' }, T('No suena nada ahora.', 'Nothing playing.')), boton(T('Buscar música', 'Find music'), () => ir('musica'))));
    } catch (err: any) { listo(musicaCuerpo, h('p', { class: 'tenue' }, err.message)); }
    // El día: agenda, correos y avisos de las apps
    try {
      const d = await pedir<any>('inicio.dia');
      const items: HTMLElement[] = [];
      for (const ev of d?.eventos ?? []) items.push(h('div', { class: 'dia-item' }, h('span', { class: 'etiqueta' }, ev.hora), h('span', null, ev.titulo)));
      // Con tope (se cuentan los últimos 30): «al menos 30», nunca un total que no se contó.
      if (d?.correos != null) items.push(h('p', { class: 'tenue', style: 'margin:8px 0 0' }, d.correosAlMenos ? T(`Al menos ${d.correos} correos sin leer`, `At least ${d.correos} unread emails`) : T(`${d.correos} correos sin leer`, `${d.correos} unread emails`)));
      if (d?.avisos?.length) items.push(h('p', { class: 'tenue', style: 'margin:4px 0 0' }, T('Últimos avisos: ', 'Latest: ') + d.avisos.join(' · ')));
      listo(diaCuerpo, ...(items.length ? items : [h('p', { class: 'tenue' }, T('Nada pendiente. Conecta Google o Outlook en Ajustes para ver tu agenda y correo.', 'Nothing pending. Connect Google or Outlook in Settings.'))]));
    } catch (err: any) { listo(diaCuerpo, h('p', { class: 'tenue' }, err.message)); }
  }
  refrescar();
  al('musica', () => refrescar());
  setInterval(() => { if (vista.isConnected) refrescar(); }, 60_000);
  return vista;
}
