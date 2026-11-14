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

## Stage E (partial): enemies and the HUD

- Enemy rifles get the same `finishWeapon` surface pass as the player's weapons.
- The enemy visibility lift retuned 1.7 → 1.35 (tuned against the old flat grade, it
  read as plastic under the new key light), roughness up.
- The in-fight control sheet fades out 26 s into a run (the pause menu and Field
  Manual carry the bindings); its type up from 11 to 12 px while it shows.

## Performance (GPU, 720p, day, 6 s medians)

| Site · tier | Baseline | Unmeasured branch state | Now |
| --- | --- | --- | --- |
| Cinder Yard · desktop High | 7.9 ms · 252 draws | 20.0 ms · 534 draws | **10.2 ms · 286 draws** |
| Dustline · desktop High | 6.9 ms | 15.1 ms | ~10 ms |
| Blacksite · desktop High | 8.4 ms | 18.3 ms | ~10.5 ms |
| Cinder Yard · mobile touch | 7.0 ms | 8.7 ms | 8.6 ms |
| All sites · desktop Low | 5–6.5 ms | unchanged | unchanged (kit and pads don't mount on Low) |

The ~2 ms over baseline on High buys SMAA, the whole refinery kit, two more
practicals, the road blend and the contact pads. Adaptive quality still steps weaker
machines down, and the Low/touch tiers keep the primitive stand-ins.

## Remaining limitations

- Dustline and Blacksite have not had their Stage D identity pass on this branch
  (they keep the earlier environment work plus the foundation improvements here).
- Enemy animation set is unchanged (Mixamo locomotion; no new hit-reaction blending).
- The viewmodel hands are posed, not skinned-animated; the reload is staged motion.
- Real-device frame times are still unmeasured (M2 + emulation only).
- `probe-vistas` night captures show the practical-lit areas correctly but SwiftShader
  runs (CI without GPU=1) will look darker than a real GPU's output.
