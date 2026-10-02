/**
 * EL ESCENARIO DEL RECORRIDO: un escritorio de Windows dibujado (fondo, barra de tareas, ventanas) con
 * el notch de AURA arriba al centro, que crece y cambia como el de verdad (Notch/NotchWindow.xaml:
 * reposo, escucha, habla, aviso, confirma, llamada, música). Encima, cada escena pinta su ejemplo.
 *
 * `pintar(escena, i, ctx)` deja el escritorio como queda la escena en su paso `i`: lo de los pasos de
 * antes, ya hecho; lo del paso `i`, animándose (se escribe letra por letra, suena el timbre, cuenta el
 * reloj). Así, saltar a cualquier paso (atrás, ir) muestra lo que corresponde, sin restos.
 *
 * Todo mide en `em` y el escenario fija su letra según su ancho: se ve igual de grande o de chico.
 */
import { h } from '../ui';
import { ico } from './iconos';
import type { DemoId } from './guion';
import type { SonidoId } from './coreografia';

export type Ctx = {
  t: (es: string, en: string) => string;
  /** La persona tocó para llegar a este paso (contestó, dijo que sí). */
  tocado: boolean;
  /** Para las interacciones: lo que se toca llama a esto (el motor avanza). */
  tocar: () => void;
  sonar: (s: SonidoId) => void;
  /** Un reloj de la escena: se cancela solo al cambiar de paso o de escena. */
  despues: (ms: number, f: () => void) => void;
  reducido: boolean;
};

export type Escritorio = {
  el: HTMLElement;
  /** El lugar del notch donde aterriza el anfitrión que vuela. */
  lugar: HTMLElement;
  notch: HTMLElement;
  pintar(escena: DemoId, i: number, c: Ctx): void;
  /** El elemento que hay que tocar en la espera en curso (para resaltarlo), o null. */
  objetivo(): HTMLElement | null;
};

const app = (letra: string, color: string, titulo: string) => h('span', { class: 'r-app', style: `background:${color}`, title: titulo, 'aria-label': titulo }, letra);
const WHATSAPP = () => app('W', '#25d366', 'WhatsApp');
const TEAMS = () => app('T', '#5b5fc7', 'Teams');
const OUTLOOK = () => app('O', '#0f6cbd', 'Outlook');

