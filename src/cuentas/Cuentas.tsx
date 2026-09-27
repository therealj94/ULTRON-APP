/**
 * LAS PANTALLAS DE CUENTAS, COMPARTIDAS POR AU-RA FP Y DR ELECTRUM.
 *
 * Cada web las pinta con su propio `Tema`, pero el comportamiento es uno solo, igual que el servidor
 * (server/cuentas-rutas.ts): olvidé mi contraseña, poner la clave desde el enlace del correo, cambiarla
 * con la sesión abierta, pedir acceso y —para quien aprueba— la lista de solicitudes.
 */
import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';

export type Tema = {
  campo: string;
  boton: string;
  botonStyle?: CSSProperties;
  secundario: string;
  enlace: string;
  titulo: string;
  texto: string;
  error: string;
  ok: string;
  tarjeta: string;
};

export type EnlaceUrl = { tipo: 'restablecer' | 'activar'; token: string } | { tipo: 'solicitudes' } | null;

/** Lo que trae la dirección desde un correo: ?restablecer=, ?activar= o ?solicitudes=1. */
export function enlaceEnLaUrl(buscar: string = typeof location !== 'undefined' ? location.search : ''): EnlaceUrl {
  const p = new URLSearchParams(buscar);
  const r = p.get('restablecer');
  if (r) return { tipo: 'restablecer', token: r };
  const a = p.get('activar');
  if (a) return { tipo: 'activar', token: a };
  if (p.get('solicitudes')) return { tipo: 'solicitudes' };
  return null;
}

/**
 * Se saca el enlace de la barra de direcciones apenas se lee: que no quede en el historial ni viaje
 * como «referer» a ningún otro sitio que cargue la página.
 */
export function quitarEnlaceDeLaUrl() {
  try {
    const u = new URL(location.href);
    for (const k of ['restablecer', 'activar', 'solicitudes']) u.searchParams.delete(k);
    history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
  } catch {
    /* sin history: no pasa nada grave */
  }
}

