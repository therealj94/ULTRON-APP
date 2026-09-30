/**
 * La conversación consultable: lo dicho, en orden, con el estado de cada turno (pensando, qué
 * herramienta usa, respondida y cuándo, sin respuesta, interrumpida), un botón para copiar cada
 * respuesta y las tarjetas de acción donde se confirma o se cancela lo que sale del sistema.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, Send, X, Clock, AlertTriangle, CircleCheck, Hourglass, Ban, ThumbsUp, ThumbsDown, Camera } from 'lucide-react';
import type { Entrada, EntradaAccion, EntradaAura } from './conversacion';

const HORA = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' });
export const hora = (ts: number) => HORA.format(new Date(ts));

/** Nombre humano de las herramientas del turno (las internas del razonamiento no se enseñan). */
const HERRAMIENTA: Record<string, string> = {
  oro: 'precio del oro',
  plata: 'precio de la plata',
  metales: 'precios de metales',
  hnl: 'tipo de cambio',
  fx: 'tipo de cambio',
  web: 'búsqueda en internet',
  pagina: 'abrir la página',
  foto: 'captura de la página',
  vision: 'la cámara',
  escena: 'la cámara',
  'pdf-leer': 'leer el PDF',
  pdf: 'PDF',
  rag: 'documentos',
  memoria: 'memoria',
  recordar: 'memoria',
  tareas: 'pendientes',
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  correo: 'correo',
  enviar: 'envío',
  urgente: 'aviso urgente',
  llamada: 'llamada',
  sistema: 'estado del sistema',
  mantenimiento: 'estado del sistema',
  boveda: 'bóveda',
  ejecutor: 'Python',
  'calculo-mina': 'cálculo de minería',
  concesiones: 'concesiones',
  app: 'tu teléfono',
};

