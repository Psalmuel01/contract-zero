'use client'

// Full screen, from the Settings button or the Full screen key (default V) on any screen.

import { useEffect } from 'react'
import { useSettings } from '@/lib/settings'

export function fullscreenSupported(): boolean {
  return typeof document !== 'undefined' && !!document.fullscreenEnabled && typeof document.documentElement.requestFullscreen === 'function'
}

/** Enter or leave full screen. Must run inside a click or key press. */
export async function toggleFullscreen(): Promise<void> {
  if (document.fullscreenElement) await document.exitFullscreen()
  else await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
}

/** Typing in a field never toggles full screen. */
function typing(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
}

/** The Full screen key, mounted once for the whole app. */
export function FullscreenShortcut() {
  const binds = useSettings().controls.binds.fullscreen
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return
      if (e.code !== binds[0] && e.code !== binds[1]) return
      if (!fullscreenSupported()) return
      e.preventDefault()
      toggleFullscreen().catch(() => {})
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [binds])
  return null
}
