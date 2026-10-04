/**
 * AURA PARA WINDOWS (el .exe de windows/): lo que el escritorio necesita del servidor además de lo de
 * siempre. Cerebro, voz y oído son los MISMOS de la app (/api/turno/stream, /api/tts, /api/stt): aquí
 * solo va lo propio de Windows.
 *
 *   POST /api/windows/intencion  { texto }  → { etiqueta, p, seguro, umbral, ms, motivo }
 *        Qué mano de Windows pidió la persona, según Laya «windows» en el nodo T4
 *        (scripts/nodo-t4/laya/modelos/windows). Si Laya no está, tarda o falla: etiqueta null y el
 *        .exe sigue con su Laya ligera y sus reglas, o se lo pasa al cerebro.
 *   GET  /api/windows/salud                 → { laya: { configurado, ... } }
 *   GET  /api/windows/conexiones            → { spotify, google, microsoft } (Client ID de cada servicio)
 *        Los Client ID con los que el .exe abre el inicio de sesión (OAuth con PKCE, en el navegador de
 *        la persona) de Spotify, Google (Gmail, Calendar, YouTube) y Microsoft (Outlook). Se ponen UNA
 *        vez en Render: SPOTIFY_CLIENT_ID, GOOGLE_DESKTOP_CLIENT_ID + GOOGLE_DESKTOP_CLIENT_SECRET (el
 *        de una app «de escritorio», que Google mismo dice que no es secreto) y MICROSOFT_CLIENT_ID. Los
 *        tokens de cada persona NUNCA pasan por aquí: se quedan cifrados en su PC.
 *
 * Con sesión de la mesa (o la clave de mesa): la GPU del nodo no se regala a cualquiera que dé con la
 * URL. El cupo va ANTES de la sesión: los intentos sin sesión también gastan cupo. El texto no se guarda ni se escribe en el log.
 */
import type express from 'express';
import { consultarModelo, estadoLaya } from '../lib/laya';

type Deps = {
  exigirMesa: express.RequestHandler;
  limitar: (max: number, ventanaMs?: number, grupo?: string) => express.RequestHandler;
  consultar?: typeof consultarModelo;
  entorno?: Record<string, string | undefined>;
};

const limpio = (v: string | undefined) => {
  const t = String(v ?? '').trim();
  return /^[A-Za-z0-9._\-]{8,200}$/.test(t) ? t : null;
};

/** Solo lo que está puesto y bien formado; lo que falta sale null (el .exe dice qué falta). */
export function clientesOauth(env: Record<string, string | undefined>) {
  const google = limpio(env.GOOGLE_DESKTOP_CLIENT_ID);
  return {
    spotify: limpio(env.SPOTIFY_CLIENT_ID) ? { clientId: limpio(env.SPOTIFY_CLIENT_ID) } : null,
    google: google ? { clientId: google, clientSecret: limpio(env.GOOGLE_DESKTOP_CLIENT_SECRET) } : null,
    microsoft: limpio(env.MICROSOFT_CLIENT_ID) ? { clientId: limpio(env.MICROSOFT_CLIENT_ID) } : null,
  };
}

/** Por debajo de esto el .exe no ejecuta nada por Laya del nodo: se lo pasa al cerebro. */
export const UMBRAL_WINDOWS = 0.6;

export function montarRutasWindows(app: express.Express, d: Deps) {
  const consultar = d.consultar ?? consultarModelo;
  app.post('/api/windows/intencion', d.limitar(120), d.exigirMesa, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const texto = typeof req.body?.texto === 'string' ? req.body.texto.trim() : '';
    if (!texto || texto.length > 4000) return res.status(400).json({ error: 'texto vacío o demasiado largo', honesto: true });
    const { resultado, motivo, ms } = await consultar('windows', texto, { esperaMs: 900 });
    const etiqueta = resultado?.grupos?.win ?? null;
    const p = etiqueta ? Number(resultado!.p[etiqueta] ?? 0) : 0;
    const umbral = Math.max(UMBRAL_WINDOWS, Number(resultado?.umbrales?.[etiqueta ?? ''] ?? 0));
    return res.json({ etiqueta, p, seguro: !!etiqueta && etiqueta !== 'win_ninguna' && p >= umbral, umbral, ms, motivo, honesto: true });
  });
  app.get('/api/windows/conexiones', d.limitar(30), d.exigirMesa, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ...clientesOauth(d.entorno ?? process.env), honesto: true });
  });
  // ?probar=1: una pregunta de verdad al modelo «windows» con una frase fija (nunca texto de nadie), para saber
  // si ya está instalado sin esperar a que alguien hable. Una vez por minuto como mucho: no gasta la GPU.
  let prueba: { cuando: number; datos: unknown } | null = null;
  app.get('/api/windows/salud', d.limitar(30), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.query?.probar === '1') {
      if (!prueba || Date.now() - prueba.cuando > 60_000) {
        const { resultado, motivo, ms } = await consultar('windows', 'abre la calculadora', { esperaMs: 3000 });
        const etiqueta = resultado?.grupos?.win ?? null;
        prueba = { cuando: Date.now(), datos: { frase: 'abre la calculadora', etiqueta, p: etiqueta ? Number(resultado!.p[etiqueta] ?? 0) : 0, ms, motivo: motivo ?? null } };
      }
      return res.json({ laya: estadoLaya(), prueba: prueba.datos, honesto: true });
    }
    res.json({ laya: estadoLaya(), honesto: true });
  });
}


