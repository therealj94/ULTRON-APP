/**
 * PULSE2CHAT en el Centro: la MISMA cuenta que la app Orden Global y la web (mismos contactos, mismas
 * conversaciones, cifrado de punta a punta), con el Centro como un aparato más.
 *
 * Dos paneles, como un chat de escritorio: a la izquierda las conversaciones (buscar, solicitudes, el
 * círculo, gente del relevo; sin leer, en línea, «escribiendo…»), a la derecha el hilo (burbujas
 * agrupadas, separadores de día, fotos, palomitas de leído, el candado con el código de seguridad y la
 * caja de escribir: Enter envía, Mayús+Enter baja de renglón, se pueden pegar fotos). En ventanas
 * angostas se ve uno a la vez.
 *
 * La vista se crea UNA vez y se conserva al cambiar de sección. Las llamadas NO viven aquí: su pantalla
 * va encima de todo (pulse/pantallaLlamada.ts) y el buzón escucha siempre (pulse/index.ts).
 */
import '../pulse/pulse.css';
import { h, boton, vacio, avisar } from '../ui';
import { pedir } from '../puente';
import { T, estado } from '../estado';
import * as PULSE from '../pulse';
import * as RELEVO from '../pulse/relevo';
import * as CHATS from '../pulse/chats';
import { botonP, iconoP } from '../pulse/iconos';
import * as PAGAR from '../pulse/pagar';
import { cuandoLista, filasDelHilo, hora, iniciales, recortar, resumen, type Fila } from '../pulse/formato';

let unica: HTMLElement | null = null;

export function vistaPulse(): HTMLElement {
  if (unica) return unica;
  const raiz = h('div', { class: 'vista p2c-vista' });
  unica = raiz;

  const acciones = h('div', { class: 'acciones' });
  const subtitulo = h('p', null, T('Tus chats, llamadas y videollamadas, cifrados de punta a punta.', 'Your chats, calls and video calls, end-to-end encrypted.'));
  raiz.append(h('div', { class: 'cabeza' }, h('div', null, h('h1', null, 'PULSE2CHAT'), subtitulo), acciones));
  const cuerpo = h('div', { class: 'p2c-cuerpo' });
  raiz.append(cuerpo);

  let app: ReturnType<typeof armarApp> | null = null;
  let modo: 'cargando' | 'sin' | 'app' | '' = '';

  function pintarModo() {
    const c = PULSE.cuenta.get();
    const nuevo = c ? 'app' : PULSE.recuperando.get() ? 'cargando' : 'sin';
    if (nuevo === modo) return;
    modo = nuevo;
    app?.destruir();
    app = null;
    vacio(cuerpo);
    vacio(acciones);
    if (nuevo === 'cargando') {
      cuerpo.append(h('div', { class: 'tarjeta p2c-centrado' }, h('span', { class: 'cargando' }), h('p', { class: 'tenue' }, T('Abriendo PULSE2CHAT…', 'Opening PULSE2CHAT…'))));
    } else if (nuevo === 'sin') {
      cuerpo.append(sinCuenta());
    } else {
      app = armarApp();
      cuerpo.append(app.el);
      acciones.append(
        h('span', { class: 'etiqueta ok p2c-etq' }, iconoP('candado', 12), ' ', c!.correo),
        boton(T('Desconectar', 'Disconnect'), () => void confirmarSalir(), { tipo: 'fantasma', titulo: T('Desconectar PULSE2CHAT de este equipo', 'Disconnect PULSE2CHAT from this PC') }),
      );
    }
  }

  PULSE.cuenta.sub(pintarModo);
  PULSE.recuperando.sub(pintarModo);
  pintarModo();
  void PULSE.iniciarPulse().then(pintarModo);

  // ¿La sección está a la vista? (main.ts la quita del DOM al cambiar de sección.)
  if (typeof IntersectionObserver !== 'undefined') {
    new IntersectionObserver((e) => app?.visible(e.some((x) => x.isIntersecting))).observe(raiz);
  }
  return raiz;
}

/* ── sin cuenta del chat en este equipo ───────────────────────────────────────────────────── */

function sinCuenta(): HTMLElement {
  const error = h('p', { class: 'p2c-error', role: 'alert' });
  error.hidden = true;
  const btn = boton(T('Conectar PULSE2CHAT', 'Connect PULSE2CHAT'), () => void conectar(), { tipo: 'acento', icono: 'candado' });
  const conectar = async () => {
    btn.disabled = true;
    error.hidden = true;
    const texto = btn.querySelector('span')!;
    texto.textContent = T('Esperando a Genesis ID…', 'Waiting for Genesis ID…');
    btn.prepend(h('span', { class: 'cargando' }));
    try {
      // Abre Veta Wallet: la persona da permiso y AURA recibe el pase (un pase sirve una vez para el relevo).
      const r = await pedir<{ miembro?: { nombre?: string; correo?: string }; pase?: string; verificador?: string }>('entrar.genesis', null, 330_000);
      if (!r?.pase || !r?.verificador) throw new Error(T('Genesis ID no devolvió el pase para el chat. Vuelve a intentar.', 'Genesis ID didn’t return the chat pass. Try again.'));
      await PULSE.conectarConPase(r.pase, r.verificador, r.miembro?.nombre, estado()?.sesion?.correo || r.miembro?.correo);
      avisar(T('PULSE2CHAT conectado en este equipo.', 'PULSE2CHAT connected on this PC.'), 'ok');
    } catch (e: any) {
      error.textContent =
        e?.code === 401 || e?.code === 403
          ? T('El pase ya se usó o venció. Vuelve a intentar.', 'The pass was already used or expired. Try again.')
          : e?.code
            ? T('El chat no pudo conectarse ahora. Vuelve a intentar en un momento.', 'The chat couldn’t connect right now. Try again shortly.')
            : String(e?.message || T('No se pudo conectar el chat.', 'Couldn’t connect the chat.'));
      error.hidden = false;
    } finally {
      btn.disabled = false;
      btn.querySelector('.cargando')?.remove();
      texto.textContent = T('Conectar PULSE2CHAT', 'Connect PULSE2CHAT');
    }
  };
  return h(
    'section',
    { class: 'tarjeta p2c-sin' },
    h('div', { class: 'p2c-sin-icono' }, iconoP('burbujas', 44)),
    h('small', { class: 'p2c-marca' }, 'PULSE2CHAT'),
    h('h2', null, T('Tu chat de Orden Global, aquí', 'Your Orden Global chat, here')),
    h(
      'p',
      { class: 'tenue' },
      T(
        'Los mismos contactos y conversaciones que en la app Orden Global y en tu teléfono, cifrados de punta a punta. Este equipo tendrá su propia llave: nadie más, ni el relevo, puede leer lo que se escriban.',
        'The same contacts and chats as in the Orden Global app and on your phone, end-to-end encrypted. This PC gets its own key: no one else, not even the relay, can read what you write.',
      ),
    ),
    error,
    btn,
    h('small', { class: 'nota' }, T('Se abre Veta Wallet (Genesis ID) para dar permiso y vuelves aquí solo.', 'Veta Wallet (Genesis ID) opens to give permission, then you come back here.')),
  );
}

