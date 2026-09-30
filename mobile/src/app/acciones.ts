/**
 * LO QUE AURA LE PIDE A LA CARCASA, por el bus del contrato (`escuchar('accion')`):
 *
 *   atras       → vuelve a la pantalla anterior (en la mesa no hay más atrás: se dice que no)
 *   abrir       → mesa, ajustes, perfil o la lista de chats
 *   tema        → lo guarda en el perfil (se aplica al instante en toda la app)
 *   avatar      → lo guarda en el perfil y cambia la voz (`setAvatarVoz`)
 *   abrir_chat  → la conversación con esa persona (por correo o por nombre, con `resolverContacto`)
 *   idioma      → lo guarda en el perfil (la app y la voz cambian de idioma)
 *   perfil      → un dato de «lo que sabe de mí» (apodo, cumple o un campo de la encuesta)
 *   recordatorio→ un aviso local (o una llamada de AURA) a esa hora (compa/recordatorios.ts; el
 *                 servidor ya pidió el «sí»); cancelar_recordatorio lo quita
 *   presencia   → cómo se presenta AURA (chiquita caminando, al lado de los chats, a pantalla
 *                 completa): se guarda en el perfil y la ven la compañera, el panel y la pantalla completa
 *
 * Las demás acciones (redactar, enviar, descartar, silencio, llamar, leer, buscar) son del chat y de
 * la compañera: aquí no se tocan. Cada acción atendida se contesta con `emitir('hecho', …)` para que
 * AURA diga «listo» o «no pude».
 */
import { useEffect } from 'react';
import { setAvatarVoz } from '../lib/tts';
import { cumpleValido, guardarPerfil } from '../lib/perfil';
import { emitir, escuchar, type AccionApp, type Perfil } from '../nucleo/contrato';
import { cancelarRecordatorio, programarRecordatorio } from '../compa/recordatorios';
// Carga también los manejadores de la llamada de AURA (tienen que existir desde el arranque).
import { depsRecordatorios } from '../compa/recordatoriosNativo';
import { tr } from '../i18n';
import { resolverContacto } from '../pulse/relevo';
import { fijarPresencia } from '../avatar3d/usePresencia';
import { abrirConversacion, abrirRuta, atras, rutaActual } from './rutas';
import { usuarioActual } from './sesion';

/* ── el oyente del bus ────────────────────────────────────────────────────────────────────── */

function hecho(accion: AccionApp, ok: boolean, detalle?: string) {
  emitir('hecho', { accion, ok, detalle });
}

/** Un dato del perfil dicho por voz, como cambio del perfil. null si no vale (un cumple que no existe). */
export function cambioDePerfil(campo: string, valor: string): Partial<Perfil> | null {
  if (campo === 'apodo') return valor.trim() ? { apodo: valor } : null;
  if (campo === 'cumple') {
    const c = cumpleValido(valor);
    return c ? { cumple: c } : null;
  }
  if (['vive', 'comida', 'musica', 'familia', 'trabajo', 'gustos', 'otros'].includes(campo)) return valor.trim() ? { encuesta: { [campo]: valor } } : null;
  return null;
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
    case 'idioma':
      guardarPerfil({ idioma: a.valor });
      return hecho(a, true);
    case 'perfil': {
      const cambio = cambioDePerfil(a.campo, a.valor);
      if (!cambio) return hecho(a, false, tr('Ese dato no me quedó claro; dímelo otra vez.', "I didn't get that right; tell me again."));
      if (!conSesion) return hecho(a, false, 'sin sesión');
      const p = guardarPerfil(cambio);
      return hecho(a, !!p, p ? undefined : tr('Todavía no tengo tu perfil a mano; inténtalo en un momento.', "I don't have your profile yet; try again in a moment."));
    }
    case 'recordatorio':
      void programarRecordatorio(a, depsRecordatorios).then((r) => hecho(a, r.ok, r.detalle));
      return;
    case 'cancelar_recordatorio':
      void cancelarRecordatorio(a.id, depsRecordatorios).then((r) => hecho(a, r.ok, r.detalle));
      return;
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
