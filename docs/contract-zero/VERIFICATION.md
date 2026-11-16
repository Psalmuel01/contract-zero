# Testing and recorded evidence

## Provenance

The result counts below were recorded in the README at source revision
`60a29fcf41b519aea46750ecce8f1399e7939136`. This documentation edit did not rerun the application, browser,
contract, or live-chain suites. Unless a linked report gives a date, the original
execution date was not recorded. Treat these as historical results, not a guarantee
about the current deployment. Phone-sized browser checks are not physical-phone tests.

The demo report dated **2026-11-09** records 16 steps and no page errors.
The supply-order evidence records 29 passing checks and transaction hashes; its
filename does not establish an execution date.

## Commands and historical results


| What | Command | Recorded result |
|---|---|---|
| Web unit tests and types | `cd apps/web && npx vitest run && npx tsc --noEmit -p .` | 946 pass |
| Economy and API | `cd apps/api && cargo test --workspace` (add `CZ_DB_TESTS=1` for the database tests) | 114 economy, 65 API |
| Contracts | `cargo test` in `contracts-near/cz-assets` and `cz-world-v2` | 28 and 58 |
| API reliability: concurrent mission events, extraction and death, lock timeouts, dropped connections, NEAR RPC down | `node apps/api/scripts/reliability.mjs` (off-chain API, scratch database) | all pass |
| Accessibility | `node apps/web/probe-a11y.mjs` | WCAG 2.1 A/AA clean on every page |
| Every browser probe group | `node apps/web/probe-all.mjs` | 12/12 |
| The deployed site, desktop and phone | `node apps/web/probe-prod-smoke.mjs` | 52/52 |
| The recorded 16-step demo | `node apps/web/demo-run.mjs` | 16/16, 0 page errors ([report](demo/report-2026-11-09.json)) |
| Field integrity and settlement (testnet, maintainers) | `node scripts/field-e2e.mjs` | 24/24 |
| Supply orders on chain (testnet, maintainers) | `CZ_ADMIN_TOKEN=… node scripts/supply-e2e.mjs` | 29/29 ([evidence](evidence/supply-e2e.json)) |

**Reproduce the core claim** (raid → shortage → autonomous order → NEAR → changed mission): run `scripts/supply-e2e.mjs` or `demo-run.mjs`, check its hashes on [nearblocks](https://testnet.nearblocks.io/address/world2.contract-zero.testnet), and follow the chain in the War Room ("Supply orders and competition"). Demo walkthrough: [DEMO.md](DEMO.md). Radio voices as heard in game: [voice recordings](voice/).

