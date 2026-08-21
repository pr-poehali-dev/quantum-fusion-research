import Icon from "@/components/ui/icon"
import { Input } from "@/components/ui/input"
import { MatchRow, Store, levelColor } from "./types"

// ШАГ 3: сверка распознанных позиций перед приёмкой
export default function ReceiptReviewStage({
  stores, storeId, setStoreId, storeAuto, setStoreAuto, storeHint,
  vatMode, setVatMode, purchaseDiscount,
  greenCount, yellowCount, redCount, qtyWarnCount,
  rows, updateRow, applyManual, createNew,
  searchIdx, setSearchIdx, searchQ, setSearchQ, searchRes,
}: {
  stores: Store[]
  storeId: number | null
  setStoreId: (v: number) => void
  storeAuto: boolean
  setStoreAuto: (v: boolean) => void
  storeHint: string | null
  vatMode: "with" | "without"
  setVatMode: (v: "with" | "without") => void
  purchaseDiscount: number
  greenCount: number
  yellowCount: number
  redCount: number
  qtyWarnCount: number
  rows: MatchRow[]
  updateRow: (i: number, patch: Partial<MatchRow>) => void
  applyManual: (i: number, gid: number, name: string) => void
  createNew: (i: number) => void
  searchIdx: number | null
  setSearchIdx: (v: number | null) => void
  searchQ: string
  setSearchQ: (v: string) => void
  searchRes: { id: number; name: string }[]
}) {
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        {/* Магазин — с акцентом, если подставлен автоматически */}
        <div className={storeAuto ? "rounded-lg border-2 border-amber-400/60 bg-amber-400/10 p-2" : ""}>
          <label className="mb-1 flex items-center gap-1 text-xs text-foreground/50">
            Магазин / площадка
            {storeAuto && <span className="flex items-center gap-0.5 font-medium text-amber-600"><Icon name="Sparkles" size={11} /> проверьте!</span>}
          </label>
          <select value={storeId ?? ""} onChange={e => { setStoreId(Number(e.target.value)); setStoreAuto(false) }}
            className={`rounded-lg border bg-background px-3 py-2 text-sm ${storeAuto ? "border-amber-400/60" : "border-border"}`} style={{ cursor: "pointer" }}>
            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {storeHint && (
            <p className="mt-1 text-[11px] text-foreground/45">в чеке: «{storeHint}»</p>
          )}
        </div>

        {/* Переключатель НДС */}
        <div>
          <label className="mb-1 block text-xs text-foreground/50">Товар</label>
          <div className="inline-flex overflow-hidden rounded-lg border border-border">
            <button onClick={() => setVatMode("with")} style={{ cursor: "pointer" }}
              className={`px-3 py-2 text-sm ${vatMode === "with" ? "bg-primary text-primary-foreground" : "bg-background text-foreground/60 hover:bg-muted"}`}>
              С НДС
            </button>
            <button onClick={() => setVatMode("without")} style={{ cursor: "pointer" }}
              className={`px-3 py-2 text-sm ${vatMode === "without" ? "bg-primary text-primary-foreground" : "bg-background text-foreground/60 hover:bg-muted"}`}>
              Без НДС
            </button>
          </div>
          {vatMode === "with" ? (
            <p className="mt-1 text-[11px] text-foreground/45">
              цена из счёта сохранится, заход = цена − {purchaseDiscount}% (скидка НДС)
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-foreground/45">заход = цена из счёта как есть</p>
          )}
        </div>

        <div className="flex flex-wrap gap-2 self-end text-xs">
          <span className="rounded-full bg-green-500/15 px-2.5 py-1 text-green-500">🟢 {greenCount} совпало</span>
          <span className="rounded-full bg-yellow-500/15 px-2.5 py-1 text-yellow-600">🟡 {yellowCount} выбрать</span>
          <span className="rounded-full bg-red-500/15 px-2.5 py-1 text-red-400">🔴 {redCount} новых</span>
          {qtyWarnCount > 0 && (
            <span className="rounded-full bg-orange-500/15 px-2.5 py-1 text-orange-500">⚠ {qtyWarnCount} проверить кол-во</span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {rows.map((row, i) => {
          const lc = levelColor(row)
          return (
            <div key={i} className={`rounded-xl border p-3 ${lc.cls}`}>
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-foreground/40">{lc.label} · из чека:</p>
                  <p className="truncate text-sm font-medium">{row.raw_name}</p>
                  {row.group_id ? (
                    <p className="mt-0.5 flex items-center gap-1 text-sm text-foreground/70">
                      <Icon name="ArrowRight" size={12} className="text-foreground/30" />
                      {row.matched_name}
                      <span className="text-xs text-foreground/40">({Math.round(row.confidence)}%)</span>
                    </p>
                  ) : (row.level === "fuzzy_mid" || (row.candidates && row.candidates.length > 0)) ? (
                    <p className="mt-0.5 text-sm text-yellow-600">
                      есть похожие — выберите нужный ниже ({Math.round(row.confidence)}%)
                    </p>
                  ) : (
                    <p className="mt-0.5 text-sm text-red-400/80">нет товара на складе</p>
                  )}
                  {row.qty_warn && (
                    <p className="mt-1 text-[11px] text-orange-500">
                      ⚠ в названии «{row.pack_size} шт/кор» — проверьте реальное количество к приёмке
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div>
                    <label className={`block text-[10px] ${row.qty_warn ? "text-orange-500 font-medium" : "text-foreground/40"}`}>
                      кол-во {row.qty_warn && "⚠"}
                    </label>
                    <Input type="number" min={1} value={row.qty}
                      className={`h-8 w-16 text-sm ${row.qty_warn ? "border-orange-500 ring-1 ring-orange-500/40" : ""}`}
                      title={row.qty_warn ? `Проверьте! В названии указана упаковка ${row.pack_size} шт — возможно, это не реальное количество` : undefined}
                      onChange={e => updateRow(i, { qty: Math.max(1, parseInt(e.target.value) || 1), qty_warn: false })} />
                  </div>
                  <div>
                    <label className="block text-[10px] text-foreground/40">цена ₽</label>
                    <Input type="number" min={0} value={row.price} className="h-8 w-24 text-sm"
                      onChange={e => updateRow(i, { price: Math.max(0, parseFloat(e.target.value) || 0) })} />
                  </div>
                  <button onClick={() => updateRow(i, { skip: !row.skip })} title={row.skip ? "Вернуть" : "Пропустить"}
                    style={{ cursor: "pointer" }}
                    className={`mt-3 rounded-lg border px-2 py-1.5 ${row.skip ? "border-primary text-primary" : "border-border text-foreground/40 hover:text-foreground"}`}>
                    <Icon name={row.skip ? "Undo2" : "EyeOff"} size={14} />
                  </button>
                </div>
              </div>

              {/* действия для спорных/новых */}
              {!row.skip && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {/* кандидаты-подсказки */}
                  {row.candidates?.slice(0, 3).map(c => c.group_id !== row.group_id && (
                    <button key={c.group_id} onClick={() => applyManual(i, c.group_id, c.name)} style={{ cursor: "pointer" }}
                      className="rounded-full border border-border px-2.5 py-1 text-xs text-foreground/60 hover:border-primary hover:text-primary transition-colors">
                      {c.name} <span className="text-foreground/30">{Math.round(c.score)}%</span>
                    </button>
                  ))}
                  <button onClick={() => { setSearchIdx(searchIdx === i ? null : i); setSearchQ(row.raw_name) }}
                    style={{ cursor: "pointer" }}
                    className="rounded-full border border-border px-2.5 py-1 text-xs text-foreground/60 hover:border-primary hover:text-primary transition-colors">
                    <Icon name="Search" size={11} className="mr-1 inline" />Выбрать из существующих
                  </button>
                  {/* Создать новую группу товаров — доступно в любой строке */}
                  <button onClick={() => createNew(i)} style={{ cursor: "pointer" }}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${row.group_id
                      ? "border-border text-foreground/60 hover:border-primary hover:text-primary"
                      : "border-red-400/40 bg-red-500/10 text-red-400 hover:bg-red-500/20"}`}>
                    <Icon name="Plus" size={11} className="mr-1 inline" />Создать новую группу
                  </button>
                </div>
              )}

              {/* инлайн-поиск */}
              {searchIdx === i && (
                <div className="mt-2 rounded-lg border border-primary/20 bg-background p-2">
                  <Input autoFocus value={searchQ} onChange={e => setSearchQ(e.target.value)}
                    placeholder="Поиск товара на складе..." className="h-8 text-sm" />
                  {searchRes.length > 0 && (
                    <div className="mt-1 max-h-40 overflow-auto">
                      {searchRes.map(p => (
                        <button key={p.id} onClick={() => applyManual(i, p.id, p.name)}
                          style={{ cursor: "pointer" }}
                          className="block w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-muted">
                          {p.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
