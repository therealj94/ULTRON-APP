/**
 * LA LÓGICA DE LA PANTALLA DEL CAMPO, sin pantalla.
 *
 * Lo que decide qué se manda, qué se enseña y qué se ofrece vive acá y no en `CampoScreen.tsx`
 * por la misma razón que `frases.ts`: este archivo no importa React Native ni Expo, así que se
 * prueba con node:test desde `tests/` sin teléfono. Lo que no se puede probar sin teléfono —el
 * GPS, la cámara, el audio— queda en la pantalla, lo más delgado posible.
 */

/** Una herramienta que usó el doctor, como la devuelve `/api/electrum/turno` (server/electrum/turno.ts). */
export type Traza = { herramienta: string; ok: boolean; resumen: string; ms?: number };

/** Un PDF que el doctor armó en el servidor (herramienta `informe_pdf`, server/electrum/manos.ts). */
export type InformeListo = { id: string; nombre: string; url: string; bytes: number };

export type EstadoInforme = { fase: 'listo' } | { fase: 'guardando' } | { fase: 'guardado'; carpeta: string };

/** Un renglón del hilo en la pantalla. */
export type TurnoCampo = {
  de: 'persona' | 'doctor';
  texto: string;
  panel?: string;
  traza?: Traza[];
  /** Lo que el servidor avisa al leer una foto («es una transcripción, no el original»). */
  avisos?: string[];
  informe?: InformeListo & { estado: EstadoInforme };
  /**
   * El renglón es un fallo: la frase de error del doctor, o la pregunta que no llegó a contestarse.
   * Se enseña, pero NO viaja en el hilo: el modelo no tiene por qué leer «No alcancé el servidor»
   * como si lo hubiera dicho él, ni una pregunta que nunca le llegó.
   */
  fallo?: boolean;
};

/** Lo que viaja con la pregunta (api.ts lo pasa a la forma del servidor). */
export type TurnoHilo = { de: 'persona' | 'doctor'; texto: string };

export function hiloParaMandar(turnos: TurnoCampo[]): TurnoHilo[] {
  return turnos.filter((t) => !t.fallo && t.texto.trim()).map((t) => ({ de: t.de, texto: t.texto }));
}

/* ------------------------------------------------------------------ la barra de estado */

export type SaludCampo = {
  viva: boolean;
  motivo?: string | null;
  concesiones?: number | null;
  quien?: string | null;
  nivel?: 'lee' | 'escribe' | 'mando' | null;
};

/** `null` = comprobando; `'fallo'` = no se alcanzó el servidor. */
export type EstadoSalud = SaludCampo | 'fallo' | null;

/**
 * El renglón debajo de la marca.
 *
 * El `motivo` del catastro caído NO se enseña: es el mensaje de Postgres tal cual («connect
 * ECONNREFUSED 10.208.3.14:5432»), que a quien está en el campo no le dice nada y le enseña una
 * dirección interna. Va al registro; en pantalla, qué significa.
 */
export function lineaDeEstado(estado: EstadoSalud): string {
  if (estado === null) return 'comprobando…';
  if (estado === 'fallo') return 'no alcancé el servidor · tocá para reintentar';
  const catastro = estado.viva
    ? `catastro conectado${estado.concesiones != null ? ` · ${estado.concesiones} concesiones` : ''}`
    : /ELECTRUM_DB_URL/.test(String(estado.motivo || ''))
      ? 'catastro sin configurar'
      : 'catastro fuera de línea';
  return `${catastro} · ${nombreDeNivel(estado.nivel)}`;
}

/**
 * La llave de demostración entra SIN nivel (`nivelDe(null)` en lib/acceso.ts devuelve null) y el
 * servidor la trata como consulta: no puede subir. Antes la barra no decía nada en ese caso.
 */
export function nombreDeNivel(nivel: SaludCampo['nivel']): string {
  return nivel === 'mando' ? 'mando' : nivel === 'escribe' ? 'trabajo' : 'consulta';
}

/**
 * ¿Puede esta credencial cargarle una foto al cerebro? `/api/electrum/subir` exige nivel de
 * escritura (`puedeEscribir`). `null` = todavía no se sabe (salud cargando o caída): entonces se
 * deja intentar y que decida el servidor, que para eso está.
 */