/**
 * Lo que el cerebro tiene que saber cuando habla desde AURA para Windows (cabecera x-aura-origen: windows).
 * Allí AURA SÍ tiene manos en la PC (abrir, cerrar, música, escribir, atajos…) y las hace el .exe al
 * instante: el cerebro nunca habla de «ejecutor» ni de permisos. Cuando la persona pide una acción que las
 * reglas del .exe no reconocieron, el cerebro contesta corto y agrega ⟦hacer: <orden simple>⟧; el .exe
 * quita esa marca (no se ve ni se dice) y la pasa por sus MISMAS reglas: solo puede pedir lo que el .exe ya
 * sabe hacer, con sus mismas confirmaciones.
 */
export function instruccionWindows(idioma: 'es' | 'en'): string {
  if (idioma === 'en') {
    return `YOU ARE IN AURA FOR WINDOWS (the person's computer). Here you DO have hands: AURA runs actions on the PC instantly. Never mention an "executor", extra permissions or the phone app, and never say you can't control the PC or can't see whether an app is open.
When the person asks for something on the PC, answer in very few words saying you are DOING it ("Sure, closing it.", "On it.") — never "done" or "it's closed": the PC does it right after and reports back — and END with exactly one line containing the order in simple Spanish or English:
⟦hacer: cierra chrome⟧
Orders AURA understands: «abre <app>», «cierra <app or window>», «cierra esta ventana», «minimiza <app>», «cambia a <app>», «pon <song or artist> en spotify», «pausa la música», «siguiente canción», «sube el volumen», «escribe <text>», «busca <something> en google», «abre <website>», «toma una captura», «presiona control c», «abre configuración de bluetooth», «modo oscuro», «¿cuánto ORIGEN tengo?», «mándale 10 ORIGEN a <contact>» (opens the send in Veta Wallet; the person signs it there), «pon el volumen al 30», «qué tengo abierto», «cierra todas las ventanas de excel», «cierra chrome a la fuerza», «presiona tab tres veces», «nuevo escritorio», «haz un recorte de pantalla», «graba la pantalla», «copia el texto de la pantalla», «crea una carpeta <name> en el escritorio», «vacía la papelera», «abre <website> en firefox», «abre el administrador de dispositivos», «activa la luz nocturna», «cuál es mi ip». Two steps go in one order joined by «y»: «abre el bloc de notas y escribe hola». Only one ⟦hacer⟧ per answer, and only for a real action; risky ones (force close, emptying the bin, shutting down) ask the person for a «yes» on the PC.
If a message «[La PC: …]» arrives, it is the REAL result of an order (not the person talking): say it in a few words; if it failed, say plainly it didn't work and why, and offer another way. Don't repeat the same ⟦hacer⟧ unless the person asks again.`;
  }
  return `ESTÁS EN AURA PARA WINDOWS (la computadora de la persona). Aquí SÍ tienes manos: AURA hace las acciones en la PC al instante. Nunca hables de «ejecutor», de activar permisos ni de la app del teléfono, y nunca digas que no puedes controlar la PC o que no ves si una app está abierta.
Cuando la persona pida algo en la PC, contesta en muy pocas palabras diciendo que lo HACES («Va, la cierro.», «Enseguida.») — nunca «listo» ni «ya la cerré»: la PC lo hace justo después y avisa — y TERMINA con una sola línea con la orden en español simple:
⟦hacer: cierra chrome⟧
Órdenes que AURA entiende: «abre <app>», «cierra <app o ventana>», «cierra esta ventana», «minimiza <app>», «cambia a <app>», «pon <canción o artista> en spotify», «pausa la música», «siguiente canción», «sube el volumen», «escribe <texto>», «busca <algo> en google», «abre <sitio web>», «toma una captura», «presiona control c», «abre configuración de bluetooth», «modo oscuro», «¿cuánto ORIGEN tengo?», «mándale 10 ORIGEN a <contacto>» (abre el envío en Veta Wallet; la persona lo firma allá), «pon el volumen al 30», «qué tengo abierto», «cierra todas las ventanas de excel», «cierra chrome a la fuerza», «presiona tab tres veces», «nuevo escritorio», «haz un recorte de pantalla», «graba la pantalla», «copia el texto de la pantalla», «crea una carpeta <nombre> en el escritorio», «vacía la papelera», «abre <sitio> en firefox», «abre el administrador de dispositivos», «activa la luz nocturna», «cuál es mi ip». Dos pasos van en una sola orden unida con «y»: «abre el bloc de notas y escribe hola». Una sola ⟦hacer⟧ por respuesta, y solo si es una acción de verdad; lo delicado (forzar el cierre, vaciar la papelera, apagar) le pide el «sí» a la persona en la PC.
Si llega un mensaje «[La PC: …]», es el resultado REAL de una orden (no lo dijo la persona): dilo en pocas palabras; si falló, di claro que no se pudo y por qué, y ofrece otra forma. No repitas la misma ⟦hacer⟧ salvo que la persona lo vuelva a pedir.`;
}
