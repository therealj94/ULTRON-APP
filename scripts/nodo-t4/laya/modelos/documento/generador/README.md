# Generador de datos del modelo `documento`

Arma los fragmentos de train/test a partir de piezas cortas (encabezados, cláusulas, párrafos técnicos,
tablas de vértices, montos) por subtipo de documento; cada pieza lleva sus `req_*`, así que las
etiquetas son las de lo que queda a la vista tras el recorte cabeza + « … » + cola. Todo es
ficticio (números `DEMO-`/`EXP-FICT-`/`FICT-`, firmantes por cargo, «[Firma y sello]»).
Los bordes (`bordes.py`) están escritos a mano, con su `nota`.

Vive fuera de `datos/` a propósito: los globs de entrenamiento leen `datos/train_*.jsonl`.

## Regenerar (misma semilla, mismos archivos)

```bash
cd scripts/nodo-t4/laya/modelos/documento/generador
python3 generar.py ../datos            # train_a..d.jsonl y test.jsonl
python3 bordes.py ../datos/bordes.jsonl
```

La semilla está fija en `comun.py` (`R = random.Random(20260926)`); con ella la salida es idéntica
byte a byte. Cambiarla, o tocar cualquier plantilla o probabilidad, cambia todos los archivos.

## Validar

```bash
python3 ../validar.py                  # desde generador/, o: python3 validar.py desde documento/
```

JSON válido, exactamente un `doc_*`, etiquetas de `preguntas.json`, largo 150–900, sin duplicados ni
casi-duplicados train↔test; imprime positivos por etiqueta. Código de salida 1 si algo falla.
