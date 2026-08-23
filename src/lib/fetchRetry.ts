// Глобальный retry для запросов к бэкенд-функциям.
// Оборачивает window.fetch один раз: если функция вернула 503 (сервер занят —
// например при «залпе» вызовов от админки) или произошёл сетевой сбой, ждём и
// повторяем запрос. Покрывает ВСЕ вызовы api.* сразу, без правки каждого метода.

const MAX_RETRIES = 2          // максимум повторов (итого до 3 попыток)
// Первый повтор — почти сразу: сетевой сбой чаще всего разовый, и секунда
// ожидания превращалась в «вход думает три секунды». Второй — с паузой.
const RETRY_DELAYS_MS = [250, 1000]
// Ни один запрос к функции не должен висеть дольше: таймаут самой функции
// заметно меньше, поэтому «вечное ожидание» = зависшее соединение.
const REQUEST_TIMEOUT_MS = 20000
const RETRY_STATUSES = new Set([503, 502, 504])

const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

// Только запросы к нашим облачным функциям — сторонние URL не трогаем.
function isBackendUrl(input: RequestInfo | URL): boolean {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  return typeof url === "string" && url.includes("functions.poehali.dev")
}

let installed = false

export function installFetchRetry(): void {
  if (installed || typeof window === "undefined") return
  installed = true

  const nativeFetch = window.fetch.bind(window)

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!isBackendUrl(input)) return nativeFetch(input, init)

    let lastErr: unknown = null
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      // Свой таймер на попытку. Если снаружи уже передан signal (например
      // компонент отменяет запрос при размонтировании) — уважаем и его.
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
      const outer = init?.signal
      const onOuterAbort = () => ctrl.abort()
      outer?.addEventListener("abort", onOuterAbort)
      try {
        const res = await nativeFetch(input, { ...init, signal: ctrl.signal })
        // Сервер занят — повторяем (если попытки ещё есть)
        if (RETRY_STATUSES.has(res.status) && attempt < MAX_RETRIES) {
          await delay(RETRY_DELAYS_MS[attempt] ?? 1000)
          continue
        }
        return res
      } catch (e) {
        // Запрос отменили снаружи — это не сбой, повторять нечего.
        if (outer?.aborted) throw e
        lastErr = e
        if (attempt < MAX_RETRIES) { await delay(RETRY_DELAYS_MS[attempt] ?? 1000); continue }
        throw e
      } finally {
        clearTimeout(timer)
        outer?.removeEventListener("abort", onOuterAbort)
      }
    }
    throw lastErr
  }
}
