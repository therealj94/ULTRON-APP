/**
 * LO QUE AURA LE PIDE A LA CARCASA, por el bus del contrato (`escuchar('accion')`):
 *
 *   atras       → vuelve a la pantalla anterior (en la mesa no hay más atrás: se dice que no)
 *   abrir       → mesa, ajustes o perfil; «chats» abre el chat de la mesa (hoy `usePulse().abrir()`)
 *   tema        → lo guarda en el perfil (se aplica al instante en toda la app)
 *   avatar      → lo guarda en el perfil y cambia la voz (`setAvatarVoz`)
 *   abrir_chat  → la conversación con esa persona (hoy `usePulse().abrir(con)`)
 *
 * Las demás acciones (redactar, enviar, descartar, silencio) son del chat y de la compañera: aquí
 * no se tocan. Cada acción atendida se contesta con `emitir('hecho', …)` para que AURA diga «listo»
 * o «no pude».
 *
 * EL CHAT, POR AHORA: el chat vive dentro de la mesa (PulseProvider). La carcasa no puede llamar a
 * `usePulse()` desde fuera, así que deja el pedido aquí (`pedirChat`) y lo recoge el puente que va
 * montado dentro del PulseProvider de la mesa (`usePedidoChat`). Cuando el frente del chat lo haga
 * pantallas propias, el integrador cambia este pedido por `abrirRuta('Chats')`/`('Chat', {con})`.
 */
import { useEffect } from 'react';
import { setAvatarVoz } from '../lib/tts';
import { guardarPerfil } from '../lib/perfil';
import { emitir, escuchar, type AccionApp } from '../nucleo/contrato';
import { abrirRuta, atras, rutaActual } from './rutas';
import { usuarioActual } from './sesion';

/* ── el pedido de chat (la carcasa lo deja, la mesa lo recoge) ────────────────────────────── */

type PedidoChat = { con?: string; n: number };
let pedido: PedidoChat | null = null;
let contador = 0;
const oyentesChat = new Set<(p: PedidoChat) => void>();

export function pedirChat(con?: string) {
  pedido = { con, n: ++contador };
  for (const f of [...oyentesChat]) f(pedido);
}

/** Lo usa el puente de la mesa: `abrir` es `usePulse().abrir`. Atiende también el pedido que llegó antes de montarse. */
export function usePedidoChat(abrir: (con?: string) => void) {
  useEffect(() => {
    const atender = (p: PedidoChat) => {
      if (pedido?.n !== p.n) return;
      pedido = null;
      abrir(p.con);
    };
    if (pedido) atender(pedido);
    oyentesChat.add(atender);
    return () => {
      oyentesChat.delete(atender);
    };
  }, [abrir]);
}

/* ── el oyente del bus ────────────────────────────────────────────────────────────────────── */

function hecho(accion: AccionApp, ok: boolean, detalle?: string) {
  emitir('hecho', { accion, ok, detalle });
}

export function atenderAccion(a: AccionApp) {
  const conSesion = !!usuarioActual();
  switch (a.tipo) {
    case 'atras': {
      const r = rutaActual();
      // En la mesa (la base de la sesión) no hay a dónde volver; en la primera vez se usa su propio atrás.
      if (r === 'Mesa' || r === 'Intro') return hecho(a, false, 'ya está en la mesa');
      return hecho(a, atras());
    }
    case 'abrir': {
      if (!conSesion) return hecho(a, false, 'sin sesión');
      if (a.pantalla === 'chats') {
        abrirRuta('Mesa');
        pedirChat();
        return hecho(a, true);
      }
      abrirRuta(a.pantalla === 'mesa' ? 'Mesa' : a.pantalla === 'ajustes' ? 'Ajustes' : 'Perfil');
      return hecho(a, true);
    }
    case 'tema':
      guardarPerfil({ tema: a.valor });
      return hecho(a, true);
    case 'avatar':
      setAvatarVoz(a.valor);
      guardarPerfil({ avatar: a.valor });
      return hecho(a, true);
    case 'abrir_chat':
      if (!conSesion) return hecho(a, false, 'sin sesión');
      abrirRuta('Mesa');
      pedirChat(a.con);
      return hecho(a, true);
    default:
      return;
  }
}

/** Se monta una vez en la raíz. */
export function useAccionesDeAura() {
  useEffect(() => escuchar('accion', atenderAccion), []);
}
