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
import { capturaDelMapa } from '../mapa/Mapa';
import { headersElectrum, SIN_PUERTA } from '../acceso';

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
  /** Si el turno produjo un informe, queda a mano para bajarlo. */
  informe?: { nombre: string; url: string; bytes: number };
};

const AMBAR = '#FFAE3B';

/**
 * Que el Doctor se escuche.
 *
 * Un solo elemento de audio, reusado: crear uno por respuesta deja al navegador con una pila de
 * reproductores y, si alguien pregunta dos veces seguidas, las dos voces se pisan. Al pedir una
 * nueva se corta la anterior, que es lo que hace una persona cuando la interrumpen.
 */
let sonando: HTMLAudioElement | null = null;

/**
 * Hablarle. El navegador graba en webm/opus, que es lo que da `MediaRecorder` en Chrome y Firefox;
 * Safari da mp4. Se manda el mime tal cual en vez de suponerlo: el transcriptor lo necesita para
 * saber qué está abriendo, y adivinarlo mal devuelve una transcripción vacía sin decir por qué.
 */
async function grabar(alTexto: (t: string) => void, alEstado: (s: 'grabando' | 'oyendo' | '') => void): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const trozos: BlobPart[] = [];
  rec.ondataavailable = (e) => e.data.size && trozos.push(e.data);
  rec.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    alEstado('oyendo');
    try {
      const blob = new Blob(trozos, { type: mime || 'audio/webm' });
      const base64 = await new Promise<string>((res) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result));
        fr.readAsDataURL(blob);
      });
      const r = await fetch('/api/electrum/oir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headersElectrum() },
        body: JSON.stringify({ audio: base64, mime: blob.type }),
      });
      const j = await r.json().catch(() => ({}));
      if (j.texto) alTexto(j.texto);
    } finally {
      alEstado('');
    }
  };
  rec.start();
  alEstado('grabando');
  return () => rec.state !== 'inactive' && rec.stop();
}

async function decirEnVoz(texto: string, emocion: string | undefined, headers: Record<string, string>) {
  try {
    sonando?.pause();
    const r = await fetch('/api/electrum/voz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ texto: texto.slice(0, 1200), emocion }),
    });
    if (!r.ok) return;
    const url = URL.createObjectURL(await r.blob());
    const a = new Audio(url);
    sonando = a;
    a.onended = () => URL.revokeObjectURL(url);
    await a.play().catch(() => URL.revokeObjectURL(url));
  } catch {
    /* sin voz se sigue leyendo; no es motivo para romper el turno */
  }
}

/**
 * Bajar el PDF.
 *
 * Un `<a download>` no lleva cabeceras, y la ruta del informe exige credencial como todo lo demás
 * de esta plataforma. Así que se pide por fetch con la cabecera puesta y el navegador recibe un
 * blob. La alternativa —una URL firmada que valga por sí sola— sería un enlace compartible a un
 * documento del catastro, y eso es justo lo que no queremos que exista.
 */
