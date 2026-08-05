import React from "react"
import { Tag, WipBuild, AdminTab } from "./types"

// Ключ sessionStorage, под которым хранится введённый администратором пароль.
// Сам пароль проверяется на бэкенде по секрету ADMIN_KEY (см. AdminGuard).
export const ADMIN_KEY_STORAGE = "begraphics_admin_key"

// Возвращает текущий админ-пароль (введённый при входе) для админ-запросов.
// Пустая строка, если не залогинен.
export function getAdminKey(): string {
  try { return sessionStorage.getItem(ADMIN_KEY_STORAGE) || "" } catch { return "" }
}

export const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  new: { label: "Заказ новый", color: "text-primary bg-primary/10" },
  processing: { label: "Заказ в работе", color: "text-accent bg-accent/10" },
  done: { label: "Заказ выполнен", color: "text-green-400 bg-green-400/10" },
  cancelled: { label: "Отменён", color: "text-foreground/50 bg-muted" },
}

export const PC_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  // по orders.status (фолбэк)
  new:              { label: "Согласование",        color: "text-primary bg-primary/10" },
  ordering:         { label: "Заказ комплектующих", color: "text-orange-400 bg-orange-400/10" },
  waiting_assembly: { label: "Ожидание сборки",     color: "text-yellow-400 bg-yellow-400/10" },
  assembly:         { label: "Сборка",              color: "text-accent bg-accent/10" },
  done:             { label: "Выдан",               color: "text-green-400 bg-green-400/10" },
  cancelled:        { label: "Отменён",             color: "text-foreground/50 bg-muted" },
  // по wip_builds.stage (русские ключи — зеркало)
  "Согласование":          { label: "Согласование",           color: "text-primary bg-primary/10" },
  "Заказ":                 { label: "Заказ комплектующих",    color: "text-orange-400 bg-orange-400/10" },
  "Ожидание железа":       { label: "Ожидание железа",        color: "text-yellow-400 bg-yellow-400/10" },
  "Ожидание сборки":       { label: "Ожидание сборки",        color: "text-yellow-400 bg-yellow-400/10" },
  "Сборка":                { label: "Сборка",                 color: "text-accent bg-accent/10" },
  "Настройка":             { label: "Настройка",              color: "text-accent bg-accent/10" },
  "Тесты":                 { label: "Тесты",                  color: "text-purple-400 bg-purple-400/10" },
  "Досборать":             { label: "Досборать",              color: "text-red-400 bg-red-400/10" },
  "Проверка перед выдачей":{ label: "Проверка перед выдачей", color: "text-teal-400 bg-teal-400/10" },
  "Ожидание упаковки":     { label: "Ожидание упаковки",      color: "text-cyan-400 bg-cyan-400/10" },
  "Готов, можно забрать":  { label: "Готов, можно забрать",   color: "text-green-400 bg-green-400/10" },
  "Отнести в сдэк":        { label: "Отнести в сдэк",         color: "text-green-400 bg-green-400/10" },
  "Забрали":               { label: "Выдан",                  color: "text-green-400 bg-green-400/10" },
  "Отменён":               { label: "Отменён",                color: "text-foreground/50 bg-muted" },
  "Архив":                 { label: "Выдан",                  color: "text-green-400 bg-green-400/10" },
}

export const ACTIVE_STATUSES = ["new", "processing", "ordering", "waiting_assembly", "assembly"]
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

export const WIP_STAGES = [
  "Согласование", "Заказ", "Ожидание железа", "Ожидание сборки",
  "Сборка", "Настройка", "Тесты", "Досборать",
  "Проверка перед выдачей", "Ожидание упаковки",
  "Готов, можно забрать", "Отнести в сдэк", "Забрали", "Отменён", "Архив",
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
  "Отменён": "bg-red-900/30 text-red-400/70",
  "Архив": "bg-muted/30 text-foreground/20",
}

export const COMP_STATUS_BG: Record<string, string> = {
  pending:          "",
  need_order:       "bg-red-500/8",
  ordered_delay:    "bg-orange-500/8",
  ordered_transit:  "bg-yellow-500/8",
  ready:            "bg-green-500/8",
}

export const COMP_STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  pending:          { label: "—",          cls: "bg-muted/50 text-foreground/30" },
  need_order:       { label: "Заказать",   cls: "bg-red-500/15 text-red-400" },
  ordered_delay:    { label: "Задержка",   cls: "bg-orange-500/15 text-orange-400" },
  ordered_transit:  { label: "Едет",       cls: "bg-yellow-500/15 text-yellow-400" },
  ready:            { label: "Есть",       cls: "bg-green-500/20 text-green-400" },
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

export const EMPTY_WIP: WipBuild = {
  id: null, order_number: "", stage: "Согласование", contact: "",
  delivery_type: "", delivery_address: "", received_at: "", issued_at: "", comment: "",
  cpu: "", motherboard: "", ram: "", gpu: "", storage: "", psu: "", case_name: "", cooling: "", extra: "",
  cpu_status: "pending", motherboard_status: "pending", ram_status: "pending", gpu_status: "pending",
  storage_status: "pending", psu_status: "pending", case_status: "pending", cooling_status: "pending", extra_status: "pending",
  order_id: null, for_sale: false,
}

export const VALID_TABS: AdminTab[] = ["orders", "orders_archive", "wip_builds", "wip_archive", "products", "add_product", "builds", "archive", "add_build", "tags", "articles", "add_article", "warehouse", "sn_archive", "compatibility", "users", "schedule", "calendar", "finance", "analytics", "faq", "promos", "cables", "rma", "quiz_requests", "price_monitor", "stress", "company_settings", "telegram_bot"]

export function TagBadge({ tag }: { tag: Tag }) {
  const cls = TAG_COLOR_CLASSES[tag.color] || TAG_COLOR_CLASSES.primary
  return React.createElement(
    "span",
    { className: `inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}` },
    tag.name
  )
}
