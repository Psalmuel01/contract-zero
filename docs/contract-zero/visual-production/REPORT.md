# Visual production pass — implementation and review status

Date: 2026-11-12. **Status: initial implementation, not visually accepted.**

The requested acceptance standard requires ordinary gameplay inspection, matched-view
captures, representative hardware measurements and an audible gameplay recording.
Those checks have not been completed. Automated tests cannot establish visual quality.

## Baseline and evidence

- Source revision and original GLB measurements: [baseline.json](baseline.json).
- Existing art direction: [reference pack](../../../artifacts/visual-references/README.md).
- Archived gameplay: [gallery](GALLERY.md). These are historical images, not fresh
  captures at controlled viewpoints. Copies are also in local, git-ignored
  `artifacts/visual-production/before/`.
- Native Brave was available, but its screenshot API returned a uniform grey image.
  Its accessibility tree exposed browser chrome but no game content. Browser tab
  automation was unavailable. No usable new gameplay captures were obtained.
- Previous GPU timings in [PERFORMANCE.md](../PERFORMANCE.md) are historical and must
  not be attributed to this change. Fresh FPS, p95 frame time, draw-pass counts,
  GPU/JS memory and real mobile measurements are **not available** for this pass.

## Audit

| Area | Existing implementation / finding | Change or remaining work |
| --- | --- | --- |
| Weapon | Poly Pizza AR: 1,930 triangles; no detachable magazine | Original 3,380-triangle GLB carbine; six primitives including separate magazine materials |
| Hands | Merged bevelled procedural gloves; hidden in ADS to protect sight picture | Existing geometry retained; support hand follows reload pose. A production skinned hand rig remains outstanding |
| Reload | Simulation and audio present, little visible magazine motion | Presentation-only magazine extraction/insertion and weapon tilt driven by existing reload timing |
| Near-wall gun | Multiplying weapon depth toward zero could push the stock toward/through the eye | Depth bounded by actual weapon length; close-wall pose lowers the muzzle instead |
| Surface scale | LevelArt's helper used normal UV materials on scaled unit boxes | Uses world-space PBR mapping; shader now applies instance transforms and normal correction |
| Ground | Same burned-earth set across all sites, very broad flat apron | Concrete for Blacksite/refinery; world-space earth/concrete weather patches on higher tiers |
| Terrain | Distant silhouette rings and flat connecting disc | Normal-lit, vertex-coloured relief outside bounds plus five-metre safety apron; playable ground remains flat |
| Foreground art | Primitive containers, two-box barriers, crate-like cases/trucks/pumps | Original GLB kit replaces those categories on High/Medium, still instanced |
| Lighting | Existing phase themes, PMREM environment, sun shadows and practicals | Preserved rather than blindly retuned without a live image; full art-directed lighting review remains pending |
| Character animation | Existing Mixamo operator clips and conservative skinned bounds | Retained; close-range intersection/pose review remains pending |
| HUD | Desktop instructions low-contrast over bright skies | Added dark backing and brighter instruction text; comprehensive HUD/tutorial overlap review remains pending |
| Environment life | Existing steam, flare, machinery audio and real line-down/delivery cues | Retained. No invented production activity or economic consequences added |
| Bottlenecks | Prior measurements identify high-DPR post-processing/fill rate, skinned geometry and light count | No new post effects, shadow lights, particles or textures. Current hardware profile remains pending |

## Asset production and budgets

Rebuild originals with `node scripts/build-visual-kit.mjs` from the repository root.
No Blender, downloaded assets, image generation or runtime CSG is needed. The source
keeps model authoring separate from gameplay and emits standard glTF 2.0 PBR GLBs.

| Asset | Bytes | Triangles | Primitives | Licence |
| --- | ---: | ---: | ---: | --- |
| service-carbine.glb | 330,688 | 3,380 | 6 | Original, MIT |
| modular-kit.glb | 401,088 | 4,048 total across five modules | 14 | Original, MIT |

