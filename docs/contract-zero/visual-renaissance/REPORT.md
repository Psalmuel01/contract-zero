# Visual renaissance: what changed, what it costs

Branch `marvy/visual-renaissance`, baseline `aaac72a`. Everything below is measured on
this machine (Apple M2, headless Chrome on the GPU, 1280×720); relative costs, not a
phone's frame times. Every before/after pair in [GALLERY.md](GALLERY.md) is the same
frame from the same camera, captured by `probe-vistas.mjs` from the base commit's
server and this branch's.

## Stage A: the first-person weapon (commit `30a9c2b`)

- The service carbine rebuilt by `scripts/build-visual-kit.mjs`: a red-dot sight
  (aperture, emissive dot aligned to the bore), a railed receiver with end caps,
  ribbed magazine, iron co-witness, sling loop; 6,092 triangles.
- A baked wear mask (`weaponFinish.ts`): edge wear, grain and grime in the
  roughness/colour, applied to every gun the player holds, procedural ones included.
- Articulated gloved hands (`viewmodelHands.ts`): a support hand under the handguard
  with splayed fingers, a trigger hand with a curled index, both posed per weapon
  from the model's own length, never clipping through the receiver.
- Motion: look-lag sway, a spring weapon kick with recovery, a staged reload (drop,
  insert, charge), a muzzle flash card with smoke, ejected brass (`ShellCasings.ts`).
- Tone mapping inside the composer stacks: the renderer's filmic curve never applied
  under post-processing, so High and Medium were showing raw linear light. Every
  grade below starts from this fix.

## Stage B: the rendering foundation (commits `94d269b`, `495bbd6`)

| Change | Why |
| --- | --- |
| `ToneMapping` + `SMAA` in every composer stack | The curve (above), and the game shipped with no anti-aliasing at all: every rail and fence wire crawled. |
| Per-hour, per-site light shaping (`siteLook.ts`) | Day: a stronger key over a quieter ambient, so shadows carry depth. Night: ambient held up so the fight reads; exposure now set by the hour. |
| The road laid into the ground shader (`siteGround.ts`) | Was a slab 2 cm proud with a dead-straight edge. Now a ragged-edged blend with wheel-polished lanes, no step. Low keeps the slab. |
| Six practicals on full tiers (was 4) | The Blacksite vault and the far rooms were pitch black at night. |
| Weather stops at the eaves (`SiteDressing.tsx`) | Rain and ash fell indoors. Roof footprints are uniforms in the air shader. |
| Baked contact pads under every sizeable structure | Grounding without a per-frame cost (see "what was measured out"). |
| Shadow bias −0.0008 → −0.0004 + normalBias 0.025 | Peter-panning on thin walls without acne. |

### What was measured and rejected

| Candidate | Measured | Verdict |
| --- | --- | --- |
| N8AO (half-res, performance) on levels | +6 ms/frame | Out. Baked pads + sun shadows instead. |
| N8AO's `enableNormalPass` | re-rendered every draw | Out with it. |
| 3072 shadow map on the full tier | +4 ms/frame | Back to 2048 (a ~4 cm texel over a site). |
| Kit thin steel casting shadows | thousands of members in the shadow pass | Only tank/column shells and plinths cast. |

## Stage C: Cinder Yard as the hero level (commits `94d269b`, `495bbd6`)

`refineryKit.ts` builds the plant at the colliders' own sizes, merged to one mesh per
material (a tank farm is six draws): shell courses with weld seams, wind girders with
handrails, conical roofs with vents and manways, nozzle runs with hand wheels, access
stair towers; columns with skirts, ringed platforms, caged ladders, downcomers; rack
flanges, hangers, a valve; a lattice flare derrick (the flame stays the live component
the economy can extinguish); the tanker loading arm; cable trays, floodlights and
horns on the blast walls. Tanks wear plate relief under flat paint.

The gameplay rule is tested (`refineryKit.test.ts`): nothing below head height leaves
its collider's footprint, so no invisible walls and no walking through geometry;
module triangle budgets are pinned.

## Stage D: Dustline and Blacksite identity

The same kit pipeline, a different prop language per site, merged into the existing
per-material meshes (Dustline 286 → 286 draws, Blacksite 292 → 294).

- **Blacksite, a serviced facility.** Cable trays with brackets, conduit drops to
  junction boxes, horn speakers and bracket floodlights run down both sides of the
  main corridor and along the perimeter wall's courtyard faces, all above head height
  (`buildWallServices`, the footprint rule tested). The corridor now recedes toward
  the vault as a working building rather than a grey tube, at day and at night.
- **Dustline, exposure.** Windblown sand banks along the bases of the containers and
  the warehouse's outward walls (`sandBanks` in `SiteDressing.tsx`): soft ground
  decals on the wear layer, not geometry, so there is nothing to trip on. A first
  attempt with leaning kit slabs read as grey planks in the captures and was removed.
  Tested: banks run along real walls and never lie over a pickup, objective, cargo
  case or the extraction zone.

## Stage E: impacts that match what was hit

The effects library already had five surfaces (concrete, dirt, wood, metal, flesh),
but the game picked between three, wrongly: every cover box was `wood` (a steel tank
threw splinters), the ground was always `dirt` (even paved Cinder Yard and the
concrete Blacksite), and every wall played the same recorded bullet-on-metal sound.

