# Modelos de «Hey AURA»

| Archivo | Qué es | Origen | Licencia |
|---|---|---|---|
| `melspectrogram.onnx` | Calcula el espectrograma (32 bandas) del audio a 16 kHz | openWakeWord v0.5.1 | Ver la nota de abajo |
| `embedding_model.onnx` | Rasgos de 96 números cada 80 ms (`speech_embedding` de Google, convertido a ONNX) | openWakeWord v0.5.1 | Ver la nota de abajo |
| `hey_aura.onnx` | El clasificador de «hey aura» / «oye aura», entrenado por nosotros el 1-oct-2026 en la T4 | Propio | Propio, entrenado sobre los rasgos de arriba |

## Cómo se entrenó

- **Positivos:**
  - 9 000 clips en español generados con 5 voces de Piper: es_MX-ald, es_MX-claude, es_ES-davefx, es_ES-sharvard y es_AR-daniela.
  - 11 000 clips en inglés generados con piper-sample-generator.
- **Negativos:**
  - Frases parecidas: «oye laura», «aurora», «a la hora», «hey alexa», «oye siri»…
  - ACAV100M.
- **Aumentos:** ruido de AudioSet y respuestas al impulso de cuartos (MIT).
- **Entrenamiento:** 25 000 pasos, `max_negative_weight` 500.

## Medición (clips que no vio, umbral 0,9)

| Prueba | Resultado |
|---|---|
| «oye aura» en español | 67 % |
| «hey aura» | 90 % |
| Frases parecidas | 0 % |
| Ambiente | 0 % |
| Falsas alarmas por hora (10,7 h de audio general) | ~0,56 |

En AURA se usa **junto** con el reconocedor de Windows: cualquiera de los dos la despierta.

## Nota de licencia

El código de openWakeWord es Apache-2.0. Los modelos preentrenados de su repositorio están bajo CC BY-NC-SA 4.0, que no permite uso comercial. Tienes que revisar esto antes de distribuir AURA comercialmente con estos dos archivos.

La alternativa es reemplazarlos por el `speech_embedding` original de Google (TF Hub, Apache-2.0) convertido por nosotros.
