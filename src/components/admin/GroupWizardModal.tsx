import { useEffect, useMemo, useState } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  NameBlock, templateForSlug, buildName, blockVisible, COLOR_NAME,
} from "./groupNameTemplates"
import { matchesSearch } from "@/lib/keyboardLayout"

interface Group {
  id?: number
  product_id?: number | null
  name?: string
  category?: string | null
  part_number?: string | null
  warranty_months?: number
  price_retail?: number
  price_opt1?: number
  price_opt2?: number
  url_site?: string | null
  url_supplier?: string | null
  cell?: string | null
}

interface SpecAttr { id: number; category_id: number; code: string; options?: string[]; field_type?: string }
interface SpecCat { id: number; product_category_slug?: string | null }
interface CatalogCat { id: number; name: string; slug: string }

export default function GroupWizardModal({ group, onClose, onSaved, receiptHint }: {
  group: Group | null
  onClose: () => void
  onSaved: () => void
  receiptHint?: string | null   // сырое название из чека (для приёмки по счёту)
}) {
  const isNew = !group?.id

  // ── Справочники ────────────────────────────────────────────────────────────
  const [catalogCats, setCatalogCats] = useState<CatalogCat[]>([])
  const [brands, setBrands] = useState<{ id: number; name: string }[]>([])
  const [specCats, setSpecCats] = useState<SpecCat[]>([])
  const [specAttrs, setSpecAttrs] = useState<SpecAttr[]>([])

  // Свежая схема совместимости (характеристики + их варианты). Тянем НАЛЕТУ:
  // при открытии мастера и каждый раз при возврате фокуса на вкладку — чтобы
  // новые варианты, добавленные в разделе «Совместимость», сразу появлялись.
  const loadSpecSchema = () => api.warehouse.specSchema()
    .then(d => { setSpecCats(d.categories || []); setSpecAttrs(d.attributes || []) })
    .catch(() => {})

  useEffect(() => {
    api.products.getAll().then(d => setCatalogCats(d.categories || [])).catch(() => {})
    api.brands.getAll().then(d => setBrands(d.brands || [])).catch(() => {})
    loadSpecSchema()
    // Обновляем характеристики, когда админ вернулся к вкладке (мог поменять
    // варианты в «Совместимости» в соседней вкладке).
    const onFocus = () => loadSpecSchema()
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [])

  // ── Состояние мастера ───────────────────────────────────────────────────────
  const [step, setStep] = useState(0)
  const [categoryName, setCategoryName] = useState(group?.category || "")
  const [brand, setBrand] = useState("")
  const [blockVals, setBlockVals] = useState<Record<string, string>>({})
  const [manualName, setManualName] = useState("")          // для категорий без шаблона
  const [nameOverride, setNameOverride] = useState("")      // ручная правка итогового названия
  const [fin, setFin] = useState({
    part_number: group?.part_number || "",
    cell: group?.cell || "",
    warranty_months: group?.warranty_months ?? 12,
    price_retail: group?.price_retail ?? 0,
    price_opt1: group?.price_opt1 ?? 0,
    price_opt2: group?.price_opt2 ?? 0,
    url_site: group?.url_site || "",
    url_supplier: group?.url_supplier || "",
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [suggest, setSuggest] = useState<string[]>([])

  // ── Категория каталога / шаблон ─────────────────────────────────────────────
  const catSlug = catalogCats.find(c => c.name === categoryName)?.slug || null
  const tpl = templateForSlug(catSlug)
  const visibleBlocks = useMemo<NameBlock[]>(
    () => tpl ? tpl.blocks.filter(b => blockVisible(tpl, b, blockVals)) : [],
    [tpl, blockVals])

  // attrCode → attribute_id для выбранной категории
  const attrIdByCode = useMemo(() => {
    const m: Record<string, number> = {}
    const sc = specCats.find(c => c.product_category_slug === catSlug)
    if (sc) specAttrs.filter(a => a.category_id === sc.id).forEach(a => { m[a.code] = a.id })
    return m
  }, [specCats, specAttrs, catSlug])

  // attrCode → характеристика совместимости (для подтягивания вариантов)
  const attrByCode = useMemo(() => {
    const m: Record<string, SpecAttr> = {}
    const sc = specCats.find(c => c.product_category_slug === catSlug)
    if (sc) specAttrs.filter(a => a.category_id === sc.id).forEach(a => { m[a.code] = a })
    return m
  }, [specCats, specAttrs, catSlug])

  // Варианты для select-блока: объединяем варианты из «Совместимости»
  // (spec_attributes.options) со статичным списком шаблона. Приоритет —
  // у совместимости (её варианты идут первыми), дубликаты убираем. Так новые
  // значения, добавленные в разделе «Совместимость», появляются сразу.
  const optionsFor = (block: NameBlock): string[] => {
    const fromCompat = (block.attrCode ? attrByCode[block.attrCode]?.options : undefined) || []
    const fromTpl = block.options || []
    if (fromCompat.length === 0) return fromTpl
    const seen = new Set<string>()
    const merged: string[] = []
    for (const opt of [...fromCompat, ...fromTpl]) {
      const key = opt.trim().toLowerCase()
      if (!key || seen.has(key)) continue
      seen.add(key)
      merged.push(opt)
    }
    return merged
  }

  // Шаги: 0 категория, 1 бренд, 2..(2+blocks-1) блоки, последний — финал
  const STEP_CATEGORY = 0
  const STEP_BRAND = 1
  const blockStart = 2
  const finStep = blockStart + visibleBlocks.length
  const totalSteps = finStep + 1

  const curBlock = step >= blockStart && step < finStep ? visibleBlocks[step - blockStart] : null

  // Подсказки моделей/линеек — distinct значения характеристики
  useEffect(() => {
    setSuggest([])
    if (curBlock?.suggest && curBlock.attrCode && attrIdByCode[curBlock.attrCode]) {
      api.warehouse.specAttrSuggest(attrIdByCode[curBlock.attrCode])
        .then(d => setSuggest(d.values || [])).catch(() => {})
    }
  }, [curBlock?.key, attrIdByCode])

  // При переходе на select-блок подтягиваем свежие варианты из «Совместимости»
  // (на случай, если их только что добавили) — чтобы список был актуальным.
  useEffect(() => {
    if (curBlock?.input === "select") loadSpecSchema()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curBlock?.key])

  // При редактировании восстанавливаем БРЕНД из начала старого названия
  // (бренд в названии хранится первым словом/словами).
  useEffect(() => {
    if (isNew || brand || !group?.name || brands.length === 0) return
    const nameLow = group.name.trim().toLowerCase()
    // ищем самый длинный бренд, с которого начинается название
    const match = brands
      .filter(b => nameLow.startsWith(b.name.toLowerCase()))
      .sort((a, b) => b.name.length - a.name.length)[0]
    if (match) setBrand(match.name)
  }, [isNew, group?.name, brands, brand])

  // Подгрузка имеющихся характеристик при редактировании (заполняем блоки).
  // Если характеристик нет (старый товар) — пытаемся восстановить select-блоки
  // из старого названия, чтобы прошлый выбор не терялся.
  useEffect(() => {
    if (!group?.product_id || !tpl || specAttrs.length === 0) return
    api.warehouse.specValuesGet(group.product_id).then(d => {
      const vals = d.values || {}
      const byCode: Record<string, string> = {}
      tpl.blocks.forEach(b => {
        if (b.attrCode && attrIdByCode[b.attrCode] !== undefined) {
          const v = vals[String(attrIdByCode[b.attrCode])]
          if (v === undefined || v === null) return
          // multiselect возвращается массивом — берём первый элемент для блока
          if (Array.isArray(v)) { if (v.length) byCode[b.key] = String(v[0]) }
          else byCode[b.key] = String(v)
        }
      })
      // Фолбэк по названию: для select-блоков ищем вариант в старом имени
      const nameLow = (group.name || "").toLowerCase()
      if (nameLow) {
        tpl.blocks.forEach(b => {
          if (byCode[b.key]) return
          if (b.input === "select" && b.options) {
            const found = b.options.find(opt => {
              if (opt === "-" || !opt.trim()) return false
              const en = (COLOR_NAME[opt] || opt).toLowerCase()
              const ru = opt.toLowerCase()
              // мощность "750 Вт" → "750w", стандарт "ATX 3.1" → "atx3.1"
              const watt = ru.replace(/\s*вт\s*/i, "w")
              const std = ru.replace(/\s+/g, "")
              return nameLow.includes(en) || nameLow.includes(ru) || nameLow.includes(watt) || nameLow.includes(std)
            })
            if (found) byCode[b.key] = found
          }
        })
      }
      setBlockVals(p => ({ ...byCode, ...p }))
    }).catch(() => {})
  }, [group?.product_id, tpl?.slug, attrIdByCode])

  const liveName = buildName(brand, tpl, tpl ? blockVals : { __manual__: manualName })
  // Итоговое название: ручная правка приоритетнее автосборки
  const finalName = nameOverride.trim() ? nameOverride : liveName
  // Старое название (как сейчас в товаре) — для сравнения при редактировании
  const oldName = (group?.name || "").trim()
  // Разбиваем новое имя на токены; токены, которых нет в старом имени,
  // подсвечиваем зелёным (то, что изменилось/добавилось).
  const oldTokens = oldName.toLowerCase().split(/\s+/).filter(Boolean)
  const nameDiff = liveName.split(/(\s+)/).map((tok, i) => {
    if (/^\s+$/.test(tok) || !tok) return { text: tok, changed: false, key: i }
    return { text: tok, changed: !oldTokens.includes(tok.toLowerCase()), key: i }
  })
  const nameChanged = !isNew && oldName !== "" && oldName !== liveName

  // ── Навигация ───────────────────────────────────────────────────────────────
  const canNext = (): boolean => {
    if (step === STEP_CATEGORY) return !!categoryName
    if (step === STEP_BRAND) return true   // бренд опционален
    if (curBlock) return !curBlock.required || !!(blockVals[curBlock.key] || "").trim()
    return true
  }
  const next = () => { if (canNext()) setStep(s => Math.min(s + 1, totalSteps - 1)); else setError("Заполните поле") }
  const prev = () => { setError(""); setStep(s => Math.max(s - 1, 0)) }
  const setBlock = (key: string, v: string) => { setError(""); setBlockVals(p => ({ ...p, [key]: v })) }

  // ── Сохранение ────────────────────────────────────────────────────────────────
  const save = async () => {
    setError("")
    if (!finalName.trim()) { setError("Название не собрано"); return }
    if (!categoryName) { setError("Выберите категорию"); return }
    if (!(fin.price_retail > 0)) { setError("Укажите цену продажи"); return }

    const catId = catalogCats.find(c => c.name === categoryName)?.id
    const payload = {
      name: finalName.trim(),
      category: categoryName,
      category_id: catId,
      part_number: fin.part_number,
      cell: fin.cell,
      warranty_months: fin.warranty_months,
      price_retail: fin.price_retail,
      price_opt1: fin.price_opt1,
      price_opt2: fin.price_opt2,
      url_site: fin.url_site,
      url_supplier: fin.url_supplier,
    }
    setLoading(true)
    const data = isNew
      ? await api.warehouse.createGroup(payload)
      : await api.warehouse.updateGroup({ id: group!.id, ...payload })
    if (data.error) { setLoading(false); setError(data.error); return }

    // Сохраняем характеристики (значения блоков по attrCode → attribute_id)
    const pid = data.product_id || group?.product_id
    if (pid && tpl) {
      const specVals: Record<string, string | string[]> = {}
      tpl.blocks.forEach(b => {
        const v = (blockVals[b.key] || "").trim()
        if (b.attrCode && attrIdByCode[b.attrCode] !== undefined && v) {
          // multiselect-характеристики сохраняем массивом, чтобы значение
          // корректно легло в совместимость (value_json), иначе — строкой.
          const isMulti = attrByCode[b.attrCode]?.field_type === "multiselect"
          specVals[String(attrIdByCode[b.attrCode])] = isMulti ? [v] : v
        }
      })
      // ОЗУ: авто «Объём комплекта» = планки × объём 1 планки
      if (tpl.slug === "ram") {
        const n = parseInt(blockVals["modules"] || "0", 10)
        const cap = parseInt(blockVals["module_cap"] || "0", 10)
        if (n && cap && attrIdByCode["capacity_gb"] !== undefined) {
          specVals[String(attrIdByCode["capacity_gb"])] = String(n * cap)
        }
      }
      if (Object.keys(specVals).length > 0) await api.warehouse.specValuesSave(pid, specVals)
    }
    setLoading(false)
    onSaved()
    onClose()
  }

  // ── Бренд-пикер ───────────────────────────────────────────────────────────────
  const [brandSearch, setBrandSearch] = useState("")
  const [creatingBrand, setCreatingBrand] = useState(false)
  const brandResults = brandSearch.trim()
    ? brands.filter(b => matchesSearch(b.name, brandSearch)).slice(0, 40)
    : brands.slice(0, 40)
  // Точное совпадение по имени (без учёта регистра) — чтобы не дублировать бренд
  const brandExact = brands.some(b => b.name.toLowerCase() === brandSearch.trim().toLowerCase())

  // Создать новый бренд из строки поиска и сразу выбрать его
  const createBrand = async () => {
    const name = brandSearch.trim()
    if (!name) return
    setCreatingBrand(true)
    const res = await api.brands.create({ name })
    setCreatingBrand(false)
    if (res?.error) return
    const created = { id: res.id ?? Date.now(), name }
    setBrands(bs => [...bs, created].sort((a, b) => a.name.localeCompare(b.name)))
    setBrand(name)
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-2 bg-black/60 p-4" onDoubleClick={onClose}>
      {/* Подсказка из чека — копируемое название над окном мастера */}
      {receiptHint && (
        <div className="w-full max-w-lg rounded-xl border border-amber-400/50 bg-card px-3 py-2 shadow-lg" onDoubleClick={e => e.stopPropagation()}>
          <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-amber-600">
            <Icon name="ClipboardCopy" fallback="Copy" size={12} /> Название из счёта (выделите и скопируйте нужное):
          </p>
          <p className="select-text cursor-text break-words text-sm text-foreground" style={{ userSelect: "text" }}>
            {receiptHint}
          </p>
        </div>
      )}
      <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-2xl" onDoubleClick={e => e.stopPropagation()}>
        {/* Заголовок + прогресс */}
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{isNew ? "Новая группа товара" : "Редактировать группу"}</h2>
          <button onClick={onClose} style={{ cursor: "pointer" }}><Icon name="X" size={18} className="text-foreground/40" /></button>
        </div>

        {/* Превью названия */}
        <div className="mb-4 rounded-lg border border-border bg-muted/40 px-3 py-2">
          {/* При редактировании — старое название сверху */}
          {!isNew && oldName && (
            <div className="mb-1.5 border-b border-border/60 pb-1.5">
              <p className="text-[11px] text-foreground/40">Было</p>
              <p className={`text-sm ${nameChanged ? "text-foreground/50 line-through" : "text-foreground/70"}`}>{oldName}</p>
            </div>
          )}
          <p className="text-[11px] text-foreground/40">{!isNew && oldName ? "Станет" : "Итоговое название"}</p>
          <p className="text-sm font-medium text-foreground">
            {liveName
              ? nameDiff.map(t => (
                  t.changed
                    ? <span key={t.key} className="rounded bg-green-500/25 px-0.5 text-green-700 dark:text-green-300">{t.text}</span>
                    : <span key={t.key}>{t.text}</span>
                ))
              : "—"}
          </p>
        </div>

        {/* Прогресс-точки */}
        <div className="mb-4 flex gap-1">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div key={i} className={`h-1.5 flex-1 rounded-full ${i === step ? "bg-primary" : i < step ? "bg-primary/40" : "bg-muted"}`} />
          ))}
        </div>

        {/* ── Шаг: Категория ── */}
        {step === STEP_CATEGORY && (
          <div>
            <label className="mb-2 block text-sm font-medium">Категория *</label>
            <div className="grid grid-cols-2 gap-2">
              {catalogCats.map(c => (
                <button key={c.id} type="button" onClick={() => { setCategoryName(c.name); setBlockVals({}) }} style={{ cursor: "pointer" }}
                  className={`rounded-lg border px-3 py-2 text-sm transition-colors ${categoryName === c.name ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/70 hover:border-primary"}`}>
                  {c.name}
                </button>
              ))}
            </div>
            {categoryName && !tpl && (
              <p className="mt-3 text-xs text-foreground/40">Для этой категории шаблон не задан — название введёте вручную.</p>
            )}
          </div>
        )}

        {/* ── Шаг: Бренд ── */}
        {step === STEP_BRAND && (
          <div>
            <label className="mb-2 block text-sm font-medium">Бренд</label>
            <Input autoFocus value={brandSearch} onChange={e => setBrandSearch(e.target.value)} placeholder="Поиск бренда..." className="mb-2"
              onKeyDown={e => {
                if (e.key !== "Enter") return
                e.preventDefault()
                if (brandResults.length > 0) setBrand(brandResults[0].name)
                else if (brandSearch.trim() && !brandExact) createBrand()
              }} />
            {brand && <p className="mb-2 text-sm">Выбран: <span className="font-medium text-primary">{brand}</span></p>}
            <div className="max-h-52 overflow-y-auto rounded-lg border border-border">
              {brandResults.map(b => (
                <button key={b.id} type="button" onClick={() => setBrand(b.name)} style={{ cursor: "pointer" }}
                  className={`flex w-full items-center px-3 py-1.5 text-left text-sm hover:bg-muted transition-colors ${brand === b.name ? "text-primary" : "text-foreground/80"}`}>
                  {b.name}
                </button>
              ))}
              {brandResults.length === 0 && <p className="px-3 py-3 text-center text-xs text-foreground/40">Ничего не найдено</p>}
            </div>
            {/* Если бренда нет в списке — предлагаем создать его */}
            {brandSearch.trim() && !brandExact && (
              <button type="button" onClick={createBrand} disabled={creatingBrand} style={{ cursor: "pointer" }}
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-primary/50 px-3 py-2 text-sm text-primary hover:bg-primary/10 disabled:opacity-50 transition-colors">
                <Icon name={creatingBrand ? "Loader" : "Plus"} size={15} />
                {creatingBrand ? "Создание..." : <>Создать бренд «{brandSearch.trim()}»</>}
              </button>
            )}
          </div>
        )}

        {/* ── Шаг: блок названия ── */}
        {curBlock && (
          <div>
            <label className="mb-2 block text-sm font-medium">
              {curBlock.label}{curBlock.required && <span className="text-primary"> *</span>}
            </label>
            {curBlock.input === "select" ? (
              <div className="flex flex-wrap gap-2">
                {optionsFor(curBlock).map(opt => (
                  <button key={opt} type="button" onClick={() => setBlock(curBlock.key, blockVals[curBlock.key] === opt ? "" : opt)} style={{ cursor: "pointer" }}
                    className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${blockVals[curBlock.key] === opt ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/70 hover:border-primary"}`}>
                    {opt}
                  </button>
                ))}
              </div>
            ) : (
              <>
                <Input autoFocus value={blockVals[curBlock.key] || ""} onChange={e => setBlock(curBlock.key, e.target.value)}
                  placeholder={curBlock.hint || ""}
                  onKeyDown={e => { if (e.key === "Enter") next() }} />
                {suggest.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {suggest
                      .filter(s => !blockVals[curBlock.key] || s.toLowerCase().includes((blockVals[curBlock.key] || "").toLowerCase()))
                      .slice(0, 12)
                      .map(s => (
                        <button key={s} type="button" onClick={() => setBlock(curBlock.key, s)} style={{ cursor: "pointer" }}
                          className="rounded-full border border-border px-2.5 py-1 text-xs text-foreground/60 hover:border-primary hover:text-foreground transition-colors">
                          {s}
                        </button>
                      ))}
                  </div>
                )}
              </>
            )}
            {curBlock.nameSuffix && (
              <p className="mt-1.5 text-[11px] text-foreground/40">В названии: {(blockVals[curBlock.key] || "…")}{curBlock.nameSuffix}</p>
            )}
          </div>
        )}

        {/* ── Шаг: ручное название (категории без шаблона) ── */}
        {!tpl && step >= blockStart && step < finStep && (
          <div>
            <label className="mb-2 block text-sm font-medium">Название *</label>
            <Input autoFocus value={manualName} onChange={e => setManualName(e.target.value)} placeholder="Название товара" />
          </div>
        )}

        {/* ── Шаг: Финал ── */}
        {step === finStep && (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <div className="mb-1 flex items-center justify-between">
                <label className="block text-xs text-foreground/50">Наименование *</label>
                {nameOverride.trim() && nameOverride.trim() !== liveName && (
                  <button
                    type="button"
                    onClick={() => setNameOverride("")}
                    className="text-[11px] text-amber-600 hover:underline"
                  >
                    Вернуть авто
                  </button>
                )}
              </div>
              <Input
                value={nameOverride || liveName}
                onChange={e => setNameOverride(e.target.value)}
                placeholder="Полное наименование товара"
              />
              <p className="mt-1 text-[11px] text-foreground/40">
                Можно дополнить или поправить вручную. Пусто = собранное автоматически.
              </p>
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-xs text-foreground/50">Партнамбер</label>
              <Input value={fin.part_number} onChange={e => setFin(p => ({ ...p, part_number: e.target.value }))} placeholder="BX8071514900K" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-foreground/50">Ячейка</label>
              <Input value={fin.cell} onChange={e => setFin(p => ({ ...p, cell: e.target.value }))} placeholder="A1-2" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-foreground/50">Гарантия (мес.) *</label>
              <Input type="number" value={fin.warranty_months || ""} onChange={e => setFin(p => ({ ...p, warranty_months: parseFloat(e.target.value) || 0 }))} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-foreground/50">Цена продажи *</label>
              <Input type="number" value={fin.price_retail || ""} onChange={e => setFin(p => ({ ...p, price_retail: parseFloat(e.target.value) || 0 }))} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-foreground/50">Опт 1</label>
              <Input type="number" value={fin.price_opt1 || ""} onChange={e => setFin(p => ({ ...p, price_opt1: parseFloat(e.target.value) || 0 }))} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-foreground/50">Опт 2</label>
              <Input type="number" value={fin.price_opt2 || ""} onChange={e => setFin(p => ({ ...p, price_opt2: parseFloat(e.target.value) || 0 }))} />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-xs text-foreground/50">Ссылка на сайте</label>
              <Input value={fin.url_site} onChange={e => setFin(p => ({ ...p, url_site: e.target.value }))} placeholder="https://..." />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-xs text-foreground/50">Ссылка у поставщика</label>
              <Input value={fin.url_supplier} onChange={e => setFin(p => ({ ...p, url_supplier: e.target.value }))} placeholder="https://..." />
            </div>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

        {/* Навигация */}
        <div className="mt-5 flex items-center justify-between">
          <Button variant="outline" onClick={step === 0 ? onClose : prev}>
            {step === 0 ? "Отмена" : "Назад"}
          </Button>
          {step === finStep ? (
            <Button onClick={save} disabled={loading}>{loading ? "Сохранение..." : isNew ? "Создать" : "Сохранить"}</Button>
          ) : (
            <Button onClick={next} disabled={!canNext()}>Далее</Button>
          )}
        </div>
      </div>
    </div>
  )
}