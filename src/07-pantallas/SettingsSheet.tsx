import { perfil as perfilActual } from '../perfil';
import React, { useEffect, useRef, useState } from 'react';
import { X, Volume2, Mic, ShieldCheck, Fingerprint, Camera, Wand2, SlidersHorizontal, Lock, Activity, Trash2, MessageSquareX, KeyRound, Sparkles } from 'lucide-react';
import type { Mode, FaceState } from '../types';
import type { PreferenciaTema } from '../01-diseno/aura';
import type { Postura } from '../11-sala/tareas';
import { playSfx } from '../03-voz/audio';
import { Capacidades, Repertorio, VozOficial, useCatalogo, type Catalogo } from './Capacidades';
import { Control } from './Control';
import { Dialogo } from './Dialogo';
import { TuAura, type VistaAura } from './TuAura';

interface Props {
  isOpen: boolean;
  currentMode: Mode;
  currentFace: FaceState;
  soundFxEnabled: boolean;
  speakerEnabled: boolean;
  funMode: boolean;
  usuario: { name: string; authenticated: boolean };
  tema: PreferenciaTema;
  onTema: (t: PreferenciaTema) => void;
  /** Solo con la sala 3D: de pie o sentada. */
  postura?: Postura;
  onPostura?: (p: Postura) => void;
  estadoCerebro: string;
  estadoArranque: string;
  hayConversacion: boolean;
  onClose: () => void;
  onSelectMode: (mode: Mode) => void;
  onSelectFace: (face: FaceState) => void;
  onToggleSoundFx: () => void;
  onToggleSpeaker: () => void;
  onToggleFunMode: () => void;
  onOpenAcceso: () => void;
  onOpenVault: () => void;
  onOpenPhotos: () => void;
  onProbarVoz: () => void;
  onEjemplo: (cmd: string) => void;
  onOlvidar: () => void;
  onVaciarConversacion: () => void;
  /**
   * Abrir en una pestaña (y vista de «Tu AURA») concreta: «Más → Tus correos», o el aviso de leer el correo sin
   * cuenta. `n` cambia en cada pedido para que el mismo destino se pueda pedir otra vez.
   */
  abrirEn?: { tab: Tab; vista?: VistaAura; n: number } | null;
  /** El pedido que espera a que conecte un correo («léeme mi correo»): al conectarlo se ofrece retomarlo tal cual. */
  pedidoPendiente?: string | null;
  onRetomarPedido?: () => void;
}

export const MODOS: Array<{ id: Mode; label: string; desc: string }> = [
  { id: 'GUARDIAN', label: 'Guardián', desc: 'Firme, protege a la junta' },
  { id: 'EXPLORER', label: 'Explorador', desc: 'Curioso, pregunta más' },
  { id: 'GOLD', label: 'Oro', desc: 'Cálido, metal y bóveda' },
  { id: 'MINING', label: 'Minería', desc: 'Seco, operativo' },
  { id: 'ANALYTICAL', label: 'Analítico', desc: 'Preciso, cifras y fuentes' },
  { id: 'STRATEGIC', label: 'Estratégico', desc: 'Bajo, piensa a largo' },
  { id: 'CREATIVE', label: 'Creativo', desc: 'Juguetón, propone' },
];

/** El nombre del modo para decirlo o mostrarlo: en español, no el id interno. */
export const nombreModo = (m: Mode) => MODOS.find((x) => x.id === m)?.label || m;

const CARAS: FaceState[] = ['IDLE', 'HAPPY', 'LAUGH', 'SURPRISED', 'CURIOSITY', 'THINKING', 'CONCERNED', 'SAD', 'ANGRY', 'TIRED', 'PURR', 'WINK', 'SING', 'SLEEPING'];

/** Cómo se llama cada expresión para quien la prueba: en español, no el nombre interno. */
const NOMBRE_CARA: Partial<Record<FaceState, string>> = {
  IDLE: 'Serena', HAPPY: 'Feliz', LAUGH: 'Risa', SURPRISED: 'Sorpresa', CURIOSITY: 'Curiosa', THINKING: 'Pensando',
  CONCERNED: 'Preocupada', SAD: 'Triste', ANGRY: 'Molesta', TIRED: 'Cansada', PURR: 'Cariño', WINK: 'Traviesa',
  SING: 'Cantando', SLEEPING: 'Dormida', SPEAKING: 'Hablando', LISTENING: 'Escuchando',
};

