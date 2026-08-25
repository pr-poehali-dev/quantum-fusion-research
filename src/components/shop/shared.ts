export interface Product {
  id: number
  name: string
  description: string
  price: number
  old_price: number | null
  image_url: string | null
  image_urls?: string[]
  specs: Record<string, string>
  in_stock: boolean
  is_featured: boolean
  is_used?: boolean
  avg_cost: number
  category: { id: number; name: string; slug: string } | null
  // SEO-поля из админки (вкладка «SEO»). Пусто — берётся автоматический вариант.
  slug?: string | null
  meta_title?: string | null
  meta_description?: string | null
}

export interface Category {
  id: number
  name: string
  slug: string
  description: string
}

export interface BuildTag {
  id: number
  name: string
  color: string
}

export interface Build {
  id: number
  name: string
  description: string
  total_price: number
  parts_total: number
  assembly_fee: number
  assembly_type: string
  components: Array<{ name: string; slot: string; current_price: number; price: number }>
  image_urls: string[]
  status: string
  is_featured: boolean
  in_stock: boolean
  reserved?: boolean
  parent_id: number | null
  client_token: string | null
  tags?: BuildTag[]
  variantsCount?: number
}

export interface CommunityBuild {
  id: number
  name: string
  username: string
  components: Array<{ slot: string; name: string; price: number; qty: number }>
  parts_total: number
  assembly_fee: number
  total_price: number
  share_token: string
  short_code?: string
  created_at: string
}

/**
 * Есть ли у товара хоть одна фотография.
 *
 * Раньше по этому признаку товары СКРЫВАЛИ из каталога. Теперь показываем все,
 * а признак используем только для сортировки: карточки с настоящими фото
 * идут выше, чем заглушки «Фото готовится».
 */
export const hasPhoto = (p: { image_url?: string | null; image_urls?: string[] }): boolean =>
  !!(p.image_url || (p.image_urls && p.image_urls.length > 0))

export const TAG_COLOR_MAP: Record<string, string> = {
  primary: "border-primary/40 bg-primary/15 text-primary",
  green: "border-green-400/40 bg-green-400/15 text-green-400",
  blue: "border-blue-400/40 bg-blue-400/15 text-blue-400",
  orange: "border-orange-400/40 bg-orange-400/15 text-orange-400",
  purple: "border-purple-400/40 bg-purple-400/15 text-purple-400",
  red: "border-red-400/40 bg-red-400/15 text-red-400",
}

export function getTagClass(color: string) {
  return TAG_COLOR_MAP[color] || TAG_COLOR_MAP.primary
}

// Расстояние Левенштейна — для «плюс-минус» распознавания категории с ошибками
export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    }
  }
  return dp[m][n]
}

// Подбирает наиболее похожую категорию по введённому тексту (с опечатками).
// Возвращает категорию или null, если уверенного совпадения нет.
export function matchCategory<T extends { name: string; slug: string }>(query: string, categories: T[]): T | null {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return null
  let best: T | null = null
  let bestScore = Infinity
  for (const c of categories) {
    const name = c.name.toLowerCase()
    const slug = c.slug.toLowerCase()
    // Прямое вхождение — мгновенно
    if (name.includes(q) || slug.includes(q) || q.includes(name) || q.includes(slug)) return c
    // Похожесть по словам названия
    const candidates = [name, slug, ...name.split(/\s+/)]
    for (const cand of candidates) {
      const d = levenshtein(q, cand)
      const maxLen = Math.max(q.length, cand.length)
      const ratio = d / maxLen
      if (ratio < 0.45 && d < bestScore) { bestScore = d; best = c }
    }
  }
  return best
}

export const SLOT_NAMES: Record<string, string> = {
  cpu: "Процессор", gpu: "Видеокарта", ram: "Оперативная память",
  storage: "Накопитель", psu: "Блок питания", case: "Корпус", motherboard: "Материнская плата",
}

export const SLOT_ICONS: Record<string, string> = {
  cpu: "Cpu", gpu: "Monitor", ram: "MemoryStick", storage: "HardDrive",
  psu: "Zap", case: "Package", motherboard: "CircuitBoard",
}