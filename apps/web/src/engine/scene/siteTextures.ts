/**
 * Canvas-painted textures for the sites: banner signs, stencilled words, the holder's
 * insignia sprayed on a wall, hazard stripes and ground wear. Drawn once per site
 * load, small, and weathered with seeded noise so two marks never look stamped.
 */

import * as THREE from 'three'
import { paintInsignia } from '@/lib/insignia'

/** Seeded PRNG (mulberry32): the same site always weathers the same way. */
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FONT = '"Rajdhani", "Barlow Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif'

function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  return { c, g: c.getContext('2d')! }
}

function texture(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c)
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  t.needsUpdate = true
  return t
}

/** Knock paint off: speckles and a few drips, cut out of what is already drawn. */
function weather(g: CanvasRenderingContext2D, w: number, h: number, r: () => number, amount = 1) {
  g.save()
  g.globalCompositeOperation = 'destination-out'
  for (let i = 0; i < 260 * amount; i++) {
    g.globalAlpha = 0.25 + r() * 0.6
    const s = 0.6 + r() * r() * 5
    g.fillRect(r() * w, r() * h, s, s * (0.5 + r()))
  }
  for (let i = 0; i < 10 * amount; i++) {
    g.globalAlpha = 0.18
    const x = r() * w
    g.fillRect(x, r() * h * 0.5, 1 + r() * 2, h * (0.2 + r() * 0.5))
  }
  g.restore()
}

/** Grime laid over the top (for boards): soft dark blotches toward the bottom. */
function grime(g: CanvasRenderingContext2D, w: number, h: number, r: () => number) {
  g.save()
  for (let i = 0; i < 10; i++) {
    const x = r() * w, y = h * (0.4 + r() * 0.6), rad = h * (0.1 + r() * 0.4)
    const grd = g.createRadialGradient(x, y, 0, x, y, rad)
    grd.addColorStop(0, 'rgba(30,24,18,0.09)'); grd.addColorStop(1, 'rgba(30,24,18,0)')
    g.fillStyle = grd
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2)
  }
  g.restore()
}

/** A banner sign: a painted board with the holder's mark, a title and a line under it. */
export function bannerTexture(o: { title: string; line: string; color: string; holder: string | null; holderColor: string; aspect: number; seed: number }): THREE.CanvasTexture {
  const H = 160, W = Math.round(H * o.aspect)
  const { c, g } = canvas(Math.min(W, 2048), H)
  const w = c.width
  const r = rng(o.seed)
  g.fillStyle = o.color
  g.fillRect(0, 0, w, H)
  // a darker border band and rivets, so it reads as a fabricated board
  g.strokeStyle = 'rgba(20,18,14,0.85)'; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, H - 8)
  g.fillStyle = 'rgba(20,18,14,0.7)'
  for (const x of [16, w - 16]) for (const y of [16, H - 16]) { g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill() }
  const small = w < 400
  const mark = small ? 0 : H * 0.72
  if (mark) {
    g.fillStyle = 'rgba(16,15,13,0.92)'
    g.fillRect(14, (H - mark) / 2 - 2, mark + 8, mark + 4)
    paintInsignia(g, o.holder, 18, (H - mark) / 2, mark, o.holderColor, 1.4)
  }
  const left = mark ? mark + 40 : 0
  const span = w - left - 24
  g.fillStyle = '#16140f'
  g.textBaseline = 'alphabetic'
  g.textAlign = small ? 'center' : 'left'
  let size = small ? 64 : 76
  g.font = `700 ${size}px ${FONT}`
  while (g.measureText(o.title).width > span && size > 20) { size -= 2; g.font = `700 ${size}px ${FONT}` }
  const x = small ? w / 2 : left
  g.fillText(o.title, x, H * (small ? 0.56 : 0.52))
  let ls = small ? 22 : 28
  g.font = `600 ${ls}px ${FONT}`
  while (g.measureText(o.line).width > span && ls > 10) { ls -= 1; g.font = `600 ${ls}px ${FONT}` }
  g.fillText(o.line, x, H * (small ? 0.82 : 0.84))
  grime(g, w, H, r)
  weather(g, w, H, r, 0.6)
  // weathering cut through to transparent: refill under it with bare metal
  g.save(); g.globalCompositeOperation = 'destination-over'; g.fillStyle = '#5b5850'; g.fillRect(0, 0, w, H); g.restore()
  return texture(c)
}

/** Stencilled words sprayed on a wall: transparent around the paint. */
export function stencilTexture(text: string, aspect: number, color: string, seed: number): THREE.CanvasTexture {
  const H = 128, W = Math.min(2048, Math.round(H * aspect))
  const { c, g } = canvas(W, H)
  const r = rng(seed)
  g.fillStyle = color
  g.textAlign = 'center'; g.textBaseline = 'middle'
  let size = H * 0.86
  g.font = `700 ${size}px ${FONT}`
  while (g.measureText(text).width > W * 0.96 && size > 12) { size -= 2; g.font = `700 ${size}px ${FONT}` }
  g.globalAlpha = 0.88
  g.fillText(text, W / 2, H / 2 + 4)
  // stencil bridges: thin vertical breaks through the letters, like a cut template
  g.globalCompositeOperation = 'destination-out'
  g.globalAlpha = 1
  for (let x = 6 + r() * 10; x < W; x += size * (0.42 + r() * 0.2)) g.fillRect(x, 0, Math.max(2, size * 0.05), H)
  g.globalCompositeOperation = 'source-over'
  weather(g, W, H, r, 1.2)
  return texture(c)
}

