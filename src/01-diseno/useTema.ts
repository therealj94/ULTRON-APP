/**
 * Claro, oscuro o lo que diga el sistema. La elección se guarda en este navegador (es una
 * comodidad de quien mira, no un dato de la cuenta) y, si no hay, manda `prefers-color-scheme`.
 *
 * Devuelve las variables `--aura-*` para ponerlas en la raíz de la app; además pinta el fondo del
 * documento y el color de la barra del navegador, para que no asome el carbón en tema claro.
 */
import { useEffect, useMemo, useState } from 'react';
import { TEMAS, variablesDe, type NombreTema, type PreferenciaTema } from './aura';

const CLAVE = 'aura_tema';

function leerPreferencia(): PreferenciaTema {
  try {
    const v = localStorage.getItem(CLAVE);
    return v === 'claro' || v === 'oscuro' ? v : 'sistema';
  } catch {
    return 'sistema';
  }
}

const consulta = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null);

export function useTema() {
  const [preferencia, setPreferencia] = useState<PreferenciaTema>(leerPreferencia);
  const [sistemaClaro, setSistemaClaro] = useState(() => !!consulta()?.matches);

  useEffect(() => {
    const mq = consulta();
    if (!mq) return;
    const cambio = () => setSistemaClaro(mq.matches);
    mq.addEventListener?.('change', cambio);
    return () => mq.removeEventListener?.('change', cambio);
  }, []);

  useEffect(() => {
    try {
      if (preferencia === 'sistema') localStorage.removeItem(CLAVE);
      else localStorage.setItem(CLAVE, preferencia);
    } catch {
      /* sin almacenamiento: vale para esta visita */
    }
  }, [preferencia]);

  const tema: NombreTema = preferencia === 'sistema' ? (sistemaClaro ? 'claro' : 'oscuro') : preferencia;
  const variables = useMemo(() => variablesDe(tema), [tema]);

  useEffect(() => {
    const fondo = TEMAS[tema].fondo;
    document.body.style.backgroundColor = fondo;
    document.documentElement.style.colorScheme = tema === 'claro' ? 'light' : 'dark';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', fondo);
  }, [tema]);

  return { preferencia, setPreferencia, tema, variables };
}