export function crearEscritorio(): Escritorio {
  const fondo = h('div', { class: 'r-fondo' }, h('i', { class: 'r-flor a' }), h('i', { class: 'r-flor b' }), h('i', { class: 'r-flor c' }));
  const brillo = h('div', { class: 'r-brillo' });
  const ventanas = h('div', { class: 'r-ventanas' });
  const lugar = h('span', { class: 'n-lugar' });
  const nCuerpo = h('div', { class: 'n-cuerpo' });
  const notch = h('div', { class: 'r-notch', 'data-estado': 'reposo' }, h('i', { class: 'n-oreja izq' }), h('i', { class: 'n-oreja der' }), lugar, nCuerpo);
  const reloj = h('span', { class: 'r-hora' }, '3:41 p. m.');
  const barra = h('div', { class: 'r-barra' },
    h('div', { class: 'r-barra-centro' },
      h('span', { class: 'r-tarea inicio', title: 'Inicio' }, ico('windows', 16)),
      h('span', { class: 'r-tarea' }, ico('buscar', 15)),
      h('span', { class: 'r-tarea' }, ico('carpeta', 15)),
      h('span', { class: 'r-tarea' }, ico('globo', 15)),
      h('span', { class: 'r-tarea bloc' }, ico('lapiz', 15)),
      h('span', { class: 'r-tarea' }, ico('musica', 15)),
      h('span', { class: 'r-tarea' }, ico('chat', 15))),
    h('div', { class: 'r-barra-der' }, ico('wifi', 13), reloj));
  const capa = h('div', { class: 'r-capa' });
  const dice = h('div', { class: 'r-dice', 'aria-hidden': 'true' });
  const icono = (ic: string, nombre: string) => h('span', { class: 'r-icono' }, h('i', null, ico(ic, 18)), nombre);
  const iconos = h('div', { class: 'r-iconos' }, icono('carpeta', 'Documentos'), icono('excel', 'Ventas.xlsx'), icono('globo', 'Edge'));
  const el = h('div', { class: 'r-escritorio', 'data-escena': '', 'data-paso': '' }, fondo, iconos, ventanas, capa, brillo, notch, barra, dice);

  // La letra del escenario sigue a su ancho: todo lo de adentro mide en em.
  new ResizeObserver(() => { el.style.fontSize = `${Math.max(8, el.clientWidth / 58)}px`; }).observe(el);

  let objetivo: HTMLElement | null = null;
  let estadoNotch = '';

  /** Pone el notch en un estado con su contenido (el contenido nuevo entra fundiéndose). */
  function ponNotch(estado: string, ...hijos: (Node | string | null | false)[]) {
    const cambio = estado !== estadoNotch;
    estadoNotch = estado;
    notch.dataset.estado = estado;
    const nuevo = h('div', { class: 'n-contenido' + (cambio ? ' entra' : '') }, ...hijos.filter(Boolean) as Node[]);
    nCuerpo.replaceChildren(nuevo);
  }
  const barras = (n = 5) => h('span', { class: 'n-barras' }, ...Array.from({ length: n }, (_, k) => h('i', { style: `animation-delay:${(k * 0.11).toFixed(2)}s` })));
  const reposo = () => ponNotch('reposo', h('span', { class: 'n-cam' }), h('span', { class: 'n-punto' }));
  const subtitulo = (texto: string) => h('span', { class: 'n-sub' }, texto);

  /** Lo que la persona dice (o teclea), abajo a la izquierda: es lo que AURA oye. */
  function ponDice(texto: string | null, c: Ctx, conMic = true) {
    dice.replaceChildren();
    dice.classList.remove('on');
    if (!texto) return;
    const t = h('span', { class: 'r-dice-texto' });
    if (conMic) dice.append(h('span', { class: 'r-dice-mic' }, ico('mic', 14)));
    dice.append(t);
    dice.classList.add('on');
    if (c.reducido) { t.textContent = texto; return; }
    let k = 0;
    const paso = () => { k = Math.min(texto.length, k + 2); t.textContent = texto.slice(0, k); if (k < texto.length) c.despues(28, paso); };
    paso();
  }

  function ventana(clase: string, titulo: string, ...hijos: (Node | null)[]) {
    return h('div', { class: `r-ventana ${clase}` },
      h('div', { class: 'r-ventana-barra' }, h('span', { class: 'r-ventana-titulo' }, titulo), h('span', { class: 'r-ventana-botones' }, h('i'), h('i'), h('i'))),
      h('div', { class: 'r-ventana-cuerpo' }, ...hijos));
  }

  /** Escribe `texto` en `destino` letra por letra (con el sonido del teclado), o de una si no es el paso actual. */
  function escribir(destino: HTMLElement, texto: string, c: Ctx, animar: boolean, alTerminar?: () => void, ms = 42) {
    if (!animar || c.reducido) { destino.textContent = texto; alTerminar?.(); return; }
    let k = 0;
    destino.textContent = '';
    const paso = () => {
      k++;
      destino.textContent = texto.slice(0, k);
      if (k < texto.length) c.despues(texto[k - 1] === ' ' ? ms * 1.6 : ms + Math.random() * ms, paso);
      else alTerminar?.();
    };
    c.despues(300, paso);
  }

  /** Un botón del ejemplo que se puede tocar en la espera (el «Sí», «Contestar», las teclas). */
  function tocable<T extends HTMLElement>(b: T, c: Ctx, activo: boolean): T {
    if (activo) {
      objetivo = b;
      b.classList.add('r-tocable');
      b.addEventListener('click', (ev) => { ev.stopPropagation(); b.classList.add('tocado'); c.sonar('tap'); c.tocar(); });
    }
    return b;
  }

  function limpiar() {
    objetivo = null;
    ventanas.replaceChildren();
    capa.replaceChildren();
    el.classList.remove('oscuro', 'apartado', 'entra');
    brillo.style.opacity = '0';
    notch.classList.remove('resalta', 'silenciado', 'pausado', 'timbra');
    dice.classList.remove('on');
    dice.replaceChildren();
  }

  // ─────────────── las escenas ───────────────

  const ESCENAS: Record<DemoId, (i: number, c: Ctx) => void> = {
    portada(i) {
      if (i === 0) el.classList.add('entra');
      reposo();
      if (i >= 1) notch.classList.add('resalta');
    },

    notch(i, c) {
      if (i === 0) { reposo(); notch.classList.add('resalta'); }
      if (i === 1) ponNotch('escucha', h('span', { class: 'n-luz' }), barras(7), subtitulo(c.t('Te escucho…', 'Listening…')));
      if (i === 2) ponNotch('habla', barras(4), subtitulo(c.t('Claro que sí. Ya lo abro.', 'Sure thing. Opening it now.')));
      if (i === 3) {
        // Un video a pantalla completa: el notch se aparta hacia arriba.
        ventanas.append(h('div', { class: 'r-pantalla-completa' }, h('div', { class: 'r-pelicula' }, h('i'), h('i'), h('i')), h('span', { class: 'r-pelicula-barra' }, h('i'))));
        reposo();
        el.classList.add('apartado');
      }
    },

    voz(i, c) {
      reposo();
      if (i === 0) {
        const teclas = h('div', { class: 'r-teclas' },
          ...['Ctrl', 'Alt', c.t('Espacio', 'Space')].map((k, n) => h('span', { class: 'r-tecla' + (n === 2 ? ' larga' : ''), style: `animation-delay:${n * 0.12}s` }, k)));
        const caja = tocable(h('button', { class: 'r-teclas-caja', 'aria-label': c.t('Tocar Ctrl + Alt + Espacio', 'Tap Ctrl + Alt + Space') }, teclas), c, true);
        capa.append(caja);
      }
      if (i >= 1) {
        ponNotch('escucha', h('span', { class: 'n-luz' }), barras(7), subtitulo(c.t('Te escucho…', 'Listening…')));
        if (c.tocado && i === 1) capa.append(h('div', { class: 'r-teclas fuera' }, ...['Ctrl', 'Alt', c.t('Espacio', 'Space')].map((k) => h('span', { class: 'r-tecla apretada' }, k))));
      }
      if (i === 1) ponDice(c.t('«Oye AURA»', '“Hey AURA”'), c);
      if (i === 2) {
        ponNotch('habla', barras(4), subtitulo(c.t('Hoy en Tegucigalpa va a estar soleado, con…', 'Today in Tegucigalpa it’ll be sunny, with…')));
        c.despues(1500, () => {
          ponDice(c.t('Espera, mejor dime la hora', 'Wait, tell me the time instead'), c);
          ponNotch('escucha', h('span', { class: 'n-luz' }), barras(7), subtitulo(c.t('Te escucho…', 'Listening…')));
        });
      }
    },

    escribir(i, c) {
      // Corto: directo. Largo (más de 280 letras o 3 renglones): «¿Lo escribo en…?» y espera el sí.
      const corto = c.t('Hola Karla, ya voy en camino', 'Hi Karla, I’m on my way');
      const largo = c.t('Estimados miembros de la junta: les escribo para confirmar la reunión del jueves a las 3:00 y compartirles la agenda…',
        'Dear board members: I’m writing to confirm Thursday’s meeting at 3:00 and to share the agenda…');
      const hoja = h('div', { class: 'r-bloc-texto' });
      const hoja2 = h('div', { class: 'r-bloc-texto largo' });
      const caret = h('i', { class: 'r-caret' });
      ventanas.append(ventana('bloc' + (i === 0 ? ' abre' : ''), c.t('Sin título: Bloc de notas', 'Untitled - Notepad'), h('div', { class: 'r-bloc' }, hoja, hoja2, caret)));
      if (i === 0) { reposo(); ponDice(c.t('Escribe: Hola Karla, ya voy en camino', 'Type: Hi Karla, I’m on my way'), c); }
      if (i === 1) {
        ponNotch('aviso', ico('lapiz', 15), subtitulo(c.t('Escribiendo en el Bloc de notas…', 'Typing in Notepad…')));
        c.despues(300, () => c.sonar('teclado'));
        escribir(hoja, corto, c, true, () => ponNotch('aviso', h('span', { class: 'n-ok' }, ico('ok', 13)), subtitulo(c.t('Listo, ya lo escribí', 'Done, it’s typed'))));
      }
      if (i >= 2) hoja.textContent = corto;
      if (i === 2) {
        ponDice(c.t('Escribe la carta para la junta', 'Type the letter to the board'), c);
        const si = tocable(h('button', { class: 'n-btn verde' }, c.t('Sí', 'Yes')), c, true);
        ponNotch('confirma', h('span', { class: 'n-pregunta' }, h('strong', null, c.t('¿Lo escribo en Bloc de notas?', 'Type it into Notepad?')), h('small', null, largo)),
          h('span', { class: 'n-botones' }, h('button', { class: 'n-btn' }, 'No'), si));
      }
      if (i === 3) {
        ponNotch('aviso', ico('lapiz', 15), subtitulo(c.t('Escribiendo en el Bloc de notas…', 'Typing in Notepad…')));
        c.despues(300, () => c.sonar('teclado'));
        escribir(hoja2, largo, c, true, () => {
          ponNotch('aviso', h('span', { class: 'n-ok' }, ico('ok', 13)), subtitulo(c.t('Listo, ya la escribí', 'Done, it’s typed')));
          capa.append(h('div', { class: 'r-chip r-chip-candado' }, ico('candado', 14), c.t('Nunca en campos de contraseña', 'Never in password fields')));
        }, 18);
      }
    },

    control(i, c) {
      reposo();
      const win = ventana('navegador izquierda' + (i === 0 ? ' encaja' : ''), 'Edge',
        h('div', { class: 'r-web' }, h('i', { class: 'r-web-barra' }), h('i', { class: 'r-web-linea l1' }), h('i', { class: 'r-web-linea l2' }), h('i', { class: 'r-web-linea l3' }), h('i', { class: 'r-web-foto' })));
      ventanas.append(win);
      if (i === 0) {
        capa.append(h('div', { class: 'r-encaje' }));
        ponDice(c.t('Pon la ventana a la izquierda', 'Put the window on the left'), c);
      }
      // «Sube el brillo»: la pantalla empieza apagadita y se enciende.
      if (i === 1) {
        brillo.style.transition = 'none';
        brillo.style.opacity = '0.42';
        requestAnimationFrame(() => requestAnimationFrame(() => { brillo.style.transition = ''; brillo.style.opacity = '0'; }));
        capa.append(h('div', { class: 'r-osd' }, ico('sol', 16), h('span', { class: 'r-osd-barra' }, h('i'))));
        ponDice(c.t('Sube el brillo', 'Turn up the brightness'), c);
      }
      if (i >= 2) el.classList.add('oscuro');
      if (i === 2) { capa.append(h('div', { class: 'r-revela' })); ponDice(c.t('Activa el modo oscuro', 'Turn on dark mode'), c); }
      if (i === 3) {
        const ordenes: [string, string, string][] = [['copiar', 'Cópialo', 'Copy it'], ['pegar', 'Pégalo', 'Paste it'], ['guardar', 'Guárdalo', 'Save it'], ['excel', 'Abre Excel', 'Open Excel']];
        capa.append(h('div', { class: 'r-ordenes' }, ...ordenes.map(([ic, es, en], n) => h('span', { class: 'r-orden', style: `animation-delay:${0.25 + n * 0.45}s` }, ico(ic, 14), c.t(es, en)))));
        c.despues(2400, () => ponNotch('confirma', h('span', { class: 'n-pregunta' }, h('strong', null, c.t('¿Cierro esta ventana?', 'Close this window?')), h('small', null, c.t('Lo que no se deshace, primero te pregunto', 'Anything permanent, I ask first'))),
          h('span', { class: 'n-botones' }, h('button', { class: 'n-btn' }, 'No'), h('button', { class: 'n-btn verde' }, c.t('Sí', 'Yes')))));
      }
    },

    avisos(i, c) {
      const avisos: [() => HTMLElement, string, string, string][] = [
        [WHATSAPP, 'WhatsApp · Karla', '¿Ya vienes? 😄', 'On your way? 😄'],
        [TEAMS, 'Teams · Equipo', 'Reunión en 10 minutos', 'Meeting in 10 minutes'],
        [OUTLOOK, 'Outlook · Banco', 'Tu estado de cuenta de septiembre', 'Your September statement'],
      ];
      const aviso = (k: number) => {
        const [logo, titulo, es, en] = avisos[k];
        ponNotch('aviso', logo(), h('span', { class: 'n-pregunta' }, h('strong', null, titulo), h('small', null, c.t(es, en))), h('button', { class: 'n-btn chico' }, c.t('Abrir', 'Open')));
      };
      if (i === 0) {
        aviso(0);
        c.despues(1700, () => { aviso(1); c.sonar('chispa'); });
        c.despues(3400, () => { aviso(2); c.sonar('chispa'); });
      }
      if (i === 1) {
        ponDice(c.t('¿Qué notificaciones tengo?', 'What notifications do I have?'), c);
        c.despues(1500, () => ponNotch('habla', barras(4), subtitulo(c.t('Tienes tres: Karla en WhatsApp, una reunión en Teams y…', 'You have three: Karla on WhatsApp, a Teams meeting and…'))));
        ponNotch('escucha', h('span', { class: 'n-luz' }), barras(7), subtitulo(c.t('Te escucho…', 'Listening…')));
      }
      if (i === 2) {
        ponDice(c.t('Silencia las notificaciones de WhatsApp', 'Mute WhatsApp notifications'), c);
        ponNotch('aviso', h('span', { class: 'r-app-silencio' }, WHATSAPP()), h('span', { class: 'n-pregunta' }, h('strong', null, c.t('WhatsApp en silencio', 'WhatsApp muted')), h('small', null, c.t('Dime «vuelve a mostrarlas» cuando quieras', 'Say “show them again” anytime'))));
      }
    },

    musica(i, c) {
      const cancion = (portada: string, titulo: string, artista: string) => ponNotch('musica',
        h('span', { class: `n-portada ${portada}` }),
        h('span', { class: 'n-pregunta' }, h('strong', null, titulo), h('small', null, artista), h('span', { class: 'n-progreso' }, h('i'))),
        h('span', { class: 'n-controles' }, ico('anterior', 13), h('span', { class: 'n-play' }, ico('pausa', 13)), ico('siguiente', 13)), barras(4));
      if (i === 0) cancion('p1', 'Vivir Mi Vida', 'Marc Anthony · Spotify');
      if (i === 1) {
        cancion('p1', 'Vivir Mi Vida', 'Marc Anthony · Spotify');
        ponDice(c.t('Pon Bad Bunny en Spotify', 'Play Bad Bunny on Spotify'), c);
        c.despues(1600, () => {
          cancion('p2', 'Tití Me Preguntó', 'Bad Bunny · Spotify');
          capa.append(h('div', { class: 'r-notas' }, ...Array.from({ length: 7 }, (_, k) => h('span', { style: `left:${12 + k * 12}%;animation-delay:${(k * 0.18).toFixed(2)}s` }, ico('nota', 18)))));
        });
      }
    },

    dia(i, c) {
      if (i === 0) ponNotch('aviso', OUTLOOK(), h('span', { class: 'n-pregunta' }, h('strong', null, c.t('Correo de Karla', 'Email from Karla')), h('small', null, c.t('La junta se movió a las 3:00', 'The meeting moved to 3:00'))), h('button', { class: 'n-btn chico' }, c.t('Leer', 'Read')));
      if (i === 1) {
        ponNotch('aviso', h('span', { class: 'r-app', style: 'background:#ea4335' }, ico('calendario', 13)), h('span', { class: 'n-pregunta' }, h('strong', null, c.t('En 10 minutos', 'In 10 minutes')), h('small', null, c.t('Junta directiva · 3:00 p. m.', 'Board meeting · 3:00 p.m.'))));
        c.despues(2300, () => {
          ponDice(c.t('¿Qué tengo hoy?', 'What’s on today?'), c);
          capa.append(h('div', { class: 'r-dia' },
            h('strong', null, c.t('Hoy', 'Today')),
            h('span', null, h('em', null, '3:00'), c.t('Junta directiva', 'Board meeting')),
            h('span', null, h('em', null, '5:30'), c.t('Llamada con Maple', 'Call with Maple'))));
        });
      }
      if (i === 2) {
        ponDice(c.t('Recuérdame en 10 minutos llamar a mamá', 'Remind me in 10 minutes to call mom'), c);
        capa.append(h('div', { class: 'r-reloj-grande' }, h('i', { class: 'aguja h' }), h('i', { class: 'aguja m' })));
        c.despues(2200, () => {
          c.sonar('chispa');
          ponNotch('aviso', h('span', { class: 'r-app', style: 'background:#d6b56c;color:#111' }, ico('reloj', 13)), h('span', { class: 'n-pregunta' }, h('strong', null, c.t('Recordatorio · 3:51 p. m.', 'Reminder · 3:51 p.m.')), h('small', null, c.t('Llamar a mamá', 'Call mom'))));
        });
        reposo();
      }
    },

    pulse(i, c) {
      if (i === 0) {
        const contestar = tocable(h('button', { class: 'n-btn verde redondo', title: c.t('Contestar', 'Answer') }, ico('telefono', 14)), c, true);
        ponNotch('llamada', h('span', { class: 'n-foto' }, 'K'), h('span', { class: 'n-pregunta' }, h('strong', null, c.t('Karla te está llamando', 'Karla is calling')), h('small', null, 'PULSE2CHAT · ' + c.t('cifrada', 'encrypted'))),
          h('span', { class: 'n-botones' }, h('button', { class: 'n-btn rojo redondo', title: c.t('Rechazar', 'Decline') }, ico('colgar', 14)), contestar));
        notch.classList.add('timbra');
      }
      if (i >= 1) {
        const tiempo = h('small', null, '00:00');
        ponNotch('encall', h('span', { class: 'n-foto' }, 'K'), h('span', { class: 'n-pregunta' }, h('strong', null, 'Karla'), tiempo), barras(4), h('button', { class: 'n-btn rojo redondo' }, ico('colgar', 14)));
        if (i === 1) {
          let s = 0;
          const tic = () => { s++; tiempo.textContent = `00:${String(s).padStart(2, '0')}`; c.despues(1000, tic); };
          c.despues(1000, tic);
          if (!c.tocado) ponDice(c.t('Sí', 'Yes'), c);
        } else tiempo.textContent = '00:12';
      }
      if (i === 2) {
        ponDice(c.t('Mándale un mensaje a Karla que ya voy', 'Message Karla that I’m coming'), c);
        c.despues(1700, () => ponNotch('confirma', h('span', { class: 'n-pregunta' }, h('strong', null, c.t('¿Le mando a Karla?', 'Send to Karla?')), h('small', null, c.t('«Ya voy»', '“I’m coming”'))),
          h('span', { class: 'n-botones' }, h('button', { class: 'n-btn' }, 'No'), h('button', { class: 'n-btn verde' }, c.t('Sí', 'Yes')))));
        c.despues(3400, () => ponDice(c.t('Sí', 'Yes'), c));
        c.despues(4200, () => {
          c.sonar('whoosh');
          capa.append(h('div', { class: 'r-avion' }, ico('avion', 22)));
          ponNotch('aviso', h('span', { class: 'n-ok' }, ico('ok', 13)), subtitulo(c.t('Enviado a Karla', 'Sent to Karla')));
        });
      }
    },

    centro(i, c) {
      reposo();
      const items: [string, string, string][] = [['inicio', 'Inicio', 'Home'], ['chat', 'Chat', 'Chat'], ['pulse', 'PULSE2CHAT', 'PULSE2CHAT'], ['musica', 'Música', 'Music'], ['cartera', 'Cartera', 'Wallet'], ['ajustes', 'Ajustes', 'Settings']];
      const lado = h('div', { class: 'r-mini-lado' }, h('i', { class: 'r-mini-marca' }), ...items.map(([ic], n) => h('span', { class: 'r-mini-nav' + (i === 2 && n === 4 ? ' activo' : ''), 'data-n': String(n) }, ico(ic, 13))));
      const contenido = h('div', { class: 'r-mini-contenido' });
      ventanas.append(h('div', { class: 'r-mini-centro' + (i === 0 ? ' abre' : '') }, lado, contenido));
      const inicio = () => contenido.replaceChildren(
        h('strong', { class: 'r-mini-titulo' }, c.t('Buenas tardes.', 'Good afternoon.')),
        h('div', { class: 'r-mini-rejilla' }, h('i'), h('i'), h('i')),
        h('div', { class: 'r-mini-rejilla dos' }, h('i'), h('i')));
      if (i === 0) { inicio(); ponDice(c.t('Ctrl + Alt + C', 'Ctrl + Alt + C'), c, false); }
      if (i === 1) {
        inicio();
        items.forEach(([, es, en], n) => c.despues(300 + n * 600, () => {
          lado.querySelectorAll('.r-mini-nav').forEach((x) => x.classList.toggle('activo', x.getAttribute('data-n') === String(n)));
          contenido.replaceChildren(h('strong', { class: 'r-mini-titulo entra' }, c.t(es, en)), h('div', { class: 'r-mini-rejilla' }, h('i'), h('i'), h('i')));
        }));
      }
      if (i === 2) {
        const cifra = h('span', { class: 'r-mini-cifra' }, '0');
        contenido.replaceChildren(
          h('strong', { class: 'r-mini-titulo' }, c.t('Cartera', 'Wallet'), h('span', { class: 'r-ejemplo' }, c.t('EJEMPLO', 'EXAMPLE'))),
          h('div', { class: 'r-mini-saldo' }, cifra, h('small', null, 'ORIGEN')),
          h('small', { class: 'r-mini-nota' }, ico('candado', 11), c.t('Solo lectura · enviar se firma en Veta Wallet', 'Read-only · sending is signed in Veta Wallet')));
        ponDice(c.t('¿Cuánto ORIGEN tengo?', 'How much ORIGEN do I have?'), c);
        const meta = 3200.5;
        if (c.reducido) cifra.textContent = meta.toLocaleString(c.t('es', 'en'), { minimumFractionDigits: 1 });
        else {
          const t0 = performance.now() + 900;
          const paso = () => {
            const x = Math.min(1, Math.max(0, (performance.now() - t0) / 1400));
            cifra.textContent = (meta * (1 - (1 - x) ** 3)).toLocaleString(c.t('es', 'en'), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
            if (x < 1) c.despues(30, paso);
          };
          paso();
        }
      }
    },

    privacidad(i, c) {
      reposo();
      if (i === 0) {
        notch.classList.add('resalta');
        c.despues(1300, () => {
          notch.classList.add('silenciado');
          ponNotch('aviso', h('span', { class: 'n-mic-no' }, ico('micNo', 14)), h('span', { class: 'n-pregunta' }, h('strong', null, c.t('Micrófono silenciado', 'Microphone muted')), h('small', null, c.t('No te oigo hasta que lo vuelvas a tocar', 'I won’t hear you until you click again'))));
        });
      }
      if (i === 1) {
        capa.append(h('div', { class: 'r-teclas' }, ...['Ctrl', 'Alt', 'Esc'].map((k, n) => h('span', { class: 'r-tecla apretar', style: `animation-delay:${0.2 + n * 0.15}s` }, k))));
        c.despues(1300, () => { notch.classList.add('pausado'); ponNotch('aviso', h('span', { class: 'n-pausa' }), subtitulo(c.t('En pausa', 'Paused'))); });
      }
      if (i === 2) {
        notch.classList.remove('silenciado', 'pausado');
        const cosas: [string, string][] = [[c.t('Tu sesión', 'Your session'), 'persona'], ['Spotify', 'musica'], ['Google', 'globo'], ['Outlook', 'sobre']];
        capa.append(h('div', { class: 'r-boveda' },
          h('div', { class: 'r-boveda-escudo' }, ico('escudo', 46)),
          h('strong', null, c.t('Cifrado en tu PC', 'Encrypted on your PC')),
          h('div', { class: 'r-boveda-lista' }, ...cosas.map(([t, ic], n) => h('span', { style: `animation-delay:${0.4 + n * 0.3}s` }, ico(ic, 12), t, ico('candado', 11))))));
      }
    },

    final(i) {
      reposo();
      notch.classList.add('resalta');
      if (i === 0) capa.append(h('div', { class: 'r-confeti' }, ...Array.from({ length: 26 }, (_, k) => h('i', { style: `left:${(k * 37) % 100}%;animation-delay:${((k * 0.13) % 1.6).toFixed(2)}s;background:${['#f4ad72', '#45c9de', '#d6b56c', '#8ef0a0', '#ff8fb1'][k % 5]}` }))));
    },
  };

  return {
    el,
    lugar,
    notch,
    pintar(escena, i, c) {
      limpiar();
      el.dataset.escena = escena;
      el.dataset.paso = String(i);
      ESCENAS[escena](i, c);
    },
    objetivo: () => objetivo,
  };
}
