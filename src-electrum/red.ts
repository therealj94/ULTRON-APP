/**
 * Una señal que corta un pedido que tarda más de `ms`. `AbortSignal.timeout` no existe en los
 * navegadores de hace un par de años (Safari < 16): ahí se arma a mano.
 */
export function senalConTope(ms: number): AbortSignal | undefined {
  try {
    if (typeof AbortSignal !== 'undefined' && typeof (AbortSignal as any).timeout === 'function') return (AbortSignal as any).timeout(ms);
    const c = new AbortController();
    setTimeout(() => c.abort(), ms);
    return c.signal;
  } catch {
    return undefined;
  }
}
