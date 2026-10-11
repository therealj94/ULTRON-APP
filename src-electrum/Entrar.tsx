/**
 * La puerta de Dr Electrum FP.
 *
 * Antes no existía: la web daba por hecho que ya habías entrado en la otra plataforma en ESE mismo
 * navegador, y
 * si no, te encontrabas la estación montada y una línea en la conversación diciendo que no tenías
 * acceso. Una puerta cerrada sin manija. La app móvil sí tenía su pantalla de entrada; la web no, y
 * eso es justo lo que hizo que el enlace «no diera acceso».
 *
 * Dos maneras de entrar, las mismas que reconoce el servidor:
 *
 *  · **Correo y clave.** Va contra `/api/electrum/entrar`: la sesión es
 *    una sola para las dos plataformas y a cuál te deja entrar lo decide el padrón del servidor.
 *  · **Llave de demostración.** Para enseñarle esto a alguien sin crearle sesión.
 *
 * Lo que NO hace: decidir si tenés permiso. Eso lo dice el servidor y solo el servidor; aquí se
 * guarda la credencial y se vuelve a llamar a la puerta.
 */
import { useState, type FormEvent } from 'react';
import { almacenamientoFragil, guardarLlave, guardarSesion, porQueNoAbre, puertaAbierta, type Donde } from './acceso';
import { OlvideClave, SolicitarAcceso, entrarConCodigo, pareceCodigo } from '../src/cuentas/Cuentas';
import { TEMA_ELECTRUM } from './Cuenta';
import { BotonAnimado } from './ui/BotonAnimado';
import { Emblema, Topografia } from './ui/Topografia';

const ACENTO = '#FFAE3B';

