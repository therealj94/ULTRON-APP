// Las escenas del banco de su computadora (una por `?p=`), con la hoja REAL (ajustes/Computadora.tsx, HojaComputadoraVivo)
// y el servidor simulado (api-simulada.ts):
//   apagada      la computadora no contesta (el nodo apagado para ahorrar, o caído)
//   lista        contesta y no hay nada en curso (con dos misiones recientes)
//   enfila       recién encargada: todavía sin pasos
//   trabajando   en marcha: plan a medias, pasos en palabras, la pantalla
//   confirmar    se detuvo antes de «Enviar» y espera su sí
//   control      la persona tomó el control
//   terminada    terminó: la tarjeta del resultado con su evidencia
//   fallo        dejó de contestar a media tarea (el final honesto)
//   sinrespuesta trabajando, pero las lecturas de la tarea fallan (la app no recibe noticias)
// Las capturas del escritorio las pone capturas.mjs en window.__PC_CAPTURAS (1..4: buscar, artículo, el dato, formulario).
import { createRoot } from 'react-dom/client';
import { StyleSheet, Text, View } from 'react-native';
import { HojaComputadoraVivo } from '@movil/src/ajustes/Computadora';
import { responder, type Respuesta } from './api-simulada';

const q = new URLSearchParams(location.search);
const cual = q.get('p') || 'trabajando';
const CAP: Record<string, string> = (globalThis as any).__PC_CAPTURAS || {};
const AHORA = Date.now();
const ID = 'tk_demo01';
const MISION = 'mi_demo01';
const INSTRUCCION = 'Entra a enciclopedia.ejemplo.org, busca Francisco Morazán y dime en qué fecha nació';
const CAPS = ['pausar', 'confirmar', 'control', 'entrada', 'seguro'];

const pasos = (hasta: number) =>
  [
    { n: 1, t: 4.1, accion: 'escritorio_limpio', texto: 'Preparó un escritorio limpio', miniatura: null },
    { n: 2, t: 9.8, accion: 'open_url', texto: 'Abrió enciclopedia.ejemplo.org', miniatura: CAP['1'] },
    { n: 3, t: 15.2, accion: 'type', texto: 'Escribió «Francisco Morazán» y dio Enter', miniatura: CAP['1'] },
    { n: 4, t: 21.7, accion: 'click', texto: 'Tocó el resultado «Francisco Morazán»', miniatura: CAP['2'] },
    { n: 5, t: 27.3, accion: 'scroll', texto: 'Bajó para leer la ficha', miniatura: CAP['3'] },
    { n: 6, t: 31.9, accion: 'answer', texto: 'Dio la respuesta', miniatura: CAP['3'] },
  ].slice(0, hasta);

const plan = (hechos: number, total = 4, estadoActual: 'actual' | 'espera' | 'fallo' = 'actual') =>
  ['Entrar a enciclopedia.ejemplo.org', 'Buscar Francisco Morazán', 'Leer su fecha de nacimiento', 'Darte el resultado'].slice(0, total).map((texto, i) => ({
    texto,
    estado: i < hechos ? ('hecho' as const) : i === hechos ? estadoActual : ('pendiente' as const),
  }));

const historial = [
  { id: 'mi_h1', tareaId: 'tk_h1', instruccion: 'Busca el clima de mañana en Tegucigalpa y dime la temperatura', estado: 'hecha', ok: true, inicio: AHORA - 3 * 3600_000, segundos: 74, resultado: 'Máx. 27 °C' },
  { id: 'mi_h2', tareaId: 'tk_h2', instruccion: 'Entra a la página del banco y dime el precio del dólar', estado: 'fallo', ok: false, inicio: AHORA - 26 * 3600_000, segundos: 131, resultado: null },
];

type Escena = { estado: any; tarea?: any; mision?: any; frase?: string; pregunta?: string | null; leerFalla?: boolean; pantalla?: string | null };

