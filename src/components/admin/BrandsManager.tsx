import { useState, useEffect } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"

interface Brand { id: number; name: string; slug: string; logo_url?: string | null; sort_order: number; product_count?: number }

export default function BrandsManager({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const [brands, setBrands] = useState<Brand[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState("")
  const [editId, setEditId] = useState<number | null>(null)
  const [editName, setEditName] = useState("")

  const load = () => { setLoading(true); api.brands.getAll().then(d => { setBrands(d.brands || []); setLoading(false) }) }
  useEffect(load, [])

  const add = async () => {
    if (!newName.trim()) return
    await api.brands.create({ name: newName.trim() })
    setNewName(""); load(); onChanged?.()
  }
  const saveEdit = async () => {
    if (editId === null || !editName.trim()) return
    await api.brands.update({ id: editId, name: editName.trim() })
    setEditId(null); setEditName(""); load(); onChanged?.()
  }
  const remove = async (b: Brand) => {
    if (!confirm(`Удалить бренд «${b.name}»? Товары (${b.product_count || 0}) станут без бренда.`)) return
    await api.brands.delete(b.id); load(); onChanged?.()
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-background" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="text-base font-bold text-foreground">Бренды</h3>
          <button onClick={onClose} className="text-foreground/40 hover:text-foreground" style={{ cursor: "pointer" }}><Icon name="X" size={20} /></button>
        </div>

        <div className="flex gap-2 border-b border-border p-4">
          <input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === "Enter" && add()}
            placeholder="Новый бренд (напр. ASUS)"
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" style={{ cursor: "text" }} />
          <button onClick={add} className="shrink-0 rounded-lg bg-primary px-3 text-primary-foreground hover:opacity-90" style={{ cursor: "pointer" }}><Icon name="Plus" size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? <p className="py-8 text-center text-sm text-foreground/40">Загрузка...</p>
            : brands.length === 0 ? <p className="py-8 text-center text-sm text-foreground/40">Брендов пока нет</p>
            : (
              <div className="space-y-1.5">
                {brands.map(b => (
                  <div key={b.id} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
                    {editId === b.id ? (
                      <input autoFocus value={editName} onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") saveEdit() }} onBlur={saveEdit}
                        className="flex-1 bg-transparent text-sm outline-none" style={{ cursor: "text" }} />
                    ) : (
                      <span className="flex-1 text-sm text-foreground cursor-text" onClick={() => { setEditId(b.id); setEditName(b.name) }}>{b.name}</span>
                    )}
                    <span className="text-xs text-foreground/40">{b.product_count || 0} тов.</span>
                    <button onClick={() => { setEditId(b.id); setEditName(b.name) }} className="text-foreground/30 hover:text-primary" style={{ cursor: "pointer" }}><Icon name="Pencil" size={13} /></button>
                    <button onClick={() => remove(b)} className="text-foreground/30 hover:text-red-400" style={{ cursor: "pointer" }}><Icon name="Trash2" size={13} /></button>
                  </div>
                ))}
              </div>
            )}
        </div>
      </div>
    </div>
  )
}
