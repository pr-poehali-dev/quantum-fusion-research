import { useUiScale, MIN_SCALE, MAX_SCALE } from "@/store/uiScale"
import Icon from "@/components/ui/icon"

// Переключатель размера интерфейса админки (шрифт/иконки/отступы).
// Кнопки −/+ и сброс. Значение сохраняется в localStorage и применяется
// глобально через zoom на контейнере админки (см. Admin.tsx).
export default function UiScaleSwitcher() {
  const { scale, inc, dec, reset } = useUiScale()
  const pct = Math.round(scale * 100)

  return (
    <div className="flex items-center gap-0.5 rounded-full border border-border px-1 py-0.5" title="Размер интерфейса">
      <button
        onClick={dec}
        disabled={scale <= MIN_SCALE}
        className="flex h-7 w-7 items-center justify-center rounded-full text-foreground/60 hover:bg-muted hover:text-foreground transition-colors disabled:opacity-30"
        style={{ cursor: "pointer" }}
        title="Меньше"
        aria-label="Уменьшить размер интерфейса"
      >
        <Icon name="Minus" size={14} />
      </button>
      <button
        onClick={reset}
        className="min-w-[38px] px-1 text-center text-xs font-medium text-foreground/70 hover:text-foreground transition-colors tabular-nums"
        style={{ cursor: "pointer" }}
        title="Сбросить размер (100%)"
      >
        {pct}%
      </button>
      <button
        onClick={inc}
        disabled={scale >= MAX_SCALE}
        className="flex h-7 w-7 items-center justify-center rounded-full text-foreground/60 hover:bg-muted hover:text-foreground transition-colors disabled:opacity-30"
        style={{ cursor: "pointer" }}
        title="Больше"
        aria-label="Увеличить размер интерфейса"
      >
        <Icon name="Plus" size={14} />
      </button>
    </div>
  )
}
