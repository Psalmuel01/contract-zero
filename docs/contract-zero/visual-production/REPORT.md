# Visual production pass: report

Date: 2026-11-13. **Status: the biggest weaknesses are fixed and measured; the acceptance
standard is not met.** The sites read as cleaner and more coherent than before, and the
weapon is a real carbine held like one. They do not yet read as production art.
The limits are at the end.

All captures are from the running game (`/dev/level`, seed 4, defense 2, assault
rifle, 1280×720, High). They were rendered on this machine's GPU (Apple M2) in headless Chrome.
The "before" build is the previous commit, `92be973`, served from a separate worktree on
another port. Both builds share fixed camera positions and hours, so every pair is the
same frame. See [GALLERY.md](GALLERY.md).

## How this pass started

A first attempt at this brief was staged on the branch without any captures (its notes
said the browser returned blank screenshots). Once rendered, several of its changes had
made things **worse** than before:

| Defect found in the staged attempt | Cause | Fix |
| --- | --- | --- |
| Jersey barriers glowed white at every hour, night included | Kit modules kept flat glTF colours; pale "cast concrete" under the sun and the environment light | Kit surfaces are dressed with the site's own textured materials (`KIT_SURFACE` in `LevelArt.tsx`) |
| Blacksite: a flat teal ramp buried the base of the perimeter wall | Terrain relief started rising 5 m outside the bounds; the perimeter wall stands 15 m out | Relief starts 20 m out (`RELIEF_FROM`), tested to 18 m |
| A pale, nearly white band between the yard and the hills (Dustline) | The apron used the floor *tint* (made to multiply a dark texture) as a plain colour | Apron colour taken to the texture's brightness, then into the haze |
| Walls became a camouflage pattern (Cinder Yard, Blacksite's hall) | World-scaled textures at 1.5 m tiled the damaged-plaster photo (cream with brick through it) and the corrugated sheet's rust patches | Interior walls use the concrete render; corrugated cladding keeps its relief under a flat paint; plate and sheet at their real 2.4 to 2.8 m |
| The rifle: a large grey slab filling the corner | A boxy model, and a depth rule that held the whole weapon, stock included, in front of the eye | A new carbine (below); the stock may pass the eye at the hip, the grip may not |
| Draw calls over the 270 budget (Cinder Yard night 272 at the start view) | One draw per glTF material per module, doubled by shadows | Kit surfaces merged per site material, kept to one or two per module; small cases cast no shadow |

The staged attempt's other changes were sound and are kept:
- world-space mapping of the level-art boxes, with the instanced-normal correction;
- the reload's magazine drop;
- the wall-lowering pose;
- the backed control help panel.

## What changed

### First-person weapon

- **A new service carbine** (`scripts/build-visual-kit.mjs`, original, MIT). Its parts are built from side profiles extruded to their width with chamfered edges:
  - upper and lower receivers, with the magwell flare and trigger guard;
  - a raked pistol grip;
  - a curved magazine;
  - an adjustable stock.

  Lathed (turned) parts:
  - the barrel;
  - the slotted muzzle device;
  - the buffer tube.

  It also has a rounded, slotted handguard and a continuous top rail, with iron sights folded low. It is 4,932 triangles and 256 KB, against the staged model's 3,380 triangles and 331 KB; indexed geometry and no UVs make the difference. The magazine and stock are named parts.
- **Framing at the hip:** the carbine sits back, so the stock leaves through the bottom corner and the receiver and handguard carry the frame.
- **Aimed:** the carbine is shouldered on the centre line, with the top rail 2.7 cm under the eye. You look along the rail to the front sight, and the stock (under your cheek) is hidden, as the hands already were. Before, it swung to 10 cm right of the eye and you looked at its flank.
- **Against a wall:** it lowers, and never passes through (checked).
- **Unchanged:** fire rate, damage, reload time, inventory, ownership. Everything above is presentation.

### Environment

- **Roads:** these were an untextured dark slab, the largest surface at two site gates. They now use CC0 asphalt (`asphalt_02`, Poly Haven, credited), recompressed to 1.3 MB for the set.
- **Kit modules** (container, barrier, case, truck, pump):
  - they take the site's textured materials, tinted by site and hour;
  - container ribs are plain boxes;
  - the kit went from 4,048 triangles and 401 KB to 2,912 triangles and 142 KB.
- **Terrain relief:** it begins beyond the perimeter wall, on a coarser grid (4.6k triangles rather than 10k), coloured to meet the yard.
- **Paved yards** (Blacksite, Cinder Yard): stronger large-scale variation, so the slab no longer reads as one flat sheet past 10 m.
- **Texture scale:** each texture sits at its real size; the camouflage tiling is gone.

### Interface

- **Mouse-capture hint:** it shows until the first keypress. It no longer sits across the crosshair: it moved below the centre, with a darker backing and brighter text.

### Also fixed in this session

- **Stairs** (committed separately as `927a505`): you were lifted onto the Cinder Yard catwalk by walking under it, or into the stair's side. The floor now only steps up what you can reach. The catwalk probe walks both cases.

## Measurements

### Render load at the start view (`probe-site-budgets`, ceiling 270 calls / 140k triangles)

| Site | Before, day / night | After, day / night |
| --- | --- | --- |
| Dustline Depot | 176 / 193 calls, 37k tris | 190 / 207 calls, 75k tris |
| Blacksite | 200 / 216 calls, 103 to 114k tris | 211 / 230 calls, 117 to 122k tris |
| Cinder Yard | 239 / 256 calls, 59k tris | 252 / **269** calls, 78k tris |

All six pass. **Cinder Yard at night sits 1 call under the ceiling**, so any new surface there must pay for itself.

Looking down at the ground (the vistas' worst case), the counts run higher in both builds:
- **Before:** 239 to 269.
- **After:** 255 to 284.

The extra triangles are the kit's real shapes and the terrain apron.

### Frame time on this machine's GPU (`GPU=1 probe-site-perf`, uncapped, 6 to 8 s per sample)

Median frame time, ms, before → after:

| Site | High, day | High, night | Low, day | Touch tier, day |
| --- | --- | --- | --- | --- |
| Dustline Depot | 6.5 → 6.8 | 6.7–7.5 → 7.5–8.8 | 3.4 → 4.0 | 5.1 → 5.9 |
| Blacksite | 8.0 → 8.5 | 8.1–11.5 → 8.4–10.0 | 4.9 → 5.1 | 6.6 → 6.7 |
| Cinder Yard | 8.8 → 8.2 | 8.0–10.0 → 8.7–12.0 | 6.2 → 5.6 | 7.5 → 7.1 |

**Medians move by under a millisecond.**

**The 95th-percentile frame at night on High is noisy in both builds:**
- **Before:** 12.6 to 28 ms.
- **After:** 17.6 to 30 ms.

Over repeated runs, Dustline's night tail looks about 5 ms worse after (21 to 24 ms against 13 to 18 ms). The other sites overlap.

**JS heap is 140 to 190 MB in both builds.** GPU textures rise by 3 to 4 (the asphalt). The full-tier texture budget test passes with it counted.

**This is an M2 Mac. It is not a phone or a low-end laptop.** The touch tier was emulated (a phone viewport and touch input), not run on a device.

### Weapon states (`probe-viewmodel.mjs`)

These were checked by eye on all three sites:
- at the hip;
- aimed;
- reload, magazine out;
- reload, magazine in;
- nose to a wall;
- Low tier;
- phone.

No clipping into the wall was seen, and the aimed view is clear of the stock and hands.

### Gameplay and collision

Nothing that collides moved: colliders, navigation, objectives and server layouts are unchanged. Relief and props are outside the bounds or on the existing collider boxes.

- **Tests:** 923 web unit tests pass, including:
  - the deck/stair cases;
  - terrain flat to 18 m;
  - kit envelopes;
  - the texture budget.
- **`probe-catwalk`:** 9 of 9.
- **`probe-auto-stepdown`:** passes (the level stays spread after Auto drops a tier).
- **The recording below** plays a whole raid: contact, loading three cases, the extraction call, extraction.

### Recording with the game's audio

`apps/web/demo-out/contract-zero-visual-pass.mp4` (git-ignored; regenerate with `SEG=3 node apps/web/probe-record-demo.mjs <dir>`):
- **Content:** a 43 s Cinder Yard raid at dusk, with arrival, contact, the push, three cases loaded and extraction.
- **Audio:** the final mix, −19.5 LUFS, true peak −4.2 dBFS.
- **Not played by a person:** the raid is scripted, as before.

The previous recording (`contract-zero-living-world.mp4`, pass 2) shows the same raid with the old rifle, the untextured road and the pre-pass props.

## Asset inventory

| Asset | Bytes | Triangles | Licence |
| --- | ---: | ---: | --- |
| `models/production/service-carbine.glb` | 256,116 | 4,932 | Original, MIT |
| `models/production/modular-kit.glb` | 142,104 | 2,912 (container 844, barrier 28, case 396, truck 1,224, pump 420) | Original, MIT |
| `textures/hangar/asphalt_02_{diff,nor_gl,rough}_1k.jpg` | 1,301,935 | n/a | CC0, Poly Haven (Rob Tuytel) |

Generated details: [inventory.json](../../../apps/web/public/models/production/inventory.json). Provenance: [CREDITS.md](../../../apps/web/CREDITS.md). Rebuild the models with `node scripts/build-visual-kit.mjs`.

## Remaining limits (what this pass did not achieve)

- **Not production art.** The kit is five modules. Buildings, the refinery's plant and the Blacksite hall are still the original boxes with better surfaces, and the hall interior is a bare concrete box. "Facilities that feel constructed for a real purpose" needs authored architecture, which this pass did not attempt.
- **The playable ground is flat.** Relief is only beyond the wall. Walkable relief needs the simulation, navigation and server to learn the same heights.
- **Hands are the existing procedural gloves.** There is no skinned, animated hand rig. The reload is presentation curves, not an animation.
- **On the bench, the carbine's stock looks heavy.** It is hidden when aimed and off-screen at the hip, but it shows in third person and on the bench.
- **Lighting was not re-art-directed.** Day, dusk and night are the existing themes and grades from pass 2. No ambient occlusion was added.
- **No real phone or low-end GPU was measured.** The numbers above are one M2 Mac.
- **No KTX2/Basis texture compression and no distance LOD.** The draw-call budget, not triangle count, is the binding limit, and Cinder Yard at night is at it.
- **Night p95 on High is noisy, and Dustline's looks ~5 ms worse.** Not diagnosed.
- **The recording is scripted, not played.**
