// Глобальный retry для запросов к бэкенд-функциям.
// Оборачивает window.fetch один раз: если функция вернула 503 (сервер занят —
// например при «залпе» вызовов от админки), ждём и повторяем запрос.
// Покрывает ВСЕ вызовы api.* сразу, без правки каждого метода.

const MAX_RETRIES = 2          // максимум повторов (итого до 3 попыток)
const RETRY_DELAY_MS = 1000    // пауза перед повтором
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
      try {
        const res = await nativeFetch(input, init)
        // Сервер занят — повторяем (если попытки ещё есть)
        if (RETRY_STATUSES.has(res.status) && attempt < MAX_RETRIES) {
          await delay(RETRY_DELAY_MS)
          continue
        }
        return res
      } catch (e) {
        // Сетевой сбой — тоже повторяем
        lastErr = e
        if (attempt < MAX_RETRIES) { await delay(RETRY_DELAY_MS); continue }
        throw e
      }
    }
    throw lastErr
  }
}
