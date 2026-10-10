/**
 * LO QUE AURA LE PIDE A LA CARCASA, por el bus del contrato (`escuchar('accion')`):
 *
 *   atras       → vuelve a la pantalla anterior (en la mesa no hay más atrás: se dice que no)
 *   abrir       → mesa, ajustes, perfil o la lista de chats; y desde cualquier pantalla, la vista en vivo
 *                 de su computadora, los chats con la pestaña de WhatsApp o sus correos (las hojas de
 *                 toda la app: app/hojas.ts, las dibuja app/ComputadoraEnVivo.tsx); también sus misiones,
 *                 lo que sabe de ti y tu círculo (misiones, conocer, circulo: app/HojasCerebro.tsx)
 *   tema        → lo guarda en el perfil (se aplica al instante en toda la app)
 *   avatar      → lo guarda en el perfil y cambia la voz (`setAvatarVoz`)
 *   abrir_chat  → la conversación con esa persona (por correo o por nombre, con `resolverContacto`)
 *   idioma      → lo guarda en el perfil (la app y la voz cambian de idioma)
 *   perfil      → un dato de «lo que sabe de mí» (apodo, cumple o un campo de la encuesta)
 *   recordatorio→ un aviso local (o una llamada de AURA) a esa hora (compa/recordatorios.ts; el
 *                 servidor ya pidió el «sí»); cancelar_recordatorio lo quita
 *   presencia   → cómo se presenta AURA (chiquita caminando, al lado de los chats, a pantalla
 *                 completa): se guarda en el perfil y la ven la compañera, el panel y la pantalla completa
 *   marcar      → abre el marcador del teléfono con el número (`tel:`), o el chat de WhatsApp de ese número, para que
 *                 la persona llame (compa/marcar.ts; el servidor ya preguntó «¿Le marco a … al +504…?»). No llama solo.
 *
 * Las demás acciones (redactar, enviar, descartar, silencio, llamar, leer, buscar) son del chat y de
 * la compañera: aquí no se tocan. La `iniciativa` (lo que AURA propone sola) la atiende la mesa (su tarjeta). Cada acción atendida se contesta con `emitir('hecho', …)` para que
 * AURA diga «listo» o «no pude».
 */
import { useEffect } from 'react';
import { Linking } from 'react-native';
import { setAvatarVoz } from '../lib/tts';
import { cumpleValido, guardarPerfil } from '../lib/perfil';
import { emitir, escuchar, type AccionApp, type Pantalla, type Perfil } from '../nucleo/contrato';
import { cancelarRecordatorio, programarRecordatorio } from '../compa/recordatorios';
// Carga también los manejadores de la llamada de AURA (tienen que existir desde el arranque).
import { depsRecordatorios } from '../compa/recordatoriosNativo';
import { tr } from '../i18n';
import { resolverContacto } from '../pulse/relevo';
import { fijarPresencia } from '../avatar3d/usePresencia';
import { abrirConversacion, abrirRuta, abrirWhatsapp, atras, rutaActual } from './rutas';
import { abrirHoja, hayAnfitrion } from './hojas';
import type { PantallaMas } from '../compa/computadora';
import { esPantallaCerebro, type PantallaCerebro } from '../compa/cerebro';
import { usuarioActual } from './sesion';
import { abrirMarcador } from '../compa/marcar';
import { anotarAlarmaServidor } from '../compa/recordatoriosSync';
import { ejecutarAccionTelefono } from '../telefono/ejecutor';
import { depsEjecutor, nativoTelefono } from '../telefono/nativo';

/* ── el oyente del bus ────────────────────────────────────────────────────────────────────── */

/** `tel:` por el marcador nativo (ACTION_DIAL, sin CALL_PHONE) si esta APK lo trae; lo demás, como siempre. */
async function abrirConMarcador(url: string): Promise<void> {
  const n = nativoTelefono();
  if (url.startsWith('tel:') && n?.marcar) {
    const r = await n.marcar(decodeURIComponent(url.slice(4)));
    if (!r.ok) throw new Error(r.motivo || 'sin-marcador');
    return;
  }
  await Linking.openURL(url);
}

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
      // Las de más (el contrato todavía no las nombra): su computadora, WhatsApp y sus correos.
      const mas = a.pantalla as Pantalla | PantallaMas | PantallaCerebro;
      // Lo de AURA (sus misiones, lo que sabe de ti, tu círculo): hojas de toda la app, como su computadora.
      if (esPantallaCerebro(mas)) {
        if (!hayAnfitrion()) return hecho(a, false, tr('Ábrelo desde el menú de la mesa.', 'Open it from the desk menu.'));
        abrirHoja(mas);
        return hecho(a, true);
      }
      if (mas === 'computadora' || mas === 'correos') {
        if (!hayAnfitrion()) return hecho(a, false, tr('Ábrela desde «Más» en la mesa.', 'Open it from “More” on the desk.'));
        abrirHoja(mas);
        return hecho(a, true);
      }
      if (mas === 'whatsapp') {
        abrirWhatsapp();
        return hecho(a, true);
      }
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
      void programarRecordatorio(a, depsRecordatorios).then((r) => {
        // Uno del servidor (A-3): se anota que su alarma de esta vez está aquí (el push de esa vez no se enseña).
        if (r.ok && a.rid) void anotarAlarmaServidor(a.rid, a.cuando);
        hecho(a, r.ok, r.detalle);
      });
      return;
    case 'marcar':
      // A-4: el marcador (o WhatsApp) con el número que la persona aprobó. La llamada la hace ella.
      // Con el módulo nativo (APK 5.7.1), el marcador por ACTION_DIAL con su recibo (resuelto y abierto); si no, `tel:`.
      void abrirMarcador(a, (url) => abrirConMarcador(url), tr).then((r) => hecho(a, r.ok, r.detalle));
      return;
    case 'cancelar_recordatorio':
      void cancelarRecordatorio(a.id, depsRecordatorios).then((r) => hecho(a, r.ok, r.detalle));
      return;
    case 'presencia':
      fijarPresencia(a.valor);
      return hecho(a, true);
    // Las manos en el teléfono (APK 5.7.1, telefono/ejecutor.ts): otra app, un enlace, la ruta, el reloj, el SMS, el
    // calendario. Su `hecho` es el recibo que va al servidor (telefono/useTelefono.ts).
    case 'abrir_app':
    case 'abrir_enlace':
    case 'navegar':
    case 'alarma':
    case 'temporizador':
    case 'sms':
    case 'evento_calendario':
      void ejecutarAccionTelefono(a, depsEjecutor()).then((r) => hecho(a, r.ok, r.detalle));
      return;
    default:
      return;
  }
}

/** Se monta una vez en la raíz. */
export function useAccionesDeAura() {
  useEffect(() => escuchar('accion', atenderAccion), []);
}
