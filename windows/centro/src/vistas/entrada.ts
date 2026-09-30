/**
 * La entrada al Centro, como la app: intro animada (halo, anillo, partículas y las letras que suben),
 * «Entrar con Genesis ID» (Veta Wallet), clave para la junta, y la guía de la primera vez (avatar,
 * cómo te escucha, conexiones). Al terminar, el Centro se encoge hacia el notch.
 */
import { h, boton, avisar, esperar, eleccion, vacio } from '../ui';
import { pedir, enAura } from '../puente';
import { estado, cargar, aplicarAcento, NOMBRES, T } from '../estado';
import { avatar3d } from '../avatar3d';

/** Una conexión de PULSE2CHAT con el mismo pase (la pone el módulo de PULSE cuando carga). */
export const alEntrarConPase: { fn: null | ((pase: string, verificador: string, nombre: string, correo: string) => Promise<unknown>) } = { fn: null };

function escena(avatar: string) {
  const av = avatar3d(avatar);
  const cont = h('div', { class: 'escena' }, h('div', { class: 'halo' }), h('div', { class: 'anillo' }), h('div', { class: 'anillo dos' }), av.el);
  for (let i = 0; i < 14; i++) {
    const p = h('i', { class: 'particula', style: `left:${10 + Math.random() * 80}%;bottom:${10 + Math.random() * 30}%;animation-delay:${(Math.random() * 5).toFixed(2)}s` });
    cont.appendChild(p);
  }
  return { cont, av };
}

function marca(texto: string) {
  return h('div', { class: 'marca-texto', 'aria-label': texto },
    ...[...texto].map((c, i) => h('span', { style: `animation-delay:${0.25 + i * 0.07}s`, class: 'brillo-texto' }, c === ' ' ? ' ' : c)));
}

export async function entrada(raiz: HTMLElement): Promise<void> {
  const e = estado();
  aplicarAcento(e.avatar);
  const fondo = h('div', { class: 'entrada' });
  vacio(raiz).appendChild(fondo);
  const { cont, av } = escena(e.avatar);
  const barra = h('i');
  const intro = h('div', { style: 'text-align:center' }, cont, marca('AURA'), h('div', { class: 'progreso' }, barra));
  fondo.appendChild(intro);
  // La intro: la barra avanza con pasos reales (estado, sesión, avatar listo).
  barra.style.width = '35%';
  await esperar(500);
  if (e.sesion) { await pedir('estado').catch(() => null); }
  barra.style.width = '75%';
  av.estado('happy', 'feliz');
  await esperar(900);
  barra.style.width = '100%';
  await esperar(300);

  if (!estado().sesion) await pantallaEntrar(fondo, av);
  if (estado().primeraVez) await guia(fondo);
  fondo.style.transition = 'opacity .45s'; fondo.style.opacity = '0';
  await esperar(450);
  fondo.remove();
}