/** The holder's insignia sprayed on a wall. */
export function insigniaTexture(holder: string | null, color: string, seed: number): THREE.CanvasTexture {
  const S = 256
  const { c, g } = canvas(S, S)
  const r = rng(seed)
  g.globalAlpha = 0.9
  paintInsignia(g, holder, S * 0.06, S * 0.06, S * 0.88, color, 1.8)
  // overspray: a faint halo of the same paint
  g.globalAlpha = 0.08
  paintInsignia(g, holder, S * 0.05, S * 0.05, S * 0.9, color, 3.2)
  g.globalAlpha = 1
  weather(g, S, S, r, 1.1)
  return texture(c)
}

/** Diagonal hazard stripes, yellow and black, scuffed. */
export function hazardTexture(aspect: number, seed: number): THREE.CanvasTexture {
  const H = 64, W = Math.min(2048, Math.round(H * aspect))
  const { c, g } = canvas(W, H)
  const r = rng(seed)
  g.fillStyle = '#d4a514'; g.fillRect(0, 0, W, H)
  g.fillStyle = '#16140f'
  for (let x = -H; x < W + H; x += 48) { g.beginPath(); g.moveTo(x, H); g.lineTo(x + 24, H); g.lineTo(x + 24 + H, 0); g.lineTo(x + H, 0); g.closePath(); g.fill() }
  weather(g, W, H, r, 1.4)
  return texture(c)
}

/** Ground wear: soft blotches, tyre tracks, drifts, puddles and cracks. Alpha-masked. */
export function wearTexture(kind: 'oil' | 'tracks' | 'sand' | 'puddle' | 'soot' | 'crack', seed: number): THREE.CanvasTexture {
  const S = 128
  const { c, g } = canvas(S, kind === 'tracks' ? S * 4 : S)
  const H = c.height
  const r = rng(seed)
  const blot = (rgb: string, n: number, alpha: number) => {
    for (let i = 0; i < n; i++) {
      const x = S * (0.3 + r() * 0.4), y = H * (0.3 + r() * 0.4), rad = S * (0.12 + r() * 0.28)
      const grd = g.createRadialGradient(x, y, 0, x, y, rad)
      grd.addColorStop(0, `rgba(${rgb},${alpha})`); grd.addColorStop(1, `rgba(${rgb},0)`)
      g.fillStyle = grd; g.fillRect(0, 0, S, H)
    }
  }
  if (kind === 'oil') blot('14,12,10', 7, 0.55)
  else if (kind === 'soot') blot('8,7,6', 9, 0.6)
  else if (kind === 'sand') blot('214,190,150', 8, 0.5)
  else if (kind === 'puddle') { blot('12,16,20', 6, 0.9) }
  else if (kind === 'tracks') {
    for (const x of [S * 0.22, S * 0.78]) {
      g.fillStyle = 'rgba(20,16,12,0.42)'
      g.fillRect(x - 10, 0, 20, H)
      g.fillStyle = 'rgba(20,16,12,0.25)'
      for (let y = 0; y < H; y += 9) g.fillRect(x - 10, y, 20, 3)
    }
    // fade the ends so a track never stops at a hard edge
    g.globalCompositeOperation = 'destination-in'
    const grd = g.createLinearGradient(0, 0, 0, H)
    grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(0.15, 'rgba(0,0,0,1)'); grd.addColorStop(0.85, 'rgba(0,0,0,1)'); grd.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = grd; g.fillRect(0, 0, S, H)
    g.globalCompositeOperation = 'source-over'
  } else if (kind === 'crack') {
    g.strokeStyle = 'rgba(12,12,12,0.7)'
    for (let k = 0; k < 3; k++) {
      g.lineWidth = 1 + r() * 1.5
      g.beginPath()
      let x = S * r(), y = S * r()
      g.moveTo(x, y)
      for (let i = 0; i < 9; i++) { x += (r() - 0.5) * 30; y += (r() - 0.5) * 30; g.lineTo(x, y) }
      g.stroke()
    }
  }
  if (kind !== 'tracks' && kind !== 'crack') weather(g, S, H, r, 0.5)
  return texture(c)
}

/** A soft round puff, for smoke, steam and mist. */
export function puffTexture(): THREE.CanvasTexture {
  const { c, g } = canvas(128, 128)
  const r = rng(7)
  for (let i = 0; i < 14; i++) {
    const x = 64 + (r() - 0.5) * 50, y = 64 + (r() - 0.5) * 50, rad = 22 + r() * 30
    const grd = g.createRadialGradient(x, y, 0, x, y, rad)
    grd.addColorStop(0, 'rgba(255,255,255,0.32)'); grd.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128)
  }
  return texture(c, false)
}
