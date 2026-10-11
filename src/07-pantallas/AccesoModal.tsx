import { Dialogo } from './Dialogo';
import React, { useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert, X, Lock, Mail, KeyRound, Globe, Loader2, LogOut, UserPlus } from 'lucide-react';
import { playSfx } from '../03-voz/audio';
import { enIconoInstalado, guardarTokenMesa, headersMesa } from '../10-infra/sesionCliente';
import { iniciarEntradaGenesis } from '../10-infra/genesisWeb';

/** La web de Veta Wallet, donde se crea la cuenta (se abre aparte; AU-RA no toca su registro). */
const WALLET_WEB_CREAR = 'https://app.vetawallet.com';
import { CambiarClave, CrearCuenta, OlvideClave, PanelSolicitudes, PonerClave, SolicitarAcceso, solicitudesPendientes, type EnlaceUrl, type Tema } from '../cuentas/Cuentas';

/**
 * El anillo de foco del teclado: redondo como el botón y del color de foco del tema (≥ 3:1 contra todo fondo;
 * auditoría B5: antes, un recuadro café cuadrado sobre un botón redondo).
 */
const FOCO = 'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-(--aura-foco) focus-visible:ring-offset-2 focus-visible:ring-offset-(--aura-fondo)';

/**
 * Las pantallas de cuentas con los colores de la sala de AU-RA. Sobre el dorado, SIEMPRE la tinta oscura
 * (`--aura-sobre-oro`, ≥ 7:1): antes iba `--aura-fondo`, que en el tema claro es marfil (1,7:1, auditoría C5).
 */
export const TEMA_AURA: Tema = {
  campo: 'w-full px-4 py-3 bg-(--aura-panel) border border-(--aura-borde) rounded-2xl text-[15px] text-(--aura-tinta) placeholder:text-(--aura-tinta-3) focus:border-(--aura-foco) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--aura-foco)',
  boton: `w-full py-3 px-4 rounded-full bg-(--aura-oro) text-(--aura-sobre-oro) hover:bg-(--aura-oro-hover) font-semibold text-[15px] cursor-pointer disabled:opacity-50 ${FOCO}`,
  secundario: `w-full py-3 px-4 rounded-full border border-(--aura-barro-borde) text-(--aura-barro-texto) hover:bg-(--aura-barro-fondo) font-semibold text-[14px] cursor-pointer disabled:opacity-50 ${FOCO}`,
  enlace: `w-full text-center text-[13px] text-(--aura-tinta-2) hover:text-(--aura-tinta) cursor-pointer rounded-full py-1.5 ${FOCO}`,
  titulo: 'font-display font-semibold text-xl text-(--aura-tinta)',
  texto: 'text-[14px] leading-snug text-(--aura-tinta-2)',
  error: 'p-2.5 rounded-xl bg-(--aura-barro-fondo) border border-(--aura-barro-borde) text-[13px] text-(--aura-error-texto)',
  ok: 'p-2.5 rounded-xl bg-(--aura-salvia-fondo) border border-(--aura-salvia-borde) text-[13px] text-(--aura-salvia-texto)',
  tarjeta: 'p-3 rounded-2xl bg-(--aura-panel-hondo) border border-(--aura-borde) text-(--aura-tinta)',
};

interface Props {
  isOpen: boolean;
  /** Lo que trajo la dirección desde un correo: poner clave, activar la cuenta o revisar solicitudes. */
  enlace?: EnlaceUrl;
  usuario: { name: string; role: string; authenticated: boolean };
  soundFxEnabled: boolean;
  /** La puerta de la web: sin sesión no hay mesa, así que no se cierra (ni botón, ni Escape, ni fondo). */
  obligatorio?: boolean;
  onClose: () => void;
  /** `correo`: el de la sesión, para la memoria por cuenta de la mesa (09-estado/memoria.ts). */
  onAuthSuccess: (nombre: string, rol: string, correo?: string) => void;
  onLogout: () => void;
}

