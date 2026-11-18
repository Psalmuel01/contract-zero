# Living World: to-do

Tick a box (`- [x]`) only when it is built, tested and, for anything visual, checked in a running game. Background and rules: [LIVING_WORLD.md](LIVING_WORLD.md).

## Phase 0: Audit
- [x] Audit the repo and record findings
- [x] Verify which resource effects the engine really has
- [x] Fix the production build (test setup typing)
- [x] Review the latest gameplay recording and screenshots (stills and run report; no recording is in the repo)
- [x] Get ESLint running in a fresh checkout
- [x] Audit the audio engine in depth (channels, per-site beds, radio)

## Phase 1: Creative direction
- [x] Write the direction: palette, type, motion, faction briefs
- [x] Design tokens: depth, shadow, focus and motion tokens in `globals.css` (plain `:root`; reduce motion from the OS or Settings zeroes the durations; keyboard focus ring checked on a cut-corner button)
- [x] Original insignia for Vanguard, Ashen Compact, Vex Exchange, Halcyon Logistics (`components/ui/FactionInsignia.tsx`; used on the War Room, War Table panel and Exchange; not yet on the Hub, briefing or radio)
- [x] Tactical icon set: ammunition, medicine, fuel, credits (`components/ui/ResourceIcon.tsx`; used on the gauges, treasury and Hub stash)
- [x] Name and document commanders and merchant personas, with voice direction (`PERSONAS.md`, `lib/personas.ts`; Halcyon's voice is on the radio but no mission line uses it yet; no portraits drawn)

## Phase 2: Economy made understandable
- [x] Presenter layer mirroring the engine rules, with tests
- [x] Faction readiness with exact-figures disclosure (War Room)
- [x] Readiness on Contract Intel and the Hub
- [x] Merchant readiness (shelf vs target, insolvency)
- [x] Consequence pipeline: accomplished, moved or destroyed, target lost, faction's next decision, next mission change (Extraction Results)
- [x] Server snapshot per operation (before and after) for honest comparisons
- [x] Consequence story for completed operations in the War Room (list past operations, open any before/after)
- [x] Verify the extracted-run path end to end on the live API (`scripts/consequence-e2e.mjs`, 11/11 on a fresh database; off-chain, so the NEAR payout status is still unverified live here)
- [ ] Run one real on-chain payout through the consequence screens (blocked: needs the testnet signing keys; then run `scripts/field-e2e.mjs`). API join and UI wording already verified with hand-seeded rows

## Phase 3: War Table
- [x] Choose 3D relief or layered 2D map: layered SVG (the server has 3 sites and 2 merchants, so a relief would invent terrain; no extra WebGL context beside the Hub and fight scenes; keyboard, touch and reduced motion come free). Not measured against a 3D build
- [x] Facility selection and focus, faction highlight (map nodes and a button list, keyboard-checked)
- [x] Convoy routes from real origin, destination and arrival tick (labelled as strategic visualization)
- [x] Facility intelligence panel: owner, holdings, readiness, guards, missions, routes, recent attacks, commander's latest decision
- [x] Scalable supply visuals (crates, cases, tanks) tied to real amounts
- [x] Agent timeline: shortage, order, bids, winner, settlement, arrival, readiness
- [x] Advanced Evidence panel with raw logs (per stage evidence and the raw recorded chain)
- [x] Before/after comparison from recorded snapshots only (War Table attacks and the War Room operations list)

## Phase 4: Factions and merchants
- [x] Faction presentation for all four
- [x] Authored portraits and dialogue; dialogue never makes decisions
- [x] Procurement sequence replaces the text list (War Room and each Exchange order)
- [x] Pending transactions never shown as confirmed; no invented bids (War Room timeline; pinned by tests)

## Phase 5: Screen redesigns
- [x] Operations Hub (clipping fixed, compact status; other screens below still open)
- [x] Contract Board
- [x] Contract Intel
- [x] Briefing and Deployment (the loadout screen is part of the Armory item below)
- [x] Armory
- [x] Exchange and Supply Orders
- [x] War Table (the War Room page)
- [x] Extraction and Mission Results
- [x] Operator Profile
- [x] Settings and Help (Settings was already structured; the work is the Help glossary and the Advanced switch)

## Phase 6: Environments
- [x] Dustline Depot: yards, containers, towers, gates (it already had yards, container walls and a tower; added gate pillars and a sign, a second tower, fuel drums)
- [x] Blacksite: corridors, rooms, medical, control room, checkpoints (added a medical bay, a second checkpoint booth with barriers, more control-room consoles, lab lockers and bench, door signs)
- [x] Cinder Yard: tanks, stacks, pipelines, steam, walkable catwalks (the catwalk between the fractionation columns is walkable: a stair on the lane climbs to a railed deck; tanks detailed, drums, valves, five steam vents)
- [x] Nav and collision for new geometry (every objective, zone and pickup reachable; props inside bounds; no duplicates; every prop kind has a mesh)
- [x] LODs, instancing, draw-call and texture budgets (instancing was already in place; draw-call and triangle ceilings are measured in the game; texture memory is budgeted from the real files and the touch and low tiers load colour maps only; LODs were evaluated and deliberately not built: the cost is draw calls and shadow passes, which LODs do not reduce)
- [x] All three mission types validated in each site (every site, kind and hour: objectives reachable in order, guards on open floor, correct end points)
- [ ] Desktop and mobile performance measured on real devices (measured in an emulated browser with a software renderer only: relative tier and site costs, not real frame times; `probe-site-perf.mjs`)

## Phase 7: Audio
- [x] Fix the ambience bed to follow the site, not time of day (found in the audit)
- [x] Delete the unused AudioDirector
- [x] Fix the stale "Pixabay" comment in FpsAudio.ts
- [x] Channels: master, music, environment, combat, radio, UI, interactions, wired to Settings (seven sliders in Settings and the pause menu; saved keys unchanged, `interactions` added)
- [x] Per-site spatial soundscapes with attenuation and filtering (emitters placed from the level's own geometry; distance, pan, occlusion by real walls and roofs; measured, not listened to)
- [x] Combat audio: weapons, indoor and outdoor, near-miss, impacts, alarms (indoor/outdoor reverb from the level's roofs, near-miss whiz from the real round path, distant fire delayed and dulled with an echo, ricochets, enemy footsteps, three alarm levels, extraction cues; measured with level meters, never listened to)
- [x] Radio events from real game state, with subtitles (in the fight: first contact, low ammunition, reinforcements with the real count; on the Hub and War Room: faction shortage, merchant procurement, retaliation; Halcyon's voice; model-voiced lines were not built)
- [x] Adaptive music states with layered transitions (hub, preparation, infiltration, detection, combat, boss, extraction with a riser, results with a resolution, table; one score for the whole app; measured, not listened to)
- [x] Priority, cooldowns, ducking, disposal, pause and resume (voice budget, per-sound cooldowns, radio ducking, pause holds; disposal unchanged: `dispose()` closes the context)
- [x] Licensing check for every audio asset (`audioLicensing.test.ts`: every shipped file declared in CREDITS.md and generated by a script in the repo; no voice, music or outside URL)

## Phase 8: Consequences in the battlefield
- [x] Expose faction state to the mission and level builders (`cues` in the mission JSON: lines down with their end tick, deliveries landing; `site::world_cues`, 5 engine tests)
- [x] Low ammunition shown as fewer armed guards (already true before this phase and unchanged: the guard plan arms rifles first, then sidearms, and guards it cannot arm stay home; sidearm guards are drawn with pistols)
- [x] Medicine shortage shown as reduced reinforcements (already true and unchanged: reinforcements per wave come from the faction's medicine; no medical cases on site when it has none; the fight now also says when guards really arrive)
- [x] Fuel shortage shown only where the engine acts on it (the engine's effect is that no depot is staged, so the contract is not offered; nothing was added in the levels because there is nothing else to show)
- [x] Sabotage shown as disabled lines with the real duration (flame out, steam gone, line sounds silent, an offline marker, a toast and an intel line with the real return time)
- [x] Merchant resupply shown only once the engine says it has landed (amber beacons and louder engines for a shipment in its last 3 ticks or landed within 6; this is engine state, not NEAR confirmation)

## Phase 9: Onboarding
- [x] Progressive explanations in Intel, Results, Exchange, War Table
- [x] Advanced view: tokens, NEAR transactions, validation records
- [x] Short captions and tooltips; nothing forced on returning players

## Phase 10: Standards and delivery
- [x] Typecheck, unit tests and production build green (for the work so far)
- [x] Reduced motion, subtitles, keyboard and touch checked (`probe-standards.mjs`: 40 checks across the redesigned screens; `probe-subtitles.mjs`; no screen-reader or real-touch-device testing)
- [x] Hidden 3D scenes pause or throttle (the Hub's hangar stops its frame loop while the tab is hidden; a fight pauses; the gun turntable already mounts only while on screen)
- [ ] Graphics presets verified on low-end devices (verified in emulation only: each preset lowers what it says it does, and Auto steps down under load; no real low-end device was available)
- [x] Settlement and reconciliation guarantees unchanged (API tests): the API diff since the baseline is additive (consequence record, cues, read-only endpoints) and touches no settlement, reconciliation, payout, relay or contract file; all 164 Rust tests pass; `scripts/guarantees-e2e.mjs` passes 9 off-chain guarantees live; on-chain settlement itself was not run (no NEAR keys)
- [x] Screenshots per phase (43 captured images with captions in docs/media/living-world/; no recordings were made)
- [x] Before/after captures (Hub, Contract Board, Intel, Exchange, War Room, Operator Profile, and the three sites)
- [x] Desktop and mobile test runs (`apps/web/probe-all.mjs`: 10 probe groups, 92 checks, desktop and phone viewports; Vitest 892, Rust 164, tsc, ESLint baseline, production build)
