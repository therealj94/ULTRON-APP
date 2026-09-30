/**
 * Muestrario de BotonAnimado: los 4 tipos, 3 tamaños, deshabilitado y cargando.
 * No está en la navegación; sirve para revisar el tema de un vistazo y para las capturas de prueba.
 */
import { useState } from 'react';
import { BotonAnimado } from './BotonAnimado';
import type { TipoBoton } from './temaBoton';

const TIPOS: { tipo: TipoBoton; texto: string }[] = [
  { tipo: 'primary', texto: 'Generar ficha' },
  { tipo: 'secondary', texto: 'Ver en el mapa' },
  { tipo: 'danger', texto: 'Borrar capa' },
  { tipo: 'link', texto: 'Ver detalles' },
];

export function EjemploBotones() {
  const [cargando, setCargando] = useState<TipoBoton | null>(null);
  const [ultimo, setUltimo] = useState('ninguno');

  const probar = (tipo: TipoBoton) => {
    setUltimo(tipo);
    setCargando(tipo);
    setTimeout(() => setCargando(null), 1500);
  };

  return (
    <div style={{ minHeight: '100vh', background: '#07090B', color: '#E7EEF2', padding: 32, fontFamily: "'IBM Plex Mono', monospace" }}>
      <h1 style={{ fontSize: 18, color: '#FFAE3B', letterSpacing: 3, margin: '0 0 24px' }}>BOTONES DE DR ELECTRUM</h1>

      <section style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
        {TIPOS.map(({ tipo, texto }) => (
          <BotonAnimado key={tipo} tipo={tipo} texto={texto} loading={cargando === tipo} onPress={() => probar(tipo)} />
        ))}
      </section>

      <p style={{ color: '#8FA3B0', fontSize: 13, margin: '16px 0 32px' }} aria-live="polite">
        Último pulsado: <b id="ultimo">{ultimo}</b>
      </p>

      <section style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', marginBottom: 32 }}>
        <BotonAnimado tamano="sm" texto="Pequeño" />
        <BotonAnimado tamano="md" texto="Mediano" />
        <BotonAnimado tamano="lg" texto="Grande" />
        <BotonAnimado texto="Deshabilitado" disabled />
        <BotonAnimado texto="Cargando" loading />
      </section>

      <section style={{ maxWidth: 340 }}>
        <BotonAnimado texto="Entrar" completo tamano="lg" />
      </section>
    </div>
  );
}

export default EjemploBotones;
