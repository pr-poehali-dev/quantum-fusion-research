export interface Order {
  id: number
  customer_name: string
  customer_phone: string
  customer_email: string
  order_type: string
  items: Array<{ name: string; price: number; quantity: number }>
  total: number
  comment: string
  status: string
  created_at: string
}

export interface Product {
  id: number
  name: string
  price: number
  old_price: number | null
  in_stock: boolean
  category: { name: string } | null
  description: string
  specs: Record<string, string>
  sort_order: number
  is_featured: boolean
  image_url: string | null
  image_urls: string[]
}

export interface Category {
  id: number
  name: string
  slug: string
}

export interface ConfigComponent {
  id: number
  slot: string
  name: string
  brand?: string
  price: number
}

export interface Tag {
  id: number
  name: string
  color: string
  sort_order: number
}

export interface PCBuild {
  id: number
  name: string
  description: string
  image_urls: string[]
  components: Array<{ slot: string; name: string; price: number; source: string; source_id?: number; current_price?: number; qty?: number }>
  parts_total: number
  assembly_type: string
  assembly_fee: number
  total_price: number
  status: string
  is_featured: boolean
  client_token: string | null
  client_user_id: number | null
  parent_id: number | null
  tags?: Tag[]
}

export interface AdminUser {
  id: number
  email: string
  username: string
  user_tag: string
  avatar_url: string
  role: string
  is_premium: boolean
  status: string
  warning_count: number
  is_muted: boolean
  created_at: string
}

export interface Article {
  id: number
  title: string
  slug: string
  excerpt: string | null
  image_url: string | null
  category: string
  is_published: boolean
  views: number
  created_at: string
}

export interface WipBuild {
  id: number | null
  order_number: string
  stage: string
  contact: string
  delivery_type: string
  delivery_address: string
  received_at: string
  issued_at: string
  comment: string
  cpu: string; motherboard: string; ram: string; gpu: string
  storage: string; psu: string; case_name: string; cooling: string; extra: string
  cpu_status: string; motherboard_status: string; ram_status: string; gpu_status: string
  storage_status: string; psu_status: string; case_status: string; cooling_status: string; extra_status: string
  order_id: number | null
  build_id?: number | null
  client_token?: string | null
  customer_name?: string
  customer_phone?: string
  total?: number
  order_status?: string
  created_at?: string
  updated_at?: string
}

export const ADMIN_PASSWORD = "begraphics2024"

export const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  new: { label: "Заказ новый", color: "text-primary bg-primary/10" },
  processing: { label: "Заказ в работе", color: "text-accent bg-accent/10" },
  done: { label: "Заказ выполнен", color: "text-green-400 bg-green-400/10" },
  cancelled: { label: "Отменён", color: "text-foreground/50 bg-muted" },
}

export const ACTIVE_STATUSES = ["new", "processing"]
export const ARCHIVE_STATUSES = ["done", "cancelled"]

export const BUILD_STATUS: Record<string, string> = {
  catalog: "На сайте",
  client: "Для клиента",
  archive: "Архив",
  draft: "Черновик",
}

export const SLOT_LABELS: Record<string, string> = {
  cpu: "Процессор", gpu: "Видеокарта", ram: "ОЗУ",
  storage: "Накопитель", psu: "БП", case: "Корпус", motherboard: "Материнская плата",
}

export const EMPTY_WIP: WipBuild = {
  id: null, order_number: "", stage: "Согласование", contact: "",
  delivery_type: "", delivery_address: "", received_at: "", issued_at: "", comment: "",
  cpu: "", motherboard: "", ram: "", gpu: "", storage: "", psu: "", case_name: "", cooling: "", extra: "",
  cpu_status: "pending", motherboard_status: "pending", ram_status: "pending", gpu_status: "pending",
  storage_status: "pending", psu_status: "pending", case_status: "pending", cooling_status: "pending", extra_status: "pending",
  order_id: null,
}

export const WIP_STAGES = [
  "Согласование", "Заказ", "Ожидание железа", "Ожидание сборки",
  "Сборка", "Настройка", "Тесты", "Досборать",
  "Проверка перед выдачей", "Ожидание упаковки",
  "Готов, можно забрать", "Отнести в сдэк", "Забрали",
]

export const WIP_STAGE_COLORS: Record<string, string> = {
  "Согласование": "bg-muted text-foreground/60",
  "Заказ": "bg-blue-500/15 text-blue-400",
  "Ожидание железа": "bg-yellow-500/15 text-yellow-400",
  "Ожидание сборки": "bg-orange-500/20 text-orange-400",
  "Сборка": "bg-blue-600/20 text-blue-300",
  "Настройка": "bg-blue-700/20 text-blue-300",
  "Тесты": "bg-purple-500/15 text-purple-400",
  "Досборать": "bg-red-500/15 text-red-400",
  "Проверка перед выдачей": "bg-teal-500/15 text-teal-400",
  "Ожидание упаковки": "bg-cyan-500/15 text-cyan-400",
  "Готов, можно забрать": "bg-green-600/20 text-green-400",
  "Отнести в сдэк": "bg-green-700/20 text-green-300",
  "Забрали": "bg-muted/50 text-foreground/30",
}

export const COMP_STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  pending:         { label: "—",        cls: "bg-muted/50 text-foreground/30" },
  need_order:      { label: "Заказать", cls: "bg-red-500/15 text-red-400" },
  ordered_delay:   { label: "Задержка", cls: "bg-orange-500/15 text-orange-400" },
  ordered_transit: { label: "Едет",     cls: "bg-yellow-500/15 text-yellow-400" },
  ready:           { label: "Есть",     cls: "bg-green-500/20 text-green-400" },
}

export const WIP_COMPONENTS: { key: string; label: string }[] = [
  { key: "cpu", label: "Процессор" },
  { key: "motherboard", label: "Плата" },
  { key: "ram", label: "Память" },
  { key: "gpu", label: "Видеокарта" },
  { key: "storage", label: "Накопитель" },
  { key: "psu", label: "БП" },
  { key: "case_name", label: "Корпус" },
  { key: "cooling", label: "Охлаждение" },
  { key: "extra", label: "Доп." },
]

export const DELIVERY_OPTIONS = [
  "Самовывоз Беляево",
  "Самовывоз Новокосино",
  "СДЭК (за счёт клиента)",
  "Курьер Яндекс по МСК (за счёт клиента)",
]

export const TAG_COLOR_CLASSES: Record<string, string> = {
  primary: "bg-primary/15 text-primary border-primary/30",
  green: "bg-green-400/15 text-green-400 border-green-400/30",
  blue: "bg-blue-400/15 text-blue-400 border-blue-400/30",
  orange: "bg-orange-400/15 text-orange-400 border-orange-400/30",
  purple: "bg-purple-400/15 text-purple-400 border-purple-400/30",
  red: "bg-red-400/15 text-red-400 border-red-400/30",
}

export const TAG_COLORS = [
  { value: "primary", label: "Акцент" },
  { value: "green", label: "Зелёный" },
  { value: "blue", label: "Синий" },
  { value: "orange", label: "Оранжевый" },
  { value: "purple", label: "Фиолетовый" },
  { value: "red", label: "Красный" },
]

export type AdminTab = "orders" | "orders_archive" | "wip_builds" | "products" | "add_product" | "builds" | "archive" | "add_build" | "tags" | "articles" | "add_article"
export const VALID_TABS: AdminTab[] = ["orders", "orders_archive", "wip_builds", "products", "add_product", "builds", "archive", "add_build", "tags", "articles", "add_article"]