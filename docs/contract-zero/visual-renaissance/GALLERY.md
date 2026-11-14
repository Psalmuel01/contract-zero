# Before / after gallery

Same frame, same camera: `before/` is the baseline commit `aaac72a` served from its own
worktree, `after/` is this branch. Captured by `probe-vistas.mjs` on this machine's GPU
at High (`GPU=1 BASE=... node probe-vistas.mjs <out> <sites> <phases>`), HUD hidden.

Views per site: `start` (the spawn), `entry-back` (looking back at the way in),
`push` (the mid-site advance), `cargo-side` (the objective from its flank),
`ground` (the surface and weapon against it).

| Pair | What to look at |
| --- | --- |
| `cinder-yard-day-start` | Tanks with shell courses, girders and stair towers instead of plain cylinders; the tracked, ragged-edged road laid into the ground; the red-dot carbine. |
| `cinder-yard-day-push` | The processing deck: catwalk treads, column platforms, plate-relief tank paint, contact pads under the racks. |
| `cinder-yard-dusk-cargo-side` | The dusk key swung warm with quieter ambient; enemies holding finished rifles. |
| `cinder-yard-night-push` | Night held readable by the practicals; the flare derrick against the sky. |
| `dustline-depot-day-start` | SMAA on the container edges; the road blend; contact pads under trucks and containers. |
| `blacksite-night-push` | The corridor no longer crushes to black past the fourth lamp. |

Weapon states (hip, ADS, reload, wall-press, Low) are captured by
`probe-viewmodel.mjs`; the Stage A pair sits in `gallery/` from the hero-pass commit.
