/**
 * WHATSAPP PERSONAL en el Centro (José, 2-oct: «una opción aparte de PULSE2CHAT, slide y cambia»). Vive al
 * lado de PULSE2CHAT en la misma sección (vistas/mensajeria.ts pone el cambio entre los dos) y solo existe
 * para la cuenta dueña: si `whatsapp.estado` dice permitido=false, ni la pestaña se ve.
 *
 * Tres caras:
 *   · VINCULAR: el QR grande para escanear con el teléfono (se refresca solo, preguntando cada ~3 s mientras
 *     vincula) o, con «Vincular con número», el código de 8 letras para escribir en el teléfono.
 *   · LISTA + CONVERSACIÓN (dos paneles, como PULSE2CHAT y con sus mismas piezas): buscar, sin leer, grupos,
 *     hora de Honduras; burbujas (las mías a la derecha), fotos en miniatura que se abren en grande, notas de
 *     voz, documentos, «🚫 Mensaje eliminado», «editado»; la caja de escribir (Enter envía, Mayús+Enter baja
 *     de renglón) con envío optimista y el error a la vista si no salió.
 *   · DESVINCULAR, con confirmación.
 *
 * Solo se pregunta con el panel a la vista: la lista cada 5 s, la conversación abierta cada 3 s. Todo sale por
 * AURA (C#, `whatsapp.*` en PUENTE.md) con la sesión de AU-RA; la página no ve tokens ni sale a la red. Lo que
 * dicen los mensajes lo escribió otra gente: se pinta como texto (nunca HTML).
 */
import '../pulse/pulse.css';
import '../whatsapp/whatsapp.css';
import { h, boton, vacio, avisar } from '../ui';
import { pedir } from '../puente';
import { T, estado } from '../estado';
import { botonP, iconoP } from '../pulse/iconos';
import { dialogo, dialogoConfirmar } from './pulse';
import * as F from '../whatsapp/formato';

const en = () => estado()?.idioma === 'en';
const textoError = (e: any, porOmision: string) => String(e?.message || porOmision);

/** Un valor con oyentes (lo mismo que usan las vistas de PULSE2CHAT, en chico). */
export type Almacen<V> = { get(): V; set(v: V): void; sub(f: (v: V) => void): () => void };
function almacen<V>(inicial: V): Almacen<V> {
  let v = inicial;
  const oyentes = new Set<(v: V) => void>();
  return {
    get: () => v,
    set(n) {
      if (n === v) return;
      v = n;
      oyentes.forEach((f) => f(v));
    },
    sub(f) {
      oyentes.add(f);
      return () => oyentes.delete(f);
    },
  };
}

/** Le pregunta a AURA cómo está WhatsApp. null si no contestó (sin sesión, sin servidor): entonces no se muestra. */
export async function consultarEstado(): Promise<F.EstadoWA | null> {
  try {
    return (await pedir<F.EstadoWA | null>('whatsapp.estado', null, 20_000)) ?? null;
  } catch {
    return null;
  }
}

export type PanelWA = {
  el: HTMLElement;
  /** La sección se ve o se dejó de ver (vistas/mensajeria.ts y el IntersectionObserver). */
  visible(si: boolean): void;
  /** Mensajes sin leer en total (la insignia de la pestaña). */
  noLeidos: Almacen<number>;
  /** En qué paso está (si pasa a «oculto», la pestaña se quita). */
  fase: Almacen<F.Fase>;
  /** Un estado nuevo traído de afuera (al volver a mirar el permiso). */
  aplicar(e: F.EstadoWA): void;
};

/* ── piezas ───────────────────────────────────────────────────────────────────────────────── */

function cara(nombre: string, grupo: boolean, tam = 44, anillo = false): HTMLElement {
  const f = h('div', { class: 'foto p2c-cara wa-cara' + (grupo ? ' grupo' : '') + (anillo ? ' wa-anillo' : ''), style: `width:${tam}px;height:${tam}px;font-size:${Math.round(tam * 0.36)}px`, 'aria-hidden': 'true' });
  if (grupo) f.append(iconoGrupo(Math.round(tam * 0.5)));
  else f.textContent = F.iniciales(nombre);
  return h('div', { class: 'p2c-cara-caja' }, f);
}

/** El ícono de grupo (dos personas), mismo trazo que los demás. */
function iconoGrupo(tam = 16): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(tam));
  svg.setAttribute('height', String(tam));
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('ico');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 3a4 4 0 1 0 .01 0Z M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75');
  svg.appendChild(p);
  return svg;
}

