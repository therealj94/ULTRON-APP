/**
 * TU CARTERA, COMO ESTADO: la dirección (sola desde tu cuenta de PULSE2CHAT, o pegada a mano), los saldos de
 * la red y tus movimientos de OrdenScan. Lo comparten la hoja «Cartera» (CuerpoCartera) y la pestaña Veta
 * Wallet de los chats (PantallaCartera). Solo lee mientras `activo` (la hoja abierta o la pestaña a la vista).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { tr } from '../i18n';
import { conectarAMano, desconectar, miCartera, type MiCartera } from './conexion';
import { leerHistorial, type Historial } from './movimientos';
import { leerSaldos, type Cartera } from './red';

export type EstadoMiCartera = {
  /** undefined = buscando; null = sin cartera conectada. */
  mia: MiCartera | null | undefined;
  cartera: Cartera | null;
  historial: Historial | null;
  cargando: boolean;
  error: string;
  /** El historial no se pudo leer (los saldos sí): se dice aparte, no tapa la cartera. */
  errorHistorial: string;
  actualizar: () => void;
  buscarOtraVez: () => void;
  guardarDireccion: (texto: string) => Promise<void>;
  quitar: () => Promise<void>;
};

export function useMiCartera(activo: boolean, o: { historial?: boolean; onDireccion?: (d: string | null) => void } = {}): EstadoMiCartera {
  const [mia, setMia] = useState<MiCartera | null | undefined>(undefined);
  const [cartera, setCartera] = useState<Cartera | null>(null);
  const [historial, setHistorial] = useState<Historial | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [errorHistorial, setErrorHistorial] = useState('');
  const conHistorial = !!o.historial;
  const aviso = useRef(o.onDireccion);
  aviso.current = o.onDireccion;
  const vivo = useRef(true);
  /**
   * La generación vigente (auditoría WAL01): cada conexión, cambio de dirección o desconexión la sube. Una
   * respuesta de una generación anterior (otra dirección, o llegada después de desconectar) se descarta:
   * nunca se pintan saldos o movimientos de otra cartera bajo la cabecera de esta.
   */
  const epoca = useRef(0);
  const vigente = useRef<string | null>(null);
  const fijarDireccion = (d: string | null) => {
    epoca.current++;
    if (d?.toLowerCase() !== vigente.current?.toLowerCase()) {
      setCartera(null);
      setHistorial(null);
      setError('');
      setErrorHistorial('');
    }
    vigente.current = d;
    return epoca.current;
  };
  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);

  const leer = useCallback(
    async (d: string, forzar: boolean) => {
      const e = epoca.current;
      // ¿Sigue siendo la misma cartera y la misma generación? Si no, la respuesta es de otra y se tira.
      const sirve = () => vivo.current && e === epoca.current && vigente.current?.toLowerCase() === d.toLowerCase();
      setCargando(true);
      const saldos = leerSaldos(d, { forzar })
        .then((c) => {
          if (!sirve() || c.direccion.toLowerCase() !== d.toLowerCase()) return;
          setCartera(c);
          setError('');
        })
        .catch((err: any) => sirve() && setError(err?.message || tr('No pude leer tu cartera ahora.', 'I couldn’t read your wallet right now.')));
      const movs = conHistorial
        ? leerHistorial(d, { forzar })
            .then((h) => {
              if (!sirve()) return;
              setHistorial(h);
              setErrorHistorial('');
            })
            .catch((err: any) => sirve() && setErrorHistorial(err?.message || tr('No pude leer tus movimientos.', 'I couldn’t read your activity.')))
        : Promise.resolve();
      await Promise.all([saldos, movs]);
      if (vivo.current && e === epoca.current) setCargando(false);
    },
    [conHistorial]
  );

  const conectar = useCallback(
    async (revisar: boolean) => {
      const e = ++epoca.current;
      const c = await miCartera({ revisar }).catch(() => null);
      // Otra conexión, un cambio de dirección o una desconexión llegaron mientras tanto: esta ya no manda.
      if (!vivo.current || e !== epoca.current) return;
      fijarDireccion(c?.direccion || null);
      setMia(c);
      aviso.current?.(c?.direccion || null);
      if (c) void leer(c.direccion, revisar);
    },
    [leer]
  );

  useEffect(() => {
    if (activo) void conectar(true);
  }, [activo, conectar]);

  return {
    mia,
    cartera,
    historial,
    cargando,
    error,
    errorHistorial,
    actualizar: () => {
      if (mia) void leer(mia.direccion, true);
    },
    buscarOtraVez: () => void conectar(true),
    guardarDireccion: async (texto: string) => {
      const c = await conectarAMano(texto);
      fijarDireccion(c.direccion);
      setMia(c);
      aviso.current?.(c.direccion);
      void leer(c.direccion, true);
    },
    quitar: async () => {
      fijarDireccion(null);
      await desconectar();
      fijarDireccion(null);
      setMia(null);
      setCartera(null);
      setHistorial(null);
      setCargando(false);
      aviso.current?.(null);
    },
  };
}