async function pantallaEntrar(fondo: HTMLElement, av: ReturnType<typeof avatar3d>) {
  return new Promise<void>((listo) => {
    const { cont } = escena(estado().avatar);
    const estadoTexto = h('p', { class: 'nota', role: 'status', 'aria-live': 'polite' }, '');
    const pegar = h('div', { style: 'display:none;margin-top:10px' },
      h('small', { class: 'tenue' }, T('¿Windows no volvió a AURA solo? Copia el enlace «ultronfp://…» que muestra la wallet y pégalo aquí:', 'Didn’t Windows bring you back? Paste the “ultronfp://…” link here:')),
      h('input', { type: 'text', placeholder: 'ultronfp://sso?pase=…', 'aria-label': T('Enlace de vuelta', 'Return link'),
        on: { change: async (ev: Event) => { try { await pedir('entrar.enlace', { url: (ev.target as HTMLInputElement).value }); } catch (e: any) { estadoTexto.textContent = e.message; } } } }));
    const genesis = boton(T('Entrar con Genesis ID', 'Sign in with Genesis ID'), async () => {
      genesis.disabled = true;
      estadoTexto.textContent = T('Abrí Veta Wallet en tu navegador. Autoriza a AU-RA allá y vuelve aquí…', 'I opened Veta Wallet in your browser. Authorize AU-RA there and come back…');
      setTimeout(() => (pegar.style.display = 'block'), 12_000);
      try {
        const r = await pedir<{ miembro: { nombre: string; correo: string }; pase: string; verificador: string }>('entrar.genesis', null, 330_000);
        estadoTexto.textContent = T('¡Listo! Preparando tus chats…', 'Done! Getting your chats ready…');
        av.gesto('saludar');
        // El mismo pase abre PULSE2CHAT (una vez). Si tarda, AURA entra igual y el chat se conecta después.
        if (alEntrarConPase.fn) await Promise.race([alEntrarConPase.fn(r.pase, r.verificador, r.miembro.nombre, r.miembro.correo).catch(() => null), esperar(12_000)]);
        await cargar();
        listo();
      } catch (e: any) {
        estadoTexto.textContent = e.message;
        genesis.disabled = false;
      }
    }, { tipo: 'acento', icono: 'persona', titulo: T('Abre Veta Wallet para autorizar a AU-RA con tu Genesis ID (AURA nunca ve tu contraseña)', 'Opens Veta Wallet to authorize AU-RA with your Genesis ID') });

    const correo = h('input', { type: 'email', placeholder: T('Correo', 'Email'), autocomplete: 'username', 'aria-label': T('Correo', 'Email') }) as HTMLInputElement;
    const clave = h('input', { type: 'password', placeholder: T('Clave', 'Password'), autocomplete: 'current-password', 'aria-label': T('Clave', 'Password') }) as HTMLInputElement;
    const conClave = h('form', { style: 'display:none;text-align:left', on: { submit: async (ev: Event) => {
      ev.preventDefault();
      estadoTexto.textContent = T('Entrando…', 'Signing in…');
      try { await pedir('entrar.clave', { correo: correo.value, clave: clave.value }); await cargar(); listo(); }
      catch (e: any) { estadoTexto.textContent = e.message; }
    } } },
      h('div', { class: 'campo' }, correo), h('div', { class: 'campo' }, clave),
      h('button', { class: 'btn suave', type: 'submit', style: 'width:100%;justify-content:center' }, T('Entrar', 'Sign in')));

    const panel = h('div', { class: 'panel-entrar' },
      h('div', { style: 'width:220px;height:220px;margin:0 auto;position:relative' }, cont),
      h('h2', null, T('Bienvenido a AURA', 'Welcome to AURA')),
      h('p', null, T('Tu compañera en la computadora: la misma de la app, con tu voz, tus chats y tu cartera.', 'Your companion on the computer: the same as the app, with your voice, chats and wallet.')),
      genesis,
      h('div', { class: 'separador' }, T('o', 'or')),
      boton(T('Entrar con correo y clave (junta)', 'Sign in with email and password'), () => { conClave.style.display = conClave.style.display === 'none' ? 'block' : 'none'; if (conClave.style.display === 'block') correo.focus(); }, { tipo: 'fantasma', icono: 'candado' }),
      conClave, estadoTexto, pegar,
      h('p', { class: 'nota', style: 'margin-top:18px' }, T('Genesis ID abre también PULSE2CHAT. AURA guarda tu sesión cifrada en esta PC.', 'Genesis ID also opens PULSE2CHAT. AURA keeps your session encrypted on this PC.')));
    vacio(fondo).appendChild(panel);
    if (!enAura) estadoTexto.textContent = T('(Modo muestra: sin el .exe.)', '(Preview mode.)');
  });
}

/** La guía de la primera vez: 3 pasos, cada uno con su explicación. */
async function guia(fondo: HTMLElement) {
  const aj = await pedir<any>('ajustes.leer');
  const pasos: (() => HTMLElement)[] = [];
  let i = 0;
  return new Promise<void>((listo) => {
    const pintar = () => {
      const panel = h('div', { class: 'panel-entrar', style: 'text-align:left' },
        h('div', { class: 'pasos' }, ...pasos.map((_, k) => h('i', { class: k <= i ? 'hecho' : '' }))),
        pasos[i](),
        h('div', { class: 'fila', style: 'margin-top:18px;justify-content:space-between' },
          i > 0 ? boton(T('Atrás', 'Back'), () => { i--; pintar(); }, { tipo: 'fantasma' }) : h('span'),
          boton(i === pasos.length - 1 ? T('Listo, al notch', 'Done, to the notch') : T('Siguiente', 'Next'), async () => {
            if (i < pasos.length - 1) { i++; pintar(); return; }
            await pedir('primeraVez.terminar');
            await cargar();
            listo();
          }, { tipo: 'acento' })));
      vacio(fondo).appendChild(panel);
    };
    pasos.push(() => {
      const av = avatar3d(aj.avatar, 'avatar3d grande');
      const caja = h('div', { style: 'height:200px;margin-bottom:8px' }, av.el);
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
      h('ul', { class: 'nota', style: 'line-height:1.9;padding-left:18px' },
        h('li', null, T('Arriba al centro, en el notch: te aviso de mensajes, llamadas, música y tus apps.', 'Top center, in the notch: messages, calls, music and your apps.')),
        h('li', null, T('Ctrl+Alt+Espacio para hablarme · Ctrl+Alt+C abre este Centro.', 'Ctrl+Alt+Space to talk · Ctrl+Alt+C opens this Center.')),
        h('li', null, T('Pídeme: «abre Excel», «escribe hola», «¿cuánto ORIGEN tengo?», «pon Bad Bunny en Spotify», «llama a Karla».', 'Ask me: “open Excel”, “type hello”, “how much ORIGEN do I have?”.')),
        h('li', null, T('En Ajustes → Conexiones conectas Spotify, Google y Outlook.', 'Connect Spotify, Google and Outlook in Settings.'))),
      h('p', { class: 'nota' }, T(`Todo listo, ${estado().sesion?.nombre?.split(' ')[0] ?? ''}. ${NOMBRES[aj.avatar] ?? 'AURA'} te espera arriba.`, 'All set.'))));
    pintar();
  });
}

export function _probarAvisos() { avisar('ok', 'ok'); }
