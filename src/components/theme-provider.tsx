import { useEffect } from "react"
import { useTheme } from "@/store/theme"

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { mode, getAccent } = useTheme()

  useEffect(() => {
    const root = document.documentElement
    const accent = getAccent()

    // Тема (светлая/тёмная)
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
    }

    // Акцентный цвет
    root.style.setProperty("--primary", accent.primary)
    root.style.setProperty("--accent", accent.accent)
    root.style.setProperty("--ring", accent.ring)
  }, [mode, getAccent])

  return <>{children}</>
}
