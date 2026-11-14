# Visual and technical audit (2026-11-14)

The baseline for this pass is commit `aaac72a` (main after the living-world and
visual-production passes). It was served from a separate worktree on its own port and
captured with the game's own probes on this machine's GPU (Apple M2, headless Chrome,
1280×720, High): `probe-vistas.mjs` for 3 sites × 3 hours × 5 fixed views, and
`probe-viewmodel.mjs` for the weapon states. The matched "after" set is captured the
same way from the working build, so every pair in [GALLERY.md](GALLERY.md) is the
same frame.

## Where things live

| Concern | Code |
| --- | --- |
| Level geometry, colliders, named points | `engine/fps/levels.ts`, `cinderYard.ts`, `decks.ts`, `nav.ts` |
| Level art (every collider drawn as a thing; instanced) | `engine/scene/LevelArt.tsx` |
| Site layer: sky, terrain ring, landmarks, signs, wear, air | `engine/scene/SiteDressing.tsx`, `siteLook.ts`, `siteTextures.ts`, `terrainRelief.ts` |
| Ground material (triplanar, two-surface blend) | `engine/scene/siteGround.ts`, `triplanar.ts`, `usePbr.ts` |
| Hour and site grading, lights, fog, post | `engine/fps/campaign.ts` (ZONE_THEMES), `siteLook.ts` (gradeTheme), `ContractZeroScene.tsx` (render block) |
| Image-based lighting | `engine/scene/zoneEnvironment.ts` |
| Weapon models and finish | `scripts/build-visual-kit.mjs`, `engine/scene/gunModels.ts`, `proceduralGuns.ts`, `weaponFinish.ts` |
| Hands, poses, weapon motion | `engine/scene/viewmodelHands.ts`, `viewmodelPose.ts`, the viewmodel block of `ContractZeroScene.tsx` |
| Enemies | `engine/scene/OperatorRig.tsx` (Mixamo rig), `rifle.ts` |
| Impacts, muzzle, casings | `engine/vfx/ImpactFX.ts`, `ShellCasings.ts` |
| Quality tiers and adaptive quality | `lib/settings.ts` (renderPlan), `engine/perf/autoQuality.ts` |
| Production-line state → visuals | `engine/fps/lineProps.ts`, `LevelArt.tsx` (FlareStack, Steam, OfflineMarker) |

## The ten most damaging problems, ranked by their effect on play

1. **No filmic curve on the High and Medium tiers.** The renderer's tone mapping only
   applies when it draws to the canvas. Under the post-processing composer the final
   pass is not tone mapped, so those tiers showed raw linear light clipped to white,
   and the night-vision exposure lift did nothing. Measured: changing the curve or the
   exposure altered the frame only with post-processing off. Every other lighting
   decision was tuned against the wrong image.
2. **Flat lighting.** Ambient, hemisphere, fill and the environment map together
   outweigh the sun, there is no ambient occlusion on structured levels, and nothing
   sits on the ground. Shadows are the only depth cue, and day scenes read as a
   render preview.
3. **Night is unreadable where the fight happens.** Four point lights per level, so a
   vault or a corridor past the first four is black; lamps are emissive panels that
   light nothing. Blacksite's vault and the Cinder Yard deck at night crush to black.
4. **The weapon.** A flat-coloured, UV-less model with no sight, held by block hands
   that vanish when aimed; a sphere for a muzzle flash, no casings, no look lag, a
   token kick. The thing on screen all the time looked least finished.
5. **Architecture is boxes and cylinders.** Tanks, columns, pipe racks, warehouses and
   interiors are plain scaled primitives with a tiling texture. Nothing has a
   silhouette past 10 m, and the refinery reads as "cylinders on a plane".
6. **The ground.** One flat plane; the road is a raised slab with a hard edge; a
   handful of wear quads. It tiles, and it carries no story of use.
7. **No anti-aliasing at all.** `antialias: false` and `multisampling={0}` on the
   composer, so every rail, fence wire and roof edge crawls, and the whole image reads
   as lower resolution than it is.
8. **Effects ignore the world.** Rain falls inside the Blacksite; steam is a handful
   of sprites; the flare is a cone.
9. **Enemies read as plastic.** The rig is fine; its materials are brightened 1.7× for
   visibility and carry the old rifle model.
10. **HUD legibility.** Key readouts at 10 to 12 px, and a persistent three-line control
    sheet in the top right during the fight.

## Baseline measurements (from the base-commit server)

Draw calls and triangles at the start view (`probe-vistas`, High):

| Site | Day | Dusk | Night |
| --- | --- | --- | --- |
| Dustline Depot | 253 calls, 300k tris | 271 calls | — |
| Blacksite | — | — | 274 calls, 273k tris |
| Cinder Yard | 266 calls, 210k tris | 283 calls | — |

Frame-time baselines are taken with `probe-site-perf.mjs` and recorded in
[REPORT.md](REPORT.md) next to the after numbers.

## Order of work

Stage A (first-person), then B (rendering foundation: tone mapping, anti-aliasing,
shadows, lighting re-grade, ground), then C (Cinder Yard), D (Dustline, Blacksite),
E (combat presentation and HUD), F (integration and performance). Each stage is its
own commit.
