import { useCallback, useEffect, useState } from "react"
import Icon from "@/components/ui/icon"
import { api } from "@/lib/api"

interface FeedbackItem {
  id: number
  stand_name: string
  order_number: string
  profile_name: string
  app_version: string
  hwinfo_active: boolean
  slots_ok: number
  slots_missing: number
  slots_na: number
  missing_labels: string[]
  note: string
  file_name: string
  file_url: string
  file_size: number
  is_resolved: boolean
  exported_at: string
  created_at: string
}

const fmtSize = (b: number) => {
  if (!b) return "—"
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} КБ`
  return `${(b / 1024 / 1024).toFixed(1)} МБ`
}

const fmtDate = (s: string) => {
  if (!s) return "—"
  const d = new Date(s.replace(" ", "T"))
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })
}

export default function StressSensorFeedbackTab({ adminKey }: { adminKey: string }) {
  const [items, setItems] = useState<FeedbackItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showResolved, setShowResolved] = useState(false)
  const [openId, setOpenId] = useState<number | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    api.stress.sensorFeedbackList(adminKey)
      .then(r => setItems(Array.isArray(r?.items) ? r.items : []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [adminKey])

  useEffect(() => { load() }, [load])

  const toggleResolved = async (it: FeedbackItem) => {
    setItems(prev => prev.map(x => x.id === it.id ? { ...x, is_resolved: !x.is_resolved } : x))
    await api.stress.sensorFeedbackResolve(it.id, !it.is_resolved, adminKey)
  }

  const remove = async (it: FeedbackItem) => {
    if (!confirm(`Удалить отчёт от «${it.stand_name || "стенда"}»?`)) return
    setItems(prev => prev.filter(x => x.id !== it.id))
    await api.stress.sensorFeedbackDelete(it.id, adminKey)
  }

  const visible = showResolved ? items : items.filter(i => !i.is_resolved)
  const pending = items.filter(i => !i.is_resolved).length

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <p className="text-sm text-foreground/60">
            Стенд присылает архив, когда не нашёл часть обязательных датчиков.
            Внутри — дамп HWiNFO и карта слотов для настройки правил.
          </p>
        </div>
        <button onClick={() => setShowResolved(v => !v)} style={{ cursor: "pointer" }}
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/70 hover:border-primary hover:text-foreground transition-colors">
          <Icon name={showResolved ? "EyeOff" : "Eye"} size={14} />
          {showResolved ? "Скрыть разобранные" : "Показать разобранные"}
        </button>
        <button onClick={load} style={{ cursor: "pointer" }}
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/70 hover:border-primary hover:text-foreground transition-colors">
          <Icon name="RefreshCw" size={14} /> Обновить
        </button>
      </div>

      {!loading && items.length > 0 && (
        <p className="mb-3 text-xs text-foreground/40">
          Всего {items.length} · не разобрано {pending}
        </p>
      )}

      {loading ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-foreground/40">
          Загрузка…
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <Icon name="Radio" size={28} className="mx-auto mb-3 text-foreground/25" />
          <p className="text-sm text-foreground/60">Обращений нет</p>
          <p className="mt-1 text-xs text-foreground/40">
            Здесь появятся архивы со стендов, где не хватило датчиков
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map(it => {
            const open = openId === it.id
            return (
              <div key={it.id} className={`rounded-xl border bg-card transition-colors ${it.is_resolved ? "border-border opacity-60" : "border-border"}`}>
                <div className="flex flex-wrap items-center gap-3 p-4">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${it.is_resolved ? "bg-muted text-foreground/40" : "bg-amber-500/10 text-amber-500"}`}>
                    <Icon name={it.is_resolved ? "Check" : "Radio"} size={17} />
                  </div>
                  <div className="min-w-[180px] flex-1">
                    <p className="text-sm font-medium text-foreground">
                      {it.stand_name || "Без названия"}
                      {it.order_number && <span className="ml-2 text-xs text-foreground/50">заказ {it.order_number}</span>}
                    </p>
                    <p className="mt-0.5 text-xs text-foreground/40">
                      {fmtDate(it.created_at)}
                      {it.profile_name && ` · ${it.profile_name}`}
                      {it.app_version && ` · v${it.app_version}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="rounded-md bg-emerald-500/10 px-2 py-1 text-emerald-500">{it.slots_ok} ок</span>
                    <span className="rounded-md bg-red-500/10 px-2 py-1 text-red-500">{it.slots_missing} без данных</span>
                    {!it.hwinfo_active && (
                      <span className="rounded-md bg-amber-500/10 px-2 py-1 text-amber-500">HWiNFO выкл.</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setOpenId(open ? null : it.id)} title="Подробности" style={{ cursor: "pointer" }}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground/50 hover:bg-muted hover:text-foreground transition-colors">
                      <Icon name={open ? "ChevronUp" : "ChevronDown"} size={16} />
                    </button>
                    {it.file_url && (
                      <a href={it.file_url} target="_blank" rel="noopener noreferrer" title="Скачать архив" style={{ cursor: "pointer" }}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground/50 hover:bg-muted hover:text-foreground transition-colors">
                        <Icon name="Download" size={16} />
                      </a>
                    )}
                    <button onClick={() => toggleResolved(it)} title={it.is_resolved ? "Вернуть в работу" : "Отметить разобранным"} style={{ cursor: "pointer" }}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground/50 hover:bg-muted hover:text-foreground transition-colors">
                      <Icon name={it.is_resolved ? "RotateCcw" : "CheckCheck"} size={16} />
                    </button>
                    <button onClick={() => remove(it)} title="Удалить" style={{ cursor: "pointer" }}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground/50 hover:bg-red-500/10 hover:text-red-500 transition-colors">
                      <Icon name="Trash2" size={16} />
                    </button>
                  </div>
                </div>

                {open && (
                  <div className="border-t border-border px-4 py-3 text-xs">
                    {it.missing_labels.length > 0 && (
                      <>
                        <p className="mb-1.5 text-foreground/50">Не нашлись датчики:</p>
                        <div className="mb-3 flex flex-wrap gap-1.5">
                          {it.missing_labels.map((l, i) => (
                            <span key={i} className="rounded-md bg-muted px-2 py-1 text-foreground/70">{l}</span>
                          ))}
                        </div>
                      </>
                    )}
                    <div className="grid gap-1 text-foreground/50 sm:grid-cols-2">
                      <p>Слоты без DIMM / неприменимые: {it.slots_na}</p>
                      <p>HWiNFO Shared Memory: {it.hwinfo_active ? "активна" : "не активна"}</p>
                      {it.exported_at && <p>Создан на стенде: {fmtDate(it.exported_at)}</p>}
                      {it.file_name && <p>Архив: {it.file_name} · {fmtSize(it.file_size)}</p>}
                    </div>
                    {it.note && <p className="mt-2 text-foreground/60">Примечание: {it.note}</p>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
