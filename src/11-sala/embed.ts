/**
 * La sala sola, para meterla en la app del teléfono (react-native-webview).
 *
 * El teléfono le habla con `window.__aura(mensaje)` —vía injectJavaScript, que es lo más rápido y
 * funciona igual en Android e iOS— y ella contesta con `ReactNativeWebView.postMessage`.
 *
 *   entra:  {tipo:'estado', face, emocion} · {tipo:'boca', n} · {tipo:'mirar', x, y, activa}
 *           {tipo:'tarea', tarea, texto?} · {tipo:'postura', p} · {tipo:'entrar'}
 *   sale:   {tipo:'listo'} · {tipo:'tocar', zona} · {tipo:'deslizar', dir} · {tipo:'fallo', motivo}
 */
import { crearSala, type SalaControl } from './sala';
import type { Postura, Tarea } from './tareas';

type AlTelefono = { tipo: 'listo' } | { tipo: 'tocar'; zona: string } | { tipo: 'deslizar'; dir: string } | { tipo: 'fallo'; motivo: string };

function alTelefono(m: AlTelefono) {
  try {
    (window as any).ReactNativeWebView?.postMessage(JSON.stringify(m));
  } catch {
    /* fuera del teléfono no hay a quién avisar */
  }
}

const host = document.getElementById('sala')!;
const params = new URLSearchParams(location.search);
let ctl: SalaControl | null = null;
try {
  ctl = crearSala(host, {
    reducido: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    postura: params.get('postura') === 'sentada' ? 'sentada' : 'pie',
    onTocar: (zona) => alTelefono({ tipo: 'tocar', zona }),
    onDeslizar: (dir) => alTelefono({ tipo: 'deslizar', dir }),
  });
} catch (e: any) {
  alTelefono({ tipo: 'fallo', motivo: String(e?.message || e) });
}

(window as any).__aura = (m: any) => {
  if (!ctl || !m || typeof m !== 'object') return;
  switch (m.tipo) {
    case 'estado': ctl.estado(m.face || 'IDLE', m.emocion || 'neutral'); break;
    case 'boca': ctl.boca(Number(m.n) || 0); break;
    case 'mirar': ctl.mirar(Number(m.x) || 0, Number(m.y) || 0, !!m.activa); break;
    case 'tarea': ctl.tarea(m.tarea as Tarea, m.texto); break;
    case 'postura': ctl.postura((m.p === 'sentada' ? 'sentada' : 'pie') as Postura); break;
    case 'entrar': ctl.entrar(); break;
  }
};
if (ctl) alTelefono({ tipo: 'listo' });
