/**
 * LA PANTALLA DE UNA LLAMADA de PULSE2CHAT en el Centro: entrante, sonando, conectando, en curso y
 * terminada. Va sobre `document.body`, encima de todo, porque una llamada no espera a que abras el chat
 * (es la `PantallaLlamada` del teléfono).
 *
 * Fondo hondo con el acento del avatar, la cara con un aro que late mientras suena, botones redondos
 * con su nombre debajo. Con video, el del otro ocupa todo y el propio va en un recuadro que se arrastra
 * a cualquier rincón; los botones se esconden solos si el ratón no se mueve. Se puede ACHICAR a una
 * tarjeta en la esquina para seguir usando el Centro (escribir en el chat) sin colgar.
 *
 * Al terminar dice POR QUÉ —no es lo mismo «colgó» que «no hubo camino de red»— y se va sola.
 * El armazón se arma una vez por llamada y después solo se actualizan sus piezas: rehacer los <video>
 * en cada aviso haría parpadear la imagen.
 */
import { h } from '../ui';
import { T } from '../estado';
import type { Almacen } from './chats';
import type { Cuento, Motivo, Motor } from './llamada';
import { botonP, cambiarBoton, iconoP } from './iconos';
import { iniciales, reloj } from './formato';

type Llamada = Cuento & { nombre: string };
type Dispositivos = { mic?: string; cam?: string; salida?: string };

export type DepsPantalla = {
  llamada: Almacen<Llamada | null>;
  motor: Motor;
  soltar: () => void;
  dispositivos: () => Dispositivos;
  elegir: (tipo: keyof Dispositivos, id: string) => void;
};

const RAZON: Record<Motivo, () => string> = {
  yo: () => T('Llamada terminada', 'Call ended'),
  'el-otro': () => T('La otra persona colgó', 'The other person hung up'),
  rechazada: () => T('No contestó', 'Declined'),
  'el-otro-sin-permiso': () => T('Quiso contestar, pero su equipo no le dio el micrófono', 'They tried to answer, but their device blocked the microphone'),
  ocupado: () => T('Está en otra llamada', 'On another call'),
  'no-contesto': () => T('No contestó', 'No answer'),
  perdida: () => T('Llamada perdida', 'Missed call'),
  'sin-camino': () => T('No hubo camino de red entre los dos', 'No network path between you'),
  corte: () => T('Se cortó la conexión', 'The connection dropped'),
  'no-se-pudo': () => T('No se pudo abrir la llamada', 'Couldn’t start the call'),
  'sin-permiso': () => T('Hace falta permiso de micrófono', 'Microphone permission needed'),
  'sin-microfono': () => T('No encontré un micrófono', 'No microphone found'),
  'en-otro-aparato': () => T('Contestaste en otro aparato', 'Answered on another device'),
  'rechazada-en-otro-aparato': () => T('Rechazada en otro aparato', 'Declined on another device'),
  'atendida-en-otro-aparato': () => T('Se atendió en otro aparato', 'Handled on another device'),
  'no-te-acepto': () => T('Todavía no te aceptó en su círculo', 'They haven’t accepted you yet'),
  'senal-grande': () => T('La llamada no cupo en el relevo', 'The call didn’t fit through the relay'),
  demasiadas: () => T('Demasiados intentos seguidos', 'Too many attempts in a row'),
  'sin-red': () => T('Sin conexión a internet', 'No internet connection'),
  'no-llego': () => T('La llamada no llegó al otro lado', 'The call didn’t reach them'),
};

const CONSEJO: Partial<Record<Motivo, () => string>> = {
  'sin-camino': () => T('Prueba con otra red (wifi o cable)', 'Try another network (wifi or cable)'),
  'sin-permiso': () => T('Windows › Configuración › Privacidad › Micrófono: deja que las apps lo usen', 'Windows › Settings › Privacy › Microphone: allow apps to use it'),
  'sin-microfono': () => T('Conecta un micrófono o unos audífonos y vuelve a intentar', 'Plug in a microphone or headset and try again'),
  demasiadas: () => T('Espera un minuto y vuelve a intentar', 'Wait a minute and try again'),
  'senal-grande': () => T('Vuelve a intentar en un momento', 'Try again in a moment'),
  'sin-red': () => T('Revisa la conexión a internet', 'Check your internet connection'),
};

