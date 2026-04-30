import { create } from "zustand"
import { persist } from "zustand/middleware"

export type ThemeMode = "dark" | "light"

export interface AccentColor {
  id: string
  label: string
  primary: string       // HSL values for --primary
  accent: string        // HSL values for --accent
  ring: string
}

export const ACCENT_COLORS: AccentColor[] = [
  { id: "red",    label: "Красный",   primary: "0 85% 50%",   accent: "24 90% 52%",  ring: "0 85% 50%"   },
  { id: "orange", label: "Оранжевый", primary: "25 95% 50%",  accent: "35 95% 55%",  ring: "25 95% 50%"  },
  { id: "blue",   label: "Синий",     primary: "217 91% 60%", accent: "200 80% 55%", ring: "217 91% 60%" },
  { id: "purple", label: "Фиолетовый",primary: "270 70% 60%", accent: "290 65% 55%", ring: "270 70% 60%" },
  { id: "green",  label: "Зелёный",   primary: "142 72% 45%", accent: "160 65% 45%", ring: "142 72% 45%" },
  { id: "cyan",   label: "Бирюзовый", primary: "188 90% 45%", accent: "200 85% 50%", ring: "188 90% 45%" },
]

interface ThemeStore {
  mode: ThemeMode
  accentId: string
  setMode: (mode: ThemeMode) => void
  setAccent: (id: string) => void
  getAccent: () => AccentColor
}

export const useTheme = create<ThemeStore>()(
  persist(
    (set, get) => ({
      mode: "dark",
      accentId: "red",
      setMode: (mode) => set({ mode }),
      setAccent: (accentId) => set({ accentId }),
      getAccent: () => ACCENT_COLORS.find(a => a.id === get().accentId) || ACCENT_COLORS[0],
    }),
    { name: "begraphics-theme" }
  )
)
