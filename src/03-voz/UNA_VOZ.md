# Una voz

Principal: **Chatterbox** (nodo GPU, `CHATTERBOX_URL`).
Si cae: **ElevenLabs Rachel** `21m00Tcm4TlvDq8ikWAM` (misma persona, mujer asistente).

Qwen3-TTS eliminado del router.

En el T4, levantar Chatterbox (OpenAI-compatible):

```
pip install chatterbox-tts uvicorn fastapi
# o: https://github.com/travisvn/chatterbox-tts-api  puerto 4123
```

Render solo habla con esa URL. El 27B (cerebro) no es TTS.
