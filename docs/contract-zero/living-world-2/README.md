# Living World, pass 2: from functional to tangible

Branch `living-world-pass-2`. Follows PR #1 (economy presenter, procurement timelines,
consequence snapshots, audio architecture, identity system), which is kept as it was.
Every visual below is driven by records the server already holds, or is labelled.

## The recording

`apps/web/demo-out/contract-zero-living-world.mp4` (1 min 37 s, 1280×720, with the game's
own audio; git-ignored, regenerate with `node apps/web/probe-record-demo.mjs`).

| Segment | Length | Audio (integrated) | What is on screen |
|---|---|---|---|
| Hub | 11 s | −33.9 LUFS | the hangar, the next operation, "Since you were last here" |
| Contracts | 13 s | −32.8 LUFS | the operations map following the contract under the pointer |
| Cinder Yard, dusk | 38 s | −17.7 LUFS, peak −4.1 dBFS | arrival, contact, the push, loading three cases, the call, the countdown, *Extracted · 3 cases · 60 ammunition* |
| War Table | 25 s | −35.1 LUFS | a real, testnet-settled supply order played on the relief |
| Exchange | 10 s | −35.1 LUFS | the market floor: both merchants, real shelves, live prices |

Per-segment notes: [recording-report.json](recording-report.json). Audio is the final mix,
captured after the limiter (`FpsAudio.captureStream`), not a re-synthesis.

### Against the previous recording

The previous recording (`demo-run.webm`, 2026-11-09) is 7 min 32 s **with no audio
track**. [before-after-recording.jpg](before-after-recording.jpg) pairs it with this one,
screen for screen (left before, right now):

- **Contract board:** a column of text cards → the same cards beside an operations map
  that glides to whichever contract you point at.
- **Cinder Yard:** night-blue boxes on a flat plain under a flat sky → a refinery at dusk
  under smog, its sign carrying the Ashen Compact's mark, a skyline of stacks and a
  cooling tower, steam and ash in the air.
- **Exchange:** a price table → two merchants' stalls with their shelves filled from
  real stock and live prices on their boards.
- **War Table:** not in the old recording → a supply order playing: the order's beam over
  Vanguard, an arc from each merchant that bid, the winner's arc solid, the crate on it.
- **Sound:** none → a site you can hear before you see the guards, a fight that is loud
  without clipping, a radio that sounds like someone talking, an extraction that builds.

**What it does not show:** a fight played by a person. The raid is scripted. The script
can't aim, so it clears arrivals as they land and heals with a dressing when hurt. The
fight is the dev bench (`/dev/level`): unscored, but the same scene, sounds and objectives
as a live contract. Rendered headless on this machine's GPU at Medium.

## What changed

| Brief item | Done | Evidence |
|---|---|---|
| 1. War Table relief | Sand table with contours and territory washes; miniatures per facility; readiness rings, line-down beacons, contract pins; convoys on the road at the server's progress; camera focus; the holder's real stock beside a selected site; flat map one click away; screen-reader summary | [war-table-order-bids.jpg](war-table-order-bids.jpg), `probe-wartable3d.mjs` (desktop and phone) |
| 2. Less dashboard | Hub: one "Since you were last here" dispatch replaces three panels. Contracts: the relief as an operations map. Exchange: a market floor. Every screen change: a restrained fade and scan line (opacity only, off under Reduce motion) | [hub.jpg](hub.jpg), [contracts.jpg](contracts.jpg), [exchange-market-floor.jpg](exchange-market-floor.jpg); `probe-standards` passes on every changed screen |
| 3. Site identity | Per-site air graded over the hour; one shader sky (sun, clouds, stars, smog); terrain per site (mesas, ridges, flats); landmarks beyond the fence; banner signs and stencils painted from the site's real holder; ground wear; dust, rain and ash. Visual-only, tested to stay outside the playable bounds | [cinder-yard-arrival.jpg](cinder-yard-arrival.jpg); `siteLook.test.ts`, `probe-site-budgets` (all under 270 calls) |
| 4. Audio | Measured (see [../audio-pass/README.md](../audio-pass/README.md)): combat level fixed (a reset in `applyMix` had overridden every attempt), radio transmissions with a voice-shaped murmur, per-site air, an extraction that builds. 2 of 18 checks → 18 of 18 | `probe-audio-record` + `probe-audio-analyze` |
| 5. Faction and merchant presence | Supply orders play on the War Table: shortage flare, order beam, an arc per real offer, the winner, the delivery crate, a card with the acting persona's portrait and the settlement exactly as recorded. New orders play by themselves once | [war-table-order-winner.jpg](war-table-order-winner.jpg); `procurementScene.test.ts` |
| 6. Recording with audio | Above | `probe-record-demo.mjs` |

### Bugs found and fixed on the way

- **The whole site vanished when Auto quality stepped down.** On any device that couldn't
  hold its frame rate, the level's instanced meshes were rebuilt with new materials and
  kept identity matrices, so every wall and container collapsed to the origin (PR #1's
  captures showed a level missing past the gate for this reason). `probe-auto-stepdown`
  fails without the fix.
- **Combat volume settings never applied.** `applyMix` reset the gun and impact buses to
  0.9 on every settings change.
- **Radio lines were silent** apart from a click (no recorded dialogue ships).

## Limits (not done, or not verifiable here)

- **Nothing was listened to.** The audio was measured, not heard. Listen before accepting it.
- **No real phone or low-end GPU.** Desktop and phone layouts were checked in emulation;
  frame rates were measured in a software renderer (a proxy), not on devices.
- **Level geometry is unchanged.** The sites' layouts, collisions and navigation are as
  they were; identity comes from a visual layer. New architecture inside the bounds would
  need nav and reachability re-validation per mission type.
- **The murmur is a stand-in for recorded voice**, not dialogue.
- **An API hang was seen once** (2026-11-11 16:09): all world reads blocked after a NEAR
  broadcast never confirmed, and the database pool showed no connections. A restart
  cleared it. Not reproduced or diagnosed; the log is kept locally. Worth a watchdog or
  RPC timeouts in the settlement path.
- **Parallel work:** a separate visual-production pass (carbine model, modular kit, ground
  and terrain modules) was staged on this branch by its author while this pass ran. It
  is not part of these commits and was left untouched.
