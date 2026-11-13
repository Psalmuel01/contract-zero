# Audio pass: measured, not yet listened to

**Who did what.** These changes were made by measuring the game's real output, not by
ear: the author of this pass cannot hear. Every number below comes from recording the
final mix (after the limiter) in a browser and analysing it with ffmpeg. **Listen to the
`.ogg` files before calling this tuned.**

## How it was measured

`apps/web/probe-audio-record.mjs` loads each site in the dev bench, taps the final mix
(`FpsAudio.captureStream()`), and plays one fixed script through the game's own sound
functions:

| Time | What plays |
|---|---|
| 0–10 s | the site's soundscape alone (guards down) |
| 10–22 s | a firefight: the player's rifle, guards' shots around the listener, wall impacts |
| 14 s | a radio line over the fight |
| 22–34 s | extraction: the call, the vehicle approaching, countdown warnings, success |

`apps/web/probe-audio-analyze.mjs` then checks EBU R128 loudness, true peak, the radio's
voice band (500 Hz–2.5 kHz) against the same fight without it, whether extraction builds,
and whether the sites differ above the rumble (800 Hz–3 kHz and above 3 kHz).

## Before and after

| Check | Before | After |
|---|---|---|
| Firefight loudness | −9.0 to −9.3 LUFS | −18.7 to −18.9 LUFS |
| Firefight true peak | +0.5 to +0.8 dBFS (over full scale) | −2.9 to −4.5 dBFS |
| Fight over the quiet | 22 LU | 10.7 to 12.4 LU |
| Radio voice band over the same fight | −1.3 to −2.1 dB (masked) | +5.3 to +6.0 dB |
| Extraction build across its 10 s | ~1 LU | 3.0 to 3.8 LU |
| Sites differ above the rumble | 1–5 dB (Dustline ≈ Blacksite) | 13–30 dB |
| Analyzer checks passing | 2 of 18 | 18 of 18 |

Full output: [report-before.txt](report-before.txt), [report-after.txt](report-after.txt).
Spectrograms: `<site>-before.png` / `<site>-after.png`. Recordings: `<site>-before.ogg` /
`<site>-after.ogg`.

## What changed, and why

- **Combat level was never what the code said.** `applyMix` reset the gun and impact buses
  to 0.9 on every settings change, so earlier attempts to lower them did nothing. The
  levels are now constants used in both places (`GUN_LEVEL`, `IMPACT_LEVEL`), and the
  combat path gets a −9 dB low shelf at 160 Hz and a 32 Hz high-pass: the fight was almost
  all sub-bass. The limiter's attack went from 3 ms to 1 ms, threshold −6 to −9 dB.
- **Radio lines had no voice.** No recorded dialogue ships, so a line was a 0.1 s click
  of static and then silence under the subtitle. Now a transmission has a squelch, carrier
  hiss, an unintelligible speech-shaped murmur for the length of the line (pitch, pace and
  grit per speaker; band-limited like a radio) and a squelch tail. No invented words: the
  subtitles carry the words. Combat dips to 0.4 (was 0.65) while a voice talks.
- **The sites sounded alike.** Each now has its own air on the Environment bus: Dustline's
  gusting wind through the mids; the Blacksite's ventilation hiss and mains hum; Cinder
  Yard's industrial roar and pressure hiss.
- **Extraction didn't build.** The approaching vehicle was a hum low-passed at 170 Hz,
  inside the site's rumble. It now arrives more slowly and carries a rotor chop in the
  mids that quickens (7 → 12.5 Hz) and grows over ten seconds; the music's riser is
  louder and opens wider.

## Limits

- The firefight is scripted through the game's sound functions, not a played fight
  (software rendering runs the sim 3–6× slow, so a real fight is too sparse to measure).
- Headless Chrome, one machine. Not checked on phone speakers or headphones.
- The murmur is a stand-in for recorded dialogue, not a replacement.
