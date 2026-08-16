import { useState } from "react"
import Icon from "@/components/ui/icon"

interface YandexMapProps {
  /** Точный адрес — по нему карта ставит метку и строится ссылка. */
  address: string
  /** Координаты "широта,долгота" — если заданы, метка точнее, чем по адресу. */
  coords?: string
  /** Ссылка «Открыть в Яндекс.Картах». Если не задана — соберётся из адреса. */
  mapsUrl?: string
  /** Высота карты, px. */
  height?: number
  zoom?: number
}

// Встроенная карта Яндекса без API-ключа: официальный map-widget в iframe.
// Грузится только по клику на превью — iframe с картой тяжёлый, а на странице
// контактов их несколько; так страница открывается быстро.
export default function YandexMap({
  address, coords, mapsUrl, height = 280, zoom = 16,
}: YandexMapProps) {
  const [shown, setShown] = useState(false)

  // Для виджета координаты нужны в порядке "долгота,широта" (Яндекс: ll),
  // а привычная запись — "широта,долгота". Разворачиваем.
  const ll = coords
    ? coords.split(",").map(s => s.trim()).reverse().join(",")
    : ""

  const widgetSrc = coords
    ? `https://yandex.ru/map-widget/v1/?ll=${ll}&z=${zoom}&pt=${ll},pm2rdm`
    : `https://yandex.ru/map-widget/v1/?text=${encodeURIComponent(address)}&z=${zoom}`

  const openUrl = mapsUrl || (coords
    ? `https://yandex.ru/maps/?ll=${ll}&z=${zoom}&pt=${ll}`
    : `https://yandex.ru/maps/?text=${encodeURIComponent(address)}`)

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-muted">
      <div className="relative w-full" style={{ height }}>
        {shown ? (
          <iframe
            src={widgetSrc}
            title={`Карта: ${address}`}
            className="h-full w-full border-0"
            allowFullScreen
            loading="lazy"
          />
        ) : (
          <button
            onClick={() => setShown(true)}
            style={{ cursor: "pointer" }}
            className="group flex h-full w-full flex-col items-center justify-center gap-2 bg-card transition-colors hover:bg-muted"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary transition-transform group-hover:scale-110">
              <Icon name="MapPin" size={22} />
            </span>
            <span className="text-sm font-medium">Показать карту</span>
            <span className="max-w-xs px-4 text-center text-xs text-foreground/50">{address}</span>
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-card px-4 py-3">
        <a
          href={openUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 whitespace-nowrap text-sm font-medium text-primary hover:underline"
        >
          Открыть в Яндекс.Картах
          <Icon name="ArrowRight" size={14} />
        </a>
      </div>
    </div>
  )
}