export type Tab = 'preferencias' | 'voz' | 'aura' | 'privacidad' | 'diagnostico';
const TABS: Array<{ id: Tab; label: string; Icono: typeof Volume2 }> = [
  { id: 'preferencias', label: 'Preferencias', Icono: SlidersHorizontal },
  { id: 'voz', label: 'Voz', Icono: Mic },
  // P4/U1 (auditoría del 4-oct): correos, memoria del servidor y avisos, como en la app Expo.
  { id: 'aura', label: 'Tu AURA', Icono: Sparkles },
  { id: 'privacidad', label: 'Privacidad y datos', Icono: Lock },
  { id: 'diagnostico', label: 'Diagnóstico', Icono: Activity },
];

/** Un grupo de opciones excluyentes con semántica de radio y flechas, como pide ARIA. */
function Radios<T extends string>(p: { etiqueta: string; valor: T; opciones: Array<{ id: T; label: string }>; onCambio: (v: T) => void }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const mover = (i: number) => {
    const n = p.opciones.length;
    const j = (i + n) % n;
    p.onCambio(p.opciones[j].id);
    refs.current[j]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={p.etiqueta} className="aura-segmento">
      {p.opciones.map((o, i) => (
        <button
          key={o.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={p.valor === o.id}
          tabIndex={p.valor === o.id ? 0 : -1}
          onClick={() => p.onCambio(o.id)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') (e.preventDefault(), mover(i + 1));
            else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') (e.preventDefault(), mover(i - 1));
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Interruptor(p: { etiqueta: string; detalle?: string; activo: boolean; onCambio: () => void; icono?: React.ReactNode }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={p.activo}
      onClick={p.onCambio}
      className="w-full min-h-[56px] p-3 rounded-2xl border border-(--aura-borde) bg-(--aura-panel) flex items-center gap-3 text-left cursor-pointer hover:border-(--aura-oro)"
    >
      {p.icono && <span className="text-(--aura-oro-texto) shrink-0" aria-hidden="true">{p.icono}</span>}
      <span className="flex-1 min-w-0">
        <span className="block text-[16px] text-(--aura-tinta)">{p.etiqueta}</span>
        {p.detalle && <span className="block text-[14px] text-(--aura-tinta-2)">{p.detalle}</span>}
      </span>
      <span className={`relative w-12 h-7 rounded-full shrink-0 transition-colors ${p.activo ? 'bg-(--aura-oro)' : 'bg-(--aura-panel-2) border border-(--aura-borde-campo)'}`} aria-hidden="true">
        <span className={`absolute top-1 w-5 h-5 rounded-full transition-all ${p.activo ? 'left-6 bg-(--aura-sobre-oro)' : 'left-1 bg-(--aura-tinta-2)'}`} />
      </span>
      <span className="sr-only">{p.activo ? 'activado' : 'desactivado'}</span>
    </button>
  );
}

/**
 * Quién procesa cada cosa, dicho con lo que de verdad pasa en esta web (A22): el reconocimiento de
 * voz es el del navegador, la voz solo es «del servidor propio» si ese servidor está configurado, y
 * la cámara manda una imagen solo cuando se le pregunta qué ve.
 */
function QuienProcesa({ cat }: { cat: Catalogo | null }) {
  const v = cat?.voz;
  const filas: Array<{ que: string; como: string }> = [
    {
      que: 'Lo que decís por el micrófono',
      como: 'Mientras hablás, tu voz va en vivo a ElevenLabs (Scribe v2 Realtime Turbo) con un permiso de un solo uso que da el servidor de AU-RA; lo de dinero también pasa por el servidor para confirmarlo. Si el navegador no deja abrir el micrófono así, lo transcribe el reconocimiento de voz del navegador (en Chrome y Edge, servicios de Google o de Microsoft).',
    },
    {
      que: 'Lo que escribís o decís, y la respuesta',
      como: 'Lo procesa el servidor de AU-RA con su modelo y, según el pedido, con herramientas (precios, búsqueda web, páginas). Puede equivocarse: debajo de cada respuesta se ve qué herramienta usó.',
    },
    {
      que: 'La voz de AU-RA',
      como: (v?.voicebox || v?.eleven) && v.oficial
        ? `La sintetiza ${v.oficial.motor}.`
        : v
          ? 'Este servidor no tiene voz sintetizada configurada: suenan clips grabados desde el navegador y el texto queda en pantalla.'
          : 'Leyendo cómo está configurada…',
    },
    {
      que: 'La cámara',
      como: 'La detección de caras y gestos corre en este navegador. Solo cuando preguntás «¿qué ves?» o analizás una foto, esa imagen va al servidor para describirla.',
    },
    { que: 'Lo que le pedís recordar', como: 'Se guarda en este navegador y en el servidor de AU-RA, asociado a tu sesión.' },
    { que: 'Esta conversación en pantalla', como: 'Queda solo en esta pestaña: se borra al cerrarla o al cerrar sesión.' },
  ];
  return (
    <dl className="flex flex-col gap-2">
      {filas.map((f) => (
        <div key={f.que} className="aura-tarjeta honda p-3">
          <dt className="text-[15px] font-semibold text-(--aura-tinta)">{f.que}</dt>
          <dd className="text-[14px] text-(--aura-tinta-2) mt-0.5">{f.como}</dd>
        </div>
      ))}
    </dl>
  );
}

export const SettingsSheet: React.FC<Props> = (p) => {
  const [tab, setTab] = useState<Tab>('preferencias');
  const [vista, setVista] = useState<VistaAura>('menu');
  const refsTab = useRef<Array<HTMLButtonElement | null>>([]);
  // Abrir directo en un destino (Más → Tus correos; leer el correo sin cuenta).
  // Cada pedido se aplica una vez: abrir Ajustes después por otro lado no vuelve a saltar a ese destino.
  const aplicado = useRef(0);
  useEffect(() => {
    if (!p.isOpen || !p.abrirEn || p.abrirEn.n === aplicado.current) return;
    aplicado.current = p.abrirEn.n;
    setTab(p.abrirEn.tab);
    if (p.abrirEn.vista) setVista(p.abrirEn.vista);
  }, [p.isOpen, p.abrirEn?.n]);
  const { cat, error } = useCatalogo();
  const ejemplo = (c: string) => {
    p.onClose();
    p.onEjemplo(c);
  };
  const moverTab = (i: number) => {
    const j = (i + TABS.length) % TABS.length;
    setTab(TABS[j].id);
    refsTab.current[j]?.focus();
  };

  return (
    <Dialogo
      abierto={p.isOpen}
      onCerrar={p.onClose}
      idTitulo="aura-ajustes-titulo"
      id="ultron-settings-sheet"
      claseCapa="items-stretch sm:items-start justify-center sm:px-3 sm:pt-3"
      clase="aura-hoja aura-baja w-full max-w-3xl sm:rounded-[28px] flex flex-col max-h-full sm:max-h-[88vh] overflow-hidden"
    >
      <div className="flex items-center justify-between gap-3 px-4 sm:px-5 pt-[calc(12px+env(safe-area-inset-top))] sm:pt-4 pb-3">
        <h2 id="aura-ajustes-titulo" className="font-display font-semibold text-[20px] text-(--aura-tinta)">
          Ajustes
        </h2>
        <button type="button" onClick={p.onClose} className="aura-redondo plano" aria-label="Cerrar ajustes">
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      <div className="px-4 sm:px-5">
        <div role="tablist" aria-label="Secciones de ajustes" className="aura-pestanas">
          {TABS.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => {
                refsTab.current[i] = el;
              }}
              id={`aura-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              aria-controls={tab === t.id ? `aura-panel-${t.id}` : undefined}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight') (e.preventDefault(), moverTab(i + 1));
                else if (e.key === 'ArrowLeft') (e.preventDefault(), moverTab(i - 1));
                else if (e.key === 'Home') (e.preventDefault(), moverTab(0));
                else if (e.key === 'End') (e.preventDefault(), moverTab(TABS.length - 1));
              }}
            >
              <t.Icono className="w-4 h-4" aria-hidden="true" />
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div id={`aura-panel-${tab}`} role="tabpanel" aria-labelledby={`aura-tab-${tab}`} tabIndex={0} className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-5 py-4 flex flex-col gap-5 pb-[calc(16px+env(safe-area-inset-bottom))]">
        {tab === 'preferencias' && (
          <>
            <section className="flex flex-col gap-2" aria-labelledby="pref-apariencia">
              <h3 id="pref-apariencia" className="aura-sobretitulo">Apariencia</h3>
              <div className="flex flex-wrap items-center gap-3">
                <Radios
                  etiqueta="Tema"
                  valor={p.tema}
                  opciones={[
                    { id: 'sistema', label: 'Como el sistema' },
                    { id: 'claro', label: 'Claro' },
                    { id: 'oscuro', label: 'Oscuro' },
                  ]}
                  onCambio={p.onTema}
                />
              </div>
              {p.postura && p.onPostura && (
                <div className="flex flex-wrap items-center gap-3 mt-1">
                  <span className="text-[15px] text-(--aura-tinta-2)">Te contesta</span>
                  <Radios
                    etiqueta="Cómo te contesta"
                    valor={p.postura}
                    opciones={[
                      { id: 'pie', label: 'De pie' },
                      { id: 'sentada', label: 'Sentada' },
                    ]}
                    onCambio={p.onPostura}
                  />
                </div>
              )}
            </section>

            <section aria-labelledby="pref-personalidad">
              <div className="flex items-center justify-between mb-2 gap-2">
                <h3 id="pref-personalidad" className="aura-sobretitulo">Personalidad</h3>
                <span className="text-[14px] text-(--aura-tinta-3)">Activa: {nombreModo(p.currentMode)}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="radiogroup" aria-labelledby="pref-personalidad">
                {MODOS.map((m) => {
                  const on = p.currentMode === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => {
                        playSfx('mode', p.soundFxEnabled);
                        p.onSelectMode(m.id);
                      }}
                      className={`min-h-[64px] p-3 rounded-2xl border text-left flex flex-col gap-0.5 cursor-pointer ${
                        on ? 'border-(--aura-oro) bg-(--aura-oro-suave)' : 'border-(--aura-borde) bg-(--aura-panel) hover:border-(--aura-oro)'
                      }`}
                    >
                      <span className="font-semibold text-[15px] text-(--aura-tinta)">{m.label}</span>
                      <span className="text-[13px] text-(--aura-tinta-2)">{m.desc}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            <Interruptor etiqueta="Efectos de sonido" detalle="Toques y avisos cortos de la mesa" activo={p.soundFxEnabled} onCambio={p.onToggleSoundFx} icono={<Volume2 className="w-5 h-5" />} />

            <details className="aura-tarjeta honda p-3">
              <summary className="min-h-[44px] flex items-center cursor-pointer text-[15px] font-semibold text-(--aura-tinta)">Probar expresiones</summary>
              <div className="flex flex-col gap-3 pt-2">
                <div className="flex flex-wrap gap-1.5">
                  {CARAS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => {
                        playSfx('tap', p.soundFxEnabled);
                        p.onSelectFace(c);
                      }}
                      aria-pressed={p.currentFace === c}
                      className={`min-h-[44px] px-3 rounded-full text-[14px] font-medium border cursor-pointer ${
                        p.currentFace === c ? 'border-(--aura-oro) bg-(--aura-oro-suave) text-(--aura-tinta)' : 'border-(--aura-borde) bg-(--aura-panel) text-(--aura-tinta) hover:border-(--aura-oro)'
                      }`}
                    >
                      {NOMBRE_CARA[c] || c}
                    </button>
                  ))}
                </div>
                <Interruptor etiqueta="Modo diversión" detalle="Solo en la cara clásica (sin sala 3D)" activo={p.funMode} onCambio={p.onToggleFunMode} icono={<Wand2 className="w-5 h-5" />} />
              </div>
            </details>
          </>
        )}

        {tab === 'voz' && (
          <>
            <Interruptor etiqueta="Voz de AU-RA" detalle={p.speakerEnabled ? 'Contesta en voz alta' : 'Silenciada: solo texto en pantalla'} activo={p.speakerEnabled} onCambio={p.onToggleSpeaker} icono={<Volume2 className="w-5 h-5" />} />
            <VozOficial cat={cat} onProbarVoz={p.onProbarVoz} />
            <div className="aura-tarjeta honda p-3">
              <p className="text-[15px] font-semibold text-(--aura-tinta)">Cómo te oye</p>
              <p className="text-[14px] text-(--aura-tinta-2) mt-0.5">
                Con el micrófono abierto escucha todo el tiempo y podés interrumpirla hablando. En esta web tu voz va en vivo a ElevenLabs (Scribe v2 Realtime Turbo) y el texto aparece mientras hablás; si el navegador no lo permite, usa el reconocimiento de voz del navegador (ver «Privacidad y datos»).
              </p>
            </div>
            <Repertorio cat={cat} onEjemplo={ejemplo} />
          </>
        )}

        {tab === 'aura' && <TuAura vista={vista} onVista={setVista} pedidoPendiente={p.pedidoPendiente} onRetomar={p.onRetomarPedido} />}

        {tab === 'privacidad' && (
          <>
            <section className="flex flex-col gap-2" aria-labelledby="priv-quien">
              <h3 id="priv-quien" className="aura-sobretitulo">Quién procesa cada cosa</h3>
              <QuienProcesa cat={cat} />
            </section>
            <section className="flex flex-col gap-2" aria-labelledby="priv-sesion">
              <h3 id="priv-sesion" className="aura-sobretitulo">Tu sesión</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    p.onClose();
                    p.onOpenAcceso();
                  }}
                  className={`min-h-[52px] p-3 rounded-2xl border flex items-center gap-2 text-[15px] font-medium cursor-pointer ${
                    p.usuario.authenticated ? 'border-(--aura-salvia-borde) bg-(--aura-salvia-fondo) text-(--aura-salvia-texto)' : 'border-(--aura-oro) bg-(--aura-oro-suave) text-(--aura-tinta)'
                  }`}
                >
                  {p.usuario.authenticated ? <ShieldCheck className="w-5 h-5" aria-hidden="true" /> : <Fingerprint className="w-5 h-5" aria-hidden="true" />}
                  <span>{p.usuario.authenticated ? `Sesión: ${p.usuario.name}` : 'Entrar a la junta'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    p.onClose();
                    p.onOpenVault();
                  }}
                  className="min-h-[52px] p-3 rounded-2xl border border-(--aura-borde) bg-(--aura-panel) text-(--aura-tinta) hover:border-(--aura-oro) flex items-center gap-2 text-[15px] font-medium cursor-pointer"
                >
                  <KeyRound className="w-5 h-5 text-(--aura-oro-texto)" aria-hidden="true" /> Bóveda de claves
                </button>
                <button
                  type="button"
                  onClick={() => {
                    p.onClose();
                    p.onOpenPhotos();
                  }}
                  className="min-h-[52px] p-3 rounded-2xl border border-(--aura-borde) bg-(--aura-panel) text-(--aura-tinta) hover:border-(--aura-oro) flex items-center gap-2 text-[15px] font-medium cursor-pointer"
                >
                  <Camera className="w-5 h-5 text-(--aura-oro-texto)" aria-hidden="true" /> Fotos de esta visita
                </button>
              </div>
            </section>
            <section className="flex flex-col gap-2" aria-labelledby="priv-borrar">
              <h3 id="priv-borrar" className="aura-sobretitulo">Borrar</h3>
              <div className="flex flex-col sm:flex-row gap-2">
                <button type="button" className="aura-secundario" onClick={p.onVaciarConversacion} disabled={!p.hayConversacion}>
                  <MessageSquareX className="w-4 h-4" aria-hidden="true" /> Vaciar la conversación en pantalla
                </button>
                <button
                  type="button"
                  className="aura-secundario peligro"
                  onClick={() => {
                    p.onVaciarConversacion();
                    p.onOlvidar();
                  }}
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" /> Borrar conversación y memoria local
                </button>
              </div>
              {/* P4: lo que AU-RA guarda EN EL SERVIDOR se gestiona dato por dato; borrar lo local no lo reemplaza. */}
              <button
                type="button"
                className="aura-secundario self-start"
                onClick={() => {
                  setTab('aura');
                  setVista('conocer');
                }}
              >
                Lo que sé de ti (en el servidor): corregir, «No usarlo» u olvidar
              </button>
            </section>
          </>
        )}

        {tab === 'diagnostico' && (
          <>
            <section className="aura-tarjeta honda p-3 flex flex-col gap-1" aria-labelledby="diag-estado">
              <h3 id="diag-estado" className="aura-sobretitulo">Estado</h3>
              <p className="text-[15px] text-(--aura-tinta)">
                Cerebro: {p.estadoCerebro} <span className="text-(--aura-tinta-2)">· {p.estadoArranque}</span>
              </p>
              <p className="text-[14px] text-(--aura-tinta-2)">Plataforma: {perfilActual().plataforma}</p>
            </section>
            <section aria-labelledby="diag-capacidades" className="flex flex-col gap-2">
              <h3 id="diag-capacidades" className="aura-sobretitulo">Qué puede hacer y si responde ahora</h3>
              <Capacidades cat={cat} error={error} onEjemplo={ejemplo} />
            </section>
            <section aria-labelledby="diag-control" className="flex flex-col gap-2">
              <h3 id="diag-control" className="aura-sobretitulo">Control (con mando)</h3>
              <Control />
            </section>
          </>
        )}
      </div>
    </Dialogo>
  );
};
