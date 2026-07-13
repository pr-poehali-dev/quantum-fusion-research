// Общие типы складского модуля (вынесено из WarehouseTab.tsx при рефакторинге).

export interface Store {
  id: number
  name: string
  code: string
  created_at: string
}

export interface Supply {
  id: number
  group_id: number
  store_id: number | null
  store_name: string | null
  store_code: string | null
  qty: number
  qty_reserved: number
  cost_price: number
  cell: string | null
  purchase_date: string | null
  warranty_until: string | null
  created_at: string
  has_vat?: boolean
  price_with_vat?: number | null
}

export interface PricePoint {
  price_retail: number
  avg_cost: number
  recorded_at: string
}

export interface Group {
  id: number
  product_id: number | null
  name: string
  sku: string
  category: string | null
  part_number: string | null
  warranty_months: number
  price_retail: number
  price_opt1: number
  price_opt2: number
  url_site: string | null
  url_supplier: string | null
  is_archived: boolean
  created_at: string
  updated_at: string
  qty_total: number
  qty_reserved: number
  qty_negative: number
  avg_cost: number
  cell: string | null
  is_used?: boolean
  price_history: PricePoint[]
  supplies?: Supply[]
}

export type RemoteHit = {
  serial: string
  store_code: string | null
  store_name: string | null
  product_name: string | null
  purchase_date: string | null
}

export type ReserveFilter = null | 'all' | 'only' | 'negative'

export type InvItem = {
  id: number
  group_id: number
  name: string
  category: string
  cell: string
  qty_expected: number
  qty_reserved: number
  qty_actual: number | null
  note: string
}

export type InventoryRecord = {
  id: number
  filter_desc: { cells?: string[]; cats?: string[] }
  status: string
  total_items: number
  filled_items: number
  changes_count: number
  applied_list: { name: string; delta: number }[]
  applied_at: string | null
  created_at: string | null
}

export type OverflowItem = {
  group_id: number
  name: string
  delta: number
  qty_actual: number
  qty_expected: number
  cell: string
}