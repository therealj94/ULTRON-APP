/**
 * EL PEGAMENTO DE LOS AVISOS DEL SERVIDOR CON EL TELÉFONO (Firebase Cloud Messaging + notifee).
 * Qué significa cada aviso y cómo se ve: push/logica.ts. El manejador de fondo: push/fondo.ts.
 *
 *  · Solo AU-RA y solo Android: Dr Electrum no lleva Firebase (ni google-services.json ni su plugin;
 *    app.config.js) y aquí ni se toca el módulo. Un APK viejo sin el nativo de Firebase: nada pasa.
 *  · Al entrar (AppAura → `usePush`): permiso de avisos si falta (Android 13+), el token de FCM y
 *    POST /api/push/registrar {token, aparato, plataforma:'android', app:'aura'}; otra vez si FCM
 *    renueva el token. Se guarda en el teléfono el SEUDÓNIMO de quien entró (no el correo): con la app
 *    cerrada no hay sesión cargada, y el aviso solo se enseña si su `para` es el de esa persona.
 *  · Al salir: se olvida el seudónimo (ningún aviso más se enseña), se pide al servidor quitar el
 *    teléfono (con el token de sesión que había; si ya se revocó, no importa) y se BORRA el token en
 *    FCM: el servidor recibe UNREGISTERED en el próximo aviso y lo limpia solo.
 *  · Lo que se toca de un aviso (abrir, «Sí») queda pendiente hasta que la app está dentro de la
 *    sesión (la intro tarda); «Luego» se contesta al servidor sin abrir nada. Cada cosa una sola vez.
 *  · La llamada no pasa por los toques de aquí: sus datos son los de la llamada de un recordatorio y la
 *    atiende compa/recordatoriosNativo.ts (Contestar abre la llamada con AURA y le pasa el motivo).
 * Nada de aquí lanza: un fallo en la tarea de fondo no puede tumbar la app.
 */
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ES_ELECTRUM } from '../variante';
import { API_BASE } from '../config';
import { api, turno, nuevoIdTurno } from '../lib/api';
import { idAparato } from '../lib/aparato';
import { correoCuenta, generacionCuenta, seudonimoDe, sigueVigente } from '../lib/cuenta';
import { loadMesaToken } from '../lib/storage';
import { miga } from '../lib/reporte';
import { tr } from '../i18n';
import { emitir } from '../nucleo/contrato';
import { accionesDelTurno } from '../compa/acciones';
import { notifeeReal } from '../compa/recordatoriosNativo';
import { sumarManejadorDeFondo } from '../pulse/servicioLlamada';
import { iniciarAvisosRelevo } from '../pulse/avisosRelevo';
import { abrirRuta, rutaActual, RUTAS_DE_SESION } from '../app/rutas';
import { abrirHoja, hayAnfitrion } from '../app/hojas';
import { usuarioActual } from '../app/sesion';
import {
  anotarVisto,
  claveVisto,
  interpretarAperturaPush,
  interpretarToque,
  leerDatos,
  planear,
  textoAlAbrir,
  yaVisto,
  type AccionPush,
  type ConstantesPush,
  type DatosPush,
  type EventoAviso,
  type Vistos,
} from './logica';

const CLAVE_DUENO = 'aura.push.dueno.v1';
const CLAVE_VISTOS = 'aura.push.vistos.v1';
const CLAVE_PENDIENTES = 'aura.push.pendientes.v1';
/** Un toque que espera más que esto (la app no llegó a la sesión) ya no se hace. */
const VIDA_PENDIENTE_MS = 10 * 60_000;

/* ── Firebase (solo AU-RA, solo Android) ─────────────────────────────────────────────────── */

type Mensajeria = typeof import('@react-native-firebase/messaging');
let modulo: Mensajeria | null | undefined;