function escena(): Escena {
  const base = { configurada: true, ok: true, motores: ['holo'], ocupada: false, ultima: ID, capacidades: CAPS, historial, version: 5 };
  const tarea = (estado: string, n: number, extra: Record<string, unknown> = {}) => ({ id: ID, instruccion: INSTRUCCION, estado, pasos: pasos(n), respuesta: null, error: null, segundos: pasos(n).at(-1)?.t ?? 0, ...extra });
  const mision = (p: any[], extra: Record<string, unknown> = {}) => ({ id: MISION, instruccion: INSTRUCCION, plan: p, inicio: AHORA - 32_000, transcurrido: 32, vuelta: 0, tareaId: ID, pregunta: null, final: null, puedeSeguir: false, version: 5, ...extra });
  const actual = (estado: string, n: number) => ({ id: ID, estado, pasos: n, instruccion: INSTRUCCION, ultimo: pasos(n).at(-1)?.texto ?? null });
  switch (cual) {
    case 'apagada':
      return { estado: { ...base, ok: false, capacidades: [], ultima: null, actual: null, historial, detalle: 'fetch failed' } };
    case 'lista':
      return { estado: { ...base, ultima: null, actual: null } };
    case 'enfila':
      return { estado: { ...base, ocupada: true, actual: actual('en_cola', 0) }, tarea: tarea('en_cola', 0), mision: mision(plan(0), { transcurrido: 2 }) };
    case 'trabajando':
    case 'sinrespuesta':
      return {
        // Sin noticias: el nodo dejó de contestar a media tarea (el servidor lo dice con ok:false; leer la tarea da 502).
        estado: { ...base, ok: cual !== 'sinrespuesta', ocupada: true, actual: actual('trabajando', 4) },
        tarea: tarea('trabajando', 4),
        mision: mision(plan(2)),
        frase: 'Ya encontré su artículo; estoy leyendo la ficha.',
        leerFalla: cual === 'sinrespuesta',
        pantalla: CAP['2'],
      };
    case 'confirmar': {
      const pregunta = 'Voy a tocar «Enviar» en formulario.ejemplo.org/contacto (mensaje a jose@ejemplo.org). ¿Lo hago?';
      return {
        estado: { ...base, ocupada: true, actual: actual('confirmar', 4) },
        tarea: tarea('confirmar', 4, { pregunta, pregunta_id: 'pq1', propuesta: 'h_abc', pasos: pasos(4).map((p, i) => (i === 3 ? { ...p, miniatura: CAP['4'], texto: 'Llenó el formulario de contacto' } : p)) }),
        mision: mision(plan(2, 4, 'espera'), { pregunta, preguntaId: 'pq1', propuesta: 'h_abc' }),
        pregunta,
        pantalla: CAP['4'],
      };
    }
    case 'control':
      return { estado: { ...base, ocupada: true, actual: actual('control', 4) }, tarea: tarea('control', 4, { epoca: 2 }), mision: mision(plan(2, 4, 'espera')), pantalla: CAP['2'] };
    case 'terminada': {
      const respuesta = 'Francisco Morazán nació el 3 de octubre de 1792, en Tegucigalpa. Lo leí en su ficha de enciclopedia.ejemplo.org.';
      const final = { estado: 'hecha', ok: true, texto: 'Listo.', respuesta, error: null, enlaces: ['https://enciclopedia.ejemplo.org/wiki/Francisco_Morazán'], datos: [{ clave: 'Nacimiento', valor: '3 de octubre de 1792' }, { clave: 'Lugar', valor: 'Tegucigalpa' }], captura: CAP['3'], segundos: 32, pasos: 5, comprobado: true };
      return { estado: { ...base, actual: actual('hecha', 6) }, tarea: tarea('hecha', 6, { respuesta }), mision: mision(plan(4), { final }) };
    }
    case 'fallo': {
      const error = 'dejó de contestarme a mitad de la tarea; no sé si alcanzó a terminar';
      const final = { estado: 'fallo', ok: false, texto: `Mi computadora ${error}. ¿La intento otra vez?`, respuesta: null, error, enlaces: [], datos: [], captura: CAP['2'], segundos: 151, pasos: 4 };
      return { estado: { ...base, actual: actual('fallo', 4) }, tarea: tarea('fallo', 4, { error }), mision: mision(plan(2, 4, 'fallo'), { final, puedeSeguir: true, transcurrido: 151 }) };
    }
    default:
      return { estado: { ...base, actual: null } };
  }
}

const e = escena();
responder((ruta): Respuesta => {
  // Como el servidor de verdad: /api/computadora contesta (con ok:false si el nodo no responde); lo que va al nodo, 502.
  if (ruta === '/api/computadora') return { json: e.estado };
  if (cual === 'apagada') return { status: 502, error: 'La computadora no contestó (fetch failed).' };
  if (ruta.includes('/pantalla')) return e.pantalla ? { json: { imagen: e.pantalla, frame: { seq: 12, ts: Date.now() / 1000, ancho: 1280, alto: 800, rev: 1, epoca: 2, privado: false, edadMs: 400 } } } : { status: 409, error: 'todavía no empieza' };
  if (/\/api\/computadora\/tareas\/[^/?]+(\?|$)/.test(ruta)) {
    if (e.leerFalla) return { status: 502, error: 'La computadora no contestó (timeout).' };
    const paso = /[?&]paso=(\d+)/.exec(ruta);
    const t = e.tarea && paso ? { ...e.tarea, pasos: e.tarea.pasos.map((p: any) => (String(p.n) === paso[1] ? p : { ...p, miniatura: null })) } : e.tarea;
    return { json: { tarea: t, mision: e.mision ?? null, version: 5 } };
  }
  if (ruta.startsWith('/api/computadora/misiones/')) return { json: { mision: { id: 'mi_h1', instruccion: historial[0].instruccion, plan: [], inicio: historial[0].inicio, transcurrido: 74, vuelta: 0, tareaId: 'tk_h1', pregunta: null, final: { estado: 'hecha', ok: true, texto: 'Listo.', respuesta: 'Mañana: máx. 27 °C, mín. 18 °C.', error: null, enlaces: [], datos: [], captura: CAP['3'], segundos: 74, pasos: 7 }, puedeSeguir: false } } };
  return { json: { ok: true } };
});

function Banco() {
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#14161a' }]}>
      <Text style={{ color: '#666', padding: 24 }}>(la mesa)</Text>
      <HojaComputadoraVivo
        visible
        onCerrar={() => {}}
        nombreAvatar="AURA"
        tareaId={e.tarea ? ID : null}
        frase={e.frase || ''}
        planInicial={[]}
        pregunta={e.pregunta ?? null}
      />
    </View>
  );
}

createRoot(document.getElementById('root')!).render(<Banco />);
