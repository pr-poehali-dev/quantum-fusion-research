import { useState, useEffect, useRef } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { Store } from "./types"
import { checkSerialSound, useArchivedSerialCheck } from "./serialCheck"

// ─── Модалка магазинов ───────────────────────────────────────────────────────

export function StoresModal({ stores, onClose, onSaved }: {
  stores: Store[]
  onClose: () => void
  onSaved: () => void
}) {
  const [newName, setNewName] = useState("")
  const [newCode, setNewCode] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const add = async () => {
    if (!newName.trim() || newCode.length !== 3) { setError("Название и ровно 3 цифры кода"); return }
    setLoading(true)
    const data = await api.warehouse.createStore({ name: newName.trim(), code: newCode })
    setLoading(false)
    if (data.error) { setError(data.error); return }
    setNewName(""); setNewCode(""); setError("")
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Магазины</h2>
          <button onClick={onClose}><Icon name="X" size={18} className="text-foreground/40" /></button>
        </div>

        <div className="mb-4 space-y-1 max-h-48 overflow-y-auto">
          {stores.length === 0 && <p className="text-sm text-foreground/40">Нет магазинов</p>}
          {[...stores].sort((a, b) => (parseInt(a.code, 10) || 0) - (parseInt(b.code, 10) || 0)).map(s => (
            <div key={s.id} className="flex items-center gap-3 rounded-lg bg-background px-3 py-2">
              <span className="font-mono text-xs text-foreground/50">[{s.code}]</span>
              <span className="text-sm">{s.name}</span>
            </div>
          ))}
        </div>

        <div className="border-t border-border pt-4">
          <p className="mb-2 text-xs text-foreground/50">Добавить магазин</p>
          <div className="flex gap-2">
            <Input className="w-20 font-mono" maxLength={3} value={newCode} onChange={e => setNewCode(e.target.value.replace(/\D/g, ""))} placeholder="001" />
            <Input className="flex-1" value={newName} onChange={e => setNewName(e.target.value)} placeholder="DNS" />
            <Button onClick={add} disabled={loading}>+</Button>
          </div>
          {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
        </div>
      </div>
    </div>
  )
}

// ─── Внесение серийников к уже принятой поставке ──────────────────────────────

export function SupplySerialsModal({ supplyId, onClose, onSaved }: {
  supplyId: number
  onClose: () => void
  onSaved: () => void
}) {
  const [info, setInfo] = useState<{
    qty: number; remaining: number; product_name: string; category: string;
    store_code: string | null; store_name: string | null; purchase_date: string | null;
    existing: { id: number; serial: string }[];
  } | null>(null)
  const [serials, setSerials] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const inputs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    api.snArchive.supplySerials(supplyId).then(d => {
      if (d.error) { setError(d.error); return }
      setInfo(d)
      setSerials(Array.from({ length: Math.max(0, d.remaining) }, () => ""))
    })
  }, [supplyId])

  // Дубли в текущем вводе
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

  // Серийники, уже принятые ранее (по всему архиву). Свою поставку игнорируем.
  const archivedHits = useArchivedSerialCheck(serials, supplyId)

  const save = async () => {
    const clean = serials.map(s => s.trim()).filter(Boolean)
    if (!clean.length) { setError("Введите хотя бы один серийник"); return }
    if (dupIndexes.size) { setError("Есть повторяющиеся серийники"); return }
    if (Object.keys(archivedHits).length) { setError("Некоторые серийники уже приняты ранее"); return }
    setLoading(true)
    setError("")
    const data = await api.snArchive.addSerials({ supply_id: supplyId, serials: clean })
    setLoading(false)
    if (data.error) { setError(data.error); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Серийные номера</h2>
          <button onClick={onClose}><Icon name="X" size={18} className="text-foreground/40" /></button>
        </div>
        {!info && !error && <p className="py-6 text-center text-sm text-foreground/40">Загрузка...</p>}
        {info && (
          <>
            <div className="mb-4 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
              <p className="font-medium">{info.product_name}</p>
              <p className="mt-0.5 text-xs text-foreground/50">
                всего {info.qty} шт. · внесено {info.existing.length} · осталось {serials.length}
                {info.store_name && <> · магазин <span className="font-medium text-foreground/70">[{info.store_code}] {info.store_name}</span></>}
                {info.purchase_date && <> · принято {info.purchase_date.substring(0, 10).split("-").reverse().join(".")}</>}
              </p>
            </div>

            {info.existing.length > 0 && (
              <div className="mb-3">
                <p className="mb-1 text-xs text-foreground/40">Уже внесены:</p>
                <div className="flex flex-wrap gap-1.5">
                  {info.existing.map(e => (
                    <span key={e.id} className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-foreground/60">{e.serial}</span>
                  ))}
                </div>
              </div>
            )}

            {serials.length === 0 ? (
              <p className="py-4 text-center text-sm text-green-500">Все серийники внесены ✓</p>
            ) : (
              <div className="max-h-[45vh] space-y-2 overflow-y-auto pr-1">
                {serials.map((sn, i) => {
                  const isDup = dupIndexes.has(i)
                  const hit = archivedHits[i]
                  const bad = isDup || !!hit
                  return (
                    <div key={i}>
                      <div className="flex items-center gap-2">
                        <span className="w-6 shrink-0 text-right text-xs text-foreground/40">{info.existing.length + i + 1}.</span>
                        <Input
                          ref={(el) => { inputs.current[i] = el }}
                          autoFocus={i === 0}
                          value={sn}
                          placeholder="S/N"
                          className={bad ? "border-red-500 ring-1 ring-red-500" : ""}
                          onChange={e => setSerials(p => p.map((v, j) => j === i ? e.target.value : v))}
                          onKeyDown={e => {
                            if (e.key === "Enter") {
                              e.preventDefault()
                              checkSerialSound(sn, i, serials, supplyId)
                              if (i < serials.length - 1) inputs.current[i + 1]?.focus()
                              else save()
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
            )}
          </>
        )}
        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
        {info && serials.length > 0 && (
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={save} disabled={loading || dupIndexes.size > 0 || Object.keys(archivedHits).length > 0}>
              {loading ? "Сохранение..." : "Сохранить серийники"}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