/** El módulo de Firebase Messaging y su instancia, o null (Dr Electrum, otra plataforma, APK sin el nativo). */
export function mensajeria(): { m: Mensajeria; msg: ReturnType<Mensajeria['getMessaging']> } | null {
  if (modulo === undefined) {
    if (ES_ELECTRUM || Platform.OS !== 'android') modulo = null;
    else {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        modulo = require('@react-native-firebase/messaging') as Mensajeria;
      } catch {
        modulo = null;
      }
    }
  }
  if (!modulo) return null;
  try {
    return { m: modulo, msg: modulo.getMessaging() };
  } catch {
    return null;
  }
}

/** notifee con sus constantes (las de los recordatorios más el estilo de texto largo). */
function avisos(): { m: NonNullable<ReturnType<typeof notifeeReal>>['m']; k: ConstantesPush } | null {
  const n = notifeeReal();
  if (!n) return null;
  let estilo: ConstantesPush['AndroidStyle'];
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    estilo = require('@notifee/react-native').AndroidStyle;
  } catch {
    estilo = undefined;
  }
  return { m: n.m, k: { ...n.k, AndroidStyle: estilo } };
}

/* ── lo guardado en el teléfono ──────────────────────────────────────────────────────────── */

async function leerJson<T>(clave: string, vacio: T): Promise<T> {
  try {
    const s = await AsyncStorage.getItem(clave);
    return s ? (JSON.parse(s) as T) : vacio;
  } catch {
    return vacio;
  }
}
const guardarJson = (clave: string, v: unknown) => AsyncStorage.setItem(clave, JSON.stringify(v)).catch(() => undefined);

async function leerDueno(): Promise<string> {
  try {
    return (await AsyncStorage.getItem(CLAVE_DUENO)) || '';
  } catch {
    return '';
  }
}

/* ── llega un aviso (con la app delante, detrás o cerrada) ───────────────────────────────── */

const enMemoria = new Set<string>();

/** Enseña el aviso que mandó el servidor (los `data` de FCM). Nunca lanza. */
export async function atenderMensaje(data: unknown): Promise<void> {
  try {
    const p = leerDatos(data);
    if (!p) return;
    const n = avisos();
    if (!n) return;
    const clave = claveVisto(p);
    // Antes de cualquier await: dos entregas casi a la vez no lo enseñan dos veces.
    if (enMemoria.has(clave)) return;
    enMemoria.add(clave);
    if (enMemoria.size > 200) enMemoria.delete(enMemoria.values().next().value as string);
    const ahora = Date.now();
    const [dueno, vistos] = await Promise.all([leerDueno(), leerJson<Vistos>(CLAVE_VISTOS, {})]);
    const plan = planear(p, { dueno, ahora, k: n.k, visto: yaVisto(vistos, clave, ahora) });
    if (plan.que !== 'mostrar') {
      if (plan.porque !== 'repetido') miga(`aviso push ignorado (${p.tipo}: ${plan.porque})`);
      return;
    }
    await guardarJson(CLAVE_VISTOS, anotarVisto(vistos, clave, ahora));
    for (const c of plan.canales) await n.m.createChannel(c).catch(() => undefined);
    await n.m.displayNotification?.(plan.aviso);
    if (plan.despues) {
      await n.m
        .createTriggerNotification(plan.despues.aviso, { type: n.k.TriggerType.TIMESTAMP, timestamp: plan.despues.cuando, alarmManager: { type: n.k.AlarmType.SET_AND_ALLOW_WHILE_IDLE } })
        .catch(() => undefined);
    }
  } catch {
    /* nunca tumba la tarea de fondo */
  }
}

/* ── lo que se toca ──────────────────────────────────────────────────────────────────────── */

type Pendiente = { accion: AccionPush; datos: DatosPush; en: number };
const tocados = new Map<string, number>();

