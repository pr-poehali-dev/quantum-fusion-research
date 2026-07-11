// Захват UTM-меток с лендинга и хранение первого касания в localStorage.
// Метки пробрасываются в заказ (корзина) и заявку (квиз) для аналитики источников.

const STORAGE_KEY = "utm_attribution"

export type UtmData = {
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  captured_at?: string
}

// Вызывается один раз при загрузке приложения. Если в URL есть utm_* —
// сохраняем (перезаписываем последним касанием). Иначе — оставляем прежнее.
export function captureUtm(): void {
  try {
    const params = new URLSearchParams(window.location.search)
    const source = params.get("utm_source")
    const medium = params.get("utm_medium")
    const campaign = params.get("utm_campaign")
    if (source || medium || campaign) {
      const data: UtmData = {
        utm_source: source || undefined,
        utm_medium: medium || undefined,
        utm_campaign: campaign || undefined,
        captured_at: new Date().toISOString(),
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    }
  } catch {
    // localStorage может быть недоступен — молча игнорируем
  }
}

// Читает сохранённые UTM-метки для отправки на бэкенд.
export function getUtm(): UtmData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const d = JSON.parse(raw) as UtmData
    return {
      utm_source: d.utm_source,
      utm_medium: d.utm_medium,
      utm_campaign: d.utm_campaign,
    }
  } catch {
    return {}
  }
}