/** Los motivos que no son un problema: el aviso dura menos. */
const BREVES: Motivo[] = ['yo', 'en-otro-aparato', 'rechazada-en-otro-aparato', 'atendida-en-otro-aparato'];

const ESPERA_CONTROLES = 4000;

type Esquina = 'ai' | 'ad' | 'bi' | 'bd';

export function montarPantallaLlamada(d: DepsPantalla) {
  let raiz: HTMLElement | null = null;
  let piezas: ReturnType<typeof armar> | null = null;
  let relojSegundos: ReturnType<typeof setInterval> | null = null;
  let relojSalida: ReturnType<typeof setTimeout> | null = null;
  let relojQuieto: ReturnType<typeof setTimeout> | null = null;
  let mini = false;
  let esquina: Esquina = 'bd';
  let controlesDe = '';
  let ultimo: Llamada | null = null;

  function armar() {
    const audio = h('audio', { autoplay: true, class: 'p2c-ll-audio' }) as HTMLAudioElement;
    const remoto = h('video', { autoplay: true, playsinline: true, muted: true, class: 'p2c-ll-remoto' }) as HTMLVideoElement;
    const propio = h('video', { autoplay: true, playsinline: true, muted: true, class: 'p2c-ll-propio', title: T('Tu cámara (arrástrala a otra esquina)', 'Your camera (drag it to another corner)') }) as HTMLVideoElement;
    remoto.muted = true;
    propio.muted = true;
    const inicial = h('span', null, '');
    const cara = h('div', { class: 'p2c-ll-cara' }, h('i', { class: 'onda' }), h('i', { class: 'onda dos' }), h('div', { class: 'aro' }, inicial));
    const nombre = h('h2', { class: 'p2c-ll-nombre' }, '');
    const leyenda = h('p', { class: 'p2c-ll-leyenda', 'aria-live': 'polite' }, '');
    const consejo = h('p', { class: 'p2c-ll-consejo' }, '');
    const insignia = h('span', { class: 'p2c-ll-insignia' }, iconoP('candado', 13), T('Cifrada de punta a punta', 'End-to-end encrypted'));
    const info = h('div', { class: 'p2c-ll-info' }, cara, nombre, leyenda, consejo, insignia);
    const controles = h('div', { class: 'p2c-ll-controles' });
    const achicar = botonP('minimizar', T('Achicar la llamada (sigue en la esquina)', 'Shrink the call (keeps going in the corner)'), () => ponerMini(!mini), 'p2c-ll-achicar');
    const menu = h('div', { class: 'p2c-ll-menu', role: 'menu', hidden: true });
    const r = h(
      'div',
      { class: 'p2c-llamada', role: 'dialog', 'aria-modal': 'false', 'aria-label': T('Llamada de PULSE2CHAT', 'PULSE2CHAT call') },
      h('div', { class: 'p2c-ll-fondo' }),
      remoto,
      propio,
      audio,
      info,
      controles,
      achicar,
      menu,
    );
    r.addEventListener('pointermove', despertarControles);
    r.addEventListener('pointerdown', despertarControles);
    r.addEventListener('keydown', despertarControles);
    arrastrable(propio);
    return { raiz: r, audio, remoto, propio, inicial, cara, nombre, leyenda, consejo, insignia, info, controles, achicar, menu };
  }

  function ponerMini(si: boolean) {
    mini = si;
    raiz?.classList.toggle('mini', si);
    if (piezas) cambiarBoton(piezas.achicar, si ? 'expandir' : 'minimizar', si ? T('Agrandar la llamada', 'Expand the call') : T('Achicar la llamada (sigue en la esquina)', 'Shrink the call (keeps going in the corner)'));
  }

  function despertarControles() {
    if (!raiz) return;
    raiz.classList.remove('quieto');
    if (relojQuieto) clearTimeout(relojQuieto);
    relojQuieto = null;
    if (raiz.classList.contains('con-video') && !mini) relojQuieto = setTimeout(() => raiz?.classList.add('quieto'), ESPERA_CONTROLES);
  }

  /** El recuadro propio se arrastra y se acomoda en la esquina más cercana. */
  function arrastrable(el: HTMLElement) {
    let x0 = 0;
    let y0 = 0;
    let moviendo = false;
    el.addEventListener('pointerdown', (e) => {
      if (mini) return;
      moviendo = true;
      x0 = e.clientX;
      y0 = e.clientY;
      el.setPointerCapture(e.pointerId);
      el.classList.add('moviendo');
    });
    el.addEventListener('pointermove', (e) => {
      if (!moviendo) return;
      el.style.translate = `${e.clientX - x0}px ${e.clientY - y0}px`;
    });
    const soltar = (e: PointerEvent) => {
      if (!moviendo) return;
      moviendo = false;
      el.classList.remove('moviendo');
      el.style.translate = '';
      const arriba = e.clientY < innerHeight / 2;
      const izq = e.clientX < innerWidth / 2;
      esquina = `${arriba ? 'a' : 'b'}${izq ? 'i' : 'd'}` as Esquina;
      el.dataset.esquina = esquina;
    };
    el.addEventListener('pointerup', soltar);
    el.addEventListener('pointercancel', soltar);
  }

  /** Un botón redondo con su nombre debajo. */
  function botonLlamada(icono: string, etiqueta: string, alClic: () => void, clase = '', activo = false) {
    const b = botonP(icono, etiqueta, alClic, `grande ${clase}`, 24);
    if (activo) b.classList.add('activo');
    b.setAttribute('aria-pressed', String(activo));
    return h('div', { class: 'p2c-ll-boton' }, b, h('small', { 'aria-hidden': 'true' }, etiqueta));
  }

  function pintarControles(c: Llamada) {
    if (!piezas) return;
    const terminada = c.estado === 'libre';
    // Solo se rehacen si cambió lo que muestran (un rehacer a cada segundo robaría el foco del teclado).
    const clave = terminada ? 'fin' : c.estado === 'entrando' ? `ent-${c.entrante?.video}` : `en-${c.micAbierto}-${c.hayVideo}-${c.camAbierta}`;
    if (clave === controlesDe) return;
    const teniaFoco = piezas.controles.contains(document.activeElement);
    controlesDe = clave;
    const caja = piezas.controles;
    caja.replaceChildren();
    if (terminada) return;
    if (c.estado === 'entrando') {
      const video = !!c.entrante?.video;
      caja.append(
        ...[
        botonLlamada('colgar', T('Rechazar', 'Decline'), () => d.motor.rechazar(), 'rojo'),
        video ? botonLlamada('telefono', T('Solo voz', 'Voice only'), () => void d.motor.contestar(false).catch(() => {})) : null,
        botonLlamada(video ? 'video' : 'telefono', video ? T('Contestar con video', 'Answer with video') : T('Contestar', 'Answer'), () => void d.motor.contestar(video).catch(() => {}), 'verde contestar'),
        ].filter((x): x is HTMLDivElement => !!x),
      );
      // El foco va a «Contestar»: Enter contesta, Tab lleva a «Rechazar».
      (caja.querySelector('.contestar') as HTMLButtonElement | null)?.focus({ preventScroll: true });
      return;
    }
    caja.append(
      ...[
      botonLlamada(c.micAbierto ? 'mic' : 'micNo', c.micAbierto ? T('Silenciar', 'Mute') : T('Activar micrófono', 'Unmute'), () => d.motor.micro(), '', !c.micAbierto),
      c.hayVideo
        ? botonLlamada(c.camAbierta ? 'video' : 'videoNo', c.camAbierta ? T('Apagar cámara', 'Turn camera off') : T('Encender cámara', 'Turn camera on'), () => d.motor.camara(), '', !c.camAbierta)
        : null,
      botonLlamada('dispositivos', T('Micrófono, cámara y altavoz', 'Microphone, camera and speaker'), () => void abrirMenu()),
      botonLlamada('colgar', T('Colgar', 'Hang up'), () => d.motor.colgar('yo'), 'rojo colgar'),
      ].filter((x): x is HTMLDivElement => !!x),
    );
    if (teniaFoco) (caja.querySelector('.colgar') as HTMLButtonElement | null)?.focus({ preventScroll: true });
  }

  /** El menú de dispositivos: micrófono, cámara (si hay video) y salida (si la WebView deja elegirla). */
  async function abrirMenu() {
    if (!piezas) return;
    const menu = piezas.menu;
    if (!menu.hidden) {
      menu.hidden = true;
      return;
    }
    let lista: MediaDeviceInfo[] = [];
    try {
      lista = await navigator.mediaDevices.enumerateDevices();
    } catch {
      lista = [];
    }
    const c = d.llamada.get();
    const elegidos = d.dispositivos();
    const pistaMic = c?.flujoLocal?.getAudioTracks()[0]?.getSettings?.().deviceId;
    const pistaCam = c?.flujoLocal?.getVideoTracks()[0]?.getSettings?.().deviceId;
    const puedeSalida = typeof (piezas.audio as any).setSinkId === 'function';
    const grupo = (titulo: string, tipo: MediaDeviceKind, actual: string | undefined, elegir: (id: string) => void) => {
      const opciones = lista.filter((x) => x.kind === tipo);
      if (!opciones.length) return null;
      return h(
        'div',
        { class: 'grupo', role: 'group', 'aria-label': titulo },
        h('strong', null, titulo),
        opciones.map((x, i) => {
          const si = (actual || 'default') === x.deviceId || (!actual && i === 0);
          return h(
            'button',
            { type: 'button', role: 'menuitemradio', 'aria-checked': String(si), class: si ? 'elegido' : '', on: { click: () => { elegir(x.deviceId); menu.hidden = true; } } },
            x.label || `${titulo} ${i + 1}`,
          );
        }),
      );
    };
    menu.replaceChildren(
      ...[
        grupo(T('Micrófono', 'Microphone'), 'audioinput', pistaMic || elegidos.mic, (id) => {
          d.elegir('mic', id);
          void d.motor.cambiarDispositivo('audio', id).catch(() => {});
        }),
        c?.hayVideo
          ? grupo(T('Cámara', 'Camera'), 'videoinput', pistaCam || elegidos.cam, (id) => {
              d.elegir('cam', id);
              void d.motor.cambiarDispositivo('video', id).catch(() => {});
            })
          : null,
        puedeSalida
          ? grupo(T('Altavoz', 'Speaker'), 'audiooutput', elegidos.salida, (id) => {
              d.elegir('salida', id);
              void (piezas!.audio as any).setSinkId(id).catch(() => {});
            })
          : null,
      ].filter((x): x is HTMLDivElement => !!x),
    );
    if (!menu.childElementCount) menu.append(h('p', { class: 'tenue' }, T('No hay otros dispositivos.', 'No other devices.')));
    menu.hidden = false;
    (menu.querySelector('button') as HTMLButtonElement | null)?.focus();
  }

  function ponerFlujo(v: HTMLMediaElement, f: MediaStream | null) {
    if (v.srcObject !== f) {
      v.srcObject = f;
      if (f) void v.play().catch(() => {});
    }
  }

  function leyendaDe(c: Llamada): string {
    if (c.estado === 'libre') return c.motivo ? RAZON[c.motivo]?.() || '' : '';
    if (c.estado === 'entrando') return c.entrante?.video ? T('Videollamada entrante', 'Incoming video call') : T('Llamada de voz entrante', 'Incoming voice call');
    if (c.estado === 'llamando') return T('Sonando…', 'Ringing…');
    if (c.estado === 'conectando') return T('Conectando…', 'Connecting…');
    if (c.reconectando) return T('Reconectando…', 'Reconnecting…');
    return reloj(Date.now() - (c.desde || Date.now()));
  }

  function cerrar() {
    if (relojSegundos) clearInterval(relojSegundos);
    if (relojSalida) clearTimeout(relojSalida);
    if (relojQuieto) clearTimeout(relojQuieto);
    relojSegundos = relojSalida = relojQuieto = null;
    if (piezas) {
      piezas.audio.srcObject = null;
      piezas.remoto.srcObject = null;
      piezas.propio.srcObject = null;
    }
    const r = raiz;
    raiz = null;
    piezas = null;
    controlesDe = '';
    if (r) {
      r.classList.add('sale');
      setTimeout(() => r.remove(), 320);
    }
  }

  function pintar(c: Llamada | null) {
    const antes = ultimo;
    ultimo = c;
    if (!c) return cerrar();
    const terminada = c.estado === 'libre';
    if (!raiz || !piezas) {
      // Una llamada que ya terminó (se colgó sin llegar a verse) no abre la pantalla.
      if (terminada && !antes) {
        d.soltar();
        return;
      }
      piezas = armar();
      raiz = piezas.raiz;
      mini = false;
      document.body.appendChild(raiz);
    }
    const p = piezas;
    const sonando = c.estado === 'llamando' || c.estado === 'entrando';
    const videoGrande = c.videoRemoto && !!c.flujoRemoto && c.estado === 'hablando';
    const propioVisible = c.hayVideo && c.camAbierta && !!c.flujoLocal && !terminada;
    const propioGrande = propioVisible && !videoGrande;
    raiz.className = ['p2c-llamada', `estado-${c.estado}`, mini ? 'mini' : '', videoGrande || propioGrande ? 'con-video' : '', propioGrande ? 'propio-grande' : '', terminada ? 'terminada' : '', raiz.classList.contains('quieto') ? 'quieto' : '']
      .filter(Boolean)
      .join(' ');
    raiz.setAttribute('aria-label', `${T('Llamada con', 'Call with')} ${c.nombre}`);
    p.inicial.textContent = iniciales(c.nombre);
    p.cara.classList.toggle('late', sonando);
    p.nombre.textContent = c.nombre || T('Llamada', 'Call');
    p.leyenda.textContent = leyendaDe(c);
    const problema = terminada && c.motivo && !BREVES.includes(c.motivo) && c.motivo !== 'el-otro';
    p.leyenda.classList.toggle('problema', !!problema);
    const duro = terminada && c.desde ? reloj(Date.now() - c.desde) : '';
    p.consejo.textContent = terminada ? CONSEJO[c.motivo as Motivo]?.() || (duro && c.motivo !== 'perdida' ? duro : '') : '';
    p.insignia.hidden = terminada;
    p.achicar.hidden = terminada || c.estado === 'entrando';
    if (c.estado === 'entrando' && mini) ponerMini(false);
    ponerFlujo(p.audio, terminada ? null : c.flujoRemoto);
    ponerFlujo(p.remoto, videoGrande ? c.flujoRemoto : null);
    ponerFlujo(p.propio, propioVisible ? c.flujoLocal : null);
    // Sin flujo, un <video> es un recuadro negro: se esconde (la cámara propia tapada, el otro sin video).
    p.remoto.hidden = !videoGrande;
    p.propio.hidden = !propioVisible;
    p.propio.dataset.esquina = esquina;
    // La salida elegida (audífonos, bocinas), si la WebView deja elegirla.
    const salida = d.dispositivos().salida;
    if (salida && typeof (p.audio as any).setSinkId === 'function' && (p.audio as any).sinkId !== salida) void (p.audio as any).setSinkId(salida).catch(() => {});
    pintarControles(c);
    if (terminada) p.menu.hidden = true;

    // El reloj de la llamada corre solo mientras se habla.
    if (c.estado === 'hablando' && !relojSegundos) {
      relojSegundos = setInterval(() => {
        const u = ultimo;
        if (piezas && u && u.estado === 'hablando') piezas.leyenda.textContent = leyendaDe(u);
      }, 1000);
    } else if (c.estado !== 'hablando' && relojSegundos) {
      clearInterval(relojSegundos);
      relojSegundos = null;
    }
    if (videoGrande || propioGrande) despertarControles();

    // Terminada: el aviso se queda un momento y se va solo.
    if (terminada && !relojSalida) {
      const espera = BREVES.includes(c.motivo as Motivo) ? 1400 : 3200;
      relojSalida = setTimeout(() => d.soltar(), espera);
    } else if (!terminada && relojSalida) {
      clearTimeout(relojSalida);
      relojSalida = null;
    }
  }

  d.llamada.sub(() => pintar(d.llamada.get()));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && piezas && !piezas.menu.hidden) piezas.menu.hidden = true;
  });
}