async function responderPropuesta(id: string, respuesta: 'si' | 'luego'): Promise<{ ok: boolean; pedido?: string; yaNo?: boolean }> {
  try {
    const r = await api<{ ok?: boolean; pedido?: string }>('/api/iniciativa/responder', { method: 'POST', body: JSON.stringify({ id, respuesta }) }, 15_000);
    return { ok: !!r?.ok, pedido: r?.pedido };
  } catch (e: any) {
    return { ok: false, yaNo: e?.status === 404 };
  }
}

/** Un toque en uno de estos avisos (con la app en cualquier estado): true si era de ellos. */
export async function atenderToque(e: EventoAviso): Promise<boolean> {
  try {
    const n = avisos();
    const t = n ? interpretarToque(e, n.k) : null;
    if (!t) return false;
    await manejarToque(t);
    return true;
  } catch {
    return false;
  }
}

async function manejarToque(t: { accion: AccionPush; datos: DatosPush; idAviso: string }) {
  try {
    const ahora = Date.now();
    const clave = `${t.accion}:${claveVisto(t.datos)}`;
    for (const [c, en] of tocados) if (ahora - en > VIDA_PENDIENTE_MS) tocados.delete(c);
    // El mismo toque llega dos veces (el evento de fondo y lo que abrió la app): una sola.
    if (tocados.has(clave)) return;
    tocados.set(clave, ahora);
    await avisos()?.m.cancelNotification?.(t.idAviso).catch(() => undefined);
    // De otra persona (o ya no hay nadie registrado): se quita y nada más.
    if (t.datos.para !== (await leerDueno())) return;
    if (t.accion === 'luego') {
      if (t.datos.tipo === 'propuesta') await responderPropuesta(t.datos.id, 'luego');
      return;
    }
    const lista = await leerJson<Pendiente[]>(CLAVE_PENDIENTES, []);
    if (!lista.some((x) => x.accion === t.accion && claveVisto(x.datos) === claveVisto(t.datos))) lista.push({ accion: t.accion, datos: t.datos, en: ahora });
    await guardarJson(CLAVE_PENDIENTES, lista.slice(-10));
    procesarPronto();
  } catch {
    /* un toque roto no tumba nada */
  }
}

/** Abre lo que pide el aviso y AURA dice lo que tenga que decir. */
async function hacer(x: Pendiente, correo: string) {
  const d = x.datos;
  const decir = (texto: string | null) => {
    if (texto) emitir('lectura', { texto });
  };
  if (x.accion === 'si' && d.tipo === 'propuesta') {
    abrirRuta('Mesa');
    const r = await responderPropuesta(d.id, 'si');
    if (!r.ok) {
      decir(r.yaNo ? tr('Esa propuesta ya no estaba pendiente.', 'That suggestion was no longer pending.') : tr('No pude avisar que sí. Dímelo otra vez en un momento.', "I couldn't send your yes. Tell me again in a moment."));
      return;
    }
    const pedido = String(r.pedido || d.pedido || '').trim();
    if (!pedido) return decir(tr('¡Va!', 'Okay!'));
    miga('aviso push: «sí» a una propuesta → turno');
    const u = usuarioActual();
    const out = await turno({ message: pedido, mode: 'GUARDIAN', userName: u?.name || '', correo, historial: [], idTurno: `push-si-${d.id}-${nuevoIdTurno()}`.slice(0, 80) });
    for (const a of accionesDelTurno(out)) emitir('accion', a);
    decir(out.reply || (out.error ? tr('No pude terminar eso ahora.', "I couldn't finish that right now.") : null));
    return;
  }
  if (d.tipo === 'computadora' || (d.tipo === 'mensaje' && (d.abrir === 'computadora' || d.abrir === 'correos'))) {
    // La hoja la dibuja ComputadoraEnVivo, que se monta con la sesión: se espera un momento a que esté.
    for (let i = 0; i < 20 && !hayAnfitrion(); i++) await new Promise((r) => setTimeout(r, 250));
    if (d.tipo === 'computadora') abrirHoja('computadora', { tareaId: d.id });
    else abrirHoja(d.abrir as 'computadora' | 'correos');
    if (d.tipo === 'mensaje') decir(textoAlAbrir(d));
    return;
  }
  if (d.tipo === 'mensaje' && d.abrir === 'chats') {
    // Un mensaje del chat: se abren los chats y ahí se lee. AURA no anuncia «tienes un mensaje».
    abrirRuta('Chats');
    return;
  }
  if (d.tipo === 'mensaje' && d.abrir === 'ajustes') abrirRuta('Ajustes');
  else abrirRuta('Mesa');
  decir(textoAlAbrir(d));
}

