/**
 * Inicio: el saludo y el resumen del día como una hoja de ensayo — la cartera (cifras en Mono, alineadas),
 * lo que suena y tu día (agenda, correo y avisos). Cada bloque lleva a su sección; no hay tarjetas que
 * repitan el menú.
 */
import { h, boton, icono } from '../ui';
import { pedir, al } from '../puente';
import { estado, T, NOMBRES } from '../estado';

function saludo() {
  const hora = new Date().getHours();
  return hora < 12 ? T('Buenos días', 'Good morning') : hora < 19 ? T('Buenas tardes', 'Good afternoon') : T('Buenas noches', 'Good evening');
}

const dinero = (n: number) => n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: n < 100 ? 2 : 0 });
const cantidad = (n: number) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 4 });
const tiempo = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function vistaInicio(): HTMLElement {
  const e = estado();
  const nombre = e.sesion?.nombre?.split(' ')[0] ?? '';
  const ir = (s: string) => window.dispatchEvent(new CustomEvent('centro:ir', { detail: s }));
  const idioma = e.idioma === 'en' ? 'en' : 'es';

  const esqueleto = () => h('div', { class: 'esqueleto', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'));
  const carteraCuerpo = h('div', { class: 'resumen cuerpo-vivo', 'aria-busy': 'true' }, esqueleto());
  const musicaCuerpo = h('div', { class: 'resumen cuerpo-vivo', 'aria-busy': 'true' }, esqueleto());
  const diaCuerpo = h('div', { class: 'resumen cuerpo-vivo', 'aria-busy': 'true' }, esqueleto());
  const listo = (el: HTMLElement, ...hijos: Node[]) => { el.removeAttribute('aria-busy'); el.replaceChildren(...hijos); };

  /** La cabeza de un bloque: su rótulo y, a la derecha, a qué sección lleva. */
  const bloque = (titulo: string, seccion: string | null, irTexto: string, cuerpo: HTMLElement) =>
    h('section', { 'aria-label': titulo },
      h('div', { class: 'bloque-cab' }, h('h2', { class: 'rotulo' }, titulo),
        seccion ? h('button', { class: 'ir-a', type: 'button', on: { click: () => ir(seccion) } }, irTexto, icono('avanzar', 14)) : null),
      cuerpo);

  // La fecha y la hora, como la lectura de un ensayo: en Mono.
  const ahora = new Date();
  const fecha = h('div', { class: 'inicio-fecha' },
    h('b', null, ahora.toLocaleDateString(idioma, { weekday: 'long' })),
    h('time', { datetime: ahora.toISOString().slice(0, 10) }, ahora.toLocaleDateString(idioma, { day: '2-digit', month: 'short', year: 'numeric' })),
    h('time', null, ahora.toLocaleTimeString(idioma, { hour: '2-digit', minute: '2-digit' })));

  const vista = h('div', { class: 'vista' },
    h('header', { class: 'inicio-heroe' },
      h('div', null,
        fecha,
        h('h1', null, saludo(), nombre ? [', ', h('em', null, nombre)] : null, '.'),
        h('p', { class: 'sub' }, T(`${NOMBRES[e.avatar] ?? 'AURA'} está arriba, en el notch. Dile «Oye AURA» o usa `, `${NOMBRES[e.avatar] ?? 'AURA'} is up in the notch. Say “Hey AURA” or press `),
          h('kbd', null, 'Ctrl'), ' ', h('kbd', null, 'Alt'), ' ', h('kbd', null, T('Espacio', 'Space')), '.')),
      h('div', { class: 'inicio-acciones' },
        boton(T('Ver el recorrido', 'Watch the tour'), () => window.dispatchEvent(new Event('centro:recorrido')), { tipo: 'fantasma', icono: 'play', titulo: T('El recorrido con Claudio y ANT-ONIO: todo lo que hace AURA en tu computadora', 'The tour with Claudio and ANT-ONIO') }),
        boton(T('Escribirle', 'Type to her'), () => ir('chat'), { icono: 'chat' }),
        boton(T('Hablar ahora', 'Talk now'), (ev) => escuchar(ev.currentTarget as HTMLButtonElement), { tipo: 'acento', icono: 'mic', titulo: T('AURA te escucha (Ctrl+Alt+Espacio)', 'AURA listens') }))),
    h('div', { class: 'hoja' },
      h('div', { class: 'hoja-col' },
        bloque(T('Cartera', 'Wallet'), 'cartera', T('Ver cartera', 'Open wallet'), carteraCuerpo),
        bloque(T('Sonando', 'Now playing'), 'musica', T('Música', 'Music'), musicaCuerpo)),
      bloque(T('Tu día', 'Your day'), null, '', diaCuerpo)));

  /** «Hablar ahora»: el botón toma la pátina (te escucho) mientras el notch abre el micrófono. */
  async function escuchar(b: HTMLButtonElement) {
    b.classList.add('escuchando');
    const texto = b.querySelector('span');
    const antes = texto?.textContent;
    if (texto) texto.textContent = T('Te escucho…', 'Listening…');
    try { await pedir('chat.hablar'); await new Promise((r) => setTimeout(r, 2400)); }
    catch { /* el notch dice qué pasó */ }
    finally { b.classList.remove('escuchando'); if (texto && antes) texto.textContent = antes; }
  }

  async function refrescar() {
    // Cartera: el total en grande y el libro de saldos debajo.
    try {
      const c = await pedir<any>('cartera.saldos');
      if (!c?.direccion) {
        listo(carteraCuerpo, h('div', null, h('p', { class: 'tenue' }, T('Pega tu dirección de Veta Wallet para ver tus saldos (solo lectura).', 'Paste your Veta Wallet address to see balances (read-only).')), boton(T('Configurar', 'Set up'), () => ir('cartera'))));
      } else {
        const con = (c.saldos as any[]).filter((s) => s.cantidad > 0).slice(0, 4);
        listo(carteraCuerpo,
          h('div', { class: 'cifra', 'aria-label': T('Valor aproximado ', 'Approximate value ') + dinero(c.total) }, dinero(c.total), h('span', { class: 'moneda' }, 'USD')),
          con.length
            ? h('table', { class: 'libro', style: 'margin-top:18px' },
                h('thead', null, h('tr', null, h('th', null, T('Moneda', 'Coin')), h('th', { class: 'num' }, T('Cantidad', 'Amount')), h('th', { class: 'num' }, 'USD'))),
                h('tbody', null, ...con.map((s) => h('tr', null,
                  h('td', null, h('span', { class: 'sello' }, String(s.simbolo).slice(0, 6))),
                  h('td', { class: 'num' }, cantidad(s.cantidad)),
                  h('td', { class: 'num tenue' }, s.usd == null ? '—' : dinero(s.usd))))))
            : h('p', { class: 'tenue' }, T('Sin saldos todavía.', 'No balances yet.')));
      }
    } catch (err: any) { listo(carteraCuerpo, h('p', { class: 'tenue' }, err.message)); }
    // Música
    try {
      const m = await pedir<any>('spotify.estado');
      const s = m?.sonando ?? m?.local;
      if (s?.titulo) {
        const tieneTiempo = typeof s.duracionMs === 'number' && s.duracionMs > 0 && typeof s.progresoMs === 'number';
        listo(musicaCuerpo, h('div', { class: 'sonando' },
          s.portada ? h('img', { src: s.portada, alt: '' }) : h('span', { class: 'portada-vacia' }, icono('musica', 22)),
          h('div', { style: 'min-width:0' },
            h('strong', null, s.titulo), h('small', null, s.artista || s.app || ''),
            tieneTiempo ? h('div', { class: 'regla', 'aria-hidden': 'true' }, h('i', { style: `transform:scaleX(${Math.min(1, s.progresoMs / s.duracionMs).toFixed(3)})` })) : null,
            tieneTiempo ? h('div', { class: 'tiempos' }, h('span', null, tiempo(s.progresoMs)), h('span', null, tiempo(s.duracionMs))) : null)));
      } else {
        listo(musicaCuerpo, h('div', null, h('p', { class: 'tenue' }, T('No suena nada ahora.', 'Nothing playing.')), boton(T('Buscar música', 'Find music'), () => ir('musica'))));
      }
    } catch (err: any) { listo(musicaCuerpo, h('p', { class: 'tenue' }, err.message)); }
    // El día: agenda, correos y avisos de las apps
    try {
      const d = await pedir<any>('inicio.dia');
      const eventos = (d?.eventos ?? []) as { hora: string; titulo: string }[];
      const hijos: Node[] = [];
      if (eventos.length) hijos.push(h('ul', { class: 'agenda' }, ...eventos.map((ev) => h('li', null, h('time', null, ev.hora), h('span', null, ev.titulo)))));
      const pie: Node[] = [];
      // Con tope (se cuentan los últimos 30): «al menos 30», nunca un total que no se contó.
      if (d?.correos != null) pie.push(h('div', null, h('b', null, (d.correosAlMenos ? '≥ ' : '') + d.correos), T('correos sin leer', 'unread emails')));
      if (d?.avisos?.length) pie.push(h('div', { class: 'tenue' }, T('Últimos avisos: ', 'Latest: ') + d.avisos.join(' · ')));
      if (pie.length) hijos.push(h('div', { class: 'agenda-pie' }, ...pie));
      listo(diaCuerpo, ...(hijos.length ? hijos : [h('p', { class: 'tenue' }, T('Nada pendiente. Conecta Google o Outlook en Ajustes para ver tu agenda y correo.', 'Nothing pending. Connect Google or Outlook in Settings.'))]));
    } catch (err: any) { listo(diaCuerpo, h('p', { class: 'tenue' }, err.message)); }
  }
  refrescar();
  al('musica', () => refrescar());
  setInterval(() => { if (vista.isConnected) refrescar(); }, 60_000);
  return vista;
}
