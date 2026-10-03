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
  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);

  const leer = useCallback(
    async (d: string, forzar: boolean) => {
      setCargando(true);
      const saldos = leerSaldos(d, { forzar })
        .then((c) => {
          if (!vivo.current) return;
          setCartera(c);
          setError('');
        })
        .catch((e: any) => vivo.current && setError(e?.message || tr('No pude leer tu cartera ahora.', 'I couldn’t read your wallet right now.')));
      const movs = conHistorial
        ? leerHistorial(d, { forzar })
            .then((h) => {
              if (!vivo.current) return;
              setHistorial(h);
              setErrorHistorial('');
            })
            .catch((e: any) => vivo.current && setErrorHistorial(e?.message || tr('No pude leer tus movimientos.', 'I couldn’t read your activity.')))
        : Promise.resolve();
      await Promise.all([saldos, movs]);
      if (vivo.current) setCargando(false);
    },
    [conHistorial]
  );

  const conectar = useCallback(
    async (revisar: boolean) => {
      const c = await miCartera({ revisar }).catch(() => null);
      if (!vivo.current) return;
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
      setMia(c);
      aviso.current?.(c.direccion);
      void leer(c.direccion, true);
    },
    quitar: async () => {
      await desconectar();
      setMia(null);
      setCartera(null);
      setHistorial(null);
      aviso.current?.(null);
    },
  };
}
