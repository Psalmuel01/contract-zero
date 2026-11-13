# Voice service

The radio voices: Kokoro-82M (**Apache-2.0**) through kokoro-onnx (**MIT**), on a CPU, with
no API key and no per-line cost.

- **Who sounds like whom:** `voices.py`, one voice per character. Change one and bump
  `VOICE_VERSION` here and in `apps/api/src/services/voice.rs`.
- **Authored lines:** `python pregen.py` writes `apps/web/public/vo/*.mp3` and its
  manifest, voicing only what changed.
- **A mission's own lines:** the API calls `server.py` (`POST /synthesize`, bearer
  `TTS_TOKEN`) and caches each line in Postgres. The browser never calls this service.

```sh
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
sh fetch_models.sh                       # 120 MB, checksum-pinned, not committed
TTS_TOKEN=… .venv/bin/python server.py   # :8090
.venv/bin/python pregen.py
```

## Deploying

Deploy it as its own Railway service from this folder (Dockerfile, health check on
`/health`), with a random `TTS_TOKEN`. Then set the same `TTS_TOKEN`, and
`TTS_URL=http://<service>.railway.internal:8090`, on the API.

Synthesis takes about 3 s a line on a CPU.