/** El ícono de un campo, a la izquierda; se enciende en ámbar con el foco (va después del input). */
function Icono({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#8FA3B0] transition-colors peer-focus:text-[#FFAE3B]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export function Entrar({ onAbierta, modoInicial = 'correo', aviso = '' }: { onAbierta: () => void; modoInicial?: 'correo' | 'olvide' | 'solicitar'; aviso?: string }) {
  const [correo, setCorreo] = useState('');
  const [clave, setClave] = useState('');
  const [llave, setLlave] = useState('');
  const [modo, setModo] = useState<'correo' | 'llave' | 'olvide' | 'solicitar'>(modoInicial);
  const [yendo, setYendo] = useState(false);
  const [fallo, setFallo] = useState('');
  /** Si la credencial no pudo guardarse en disco, se entra igual pero se dice que no durará. */
  const [fragil, setFragil] = useState(() => almacenamientoFragil());
  const [verClave, setVerClave] = useState(false);
  const [mayusculas, setMayusculas] = useState(false);
  /** Entró: un instante de confirmación (el anillo se cierra) antes de pasar a la estación. */
  const [listo, setListo] = useState(false);
  const abrir = () => {
    setListo(true);
    setTimeout(onAbierta, 650);
  };
  const mirarMayusculas = (e: { getModifierState?: (k: string) => boolean }) => setMayusculas(!!e.getModifierState?.('CapsLock'));

  async function entrarConCorreo(e: FormEvent) {
    e.preventDefault();
    if (!correo.trim() || !clave) return;
    setYendo(true);
    setFallo('');
    try {
      const r = await fetch('/api/electrum/entrar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correo: correo.trim(), clave }),
      });
      const j = await r.json().catch(() => ({}) as any);
      if (!r.ok || !j?.token) {
        setFallo(j?.error || j?.message || 'Ese correo y esa clave no abren.');
        return;
      }
      avisarSiEsFragil(guardarSesion(String(j.token)));
      // Tener credencial no es tener acceso AQUÍ: el padrón puede dejarte en una plataforma y no en
      // y decirlo aquí es mejor que dejar pasar a una estación que no va a contestar.
      const p = await puertaAbierta();
      if (p.estado === 'abierta') abrir();
      else setFallo(porQueNoAbre(p, 'sesion'));
    } catch {
      // «Failed to fetch» es lo que dice el navegador, en inglés y sin decir qué hacer.
      setFallo('No alcancé el servidor. Revisá la conexión y volvé a intentarlo — tu clave no tiene nada que ver.');
    } finally {
      setYendo(false);
    }
  }

  /**
   * La credencial se guardó, pero puede que solo en memoria.
   *
   * No se bloquea por eso: quien está en una ventana privada tiene el mismo derecho a entrar. Lo
   * que se hace es decirle la verdad — que si recarga tendrá que volver a poner la llave.
   */
  function avisarSiEsFragil(donde: Donde) {
    setFragil(donde === 'memoria');
  }

  async function entrarConLlave(e: FormEvent) {
    e.preventDefault();
    if (!llave.trim()) return;
    setYendo(true);
    setFallo('');
    /*
     * ESTE ERA EL PUNTO DE F09.
     *
     * El `sessionStorage.setItem` de reserva estaba dentro del `catch` del primero y **sin
     * proteger**. Cuando los dos almacenes fallaban —ventana privada con almacenamiento bloqueado,
     * política de empresa— la excepción salía disparada antes del `setYendo(false)` que estaba
     * al final sin `finally`, y el formulario quedaba en «Probando…» con todo deshabilitado para
     * siempre. Ni entraba ni decía por qué. Ahora guardar no puede fallar: si no hay disco, queda
     * en memoria y se avisa.
     */
    try {
      // Un código temporal (DE-XXXX-XXXX-XXXX) abre una sesión que vence sola; lo demás es la llave
      // de demostración de siempre.
      if (pareceCodigo(llave)) {
        const r = await entrarConCodigo(llave.trim());
        if (r.ok === false) {
          setFallo(r.error);
          return;
        }
        avisarSiEsFragil(guardarSesion(r.token));
        const p = await puertaAbierta();
        if (p.estado === 'abierta') abrir();
        else setFallo(porQueNoAbre(p, 'sesion'));
        return;
      }
      avisarSiEsFragil(guardarLlave(llave.trim()));
      const p = await puertaAbierta();
      if (p.estado === 'abierta') abrir();
      else setFallo(porQueNoAbre(p, 'llave'));
    } catch {
      setFallo('No pude comprobar la llave: no alcancé el servidor. Revisá la conexión y volvé a intentarlo.');
    } finally {
      setYendo(false);
    }
  }

  const campo =
    'peer w-full rounded-xl border border-white/10 bg-white/[0.04] pl-10 pr-3 pt-5 pb-2 text-[15px] text-[#F3F6F8] ' +
    'placeholder-transparent outline-none transition-all focus:border-[#FFAE3B]/70 focus:bg-white/[0.06] focus:shadow-[0_0_0_4px_rgba(255,174,59,.10)] disabled:opacity-60';
  const etiquetaFlotante =
    'pointer-events-none absolute left-10 top-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[#8FA3B0] transition-all ' +
    'peer-placeholder-shown:top-3.5 peer-placeholder-shown:text-[13px] peer-placeholder-shown:normal-case peer-placeholder-shown:tracking-normal peer-placeholder-shown:font-sans ' +
    'peer-focus:top-1.5 peer-focus:font-mono peer-focus:text-[10px] peer-focus:uppercase peer-focus:tracking-[0.14em] peer-focus:text-[#FFAE3B]';
  const enEntrada = modo === 'correo' || modo === 'llave';

  return (
    <div className="fixed inset-0 overflow-y-auto bg-[#050607] text-[#E7EEF2]">
      {/* El terreno vivo de fondo, con su viñeta. */}
      <div className="fixed inset-0" style={{ background: 'radial-gradient(ellipse at 30% 40%, #15100A 0%, #070708 55%, #030304 100%)' }} />
      <div className="fixed inset-0">
        <Topografia intensidad={0.85} />
      </div>
      <div className="fixed inset-0" style={{ background: 'radial-gradient(ellipse at 70% 50%, transparent 20%, rgba(0,0,0,.7) 100%)' }} />

      <div className="relative mx-auto flex min-h-full max-w-[1180px] flex-col items-center justify-center gap-10 px-5 py-10 lg:flex-row lg:justify-between lg:gap-16 lg:px-10">
        {/* EL HÉROE: qué es esto, antes de pedir nada. */}
        <section className="w-full max-w-[540px] text-center lg:text-left" style={{ animation: 'en-subir .9s cubic-bezier(.2,.8,.2,1) both' }}>
          <div className="flex justify-center lg:justify-start">
            <Emblema tam={84} progreso={listo ? 1 : undefined} />
          </div>
          <div className="mt-6 font-mono text-[10.5px] uppercase tracking-[0.34em] text-[#FFAE3B]/90">Inteligencia geológico-minera · Honduras</div>
          <h1 className="mt-3 font-display text-[40px] font-bold leading-[0.98] tracking-tight md:text-[60px]">
            <span style={{ background: 'linear-gradient(100deg,#FFFFFF 0%,#FFE3A3 38%,#FFAE3B 55%,#FFFFFF 78%)', backgroundSize: '220% 100%', WebkitBackgroundClip: 'text', color: 'transparent', animation: 'en-brillo 7s linear infinite' }}>
              Dr Electrum
            </span>
          </h1>
          <p className="mx-auto mt-4 max-w-[460px] text-[15px] leading-relaxed text-[#C9D4DA] lg:mx-0 md:text-[17px]">
            El catastro, la geología, los expedientes y un equipo de especialistas, en una sola estación de trabajo.
          </p>
          <ul className="mx-auto mt-7 hidden max-w-[460px] space-y-3 text-left md:block lg:mx-0">
            {[
              { t: 'Catastro y restricciones cruzados', d: 'Áreas protegidas, microcuencas, comunidades y derechos mineros sobre el mismo mapa.', i: 'M4 5h16v14H4z M4 10h16 M9 5v14' },
              { t: 'Geología con sus fuentes', d: 'Mapas geológicos y estructurales, fichas de ocurrencia, JICA y USGS.', i: 'M3 20l6-10 4 6 3-4 5 8z M14 7a2 2 0 1 0 0-.01' },
              { t: 'Una mesa técnica que conversa', d: 'Geología, plan de minado y metalurgia, con voz y en tres dimensiones.', i: 'M7 9a3 3 0 1 0 0-.01 M17 9a3 3 0 1 0 0-.01 M3 20c0-3 2-5 4-5s4 2 4 5 M13 20c0-3 2-5 4-5s4 2 4 5' },
            ].map((f, k) => (
              <li key={f.t} className="flex gap-3" style={{ animation: `en-subir .8s cubic-bezier(.2,.8,.2,1) ${0.25 + k * 0.12}s both` }}>
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#FFAE3B]/30 bg-[#FFAE3B]/[0.07]">
                  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke={ACENTO} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d={f.i} />
                  </svg>
                </span>
                <span>
                  <span className="block text-[14px] font-semibold text-[#F3F6F8]">{f.t}</span>
                  <span className="block text-[13px] leading-snug text-[#9FB0B8]">{f.d}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* LA TARJETA DE ENTRADA, de vidrio. */}
        <section
          className="relative w-full max-w-[400px]"
          style={{ animation: listo ? 'en-salir .65s cubic-bezier(.4,0,.2,1) forwards' : 'en-subir .9s cubic-bezier(.2,.8,.2,1) .15s both' }}
        >
          <div className="relative">
          <div className="absolute -inset-px rounded-[22px] opacity-70" style={{ background: 'linear-gradient(140deg, rgba(255,174,59,.55), rgba(255,174,59,0) 40%, rgba(255,174,59,0) 60%, rgba(255,174,59,.35))' }} aria-hidden />
          <div className="relative rounded-[22px] border border-white/[0.06] bg-[rgba(12,14,17,.78)] p-6 shadow-[0_30px_80px_rgba(0,0,0,.6)] backdrop-blur-2xl md:p-7">
            <div className="mb-5">
              <div className="font-display text-[22px] font-bold leading-tight text-[#F3F6F8]">
                {modo === 'olvide' ? 'Recuperar la clave' : modo === 'solicitar' ? 'Solicitar acceso' : 'Bienvenido'}
              </div>
              <div className="mt-1 text-[13px] text-[#9FB0B8]">
                {modo === 'olvide' ? 'Le enviamos un enlace a su correo.' : modo === 'solicitar' ? 'José revisa cada solicitud.' : 'Entre a su estación de trabajo.'}
              </div>
            </div>

            {enEntrada && (
              <div className="relative mb-5 grid grid-cols-2 rounded-xl border border-white/[0.08] bg-black/30 p-1" role="tablist" aria-label="Forma de entrar">
                <span
                  aria-hidden
                  className="absolute bottom-1 top-1 w-[calc(50%-4px)] rounded-lg bg-[#FFAE3B] shadow-[0_6px_20px_rgba(255,174,59,.35)] transition-transform duration-300 ease-[cubic-bezier(.2,.8,.2,1)]"
                  style={{ left: 4, transform: modo === 'llave' ? 'translateX(100%)' : 'none' }}
                />
                {(['correo', 'llave'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="tab"
                    aria-selected={modo === m}
                    onClick={() => {
                      setModo(m);
                      setFallo('');
                    }}
                    className={`relative z-[1] rounded-lg py-2 text-[13px] font-semibold transition-colors cursor-pointer ${modo === m ? 'text-black' : 'text-[#C9D4DA] hover:text-white'}`}
                  >
                    {m === 'correo' ? 'Correo' : 'Código de acceso'}
                  </button>
                ))}
              </div>
            )}

            {aviso && (
              <div className="mb-4 rounded-xl border px-3 py-2.5 text-[13px] leading-relaxed" style={{ borderColor: 'rgba(255,174,59,0.3)', background: 'rgba(255,174,59,0.07)', color: '#FFD08A' }} role="status">
                {aviso}
              </div>
            )}

            <div key={modo} style={{ animation: 'en-cambio .35s ease-out both' }}>
              {modo === 'olvide' ? (
                <OlvideClave tema={TEMA_ELECTRUM} correoInicial={correo} onVolver={() => setModo('correo')} />
              ) : modo === 'solicitar' ? (
                <SolicitarAcceso tema={TEMA_ELECTRUM} producto="Dr Electrum FP" onVolver={() => setModo('correo')} />
              ) : modo === 'correo' ? (
                <form onSubmit={entrarConCorreo} className="space-y-3">
                  <div className="relative">
                    <input id="en-correo" className={campo} type="email" autoComplete="username" placeholder="Correo" value={correo} onChange={(e) => setCorreo(e.target.value)} disabled={yendo} autoFocus />
                    <label htmlFor="en-correo" className={etiquetaFlotante}>Correo</label>
                    <Icono d="M4 6h16v12H4z M4 7l8 6 8-6" />
                  </div>
                  <div className="relative">
                    <input
                      id="en-clave"
                      className={`${campo} pr-11`}
                      type={verClave ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder="Contraseña"
                      value={clave}
                      onChange={(e) => setClave(e.target.value)}
                      onKeyUp={mirarMayusculas}
                      onKeyDown={mirarMayusculas}
                      disabled={yendo}
                    />
                    <label htmlFor="en-clave" className={etiquetaFlotante}>Contraseña</label>
                    <Icono d="M6 11h12v9H6z M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
                    <button
                      type="button"
                      onClick={() => setVerClave((v) => !v)}
                      aria-label={verClave ? 'Ocultar la contraseña' : 'Mostrar la contraseña'}
                      className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-[#8FA3B0] hover:bg-white/[0.06] hover:text-white cursor-pointer"
                    >
                      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        {verClave ? <path d="M3 3l18 18 M10.6 10.6a2 2 0 0 0 2.8 2.8 M9.4 5.2A9.6 9.6 0 0 1 12 5c5 0 9 5 9 7 0 .9-.8 2.3-2.2 3.7 M6.6 6.6C4.4 8 3 10.6 3 12c0 2 4 7 9 7 1.6 0 3-.4 4.3-1" /> : <path d="M3 12c0-2 4-7 9-7s9 5 9 7-4 7-9 7-9-5-9-7z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />}
                      </svg>
                    </button>
                  </div>
                  {mayusculas && <div className="font-mono text-[11px] tracking-[0.06em] text-[#FFD08A]">Bloq Mayús está activado</div>}
                  <div className="pt-1">
                    <BotonAnimado enviar completo tamano="lg" texto={listo ? '¡Adentro!' : yendo ? 'Entrando…' : 'Entrar'} loading={yendo} disabled={!correo.trim() || !clave || listo} />
                  </div>
                  <div className="flex items-center justify-between pt-1 text-[12.5px]">
                    <button type="button" onClick={() => { setModo('olvide'); setFallo(''); }} className="text-[#9FB0B8] hover:text-[#FFE3A3] transition-colors cursor-pointer">
                      ¿Olvidó su contraseña?
                    </button>
                    <button type="button" onClick={() => { setModo('solicitar'); setFallo(''); }} className="text-[#9FB0B8] hover:text-[#FFE3A3] transition-colors cursor-pointer">
                      Solicitar acceso
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={entrarConLlave} className="space-y-3">
                  <div className="relative">
                    <input id="en-codigo" className={`${campo} font-mono tracking-[0.12em]`} type="password" autoComplete="off" placeholder="Código" value={llave} onChange={(e) => setLlave(e.target.value)} disabled={yendo} autoFocus />
                    <label htmlFor="en-codigo" className={etiquetaFlotante}>Código (DE-XXXX-XXXX-XXXX)</label>
                    <Icono d="M14 7a4 4 0 1 1-3.9 4.9L4 18v2h3v-2h2v-2h2l1.1-1.1A4 4 0 0 1 14 7z M15.5 9.5h.01" />
                  </div>
                  <p className="text-[12px] leading-snug text-[#8FA3B0]">El código vale por un tiempo y se cierra solo al vencer. Con él se mira todo, pero no se descargan archivos.</p>
                  <div className="pt-1">
                    <BotonAnimado enviar completo tamano="lg" texto={listo ? '¡Adentro!' : yendo ? 'Probando…' : 'Entrar con el código'} loading={yendo} disabled={!llave.trim() || listo} />
                  </div>
                </form>
              )}
            </div>

            {fallo && (
              <div className="mt-4 rounded-xl border px-3 py-2.5 text-[13px] leading-relaxed" style={{ borderColor: 'rgba(255,120,90,0.3)', background: 'rgba(255,120,90,0.07)', color: '#FFB0A0', animation: 'en-temblor .4s ease-in-out' }} role="alert">
                {fallo}
              </div>
            )}

            {/*
              * Guardado solo en memoria. No es un error —se entró— pero callarlo haría que la sesión
              * se «perdiera sola» al recargar, sin explicación.
              */}
            {fragil && (
              <div className="mt-4 rounded-xl border px-3 py-2.5 text-[13px] leading-relaxed" style={{ borderColor: 'rgba(255,174,59,0.3)', background: 'rgba(255,174,59,0.07)', color: '#FFD08A' }} role="status">
                Este navegador no deja guardar nada, así que la credencial vale solo mientras no recargue la página. Suele pasar en ventana privada.
              </div>
            )}
          </div>
          </div>
          <p className="mt-5 text-center text-[11.5px] leading-relaxed text-[#8FA3B0]">
            Privado · catastro minero y expedientes de Honduras. Si su correo está en el padrón, entre con él; para ver la demostración, pida un código de acceso.
          </p>
        </section>
      </div>
      <style>{`
@keyframes en-subir{from{opacity:0;transform:translateY(18px);filter:blur(6px)}to{opacity:1;transform:none;filter:none}}
@keyframes en-salir{to{opacity:0;transform:translateY(-10px) scale(.97);filter:blur(6px)}}
@keyframes en-cambio{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes en-brillo{to{background-position:-220% 0}}
@keyframes en-temblor{0%,100%{transform:none}20%{transform:translateX(-6px)}40%{transform:translateX(5px)}60%{transform:translateX(-3px)}80%{transform:translateX(2px)}}
@media (prefers-reduced-motion: reduce){.fixed *{animation-duration:.01s!important}}
`}</style>
    </div>
  );
}
