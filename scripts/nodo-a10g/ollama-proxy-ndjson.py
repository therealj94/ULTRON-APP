from flask import Flask, request, Response, stream_with_context, jsonify
import requests, json, os, time
app = Flask(__name__)
LLAMA = "http://127.0.0.1:8080"
MODEL = "/opt/models/orcarouter_Qwen3.8-27B-Uncensored-Q4_K_M.gguf"
# Lo que cabe en el contexto de llama-server (--ctx-size), en caracteres, dejando sitio a la
# respuesta. Antes el system se cortaba a 4500 caracteres: Dr Electrum perdia su oficio, el
# conocimiento minero y la instruccion de herramientas (que va al final), y contestaba de memoria
# sin consultar nunca el catastro. El system va entero; lo que se recorta es la conversacion vieja.
MAX_CHARS = int(os.environ.get("PROXY_MAX_CHARS", "42000"))

def linea(content, done, extra=None, tools=None):
    msg = {"role": "assistant", "content": content or ""}
    if tools:
        msg["tool_calls"] = tools
    u = extra or {}
    o = {
        "model": MODEL,
        "created_at": int(time.time()),
        "message": msg,
        "done": done,
        "prompt_eval_count": int(u.get("prompt_tokens") or 0),
        "eval_count": int(u.get("completion_tokens") or 0),
        "eval_duration": int(float(u.get("predicted_ms") or 0) * 1e6),
    }
    if done:
        o["done_reason"] = "stop"
    return json.dumps(o, ensure_ascii=False) + "\n"

def largo(msgs):
    return sum(len(m.get("content") or "") for m in msgs)

def recortar(messages):
    clean = []
    for m in messages or []:
        c = m.get("content")
        if isinstance(c, list):
            c = " ".join(str(x) for x in c)
        d = {"role": m.get("role") or "user", "content": str(c or "")}
        if m.get("tool_calls"):
            d["tool_calls"] = m["tool_calls"]
        if m.get("tool_name"):
            d["tool_name"] = m["tool_name"]
        clean.append(d)
    if not clean:
        clean = [{"role": "user", "content": "hola"}]
    inicio = 1 if clean[0]["role"] == "system" else 0
    # Primero se va lo mas viejo de la conversacion, nunca la pregunta de ahora ni lo que vino
    # despues (las llamadas a herramientas y sus respuestas de este mismo turno).
    ultima = max((i for i, m in enumerate(clean) if m["role"] == "user"), default=len(clean) - 1)
    while largo(clean) > MAX_CHARS and inicio < ultima:
        clean.pop(inicio)
        ultima -= 1
    # Si aun asi no cabe, se recorta el MEDIO del system: el principio es quien es y el final son
    # las herramientas, que es lo que no puede faltar.
    marca = "\n[...]\n"
    exceso = largo(clean) - MAX_CHARS + len(marca)
    if exceso > len(marca) and inicio == 1:
        s = clean[0]["content"]
        if len(s) > exceso + 2000:
            cabeza = (len(s) - exceso) // 3
            cola = len(s) - exceso - cabeza
            clean[0]["content"] = s[:cabeza] + marca + s[len(s) - cola:]
    return clean

@app.route("/api/chat", methods=["POST"])
def chat():
    data = request.get_json(force=True, silent=True) or {}
    op = data.get("options") or {}
    payload = {
        "model": MODEL,
        "messages": recortar(data.get("messages")),
        "stream": True,
        "max_tokens": int(op.get("num_predict") or 1536),
        "temperature": float(op["temperature"]) if op.get("temperature") is not None else 0.7,
    }
    # Las herramientas NO se mandan a llama: quien llama las describe en el system (formato Hermes)
    # y lee las <tool_call> del texto. Mandarlas ademas las duplicaba en el prompt.
    def generate():
        tcs, usage, got = [], {}, False
        r = requests.post(LLAMA + "/v1/chat/completions", json=payload, stream=True, timeout=600)
        if r.status_code != 200:
            yield linea("El modelo no tomo el turno (" + str(r.status_code) + "). Proba de nuevo.", True)
            return
        for raw in r.iter_lines():
            if not raw:
                continue
            s = raw.decode("utf-8", "replace").strip()
            if s.startswith("data:"):
                s = s[5:].strip()
            if not s or s == "[DONE]":
                continue
            try:
                chunk = json.loads(s)
            except Exception:
                continue
            if chunk.get("error"):
                yield linea("No pude completar este turno. Proba de nuevo.", True)
                return
            delta = ((chunk.get("choices") or [{}])[0].get("delta") or {})
            tim = chunk.get("timings") or {}
            if tim.get("predicted_n") is not None:
                usage["completion_tokens"] = tim["predicted_n"]
                usage["predicted_ms"] = tim.get("predicted_ms") or 0
            if tim.get("prompt_n") is not None:
                usage["prompt_tokens"] = tim["prompt_n"] + int(tim.get("cache_n") or 0)
            txt = delta.get("content") or ""
            if txt:
                got = True
                yield linea(txt, False)
        yield linea("" if got else "Te escucho.", True, usage)
    # Ollama contesta en un solo JSON cuando piden stream:false (asi templa el asistente de
    # PULSE2CHAT y asi preguntan los que no leen a trozos).
    if data.get("stream", True) is False:
        texto, final = [], None
        for ln in generate():
            o = json.loads(ln)
            texto.append(o["message"].get("content") or "")
            if o.get("done"):
                final = o
        final = final or json.loads(linea("", True))
        final["message"]["content"] = "".join(texto)
        return jsonify(final)
    return Response(stream_with_context(generate()), mimetype="application/x-ndjson")

@app.route("/api/tags", methods=["GET"])
def tags():
    # Tambien bajo el nombre corto que configura el asistente (AURA_MODELO=qwen3.8:27b).
    return jsonify({"models": [{"name": MODEL, "model": MODEL}, {"name": "qwen3.8:27b", "model": "qwen3.8:27b"}, {"name": "orcarouter/Qwen3.8-27B-Uncensored", "model": "orcarouter/Qwen3.8-27B-Uncensored"}]})

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=11434, threaded=True)
