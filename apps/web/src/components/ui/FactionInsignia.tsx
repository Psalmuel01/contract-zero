// Original insignia for the four powers. Simple geometry drawn with currentColor, each
// carrying one idea about its owner: Vanguard's disciplined chevrons, the Ashen Compact's
// riveted weld-plate with a slash, Vex's chalked ticket, Halcyon's clean hex ring and
// pallet line. Unknown factions get a neutral blank plate rather than a borrowed mark.
// The shapes live in lib/insignia, which also paints them onto the 3D sites.

import { factionColor } from '@/lib/factions'
import { insigniaFor } from '@/lib/insignia'

export function FactionInsignia({ id, className = 'h-8 w-8', title, colored = true }: { id: string | null | undefined; className?: string; title?: string; colored?: boolean }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'square' as const, strokeLinejoin: 'miter' as const }
  return (
    <svg viewBox="0 0 48 48" className={className} style={colored ? { color: factionColor(id) } : undefined} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} data-insignia={id ?? 'none'} {...p}>
      {title && <title>{title}</title>}
      {insigniaFor(id).map((s, i) =>
        s.kind === 'dot' ? <circle key={i} cx={s.cx} cy={s.cy} r={s.r} fill="currentColor" stroke="none" />
        : s.kind === 'ring' ? <circle key={i} cx={s.cx} cy={s.cy} r={s.r} strokeWidth={s.width} />
        : <path key={i} d={s.d} strokeWidth={s.width} fill={s.fill ? 'currentColor' : undefined} fillOpacity={s.fill} strokeDasharray={s.dash?.join(' ')} />,
      )}
    </svg>
  )
}