async function confirmarSalir() {
  const si = await dialogoConfirmar(
    T('¿Desconectar PULSE2CHAT?', 'Disconnect PULSE2CHAT?'),
    T(
      'Este equipo deja de recibir mensajes y llamadas. Tus conversaciones siguen en tus otros aparatos; para volver, conéctalo otra vez con Genesis ID.',
      'This PC stops receiving messages and calls. Your chats stay on your other devices; to come back, connect again with Genesis ID.',
    ),
    T('Desconectar', 'Disconnect'),
  );
  if (si) await PULSE.salir();
}

/* ── diálogos (velo + tarjeta) ────────────────────────────────────────────────────────────── */

export function dialogo(titulo: string, ...contenido: (Node | null)[]): { el: HTMLElement; cerrar: () => void; alCerrar: (f: () => void) => void } {
  const antes = document.activeElement as HTMLElement | null;
  const fin = new Set<() => void>();
  let cerrado = false;
  const cerrar = () => {
    // Escape y un clic en el velo a la vez no cierran (ni responden) dos veces.
    if (cerrado) return;
    cerrado = true;
    velo.classList.add('sale');
    document.removeEventListener('keydown', teclas, true);
    setTimeout(() => velo.remove(), 220);
    fin.forEach((f) => f());
    antes?.focus?.({ preventScroll: true });
  };
  const teclas = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      cerrar();
    }
  };
  const tarjeta = h(
    'div',
    { class: 'p2c-dialogo', role: 'dialog', 'aria-modal': 'true', 'aria-label': titulo },
    h('div', { class: 'p2c-dialogo-cab' }, h('h2', null, titulo), botonP('cerrar', T('Cerrar', 'Close'), () => cerrar())),
    ...contenido.filter((x): x is Node => !!x),
  );
  const velo = h('div', { class: 'p2c-velo', on: { mousedown: (e: MouseEvent) => e.target === velo && cerrar() } }, tarjeta);
  document.body.appendChild(velo);
  document.addEventListener('keydown', teclas, true);
  setTimeout(() => (tarjeta.querySelector('input, textarea, .btn.acento') as HTMLElement | null)?.focus(), 30);
  return { el: tarjeta, cerrar, alCerrar: (f) => fin.add(f) };
}

export function dialogoConfirmar(titulo: string, texto: string, si: string): Promise<boolean> {
  return new Promise((listo) => {
    let dicho = false;
    const d = dialogo(
      titulo,
      h('p', { class: 'tenue' }, texto),
      h(
        'div',
        { class: 'p2c-dialogo-pie' },
        boton(T('Cancelar', 'Cancel'), () => d.cerrar(), { tipo: 'fantasma' }),
        boton(si, () => {
          dicho = true;
          d.cerrar();
        }, { tipo: 'peligro' }),
      ),
    );
    d.alCerrar(() => listo(dicho));
  });
}

/* ── enviar ORIGEN: AURA lo prepara, Veta Wallet lo firma ─────────────────────────────────── */

/**
 * El diálogo de enviar: la dirección sale de la ficha de la persona en el chat (nunca escrita a mano).
 * «Revisar en Veta Wallet» abre el envío ya llenado; allá se firma con la contraseña. AURA vigila la
 * cadena y, cuando el envío pasó, deja el comprobante en el hilo.
 */
export async function abrirPagar(correo: string, nombre: string, monto = '', moneda = 'ORIGEN') {
  const estadoEl = h('p', { class: 'p2c-resultado', role: 'status' });
  const direccionEl = h('small', { class: 'tenue' }, T('Buscando su dirección de Veta Wallet…', 'Looking up their Veta Wallet address…'));
  const campo = h('input', { type: 'text', inputmode: 'decimal', value: monto, placeholder: '0.00', 'aria-label': T('Cantidad', 'Amount'), class: 'p2c-monto' }) as HTMLInputElement;
  const elegir = h('select', { 'aria-label': T('Moneda', 'Coin') }, ...PAGAR.MONEDAS.map((x) => h('option', { value: x, selected: x === moneda }, x))) as HTMLSelectElement;
  // Mientras se abre, la lista única dice cuáles se muestran hoy.
  void PAGAR.monedasVisibles().then((l) => {
    const actual = elegir.value;
    elegir.replaceChildren(...l.map((x) => h('option', { value: x, selected: x === actual }, x)));
  });
  let direccion: string | null = null;
  const ir = boton(T('Revisar y firmar en Veta Wallet', 'Review and sign in Veta Wallet'), () => void enviar(), { tipo: 'acento', icono: 'enlace', deshabilitado: true });
  const d = dialogo(
    T(`Enviar a ${nombre}`, `Send to ${nombre}`),
    direccionEl,
    h('div', { class: 'fila p2c-pago-fila' }, campo, elegir),
    h('p', { class: 'nota' }, T('AURA no mueve tu dinero: abre el envío ya llenado en Veta Wallet y tú lo confirmas allá con tu contraseña. Cuando la cadena lo confirme, dejo el comprobante en este chat.', 'AURA never moves your money: it opens the send pre-filled in Veta Wallet and you confirm it there with your password. Once the chain confirms it, I post the receipt in this chat.')),
    estadoEl,
    h('div', { class: 'p2c-dialogo-pie' }, boton(T('Cancelar', 'Cancel'), () => d.cerrar(), { tipo: 'fantasma' }), ir),
  );
  const decir = (t: string, bien: boolean | null) => {
    estadoEl.textContent = t;
    estadoEl.className = 'p2c-resultado' + (bien == null ? '' : bien ? ' bien' : ' mal');
  };
  campo.addEventListener('keydown', (e) => e.key === 'Enter' && !ir.disabled && void enviar());
  direccion = await PAGAR.direccionDe(correo);
  if (!direccion) {
    direccionEl.textContent = T(`${nombre} todavía no tiene su dirección de Veta Wallet a la vista en PULSE2CHAT. Pídele que entre una vez a Veta Wallet con su cuenta.`, `${nombre} has no Veta Wallet address visible in PULSE2CHAT yet.`);
    return;
  }
  direccionEl.textContent = T('A su Veta Wallet: ', 'To their Veta Wallet: ') + `${direccion.slice(0, 8)}…${direccion.slice(-6)}`;
  direccionEl.title = direccion;
  ir.disabled = false;

  async function enviar() {
    const m = PAGAR.montoValido(campo.value);
    if (!m) { decir(T('Escribe una cantidad mayor que cero.', 'Enter an amount above zero.'), false); campo.focus(); return; }
    ir.disabled = true;
    try {
      await PAGAR.pagar({ correo, nombre, direccion: direccion!, monto: m, moneda: elegir.value }, (e, hash) => {
        if (e === 'abierto') decir(T(`Abrí Veta Wallet con ${m} ${elegir.value} para ${nombre}. Confírmalo allá; te aviso cuando la cadena lo confirme.`, `Opened Veta Wallet. Confirm it there.`), true);
        if (e === 'sin-comprobante') avisar(T(`Vi el envío en la cadena (${hash?.slice(0, 10)}…), pero el chat no aceptó el comprobante.`, 'I saw the payment on-chain, but the chat rejected the receipt.'), 'mal', 9000);
        if (e === 'confirmado') avisar(T(`Envío confirmado (${hash?.slice(0, 10)}…). El comprobante quedó en el chat.`, 'Payment confirmed. The receipt is in the chat.'), 'ok', 7000);
      });
    } catch (e: any) {
      decir(e?.message || T('No pude abrir Veta Wallet.', 'Couldn’t open Veta Wallet.'), false);
      ir.disabled = false;
    }
  }
}

