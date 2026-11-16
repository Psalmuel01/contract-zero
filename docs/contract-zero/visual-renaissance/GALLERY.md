# Before / after gallery

Same frame, same camera: `before/` is the baseline commit `aaac72a` served from its own
worktree, `after/` is this branch. Captured by `probe-vistas.mjs` on this machine's GPU
at High (`GPU=1 BASE=... node probe-vistas.mjs <out> <sites> <phases>`), HUD hidden.

Views per site: `start` (the spawn), `entry-back` (looking back at the way in),
`push` (the mid-site advance), `cargo-side` (the objective from its flank),
`ground` (the surface and weapon against it).

| Pair | What to look at |
| --- | --- |
| `cinder-yard-day-start` | Tanks with shell courses, girders and stair towers instead of plain cylinders, weathered toward the base so they hold against a bright sky; the tracked, ragged-edged road laid into the ground; the red-dot carbine. |
| `cinder-yard-day-push` | The processing deck: catwalk treads, column platforms on concrete-fireproofed skirts, weathered column shells, contact pads under the racks. |
| `cinder-yard-dusk-cargo-side` | The dusk key swung warm with quieter ambient; enemies holding finished rifles. |
| `cinder-yard-night-push` | Night held readable by the practicals; the flare derrick against the sky. |
| `dustline-depot-day-start` | SMAA on the container edges; the road blend; contact pads under trucks and containers. |
| `blacksite-night-push` | The corridor no longer crushes to black past the fourth lamp. |

Weapon states (hip, ADS, reload, wall-press, Low) are captured by
`probe-viewmodel.mjs`; the Stage A pair sits in `gallery/` from the hero-pass commit.

## Showcase

Composed frames, not like-for-like comparisons. The carbine is rendered on `/dev/carbine`
(the player's own first-person model and finish, in a studio light); the site frames were
picked from a scouted ring of 8 directions at each site's key points, at the hour that
suits it, HUD hidden.

| Frame | What it shows |
| --- | --- |
| `showcase/carbine-three-quarter`, `-side`, `-muzzle`, `-top` | The service carbine: red-dot sight, railed receiver, ribbed magazine, baked edge wear. |
| `showcase/hero-cinder-yard-dusk-tank-farm` | The tank farm at dusk: shell courses, wind girders, stair towers, weathered paint, steam off the rack. |
| `showcase/hero-cinder-yard-dusk-columns` | Fractionation columns framing the plant gate. |
| `showcase/hero-blacksite-night-corridor` | The serviced corridor (cable trays, conduit, floodlights) receding toward the vault. |
| `showcase/hero-blacksite-night-vault` | The B-7 vault facade under its own lights. |
| `showcase/hero-dustline-depot-dusk-towers` | Dustline's watchtower and water tower at dusk. |
| `showcase/hero-dustline-depot-dusk-warehouse` | The munitions warehouse and long dusk shadows. |
