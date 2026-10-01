/**
 * ¿MODO DESARROLLO? Solo si se pide a propósito.
 *
 * Antes cada puerta preguntaba `NODE_ENV !== 'production'`: un servidor arrancado SIN `NODE_ENV`
 * (un despliegue nuevo, un `node build-server/server.cjs` a mano, un servicio copiado sin esa
 * variable) quedaba con la mesa abierta, cualquiera como junta, Dr Electrum sin llave, el ejecutor
 * de Python en el propio host y Vite sirviendo el árbol del repo. Ahora se falla cerrado: sin una
 * marca explícita, el servidor se porta como en producción.
 *
 * Las marcas: `AURA_DEV=1` (tu máquina, `npm run dev`) o `NODE_ENV=test` (pruebas). `NODE_ENV=production`
 * gana siempre, aunque alguien deje `AURA_DEV=1` puesto en Render.
 */
export function modoDesarrollo(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === 'production') return false;
  return env.AURA_DEV === '1' || env.NODE_ENV === 'test';
}
