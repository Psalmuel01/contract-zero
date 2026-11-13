# Audio pass 2: radio voices and a clearer mix

**Not complete until a person has listened to it.** Every change here was made by
measuring the game's final mix (after the limiter), not by ear. Listen to the
`*-after.ogg` files, and to the game, before calling it done.

## What a player hears now

- **Radio lines are spoken.** Before this pass a radio line was a wordless "voice-shaped
  murmur" under its subtitle. Now each of the five characters has its own synthesized
  voice: Kestrel, Halcyon, Vanguard, Vex and Ashen.
  - **Authored lines:** pre-voiced, in `apps/web/public/vo`.
  - **A mission's own lines** (authored, or rewritten by the model and checked): the API
    voices them through a private service and caches them.
- **The mix is less muffled.** The fight has less low boom, more presence where speech and
  gunshot crack live, and more air on top. The sites' ambience got its top end back.

## Measured

**Before** samples, which are what production plays today, are in the previous pass's folder:
`../audio-pass/<site>-after.ogg`. **After:** `<site>-after.ogg` here.

Whisper (speech recognition) transcribing the moment a radio line plays over a firefight,
in the final mix:

| Site | Production today (murmur) | After |
| --- | --- | --- |
| Dustline Depot | "♪ ♪" (no words) | "Contact, they know you're here now. Move." |
| Blacksite | "♪ ♪" | "The cargo is in the yard past the hall. Load it, walk it out, get paid." (the scene's own opening line, landing in that window) |
| Cinder Yard | "♪" | "Contact, they know you're here now. Move." |

The fight in octave bands, dB, before → after (Dustline; the other sites are within 0.5 dB):

| Band | 63 | 125 | 500 | 1k | 2k | 4k | 8k | 16k |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Before | -28.7 | -27.0 | -33.2 | -32.0 | -31.3 | -32.2 | -36.1 | -42.8 |
| After | -31.9 | -30.0 | -34.1 | -32.0 | -30.0 | -30.3 | -34.2 | -40.8 |

Mix checks (`apps/web/probe-audio-analyze.mjs`): 18 of 18 pass in two consecutive takes.
- **Firefight:** -17.6 to -18 LUFS, true peak -1.0 dBFS or below.
- **The radio voice band:** rises 3.6 to 3.7 dB over the same fight.
- **Extraction:** still builds.

Before this pass, the voice-band check only passed with the murmur. With a real voice at
the old level it fell to 1.5 dB.

## What changed

- **Voices** (`apps/tts`).
  - **Model:** Kokoro-82M (Apache-2.0) through kokoro-onnx (MIT), on the CPU, with no
    API key and no per-line cost. One voice per character (`voices.py`), chosen for
    distinct accent, gender and pitch.
  - **Checked:** Whisper transcribed every candidate, and all 34 pre-voiced lines, word
    for word.
  - **Server side:** the API voices only lines it stored (a mission's story, for that
    mission's player), caches each distinct line once (`voice_cache`), and warms a
    mission's lines in play order when its story is fetched. The browser never sees the
    voice service or its token.
  - **Fallback:** if no voice service is configured, or a line isn't ready within 3.5 s, it
    plays as its subtitle over the radio's signature.
- **Voice playback** is decoded into the audio graph (radio band, presence, Ashen's set
  overdriven) instead of a bare `<audio>` element, so voices follow the mix, the ducking and
  the recording tap. Voice level is up about 4 dB.
- **Combat EQ:** -3 dB at 90 Hz, +3 dB presence at 3 kHz, and a +3 dB shelf above 7 kHz.
- **Environment:** a +6 dB shelf above 3.5 kHz.
- **Dustline's air:** trimmed on top, so its wind sits in the mids.
- **Headroom:**
  - The master runs under a 0.91 trim of the player's slider.
  - A soft ceiling after the limiter: the fastest transients had reached 0 dBFS in one
    take.
- **The site-difference check is now robust.** It takes the median over nine 1 s windows
  instead of one 9 s window, which had swung up to 5 dB between takes of the same site.

## Limits

- **Nothing was listened to.**
- **Strategic radio isn't voiced yet.** That's the War Table feed of faction and merchant
  moves. Its sentences are built in the browser from live numbers. The server would need
  to accept only text matching those exact templates before voicing it, so it keeps
  subtitles and squelch for now.
- **Synthesis is about 3 s per line on a CPU.** A mission's lines are warmed when its
  story is fetched, and the opening line is ready in about 5 s. On a slow host, a late
  line plays as its subtitle.
- **The sites are less distinct than the old check claimed.** Measured robustly, Dustline
  and Blacksite were about 5 dB apart both before and after this pass (target 6). Their
  character comes mostly from the site layers, which need ear-led sound design, not these
  small air layers. The check passes in both final takes but isn't a strong margin.
- **The voice service still has to be deployed** (`apps/tts`, its own Railway service),
  with `TTS_URL` and `TTS_TOKEN` set on the API. Until then, production uses the
  pre-voiced lines and subtitles.