export function nombresDeHerramientas(tools: readonly string[]): string[] {
  const out: string[] = [];
  for (const t of tools) {
    const n = HERRAMIENTA[t] || (t.startsWith('cerebro-') ? 'conocimiento de la plataforma' : '');
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

/** La línea de estado de un turno de AU-RA, en palabras. */
export function textoDeEstado(e: Pick<EntradaAura, 'estado' | 'herramientas' | 'ms' | 'tsFin' | 'ts'>): string {
  const usa = nombresDeHerramientas(e.herramientas);
  switch (e.estado) {
    case 'pensando':
      return 'Pensando…';
    case 'usando':
      return usa.length ? `Usando ${usa.join(', ')}…` : 'Buscando…';
    case 'respondiendo':
      return usa.length ? `Respondiendo · usó ${usa.join(', ')}` : 'Respondiendo…';
    case 'lista': {
      const partes = [`Respondida a las ${hora(e.tsFin || e.ts)}`];
      if (e.ms && e.ms > 0) partes.push(`${(e.ms / 1000).toLocaleString('es', { maximumFractionDigits: 1 })} s`);
      if (usa.length) partes.push(`usó ${usa.join(', ')}`);
      return partes.join(' · ');
    }
    case 'error':
      return 'Sin respuesta del cerebro · probá de nuevo';
    case 'interrumpida':
      return 'Interrumpida';
  }
}

async function copiarTexto(t: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch {
    // Sin permiso de portapapeles (http, iframe): el método viejo.
    try {
      const area = document.createElement('textarea');
      area.value = t;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function BotonCopiar({ texto, aviso }: { texto: string; aviso: (t: string) => void }) {
  const [hecho, setHecho] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 min-h-[44px] px-2 -mx-1 rounded-full text-(--aura-tinta-2) hover:text-(--aura-tinta) hover:bg-(--aura-oro-suave) cursor-pointer"
      onClick={async () => {
        const ok = await copiarTexto(texto);
        setHecho(ok);
        aviso(ok ? 'Respuesta copiada.' : 'No pude copiar: seleccioná el texto y copialo a mano.');
        if (ok) setTimeout(() => setHecho(false), 1800);
      }}
    >
      {hecho ? <Check className="w-4 h-4" aria-hidden="true" /> : <Copy className="w-4 h-4" aria-hidden="true" />}
      <span>{hecho ? 'Copiado' : 'Copiar'}</span>
    </button>
  );
}

const ESTADO_ACCION: Record<EntradaAccion['estado'], { texto: string; clase: string; Icono: typeof Clock }> = {
  propuesta: { texto: 'Esperando tu confirmación', clase: 'text-(--aura-oro-texto)', Icono: Clock },
  enviando: { texto: 'Enviando al servidor…', clase: 'text-(--aura-tinta-2)', Icono: Hourglass },
  hecha: { texto: 'Hecho: el canal lo confirmó', clase: 'text-(--aura-ok-texto)', Icono: CircleCheck },
  fallida: { texto: 'No se hizo', clase: 'text-(--aura-error-texto)', Icono: AlertTriangle },
  espera: { texto: 'En espera de aprobación', clase: 'text-(--aura-oro-texto)', Icono: Hourglass },
  'sin-confirmar': { texto: 'Sin confirmación del canal', clase: 'text-(--aura-tinta-2)', Icono: AlertTriangle },
  cancelada: { texto: 'Cancelada: no se mandó nada', clase: 'text-(--aura-tinta-2)', Icono: Ban },
};

export function TarjetaAccion({ e, onConfirmar, onCancelar }: { e: EntradaAccion; onConfirmar: (id: string) => void; onCancelar: (id: string) => void }) {
  const est = ESTADO_ACCION[e.estado];
  const idTitulo = `accion-${e.id}`;
  return (
    <article aria-labelledby={idTitulo} className="aura-tarjeta self-stretch sm:self-start sm:max-w-[560px] w-full p-4 flex flex-col gap-3 border-(--aura-oro)">
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-full bg-(--aura-oro-suave) text-(--aura-oro-texto) grid place-items-center shrink-0" aria-hidden="true">
          <Send className="w-5 h-5" />
        </span>
        <div className="min-w-0">
          <p className="aura-sobretitulo">Acción que sale del sistema</p>
          <h3 id={idTitulo} className="font-semibold text-[17px] leading-snug text-(--aura-tinta)">
            {e.accion.titulo}
          </h3>
        </div>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[15px]">
        <dt className="text-(--aura-tinta-2)">Para</dt>
        <dd className="text-(--aura-tinta) min-w-0">{e.accion.destinatario}</dd>
        <dt className="text-(--aura-tinta-2)">Contenido</dt>
        <dd className="text-(--aura-tinta) min-w-0 aura-seleccionable whitespace-pre-wrap [overflow-wrap:anywhere]">«{e.accion.contenido}»</dd>
        <dt className="text-(--aura-tinta-2)">Cuándo</dt>
        <dd className="text-(--aura-tinta)">
          {e.estado === 'propuesta' ? `En cuanto confirmes (pedido a las ${hora(e.ts)})` : e.tsResultado ? `Resultado a las ${hora(e.tsResultado)} (pedido a las ${hora(e.ts)})` : `Pedido a las ${hora(e.ts)}`}
        </dd>
      </dl>
      <p className={`flex items-center gap-2 text-[15px] font-medium ${est.clase}`} role="status">
        <est.Icono className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span>{est.texto}</span>
      </p>
      {e.resultado && e.estado !== 'propuesta' && (
        <p className="text-[15px] text-(--aura-tinta-2) aura-seleccionable [overflow-wrap:anywhere]">
          <span className="text-(--aura-tinta)">Respuesta del servidor:</span> {e.resultado}
        </p>
      )}
      {e.estado === 'propuesta' && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="aura-primario" onClick={() => onConfirmar(e.id)}>
            <Check className="w-4 h-4" aria-hidden="true" /> Confirmar y enviar
          </button>
          <button type="button" className="aura-secundario" onClick={() => onCancelar(e.id)}>
            <X className="w-4 h-4" aria-hidden="true" /> Cancelar
          </button>
        </div>
      )}
    </article>
  );
}

type Props = {
  entradas: Entrada[];
  onConfirmar: (id: string) => void;
  onCancelar: (id: string) => void;
  /** «¿Te sirvió?» sobre la última respuesta: su traza y en qué quedó. */
  opinion?: { id: string; estado: 'preguntar' | 'gracias' } | null;
  onOpinar?: (valor: 1 | -1) => void;
  /** Lo que se ve cuando todavía no hay nada (el inicio). */
  vacio?: React.ReactNode;
};

export function Conversacion({ entradas, onConfirmar, onCancelar, opinion, onOpinar, vacio }: Props) {
  const fin = useRef<HTMLDivElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  const [aviso, setAviso] = useState('');
  const ultimo = entradas[entradas.length - 1];
  const firma = ultimo ? `${ultimo.id}:${ultimo.tipo === 'aura' ? ultimo.texto.length + ultimo.estado : ultimo.tipo === 'accion' ? ultimo.estado : ''}` : '';

  // Baja sola con lo nuevo, salvo que la persona haya subido a leer algo anterior. Se decide con
  // dónde estaba ANTES de que llegara lo nuevo (después, una tarjeta alta ya la alejó del fondo).
  const pegada = useRef(true);
  useEffect(() => {
    if (pegada.current || ultimo?.tipo === 'persona') fin.current?.scrollIntoView({ block: 'end', behavior: matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [firma]);
  const alDesplazar = () => {
    const el = lista.current;
    if (el) pegada.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  const ultimaAura = [...entradas].reverse().find((x): x is EntradaAura => x.tipo === 'aura');

  return (
    <div ref={lista} onScroll={alDesplazar} className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 sm:px-5 py-4" tabIndex={0} role="region" aria-label="Conversación con AU-RA">
      {!entradas.length && vacio}
      <ol className="flex flex-col gap-3" role="list">
        {entradas.map((e) => {
          if (e.tipo === 'persona')
            return (
              <li key={e.id} className="flex flex-col items-end gap-1">
                <span className="sr-only">Tú, a las {hora(e.ts)}:</span>
                <p className="aura-mensaje persona aura-seleccionable">
                  {e.conFoto && <Camera className="inline w-4 h-4 mr-1.5 -mt-0.5 text-(--aura-oro-texto)" aria-label="con foto" />}
                  {e.texto}
                </p>
                <span className="text-[13px] text-(--aura-tinta-2) pr-2" aria-hidden="true">
                  {hora(e.ts)}
                </span>
              </li>
            );
          if (e.tipo === 'accion')
            return (
              <li key={e.id} className="flex flex-col">
                <TarjetaAccion e={e} onConfirmar={onConfirmar} onCancelar={onCancelar} />
              </li>
            );
          const trabajando = e.estado === 'pensando' || e.estado === 'usando' || (e.estado === 'respondiendo' && !e.texto);
          const esUltima = ultimaAura?.id === e.id;
          return (
            <li key={e.id} className="flex flex-col items-start gap-1" aria-busy={trabajando || undefined}>
              <span className="sr-only">AU-RA:</span>
              {e.texto ? (
                <p className="aura-mensaje aura-dice aura-seleccionable">{e.texto}</p>
              ) : (
                <p className="aura-mensaje aura-dice aura-puntos" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </p>
              )}
              <div className="aura-meta pl-2">
                <span className={e.estado === 'error' ? 'text-(--aura-error-texto)' : undefined}>{textoDeEstado(e)}</span>
                {e.texto && e.estado !== 'pensando' && <BotonCopiar texto={e.texto} aviso={setAviso} />}
                {esUltima && e.estado === 'lista' && opinion?.estado === 'preguntar' && opinion && onOpinar && (
                  <span className="inline-flex items-center gap-1" role="group" aria-label="¿Te sirvió esta respuesta?">
                    <span>¿Te sirvió?</span>
                    <button type="button" className="aura-redondo plano !w-11 !h-11" aria-label="Sí, me sirvió" onClick={() => onOpinar(1)}>
                      <ThumbsUp className="w-4 h-4" aria-hidden="true" />
                    </button>
                    <button type="button" className="aura-redondo plano !w-11 !h-11" aria-label="No me sirvió" onClick={() => onOpinar(-1)}>
                      <ThumbsDown className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </span>
                )}
                {esUltima && opinion?.estado === 'gracias' && <span>Gracias, lo anoto.</span>}
              </div>
            </li>
          );
        })}
      </ol>
      <div ref={fin} />
      {/* Lo que cambia se anuncia una vez: el turno terminado o la copia, no cada trozo del stream. */}
      <p className="sr-only" role="status" aria-live="polite">
        {aviso || (ultimaAura && (ultimaAura.estado === 'lista' || ultimaAura.estado === 'error') ? `AU-RA: ${ultimaAura.texto || textoDeEstado(ultimaAura)}` : '')}
      </p>
    </div>
  );
}
