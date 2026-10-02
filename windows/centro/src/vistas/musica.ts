/**
 * Música: el reproductor de Spotify (lo que suena, controles, volumen, dispositivos) y la búsqueda con
 * resultados para ponerlos con un clic. Sin Spotify conectado: lo que Windows ve sonar y cómo conectarlo.
 */
import { h, boton, botonIcono, tarjeta, avisar, icono, vacio } from '../ui';
import { pedir } from '../puente';
import { T } from '../estado';

const tiempo = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function vistaMusica(): HTMLElement {
  const reproductor = h('div', null, h('span', { class: 'cargando' }));
  const resultados = h('div', { class: 'resultados' });
  const buscar = h('input', { type: 'search', placeholder: T('Busca una canción, artista o playlist…', 'Search a song, artist or playlist…'), 'aria-label': T('Buscar en Spotify', 'Search Spotify') }) as HTMLInputElement;
  let conectado = false;
  let ultimo: any = null;
  let progresoEl: HTMLElement | null = null;
  let tiempoEl: HTMLElement | null = null;
  let base = { ms: 0, en: Date.now(), dur: 1, sonando: false };

  const vista = h('div', { class: 'vista' },
    h('div', { class: 'cabeza' }, h('div', null, h('h1', null, T('Música', 'Music')), h('p', null, T('Tu Spotify desde aquí, o por voz: «pon Bad Bunny en Spotify».', 'Your Spotify here, or by voice.')))),
    reproductor,
    tarjeta(T('Buscar', 'Search'), h('form', { on: { submit: (e: Event) => { e.preventDefault(); hacerBusqueda(); } } }, buscar), resultados));

  async function control(accion: string) {
    try { await pedir('spotify.control', { accion }); setTimeout(cargar, 450); }
    catch (e: any) { avisar(e.message, 'mal', 6000); }
  }

  function pintarSinConexion(local: any) {
    reproductor.replaceChildren(tarjeta(null,
      local?.titulo ? h('div', { class: 'fila', style: 'margin-bottom:var(--e-4);padding-bottom:var(--e-4);border-bottom:1px solid var(--linea-suave)' }, h('span', { class: 'foto' }, icono('musica')),
        h('div', null, h('small', { class: 'antetitulo' }, T('Suena en tu PC', 'Playing on your PC')), h('br'), h('strong', null, local.titulo), h('br'), h('small', { class: 'tenue' }, `${local.artista || ''} · ${local.app}`))) : null,
      h('div', { class: 'musica-sin' },
        h('span', { class: 'foto dorada' }, icono('musica', 28)),
        h('div', null,
          h('strong', null, T('Conecta tu Spotify', 'Connect your Spotify')),
          h('p', { class: 'tenue' }, T('Para ver lo que suena, buscar y poner canciones desde aquí o por voz.', 'To see what’s playing, search and play from here or by voice.')),
          h('small', { class: 'nota' }, T('Controlar la música desde otra app es una función de Spotify Premium.', 'Controlling from another app requires Spotify Premium.')),
          h('div', null, boton(T('Conectar Spotify', 'Connect Spotify'), async (ev) => {
            const b = ev.currentTarget as HTMLButtonElement; b.disabled = true;
            avisar(T('Abrí Spotify en tu navegador: acepta y vuelve.', 'Opened Spotify in your browser.'));
            try { await pedir('conectar', { servicio: 'spotify' }, 330_000); avisar(T('Spotify conectado.', 'Spotify connected.'), 'ok'); cargar(); }
            catch (e: any) { avisar(e.message, 'mal', 9000); b.disabled = false; }
          }, { tipo: 'acento', icono: 'musica' }))))));
  }

  function pintar(s: any) {
    if (!s) {
      reproductor.replaceChildren(tarjeta(null, h('p', { class: 'tenue' }, T('No suena nada en tu Spotify. Busca algo abajo o abre Spotify en cualquier dispositivo.', 'Nothing is playing. Search below.'))));
      return;
    }
    base = { ms: s.progresoMs, en: Date.now(), dur: Math.max(1, s.duracionMs), sonando: s.sonando };
    progresoEl = h('i');
    tiempoEl = h('small', { class: 'tenue' });
    const barra = h('div', { class: 'barra-progreso', title: T('Toca para saltar a ese momento', 'Click to seek'),
      on: { click: (e: MouseEvent) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); control('posicion:' + Math.round(((e.clientX - r.left) / r.width) * base.dur)); } } }, progresoEl);
    const volumen = h('input', { type: 'range', min: '0', max: '100', value: String(Math.max(0, s.volumen)), 'aria-label': T('Volumen de Spotify', 'Spotify volume'), title: T('Volumen de Spotify', 'Spotify volume'),
      style: 'width:120px', on: { change: (e: Event) => control('volumen:' + (e.target as HTMLInputElement).value) } });
    reproductor.replaceChildren(h('section', { class: 'tarjeta reproductor' },
      h('div', { style: 'display:grid;grid-template-columns:170px 1fr;gap:22px;align-items:center' },
        s.portada ? h('img', { class: 'reproductor-portada', src: s.portada, alt: T('Portada de ', 'Cover of ') + s.album }) : h('div', { class: 'foto reproductor-portada' }, icono('musica', 48)),
        h('div', null,
          h('small', { class: 'antetitulo' }, T('Sonando en ', 'Playing on ') + (s.dispositivo || 'Spotify')),
          h('h2', { style: 'font:650 var(--t-2xl)/1.15 var(--titulo);letter-spacing:-.02em;margin:6px 0 4px' }, s.titulo),
          h('p', { class: 'tenue', style: 'margin:0' }, `${s.artista} · ${s.album}`),
          barra, h('div', { class: 'fila', style: 'justify-content:space-between' }, tiempoEl, h('small', { class: 'tenue' }, tiempo(s.duracionMs))),
          h('div', { class: 'fila', style: 'margin-top:10px' },
            botonIcono('anterior', T('Canción anterior', 'Previous'), () => control('anterior'), 'grande'),
            botonIcono(s.sonando ? 'pausa' : 'play', s.sonando ? T('Pausar', 'Pause') : T('Reproducir', 'Play'), () => control(s.sonando ? 'pausa' : 'play'), 'grande acento'),
            botonIcono('siguiente', T('Siguiente canción', 'Next'), () => control('siguiente'), 'grande'),
            h('span', { style: 'flex:1' }),
            h('span', { class: 'tenue', title: T('Volumen', 'Volume'), style: 'display:inline-flex' }, icono('volumen')), volumen,
            botonIcono('actualizar', T('Dispositivos: elegir dónde suena', 'Devices: choose where it plays'), dispositivos))))));
    mover();
  }

  function mover() {
    if (!progresoEl || !tiempoEl) return;
    const ms = Math.min(base.dur, base.ms + (base.sonando ? Date.now() - base.en : 0));
    progresoEl.style.width = (ms / base.dur * 100).toFixed(2) + '%';
    tiempoEl.textContent = tiempo(ms);
  }
  setInterval(() => { if (vista.isConnected) mover(); }, 500);

  async function dispositivos() {
    try {
      const d = await pedir<any[]>('spotify.dispositivos');
      if (!d.length) { avisar(T('No hay dispositivos: abre Spotify en la PC o el teléfono.', 'No devices: open Spotify somewhere.'), 'info', 6000); return; }
      // Se cierra al elegir, con «Cerrar», con Escape o con un clic afuera.
      const cerrar = () => { menu.remove(); removeEventListener('keydown', alTeclado); removeEventListener('mousedown', alClicAfuera, true); };
      const alTeclado = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar(); };
      const alClicAfuera = (e: MouseEvent) => { if (!menu.contains(e.target as Node)) cerrar(); };
      const menu = h('div', { class: 'tarjeta menu-flotante', role: 'dialog', 'aria-label': T('¿Dónde suena?', 'Play on'), style: 'right:40px;top:120px' },
        h('h3', null, T('¿Dónde suena?', 'Play on')),
        h('div', { class: 'lista' }, ...d.map((x) => h('div', { class: 'item', role: 'button', tabindex: '0', on: { click: async () => { cerrar(); try { await pedir('spotify.transferir', { id: x.id }); setTimeout(cargar, 800); } catch (e: any) { avisar(e.message, 'mal'); } } } },
          icono('musica'), h('span', { style: 'flex:1' }, x.nombre), x.activo ? h('span', { class: 'etiqueta ok' }, T('activo', 'active')) : null))),
        boton(T('Cerrar', 'Close'), () => cerrar(), { tipo: 'fantasma' }));
      document.body.appendChild(menu);
      addEventListener('keydown', alTeclado);
      setTimeout(() => addEventListener('mousedown', alClicAfuera, true));
    } catch (e: any) { avisar(e.message, 'mal'); }
  }

  async function hacerBusqueda() {
    const q = buscar.value.trim();
    if (q.length < 2) return;
    if (!conectado) { avisar(T('Conecta Spotify primero.', 'Connect Spotify first.')); return; }
    vacio(resultados).appendChild(h('span', { class: 'cargando' }));
    try {
      const r = await pedir<any[]>('spotify.buscar', { q });
      const tipo = { cancion: T('Canción', 'Song'), artista: T('Artista', 'Artist'), playlist: 'Playlist' } as Record<string, string>;
      resultados.replaceChildren(r.length ? h('div', { class: 'lista' }, ...r.map((x) => h('div', { class: 'item', title: T('Ponerla ahora', 'Play now'), role: 'button', tabindex: '0',
        on: { click: async () => { try { await pedir('spotify.poner', { uri: x.uri }); avisar(T('Poniendo ', 'Playing ') + x.titulo, 'ok'); setTimeout(cargar, 1200); } catch (e: any) { avisar(e.message, 'mal', 7000); } } } },
        x.imagen ? h('img', { src: x.imagen, alt: '', style: 'width:44px;height:44px;border-radius:var(--r-xs);object-fit:cover' }) : h('span', { class: 'foto' }, icono('musica')),
        h('div', { style: 'flex:1;min-width:0' }, h('strong', null, x.titulo), h('br'), h('small', { class: 'tenue' }, `${tipo[x.tipo]} · ${x.subtitulo}`)),
        x.duracionMs ? h('small', { class: 'tenue' }, tiempo(x.duracionMs)) : null, icono('play')))) : h('p', { class: 'tenue' }, T('Sin resultados.', 'No results.')));
    } catch (e: any) { resultados.replaceChildren(h('p', { class: 'tenue' }, e.message)); }
  }

  async function cargar() {
    try {
      const m = await pedir<any>('spotify.estado');
      conectado = !!m?.conectado;
      if (!conectado) { pintarSinConexion(m?.local); return; }
      if (JSON.stringify(m.sonando) !== JSON.stringify(ultimo)) { ultimo = m.sonando; pintar(m.sonando); }
    } catch (e: any) { reproductor.replaceChildren(tarjeta(null, h('p', null, e.message))); }
  }
  cargar();
  setInterval(() => { if (vista.isConnected && !document.hidden) cargar(); }, 5000);
  return vista;
}