let procesando = false;
let reloj: ReturnType<typeof setInterval> | null = null;

/** Hace lo pendiente si la app ya está dentro de la sesión; si no, devuelve false. */
async function procesar(): Promise<boolean> {
  const u = usuarioActual();
  const r = rutaActual();
  if (!u || !r || !RUTAS_DE_SESION.includes(r)) return false;
  if (procesando) return true;
  procesando = true;
  try {
    const lista = await leerJson<Pendiente[]>(CLAVE_PENDIENTES, []);
    if (!lista.length) return true;
    await AsyncStorage.removeItem(CLAVE_PENDIENTES).catch(() => undefined);
    const yo = seudonimoDe(u.correo);
    for (const x of lista) {
      if (Date.now() - x.en > VIDA_PENDIENTE_MS || x.datos?.para !== yo) continue;
      try {
        await hacer(x, u.correo);
      } catch {
        /* uno roto no deja sin hacer a los demás */
      }
    }
    return true;
  } finally {
    procesando = false;
  }
}

/** Lo pendiente, en cuanto la app esté dentro de la sesión (la intro puede tardar unos segundos). */
let pedidos = 0;
export function procesarPronto() {
  pedidos++;
  if (reloj) return;
  let vueltas = 0;
  const vuelta = () => {
    // Si alguien pidió otra vuelta mientras esta corría (un toque recién guardado), no se para.
    const visto = pedidos;
    void procesar()
      .then((hecho) => {
        if (((hecho && visto === pedidos) || ++vueltas > 60) && reloj) {
          clearInterval(reloj);
          reloj = null;
        }
      })
      .catch(() => undefined);
  };
  reloj = setInterval(vuelta, 700);
  vuelta();
}

/* ── registrar el teléfono ───────────────────────────────────────────────────────────────── */

/** El último registro (para pedir quitarlo al salir, con la sesión que lo registró). */
let registro: { correo: string; token: string; sesion: string; aparato: string } | null = null;
let permisoPedido = false;

async function pedirPermiso() {
  const n = notifeeReal();
  if (!n) return;
  try {
    const s = await n.m.getNotificationSettings?.();
    if (n.k.AuthorizationStatus.AUTHORIZED !== undefined && s?.authorizationStatus === n.k.AuthorizationStatus.AUTHORIZED) return;
    // Una vez por arranque y con la app delante: el diálogo del sistema pausa la app.
    if (permisoPedido || AppState.currentState !== 'active') return;
    permisoPedido = true;
    await n.m.requestPermission();
  } catch {
    /* sin permiso, los avisos no se ven; la app sigue */
  }
}

async function enviarRegistro(token: string, correo: string, gen: number): Promise<boolean> {
  if (!token || !sigueVigente(gen) || correoCuenta() !== correo) return false;
  try {
    const aparato = await idAparato().catch(() => '');
    await api('/api/push/registrar', { method: 'POST', body: JSON.stringify({ token, aparato, plataforma: 'android', app: 'aura' }) }, 15_000);
    if (!sigueVigente(gen)) return false;
    registro = { correo, token, sesion: await loadMesaToken().catch(() => ''), aparato };
    miga('avisos push: teléfono registrado');
    return true;
  } catch (e: any) {
    miga(`avisos push: no se registró (${String(e?.status || e?.message || 'error').slice(0, 40)})`);
    return false;
  }
}

