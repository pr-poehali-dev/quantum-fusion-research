import React, { useRef, useState, useEffect } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { ImageUploader } from "@/components/image-uploader"
import RichTextEditor from "@/components/ui/rich-text-editor"
import { CableBody } from "@/components/cable-configurator"
import {
  Product, Category, ConfigComponent, Tag, PCBuild, Article, AdminTab,
  BUILD_STATUS, TAG_COLORS, TAG_COLOR_CLASSES, TagBadge,
} from "@/pages/admin/types"
import { BuildRow, BuildsList } from "./BuildsList"
import BrandsManager from "./BrandsManager"

interface Props {
  tab: AdminTab
  setTab: (t: AdminTab) => void
  loading: boolean
  // Products
  products: Product[]
  categories: Category[]
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>
  setCategories: React.Dispatch<React.SetStateAction<Category[]>>
  // Builds
  builds: PCBuild[]
  setBuilds: React.Dispatch<React.SetStateAction<PCBuild[]>>
  configSlots: Record<string, ConfigComponent[]>
  setConfigSlots: React.Dispatch<React.SetStateAction<Record<string, ConfigComponent[]>>>
  tags: Tag[]
  setTags: React.Dispatch<React.SetStateAction<Tag[]>>
  // Articles
  articles: Article[]
  setArticles: React.Dispatch<React.SetStateAction<Article[]>>
  // авто-открытие сборки на редактирование (из WIP)
  autoEditBuildId?: number | null
  clearAutoEditBuildId?: () => void
}

