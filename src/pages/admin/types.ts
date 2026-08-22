// Только типы и интерфейсы админки.
// Константы, функции и значения-хелперы вынесены в ./constants.ts

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
  partner_company_id?: number | null
  partner_company_name?: string
}

export interface PartnerCompany {
  id: number
  name: string
  tier: string           // basic | close | paid
  status: string         // active | suspended
  trial_ends_at: string | null
  trial_active: boolean
  stress_ingest_token: string
  contact_name: string
  contact_phone: string
  note: string
  users_count: number
  created_at: string | null
}

export interface Order {
  id: number
  display_number?: string
  customer_name: string
  customer_phone: string
  customer_email: string
  order_type: string
  items: Array<{ name: string; price: number; quantity: number; preorder?: boolean }>
  total: number
  comment: string
  status: string
  created_at: string
  wip_stage?: string | null
  prepayment_percent?: number
  prepayment_amount?: number
  remaining_amount?: number
  prepayment_confirmed?: boolean
  remaining_paid?: boolean
  for_sale?: boolean
  is_stock_sale?: boolean
  quiz_request_id?: number | null
}

export interface Product {
  id: number
  name: string
  price: number
  old_price: number | null
  in_stock: boolean
  stock_qty?: number
  category: { name: string } | null
  description: string
  specs: Record<string, string>
  sort_order: number
  is_featured: boolean
  is_used?: boolean
  /** Товар убран из каталога, но может оставаться на складе. */
  is_archived?: boolean
  warranty_months?: number
  image_url: string | null
  image_urls: string[]
  brand_id?: number | null
  brand?: string | null
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
  /** Остаток на складе — показываем прямо в поиске состава сборки. */
  stock_qty?: number
  /** Товар в архиве каталога (но может лежать на складе). */
  is_archived?: boolean
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
  components: Array<{ slot: string; name: string; price: number; source: string; source_id?: number; current_price?: number; qty?: number; point?: { x: number; y: number } | null; points?: { x: number; y: number }[] | null }>
  parts_total: number
  assembly_type: string
  assembly_fee: number
  total_price: number
  status: string
  is_featured: boolean
  in_stock: boolean
  client_token: string | null
  short_code?: string | null
  client_user_id: number | null
  parent_id: number | null
  sell_with_vat?: boolean
  lock_prices?: boolean
  tags?: Tag[]
}

export interface Article {
  id: number
  title: string
  slug: string
  excerpt: string | null
  image_url: string | null
  image_urls?: string[]
  category: string
  categories?: string[]
  is_published: boolean
  views: number
  created_at: string
  content?: string
  html_attachment?: string | null
  toc?: { title: string; anchor: string }[]
  tier_cards?: { title: string; image_url: string; rank: string | null; product_id?: number; anchor?: string }[]
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
  build_components?: Array<{ slot: string; name: string; qty?: number }>
  need_by_slot?: Record<string, number>
  customer_name?: string
  customer_phone?: string
  total?: number
  order_status?: string
  prepayment_percent?: number
  prepayment_amount?: number
  remaining_amount?: number
  assembled_by?: number | null
  assembler_name?: string | null
  for_sale?: boolean
  source_id?: number | null
  source_name?: string | null
  created_at?: string
  updated_at?: string
}

export type AdminTab = "orders" | "orders_archive" | "wip_builds" | "wip_archive" | "products" | "add_product" | "builds" | "archive" | "add_build" | "tags" | "articles" | "add_article" | "warehouse" | "sn_archive" | "compatibility" | "users" | "schedule" | "calendar" | "finance" | "analytics" | "faq" | "promos" | "cables" | "rma" | "quiz_requests" | "price_monitor" | "stress" | "company_settings" | "telegram_bot" | "user_builds"