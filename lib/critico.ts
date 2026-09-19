/**
 * Crítico de código (Fase 4). Claude revisa lo que escribió Qwen.
 * Flag CRITICA_ACTIVA=true + ANTHROPIC_API_KEY. Si faltan, se omite (no rompe el turno).
 * Sin SDK: fetch al Messages API para no añadir dependencia.
 */

export type Critica = {
  texto: string;
  skipped: boolean;
  bugs: boolean;
  modelo?: string;
};

export function criticaActiva(): boolean {
  return process.env.CRITICA_ACTIVA === 'true' || process.env.CRITICA_ACTIVA === '1';
}

export async function criticarCodigo(codigo: string, contextoOriginal: string): Promise<Critica> {
  const key = process.env.ANTHROPIC_API_KEY || '';
  if (!criticaActiva()) return { texto: '', skipped: true, bugs: false };
  if (!key) return { texto: 'ANTHROPIC_API_KEY vacío: crítica omitida.', skipped: true, bugs: false };
  if (!codigo.trim()) return { texto: 'No hay código que revisar.', skipped: true, bugs: false };

  const modelo = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
  const prompt = `Eres un revisor de código senior. Tu trabajo es encontrar bugs, edge cases no manejados, y problemas de diseño en el siguiente código.

CONTEXTO ORIGINAL DEL PEDIDO:
${contextoOriginal}

CÓDIGO A REVISAR:
\`\`\`python
${codigo}
\`\`\`

Tu respuesta debe incluir:
1. Bugs evidentes (si los hay).
2. Edge cases no manejados.
3. Problemas de performance (si los hay).
4. Inconsistencias entre la documentación y el código.
5. Veredicto: ¿el código pasa los tests que él mismo escribió?

Sé brutalmente honesto. Si el código está roto, dilo claramente.
Si está bien, dilo también. No inventes problemas donde no los hay.

Máximo 300 palabras.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: modelo,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(30000),
    });
    const j: any = await r.json().catch(() => ({}));
    const texto = String(j?.content?.[0]?.text || j?.error?.message || '').trim();
    if (!r.ok || !texto) {
      return { texto: `Crítica falló (${r.status}).`, skipped: true, bugs: false, modelo };
    }
    const bugs = /bug|roto|falla|incorrecto|no pasa|rompe|error eviden|edge case no/i.test(texto) &&
      !/no (hay|encontr[eé]) bugs|c[oó]digo est[aá] bien|sin bugs evidentes/i.test(texto);
    return { texto, skipped: false, bugs, modelo };
  } catch (e: any) {
    return { texto: `Crítica caída: ${String(e?.message || e).slice(0, 160)}`, skipped: true, bugs: false };
  }
}
