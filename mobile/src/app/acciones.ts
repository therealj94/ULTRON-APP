/**
 * LO QUE AURA LE PIDE A LA CARCASA, por el bus del contrato (`escuchar('accion')`):
 *
 *   atras       → vuelve a la pantalla anterior (en la mesa no hay más atrás: se dice que no)
 *   abrir       → mesa, ajustes, perfil o la lista de chats
 *   tema        → lo guarda en el perfil (se aplica al instante en toda la app)
 *   avatar      → lo guarda en el perfil y cambia la voz (`setAvatarVoz`)
 *   abrir_chat  → la conversación con esa persona (por correo o por nombre, con `resolverContacto`)
 *   presencia   → cómo se presenta AURA (chiquita caminando, al lado de los chats, a pantalla
 *                 completa): se guarda en el perfil y la ven la compañera, el panel y la pantalla completa
 *
 * Las demás acciones (redactar, enviar, descartar, silencio) son del chat y de la compañera: aquí
 * no se tocan. Cada acción atendida se contesta con `emitir('hecho', …)` para que AURA diga «listo»
 * o «no pude».
 */
import { useEffect } from 'react';
import { setAvatarVoz } from '../lib/tts';
import { guardarPerfil } from '../lib/perfil';
import { emitir, escuchar, type AccionApp } from '../nucleo/contrato';
import { resolverContacto } from '../pulse/relevo';
import { fijarPresencia } from '../avatar3d/usePresencia';
import { abrirConversacion, abrirRuta, atras, rutaActual } from './rutas';
import { usuarioActual } from './sesion';

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
        abrirRuta('Chats');
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
    case 'abrir_chat': {
      if (!conSesion) return hecho(a, false, 'sin sesión');
      const c = resolverContacto(a.con);
      const correo = c?.correo || (/^[^@\s]+@[^@\s]+$/.test(a.con.trim()) ? a.con.trim().toLowerCase() : '');
      if (!correo) return hecho(a, false, `No encuentro a «${a.con}» entre tus contactos.`);
      if (!abrirConversacion(correo, c?.nombre)) return hecho(a, false, 'No pude abrir el chat ahora.');
      return hecho(a, true);
    }
    case 'presencia':
      fijarPresencia(a.valor);
      return hecho(a, true);
    default:
      return;
  }
}

/** Se monta una vez en la raíz. */
export function useAccionesDeAura() {
  useEffect(() => escuchar('accion', atenderAccion), []);
}
