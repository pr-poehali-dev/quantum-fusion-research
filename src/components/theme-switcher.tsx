import { useState } from "react"
import { useTheme, ACCENT_COLORS } from "@/store/theme"
import Icon from "@/components/ui/icon"

export function ThemeSwitcher() {
  const { mode, accentId, setMode, setAccent } = useTheme()
  const [open, setOpen] = useState(false)

  const accentDots: Record<string, string> = {
    red:    "bg-red-500",
    orange: "bg-orange-500",
    blue:   "bg-blue-500",
    purple: "bg-purple-500",
    green:  "bg-green-500",
    cyan:   "bg-cyan-500",
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-2 text-sm text-foreground/70 hover:border-primary hover:text-foreground transition-colors"
        style={{ cursor: "pointer" }}
        title="Настройки темы"
      >
        <Icon name={mode === "dark" ? "Moon" : "Sun"} size={15} />
        <span className={`h-3 w-3 rounded-full ${accentDots[accentId] || "bg-primary"}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-xl border border-border bg-card p-4 shadow-xl">
            {/* Тема */}
            <p className="mb-2 text-xs font-medium text-foreground/50 uppercase tracking-wider">Тема</p>
            <div className="mb-4 flex gap-2">
              <button
                onClick={() => setMode("dark")}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg border py-2 text-xs font-medium transition-colors ${mode === "dark" ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60 hover:border-primary"}`}
                style={{ cursor: "pointer" }}
              >
                <Icon name="Moon" size={13} />Тёмная
              </button>
              <button
                onClick={() => setMode("light")}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg border py-2 text-xs font-medium transition-colors ${mode === "light" ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60 hover:border-primary"}`}
                style={{ cursor: "pointer" }}
              >
                <Icon name="Sun" size={13} />Светлая
              </button>
            </div>

            {/* Акцентный цвет */}
            <p className="mb-2 text-xs font-medium text-foreground/50 uppercase tracking-wider">Цвет акцента</p>
            <div className="grid grid-cols-3 gap-2">
              {ACCENT_COLORS.map(color => (
                <button
                  key={color.id}
                  onClick={() => setAccent(color.id)}
                  className={`flex items-center gap-2 rounded-lg border px-2 py-2 text-xs transition-colors ${accentId === color.id ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"}`}
                  style={{ cursor: "pointer" }}
                >
                  <span className={`h-3 w-3 shrink-0 rounded-full ${accentDots[color.id]}`} />
                  <span className="text-foreground/70 truncate">{color.label}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
