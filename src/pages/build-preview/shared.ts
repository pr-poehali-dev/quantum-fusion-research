import { api } from "@/lib/api"

export const SLOT_NAMES: Record<string, string> = {
  cpu: "Процессор", gpu: "Видеокарта", ram: "Оперативная память",
  storage: "Накопитель", psu: "Блок питания", case: "Корпус", motherboard: "Материнская плата",
  cooling: "Охлаждение", extra: "Доп. комплектующие",
}

// Маппинг слот → поле статуса в wip_builds
export const SLOT_TO_WIP: Record<string, string> = {
  cpu: "cpu", gpu: "gpu", ram: "ram", storage: "storage",
  psu: "psu", case: "case", motherboard: "motherboard",
  cooling: "cooling", extra: "extra",
}

export const COMPONENT_STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  pending:         { label: "Обрабатывается",     cls: "bg-muted/60 text-foreground/50" },
  need_order:      { label: "Надо заказать",       cls: "bg-orange-500/15 text-orange-400" },
  ordered_delay:   { label: "Заказано, задержка",  cls: "bg-yellow-500/15 text-yellow-400" },
  ordered_transit: { label: "Едет к нам",          cls: "bg-blue-500/15 text-blue-400" },
  ready:           { label: "Готово / в наличии",  cls: "bg-green-600/20 text-green-400" },
}

export interface Component {
  slot: string; name: string; price: number; current_price?: number; qty?: number
  source_id?: number; image_url?: string; image_urls?: string[]; description?: string; specs?: Record<string, string>
  point?: { x: number; y: number } | null
  points?: { x: number; y: number }[] | null  // несколько точек (для qty>1)
}

// Все точки компонента на фото (несколько — для qty>1). Совмещает новое поле
// points и старое одиночное point (обратная совместимость).
export function compPoints(c: Component): { x: number; y: number }[] {
  if (c.points && c.points.length) return c.points
  if (c.point) return [c.point]
  return []
}
// Репрезентативная точка (центр всех) — для выбора стороны/угла подписи.
export function compCenter(c: Component): { x: number; y: number } | null {
  const pts = compPoints(c)
  if (!pts.length) return null
  const x = pts.reduce((s, p) => s + p.x, 0) / pts.length
  const y = pts.reduce((s, p) => s + p.y, 0) / pts.length
  return { x, y }
}

export interface BuildTag { id: number; name: string; color: string }

export interface WipInfo {
  stage: string
  received_at?: string
  issued_at?: string
  delivery_type?: string
  cpu_status?: string; motherboard_status?: string; ram_status?: string; gpu_status?: string
  storage_status?: string; psu_status?: string; case_status?: string; cooling_status?: string; extra_status?: string
  total?: number
  prepayment_amount?: number
  prepayment_confirmed_amount?: number
  remaining_amount?: number
  order_number?: string
}

// Прогон стресс-тестов по заказу — показываем клиенту на его странице сборки
export interface BuildTestRun {
  public_code: string
  profile_name: string
  started_at?: string
  finished_at?: string
  total_tests: number
  passed_tests: number
  failed_tests: number
  status: string
  gpu_maintenance?: boolean
}

export interface Build {
  id: number; name: string; description: string; components: Component[]
  parts_total: number; assembly_fee: number; total_price: number
  assembly_type: string; image_urls: string[]
  is_featured?: boolean; status?: string
  client_token?: string | null; client_user_id?: number | null; parent_id?: number | null
  sell_with_vat?: boolean
  lock_prices?: boolean
  tags?: BuildTag[]
  // SEO-поля из админки (вкладка «SEO»). Пусто — берётся автоматический вариант.
  slug?: string | null
  meta_title?: string | null
  meta_description?: string | null
}

// Продажа с НДС: +22% и округление вверх до 250 ₽ (единая формула проекта)
export const withVat = (base: number, vat?: boolean) => vat ? Math.ceil(base * 1.22 / 250) * 250 : base

