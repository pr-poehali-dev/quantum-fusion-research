import { useEffect, useLayoutEffect } from "react"
import { useTheme, ThemeLevel } from "@/store/theme"

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

// 5 уровней яркости — от супер-тёмного (0) до супер-светлого (4).
// Индексы 1 и 3 — исходные «тёмная» и «светлая» темы (сохранены как были).
const LEVEL_VARS: Record<ThemeLevel, Record<string, string>> = {
  // 0 — Супер-тёмная (почти чёрная, минимум контраста фона)
  0: {
    "--background": "0 0% 0%", "--foreground": "0 0% 92%",
    "--card": "0 0% 4%", "--card-foreground": "0 0% 92%",
    "--popover": "0 0% 4%", "--popover-foreground": "0 0% 92%",
    "--secondary": "0 0% 6%", "--secondary-foreground": "0 0% 92%",
    "--muted": "0 0% 6%", "--muted-foreground": "0 0% 40%",
    "--border": "0 0% 8%", "--input": "0 0% 8%",
    "--primary-foreground": "0 0% 100%", "--accent-foreground": "0 0% 100%",
  },
  // 1 — Тёмная (исходная dark)
  1: {
    "--background": "0 0% 4%", "--foreground": "0 0% 95%",
    "--card": "0 0% 7%", "--card-foreground": "0 0% 95%",
    "--popover": "0 0% 7%", "--popover-foreground": "0 0% 95%",
    "--secondary": "0 0% 10%", "--secondary-foreground": "0 0% 95%",
    "--muted": "0 0% 10%", "--muted-foreground": "0 0% 45%",
    "--border": "0 0% 12%", "--input": "0 0% 12%",
    "--primary-foreground": "0 0% 100%", "--accent-foreground": "0 0% 100%",
  },
  // 2 — Приглушённая (тёмно-серая, мягче dark)
  2: {
    "--background": "0 0% 15%", "--foreground": "0 0% 96%",
    "--card": "0 0% 19%", "--card-foreground": "0 0% 96%",
    "--popover": "0 0% 19%", "--popover-foreground": "0 0% 96%",
    "--secondary": "0 0% 24%", "--secondary-foreground": "0 0% 96%",
    "--muted": "0 0% 24%", "--muted-foreground": "0 0% 60%",
    "--border": "0 0% 28%", "--input": "0 0% 28%",
    "--primary-foreground": "0 0% 100%", "--accent-foreground": "0 0% 100%",
  },
  // 3 — Светлая (исходная light)
  3: {
    "--background": "0 0% 97%", "--foreground": "0 0% 8%",
    "--card": "0 0% 100%", "--card-foreground": "0 0% 8%",
    "--popover": "0 0% 100%", "--popover-foreground": "0 0% 8%",
    "--secondary": "0 0% 92%", "--secondary-foreground": "0 0% 8%",
    "--muted": "0 0% 92%", "--muted-foreground": "0 0% 45%",
    "--border": "0 0% 86%", "--input": "0 0% 86%",
    "--primary-foreground": "0 0% 100%", "--accent-foreground": "0 0% 100%",
  },
  // 4 — Супер-светлая (чисто-белая, максимум яркости)
  4: {
    "--background": "0 0% 100%", "--foreground": "0 0% 4%",
    "--card": "0 0% 100%", "--card-foreground": "0 0% 4%",
    "--popover": "0 0% 100%", "--popover-foreground": "0 0% 4%",
    "--secondary": "0 0% 96%", "--secondary-foreground": "0 0% 4%",
    "--muted": "0 0% 96%", "--muted-foreground": "0 0% 40%",
    "--border": "0 0% 90%", "--input": "0 0% 90%",
    "--primary-foreground": "0 0% 100%", "--accent-foreground": "0 0% 100%",
  },
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { level, accentId, getAccent } = useTheme()

  // Единая функция применения темы (без дублирования)
  const applyTheme = () => {
    const root = document.documentElement
    const accent = getAccent()
    // На /welcome всегда тёмная тема (уровень 1)
    const effectiveLevel: ThemeLevel = window.location.pathname === "/welcome" ? 1 : level
    const vars = LEVEL_VARS[effectiveLevel] || LEVEL_VARS[1]
    // Класс dark для уровней 0..2 (тёмные), light — 3..4
    root.classList.toggle("dark", effectiveLevel <= 2)
    for (const k in vars) root.style.setProperty(k, vars[k])
    root.style.setProperty("--primary", accent.primary)
    root.style.setProperty("--accent", accent.accent)
    root.style.setProperty("--ring", accent.ring)
  }

  // Применяем тему ДО отрисовки (layout-effect) — без мерцания и лишней перерисовки
  useIsoLayoutEffect(() => { applyTheme() }, [level, accentId])  

  // Пересчёт темы при навигации (переход с/на "/welcome")
  useEffect(() => {
    window.addEventListener("popstate", applyTheme)
    const orig = history.pushState.bind(history)
    history.pushState = (...args) => { orig(...args); applyTheme() }
    return () => {
      window.removeEventListener("popstate", applyTheme)
      history.pushState = orig
    }
  }, [level, accentId]) // eslint-disable-line react-hooks/exhaustive-deps

  return <>{children}</>
}