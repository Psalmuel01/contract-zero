import type { ClipName } from './OperatorRig'

/**
 * The rig's clip names for operator.glb's animations, where they differ.
 *
 * The asset's strafe clips are named for the opposite side: measured from the clips'
 * own root motion (Hips translation; the armature only rotates about X, so local X is
 * the character's X, and its left thigh sits at +X, so its left is +X):
 * `strafeL` travels 2.2 m toward -X (the character's RIGHT), `strafeR` 1.5 m toward +X
 * (its LEFT). Played as named, a guard circling right stepped left. Checked against
 * the file by rigClips.test.ts.
 */
export const GLB_CLIP_RENAME: Record<string, ClipName> = {
  strafeL: 'strafeR',
  strafeR: 'strafeL',
}

export const rigClipName = (glbName: string): ClipName => GLB_CLIP_RENAME[glbName] ?? (glbName as ClipName)
