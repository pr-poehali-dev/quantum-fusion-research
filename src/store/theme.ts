import { create } from "zustand"
import { persist } from "zustand/middleware"

export type ThemeMode = "dark" | "light"

// Уровень яркости темы: 0 — супер-тёмный … 4 — супер-светлый.
// 0,1,2 считаются «тёмными», 3,4 — «светлыми» (для иконки и /welcome).
export type ThemeLevel = 0 | 1 | 2 | 3 | 4
export const THEME_LEVELS: { level: ThemeLevel; label: string }[] = [
  { level: 0, label: "Супер-тёмная" },
  { level: 1, label: "Тёмная" },
  { level: 2, label: "Приглушённая" },
  { level: 3, label: "Светлая" },
  { level: 4, label: "Супер-светлая" },
]
export const levelToMode = (l: ThemeLevel): ThemeMode => (l <= 2 ? "dark" : "light")

export interface AccentColor {
  id: string
  label: string
  primary: string
  accent: string
  ring: string
}

export const ACCENT_COLORS: AccentColor[] = [
  { id: "red",    label: "Красный",    primary: "0 85% 50%",   accent: "24 90% 52%",  ring: "0 85% 50%"   },
  { id: "orange", label: "Оранжевый",  primary: "25 95% 50%",  accent: "35 95% 55%",  ring: "25 95% 50%"  },
  { id: "blue",   label: "Синий",      primary: "217 91% 60%", accent: "200 80% 55%", ring: "217 91% 60%" },
  { id: "purple", label: "Фиолетовый", primary: "270 70% 60%", accent: "290 65% 55%", ring: "270 70% 60%" },
  { id: "green",  label: "Зелёный",    primary: "142 72% 45%", accent: "160 65% 45%", ring: "142 72% 45%" },
  { id: "cyan",   label: "Бирюзовый",  primary: "188 90% 45%", accent: "200 85% 50%", ring: "188 90% 45%" },
]

interface ThemeStore {
  mode: ThemeMode
  level: ThemeLevel         // уровень яркости 0..4 (ползунок)
  accentId: string
  everChanged: boolean      // менял ли пользователь тему хоть раз
  hintDismissed: boolean    // скрыл ли подсказку «больше не показывать»
  setMode: (mode: ThemeMode) => void
  setLevel: (level: ThemeLevel) => void
  setAccent: (id: string) => void
  dismissThemeHint: () => void
  getAccent: () => AccentColor
  getShaderColors: () => { colorA: string; colorB: string; base: string; glow: string }
}

// Конвертируем hex → HSL строку
function hexToHsl(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h = Math.round(h * 60)
    if (h < 0) h += 360
  }
  return `${h} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`
}

// Hex цвета шейдера для каждого акцента (тёмные версии)
const SHADER_COLORS: Record<string, { colorA: string; colorB: string; base: string; glow: string }> = {
  red:    { colorA: "#200000", colorB: "#3a0000", base: "#cc0000", glow: "rgba(200,0,0,0.55)"    },
  orange: { colorA: "#1a0a00", colorB: "#2e1400", base: "#cc5500", glow: "rgba(200,80,0,0.55)"   },
  blue:   { colorA: "#000a1a", colorB: "#00143a", base: "#1155cc", glow: "rgba(30,80,200,0.55)"  },
  purple: { colorA: "#0d0020", colorB: "#18003a", base: "#7700cc", glow: "rgba(120,0,200,0.55)"  },
  green:  { colorA: "#001a08", colorB: "#002e14", base: "#00aa44", glow: "rgba(0,160,60,0.55)"   },
  cyan:   { colorA: "#001a1a", colorB: "#002e2e", base: "#00aacc", glow: "rgba(0,160,200,0.55)"  },
}

export const useTheme = create<ThemeStore>()(
  persist(
    (set, get) => ({
      mode: "dark",
      level: 1,
      accentId: "red",
      everChanged: false,
      hintDismissed: false,
      // setMode оставлен для обратной совместимости: dark→уровень 1, light→уровень 3
      setMode: (mode) => set({ mode, level: mode === "light" ? 3 : 1, everChanged: true }),
      setLevel: (level) => set({ level, mode: levelToMode(level), everChanged: true }),
      setAccent: (accentId) => set({ accentId, everChanged: true }),
      dismissThemeHint: () => set({ hintDismissed: true }),

      getAccent: () => {
        const id = get().accentId
        if (id.startsWith("custom:")) {
          const parts = id.split(":")
          const hsl = parts[2] || "0 85% 50%"
          const lighter = parts[3] || hsl
          return { id, label: "Другое", primary: hsl, accent: lighter, ring: hsl }
        }
        return ACCENT_COLORS.find(a => a.id === id) || ACCENT_COLORS[0]
      },

      getShaderColors: () => {
        const id = get().accentId
        if (id.startsWith("custom:")) {
          const hex = id.split(":")[1] || "#cc0000"
          const hsl = hexToHsl(hex)
          const parts = hsl.split(" ")
          const h = parseInt(parts[0])
          const s = parseInt(parts[1])
          const l = parseInt(parts[2])
          const darkBase = `hsl(${h}, ${s}%, ${Math.max(l - 30, 5)}%)`
          const darker = `hsl(${h}, ${s}%, ${Math.max(l - 40, 3)}%)`
          return { colorA: darker, colorB: darkBase, base: hex, glow: `${hex}88` }
        }
        return SHADER_COLORS[id] || SHADER_COLORS.red
      },
    }),
    { name: "begraphics-theme" }
  )
)