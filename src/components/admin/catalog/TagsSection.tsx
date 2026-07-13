import React, { useState } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { Tag, TAG_COLORS, TAG_COLOR_CLASSES, TagBadge } from "@/pages/admin/types"

export function TagsSection({ tags, setTags, loading }: {
  tags: Tag[]
  setTags: React.Dispatch<React.SetStateAction<Tag[]>>
  loading: boolean
}) {
  const [tagForm, setTagForm] = useState<{ id: number | null; name: string; color: string; sort_order: string }>({ id: null, name: "", color: "primary", sort_order: "0" })
  const [tagFormOpen, setTagFormOpen] = useState(false)

  const submitTag = async (e: React.FormEvent) => {
    e.preventDefault()
    const payload = { id: tagForm.id, name: tagForm.name, color: tagForm.color, sort_order: Number(tagForm.sort_order) }
    if (tagForm.id) await api.tags.update(payload)
    else await api.tags.create(payload)
    const d = await api.tags.getAll()
    setTags(d.tags || [])
    setTagForm({ id: null, name: "", color: "primary", sort_order: "0" })
    setTagFormOpen(false)
  }

  const deleteTag = async (id: number) => {
    if (!confirm("Удалить тег? Он будет снят со всех сборок.")) return
    await api.tags.delete(id)
    setTags(ts => ts.filter(t => t.id !== id))
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-xl font-light text-foreground">Теги сборок</h2>
        <button onClick={() => { setTagForm({ id: null, name: "", color: "primary", sort_order: "0" }); setTagFormOpen(true) }}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>
          <Icon name="Plus" size={15} />Новый тег
        </button>
      </div>
      {tagFormOpen && (
        <form onSubmit={submitTag} className="mb-6 rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
          <p className="text-sm font-medium text-foreground">{tagForm.id ? "Редактировать тег" : "Новый тег"}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs text-foreground/60">Название *</label>
              <input required value={tagForm.name} onChange={e => setTagForm(f => ({ ...f, name: e.target.value }))}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" placeholder="Игровой" style={{ cursor: "text" }} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-foreground/60">Цвет</label>
              <select value={tagForm.color} onChange={e => setTagForm(f => ({ ...f, color: e.target.value }))}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "pointer" }}>
                {TAG_COLORS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-foreground/60">Порядок</label>
              <input type="number" value={tagForm.sort_order} onChange={e => setTagForm(f => ({ ...f, sort_order: e.target.value }))}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "text" }} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <p className="text-xs text-foreground/40">Превью:</p>
            <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${TAG_COLOR_CLASSES[tagForm.color] || TAG_COLOR_CLASSES.primary}`}>
              {tagForm.name || "Тег"}
            </span>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>
              {tagForm.id ? "Сохранить" : "Создать"}
            </button>
            <button type="button" onClick={() => setTagFormOpen(false)} className="rounded-lg border border-border px-4 py-2 text-sm text-foreground/60 hover:border-primary transition-colors" style={{ cursor: "pointer" }}>
              Отмена
            </button>
          </div>
        </form>
      )}
      {loading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-14 rounded-xl bg-card animate-pulse" />)}</div>
      ) : tags.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-12 text-center">
          <Icon name="Tag" size={32} className="mx-auto mb-3 text-foreground/20" />
          <p className="text-sm text-foreground/40">Тегов пока нет. Создайте первый!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tags.map(t => (
            <div key={t.id} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
              <TagBadge tag={t} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{t.name}</p>
                <p className="text-xs text-foreground/40">порядок: {t.sort_order}</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => { setTagForm({ id: t.id, name: t.name, color: t.color, sort_order: String(t.sort_order) }); setTagFormOpen(true) }}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs hover:border-primary transition-colors" style={{ cursor: "pointer" }}><Icon name="Pencil" size={12} /></button>
                <button onClick={() => deleteTag(t.id)} className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/40 hover:border-red-400 hover:text-red-400 transition-colors" style={{ cursor: "pointer" }}><Icon name="Trash2" size={12} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
