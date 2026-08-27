import { useEffect, useRef } from "react"
import { useLocation } from "react-router-dom"

// Сайт одностраничный: при переходе между разделами страница не
// перезагружается, поэтому Метрика сама засчитывает только первый заход.
// Здесь досылаем ей каждый переход — иначе в отчётах будет виден лишь вход,
// а весь путь посетителя по сайту потеряется.
const COUNTER_ID = 112015547

declare global {
  interface Window {
    ym?: (id: number, action: string, ...args: unknown[]) => void
  }
}

export default function MetrikaTracker() {
  const { pathname, search } = useLocation()
  // Первый просмотр Метрика отправляет сама при инициализации — дубль не нужен.
  const first = useRef(true)

  useEffect(() => {
    if (first.current) { first.current = false; return }
    if (typeof window.ym !== "function") return
    window.ym(COUNTER_ID, "hit", pathname + search, {
      referer: document.referrer,
      title: document.title,
    })
  }, [pathname, search])

  return null
}