- `vfx/impactSurface.ts` maps each collider's real kind to its material: steel for
  tanks, trucks, containers, warehouse sheeting, racks, pumps, servers and lockers;
  timber for crates; masonry for barriers and walls. The ground follows the site's
  floor, with asphalt roads counted as concrete. Campaign arenas (no kinds) keep the
  old split. Tested for every collider kind in every level.
- One surface now drives both the burst and the sound: the recorded strike is voiced
  per surface (steel at pitch; concrete lower and duller; timber duller; earth a
  filtered thud), and only hard surfaces ricochet.
- Checked in the running game: tight holes and sparks off a steel tank, a plume of
  earth off the ground.
- Fixed on the way: the Cinder Yard tanks wore the tread-plate relief (floor plating,
  obvious up close); now fine pitting under the paint.

## Stage E: guards move the way their bodies move

Before: any guard that was manoeuvring played `run` at one fixed rate, so a guard
edging between cover ran on the spot and slid. The rig's `walk` and strafe clips were
never used.

- `scene/enemyGait.ts` picks the clip from the guard's real, smoothed velocity relative
  to where it faces: standing below 0.3 m/s, strafing left or right when the motion is
  mostly sideways (guards always face the player, so circling is a strafe), walking
  when slow or backing off, running forward at manoeuvre speed. Each clip plays at a
  rate matched to ground speed (bounded), so the feet keep pace. The AI, positions and
  hitboxes are untouched.
- Checked live (`probe-gait.mjs`, Dustline, rooms awake, 17 s): run 282 frames, idle
  274, strafe 146, walk 68, peak speed 2.8 m/s (the sim's manoeuvre speed), 0
  disagreements between the played clip and the gait. Before, all 455 manoeuvring
  frames would have been `run`.
- The strafe clips were mirrored, found by measuring rather than eyeballing: in
  `operator.glb`, `strafeL`'s root motion travels 2.2 m to the character's right and
  `strafeR` 1.5 m to its left (the armature only rotates about X; the left thigh sits
  at +X, so left is +X). A guard circling right stepped left. `rigClips.ts` maps them to
  the side they actually step, and a test reads the file to keep it so. Rechecked live:
  strafeL 86 frames, strafeR 51, 0 clip/gait disagreements.

## Stage F: Cinder Yard's tanks by day

By day the tank farm read as white paper against the smog sky (tank 164 luma, sky 196,
at the start view). Measured, not guessed:

- **Not the paint.** A much darker, less metallic paint moved the shell 13 points: the
  sun, sky, fill and ambient together sit those faces on the tone curve's shoulder.
- **Not the haze.** Pushing the day smog back (0.7 → 0.85 of the fog distance) changed
  the shell by 0.3 points; reverted.
- **Flatness.** Every shell was one clean paint from base to roof. `weather()` in
  `refineryKit.ts` now bakes vertex colours into the merged tank/column geometry:
  grime and rust bleed toward the base, fading by 11 m, uneven around the shell so the
  gradient draws faint vertical streaks. One extra material (`tankKit`) so nothing
  without the colours can turn black; no extra draws or textures.
- Column skirts were wrapped in tread plate (read as floor plating); they are concrete
  fireproofing now, as on real columns.

Result: tank 138 (base 134, upper 145) against the same 196 sky: contrast 33 → 58. Night
checked: shells hold their shape against the flare glow. Cinder Yard High 10.6 ms / 286
draws (10.2 ms / 286 before; within run-to-run noise).

## Stage E (partial): enemies and the HUD

- Enemy rifles get the same `finishWeapon` surface pass as the player's weapons.
- The enemy visibility lift retuned 1.7 → 1.35 (tuned against the old flat grade, it
  read as plastic under the new key light), roughness up.
- The in-fight control sheet fades out 26 s into a run (the pause menu and Field
  Manual carry the bindings); its type up from 11 to 12 px while it shows.

## Performance (GPU, 720p, day, 6 s medians)

| Site · tier | Baseline | Unmeasured branch state | Now |
| --- | --- | --- | --- |
| Cinder Yard · desktop High | 7.9 ms · 252 draws | 20.0 ms · 534 draws | **10.6 ms · 286 draws** |
| Dustline · desktop High | 6.9 ms | 15.1 ms | ~10 ms |
| Blacksite · desktop High | 8.4 ms | 18.3 ms | ~10.5 ms |
| Cinder Yard · mobile touch | 7.0 ms | 8.7 ms | 8.6 ms |
| All sites · desktop Low | 5–6.5 ms | unchanged | unchanged (kit and pads don't mount on Low) |

The ~2 ms over baseline on High buys SMAA, the whole refinery kit, two more
practicals, the road blend and the contact pads. Adaptive quality still steps weaker
machines down, and the Low/touch tiers keep the primitive stand-ins.

## Remaining limitations

- Some Blacksite light panels blow out to flat white rectangles at night (visible in the
  showcase scouting); the emissive panels need a softer intensity or a texture.

- Stage D is a detail pass, not a re-layout: Dustline and Blacksite keep their
  geometry; the sand drifts are subtle at gameplay distance.
- Enemy animation set is unchanged (Mixamo locomotion; no new hit-reaction blending).
- The viewmodel hands are posed, not skinned-animated; the reload is staged motion.
- Real-device frame times are still unmeasured (M2 + emulation only).
- `probe-vistas` night captures show the practical-lit areas correctly but SwiftShader
  runs (CI without GPU=1) will look darker than a real GPU's output.
