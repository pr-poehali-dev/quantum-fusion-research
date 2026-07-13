import { useState, useEffect, useRef } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { Store, Group } from "./types"
import { checkSerialSound, useArchivedSerialCheck } from "./serialCheck"

export function QuickSupplyModal({ stores, onClose, onSaved }: {
  stores: Store[]
  onClose: () => void
  onSaved: () => void
}) {
  const [searchQ, setSearchQ] = useState("")
  const [searchResults, setSearchResults] = useState<Group[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null)
  const [form, setForm] = useState({
    store_id: "" as number | "",
    qty: "" as string,
    cost_price: "" as string,
    purchase_date: new Date().toISOString().substring(0, 10),
    has_vat: null as boolean | null,
    is_used: false,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [showErrors, setShowErrors] = useState(false)

  const qtyNum = parseInt(form.qty) || 0
  const costNum = parseFloat(form.cost_price) || 0

  // Условия валидности: выбран магазин, кол-во (> 0), цена закупки (> 0) и выбран НДС (да/нет)
  const storeInvalid = form.store_id === "" || form.store_id == null
  const qtyInvalid = qtyNum <= 0
  const priceInvalid = costNum <= 0
  const vatInvalid = form.has_vat === null
  const canSave = !storeInvalid && !qtyInvalid && !priceInvalid && !vatInvalid
  const [alerts, setAlerts] = useState<{product: string, reserved: number, orders: number[]}[]>([])

  // ── Ввод серийников после приёмки (для категорий из учёта SN) ──
  const [snCats, setSnCats] = useState<{ category: string, require_serial: boolean }[]>([])
  const [snStep, setSnStep] = useState(false)
  const [snSupplyId, setSnSupplyId] = useState<number | null>(null)
  const [serials, setSerials] = useState<string[]>([])
  const snInputs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => { api.snArchive.getCategories().then(d => setSnCats(d.categories || [])) }, [])

  const snRule = snCats.find(c => c.category === selectedGroup?.category)
  const needSerials = !!snRule

  useEffect(() => {
    if (!searchQ || searchQ.length < 2) { setSearchResults([]); return }
    let cancelled = false
    setSearchLoading(true)
    api.warehouse.getGroups({ search: searchQ, limit: "10", offset: "0" })
      .then(d => { if (!cancelled) { setSearchResults(d.groups || []); setSearchLoading(false) } })
      .catch(() => { if (!cancelled) setSearchLoading(false) })
    return () => { cancelled = true }
  }, [searchQ])

  const save = async () => {
    if (!selectedGroup) return
    if (!canSave) { setShowErrors(true); return }
    setLoading(true)
    setError("")
    const data = await api.warehouse.createSupply({
      group_id: selectedGroup.id,
      store_id: form.store_id || null,
      qty: qtyNum,
      price_with_vat: costNum,
      has_vat: form.has_vat,
      purchase_date: form.purchase_date,
      is_used: form.is_used,
    })
    setLoading(false)
    if (data.error) { setError(data.error); return }
    // Б/У: сервер создал отдельную карточку товара для сайта — сообщаем менеджеру.
    if (form.is_used && data.used_product_id) {
      alert(
        `Партия принята как Б/У.\n\nСоздана отдельная карточка товара для сайта — ` +
        `её нужно заполнить (описание, цена, фото) во вкладке «Товары».`
      )
    }
    // Категория с учётом серийников → переходим к вводу SN (не закрываем).
    if (needSerials && data.id && qtyNum > 0) {
      setSnSupplyId(data.id)
      setSerials(Array.from({ length: qtyNum }, () => ""))
      setSnStep(true)
      if (data.negative_alerts?.length) setAlerts(data.negative_alerts)
      return
    }
    if (data.negative_alerts?.length) {
      setAlerts(data.negative_alerts)
      return
    }
    onSaved()
    onClose()
  }

  // Дубли внутри текущего ввода (без учёта регистра/пробелов)
  const dupIndexes = (() => {
    const seen = new Map<string, number>()
    const dup = new Set<number>()
    serials.forEach((s, i) => {
      const key = s.trim().toLowerCase()
      if (!key) return
      if (seen.has(key)) { dup.add(i); dup.add(seen.get(key)!) }
      else seen.set(key, i)
    })
    return dup
  })()

  // Серийники, уже принятые ранее (по всему архиву) — с указанием магазина
  const archivedHits = useArchivedSerialCheck(serials, snSupplyId)

  const saveSerials = async () => {
    const clean = serials.map(s => s.trim())
    if (snRule?.require_serial && clean.some(s => !s)) {
      setError("Заполни все серийные номера")
      return
    }
    if (dupIndexes.size) {
      setError("Есть повторяющиеся серийники — исправь подсвеченные строки")
      return
    }
    if (Object.keys(archivedHits).length) {
      setError("Некоторые серийники уже приняты ранее — исправь подсвеченные строки")
      return
    }
    setLoading(true)
    setError("")
    const data = await api.snArchive.addSerials({ supply_id: snSupplyId!, serials: clean.filter(Boolean) })
    setLoading(false)
    if (data.error) { setError(data.error); return }
    onSaved()
    onClose()
  }

  if (snStep) {
    const store = stores.find(s => s.id === form.store_id)
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Серийные номера</h2>
            <button onClick={onClose}><Icon name="X" size={18} className="text-foreground/40" /></button>
          </div>
          <div className="mb-4 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
            <p className="font-medium">{selectedGroup?.name}</p>
            <p className="mt-0.5 text-xs text-foreground/50">
              {serials.length} шт.
              {store && <> · магазин <span className="font-medium text-foreground/70">[{store.code}] {store.name}</span></>}
              {form.purchase_date && <> · принято {form.purchase_date.split("-").reverse().join(".")}</>}
            </p>
          </div>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
            {serials.map((sn, i) => {
              const isDup = dupIndexes.has(i)
              const hit = archivedHits[i]
              const bad = isDup || !!hit
              return (
                <div key={i}>
                  <div className="flex items-center gap-2">
                    <span className="w-6 shrink-0 text-right text-xs text-foreground/40">{i + 1}.</span>
                    <Input
                      ref={(el) => { snInputs.current[i] = el }}
                      autoFocus={i === 0}
                      value={sn}
                      placeholder="S/N"
                      className={bad ? "border-red-500 ring-1 ring-red-500" : ""}
                      onChange={e => setSerials(p => p.map((v, j) => j === i ? e.target.value : v))}
                      onKeyDown={e => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          checkSerialSound(sn, i, serials, snSupplyId)
                          if (i < serials.length - 1) snInputs.current[i + 1]?.focus()
                          else saveSerials()
                        }
                      }}
                    />
                    {bad && <Icon name="TriangleAlert" size={15} className="shrink-0 text-red-500" />}
                  </div>
                  {hit && (
                    <p className="ml-8 mt-0.5 text-[11px] text-red-500">
                      Уже принят{hit.store_name ? ` в [${hit.store_code}] ${hit.store_name}` : ""}
                      {hit.purchase_date ? ` (${hit.purchase_date.substring(0, 10).split("-").reverse().join(".")})` : ""}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
          {dupIndexes.size > 0 && <p className="mt-3 text-xs text-red-500">Повторяющиеся серийники подсвечены</p>}
          {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={saveSerials} disabled={loading || dupIndexes.size > 0 || Object.keys(archivedHits).length > 0}>
              {loading ? "Сохранение..." : "Сохранить серийники"}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (alerts.length) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-400/15">
            <Icon name="Bell" size={18} className="text-yellow-400" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Товар из резерва</h2>
            <p className="text-xs text-foreground/50">Поставка принята, резерв перераспределён</p>
          </div>
        </div>
        <div className="space-y-2 mb-5">
          {alerts.map((a, i) => (
            <div key={i} className="rounded-lg border border-yellow-400/20 bg-yellow-400/5 px-3 py-2 text-sm">
              <span className="text-yellow-400 font-medium">{a.product}</span>
              <span className="text-foreground/60"> — {a.reserved} шт. → </span>
              {a.orders.length ? <span className="text-foreground">заказ #{a.orders.join(', #')}</span> : <span className="text-foreground/40">заказы</span>}
            </div>
          ))}
        </div>
        <Button className="w-full" onClick={() => { onSaved(); onClose() }}>Понятно</Button>
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Принять поставку</h2>
          <button onClick={onClose}><Icon name="X" size={18} className="text-foreground/40" /></button>
        </div>

        {!selectedGroup ? (
          <div>
            <label className="mb-1.5 block text-xs text-foreground/50">Найдите товар</label>
            <Input
              autoFocus
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              placeholder="Название, артикул..."
            />
            {searchLoading && (
              <div className="flex items-center gap-2 py-4 text-foreground/40 text-sm">
                <Icon name="Loader" size={14} className="animate-spin" />Ищу...
              </div>
            )}
            {searchResults.length > 0 && (
              <div className="mt-2 space-y-1 max-h-64 overflow-y-auto">
                {searchResults.map(g => (
                  <button key={g.id} onClick={() => setSelectedGroup(g)} style={{ cursor: "pointer" }}
                    className="w-full flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2.5 text-sm hover:border-primary/40 hover:bg-muted transition-colors text-left">
                    <div>
                      <p className="font-medium">{g.name}</p>
                      <p className="text-xs text-foreground/40 font-mono">{g.sku} {g.category ? `· ${g.category}` : ""}</p>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <p className="text-sm font-bold text-primary">{g.price_retail ? g.price_retail.toLocaleString("ru-RU") + " ₽" : "—"}</p>
                      <p className="text-xs text-foreground/40">в наличии: {g.qty_total - g.qty_reserved}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {searchQ.length >= 2 && !searchLoading && searchResults.length === 0 && (
              <p className="mt-3 text-center text-sm text-foreground/40">Ничего не найдено</p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
              <div>
                <p className="font-medium text-sm">{selectedGroup.name}</p>
                <p className="text-xs text-foreground/40 font-mono">{selectedGroup.sku}</p>
              </div>
              <button onClick={() => setSelectedGroup(null)} style={{ cursor: "pointer" }}
                className="text-xs text-foreground/40 hover:text-foreground transition-colors">
                Изменить
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-foreground/50">Кол-во *</label>
                <Input type="number" min={1} value={form.qty} placeholder="0"
                  onChange={e => setForm(p => ({ ...p, qty: e.target.value }))}
                  className={showErrors && qtyInvalid ? "border-red-500 ring-1 ring-red-500" : ""} />
                {showErrors && qtyInvalid && <p className="mt-1 text-[11px] text-red-500">Укажите количество</p>}
              </div>
              <div>
                <label className="mb-1 block text-xs text-foreground/50">
                  {form.has_vat === false ? "Цена закупки без НДС *" : "Цена закупки с НДС *"}
                </label>
                <Input type="number" value={form.cost_price} placeholder="0"
                  onChange={e => setForm(p => ({ ...p, cost_price: e.target.value }))}
                  className={showErrors && priceInvalid ? "border-red-500 ring-1 ring-red-500" : ""} />
                {showErrors && priceInvalid && <p className="mt-1 text-[11px] text-red-500">Укажите цену закупки</p>}
              </div>
              <div>
                <label className="mb-1 block text-xs text-foreground/50">Магазин *</label>
                <select
                  className={`w-full rounded-lg border bg-background px-3 py-2 text-sm ${showErrors && storeInvalid ? "border-red-500 ring-1 ring-red-500" : "border-border"}`}
                  value={form.store_id}
                  onChange={e => setForm(p => ({ ...p, store_id: e.target.value ? parseInt(e.target.value) : "" }))}>
                  <option value="">Выберите магазин</option>
                  {[...stores].sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true })).map(s => <option key={s.id} value={s.id}>[{s.code}] {s.name}</option>)}
                </select>
                {showErrors && storeInvalid && <p className="mt-1 text-[11px] text-red-500">Выберите магазин</p>}
              </div>
              <div>
                <label className="mb-1 block text-xs text-foreground/50">Дата</label>
                <Input type="date" value={form.purchase_date}
                  onChange={e => setForm(p => ({ ...p, purchase_date: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs text-foreground/50">Товар с НДС? *</label>
              <div className="flex gap-2">
                <button type="button" onClick={() => setForm(p => ({ ...p, has_vat: true }))} style={{ cursor: "pointer" }}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${form.has_vat === true ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-primary/40"}`}>
                  Да, с НДС
                </button>
                <button type="button" onClick={() => setForm(p => ({ ...p, has_vat: false }))} style={{ cursor: "pointer" }}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${form.has_vat === false ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-primary/40"}`}>
                  Нет, без НДС
                </button>
              </div>
              {showErrors && vatInvalid && <p className="mt-1 text-[11px] text-red-500">Укажите, товар с НДС или без</p>}
            </div>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border px-3 py-2.5 transition-colors hover:border-primary/40">
              <input
                type="checkbox"
                checked={form.is_used}
                onChange={e => setForm(p => ({ ...p, is_used: e.target.checked }))}
                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-primary"
              />
              <span className="text-sm">
                <span className="font-medium">Товар Б/У (бывший в употреблении)</span>
                <span className="mt-0.5 block text-xs text-foreground/50">
                  Партия будет помечена как Б/У, и для сайта создастся отдельная карточка товара, которую нужно заполнить.
                </span>
              </span>
            </label>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={onClose}>Отмена</Button>
              <Button onClick={save} disabled={loading || !canSave}>
                <Icon name={loading ? "Loader" : "PackagePlus"} size={14} className={`mr-1.5 ${loading ? "animate-spin" : ""}`} />
                {loading ? "Сохраняю..." : "Принять"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}