async function bajarInforme(informe: { nombre: string; url: string }) {
  try {
    const r = await fetch(informe.url, { headers: headersElectrum() });
    if (!r.ok) return;
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = informe.nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch {
    /* el navegador dirá lo suyo */
  }
}

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
  // Arranca apagada: un navegador no deja sonar nada hasta que alguien toca algo, y una demo que
  // empieza hablando sola en una sala de reunión es peor que una que espera a que se lo pidan.
  const [vozActiva, setVozActiva] = useState(false);
  const [oyendo, setOyendo] = useState<'grabando' | 'oyendo' | ''>('');
  const pararGrabacion = useRef<(() => void) | null>(null);
  /** Lo que está pasando AHORA. Se vacía al terminar, cuando pasa a ser parte del turno. */
  const [enVivo, setEnVivo] = useState<{ panel: string; traza: Array<{ herramienta: string; ok: boolean; resumen: string }> }>({ panel: '', traza: [] });
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
      setEnVivo({ panel: '', traza: [] });
      setPensando(true);
      onFace('THINKING');
      onTrabajo();

      try {
        /*
         * Se lee el flujo a mano en vez de usar EventSource porque EventSource solo hace GET, y la
         * pregunta va en el cuerpo de un POST — meterla en la URL la dejaría en los registros del
         * servidor y en el historial del navegador.
         */
        const r = await fetch('/api/electrum/turno/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headersElectrum() },
          body: JSON.stringify({ mensaje: q }),
        });
        if (r.status === 401) {
          onFace('CONCERNED');
          setTurnos((t) => [...t, { de: 'electrum', texto: SIN_PUERTA }]);
          return;
        }
        if (!r.body) throw new Error('sin flujo');

        const lector = r.body.getReader();
        const dec = new TextDecoder();
        let resto = '';
        let evento = '';
        let terminado = false;

        while (!terminado) {
          const { done, value } = await lector.read();
          if (done) break;
          resto += dec.decode(value, { stream: true });
          // SSE separa los mensajes con una línea en blanco; lo que quede a medias espera.
          const trozos = resto.split('\n\n');
          resto = trozos.pop() || '';
          for (const trozo of trozos) {
            for (const linea of trozo.split('\n')) {
              if (linea.startsWith('event: ')) evento = linea.slice(7).trim();
              else if (linea.startsWith('data: ')) {
                const d = JSON.parse(linea.slice(6));
                if (evento === 'panel') setEnVivo((v) => ({ ...v, panel: d.panel }));
                else if (evento === 'herramienta') setEnVivo((v) => ({ ...v, traza: [...v.traza, d] }));
                else if (evento === 'ui') onUi([d]); // el mapa se mueve YA, no al final
                else if (evento === 'error') {
                  setTurnos((t) => [...t, { de: 'electrum', texto: d.error }]);
                  onFace('CONCERNED');
                  terminado = true;
                } else if (evento === 'fin') {
                  onFace('SPEAKING');
                  if (d.emocion) onEmocion(d.emocion);
                  if (vozActiva && d.texto) void decirEnVoz(d.texto, d.emocion, headersElectrum());
                  setTurnos((t) => [...t, { de: 'electrum', texto: d.texto || 'No pude contestar.', panel: d.panel, traza: d.traza }]);
                  terminado = true;
                }
              }
            }
          }
        }
      } catch {
        onFace('CONCERNED');
        setTurnos((t) => [...t, { de: 'electrum', texto: 'No alcancé el servidor. Revisá la conexión y volvé a preguntarme.' }]);
      } finally {
        setPensando(false);
        setEnVivo({ panel: '', traza: [] });
        setTimeout(() => onFace('IDLE'), 1200);
      }
    },
    [pensando, onFace, onEmocion, onUi, onTrabajo]
  );

  /**
   * Pedir el informe de la cartera desde la pantalla, con el mapa tal como se está viendo. Va por
   * su propia ruta y no por el turno: no hace falta molestar al modelo para armar un documento cuyo
   * contenido sale entero del catastro.
   */
  const pedirInforme = useCallback(async () => {
    if (pensando) return;
    setPensando(true);
    onFace('THINKING');
    onTrabajo();
    try {
      const r = await fetch('/api/electrum/informe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headersElectrum() },
        body: JSON.stringify({ tipo: 'cartera', mapa: capturaDelMapa() }),
      });
      const j = await r.json();
      if (!r.ok) {
        setTurnos((t) => [...t, { de: 'electrum', texto: j.error || 'No pude armar el informe.' }]);
      } else {
        setTurnos((t) => [...t, { de: 'electrum', texto: j.dicho, informe: { nombre: j.nombre, url: j.url, bytes: j.bytes } }]);
      }
    } catch {
      setTurnos((t) => [...t, { de: 'electrum', texto: 'No alcancé el servidor para armar el informe.' }]);
    } finally {
      setPensando(false);
      setTimeout(() => onFace('IDLE'), 900);
    }
  }, [pensando, onFace, onTrabajo]);

  return (
    <aside
      className="absolute z-20 flex flex-col border-white/10 bg-[#0A0C0E]/92 backdrop-blur-xl
                 inset-x-0 bottom-0 h-[42%] border-t"
      style={{ transition: 'transform .4s ease', transform: abierto ? 'none' : 'translateY(100%)' }}
    >
      {vista === 'chat' ? (
        <>
          <div ref={hilo} className="flex-1 overflow-y-auto px-4 py-4 space-y-4 w-full max-w-4xl mx-auto">
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
                {t.informe && (
                  <button
                    type="button"
                    onClick={() => bajarInforme(t.informe!)}
                    className="mt-2 flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-white/[0.06] cursor-pointer"
                    style={{ borderColor: 'rgba(255,174,59,.35)' }}
                  >
                    <span className="font-mono text-[10px] tracking-[0.14em] uppercase" style={{ color: AMBAR }}>
                      PDF
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-[#E7EEF2]">{t.informe.nombre}</span>
                      <span className="block font-mono text-[10px] text-[#6C7F89]">{Math.round(t.informe.bytes / 1024)} KB · se guarda media hora</span>
                    </span>
                  </button>
                )}
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

            {oyendo === 'grabando' && <div className="font-mono text-[11px] text-[#D9705A]">te escucho… tocá «Parar» cuando termines</div>}
            {oyendo === 'oyendo' && <div className="font-mono text-[11px] text-[#6C7F89]">pasando a texto…</div>}
            {pensando && (
              <div className="space-y-1">
                {enVivo.panel && (
                  <div className="font-mono text-[10px] tracking-[0.16em] uppercase" style={{ color: AMBAR }}>
                    {enVivo.panel}
                  </div>
                )}
                {enVivo.traza.map((h, i) => (
                  <div key={i} className="font-mono text-[10px] text-[#6C7F89] flex gap-1.5">
                    <span style={{ color: h.ok ? AMBAR : '#D9705A' }}>{h.ok ? '·' : '×'}</span>
                    <span className="truncate">
                      {h.herramienta} — {h.resumen}
                    </span>
                  </div>
                ))}
                <div className="font-mono text-[11px] text-[#6C7F89]">
                  {enVivo.traza.length ? 'redactando…' : 'pensando…'}
                </div>
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              preguntar(texto);
            }}
            className="flex gap-2 p-3 border-t border-white/10 w-full max-w-4xl mx-auto"
          >
            <input
              id="electrum-pregunta"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Preguntale a Dr Electrum…"
              className="flex-1 min-w-0 bg-white/[0.06] border border-white/12 rounded-lg px-3 py-2 text-sm text-[#E7EEF2] placeholder:text-[#5E7078] focus:outline-none focus:border-[#FFAE3B]/60"
            />
            <button
              type="button"
              onClick={async () => {
                if (pararGrabacion.current) {
                  pararGrabacion.current();
                  pararGrabacion.current = null;
                  return;
                }
                try {
                  pararGrabacion.current = await grabar((t) => void preguntar(t), setOyendo);
                } catch {
                  setOyendo('');
                  setTurnos((t) => [...t, { de: 'electrum', texto: 'No me dejaron usar el micrófono. Revisá el permiso del navegador.' }]);
                }
              }}
              disabled={pensando || oyendo === 'oyendo'}
              title={oyendo === 'grabando' ? 'Parar y mandarme lo que dijiste' : 'Hablarme'}
              className="shrink-0 rounded-lg border px-2.5 font-mono text-[10px] tracking-[0.12em] uppercase transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              style={
                oyendo === 'grabando'
                  ? { borderColor: '#D9705A', color: '#D9705A' }
                  : { borderColor: 'rgba(255,255,255,.12)', color: '#9FB0B8' }
              }
            >
              {oyendo === 'grabando' ? 'Parar' : oyendo === 'oyendo' ? '…' : 'Decir'}
            </button>
            <button
              type="button"
              onClick={() => setVozActiva((v) => !v)}
              title={vozActiva ? 'Silenciar a Dr Electrum' : 'Que Dr Electrum hable'}
              aria-pressed={vozActiva}
              className="shrink-0 rounded-lg border px-2.5 font-mono text-[10px] tracking-[0.12em] uppercase transition-colors cursor-pointer"
              style={
                vozActiva
                  ? { borderColor: AMBAR, color: AMBAR }
                  : { borderColor: 'rgba(255,255,255,.12)', color: '#9FB0B8' }
              }
            >
              Voz
            </button>
            <button
              type="button"
              onClick={pedirInforme}
              disabled={pensando}
              title="Informe de la cartera en PDF, con el mapa como se está viendo"
              className="shrink-0 rounded-lg border border-white/12 px-2.5 font-mono text-[10px] tracking-[0.12em] uppercase text-[#9FB0B8] transition-colors hover:border-white/25 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            >
              PDF
            </button>
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

/**
 * El cargador: arrastrar aquí, o elegir.
 *
 * Se sube de uno en uno y en serie, no todos a la vez. Un shapefile de un departamento tarda, y
 * lanzar seis en paralelo contra el mismo PostGIS hace que el recálculo de traslapes se pise
 * consigo mismo. En serie tarda lo mismo y se ve qué está pasando.
 */
function Cargador({ alCargar }: { alCargar: () => void }) {
  const [encima, setEncima] = useState(false);
  const [cola, setCola] = useState<Array<{ nombre: string; estado: 'espera' | 'subiendo' | 'ok' | 'falló'; dicho?: string }>>([]);
  const entrada = useRef<HTMLInputElement>(null);
  const ocupado = useRef(false);

  const subir = useCallback(
    async (archivos: File[]) => {
      if (!archivos.length) return;
      setCola((c) => [...c, ...archivos.map((f) => ({ nombre: f.name, estado: 'espera' as const }))]);
      if (ocupado.current) return;
      ocupado.current = true;
      try {
        for (const f of archivos) {
          const marcar = (estado: 'subiendo' | 'ok' | 'falló', dicho?: string) =>
            setCola((c) => c.map((x) => (x.nombre === f.name && x.estado !== 'ok' && x.estado !== 'falló' ? { ...x, estado, dicho } : x)));
          marcar('subiendo');
          try {
            const r = await fetch(`/api/electrum/subir?nombre=${encodeURIComponent(f.name)}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/octet-stream', ...headersElectrum() },
              body: f,
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) marcar('falló', j.error || `Error ${r.status}`);
            else {
              marcar('ok', j.dicho);
              alCargar();
            }
          } catch {
            marcar('falló', 'No alcancé el servidor.');
          }
        }
      } finally {
        ocupado.current = false;
      }
    },
    [alCargar]
  );

  return (
    <div className="px-4 pb-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setEncima(true);
        }}
        onDragLeave={() => setEncima(false)}
        onDrop={(e) => {
          e.preventDefault();
          setEncima(false);
          void subir([...e.dataTransfer.files]);
        }}
        onClick={() => entrada.current?.click()}
        className="rounded-xl border border-dashed px-3 py-4 text-center cursor-pointer transition-colors"
        style={{ borderColor: encima ? AMBAR : 'rgba(255,255,255,.16)', background: encima ? 'rgba(255,174,59,.07)' : 'transparent' }}
      >
        <div className="text-[13px] text-[#B9C7CE]">Arrastrá acá el catastro o un expediente</div>
        <div className="mt-0.5 font-mono text-[10px] text-[#6C7F89]">.zip de shapefile · KML · KMZ · GeoJSON · CSV · PDF</div>
        <input
          ref={entrada}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            void subir([...(e.target.files || [])]);
            e.target.value = '';
          }}
        />
      </div>

      {cola.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {cola.map((x, i) => (
            <li key={`${x.nombre}-${i}`} className="text-[12px] leading-snug">
              <div className="flex items-center gap-1.5">
                <span
                  className="font-mono text-[10px]"
                  style={{ color: x.estado === 'ok' ? AMBAR : x.estado === 'falló' ? '#D9705A' : '#6C7F89' }}
                >
                  {x.estado === 'ok' ? '·' : x.estado === 'falló' ? '×' : '…'}
                </span>
                <span className="truncate text-[#DDE7EC]">{x.nombre}</span>
              </div>
              {x.dicho && <div className="pl-4 text-[11px] text-[#8FA3B0]">{x.dicho}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Lo que se ha subido y quedó indexado. Sin nada cargado, dice cómo cargarlo. */
/**
 * El estado, en una línea por pieza.
 *
 * Cuando algo falla, lo que se ve es al doctor diciendo que no alcanza su cerebro — y eso no
 * distingue entre el nodo caído, la llave de voz sin poner y el catastro desconectado. Aquí cada
 * pieza responde por sí misma.
 */
function Estado() {
  const [s, setS] = useState<any>(null);
  useEffect(() => {
    fetch('/api/electrum/salud', { headers: headersElectrum() })
      .then((r) => (r.ok ? r.json() : null))
      .then(setS)
      .catch(() => setS(null));
  }, []);
  if (!s) return null;

  const filas: Array<[string, boolean, string]> = [
    ['Cerebro', !!s.cerebro?.vivo, s.cerebro?.vivo ? String(s.cerebro.modelo).split('/').pop() : s.cerebro?.configurado ? 'no responde' : 'sin configurar'],
    ['Voz', !!s.voz?.llave, s.voz?.llave ? 'ElevenLabs' : 'sin llave'],
    ['Catastro', !!s.catastro?.viva, s.catastro?.viva ? `${s.catastro.concesiones} concesiones` : s.catastro?.motivo || 'fuera de línea'],
    ['Telegram', !!s.bot, s.bot ? 'escuchando' : 'apagado'],
  ];

  return (
    <section>
      <h3 className="font-mono text-[10px] tracking-[0.18em] uppercase mb-2" style={{ color: AMBAR }}>
        Estado
      </h3>
      <ul className="space-y-1">
        {filas.map(([que, ok, detalle]) => (
          <li key={que} className="flex items-baseline gap-2 text-[12px]">
            <span className="font-mono" style={{ color: ok ? AMBAR : '#6C7F89' }}>
              {ok ? '·' : '×'}
            </span>
            <span className="w-[68px] shrink-0 text-[#B9C7CE]">{que}</span>
            <span className="font-mono text-[11px] text-[#6C7F89] truncate">{detalle}</span>
          </li>
        ))}
        <li className="flex items-baseline gap-2 text-[12px] pt-1">
          <span className="font-mono text-[#6C7F89]">·</span>
          <span className="w-[68px] shrink-0 text-[#B9C7CE]">Vos</span>
          <span className="font-mono text-[11px] text-[#6C7F89]">
            {s.quien || 'invitado'} · {s.nivel === 'mando' ? 'mando' : s.nivel === 'escribe' ? 'trabajo' : 'consulta'} · {s.herramientas} herramientas
          </span>
        </li>
      </ul>
    </section>
  );
}

function Expedientes() {
  const [datos, setDatos] = useState<{ capas: any[]; documentos: any[] } | null>(null);
  const [fallo, setFallo] = useState<'' | 'puerta' | 'base'>('');
  const [vuelta, setVuelta] = useState(0);

  useEffect(() => {
    fetch('/api/electrum/expedientes', { headers: headersElectrum() })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setDatos)
      .catch((e) => setFallo(e === 401 ? 'puerta' : 'base'));
  }, [vuelta]);

  const recargar = useCallback(() => setVuelta((v) => v + 1), []);

  if (fallo === 'puerta') return <div className="p-4 text-sm text-[#8FA3B0] leading-relaxed">{SIN_PUERTA}</div>;
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
      <div className="flex-1 overflow-y-auto w-full max-w-4xl mx-auto">
        <div className="p-4 pb-1">
          <Estado />
        </div>
        <div className="p-4 pt-2 pb-2 space-y-2 text-sm text-[#8FA3B0] leading-relaxed">
          <p>Todavía no hay nada cargado.</p>
          <p>Lo geográfico se vuelve mapa, medido sobre el elipsoide. Los documentos quedan citables con su página.</p>
        </div>
        <Cargador alCargar={recargar} />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 pt-4 space-y-5 w-full max-w-4xl mx-auto">
      <Estado />
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
      <Cargador alCargar={recargar} />
    </div>
  );
}