export function AdminCatalogTab({
  tab, setTab, loading,
  products, categories, setProducts, setCategories,
  builds, setBuilds, configSlots, setConfigSlots,
  tags, setTags,
  articles, setArticles,
  autoEditBuildId, clearAutoEditBuildId,
}: Props) {
  const fmt = (n: number) => n.toLocaleString("ru-RU") + " ₽"

  // ── Products ──────────────────────────────────────────────────────────────
  const [productCatFilter, setProductCatFilter] = useState("all")
  const [productFillFilter, setProductFillFilter] = useState<"all" | "new" | "filled">("all")
  const [productSearch, setProductSearch] = useState("")
  const [showArchived, setShowArchived] = useState(false)
  const [archivedProducts, setArchivedProducts] = useState<Product[]>([])
  const [archivedLoading, setArchivedLoading] = useState(false)

  const loadArchived = async () => {
    setArchivedLoading(true)
    const d = await api.products.getAll({ include_archived: "true" })
    setArchivedProducts((d.products || []).filter((p: Product & { is_archived?: boolean }) => p.is_archived))
    setArchivedLoading(false)
  }
  const toggleArchiveView = () => {
    const next = !showArchived
    setShowArchived(next)
    if (next) loadArchived()
  }
  const restoreProduct = async (id: number) => {
    await api.products.restore(id)
    setArchivedProducts(ps => ps.filter(p => p.id !== id))
  }

  // ── Тогл архива сборок ──
  const [buildsViewArchive, setBuildsViewArchive] = useState(false)

  // ── Массовый выбор ──
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [bulkLoading, setBulkLoading] = useState(false)
  useEffect(() => { setSelected(new Set()) }, [showArchived])
  const toggleSelect = (id: number) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const toggleSelectAll = (ids: number[]) => setSelected(prev =>
    ids.every(id => prev.has(id)) ? new Set() : new Set(ids)
  )
  const bulkArchive = async () => {
    if (!confirm(`Архивировать выбранные товары (${selected.size})?`)) return
    setBulkLoading(true)
    const ids = [...selected]
    await Promise.all(ids.map(id => api.products.delete(id)))
    setProducts(ps => ps.filter(p => !selected.has(p.id)))
    setSelected(new Set())
    setBulkLoading(false)
  }
  const bulkRestore = async () => {
    setBulkLoading(true)
    const ids = [...selected]
    await Promise.all(ids.map(id => api.products.restore(id)))
    setArchivedProducts(ps => ps.filter(p => !selected.has(p.id)))
    setSelected(new Set())
    setBulkLoading(false)
  }
  const [productForm, setProductForm] = useState({
    id: null as number | null,
    category_id: "", brand_id: "", name: "", description: "", price: "", old_price: "", warranty_months: "0",
    image_urls: [] as string[], specs: "", in_stock: true, is_featured: false, is_used: false, sort_order: "0",
  })
  const [importLoading, setImportLoading] = useState(false)
  const [exportLoading, setExportLoading] = useState(false)
  // Справочник брендов (для выпадающего списка в форме товара)
  const [brands, setBrands] = useState<{ id: number; name: string }[]>([])
  const [showBrandsManager, setShowBrandsManager] = useState(false)
  const loadBrands = () => api.brands.getAll().then(d => setBrands(d.brands || [])).catch(() => {})
  useEffect(() => { loadBrands() }, [])

  const deleteProduct = async (id: number) => {
    if (!confirm("Архивировать товар? Он скроется из каталога, но данные сохранятся.")) return
    await api.products.delete(id)
    setProducts(ps => ps.filter(p => p.id !== id))
  }
  const editProduct = (p: Product) => {
    // Отрезаем префикс бренда от имени, чтобы поле «Название» было без бренда
    // (в БД имя хранится цельным: "{Бренд} {Название}").
    const brandName = p.brand_id ? (brands.find(b => b.id === p.brand_id)?.name || p.brand || "") : ""
    let nameNoBrand = p.name
    if (brandName && p.name.toLowerCase().startsWith(brandName.toLowerCase() + " ")) {
      nameNoBrand = p.name.slice(brandName.length).trimStart()
    }
    setProductForm({
      id: p.id,
      category_id: p.category ? String(categories.find(c => c.name === p.category?.name)?.id || "") : "",
      brand_id: p.brand_id ? String(p.brand_id) : "",
      name: nameNoBrand, description: p.description || "",
      price: String(p.price), old_price: p.old_price ? String(p.old_price) : "",
      warranty_months: String(p.warranty_months ?? 0),
      image_urls: p.image_urls?.length ? p.image_urls : (p.image_url ? [p.image_url] : []),
      specs: JSON.stringify(p.specs || {}),
      in_stock: p.in_stock, is_featured: p.is_featured, is_used: !!p.is_used, sort_order: String(p.sort_order || 0),
    })
    setTab("add_product")
  }
  const submitProduct = async (e: React.FormEvent) => {
    e.preventDefault()
    // Цена и гарантия подтягиваются со склада, обязательна только категория
    if (!productForm.category_id) { alert("Выберите категорию"); return }
    let specs = {}
    try { specs = JSON.parse(productForm.specs || "{}") } catch { specs = {} }
    // Склеиваем имя как "{Бренд} {Название}" — в БД хранится цельным текстом,
    // а brand_id держим отдельно. Не дублируем бренд, если уже введён в начале.
    const brandName = productForm.brand_id ? (brands.find(b => String(b.id) === productForm.brand_id)?.name || "") : ""
    const rawName = productForm.name.trim()
    const fullName = (brandName && !rawName.toLowerCase().startsWith(brandName.toLowerCase()))
      ? `${brandName} ${rawName}`.trim()
      : rawName
    const payload = {
      id: productForm.id,
      category_id: productForm.category_id ? Number(productForm.category_id) : null,
      brand_id: productForm.brand_id ? Number(productForm.brand_id) : null,
      name: fullName, description: productForm.description,
      price: Number(productForm.price), old_price: productForm.old_price ? Number(productForm.old_price) : null,
      warranty_months: Number(productForm.warranty_months) || 0,
      image_url: productForm.image_urls[0] || null, image_urls: productForm.image_urls, specs,
      is_featured: productForm.is_featured, is_used: productForm.is_used,
      sort_order: Number(productForm.sort_order),
    }
    if (productForm.id) await api.products.update(payload)
    else await api.products.create(payload)
    setTab("products")
    setProductForm({ id: null, category_id: "", brand_id: "", name: "", description: "", price: "", old_price: "", warranty_months: "0", image_urls: [], specs: "", in_stock: true, is_featured: false, is_used: false, sort_order: "0" })
  }
  const handleExportExcel = async () => {
    setExportLoading(true)
    const res = await api.syncProducts.exportExcel()
    setExportLoading(false)
    if (res.file_b64) {
      const bin = atob(res.file_b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a"); a.href = url; a.download = "products.xlsx"; a.click()
      URL.revokeObjectURL(url)
    }
  }
  const handleImportExcel = async (file: File) => {
    setImportLoading(true)
    const reader = new FileReader()
    reader.onload = async (e) => {
      const b64 = btoa(String.fromCharCode(...new Uint8Array(e.target!.result as ArrayBuffer)))
      const res = await api.syncProducts.importExcel(b64)
      setImportLoading(false)
      if (res.error) { alert("Ошибка: " + res.error); return }
      alert(`Импорт завершён: добавлено ${res.created}, обновлено ${res.updated}, пропущено ${res.skipped}`)
      api.products.getAll().then(d => { setProducts(d.products || []); setCategories(d.categories || []) })
    }
    reader.readAsArrayBuffer(file)
  }

  // ── Builds ────────────────────────────────────────────────────────────────
  const [buildForm, setBuildForm] = useState({
    id: null as number | null,
    name: "", description: "", status: "catalog", is_featured: false, in_stock: false,
    assembly_type: "percent" as "percent" | "manual",
    assembly_fee_manual: "",
    image_urls: [] as string[],
    sell_with_vat: false,
    parent_id: null as number | null,
  })
  const [buildComponents, setBuildComponents] = useState<Array<{
    slot: string; source: "catalog" | "custom"; source_id?: number; name: string; price: number; qty: number; image_urls?: string[]
  }>>([])
  const [expandedComponent, setExpandedComponent] = useState<number | null>(null)
  const [addingSlot, setAddingSlot] = useState<string | null>(null)
  const [componentSearch, setComponentSearch] = useState("")
  const [componentSearchIdx, setComponentSearchIdx] = useState(0)
  const componentSearchRef = useRef<HTMLInputElement>(null)
  const [copiedBuildId, setCopiedBuildId] = useState<number | null>(null)
  const [dupeLoading, setDupeLoading] = useState<number | null>(null)
  const [expandedVariants, setExpandedVariants] = useState<number | null>(null)
  const [buildTagIds, setBuildTagIds] = useState<number[]>([])

  const partsTotal = buildComponents.reduce((s, c) => s + c.price * (c.qty || 1), 0)
  const assemblyFee = buildForm.assembly_type === "percent"
    ? Math.round(partsTotal * 0.07)
    : (parseFloat(buildForm.assembly_fee_manual) || 0)
  const baseTotal = partsTotal + assemblyFee
  // Продажа с НДС: +22% и округление вверх до 250 ₽
  const buildTotal = buildForm.sell_with_vat
    ? Math.ceil(baseTotal * 1.22 / 250) * 250
    : baseTotal

  const editBuild = (b: PCBuild) => {
    setBuildForm({
      id: b.id, name: b.name, description: b.description || "",
      status: b.status, is_featured: b.is_featured, in_stock: b.in_stock ?? false,
      assembly_type: (b.assembly_type as "percent" | "manual") || "percent",
      assembly_fee_manual: b.assembly_fee ? String(b.assembly_fee) : "",
      image_urls: b.image_urls || [],
      sell_with_vat: b.sell_with_vat ?? false,
      parent_id: b.parent_id ?? null,
    })
    setBuildComponents(b.components?.map(c => ({
      slot: c.slot, source: (c.source as "catalog" | "custom") || "catalog",
      source_id: c.source_id, name: c.name, price: c.price || 0,
      qty: c.qty || 1, image_urls: [],
    })) || [])
    setBuildTagIds(b.tags?.map(t => t.id) || [])
    setTab("add_build")
  }

  // Авто-открытие сборки на редактирование (по запросу из WIP)
  useEffect(() => {
    if (!autoEditBuildId) return
    const b = builds.find(x => x.id === autoEditBuildId)
    if (b) {
      editBuild(b)
      clearAutoEditBuildId?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoEditBuildId, builds])

  const submitBuild = async (e: React.FormEvent) => {
    e.preventDefault()
    const asm_fee = buildForm.assembly_type === "manual" ? parseFloat(buildForm.assembly_fee_manual) || 0 : assemblyFee
    const payload = {
      id: buildForm.id,
      name: buildForm.name, description: buildForm.description, status: buildForm.status,
      is_featured: buildForm.is_featured, in_stock: buildForm.in_stock,
      assembly_type: buildForm.assembly_type, assembly_fee: asm_fee,
      parts_total: partsTotal, total_price: buildTotal,
      sell_with_vat: buildForm.sell_with_vat,
      image_urls: buildForm.image_urls,
      parent_id: buildForm.parent_id,
      components: buildComponents.map(c => ({
        slot: c.slot, source: c.source, source_id: c.source_id,
        name: c.name, price: c.price, qty: c.qty, image_urls: c.image_urls,
      })),
    }
    let savedId: number
    if (buildForm.id) {
      await api.builds.update(payload)
      savedId = buildForm.id
    } else {
      const res = await api.builds.create(payload)
      savedId = res.id
    }
    if (savedId && buildTagIds.length >= 0) {
      await api.tags.setForBuild(savedId, buildTagIds)
    }
    const d = await api.builds.getAll()
    setBuilds(Array.isArray(d) ? d : (d.builds || []))
    setBuildForm({ id: null, name: "", description: "", status: "catalog", is_featured: false, in_stock: false, assembly_type: "percent", assembly_fee_manual: "", image_urls: [], sell_with_vat: false, parent_id: null })
    setBuildComponents([])
    setBuildTagIds([])
    setTab("builds")
  }

  const deleteBuild = async (id: number) => {
    if (!confirm("Удалить сборку?")) return
    await api.builds.delete(id)
    setBuilds(bs => bs.filter(b => b.id !== id))
  }

  const duplicateBuild = async (b: PCBuild) => {
    setDupeLoading(b.id)
    const res = await api.builds.create({
      ...b, id: undefined, name: b.name + " (копия)", status: "draft",
      parent_id: b.parent_id ?? b.id, client_token: null,
    })
    if (res.id) {
      const d = await api.builds.getAll()
      setBuilds(Array.isArray(d) ? d : (d.builds || []))
    }
    setDupeLoading(null)
  }

  const generateClientLink = async (b: PCBuild) => {
    // всегда дёргаем бэкенд: он переиспользует токен и догенерит короткий код,
    // если его ещё нет (для старых сборок)
    const res = await api.builds.generateClientLink(b.id)
    const code = res.short_code
    const token = res.client_token || b.client_token
    if (!code && !token) return
    setBuilds(bs => bs.map(bb => bb.id === b.id ? { ...bb, client_token: token, short_code: code } : bb))
    const url = code ? `${window.location.origin}/b/${code}` : `${window.location.origin}/build?token=${token}`
    navigator.clipboard.writeText(url)
    setCopiedBuildId(b.id)
    setTimeout(() => setCopiedBuildId(null), 2500)
  }

  const addCatalogComponent = (slot: string, comp: ConfigComponent) => {
    if (buildComponents.some(c => c.source_id === comp.id)) return
    setBuildComponents(cs => [...cs, { slot, source: "catalog", source_id: comp.id, name: comp.name, price: comp.price, qty: 1 }])
    setAddingSlot(null)
  }

  const removeComponent = (sourceId: number) => {
    setBuildComponents(cs => cs.filter(c => c.source_id !== sourceId))
  }

  const setComponentQty = (sourceId: number, delta: number) => {
    setBuildComponents(cs => cs.map(c => c.source_id === sourceId
      ? { ...c, qty: Math.max(1, (c.qty || 1) + delta) } : c))
  }

  // ── Tags ──────────────────────────────────────────────────────────────────
  const [tagForm, setTagForm] = useState<{ id: number | null; name: string; color: string; sort_order: string }>({ id: null, name: "", color: "primary", sort_order: "0" })
  const [tagFormOpen, setTagFormOpen] = useState(false)

  const submitTag = async (e: React.FormEvent) => {
    e.preventDefault()
    const payload = { id: tagForm.id, name: tagForm.name, color: tagForm.color, sort_order: Number(tagForm.sort_order) }
    if (tagForm.id) await api.tags.update(payload)
    else await api.tags.create(payload)
    const d = await api.tags.getAll()
    setTags(d.tags || [])
    setTagForm({ id: null, name: "", color: "primary", sort_order: "0" })
    setTagFormOpen(false)
  }

  const deleteTag = async (id: number) => {
    if (!confirm("Удалить тег? Он будет снят со всех сборок.")) return
    await api.tags.delete(id)
    setTags(ts => ts.filter(t => t.id !== id))
  }

  // ── Articles ──────────────────────────────────────────────────────────────
  const [articleForm, setArticleForm] = useState({
    id: null as number | null,
    title: "", slug: "", excerpt: "", content: "",
    image_url: "", image_urls: [] as string[], category: "article", is_published: false,
    html_attachment: "",
    toc: [] as { title: string; anchor: string }[],
  })
  const [copiedAnchor, setCopiedAnchor] = useState<string | null>(null)

  // Превратить заголовок пункта в slug-якорь (латиницей)
  const anchorSlug = (s: string) => s.toLowerCase()
    .replace(/[а-яё]/g, m => ({ 'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'j','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'c','ч':'ch','ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya' } as Record<string, string>)[m] || m)
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

  const addTocItem = () => setArticleForm(f => ({ ...f, toc: [...f.toc, { title: "", anchor: `p${f.toc.length + 1}` }] }))
  const updateTocItem = (i: number, patch: Partial<{ title: string; anchor: string }>) =>
    setArticleForm(f => ({ ...f, toc: f.toc.map((t, idx) => idx === i ? { ...t, ...patch } : t) }))
  const removeTocItem = (i: number) =>
    setArticleForm(f => ({ ...f, toc: f.toc.filter((_, idx) => idx !== i) }))
  const copyAnchorTag = (anchor: string) => {
    navigator.clipboard.writeText(`[[#${anchor}]]`)
    setCopiedAnchor(anchor)
    setTimeout(() => setCopiedAnchor(null), 1800)
  }

  const submitArticle = async (e: React.FormEvent) => {
    e.preventDefault()
    const payload = {
      id: articleForm.id,
      title: articleForm.title, slug: articleForm.slug,
      excerpt: articleForm.excerpt || null, content: articleForm.content,
      image_url: articleForm.image_urls[0] || articleForm.image_url || null,
      image_urls: articleForm.image_urls,
      category: articleForm.category, is_published: articleForm.is_published,
      html_attachment: articleForm.html_attachment || null,
      toc: articleForm.toc.filter(t => t.title.trim() && t.anchor.trim()),
    }
    if (articleForm.id) await api.articles.update(payload)
    else await api.articles.create(payload)
    setArticleForm({ id: null, title: "", slug: "", excerpt: "", content: "", image_url: "", image_urls: [], category: "article", is_published: false, html_attachment: "", toc: [] })
    setTab("articles")
  }

  const editArticle = (a: Article) => {
    setArticleForm({
      id: a.id, title: a.title, slug: a.slug,
      excerpt: a.excerpt || "", content: "",
      image_url: a.image_url || "", image_urls: a.image_urls || (a.image_url ? [a.image_url] : []),
      category: a.category, is_published: a.is_published, html_attachment: "", toc: [],
    })
    api.articles.getById(a.id, true).then(full => {
      setArticleForm(f => ({ ...f, content: full.content || "", html_attachment: full.html_attachment || "", image_urls: full.image_urls || f.image_urls || [], toc: full.toc || [] }))
    })
    setTab("add_article")
  }

  const deleteArticle = async (id: number) => {
    if (!confirm("Удалить статью?")) return
    await api.articles.delete(id)
    setArticles(as => as.filter(a => a.id !== id))
  }

  // ── Cables ────────────────────────────────────────────────────────────────
  const [cableAdded, setCableAdded] = useState(false)

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  // PRODUCTS LIST
  if (tab === "products") {
    const isNew = (p: Product) => !p.description && (!p.image_urls?.length && !p.image_url)
    const filtered = products
      .filter(p => productCatFilter === "all" || p.category?.name === productCatFilter)
      .filter(p => productFillFilter === "all" ? true : productFillFilter === "new" ? isNew(p) : !isNew(p))
      .filter(p => !productSearch.trim() || p.name.toLowerCase().includes(productSearch.toLowerCase()))
    return (
      <div>
        <div className="mb-4 flex flex-wrap items-center gap-3 justify-between">
          <h2 className="text-xl font-light text-foreground">{showArchived ? `Архив товаров (${archivedProducts.length})` : `Товары (${filtered.length})`}</h2>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Icon name="Search" size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground/40" />
              <input type="text" placeholder="Поиск по названию..." value={productSearch}
                onChange={e => setProductSearch(e.target.value)}
                className="rounded-lg border border-border bg-card pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-foreground/40 focus:border-primary focus:outline-none w-48"
                style={{ cursor: "text" }} />
              {productSearch && <button onClick={() => setProductSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground/40 hover:text-foreground" style={{ cursor: "pointer" }}><Icon name="X" size={12} /></button>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => setProductCatFilter("all")} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${productCatFilter === "all" ? "bg-primary text-primary-foreground" : "border border-border text-foreground/60 hover:border-primary hover:text-foreground"}`} style={{ cursor: "pointer" }}>Все</button>
              {categories.map(c => <button key={c.id} onClick={() => setProductCatFilter(c.name)} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${productCatFilter === c.name ? "bg-primary text-primary-foreground" : "border border-border text-foreground/60 hover:border-primary hover:text-foreground"}`} style={{ cursor: "pointer" }}>{c.name}</button>)}
            </div>
            <div className="flex gap-1.5">
              {(["all", "new", "filled"] as const).map(f => (
                <button key={f} onClick={() => setProductFillFilter(f)} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${productFillFilter === f ? "bg-primary text-primary-foreground" : "border border-border text-foreground/60 hover:border-primary hover:text-foreground"}`} style={{ cursor: "pointer" }}>
                  {f === "all" ? "Все" : f === "new" ? "Новые" : "Заполненные"}
                </button>
              ))}
            </div>
            <button onClick={toggleArchiveView} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${showArchived ? "bg-amber-400/15 text-amber-400 border border-amber-400/40" : "border border-border text-foreground/60 hover:border-primary hover:text-foreground"}`} style={{ cursor: "pointer" }}>
              <Icon name="Archive" size={14} />{showArchived ? "Скрыть архив" : "Архив"}
            </button>
            <div className="flex items-center gap-2">
              <button onClick={handleExportExcel} disabled={exportLoading} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground/70 hover:border-primary hover:text-foreground transition-colors disabled:opacity-50" style={{ cursor: "pointer" }}>
                <Icon name={exportLoading ? "Loader" : "Download"} size={14} />Excel
              </button>
              <label className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground/70 hover:border-primary hover:text-foreground transition-colors cursor-pointer">
                <Icon name={importLoading ? "Loader" : "Upload"} size={14} />Импорт
                <input type="file" accept=".xlsx,.xls" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleImportExcel(f); e.target.value = "" }} />
              </label>
              <button onClick={() => setTab("add_product")} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>
                <Icon name="Plus" size={16} />Добавить
              </button>
            </div>
          </div>
        </div>
        {(showArchived ? archivedLoading : loading) ? (
          <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-14 rounded-xl bg-card animate-pulse" />)}</div>
        ) : showArchived && archivedProducts.length === 0 ? (
          <div className="rounded-xl border border-border bg-card py-12 text-center text-foreground/40 text-sm">Архив пуст</div>
        ) : (() => {
          const rows = showArchived ? archivedProducts : filtered
          const rowIds = rows.map(p => p.id)
          const allSelected = rowIds.length > 0 && rowIds.every(id => selected.has(id))
          return (
          <>
            {selected.size > 0 && (
              <div className="mb-3 flex items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 px-4 py-2.5">
                <span className="text-sm font-medium text-foreground">Выбрано: {selected.size}</span>
                <div className="flex-1" />
                {showArchived ? (
                  <button onClick={bulkRestore} disabled={bulkLoading} className="flex items-center gap-1.5 rounded-lg border border-green-400/40 px-3 py-1.5 text-xs font-medium text-green-400 hover:bg-green-400/10 transition-colors disabled:opacity-50" style={{ cursor: "pointer" }}>
                    <Icon name={bulkLoading ? "Loader" : "RotateCcw"} size={14} />Восстановить выбранные
                  </button>
                ) : (
                  <button onClick={bulkArchive} disabled={bulkLoading} className="flex items-center gap-1.5 rounded-lg border border-red-400/40 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-50" style={{ cursor: "pointer" }}>
                    <Icon name={bulkLoading ? "Loader" : "Archive"} size={14} />Архивировать выбранные
                  </button>
                )}
                <button onClick={() => setSelected(new Set())} className="text-foreground/40 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}><Icon name="X" size={16} /></button>
              </div>
            )}
            <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground/50">Товар</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground/50">Категория</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground/50">Цена</th>
                  {!showArchived && <th className="px-4 py-3 text-center text-xs font-semibold text-foreground/50">На складе</th>}
                  <th className="px-4 py-3" />
                  <th className="px-4 py-3 text-center w-12">
                    <input type="checkbox" checked={allSelected} onChange={() => toggleSelectAll(rowIds)} className="h-4 w-4 cursor-pointer accent-primary" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p, i) => (
                  <tr key={p.id} className={`border-b border-border/50 hover:bg-muted/30 transition-colors ${selected.has(p.id) ? "bg-primary/5" : i % 2 === 0 ? "" : "bg-muted/10"}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {p.image_url && <img src={p.image_url} alt={p.name} className="h-10 w-10 rounded-lg object-contain bg-muted shrink-0" />}
                        <div>
                          <p className="font-medium text-foreground">{p.name}</p>
                          {p.is_featured && <span className="text-xs text-accent">★ Рекомендуем</span>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-foreground/60 text-xs">{p.category?.name || "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <p className="font-bold text-foreground">{fmt(p.price)}</p>
                      {p.old_price && <p className="text-xs text-foreground/40 line-through">{fmt(p.old_price)}</p>}
                    </td>
                    {!showArchived && (
                      <td className="px-4 py-3 text-center">
                        {(p.stock_qty ?? 0) > 0 ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-green-400/10 px-3 py-1 text-xs font-medium text-green-400">
                            {p.stock_qty} шт.
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-red-400/10 px-3 py-1 text-xs font-medium text-red-400">
                            Нет в наличии
                          </span>
                        )}
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {showArchived ? (
                          <button onClick={() => restoreProduct(p.id)} className="flex items-center gap-1.5 rounded-lg border border-green-400/40 px-3 py-1.5 text-xs font-medium text-green-400 hover:bg-green-400/10 transition-colors" style={{ cursor: "pointer" }}>
                            <Icon name="RotateCcw" size={14} />Восстановить
                          </button>
                        ) : (
                          <>
                            <button onClick={() => editProduct(p)} className="text-foreground/40 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}><Icon name="Pencil" size={15} /></button>
                            <button onClick={() => deleteProduct(p.id)} className="text-foreground/30 hover:text-red-400 transition-colors" style={{ cursor: "pointer" }}><Icon name="Trash2" size={15} /></button>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)} className="h-4 w-4 cursor-pointer accent-primary" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
          )
        })()}
      </div>
    )
  }

  // ADD/EDIT PRODUCT
  if (tab === "add_product") return (
    <div className="max-w-2xl">
      <h2 className="mb-6 text-xl font-light text-foreground">{productForm.id ? "Редактировать товар" : "Добавить товар"}</h2>
      <form onSubmit={submitProduct} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-foreground/60">Бренд</label>
            <div className="flex gap-2">
              <select value={productForm.brand_id} onChange={e => setProductForm(f => ({ ...f, brand_id: e.target.value }))}
                className="flex-1 rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "pointer" }}>
                <option value="">— Без бренда —</option>
                {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <button type="button" onClick={() => setShowBrandsManager(true)}
                className="shrink-0 rounded-lg border border-border px-3 text-foreground/60 hover:border-primary hover:text-primary transition-colors" style={{ cursor: "pointer" }}
                title="Управление брендами">
                <Icon name="Settings2" size={16} />
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-foreground/60">Категория *</label>
            <select required value={productForm.category_id} onChange={e => setProductForm(f => ({ ...f, category_id: e.target.value }))}
              className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "pointer" }}>
              <option value="">Выберите категорию</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs text-foreground/60">Название * <span className="text-foreground/30">(без бренда — он подставится в начало)</span></label>
          <input required value={productForm.name} onChange={e => setProductForm(f => ({ ...f, name: e.target.value }))}
            className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none" placeholder="RTX 4090 Gaming OC" style={{ cursor: "text" }} />
          {productForm.brand_id && productForm.name.trim() && (() => {
            const bn = brands.find(b => String(b.id) === productForm.brand_id)?.name || ""
            const rn = productForm.name.trim()
            const full = (bn && !rn.toLowerCase().startsWith(bn.toLowerCase())) ? `${bn} ${rn}` : rn
            return <p className="mt-1 text-[11px] text-foreground/40">Итоговое название: <span className="text-foreground/70">{full}</span></p>
          })()}
        </div>
        {showBrandsManager && <BrandsManager onClose={() => setShowBrandsManager(false)} onChanged={loadBrands} />}
        <div>
          <label className="mb-1 block text-xs text-foreground/60">Описание</label>
          <RichTextEditor value={productForm.description} onChange={v => setProductForm(f => ({ ...f, description: v }))} placeholder="Описание..." />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs text-foreground/60">Цена продажи (₽)</label>
            <input type="number" value={productForm.price} readOnly disabled
              className="w-full rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm text-foreground/60 cursor-not-allowed" placeholder="—" />
            <p className="mt-1 text-[11px] text-foreground/40">Подтягивается со склада</p>
          </div>
          <div>
            <label className="mb-1 block text-xs text-foreground/60">Старая цена (₽)</label>
            <input type="number" value={productForm.old_price} onChange={e => setProductForm(f => ({ ...f, old_price: e.target.value }))}
              className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none" placeholder="99990" style={{ cursor: "text" }} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-foreground/60">Гарантия (мес)</label>
            <input type="number" value={productForm.warranty_months} readOnly disabled
              className="w-full rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm text-foreground/60 cursor-not-allowed" placeholder="—" />
            <p className="mt-1 text-[11px] text-foreground/40">Подтягивается со склада</p>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs text-foreground/60">Фото товара</label>
          <ImageUploader images={productForm.image_urls} onChange={urls => setProductForm(f => ({ ...f, image_urls: urls }))} folder="products" maxImages={8} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-foreground/60">Характеристики (JSON)</label>
          <textarea rows={2} value={productForm.specs} onChange={e => setProductForm(f => ({ ...f, specs: e.target.value }))}
            className="w-full rounded-lg border border-border bg-card px-3 py-2.5 font-mono text-xs text-foreground focus:border-primary focus:outline-none resize-none" placeholder='{"vram":"16GB"}' style={{ cursor: "text" }} />
        </div>
        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm text-foreground/70" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={productForm.is_featured} onChange={e => setProductForm(f => ({ ...f, is_featured: e.target.checked }))} className="rounded" />Рекомендуем
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground/70" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={productForm.is_used} onChange={e => setProductForm(f => ({ ...f, is_used: e.target.checked }))} className="rounded" />Б/У (бывший в употреблении)
          </label>
        </div>
        <div className="flex gap-3 pt-2">
          <button type="submit" className="rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>
            {productForm.id ? "Сохранить" : "Добавить"}
          </button>
          <button type="button" onClick={() => { setTab("products"); setProductForm({ id: null, category_id: "", brand_id: "", name: "", description: "", price: "", old_price: "", warranty_months: "0", image_urls: [], specs: "", in_stock: true, is_featured: false, is_used: false, sort_order: "0" }) }}
            className="rounded-lg border border-border px-6 py-2.5 text-sm text-foreground/70 hover:border-primary hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
            Отмена
          </button>
        </div>
      </form>
    </div>
  )

  // BUILDS LIST + ARCHIVE (тогл внутри одной вкладки)
  if (tab === "builds" || tab === "archive") {
    const showArchive = buildsViewArchive
    return (
      <BuildsList
        builds={builds.filter(b => showArchive ? b.status === "archive" : b.status !== "archive")}
        loading={loading}
        expandedVariants={expandedVariants} setExpandedVariants={setExpandedVariants}
        dupeLoading={dupeLoading} copiedBuildId={copiedBuildId} fmt={fmt}
        onNew={() => { setBuildForm({ id: null, name: "", description: "", status: "catalog", is_featured: false, in_stock: false, assembly_type: "percent", assembly_fee_manual: "", image_urls: [] }); setBuildComponents([]); setTab("add_build") }}
        onEdit={editBuild} onDupe={duplicateBuild} onLink={generateClientLink}
        onStatus={async (b, status) => { await api.builds.patch({ id: b.id, status }); setBuilds(bs => bs.map(bb => bb.id === b.id || bb.parent_id === b.id ? { ...bb, status } : bb)) }}
        onDelete={deleteBuild} isArchive={showArchive}
        onToggleArchive={() => setBuildsViewArchive(v => !v)} />
    )
  }

  // CABLES
  if (tab === "cables") {
    const handleCableAdd = async (name: string, _summary: string, pinColors: Record<string, string>, cpuType: string, gpuType: string) => {
      try { await api.cables.create({ name, cpu_type: cpuType, gpu_type: gpuType, pin_colors: pinColors }) } catch { /* ignore */ }
      setCableAdded(true)
      setTimeout(() => setCableAdded(false), 3000)
    }
    return (
      <div>
        <h2 className="mb-6 text-xl font-light text-foreground">Кастомные кабели</h2>
        <CableBody addToCart={handleCableAdd} added={cableAdded} />
      </div>
    )
  }

  // ADD/EDIT BUILD
  if (tab === "add_build") return (
    <div className="max-w-3xl">
      <h2 className="mb-6 text-xl font-light text-foreground">{buildForm.id ? "Редактировать сборку" : "Новая сборка"}</h2>
      <form onSubmit={submitBuild} className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-foreground/60">Название сборки *</label>
            <input required value={buildForm.name} onChange={e => setBuildForm(f => ({ ...f, name: e.target.value }))}
              className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none" placeholder="UltraGame Pro" style={{ cursor: "text" }} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-foreground/60">Статус</label>
            <select value={buildForm.status} onChange={e => setBuildForm(f => ({ ...f, status: e.target.value }))}
              className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "pointer" }}>
              {Object.entries(BUILD_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs text-foreground/60">Описание</label>
          <textarea rows={2} value={buildForm.description} onChange={e => setBuildForm(f => ({ ...f, description: e.target.value }))}
            className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none resize-none" style={{ cursor: "text" }} />
        </div>
        <div>
          <label className="mb-2 block text-xs text-foreground/60">Фотографии сборки</label>
          <ImageUploader images={buildForm.image_urls} onChange={urls => setBuildForm(f => ({ ...f, image_urls: urls }))} folder="builds" />
        </div>

        {/* Поиск компонентов */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium text-foreground">Состав сборки</h3>
            <p className="text-xs text-foreground/40">Выбирайте товары из каталога по категориям</p>
          </div>
          {(() => {
            const allComps = Object.entries(configSlots).flatMap(([slot, comps]) => comps.map(c => ({ ...c, slot })))
            const q = componentSearch.trim().toLowerCase()
            const results = q.length >= 1 ? allComps.filter(c => c.name.toLowerCase().includes(q)).slice(0, 10) : []
            const safeIdx = Math.min(componentSearchIdx, results.length - 1)
            const addComp = (comp: ConfigComponent & { slot: string }) => {
              addCatalogComponent(comp.slot, comp)
              setComponentSearch("")
              setComponentSearchIdx(0)
              setTimeout(() => componentSearchRef.current?.focus(), 0)
            }
            return (
              <div className="relative mb-4">
                <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 focus-within:border-primary transition-colors">
                  <Icon name="Search" size={15} className="text-foreground/40 shrink-0" />
                  <input ref={componentSearchRef} type="text" value={componentSearch}
                    onChange={e => { setComponentSearch(e.target.value); setComponentSearchIdx(0) }}
                    onKeyDown={e => {
                      if (e.key === "ArrowDown") { e.preventDefault(); setComponentSearchIdx(i => Math.min(i + 1, results.length - 1)) }
                      else if (e.key === "ArrowUp") { e.preventDefault(); setComponentSearchIdx(i => Math.max(i - 1, 0)) }
                      else if (e.key === "Enter") { e.preventDefault(); if (results[safeIdx]) addComp(results[safeIdx]) }
                      else if (e.key === "Escape") { setComponentSearch(""); setComponentSearchIdx(0) }
                    }}
                    placeholder="Быстрый поиск по каталогу..."
                    className="flex-1 bg-transparent text-sm text-foreground placeholder:text-foreground/40 focus:outline-none" style={{ cursor: "text" }} />
                  {componentSearch && <button type="button" onClick={() => { setComponentSearch(""); setComponentSearchIdx(0); componentSearchRef.current?.focus() }} className="text-foreground/30 hover:text-foreground" style={{ cursor: "pointer" }}><Icon name="X" size={13} /></button>}
                </div>
                {results.length > 0 && (
                  <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-xl border border-border bg-card shadow-xl overflow-hidden">
                    {results.map((c, i) => {
                      const isAdded = buildComponents.some(bc => bc.source_id === c.id)
                      return (
                        <button key={c.id} type="button" onClick={() => addComp(c)}
                          className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${i === safeIdx ? "bg-primary/10 text-primary" : "hover:bg-muted text-foreground"}`}
                          style={{ cursor: "pointer" }}>
                          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-foreground/50">{c.slot}</span>
                          <span className="flex-1 truncate font-medium">{c.name}</span>
                          <span className="shrink-0 text-xs font-bold text-accent">{c.price ? c.price.toLocaleString("ru-RU") + " ₽" : "—"}</span>
                          {isAdded && <Icon name="Check" size={12} className="text-primary shrink-0" />}
                        </button>
                      )
                    })}
                  </div>
                )}
                {q.length >= 1 && results.length === 0 && (
                  <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-xl border border-border bg-card px-4 py-3 text-xs text-foreground/40 shadow-xl">Ничего не найдено</div>
                )}
              </div>
            )
          })()}

          {/* Добавленные компоненты */}
          {buildComponents.length > 0 && (
            <div className="mb-3 space-y-1.5 rounded-xl border border-primary/20 bg-primary/5 p-4">
              <p className="mb-2 text-xs font-medium text-foreground/60">Позиций: {buildComponents.length} · Итого железо: {fmt(partsTotal)}</p>
              {buildComponents.map((c, i) => (
                <div key={i} className="rounded-lg border border-border/40 bg-card/60">
                  <div className="flex items-center gap-2 text-sm px-3 py-2">
                    <span className="w-24 shrink-0 text-xs text-foreground/50 font-mono truncate">{c.slot}</span>
                    <span className="flex-1 text-foreground font-medium truncate">{c.name}</span>
                    {(c.image_urls?.length ?? 0) > 0 && <span className="shrink-0 text-[10px] text-primary/70 font-mono">{c.image_urls!.length}ф</span>}
                    <div className="flex items-center gap-1 shrink-0">
                      <button type="button" onClick={() => setComponentQty(c.source_id ?? 0, -1)} className="h-5 w-5 rounded border border-border text-foreground/50 hover:border-primary hover:text-primary transition-colors flex items-center justify-center" style={{ cursor: "pointer" }}><Icon name="Minus" size={10} /></button>
                      <span className="w-5 text-center text-xs font-bold text-foreground">{c.qty || 1}</span>
                      <button type="button" onClick={() => setComponentQty(c.source_id ?? 0, 1)} className="h-5 w-5 rounded border border-border text-foreground/50 hover:border-primary hover:text-primary transition-colors flex items-center justify-center" style={{ cursor: "pointer" }}><Icon name="Plus" size={10} /></button>
                    </div>
                    {c.price === 0 ? (
                      <div className="flex items-center gap-0.5 shrink-0 w-28">
                        <input type="number" min={0} placeholder="цена" value={c.price === 0 ? "" : c.price}
                          onChange={e => { const val = Number(e.target.value) || 0; setBuildComponents(cs => cs.map((comp, ci) => ci === i ? { ...comp, price: val } : comp)) }}
                          className="w-full rounded border border-border bg-background px-2 py-0.5 text-xs text-primary font-bold text-right focus:border-primary focus:outline-none" style={{ cursor: "text" }} />
                        <span className="text-xs text-foreground/40 shrink-0">₽</span>
                      </div>
                    ) : (
                      <span className="shrink-0 font-bold text-primary text-xs w-20 text-right">{fmt(c.price * (c.qty || 1))}</span>
                    )}
                    <button type="button" onClick={() => setExpandedComponent(expandedComponent === i ? null : i)} className="text-foreground/30 hover:text-primary transition-colors" style={{ cursor: "pointer" }}>
                      <Icon name={expandedComponent === i ? "ChevronUp" : "Image"} size={13} />
                    </button>
                    <button type="button" onClick={() => removeComponent(c.source_id ?? 0)} className="text-foreground/30 hover:text-red-400 transition-colors" style={{ cursor: "pointer" }}><Icon name="X" size={13} /></button>
                  </div>
                  {expandedComponent === i && (
                    <div className="px-3 pb-3 border-t border-border/30 pt-2">
                      <p className="text-xs text-foreground/50 mb-1.5">Фото компонента</p>
                      <ImageUploader images={c.image_urls || []} onChange={urls => setBuildComponents(cs => cs.map((comp, ci) => ci === i ? { ...comp, image_urls: urls } : comp))} folder="builds" maxImages={6} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* По категориям */}
          <div className="space-y-2">
            {categories.length === 0 ? (
              <p className="text-xs text-foreground/40 text-center py-4">Загрузка категорий...</p>
            ) : categories.map(cat => {
              const slotOptions = configSlots[cat.slug] || []
              const isOpen = addingSlot === cat.slug
              const addedFromCat = buildComponents.filter(c => c.slot === cat.slug || slotOptions.some(o => o.id === c.source_id))
              return (
                <div key={cat.id} className="rounded-xl border border-border overflow-hidden">
                  <button type="button" onClick={() => setAddingSlot(isOpen ? null : cat.slug)}
                    className="flex w-full items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors" style={{ cursor: "pointer" }}>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-foreground">{cat.name}</span>
                      {addedFromCat.length > 0 && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary font-medium">{addedFromCat.length}</span>}
                    </div>
                    <Icon name={isOpen ? "ChevronUp" : "ChevronDown"} size={14} className="text-foreground/40" />
                  </button>
                  {isOpen && (
                    <div className="border-t border-border bg-muted/20 divide-y divide-border/30 max-h-48 overflow-y-auto">
                      {slotOptions.length === 0 ? (
                        <p className="px-4 py-3 text-xs text-foreground/40">Нет товаров в этой категории</p>
                      ) : slotOptions.map(comp => {
                        const isAdded = buildComponents.some(c => c.source_id === comp.id)
                        return (
                          <button key={comp.id} type="button" onClick={() => !isAdded && addCatalogComponent(cat.slug, comp)}
                            className={`flex w-full items-center justify-between px-4 py-2.5 text-sm transition-colors ${isAdded ? "opacity-50 cursor-default" : "hover:bg-muted cursor-pointer"}`}
                            style={{ cursor: isAdded ? "default" : "pointer" }}>
                            <span className="text-foreground font-medium truncate">{comp.name}</span>
                            <div className="flex items-center gap-2 shrink-0 ml-2">
                              <span className="text-xs font-bold text-accent">{comp.price ? fmt(comp.price) : "—"}</span>
                              {isAdded ? <Icon name="Check" size={13} className="text-primary" /> : <Icon name="Plus" size={13} className="text-foreground/40" />}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Цена */}
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="mb-4 flex items-center justify-between text-sm">
            <span className="text-foreground/60">Железо:</span>
            <span className="font-bold text-foreground">{fmt(partsTotal)}</span>
          </div>
          <div className="mb-4">
            <label className="mb-2 block text-xs text-foreground/60">Стоимость сборки</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setBuildForm(f => ({ ...f, assembly_type: "percent" }))}
                className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-colors ${buildForm.assembly_type === "percent" ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60 hover:border-primary"}`}
                style={{ cursor: "pointer" }}>
                7% автоматически ({fmt(Math.round(partsTotal * 0.07))})
              </button>
              <button type="button" onClick={() => setBuildForm(f => ({ ...f, assembly_type: "manual" }))}
                className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-colors ${buildForm.assembly_type === "manual" ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60 hover:border-primary"}`}
                style={{ cursor: "pointer" }}>
                Ввести вручную
              </button>
            </div>
            {buildForm.assembly_type === "manual" && (
              <input type="number" value={buildForm.assembly_fee_manual} onChange={e => setBuildForm(f => ({ ...f, assembly_fee_manual: e.target.value }))}
                className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" placeholder="Сумма за сборку (₽)" style={{ cursor: "text" }} />
            )}
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground/70 border-t border-border pt-3 cursor-pointer" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={buildForm.sell_with_vat} onChange={e => setBuildForm(f => ({ ...f, sell_with_vat: e.target.checked }))} className="rounded" />
            Продажа с НДС <span className="text-xs text-foreground/40">(+22%, округление вверх до 250 ₽)</span>
          </label>
          {buildForm.sell_with_vat && (
            <div className="mt-2 flex items-center justify-between text-xs text-foreground/50">
              <span>Без НДС: {fmt(baseTotal)}</span>
              <span>+22% и округление</span>
            </div>
          )}
          <div className="flex items-center justify-between border-t border-border pt-3 mt-3">
            <span className="text-sm font-medium text-foreground">Итого{buildForm.sell_with_vat ? " (с НДС)" : ""}:</span>
            <span className="text-2xl font-bold text-foreground">{fmt(buildTotal)}</span>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <label className={`flex items-center gap-2 text-sm transition-opacity ${buildForm.status === "catalog" ? "text-foreground/70 cursor-pointer" : "text-foreground/30 cursor-not-allowed"}`}
            style={{ cursor: buildForm.status === "catalog" ? "pointer" : "not-allowed" }}
            title={buildForm.status !== "catalog" ? "Доступно только для «На сайте»" : undefined}>
            <input type="checkbox" checked={buildForm.in_stock} disabled={buildForm.status !== "catalog"} onChange={e => setBuildForm(f => ({ ...f, in_stock: e.target.checked }))} className="rounded disabled:opacity-40" />
            В наличии{buildForm.status !== "catalog" && <span className="text-xs text-foreground/30">(только для «На сайте»)</span>}
          </label>
          <label className={`flex items-center gap-2 text-sm transition-opacity ${buildForm.status === "catalog" ? "text-foreground/70 cursor-pointer" : "text-foreground/30 cursor-not-allowed"}`}
            style={{ cursor: buildForm.status === "catalog" ? "pointer" : "not-allowed" }}
            title={buildForm.status !== "catalog" ? "Доступно только для «На сайте»" : undefined}>
            <input type="checkbox" checked={buildForm.is_featured} disabled={buildForm.status !== "catalog"} onChange={e => setBuildForm(f => ({ ...f, is_featured: e.target.checked }))} className="rounded disabled:opacity-40" />
            Рекомендуемая сборка
          </label>
        </div>

        {tags.length > 0 && (
          <div>
            <label className="mb-2 block text-xs text-foreground/60">Теги</label>
            <div className="flex flex-wrap gap-2">
              {tags.map(t => {
                const active = buildTagIds.includes(t.id)
                return (
                  <button key={t.id} type="button" onClick={() => setBuildTagIds(ids => active ? ids.filter(i => i !== t.id) : [...ids, t.id])}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all ${active ? "border-primary bg-primary/15 text-primary" : "border-border text-foreground/50 hover:border-primary hover:text-foreground"}`}
                    style={{ cursor: "pointer" }}>
                    {active && <Icon name="Check" size={11} />}{t.name}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <button type="submit" className="rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>
            {buildForm.id ? "Сохранить" : "Опубликовать сборку"}
          </button>
          <button type="button" onClick={() => setTab("builds")} className="rounded-lg border border-border px-6 py-2.5 text-sm text-foreground/70 hover:border-primary hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
            Отмена
          </button>
        </div>
      </form>
    </div>
  )

  // TAGS
  if (tab === "tags") return (
    <div className="max-w-2xl">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-xl font-light text-foreground">Теги сборок</h2>
        <button onClick={() => { setTagForm({ id: null, name: "", color: "primary", sort_order: "0" }); setTagFormOpen(true) }}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>
          <Icon name="Plus" size={15} />Новый тег
        </button>
      </div>
      {tagFormOpen && (
        <form onSubmit={submitTag} className="mb-6 rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
          <p className="text-sm font-medium text-foreground">{tagForm.id ? "Редактировать тег" : "Новый тег"}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs text-foreground/60">Название *</label>
              <input required value={tagForm.name} onChange={e => setTagForm(f => ({ ...f, name: e.target.value }))}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" placeholder="Игровой" style={{ cursor: "text" }} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-foreground/60">Цвет</label>
              <select value={tagForm.color} onChange={e => setTagForm(f => ({ ...f, color: e.target.value }))}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "pointer" }}>
                {TAG_COLORS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-foreground/60">Порядок</label>
              <input type="number" value={tagForm.sort_order} onChange={e => setTagForm(f => ({ ...f, sort_order: e.target.value }))}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "text" }} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <p className="text-xs text-foreground/40">Превью:</p>
            <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${TAG_COLOR_CLASSES[tagForm.color] || TAG_COLOR_CLASSES.primary}`}>
              {tagForm.name || "Тег"}
            </span>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>
              {tagForm.id ? "Сохранить" : "Создать"}
            </button>
            <button type="button" onClick={() => setTagFormOpen(false)} className="rounded-lg border border-border px-4 py-2 text-sm text-foreground/60 hover:border-primary transition-colors" style={{ cursor: "pointer" }}>
              Отмена
            </button>
          </div>
        </form>
      )}
      {loading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-14 rounded-xl bg-card animate-pulse" />)}</div>
      ) : tags.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-12 text-center">
          <Icon name="Tag" size={32} className="mx-auto mb-3 text-foreground/20" />
          <p className="text-sm text-foreground/40">Тегов пока нет. Создайте первый!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tags.map(t => (
            <div key={t.id} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
              <TagBadge tag={t} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{t.name}</p>
                <p className="text-xs text-foreground/40">порядок: {t.sort_order}</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => { setTagForm({ id: t.id, name: t.name, color: t.color, sort_order: String(t.sort_order) }); setTagFormOpen(true) }}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs hover:border-primary transition-colors" style={{ cursor: "pointer" }}><Icon name="Pencil" size={12} /></button>
                <button onClick={() => deleteTag(t.id)} className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/40 hover:border-red-400 hover:text-red-400 transition-colors" style={{ cursor: "pointer" }}><Icon name="Trash2" size={12} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  // ARTICLES LIST
  if (tab === "articles") return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Статьи и тесты</h2>
        <button onClick={() => { setArticleForm({ id: null, title: "", slug: "", excerpt: "", content: "", image_url: "", image_urls: [], category: "article", is_published: false, html_attachment: "", toc: [] }); setTab("add_article") }}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>
          <Icon name="Plus" size={15} />Новая статья
        </button>
      </div>
      {loading ? <p className="text-sm text-foreground/40">Загрузка...</p> : articles.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-12 text-center">
          <Icon name="BookOpen" size={32} className="mx-auto mb-3 text-foreground/20" />
          <p className="text-sm text-foreground/40">Статей пока нет. Создайте первую!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {articles.map(a => (
            <div key={a.id} className="flex items-center gap-4 rounded-xl border border-border bg-card p-4 hover:border-primary/40 transition-colors">
              {a.image_url && <img src={a.image_url} alt={a.title} className="h-14 w-20 rounded-lg object-cover shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${a.is_published ? "bg-green-400/10 text-green-400" : "bg-muted text-foreground/40"}`}>
                    {a.is_published ? "Опубликована" : "Черновик"}
                  </span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground/50">
                    {{ review: "Обзор", test: "Тест", guide: "Гайд", repair: "Ремонты", tier_detail: "Тир-лист", article: "Статья" }[a.category] || "Статья"}
                  </span>
                </div>
                <p className="text-sm font-medium text-foreground truncate">{a.title}</p>
                <p className="text-xs text-foreground/40">{new Date(a.created_at).toLocaleDateString("ru-RU")} · {a.views} просмотров</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => editArticle(a)} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:border-primary transition-colors" style={{ cursor: "pointer" }}>Редакт.</button>
                <button onClick={() => deleteArticle(a.id)} className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/50 hover:border-red-400 hover:text-red-400 transition-colors" style={{ cursor: "pointer" }}><Icon name="Trash2" size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  // ADD/EDIT ARTICLE
  if (tab === "add_article") return (
    <div>
      <h2 className="mb-5 text-lg font-semibold text-foreground">{articleForm.id ? "Редактировать статью" : "Новая статья"}</h2>
      <form onSubmit={submitArticle} className="space-y-4 max-w-3xl">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-foreground/60">Заголовок *</label>
            <input required value={articleForm.title} onChange={e => setArticleForm(f => ({ ...f, title: e.target.value }))}
              className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "text" }} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-foreground/60">Slug (URL)</label>
            <input value={articleForm.slug} onChange={e => setArticleForm(f => ({ ...f, slug: e.target.value }))} placeholder="auto-generated"
              className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "text" }} />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-foreground/60">Категория</label>
            <select value={articleForm.category} onChange={e => setArticleForm(f => ({ ...f, category: e.target.value }))}
              className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "pointer" }}>
              <option value="article">Статья</option>
              <option value="review">Обзор</option>
              <option value="test">Тест / Бенчмарк</option>
              <option value="guide">Гайд</option>
              <option value="repair">Ремонты</option>
              <option value="tier_detail">Подробный тир-лист</option>
            </select>
          </div>
          <div>
            <label className="mb-2 block text-xs text-foreground/60">Изображения статьи</label>
            <ImageUploader images={articleForm.image_urls} onChange={urls => setArticleForm(f => ({ ...f, image_urls: urls }))} folder="articles" />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs text-foreground/60">Краткое описание (превью)</label>
          <RichTextEditor value={articleForm.excerpt} onChange={v => setArticleForm(f => ({ ...f, excerpt: v }))} placeholder="Краткое описание для карточки статьи..." />
        </div>
        <div>
          <label className="mb-1 block text-xs text-foreground/60">Текст статьи *</label>
          <RichTextEditor value={articleForm.content} onChange={v => setArticleForm(f => ({ ...f, content: v }))} placeholder="Начните писать статью..." className="min-h-[400px]" />
        </div>

        {/* ── Оглавление статьи ── */}
        <div className="rounded-xl border border-border bg-card/40 p-4">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <label className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <Icon name="List" size={15} className="text-primary" /> Оглавление статьи
              </label>
              <p className="mt-0.5 text-xs text-foreground/50">
                Добавьте пункты, скопируйте метку и вставьте её в нужное место текста.
                По клику в статье будет плавная прокрутка к этому месту.
              </p>
            </div>
            <button type="button" onClick={addTocItem}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors" style={{ cursor: "pointer" }}>
              <Icon name="Plus" size={13} /> Пункт
            </button>
          </div>

          {articleForm.toc.length === 0 ? (
            <p className="py-3 text-center text-xs text-foreground/40">Пунктов пока нет</p>
          ) : (
            <div className="space-y-2">
              {articleForm.toc.map((t, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background/40 p-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-muted text-xs font-mono text-foreground/50">{i + 1}</span>
                  <input
                    value={t.title}
                    onChange={e => updateTocItem(i, { title: e.target.value, anchor: t.anchor || anchorSlug(e.target.value) || `p${i + 1}` })}
                    placeholder="Название пункта (напр. «Итоги»)"
                    className="min-w-[140px] flex-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "text" }} />
                  <input
                    value={t.anchor}
                    onChange={e => updateTocItem(i, { anchor: anchorSlug(e.target.value) })}
                    placeholder="метка"
                    className="w-28 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-mono text-foreground/70 focus:border-primary focus:outline-none" style={{ cursor: "text" }} />
                  <button type="button" onClick={() => copyAnchorTag(t.anchor)} title="Скопировать метку для вставки в текст"
                    className="flex items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-xs text-foreground/60 hover:border-primary hover:text-primary transition-colors" style={{ cursor: "pointer" }}>
                    <Icon name={copiedAnchor === t.anchor ? "Check" : "Copy"} size={12} />
                    {copiedAnchor === t.anchor ? "Скопировано" : `[[#${t.anchor}]]`}
                  </button>
                  <button type="button" onClick={() => removeTocItem(i)}
                    className="rounded-lg border border-border px-2 py-1.5 text-foreground/40 hover:border-red-400 hover:text-red-400 transition-colors" style={{ cursor: "pointer" }}>
                    <Icon name="Trash2" size={12} />
                  </button>
                </div>
              ))}
              <p className="text-xs text-foreground/40">
                Метку <span className="font-mono text-foreground/60">[[#метка]]</span> вставьте в текст там, куда должна вести прокрутка (в начало нужного абзаца).
              </p>
            </div>
          )}
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs text-foreground/60">HTML-вложение <span className="text-foreground/30">(опционально)</span></label>
            {articleForm.html_attachment && (
              <button type="button" onClick={() => setArticleForm(f => ({ ...f, html_attachment: "" }))}
                className="text-xs text-foreground/40 hover:text-red-400 transition-colors flex items-center gap-1" style={{ cursor: "pointer" }}>
                <Icon name="X" size={11} /> Очистить
              </button>
            )}
          </div>
          <div className="relative">
            <textarea rows={8} value={articleForm.html_attachment} onChange={e => setArticleForm(f => ({ ...f, html_attachment: e.target.value }))}
              placeholder={"<!DOCTYPE html>\n<html>\n  <body>\n    <!-- HTML-код результатов теста -->\n  </body>\n</html>"}
              className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-xs text-foreground focus:border-primary focus:outline-none resize-y font-mono" style={{ cursor: "text" }} />
            <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
              {articleForm.html_attachment && <span className="rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">{articleForm.html_attachment.length.toLocaleString()} симв.</span>}
              <label className="flex cursor-pointer items-center gap-1 rounded border border-border bg-card px-2 py-1 text-xs text-foreground/50 hover:border-primary hover:text-foreground transition-colors">
                <Icon name="Upload" size={11} />.html
                <input type="file" accept=".html,.htm" className="hidden" onChange={e => { const file = e.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = ev => setArticleForm(f => ({ ...f, html_attachment: ev.target?.result as string || "" })); reader.readAsText(file); e.target.value = "" }} />
              </label>
            </div>
          </div>
          {articleForm.html_attachment && (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-foreground/40 hover:text-foreground/60 select-none">Предпросмотр</summary>
              <div className="mt-2 rounded-lg border border-border overflow-hidden" style={{ height: 320 }}>
                <iframe srcDoc={articleForm.html_attachment} sandbox="allow-scripts" className="w-full h-full border-0 bg-white" title="HTML preview" />
              </div>
            </details>
          )}
        </div>
        <div className="flex items-center gap-3">
          <input type="checkbox" id="is_published" checked={articleForm.is_published} onChange={e => setArticleForm(f => ({ ...f, is_published: e.target.checked }))} className="h-4 w-4 rounded border-border accent-primary" style={{ cursor: "pointer" }} />
          <label htmlFor="is_published" className="text-sm text-foreground/70" style={{ cursor: "pointer" }}>Опубликовать (показывать на сайте)</label>
        </div>
        <div className="flex gap-3">
          <button type="submit" className="rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>
            {articleForm.id ? "Сохранить" : "Создать статью"}
          </button>
          <button type="button" onClick={() => setTab("articles")} className="rounded-lg border border-border px-6 py-2.5 text-sm text-foreground/70 hover:border-primary hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
            Отмена
          </button>
        </div>
      </form>
    </div>
  )

  return null
}