export const DELIVERY_DESCRIPTIONS: Record<string, { title: string; desc: string }> = {
  "Самовывоз Беляево":    { title: "Самовывоз · Беляево", desc: "м. Беляево, Профсоюзная ул. Уточним адрес при подтверждении." },
  "Самовывоз Новокосино": { title: "Самовывоз · Новокосино", desc: "м. Новокосино. Уточним адрес при подтверждении." },
  "СДЭК (за счёт клиента)":                    { title: "Доставка СДЭК", desc: "Отправим по всей России. Стоимость доставки за счёт получателя." },
  "Курьер Яндекс по МСК (за счёт клиента)":   { title: "Курьер по Москве", desc: "Доставка курьером Яндекс. Стоимость доставки за счёт получателя." },
}

export const WIP_STAGE_COLORS_CLIENT: Record<string, string> = {
  "Согласование":           "bg-muted/60 text-foreground/50",
  "Заказ":                  "bg-blue-500/15 text-blue-400",
  "Ожидание железа":        "bg-yellow-500/15 text-yellow-400",
  "Ожидание сборки":        "bg-orange-500/15 text-orange-400",
  "Сборка":                 "bg-blue-600/15 text-blue-300",
  "Настройка":              "bg-blue-700/15 text-blue-300",
  "Тесты":                  "bg-purple-500/15 text-purple-400",
  "Досборать":              "bg-red-500/15 text-red-400",
  "Проверка перед выдачей": "bg-teal-500/15 text-teal-400",
  "Ожидание упаковки":      "bg-cyan-500/15 text-cyan-400",
  "Готов, можно забрать":   "bg-green-600/20 text-green-400",
  "Отнести в сдэк":         "bg-green-700/15 text-green-300",
  "Забрали":                "bg-muted/40 text-foreground/30",
}

export const TAG_COLOR_MAP: Record<string, string> = {
  primary: "border-primary/40 bg-primary/10 text-primary",
  green: "border-green-400/40 bg-green-400/10 text-green-400",
  blue: "border-blue-400/40 bg-blue-400/10 text-blue-400",
  orange: "border-orange-400/40 bg-orange-400/10 text-orange-400",
  purple: "border-purple-400/40 bg-purple-400/10 text-purple-400",
  red: "border-red-400/40 bg-red-400/10 text-red-400",
}

export const fmt = (n: number) => n.toLocaleString("ru-RU") + " ₽"

// Подтягивает фото каждого компонента из каталога по source_id.
// livePrice=true — также обновляет цену компонента до актуальной цены продажи
// из каталога (для витринных сборок «на показ»). Для сборок в заказах цена
// остаётся зафиксированной (livePrice=false).
export async function enrichComponents(comps: Component[], livePrice = false): Promise<Component[]> {
  const ids = [...new Set(comps.filter(c => c.source_id).map(c => c.source_id!))]
  const products: Record<number, { image_urls?: string[]; image_url?: string; description?: string; price?: number }> = {}
  await Promise.all(ids.map(id =>
    api.products.getById(id).then(p => { if (p?.id) products[id] = p }).catch(() => {})
  ))
  return comps.map(c => {
    if (!c.source_id) return c
    const p = products[c.source_id]
    if (!p) return c
    return {
      ...c,
      image_urls: (p.image_urls && p.image_urls.length > 0) ? p.image_urls : undefined,
      image_url: p.image_url || (p.image_urls && p.image_urls[0]) || c.image_url,
      description: c.description || p.description,
      // Актуальная цена каталога — только для витринных сборок
      current_price: livePrice && typeof p.price === "number" ? p.price : c.current_price,
    }
  })
}

// Обогащает компоненты ВСЕХ вариантов данными товара (фото/описание).
// ЦЕНЫ (current_price) уже проставлены бэкендом с учётом флага lock_prices:
// lock_prices=false → актуальная цена каталога, lock_prices=true → зафиксированная.
// Поэтому livePrice здесь НЕ трогаем (передаём false), чтобы не перезатирать.
export async function enrichVariants(list: Build[]): Promise<Build[]> {
  return Promise.all(list.map(async (b) => ({
    ...b,
    components: await enrichComponents(b.components || [], false),
  })))
}