/**
 * El panel lateral: la consulta y los expedientes.
 *
 * Va al costado del mapa, no encima: lo que se pregunta y lo que se mira tienen que verse a la vez.
 * En teléfono se convierte en una lámina de abajo, porque a 400 px de ancho no caben dos columnas y
 * fingir que sí es peor que elegir.
 *
 * La traza de herramientas se muestra mientras trabaja. No es depuración: es lo que un ingeniero va
 * a exigir para creerle. «Consultó el catastro, midió sobre el elipsoide, encontró el traslape» vale
 * más que la respuesta sola.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FaceState } from '../../src/types';
import type { Emocion } from '../../lib/emocion';

type Props = {
  abierto: boolean;
  vista: 'chat' | 'expedientes';
  onFace: (f: FaceState) => void;
  onEmocion: (e: Emocion) => void;
  onUi: (datos: Array<Record<string, unknown>>) => void;
  onTrabajo: () => void;
};

type Turno = {
  de: 'persona' | 'electrum';
  texto: string;
  panel?: string;
  traza?: Array<{ herramienta: string; ok: boolean; resumen: string }>;
};

const AMBAR = '#FFAE3B';

const EJEMPLOS = [
  '¿se traslapa algo en el catastro?',
  'mostrame Cerro Partido',
  '250.000 toneladas a 3,4 g/t, ¿cuántas onzas?',
  '¿qué concesiones vencen este año?',
];

export function Panel({ abierto, vista, onFace, onEmocion, onUi, onTrabajo }: Props) {
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [texto, setTexto] = useState('');
  const [pensando, setPensando] = useState(false);
  const hilo = useRef<HTMLDivElement>(null);

  useEffect(() => {
    hilo.current?.scrollTo({ top: hilo.current.scrollHeight, behavior: 'smooth' });
  }, [turnos, pensando]);

  const preguntar = useCallback(
    async (pregunta: string) => {
      const q = pregunta.trim();
      if (!q || pensando) return;
      setTexto('');
      setTurnos((t) => [...t, { de: 'persona', texto: q }]);
      setPensando(true);
      onFace('THINKING');
      onTrabajo();

      try {
        const r = await fetch('/api/electrum/turno', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mensaje: q }),
        });
        const j = await r.json();
        if (Array.isArray(j.ui) && j.ui.length) onUi(j.ui);
        if (j.emocion) onEmocion(j.emocion);
        onFace('SPEAKING');
        setTurnos((t) => [...t, { de: 'electrum', texto: j.texto || j.error || 'No pude contestar.', panel: j.panel, traza: j.traza }]);
      } catch {
        onFace('CONCERNED');
        setTurnos((t) => [...t, { de: 'electrum', texto: 'No alcancé el servidor. Revisá la conexión y volvé a preguntarme.' }]);
      } finally {
        setPensando(false);
        setTimeout(() => onFace('IDLE'), 1200);
      }
    },
    [pensando, onFace, onEmocion, onUi, onTrabajo]
  );

  return (
    <aside
      className="absolute z-20 flex flex-col border-white/10 bg-[#0A0C0E]/92 backdrop-blur-xl
                 inset-x-0 bottom-0 h-[52%] border-t
                 md:inset-y-0 md:left-auto md:right-0 md:w-[380px] md:h-auto md:border-t-0 md:border-l md:pt-[52px]"
      style={{ transition: 'transform .4s ease', transform: abierto ? 'none' : 'translateY(100%)' }}
    >
      {vista === 'chat' ? (
        <>
          <div ref={hilo} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {!turnos.length && (
              <div className="space-y-3">
                <p className="text-sm text-[#8FA3B0] leading-relaxed">
                  Preguntame de minería, o del catastro que tengas cargado. Si nombrás una concesión, el mapa va sola.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {EJEMPLOS.map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => preguntar(e)}
                      className="px-2.5 py-1 rounded-full border border-white/12 text-[11px] text-[#9FB0B8] hover:text-white hover:border-white/25 transition-colors cursor-pointer text-left"
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {turnos.map((t, i) => (
              <div key={i} className={t.de === 'persona' ? 'text-right' : ''}>
                {t.de === 'electrum' && t.panel && (
                  <div className="font-mono text-[10px] tracking-[0.16em] uppercase mb-1" style={{ color: AMBAR }}>
                    {t.panel}
                  </div>
                )}
                <div
                  className={`inline-block max-w-[92%] rounded-xl px-3 py-2 text-sm leading-relaxed text-left ${
                    t.de === 'persona' ? 'bg-white/10 text-[#E7EEF2]' : 'bg-white/[0.045] text-[#DDE7EC]'
                  }`}
                >
                  {t.texto}
                </div>
                {t.traza?.length ? (
                  <ul className="mt-1.5 space-y-0.5">
                    {t.traza.map((h, j) => (
                      <li key={j} className="font-mono text-[10px] text-[#6C7F89] flex gap-1.5">
                        <span style={{ color: h.ok ? AMBAR : '#D9705A' }}>{h.ok ? '·' : '×'}</span>
                        <span className="truncate">
                          {h.herramienta} — {h.resumen}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}

            {pensando && <div className="font-mono text-[11px] text-[#6C7F89]">pensando…</div>}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              preguntar(texto);
            }}
            className="flex gap-2 p-3 border-t border-white/10"
          >
            <input
              id="electrum-pregunta"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Preguntale a Dr Electrum…"
              className="flex-1 min-w-0 bg-white/[0.06] border border-white/12 rounded-lg px-3 py-2 text-sm text-[#E7EEF2] placeholder:text-[#5E7078] focus:outline-none focus:border-[#FFAE3B]/60"
            />
            <button
              type="submit"
              disabled={pensando || !texto.trim()}
              className="px-3.5 rounded-lg text-black text-[12px] font-semibold disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
              style={{ background: AMBAR }}
            >
              Ir
            </button>
          </form>
        </>
      ) : (
        <Expedientes />
      )}
    </aside>
  );
}

/** Lo que se ha subido y quedó indexado. Sin nada cargado, dice cómo cargarlo. */
function Expedientes() {
  const [datos, setDatos] = useState<{ capas: any[]; documentos: any[] } | null>(null);
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    fetch('/api/electrum/expedientes')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setDatos)
      .catch(() => setFallo(true));
  }, []);

  if (fallo) {
    return (
      <div className="p-4 text-sm text-[#8FA3B0] leading-relaxed">
        No alcancé el catastro. Si todavía no está conectado, es normal: falta <code className="font-mono text-xs">ELECTRUM_DB_URL</code>.
      </div>
    );
  }
  if (!datos) return <div className="p-4 font-mono text-[11px] text-[#6C7F89]">cargando…</div>;

  const vacio = !datos.capas.length && !datos.documentos.length;
  if (vacio) {
    return (
      <div className="p-4 space-y-2 text-sm text-[#8FA3B0] leading-relaxed">
        <p>Todavía no hay nada cargado.</p>
        <p>
          Mandame shapefiles del catastro (<span className="font-mono text-xs">.zip</span>), KML, GeoJSON o CSV, y los informes en PDF. Lo
          geográfico se vuelve mapa y los documentos quedan citables con su página.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-5">
      {datos.capas.length > 0 && (
        <section>
          <h3 className="font-mono text-[10px] tracking-[0.18em] uppercase mb-2" style={{ color: AMBAR }}>
            Capas del mapa
          </h3>
          <ul className="space-y-1.5">
            {datos.capas.map((c) => (
              <li key={c.id} className="text-sm">
                <div className="text-[#E7EEF2]">{c.nombre}</div>
                <div className="font-mono text-[11px] text-[#6C7F89]">
                  {c.entidades} entidades · {c.formato} · {c.origen_crs}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {datos.documentos.length > 0 && (
        <section>
          <h3 className="font-mono text-[10px] tracking-[0.18em] uppercase mb-2" style={{ color: AMBAR }}>
            Expedientes
          </h3>
          <ul className="space-y-1.5">
            {datos.documentos.map((d) => (
              <li key={d.id} className="text-sm">
                <div className="text-[#E7EEF2]">{d.nombre}</div>
                <div className="font-mono text-[11px] text-[#6C7F89]">
                  {d.tipo} · {d.paginas} {d.paginas === 1 ? 'página' : 'páginas'}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
