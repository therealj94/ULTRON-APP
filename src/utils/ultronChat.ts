/** Cliente del harness: habla con /api/qwen/chat (SSE) sin tocar secretos AWS. */

export type UltronToolCall = {
  name: string;
  arguments: Record<string, unknown>;
};

export type UltronChatResult = {
  reply: string;
  mode?: string;
  toolCall?: UltronToolCall | null;
  model?: string;
  conversationId?: string;
  error?: string;
};

export async function streamUltronChat(opts: {
  message: string;
  mode: string;
  conversationId?: string;
  onToken?: (t: string) => void;
  signal?: AbortSignal;
}): Promise<UltronChatResult> {
  const res = await fetch('/api/qwen/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      message: opts.message,
      mode: opts.mode,
      conversationId: opts.conversationId || 'desk-default',
      stream: true,
    }),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    return { reply: '', error: (err as any).error || `HTTP ${res.status}` };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let reply = '';
  let meta: UltronChatResult = { reply: '' };

  const handleBlock = (block: string) => {
    const lines = block.split('\n');
    let event = 'message';
    let data = '';
    for (const line of lines) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (!data) return;
    let payload: any;
    try {
      payload = JSON.parse(data);
    } catch {
      return;
    }
    if (event === 'token' && payload.t) {
      reply += payload.t;
      opts.onToken?.(payload.t);
    } else if (event === 'done') {
      meta = {
        reply: payload.reply || reply,
        mode: payload.mode,
        toolCall: payload.toolCall,
        model: payload.model,
        conversationId: payload.conversationId,
      };
      reply = meta.reply;
    } else if (event === 'error') {
      meta = { reply, error: payload.mensaje || payload.error || 'error' };
    } else if (event === 'start') {
      meta = { ...meta, toolCall: payload.toolCall, mode: payload.mode, model: payload.model };
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';
    for (const part of parts) handleBlock(part);
  }
  if (buffer.trim()) handleBlock(buffer);

  return { ...meta, reply: meta.reply || reply };
}

export async function chatUltronJson(opts: {
  message: string;
  mode: string;
  conversationId?: string;
}): Promise<UltronChatResult> {
  const res = await fetch('/api/qwen/chat?stream=0', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: opts.message,
      mode: opts.mode,
      conversationId: opts.conversationId || 'desk-default',
      stream: false,
    }),
  });
  const data = await res.json();
  if (!res.ok) return { reply: '', error: data.error || data.message || `HTTP ${res.status}` };
  return {
    reply: data.reply || '',
    mode: data.mode,
    toolCall: data.toolCall,
    model: data.model,
    conversationId: data.conversationId,
  };
}
