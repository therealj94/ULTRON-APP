/**
 * PULSE2CHAT dentro de AU-RA: la cuenta del chat, el buzón de señales y las llamadas.
 *
 * Mientras la app está en primer plano, este aparato escucha SU buzón (el relevo reparte cada señal
 * a cada aparato de la cuenta): así una llamada entrante suena aquí aunque la persona esté hablando
 * con el avatar. En segundo plano se deja de escuchar (batería); sin avisos push —AU-RA todavía no
 * tiene credenciales FCM propias— una llamada con la app cerrada suena solo en la app Orden Global.
 *
 * La pantalla de llamada se pinta aquí, encima de todo: una llamada no espera a que abras el chat.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import * as RELEVO from './relevo';
import * as LLAMADA from './llamada';
import { conectarChat } from '../lib/genesis';
import { PantallaLlamada } from './PantallaLlamada';
import { PulseChat } from './PulseChat';
import { miga } from '../lib/reporte';

type Ctx = {
  cuenta: RELEVO.Cuenta | null;
  conectando: boolean;
  error: string;
  conectar: () => Promise<void>;
  salir: () => Promise<void>;
  llamada: LLAMADA.Cuento;
  /** correo → hasta cuándo se muestra «escribiendo…» */
  escribiendo: Record<string, number>;
  abrir: (con?: string) => void;
  cerrar: () => void;
  abierto: boolean;
};

const PulseCtx = createContext<Ctx | null>(null);

export function usePulse(): Ctx {
  const c = useContext(PulseCtx);
  if (!c) throw new Error('usePulse fuera de PulseProvider');
  return c;
}

export function PulseProvider({ children }: { children: ReactNode }) {
  const [cuenta, setCuenta] = useState<RELEVO.Cuenta | null>(null);
  const [conectando, setConectando] = useState(false);
  const [error, setError] = useState('');
  const [llamada, setLlamada] = useState<LLAMADA.Cuento>(LLAMADA.cuento());
  const [escribiendo, setEscribiendo] = useState<Record<string, number>>({});
  const [abierto, setAbierto] = useState(false);
  const [conInicial, setConInicial] = useState<string | undefined>(undefined);
  const activa = useRef(AppState.currentState === 'active');

  // La cuenta del chat que ya estaba en este teléfono (la dejó «Entrar con Genesis ID»).
  useEffect(() => {
    let vivo = true;
    void RELEVO.recuperar().then((c) => vivo && setCuenta(c));
    return () => {
      vivo = false;
    };
  }, []);

  // El motor de llamadas habla por el relevo y avisa a esta pantalla.
  useEffect(() => {
    LLAMADA.arrancar({
      mandar: (para, tipo, datos) => void RELEVO.senalar(para, tipo, datos),
      alCambiar: (c) => setLlamada(c),
      traerTurno: RELEVO.turno,
      aparato: RELEVO.miId,
    });
  }, []);

  // Escuchar el buzón mientras la app está delante y hay cuenta.
  const alLlegar = useCallback((s: RELEVO.Senal) => {
    if (LLAMADA.ES_DE_LLAMADA(s.tipo)) {
      void LLAMADA.recibir(s);
      return;
    }
    if (s.tipo === 'escribe') setEscribiendo((e) => ({ ...e, [String(s.de).toLowerCase()]: Date.now() + 4000 }));
  }, []);

  useEffect(() => {
    if (!cuenta) return;
    const arrancar = () => {
      if (activa.current) void RELEVO.escuchar(alLlegar);
    };
    arrancar();
    const sub = AppState.addEventListener('change', (st) => {
      activa.current = st === 'active';
      // En segundo plano se suelta el buzón, salvo en plena llamada (se colgaría sola).
      if (st === 'active') arrancar();
      else if (!LLAMADA.enLlamada()) RELEVO.dejarDeEscuchar();
    });
    return () => {
      sub.remove();
      RELEVO.dejarDeEscuchar();
    };
  }, [cuenta, alLlegar]);

  const conectar = useCallback(async () => {
    setConectando(true);
    setError('');
    try {
      const r = await conectarChat();
      if (!r.ok) {
        setError(r.mensaje || 'No se pudo conectar el chat.');
        return;
      }
      setCuenta(RELEVO.quien());
    } catch (e: any) {
      miga(`chat: no conectó (${String(e?.message || e).slice(0, 80)})`);
      setError('No se pudo conectar el chat.');
    } finally {
      setConectando(false);
    }
  }, []);

  const salir = useCallback(async () => {
    await RELEVO.salir();
    setCuenta(null);
  }, []);

  const valor = useMemo<Ctx>(
    () => ({
      cuenta,
      conectando,
      error,
      conectar,
      salir,
      llamada,
      escribiendo,
      abierto,
      abrir: (con?: string) => {
        setConInicial(con);
        setAbierto(true);
      },
      cerrar: () => setAbierto(false),
    }),
    [cuenta, conectando, error, conectar, salir, llamada, escribiendo, abierto]
  );

  return (
    <PulseCtx.Provider value={valor}>
      {children}
      <PulseChat visible={abierto} conInicial={conInicial} onCerrar={() => setAbierto(false)} />
      {llamada.estado !== 'libre' || llamada.motivo ? <PantallaLlamada cuento={llamada} onListo={() => setLlamada(LLAMADA.cuento())} /> : null}
    </PulseCtx.Provider>
  );
}
