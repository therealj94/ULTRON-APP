# Entrenar a Laya y a Qwen con lo que hace la mesa

El ciclo completo tiene seis pasos:

1. Dr Electrum contesta y cada turno deja su traza.
2. El equipo revisa esas trazas.
3. Se exporta lo revisado.
4. Se entrena.
5. Se evalúa contra el modelo que ya está sirviendo.
6. Solo si no empeora, se promueve.

```
turnos reales ──► traza (pregunta, herramientas, respuesta)          lib/cognitivo/traza.ts
      │
      ├─ 👍/👎 debajo de cada respuesta (quien preguntó)              src-electrum/panel/Opinion.tsx
      └─ Escuela: ✓/✗, corrección y a quién convocar (mando)          src-electrum/escuela/Escuela.tsx
                         │  (se guarda en la opinión de la traza: sin tablas nuevas)
                         ▼
      scripts/entrenamiento/exportar.ts ──► entrenamiento/salida/   (fuera del repositorio)
            ├─ laya-electrum/train_reales.jsonl ──► nodo T4: instalar-laya.sh (con compuerta)
            ├─ qwen-sft.jsonl + herramientas.json ──► entrenar_lora.py ──► a_gguf.sh ──► llama-server --lora
            └─ evals-candidatas.jsonl ──► (revisar) ──► evals/electrum.jsonl
```

## Reglas que no se negocian

- **Solo entra lo revisado por una persona.** Un turno se usa si alguien lo aprobó, o si lo marcó como malo y escribió la respuesta correcta. Una respuesta sin revisar no enseña nada: el modelo aprendería sus propios errores.
- **Para Qwen, solo texto de Qwen o de una persona.** Nunca salidas de otros modelos comerciales (OpenAI, Anthropic, Google, etc.). Sus términos lo prohíben, y además arrastran su estilo y sus errores. El exportador filtra por el modelo que quedó en la traza.
- **Los datos personales se tapan al exportar.** Se tapan correos, teléfonos de Honduras, DNI, RTN y secretos, también dentro de los argumentos de las herramientas. Los nombres de concesiones, titulares y lugares se quedan, porque son el oficio.
- **Los hechos no se entrenan.** Cargos, leyes y concesiones cambian, y tienen que salir de las herramientas con su fuente (ver `server/electrum/instituciones.ts`). Lo que se enseña es el comportamiento:
  - qué herramienta usar y con qué argumentos,
  - cómo contestar con lo que devolvió,
  - a quién convocar.
- **Evaluar con preguntas que no se entrenaron.** Una de cada diez trazas aprobadas (siempre la misma, por su id) queda apartada: sale solo como caso de evaluación y nunca entra al ajuste. Si no, la compuerta mediría memoria.
- **Una corrección enseña solo la respuesta.** En un turno marcado ✗ con la respuesta correcta, las llamadas a herramientas originales quedan como contexto (la respuesta se apoya en lo que devolvieron), pero no se aprenden: pudieron ser justamente el error.
- **Nada se promueve sin ganarle al que está.**
  - Laya se compara con `evaluar.py` y `comparar.py`.
  - Qwen se compara con `scripts/evals/correr.ts`.

## 1. Juntar opiniones

- **En el chat:** debajo de cada respuesta aparece «¿Sirvió? 👍 👎». El 👎 pide, en una línea, qué debió hacer.
- **En Infraestructura › Escuela (solo mando):** los turnos se filtran por «Con problemas», «Sin revisar», «Revisadas» o «Todas». Empezá por «Con problemas»: llamadas ilegibles, turnos sin rondas, errores y 👎. En cada turno:
  - **A quién debió convocar la mesa** (hasta 2, o «Nadie»). Viene marcado lo que decidió en ese turno; corregilo si hace falta.
  - **✓ Sirve.** La respuesta queda como ejemplo bueno.
  - **✗ No sirve.** Escribí la respuesta correcta y esa es la que se enseña. Sin corrección, el turno no entra al entrenamiento.
- **Metas orientativas**, que se ven en la Escuela:
  - ~300 conversaciones aprobadas o corregidas para Qwen,
  - ~100 paneles marcados para Laya.
  - Con menos, el ajuste no mueve la aguja.

## 2. Exportar

```bash
EVAL_SESION=<sesión con mando en Dr Electrum> npx tsx scripts/entrenamiento/exportar.ts --salida entrenamiento/salida
```

Recorre todas las trazas por páginas (el servidor da 500 por pedido), así que los ejemplos revisados viejos no se pierden. Imprime y guarda en `informe.json` cuánto entró, qué quedó fuera y por qué. También muestra las señales de dónde falla hoy: turnos con llamadas ilegibles, sin rondas y con error.

`--prueba-humo 24` escribe además `qwen-sft-PRUEBA-sin-revisar.jsonl`. Son respuestas de Qwen sin revisar, y sirven solo para probar el ajuste de punta a punta con un modelo chico. **Nunca** son para el modelo de producción.

Primera corrida, 29-09-2026: 286 trazas, 0 revisadas, 0 ejemplos. Hay 57 turnos con llamadas ilegibles y 43 sin rondas; el formato XML de Qwen, que se lee desde el PR #71, explica probablemente muchos de ellos.

## 3. Laya (nodo T4)

1. Copiá los datos reales al nodo, fuera del repositorio:
   ```bash
   scp -r entrenamiento/salida/laya-electrum/ <nodo-t4>:/opt/laya-reales/electrum/
   ```
2. En el nodo, reentrená:
   ```bash
   REENTRENAR=electrum bash scripts/nodo-t4/instalar-laya.sh
   ```
   `instalar-laya.sh` suma `/opt/laya-reales/<modelo>/train_*.jsonl` a los datos de ese modelo. `entrenar.py` deja fuera cualquier texto que esté en las pruebas.
