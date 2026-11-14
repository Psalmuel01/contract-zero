import type { MetadataRoute } from 'next'

// Installed to a phone's home screen, the game opens without browser bars: Android
// honours "fullscreen"; iOS (no Fullscreen API on iPhone) opens it standalone.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'CONTRACT ZERO',
    short_name: 'Contract Zero',
    description: 'A tactical extraction shooter in a war economy run by rival AI factions.',
    start_url: '/',
    display: 'fullscreen',
    display_override: ['fullscreen', 'standalone'],
    orientation: 'landscape',
    background_color: '#0a0b0d',
    theme_color: '#0a0b0d',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  }
}
