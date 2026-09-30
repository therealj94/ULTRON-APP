/**
 * Lo primero que se ve: un saludo corto, en qué está AU-RA, y tres cosas reales para pedirle. Los
 * ejemplos son herramientas públicas del catálogo (lib/capacidades.ts): funcionan sin sesión.
 */
import React from 'react';
import { Coins, Globe, Landmark } from 'lucide-react';

export const EJEMPLOS_INICIO: ReadonlyArray<{ texto: string; pedido: string; icono: 'oro' | 'web' | 'cambio' }> = [
  { texto: '¿Cómo está el oro hoy?', pedido: 'precio del oro hoy', icono: 'oro' },
  { texto: 'Buscá noticias de Honduras de hoy', pedido: 'busca noticias de Honduras hoy', icono: 'web' },
  { texto: '¿A cuánto está el lempira?', pedido: 'lempira a dólar', icono: 'cambio' },
];

const ICONO = { oro: Coins, web: Globe, cambio: Landmark };

export function saludoDeHora(d = new Date()): string {
  const h = d.getHours();
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
}

type Props = {
  nombre?: string;
  /** En qué está: «Lista», «Despertando», «Sin cerebro». */
  estado: string;
  onPedir: (pedido: string) => void;
  /** Tarjeta flotante (conversar) o dentro del panel (trabajar). */
  flotante?: boolean;
  onCerrar?: () => void;
};

export function Inicio({ nombre, estado, onPedir, flotante, onCerrar }: Props) {
  const primer = nombre ? nombre.split(' ')[0] : '';
  return (
    <section aria-labelledby="aura-inicio-titulo" className={`flex flex-col gap-3 ${flotante ? 'aura-tarjeta aura-sombra aura-sube p-4 sm:p-5' : 'px-1 py-2'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="aura-inicio-titulo" className="font-display font-semibold text-[20px] leading-tight text-(--aura-tinta)">
            {saludoDeHora()}{primer ? `, ${primer}` : ''}. ¿En qué te ayudo?
          </h2>
          <p className="aura-inicio-sub text-[14px] text-(--aura-tinta-2) mt-1">
            {estado === 'Lista'
              ? 'Hablame o escribime. Por ejemplo:'
              : estado === 'Despertando'
                ? 'Se está despertando: en un momento contesta. Por ejemplo:'
                : 'El cerebro no responde ahora; lo local (chistes, canto, fotos) sí funciona.'}
          </p>
        </div>
        {onCerrar && (
          <button type="button" onClick={onCerrar} className="aura-secundario !min-h-[44px] !px-3 text-[14px] shrink-0" aria-label="Ocultar sugerencias">
            Ocultar
          </button>
        )}
      </div>
      <ul className="flex flex-col sm:flex-row sm:flex-wrap gap-2" role="list">
        {EJEMPLOS_INICIO.map((e) => {
          const Icono = ICONO[e.icono];
          return (
            <li key={e.pedido}>
              <button type="button" className="aura-chip w-full sm:w-auto" onClick={() => onPedir(e.pedido)}>
                <Icono className="w-4 h-4" aria-hidden="true" />
                <span>{e.texto}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