async function llamar(ruta: string, cuerpo?: unknown, headers: Record<string, string> = {}): Promise<{ ok: boolean; status: number; json: any }> {
  try {
    const r = await fetch(ruta, {
      method: cuerpo === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    const json = await r.json().catch(() => ({}));
    return { ok: r.ok && json?.ok !== false, status: r.status, json };
  } catch {
    return { ok: false, status: 0, json: { error: 'No alcancé el servidor. Revisá la conexión y volvé a intentarlo.' } };
  }
}

function Aviso({ tema, tipo, children }: { tema: Tema; tipo: 'error' | 'ok'; children: ReactNode }) {
  return (
    <div className={tipo === 'error' ? tema.error : tema.ok} role={tipo === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

const REGLAS = 'Mínimo 10 caracteres. Una frase que recuerdes sirve mejor que una palabra rara.';

/* ------------------------------------------------------------------ olvidé */

export function OlvideClave({ tema, correoInicial = '', onVolver }: { tema: Tema; correoInicial?: string; onVolver: () => void }) {
  const [correo, setCorreo] = useState(correoInicial);
  const [yendo, setYendo] = useState(false);
  const [listo, setListo] = useState('');
  const [fallo, setFallo] = useState('');
  async function enviar(e: FormEvent) {
    e.preventDefault();
    setYendo(true);
    setFallo('');
    const r = await llamar('/api/ultron/clave/olvide', { correo: correo.trim() });
    setYendo(false);
    if (r.ok) setListo(r.json.message);
    else setFallo(r.json?.error || 'No pude mandar el enlace. Probá en un momento.');
  }
  return (
    <div className="space-y-3">
      <h2 className={tema.titulo}>¿Olvidaste tu contraseña?</h2>
      {listo ? (
        <Aviso tema={tema} tipo="ok">
          {listo}
        </Aviso>
      ) : (
        <form onSubmit={enviar} className="space-y-3">
          <p className={tema.texto}>Escribí tu correo y te mandamos un enlace para poner una contraseña nueva.</p>
          <input className={tema.campo} type="email" autoComplete="username" aria-label="Correo" placeholder="tu correo" value={correo} onChange={(e) => setCorreo(e.target.value)} disabled={yendo} required />
          <button type="submit" className={tema.boton} style={tema.botonStyle} disabled={yendo || !correo.trim()}>
            {yendo ? 'Enviando…' : 'Enviarme el enlace'}
          </button>
        </form>
      )}
      {fallo && (
        <Aviso tema={tema} tipo="error">
          {fallo}
        </Aviso>
      )}
      <button type="button" className={tema.enlace} onClick={onVolver}>
        Volver a entrar
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ pedir acceso */

export function SolicitarAcceso({ tema, producto, onVolver }: { tema: Tema; producto: string; onVolver: () => void }) {
  const [nombre, setNombre] = useState('');
  const [correo, setCorreo] = useState('');
  const [motivo, setMotivo] = useState('');
  const [yendo, setYendo] = useState(false);
  const [listo, setListo] = useState('');
  const [fallo, setFallo] = useState('');
  async function enviar(e: FormEvent) {
    e.preventDefault();
    setYendo(true);
    setFallo('');
    const r = await llamar('/api/ultron/cuentas/solicitar', { nombre: nombre.trim(), correo: correo.trim(), motivo: motivo.trim() });
    setYendo(false);
    if (r.ok) setListo(r.json.message);
    else setFallo(r.status === 429 ? 'Demasiadas solicitudes desde esta conexión. Probá más tarde.' : r.json?.error || 'No pude mandar la solicitud.');
  }
  return (
    <div className="space-y-3">
      <h2 className={tema.titulo}>Solicitar acceso</h2>
      {listo ? (
        <Aviso tema={tema} tipo="ok">
          {listo}
        </Aviso>
      ) : (
        <form onSubmit={enviar} className="space-y-3">
          <p className={tema.texto}>{producto} es privado. Tu solicitud la revisa la administración de Orden Global; si la aprueba, te llega un correo para crear tu contraseña.</p>
          <input className={tema.campo} autoComplete="name" aria-label="Nombre completo" placeholder="nombre completo" value={nombre} onChange={(e) => setNombre(e.target.value)} disabled={yendo} required />
          <input className={tema.campo} type="email" autoComplete="email" aria-label="Correo" placeholder="tu correo" value={correo} onChange={(e) => setCorreo(e.target.value)} disabled={yendo} required />
          <textarea className={`${tema.campo} min-h-[84px] resize-y`} aria-label="Para qué necesitás el acceso" placeholder="para qué necesitás el acceso (institución, cargo, proyecto)" value={motivo} onChange={(e) => setMotivo(e.target.value)} disabled={yendo} maxLength={600} required />
          <button type="submit" className={tema.boton} style={tema.botonStyle} disabled={yendo || !nombre.trim() || !correo.trim() || motivo.trim().length < 5}>
            {yendo ? 'Enviando…' : 'Enviar solicitud'}
          </button>
        </form>
      )}
      {fallo && (
        <Aviso tema={tema} tipo="error">
          {fallo}
        </Aviso>
      )}
      <button type="button" className={tema.enlace} onClick={onVolver}>
        Volver a entrar
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ poner la clave desde el correo */

export function PonerClave({
  tema,
  tipo,
  token,
  onListo,
  onPedirOtro,
}: {
  tema: Tema;
  tipo: 'restablecer' | 'activar';
  token: string;
  onListo: (sesion: string) => void;
  onPedirOtro: () => void;
}) {
  const [correo, setCorreo] = useState<string | null>(null);
  const [vencido, setVencido] = useState('');
  const [nueva, setNueva] = useState('');
  const [otra, setOtra] = useState('');
  const [yendo, setYendo] = useState(false);
  const [fallo, setFallo] = useState('');
  useEffect(() => {
    void llamar(`/api/ultron/clave/enlace?token=${encodeURIComponent(token)}`).then((r) => {
      if (r.ok) setCorreo(r.json.correo);
      else setVencido(r.json?.error || 'El enlace ya se usó o venció.');
    });
  }, [token]);
  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (nueva !== otra) return setFallo('Las dos contraseñas no coinciden.');
    setYendo(true);
    setFallo('');
    const r = await llamar('/api/ultron/clave/restablecer', { token, clave: nueva });
    setYendo(false);
    if (r.ok && r.json.token) return onListo(String(r.json.token));
    if (r.status === 410) setVencido(r.json?.error || 'El enlace ya se usó o venció.');
    else setFallo(r.json?.error || 'No pude guardar la contraseña.');
  }
  const titulo = tipo === 'activar' ? 'Creá tu contraseña' : 'Contraseña nueva';
  return (
    <div className="space-y-3">
      <h2 className={tema.titulo}>{titulo}</h2>
      {vencido ? (
        <>
          <Aviso tema={tema} tipo="error">
            {vencido}
          </Aviso>
          <button type="button" className={tema.enlace} onClick={onPedirOtro}>
            Pedir un enlace nuevo
          </button>
        </>
      ) : correo === null ? (
        <p className={tema.texto} role="status">
          Comprobando el enlace…
        </p>
      ) : (
        <form onSubmit={enviar} className="space-y-3">
          <p className={tema.texto}>
            Para <b>{correo}</b>. {REGLAS}
          </p>
          <input type="email" autoComplete="username" value={correo} readOnly hidden />
          <input className={tema.campo} type="password" autoComplete="new-password" aria-label="Contraseña nueva" placeholder="contraseña nueva" value={nueva} onChange={(e) => setNueva(e.target.value)} disabled={yendo} required minLength={10} />
          <input className={tema.campo} type="password" autoComplete="new-password" aria-label="Repetir la contraseña" placeholder="repetila" value={otra} onChange={(e) => setOtra(e.target.value)} disabled={yendo} required />
          <button type="submit" className={tema.boton} style={tema.botonStyle} disabled={yendo || nueva.length < 10 || !otra}>
            {yendo ? 'Guardando…' : 'Guardar y entrar'}
          </button>
        </form>
      )}
      {fallo && (
        <Aviso tema={tema} tipo="error">
          {fallo}
        </Aviso>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ cambiar con la sesión abierta */

export function CambiarClave({ tema, headers, onListo }: { tema: Tema; headers: () => Record<string, string>; onListo: (sesion: string) => void }) {
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [otra, setOtra] = useState('');
  const [yendo, setYendo] = useState(false);
  const [fallo, setFallo] = useState('');
  const [listo, setListo] = useState('');
  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (nueva !== otra) return setFallo('Las dos contraseñas nuevas no coinciden.');
    setYendo(true);
    setFallo('');
    const r = await llamar('/api/ultron/clave/cambiar', { actual, nueva }, headers());
    setYendo(false);
    if (r.ok && r.json.token) {
      setListo(r.json.message || 'Contraseña cambiada.');
      setActual('');
      setNueva('');
      setOtra('');
      return onListo(String(r.json.token));
    }
    setFallo(r.status === 401 && r.json?.code === 'sesion_requerida' ? 'Tu sesión venció: volvé a entrar.' : r.json?.error || 'No pude cambiar la contraseña.');
  }
  return (
    <form onSubmit={enviar} className="space-y-3">
      <h2 className={tema.titulo}>Cambiar contraseña</h2>
      <p className={tema.texto}>{REGLAS} Al cambiarla se cierran tus sesiones en otros aparatos.</p>
      <input className={tema.campo} type="password" autoComplete="current-password" aria-label="Contraseña actual" placeholder="contraseña actual" value={actual} onChange={(e) => setActual(e.target.value)} disabled={yendo} required />
      <input className={tema.campo} type="password" autoComplete="new-password" aria-label="Contraseña nueva" placeholder="contraseña nueva" value={nueva} onChange={(e) => setNueva(e.target.value)} disabled={yendo} required minLength={10} />
      <input className={tema.campo} type="password" autoComplete="new-password" aria-label="Repetir la contraseña nueva" placeholder="repetí la nueva" value={otra} onChange={(e) => setOtra(e.target.value)} disabled={yendo} required />
      <button type="submit" className={tema.boton} style={tema.botonStyle} disabled={yendo || !actual || nueva.length < 10 || !otra}>
        {yendo ? 'Cambiando…' : 'Cambiar contraseña'}
      </button>
      {fallo && (
        <Aviso tema={tema} tipo="error">
          {fallo}
        </Aviso>
      )}
      {listo && (
        <Aviso tema={tema} tipo="ok">
          {listo}
        </Aviso>
      )}
    </form>
  );
}

/* ------------------------------------------------------------------ solicitudes (quien aprueba) */

type Solicitud = {
  id: number;
  nombre: string;
  correo: string;
  motivo: string;
  estado: 'pendiente' | 'aprobada' | 'rechazada';
  nivel: string | null;
  creada: string;
  decididaPor: string | null;
  yaEsDe: string | null;
};

/** Cuántas solicitudes esperan, o null si esta sesión no es la del aprobador. */
export async function solicitudesPendientes(headers: Record<string, string>): Promise<number | null> {
  const r = await llamar('/api/ultron/cuentas/solicitudes', undefined, headers);
  return r.ok ? Number(r.json.pendientes || 0) : null;
}

const NOMBRE_NIVEL: Record<string, string> = { lee: 'Consulta', escribe: 'Trabajo', mando: 'Mando' };
const fecha = (iso: string) => {
  try {
    return new Date(iso).toLocaleString('es-HN', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
};

export function PanelSolicitudes({ tema, headers, onCambio }: { tema: Tema; headers: () => Record<string, string>; onCambio?: (pendientes: number) => void }) {
  const [lista, setLista] = useState<Solicitud[] | null>(null);
  const [fallo, setFallo] = useState('');
  const [aviso, setAviso] = useState('');
  const [nivel, setNivel] = useState<Record<number, string>>({});
  const [yendo, setYendo] = useState<number | null>(null);

  async function cargar() {
    const r = await llamar('/api/ultron/cuentas/solicitudes', undefined, headers());
    if (!r.ok) return setFallo(r.json?.error || 'No pude traer las solicitudes.');
    setLista(r.json.solicitudes);
    onCambio?.(Number(r.json.pendientes || 0));
  }
  useEffect(() => {
    void cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function decidir(s: Solicitud, decision: 'aprobar' | 'rechazar') {
    const n = nivel[s.id] || 'lee';
    if (decision === 'aprobar' && n === 'mando' && !confirm(`¿Dar nivel Mando a ${s.nombre}? Mando puede administrar la plataforma.`)) return;
    if (decision === 'rechazar' && !confirm(`¿Rechazar la solicitud de ${s.nombre}?`)) return;
    setYendo(s.id);
    setAviso('');
    setFallo('');
    const r = await llamar(`/api/ultron/cuentas/solicitudes/${s.id}`, { decision, nivel: n }, headers());
    setYendo(null);
    if (r.ok) setAviso(r.json.message);
    else setFallo(r.json?.error || 'No pude guardar la decisión.');
    await cargar();
  }

  const pendientes = (lista || []).filter((s) => s.estado === 'pendiente');
  const decididas = (lista || []).filter((s) => s.estado !== 'pendiente').slice(0, 10);
  return (
    <div className="space-y-3">
      <h2 className={tema.titulo}>Solicitudes de acceso</h2>
      {fallo && (
        <Aviso tema={tema} tipo="error">
          {fallo}
        </Aviso>
      )}
      {aviso && (
        <Aviso tema={tema} tipo="ok">
          {aviso}
        </Aviso>
      )}
      {lista === null && !fallo && <p className={tema.texto}>Cargando…</p>}
      {lista && pendientes.length === 0 && <p className={tema.texto}>No hay solicitudes pendientes.</p>}
      {pendientes.map((s) => (
        <div key={s.id} className={tema.tarjeta}>
          <div className="font-semibold">{s.nombre}</div>
          <div className={tema.texto}>
            {s.correo} · {fecha(s.creada)}
          </div>
          <p className={`${tema.texto} mt-1.5 whitespace-pre-wrap`}>{s.motivo}</p>
          {s.yaEsDe && <p className={`${tema.texto} mt-1`}>Ese correo ya es de {s.yaEsDe} en el padrón.</p>}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <label className={tema.texto}>
              Nivel{' '}
              <select
                className={`${tema.campo} !w-auto !py-1.5`}
                value={nivel[s.id] || 'lee'}
                onChange={(e) => setNivel((v) => ({ ...v, [s.id]: e.target.value }))}
                disabled={yendo === s.id}
                aria-label={`Nivel para ${s.nombre}`}
              >
                <option value="lee">Consulta</option>
                <option value="escribe">Trabajo</option>
                <option value="mando">Mando</option>
              </select>
            </label>
            <button type="button" className={`${tema.boton} !w-auto px-4`} style={tema.botonStyle} disabled={yendo === s.id} onClick={() => decidir(s, 'aprobar')}>
              Aprobar
            </button>
            <button type="button" className={`${tema.secundario} !w-auto px-4`} disabled={yendo === s.id} onClick={() => decidir(s, 'rechazar')}>
              Rechazar
            </button>
          </div>
        </div>
      ))}
      {decididas.length > 0 && (
        <details>
          <summary className={`${tema.texto} cursor-pointer`}>Últimas decididas</summary>
          <ul className="mt-2 space-y-1">
            {decididas.map((s) => (
              <li key={s.id} className={tema.texto}>
                {s.nombre} ({s.correo}) — {s.estado === 'aprobada' ? `aprobada · ${NOMBRE_NIVEL[s.nivel || 'lee']}` : 'rechazada'}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