/* ── piezas ───────────────────────────────────────────────────────────────────────────────── */

/** La cara de alguien: su foto o sus iniciales, con el punto si está en línea y el anillo si hay sin leer. */
function cara(p: { nombre: string; foto?: string; enLinea?: boolean }, tam = 44, anillo = false): HTMLElement {
  const f = h('div', { class: 'foto p2c-cara' + (anillo ? ' p2c-anillo' : ''), style: `width:${tam}px;height:${tam}px;font-size:${Math.round(tam * 0.38)}px`, 'aria-hidden': 'true' });
  if (p.foto && /^(https:|data:image\/)/.test(p.foto)) f.style.backgroundImage = `url("${p.foto.replace(/"/g, '%22')}")`;
  else f.textContent = iniciales(p.nombre);
  return h('div', { class: 'p2c-cara-caja' }, f, p.enLinea ? h('span', { class: 'p2c-enlinea', title: T('En línea', 'Online') }) : null);
}

/** «maria.lopez@x.com» → quien sea en la lista, o «maria.lopez». */
const nombreDe = (correo: string) => RELEVO.nombreDeCorreo(correo);

/* ── la app: lista + hilo ─────────────────────────────────────────────────────────────────── */

function armarApp() {
  const yo = () => RELEVO.quien()?.correo || '';
  let abierto: string | null = null;
  let seVe = false;
  let pararHilo: (() => void) | null = null;
  const borradores = new Map<string, string>();
  const quitar: (() => void)[] = [];

  /* ── panel izquierdo ── */
  const buscar = h('input', { type: 'search', placeholder: T('Buscar personas y chats', 'Search people and chats'), 'aria-label': T('Buscar', 'Search'), autocomplete: 'off', spellcheck: false }) as HTMLInputElement;
  const buscando = h('span', { class: 'cargando' });
  buscando.hidden = true;
  const bandaLista = h('div', { class: 'p2c-banda', role: 'status' });
  bandaLista.hidden = true;
  const listaEl = h('div', { class: 'lista p2c-lista', role: 'list' });
  const lado = h(
    'aside',
    { class: 'p2c-lado', 'aria-label': T('Conversaciones', 'Chats') },
    h(
      'div',
      { class: 'p2c-lado-cab' },
      h('div', null, h('h2', null, T('Chats', 'Chats')), h('small', { class: 'p2c-cifrado' }, iconoP('candado', 12), T('Cifrado de punta a punta', 'End-to-end encrypted'))),
      botonP('personaMas', T('Agregar a alguien', 'Add someone'), () => abrirAgregar(), 'p2c-agregar'),
    ),
    h('label', { class: 'p2c-buscar' }, iconoP('buscar', 16), buscar, buscando),
    bandaLista,
    listaEl,
  );

  /* ── panel derecho ── */
  const hiloEl = h('section', { class: 'p2c-hilo', 'aria-label': T('Conversación', 'Conversation') });

  const el = h('div', { class: 'p2c' }, lado, hiloEl);

  /* ── búsqueda en el relevo (gente fuera del círculo) ── */
  let remotos: RELEVO.Persona[] | null = null;
  let relojBuscar: ReturnType<typeof setTimeout> | null = null;
  let vueltaBuscar = 0;
  const lazos: Record<string, string> = {};
  const respondiendo: Record<string, boolean> = {};
  buscar.addEventListener('input', () => {
    const q = buscar.value.trim();
    if (relojBuscar) clearTimeout(relojBuscar);
    const mia = ++vueltaBuscar;
    if (q.length < 2) {
      remotos = null;
      buscando.hidden = true;
      pintarLista();
      return;
    }
    buscando.hidden = false;
    pintarLista();
    relojBuscar = setTimeout(() => {
      RELEVO.buscar(q)
        .then((r) => mia === vueltaBuscar && (remotos = r))
        .catch(() => mia === vueltaBuscar && (remotos = []))
        .finally(() => {
          if (mia !== vueltaBuscar) return;
          buscando.hidden = true;
          pintarLista();
        });
    }, 350);
  });
  buscar.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && buscar.value) {
      buscar.value = '';
      buscar.dispatchEvent(new Event('input'));
    }
  });

  /* ── la lista ── */
  function pintarLista() {
    const v = CHATS.lista.get();
    const qn = RELEVO.normalizar(buscar.value);
    const coincide = (x: { nombre: string; correo: string; gid?: string }) =>
      !qn || RELEVO.normalizar(x.nombre).includes(qn) || x.correo.includes(qn) || (x.gid || '').toLowerCase().includes(qn);
    bandaLista.hidden = v.error !== 'sin-red';
    bandaLista.textContent = T('Sin conexión con el chat. Reintentando…', 'No connection to the chat. Retrying…');
    const scroll = listaEl.scrollTop;
    vacio(listaEl);
    if (v.conversaciones === null) {
      for (let i = 0; i < 5; i++) listaEl.append(h('div', { class: 'p2c-esqueleto', style: `--i:${i}` }, h('i'), h('div', null, h('b'), h('b'))));
      return;
    }
    const conv = v.conversaciones;
    const circ = v.circulo;
    const titulo = (t: string) => h('div', { class: 'p2c-seccion', role: 'presentation' }, t);
    const recibidas = (circ?.recibidas || []).filter(coincide);
    if (recibidas.length) {
      listaEl.append(titulo(T('Solicitudes', 'Requests')));
      for (const x of recibidas) listaEl.append(filaSolicitud(x));
    }
    const charlas = conv.filter(coincide);
    if (charlas.length && (recibidas.length || qn)) listaEl.append(titulo(T('Conversaciones', 'Chats')));
    for (const c of charlas) listaEl.append(filaCharla(c));
    const conCharla = new Set(conv.map((c) => c.correo));
    const amigos = (circ?.amigos || []).filter((a) => !conCharla.has(a.correo) && coincide(a));
    if (amigos.length) {
      listaEl.append(titulo(T('Tu círculo', 'Your circle')));
      for (const a of amigos) listaEl.append(filaPersona(a, 'amigos'));
    }
    if (remotos) {
      const conocidos = new Set([...conCharla, ...(circ?.amigos || []).map((a) => a.correo), ...(circ?.recibidas || []).map((a) => a.correo)]);
      const nuevos = remotos.filter((r) => !conocidos.has(r.correo));
      if (nuevos.length) {
        listaEl.append(titulo(T('Personas en PULSE2CHAT', 'People on PULSE2CHAT')));
        for (const r of nuevos) listaEl.append(filaPersona(r, lazos[r.correo] || r.lazo || 'no'));
      }
    }
    if (!listaEl.childElementCount) {
      listaEl.append(
        qn
          ? h('p', { class: 'p2c-vacio tenue' }, buscando.hidden ? T('Nadie con ese nombre. Prueba con su correo o su Genesis ID.', 'No one by that name. Try their email or Genesis ID.') : '')
          : h(
              'div',
              { class: 'p2c-vacio' },
              h('div', { class: 'p2c-sin-icono chico' }, iconoP('burbujas', 30)),
              h('strong', null, T('Tus conversaciones aparecerán aquí', 'Your chats will show up here')),
              h('p', { class: 'tenue' }, T('Agrega a alguien con su correo o su Genesis ID.', 'Add someone with their email or Genesis ID.')),
              boton(T('Agregar a alguien', 'Add someone'), () => abrirAgregar(), { tipo: 'acento', icono: 'mas' }),
            ),
      );
    }
    listaEl.scrollTop = scroll;
  }

  function filaCharla(c: RELEVO.Conversacion): HTMLElement {
    const escribe = CHATS.estaEscribiendo(c.correo);
    const sinLeer = c.sinLeer > 0;
    const borrador = borradores.get(c.correo);
    const detalle = escribe
      ? h('span', { class: 'p2c-escribe' }, T('escribiendo…', 'typing…'))
      : borrador && abierto !== c.correo
        ? h('span', null, h('b', { class: 'p2c-borrador' }, T('Borrador: ', 'Draft: ')), recortar(borrador, 60))
        : h('span', null, resumen(c.ultimo, yo()) || T('Empiecen a hablar', 'Start talking'));
    return h(
      'button',
      {
        type: 'button',
        role: 'listitem',
        class: 'item p2c-fila' + (abierto === c.correo ? ' activa' : '') + (sinLeer ? ' sin-leer' : ''),
        'aria-current': abierto === c.correo ? 'true' : null,
        'aria-label': `${c.nombre}${sinLeer ? `, ${c.sinLeer} ${T('sin leer', 'unread')}` : ''}${c.enLinea ? `, ${T('en línea', 'online')}` : ''}`,
        on: { click: () => abrirHiloCon(c.correo) },
      },
      cara(c, 44, sinLeer),
      h(
        'div',
        { class: 'p2c-fila-cuerpo' },
        h('div', { class: 'p2c-fila-arriba' }, h('strong', null, c.nombre), h('small', { class: 'p2c-hora' }, cuandoLista(c.ultimo?.cuando || 0))),
        h('div', { class: 'p2c-fila-abajo' }, detalle, sinLeer ? h('span', { class: 'p2c-insignia-n' }, c.sinLeer > 99 ? '99+' : String(c.sinLeer)) : null),
      ),
    );
  }

  function filaSolicitud(x: RELEVO.Persona): HTMLElement {
    const ocupado = !!respondiendo[x.correo];
    const responder = async (si: boolean) => {
      respondiendo[x.correo] = true;
      pintarLista();
      const ok = await CHATS.responder(x.correo, si);
      respondiendo[x.correo] = false;
      if (!ok) avisar(T('No se pudo responder. Revisa la conexión.', 'Couldn’t reply. Check the connection.'), 'mal');
      else if (si) avisar(T(`${x.nombre} ya está en tu círculo.`, `${x.nombre} is now in your circle.`), 'ok');
      pintarLista();
    };
    return h(
      'div',
      { class: 'p2c-solicitud', role: 'listitem' },
      h('div', { class: 'fila' }, cara(x, 40), h('div', { class: 'p2c-fila-cuerpo' }, h('strong', null, x.nombre), h('small', { class: 'tenue' }, x.nota ? '«' + recortar(x.nota, 120) + '»' : T('Quiere agregarte a su círculo', 'Wants to add you to their circle')))),
      h(
        'div',
        { class: 'p2c-solicitud-pie' },
        boton(T('Rechazar', 'Decline'), () => void responder(false), { tipo: 'fantasma', deshabilitado: ocupado }),
        boton(T('Aceptar', 'Accept'), () => void responder(true), { tipo: 'acento', deshabilitado: ocupado }),
      ),
    );
  }

  function filaPersona(x: RELEVO.Persona, lazo: string): HTMLElement {
    const amigos = lazo === 'amigos';
    let accion: HTMLElement | null = null;
    if (!amigos) {
      if (lazo === 'enviada') accion = h('small', { class: 'tenue' }, T('Pendiente', 'Pending'));
      else if (lazo === 'recibida')
        accion = boton(T('Aceptar', 'Accept'), async (e) => {
          e.stopPropagation();
          lazos[x.correo] = (await CHATS.responder(x.correo, true)) ? 'amigos' : 'sin-red';
          pintarLista();
        }, { tipo: 'acento' });
      else if (lazo === 'no' || lazo === 'enviando')
        accion = boton(T('Agregar', 'Add'), async (e) => {
          e.stopPropagation();
          lazos[x.correo] = 'enviando';
          pintarLista();
          lazos[x.correo] = await CHATS.agregar(x.correo);
          pintarLista();
        }, { tipo: 'suave', icono: 'mas', deshabilitado: lazo === 'enviando' });
      else accion = h('small', { class: 'p2c-aviso-txt' }, textoLazo(lazo));
    }
    return h(
      amigos ? 'button' : 'div',
      {
        type: amigos ? 'button' : null,
        role: 'listitem',
        class: 'item p2c-fila' + (amigos ? '' : ' quieta'),
        on: amigos ? { click: () => abrirHiloCon(x.correo) } : undefined,
      },
      cara(x, 44),
      h('div', { class: 'p2c-fila-cuerpo' }, h('strong', null, x.nombre), h('small', { class: 'tenue' }, amigos ? T('Escríbele', 'Write to them') : x.gid || x.correo)),
      accion,
    );
  }

  /* ── agregar por correo o código ── */
  function abrirAgregar() {
    const campo = h('input', { type: 'text', placeholder: T('correo@ejemplo.com o GEN-XXXX-XXXX-X', 'email@example.com or GEN-XXXX-XXXX-X'), autocomplete: 'off', spellcheck: false, 'aria-label': T('Correo o Genesis ID', 'Email or Genesis ID') }) as HTMLInputElement;
    const mensaje = h('p', { class: 'p2c-resultado', role: 'status' });
    const pie = h('div', { class: 'p2c-dialogo-pie' });
    let enviando = false;
    const enviar = async () => {
      const t = campo.value.trim();
      if (!t || enviando) return;
      enviando = true;
      pintarPie(null);
      mensaje.textContent = '';
      let res: { estado: string; correo?: string; nombre?: string };
      try {
        let correo = t.toLowerCase();
        let nombre = '';
        if (!correo.includes('@')) {
          // Un código (Genesis ID): se busca a quién es.
          const r = await RELEVO.buscar(t).catch(() => null);
          if (r === null) res = { estado: 'sin-red' };
          else {
            const x = r.find((y) => (y.gid || '').toUpperCase() === t.toUpperCase()) || (r.length === 1 ? r[0] : null);
            if (!x) res = { estado: 'no-esta' };
            else {
              correo = x.correo;
              nombre = x.nombre;
              res = { estado: '' };
            }
          }
        } else res = { estado: '' };
        if (!res.estado) {
          if (correo === yo()) res = { estado: 'eres-tu' };
          else res = { estado: await CHATS.agregar(correo), correo, nombre: nombre || correo.split('@')[0] };
        }
      } finally {
        enviando = false;
      }
      const bien = res.estado === 'enviada' || res.estado === 'amigos';
      mensaje.className = 'p2c-resultado ' + (bien ? 'bien' : 'mal');
      mensaje.textContent =
        res.estado === 'enviada'
          ? T(`Solicitud enviada a ${res.nombre}. Podrán escribirse en cuanto te acepte.`, `Request sent to ${res.nombre}. You can chat once they accept.`)
          : res.estado === 'amigos'
            ? T(`${res.nombre} ya está en tu círculo.`, `${res.nombre} is already in your circle.`)
            : res.estado === 'no-esta'
              ? T('No encontramos a nadie con ese correo o código en PULSE2CHAT.', 'We couldn’t find anyone with that email or code on PULSE2CHAT.')
              : res.estado === 'eres-tu'
                ? T('Ese eres tú.', 'That’s you.')
                : res.estado === 'demasiadas'
                  ? T('Tienes demasiadas solicitudes abiertas. Espera a que te contesten.', 'You have too many open requests. Wait for replies.')
                  : res.estado === 'no-se-puede'
                    ? T('No se puede agregar a esa persona.', 'You can’t add that person.')
                    : T('Sin conexión. Vuelve a intentar.', 'No connection. Try again.');
      pintarPie(res);
    };
    const pintarPie = (res: { estado: string; correo?: string; nombre?: string } | null) => {
      vacio(pie);
      if (res?.estado === 'amigos' && res.correo) {
        const c = res.correo;
        pie.append(boton(T('Escribirle', 'Write'), () => { d.cerrar(); abrirHiloCon(c); }, { tipo: 'acento', icono: 'chat' }));
      } else if (res?.estado === 'enviada') {
        pie.append(boton(T('Listo', 'Done'), () => d.cerrar(), { tipo: 'acento', icono: 'ok' }));
      } else {
        const b = boton(enviando ? T('Buscando…', 'Searching…') : T('Enviar solicitud', 'Send request'), () => void enviar(), { tipo: 'acento', deshabilitado: enviando });
        pie.append(b);
      }
    };
    campo.addEventListener('input', () => {
      mensaje.textContent = '';
      pintarPie(null);
    });
    campo.addEventListener('keydown', (e) => e.key === 'Enter' && void enviar());
    pintarPie(null);
    const d = dialogo(
      T('Agregar a alguien', 'Add someone'),
      h('p', { class: 'tenue' }, T('Con su correo o su Genesis ID (GEN-…).', 'With their email or Genesis ID (GEN-…).')),
      campo,
      mensaje,
      pie,
      h('small', { class: 'nota p2c-comparte' }, T('Para que te agreguen, comparte tu correo: ', 'To be added, share your email: '), h('strong', null, yo())),
    );
  }

  /* ── el hilo ── */
  let hilo: ReturnType<typeof armarHilo> | null = null;

  function abrirHiloCon(correo: string) {
    const c = correo.toLowerCase();
    if (abierto === c && hilo) {
      hilo.enfocar();
      return;
    }
    hilo?.destruir();
    pararHilo?.();
    pararHilo = null;
    abierto = c;
    hilo = armarHilo(c);
    vacio(hiloEl).append(hilo.el);
    el.classList.add('con-hilo');
    if (seVe) pararHilo = CHATS.abrirHilo(c);
    PULSE.fijarHiloVisible(seVe ? c : null);
    pintarLista();
    hilo.enfocar();
  }

  function cerrarHilo() {
    hilo?.destruir();
    hilo = null;
    pararHilo?.();
    pararHilo = null;
    abierto = null;
    PULSE.fijarHiloVisible(null);
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
        h('h3', null, T('Elige una conversación', 'Pick a conversation')),
        h('p', { class: 'tenue' }, T('Escribe, llama o haz una videollamada. Todo va cifrado de punta a punta: ni el relevo puede leerlo.', 'Write, call or video call. Everything is end-to-end encrypted: not even the relay can read it.')),
      ),
    );
  }

  function armarHilo(c: string) {
    const persona = () => {
      const v = CHATS.lista.get();
      return (v.conversaciones || []).find((x) => x.correo === c) || (v.circulo?.amigos || []).find((x) => x.correo === c) || null;
    };
    const nombreVisto = () => persona()?.nombre || nombreDe(c);
    const almacenHilo = CHATS.hiloDe(c);

    /* cabecera */
    const caraCaja = h('div', { class: 'p2c-hilo-cara' });
    const nombre = h('strong', null, '');
    const sub = h('small', { class: 'p2c-sub' }, '');
    const btnVoz = botonP('telefono', T('Llamar', 'Call'), () => PULSE.llamar(c, false), 'acento-texto');
    const btnVideo = botonP('video', T('Videollamada', 'Video call'), () => PULSE.llamar(c, true), 'acento-texto');
    const btnPagar = botonP('cartera', T('Enviar ORIGEN (lo firmas en Veta Wallet)', 'Send ORIGEN (you sign it in Veta Wallet)'), () => void abrirPagar(c, nombreVisto()), 'acento-texto');
    const cab = h(
      'header',
      { class: 'p2c-hilo-cab' },
      botonP('atras', T('Volver a los chats', 'Back to chats'), () => cerrarHilo(), 'p2c-volver'),
      h('button', { type: 'button', class: 'p2c-quien', title: T('Ver el código de seguridad', 'View security code'), on: { click: () => verCodigo() } }, caraCaja, h('div', null, nombre, sub)),
      btnPagar,
      btnVideo,
      btnVoz,
      botonP('escudo', T('Código de seguridad', 'Security code'), () => verCodigo()),
    );

    /* mensajes */
    const banda = h('div', { class: 'p2c-banda', role: 'status' });
    banda.hidden = true;
    const insignia = h(
      'button',
      { type: 'button', class: 'p2c-insignia-cifrado', on: { click: () => verCodigo() } },
      iconoP('candado', 14),
      h('span', null, T('Los mensajes van cifrados de punta a punta: nadie más, ni el relevo, puede leerlos. Clic para ver el código de seguridad.', 'Messages are end-to-end encrypted: no one else, not even the relay, can read them. Click to see the security code.')),
    );
    const antes = h('div', { class: 'p2c-antes' }, h('span', { class: 'cargando' }));
    const filasEl = h('div', { class: 'p2c-filas', role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions' });
    const escribeEl = h('div', { class: 'p2c-fila-msg suyo p2c-escribiendo', 'aria-label': T('escribiendo…', 'typing…') }, h('div', { class: 'p2c-burbuja' }, h('i'), h('i'), h('i')));
    escribeEl.hidden = true;
    const saludo = h('p', { class: 'p2c-saludo tenue' }, '');
    const mensajes = h('div', { class: 'p2c-mensajes' }, antes, insignia, saludo, filasEl, escribeEl);
    const bajar = botonP('abajo', T('Ir al último mensaje', 'Go to the latest message'), () => irAbajo(true), 'p2c-bajar');
    bajar.hidden = true;

    /* escribir */
    const caja = h('textarea', { rows: 1, maxlength: 4000, placeholder: T('Mensaje', 'Message'), 'aria-label': T('Escribe un mensaje', 'Write a message') }) as HTMLTextAreaElement;
    caja.value = borradores.get(c) || '';
    const archivo = h('input', { type: 'file', accept: 'image/*', hidden: true }) as HTMLInputElement;
    const btnFoto = botonP('clip', T('Enviar una foto', 'Send a photo'), () => archivo.click());
    const btnEnviar = botonP('enviar', T('Enviar (Enter)', 'Send (Enter)'), () => enviar(), 'acento p2c-enviar');
    const componer = h('div', { class: 'p2c-componer' }, btnFoto, archivo, h('div', { class: 'p2c-caja' }, caja), btnEnviar);

    const elHilo = h('div', { class: 'p2c-hilo-dentro' }, cab, banda, h('div', { class: 'p2c-mensajes-caja' }, mensajes, bajar), componer);

    /* estado de la cabecera */
    function pintarCab() {
      const p = persona();
      const n = nombreVisto();
      nombre.textContent = n;
      const hs = almacenHilo.get();
      const enLinea = hs.enLinea || !!p?.enLinea;
      vacio(caraCaja).append(cara({ nombre: n, foto: p?.foto, enLinea }, 40));
      const escribe = CHATS.estaEscribiendo(c);
      vacio(sub).append(
        escribe
          ? h('span', { class: 'p2c-escribe' }, T('escribiendo…', 'typing…'))
          : enLinea
            ? h('span', { class: 'p2c-verde' }, T('en línea', 'online'))
            : h('span', null, iconoP('candado', 11), ' ', T('cifrado de punta a punta', 'end-to-end encrypted')),
      );
      escribeEl.hidden = !escribe;
      const ocupado = PULSE.enLlamada();
      btnVoz.disabled = btnVideo.disabled = ocupado;
    }

    /* las filas, reutilizando lo ya pintado */
    const pintadas = new Map<string, { clave: string; el: HTMLElement }>();
    let primeraVez = true;
    let ultimoEstado: CHATS.EstadoHilo | null = null;

    function pegadoAbajo() {
      return mensajes.scrollHeight - mensajes.scrollTop - mensajes.clientHeight < 80;
    }
    function irAbajo(suave = false) {
      mensajes.scrollTo({ top: mensajes.scrollHeight, behavior: suave && !reducido() ? 'smooth' : 'auto' });
    }

    function pintarFilas() {
      const e = almacenHilo.get();
      if (e === ultimoEstado) return;
      ultimoEstado = e;
      antes.hidden = !e.cargandoAntes;
      insignia.hidden = e.hayMas;
      saludo.hidden = !(e.mensajes && !e.mensajes.length);
      saludo.textContent = T(`Escríbele el primer mensaje a ${nombreVisto()}.`, `Write the first message to ${nombreVisto()}.`);
      if (e.error === 'sin-permiso' || e.error === 'sin-red') mostrarBanda(e.error === 'sin-permiso' ? T(`Hace falta que ${nombreVisto()} te acepte para escribirle.`, `${nombreVisto()} needs to accept you before you can write.`) : T('Sin conexión con el chat. Reintentando…', 'No connection to the chat. Retrying…'));
      else if (!bandaFija) banda.hidden = true;
      if (e.mensajes === null) {
        if (!filasEl.childElementCount) filasEl.append(h('div', { class: 'p2c-centrado' }, h('span', { class: 'cargando' })));
        return;
      }
      const abajo = pegadoAbajo();
      const desdeAbajo = mensajes.scrollHeight - mensajes.scrollTop;
      const filas = filasDelHilo(e.mensajes, yo(), e.leidoHasta);
      const nuevas: HTMLElement[] = [];
      const vistas = new Set<string>();
      let mioNuevo = false;
      for (const f of filas) {
        const clave = f.tipo === 'dia' ? f.texto : claveDeFila(f);
        vistas.add(f.clave);
        const ya = pintadas.get(f.clave);
        if (ya && ya.clave === clave && ya.el.dataset.m === '1' && f.tipo === 'msg' && (ya.el as any)._m === f.m) {
          nuevas.push(ya.el);
          continue;
        }
        if (ya && ya.clave === clave && f.tipo === 'dia') {
          nuevas.push(ya.el);
          continue;
        }
        const elFila = f.tipo === 'dia' ? h('div', { class: 'p2c-dia' }, h('span', null, f.texto)) : burbuja(f);
        if (!ya && !primeraVez) {
          elFila.classList.add('entra');
          if (f.tipo === 'msg' && f.mio) mioNuevo = true;
        }
        pintadas.set(f.clave, { clave, el: elFila });
        nuevas.push(elFila);
      }
      for (const k of [...pintadas.keys()]) if (!vistas.has(k)) pintadas.delete(k);
      filasEl.replaceChildren(...nuevas);
      if (primeraVez || abajo || mioNuevo) irAbajo(!primeraVez);
      else mensajes.scrollTop = mensajes.scrollHeight - desdeAbajo;
      primeraVez = false;
      bajar.hidden = pegadoAbajo();
    }

    const claveDeFila = (f: Extract<Fila, { tipo: 'msg' }>) => `${f.primera ? 1 : 0}${f.ultima ? 1 : 0}${f.leido ? 1 : 0}`;

    function burbuja(f: Extract<Fila, { tipo: 'msg' }>): HTMLElement {
      const { m, mio, primera, ultima, leido } = f;
      const esFoto = m.tipo === 'imagen' && !m.borrado && !m.cerrado;
      const marca = m.borrado ? '' : m.e2e === false ? T('sin cifrar', 'unencrypted') : m.e2e && m.verificado === false && !m.cerrado ? '⚠ ' + T('firma sin verificar', 'unverified signature') : '';
      const meta = h(
        'span',
        { class: 'p2c-meta' },
        marca ? h('span', { class: 'p2c-marca-msg', title: m.e2e === false ? T('Este mensaje viajó sin cifrar', 'This message traveled unencrypted') : T('El sobre abrió, pero la firma no es de las llaves publicadas de quien escribió', 'The envelope opened, but the signature isn’t from the sender’s published keys') }, marca) : null,
        h('time', { datetime: new Date(m.cuando || Date.now()).toISOString() }, hora(m.cuando)),
        mio && !m.fallido ? palomitas(!!m.pendiente, leido) : null,
      );
      let cuerpo: (Node | null)[];
      if (m.borrado) cuerpo = [h('em', { class: 'p2c-tenue-msg' }, T('Mensaje borrado', 'Message deleted'))];
      else if (m.cerrado) cuerpo = [h('em', { class: 'p2c-tenue-msg', title: T('Llegó antes de que este equipo publicara su llave: ábrelo en el aparato donde lo recibiste.', 'It arrived before this PC published its key: open it on the device that received it.') }, '🔒 ' + T('Cifrado para otro de tus aparatos', 'Encrypted for another of your devices'))];
      else if (m.tipo === 'pago') cuerpo = [comprobante(m)];
      else cuerpo = [esFoto ? fotoMensaje(m) : null, m.texto ? h('div', { class: 'p2c-texto' }, m.texto) : null];
      const fila = h(
        'div',
        { class: ['p2c-fila-msg', mio ? 'mio' : 'suyo', primera ? 'primera' : '', ultima ? 'ultima' : '', m.pendiente ? 'pendiente' : '', m.fallido ? 'fallido' : '', esFoto ? 'con-foto' : ''].filter(Boolean).join(' ') },
        mio && m.fallido ? botonP('actualizar', T('Reintentar el envío', 'Retry sending'), () => void reintentar(m.id), 'p2c-reintentar', 14) : null,
        h('div', { class: 'p2c-burbuja' + (esFoto && !m.texto ? ' solo-foto' : '') }, ...cuerpo, meta),
      );
      if (mio && m.fallido) {
        fila.append(
          h(
            'small',
            { class: 'p2c-fallo' },
            m.motivoFallo === 'sin-aparatos' ? T('No se envió: no hay aparato con llave del otro lado.', 'Not sent: the other side has no device with a key.') : T('No se envió.', 'Not sent.'),
            ' ',
            m.motivoFallo === 'sin-aparatos' && m.tipo !== 'imagen'
              ? h('button', { type: 'button', class: 'p2c-enlace', on: { click: () => void enviarSinCifrar(m.id, m.texto) } }, T('Enviar sin cifrar', 'Send unencrypted'))
              : null,
            ' ',
            h('button', { type: 'button', class: 'p2c-enlace', on: { click: () => CHATS.descartarFallido(c, m.id) } }, T('Quitar', 'Remove')),
          ),
        );
      }
      fila.dataset.m = '1';
      (fila as any)._m = m;
      return fila;
    }

    /** El comprobante de un envío: la tarjeta con el hash, que enlaza al explorador (no pide que se confíe). */
    function comprobante(m: CHATS.MensajeHilo): HTMLElement {
      const hash = /^0x[0-9a-fA-F]{64}$/.test(String(m.hash || '')) ? String(m.hash) : '';
      return h(
        'div',
        { class: 'p2c-pago' },
        h('small', null, T('Envío', 'Payment')),
        h('strong', null, `${m.monto || '?'} ${m.moneda || 'ORIGEN'}`),
        m.texto ? h('p', null, m.texto) : null,
        hash ? h('button', { type: 'button', class: 'p2c-enlace', on: { click: () => window.open('https://ordenscan.com/tx/' + hash, '_blank') } }, T('Ver en OrdenScan', 'View on OrdenScan')) : null,
      );
    }

    function palomitas(pendiente: boolean, leido: boolean) {
      if (pendiente) return h('span', { class: 'p2c-reloj', title: T('Enviando…', 'Sending…'), 'aria-label': T('Enviando', 'Sending') });
      return h('span', { class: 'p2c-palomitas' + (leido ? ' leido' : ''), title: leido ? T('Leído', 'Read') : T('Enviado', 'Sent'), 'aria-label': leido ? T('Leído', 'Read') : T('Enviado', 'Sent') }, leido ? '✓✓' : '✓');
    }

    function fotoMensaje(m: CHATS.MensajeHilo): HTMLElement {
      const caja = h('button', { type: 'button', class: 'p2c-foto-msg cargando-foto', 'aria-label': T('Ver foto', 'View photo') }, h('span', { class: 'cargando' }));
      const poner = (uri: string | null) => {
        caja.classList.remove('cargando-foto');
        vacio(caja);
        if (!uri) {
          caja.disabled = true;
          caja.append(h('small', { class: 'tenue' }, T('No se pudo abrir la foto', 'Couldn’t open the photo')));
          return;
        }
        const img = h('img', { src: uri, alt: m.texto || T('Foto', 'Photo'), loading: 'lazy', decoding: 'async' }) as HTMLImageElement;
        img.addEventListener('load', () => {
          if (pegadoAbajo()) irAbajo();
        });
        caja.append(img);
        caja.onclick = () => verFoto(uri);
      };
      const a = m.archivo || '';
      if (/^(blob:|data:)/.test(a)) poner(a);
      else if (!a) poner(null);
      else void RELEVO.archivoAbierto(a, m.llaveArchivo, m.ivArchivo).then(poner);
      return caja;
    }

    /* avisos */
    let bandaFija = false;
    let relojBanda: ReturnType<typeof setTimeout> | null = null;
    function mostrarBanda(texto: string, fija = false, extra?: Node) {
      banda.replaceChildren(h('span', null, texto), extra || '');
      banda.hidden = false;
      bandaFija = fija;
      if (relojBanda) clearTimeout(relojBanda);
      relojBanda = fija
        ? setTimeout(() => {
            bandaFija = false;
            banda.hidden = true;
          }, 8000)
        : null;
    }

    function resultado(r: CHATS.Envio, texto?: string) {
      const n = nombreVisto();
      if (!r.ok) {
        if (r.code === 403) mostrarBanda(T(`Hace falta que ${n} te acepte para escribirle.`, `${n} needs to accept you before you can write.`), true);
        else if (r.motivo === 'sin-cuenta') mostrarBanda(T('El chat no está conectado.', 'The chat isn’t connected.'), true);
        else if (r.motivo === 'sin-aparatos')
          mostrarBanda(
            T(`No lo envié: ${n} todavía no abrió el chat en ningún aparato y no puedo cifrarlo. Queda aquí para reintentar.`, `Not sent: ${n} hasn’t opened the chat on any device yet, so I can’t encrypt it. It stays here to retry.`),
            true,
          );
        else if (r.motivo !== 'vacio') mostrarBanda(T('No se envió. Revisa la conexión y reintenta.', 'Not sent. Check the connection and retry.'), true);
      } else if (!r.e2e) {
        mostrarBanda(T(`Salió sin cifrar: ${n} todavía no abrió el chat en ningún aparato.`, `Sent unencrypted: ${n} hasn’t opened the chat on any device yet.`), true);
      }
      void texto;
    }

    /* enviar */
    function ajustarCaja() {
      caja.style.height = 'auto';
      caja.style.height = Math.min(160, caja.scrollHeight) + 'px';
      btnEnviar.disabled = !caja.value.trim();
    }
    function enviar() {
      const t = caja.value.trim();
      if (!t) return;
      caja.value = '';
      borradores.delete(c);
      ajustarCaja();
      void CHATS.enviarTexto(c, t).then((r) => resultado(r, t));
    }
    async function reintentar(id: string) {
      resultado(await CHATS.reintentar(c, id));
    }
    async function enviarSinCifrar(id: string, texto: string) {
      const si = await dialogoConfirmar(
        T('¿Enviar sin cifrar?', 'Send unencrypted?'),
        T(`${nombreVisto()} todavía no tiene ningún aparato con llave. Si lo mandas así, el relevo podría leerlo.`, `${nombreVisto()} has no device with a key yet. If you send it like this, the relay could read it.`),
        T('Enviar sin cifrar', 'Send unencrypted'),
      );
      if (si) resultado(await CHATS.enviarTexto(c, texto, id, { sinCifrar: true }));
    }
    caja.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        enviar();
      }
    });
    caja.addEventListener('input', () => {
      ajustarCaja();
      if (caja.value.trim()) {
        borradores.set(c, caja.value);
        RELEVO.escribiendo(c);
      } else borradores.delete(c);
    });
    caja.addEventListener('paste', (e) => {
      const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
      if (f) {
        e.preventDefault();
        void mandarFoto(f);
      }
    });
    archivo.addEventListener('change', () => {
      const f = archivo.files?.[0];
      archivo.value = '';
      if (f) void mandarFoto(f);
    });
    async function mandarFoto(f: File) {
      try {
        const { bytes, vista } = await prepararFoto(f);
        const texto = caja.value.trim();
        if (texto) {
          caja.value = '';
          borradores.delete(c);
          ajustarCaja();
        }
        resultado(await CHATS.enviarFoto(c, bytes, 'image/jpeg', vista, texto));
      } catch {
        mostrarBanda(T('No pude abrir esa imagen.', 'I couldn’t open that image.'), true);
      }
    }

    /* código de seguridad y fotos en grande */
    function verCodigo() {
      const cuerpoCodigo = h('div', { class: 'p2c-codigo' }, h('span', { class: 'cargando' }));
      const p = persona();
      dialogo(
        T('Código de seguridad', 'Security code'),
        h('div', { class: 'fila' }, cara({ nombre: nombreVisto(), foto: p?.foto }, 44), h('div', null, h('strong', null, nombreVisto()), h('br'), h('small', { class: 'tenue' }, c))),
        cuerpoCodigo,
        h('p', { class: 'tenue' }, T('Compáralo con el que ve la otra persona en su aparato. Si coincide, nadie se metió en medio.', 'Compare it with the one the other person sees on their device. If it matches, no one is in between.')),
      );
      void RELEVO.codigoCon(c)
        .catch(() => null)
        .then((codigo) => {
          vacio(cuerpoCodigo);
          if (!codigo) {
            cuerpoCodigo.append(h('p', { class: 'tenue' }, T('Todavía no se puede: a alguno de los dos le falta publicar su llave.', 'Not yet: one of you hasn’t published a key.')));
            return;
          }
          const grupos = codigo.split(/\s+/);
          cuerpoCodigo.append(h('div', { class: 'p2c-codigo-grupos', 'aria-label': codigo }, grupos.map((g) => h('span', null, g))));
        });
    }
    function verFoto(uri: string) {
      const d = dialogo(T('Foto', 'Photo'), h('img', { class: 'p2c-foto-grande', src: uri, alt: T('Foto', 'Photo') }));
      d.el.classList.add('p2c-visor');
    }

    /* scroll: cargar lo de antes y el botón de bajar */
    mensajes.addEventListener('scroll', () => {
      bajar.hidden = pegadoAbajo();
      const e = almacenHilo.get();
      if (mensajes.scrollTop < 60 && e.hayMas && !e.cargandoAntes) void CHATS.cargarAnteriores(c);
    });

    const subs = [
      almacenHilo.sub(() => {
        pintarFilas();
        pintarCab();
      }),
      CHATS.lista.sub(pintarCab),
      CHATS.escriben.sub(() => {
        const abajo = pegadoAbajo();
        pintarCab();
        if (abajo) irAbajo(true);
      }),
      PULSE.llamada.sub(pintarCab),
    ];
    pintarCab();
    pintarFilas();
    ajustarCaja();

    return {
      el: elHilo,
      enfocar: () => caja.focus({ preventScroll: true }),
      destruir: () => {
        subs.forEach((f) => f());
        if (relojBanda) clearTimeout(relojBanda);
        if (caja.value.trim()) borradores.set(c, caja.value);
      },
    };
  }

  /* ── suscripciones de la app ── */
  quitar.push(
    CHATS.lista.sub(() => {
      pintarLista();
      PULSE.fijarSeccionVisible(seVe);
    }),
    CHATS.escriben.sub(pintarLista),
  );
  pintarLista();
  pintarNada();
  void CHATS.refrescarLista();

  // Las horas relativas («Ayer») se redibujan al pasar la medianoche con la lista abierta.
  const tic = setInterval(pintarLista, 60_000);

  // La voz («mándale 10 ORIGEN a Beto», pulseVoz.ts) abre el hilo de esa persona.
  const abrirDeVoz = (e: Event) => { const d = (e as CustomEvent).detail; if (d?.correo) abrirHiloCon(String(d.correo)); };
  window.addEventListener('p2c:abrir', abrirDeVoz);
  quitar.push(() => window.removeEventListener('p2c:abrir', abrirDeVoz));

  return {
    el,
    /** La sección se ve o se dejó de ver: el hilo abierto solo se sondea a la vista. */
    visible(si: boolean) {
      if (si === seVe) return;
      seVe = si;
      PULSE.fijarSeccionVisible(si);
      if (si && abierto && !pararHilo) pararHilo = CHATS.abrirHilo(abierto);
      if (!si && pararHilo) {
        pararHilo();
        pararHilo = null;
      }
      PULSE.fijarHiloVisible(si ? abierto : null);
    },
    destruir() {
      quitar.forEach((f) => f());
      clearInterval(tic);
      hilo?.destruir();
      pararHilo?.();
      PULSE.fijarHiloVisible(null);
    },
  };
}

