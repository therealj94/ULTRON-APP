/**
 * La puerta de Dr Electrum FP.
 *
 * Antes no existía: la web daba por hecho que ya habías entrado en ULTRON en ESE mismo navegador, y
 * si no, te encontrabas la estación montada y una línea en la conversación diciendo que no tenías
 * acceso. Una puerta cerrada sin manija. La app móvil sí tenía su pantalla de entrada; la web no, y
 * eso es justo lo que hizo que el enlace «no diera acceso».
 *
 * Dos maneras de entrar, las mismas que reconoce el servidor:
 *
 *  · **Correo y clave.** Va contra `/api/ultron/entrar`, que es la puerta de la casa: la sesión es
 *    una sola para las dos plataformas y a cuál te deja entrar lo decide el padrón del servidor.
 *  · **Llave de demostración.** Para enseñarle esto a alguien sin crearle sesión.
 *
 * Lo que NO hace: decidir si tenés permiso. Eso lo dice el servidor y solo el servidor; aquí se
 * guarda la credencial y se vuelve a llamar a la puerta.
 */
import { useState, type FormEvent } from 'react';
import { guardarSesion, puertaAbierta } from './acceso';

const ACENTO = '#FFAE3B';

export function Entrar({ onAbierta }: { onAbierta: () => void }) {
  const [correo, setCorreo] = useState('');
  const [clave, setClave] = useState('');
  const [llave, setLlave] = useState('');
  const [modo, setModo] = useState<'correo' | 'llave'>('correo');
  const [yendo, setYendo] = useState(false);
  const [fallo, setFallo] = useState('');

  async function entrarConCorreo(e: FormEvent) {
    e.preventDefault();
    if (!correo.trim() || !clave) return;
    setYendo(true);
    setFallo('');
    try {
      const r = await fetch('/api/ultron/entrar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correo: correo.trim(), clave }),
      });
      const j = await r.json().catch(() => ({}) as any);
      if (!r.ok || !j?.token) {
        setFallo(j?.error || j?.message || 'Ese correo y esa clave no abren.');
        return;
      }
      guardarSesion(String(j.token));
      // Entrar en ULTRON no es entrar en Electrum: el padrón puede dejarte en uno y no en el otro,
      // y decirlo aquí es mejor que dejar pasar a una estación que no va a contestar.
      if (await puertaAbierta()) onAbierta();
      else setFallo('Entraste en ULTRON, pero tu cuenta no tiene acceso a Dr Electrum FP. Pedíselo a José.');
    } catch (err: any) {
      setFallo(String(err?.message || err).slice(0, 140) || 'No pude contactar con el servidor.');
    } finally {
      setYendo(false);
    }
  }

  async function entrarConLlave(e: FormEvent) {
    e.preventDefault();
    if (!llave.trim()) return;
    setYendo(true);
    setFallo('');
    try {
      localStorage.setItem('electrum_llave', llave.trim());
    } catch {
      sessionStorage.setItem('electrum_llave', llave.trim());
    }
    if (await puertaAbierta()) onAbierta();
    else setFallo('Esa llave no abre. Pedile a José la vigente.');
    setYendo(false);
  }

  const campo =
    'w-full rounded-lg bg-white/[0.04] border border-white/10 px-3 py-2.5 text-[15px] text-[#E7EEF2] ' +
    'placeholder:text-[#8FA3B0]/50 outline-none focus:border-[#FFAE3B]/60 transition-colors';

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
                placeholder="tu correo"
                value={correo}
                onChange={(e) => setCorreo(e.target.value)}
                disabled={yendo}
              />
              <input
                className={campo}
                type="password"
                autoComplete="current-password"
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

          <p className="mt-8 text-center text-[11px] leading-relaxed text-[#8FA3B0]/60">
            Dr Electrum FP es privado. La sesión es la misma que la de ULTRON: si ya entraste ahí en
            este navegador, no hace falta repetirlo.
          </p>
        </div>
      </div>
    </div>
  );
}
