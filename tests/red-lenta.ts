/**
 * La red de afuera LENTA, como la ve el CI de GitHub: un servidor que se levanta para las pruebas con
 * `--import tests/red-lenta.ts` no sale de la máquina, y cada fetch a un host que no es local tarda
 * `RED_LENTA_MS` (2,5 s por omisión) y después falla. No es un archivo de pruebas (`*.test.ts`).
 *
 * Por qué existe: en esta máquina la red de afuera falla al instante (sin el certificado del proxy),
 * y en el CI contesta de verdad y tarda segundos. Un paso que espera a internet antes de la primera
 * palabra de la voz (la búsqueda web previa, el 28-sep) pasaba aquí en 500 ms y en el CI tardaba
 * 3-4 s. Con esto se ve igual en los dos lados, y las pruebas no dependen de la red de nadie.
 */
const LOCAL = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const demora = Math.max(0, Number(process.env.RED_LENTA_MS ?? 2500));
const original = globalThis.fetch;

globalThis.fetch = (async (entrada: any, init?: RequestInit) => {
  const url = new URL(typeof entrada === 'string' || entrada instanceof URL ? String(entrada) : String(entrada?.url));
  if (LOCAL.has(url.hostname)) return original(entrada, init);
  const senal = init?.signal || (entrada instanceof Request ? entrada.signal : undefined);
  await new Promise<void>((resolver, rechazar) => {
    const t = setTimeout(resolver, demora);
    senal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        rechazar(senal.reason ?? new DOMException('abortado', 'AbortError'));
      },
      { once: true }
    );
  });
  throw new TypeError('fetch failed', { cause: Object.assign(new Error(`red lenta de prueba: ${url.hostname}`), { code: 'ECONNRESET' }) });
}) as typeof fetch;
