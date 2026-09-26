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

const ACENTO = '#FFAE3B';

export function Entrar({ onAbierta }: { onAbierta: () => void }) {
  const [correo, setCorreo] = useState('');
  const [clave, setClave] = useState('');
  const [llave, setLlave] = useState('');
  const [modo, setModo] = useState<'correo' | 'llave'>('correo');
  const [yendo, setYendo] = useState(false);
  const [fallo, setFallo] = useState('');
  /** Si la credencial no pudo guardarse en disco, se entra igual pero se dice que no durará. */
  const [fragil, setFragil] = useState(() => almacenamientoFragil());

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
      if (p.estado === 'abierta') onAbierta();
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
      avisarSiEsFragil(guardarLlave(llave.trim()));
      const p = await puertaAbierta();
      if (p.estado === 'abierta') onAbierta();
      else setFallo(porQueNoAbre(p, 'llave'));
    } catch {
      setFallo('No pude comprobar la llave: no alcancé el servidor. Revisá la conexión y volvé a intentarlo.');
    } finally {
      setYendo(false);
    }
  }

  const campo =
    'w-full rounded-lg bg-white/[0.04] border border-white/10 px-3 py-2.5 text-[15px] text-[#E7EEF2] ' +
    'placeholder:text-[#7D909A] outline-none focus:border-[#FFAE3B]/60 transition-colors';

  return (
    <div className="fixed inset-0 bg-black text-[#E7EEF2] overflow-y-auto">
      <div className="min-h-full flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-[340px]">
          <div className="text-center mb-8">
            <div className="font-display font-bold tracking-[0.34em] text-lg" style={{ color: ACENTO }}>
              DR ELECTRUM FP
            </div>
            <div className="mt-2 font-mono text-[10px] tracking-[0.2em] uppercase text-[#8FA3B0]">
              catastro · expedientes · especialistas
            </div>
          </div>

          {modo === 'correo' ? (
            <form onSubmit={entrarConCorreo} className="space-y-3">
              <input
                className={campo}
                type="email"
                autoComplete="username"
                aria-label="Correo"
                placeholder="tu correo"
                value={correo}
                onChange={(e) => setCorreo(e.target.value)}
                disabled={yendo}
              />
              <input
                className={campo}
                type="password"
                autoComplete="current-password"
                aria-label="Clave"
                placeholder="tu clave"
                value={clave}
                onChange={(e) => setClave(e.target.value)}
                disabled={yendo}
              />
              <button
                type="submit"
                disabled={yendo || !correo.trim() || !clave}
                className="w-full rounded-lg py-2.5 text-[15px] font-semibold text-black transition-opacity disabled:opacity-35"
                style={{ background: ACENTO }}
              >
                {yendo ? 'Entrando…' : 'Entrar'}
              </button>
            </form>
          ) : (
            <form onSubmit={entrarConLlave} className="space-y-3">
              <input
                className={campo}
                type="password"
                aria-label="Llave de demostración"
                autoComplete="off"
                placeholder="llave de demostración"
                value={llave}
                onChange={(e) => setLlave(e.target.value)}
                disabled={yendo}
              />
              <button
                type="submit"
                disabled={yendo || !llave.trim()}
                className="w-full rounded-lg py-2.5 text-[15px] font-semibold text-black transition-opacity disabled:opacity-35"
                style={{ background: ACENTO }}
              >
                {yendo ? 'Probando…' : 'Entrar con la llave'}
              </button>
            </form>
          )}

          {fallo && (
            <div
              className="mt-4 rounded-lg border px-3 py-2.5 text-[13px] leading-relaxed"
              style={{ borderColor: 'rgba(255,120,90,0.3)', background: 'rgba(255,120,90,0.07)', color: '#FFB0A0' }}
              role="alert"
            >
              {fallo}
            </div>
          )}

          {/*
            * Guardado solo en memoria. No es un error —se entró— pero callarlo haría que la sesión
            * se «perdiera sola» al recargar, sin explicación.
            */}
          {fragil && (
            <div
              className="mt-4 rounded-lg border px-3 py-2.5 text-[13px] leading-relaxed"
              style={{ borderColor: 'rgba(255,174,59,0.3)', background: 'rgba(255,174,59,0.07)', color: '#FFD08A' }}
              role="status"
            >
              Este navegador no me deja guardar nada, así que la credencial vale solo mientras no
              recargues la página. Suele pasar en ventana privada.
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              setModo(modo === 'correo' ? 'llave' : 'correo');
              setFallo('');
            }}
            className="mt-6 w-full text-center text-[12px] text-[#8FA3B0] hover:text-[#E7EEF2] transition-colors"
          >
            {modo === 'correo' ? 'Tengo una llave de demostración' : 'Entrar con mi correo'}
          </button>

          <p className="mt-8 text-center text-[11px] leading-relaxed text-[#8FA3B0]">
            Dr Electrum FP es privado: catastro minero y expedientes de Honduras. Si tu correo está en
            el padrón, entrás con él; si venís a ver la demostración, pedí el enlace con llave.
          </p>
        </div>
      </div>
    </div>
  );
}
