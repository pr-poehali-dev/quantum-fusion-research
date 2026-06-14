import { useState, useEffect } from "react"
import Icon from "@/components/ui/icon"

const BASKET_URL = "https://functions.poehali.dev/8b2b8538-7489-4d72-9832-d8894784f957"

interface BasketItem {
  id: number
  group_id: number
  name: string
  sku: string
  required_qty: number
  status: string
  url_supplier: string | null
  updated_at: string
}

export default function PurchaseBasket() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<BasketItem[]>([])
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    const res = await fetch(`${BASKET_URL}?action=basket`)
    const data = await res.json()
    const filtered = (data.items || []).filter((i: BasketItem) => i.required_qty > 0)
    filtered.sort((a: BasketItem, b: BasketItem) => {
      if (a.status === "NEW" && b.status !== "NEW") return -1
      if (a.status !== "NEW" && b.status === "NEW") return 1
      return a.name.localeCompare(b.name, "ru")
    })
    setItems(filtered)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const updateStatus = async (groupId: number, status: string) => {
    setItems(prev => prev.map(i => i.group_id === groupId ? { ...i, status } : i))
    await fetch(`${BASKET_URL}?action=basket_status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ group_id: groupId, status }),
    })
  }

  const newCount = items.filter(i => i.status === "NEW").length

  return (
    <div>
      {/* Кнопка-триггер */}
      <button
        onClick={() => { setOpen(v => !v); if (!open) load() }}
        className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
          newCount > 0
            ? "border-orange-400/40 bg-orange-400/5 text-orange-400 hover:bg-orange-400/10"
            : open
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-foreground/60 hover:border-primary hover:text-foreground"
        }`}
        style={{ cursor: "pointer" }}
      >
        <Icon name="ShoppingCart" size={15} />
        Корзина закупки
        {newCount > 0 && (
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-orange-400 text-[10px] font-bold text-white">
            {newCount}
          </span>
        )}
      </button>

      {/* Панель */}
      {open && (
        <div className="mt-3 rounded-xl border border-orange-400/20 bg-orange-400/5 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Icon name="ShoppingCart" size={16} className="text-orange-400" />
              <span className="font-medium text-foreground">Корзина закупки</span>
              <span className="rounded-full bg-orange-400/15 px-2 py-0.5 text-xs text-orange-400">
                {items.length} позиций
              </span>
            </div>
            <button onClick={load} className="text-foreground/40 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
              <Icon name={loading ? "Loader" : "RefreshCw"} size={14} className={loading ? "animate-spin" : ""} />
            </button>
          </div>

          {loading ? (
            <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-10 rounded-lg bg-card animate-pulse" />)}</div>
          ) : items.length === 0 ? (
            <div className="py-6 text-center">
              <Icon name="CheckCircle" size={28} className="mx-auto mb-2 text-green-400/40" />
              <p className="text-sm text-foreground/40">Всё в наличии — закупать нечего</p>
            </div>
          ) : (
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {items.map(item => (
                <div key={item.group_id} className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-foreground truncate">{item.name}</span>
                      <span className="font-mono text-[10px] text-foreground/40">{item.sku}</span>
                      <span className="rounded-full bg-red-400/10 px-2 py-0.5 text-xs font-medium text-red-400">
                        нужно {item.required_qty} шт.
                      </span>
                    </div>
                  </div>
                  {item.url_supplier && (
                    <a href={item.url_supplier} target="_blank" rel="noreferrer"
                      className="shrink-0 text-foreground/30 hover:text-primary transition-colors"
                      title="Купить у поставщика">
                      <Icon name="ExternalLink" size={13} />
                    </a>
                  )}
                  {item.status === "RECEIVED" ? (
                    <span className="shrink-0 rounded-lg border border-green-400/40 bg-green-400/5 px-2 py-1 text-xs font-medium text-green-400">
                      Получено
                    </span>
                  ) : (
                    <select
                      value={item.status}
                      onChange={e => updateStatus(item.group_id, e.target.value)}
                      className={`shrink-0 rounded-lg border px-2 py-1 text-xs font-medium focus:outline-none transition-colors ${
                        item.status === "NEW"     ? "border-red-400/40 bg-red-400/5 text-red-400" :
                        item.status === "ORDERED" ? "border-yellow-400/40 bg-yellow-400/5 text-yellow-400" :
                        "border-border text-foreground/50"
                      }`}
                      style={{ cursor: "pointer" }}>
                      <option value="NEW">Заказать</option>
                      <option value="ORDERED">Заказано</option>
                    </select>
                  )}
                </div>
              ))}
            </div>
          )}
          {items.length > 0 && (
            <p className="mt-2 text-xs text-foreground/30 text-center">
              Статусы сохраняются в БД и видны всем менеджерам
            </p>
          )}
        </div>
      )}
    </div>
  )
}