export function puedeCargar(estado: EstadoSalud): boolean | null {
  if (estado === null || estado === 'fallo') return null;
  return estado.nivel === 'escribe' || estado.nivel === 'mando';
}

/* ------------------------------------------------------------------ fotos */

const dos = (n: number) => String(n).padStart(2, '0');

/**
 * El nombre con que la foto entra al expediente. Hora LOCAL y legible: antes era la hora UTC con
 * los separadores quitados a medias («plano-2026-09-26182128.jpg»), seis horas corrida en Honduras.
 */
export function nombreDeFoto(d: Date): string {
  return `foto-${d.getFullYear()}${dos(d.getMonth() + 1)}${dos(d.getDate())}-${dos(d.getHours())}${dos(d.getMinutes())}${dos(d.getSeconds())}.jpg`;
}

/**
 * Los avisos de `/api/electrum/subir` que valen para la persona. Los de nivel `error` son para
 * quien depura («visión: gemini-caído»): la frase `dicho` ya explica en castellano qué pasó.
 */
export function avisosVisibles(avisos: unknown): string[] {
  if (!Array.isArray(avisos)) return [];
  return avisos
    .filter((a) => a && typeof a === 'object' && (a as { nivel?: unknown }).nivel !== 'error')
    .map((a) => String((a as { texto?: unknown }).texto ?? '').trim())
    .filter(Boolean)
    .slice(0, 3);
}

/* ------------------------------------------------------------------ informes */

/**
 * Solo se descargan rutas de informe del propio servidor. La URL la manda el servidor, pero va a
 * salir con la credencial en la cabecera: que un `ui` raro no pueda llevarla a otro sitio.
 */
export function rutaDeInforme(url: unknown): string | null {
  const u = String(url ?? '');
  return /^\/api\/electrum\/informe\/[A-Za-z0-9_-]{4,64}$/.test(u) ? u : null;
}

/**
 * El informe que viene en las órdenes de pantalla de un turno, si viene. La herramienta lo manda
 * como `{ informe: { id, nombre, url, bytes } }`; el teléfono lo ignoraba, y el doctor decía «ya
 * está listo para descargar» sin que hubiera nada que tocar.
 */
export function informeDe(ui: unknown): InformeListo | null {
  if (!Array.isArray(ui)) return null;
  for (const o of ui) {
    const inf = o && typeof o === 'object' ? (o as { informe?: unknown }).informe : null;
    if (!inf || typeof inf !== 'object') continue;
    const { id, nombre, url, bytes } = inf as Record<string, unknown>;
    const ruta = rutaDeInforme(url);
    if (typeof id !== 'string' || !ruta) continue;
    return { id, nombre: String(nombre || `informe-${id}.pdf`), url: ruta, bytes: Number(bytes) || 0 };
  }
  return null;
}

export function tamanoLegible(bytes: number): string {
  if (!(bytes > 0)) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

/**
 * «content://com.android.externalstorage.documents/tree/primary%3ADownload%2FInformes» →
 * «Download/Informes». Es lo que se le dice a la persona para que sepa dónde buscar el PDF.
 */
export function nombreDeCarpeta(uri: string): string {
  const cola = String(uri || '').split('/tree/')[1] || '';
  let d = cola;
  try {
    d = decodeURIComponent(cola);
  } catch {
    /* se queda como vino */
  }
  const ruta = d.includes(':') ? d.slice(d.indexOf(':') + 1) : d;
  return ruta.replace(/\/+$/, '') || 'la carpeta que elegiste';
}

/* ------------------------------------------------------------------ tiempo */

/** El error de un plazo vencido. Lleva «timeout» en el mensaje, que es lo que `frases.ts` reconoce. */
export class PlazoVencido extends Error {
  constructor(que: string) {
    super(`${que}: timeout`);
    this.name = 'PlazoVencido';
  }
}

/**
 * Una promesa con plazo. Hace falta para el GPS: `getCurrentPositionAsync` no trae tope, y bajo
 * árboles o en un cañón puede no fijar nunca — el botón se quedaba en «FIJANDO GPS…» sin salida.
 */
export function conPlazo<T>(p: Promise<T>, ms: number, que = 'plazo'): Promise<T> {
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const vence = new Promise<never>((_, rechazar) => {
    reloj = setTimeout(() => rechazar(new PlazoVencido(que)), ms);
  });
  return Promise.race([p, vence]).finally(() => clearTimeout(reloj));
}
