import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

// Every 3D model the game ships has a known source and licence: generated here (the
// production inventory), imported through scripts/import-asset.mjs (the licensed
// inventory, with its licence and source), or named in CREDITS.md.
const WEB = resolve(__dirname, '../../..')
const PUBLIC = join(WEB, 'public')
const credits = readFileSync(join(WEB, 'CREDITS.md'), 'utf8')
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p] })
const models = walk(PUBLIC).filter((f) => /\.(glb|gltf)$/i.test(f)).map((f) => relative(PUBLIC, f))
const inventory = (dir: string) => { const p = join(PUBLIC, dir, 'inventory.json'); return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Record<string, string>[]) : [] }

describe('3D model licensing', () => {
  it('every shipped model has a recorded source and licence', () => {
    expect(models.length).toBeGreaterThan(0)
    for (const m of models) {
      const dir = m.split('/').slice(0, -1).join('/'), file = m.split('/').pop()!
      const listed = inventory(dir).find((e) => e.file === file)
      expect(!!listed || credits.includes(m) || credits.includes(file), `${m} has no inventory entry and is not in CREDITS.md`).toBe(true)
    }
  })

  it('an imported model carries what its licence requires', () => {
    for (const e of inventory('models/licensed')) {
      expect(e.license, e.file).toBeTruthy()
      expect(e.source, e.file).toMatch(/^https?:\/\//)
      if (e.license !== 'CC0-1.0') expect(e.author ?? e.receipt, `${e.file}: attribution or a purchase reference`).toBeTruthy()
      expect(credits, `${e.file} must be credited`).toContain(e.file)
    }
  })
})
