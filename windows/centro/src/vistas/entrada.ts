/**
 * La entrada al Centro: el golpe (la misma intro que el splash del notch: el punzón llega, se golpea, el
 * canto gira y se escribe «AU·RA FP»), «Entrar con Genesis ID» (Veta Wallet), clave para la junta, y la
 * guía de la primera vez (avatar, cómo te escucha, dónde vive). Al terminar, el Centro se encoge hacia el notch.
 */
import { h, boton, avisar, esperar, eleccion, vacio } from '../ui';
import { pedir, enAura } from '../puente';
import { estado, cargar, aplicarAcento, NOMBRES, T } from '../estado';
import { avatar3d } from '../avatar3d';
import { punzon, wordmark, firma } from '../marca';

/** Una conexión de PULSE2CHAT con el mismo pase (la pone el módulo de PULSE cuando carga). */
export const alEntrarConPase: { fn: null | ((pase: string, verificador: string, nombre: string, correo: string) => Promise<unknown>) } = { fn: null };

const reducido = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * El golpe (DIRECCION.md, «La pantalla de arranque»): ≈ 2,2 s; `corta` ≈ 0,9 s (llega, golpe y se recoge).
 * Clic, Esc o cualquier tecla lo salta. Con «menos movimiento»: la marca fija 600 ms y un fundido.
 * Los tiempos de cada paso viven en estilos.css (`.corre …`); aquí solo se espera y se recoge.
 */
async function golpe(fondo: HTMLElement, corta: boolean) {
  const escena = h('div', { class: 'golpe-escena' + (corta ? ' corta' : ''), role: 'img', 'aria-label': 'AU·RA FP · POWERED BY ORDEN GLOBAL' },
    h('div', { class: 'golpe-marca' }, punzon(240, { escena: true })),
    h('div', { class: 'golpe-nombre' }, wordmark({ letras: true })),
    h('i', { class: 'golpe-filo', 'aria-hidden': 'true' }),
    firma());
  const pista = h('p', { class: 'golpe-saltar', 'aria-hidden': 'true' }, T('CLIC O ESC PARA SALTAR', 'CLICK OR ESC TO SKIP'));
  fondo.append(escena, corta ? '' : pista);
  void escena.offsetWidth;
  escena.classList.add('corre');
  const sinMovimiento = reducido();
  let saltar: () => void = () => {};
  const salto = new Promise<void>((r) => (saltar = r));
  const alTecla = () => saltar();
  addEventListener('keydown', alTecla);
  fondo.addEventListener('pointerdown', alTecla);
  await Promise.race([esperar(sinMovimiento ? 600 : corta ? 640 : 1960), salto]);
  removeEventListener('keydown', alTecla);
  fondo.removeEventListener('pointerdown', alTecla);
  escena.classList.add('saltado');
  pista.remove();
  if (sinMovimiento) {
    escena.style.transition = 'opacity .2s'; escena.style.opacity = '0';
    await esperar(200);
  } else {
    // 7. Todo se encoge hacia arriba (donde vive el notch).
    escena.classList.add('recoge');
    await esperar(320);
  }
  escena.remove();
}

/** Resuelve 'recorrido' si al terminar la guía la persona pidió ver el recorrido. */
export async function entrada(raiz: HTMLElement): Promise<'recorrido' | 'listo'> {
  const e = estado();
  aplicarAcento(e.avatar);
  const fondo = h('div', { class: 'entrada' });
  vacio(raiz).appendChild(fondo);
  // Con sesión (solo falta la guía) va la versión corta; mientras tanto se refresca el estado, como antes.
  await Promise.all([golpe(fondo, !!e.sesion), e.sesion ? pedir('estado').catch(() => null) : null]);

  if (!estado().sesion) await pantallaEntrar(fondo);
  const fin = estado().primeraVez ? await guia(fondo) : 'listo';
  fondo.style.transition = 'opacity .32s'; fondo.style.opacity = '0';
  await esperar(320);
  fondo.remove();
  return fin;
}

