import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { fetchNodo, saludNodo, nodoConfigurado, NODO_URL as ULTRON_NODO_URL, NODO_SECRETO as ULTRON_NODO_SECRETO, NODO_MODELO as ULTRON_NODO_MODELO } from './lib/nodo';
import { JUNTA, buildPersonality, decodeDataUrl, normalizarCorreo, buscarWeb, leerPagina } from './server/desk';
import { hablar, cantar, orar, repertorio, cancionPorPedido, estadoVoz, vozDe } from './server/voz';
import { emitirSesion, borrarSesion, sesionDe, tokenDe, exigirSesion, exigirMesa, exigirMesaODesk, limitar, urlPublica } from './server/seguridad';
import { leerPdf, telegramFoto, telegramVoz } from './lib/canales';
import { catalogoCanales, fotoSistema } from './lib/sistema';
import { despacharTaller, hechosCatalogo } from './lib/taller';
import { listarTareas } from './lib/tareas';
import { ejecutarCodigo, ejecutorActivo } from './lib/ejecutor';
import { construirMensajes, extraerPython } from './lib/qwen';
import { extraerPedidoHerramienta, quitarLineaPedido, resolverPedido } from './lib/harness';
import { notaDeVoz, pideNotaDeVoz } from './lib/voz';
import { iniciarCentinela } from './lib/centinela';
import { clave, fotoBoveda, guardarCaja } from './lib/boveda';
import { capturaPagina, verImagen } from './lib/vision';
import { extraerPdf, dataUrlDeImagen, bufferDeCualquier } from './lib/leer-pdf';
import { transcribirAudio } from './lib/oido';
import { esTareaDeCodigo } from './lib/prompts/cot';
import { extraerEmocion, normalizarEmocion, type Emocion } from './lib/emocion';
import { hechoCerebro } from './lib/cerebro';
import { herramientaActiva, perfilActivo } from './lib/perfiles';
import { resolverCalculoMina } from './lib/minas/calculos';
import { responderConcesion } from './lib/minas/concesiones';
import { spotMetal } from './lib/mercado';
import { turnoElectrum } from './server/electrum/turno';
import { ES_ELECTRUM, ES_ULTRON, PAGINA_RAIZ, PLATAFORMA, rutaPermitida } from './lib/plataforma';
import {
  claveHilo,
  fusionarHiloElectrum,
  hiloDe as hiloElectrumDe,
  hiloDelCliente,
  olvidarHilo,
  recordarHilo,
} from './server/electrum/hilo';
import { TODAS as TODAS_ELECTRUM } from './server/electrum/manos';
import { compartirInforme, guardarInforme, informeCartera, informeConcesion, tomarInforme } from './server/electrum/informe';
import { aprender as aprenderElectrum } from './server/electrum/aprender';
import {
  electrumBotListo,
  electrumWebhookSecretOk,
  genteDeElectrum,
  procesarElectrumTelegram,
  registrarWebhookElectrum,
} from './server/electrum/telegram';
import { identidadDe, exigirPlataforma } from './server/seguridad';
import { puedeEscribir } from './lib/acceso';
import { nivelDe } from './lib/acceso';
import { catastroGeojson, consulta as consultaElectrum, encuadreCatastro, hayBase as hayBaseElectrum, saludBase as saludElectrum } from './server/electrum/db';
import { catalogoCapacidades, MODOS, GESTOS_TACTILES, VOZ_OFICIAL } from './lib/capacidades';
import {
  cargarMemoria,
  estadoMemoria,
  fotoMemoria,
  guardarHechoQuien,
  olvidarQuien,
  promptMemoria,
  recordarTurno,
  registrarCambio,
  resolverQuien,
  quienVerificado,
  hiloDe,
  type CanalMem,
} from './lib/memoria';
import { fusionarHilo, pedidoRed, resolverReferencia, urlsParaLeer, type MsgHilo } from './lib/conversacion';
import { nombreDe, puedeCambiarSistema } from './lib/junta';
import { mensajeBienvenidaUltron } from './lib/bienvenida';
import {
  ayudaTelegram,
  hiloTelegram,
  parsearUpdateTelegram,
  recordarTelegram,
  registrarWebhookTelegram,
  telegramAutorizado,
  telegramResponder,
  telegramWebhookSecretOk,
} from './lib/telegram-in';

const app = express();
app.set('trust proxy', 1);
const httpServer = http.createServer(app);
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '12mb' }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

/*
 * UN DESPLIEGUE, UN PRODUCTO.
 *
 * Esto va ANTES que cualquier ruta, a propósito: es una lista de permitidos y lo que no está en
 * ella no llega ni a existir. En un despliegue de Dr Electrum eso deja fuera `/api/ejecutar` —el
 * ejecutor de código de ULTRON—, `/api/render/deploy`, `/api/taller` y `/api/vault/*`. Todas
 * estaban ya detrás de permisos; pero la mejor defensa de una ruta peligrosa es que no esté en ese
 * servidor, y la segunda mejor es que el día que alguien añada otra no entre sola por ser nueva.
 *
 * Contesta 404 y no 403 porque desde fuera es la verdad: en este servidor esa ruta no existe.
 */
app.use('/api', (req, res, next) => {
  if (rutaPermitida(`/api${req.path}`)) return next();
  res.status(404).json({
    error: `Esto es ${PLATAFORMA === 'electrum' ? 'Dr Electrum FP' : 'ULTRON FP'}. Esa ruta es de la otra plataforma.`,
    honesto: true,
  });
});

// Nodos. Nada hardcodeado que no sea el modelo por defecto.
const RENDER_API_KEY = process.env.RENDER_API_KEY || '';
const RENDER_SERVICE_ID = process.env.RENDER_SERVICE_ID || '';
const ULTRON_REMOTE_URL = process.env.ULTRON_FP_URL || process.env.ULTRON_REMOTE_URL || 'https://ultron.ordenglobal.link';
const ULTRON_OJO_URL = (process.env.ULTRON_OJO_URL || process.env.PLAYWRIGHT_NODE_URL || '').replace(/\/$/, '');
const ULTRON_OJO_CLAVE = process.env.ULTRON_OJO_CLAVE || '';
const ULTRON_TTS_URL = (process.env.ULTRON_TTS_URL || process.env.CHATTERBOX_URL || '').replace(/\/$/, '');
const ULTRON_TTS_CLAVE = process.env.ULTRON_TTS_CLAVE || '';

async function probeJson(url: string, headers: Record<string, string> = {}, timeoutMs = 4000) {
  const ctrl = new AbortController();
  const tmr = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers, signal: ctrl.signal });
    const text = await r.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* raw */ }
    return { ok: r.ok, status: r.status, json, text: text.slice(0, 180) };
  } catch (e: any) {
    return { ok: false, status: 0, json: null, text: String(e?.message || e).slice(0, 180) };
  } finally {
    clearTimeout(tmr);
  }
}

type Salud = { qwen: boolean; ojo: boolean; vision: boolean; ttsLocal: boolean; fp: boolean; at: number; raw?: any };
let saludCache: Salud | null = null;

async function medirSalud(force = false): Promise<Salud> {
  if (!force && saludCache && Date.now() - saludCache.at < 15000) return saludCache;
  const [fp, nodo, ojo, tts] = await Promise.all([
    probeJson(`${ULTRON_REMOTE_URL}/salud`),
    saludNodo(),
    ULTRON_OJO_URL
      ? probeJson(`${ULTRON_OJO_URL}/salud`, { 'X-Ojo-Clave': ULTRON_OJO_CLAVE })
      : Promise.resolve({ ok: false, status: 0, json: null, text: 'ULTRON_OJO_URL vacío' }),
    ULTRON_TTS_URL
      ? probeJson(`${ULTRON_TTS_URL}/salud`, { 'x-ultron-tts-clave': ULTRON_TTS_CLAVE })
      : Promise.resolve({ ok: false, status: 0, json: null, text: 'ULTRON_TTS_URL vacío' }),
  ]);
  saludCache = {
    qwen: !!(nodo.ok && nodo.json),
    ojo: !!(ojo.ok && ojo.json?.playwright),
    vision: !!(ojo.ok && ojo.json?.vision) || !!clave('gemini'),
    ttsLocal: tts.status === 200 || tts.status === 401,
    fp: !!fp.ok,
    at: Date.now(),
    raw: { fp, nodo, ojo, tts },
  };
  return saludCache;
}

app.get('/api/health', async (_req, res) => {
  const s = await medirSalud(true);
  const raw = s.raw || {};
  res.json({
    ok: true,
    version: '4.0',
    launch: false,
    cerebro: ULTRON_REMOTE_URL,
    qwen: { url: ULTRON_NODO_URL || null, vivo: s.qwen, modelo: raw.nodo?.json?.modelo || null, rutaChat: '/api/chat' },
    fp: { url: ULTRON_REMOTE_URL, vivo: s.fp, modelo: raw.fp?.json?.modelo || null },
    ojo: { url: ULTRON_OJO_URL || null, vivo: s.ojo, playwright: s.ojo, vision: !!raw.ojo?.json?.vision },
    tts: { url: ULTRON_TTS_URL || null, status: raw.tts?.status ?? 0, vivo: s.ttsLocal },
    elevenlabs: !!clave('elevenlabs'),
    voz: VOZ_OFICIAL.nombre,
    geminiFallback: !!clave('gemini'),
  });
});

