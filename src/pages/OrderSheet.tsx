import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"

interface Component {
  slot: string
  name: string
  price: number
  current_price?: number
  source_id?: number
  qty?: number
  quantity?: number
  image_url?: string
  image_urls?: string[]
}

interface Build {
  id: number
  name: string
  description: string
  components: Component[]
  parts_total: number
  assembly_type: string
  assembly_fee: number
  total_price: number
  status: string
}

const SLOT_NAMES: Record<string, string> = {
  cpu: "Процессор", gpu: "Видеокарта", ram: "ОЗУ",
  storage: "Накопитель", psu: "Блок питания", case: "Корпус",
  motherboard: "Материнская плата", cooling: "Охлаждение", other: "Прочее",
}

const fmt = (n: number) => n.toLocaleString("ru-RU") + " ₽"

export default function OrderSheet() {
  const { id } = useParams<{ id: string }>()
  const [build, setBuild] = useState<Build | null>(null)
  const [checked, setChecked] = useState<Record<number, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const isParts = build?.name?.startsWith("Заказ комплектующих")

  useEffect(() => {
    if (!id) return
    api.builds.getById(Number(id))
      .then(data => {
        if (data.error || !data.id) { setError("Заказ не найден"); setLoading(false); return }
        setBuild(data)
        setLoading(false)
      })
      .catch(() => { setError("Не удалось загрузить"); setLoading(false) })
  }, [id])

  const toggle = (i: number) => setChecked(c => ({ ...c, [i]: !c[i] }))
  const checkedCount = Object.values(checked).filter(Boolean).length
  const total = build?.components?.length ?? 0

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  )

  if (error || !build) return (
    <div className="flex min-h-screen items-center justify-center bg-background text-foreground/50">{error || "Не найдено"}</div>
  )

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ cursor: "auto" }}>
      {/* Header */}
      <div className="border-b border-border bg-card px-6 py-4">
        <div className="mx-auto max-w-2xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-xs">B</div>
                <span className="text-xs text-foreground/40 font-mono">BeGraphics</span>
                <span className="text-xs text-foreground/20">·</span>
                <span className="text-xs text-foreground/40">{isParts ? "Лист комплектующих" : "Лист сборки"}</span>
              </div>
              <h1 className="text-lg font-semibold text-foreground">{build.name}</h1>
              {build.description && <p className="text-xs text-foreground/50 mt-0.5">{build.description}</p>}
            </div>
            {/* Прогресс */}
            <div className="text-right shrink-0">
              <p className="text-2xl font-bold text-foreground tabular-nums">{checkedCount}<span className="text-foreground/30">/{total}</span></p>
              <p className="text-xs text-foreground/40">в наличии</p>
            </div>
          </div>
          {/* Прогресс-бар */}
          <div className="mt-3 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: total ? `${(checkedCount / total) * 100}%` : "0%" }}
            />
          </div>
        </div>
      </div>

      {/* Components */}
      <div className="mx-auto max-w-2xl px-6 py-4 space-y-2">
        {build.components.map((comp, i) => {
          const isChecked = !!checked[i]
          const qty = comp.qty ?? comp.quantity ?? 1
          const price = comp.current_price ?? comp.price
          const img = comp.image_url ?? (comp.image_urls?.[0])
          const slotLabel = SLOT_NAMES[comp.slot] ?? comp.slot

          return (
            <button
              key={i}
              onClick={() => toggle(i)}
              className={`w-full rounded-xl border p-4 text-left transition-all duration-150 ${
                isChecked
                  ? "border-primary/40 bg-primary/5"
                  : "border-border bg-card hover:border-border/80"
              }`}
              style={{ cursor: "pointer" }}
            >
              <div className="flex items-center gap-3">
                {/* Чекбокс */}
                <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 transition-colors ${
                  isChecked ? "border-primary bg-primary" : "border-border"
                }`}>
                  {isChecked && <Icon name="Check" size={14} className="text-primary-foreground" />}
                </div>

                {/* Фото */}
                {img ? (
                  <img src={img} alt={comp.name} className="h-12 w-12 shrink-0 rounded-lg object-contain bg-muted" />
                ) : (
                  <div className="h-12 w-12 shrink-0 rounded-lg bg-muted flex items-center justify-center">
                    <Icon name="Package" size={20} className="text-foreground/20" />
                  </div>
                )}

                {/* Инфо */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-medium text-foreground/40 uppercase tracking-wide">{slotLabel}</span>
                    {qty > 1 && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-bold text-primary">×{qty}</span>}
                  </div>
                  <p className={`text-sm font-medium leading-snug transition-colors ${isChecked ? "text-foreground/50 line-through" : "text-foreground"}`}>
                    {comp.name}
                  </p>
                </div>

                {/* Цена */}
                <div className="text-right shrink-0">
                  <p className={`text-sm font-bold transition-colors ${isChecked ? "text-foreground/30" : "text-foreground"}`}>
                    {fmt(price * qty)}
                  </p>
                  {qty > 1 && <p className="text-xs text-foreground/30">{fmt(price)} × {qty}</p>}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {/* Footer итого */}
      <div className="sticky bottom-0 border-t border-border bg-card/95 backdrop-blur px-6 py-4">
        <div className="mx-auto max-w-2xl space-y-1">
          <div className="flex justify-between text-sm text-foreground/60">
            <span>Комплектующие</span>
            <span>{fmt(build.parts_total)}</span>
          </div>
          {build.assembly_fee > 0 && (
            <div className="flex justify-between text-sm text-foreground/60">
              <span>Сборка {build.assembly_type === "percent" ? "(7%)" : ""}</span>
              <span>{fmt(build.assembly_fee)}</span>
            </div>
          )}
          <div className="flex justify-between text-base font-bold text-foreground pt-1 border-t border-border">
            <span>Итого</span>
            <span>{fmt(build.total_price)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
