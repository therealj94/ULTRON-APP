"""
ULTRON FP — Nodo Qwen3-TTS en EC2 g4dn.xlarge (T4).
NO desplegar en aura-gpu-a10g (Qwen 27B) ni en ultron-manos-vision (Playwright).

Instancia objetivo: i-02653feadc919d3a4 (aura-gpu-T4-APAGADA)
Puerto: 8123 (histórico de voz AU-RA) o 8790
Auth: header x-ultron-tts-clave
"""

from __future__ import annotations

import io
import os
import time
from typing import Optional

import numpy as np
import soundfile as sf
import torch
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

CLAVE = os.environ.get("ULTRON_TTS_CLAVE", "").strip()
MODEL_ID = os.environ.get(
    "ULTRON_TTS_MODEL", "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"
)
HOST = os.environ.get("ULTRON_TTS_HOST", "0.0.0.0")
PORT = int(os.environ.get("ULTRON_TTS_PORT", "8790"))

app = FastAPI(title="ULTRON FP Qwen3-TTS", version="1.0.0")
_model = None
_boot = time.time()


def require_clave(x_ultron_tts_clave: Optional[str]) -> None:
    if CLAVE and (x_ultron_tts_clave or "").strip() != CLAVE:
        raise HTTPException(status_code=401, detail="clave inválida")


def get_model():
    global _model
    if _model is None:
        from qwen_tts import Qwen3TTSModel

        dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float32
        kwargs = dict(device_map="cuda:0" if torch.cuda.is_available() else "cpu", dtype=dtype)
        try:
            _model = Qwen3TTSModel.from_pretrained(
                MODEL_ID, attn_implementation="flash_attention_2", **kwargs
            )
        except Exception:
            _model = Qwen3TTSModel.from_pretrained(MODEL_ID, **kwargs)
    return _model


class SynthRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)
    voice: str = "jarvis"
    name: str = "JARVIS"
    language: str = "Spanish"
    instruct: str = (
        "Adult male, calm elegant tone, neutral Latin American Spanish, slow measured pace"
    )


@app.get("/salud")
def salud(x_ultron_tts_clave: Optional[str] = Header(default=None)):
    require_clave(x_ultron_tts_clave)
    return {
        "ok": True,
        "servicio": "ultron-qwen3-tts",
        "modelo": MODEL_ID,
        "cuda": torch.cuda.is_available(),
        "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        "enPieDesdeSegundos": int(time.time() - _boot),
        "voces": ["jarvis", "formal", "tierna", "estrategia", "orbita"],
    }


@app.get("/voces")
def voces(x_ultron_tts_clave: Optional[str] = Header(default=None)):
    require_clave(x_ultron_tts_clave)
    return {
        "voces": [
            {"id": "jarvis", "name": "JARVIS"},
            {"id": "formal", "name": "FORMAL"},
            {"id": "tierna", "name": "TIERNA"},
            {"id": "estrategia", "name": "ESTRATEGIA"},
            {"id": "orbita", "name": "ÓRBITA"},
        ]
    }


@app.post("/synthesize")
def synthesize(
    body: SynthRequest,
    x_ultron_tts_clave: Optional[str] = Header(default=None),
):
    require_clave(x_ultron_tts_clave)
    text = body.text.strip()
    if not text:
        raise HTTPException(400, "texto vacío")

    model = get_model()
    wavs, sr = model.generate_voice_design(
        text=text,
        language=body.language or "Spanish",
        instruct=body.instruct,
        temperature=0.7,
        top_p=0.9,
    )
    wav = wavs[0]
    if isinstance(wav, torch.Tensor):
        wav = wav.detach().cpu().numpy()
    wav = np.asarray(wav, dtype=np.float32)

    buf = io.BytesIO()
    sf.write(buf, wav, int(sr), format="WAV")
    return Response(content=buf.getvalue(), media_type="audio/wav")


if __name__ == "__main__":
    import uvicorn

    get_model()  # warm load
    uvicorn.run(app, host=HOST, port=PORT)
