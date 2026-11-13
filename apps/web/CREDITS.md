# Asset credits

Every file the web app ships under `public/`, where it came from, and its licence. The full audit (including code dependencies) is in `docs/contract-zero/LICENSING.md`.

## Textures

- **Zone PBR textures** (`public/textures/dustline/`): [Poly Haven](https://polyhaven.com), **CC0**. Per-map sources are in that folder's README.
- **Hangar PBR textures** (`public/textures/hangar/`): `concrete_floor_worn_001`, `corrugated_iron_02`, `metal_plate` and `asphalt_02` (Rob Tuytel; roads) from [Poly Haven](https://polyhaven.com), **CC0**.
- **Impact VFX sprites** (`public/textures/vfx/`): [Kenney Particle Pack](https://kenney.nl/assets/particle-pack), **CC0**. Sources are in that folder's README.

## Weapons

- **Rifle** (`public/models/guns/rifle.glb`) and **sci-fi blaster** (`blaster.glb`): [Poly Pizza](https://poly.pizza), **CC0**.
- **Sidearm, SMG and Marksman rifle**: original procedural models, built in code (`src/engine/scene/proceduralGuns.ts`). They replaced three GLB files whose source could not be confirmed.
- **The five seasonal weapons**: original procedural models, same file.

## Production models

- `public/models/production/service-carbine.glb`: original CONTRACT ZERO service carbine, **MIT**, authored and baked by `scripts/build-visual-kit.mjs`. Replaces the Poly Pizza rifle in the player viewmodel; the old rifle remains for the existing world/guard pipeline.
- `public/models/production/modular-kit.glb`: original reusable container, jersey-barrier, equipment-case, logistics-truck and pump-skid modules, **MIT**, same authoring source. No external model inputs or textures. Dimensions use a unit envelope mapped to the existing colliders.
- `public/models/production/inventory.json`: generated sizes, triangle counts and provenance. Rerun the script to regenerate all three files. GLBs use standard glTF 2.0 metallic/roughness materials. They have no texture payload; this pass reuses the existing JPEG PBR maps. KTX2/Basis conversion is not implemented.

## Characters

- **Operator rig** (`public/characters/glb/operator.glb`): a skinned body with rifle animation clips from Adobe [Mixamo](https://www.mixamo.com), assembled by `scripts/build_operator_glb.py`.
  - Mixamo characters and animations may be used in games under Adobe's terms.
  - The raw `.fbx` downloads are not redistributed: they live in the git-ignored `apps/web/assets-src/` and are never served.

## Sound

- **Gunshots and the wall impact** (`public/sounds/fps/*`, four files): original, synthesised by `scripts/generate-sfx.mjs` (deterministic; rerun it to rebuild them). They replaced samples whose source could not be confirmed.
- **Everything else** (reloads, hit markers, footsteps, radio static, ambience, alarms, explosions, refinery machinery, the sounds of each site, near-miss, ricochets, extraction cues, the score): synthesised at runtime with the Web Audio API in `src/engine/audio/` (`FpsAudio.ts`, `soundscape*.ts`, `MusicLayers.ts`). No files.
- **A test keeps this honest:** `src/lib/__tests__/audioLicensing.test.ts` fails if an undeclared audio file, a recorded voice or music file, or an outside audio URL appears.
- **Voice:** the game ships no recorded voice. Radio lines are subtitles over synthesised static.

## Fonts

- **Rajdhani**, **Barlow** and **Cinzel**: Google Fonts, **SIL Open Font License 1.1**. Self-hosted at build time by `next/font`.

## Removed

- `public/sounds/combat/*.mp3` (melee sounds from the earlier codebase, source unknown, unused) were deleted.