/** Calienta Qwen 27B. La mesa espera `listo` antes de dejar hablar. */
app.get('/api/nodo/listo', async (_req, res) => {
  if (!ULTRON_NODO_URL || !ULTRON_NODO_SECRETO) {
    return res.json({ listo: false, motivo: 'sin nodo', honesto: true });
  }
  const t0 = Date.now();
  try {
    const r = await fetchNodo(`${ULTRON_NODO_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ultron-secreto': ULTRON_NODO_SECRETO },
      body: JSON.stringify({
        model: ULTRON_NODO_MODELO,
        stream: false,
        messages: [{ role: 'user', content: 'Responde solo: LISTO' }],
        max_tokens: 8,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(45000),
    });
    return res.json({ listo: r.ok, ms: Date.now() - t0, honesto: true });
  } catch (e: any) {
    return res.json({ listo: false, ms: Date.now() - t0, motivo: String(e?.message || e).slice(0, 160), honesto: true });
  }
});

/** Catálogo de capacidades: la única lista de lo que ULTRON puede hacer, con estado real. */
/**
 * Qué plataforma es esta. El front se marca con esto (arranque, cabecera, ajustes) en vez de llevar
 * «ULTRON FP» escrito a mano: así el mismo binario se presenta como Genesis Core o como Cerebro de
 * Minas según ULTRON_PERFIL, sin dos copias de la interfaz.
 */
/* ------------------------------------------------------------------ Dr Electrum FP */

/** El turno de Electrum: panel de especialistas + harness con manos + órdenes para el mapa. */
app.post('/api/electrum/turno', exigirPlataforma('electrum'), limitar(30), async (req, res) => {
  const mensaje = String(req.body?.mensaje || '').slice(0, 4000).trim();
  if (!mensaje) return res.status(400).json({ error: 'Falta el mensaje.', honesto: true });
  try {
    // Antes esto era `quienVerificado(req)`, con la PETICIÓN donde va el CUERPO: leía
    // `req.telegramUserId`, que no existe, así que Dr Electrum nunca supo con quién hablaba y el
    // nivel salía siempre nulo. Fallaba hacia el lado seguro, pero fallaba.
    const id = identidadDe(req);
    const clave = claveHilo(id?.persona.id || null, 'mesa');
    const historial = fusionarHiloElectrum({
      servidor: hiloElectrumDe(clave),
      cliente: hiloDelCliente(req.body?.hilo),
      mensaje,
    });
    const salida = await turnoElectrum(
      mensaje,
      {
        quien: id?.persona.id || null,
        nivel: nivelDe(id, 'electrum'),
        plataforma: 'electrum',
        canal: 'mesa',
        mensaje,
      },
      { historial }
    );
    recordarHilo(clave, mensaje, salida.texto);
    res.json({ ...salida, honesto: true });
  } catch (e: any) {
    console.error('[electrum] turno falló:', String(e?.message || e).slice(0, 200));
    res.status(500).json({ error: 'Se me cayó el turno. Volvé a preguntarme.', honesto: true });
  }
});

/**
 * «Borrá lo que hablamos.» Desde que el hilo sobrevive a recargar la página, poder vaciarlo deja de
 * ser un lujo: quien consultó el expediente de un concesionario necesita dejar la pantalla limpia
 * antes de que se siente otro.
 */
app.delete('/api/electrum/hilo', exigirPlataforma('electrum'), limitar(30), (req, res) => {
  const id = identidadDe(req);
  olvidarHilo(claveHilo(id?.persona.id || null, 'mesa'));
  res.json({ ok: true, honesto: true });
});

/**
 * Qué hay cargado: capas del mapa y expedientes indexados.
 *
 * Devuelve los TOTALES además de la página. Antes cortaba en 40 capas y 60 documentos sin decirlo,
 * y eso hace algo peor que quedarse corto: con un catastro nacional de 125 capas, la lista parecía
 * completa y faltaban 85. Quien no encontraba un expediente concluía que no estaba cargado, cuando
 * lo que pasaba es que no estaba en esa página. «No existe» y «no está aquí» no se pueden ver
 * igual en un registro.
 */
app.get('/api/electrum/expedientes', exigirPlataforma('electrum'), limitar(60), async (req, res) => {
  /*
   * El nivel va con la lista, no solo en `salud`.
   *
   * `salud` le pregunta antes al nodo —hasta cuatro segundos, más si está dormido— y la pantalla
   * necesita saber si esta persona puede cargar archivos para decidir si le ofrece el cargador.
   * Sacarlo de una ruta lenta hacía que el cargador tardara en aparecer para quien sí puede subir.
   */
  const nivelAqui = nivelDe(identidadDe(req), 'electrum');
  if (!hayBaseElectrum()) {
    return res.json({
      capas: [],
      documentos: [],
      totales: { capas: 0, documentos: 0 },
      existentes: { capas: 0, documentos: 0 },
      nivel: nivelAqui,
      catastro: false,
      honesto: true,
    });
  }
  const q = String(req.query.q || '').trim().slice(0, 120);
  const desde = Math.max(0, Math.min(10_000, Number(req.query.desde) || 0));
  const limite = Math.max(1, Math.min(200, Number(req.query.limite) || 60));
  try {
    // `unaccent` para que «Danlí» y «Danli» encuentren lo mismo, como en el resto de la plataforma.
    const filtro = q ? `WHERE unaccent(lower(nombre)) LIKE unaccent(lower($1))` : '';
    const args = q ? [`%${q}%`] : [];

    const [tc] = await consultaElectrum<{ n: string }>(`SELECT count(*)::text AS n FROM capa ${filtro}`, args);
    const [td] = await consultaElectrum<{ n: string }>(`SELECT count(*)::text AS n FROM documento ${filtro}`, args);
    /*
     * Cuántos hay EN TOTAL, al margen de la búsqueda. Sin esto, una búsqueda sin resultados decía
     * «hay 0 capas y 0 expedientes cargados» —el total filtrado, o sea cero— y eso le cuenta a
     * quien busca que el catastro está vacío cuando lo que pasa es que su palabra no aparece.
     */
    const [ec] = q ? await consultaElectrum<{ n: string }>(`SELECT count(*)::text AS n FROM capa`) : [tc];
    const [ed] = q ? await consultaElectrum<{ n: string }>(`SELECT count(*)::text AS n FROM documento`) : [td];

    const capas = await consultaElectrum(
      `SELECT id, nombre, formato, origen_crs, entidades, subido FROM capa ${filtro}
        ORDER BY subido DESC LIMIT ${limite} OFFSET ${desde}`,
      args
    );
    const documentos = await consultaElectrum(
      `SELECT id, nombre, tipo, paginas, subido, subido_por FROM documento ${filtro}
        ORDER BY subido DESC LIMIT ${limite} OFFSET ${desde}`,
      args
    );
    res.json({
      capas,
      documentos,
      totales: { capas: Number(tc?.n || 0), documentos: Number(td?.n || 0) },
      existentes: { capas: Number(ec?.n || 0), documentos: Number(ed?.n || 0) },
      desde,
      limite,
      nivel: nivelAqui,
      catastro: true,
      honesto: true,
    });
  } catch (e: any) {
    res.status(503).json({ error: String(e?.message || e).slice(0, 160), honesto: true });
  }
});

/** Estado del catastro, para el panel de sistema. */
/**
 * ¿Funciona Dr Electrum?
 *
 * Informaba solo del catastro. Con eso, la única forma de saber si el cerebro contesta o si la voz
 * tiene llave era preguntarle algo y ver qué pasaba — y cuando algo falla, lo que se ve es al
 * doctor diciendo que no alcanza su cerebro, sin decir cuál de las cuatro cosas está caída.
 *
 * Ahora cada pieza se declara por separado, y `listo` es la conjunción de las que hacen falta para
 * trabajar. El catastro NO entra en `listo`: sin él Dr Electrum sigue sabiendo minería y haciendo
 * cuentas; lo que no puede es hablar de una concesión concreta, y eso ya lo dice él solo.
 */
/**
 * El catastro entero para pintarlo. Se sirve al abrir el mapa, no al preguntar.
 *
 * Con mil concesiones cargadas el mapa salía vacío hasta que alguien nombraba una: los datos
 * estaban y no se veían. La geometría va simplificada porque es para mirarla; lo que se usa para
 * medir hectáreas sigue siendo la de la base, entera.
 */
app.get('/api/electrum/catastro.geojson', exigirPlataforma('electrum'), limitar(30), async (_req, res) => {
  try {
    const [fc, encuadre] = await Promise.all([catastroGeojson(), encuadreCatastro()]);
    res.setHeader('Cache-Control', 'private, max-age=60');
    return res.json({ geojson: fc, encuadre, honesto: true });
  } catch (e: any) {
    return res.status(503).json({ error: 'No pude leer el catastro.', detalle: String(e?.message || e).slice(0, 160), honesto: true });
  }
});

app.get('/api/electrum/salud', exigirPlataforma('electrum'), limitar(60), async (req, res) => {
  const id = identidadDe(req);
  const catastro = await saludElectrum();
  const voz = estadoVoz();
  const nodo = nodoConfigurado();

  // Se pregunta al nodo de verdad; sin esto «configurado» y «vivo» se confunden, que es
  // precisamente la diferencia que importa a las once de la noche.
  const cerebro = nodo ? await saludNodo(4000).then((r) => r.ok).catch(() => false) : false;

  res.json({
    ...catastro,
    listo: cerebro,
    // El nombre del modelo es un detalle interno, como el padrón: solo a quien manda. A un cliente
    // se le enseña que el cerebro está en línea, no con qué pesos está hecho.
    cerebro: { configurado: nodo, vivo: cerebro, modelo: nivelDe(id, 'electrum') === 'mando' ? ULTRON_NODO_MODELO : undefined },
    voz: { llave: voz.elevenlabs, vozId: vozDe('electrum') },
    catastro: { viva: catastro.viva, motivo: catastro.motivo || null, concesiones: catastro.concesiones ?? null },
    herramientas: TODAS_ELECTRUM.length,
    quien: id?.persona.nombre || null,
    nivel: nivelDe(id, 'electrum'),
    bot: electrumBotListo(),
    /*
     * EL PADRÓN, SOLO A QUIEN MANDA.
     *
     * Esto se le devolvía a cualquiera que pasara la puerta, incluida la llave de demostración: una
     * persona a la que se le enseña la plataforma diez minutos se llevaba la lista de quién está en
     * la junta y con qué nivel. Que la ruta pida credencial no significa que todas las credenciales
     * merezcan lo mismo.
     */
    padron: nivelDe(id, 'electrum') === 'mando' ? genteDeElectrum() : undefined,
    honesto: true,
  });
});

/**
 * El turno, en vivo.
 *
 * El mapa de Dr Electrum se mueve cuando una herramienta le pasa geometría, y hasta ahora eso
 * ocurría cuando el turno ENTERO terminaba: el catastro contestaba a los ocho segundos y la
 * pantalla se enteraba a los cincuenta. La premisa de la plataforma es que el mapa se mueve
 * mientras él habla, y sin esto era mentira.
 *
 * SSE y no WebSocket porque esto es un flujo de ida: el servidor cuenta, el navegador escucha.
 * Un WebSocket añadiría una conexión bidireccional que nadie usa y que Render tendría que sostener.
 */
app.post('/api/electrum/turno/stream', exigirPlataforma('electrum'), limitar(30), async (req, res) => {
  const mensaje = String(req.body?.mensaje || '').slice(0, 4000).trim();
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  // Sin esto, el proxy de Render acumula el flujo y lo entrega junto al final: SSE sin efecto.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const enviar = (evento: string, datos: unknown) => {
    if (!res.writableEnded) res.write(`event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`);
  };

  if (!mensaje) {
    enviar('error', { error: 'Falta el mensaje.' });
    return res.end();
  }

  /*
   * ¿SE FUE QUIEN PREGUNTABA?
   *
   * Pasa más de lo que parece: se toca «Parar», se cierra la pestaña, se va la señal en el campo.
   * Dos cosas dependen de saberlo. Una, no seguir gastando el nodo en un turno que nadie va a leer.
   * Y dos —la que se ve— no guardar en el hilo una respuesta que el usuario nunca vio: si se
   * guardara, la pregunta siguiente se contestaría sobre algo que para él no existe.
   */
  let seFue = false;
  res.on('close', () => {
    if (!res.writableEnded) seFue = true;
  });

  try {
    const id = identidadDe(req);
    const clave = claveHilo(id?.persona.id || null, 'mesa');
    const historial = fusionarHiloElectrum({
      servidor: hiloElectrumDe(clave),
      cliente: hiloDelCliente(req.body?.hilo),
      mensaje,
    });
    const salida = await turnoElectrum(
      mensaje,
      { quien: id?.persona.id || null, nivel: nivelDe(id, 'electrum'), plataforma: 'electrum', canal: 'mesa', mensaje },
      {
        historial,
        abandonado: () => seFue,
        enVivo: (e) => {
          if (e.panel) enviar('panel', { panel: e.panel });
          if (e.herramienta) enviar('herramienta', e.herramienta);
          if (e.ui) enviar('ui', e.ui);
        },
      }
    );
    if (!seFue) recordarHilo(clave, mensaje, salida.texto);
    enviar('fin', { texto: salida.texto, emocion: salida.emocion, panel: salida.panel, traza: salida.traza, fin: salida.fin });
  } catch (e: any) {
    console.error('[electrum] turno en vivo falló:', String(e?.message || e).slice(0, 200));
    enviar('error', { error: 'Se me cayó el turno. Volvé a preguntarme.' });
  }
  res.end();
});

/**
 * SUBIRLE ALGO AL CEREBRO desde la pantalla.
 *
 * Este hueco era el más grande que le quedaba a Dr Electrum: hasta ahora solo se le podía cargar el
 * catastro por Telegram o por línea de comandos. O sea que la plataforma que existe para enseñar un
 * catastro no tenía forma de recibir uno por su propia pantalla.
 *
 * El archivo llega como cuerpo crudo, no como JSON con base64: un shapefile comprimido de un
 * departamento entero pasa de los veinte megas, y en base64 crece un tercio más. Tampoco se usa
 * multipart —ni la dependencia que haría falta— porque acá sube UN archivo, no un formulario.
 *
 * Exige nivel de ESCRITURA. Es lo que separa mirar de alimentar: quien consulta puede ver todo el
 * catastro y no puede cambiarlo.
 */
app.post(
  '/api/electrum/subir',
  exigirPlataforma('electrum'),
  limitar(20),
  express.raw({ type: () => true, limit: '64mb' }),
  async (req, res) => {
    const id = identidadDe(req);
    if (!puedeEscribir(id, 'electrum')) {
      return res.status(403).json({
        error: 'Tu acceso es de consulta: podés mirarlo todo, pero no cargar al cerebro. Pedile a José nivel de trabajo.',
        code: 'nivel_insuficiente',
        honesto: true,
      });
    }
    const nombre = String(req.query.nombre || req.headers['x-archivo'] || '').trim().slice(0, 200);
    if (!nombre) return res.status(400).json({ error: 'Falta el nombre del archivo.', honesto: true });
    const datos = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (datos.length < 80) return res.status(400).json({ error: 'El archivo llegó vacío.', honesto: true });

    try {
      // El tipo va también: un teléfono manda la foto con `image/jpeg` y a veces con un nombre sin
      // extensión, y por el nombre solo se perdería que era una imagen.
      const r = await aprenderElectrum(nombre, datos, {
        subidoPor: id?.persona.nombre,
        mime: String(req.headers['content-type'] || ''),
      });
      return res.json({
        clase: r.clase,
        dicho: r.dicho,
        avisos: r.avisos,
        ui: r.ui ?? null,
        capaId: (r as any).capaId ?? null,
        honesto: true,
      });
    } catch (e: any) {
      console.error('[electrum] subir falló:', String(e?.message || e).slice(0, 200));
      return res.status(500).json({ error: `Se me cayó leyendo «${nombre}». Volvé a mandarlo.`, honesto: true });
    }
  }
);

/**
 * Oírle. Ruta propia por lo mismo que la voz: `/api/stt` está en la lista abierta de la APK, y un
 * transcriptor abierto es otra factura con la puerta quitada.
 */
app.post('/api/electrum/oir', exigirPlataforma('electrum'), limitar(40), async (req, res) => {
  const audio = bufferDeCualquier(req.body?.audio);
  if (!audio || audio.length < 400) return res.status(400).json({ error: 'No me llegó audio.', honesto: true });
  try {
    const oido = await transcribirAudio({ audio, mime: String(req.body?.mime || 'audio/webm'), language: 'es' });
    if (!oido.texto) return res.status(200).json({ texto: '', detalle: oido.detalle, via: oido.via, honesto: true });
    return res.json({ texto: oido.texto, via: oido.via, honesto: true });
  } catch (e: any) {
    return res.status(502).json({ error: String(e?.message || e).slice(0, 160), honesto: true });
  }
});

/**
 * Pedir un informe desde la pantalla, con el mapa dentro.
 *
 * La captura del lienzo de MapLibre viaja en el cuerpo porque el servidor no tiene el mapa: el
 * encuadre, las capas encendidas y el zoom son de quien está mirando. Por eso el lienzo se creó con
 * `preserveDrawingBuffer`, que sin esto no sirve para nada.
 */
app.post('/api/electrum/informe', exigirPlataforma('electrum'), limitar(12), async (req, res) => {
  const id = identidadDe(req);
  // El nombre va impreso en el documento; el DUEÑO se guarda por id, que es con lo que se compara
  // al recogerlo y al compartirlo. Guardarlo por nombre hacía que nadie pudiera bajar su propio
  // informe: «Ing. Prueba» nunca es igual a «prueba», y la respuesta era «lo pidió otra persona».
  const quien = id?.persona.nombre || null;
  const duenio = id?.persona.id || null;
  const tipo = String(req.body?.tipo || 'concesion');

  let mapa: Buffer | undefined;
  const crudo = String(req.body?.mapa || '');
  if (crudo.startsWith('data:image/jpeg;base64,')) {
    const b = Buffer.from(crudo.slice(crudo.indexOf(',') + 1), 'base64');
    // Más de seis megas no es un mapa: es alguien probando qué pasa.
    if (b.length > 80 && b.length < 6 * 1024 * 1024) mapa = b;
  }

  try {
    const opts = { quien, lectura: req.body?.lectura ? String(req.body.lectura) : undefined, mapa };
    const r =
      tipo === 'cartera'
        ? await informeCartera(opts)
        : await informeConcesion(
            { id: req.body?.concesion_id != null ? Number(req.body.concesion_id) : undefined, nombre: req.body?.nombre ? String(req.body.nombre) : undefined },
            opts
          );
    if ('error' in r) return res.status(404).json({ error: r.error, honesto: true });
    const guardado = guardarInforme(r, duenio);
    return res.json({ id: guardado, nombre: r.nombre, url: `/api/electrum/informe/${guardado}`, bytes: r.pdf.length, dicho: r.dicho, honesto: true });
  } catch (e: any) {
    console.error('[electrum] informe falló:', String(e?.message || e).slice(0, 200));
    return res.status(500).json({ error: 'Se me cayó armando el informe. Volvé a pedírmelo.', honesto: true });
  }
});

/**
 * La voz de Dr Electrum. Ruta propia, no la de ULTRON: no por capricho de simetría, sino porque
 * `/api/tts` está en la lista de rutas abiertas de la APK y un sintetizador abierto es una factura
 * de ElevenLabs con la puerta quitada.
 */
app.post('/api/electrum/voz', exigirPlataforma('electrum'), limitar(30), async (req, res) => {
  const texto = String(req.body?.texto || '').slice(0, 1200).trim();
  if (!texto) return res.status(400).json({ error: 'Falta el texto.', honesto: true });
  try {
    const out = await hablar({ texto, emocion: req.body?.emocion, plataforma: 'electrum' });
    if (!out) return res.status(503).json({ error: 'No tengo voz ahora mismo.', honesto: true });
    res.setHeader('Content-Type', out.contentType);
    res.setHeader('Cache-Control', 'private, max-age=600');
    res.setHeader('X-Motor', out.motor);
    return res.end(out.audio);
  } catch (e: any) {
    console.warn('[electrum] voz', String(e?.message || e).slice(0, 160));
    return res.status(502).json({ error: 'Se me trabó la voz.', honesto: true });
  }
});

/** Recoger un informe ya armado. Vive media hora: describe el catastro de este momento. */
app.get('/api/electrum/informe/:id', exigirPlataforma('electrum'), limitar(60), (req, res) => {
  const id = identidadDe(req);
  const r = tomarInforme(String(req.params.id), id?.persona.id || null);
  if (r.estado !== 'ok') {
    if (r.estado === 'ajeno') {
      return res.status(403).json({
        error: 'Ese informe lo pidió otra persona y no lo compartió. Pedime uno a mí y te lo armo con los datos de ahora.',
        honesto: true,
      });
    }
    return res.status(404).json({ error: 'Ese informe ya no está. Se guardan media hora porque describen el catastro del momento; pedime otro.', honesto: true });
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${r.informe.nombre}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  return res.end(r.informe.pdf);
});

/**
 * Compartirlo con la junta.
 *
 * Un informe nace privado de quien lo pidió —lleva nombres de concesionarios y hectáreas— y se
 * comparte a propósito, con un botón, no por descuido del sistema.
 */
app.post('/api/electrum/informe/:id/compartir', exigirPlataforma('electrum'), limitar(30), (req, res) => {
  const id = identidadDe(req);
  const r = compartirInforme(String(req.params.id), id?.persona.id || null);
  if (r === 'hecho') return res.json({ ok: true, honesto: true });
  if (r === 'ajeno') {
    return res.status(403).json({ error: 'Ese informe no es tuyo, así que no sos vos quien puede compartirlo.', honesto: true });
  }
  return res.status(404).json({ error: 'Ese informe ya no está. Se guardan media hora; pedime otro.', honesto: true });
});

/**
 * El bot Dr Electrum FP. Puerta propia, secreto propio: un update firmado con el secreto de ULTRON
 * rebota aquí, y al revés. Que los dos bots vivan en el mismo proceso no los hace el mismo bot.
 */
app.post(['/api/electrum/telegram/webhook', '/api/electrum/telegram/webhook/'], limitar(40), async (req, res) => {
  if (!electrumWebhookSecretOk(req.headers['x-telegram-bot-api-secret-token'])) {
    return res.status(401).json({ ok: false, honesto: true });
  }
  res.json({ ok: true, honesto: true });
  try {
    const r = await procesarElectrumTelegram(req.body);
    if (r.estado === 'rechazado') console.warn('[electrum] telegram', r.estado, r.chatId);
  } catch (e: any) {
    console.warn('[electrum] telegram', String(e?.message || e).slice(0, 180));
  }
});

app.get('/api/perfil', limitar(60), (_req, res) => {
  const p = perfilActivo();
  res.json({
    id: p.id,
    cerebro: p.cerebro,
    plataforma: p.plataforma,
    proposito: p.proposito,
    acento: p.acento,
    demo: p.demo,
    modos: p.modos,
    herramientas: p.herramientas,
    honesto: true,
  });
});

app.get('/api/capacidades', limitar(30), async (_req, res) => {
  const s = await medirSalud();
  const canales = catalogoCanales();
  const listo = (id: string) => !!canales.find((c) => c.id === id)?.listo;
  const capacidades = catalogoCapacidades({
    qwen: s.qwen,
    ojo: s.ojo,
    elevenlabs: !!clave('elevenlabs'),
    ttsLocal: s.ttsLocal,
    memoriaS3: listo('memoria'),
    telegram: listo('telegram'),
    telegramIn: listo('telegram-in'),
    ejecutor: ejecutorActivo(),
    vision: s.vision,
    oido: listo('oido'),
  });
  res.json({ honesto: true, voz: estadoVoz(), modos: MODOS, canciones: repertorio(), gestos: GESTOS_TACTILES, capacidades });
});


app.get('/api/vault/status', exigirMesa, async (_req, res) => {
  const b = fotoBoveda();
  res.json({
    vaultId: 'ULTRON-BOVEDA',
    status: b.faltan.length ? 'OPERATIVA_INCOMPLETA' : 'OPERATIVA',
    lastSync: new Date().toISOString(),
    honesto: true,
    resumen: b.resumen,
    conduits: b.cajas.map((c) => ({
      id: c.id,
      name: c.nombre,
      type: c.usa,
      configured: c.listo,
      status: c.listo ? 'CONECTADO' : 'FALTA_CLAVE',
      falta: c.falta,
      usa: c.usa,
    })),
  });
});

// BÓVEDA: ElevenLabs Key Update Endpoint

// BÓVEDA: ElevenLabs Key Update Endpoint (solo mando con sesión firmada)
app.post('/api/vault/elevenlabs', exigirSesion, (req, res) => {
  const quien = quienVerificado(req.body, sesionDe(req));
  if (!puedeCambiarSistema(quien)) {
    return res.status(403).json({ error: 'ACCESO: consulta. Solo José o Medardo con sesión escriben la bóveda.', honesto: true });
  }
  const { apiKey } = req.body;
  if (!apiKey || typeof apiKey !== 'string') {
    return res.status(400).json({ error: 'La API Key de ElevenLabs es requerida.' });
  }
  guardarCaja('elevenlabs', apiKey.trim());
  return res.json({ success: true, message: 'API Key de ElevenLabs archivada en la bóveda hasta el próximo redespliegue.', configured: true });
});

// Render: redesplegar la mesa (solo mando con sesión firmada)
app.post('/api/render/deploy', exigirSesion, limitar(5), async (req, res) => {
  const quien = quienVerificado(req.body, sesionDe(req));
  if (!puedeCambiarSistema(quien)) {
    return res.status(403).json({ error: 'ACCESO: consulta. No redespliego.', honesto: true });
  }
  if (!RENDER_API_KEY || !RENDER_SERVICE_ID) {
    return res.status(400).json({ error: 'Falta RENDER_API_KEY o RENDER_SERVICE_ID.', honesto: true });
  }
  try {
    const renderRes = await fetch(`https://api.render.com/v1/services/${RENDER_SERVICE_ID}/deploys`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${RENDER_API_KEY}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ clearCache: req.body?.clearCache ? 'clear' : 'do_not_clear' }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await renderRes.json().catch(() => ({}));
    if (!renderRes.ok) return res.status(renderRes.status).json({ error: 'Render no aceptó el despliegue', details: data, honesto: true });
    await registrarCambio({ quien, canal: 'mesa', que: 'redespliegue de la mesa en Render' });
    return res.json({ success: true, deploy: data, message: 'Despliegue iniciado en Render.', honesto: true });
  } catch (err: any) {
    return res.status(500).json({ error: 'Fallo al contactar Render', message: String(err?.message || err).slice(0, 160), honesto: true });
  }
});

// Cerebro remoto: salud (sin exponer quién entró)
app.get('/api/ultron/salud', async (_req, res) => {
  const remoto = await probeJson(`${ULTRON_REMOTE_URL}/salud`, {}, 6000);
  if (!remoto.ok) {
    return res.status(502).json({ ok: false, connected: false, error: 'No se pudo conectar con el cerebro remoto', remoteUrl: ULTRON_REMOTE_URL });
  }
  return res.json({ ...(remoto.json || {}), connected: true, remoteUrl: ULTRON_REMOTE_URL });
});

/*
 * LA PUERTA.
 *
 * Dos direcciones para la misma puerta, y no por indecisión: `/api/electrum/entrar` es la que
 * corresponde al producto, y `/api/ultron/entrar` se queda porque **la APK ya publicada la usa**.
 * Quitarla dejaría sin entrar a los teléfonos que ya están instalados, que no se actualizan porque
 * nosotros cambiemos de opinión sobre los nombres.
 *
 * La sesión es UNA entre las dos plataformas; a cuál te deja entrar lo decide el padrón del
 * servidor, no la dirección por la que llamaste.
 */
app.post(['/api/electrum/entrar', '/api/ultron/entrar'], limitar(12), async (req, res) => {
  // `clave` o `password`: la web manda lo primero y la app de Dr Electrum lo segundo. Leer solo
  // `clave` hacía que la pantalla de entrada de la APK contestara siempre «Correo y clave
  // requeridos» con las credenciales correctas — nunca llegó a funcionar. Se acepta lo que manden
  // los dos para que la APK que ya está publicada quede arreglada sin recompilarla.
  const claveEntrada = req.body?.clave || req.body?.password;
  const correo = normalizarCorreo(req.body?.correo);
  if (!correo || !claveEntrada) {
    return res.status(400).json({ error: 'Correo y clave requeridos.' });
  }
  try {
    const remoteRes = await fetch(`${ULTRON_REMOTE_URL}/entrar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correo, clave: claveEntrada }),
      signal: AbortSignal.timeout(10000),
    });
    const data: any = await remoteRes.json().catch(() => ({}));
    if (!remoteRes.ok) {
      return res.status(remoteRes.status).json(data);
    }
    const nombre = data.miembro?.nombre || JUNTA[correo]?.nombre || correo.split('@')[0];
    const rol = JUNTA[correo]?.rol || 'Junta Directiva · Orden Global';
    const s = emitirSesion({ correo, nombre, rol });
    return res.json({ ok: true, token: s.token, miembro: { nombre, correo, rol }, message: `Bienvenido a ULTRON FP, ${nombre}`, remoteUrl: ULTRON_REMOTE_URL });
  } catch (err: any) {
    return res.status(500).json({ error: 'Fallo al contactar el cerebro remoto', message: String(err?.message || err).slice(0, 160) });
  }
});

app.post('/api/ultron/biometric-login', limitar(12), async (req, res) => {
  const correo = normalizarCorreo(req.body?.correo);
  if (!correo || !JUNTA[correo]) {
    return res.status(403).json({ error: 'biometría solo para junta registrada', honesto: true });
  }
  const previa = sesionDe(req);
  if (!previa || previa.correo !== correo) {
    return res.status(401).json({ error: 'entra primero con clave; la huella no abre la casa sola', honesto: true });
  }
  const s = emitirSesion({ correo, nombre: JUNTA[correo].nombre, rol: JUNTA[correo].rol });
  return res.json({ ok: true, authenticated: true, token: s.token, user: { nombre: s.nombre, correo, rol: s.rol }, honesto: true });
});

app.get('/api/ultron/sesion', async (req, res) => {
  const s = sesionDe(req);
  if (s) {
    return res.json({ authenticated: true, user: { nombre: s.nombre, correo: s.correo, rol: s.rol }, remoteUrl: ULTRON_REMOTE_URL, honesto: true });
  }
  res.json({ authenticated: false, user: null, remoteUrl: ULTRON_REMOTE_URL, honesto: true });
});

app.post('/api/ultron/salir', async (req, res) => {
  borrarSesion(tokenDe(req));
  res.json({ ok: true, message: 'Sesión cerrada.' });
});


app.post('/api/playwright/scrape', exigirSesion, limitar(10), async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL requerida', honesto: true });
  }
  let formattedUrl = url.trim();
  if (!/^https?:\/\//i.test(formattedUrl)) formattedUrl = `https://${formattedUrl}`;
  const gate = await urlPublica(formattedUrl);
  if (gate.ok === false) return res.status(400).json({ error: gate.error, honesto: true });
  formattedUrl = gate.url;
  if (!ULTRON_OJO_URL) {
    return res.status(503).json({ error: 'ULTRON_OJO_URL no configurada', honesto: true });
  }
  try {
    const headers = { 'Content-Type': 'application/json', 'X-Ojo-Clave': ULTRON_OJO_CLAVE };
    const mirar = await fetch(`${ULTRON_OJO_URL}/mirar`, {
      method: 'POST', headers, body: JSON.stringify({ url: formattedUrl }),
      signal: AbortSignal.timeout(25000),
    });
    const visto: any = await mirar.json().catch(() => ({}));
    let fotoId: string | null = null;
    try {
      const fotoRes = await fetch(`${ULTRON_OJO_URL}/foto`, {
        method: 'POST', headers, body: JSON.stringify({ url: formattedUrl }),
        signal: AbortSignal.timeout(25000),
      });
      const foto: any = await fotoRes.json().catch(() => ({}));
      fotoId = foto.id || null;
    } catch { /* screenshot opcional */ }
    const texto = String(visto.texto || visto.textoPlano || visto.text || '').slice(0, 4000);
    if (!mirar.ok && !texto) {
      return res.status(502).json({ error: 'Playwright/manos no abrió la página', detalle: visto.error || mirar.status, url: formattedUrl, nodo: ULTRON_OJO_URL, honesto: true });
    }
    return res.json({
      success: true, url: formattedUrl, title: visto.titulo || formattedUrl,
      sampleText: texto,
      findings: [`Playwright real ${ULTRON_OJO_URL}`, texto ? `Texto ${texto.length} chars` : 'Sin texto útil'],
      fotoId,
      inspectedAt: new Date().toISOString(),
      node: ULTRON_OJO_URL,
      honesto: true,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Fallo nodo Playwright/manos', message: String(err?.message || err).slice(0, 200), url: formattedUrl, nodo: ULTRON_OJO_URL, honesto: true });
  }
});


app.post('/api/vision/analyze', exigirMesaODesk, async (req, res) => {
  const { mediaType, fileName, base64Data, prompt } = req.body || {};
  if (!base64Data) {
    return res.status(400).json({ error: 'Falta la imagen', honesto: true });
  }
  const isVideo = String(mediaType || fileName || '').startsWith('video') || /\.(mp4|webm|mov)$/i.test(fileName || '');
  if (isVideo) {
    return res.status(501).json({ error: 'Video todavía no se analiza. Mandá un frame.', honesto: true });
  }
  const isPdf = String(mediaType || '').includes('pdf') || /\.pdf$/i.test(fileName || '') || String(base64Data).includes('application/pdf');
  if (isPdf) {
    const buf = bufferDeCualquier(base64Data);
    if (!buf) return res.status(400).json({ error: 'PDF vacío. No lo leí.', honesto: true });
    const leido = extraerPdf(buf);
    const visiones: string[] = [];
    for (const img of leido.imagenes.slice(0, leido.texto.length < 240 ? 3 : 1)) {
      const vista = await verImagen(dataUrlDeImagen(img), prompt || 'Lee el documento. Copia texto y números. No inventes.');
      visiones.push(vista.texto);
    }
    const summary = [leido.texto, ...visiones].filter(Boolean).join('\n\n') || leido.detalle;
    return res.json({ success: !!leido.texto || visiones.length > 0, summary, detalle: leido.detalle, via: 'pdf-leer', honesto: true });
  }
  const vista = await verImagen(String(base64Data), prompt || 'Describe con precisión lo que se ve. Si hay precios o números, cópialos. No inventes.');
  if (vista.via === 'ninguno' || vista.via === 'error') {
    console.error(`[ULTRON] /vision/analyze falló (${vista.via}) con ${String(base64Data).length} car.: ${vista.texto.slice(0, 160)}`);
    return res.status(503).json({ error: vista.texto, honesto: true });
  }
  return res.json({ success: true, summary: vista.texto, via: vista.via, honesto: true });
});


const spotCache: Record<string, { at: number; data: any }> = {};
async function cached(key: string, ttlMs: number, fn: () => Promise<any>) {
  const hit = spotCache[key];
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  const data = await fn();
  spotCache[key] = { at: Date.now(), data };
  return data;
}

/**
 * Qué contesta ULTRON cuando el cerebro no responde.
 *
 * Antes volcaba HECHOS en crudo, con sus etiquetas internas y todo («CEREBRO DE MINAS (esto lo sabés
 * de verdad…)»). Eso no es una respuesta: es enseñar el prompt. Se dice lo que sí se sabe en frases
 * de persona (los `datos`, que ya vienen redactados) y se admite que el cerebro está caído.
 */
function sinCerebro(datos: string[]): string {
  if (datos.length) return `${datos.join(' ')} Eso sí lo tengo a mano; el cerebro grande no me responde ahora, así que no te voy a elaborar más.`;
  return 'Ahora mismo no alcanzo mi cerebro. No te voy a inventar una respuesta: dame un momento y volvé a preguntarme.';
}



async function usdHnl() {
  return cached('hnl', 60000, async () => {
    const r = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(8000) });
    const j: any = await r.json();
    const hnl = j?.rates?.HNL;
    if (!hnl) throw new Error('sin rate HNL');
    return { usdHnl: Number(hnl), fuente: 'open.er-api.com' };
  });
}


function juntarOllama(raw: string) {
  let acc = '';
  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      const j = JSON.parse(s);
      acc += j.message?.content || j.content || j.response || '';
      if (j.done && acc) return acc;
    } catch { /* skip */ }
  }
  try {
    const j = JSON.parse(raw);
    return j.message?.content || j.content || j.reply || raw;
  } catch {
    return raw;
  }
}




app.get('/api/memoria', exigirMesa, async (req, res) => {
  await cargarMemoria();
  const s = sesionDe(req);
  const quien = resolverQuien(req.query, s);
  res.json(fotoMemoria(quien));
});

/** Escribir u olvidar memoria exige sesión firmada: la identidad sale del token, no del body. */
app.post('/api/memoria', exigirSesion, limitar(60), async (req, res) => {
  await cargarMemoria();
  const s = sesionDe(req);
  const quien = quienVerificado(req.body, s);
  const hecho = String(req.body?.hecho || '').trim().slice(0, 600);
  const olvido = !!req.body?.olvidar;
  if (olvido) {
    if (!quien) return res.status(400).json({ error: 'No supe quién eres de la junta. No borré nada.', honesto: true });
    await olvidarQuien(quien, !!req.body?.junta && puedeCambiarSistema(quien));
    return res.json({ ok: true, olvidado: true, quien, honesto: true });
  }
  if (hecho) {
    await guardarHechoQuien({ quien, hecho, canal: 'mesa', junta: !!req.body?.junta && puedeCambiarSistema(quien) });
  }
  res.json({ ok: true, ...fotoMemoria(quien) });
});

/* ---------------- VOZ: una sola voz, un solo camino ---------------- */

function leerPeticionVoz(req: express.Request) {
  const fuente: any = req.method === 'GET' ? req.query : { ...(req.query || {}), ...(req.body || {}) };
  return {
    texto: String(fuente.text || fuente.texto || '').slice(0, 2400).trim(),
    emocion: normalizarEmocion(fuente.emocion),
    performance: String(fuente.performance || 'speak') === 'sing' ? ('sing' as const) : ('speak' as const),
  };
}

async function responderVoz(req: express.Request, res: express.Response) {
  const p = leerPeticionVoz(req);
  if (!p.texto) return res.status(400).json({ error: 'text vacío', honesto: true });
  const out = await hablar({ texto: p.texto, emocion: p.emocion, performance: p.performance });
  if (!out) return res.status(503).json({ error: 'Voz no disponible (ElevenLabs y nodo TTS sin respuesta)', honesto: true });
  res.setHeader('Content-Type', out.contentType);
  res.setHeader('Cache-Control', out.cache ? 'private, max-age=3600' : 'no-store');
  res.setHeader('X-Ultron-TTS', out.motor);
  res.setHeader('X-Ultron-Emocion', p.emocion);
  res.setHeader('X-Ultron-Ms', String(out.ms));
  return res.send(out.audio);
}

app.all('/api/tts', exigirMesaODesk, limitar(60), responderVoz);
app.all('/api/tts/stream', exigirMesaODesk, limitar(60), responderVoz);
app.all('/api/voz', exigirMesaODesk, limitar(60), responderVoz);

/** Oración del día: ULTRON cierra los ojos y ora (clip grabado con la voz oficial). */
app.all('/api/orar', exigirMesaODesk, limitar(12), async (req, res) => {
  const tema = String(req.body?.tema || req.query?.tema || '').slice(0, 120);
  const out = await orar({ tema });
  if (!out) return res.status(503).json({ error: 'No pude orar ahora (voz sin respuesta).', honesto: true });
  res.setHeader('Content-Type', out.contentType);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('X-Ultron-TTS', out.motor);
  res.setHeader('X-Ultron-Emocion', 'oracion');
  return res.send(out.audio);
});

/**
 * Diagnóstico de campo de la APK: migas de arranque y crashes. Sale por consola para verlo en los
 * logs de Render. Sin sesión (una app que se está cayendo no puede autenticarse) y con rate limit.
 */
app.post('/api/diag', limitar(40), (req, res) => {
  const b = req.body || {};
  const cab = `[APK ${String(b.version || '?')} ${String(b.plataforma || '?')} ${String(b.dispositivo || '?')} ses=${String(b.sesion || '?')}]`;
  const tipo = String(b.tipo || 'estado');
  if (tipo === 'crash-previo') {
    console.error(`${cab} CRASH. Murió en: ${String(b.murio_en || '?')}`);
  } else if (tipo === 'error-js') {
    console.error(`${cab} ERROR JS${b.fatal ? ' FATAL' : ''}: ${String(b.error || '').slice(0, 300)}`);
    if (b.stack) console.error(`${cab} stack: ${String(b.stack).slice(0, 900)}`);
  } else {
    console.log(`${cab} ${String(b.nota || 'estado')}`);
  }
  const migas = Array.isArray(b.migas) ? b.migas.slice(-40) : [];
  if (migas.length) console.log(`${cab} migas: ${migas.map(String).join(' | ').slice(0, 1800)}`);
  res.json({ ok: true, honesto: true });
});

app.get('/api/cantar', (_req, res) => {
  res.json({ honesto: true, canciones: repertorio() });
});

/** Canta: `{ id }` del repertorio, `{ pedido }` en lenguaje natural o `{ letra, titulo }` libre. Devuelve audio/mpeg. */
app.post('/api/cantar', exigirMesaODesk, limitar(12), async (req, res) => {
  const id = String(req.body?.id || '').trim();
  const letra = String(req.body?.letra || '').trim();
  const titulo = String(req.body?.titulo || '').trim();
  const pedido = String(req.body?.pedido || '').trim();
  const cancion = id || (pedido ? cancionPorPedido(pedido)?.id : '') || '';
  const out = await cantar(cancion ? { id: cancion } : { letra, titulo });
  if (!out) {
    return res.status(letra || cancion ? 503 : 400).json({
      error: letra || cancion ? 'No pude cantar ahora (voz sin respuesta).' : 'Decime qué canto: un id del repertorio o una letra.',
      canciones: repertorio(),
      honesto: true,
    });
  }
  res.setHeader('Content-Type', out.contentType);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('X-Ultron-TTS', out.motor);
  res.setHeader('X-Ultron-Titulo', encodeURIComponent(out.titulo));
  return res.send(out.audio);
});


app.post('/api/stt', exigirMesaODesk, limitar(60), async (req, res) => {
  const t0 = Date.now();
  const raw = String(req.body?.audioBase64 || req.body?.audio || '');
  if (!raw || raw.length < 80) return res.status(400).json({ error: 'audio vacío', honesto: true });
  const { mime, buffer } = decodeDataUrl(raw, String(req.body?.mimeType || req.body?.mime || 'audio/m4a'));
  if (buffer.length < 1200) return res.json({ text: '', model: 'vacio', ms: Date.now() - t0, honesto: true });
  const oido = await transcribirAudio({ audio: buffer, mime, language: String(req.body?.language || 'es') });
  if (oido.texto) {
    return res.json({ text: oido.texto, via: oido.via, ms: Date.now() - t0, bytes: buffer.length, honesto: true });
  }
  if (oido.via === 'ninguno' || oido.via === 'vacio') {
    return res.status(oido.via === 'ninguno' ? 503 : 200).json({ text: '', error: oido.detalle, via: oido.via, honesto: true });
  }
  return res.json({ text: '', via: oido.via, detalle: oido.detalle, ms: Date.now() - t0, honesto: true });
});

async function prepararTurno(body: any) {
  const t0 = Date.now();
  const message = String(body?.message || body?.text || '').trim();
  const mode = body?.mode || 'GUARDIAN';
  const nombre = String(body?.usuario || body?.userName || '').trim().slice(0, 40);
  const canal: CanalMem = body?.canal === 'telegram' ? 'telegram' : 'mesa';
  await cargarMemoria();
  const quien = resolverQuien(body, body?.sesion || null);
  // Mando solo con identidad verificada (sesión firmada o Telegram). El body no escala.
  const mando = puedeCambiarSistema(quienVerificado(body, body?.sesion || null));
  const memSt = estadoMemoria();
  if (message) {
    await recordarTurno({ quien, rol: 'user', texto: message, canal });
  }
  const clienteHilo = Array.isArray(body?.historial)
    ? (body.historial as any[]).map((x) => ({
        rol: String(x?.rol || x?.role || 'user'),
        texto: String(x?.texto || x?.content || ''),
      }))
    : [];
  const durable = hiloDe(quien).map((t) => ({ rol: t.rol, texto: t.texto }));
  const hiloTodo = durable.length >= 2 ? durable : [...clienteHilo, ...durable];
  const hiloPrevio = hiloTodo.filter(
    (t, i) => !(i === hiloTodo.length - 1 && t.rol === 'user' && t.texto === message)
  );
  const mensajeHilo = resolverReferencia(message, hiloPrevio);
  const hilo: MsgHilo[] = fusionarHilo({ durable, cliente: clienteHilo, mensaje: message, max: 16 });
  // Hechos que manda el cliente solo entran con sesión firmada (si no, cualquiera envenena la memoria).
  const largaApp: string[] = body?.sesion && Array.isArray(body?.memoria) ? body.memoria.map((x: any) => String(x)).slice(0, 24) : [];
  for (const h of largaApp) {
    if (h.trim().length > 8) await guardarHechoQuien({ quien, hecho: h.trim().slice(0, 400), canal: 'mesa' });
  }

  const q = message.toLowerCase();
  const hechos: string[] = [];
  const datos: string[] = [];
  const foto: string | null = null;
  const tools: string[] = [];
  let decirTaller: string | undefined;
  /** Un cálculo de mina se dice tal cual: parafrasear un número es arruinarlo. */
  let calculoMina: string | null = null;

  // Hechos de Orden Global pegados a la pregunta: el cerebro completo va en el system, pero el
  // dato concreto (1 ORIGEN = 1/55 g, Besu/QBFT, CIADI…) rinde más al lado de lo que preguntaron.
  const delCerebro = hechoCerebro(message);
  if (delCerebro) {
    hechos.push(delCerebro);
    tools.push(`cerebro-${perfilActivo().id}`);
  }

  // Contexto interno: el 27B lo usa para decidir, no para recitarlo. Los fallos de infraestructura
  // no se le cuentan a la junta en un saludo; solo si preguntan por el sistema (taller lo responde).
  hechos.push(
    `CONTEXTO INTERNO (no lo menciones salvo que te pregunten por el sistema): hablas con ${nombreDe(quien)}; ` +
      (memSt.durable ? 'memoria durable activa; ' : 'memoria durable no disponible en este momento (no lo digas, solo no prometas recordar para siempre); ') +
      (mando
        ? 'acceso de mando: puede pedir redespliegue, mantenimiento y ejecutor.'
        : 'acceso de consulta: no redespliegas, no haces mantenimiento ni corres el ejecutor; lo demás (estado, PDF, fotos, voz, web, oro, pendientes, memoria propia) sí.')
  );


  try {
    if (/\b(oro|gold|xau|onza)\b/.test(q)) {
      const s = await spotMetal('XAU');
      hechos.push(`SPOT XAU/USD = ${s.usd} USD/oz (fuente ${s.fuente}). No inventes otro número.`);
      datos.push(`El oro está en ${Math.round(s.usd)} dólares la onza, según ${s.fuente}.`);
      tools.push('oro');
    }
    if (/\b(plata|silver|xag)\b/.test(q)) {
      const s = await spotMetal('XAG');
      hechos.push(`SPOT XAG/USD = ${s.usd} USD/oz (fuente ${s.fuente}). No inventes otro número.`);
      datos.push(`La plata está en ${s.usd.toFixed(2)} dólares la onza, según ${s.fuente}.`);
      tools.push('plata');
    }
    // --- Cerebro de Minas: las cuentas las hace la plataforma, no el modelo de cabeza.
    if (herramientaActiva('calculos-mina')) {
      let precioOnza: number | undefined;
      // El spot solo se pide si la frase habla de dinero: una conversión de onzas no necesita red.
      if (/\b(vale|valor|d[oó]lares|usd|precio|cuánto|cuanto|corte|cutoff)\b/.test(q)) {
        precioOnza = await spotMetal('XAU').then((s) => Number(s.usd)).catch(() => undefined);
      }
      const calc = resolverCalculoMina(message, { precioOnza });
      if (calc) {
        hechos.push(
          `CÁLCULO DE MINA (${calc.tipo}) — lo hizo la plataforma, este número es el bueno, no lo recalcules:\n${calc.texto}\nFórmula: ${calc.formula}`
        );
        datos.push(calc.texto);
        calculoMina = calc.texto;
        tools.push('calculo-mina');
      }
    }
    if (herramientaActiva('concesiones')) {
      const ficha = responderConcesion(message);
      if (ficha) {
        hechos.push(`PADRÓN DE CONCESIONES (datos de demostración, dilo al darlos):\n${ficha}`);
        datos.push(ficha);
        tools.push('concesiones');
      }
    }
    if (/\b(lempira|hnl|d[oó]lar a lempira|usd a hnl|tipo de cambio)\b/.test(q)) {
      const fx = await usdHnl();
      hechos.push(`USD/HNL = ${fx.usdHnl} (fuente ${fx.fuente}).`);
      datos.push(`El dólar está a ${fx.usdHnl.toFixed(2)} lempiras, según ${fx.fuente}.`);
      tools.push('hnl');
    }
    const urlMatch = message.match(/https?:\/\/[^\s]+/i);
    const quiereCaptura = urlMatch || /\b(abr[ií] la p[aá]gina|screenshot|playwright|captura)\b/.test(q);
    if (quiereCaptura) {
      const url = urlMatch ? urlMatch[0] : 'https://www.bch.hn/';
      const gate = await urlPublica(url);
      if (gate.ok === false) {
        hechos.push(`Página ${url}: no la abro (${gate.error}).`);
      } else {
        const page = await capturaPagina(gate.url);
        hechos.push(`Página ${page.url}: ${page.texto.slice(0, 1200) || 'sin texto'}`);
        tools.push('pagina');
        if (page.foto) {
          tools.push('foto');
          if (body?.canal === 'telegram' || /telegram|captura|screenshot|m[aá]ndame (la )?foto/.test(q)) {
            const envio = await telegramFoto({ buf: page.foto, caption: page.titulo || page.url, chatId: body?.telegramChatId });
            hechos.push(`FOTO TELEGRAM: ${envio.detalle}`);
          }
        }
      }
    }
    const red = pedidoRed(message, hiloPrevio);
    if (red) {
      tools.push('web');
      const hits = await buscarWeb(red.query, 5);
      if (hits.length) {
        hechos.push(
          `BÚSQUEDA WEB "${red.query}" (${new Date().toISOString().slice(0, 10)}):\n` +
            hits.map((h, i) => `${i + 1}. ${h.title} — ${h.snippet} [${h.url}]`).join('\n')
        );
      } else {
        hechos.push(`BÚSQUEDA WEB "${red.query}": sin resultados. Dilo.`);
      }
      let leer = red.leer || hits.find((h) => /github\.com\//i.test(h.url))?.url || hits.find((h) => /^https?:\/\/[^/]+\/.+/.test(h.url))?.url;
      if (leer) {
        for (const u of urlsParaLeer(leer).slice(0, 3)) {
          const pub = await urlPublica(u);
          if (pub.ok === false) continue;
          const texto = await leerPagina(pub.url, /raw\.githubusercontent/.test(u) ? 4500 : 1800);
          if (texto && texto.length > 80 && !/^\s*(404|not found|file not found)/i.test(texto)) {
            hechos.push(`FUENTE (${pub.url}): ${texto}`);
            tools.push('pagina');
            break;
          }
        }
      }
      hechos.push('Responde con lo que dicen las fuentes y el hilo. Si el usuario dijo «esto», es el tema o la URL anterior. No pidas otra vez el enlace. Si las fuentes no contestan, dilo.');
    }
    // Escena que la cámara local ya interpretó (MediaPipe en la web, ML Kit en la APK): quién está y qué hace.
    const escena = String(body?.escena || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    const preguntaPorVer = /\b(qu[eé] ves|qu[eé] hay aqu[ií]|qui[eé]n (est[aá]|hay|anda)( aqu[ií]| ah[ií]| conmigo)?|me ves|c[oó]mo me ves|estoy solo|cu[aá]ntos somos|qu[eé] cara tengo|me veo)\b/.test(q);
    if (escena) {
      hechos.push(`ESCENA (tu cámara, ahora mismo): ${escena}${preguntaPorVer ? '' : ' (úsalo solo si viene al caso; no lo recites sin motivo).'}`);
      tools.push('escena');
    }
    const image = body?.image;
    if (image) {
      const vista = await verImagen(String(image));
      // Un fallo de visión NO se le pasa crudo al modelo: lo parafraseaba como «la cámara me muestra un
      // error técnico», que no le dice nada a nadie. Se le da la frase que tiene que decir.
      if (vista.via === 'error' || vista.via === 'ninguno') {
        console.error(`[ULTRON] vision falló (${vista.via}) con ${String(image).length} car.: ${vista.texto.slice(0, 160)}`);
        hechos.push('VISION: la cámara no devolvió imagen esta vez. Dilo simple y humano («ahora mismo no me está entrando imagen, dame un segundo»); no hables de errores técnicos ni de nodos.');
      } else {
        console.log(`[ULTRON] vision ok (${String(image).length} car.) → ${vista.texto.slice(0, 120)}`);
        hechos.push(`VISION (${vista.via}): ${vista.texto}`);
      }
      tools.push('vision');
    } else if (/\b(qu[eé] ves|qu[eé] hay aqu[ií]|le[eé] (la |esta )?imagen|foto)\b/.test(q) && !quiereCaptura && !body?.documento && !body?.pdf && !escena) {
      hechos.push('VISION: no llegó frame ni escena. Di que ahora mismo no ves (cámara apagada) y ofrece encenderla.');
    }
    const doc = body?.documento || body?.pdf;
    if (doc) {
      const filename = String(doc.filename || 'archivo.pdf');
      const buf =
        bufferDeCualquier(doc.buffer) ||
        bufferDeCualquier(doc.data) ||
        bufferDeCualquier(body?.pdfBase64);
      if (!buf) {
        hechos.push(`PDF "${filename}": no pude bajar el archivo. No invento el contenido.`);
        tools.push('pdf-leer');
      } else {
        const leido = extraerPdf(buf);
        tools.push('pdf-leer');
        hechos.push(`PDF "${filename}" (${leido.bytes} bytes, ~${leido.paginas || '?'} pág.): ${leido.detalle}`);
        if (leido.texto) hechos.push(`TEXTO DEL PDF:\n${leido.texto}`);
        if (leido.imagenes.length) {
          const cuantas = leido.texto.length < 240 ? leido.imagenes.length : Math.min(1, leido.imagenes.length);
          for (let i = 0; i < cuantas; i++) {
            const vista = await verImagen(dataUrlDeImagen(leido.imagenes[i]), 'Lee el documento en la imagen. Copia texto y números. No inventes.');
            hechos.push(`VISION PDF img ${i + 1} (${vista.via}): ${vista.texto}`);
            tools.push('vision');
          }
        }
        if (!leido.texto && !leido.imagenes.length) {
          hechos.push('No extraí texto ni imágenes del PDF. Dilo. No inventes cláusulas ni cifras.');
        }
      }
    }
  } catch (e: any) {
    hechos.push(`Tool falló: ${String(e?.message || e).slice(0, 160)}. Si no hay cifra, dilo.`);
  }

  try {
    const taller = await despacharTaller(message, { usuario: nombre, quien: mando ? quien : quien === 'jose' || quien === 'medardo' ? null : quien });
    hechos.push(...taller.hechos);
    tools.push(...taller.tools);
    decirTaller = taller.decir;
    if (taller.tools.length) {
      await registrarCambio({
        quien,
        canal,
        que: `${taller.tools.join('+')}: ${(taller.decir || taller.hechos[0] || '').slice(0, 140)}`,
      });
    }
  } catch (e: any) {
    hechos.push(`Taller falló: ${String(e?.message || e).slice(0, 160)}.`);
  }

  try {
    if (/\b(ejecuta|corre el c[oó]digo|run this)\b/i.test(message)) {
      if (!mando) {
        hechos.push('ACCESO: consulta. No corro el ejecutor. José o Medardo sí pueden.');
      } else {
        const py = extraerPython(message);
        if (py) {
          tools.push('ejecutor');
          const r = await ejecutarCodigo(py);
          hechos.push(
            `EJECUTOR (${r.via}): exit ${r.exit_code}. stdout: ${String(r.stdout || '').slice(0, 800) || '(vacío)'} stderr: ${String(r.stderr || r.error || '').slice(0, 400) || '(vacío)'}.`
          );
        } else {
          hechos.push('EJECUTOR: pediste ejecutar pero no vino un bloque ```python. Pégalo.');
        }
      }
    }
  } catch (e: any) {
    hechos.push(`Ejecutor falló: ${String(e?.message || e).slice(0, 160)}.`);
  }

  // Respuesta directa solo para pedidos cortos de dato puro («precio del oro», «lempira a dólar»).
  // Se dice como persona, no como volcado de HECHOS. Lo conversacional va al 27B con los datos como hechos.
  const soloDato =
    q.split(/\s+/).length <= 7 &&
    /precio|spot|cotizaci|a cu[aá]nto|cu[aá]nto (est[aá]|vale|cuesta)|tipo de cambio|lempira a d[oó]lar|d[oó]lar a lempira/.test(q) &&
    !/por qu[eé]|explica|an[aá]lisis|busca|investiga|opin|crees|pens[aá]s/.test(q) &&
    !tools.includes('web') &&
    datos.length > 0;
  // Un cálculo sale palabra por palabra como lo armó la plataforma, salvo que pidan explicación.
  const soloCalculo = calculoMina && !/por qu[eé]|explic|c[oó]mo se (calcula|saca)|f[oó]rmula|analiz|opin/.test(q) ? calculoMina : null;
  const directo = decirTaller || soloCalculo || (soloDato ? datos.join(' ') : null);

  const personalidad = `${buildPersonality({ nombre: (quien ? nombreDe(quien) : nombre) || undefined, canal, modo: String(mode), mando })}

${perfilActivo().tituloConocimiento}:
${perfilActivo().conocimiento}

No finjas recuerdos: solo la memoria de ${quien ? nombreDe(quien) : 'quien no identifiqué'} y los hechos de junta. No recites la conversación privada del otro.
Modo de mesa pedido: ${mode}.
HECHOS:\n${hechos.join('\n') || '(ninguno)'}\n${hechosCatalogo()}\n${promptMemoria(quien)}`;

  const compuesto = construirMensajes({ personalidad, user: mensajeHilo || message, canal, historial: hilo });
  if (compuesto.meta.rag) tools.push('rag');
  if (compuesto.meta.cot) tools.push('cot');
  if (compuesto.meta.harness) tools.push('harness');
  const system = compuesto.messages[0].content;

  return { t0, message: mensajeHilo || message, crudo: message, mode, hechos, datos, tools, foto, directo, directoVia: decirTaller ? 'taller' : soloCalculo ? 'calculo-mina' : directo ? 'market' : null, system, quien, mando, canal, hilo };
}


function mensajesQwen(system: string, message: string, hechos: string[], hilo: MsgHilo[] = []) {
  return [
    { role: 'system', content: system },
    ...hilo.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: `HECHOS DE ESTE TURNO:\n${hechos.join('\n') || '(ninguno)'}\n\nJunta: ${message}` },
  ];
}

async function preguntarQwen(
  system: string,
  message: string,
  hechos: string[],
  hilo: MsgHilo[] = []
): Promise<{ ok: boolean; reply: string; error?: string }> {
  if (!ULTRON_NODO_URL || !ULTRON_NODO_SECRETO) {
    return { ok: false, reply: '', error: 'Qwen no configurado' };
  }
  try {
    const r = await fetchNodo(`${ULTRON_NODO_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ultron-secreto': ULTRON_NODO_SECRETO },
      body: JSON.stringify({ model: ULTRON_NODO_MODELO, stream: false, messages: mensajesQwen(system, message, hechos, hilo) }),
      signal: AbortSignal.timeout(60000),
    });
    const raw = await r.text();
    const reply = String(juntarOllama(raw) || '').trim();
    if (!r.ok || !reply) return { ok: false, reply: '', error: 'Qwen no contestó' };
    return { ok: true, reply };
  } catch (err: any) {
    return { ok: false, reply: '', error: String(err?.message || err).slice(0, 200) };
  }
}

async function correrHerramientaPedida(ped: ReturnType<typeof extraerPedidoHerramienta>, reply: string, mando: boolean): Promise<string> {
  if (!ped) return 'HARNESS: pedido vacío.';
  return resolverPedido(
    ped,
    {
      web: async (q) => {
        const hits = await buscarWeb(q, 5);
        if (!hits.length) return `HARNESS web "${q}": sin resultados.`;
        const first = hits.find((h) => /^https?:\/\/[^/]+\/.+/.test(h.url));
        let texto = '';
        if (first) {
          const pub = await urlPublica(first.url);
          if (pub.ok !== false) texto = await leerPagina(pub.url, 1200);
        }
        return (
          `HARNESS web "${q}":\n` +
          hits.map((h, i) => `${i + 1}. ${h.title} — ${h.snippet} [${h.url}]`).join('\n') +
          (first && texto ? `\nPRIMERA FUENTE (${first.url}): ${texto}` : '')
        );
      },
      sistema: async () => (await fotoSistema()).resumen,
      leer: async (url) => {
        const pub = await urlPublica(url);
        if (pub.ok === false) return `HARNESS leer: ${pub.error}. No abrí.`;
        const texto = await leerPagina(pub.url, 1600);
        return texto ? `HARNESS leer (${pub.url}): ${texto}` : `HARNESS leer (${pub.url}): página vacía o no HTML.`;
      },
      ejecutor: async (codigo) => {
        if (!mando) return 'ACCESO: consulta. No ejecuto código ni cambio el sistema. José o Medardo con sesión sí pueden.';
        const r = await ejecutarCodigo(codigo);
        return `EJECUTOR (${r.via}): exit ${r.exit_code}. stdout: ${String(r.stdout || '').slice(0, 800) || '(vacío)'} stderr: ${String(r.stderr || r.error || '').slice(0, 400) || '(vacío)'}.`;
      },
    },
    extraerPython(reply)
  );
}

/** Bucle harness compartido por /api/turno y /api/turno/stream. Máximo dos vueltas. */
async function bucleHarness(o: {
  reply: string;
  system: string;
  message: string;
  hechos: string[];
  hilo: MsgHilo[];
  tools: string[];
  mando: boolean;
}): Promise<{ reply: string; via: string }> {
  let reply = o.reply;
  let via = `${ULTRON_NODO_URL}/api/chat`;
  for (let i = 0; i < 2; i++) {
    const ped = extraerPedidoHerramienta(reply);
    if (!ped) break;
    o.tools.push(ped.herramienta);
    const extra = await correrHerramientaPedida(ped, reply, o.mando);
    o.hechos.push(extra);
    const qn = await preguntarQwen(o.system, o.message, o.hechos, o.hilo);
    if (!qn.ok) {
      reply = quitarLineaPedido(reply) + (extra ? `\n\n${extra}` : '');
      via = 'harness-parcial';
      break;
    }
    reply = qn.reply;
    via = 'harness';
  }
  return { reply: quitarLineaPedido(reply), via };
}

type SalidaTurno = {
  reply: string;
  emocion: Emocion;
  via: string;
  mode: string;
  ms: number;
  herramientas: string[];
  foto: string | null;
  honesto: true;
  error?: string;
};

async function correrTurno(body: any): Promise<SalidaTurno> {
  const p = await prepararTurno(body);
  const base = { mode: p.mode, foto: null as string | null, honesto: true as const };
  if (!p.message) return { ...base, reply: '', emocion: 'neutral', via: 'none', ms: Date.now() - p.t0, herramientas: [], error: 'message vacío' };
  const { t0, mode, tools, system, message, quien, canal, hilo, mando } = p;
  const hechos = [...p.hechos];
  const guardar = async (out: Omit<SalidaTurno, 'emocion'> & { emocion?: Emocion }): Promise<SalidaTurno> => {
    const e = extraerEmocion(out.reply);
    const final: SalidaTurno = { ...out, reply: e.texto, emocion: out.emocion || e.emocion };
    if (final.reply) await recordarTurno({ quien, rol: 'ultron', texto: final.reply, canal });
    return final;
  };
  if (p.directo) {
    const via = p.directoVia === 'taller' ? 'taller' : p.directoVia === 'calculo-mina' ? 'calculo-mina' : 'gold-api/er-api';
    return guardar({ ...base, reply: p.directo, via, mode, ms: Date.now() - t0, herramientas: tools });
  }
  if (!ULTRON_NODO_URL || !ULTRON_NODO_SECRETO) {
    return guardar({ ...base, reply: sinCerebro(p.datos), emocion: 'preocupado', via: 'tools-only', mode, ms: Date.now() - t0, herramientas: tools });
  }
  const q1 = await preguntarQwen(system, message, hechos, hilo);
  if (!q1.ok) {
    return guardar({ ...base, reply: sinCerebro(p.datos), emocion: 'preocupado', via: 'tools-fallback', mode, ms: Date.now() - t0, herramientas: tools, error: q1.error });
  }
  const h = await bucleHarness({ reply: q1.reply, system, message, hechos, hilo, tools, mando });
  let reply = h.reply;
  let via = h.via;

  // Código que escribió el modelo solo se ejecuta si lo pidió alguien con mando y lo pidió explícitamente.
  const py = extraerPython(reply);
  if (py && mando && ejecutorActivo() && !tools.includes('ejecutor') && /\b(ejecuta|corre el c[oó]digo|run this)\b/i.test(message) && esTareaDeCodigo(message)) {
    tools.push('ejecutor');
    const r = await ejecutarCodigo(py);
    const hecho = `EJECUTOR (${r.via}): exit ${r.exit_code}. stdout: ${String(r.stdout || '').slice(0, 800) || '(vacío)'} stderr: ${String(r.stderr || r.error || '').slice(0, 400) || '(vacío)'}.`;
    hechos.push(hecho);
    if (!r.ok) {
      const qn = await preguntarQwen(system, `${message}\n\nEl ejecutor falló. Corrige el código. No afirmes que funciona.`, hechos, hilo);
      reply = qn.ok ? quitarLineaPedido(qn.reply) : `${quitarLineaPedido(reply)}\n\n${hecho}`;
    } else {
      reply = `${quitarLineaPedido(reply)}\n\n${hecho}`;
    }
    via = 'harness-ejecutor';
  }

  return guardar({ ...base, reply, via, mode, ms: Date.now() - t0, herramientas: tools });
}

app.post('/api/turno', exigirMesaODesk, limitar(60), async (req, res) => {
  const s = sesionDe(req);
  const out = await correrTurno({
    ...req.body,
    correo: req.body?.correo || s?.correo,
    usuario: req.body?.usuario || req.body?.userName || s?.nombre,
    sesion: s,
  });
  if (out.error && !out.reply) {
    const code = out.error === 'message vacío' ? 400 : out.error.includes('configurado') ? 503 : 502;
    return res.status(code).json({ error: out.error, emocion: out.emocion, honesto: true });
  }
  return res.json({
    reply: out.reply,
    emocion: out.emocion,
    modelo: out.via === 'taller' || out.via.includes('gold') ? 'tools' : ULTRON_NODO_MODELO,
    via: out.via,
    mode: out.mode,
    ms: out.ms,
    tools: out.herramientas.length,
    herramientas: out.herramientas,
    foto: out.foto,
    honesto: true,
  });
});


/**
 * Turno en streaming (SSE). Eventos: `tools`, `emocion` (antes del primer texto), `delta`,
 * `replace` (raro: el harness cambió la respuesta ya enviada), `done` ({ reply, emocion, ms, via }), `error`.
 * Aplica el mismo harness que /api/turno: si el 27B pide una herramienta, se corre y se
 * vuelve a preguntar; el usuario nunca oye «PEDIR_HERRAMIENTA».
 */
app.post('/api/turno/stream', exigirMesaODesk, limitar(60), async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const s = sesionDe(req);
  const p = await prepararTurno({
    ...req.body,
    correo: req.body?.correo || s?.correo,
    usuario: req.body?.usuario || req.body?.userName || s?.nombre,
    sesion: s,
  });
  if (!p.message) {
    send('error', { error: 'message vacío' });
    return res.end();
  }
  const { t0, tools, system, message, quien, canal, hilo, mando } = p;
  const hechos = [...p.hechos];
  const terminar = async (texto: string, via: string, emocion: Emocion) => {
    send('done', { reply: texto, emocion, ms: Date.now() - t0, via });
    if (texto) await recordarTurno({ quien, rol: 'ultron', texto, canal });
    res.end();
  };
  send('tools', { tools });
  if (p.directo) {
    const emo = extraerEmocion(p.directo);
    send('emocion', { emocion: emo.emocion });
    send('delta', { text: emo.texto });
    return terminar(emo.texto, p.directoVia === 'taller' ? 'taller' : 'tools', emo.emocion);
  }
  if (!ULTRON_NODO_URL || !ULTRON_NODO_SECRETO) {
    const reply = sinCerebro(p.datos);
    send('emocion', { emocion: 'preocupado' });
    send('delta', { text: reply });
    return terminar(reply, 'tools-only', 'preocupado');
  }
  try {
    const r = await fetchNodo(`${ULTRON_NODO_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ultron-secreto': ULTRON_NODO_SECRETO },
      body: JSON.stringify({ model: ULTRON_NODO_MODELO, stream: true, messages: mensajesQwen(system, message, hechos, hilo) }),
      signal: AbortSignal.timeout(60000),
    });
    if (!r.ok || !r.body) {
      const raw = await r.text().catch(() => '');
      const reply = sinCerebro(p.datos);
      if (reply) {
        send('emocion', { emocion: 'preocupado' });
        send('delta', { text: reply });
        return terminar(reply, 'tools-fallback', 'preocupado');
      }
      send('error', { error: 'Qwen no contestó', status: r.status, raw: raw.slice(0, 200) });
      return res.end();
    }
    const reader = (r.body as any).getReader();
    const dec = new TextDecoder();
    let buf = '';
    let full = '';
    let cuerpo = '';
    let enviado = 0;
    let emocion: Emocion | null = null;
    let pedido = false;

    const procesar = (piece: string) => {
      full += piece;
      if (emocion === null) {
        const cierra = full.indexOf(']');
        if (full.trimStart().startsWith('[') && cierra === -1 && full.length < 40) return;
        emocion = extraerEmocion(full).emocion;
        send('emocion', { emocion });
      }
      cuerpo = extraerEmocion(full).texto;
      if (/PEDIR_HERRAMIENTA/i.test(cuerpo)) {
        pedido = true;
        return;
      }
      // Soltar solo hasta la última frase cerrada; lo que queda puede ser una línea de pedido.
      const corte = Math.max(cuerpo.lastIndexOf('. '), cuerpo.lastIndexOf('? '), cuerpo.lastIndexOf('! '), cuerpo.lastIndexOf('\n'));
      if (corte > enviado) {
        send('delta', { text: cuerpo.slice(enviado, corte + 1) });
        enviado = corte + 1;
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        const l = line.trim();
        if (!l) continue;
        try {
          const j = JSON.parse(l);
          const piece = j.message?.content || j.response || '';
          if (piece) procesar(piece);
        } catch {
          /* línea parcial */
        }
      }
    }
    if (buf.trim()) {
      try {
        const j = JSON.parse(buf.trim());
        const piece = j.message?.content || j.response || '';
        if (piece) procesar(piece);
      } catch {
        /* */
      }
    }
    if (emocion === null) {
      emocion = extraerEmocion(full).emocion;
      send('emocion', { emocion });
    }
    let reply = extraerEmocion(full).texto;
    let via = `${ULTRON_NODO_URL}/api/chat`;
    if (pedido) {
      const h = await bucleHarness({ reply, system, message, hechos, hilo, tools, mando });
      const e = extraerEmocion(h.reply);
      emocion = e.emocion;
      send('emocion', { emocion });
      reply = e.texto;
      via = h.via;
      if (enviado > 0 && !reply.startsWith(cuerpo.slice(0, enviado))) {
        send('replace', { text: reply });
        enviado = reply.length;
      }
    }
    if (!reply) reply = sinCerebro(p.datos);
    if (reply.length > enviado) send('delta', { text: reply.slice(enviado) });
    return terminar(reply, via, emocion);
  } catch (err: any) {
    send('error', { error: 'Qwen caído', message: String(err?.message || err).slice(0, 200) });
    res.end();
  }
});


app.get('/api/taller', exigirMesa, limitar(30), (_req, res) => {
  res.json({ honesto: true, canales: catalogoCanales() });
});

app.get('/api/sistema', exigirMesa, limitar(20), async (_req, res) => {
  const foto = await fotoSistema();
  res.json({ honesto: true, ...foto });
});

app.get('/api/tareas', exigirMesa, limitar(20), (_req, res) => {
  res.json({ honesto: true, tareas: listarTareas() });
});

app.get('/api/taller/archivo/:id', exigirMesa, limitar(30), (req, res) => {
  const buf = leerPdf(String(req.params.id || ''));
  if (!buf) return res.status(404).json({ error: 'PDF no encontrado', honesto: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${path.basename(String(req.params.id))}"`);
  return res.send(buf);
});


app.post('/api/ejecutar', exigirSesion, limitar(10), async (req, res) => {
  const quien = quienVerificado(req.body, sesionDe(req));
  if (!puedeCambiarSistema(quien)) {
    return res.status(403).json({ error: 'ACCESO: consulta. Solo José o Medardo con sesión corren el ejecutor.', honesto: true, ok: false });
  }
  if (!ejecutorActivo()) return res.status(503).json({ error: 'Ejecutor desactivado', honesto: true, ok: false });
  const codigo = String(req.body?.codigo || extraerPython(String(req.body?.texto || '')) || '');
  const r = await ejecutarCodigo(codigo);
  await registrarCambio({ quien, canal: 'mesa', que: `ejecutor (${r.via}) exit ${r.exit_code}` });
  return res.json({ ...r, honesto: true });
});


async function procesarTelegram(update: any) {
  const parsed = await parsearUpdateTelegram(update);
  if (!parsed) return;
  if (!telegramAutorizado(parsed.chatId, parsed.userId)) {
    console.warn('[ULTRON] telegram rechazado', parsed.chatId, parsed.userId, parsed.nombre);
    return;
  }
  if (parsed.comando === '/start') {
    const quien = resolverQuien({
      usuario: parsed.nombre,
      telegramUserId: parsed.userId,
      telegramChatId: parsed.chatId,
    });
    const bienvenida = quien
      ? mensajeBienvenidaUltron({ nombre: nombreDe(quien), quien })
      : ayudaTelegram();
    await telegramResponder(parsed.chatId, bienvenida);
    return;
  }
  if (parsed.comando === '/ayuda' || parsed.comando === '/help') {
    await telegramResponder(parsed.chatId, ayudaTelegram());
    return;
  }
  let texto = parsed.texto;
  if (parsed.comando === '/audio') texto = 'mándame audio del sistema';
  if (parsed.audio) {
    const oido = await transcribirAudio({ audio: parsed.audio.buffer, mime: parsed.audio.mime, language: 'es' });
    if (oido.texto) texto = oido.texto;
    else if (!texto) {
      await telegramResponder(parsed.chatId, oido.detalle);
      return;
    }
  }
  if (!texto && parsed.imageDataUrl) texto = '¿qué ves en esta imagen?';
  if (!texto && parsed.documento) texto = `Lee este PDF (${parsed.documento.filename}) y resume solo lo que dice. No inventes.`;
  const out = await correrTurno({
    message: texto,
    usuario: parsed.nombre,
    mode: 'TELEGRAM',
    canal: 'telegram',
    telegramUserId: parsed.userId,
    telegramChatId: parsed.chatId,
    historial: hiloTelegram(parsed.chatId),
    image: parsed.imageDataUrl,
    documento: parsed.documento,
  });
  const reply = out.reply || out.error || 'No pude contestar.';
  recordarTelegram(parsed.chatId, texto, reply);
  await telegramResponder(parsed.chatId, reply);
  const yaMandóVoz = out.herramientas.includes('voz') || out.herramientas.includes('urgente');
  const quiereVoz = parsed.comando === '/audio' || pideNotaDeVoz(texto);
  if (quiereVoz && !yaMandóVoz) {
    const audio = await notaDeVoz(reply.slice(0, 400));
    if (audio) await telegramVoz({ buf: audio, caption: 'ULTRON', chatId: parsed.chatId });
  }
}

app.post(['/api/telegram/webhook', '/api/telegram/webhook/'], limitar(40), async (req, res) => {
  if (!telegramWebhookSecretOk(req.headers['x-telegram-bot-api-secret-token'])) {
    return res.status(401).json({ ok: false, honesto: true });
  }
  res.json({ ok: true, honesto: true });
  try {
    await procesarTelegram(req.body);
  } catch (e: any) {
    console.warn('[ULTRON] telegram inbound', String(e?.message || e).slice(0, 180));
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');

    /*
     * LA RAÍZ ES EL PRODUCTO.
     *
     * Antes `/` servía siempre `index.html` —ULTRON FP— y Dr Electrum vivía escondido en
     * `/electrum.html`. Quien recibía «el enlace de Dr Electrum» aterrizaba en otra plataforma, con
     * otro nombre y otro color, y concluía razonablemente que le habían mandado el enlace
     * equivocado. Ahora la raíz es la página de quien sea este despliegue.
     */
    /*
     * Las redirecciones van ANTES de `express.static`, o no se ejecutan: el estático encuentra el
     * archivo y lo sirve sin dejar pasar la petición. Se descubrió probando: `/electrum.html`
     * devolvía 200 en vez de la redirección, y la página quedaba con dos direcciones.
     */
    const ajena = ES_ELECTRUM ? '/index.html' : '/electrum.html';
    // La página de la OTRA plataforma no se sirve: que exista el archivo no la hace parte de esto.
    app.get(ajena, (_req, res) => res.redirect(302, '/'));
    // Y la propia, por su nombre, también lleva a la raíz: una sola dirección por producto.
    app.get(`/${PAGINA_RAIZ}`, (_req, res) => res.redirect(302, '/'));

    app.use(express.static(distPath, { index: false }));

    app.get('*', (req, res) => {
      if (String(req.path || '').startsWith('/api/')) {
        return res.status(404).json({ error: 'no está', honesto: true });
      }
      res.sendFile(path.join(distPath, PAGINA_RAIZ));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(
      `[${PLATAFORMA === 'electrum' ? 'Dr Electrum FP' : 'ULTRON FP'}] :${PORT} — sirviendo ${PAGINA_RAIZ}` +
        `${ES_ELECTRUM ? ' · API de ULTRON cerrada' : ''}`
    );
    // Cada plataforma registra SU bot. Los dos desde el mismo proceso era la costura más fácil de
    // olvidar: un despliegue de Dr Electrum se quedaba con el webhook del bot de la junta.
    if (ES_ULTRON) {
      registrarWebhookTelegram()
        .then((r) => console.log('[ULTRON] telegram webhook', r.detalle))
        .catch((e) => console.warn('[ULTRON] telegram webhook', String(e?.message || e).slice(0, 160)));
    }
    if (ES_ELECTRUM && electrumBotListo()) {
      registrarWebhookElectrum()
        .then((r) => console.log('[electrum] telegram webhook', r.detalle))
        .catch((e) => console.warn('[electrum] telegram webhook', String(e?.message || e).slice(0, 160)));
    } else if (ES_ELECTRUM) {
      console.log('[electrum] bot apagado: falta ELECTRUM_BOT_TOKEN o ELECTRUM_WEBHOOK_SECRET.');
    }
    iniciarCentinela(180_000);
    cargarMemoria()
      .then(() => console.log('[ULTRON] memoria', estadoMemoria().detalle))
      .catch((e) => console.warn('[ULTRON] memoria', String(e?.message || e).slice(0, 160)));
  });
}

startServer();

