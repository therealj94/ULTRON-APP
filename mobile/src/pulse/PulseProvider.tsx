/**
 * PULSE2CHAT dentro de AU-RA: la cuenta del chat, el buzón de señales y las llamadas.
 *
 * Mientras la app está en primer plano, este aparato escucha SU buzón (el relevo reparte cada señal
 * a cada aparato de la cuenta): así una llamada entrante suena aquí aunque la persona esté hablando
 * con el avatar. En segundo plano se deja de escuchar (batería); sin avisos push —AU-RA todavía no
 * tiene credenciales FCM propias— una llamada con la app cerrada suena solo en la app Orden Global.
 * Si una llamada TERMINA con la app en segundo plano, el buzón se suelta en ese momento (antes quedaba
 * escuchando hasta volver a abrir la app, gastando batería y datos).
 *
 * Aquí se registran también los manejadores de voz del chat (`borradores.ts`: redactar, enviar,
 * descartar) y, mientras la navegación nueva no los tome, este proveedor abre el chat en su ventana
 * (`PulseChat`) cuando AURA pide `abrir_chat` o `abrir: chats`. `abrirChatEnModal={false}` le deja
 * eso a la navegación.
 *
 * La pantalla de llamada se pinta aquí, encima de todo: una llamada no espera a que abras el chat.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import * as RELEVO from './relevo';
import * as LLAMADA from './llamada';
import * as CHATS from './chats';
import './borradores';
import { emitir, escuchar } from '../nucleo/contrato';
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
  /** Abre la ventana del chat (en la lista, o en el hilo con `con`: correo o nombre). */
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

/** Igual que `usePulse`, pero null fuera del proveedor (las pantallas de chat funcionan sin él). */
export function usePulseSiHay(): Ctx | null {
  return useContext(PulseCtx);
}

/** Correo si ya lo es; si no, el contacto que más se parece al nombre; si nadie, lo que vino. */
function correoDe(con: string): string {
  const c = String(con || '').trim();
  if (/^[^@\s]+@[^@\s]+$/.test(c)) return c.toLowerCase();
  return RELEVO.resolverContacto(c)?.correo || c;
}

export function PulseProvider({ children, abrirChatEnModal = true }: { children: ReactNode; abrirChatEnModal?: boolean }) {
  const [cuenta, setCuenta] = useState<RELEVO.Cuenta | null>(null);
  const [conectando, setConectando] = useState(false);
  const [error, setError] = useState('');
  const [llamada, setLlamada] = useState<LLAMADA.Cuento>(LLAMADA.cuento());
  const escribiendo = CHATS.useEscribiendo();
  const [abierto, setAbierto] = useState(false);
  const [conInicial, setConInicial] = useState<string | undefined>(undefined);
  const activa = useRef(AppState.currentState === 'active');

  // La cuenta del chat que ya estaba en este teléfono (la dejó «Entrar con Genesis ID»).
  useEffect(() => {
    let vivo = true;
    void RELEVO.recuperar().then((c) => vivo && setCuenta(c));
    // Entrar o salir desde donde sea (la entrada con Genesis ID, Ajustes, App.tsx al cerrar sesión,
    // un 401 del relevo): el proveedor se entera y arranca o suelta el buzón.
    const fuera = RELEVO.escucharCuenta(() => {
      if (vivo) setCuenta(RELEVO.quien());
    });
    const desconexion = CHATS.escucharDesconexion(() => void RELEVO.salir());
    return () => {
      vivo = false;
      fuera();
      desconexion();
    };
  }, []);

  /** Suelta el buzón si la app no está delante y ya no hay llamada (la batería no escucha de más). */
  const soltarSiDetras = useCallback(() => {
    if (!activa.current && !LLAMADA.enLlamada()) RELEVO.dejarDeEscuchar();
  }, []);

  // El motor de llamadas habla por el relevo y avisa a esta pantalla. `mandar` devuelve la promesa
  // de `RELEVO.senalar`, que RECHAZA con el motivo real (403/413/429/red) para quien quiera leerlo.
  useEffect(() => {
    LLAMADA.arrancar({
      mandar: (para, tipo, datos) => RELEVO.senalar(para, tipo, datos),
      alCambiar: (c) => {
        setLlamada(c);
        if (c.estado === 'libre') soltarSiDetras();
      },
      traerTurno: RELEVO.turno,
      aparato: RELEVO.miId,
    });
  }, [soltarSiDetras]);

  // La llamada terminó (lo avisa el motor de llamadas por el bus): si la app está detrás, se suelta.
  useEffect(
    () =>
      escuchar('llamada', (e) => {
        if (!e.activa) soltarSiDetras();
      }),
    [soltarSiDetras]
  );

  // Escuchar el buzón mientras la app está delante y hay cuenta.
  const alLlegar = useCallback((s: RELEVO.Senal) => {
    if (LLAMADA.ES_DE_LLAMADA(s.tipo)) {
      void LLAMADA.recibir(s);
      return;
    }
    if (s.tipo === 'escribe') CHATS.marcarEscribiendo(String(s.de));
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
      else soltarSiDetras();
    });
    return () => {
      sub.remove();
      RELEVO.dejarDeEscuchar();
    };
  }, [cuenta, alLlegar, soltarSiDetras]);

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

  const abrir = useCallback((con?: string) => {
    setConInicial(con ? correoDe(con) : undefined);
    setAbierto(true);
  }, []);
  const cerrar = useCallback(() => {
    setAbierto(false);
    // Al cerrar la ventana del chat se vuelve a la mesa (la ventana se abre desde ahí).
    emitir('pantalla', { pantalla: 'mesa', chatAbierto: null });
  }, []);

  // Lo que AURA pide sobre el chat, mientras la navegación nueva no lo tome.
  const abiertoRef = useRef(abierto);
  abiertoRef.current = abierto;
  useEffect(() => {
    if (!abrirChatEnModal) return;
    return escuchar('accion', (a) => {
      if (a.tipo === 'abrir_chat') {
        const correo = correoDe(a.con);
        const ok = /^[^@\s]+@[^@\s]+$/.test(correo);
        if (ok) abrir(correo);
        emitir('hecho', { accion: a, ok, ...(ok ? {} : { detalle: `No encuentro a «${a.con}» entre tus contactos.` }) });
      } else if (a.tipo === 'abrir' && a.pantalla === 'chats') {
        abrir();
        emitir('hecho', { accion: a, ok: true });
      } else if (a.tipo === 'abrir' && abiertoRef.current) {
        // Otra pantalla: la ventana del chat se aparta para que se vea.
        cerrar();
      }
    });
  }, [abrirChatEnModal, abrir, cerrar]);

  const valor = useMemo<Ctx>(
    () => ({ cuenta, conectando, error, conectar, salir, llamada, escribiendo, abierto, abrir, cerrar }),
    [cuenta, conectando, error, conectar, salir, llamada, escribiendo, abierto, abrir, cerrar]
  );

  return (
    <PulseCtx.Provider value={valor}>
      {children}
      <PulseChat visible={abierto} conInicial={conInicial} onCerrar={cerrar} />
      {llamada.estado !== 'libre' || llamada.motivo ? <PantallaLlamada cuento={llamada} onListo={() => setLlamada(LLAMADA.cuento())} /> : null}
    </PulseCtx.Provider>
  );
}
