# Radio voices: real dialogue only

**Not done until you have listened to it.** The recordings here are the game's final mix
as a player hears it. Automated transcription understanding them is a check, not the
verdict.

## What changed

- **No synthetic speech anywhere.**
  - **The murmur is deleted:** `radioMurmur()`, the "speech-shaped murmur" that played
    whenever a line had no recording.
  - **The fallback is now silent apart from a tone.** When a voice is missing, fails, or
    isn't ready within 1.5 s, the line is its subtitle and the speaker's brief radio tone
    (about 0.15 s of static).
  - **A test guards it:** it fails if any path builds an oscillator or distortion.
- **Every line has one source of truth.** The text that is captioned is the text that is
  spoken.
  - **Authored lines:** pre-voiced (`public/vo`, `apps/tts/pregen.py`).
  - **A mission's own lines** (authored or AI-rewritten, then checked): voiced by the API.
  - **The strategic radio:** now written by the server (`apps/api/src/services/radio.rs`)
    from its own records: accepted faction decisions and filled orders. Before, the
    browser wrote these sentences and the server could not voice them. The server voices
    exactly the text it serves (`GET /radio`, `GET /radio/{key}/vo`).
- **Voices are made before they're needed.**
  - **Mission lines:** voiced when the story is served, then fetched by the deploy screen
    during mission prep.
  - **Strategic lines:** voiced by a background loop within about 10 s of the event, then
    fetched by the browser as soon as they're queued.
  - **Nothing waits on synthesis:** it never holds the world lock, so the scheduler,
    combat and mission completion never wait on a voice.
  - **Cache:** keyed on voice version, speaker and text. Concurrent requests for one line
    share a single synthesis (server) and a single download (browser).
- **One transmission at a time.** A line arriving while another speaks waits up to 4 s
  for the channel, scheduled to start when the first ends. Past that, it plays as its
  subtitle rather than late. Strategic history is never replayed.
- **A lighter radio chain** (`buildVoiceChain` in `engine/audio/dialogue.ts`). The old
  chain:
  - cut everything below 260 Hz;
  - boosted 2.4 kHz by 4 dB;
  - cut everything above 3.6 kHz;
  - and drove Ashen through distortion.

  The new one passes 160 Hz to 6.5 kHz, adds 2 dB at 3 kHz, has no distortion, and uses a
  gentle compressor. Measured on Kestrel's line, against the clean synthesis: the tone
  stays within about ±1 dB from 125 Hz to 4 kHz, and only the top octave is softened by
  about 2 dB.
- **The settings "test voice" button** plays a real line. It used to be a murmur.
- **Development diagnostics:** in development, each line logs its source (pre-generated,
  dynamic or cache) or why it fell back. URLs are never logged, because a mission line's
  URL contains its session.

## Every call site

| Where | Lines | Voice source | Before this change |
| --- | --- | --- | --- |
| The mission scene's radio queue | Authored beats (op start, contact, low ammo…) | Pre-generated | The same |
| | Reinforcements, 1–12 guards | Pre-generated per count | The same |
| | Reinforcements, 13+ | None: subtitle and tone | Murmur |
| | A mission's own lines (AI-rewritten or not) | Dynamic (API), prefetched at prep | Dynamic, murmur on failure |
| The strategic radio (Hub, War Room) | Faction decisions, merchant fills | Dynamic (server-written, server-voiced) | Murmur, always |
| Settings → test voice | One line | Pre-generated | Murmur, always |

## Recordings (`*.ogg`, the final mix)

| File | What | Line outcomes (`outcomes.txt`) |
| --- | --- | --- |
| `clean.ogg` | No fight: a pre-voiced line, then a server-voiced strategic line | pregenerated, dynamic |
| `combat.ogg` | A firefight: a pre-voiced line, then a server-voiced line | pregenerated, cache |
| `strategic.ogg` | Three server-written faction and merchant lines in turn | dynamic ×3 |
| `failed.ogg` | A missing voice (404), a voice service that never answers, a line with no voice | subtitle-only ×3: tones only |
| `handler-first-contact-clean.ogg` / `-processed.ogg` | One voice as synthesized, and through the radio chain | |

Whisper transcribing each line on its own (a check, not the verdict):
- **Combat:** "Medicine at 17 of 24. Logged. Resupply is ordered."
- **Strategic:**
  - "Ammunition at 67 of 96. We burn without it. We are buying."
  - "Lovely, 66 fuel to Ashen Compact for 1,768 credits, as agreed."
- **Failed:** no words. That recording is -29 LUFS with peaks at -10 dBFS: the site's
  ambience and three short tones.

Regenerate with `API=http://localhost:8080 node apps/web/probe-voice-record.mjs <dir>`. It
needs a local API with a voice service (`TTS_URL`) and a world that has made decisions.

## Limits

- **Nobody has listened yet.**
- **Coverage gap:** a line with no voice source (13 or more reinforcements; any future
  line added without one) is subtitle-only. Adding a line means voicing it
  (`pregen.py`) or serving it from the API. The development log names any line that has
  no voice.
- **Synthesis time:** about 3 s a line on this Mac, but **about 11–12 s on Railway's CPU**
  (measured on production).
  - **Strategic radio:** a line waits for its voice, up to 25 s, before being said, so it
    plays voiced. If it's still not ready, it plays as subtitle and tone.
  - **Mission lines:** voiced from the moment the story is served, in play order. With
    about 17 lines a mission, the first few beats are ready within about a minute of
    preparation; a line not ready at its beat is shown, not spoken, and cached for next
    time.
  - **Faster synthesis** needs a bigger CPU for the `voice` service on Railway (or a GPU
    host).
- **One mispronunciation:** Kokoro says "Medicine" in a way Whisper sometimes hears as
  "Medecine". Listen for it.
