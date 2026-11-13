"""Kokoro-82M (Apache-2.0) through kokoro-onnx (MIT): text in, MP3 out."""
import io
import os
import threading

import soundfile as sf
from kokoro_onnx import Kokoro

from voices import MAX_CHARS, VOICES

MODEL = os.environ.get("KOKORO_MODEL", os.path.join(os.path.dirname(__file__), "models", "kokoro-v1.0.int8.onnx"))
VOICES_BIN = os.environ.get("KOKORO_VOICES", os.path.join(os.path.dirname(__file__), "models", "voices-v1.0.bin"))


class Engine:
    def __init__(self):
        self.k = Kokoro(MODEL, VOICES_BIN)
        # One synthesis at a time: ONNX Runtime already uses every core for one.
        self.lock = threading.Lock()

    def mp3(self, speaker: str, text: str) -> bytes:
        if speaker not in VOICES:
            raise ValueError(f"unknown speaker {speaker!r}")
        text = " ".join(text.split())
        if not text or len(text) > MAX_CHARS:
            raise ValueError("text is empty or too long")
        voice, lang = VOICES[speaker]
        with self.lock:
            audio, rate = self.k.create(text, voice=voice, speed=1.0, lang=lang)
        out = io.BytesIO()
        sf.write(out, audio, rate, format="MP3")
        return out.getvalue()
