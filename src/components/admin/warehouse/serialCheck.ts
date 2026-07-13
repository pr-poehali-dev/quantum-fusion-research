import { useEffect, useState } from "react"
import { api } from "@/lib/api"
import { playScanOk, playScanError } from "@/lib/scanSound"
import type { RemoteHit } from "./types"

// ─── Звуковая проверка серийника при вводе (Enter) ────────────────────────────
// Мгновенно: пустой/дубль → ошибка. Иначе спрашиваем архив (lookup):
// уже принят (не в этой же поставке) → ошибка, новый → успех.
export async function checkSerialSound(
  value: string,
  index: number,
  allSerials: string[],
  ignoreSupplyId?: number | null,
): Promise<boolean> {
  const v = value.trim().toLowerCase()
  if (!v) { playScanError(); return false }
  // локальный дубль (то же значение в другой строке)
  const localDup = allSerials.some((s, j) => j !== index && s.trim().toLowerCase() === v)
  if (localDup) { playScanError(); return false }
  const d = await api.snArchive.lookup(value.trim()).catch(() => ({ found: false }))
  const isArchived = d.found && d.record &&
    (ignoreSupplyId == null || d.record.supply_id !== ignoreSupplyId)
  if (isArchived) { playScanError(); return false }
  playScanOk()
  return true
}

// ─── Проверка серийников по всему архиву (уже принятые) ───────────────────────
// Возвращает мапу: индекс строки -> запись из sn_archive (магазин/товар), если
// такой серийник уже есть в базе. Проверка идёт с задержкой (debounce).
export function useArchivedSerialCheck(serials: string[], ignoreSupplyId?: number | null) {
  const [hits, setHits] = useState<Record<number, RemoteHit>>({})

  useEffect(() => {
    const t = setTimeout(async () => {
      const result: Record<number, RemoteHit> = {}
      // Уникальные непустые значения → один запрос на значение
      const checked = new Map<string, RemoteHit | null>()
      await Promise.all(serials.map(async (s, i) => {
        const key = s.trim()
        if (!key) return
        if (!checked.has(key.toLowerCase())) {
          const d = await api.snArchive.lookup(key).catch(() => ({ found: false }))
          // Игнорируем совпадение с серийниками этой же поставки (дозаполнение)
          const rec = d.found && d.record &&
            (ignoreSupplyId == null || d.record.supply_id !== ignoreSupplyId)
            ? {
                serial: d.record.serial,
                store_code: d.record.store_code ?? null,
                store_name: d.record.store_name ?? null,
                product_name: d.record.product_name ?? null,
                purchase_date: d.record.purchase_date ?? null,
              } as RemoteHit
            : null
          checked.set(key.toLowerCase(), rec)
        }
        const hit = checked.get(key.toLowerCase())
        if (hit) result[i] = hit
      }))
      setHits(result)
    }, 500)
    return () => clearTimeout(t)
  }, [serials, ignoreSupplyId])

  return hits
}
