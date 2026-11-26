/**
 * Tema claro/oscuro: se aplica con `data-theme` en <html>, se persiste en
 * `localStorage` y se lee en index.html antes del primer render para evitar parpadeos.
 */

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'foundry.theme'

export const THEME_META_COLORS: Record<Theme, string> = { dark: '#0d0f15', light: '#f4f5fa' }

export function readStoredTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme)

  const colorScheme = document.querySelector('meta[name="color-scheme"]')
  colorScheme?.setAttribute('content', theme)

  const themeColor = document.querySelector('meta[name="theme-color"]')
  themeColor?.setAttribute('content', THEME_META_COLORS[theme])

  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    /* almacenamiento no disponible */
  }
}