async function pantallaEntrar(fondo: HTMLElement) {
  return new Promise<void>((listo) => {
    const estadoTexto = h('p', { class: 'nota', role: 'status', 'aria-live': 'polite' }, '');
    const pegar = h('div', { style: 'display:none;margin-top:10px' },
      h('small', { class: 'tenue' }, T('¿Windows no volvió a AURA solo? Copia el enlace «ultronfp://…» que muestra la wallet y pégalo aquí:', 'Didn’t Windows bring you back? Paste the “ultronfp://…” link here:')),
      h('input', { type: 'text', placeholder: 'ultronfp://sso?pase=…', 'aria-label': T('Enlace de vuelta', 'Return link'), style: 'margin-top:8px;font-family:var(--mono)',
        on: { change: async (ev: Event) => { try { await pedir('entrar.enlace', { url: (ev.target as HTMLInputElement).value }); } catch (e: any) { estadoTexto.textContent = e.message; } } } }));
    const genesis = boton(T('Entrar con Genesis ID', 'Sign in with Genesis ID'), async () => {
      genesis.disabled = true;
      estadoTexto.textContent = T('Abrí Veta Wallet en tu navegador. Autoriza a AU-RA allá y vuelve aquí.', 'I opened Veta Wallet in your browser. Authorize AU-RA there and come back.');
      setTimeout(() => (pegar.style.display = 'block'), 12_000);
      try {
        const r = await pedir<{ miembro: { nombre: string; correo: string }; pase: string; verificador: string }>('entrar.genesis', null, 330_000);
        estadoTexto.textContent = T('Listo. Preparando tus chats…', 'Done. Getting your chats ready…');
        // El mismo pase abre PULSE2CHAT (una vez). Si tarda, AURA entra igual y el chat se conecta después.
        if (alEntrarConPase.fn) await Promise.race([alEntrarConPase.fn(r.pase, r.verificador, r.miembro.nombre, r.miembro.correo).catch(() => null), esperar(12_000)]);
        await cargar();
        listo();
      } catch (e: any) {
        estadoTexto.textContent = e.message;
        genesis.disabled = false;
      }
    }, { tipo: 'acento', titulo: T('Abre Veta Wallet para autorizar a AU-RA con tu Genesis ID (AURA nunca ve tu contraseña)', 'Opens Veta Wallet to authorize AU-RA with your Genesis ID') });

    const correo = h('input', { type: 'email', placeholder: T('Correo', 'Email'), autocomplete: 'username', 'aria-label': T('Correo', 'Email') }) as HTMLInputElement;
    const clave = h('input', { type: 'password', placeholder: T('Clave', 'Password'), autocomplete: 'current-password', 'aria-label': T('Clave', 'Password') }) as HTMLInputElement;
    const conClave = h('form', { style: 'display:none', on: { submit: async (ev: Event) => {
      ev.preventDefault();
      estadoTexto.textContent = T('Entrando…', 'Signing in…');
      try { await pedir('entrar.clave', { correo: correo.value, clave: clave.value }); await cargar(); listo(); }
      catch (e: any) { estadoTexto.textContent = e.message; }
    } } },
      h('div', { class: 'campo' }, correo), h('div', { class: 'campo' }, clave),
      h('button', { class: 'btn suave', type: 'submit', style: 'width:100%' }, T('Entrar', 'Sign in')));

    const version = estado()?.version;
    const marca = h('aside', { class: 'entrar-marca' },
      h('div', null,
        punzon(96, { etiqueta: 'AU·RA' }),
        h('div', null, wordmark()),
        h('p', { class: 'lema' }, T('Tu voz, tus chats y tu cartera de Orden Global, en el notch de tu computadora.', 'Your voice, chats and Orden Global wallet, in your computer’s notch.'))),
      h('div', { class: 'entrar-meta' },
        h('dl', null,
          h('dt', null, T('Equipo', 'Device')), h('dd', null, 'Windows'),
          version ? [h('dt', null, T('Versión', 'Version')), h('dd', null, version)] : null,
          h('dt', null, T('Sesión', 'Session')), h('dd', null, T('cifrada en esta PC', 'encrypted on this PC'))),
        firma()));
    const panel = h('div', { class: 'panel-entrar' },
      h('span', { class: 'rotulo' }, T('Entrada', 'Sign in')),
      h('h2', null, T('Entra con tu Genesis ID', 'Sign in with your Genesis ID')),
      h('p', null, T('Es tu cuenta de Veta Wallet: la misma de la app y de PULSE2CHAT. Autorizas allá y vuelves aquí; AURA nunca ve tu contraseña.', 'It’s your Veta Wallet account, the same as the app and PULSE2CHAT. Authorize there and come back; AURA never sees your password.')),
      genesis,
      h('div', { class: 'separador' }, T('o', 'or')),
      boton(T('Correo y clave (junta)', 'Email and password (board)'), () => { conClave.style.display = conClave.style.display === 'none' ? 'block' : 'none'; if (conClave.style.display === 'block') correo.focus(); }, { tipo: 'suave', icono: 'candado' }),
      conClave, estadoTexto, pegar,
      h('p', { class: 'nota' }, T('Genesis ID abre también PULSE2CHAT. AURA guarda tu sesión cifrada en esta PC.', 'Genesis ID also opens PULSE2CHAT. AURA keeps your session encrypted on this PC.')));
    vacio(fondo).appendChild(h('div', { class: 'entrar' }, marca, panel));
    if (!enAura) estadoTexto.textContent = T('(Modo muestra: sin el .exe.)', '(Preview mode.)');
  });
}

