// The four powers' insignia as data: one definition drawn by the SVG component in
// the interface and painted onto canvas textures in the 3D sites (signs, walls,
// tanks), so a mark on a Cinder Yard tank is the same mark as on the War Table.
// Coordinates are in a 48x48 box. Original artwork; see components/ui/FactionInsignia.

export type InsigniaPart =
  | { kind: 'path'; d: string; width?: number; fill?: number; dash?: [number, number] }
  | { kind: 'dot'; cx: number; cy: number; r: number }
  | { kind: 'ring'; cx: number; cy: number; r: number; width?: number }

export const INSIGNIA_IDS = ['vanguard', 'ashen', 'vex', 'halcyon'] as const
export type InsigniaId = (typeof INSIGNIA_IDS)[number]

export const INSIGNIA: Record<InsigniaId | 'none', InsigniaPart[]> = {
  // a shield stencilled with three rising chevrons and a bar: ordered, professional
  vanguard: [
    { kind: 'path', d: 'M24 3l17 6v14c0 10-7 18-17 22C14 41 7 33 7 23V9z' },
    { kind: 'path', d: 'M14 22l10-7 10 7M14 29l10-7 10 7' },
    { kind: 'path', d: 'M17 35h14', width: 3 },
  ],
  // a weld-plate: bolted corners and a jagged slash of flame through it, improvised and hard-used
  ashen: [
    { kind: 'path', d: 'M8 8h32v32H8z' },
    { kind: 'dot', cx: 13, cy: 13, r: 1.6 }, { kind: 'dot', cx: 35, cy: 13, r: 1.6 },
    { kind: 'dot', cx: 13, cy: 35, r: 1.6 }, { kind: 'dot', cx: 35, cy: 35, r: 1.6 },
    { kind: 'path', d: 'M30 10l-9 12h6l-8 16 14-17h-7z', fill: 0.22 },
  ],
  // a ticket stub with notched sides, a chalked V and a tally: informal wartime trade
  vex: [
    { kind: 'path', d: 'M6 14h36v7a3 3 0 0 0 0 6v7H6v-7a3 3 0 0 0 0-6z' },
    { kind: 'path', d: 'M16 19l5 10 5-10', width: 2.6 },
    { kind: 'path', d: 'M32 19v10M35 19v10M38 19v10M31 28l9-8', width: 1.5 },
  ],
  // a thin hexagon ring over a pallet line and a single node: polished procurement
  halcyon: [
    { kind: 'path', d: 'M24 4l17 10v20L24 44 7 34V14z', width: 1.6 },
    { kind: 'path', d: 'M14 27h20M14 31h20', width: 1.6 },
    { kind: 'ring', cx: 24, cy: 19, r: 3.2 },
  ],
  // an unknown faction gets a neutral blank plate rather than a borrowed mark
  none: [
    { kind: 'path', d: 'M9 9h30v30H9z', dash: [4, 3] },
    { kind: 'path', d: 'M18 24h12' },
  ],
}

export function insigniaFor(id: string | null | undefined): InsigniaPart[] {
  return (INSIGNIA_IDS as readonly string[]).includes(id ?? '') ? INSIGNIA[id as InsigniaId] : INSIGNIA.none
}

/** Paint an insignia onto a canvas: `size` px square at (x, y), stroked in `color`. */
export function paintInsignia(g: CanvasRenderingContext2D, id: string | null | undefined, x: number, y: number, size: number, color: string, lineScale = 1) {
  const k = size / 48
  g.save()
  g.translate(x, y)
  g.scale(k, k)
  g.strokeStyle = color
  g.fillStyle = color
  g.lineCap = 'square'
  g.lineJoin = 'miter'
  for (const p of insigniaFor(id)) {
    if (p.kind === 'dot') { g.beginPath(); g.arc(p.cx, p.cy, p.r, 0, Math.PI * 2); g.fill(); continue }
    g.lineWidth = (p.width ?? 2) * lineScale
    if (p.kind === 'ring') { g.beginPath(); g.arc(p.cx, p.cy, p.r, 0, Math.PI * 2); g.stroke(); continue }
    const path = new Path2D(p.d)
    g.setLineDash(p.dash ?? [])
    if (p.fill) { g.globalAlpha = p.fill; g.fill(path); g.globalAlpha = 1 }
    g.stroke(path)
  }
  g.restore()
}