function textoLazo(l: string): string {
  if (l === 'no-esta') return T('No está en el chat', 'Not on the chat');
  if (l === 'demasiadas') return T('Demasiadas solicitudes', 'Too many requests');
  if (l === 'no-se-puede') return T('No se puede', 'Not possible');
  if (l === 'amigos') return T('En tu círculo', 'In your circle');
  if (l === 'sin-red') return T('Sin conexión', 'No connection');
  return '';
}

const reducido = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Achica la foto (lado mayor 1600 px, JPEG) antes de cifrarla: menos que subir y que bajar. */
async function prepararFoto(f: File): Promise<{ bytes: Uint8Array; vista: string }> {
  const bmp = await createImageBitmap(f);
  const escala = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const lienzo = document.createElement('canvas');
  lienzo.width = Math.max(1, Math.round(bmp.width * escala));
  lienzo.height = Math.max(1, Math.round(bmp.height * escala));
  lienzo.getContext('2d')!.drawImage(bmp, 0, 0, lienzo.width, lienzo.height);
  bmp.close?.();
  const blob = await new Promise<Blob>((ok, mal) => lienzo.toBlob((b) => (b ? ok(b) : mal(new Error('sin imagen'))), 'image/jpeg', 0.85));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), vista: URL.createObjectURL(blob) };
}
