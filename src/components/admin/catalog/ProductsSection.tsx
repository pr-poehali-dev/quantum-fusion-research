import React, { useState, useEffect } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { ImageUploader } from "@/components/image-uploader"
import RichTextEditor from "@/components/ui/rich-text-editor"
import BrandsManager from "../BrandsManager"
import { Product, Category, AdminTab } from "@/pages/admin/types"

export function ProductsSection({ tab, setTab, loading, products, setProducts, categories, setCategories }: {
  tab: AdminTab
  setTab: (t: AdminTab) => void
  loading: boolean
  products: Product[]
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>
  categories: Category[]
  setCategories: React.Dispatch<React.SetStateAction<Category[]>>
}) {
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
  const EMPTY_FORM = {
    id: null as number | null,
    category_id: "", brand_id: "", name: "", description: "", price: "", old_price: "", warranty_months: "0",
    image_urls: [] as string[], specs: "", in_stock: true, is_featured: false, is_used: false, sort_order: "0",
  }
  const [productForm, setProductForm] = useState(EMPTY_FORM)

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
  const buildFormFromProduct = (p: Product) => {
    // Отрезаем префикс бренда от имени, чтобы поле «Название» было без бренда
    // (в БД имя хранится цельным: "{Бренд} {Название}").
    const brandName = p.brand_id ? (brands.find(b => b.id === p.brand_id)?.name || p.brand || "") : ""
    let nameNoBrand = p.name
    if (brandName && p.name.toLowerCase().startsWith(brandName.toLowerCase() + " ")) {
      nameNoBrand = p.name.slice(brandName.length).trimStart()
    }
    // category_id: сначала по прямому id из p.category, иначе по имени в справочнике
    const catId = (p.category && "id" in p.category && (p.category as { id?: number }).id)
      ? String((p.category as { id: number }).id)
      : (p.category ? String(categories.find(c => c.name === p.category?.name)?.id || "") : "")
    return {
      id: p.id,
      category_id: catId,
      brand_id: p.brand_id ? String(p.brand_id) : "",
      name: nameNoBrand, description: p.description || "",
      price: String(p.price), old_price: p.old_price ? String(p.old_price) : "",
      warranty_months: String(p.warranty_months ?? 0),
      image_urls: p.image_urls?.length ? p.image_urls : (p.image_url ? [p.image_url] : []),
      specs: JSON.stringify(p.specs || {}),
      in_stock: p.in_stock, is_featured: p.is_featured, is_used: !!p.is_used, sort_order: String(p.sort_order || 0),
    }
  }

  // Какой товар редактируем (id переживает навигацию/подгрузку списка).
  const [editingId, setEditingId] = useState<number | null>(null)

  const editProduct = (p: Product) => {
    setEditingId(p.id)
    setProductForm(buildFormFromProduct(p))
    setTab("add_product")
  }

  // Если список товаров/справочники подгрузились ПОСЛЕ открытия редактирования
  // (навигация на add_product перезапрашивает products), заново наполняем форму
  // из актуальных данных, чтобы карточка не «схлопывалась» в пустое создание.
  useEffect(() => {
    if (editingId == null) return
    const p = products.find(pr => pr.id === editingId) || archivedProducts.find(pr => pr.id === editingId)
    if (p) setProductForm(prev => (prev.id === editingId ? prev : buildFormFromProduct(p)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, products, archivedProducts, categories, brands])
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
    setEditingId(null)
    setProductForm(EMPTY_FORM)
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
              <button onClick={() => { setEditingId(null); setProductForm(EMPTY_FORM); setTab("add_product") }} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>
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
                {brands.map(b => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
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
          <button type="button" onClick={() => { setTab("products"); setEditingId(null); setProductForm(EMPTY_FORM) }}
            className="rounded-lg border border-border px-6 py-2.5 text-sm text-foreground/70 hover:border-primary hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
            Отмена
          </button>
        </div>
      </form>
    </div>
  )

  return null
}