/** Un color estable por persona (el nombre de quien escribe en los grupos). */
function colorDe(clave: string): string {
  let n = 0;
  for (const c of clave) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${n % 360} 70% 70%)`;
}

/** base64 → URL de Blob (más liviano que un data: de varios MB). Quien la pide la suelta con revokeObjectURL. */
function urlDeBase64(base64: string, mime: string): string {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime || 'application/octet-stream' }));
}

const reducido = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── la vista ─────────────────────────────────────────────────────────────────────────────── */

export function vistaWhatsApp(inicial: F.EstadoWA): PanelWA {
  const raiz = h('div', { class: 'vista p2c-vista wa-vista' });
  const subtitulo = h('p', null, '');
  const acciones = h('div', { class: 'acciones' });
  raiz.append(h('div', { class: 'cabeza' }, h('div', null, h('h1', null, 'WhatsApp'), subtitulo), acciones));
  const cuerpo = h('div', { class: 'p2c-cuerpo' });
  raiz.append(cuerpo);

  let est: F.EstadoWA = inicial;
  let faseActual: F.Fase | '' = '';
  let seVeSeccion = false;
  let qrPedido = false;
  let relojEstado: ReturnType<typeof setTimeout> | null = null;
  const noLeidos = almacen(0);
  const faseA = almacen<F.Fase>(F.fase(inicial));
  let conv: ReturnType<typeof armarConversaciones> | null = null;
  let vinc: ReturnType<typeof armarVincular> | null = null;

  /** ¿Se ve de verdad? La sección a la vista y la ventana sin esconder. */
  const seVe = () => seVeSeccion && (typeof document === 'undefined' || document.visibilityState !== 'hidden');

  function aplicar(e: F.EstadoWA) {
    est = e;
    const f = F.fase(e);
    faseA.set(f);
    if (f !== faseActual) {
      if (faseActual === 'vincular' && f === 'listo') avisar(T('¡WhatsApp vinculado! Tus chats llegan en un momento.', 'WhatsApp linked! Your chats arrive in a moment.'), 'ok');
      faseActual = f;
      conv?.destruir();
      conv = null;
      vinc = null;
      vacio(cuerpo);
      if (f === 'listo') {
        conv = armarConversaciones();
        cuerpo.append(conv.el);
        conv.visible(seVe());
      } else if (f === 'vincular') {
        vinc = armarVincular();
        cuerpo.append(vinc.el);
      } else if (f === 'sin-puente') {
        cuerpo.append(tarjetaCentrada(T('WhatsApp todavía no está conectado en el servidor', 'WhatsApp isn’t connected on the server yet'), T('Cuando el puente de WhatsApp esté listo en AU-RA, aquí podrás vincular tu teléfono.', 'Once the WhatsApp bridge is ready on AU-RA, you can link your phone here.')));
      } else if (f === 'oculto') {
        cuerpo.append(tarjetaCentrada(T('WhatsApp no está disponible en esta cuenta', 'WhatsApp isn’t available on this account'), ''));
      } else {
        cuerpo.append(h('div', { class: 'tarjeta p2c-centrado' }, h('span', { class: 'cargando' })));
      }
    } else vinc?.actualizar();
    pintarCabeza();
    programarEstado();
  }

  function tarjetaCentrada(titulo: string, texto: string) {
    return h('section', { class: 'tarjeta p2c-sin' }, h('div', { class: 'p2c-sin-icono' }, iconoP('burbujas', 44)), h('small', { class: 'p2c-marca' }, 'WHATSAPP'), h('h2', null, titulo), texto ? h('p', { class: 'tenue' }, texto) : null);
  }

  function pintarCabeza() {
    vacio(acciones);
    const f = F.fase(est);
    if (f === 'listo') {
      const numero = F.numeroDeJid(String(est.numero || '').replace(/\D/g, '') + '@s.whatsapp.net');
      subtitulo.textContent = [T('Tu WhatsApp, vinculado a este equipo', 'Your WhatsApp, linked to this PC'), est.nombre, numero].filter(Boolean).join(' · ');
      acciones.append(
        est.conectado === false
          ? h('span', { class: 'etiqueta wa-etq-aviso', title: T('El puente se está reconectando con WhatsApp', 'The bridge is reconnecting to WhatsApp') }, T('Reconectando…', 'Reconnecting…'))
          : h('span', { class: 'etiqueta ok' }, T('Conectado', 'Connected')),
        boton(T('Desvincular', 'Unlink'), () => void desvincular(), { tipo: 'fantasma', titulo: T('Quitar este WhatsApp de AURA', 'Remove this WhatsApp from AURA') }),
      );
    } else if (f === 'vincular') {
      subtitulo.textContent = T('Vincula tu WhatsApp y míralo y contéstalo desde aquí, aparte de PULSE2CHAT.', 'Link your WhatsApp to read and reply from here, separate from PULSE2CHAT.');
    } else subtitulo.textContent = T('Tu WhatsApp personal, aparte de PULSE2CHAT.', 'Your personal WhatsApp, separate from PULSE2CHAT.');
  }

  /** El estado se vuelve a preguntar solo a la vista: cada 3 s mientras vincula (el QR cambia), cada 30 s ya vinculado. */
  function programarEstado() {
    if (relojEstado) clearTimeout(relojEstado);
    relojEstado = null;
    const ms = F.sondeoEstado(est);
    if (!ms || !seVe()) return;
    relojEstado = setTimeout(async () => {
      relojEstado = null;
      try {
        const e = await pedir<F.EstadoWA | null>('whatsapp.estado', null, 20_000);
        // Un corte no esconde nada: solo una respuesta de verdad cambia el paso.
        if (e) aplicar(e);
        else programarEstado();
      } catch {
        programarEstado();
      }
    }, ms);
  }

  async function desvincular() {
    const si = await dialogoConfirmar(
      T('¿Desvincular WhatsApp?', 'Unlink WhatsApp?'),
      T(
        'AURA deja de ver tu WhatsApp y en tu teléfono desaparece de «Dispositivos vinculados». Tus chats siguen en tu teléfono; para volver, lo vinculas otra vez con el QR.',
        'AURA stops seeing your WhatsApp and it disappears from “Linked devices” on your phone. Your chats stay on your phone; to come back, link it again with the QR.',
      ),
      T('Desvincular', 'Unlink'),
    );
    if (!si) return;
    try {
      await pedir('whatsapp.desvincular', null, 30_000);
      avisar(T('WhatsApp desvinculado de este equipo.', 'WhatsApp unlinked from this PC.'), 'ok');
      aplicar({ ...est, vinculado: false, conectado: false, qr: undefined, codigo: undefined, vinculando: false });
    } catch (e) {
      avisar(textoError(e, T('No se pudo desvincular. Vuelve a intentar.', 'Couldn’t unlink. Try again.')), 'mal');
    }
  }

  /* ── vincular ── */
  function armarVincular() {
    let modo: 'qr' | 'numero' = 'qr';
    let pidiendo = false;
    const caja = h('div', { class: 'wa-qr', 'aria-live': 'polite' });
    const error = h('p', { class: 'p2c-error', role: 'alert' });
    error.hidden = true;
    const paso3 = h('li', null, '');
    const nota = h('p', { class: 'nota' }, '');
    const campo = h('input', { type: 'text', inputmode: 'tel', autocomplete: 'tel', placeholder: T('9999-9999 o +504 9999-9999', '+504 9999-9999'), 'aria-label': T('Tu número de WhatsApp', 'Your WhatsApp number') }) as HTMLInputElement;
    const pedirCodigo = boton(T('Pedir el código', 'Get the code'), () => void pedirVinculo(true), { tipo: 'acento' });
    const formNumero = h('div', { class: 'wa-numero' }, h('label', { class: 'campo' }, h('small', null, T('Tu número de WhatsApp (con 504 si no es de Honduras… o solo tus 8 cifras)', 'Your WhatsApp number, with country code')), campo), pedirCodigo);
    formNumero.hidden = true;
    const cambiarModo = boton(T('Vincular con número', 'Link with phone number'), () => {
      modo = modo === 'qr' ? 'numero' : 'qr';
      error.hidden = true;
      pintar();
      if (modo === 'numero') setTimeout(() => campo.focus(), 30);
      else if (!est.qr && !pidiendo) void pedirVinculo(false);
    }, { tipo: 'fantasma' });
    campo.addEventListener('keydown', (e) => e.key === 'Enter' && void pedirVinculo(true));

    const el = h(
      'section',
      { class: 'tarjeta wa-vincular' },
      caja,
      h(
        'div',
        { class: 'wa-pasos' },
        h('small', { class: 'p2c-marca' }, 'WHATSAPP'),
        h('h2', null, T('Vincula tu WhatsApp', 'Link your WhatsApp')),
        h('p', { class: 'wa-guia' }, T('Abre WhatsApp en tu teléfono → Dispositivos vinculados → Vincular un dispositivo y escanea', 'Open WhatsApp on your phone → Linked devices → Link a device and scan')),
        h(
          'ol',
          null,
          h('li', null, T('Abre WhatsApp en tu teléfono.', 'Open WhatsApp on your phone.')),
          h('li', null, T('Toca Menú ⋮ (Android) o Configuración (iPhone) → Dispositivos vinculados.', 'Tap Menu ⋮ (Android) or Settings (iPhone) → Linked devices.')),
          paso3,
        ),
        nota,
        error,
        formNumero,
        h('div', { class: 'wa-pie' }, cambiarModo),
      ),
    );

    async function pedirVinculo(conNumero: boolean) {
      if (pidiendo) return;
      let telefono: string | undefined;
      if (conNumero) {
        const t = F.telefonoParaVincular(campo.value);
        if (!t.valido) {
          error.textContent = T('Escribe tu número con el código de país (Honduras: 504 y tus 8 cifras).', 'Type your number with the country code.');
          error.hidden = false;
          return;
        }
        telefono = t.numero;
      }
      pidiendo = true;
      qrPedido = true;
      error.hidden = true;
      pedirCodigo.disabled = true;
      pintar();
      try {
        const r = await pedir<{ qr?: string; codigo?: string } | null>('whatsapp.vincular', telefono ? { telefono } : {}, 45_000);
        est = { ...est, vinculando: true, qr: r?.qr || (telefono ? undefined : est.qr), codigo: r?.codigo || undefined };
      } catch (e) {
        error.textContent = textoError(e, T('No se pudo empezar a vincular. Vuelve a intentar.', 'Couldn’t start linking. Try again.'));
        error.hidden = false;
      } finally {
        pidiendo = false;
        pedirCodigo.disabled = false;
        pintar();
        programarEstado();
      }
    }

    function pintar() {
      vacio(caja);
      caja.classList.toggle('numero', modo === 'numero');
      formNumero.hidden = modo !== 'numero' || !!est.codigo;
      cambiarModo.querySelector('span')!.textContent = modo === 'qr' ? T('Vincular con número', 'Link with phone number') : T('Usar el código QR', 'Use the QR code');
      if (modo === 'qr') {
        paso3.textContent = T('Toca «Vincular un dispositivo» y apunta la cámara a este código.', 'Tap “Link a device” and point the camera at this code.');
        nota.textContent = T('El código cambia cada pocos segundos; aquí se actualiza solo.', 'The code changes every few seconds; it updates here on its own.');
        if (est.qr && /^data:image\//.test(est.qr)) caja.append(h('img', { src: est.qr, alt: T('Código QR para vincular WhatsApp', 'QR code to link WhatsApp'), class: 'wa-qr-img', draggable: 'false' }));
        else if (pidiendo || (est.vinculando && !est.codigo)) caja.append(h('div', { class: 'wa-qr-espera' }, h('span', { class: 'cargando' }), h('small', { class: 'tenue' }, T('Preparando el código…', 'Preparing the code…'))));
        else
          caja.append(
            h(
              'div',
              { class: 'wa-qr-espera' },
              h('small', { class: 'tenue' }, qrPedido ? T('El código venció.', 'The code expired.') : T('Listo para vincular.', 'Ready to link.')),
              boton(qrPedido ? T('Otro código QR', 'New QR code') : T('Mostrar el código QR', 'Show the QR code'), () => void pedirVinculo(false), { tipo: 'acento', icono: 'actualizar' }),
            ),
          );
      } else {
        paso3.textContent = T('Toca «Vincular con número de teléfono» y escribe este código.', 'Tap “Link with phone number instead” and type this code.');
        nota.textContent = est.codigo ? T('Escríbelo tal cual en tu teléfono. Vence en unos minutos.', 'Type it exactly on your phone. It expires in a few minutes.') : T('Te doy un código de 8 letras para escribir en tu teléfono.', 'I’ll give you an 8-letter code to type on your phone.');
        if (est.codigo) caja.append(h('div', { class: 'wa-codigo', 'aria-label': est.codigo }, ...F.codigoBonito(est.codigo).split('').map((c) => h('span', { class: c === '-' ? 'guion' : '' }, c))));
        else if (pidiendo) caja.append(h('div', { class: 'wa-qr-espera' }, h('span', { class: 'cargando' })));
        else caja.append(h('div', { class: 'wa-qr-espera' }, iconoP('telefono', 40), h('small', { class: 'tenue' }, T('Escribe tu número a la derecha.', 'Type your number on the right.'))));
      }
    }

    pintar();
    if (F.pedirQr(est, qrPedido)) void pedirVinculo(false);
    return { el, actualizar: pintar };
  }

  /* ── lista + conversación ── */
  function armarConversaciones() {
    let chats: F.ChatWA[] | null = null;
    let chatsDe = '';
    let errorLista = '';
    let abierto: string | null = null;
    let activo = false;
    let relojChats: ReturnType<typeof setTimeout> | null = null;
    let vuelta = 0;
    /** Los chats que marcaste leídos aquí: hasta que llegue algo más nuevo, sin insignia (el servidor tarda un poco). */
    const leidosAqui = new Map<string, number>();
    const borradores = new Map<string, string>();

    const buscar = h('input', { type: 'search', placeholder: T('Buscar chats', 'Search chats'), 'aria-label': T('Buscar en WhatsApp', 'Search WhatsApp'), autocomplete: 'off', spellcheck: false }) as HTMLInputElement;
    const buscando = h('span', { class: 'cargando' });
    buscando.hidden = true;
    const banda = h('div', { class: 'p2c-banda', role: 'status' });
    banda.hidden = true;
    const listaEl = h('div', { class: 'lista p2c-lista', role: 'list' });
    const lado = h(
      'aside',
      { class: 'p2c-lado', 'aria-label': T('Chats de WhatsApp', 'WhatsApp chats') },
      h('div', { class: 'p2c-lado-cab' }, h('div', null, h('h2', null, T('Chats', 'Chats')), h('small', { class: 'p2c-cifrado' }, T('WhatsApp personal', 'Personal WhatsApp')))),
      h('label', { class: 'p2c-buscar' }, iconoP('buscar', 16), buscar, buscando),
      banda,
      listaEl,
    );
    const hiloEl = h('section', { class: 'p2c-hilo', 'aria-label': T('Conversación', 'Conversation') });
    const el = h('div', { class: 'p2c wa' }, lado, hiloEl);

    let relojBuscar: ReturnType<typeof setTimeout> | null = null;
    buscar.addEventListener('input', () => {
      pintarLista();
      if (relojBuscar) clearTimeout(relojBuscar);
      buscando.hidden = false;
      relojBuscar = setTimeout(() => void refrescar(), 350);
    });
    buscar.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && buscar.value) {
        buscar.value = '';
        buscar.dispatchEvent(new Event('input'));
      }
    });

    const conLeidos = (c: F.ChatWA): F.ChatWA => {
      const hasta = leidosAqui.get(c.jid);
      return hasta != null && c.hora <= hasta ? { ...c, noLeidos: 0 } : abierto === c.jid && activo ? { ...c, noLeidos: 0 } : c;
    };

    async function refrescar() {
      const q = buscar.value.trim();
      const mia = ++vuelta;
      try {
        const r = await pedir<{ chats?: F.ChatWA[] } | null>('whatsapp.chats', q ? { buscar: q } : null, 25_000);
        if (mia !== vuelta) return;
        chats = F.ordenarChats((r?.chats || []).map(conLeidos));
        chatsDe = q;
        errorLista = '';
        if (!q) noLeidos.set(F.totalNoLeidos(chats));
      } catch (e) {
        if (mia !== vuelta) return;
        errorLista = textoError(e, T('Sin conexión con WhatsApp.', 'No connection to WhatsApp.'));
      }
      buscando.hidden = true;
      pintarLista();
      hilo?.chatCambio();
    }

    function programar() {
      if (relojChats) clearTimeout(relojChats);
      relojChats = null;
      if (!activo) return;
      relojChats = setTimeout(async () => {
        relojChats = null;
        await refrescar();
        programar();
      }, F.SONDEO.chats);
    }

    function pintarLista() {
      banda.hidden = !errorLista;
      banda.textContent = errorLista ? `${errorLista} ${T('Reintentando…', 'Retrying…')}` : '';
      const scroll = listaEl.scrollTop;
      vacio(listaEl);
      if (chats === null) {
        for (let i = 0; i < 6; i++) listaEl.append(h('div', { class: 'p2c-esqueleto', style: `--i:${i}` }, h('i'), h('div', null, h('b'), h('b'))));
        return;
      }
      const q = buscar.value.trim();
      const visibles = chatsDe === q ? chats : F.filtrarChats(chats, q);
      for (const c of visibles) listaEl.append(fila(c));
      if (!visibles.length)
        listaEl.append(
          q
            ? h('p', { class: 'p2c-vacio tenue' }, buscando.hidden ? T('Ningún chat con ese nombre.', 'No chat by that name.') : '')
            : h('div', { class: 'p2c-vacio' }, h('div', { class: 'p2c-sin-icono chico' }, iconoP('burbujas', 30)), h('strong', null, T('Todavía no hay chats', 'No chats yet')), h('p', { class: 'tenue' }, T('Los chats de tu WhatsApp aparecen aquí en cuanto el teléfono termine de pasarlos.', 'Your WhatsApp chats show up here once your phone finishes syncing them.'))),
        );
      listaEl.scrollTop = scroll;
    }

    function fila(c: F.ChatWA): HTMLElement {
      const n = Math.max(0, c.noLeidos || 0);
      const previa = F.vistaPrevia(c, en());
      return h(
        'button',
        {
          type: 'button',
          role: 'listitem',
          class: 'item p2c-fila wa-fila' + (abierto === c.jid ? ' activa' : '') + (n ? ' sin-leer' : ''),
          'aria-current': abierto === c.jid ? 'true' : null,
          'aria-label': `${c.nombre}${c.grupo ? `, ${T('grupo', 'group')}` : ''}${n ? `, ${n} ${T('sin leer', 'unread')}` : ''}`,
          on: { click: () => abrir(c.jid) },
        },
        cara(c.nombre, c.grupo, 44, n > 0),
        h(
          'div',
          { class: 'p2c-fila-cuerpo' },
          h('div', { class: 'p2c-fila-arriba' }, h('strong', null, c.nombre), c.grupo ? h('span', { class: 'wa-grupo', title: T('Grupo', 'Group') }, T('Grupo', 'Group')) : null, h('small', { class: 'p2c-hora' }, F.cuandoChat(c.hora, Date.now(), en()))),
          h('div', { class: 'p2c-fila-abajo' }, h('span', null, previa || ' '), n ? h('span', { class: 'p2c-insignia-n' }, F.insignia(n)) : null),
        ),
      );
    }

    /* la conversación */
    let hilo: ReturnType<typeof armarHilo> | null = null;

    function abrir(jid: string) {
      if (abierto === jid && hilo) {
        hilo.enfocar();
        return;
      }
      hilo?.destruir();
      abierto = jid;
      hilo = armarHilo(jid);
      vacio(hiloEl).append(hilo.el);
      el.classList.add('con-hilo');
      hilo.visible(activo);
      pintarLista();
      hilo.enfocar();
    }

    function cerrar() {
      hilo?.destruir();
      hilo = null;
      abierto = null;
      el.classList.remove('con-hilo');
      pintarNada();
      pintarLista();
    }

    function pintarNada() {
      vacio(hiloEl).append(
        h(
          'div',
          { class: 'p2c-nada' },
          h('div', { class: 'p2c-sin-icono' }, iconoP('burbujas', 40)),
          h('h3', null, T('Elige un chat', 'Pick a chat')),
          h('p', { class: 'tenue' }, T('Lee y contesta tu WhatsApp desde aquí. Lo que escribas sale de tu número, como desde el teléfono.', 'Read and reply to your WhatsApp from here. What you write goes out from your number, like from your phone.')),
        ),
      );
    }

    function marcarLeido(jid: string, hora: number) {
      leidosAqui.set(jid, Math.max(hora, leidosAqui.get(jid) || 0));
      if (chats) {
        chats = chats.map(conLeidos);
        if (!buscar.value.trim()) noLeidos.set(F.totalNoLeidos(chats));
        pintarLista();
      }
      void pedir('whatsapp.leido', { chat: jid }, 20_000).catch(() => null);
    }

    function armarHilo(jid: string) {
      const chat = () => chats?.find((c) => c.jid === jid) || { jid, nombre: F.numeroDeJid(jid) || jid.split('@')[0], grupo: jid.endsWith('@g.us'), noLeidos: 0, hora: 0, ultimo: '', ultimoMio: false };
      let servidor: F.MensajeWA[] | null = null;
      let locales: F.MensajeWA[] = [];
      let hayMas = true;
      let cargandoAntes = false;
      let seVeHilo = false;
      let reloj: ReturnType<typeof setTimeout> | null = null;
      let vueltaHilo = 0;
      let serieLocal = 0;
      let leidoHasta = 0;
      let primeraVez = true;
      let errorHilo = '';
      const vivas = new Set<string>();

      const nombre = h('strong', null, '');
      const sub = h('small', { class: 'p2c-sub' }, '');
      const caraCaja = h('div', { class: 'p2c-hilo-cara' });
      const cab = h('header', { class: 'p2c-hilo-cab' }, botonP('atras', T('Volver a los chats', 'Back to chats'), () => cerrar(), 'p2c-volver'), h('div', { class: 'p2c-quien wa-quien' }, caraCaja, h('div', null, nombre, sub)));
      const bandaHilo = h('div', { class: 'p2c-banda', role: 'status' });
      bandaHilo.hidden = true;
      const antes = h('div', { class: 'p2c-antes' }, h('span', { class: 'cargando' }));
      antes.hidden = true;
      const filasEl = h('div', { class: 'p2c-filas', role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions' });
      const mensajes = h('div', { class: 'p2c-mensajes' }, antes, filasEl);
      const bajar = botonP('abajo', T('Ir al último mensaje', 'Go to the latest message'), () => irAbajo(true), 'p2c-bajar');
      bajar.hidden = true;
      const caja = h('textarea', { rows: 1, maxlength: F.TEXTO_MAX, placeholder: T('Escribe un mensaje', 'Type a message'), 'aria-label': T('Escribe un mensaje de WhatsApp', 'Write a WhatsApp message') }) as HTMLTextAreaElement;
      caja.value = borradores.get(jid) || '';
      const contador = h('small', { class: 'wa-contador' }, '');
      const btnEnviar = botonP('enviar', T('Enviar (Enter)', 'Send (Enter)'), () => enviar(), 'acento p2c-enviar');
      const componer = h('div', { class: 'p2c-componer' }, h('div', { class: 'p2c-caja' }, caja, contador), btnEnviar);
      const elHilo = h('div', { class: 'p2c-hilo-dentro' }, cab, bandaHilo, h('div', { class: 'p2c-mensajes-caja' }, mensajes, bajar), componer);

      function pintarCab() {
        const c = chat();
        nombre.textContent = c.nombre;
        sub.textContent = c.grupo ? T('Grupo', 'Group') : F.numeroDeJid(jid) || T('WhatsApp', 'WhatsApp');
        vacio(caraCaja).append(cara(c.nombre, c.grupo, 40));
      }

      const pegadoAbajo = () => mensajes.scrollHeight - mensajes.scrollTop - mensajes.clientHeight < 80;
      const irAbajo = (suave = false) => mensajes.scrollTo({ top: mensajes.scrollHeight, behavior: suave && !reducido() ? 'smooth' : 'auto' });

      function mostrarBanda(texto: string) {
        bandaHilo.textContent = texto;
        bandaHilo.hidden = !texto;
      }

      async function cargar() {
        const mia = ++vueltaHilo;
        try {
          const r = await pedir<{ mensajes?: F.MensajeWA[] } | null>('whatsapp.mensajes', { chat: jid }, 25_000);
          if (mia !== vueltaHilo) return;
          const recientes = r?.mensajes || [];
          // Lo que se cargó subiendo (más viejo que esta página) se queda.
          const corte = recientes.length ? recientes[0].hora : Infinity;
          servidor = F.juntarAnteriores((servidor || []).filter((m) => m.hora < corte), recientes);
          errorHilo = '';
          // Lo estás viendo: queda leído al abrirlo y cada vez que llega algo nuevo de la otra persona.
          if (seVeHilo) {
            const ultimoSuyo = servidor.reduce((x, m) => (m.mio ? x : Math.max(x, m.hora)), 0);
            if (leidoHasta === 0 || F.hayNuevoSuyo(servidor, leidoHasta)) {
              leidoHasta = Math.max(ultimoSuyo, 1);
              marcarLeido(jid, Math.max(ultimoSuyo, chat().hora));
            }
          }
        } catch (e) {
          if (mia !== vueltaHilo) return;
          errorHilo = textoError(e, T('Sin conexión con WhatsApp.', 'No connection to WhatsApp.'));
        }
        pintar();
      }

      async function cargarAnteriores() {
        if (!servidor?.length || cargandoAntes || !hayMas) return;
        cargandoAntes = true;
        antes.hidden = false;
        try {
          const r = await pedir<{ mensajes?: F.MensajeWA[] } | null>('whatsapp.mensajes', { chat: jid, antes: servidor[0].hora }, 25_000);
          const viejos = (r?.mensajes || []).filter((m) => m.hora < servidor![0].hora);
          if (!viejos.length) hayMas = false;
          else {
            const desdeAbajo = mensajes.scrollHeight - mensajes.scrollTop;
            servidor = F.juntarAnteriores(viejos, servidor);
            pintar();
            mensajes.scrollTop = mensajes.scrollHeight - desdeAbajo;
          }
        } catch {
          /* se reintenta al volver a subir */
        } finally {
          cargandoAntes = false;
          antes.hidden = true;
        }
      }

      function programarHilo() {
        if (reloj) clearTimeout(reloj);
        reloj = null;
        if (!seVeHilo) return;
        reloj = setTimeout(async () => {
          reloj = null;
          await cargar();
          programarHilo();
        }, F.SONDEO.hilo);
      }

      /* las filas, reutilizando lo ya pintado (un audio que suena no se corta en cada sondeo) */
      const pintadas = new Map<string, { firma: string; el: HTMLElement }>();
      function pintar() {
        if (errorHilo) mostrarBanda(`${errorHilo} ${T('Reintentando…', 'Retrying…')}`);
        else if (!locales.some((l) => l.fallido)) mostrarBanda('');
        if (servidor === null) {
          if (!filasEl.childElementCount) filasEl.append(h('div', { class: 'p2c-centrado' }, h('span', { class: 'cargando' })));
          return;
        }
        const todos = F.fusionarMensajes(servidor, locales);
        const abajo = pegadoAbajo();
        const desdeAbajo = mensajes.scrollHeight - mensajes.scrollTop;
        const filas = F.filasConversacion(todos, chat().grupo, Date.now(), en());
        const nuevas: HTMLElement[] = [];
        const vistas = new Set<string>();
        let mioNuevo = false;
        for (const f of filas) {
          const firma = f.tipo === 'dia' ? f.texto : JSON.stringify([f.primera, f.ultima, f.autor, f.m.texto, f.m.eliminado, f.m.editado, f.m.pendiente, f.m.fallido, f.m.motivo, f.m.miniatura ? 1 : 0, f.m.nombreDe]);
          vistas.add(f.clave);
          const ya = pintadas.get(f.clave);
          if (ya && ya.firma === firma) {
            nuevas.push(ya.el);
            continue;
          }
          const elFila = f.tipo === 'dia' ? h('div', { class: 'p2c-dia' }, h('span', null, f.texto)) : burbuja(f);
          if (!ya && !primeraVez) {
            elFila.classList.add('entra');
            if (f.tipo === 'msg' && f.m.mio) mioNuevo = true;
          }
          pintadas.set(f.clave, { firma, el: elFila });
          nuevas.push(elFila);
        }
        for (const k of [...pintadas.keys()]) if (!vistas.has(k)) pintadas.delete(k);
        if (!filas.length) nuevas.push(h('p', { class: 'p2c-saludo tenue' }, T('No hay mensajes recientes en este chat.', 'No recent messages in this chat.')));
        filasEl.replaceChildren(...nuevas);
        if (primeraVez || abajo || mioNuevo) irAbajo(!primeraVez);
        else mensajes.scrollTop = mensajes.scrollHeight - desdeAbajo;
        primeraVez = false;
        bajar.hidden = pegadoAbajo();
      }

      function burbuja(f: Extract<F.FilaWA, { tipo: 'msg' }>): HTMLElement {
        const { m, primera, ultima, autor } = f;
        const conFoto = !m.eliminado && !!m.miniatura && (m.tipo === 'imagen' || m.tipo === 'video' || m.tipo === 'sticker');
        const meta = h(
          'span',
          { class: 'p2c-meta' },
          m.editado && !m.eliminado ? h('span', { class: 'wa-editado' }, T('editado', 'edited')) : null,
          h('time', { datetime: new Date(m.hora || Date.now()).toISOString() }, F.horaHN(m.hora)),
          m.mio && m.pendiente ? h('span', { class: 'p2c-reloj', title: T('Enviando…', 'Sending…'), 'aria-label': T('Enviando', 'Sending') }) : null,
        );
        const partes: (Node | null)[] = [];
        if (autor) partes.push(h('div', { class: 'wa-autor', style: `color:${colorDe(m.de || m.nombreDe)}` }, m.nombreDe || F.numeroDeJid(m.de) || m.de.split('@')[0]));
        const etiqueta = F.etiquetaTipo(m, en());
        if (m.eliminado) partes.push(h('em', { class: 'p2c-tenue-msg' }, etiqueta));
        else {
          if (conFoto) partes.push(fotoMensaje(m));
          else if (etiqueta) partes.push(adjunto(m, etiqueta));
          if (m.texto) partes.push(h('div', { class: 'p2c-texto' }, m.texto));
        }
        const filaEl = h(
          'div',
          { class: ['p2c-fila-msg', m.mio ? 'mio' : 'suyo', primera ? 'primera' : '', ultima ? 'ultima' : '', m.pendiente ? 'pendiente' : '', m.fallido ? 'fallido' : '', conFoto ? 'con-foto' : ''].filter(Boolean).join(' ') },
          m.mio && m.fallido ? botonP('actualizar', T('Reintentar el envío', 'Retry sending'), () => reintentar(m.id), 'p2c-reintentar', 14) : null,
          h('div', { class: 'p2c-burbuja' + (conFoto && !m.texto ? ' solo-foto' : '') }, ...partes, meta),
        );
        if (m.mio && m.fallido)
          filaEl.append(
            h(
              'small',
              { class: 'p2c-fallo' },
              T('No se envió', 'Not sent') + (m.motivo ? `: ${m.motivo}` : '.'),
              ' ',
              h('button', { type: 'button', class: 'p2c-enlace', on: { click: () => reintentar(m.id) } }, T('Reintentar', 'Retry')),
              ' ',
              h('button', { type: 'button', class: 'p2c-enlace', on: { click: () => quitarLocal(m.id) } }, T('Quitar', 'Remove')),
            ),
          );
        return filaEl;
      }

      function fotoMensaje(m: F.MensajeWA): HTMLElement {
        const img = h('img', { src: 'data:image/jpeg;base64,' + m.miniatura, alt: m.texto || F.etiquetaTipo(m, en()), loading: 'lazy', decoding: 'async' }) as HTMLImageElement;
        img.addEventListener('load', () => pegadoAbajo() && irAbajo());
        const marca = m.tipo === 'video' ? h('span', { class: 'wa-video-marca' }, '▶', m.duracion ? ' ' + F.duracion(m.duracion) : '') : null;
        return h(
          'button',
          {
            type: 'button',
            class: 'p2c-foto-msg wa-foto' + (m.tipo === 'sticker' ? ' sticker' : ''),
            'aria-label': m.tipo === 'video' ? T('Ver el video', 'Play video') : T('Ver la foto en grande', 'View photo'),
            disabled: m.conMedia === false,
            on: { click: () => void verMedia(m) },
          },
          img,
          marca,
        );
      }

      /** Una nota de voz, un documento, una ubicación…: su etiqueta y, si hay archivo, cómo abrirlo. */
      function adjunto(m: F.MensajeWA, etiqueta: string): HTMLElement {
        const caja = h('div', { class: 'wa-adjunto' }, h('span', null, etiqueta));
        if (m.conMedia) {
          const texto = m.tipo === 'audio' ? T('Escuchar', 'Play') : m.tipo === 'documento' ? T('Abrir', 'Open') : T('Ver', 'View');
          const b = h('button', { type: 'button', class: 'p2c-enlace wa-abrir' }, texto) as HTMLButtonElement;
          b.addEventListener('click', async () => {
            if (m.tipo !== 'audio') return void verMedia(m);
            // La nota de voz suena aquí mismo, sin diálogo.
            b.disabled = true;
            b.textContent = T('Cargando…', 'Loading…');
            try {
              const r = await pedir<{ base64: string; mime: string }>('whatsapp.media', { chat: m.chat, id: m.id }, 70_000);
              const url = urlDeBase64(r.base64, r.mime);
              vivas.add(url);
              const audio = h('audio', { controls: true, src: url, class: 'wa-audio' }) as HTMLAudioElement;
              b.replaceWith(audio);
              void audio.play().catch(() => null);
            } catch (e) {
              b.disabled = false;
              b.textContent = texto;
              mostrarBanda(textoError(e, T('No se pudo abrir el audio.', 'Couldn’t open the audio.')));
            }
          });
          caja.append(b);
        }
        return caja;
      }

      /** El archivo en grande: foto, video o audio en un diálogo; un documento, para guardarlo. */
      async function verMedia(m: F.MensajeWA) {
        const contenido = h('div', { class: 'wa-media' }, h('span', { class: 'cargando' }));
        const d = dialogo(m.tipo === 'video' ? T('Video', 'Video') : m.tipo === 'documento' ? m.archivo || T('Documento', 'Document') : T('Foto', 'Photo'), contenido);
        d.el.classList.add('p2c-visor');
        let url = '';
        d.alCerrar(() => url && URL.revokeObjectURL(url));
        try {
          const r = await pedir<{ base64: string; mime: string }>('whatsapp.media', { chat: m.chat, id: m.id }, 70_000);
          url = urlDeBase64(r.base64, r.mime);
          vacio(contenido);
          if (/^image\//.test(r.mime)) contenido.append(h('img', { class: 'p2c-foto-grande', src: url, alt: m.texto || T('Foto', 'Photo') }));
          else if (/^video\//.test(r.mime)) contenido.append(h('video', { class: 'p2c-foto-grande', src: url, controls: true, autoplay: true }));
          else if (/^audio\//.test(r.mime)) contenido.append(h('audio', { src: url, controls: true, autoplay: true }));
          else {
            const a = h('a', { href: url, download: m.archivo || 'archivo', class: 'btn acento' }, T('Guardar en el equipo', 'Save to this PC')) as HTMLAnchorElement;
            contenido.append(h('p', { class: 'tenue' }, F.etiquetaTipo(m, en())), a);
          }
          if (m.texto) contenido.append(h('p', { class: 'wa-pie-media' }, m.texto));
        } catch (e) {
          vacio(contenido).append(h('p', { class: 'p2c-error' }, textoError(e, T('No se pudo abrir el archivo.', 'Couldn’t open the file.'))));
        }
      }

      /* enviar */
      function ajustarCaja() {
        caja.style.height = 'auto';
        caja.style.height = Math.min(160, caja.scrollHeight) + 'px';
        const largo = caja.value.length;
        btnEnviar.disabled = !F.textoEnviable(caja.value);
        contador.textContent = largo > F.TEXTO_MAX - 500 ? `${largo}/${F.TEXTO_MAX}` : '';
      }

      function enviar(texto = caja.value) {
        if (!F.textoEnviable(texto)) {
          if (texto.length > F.TEXTO_MAX) mostrarBanda(T('El mensaje es muy largo (máximo 4000 letras).', 'The message is too long (4000 characters max).'));
          return;
        }
        if (texto === caja.value) {
          caja.value = '';
          borradores.delete(jid);
          ajustarCaja();
        }
        const local = F.mensajeLocal(jid, texto, ++serieLocal);
        locales = [...locales, local];
        pintar();
        irAbajo(true);
        void pedir<{ mensaje?: F.MensajeWA } | null>('whatsapp.enviar', { chat: jid, texto }, 40_000)
          .then((r) => {
            locales = locales.filter((l) => l.id !== local.id);
            const enviado = r?.mensaje;
            if (enviado?.id) servidor = F.fusionarMensajes([...(servidor || []), enviado], []);
            else servidor = [...(servidor || []), { ...local, id: 'enviado-' + local.id, pendiente: false }];
            // La lista lo dice ya (sin esperar al sondeo).
            if (chats) {
              chats = F.ordenarChats(chats.map((c) => (c.jid === jid ? { ...c, hora: enviado?.hora || Date.now(), ultimo: texto, ultimoMio: true } : c)));
              pintarLista();
            }
            pintar();
          })
          .catch((e) => {
            const motivo = textoError(e, T('Revisa la conexión.', 'Check the connection.'));
            locales = locales.map((l) => (l.id === local.id ? { ...l, pendiente: false, fallido: true, motivo } : l));
            mostrarBanda(T('No se envió: ', 'Not sent: ') + motivo);
            pintar();
          });
      }

      function reintentar(id: string) {
        const l = locales.find((x) => x.id === id);
        if (!l) return;
        locales = locales.filter((x) => x.id !== id);
        mostrarBanda('');
        enviar(l.texto);
      }

      function quitarLocal(id: string) {
        locales = locales.filter((x) => x.id !== id);
        if (!locales.some((l) => l.fallido)) mostrarBanda('');
        pintar();
      }

      caja.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          enviar();
        }
      });
      caja.addEventListener('input', () => {
        ajustarCaja();
        if (caja.value.trim()) borradores.set(jid, caja.value);
        else borradores.delete(jid);
      });
      mensajes.addEventListener('scroll', () => {
        bajar.hidden = pegadoAbajo();
        if (mensajes.scrollTop < 60) void cargarAnteriores();
      });

      pintarCab();
      pintar();
      ajustarCaja();
      void cargar();

      return {
        el: elHilo,
        enfocar: () => caja.focus({ preventScroll: true }),
        /** La lista cambió (nombre o sin leer del chat abierto). */
        chatCambio: pintarCab,
        visible(si: boolean) {
          if (si === seVeHilo) return;
          seVeHilo = si;
          if (si) {
            void cargar();
            programarHilo();
          } else if (reloj) {
            clearTimeout(reloj);
            reloj = null;
          }
        },
        destruir() {
          seVeHilo = false;
          vueltaHilo++;
          if (reloj) clearTimeout(reloj);
          if (caja.value.trim()) borradores.set(jid, caja.value);
          vivas.forEach((u) => URL.revokeObjectURL(u));
        },
      };
    }

    pintarLista();
    pintarNada();
    // Las horas («hoy 14:05» → «ayer») se redibujan al pasar la medianoche con la lista abierta.
    const tic = setInterval(() => activo && pintarLista(), 60_000);

    return {
      el,
      visible(si: boolean) {
        if (si === activo) return;
        activo = si;
        hilo?.visible(si);
        if (si) {
          void refrescar();
          programar();
        } else if (relojChats) {
          clearTimeout(relojChats);
          relojChats = null;
        }
      },
      destruir() {
        activo = false;
        vuelta++;
        if (relojChats) clearTimeout(relojChats);
        if (relojBuscar) clearTimeout(relojBuscar);
        clearInterval(tic);
        hilo?.destruir();
      },
    };
  }

  /* ── a la vista o no ── */
  function recalcular() {
    const si = seVe();
    conv?.visible(si);
    programarEstado();
  }
  if (typeof IntersectionObserver !== 'undefined') new IntersectionObserver((e) => visible(e.some((x) => x.isIntersecting))).observe(raiz);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', recalcular);

  function visible(si: boolean) {
    if (si === seVeSeccion) return;
    seVeSeccion = si;
    recalcular();
  }

  aplicar(inicial);
  return { el: raiz, visible, noLeidos, fase: faseA, aplicar };
}
