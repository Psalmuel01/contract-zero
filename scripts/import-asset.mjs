// Bring an outside 3D asset into the game: licence first, then optimise, then budget.
//
//   node scripts/import-asset.mjs <in.glb|in.gltf> --name carbine-m4 --kind weapon \
//        --license CC0-1.0 --source https://… [--author "…"] [--receipt "store order ref"]
//
// The Blender-compatible route: model or buy in any tool, export glTF 2.0 (.glb) from
// Blender (File > Export > glTF 2.0, +Y up, apply modifiers), then run this. It:
//  1. refuses an asset without a licence it recognises (CC-BY needs --author; a bought
//     licence needs --receipt, a reference kept with the inventory, never the receipt);
//  2. cleans and compresses it: dedup, prune, weld, meshopt geometry, textures to WebP
//     at the kind's size cap;
//  3. refuses it if it is still over the kind's triangle or byte budget;
//  4. writes apps/web/public/models/licensed/<name>.glb and records it in the inventory
//     next to it (licence, author, source, sizes), which a test checks every model has.
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, prune, weld, meshopt, textureCompress, getBounds } from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer'
import sharp from 'sharp'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = resolve(ROOT, 'apps/web/public/models/licensed')
const INVENTORY = resolve(OUT_DIR, 'inventory.json')

/** Per kind: triangles, bytes after compression, largest texture side. */
export const BUDGETS = {
  weapon: { triangles: 25_000, bytes: 2_500_000, texture: 2048 },
  hands: { triangles: 20_000, bytes: 2_000_000, texture: 2048 },
  prop: { triangles: 8_000, bytes: 600_000, texture: 1024 },
  building: { triangles: 40_000, bytes: 3_000_000, texture: 2048 },
}
export const LICENSES = {
  'CC0-1.0': { attribution: false },
  'CC-BY-4.0': { attribution: true },
  MIT: { attribution: true },
  'Apache-2.0': { attribution: true },
  // A licence bought from a store (Fab, Sketchfab Store, Synty…): name it, keep a reference.
  purchased: { attribution: false, receipt: true },
}

function args(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1] === undefined || argv[i + 1].startsWith('--') ? true : argv[++i]
    else out._.push(argv[i])
  }
  return out
}

async function main() {
  const a = args(process.argv.slice(2))
  const input = a._[0]
  const kind = BUDGETS[a.kind] ? a.kind : null
  const lic = LICENSES[a.license]
  const fail = (m) => { console.error(`refused: ${m}`); process.exit(1) }
  if (!input || !existsSync(input)) fail('give the exported .glb/.gltf to import')
  if (!a.name || !/^[a-z0-9-]{2,48}$/.test(a.name)) fail('--name must be lowercase-kebab (it becomes the file name)')
  if (!kind) fail(`--kind must be one of ${Object.keys(BUDGETS).join(', ')}`)
  if (!lic) fail(`--license must be one of ${Object.keys(LICENSES).join(', ')}`)
  if (!a.source || !/^https?:\/\//.test(a.source)) fail('--source must be the URL the asset came from')
  if (lic.attribution && !a.author) fail(`${a.license} requires attribution: give --author`)
  if (lic.receipt && !a.receipt) fail('a purchased licence needs --receipt (an order reference; never the receipt itself)')
  if (lic.receipt && !a['license-name']) fail('a purchased licence needs --license-name (e.g. "Fab Standard License")')

  await MeshoptEncoder.ready
  await MeshoptDecoder.ready
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder })
  const doc = await io.read(input)
  const budget = BUDGETS[kind]
  await doc.transform(
    dedup(),
    prune(),
    weld(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [budget.texture, budget.texture] }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  )
  let triangles = 0
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const idx = p.getIndices(), pos = p.getAttribute('POSITION')
    triangles += Math.floor((idx ? idx.getCount() : pos?.getCount() ?? 0) / 3)
  }
  const glb = await io.writeBinary(doc)
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]
  const b = scene ? getBounds(scene) : null
  const size = b ? b.max.map((v, i) => +(v - b.min[i]).toFixed(3)) : null
  console.log(`${a.name}: ${triangles} triangles, ${glb.byteLength} bytes, size ${JSON.stringify(size)} (budget ${budget.triangles} / ${budget.bytes})`)
  if (triangles > budget.triangles) fail(`${triangles} triangles is over the ${kind} budget of ${budget.triangles}: decimate in Blender first`)
  if (glb.byteLength > budget.bytes) fail(`${glb.byteLength} bytes is over the ${kind} budget of ${budget.bytes}`)
  if (a['dry-run']) { console.log('dry run: nothing written'); return }

  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(resolve(OUT_DIR, `${a.name}.glb`), glb)
  const inv = existsSync(INVENTORY) ? JSON.parse(readFileSync(INVENTORY, 'utf8')) : []
  const entry = {
    file: `${a.name}.glb`, kind, bytes: glb.byteLength, triangles, size,
    license: a.license === 'purchased' ? a['license-name'] : a.license,
    ...(a.author ? { author: a.author } : {}), source: a.source,
    ...(a.receipt ? { receipt: a.receipt } : {}), imported: new Date().toISOString().slice(0, 10),
  }
  writeFileSync(INVENTORY, JSON.stringify([...inv.filter((e) => e.file !== entry.file), entry], null, 2) + '\n')
  console.log(`wrote public/models/licensed/${a.name}.glb; recorded in inventory.json. Add it to apps/web/CREDITS.md.`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
