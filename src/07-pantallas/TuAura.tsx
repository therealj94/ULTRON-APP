/**
 * «TU AURA» EN LA WEB/PWA (auditoría del 4-oct, P4 y U1): las mismas entradas que la app Expo
 * (mobile/src/ajustes/{Correos,LoQueSeDeTi,Avisos}.tsx), contra las MISMAS APIs del servidor:
 *
 *   · Tus correos      GET/POST/DELETE /api/correo/cuentas, POST /api/correo/detectar y, por cuenta,
 *                      GET /api/correo/bandeja?cuenta=&n=1 para ver si responde. Un proveedor caído dice qué
 *                      pasó y qué hacer con ESA cuenta (reintentar o reconectarla), sin el texto crudo.
 *   · Lo que sé de ti  la memoria DEL SERVIDOR (no la local): GET /api/cerebro/conocer, «Corregir» y
 *                      «No usarlo / Usarlo» (PATCH /api/cerebro/conocer/:id) y «Olvidar»
 *                      (POST /api/cerebro/conocer/olvidar, por id y clave común, y la respuesta del perfil que lo
 *                      repite). Solo se quita de la vista con recibo durable.
 *   · Tus avisos       la iniciativa: GET/POST /api/avisos/preferencias.
 *
 * Antes la web solo tenía «Borrar conversación y memoria local», y el cerebro decía «conéctalo en Ajustes → Tus
 * correos», una pantalla que en la web no existía. La lógica que no dibuja es la del teléfono, tal cual
 * (compa/cerebro.ts, compa/avisos.ts, lib/supresion.ts), como ya hace 13-trabajo con lib/trabajos.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Bell, Brain, ChevronRight, Mail, RefreshCw } from 'lucide-react';
import { headersMesa } from '../10-infra/sesionCliente';
import { conDato, conocerDe, procedenciaDato, sinDato, type Conocer, type DatoPersona } from '../../mobile/src/compa/cerebro';
import { alternar, CLASES_AVISO, etiquetaClaseAviso, etiquetaLuego, prefsDeServidor, QUIETAS_RAPIDAS, idQuietas, zonaDelTelefono, type LuegoPref, type PreferenciasAvisos } from '../../mobile/src/compa/avisos';
import { campoDeDato, copiaConocer, reciboDurable, suprimirCopias, type EstadoSupresion } from '../../mobile/src/lib/supresion';

export type VistaAura = 'menu' | 'correos' | 'conocer' | 'avisos';

/** Un error de la API con el texto que dio el servidor (ya escrito para la persona) y su estado HTTP. */
class ErrorApi extends Error {
  constructor(
    mensaje: string,
    readonly status: number
  ) {
    super(mensaje);
  }
}

/** fetch con la sesión de la mesa. Lanza con el `error` del servidor (o uno honesto si no dijo nada). */
export async function pedirApi<T = any>(ruta: string, init: { method?: string; body?: string } = {}, ms = 15_000): Promise<T> {
  const ctl = new AbortController();
  const corte = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(ruta, { method: init.method || 'GET', body: init.body, signal: ctl.signal, headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headersMesa() } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new ErrorApi(String(j?.error || (r.status === 401 ? 'Entra con tu sesión.' : 'El servidor no pudo hacerlo ahora.')).slice(0, 240), r.status);
    return j as T;
  } catch (e: any) {
    if (e instanceof ErrorApi) throw e;
    throw new ErrorApi(e?.name === 'AbortError' ? 'El servidor tardó demasiado. Prueba otra vez.' : 'Sin conexión con el servidor.', 0);
  } finally {
    clearTimeout(corte);
  }
}
const apiSupresion = <T,>(ruta: string, init?: { method?: string; body?: string }, ms?: number) => pedirApi<T>(ruta, init, ms);

/* ------------------------------------------------------------------ piezas */

const CAMPO = 'w-full px-4 py-3 bg-(--aura-panel) border border-(--aura-borde) rounded-2xl text-[15px] text-(--aura-tinta) placeholder:text-(--aura-tinta-3) focus:border-(--aura-oro) focus:outline-none';
const BOTON_CHICO = 'min-h-[40px] px-3 rounded-full border border-(--aura-borde) bg-(--aura-panel) text-[14px] font-medium text-(--aura-tinta) hover:border-(--aura-oro) cursor-pointer disabled:opacity-50 disabled:cursor-default';

