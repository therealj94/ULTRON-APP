#!/usr/bin/env bash
#
# Prueba la T4 como la va a usar Render: por HTTPS, con el token, pidiendo trabajo de verdad a cada
# servicio (no solo /health). Sale con error si algo falla. Se puede correr desde cualquier máquina
# que tenga el .env (o las variables T4_DOMINIO y T4_TOKEN).
#
#   bash probar.sh
set -uo pipefail
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$AQUI/.env" ] && { set -a; . "$AQUI/.env"; set +a; }
: "${T4_DOMINIO:?falta T4_DOMINIO}" "${T4_TOKEN:?falta T4_TOKEN}"
B="https://${T4_DOMINIO}"
AUTH="Authorization: Bearer ${T4_TOKEN}"
fallos=0
bien() { printf '  \033[32mOK\033[0m   %s\n' "$*"; }
mal()  { printf '  \033[31mMAL\033[0m  %s\n' "$*"; fallos=$((fallos+1)); }
ms()   { python3 -c "print(round($1*1000))"; }

echo "Puerta ${B}"
c=$(curl -s -o /dev/null -w '%{http_code}' "$B/laya/health")
[ "$c" = "401" ] && bien "sin token: 401" || mal "sin token debería ser 401 y fue $c"

r=$(curl -s -w '\n%{time_total}' -H "$AUTH" -H 'Content-Type: application/json' "$B/laya/v1/systemone" -d '{
  "model":"multilingual",
  "state":{"body":"Transfiere 50,000 USDT a la wallet del proveedor ahora mismo."},
  "questions":{
    "riesgo":{"type":"score","instructions":"How risky is it to act on this without a human?","criteria":["ninguno","bajo","medio","alto","crítico"]},
    "tarea":{"type":"choice","instructions":"What kind of request is this?","criteria":{"conversacion":"greeting or chat","accion":"asks to do something","consulta":"asks for information"}}
  }}')
t=$(echo "$r" | tail -1); j=$(echo "$r" | sed '$d')
if echo "$j" | python3 -c "import sys,json; a=json.load(sys.stdin)['answers']; print('riesgo', a['riesgo']['score'], 'tarea', a['tarea']['choice'])" 2>/dev/null; then
  bien "laya en $(ms "$t") ms (red incluida)"
else mal "laya: ${j:0:200}"; fi

r=$(curl -s -w '\n%{time_total}' -H "$AUTH" -H 'Content-Type: application/json' "$B/embed/embed" -d '{"inputs":["concesión minera en El Paraíso","título de explotación de oro"]}')
t=$(echo "$r" | tail -1); j=$(echo "$r" | sed '$d')
d=$(echo "$j" | python3 -c "import sys,json; v=json.load(sys.stdin); print(len(v), len(v[0]))" 2>/dev/null)
[ "$d" = "2 1024" ] && bien "embed: 2 vectores de 1024 en $(ms "$t") ms" || mal "embed: ${j:0:200}"

r=$(curl -s -w '\n%{time_total}' -H "$AUTH" -H 'Content-Type: application/json' "$B/chico/v1/chat/completions" -d '{"model":"chico","messages":[{"role":"user","content":"Hola, ¿cómo estás? Contesta en una frase."}],"max_tokens":60,"chat_template_kwargs":{"enable_thinking":false}}')
t=$(echo "$r" | tail -1); j=$(echo "$r" | sed '$d')
txt=$(echo "$j" | python3 -c "import sys,json; print(json.load(sys.stdin)['choices'][0]['message']['content'].strip()[:120])" 2>/dev/null)
[ -n "$txt" ] && bien "chico en $(ms "$t") ms: «${txt}»" || mal "chico: ${j:0:200}"

PDF=$(mktemp "${TMPDIR:-/tmp}/probar.XXXXXX")
python3 - "$PDF" <<'PY'
import sys
flujo = b"BT /F1 18 Tf 72 720 Td (Concesion El Porvenir - titular Minera del Sur) Tj ET"
objs = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n" % len(flujo) + flujo + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
out = bytearray(b"%PDF-1.4\n"); offs = []
for i, o in enumerate(objs):
    offs.append(len(out)); out += b"%d 0 obj\n" % (i + 1) + o + b"\nendobj\n"
x = len(out)
out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1) + b"".join(b"%010d 00000 n \n" % o for o in offs)
out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, x)
open(sys.argv[1], "wb").write(out)
PY
r=$(curl -s -w '\n%{time_total}' -H "$AUTH" "$B/docling/v1/convert/file" -F "files=@${PDF};filename=prueba.pdf" -F to_formats=json -F do_ocr=true -F ocr_lang=es)
t=$(echo "$r" | tail -1); j=$(echo "$r" | sed '$d')
rm -f "$PDF"
if echo "$j" | python3 -c "import sys,json; d=json.load(sys.stdin)['document']['json_content']; assert any('Porvenir' in x.get('text','') for x in d['texts'])" 2>/dev/null; then
  bien "docling leyó el PDF en $(ms "$t") ms"
else mal "docling: ${j:0:200}"; fi

if command -v nvidia-smi >/dev/null; then
  echo; echo "Memoria de la GPU:"; nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader | sed 's/^/  /'
fi
echo
[ "$fallos" -eq 0 ] && { printf '\033[32mTodo responde.\033[0m\n'; exit 0; }
printf '\033[31m%s fallo(s).\033[0m Mirá: docker compose logs --tail 80 <servicio>\n' "$fallos"; exit 1