/** Tras entrar (y en cada arranque con sesión): permiso, token de FCM y registro en el servidor. */
export async function registrarPush(correo: string): Promise<void> {
  const c = String(correo || '').trim().toLowerCase();
  if (!c || ES_ELECTRUM) return;
  const gen = generacionCuenta();
  await AsyncStorage.setItem(CLAVE_DUENO, seudonimoDe(c)).catch(() => undefined);
  const f = mensajeria();
  if (!f) return;
  await pedirPermiso();
  try {
    const token = await f.m.getToken(f.msg);
    if (!(await enviarRegistro(token, c, gen))) {
      // Sin red al entrar: una vez más en un minuto.
      setTimeout(() => void enviarRegistro(token, c, gen), 60_000);
    }
  } catch {
    /* sin Google Play Services o sin red: el próximo arranque lo intenta otra vez */
  }
}

/** Al salir de la sesión: no más avisos de esa persona en este teléfono. */
export async function salirPush(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([CLAVE_DUENO, CLAVE_PENDIENTES]).catch(() => undefined);
    const r = registro;
    registro = null;
    if (r?.sesion) {
      // Directo (no api()): un 401 no debe renovar la sesión que se está cerrando.
      void fetch(`${API_BASE}/api/push/quitar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-ultron-sesion': r.sesion, ...(r.aparato ? { 'x-aura-aparato': r.aparato } : {}) },
        body: JSON.stringify({ token: r.token }),
      }).catch(() => undefined);
    }
    const f = mensajeria();
    // El token se borra en FCM: aunque el servidor no se enterara, el próximo aviso le da UNREGISTERED.
    if (f) await f.m.deleteToken(f.msg).catch(() => undefined);
  } catch {
    /* salir nunca falla por esto */
  }
}

/**
 * En la raíz de AU-RA: registra el teléfono al entrar (y si FCM renueva el token), lo suelta al salir
 * y hace lo que quedó pendiente de un aviso tocado.
 */
export function usePush(correo: string | null | undefined) {
  const previo = useRef('');
  useEffect(() => {
    if (ES_ELECTRUM) return;
    const c = String(correo || '').trim().toLowerCase();
    const antes = previo.current;
    previo.current = c;
    if (!c) {
      if (antes) void salirPush();
      return;
    }
    void (antes && antes !== c ? salirPush() : Promise.resolve()).then(() => registrarPush(c));
    // Los avisos del chat (PULSE2CHAT) llegan por el mismo camino (pulse/avisosRelevo.ts).
    iniciarAvisosRelevo();
    const gen = generacionCuenta();
    let offToken = () => {};
    const f = mensajeria();
    if (f) {
      try {
        offToken = f.m.onTokenRefresh(f.msg, (t) => void enviarRegistro(t, c, gen));
      } catch {
        /* sin renovación: el próximo arranque registra el token nuevo */
      }
    }
    procesarPronto();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') procesarPronto();
    });
    return () => {
      offToken();
      sub.remove();
    };
  }, [correo]);
}

/* ── los manejadores (al cargar el módulo: también cuando Android despierta la app para un evento) ── */

(function registrar() {
  if (ES_ELECTRUM) return;
  const n = notifeeReal();
  if (!n) return;
  try {
    (n.m as unknown as { onForegroundEvent: (f: (e: EventoAviso) => void) => () => void }).onForegroundEvent((e) => void atenderToque(e));
  } catch {
    /* sin eventos en primer plano, el aviso igual abre la app */
  }
  sumarManejadorDeFondo(atenderToque);
  // Lo que abrió la app (un toque con la app cerrada): «Sí» o abrir.
  void n.m
    .getInitialNotification?.()
    .then((ini) => {
      const k = avisos()?.k;
      const t = k ? interpretarAperturaPush(ini, k) : null;
      if (t) void manejarToque(t);
    })
    .catch(() => undefined);
})();
