import { create } from "zustand"
import { persist } from "zustand/middleware"

// Масштаб интерфейса админки (шрифт + иконки + отступы разом).
// Применяется через CSS zoom на контейнере админки — работает и на мобилке.
export const UI_SCALES: { value: number; label: string }[] = [
  { value: 0.9, label: "S" },
  { value: 1.0, label: "M" },
  { value: 1.15, label: "L" },
  { value: 1.3, label: "XL" },
]

export const MIN_SCALE = 0.9
export const MAX_SCALE = 1.3

interface UiScaleStore {
  scale: number
  setScale: (s: number) => void
  inc: () => void
  dec: () => void
  reset: () => void
}

const clamp = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(s * 100) / 100))

export const useUiScale = create<UiScaleStore>()(
  persist(
    (set, get) => ({
      scale: 1.0,
      setScale: (s: number) => set({ scale: clamp(s) }),
      inc: () => set({ scale: clamp(get().scale + 0.1) }),
      dec: () => set({ scale: clamp(get().scale - 0.1) }),
      reset: () => set({ scale: 1.0 }),
    }),
    { name: "admin-ui-scale" }
  )
)
