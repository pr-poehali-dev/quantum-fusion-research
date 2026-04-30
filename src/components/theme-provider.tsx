import { useEffect } from "react"
import { useTheme } from "@/store/theme"

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

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { mode, getAccent } = useTheme()

  useEffect(() => {
    const root = document.documentElement
    const accent = getAccent()

    // Включаем плавный переход на всех CSS-переменных
    root.style.setProperty("transition", "background-color 0.4s ease, color 0.4s ease")

    // Светлая / тёмная тема
    if (mode === "light") {
      root.style.setProperty("--background", "0 0% 97%")
      root.style.setProperty("--foreground", "0 0% 8%")
      root.style.setProperty("--card", "0 0% 100%")
      root.style.setProperty("--card-foreground", "0 0% 8%")
      root.style.setProperty("--popover", "0 0% 100%")
      root.style.setProperty("--popover-foreground", "0 0% 8%")
      root.style.setProperty("--secondary", "0 0% 92%")
      root.style.setProperty("--secondary-foreground", "0 0% 8%")
      root.style.setProperty("--muted", "0 0% 92%")
      root.style.setProperty("--muted-foreground", "0 0% 45%")
      root.style.setProperty("--border", "0 0% 86%")
      root.style.setProperty("--input", "0 0% 86%")
      root.style.setProperty("--primary-foreground", "0 0% 100%")
      root.style.setProperty("--accent-foreground", "0 0% 100%")
      root.classList.remove("dark")
    } else {
      root.style.setProperty("--background", "0 0% 4%")
      root.style.setProperty("--foreground", "0 0% 95%")
      root.style.setProperty("--card", "0 0% 7%")
      root.style.setProperty("--card-foreground", "0 0% 95%")
      root.style.setProperty("--popover", "0 0% 7%")
      root.style.setProperty("--popover-foreground", "0 0% 95%")
      root.style.setProperty("--secondary", "0 0% 10%")
      root.style.setProperty("--secondary-foreground", "0 0% 95%")
      root.style.setProperty("--muted", "0 0% 10%")
      root.style.setProperty("--muted-foreground", "0 0% 45%")
      root.style.setProperty("--border", "0 0% 12%")
      root.style.setProperty("--input", "0 0% 12%")
      root.style.setProperty("--primary-foreground", "0 0% 100%")
      root.style.setProperty("--accent-foreground", "0 0% 100%")
      root.classList.add("dark")
    }

    // Акцентный цвет
    root.style.setProperty("--primary", accent.primary)
    root.style.setProperty("--accent", accent.accent)
    root.style.setProperty("--ring", accent.ring)
  }, [mode, getAccent])

  return <>{children}</>
}