3. El modelo nuevo se promueve **solo si no empeora** al que está sirviendo:
   - Se miden los dos sobre las mismas pruebas apartadas con `evaluar.py`.
   - `comparar.py` usa el F1 del híbrido en electrum y el F1 macro en los demás, con una tolerancia de 0,01.
   - Si no pasa, sigue el anterior y el nuevo queda en `<dir>.rechazado`.
   - Cuando se promueve uno, el anterior queda en `<dir>.anterior` (volver atrás es un `mv`).
   - `FORZAR=1` salta la compuerta.

**Ojo, antes de confiar en Laya electrum:** medí el modelo del nodo con:

```bash
cd /opt/laya && venv/bin/python evaluar.py --modelo modelo-electrum --tabla datos/test-tabla.jsonl
```

Un checkpoint viejo entrenado en CPU dio F1 0,617 para el híbrido contra 0,761 de la tabla sola, en la misma prueba (29-09-2026). Si el del nodo da algo parecido, conviene que decida la tabla hasta que los datos reales lo mejoren.

## 4. Qwen (ajuste LoRA)

**Cuándo:** con ≥300 ejemplos revisados. `--minimo 300` lo exige.

**Base:** tiene que ser el modelo HF **con los mismos pesos** que sirve llama-server. Hoy el nodo sirve `orcarouter/Qwen3.8-27B-Uncensored` en GGUF.
- Si no está publicada su versión HF (safetensors), entrená sobre `Qwen/Qwen3.8-27B` y serví esa misma base con el adaptador.
- Un adaptador sobre otros pesos degrada al modelo.

**Máquina:** las conversaciones reales miden de 900 a más de 2 500 tokens con las definiciones de herramientas, así que el ajuste de verdad corre con `--max-largo 4096`.
- **A10G de 24 GB:** QLoRA de 27B en 4 bits queda muy justo con 4096. Se puede con `--max-largo 2048 --lote 1`, pero se pierden los ejemplos largos.
- **A100/H100 de 80 GB alquilada por horas:** lo práctico. Unas 2–4 h para 300–1 000 ejemplos.

```bash
pip install -r scripts/entrenamiento/qwen/requirements.txt   # torch con CUDA
python scripts/entrenamiento/qwen/entrenar_lora.py \
  --datos entrenamiento/salida/qwen-sft.jsonl --herramientas entrenamiento/salida/herramientas.json \
  --base <modelo HF base> --salida lora-electrum --minimo 300 --max-largo 4096
bash scripts/entrenamiento/qwen/a_gguf.sh lora-electrum <dir HF del base>
```

**Qué hace `entrenar_lora.py`:**
- La pérdida solo cuenta lo que dice el asistente: sus llamadas a herramientas y su respuesta. No cuentan la pregunta, lo que devolvieron las herramientas ni el system.
- A cada ejemplo le da sus herramientas más unas cuantas que no usó (`--distractores`), para que aprenda a elegir.
- Si una conversación no cabe, acorta lo que devolvieron las herramientas antes que cortar la respuesta.
- Guarda `entrenamiento.json` con la huella de los datos, los hiperparámetros y la pérdida de validación.

**Probar y promover:**

1. Levantá llama-server con el adaptador:
   ```
   --lora lora-electrum.gguf
   ```
   Para probar a media fuerza: `--lora-scaled lora-electrum.gguf 0.5`.
2. Corré las evaluaciones contra ese servidor y contra el de siempre:
   ```bash
   EVAL_SESION=… npx tsx scripts/evals/correr.ts --url … --plataforma electrum --anterior evals/informes/electrum-ultimo.json
   ```
   Sale con código 1 si el nuevo es peor.
3. Solo si no empeora, se deja el `--lora` en el servicio.
4. Volver atrás es quitar `--lora` y reiniciar.

## Lo que se verificó el 29-09-2026

Todo en este contenedor. Solo lectura sobre producción: las opiniones de la prueba se interceptaron, no se escribieron.

- **Exportador contra producción:** leyó las 286 trazas y dio 0 ejemplos, lo correcto porque no hay revisadas. La prueba de humo sacó 24 conversaciones reales de Qwen con herramientas.
- **Chat y Escuela en Chromium:**
  - El 👎 con nota manda `{valor: -1, nota}` a la traza correcta.
  - La Escuela lista los turnos reales y guarda la revisión en el formato que lee el exportador.
- **`entrenar_lora.py` en CPU con `Qwen/Qwen3-0.6B`**, misma familia y misma plantilla ChatML que el modelo del nodo:
  - Con `--max-largo 1536`, 24 ejemplos dieron 11 que caben (13 fuera por largo).
  - 8 pasos: pérdida 2,20 en entrenamiento y 1,90 en validación.
  - Máscara comprobada: de 913 tokens se entrenan 108, exactamente la llamada a la herramienta y la respuesta final. Ni la pregunta, ni el resultado de la herramienta, ni el system.
- **El adaptador guardado carga con PEFT y genera una llamada válida:**
  ```
  <tool_call>{"name": "expediente_buscar", "arguments": {"texto": "Clavo Rico"}}</tool_call>
  ```
- **`a_gguf.sh`** (`convert_lora_to_gguf.py` de llama.cpp): 392 tensores, 20 MB en f16. Cargarlo en llama-server no se probó aquí (no hay GPU ni llama.cpp compilado).
- **Compuerta de Laya:**
  - Simulada: promueve si mejora, rechaza si empeora y guarda el anterior.
  - Con un informe real de `evaluar.py`, `comparar.py` lo lee bien.
- **Pruebas:** `tests/entrenamiento-dataset.test.ts`. Solo entra lo revisado, solo de Qwen o de una persona, sin datos personales, sin repetidas.