/** La guía de la primera vez: 3 pasos, cada uno con su explicación. Al final, ver el recorrido o ir al notch. */
async function guia(fondo: HTMLElement): Promise<'recorrido' | 'listo'> {
  const aj = await pedir<any>('ajustes.leer');
  const pasos: (() => HTMLElement)[] = [];
  let i = 0;
  return new Promise<'recorrido' | 'listo'>((listo) => {
    const terminar = async (como: 'recorrido' | 'listo') => {
      await pedir('primeraVez.terminar');
      await cargar();
      listo(como);
    };
    const pintar = () => {
      const panel = h('div', { class: 'panel-entrar' },
        h('div', { class: 'pasos', role: 'progressbar', 'aria-valuemin': '1', 'aria-valuemax': String(pasos.length), 'aria-valuenow': String(i + 1), 'aria-label': T('Paso', 'Step') },
          ...pasos.map((_, k) => h('i', { class: k <= i ? 'hecho' : '' })),
          h('span', { class: 'paso-n' }, T(`PASO ${i + 1} / ${pasos.length}`, `STEP ${i + 1} / ${pasos.length}`))),
        pasos[i](),
        h('div', { class: 'fila', style: 'margin-top:18px;justify-content:space-between' },
          i > 0 ? boton(T('Atrás', 'Back'), () => { i--; pintar(); }, { tipo: 'fantasma' }) : h('span'),
          h('div', { class: 'fila' },
            i === pasos.length - 1 ? boton(T('Listo, al notch', 'Done, to the notch'), () => void terminar('listo'), { tipo: 'fantasma' }) : null,
            boton(i === pasos.length - 1 ? T('Ver el recorrido', 'Watch the tour') : T('Siguiente', 'Next'), async () => {
              if (i < pasos.length - 1) { i++; pintar(); return; }
              await terminar('recorrido');
            }, { tipo: 'acento', icono: i === pasos.length - 1 ? 'play' : undefined, titulo: i === pasos.length - 1 ? T('Claudio y ANT-ONIO te enseñan todo lo que hace AURA en tu computadora (unos 5 minutos)', 'Claudio and ANT-ONIO show you everything AURA does on your PC (about 5 minutes)') : undefined }))));
      vacio(fondo).appendChild(h('div', { class: 'guia' }, panel));
    };
    pasos.push(() => {
      // AU-RA es su orbe de partículas; sus efectos de sonido, según Ajustes (encendidos de fábrica).
      const av = avatar3d(aj.avatar, 'avatar3d grande', { sonidos: aj.efectosDeSonido !== false });
      const caja = h('div', { class: 'guia-avatar' }, av.el);
      return h('div', null, h('h2', null, T('Elige quién te acompaña', 'Pick your companion')), caja,
        eleccion(T('Avatar', 'Avatar'), [
          { valor: 'aura', texto: 'AU-RA', explica: T('Cálida y precisa; la voz de siempre de AU-RA.', 'Warm and precise.') },
          { valor: 'claudio', texto: 'Claudio', explica: T('Creativo, para ideas, marketing y contenido.', 'Creative: ideas and content.') },
          { valor: 'antonio', texto: 'ANT-ONIO', explica: T('Directo y técnico.', 'Direct and technical.') },
          { valor: 'ojos', texto: 'Guardián', explica: T('Sereno; cuida tu espacio y tu seguridad.', 'Calm; watches over your space.') },
        ], aj.avatar, async (v) => { aj.avatar = v; av.cambiar(v); aplicarAcento(v); await pedir('ajustes.guardar', { avatar: v }); }));
    });
    pasos.push(() => h('div', null, h('h2', null, T('¿Cómo quieres que te escuche?', 'How should I listen?')),
      h('p', null, T('Puedes cambiarlo cuando quieras. En el notch siempre hay un botón para silenciar el micrófono.', 'Change it anytime. The notch always has a mute button.')),
      eleccion(T('Escucha', 'Listening'), [
        { valor: 'palabra', texto: T('«Oye AURA»', '“Hey AURA”'), explica: T('Recomendado. La PC espera tu voz diciendo «Oye AURA» (se reconoce en el equipo, sin enviar audio).', 'Recommended. Your PC waits for “Hey AURA” (recognized locally).') },
        { valor: 'siempre', texto: T('Siempre atenta', 'Always attentive'), explica: T('El micrófono queda abierto y AURA atiende cuando la nombras o mientras conversan. Envía al servidor lo que se habla para entenderlo.', 'Mic stays open; AURA answers when you name her or during a conversation.') },
        { valor: 'pedir', texto: T('Solo si lo pido', 'Only when I ask'), explica: T('Con Ctrl+Alt+Espacio o tocando el micrófono del notch.', 'With Ctrl+Alt+Space or the notch mic.') },
      ], aj.escucha, (v) => pedir('ajustes.guardar', { escucha: v }))));
    pasos.push(() => h('div', null, h('h2', null, T('Así vivo en tu computadora', 'This is how I live on your PC')),
      h('ul', { class: 'guia-lista' },
        h('li', null, h('b', null, T('El notch', 'The notch')), T('Arriba al centro: te aviso de mensajes, llamadas, música y tus apps.', 'Top center: messages, calls, music and your apps.')),
        h('li', null, h('b', null, T('Atajos', 'Shortcuts')), h('span', null, h('kbd', null, 'Ctrl+Alt+Espacio'), T(' para hablarme · ', ' to talk · '), h('kbd', null, 'Ctrl+Alt+C'), T(' abre este Centro.', ' opens this Center.'))),
        h('li', null, h('b', null, T('Pídeme', 'Ask me')), T('«abre Excel», «escribe hola», «¿cuánto ORIGEN tengo?», «pon Bad Bunny en Spotify», «llama a Karla».', '“open Excel”, “type hello”, “how much ORIGEN do I have?”.')),
        h('li', null, h('b', null, T('Conexiones', 'Connections')), T('En Ajustes conectas Spotify, Google y Outlook.', 'Connect Spotify, Google and Outlook in Settings.'))),
      h('p', { class: 'nota' }, T(`Todo listo, ${estado().sesion?.nombre?.split(' ')[0] ?? ''}. ${NOMBRES[aj.avatar] ?? 'AURA'} te espera arriba.`, 'All set.'))));
    pintar();
  });
}

export function _probarAvisos() { avisar('ok', 'ok'); }
