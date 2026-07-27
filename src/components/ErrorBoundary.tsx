import { Component, ErrorInfo, ReactNode } from "react"

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  message: string
  code: string
}

// Короткий код ошибки для дебага: время (base36) + хеш сообщения.
// Пример: E-LX9F2K-7A3. Виден на экране и в логах — легко сопоставить.
function makeErrorCode(message: string): string {
  let hash = 0
  for (let i = 0; i < message.length; i++) {
    hash = (hash * 31 + message.charCodeAt(i)) | 0
  }
  const ts = Date.now().toString(36).toUpperCase().slice(-6)
  const h = Math.abs(hash).toString(36).toUpperCase().slice(0, 3).padStart(3, "0")
  return `E-${ts}-${h}`
}

// Признак ошибки загрузки динамического чанка (после нового деплоя браузер
// держит ссылку на старый удалённый чанк). Такие ошибки лечатся перезагрузкой.
function isChunkLoadError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err || "")).toLowerCase()
  return (
    msg.includes("failed to fetch dynamically imported module") ||
    msg.includes("importing a module script failed") ||
    msg.includes("error loading dynamically imported module") ||
    (msg.includes("unexpected token") && msg.includes("<")) ||
    msg.includes("loading chunk")
  )
}

// Глобальный «предохранитель»: ловит ошибки рендера в дереве и не даёт
// приложению упасть в чёрный экран.
// - Ошибку загрузки чанка (после релиза) — тихо чиним перезагрузкой (1 раз).
// - Любую другую ошибку — показываем понятный экран с кнопкой «Обновить».
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: "", code: "" }

  static getDerivedStateFromError(error: Error): State {
    const message = error?.message || ""
    return { hasError: true, message, code: makeErrorCode(message) }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Ошибка устаревшего чанка — один раз перезагружаем, чтобы подтянуть
    // свежий билд. Флаг в sessionStorage защищает от цикла перезагрузок.
    if (isChunkLoadError(error)) {
      if (!sessionStorage.getItem("eb_chunk_reload")) {
        sessionStorage.setItem("eb_chunk_reload", "1")
        window.location.reload()
        return
      }
    }
    // eslint-disable-next-line no-console
    console.error(`ErrorBoundary caught [${this.state.code}]:`, error, info?.componentStack)
  }

  render() {
    if (!this.state.hasError) return this.props.children

    // Для чанк-ошибки (уже перезагрузились однажды) показываем спиннер —
    // перезагрузка либо уже идёт, либо кнопка ниже.
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-5 p-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
        </div>
        <div className="space-y-1.5">
          <h1 className="text-lg font-medium text-foreground">Что-то пошло не так</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            Страница не смогла загрузиться. Обычно помогает обновление — нажмите кнопку ниже.
          </p>
        </div>
        <button
          onClick={() => { sessionStorage.removeItem("eb_chunk_reload"); window.location.reload() }}
          className="rounded-xl bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          style={{ cursor: "pointer" }}
        >
          Обновить страницу
        </button>

        {/* Код ошибки для дебага — можно скопировать и передать в поддержку */}
        {this.state.code && (
          <button
            onClick={() => {
              const info = `${this.state.code}${this.state.message ? `: ${this.state.message}` : ""}`
              navigator.clipboard?.writeText(info).catch(() => {})
            }}
            title="Нажмите, чтобы скопировать код ошибки"
            className="mt-1 flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
            style={{ cursor: "pointer" }}
          >
            <span>Код ошибки: {this.state.code}</span>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
        )}
      </div>
    )
  }
}