Full per-file provenance: [inventory.json](../../../apps/web/public/models/production/inventory.json)
and [CREDITS.md](../../../apps/web/CREDITS.md). The old rifle stays available for guards.
New model payload totals 731,776 bytes, approximately 715 KiB before HTTP compression.
The kit contains container, jersey barrier, equipment case, truck and pump modules.
It is not yet a complete building/vehicle/industrial production library.

All modules fit a unit envelope and scale to existing collision boxes. Truck wheel
proportions are authored for a typical logistics-truck aspect ratio; unusual collider
aspect ratios still need visual review. Barriers use a real sloping jersey section;
the existing conservative AABB collision remains, including its empty upper corners.

Repeated modules use instancing, with one material group per surface, rather than
one render object per detail. Low retains the original simple representations.
Terrain apron: 10,368 triangles on High/Medium, 1,568 on Low. It remains below the
walkable surface throughout the playable bounds and their five-metre safety apron.
The distant skyline rings are unchanged. No mesh or height changes were made to
colliders, navigation, objectives or server-exported layouts.

The kit is currently loaded even on Low, although Low does not draw it. No additional
texture sets are introduced: ground blending reuses existing URL-cached PBR sets.
The established colour-only path remains. Secondary diffuse/roughness are blended;
normal detail currently follows the primary surface. Low omits the blending shader.
KTX2/Basis texture conversion, authored texture atlases and distance-based module LOD
are not implemented. They should follow measurements, not assumptions about cost.

## Verification performed

- Web TypeScript check passed.
- Full web suite: 75 files / 918 tests passed before the final asset extensions.
- Focused scene suite: 98 tests passed after instanced shader correction.
- Final generated asset bounds/material/load and presentation checks: all five tests
  passed after truck and pump additions, including the corrected wheel envelope.
- GLBs are parsed by Three's GLTFLoader in tests, not merely checked for file existence.
- Ground shader string transformations are tested against Three's standard shader;
  this is **not a GPU shader-compilation test**.
- Production build initially failed resolving Google Fonts; retry with network access
  completed successfully and prerendered all 18 routes.

## Required live review

Use the existing dev-only route `/dev/level` at 1280×720, seed 4, defense 2, assault
rifle, identical camera pose and tier for each comparison. Compare ordinary movement
as well as stills. Use the existing test/probe routes only in development.

| Site | Day | Dusk | Night | Combat/objectives/extraction | Mobile | FPS/memory/video |
| --- | --- | --- | --- | --- | --- | --- |
| Dustline Depot | Pending | Pending | Pending | Pending | Pending | Pending |
| Blacksite | Pending | Pending | Pending | Pending | Pending | Pending |
| Cinder Yard | Pending | Pending | Pending | Pending | Pending | Pending |

Existing commands available for the next review:

```sh
node apps/web/probe-levels.mjs
node apps/web/probe-field.mjs
node apps/web/probe-catwalk.mjs
node apps/web/probe-world-cues.mjs
node apps/web/probe-perf.mjs http://localhost:3000 gpu
node apps/web/probe-site-budgets.mjs
node apps/web/probe-texture-tiers.mjs
node apps/web/probe-auto-stepdown.mjs
node apps/web/probe-audio-combat.mjs
```

Inspect each probe's renderer flags: software-rendered or CPU-throttled results do
not establish real GPU or phone performance. Existing audio meter probes do not
replace listening or a recording with actual game audio. Videos captured by a browser
recorder without loopback audio do not satisfy the brief.

Remaining production work includes a fully authored animated hand rig, the remaining
primary weapon art, complete modular architecture, close-range material finishing,
walkable terrain relief if simulation/server heights are expanded together, lighting
and exposure tuning from real captures, texture compression, and the full review
matrix above. Do not describe this pass as meeting the final acceptance standard yet.
