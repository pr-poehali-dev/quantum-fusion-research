import { useState, useRef, useEffect } from "react"
import { createPortal } from "react-dom"
import { useTheme, ACCENT_COLORS } from "@/store/theme"
import Icon from "@/components/ui/icon"

// Цвета кружков (Tailwind + inline для custom)
const ACCENT_BG: Record<string, string> = {
  red:    "#ef4444",
  orange: "#f97316",
  blue:   "#3b82f6",
  purple: "#a855f7",
  green:  "#22c55e",
  cyan:   "#06b6d4",
}

export function ThemeSwitcher() {
  const { mode, accentId, everChanged, hintDismissed, setMode, setAccent, dismissThemeHint } = useTheme()
  const [open, setOpen] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [showHint, setShowHint] = useState(false)
  const [hintExpanded, setHintExpanded] = useState(false)
  const pickerRef = useRef<HTMLInputElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [popupPos, setPopupPos] = useState({ top: 0, right: 0 })

  // Подсказка о смене темы: если пользователь ни разу не менял тему и не скрыл
  // подсказку — показываем её через 30 секунд пребывания на странице.
  useEffect(() => {
    if (everChanged || hintDismissed) { setShowHint(false); return }
    const t = setTimeout(() => setShowHint(true), 30000)
    return () => clearTimeout(t)
  }, [everChanged, hintDismissed])

  // Любое открытие настроек или смена темы — прячем подсказку
  useEffect(() => { if (open || everChanged) setShowHint(false) }, [open, everChanged])

  const closeHintForever = () => { dismissThemeHint(); setShowHint(false) }
  const closeHint = () => { setShowHint(false); setHintExpanded(false) }

  useEffect(() => {
    if (open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      const margin = 8
      const popupWidth = Math.min(288, window.innerWidth - margin * 2)
      // right так, чтобы левый край попапа не ушёл за экран
      const maxRight = window.innerWidth - margin - popupWidth
      const right = Math.min(window.innerWidth - r.right, maxRight)
      setPopupPos({
        top: r.bottom + 8,
        right: Math.max(margin, right),
      })
    }
  }, [open])

  const currentDot = ACCENT_BG[accentId] || "#ef4444"

  const handleCustomColor = (hex: string) => {
    // Конвертируем hex → примерные HSL-значения и сохраняем как кастомный цвет
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
    const hsl = `${h} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`
    const lighterHsl = `${h} ${Math.round(s * 100)}% ${Math.round(Math.min(l * 1.2, 0.8) * 100)}%`
    // Сохраняем как custom с данным hex
    setAccent(`custom:${hex}:${hsl}:${lighterHsl}`)
  }

  const currentCustomHex =
    accentId.startsWith("custom:")
      ? accentId.split(":")[1]
      : "#ef4444"

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-2 text-sm text-foreground/70 hover:border-primary hover:text-foreground transition-colors"
        style={{ cursor: "pointer" }}
        title="Настройки темы"
      >
        <Icon
          name={mode === "dark" ? "Moon" : "Sun"}
          size={15}
          className="text-primary"
          style={{ filter: "drop-shadow(0 0 5px hsl(var(--primary)))" }}
        />
        {showHint && (
          <span className="absolute -right-1 -top-1 flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
          </span>
        )}
      </button>

      {/* Подсказка про смену темы */}
      {showHint && (
        <div
          onMouseEnter={() => setHintExpanded(true)}
          onMouseLeave={() => setHintExpanded(false)}
          className="absolute right-0 top-full z-[60] mt-2 w-60 rounded-xl border border-border bg-card p-3 shadow-2xl"
          style={{ cursor: "auto" }}
        >
          <div className="absolute -top-1.5 right-5 h-3 w-3 rotate-45 border-l border-t border-border bg-card" />
          <div className="flex items-start gap-2">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Icon name="Palette" size={14} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Можно сменить тему</p>
              <p className="mt-0.5 text-xs leading-snug text-foreground/55">
                Тёмная или светлая, плюс любой акцентный цвет — нажмите на кнопку рядом.
              </p>
            </div>
          </div>
          {hintExpanded && (
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => { closeHint(); setOpen(true) }}
                className="flex-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                style={{ cursor: "pointer" }}
              >
                Открыть
              </button>
              <button
                onClick={closeHint}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground/70 hover:text-foreground transition-colors"
                style={{ cursor: "pointer" }}
              >
                Ок, спасибо
              </button>
            </div>
          )}
          <button
            onClick={closeHintForever}
            className="mt-2 w-full text-center text-[11px] text-foreground/40 hover:text-foreground/70 transition-colors"
            style={{ cursor: "pointer" }}
          >
            Больше не показывать
          </button>
        </div>
      )}

      {open && createPortal(
        <>
          {/* Backdrop — вне custom-cursor-active, курсор виден */}
          <div
            className="fixed inset-0 z-[9998]"
            style={{ cursor: "auto" }}
            onClick={() => { setOpen(false); setShowPicker(false) }}
          />
          {/* Попап тоже вне main — курсор всегда виден */}
          <div
            className="fixed z-[9999] rounded-2xl border border-border bg-card p-5 shadow-2xl"
            style={{ top: popupPos.top, right: popupPos.right, width: "min(288px, calc(100vw - 16px))", cursor: "auto" }}
          >
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-foreground/40">Тема</p>
            <div className="mb-5 flex gap-2">
              {[
                { val: "dark" as const, icon: "Moon", label: "Тёмная" },
                { val: "light" as const, icon: "Sun", label: "Светлая" },
              ].map(t => (
                <button
                  key={t.val}
                  onClick={() => setMode(t.val)}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-xl border py-2.5 text-xs font-medium transition-all ${
                    mode === t.val
                      ? "border-primary bg-primary text-primary-foreground shadow-sm"
                      : "border-border text-foreground/60 hover:border-primary/50 hover:text-foreground"
                  }`}
                  style={{ cursor: "pointer" }}
                >
                  <Icon name={t.icon as "Moon"} size={13} />
                  {t.label}
                </button>
              ))}
            </div>

            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-foreground/40">Акцентный цвет</p>
            <div className="flex flex-col gap-1.5">
              {ACCENT_COLORS.map(color => {
                const isActive = accentId === color.id
                return (
                  <button
                    key={color.id}
                    onClick={() => setAccent(color.id)}
                    className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-all ${
                      isActive ? "border-primary bg-primary/10" : "border-border hover:border-primary/30 hover:bg-muted/50"
                    }`}
                    style={{ cursor: "pointer" }}
                  >
                    <span className="h-5 w-5 shrink-0 rounded-full shadow-sm" style={{ backgroundColor: ACCENT_BG[color.id] }} />
                    <span className={`text-sm font-medium ${isActive ? "text-primary" : "text-foreground/70"}`}>{color.label}</span>
                    {isActive && <Icon name="Check" size={14} className="ml-auto text-primary" />}
                  </button>
                )
              })}

              <button
                onClick={() => setShowPicker(v => !v)}
                className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-all ${
                  accentId.startsWith("custom:") ? "border-primary bg-primary/10" : "border-border hover:border-primary/30 hover:bg-muted/50"
                }`}
                style={{ cursor: "pointer" }}
              >
                <span
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-dashed border-foreground/30"
                  style={{ backgroundColor: accentId.startsWith("custom:") ? currentCustomHex : "transparent" }}
                >
                  {!accentId.startsWith("custom:") && <Icon name="Plus" size={10} className="text-foreground/40" />}
                </span>
                <span className={`text-sm font-medium ${accentId.startsWith("custom:") ? "text-primary" : "text-foreground/70"}`}>Другое</span>
                {accentId.startsWith("custom:") && <Icon name="Check" size={14} className="ml-auto text-primary" />}
              </button>

              {showPicker && (
                <div className="mt-1 flex items-center gap-3 rounded-xl border border-border bg-muted/30 px-3 py-3">
                  <label
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 border-border overflow-hidden hover:border-primary transition-colors"
                    style={{ cursor: "pointer" }}
                  >
                    <input
                      ref={pickerRef}
                      type="color"
                      defaultValue={currentCustomHex}
                      onChange={e => handleCustomColor(e.target.value)}
                      className="h-12 w-12 scale-150 opacity-0 absolute"
                      style={{ cursor: "pointer" }}
                    />
                    <span
                      className="h-8 w-8 rounded-md"
                      style={{ backgroundColor: accentId.startsWith("custom:") ? currentCustomHex : "#ffffff" }}
                    />
                  </label>
                  <div>
                    <p className="text-xs font-medium text-foreground">Выберите любой цвет</p>
                    <p className="text-xs text-foreground/50">Нажмите на квадрат чтобы открыть палитру</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  )
}