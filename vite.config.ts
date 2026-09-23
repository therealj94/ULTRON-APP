import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

/** Qué páginas se compilan, según qué producto sea este despliegue. */
function entradas() {
  const main = path.resolve(__dirname, 'index.html');
  const electrum = path.resolve(__dirname, 'electrum.html');
  const p = String(process.env.PLATAFORMA || '').trim().toLowerCase();
  if (p === 'ultron' || p === 'ultron-fp' || p === 'genesis') return { main };
  if (p === 'electrum') return { electrum };
  return { main, electrum };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        /*
         * UN DESPLIEGUE, UNA APLICACIÓN.
         *
         * Antes se compilaban las dos siempre y se servía ULTRON FP en la raíz, con Dr Electrum
         * escondido en `/electrum.html`. Ahora `PLATAFORMA` decide cuál se compila: no tiene
         * sentido mandar a Render el paquete de la otra plataforma, y no mandarlo es la forma más
         * barata de que no se sirva por accidente.
         *
         * En desarrollo, sin la variable, se compilan las dos: quien trabaja en esto quiere ver las
         * dos sin tener que reiniciar con otra variable.
         */
        input: entradas(),
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
