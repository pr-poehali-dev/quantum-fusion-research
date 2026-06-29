import { useEffect, useLayoutEffect } from "react"
import { useTheme } from "@/store/theme"

// Безопасный layout-effect (на сервере падает на useEffect, но у нас SPA)
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect

// Конвертируем HSL-строку "217 91% 60%" в hex для шейдера
export function hslToHex(hsl: string): string {
  const parts = hsl.trim().split(/\s+/)
  const h = parseFloat(parts[0])
  const s = parseFloat(parts[1]) / 100
  const l = parseFloat(parts[2]) / 100

  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * color).toString(16).padStart(2, "0")
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

const LIGHT_VARS: Record<string, string> = {
  "--background": "0 0% 97%", "--foreground": "0 0% 8%",
  "--card": "0 0% 100%", "--card-foreground": "0 0% 8%",
  "--popover": "0 0% 100%", "--popover-foreground": "0 0% 8%",
  "--secondary": "0 0% 92%", "--secondary-foreground": "0 0% 8%",
  "--muted": "0 0% 92%", "--muted-foreground": "0 0% 45%",
  "--border": "0 0% 86%", "--input": "0 0% 86%",
  "--primary-foreground": "0 0% 100%", "--accent-foreground": "0 0% 100%",
}
const DARK_VARS: Record<string, string> = {
  "--background": "0 0% 4%", "--foreground": "0 0% 95%",
  "--card": "0 0% 7%", "--card-foreground": "0 0% 95%",
  "--popover": "0 0% 7%", "--popover-foreground": "0 0% 95%",
  "--secondary": "0 0% 10%", "--secondary-foreground": "0 0% 95%",
  "--muted": "0 0% 10%", "--muted-foreground": "0 0% 45%",
  "--border": "0 0% 12%", "--input": "0 0% 12%",
  "--primary-foreground": "0 0% 100%", "--accent-foreground": "0 0% 100%",
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { mode, accentId, getAccent } = useTheme()

  // Единая функция применения темы (без дублирования)
  const applyTheme = () => {
    const root = document.documentElement
    const accent = getAccent()
    const effectiveMode = window.location.pathname === "/welcome" ? "dark" : mode
    const vars = effectiveMode === "light" ? LIGHT_VARS : DARK_VARS
    root.classList.toggle("dark", effectiveMode !== "light")
    for (const k in vars) root.style.setProperty(k, vars[k])
    root.style.setProperty("--primary", accent.primary)
    root.style.setProperty("--accent", accent.accent)
    root.style.setProperty("--ring", accent.ring)
  }

  // Применяем тему ДО отрисовки (layout-effect) — без мерцания и лишней перерисовки
  useIsoLayoutEffect(() => { applyTheme() }, [mode, accentId])  

  // Пересчёт темы при навигации (переход с/на "/welcome")
  useEffect(() => {
    window.addEventListener("popstate", applyTheme)
    const orig = history.pushState.bind(history)
    history.pushState = (...args) => { orig(...args); applyTheme() }
    return () => {
      window.removeEventListener("popstate", applyTheme)
      history.pushState = orig
    }
  }, [mode, accentId]) // eslint-disable-line react-hooks/exhaustive-deps

  return <>{children}</>
}