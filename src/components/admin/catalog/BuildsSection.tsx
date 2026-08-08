import React, { useState, useEffect, useRef } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { ImageUploader } from "@/components/image-uploader"
import { Category, ConfigComponent, Tag, PCBuild, AdminTab } from "@/pages/admin/types"
import { BUILD_STATUS } from "@/pages/admin/constants"
import { BuildsList } from "../BuildsList"

export function BuildsSection({
  tab, setTab, loading,
  builds, setBuilds, configSlots, categories, tags,
  autoEditBuildId, clearAutoEditBuildId, setAutoEditBuildId,
}: {
  tab: AdminTab
  setTab: (t: AdminTab) => void
  loading: boolean
  builds: PCBuild[]
  setBuilds: React.Dispatch<React.SetStateAction<PCBuild[]>>
  configSlots: Record<string, ConfigComponent[]>
  categories: Category[]
  tags: Tag[]
  autoEditBuildId?: number | null
  clearAutoEditBuildId?: () => void
  // Клик «Ред.» тоже проставляет autoEditBuildId (state живёт в Admin.tsx,
  // переживает remount дерева при navigate между вкладками).
  setAutoEditBuildId?: (id: number | null) => void
}) {
  const fmt = (n: number) => n.toLocaleString("ru-RU") + " ₽"

  const [buildsViewArchive, setBuildsViewArchive] = useState(false)

  // ── Builds ────────────────────────────────────────────────────────────────
  const [buildForm, setBuildForm] = useState({
    id: null as number | null,
    name: "", description: "", status: "catalog", is_featured: false, in_stock: false,
    assembly_type: "percent" as "percent" | "manual",
    assembly_fee_manual: "",
    image_urls: [] as string[],
    sell_with_vat: false,
    lock_prices: false,
    parent_id: null as number | null,
  })
  const [buildComponents, setBuildComponents] = useState<Array<{
    slot: string; source: "catalog" | "custom"; source_id?: number; name: string; price: number; current_price?: number; qty: number; image_urls?: string[]
    point?: { x: number; y: number } | null
    points?: { x: number; y: number }[] | null  // несколько точек (для qty>1)
  }>>([])
  const [expandedComponent, setExpandedComponent] = useState<number | null>(null)
  // Индекс железки, для которой сейчас ставим точку на общем фото сборки
  const [pointPickIdx, setPointPickIdx] = useState<number | null>(null)
  const [addingSlot, setAddingSlot] = useState<string | null>(null)
  const [componentSearch, setComponentSearch] = useState("")
  const [componentSearchIdx, setComponentSearchIdx] = useState(0)
  const componentSearchRef = useRef<HTMLInputElement>(null)
  const [copiedBuildId, setCopiedBuildId] = useState<number | null>(null)
  const [dupeLoading, setDupeLoading] = useState<number | null>(null)
  const [copyLoading, setCopyLoading] = useState<number | null>(null)
  const [expandedVariants, setExpandedVariants] = useState<number | null>(null)
  const [buildTagIds, setBuildTagIds] = useState<number[]>([])

  // Цена комплектующего: если цены НЕ зафиксированы — актуальная из каталога
  // (current_price), иначе — зафиксированная вручную (price).
  const compPrice = (c: { price: number; current_price?: number }) =>
    (buildForm.lock_prices ? c.price : (c.current_price ?? c.price)) || 0
  const partsTotal = buildComponents.reduce((s, c) => s + compPrice(c) * (c.qty || 1), 0)
  // Сборка 7% округляется ВВЕРХ до кратного 250 ₽ (250/500/750/…)
  const assemblyFee = buildForm.assembly_type === "percent"
    ? Math.ceil(partsTotal * 0.07 / 250) * 250
    : (parseFloat(buildForm.assembly_fee_manual) || 0)
  const baseTotal = partsTotal + assemblyFee
  // Продажа с НДС: +22% и округление вверх до 250 ₽
  const buildTotal = buildForm.sell_with_vat
    ? Math.ceil(baseTotal * 1.22 / 250) * 250
    : baseTotal

  // Наполнить форму данными сборки (без навигации).
  const fillBuildForm = (b: PCBuild) => {
    setBuildForm({
      id: b.id, name: b.name, description: b.description || "",
      status: b.status, is_featured: b.is_featured, in_stock: b.in_stock ?? false,
      assembly_type: (b.assembly_type as "percent" | "manual") || "percent",
      assembly_fee_manual: b.assembly_fee ? String(b.assembly_fee) : "",
      image_urls: b.image_urls || [],
      sell_with_vat: b.sell_with_vat ?? false,
      lock_prices: b.lock_prices ?? false,
      parent_id: b.parent_id ?? null,
    })
    setBuildComponents(b.components?.map(c => ({
      slot: c.slot, source: (c.source as "catalog" | "custom") || "catalog",
      source_id: c.source_id, name: c.name, price: c.price || 0,
      current_price: c.current_price ?? c.price ?? 0,
      qty: c.qty || 1, image_urls: [],
      point: c.point ?? null,
      points: c.points ?? (c.point ? [c.point] : null),
    })) || [])
    setBuildTagIds(b.tags?.map(t => t.id) || [])
  }

  // Какую сборку сейчас редактируем — id живёт в Admin.tsx (autoEditBuildId),
  // а НЕ в локальном state этого компонента. Переключение на add_build — это
  // navigate() в setTab(), из-за которого дерево пересоздаётся целиком
  // (key={main-${tab}} в Admin.tsx) и любой локальный state здесь обнуляется
  // ДО того, как успевает открыться форма. Тот же приём уже использовался
  // для авто-открытия из WIP — теперь кнопка «Ред.» в списке идёт тем же путём.
  const editBuild = (b: PCBuild) => {
    setAutoEditBuildId?.(b.id)
    setTab("add_build")
  }

  // Наполняем форму из autoEditBuildId (клик «Ред.» в списке ИЛИ переход из
  // WIP), как только сборка есть в списке. Устойчиво к перезагрузке списка/
  // навигации. one-shot: после наполнения id сбрасываем.
  useEffect(() => {
    if (!autoEditBuildId) return
    const b = builds.find(x => x.id === autoEditBuildId)
    if (b) {
      fillBuildForm(b)
      setTab("add_build")
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
      lock_prices: buildForm.lock_prices,
      image_urls: buildForm.image_urls,
      parent_id: buildForm.parent_id,
      components: buildComponents.map(c => ({
        slot: c.slot, source: c.source, source_id: c.source_id,
        // price — зафиксированная цена (используется при lock_prices=true).
        // Если цены зафиксированы, сохраняем то, что видит админ (current_price).
        name: c.name, price: buildForm.lock_prices ? compPrice(c) : c.price,
        qty: c.qty, image_urls: c.image_urls,
        // точки на фото сборки для витрины (в %). points — массив (для qty>1),
        // point дублируем первой точкой для обратной совместимости.
        points: c.points ?? (c.point ? [c.point] : null),
        point: (c.points && c.points[0]) ?? c.point ?? null,
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
    setBuildForm({ id: null, name: "", description: "", status: "catalog", is_featured: false, in_stock: false, assembly_type: "percent", assembly_fee_manual: "", image_urls: [], sell_with_vat: false, lock_prices: false, parent_id: null })
    setBuildComponents([])
    setBuildTagIds([])
    setPointPickIdx(null)
    setAutoEditBuildId?.(null)
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

  // «Скопировать билд» — самостоятельная независимая копия (в отличие от
  // «Вариант» не привязана как parent_id к оригиналу, свободно редактируется
  // и удаляется отдельно от него).
  const copyBuild = async (b: PCBuild) => {
    setCopyLoading(b.id)
    const res = await api.builds.create({
      ...b, id: undefined, name: b.name + " (копия)", status: "draft",
      parent_id: null, client_token: null, short_code: null,
    })
    if (res.id) {
      const d = await api.builds.getAll()
      setBuilds(Array.isArray(d) ? d : (d.builds || []))
    }
    setCopyLoading(null)
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
    setBuildComponents(cs => [...cs, { slot, source: "catalog", source_id: comp.id, name: comp.name, price: comp.price, current_price: comp.price, qty: 1 }])
    setAddingSlot(null)
  }

  const removeComponent = (sourceId: number) => {
    setBuildComponents(cs => cs.filter(c => c.source_id !== sourceId))
  }

  const setComponentQty = (sourceId: number, delta: number) => {
    setBuildComponents(cs => cs.map(c => c.source_id === sourceId
      ? { ...c, qty: Math.max(1, (c.qty || 1) + delta) } : c))
  }

  // BUILDS LIST + ARCHIVE (тогл внутри одной вкладки)
  if (tab === "builds" || tab === "archive") {
    const showArchive = buildsViewArchive
    return (
      <BuildsList
        builds={builds.filter(b => showArchive ? b.status === "archive" : b.status !== "archive")}
        loading={loading}
        expandedVariants={expandedVariants} setExpandedVariants={setExpandedVariants}
        dupeLoading={dupeLoading} copyLoading={copyLoading} copiedBuildId={copiedBuildId} fmt={fmt}
        onNew={() => { setAutoEditBuildId?.(null); setBuildForm({ id: null, name: "", description: "", status: "catalog", is_featured: false, in_stock: false, assembly_type: "percent", assembly_fee_manual: "", image_urls: [], sell_with_vat: false, lock_prices: false, parent_id: null }); setBuildComponents([]); setTab("add_build") }}
        onEdit={editBuild} onDupe={duplicateBuild} onCopy={copyBuild} onLink={generateClientLink}
        onStatus={async (b, status) => { await api.builds.patch({ id: b.id, status }); setBuilds(bs => bs.map(bb => bb.id === b.id || bb.parent_id === b.id ? { ...bb, status } : bb)) }}
        onDelete={deleteBuild} isArchive={showArchive}
        onToggleArchive={() => setBuildsViewArchive(v => !v)} />
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
              {(() => {
                // Фиксированный порядок вывода компонентов сборки (по типу слота).
                // Оригинальный индекс i сохраняем для операций (qty/фото/удаление).
                const SLOT_ORDER = ["cpu", "motherboard", "ram", "gpu", "storage", "cooling", "fan", "psu", "case"]
                const ord = (s: string) => { const k = SLOT_ORDER.indexOf(s); return k === -1 ? SLOT_ORDER.length : k }
                return buildComponents
                  .map((c, i) => ({ c, i }))
                  .sort((a, b) => ord(a.c.slot) - ord(b.c.slot))
                  .map(({ c, i }) => (
                <div key={i} className="rounded-lg border border-border/40 bg-card/60">
                  <div className="flex items-center gap-2 text-sm px-3 py-2">
                    <span className="w-24 shrink-0 text-xs text-foreground/50 font-mono truncate">{c.slot}</span>
                    <span className="flex-1 text-foreground font-medium truncate">{c.name}</span>
                    {(c.image_urls?.length ?? 0) > 0 && <span className="shrink-0 text-[10px] text-primary/70 font-mono">{c.image_urls!.length}ф</span>}
                    {c.point && <span className="shrink-0" title="Точка на фото задана"><Icon name="MapPin" size={12} className="text-emerald-400" /></span>}
                    <div className="flex items-center gap-1 shrink-0">
                      <button type="button" onClick={() => setComponentQty(c.source_id ?? 0, -1)} className="h-5 w-5 rounded border border-border text-foreground/50 hover:border-primary hover:text-primary transition-colors flex items-center justify-center" style={{ cursor: "pointer" }}><Icon name="Minus" size={10} /></button>
                      <span className="w-5 text-center text-xs font-bold text-foreground">{c.qty || 1}</span>
                      <button type="button" onClick={() => setComponentQty(c.source_id ?? 0, 1)} className="h-5 w-5 rounded border border-border text-foreground/50 hover:border-primary hover:text-primary transition-colors flex items-center justify-center" style={{ cursor: "pointer" }}><Icon name="Plus" size={10} /></button>
                    </div>
                    {(buildForm.lock_prices || (c.current_price ?? c.price) === 0) ? (
                      <div className="flex items-center gap-0.5 shrink-0 w-28">
                        <input type="number" min={0} placeholder="цена" value={c.price === 0 ? "" : c.price}
                          onChange={e => { const val = Number(e.target.value) || 0; setBuildComponents(cs => cs.map((comp, ci) => ci === i ? { ...comp, price: val, current_price: val } : comp)) }}
                          className="w-full rounded border border-border bg-background px-2 py-0.5 text-xs text-primary font-bold text-right focus:border-primary focus:outline-none" style={{ cursor: "text" }} />
                        <span className="text-xs text-foreground/40 shrink-0">₽</span>
                      </div>
                    ) : (
                      <span className="shrink-0 font-bold text-primary text-xs w-20 text-right">{fmt(compPrice(c) * (c.qty || 1))}</span>
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
                ))
              })()}
            </div>
          )}

          {/* Точки железок на фото сборки (для витрины /build-preview).
              Одно общее фото сборки: выбираем железку слева и кликаем по фото. */}
          {buildComponents.length > 0 && (buildForm.image_urls?.length ?? 0) > 0 && (
            <div className="mb-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
              <div className="mb-2 flex items-center gap-2">
                <Icon name="MapPin" size={14} className="text-primary" />
                <h3 className="text-sm font-medium text-foreground">Точки железок на фото</h3>
                <span className="text-xs text-foreground/40">выберите железку и кликайте по фото (можно несколько точек)</span>
              </div>
              <div className="flex flex-col gap-4 md:flex-row">
                {/* Список железок слева */}
                <div className="w-full shrink-0 space-y-1 md:w-64">
                  {buildComponents.map((c, i) => {
                    const pts = c.points ?? (c.point ? [c.point] : [])
                    return (
                    <div key={i}
                      className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${pointPickIdx === i ? "border-primary bg-primary/10" : "border-border/50 hover:border-primary/50"}`}>
                      <button type="button" onClick={() => setPointPickIdx(pointPickIdx === i ? null : i)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left" style={{ cursor: "pointer" }}>
                        <span className="w-16 shrink-0 truncate font-mono text-foreground/50">{c.slot}</span>
                        <span className="min-w-0 flex-1 truncate text-foreground">{c.name}</span>
                        {(c.qty || 1) > 1 && <span className="shrink-0 rounded bg-primary/15 px-1 text-[9px] font-bold text-primary">×{c.qty}</span>}
                      </button>
                      {pts.length > 0 ? (
                        <span className="flex shrink-0 items-center gap-1">
                          <span className="flex items-center gap-0.5 text-emerald-400"><Icon name="MapPin" size={11} />{pts.length}</span>
                          <button type="button" title="Убрать все точки"
                            onClick={() => setBuildComponents(cs => cs.map((comp, ci) => ci === i ? { ...comp, point: null, points: null } : comp))}
                            className="text-foreground/30 hover:text-red-400" style={{ cursor: "pointer" }}><Icon name="X" size={11} /></button>
                        </span>
                      ) : (
                        <span className="shrink-0 text-[10px] text-foreground/30">нет</span>
                      )}
                    </div>
                  )})}
                </div>
                {/* Фото сборки с точками */}
                <div className="flex-1">
                  <div
                    className="relative w-full overflow-hidden rounded-lg border border-border bg-black/20"
                    style={{ cursor: pointPickIdx !== null ? "crosshair" : "default" }}
                    onClick={e => {
                      if (pointPickIdx === null) return
                      const r = e.currentTarget.getBoundingClientRect()
                      const x = Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100))
                      const y = Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100))
                      const pt = { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }
                      // ДОБАВЛЯЕМ точку в список (не заменяем) — можно несколько на железку
                      setBuildComponents(cs => cs.map((comp, ci) => {
                        if (ci !== pointPickIdx) return comp
                        const cur = comp.points ?? (comp.point ? [comp.point] : [])
                        return { ...comp, points: [...cur, pt], point: cur[0] ?? pt }
                      }))
                    }}>
                    <img src={buildForm.image_urls[0]} alt="" className="block w-full select-none" draggable={false} />
                    {buildComponents.map((c, i) => {
                      const pts = c.points ?? (c.point ? [c.point] : [])
                      return pts.map((p, pi) => (
                        <div key={`${i}-${pi}`} className="absolute -translate-x-1/2 -translate-y-1/2"
                          style={{ left: `${p.x}%`, top: `${p.y}%` }}>
                          {/* Клик по точке в режиме её железки — удаляет эту точку */}
                          <button type="button" title="Удалить точку"
                            onClick={ev => {
                              ev.stopPropagation()
                              if (pointPickIdx !== i) { setPointPickIdx(i); return }
                              setBuildComponents(cs => cs.map((comp, ci) => {
                                if (ci !== i) return comp
                                const cur = (comp.points ?? (comp.point ? [comp.point] : [])).filter((_, k) => k !== pi)
                                return { ...comp, points: cur.length ? cur : null, point: cur[0] ?? null }
                              }))
                            }}
                            className={`block h-4 w-4 rounded-full border-2 border-white shadow-lg ${pointPickIdx === i ? "bg-emerald-400 ring-2 ring-emerald-300/50" : "bg-primary ring-2 ring-primary/40"}`}
                            style={{ cursor: "pointer" }} />
                          <span className="pointer-events-none absolute left-1/2 top-5 -translate-x-1/2 whitespace-nowrap rounded bg-background/85 px-1.5 py-0.5 text-[9px] font-medium text-foreground shadow backdrop-blur-sm">{c.name.slice(0, 18)}{pts.length > 1 ? ` #${pi + 1}` : ""}</span>
                        </div>
                      ))
                    })}
                  </div>
                  {pointPickIdx !== null && (
                    <p className="mt-1.5 text-xs text-primary">Кликайте по фото — добавляете точки для: <b>{buildComponents[pointPickIdx]?.name}</b>. Клик по точке — удалить её.</p>
                  )}
                </div>
              </div>
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
                7% автоматически ({fmt(Math.ceil(partsTotal * 0.07 / 250) * 250)})
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
          <label className="flex items-start gap-2 text-sm text-foreground/70 border-t border-border pt-3 mt-3 cursor-pointer" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={buildForm.lock_prices} onChange={e => setBuildForm(f => ({ ...f, lock_prices: e.target.checked }))} className="rounded mt-0.5" />
            <span>
              Фиксировать цены
              <span className="block text-xs text-foreground/40">
                {buildForm.lock_prices
                  ? "Цены вбиты вручную и не меняются при изменении каталога"
                  : "Цены синхронизируются со складом (актуальная цена каталога)"}
              </span>
            </span>
          </label>
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
          <button type="button" onClick={() => { setAutoEditBuildId?.(null); setTab("builds") }} className="rounded-lg border border-border px-6 py-2.5 text-sm text-foreground/70 hover:border-primary hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
            Отмена
          </button>
        </div>
      </form>
    </div>
  )

  return null
}