/**
 * LA PUERTA DE LA WEB (José, 10-oct: «login y registro que simplemente funcionen, sin abrir ninguna otra app»).
 *
 *   · Lo primero: correo + contraseña + «Entrar» (el único botón dorado), contra /api/ultron/entrar; los errores
 *     dicen si fue la contraseña, la conexión o el servidor.
 *   · «Crear cuenta» bien a la vista: la cuenta y la sesión de miembro en el acto, y el correo se confirma con un
 *     código (src/cuentas/Cuentas.tsx CrearCuenta; server/registro-cuentas.ts).
 *   · Las opciones, debajo: «Entrar con Veta Wallet» (la web de la wallet con el pedido de AU-RA y la vuelta de
 *     siempre, 10-infra/genesisWeb.ts: el navegador no puede hablar directo con el backend de la wallet porque su
 *     CORS no admite este origen) y «Crear cuenta en Veta Wallet» (el mismo viaje: ahí se crea y vuelve sola).
 *   · «Solicitar acceso» queda para quien necesita el nivel de la junta.
 *
 * Sin escáner de huella de teatro: la sesión firmada dura catorce días y se renueva sola.
 */
export const AccesoModal: React.FC<Props> = ({ isOpen, enlace = null, usuario, soundFxEnabled, obligatorio = false, onClose, onAuthSuccess, onLogout }) => {
  const [vista, setVista] = useState<'entrar' | 'crear' | 'olvide' | 'solicitar' | 'poner' | 'clave' | 'solicitudes'>(() =>
    enlace && enlace.tipo !== 'solicitudes' ? 'poner' : 'entrar'
  );
  const [enlaceVivo, setEnlaceVivo] = useState(enlace);
  /** Solicitudes esperando; null si esta sesión no es la de quien aprueba. */
  const [pendientes, setPendientes] = useState<number | null>(null);
  useEffect(() => {
    if (!isOpen || !usuario.authenticated) return setPendientes(null);
    void solicitudesPendientes(headersMesa()).then((n) => {
      setPendientes(n);
      if (n !== null && enlaceVivo?.tipo === 'solicitudes') {
        setVista('solicitudes');
        setEnlaceVivo(null);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, usuario.authenticated]);
  const [correo, setCorreo] = useState(() => {
    try {
      return localStorage.getItem('ultron_correo') || '';
    } catch {
      return '';
    }
  });
  const [clave, setClave] = useState('');
  const [remoto, setRemoto] = useState<'?' | 'ok' | 'off'>('?');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  /** ¿Se ofrece «Entrar con Veta Wallet» (Genesis ID)? null mientras se pregunta al servidor (IOS01). */
  const [conGenesis, setConGenesis] = useState<boolean | null>(null);
  const [yendoAGenesis, setYendoAGenesis] = useState(false);
  /** Entró con una cuenta propia SIN confirmar: correo y clave para la pantalla del código (en memoria, una vez). */
  const [pendienteCodigo, setPendienteCodigo] = useState<{ correo: string; clave: string } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    // Cada vez que se abre, desde la entrada (salvo que venga un enlace de correo por usar).
    if (!enlaceVivo || enlaceVivo.tipo === 'solicitudes') setVista('entrar');
    fetch('/api/ultron/salud')
      .then((r) => setRemoto(r.ok ? 'ok' : 'off'))
      .catch(() => setRemoto('off'));
    fetch('/api/genesis/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => setConGenesis(!!c?.disponible))
      .catch(() => setConGenesis(false));
  }, [isOpen]);

  if (!isOpen) return null;

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!correo || !clave) return;
    setEnviando(true);
    setError('');
    try {
      const res = await fetch('/api/ultron/entrar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correo, clave }),
      });
      const data = await res.json().catch(() => ({}));
      setEnviando(false);
      const claveUsada = clave;
      setClave('');
      // Cuenta propia con el correo sin confirmar: sin sesión; el servidor mandó el código y se pide ya.
      if (res.status === 403 && data?.codigo === 'CORREO_SIN_CONFIRMAR') {
        setPendienteCodigo({ correo, clave: claveUsada });
        setVista('crear');
        return;
      }
      if (res.ok && data.ok) {
        if (data.token) guardarTokenMesa(String(data.token));
        try {
          localStorage.setItem('ultron_correo', correo);
        } catch {
          /* */
        }
        playSfx('grant', soundFxEnabled);
        onAuthSuccess(data.miembro?.nombre || correo.split('@')[0], data.miembro?.rol || 'Junta Directiva · Orden Global', data.miembro?.correo || data.user?.correo || correo);
        setClave('');
        onClose();
      } else {
        // Precisos: la contraseña, el freno o el servidor (nunca «contraseña mala» por un servidor caído).
        setError(
          res.status === 401 || res.status === 400 || res.status === 404
            ? 'Correo o contraseña incorrectos. Si tu cuenta es de Veta Wallet, usa «Entrar con Genesis ID (Veta Wallet)».'
            : res.status === 429
              ? data.error || 'Demasiados intentos. Espera unos minutos.'
              : res.status === 403
                ? data.error || 'Tu cuenta no tiene acceso a AU-RA.'
                : 'AU-RA no pudo comprobar tu contraseña ahora. Inténtalo en un momento.'
        );
        playSfx('deny', soundFxEnabled);
      }
    } catch {
      setEnviando(false);
      setError('No alcancé el servidor de AU-RA. Revisa tu conexión e inténtalo otra vez.');
    }
  };

  /** A la wallet con el pedido; al volver, App.tsx recoge la sesión (10-infra/genesisWeb.ts). */
  const entrarConGenesis = async () => {
    setError('');
    setYendoAGenesis(true);
    const r = await iniciarEntradaGenesis();
    if (r.ok === false) {
      setYendoAGenesis(false);
      setError(r.mensaje);
      return;
    }
    window.location.assign(r.ir);
  };

  const salir = async () => {
    try {
      await fetch('/api/ultron/salir', { method: 'POST', headers: headersMesa() });
    } catch {
      /* */
    }
    guardarTokenMesa('');
    onLogout();
    onClose();
  };

  return (
    <Dialogo abierto={isOpen} onCerrar={obligatorio ? () => undefined : onClose} idTitulo="aura-acceso-titulo" claseCapa="items-center justify-center p-3 sm:p-4" clase="aura-sube w-full max-w-md md:max-w-lg lg:max-w-xl bg-(--aura-fondo) rounded-[28px] p-6 md:p-9 lg:p-11 shadow-[0_16px_48px_rgba(0,0,0,0.53)] flex flex-col gap-4 md:gap-5 relative overflow-hidden">
        {!obligatorio && (
          <button type="button" onClick={onClose} className="absolute top-4 right-4 w-9 h-9 rounded-full bg-(--aura-panel-2) text-(--aura-tinta-2) hover:bg-(--aura-oro-suave) flex items-center justify-center cursor-pointer" aria-label="Cerrar">
            <X className="w-5 h-5" />
          </button>
        )}
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-(--aura-oro)/10 border border-(--aura-borde) text-[12px] font-mono text-(--aura-oro-texto) mb-1">
            <Globe className="w-3 h-3" />
            <span>cerebro Orden Global</span>
            <span className={`w-1.5 h-1.5 rounded-full ${remoto === 'ok' ? 'bg-(--aura-salvia) animate-pulse' : remoto === 'off' ? 'bg-(--aura-barro)' : 'bg-(--aura-oro)'}`} />
          </div>
          <h2 id="aura-acceso-titulo" className="aura-serif text-[32px] md:text-[40px] leading-tight text-(--aura-tinta)">{usuario.authenticated ? 'Tu sesión' : 'Entrar a AU-RA'}</h2>
          <p className="text-[14px] md:text-[16px] leading-snug text-(--aura-tinta-2) mt-1">{usuario.authenticated ? 'Tu memoria, tu bóveda y tus manos van con tu sesión.' : 'Entra con tu correo y tu contraseña, o crea tu cuenta en un minuto.'}</p>
        </div>

        {vista === 'poner' && enlaceVivo && enlaceVivo.tipo !== 'solicitudes' ? (
          <PonerClave
            tema={TEMA_AURA}
            tipo={enlaceVivo.tipo}
            token={enlaceVivo.token}
            onListo={async (t) => {
              // Guardar la sesión ya anuncia qué build corre esta pestaña (sesionCliente.anunciarRecepcion): aquí no se repite.
              guardarTokenMesa(t);
              setEnlaceVivo(null);
              setVista('entrar');
              const d = await fetch('/api/ultron/sesion', { headers: headersMesa() })
                .then((r) => r.json())
                .catch(() => null);
              if (d?.authenticated) onAuthSuccess(d.user?.nombre || '', d.user?.rol || 'Junta Directiva · Orden Global', d.user?.correo);
              playSfx('grant', soundFxEnabled);
              onClose();
            }}
            onPedirOtro={() => {
              setEnlaceVivo(null);
              setVista('olvide');
            }}
          />
        ) : vista === 'olvide' && !usuario.authenticated ? (
          <OlvideClave tema={TEMA_AURA} correoInicial={correo} onVolver={() => setVista('entrar')} />
        ) : vista === 'crear' && !usuario.authenticated ? (
          <CrearCuenta
            tema={TEMA_AURA}
            producto="AU-RA"
            pendiente={pendienteCodigo}
            onSesion={(t) => guardarTokenMesa(t)}
            onListo={(m) => {
              setPendienteCodigo(null);
              playSfx('grant', soundFxEnabled);
              onAuthSuccess(m.nombre, m.rol || 'Miembro de la comunidad', m.correo);
              onClose();
            }}
            onVolver={() => {
              setPendienteCodigo(null);
              setVista('entrar');
            }}
          />
        ) : vista === 'solicitar' && !usuario.authenticated ? (
          <SolicitarAcceso tema={TEMA_AURA} producto="AU-RA FP" onVolver={() => setVista('entrar')} />
        ) : vista === 'clave' && usuario.authenticated ? (
          <div className="flex flex-col gap-3">
            <CambiarClave tema={TEMA_AURA} headers={headersMesa} onListo={(t) => guardarTokenMesa(t)} />
            <button type="button" className={TEMA_AURA.enlace} onClick={() => setVista('entrar')}>
              Volver
            </button>
          </div>
        ) : vista === 'solicitudes' && usuario.authenticated && pendientes !== null ? (
          <div className="flex flex-col gap-3 max-h-[65vh] overflow-y-auto pr-1">
            <PanelSolicitudes tema={TEMA_AURA} headers={headersMesa} onCambio={setPendientes} />
            <button type="button" className={TEMA_AURA.enlace} onClick={() => setVista('entrar')}>
              Volver
            </button>
          </div>
        ) : usuario.authenticated ? (
          <div className="flex flex-col gap-3">
            <div className="p-3 rounded-lg bg-(--aura-salvia-fondo) border border-(--aura-salvia-borde) text-left text-xs font-mono text-(--aura-salvia-texto)">
              <div className="flex items-center gap-1.5 font-semibold mb-1"><ShieldCheck className="w-4 h-4" /> Sesión activa</div>
              <div className="text-(--aura-tinta) text-sm font-semibold">{usuario.name}</div>
              <div className="text-(--aura-tinta-2) text-[13px]">{usuario.role}</div>
            </div>
            <button type="button" onClick={() => setVista('clave')} className="py-3 rounded-full border border-(--aura-borde) text-(--aura-tinta) hover:bg-(--aura-panel) font-semibold text-[14px] flex items-center justify-center gap-2 cursor-pointer">
              <KeyRound className="w-4 h-4" /> Cambiar contraseña
            </button>
            {pendientes !== null && (
              <button type="button" onClick={() => setVista('solicitudes')} className="py-3 rounded-full border border-(--aura-borde) text-(--aura-oro-texto) hover:bg-(--aura-panel) font-semibold text-[14px] flex items-center justify-center gap-2 cursor-pointer">
                <ShieldCheck className="w-4 h-4" /> Solicitudes de acceso{pendientes ? ` · ${pendientes}` : ''}
              </button>
            )}
            <button type="button" onClick={salir} className="py-3 rounded-full border border-(--aura-barro-borde) text-(--aura-barro-texto) hover:bg-(--aura-barro-fondo) font-semibold text-[14px] flex items-center justify-center gap-2 cursor-pointer">
              <LogOut className="w-4 h-4" /> Cerrar sesión
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 text-left">
            {/* Lo primero: la cuenta de AU-RA (correo y contraseña). */}
            <form onSubmit={entrar} className="flex flex-col gap-3 text-left">
              <label className="block text-[13px] font-medium text-(--aura-tinta-2)">
                Correo
                <div className="relative mt-1">
                  <Mail className="w-4 h-4 text-(--aura-tinta-2) absolute left-3 top-1/2 -translate-y-1/2" />
                  <input type="email" autoComplete="username" value={correo} onChange={(e) => { setCorreo(e.target.value); setError(''); }} placeholder="tu@correo.com" required className="w-full min-h-[48px] pl-10 pr-4 py-3 bg-(--aura-panel) border border-(--aura-borde) rounded-full text-[15px] text-(--aura-tinta) placeholder:text-(--aura-tinta-3) focus:border-(--aura-foco) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--aura-foco)" />
                </div>
              </label>
              <label className="block text-[13px] font-medium text-(--aura-tinta-2)">
                Contraseña
                <div className="relative mt-1">
                  <Lock className="w-4 h-4 text-(--aura-tinta-2) absolute left-3 top-1/2 -translate-y-1/2" />
                  <input type="password" autoComplete="current-password" value={clave} onChange={(e) => { setClave(e.target.value); setError(''); }} placeholder="••••••••" required className="w-full min-h-[48px] pl-10 pr-4 py-3 bg-(--aura-panel) border border-(--aura-borde) rounded-full text-[15px] text-(--aura-tinta) placeholder:text-(--aura-tinta-3) focus:border-(--aura-foco) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--aura-foco)" />
                </div>
              </label>
              {error && (
                <div role="alert" className="p-2 rounded bg-(--aura-barro-fondo) border border-(--aura-barro-borde) text-[13px] font-mono text-(--aura-error-texto) flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              <button type="submit" disabled={enviando} className={`mt-1 min-h-[52px] py-3 px-4 rounded-full bg-(--aura-oro) text-(--aura-sobre-oro) hover:bg-(--aura-oro-hover) shadow-[0_6px_16px_rgba(214,181,108,0.3)] font-semibold text-[16px] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 ${FOCO}`}>
                {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                <span>{enviando ? 'Entrando…' : 'Entrar'}</span>
              </button>
              {enIconoInstalado() && (
                <p className="px-1 text-[12px] leading-snug text-(--aura-tinta-2)">
                  El ícono de AU-RA guarda su propia sesión: si entraste en el navegador, entra aquí una vez y queda guardada.
                </p>
              )}
            </form>
            <button type="button" onClick={() => { setPendienteCodigo(null); setVista('crear'); setError(''); }} className={`min-h-[48px] ${TEMA_AURA.secundario} flex items-center justify-center gap-2`}>
              <UserPlus className="w-4 h-4" /> Crear cuenta
            </button>
            <button type="button" onClick={() => { setVista('olvide'); setError(''); }} className={`self-center min-h-[44px] px-3 py-1.5 rounded-full text-[13px] text-(--aura-tinta-2) hover:text-(--aura-tinta) cursor-pointer ${FOCO}`}>
              ¿Olvidaste tu contraseña?
            </button>

            {/* Las opciones. En la web la wallet solo devuelve un pase de Genesis ID (su API no admite llamadas desde este
                dominio, CORS): el botón se llama por lo que hace. Crear la cuenta de la wallet es su propia web. */}
            {conGenesis !== false && (
              <>
                <div className="flex items-center gap-2.5 text-[12px] text-(--aura-tinta-3)" aria-hidden="true">
                  <span className="flex-1 h-px bg-(--aura-borde)" />o entra con<span className="flex-1 h-px bg-(--aura-borde)" />
                </div>
                <button
                  type="button"
                  onClick={() => void entrarConGenesis()}
                  disabled={yendoAGenesis || conGenesis === null}
                  className={`min-h-[48px] ${TEMA_AURA.secundario} flex items-center justify-center gap-2`}
                >
                  {yendoAGenesis || conGenesis === null ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                  <span>{yendoAGenesis ? 'Abriendo tu wallet…' : 'Entrar con Genesis ID (Veta Wallet)'}</span>
                </button>
                <a href={WALLET_WEB_CREAR} target="_blank" rel="noopener noreferrer" className={`self-center min-h-[44px] px-3 py-1.5 rounded-full text-[13px] text-(--aura-tinta-2) hover:text-(--aura-tinta) cursor-pointer inline-flex items-center ${FOCO}`}>
                  Crear cuenta en Veta Wallet
                </a>
              </>
            )}
            <button type="button" onClick={() => { setVista('solicitar'); setError(''); }} className={`self-center min-h-[44px] px-3 py-1.5 rounded-full text-[12px] text-(--aura-tinta-3) hover:text-(--aura-tinta) cursor-pointer ${FOCO}`}>
              ¿Necesitas acceso de la junta? Solicitar acceso
            </button>
          </div>
        )}
      </Dialogo>
  );
};
