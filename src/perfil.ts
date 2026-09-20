/**
 * Qué plataforma es esta, del lado del navegador.
 *
 * El servidor decide (ULTRON_PERFIL) y la interfaz se marca con lo que le diga: nombre en el arranque,
 * color de acento, título de la pestaña. Así el mismo front sirve a Genesis Core y al Cerebro de Minas
 * sin dos copias que se desincronizan.
 *
 * Si la llamada falla, se queda con Genesis: la plataforma de la junta nunca depende de esto para abrir.
 */
export type PerfilPublico = {
  id: string;
  cerebro: string;
  plataforma: string;
  proposito: string;
  acento: string;
  demo: boolean;
  modos: string[];
  herramientas: string[];
};

export const PERFIL_POR_DEFECTO: PerfilPublico = {
  id: 'genesis',
  cerebro: 'Genesis Core',
  plataforma: 'ULTRON FP',
  proposito: 'Asistente privado de la junta directiva de Orden Global.',
  acento: '#05E1FF',
  demo: false,
  modos: [],
  herramientas: [],
};

let cache: PerfilPublico = PERFIL_POR_DEFECTO;
let pedido: Promise<PerfilPublico> | null = null;

/** Lo último que se sabe. Sirve para pintar sin esperar a la red. */
export function perfil(): PerfilPublico {
  return cache;
}

/** Pide el perfil una sola vez y aplica el acento como variable CSS y el título de la pestaña. */
export function cargarPerfil(): Promise<PerfilPublico> {
  if (pedido) return pedido;
  pedido = fetch('/api/perfil')
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      if (j && j.plataforma) cache = { ...PERFIL_POR_DEFECTO, ...j };
      aplicar(cache);
      return cache;
    })
    .catch(() => {
      aplicar(cache);
      return cache;
    });
  return pedido;
}

function aplicar(p: PerfilPublico) {
  try {
    document.documentElement.style.setProperty('--acento', p.acento);
    document.title = p.demo ? `${p.plataforma} · demo` : p.plataforma;
  } catch {
    /* sin DOM (pruebas) */
  }
}