function Aviso({ texto, tono = 'aviso' }: { texto: string; tono?: 'aviso' | 'info' }) {
  if (!texto) return null;
  return (
    <p role={tono === 'aviso' ? 'alert' : 'status'} className={`text-[14px] ${tono === 'aviso' ? 'text-(--aura-barro-texto)' : 'text-(--aura-tinta-2)'}`}>
      {texto}
    </p>
  );
}

function Campo(p: { etiqueta: string; valor: string; onCambio: (v: string) => void; tipo?: string; id: string; autoComplete?: string; onEnter?: () => void }) {
  return (
    <label htmlFor={p.id} className="flex flex-col gap-1">
      <span className="text-[13px] font-medium text-(--aura-tinta-2)">{p.etiqueta}</span>
      <input
        id={p.id}
        type={p.tipo || 'text'}
        value={p.valor}
        autoComplete={p.autoComplete || 'off'}
        onChange={(e) => p.onCambio(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && p.onEnter) (e.preventDefault(), p.onEnter());
        }}
        className={CAMPO}
      />
    </label>
  );
}

function Interruptor(p: { etiqueta: string; detalle?: string; activo: boolean; onCambio: (v: boolean) => void; deshabilitado?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={p.activo}
      disabled={p.deshabilitado}
      onClick={() => p.onCambio(!p.activo)}
      className="w-full min-h-[52px] p-3 rounded-2xl border border-(--aura-borde) bg-(--aura-panel) flex items-center gap-3 text-left cursor-pointer hover:border-(--aura-oro) disabled:opacity-60"
    >
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] text-(--aura-tinta)">{p.etiqueta}</span>
        {p.detalle && <span className="block text-[13px] text-(--aura-tinta-2)">{p.detalle}</span>}
      </span>
      <span className={`relative w-12 h-7 rounded-full shrink-0 ${p.activo ? 'bg-(--aura-oro)' : 'bg-(--aura-panel-2) border border-(--aura-borde-campo)'}`} aria-hidden="true">
        <span className={`absolute top-1 w-5 h-5 rounded-full ${p.activo ? 'left-6 bg-(--aura-sobre-oro)' : 'left-1 bg-(--aura-tinta-2)'}`} />
      </span>
      <span className="sr-only">{p.activo ? 'activado' : 'desactivado'}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ el menú */

const ENTRADAS: Array<{ id: Exclude<VistaAura, 'menu'>; titulo: string; detalle: string; Icono: typeof Mail }> = [
  { id: 'correos', titulo: 'Tus correos', detalle: 'Conectar, ver si responden, reconectar o quitar', Icono: Mail },
  { id: 'conocer', titulo: 'Lo que sé de ti', detalle: 'Lo que AU-RA guarda en el servidor: corregir, «No usarlo» u olvidar', Icono: Brain },
  { id: 'avisos', titulo: 'Tus avisos', detalle: 'Cuándo y cómo te avisa lo que propone por su cuenta', Icono: Bell },
];

export function MenuTuAura({ onAbrir }: { onAbrir: (v: Exclude<VistaAura, 'menu'>) => void }) {
  return (
    <nav aria-label="Tu AURA" className="flex flex-col gap-2">
      {ENTRADAS.map((e) => (
        <button key={e.id} type="button" onClick={() => onAbrir(e.id)} className="w-full min-h-[64px] p-3 rounded-2xl border border-(--aura-borde) bg-(--aura-panel) hover:border-(--aura-oro) flex items-center gap-3 text-left cursor-pointer">
          <e.Icono className="w-5 h-5 text-(--aura-oro-texto) shrink-0" aria-hidden="true" />
          <span className="flex-1 min-w-0">
            <span className="block text-[16px] font-medium text-(--aura-tinta)">{e.titulo}</span>
            <span className="block text-[13px] text-(--aura-tinta-2)">{e.detalle}</span>
          </span>
          <ChevronRight className="w-4 h-4 text-(--aura-tinta-3)" aria-hidden="true" />
        </button>
      ))}
    </nav>
  );
}

/* ------------------------------------------------------------------ tus correos */

type Cuenta = { id: string; correo: string; proveedor: { nombre: string; auth: 'clave' | 'microsoft' } };
type Proveedor = { nombre: string; auth: 'clave' | 'microsoft'; ayuda: string; fuente: string; imap: { host: string }; smtp: { host: string } };
type EstadoCuenta = { estado: 'probando' } | { estado: 'responde'; total: number | null } | { estado: 'fallo'; mensaje: string; siguiente: string } | { estado: 'sin-saber'; mensaje: string };

/** Lo que dice el servidor de una cuenta que no abrió, en palabras: qué pasó y qué hacer con ESA cuenta. */
function estadoDeBandeja(j: any, cuentaId: string): EstadoCuenta {
  const err = (Array.isArray(j?.errores) ? j.errores : []).find((e: any) => e?.cuentaId === cuentaId);
  if (err) {
    const siguiente = typeof err.siguiente === 'string' ? err.siguiente : 'reintentar';
    // `mensaje` es el fallo seguro (sin lo crudo); un servidor viejo solo trae `error`.
    return { estado: 'fallo', mensaje: String(err.mensaje || err.error || 'No respondió.'), siguiente };
  }
  const cob = (Array.isArray(j?.cobertura) ? j.cobertura : []).find((c: any) => c?.cuentaId === cuentaId);
  return { estado: 'responde', total: cob && Number.isFinite(Number(cob.total)) && cob.total !== null ? Number(cob.total) : null };
}

export function PanelCorreos(p: { pedidoPendiente?: string | null; onRetomar?: () => void }) {
  const [cuentas, setCuentas] = useState<Cuenta[] | null>(null);
  const [sinLeer, setSinLeer] = useState('');
  const [estados, setEstados] = useState<Record<string, EstadoCuenta>>({});
  const [correo, setCorreo] = useState('');
  const [clave, setClave] = useState('');
  const [prov, setProv] = useState<Proveedor | null>(null);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [recienConectada, setRecienConectada] = useState('');
  const campoCorreo = useRef<HTMLDivElement>(null);

  const probar = useCallback(async (c: Cuenta) => {
    setEstados((m) => ({ ...m, [c.id]: { estado: 'probando' } }));
    try {
      const j = await pedirApi(`/api/correo/bandeja?cuenta=${encodeURIComponent(c.id)}&n=1`, {}, 30_000);
      setEstados((m) => ({ ...m, [c.id]: estadoDeBandeja(j, c.id) }));
    } catch (e: any) {
      // No se pudo preguntar (red, servidor): no es «la cuenta falló» ni «responde».
      setEstados((m) => ({ ...m, [c.id]: { estado: 'sin-saber', mensaje: e?.message || 'No pude comprobarla ahora.' } }));
    }
  }, []);

  const refrescar = useCallback(async () => {
    try {
      const r = await pedirApi<{ cuentas: Cuenta[] }>('/api/correo/cuentas', {}, 10_000);
      const lista = Array.isArray(r.cuentas) ? r.cuentas : [];
      setCuentas(lista);
      setSinLeer('');
      for (const c of lista) void probar(c);
      return lista;
    } catch (e: any) {
      // «No pude leer» NO es «no tienes correos» (auditoría 3-oct, COM02): lo que se sabía se queda.
      setSinLeer(e?.message || 'No pude leer tus correos guardados.');
      return null;
    }
  }, [probar]);

  useEffect(() => {
    void refrescar();
  }, [refrescar]);

  const detectar = async () => {
    setError('');
    setOcupado(true);
    try {
      const r = await pedirApi<{ proveedor: Proveedor }>('/api/correo/detectar', { method: 'POST', body: JSON.stringify({ correo: correo.trim() }) });
      setProv(r.proveedor);
    } catch (e: any) {
      setError(e?.message || 'No pude revisar esa dirección.');
    } finally {
      setOcupado(false);
    }
  };

  const conectar = async () => {
    setError('');
    setOcupado(true);
    try {
      await pedirApi('/api/correo/cuentas', { method: 'POST', body: JSON.stringify({ correo: correo.trim(), clave }) }, 45_000);
      setRecienConectada(correo.trim().toLowerCase());
      setCorreo('');
      setClave('');
      setProv(null);
      await refrescar();
    } catch (e: any) {
      setError(e?.message || 'No pude conectarlo.');
    } finally {
      setOcupado(false);
    }
  };

  const quitar = async (c: Cuenta) => {
    setError('');
    try {
      await pedirApi(`/api/correo/cuentas/${encodeURIComponent(c.id)}`, { method: 'DELETE' });
      await refrescar();
    } catch (e: any) {
      setError(e?.message || 'No pude quitarla.');
    }
  };

  /** Reconectar ESA cuenta: el formulario con su dirección (la clave nueva la escribe la persona). */
  const reconectar = (c: Cuenta) => {
    setCorreo(c.correo);
    setClave('');
    setProv(null);
    setError('');
    requestAnimationFrame(() => campoCorreo.current?.querySelector('input')?.focus());
  };

  const esMs = prov?.auth === 'microsoft';
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[14px] text-(--aura-tinta-2)">AU-RA los revisa y te ayuda a contestar. Nunca manda nada sin que le digas que sí. La clave se guarda cifrada en el servidor.</p>
      <Aviso texto={sinLeer ? `${sinLeer} Si ya conectaste uno, sigue ahí: prueba otra vez antes de volver a conectarlo.` : ''} />

      {p.pedidoPendiente && recienConectada && (
        <div className="aura-tarjeta honda p-3 flex flex-col gap-2" role="status">
          <p className="text-[15px] text-(--aura-tinta)">Ya está conectado {recienConectada}. ¿Sigo con lo que me pediste?</p>
          <p className="text-[14px] text-(--aura-tinta-2)">«{p.pedidoPendiente}»</p>
          <button type="button" className="aura-primario self-start" onClick={p.onRetomar}>
            Retomar «{p.pedidoPendiente.length > 40 ? `${p.pedidoPendiente.slice(0, 40)}…` : p.pedidoPendiente}»
          </button>
        </div>
      )}

      {cuentas === null && !sinLeer && <p className="text-[14px] text-(--aura-tinta-2)">Leyendo tus correos…</p>}
      {cuentas && cuentas.length === 0 && <p className="text-[14px] text-(--aura-tinta-2)">Todavía no conectaste ningún correo. Sirve Gmail, Outlook, Yahoo, iCloud o el de tu empresa.</p>}
      {!!cuentas?.length && (
        <ul className="flex flex-col gap-2" aria-label="Correos conectados">
          {cuentas.map((c) => {
            const e = estados[c.id];
            return (
              <li key={c.id} data-cuenta={c.id} className="aura-tarjeta honda p-3 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex-1 min-w-0">
                    <span className="block text-[15px] text-(--aura-tinta) truncate">{c.correo}</span>
                    <span className="block text-[13px] text-(--aura-tinta-3)">{c.proveedor?.nombre}</span>
                  </span>
                  <button type="button" className={BOTON_CHICO} onClick={() => void quitar(c)} aria-label={`Quitar ${c.correo}`}>
                    Quitar
                  </button>
                </div>
                {e?.estado === 'probando' && <p className="text-[13px] text-(--aura-tinta-2)">Comprobando si responde…</p>}
                {e?.estado === 'responde' && <p className="text-[13px] text-(--aura-salvia-texto)">Responde{e.total !== null ? ` · ${e.total} en la bandeja de entrada` : ''}</p>}
                {e?.estado === 'sin-saber' && (
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[13px] text-(--aura-tinta-2)">No pude comprobarla: {e.mensaje}</p>
                    <button type="button" className={BOTON_CHICO} onClick={() => void probar(c)}>
                      <RefreshCw className="w-3.5 h-3.5 inline mr-1" aria-hidden="true" />
                      Reintentar
                    </button>
                  </div>
                )}
                {e?.estado === 'fallo' && (
                  <div className="flex flex-col gap-2">
                    <p role="alert" className="text-[13px] text-(--aura-barro-texto)">
                      {e.mensaje}. {e.siguiente === 'reconectar' ? 'Hay que reconectarla: escribe la clave nueva (o una contraseña de aplicación).' : e.siguiente === 'revisar-servidor' ? 'Revisa el servidor de esta cuenta.' : 'Puede ser algo pasajero: prueba otra vez en un momento.'} Mientras tanto no sé qué hay en esta cuenta.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {e.siguiente === 'reintentar' ? (
                        <button type="button" className={BOTON_CHICO} onClick={() => void probar(c)} aria-label={`Reintentar ${c.correo}`}>
                          Reintentar
                        </button>
                      ) : (
                        <button type="button" className={BOTON_CHICO} onClick={() => reconectar(c)} aria-label={`Reconectar ${c.correo}`}>
                          Reconectar
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <section aria-labelledby="correo-conectar" className="flex flex-col gap-3">
        <h4 id="correo-conectar" className="aura-sobretitulo">
          Conectar un correo
        </h4>
        <div ref={campoCorreo}>
          <Campo
            id="aura-correo-direccion"
            etiqueta="Tu dirección de correo"
            tipo="email"
            autoComplete="email"
            valor={correo}
            onCambio={(v) => {
              setCorreo(v);
              setProv(null);
              setError('');
            }}
            onEnter={() => /@.+\./.test(correo) && void detectar()}
          />
        </div>
        {!prov ? (
          <button type="button" className="aura-secundario self-start" disabled={ocupado || !/@.+\./.test(correo)} onClick={() => void detectar()}>
            Continuar
          </button>
        ) : esMs ? (
          <p className="text-[14px] text-(--aura-tinta-2)">
            {prov.nombre}: las cuentas de Microsoft entran con un código desde la app del teléfono (Ajustes → Tus correos → «Entrar con Microsoft»). Desde aquí puedes conectarla con una contraseña de aplicación de Outlook si tu cuenta lo permite.
          </p>
        ) : (
          <>
            <p className="text-[14px] text-(--aura-tinta-2)">
              {prov.nombre} · {prov.ayuda}
            </p>
            <Campo id="aura-correo-clave" etiqueta="Clave (o contraseña de aplicación)" tipo="password" autoComplete="current-password" valor={clave} onCambio={setClave} onEnter={() => clave && void conectar()} />
            <button type="button" className="aura-primario self-start" disabled={ocupado || !clave} onClick={() => void conectar()}>
              {ocupado ? 'Probando…' : 'Conectar'}
            </button>
          </>
        )}
        <Aviso texto={error} />
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ lo que sé de ti (memoria del servidor) */

export function PanelConocer() {
  const [conocer, setConocer] = useState<Conocer | null>(null);
  const [error, setError] = useState('');
  const [corrigiendo, setCorrigiendo] = useState<{ id: string; texto: string } | null>(null);
  const [olvidando, setOlvidando] = useState<string | null>(null);
  const [supresion, setSupresion] = useState<Record<string, EstadoSupresion>>({});
  const [guardando, setGuardando] = useState<string | null>(null);

  const leer = useCallback(async () => {
    try {
      setConocer(conocerDe(await pedirApi('/api/cerebro/conocer')));
      setError('');
    } catch (e: any) {
      // No se pudo leer: NO es «no sé nada de ti».
      setError(e?.message || 'No pude leer lo que sé de ti.');
    }
  }, []);
  useEffect(() => {
    void leer();
  }, [leer]);

  /** Corregir o limitar: va al servidor, que también cambia los usos activos del dato. Sin recibo durable lo dice. */
  const cambiar = async (d: DatoPersona, cuerpo: { dato: string } | { alcance: 'general' | 'limitado' }) => {
    setGuardando(d.id);
    setError('');
    try {
      const r = await pedirApi<{ dato?: DatoPersona; durable?: boolean }>(`/api/cerebro/conocer/${encodeURIComponent(d.id)}`, { method: 'PATCH', body: JSON.stringify(cuerpo) });
      if (r?.dato) setConocer((c) => (c ? conDato(c, r.dato!) : c));
      setCorrigiendo(null);
      if (r?.durable !== true) setError('Quedó cambiado, pero el servidor todavía no confirmó que lo guardó de forma segura.');
    } catch (e: any) {
      setError(e?.message || 'No se pudo guardar.');
    } finally {
      setGuardando(null);
    }
  };

  /** «Olvidar» (PRIV01): el dato, sus copias con la misma clave y la respuesta del perfil; solo con recibo durable. */
  const olvidar = async (d: DatoPersona) => {
    setOlvidando(null);
    setError('');
    setSupresion((m) => ({ ...m, [d.id]: 'pendiente' }));
    const campo = campoDeDato(d);
    const clave = d.clave && d.categoria ? { categoria: d.categoria, clave: d.clave } : null;
    const r = await suprimirCopias([
      copiaConocer(apiSupresion, { ids: [d.id], claves: clave ? [clave] : [] }),
      ...(campo ? [{ nombre: 'perfil', borrar: async () => reciboDurable(await pedirApi('/api/perfil', { method: 'PUT', body: JSON.stringify({ encuesta: { [campo]: '' } }) })) }] : []),
    ]);
    setSupresion((m) => ({ ...m, [d.id]: r.estado }));
    if (r.estado === 'confirmado') {
      setConocer((c) => (c ? sinDato(c, d.id) : c));
      return;
    }
    setError('No quedó confirmado que se borró de forma segura, así que lo dejo a la vista. Vuelve a tocar «Olvidar» en un momento.');
  };

  const conDatos = (conocer?.categorias || []).filter((k) => k.datos.length);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[14px] text-(--aura-tinta-2)">Lo que AU-RA fue aprendiendo al hablar contigo, guardado en el servidor. Cada dato se puede corregir, dejar sin usar u olvidar en todas sus copias.</p>
      <Aviso texto={error} />
      {conocer === null && !error && <p className="text-[14px] text-(--aura-tinta-2)">Leyendo…</p>}
      {conocer && conDatos.length === 0 && <p className="text-[14px] text-(--aura-tinta-2)">Todavía no sé mucho de ti. Lo que me cuentes al hablar aparece aquí.</p>}
      {conDatos.map((k) => (
        <section key={k.id} aria-label={k.nombre} className="flex flex-col gap-2">
          <h4 className="aura-sobretitulo">{k.nombre}</h4>
          <ul className="flex flex-col gap-2">
            {k.datos.map((d) => (
              <li key={d.id} className="aura-tarjeta honda p-3 flex flex-col gap-2">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <span className={`block text-[15px] ${d.alcance === 'limitado' ? 'text-(--aura-tinta-3)' : 'text-(--aura-tinta)'}`}>{d.dato}</span>
                    <span className="block text-[13px] text-(--aura-tinta-3)">
                      {supresion[d.id] === 'pendiente' ? 'Olvidando…' : supresion[d.id] === 'error' ? 'Sin confirmar que se borró' : procedenciaDato(d, 'es')}
                    </span>
                  </div>
                  {olvidando !== d.id && supresion[d.id] !== 'pendiente' && (
                    <button type="button" className={BOTON_CHICO} onClick={() => setOlvidando(d.id)} aria-label={`Olvidar: ${d.dato}`}>
                      Olvidar
                    </button>
                  )}
                </div>
                {olvidando === d.id && (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="aura-secundario peligro" onClick={() => void olvidar(d)}>
                      Olvidarlo
                    </button>
                    <button type="button" className={BOTON_CHICO} onClick={() => setOlvidando(null)}>
                      Cancelar
                    </button>
                  </div>
                )}
                {corrigiendo?.id === d.id ? (
                  <div className="flex flex-col gap-2">
                    <Campo id={`aura-corregir-${d.id}`} etiqueta="Corregido" valor={corrigiendo.texto} onCambio={(t) => setCorrigiendo({ id: d.id, texto: t.slice(0, 240) })} />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="aura-primario"
                        disabled={guardando === d.id || corrigiendo.texto.trim().length < 4 || corrigiendo.texto.trim() === d.dato}
                        onClick={() => void cambiar(d, { dato: corrigiendo.texto.trim() })}
                      >
                        Guardar
                      </button>
                      <button type="button" className={BOTON_CHICO} onClick={() => setCorrigiendo(null)}>
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : olvidando !== d.id ? (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={BOTON_CHICO} onClick={() => setCorrigiendo({ id: d.id, texto: d.dato })}>
                      Corregir
                    </button>
                    <button type="button" className={BOTON_CHICO} disabled={guardando === d.id} onClick={() => void cambiar(d, { alcance: d.alcance === 'limitado' ? 'general' : 'limitado' })}>
                      {d.alcance === 'limitado' ? 'Usarlo' : 'No usarlo'}
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ tus avisos (iniciativa) */

export function PanelAvisos() {
  const [prefs, setPrefs] = useState<PreferenciasAvisos | null>(null);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const leer = useCallback(async () => {
    try {
      const p = prefsDeServidor(await pedirApi('/api/avisos/preferencias'));
      if (!p) throw new Error('mal');
      setPrefs(p);
      setError('');
    } catch {
      // No se pudo leer: NO es «todo apagado» ni «lo de por omisión».
      setError('No pude leer tus avisos. Prueba en un momento.');
    }
  }, []);
  useEffect(() => {
    void leer();
  }, [leer]);

  const guardar = async (cambios: Record<string, unknown>) => {
    setOcupado(true);
    try {
      const r = await pedirApi('/api/avisos/preferencias', { method: 'POST', body: JSON.stringify(cambios) });
      const p = prefsDeServidor(r);
      if (p) setPrefs(p);
      else await leer();
      setError('');
    } catch (e: any) {
      setError(e?.message || 'No pude guardar el cambio.');
    } finally {
      setOcupado(false);
    }
  };

  const zona = zonaDelTelefono();
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[14px] text-(--aura-tinta-2)">Como mucho uno al día si no es urgente, y nada si no hay novedad.</p>
      <Aviso texto={error} />
      {prefs && (
        <>
          <Interruptor etiqueta="Avisarme" detalle={prefs.apagado ? 'Apagados: lo que estaba por salir se canceló' : 'AU-RA te avisa lo que propone'} activo={!prefs.apagado} deshabilitado={ocupado} onCambio={(v) => void guardar({ apagado: !v })} />
          <Interruptor etiqueta="Menos avisos" detalle="Uno cada tres días como mucho" activo={prefs.cadaDias > 1} deshabilitado={ocupado} onCambio={(v) => void guardar({ menosAvisos: v })} />
          <section aria-labelledby="avisos-horario" className="flex flex-col gap-2">
            <h4 id="avisos-horario" className="aura-sobretitulo">
              Horas quietas · {prefs.zona}
            </h4>
            <div role="radiogroup" aria-labelledby="avisos-horario" className="aura-segmento">
              {QUIETAS_RAPIDAS.map((q) => (
                <button key={q.id} type="button" role="radio" aria-checked={idQuietas(prefs.quietas) === q.id} disabled={ocupado} onClick={() => void guardar({ quietas: { desde: q.desde, hasta: q.hasta } })}>
                  {q.desde}–{q.hasta}
                </button>
              ))}
            </div>
            {zona && zona !== prefs.zona && (
              <button type="button" className={BOTON_CHICO + ' self-start'} disabled={ocupado} onClick={() => void guardar({ zona })}>
                Usar la zona de este navegador ({zona})
              </button>
            )}
          </section>
          <section aria-labelledby="avisos-luego" className="flex flex-col gap-2">
            <h4 id="avisos-luego" className="aura-sobretitulo">
              Cuando digo «Luego»
            </h4>
            <div role="radiogroup" aria-labelledby="avisos-luego" className="aura-segmento">
              {(['2h', 'tarde', 'manana'] as LuegoPref[]).map((l) => (
                <button key={l} type="button" role="radio" aria-checked={prefs.luego === l} disabled={ocupado} onClick={() => void guardar({ luego: l })}>
                  {etiquetaLuego(l, 'es')}
                </button>
              ))}
            </div>
          </section>
          <section aria-labelledby="avisos-clases" className="flex flex-col gap-2">
            <h4 id="avisos-clases" className="aura-sobretitulo">
              No quiero avisos de…
            </h4>
            <div className="flex flex-wrap gap-2">
              {CLASES_AVISO.map((c) => (
                <button key={c} type="button" aria-pressed={prefs.clasesApagadas.includes(c)} disabled={ocupado} className={BOTON_CHICO} onClick={() => void guardar({ clasesApagadas: alternar(prefs.clasesApagadas, c) })}>
                  {etiquetaClaseAviso(c, 'es')}
                </button>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ la pestaña entera */

const TITULOS: Record<Exclude<VistaAura, 'menu'>, string> = { correos: 'Tus correos', conocer: 'Lo que sé de ti', avisos: 'Tus avisos' };

export function TuAura(p: { vista: VistaAura; onVista: (v: VistaAura) => void; pedidoPendiente?: string | null; onRetomar?: () => void }) {
  if (p.vista === 'menu') return <MenuTuAura onAbrir={p.onVista} />;
  return (
    <section aria-labelledby="tu-aura-titulo" className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button type="button" className="aura-redondo plano" onClick={() => p.onVista('menu')} aria-label="Volver a Tu AURA">
          <ArrowLeft className="w-5 h-5" aria-hidden="true" />
        </button>
        <h3 id="tu-aura-titulo" className="font-display font-semibold text-[18px] text-(--aura-tinta)">
          {TITULOS[p.vista]}
        </h3>
      </div>
      {p.vista === 'correos' && <PanelCorreos pedidoPendiente={p.pedidoPendiente} onRetomar={p.onRetomar} />}
      {p.vista === 'conocer' && <PanelConocer />}
      {p.vista === 'avisos' && <PanelAvisos />}
    </section>
  );
}
