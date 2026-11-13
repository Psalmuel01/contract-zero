# CONTRACT ZERO voice service: Kokoro-82M (Apache-2.0) via kokoro-onnx (MIT), CPU only.
# Build context: apps/tts. Private: the API calls it with TTS_TOKEN; never expose it.
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY fetch_models.sh .
RUN sh fetch_models.sh
COPY voices.py engine.py server.py ./
RUN useradd --system --uid 10001 tts && chown -R tts /app
USER tts
EXPOSE 8090
CMD ["python", "server.py"]
