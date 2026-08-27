import { useCallback, useEffect, useState } from 'react'

/**
 * Light / Dark / System, applied by toggling `.dark` on the root element.
 *
 * `system` is a real third state, not a default the control lacks a button for:
 * a user whose OS flips to dark at sunset should follow it without coming back
 * here, and that is only expressible if "follow the OS" is selectable.
 *
 * Reads are wrapped because `localStorage` THROWS rather than returning null in
 * a browser set to block site data, and a theme preference is not worth taking
 * the whole app down for.
 */
export type AppTheme = 'light' | 'dark' | 'system'

const KEY = 'oer2canvas:theme'

function stored(): AppTheme {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
  } catch {
    return 'system'
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<AppTheme>(stored)

  useEffect(() => {
    /*
     * Guarded rather than assumed. `matchMedia` is absent in jsdom and in some
     * embedded webviews, and an explicit Light or Dark choice does not need it —
     * so a missing implementation costs the OS-following arm, not the feature.
     */
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media?.matches === true)
      document.documentElement.classList.toggle('dark', dark)
    }
    apply()
    // Only while following the OS is there anything to listen to.
    if (theme !== 'system' || !media) return
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])

  const setTheme = useCallback((t: AppTheme) => {
    setThemeState(t)
    try {
      localStorage.setItem(KEY, t)
    } catch {
      // A preference that cannot be remembered still applies for this session.
    }
  }, [])

  return { theme, setTheme }
}
