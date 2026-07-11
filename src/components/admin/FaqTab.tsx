import { useState, useEffect, useCallback, lazy, Suspense } from "react"
import Icon from "@/components/ui/icon"
import { api } from "@/lib/api"

const RichTextEditor = lazy(() => import("@/components/ui/rich-text-editor"))

const INPUT_CLS = "w-full rounded border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"

type Category = { id: number; name: string; icon: string; sort_order: number }
type Item = {
  id: number; category_id: number | null; question: string; answer: string
  sort_order: number; is_published: boolean; category_name: string | null
}

type ItemDraft = {
  id?: number; category_id: number | null; question: string; answer: string
  sort_order: number; is_published: boolean
}

const ICON_OPTIONS = ["HelpCircle", "CreditCard", "Truck", "ShieldCheck", "Cpu", "Wrench", "Package", "Percent", "Clock", "MessageCircle"]

export default function FaqTab() {
  const [categories, setCategories] = useState<Category[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [editItem, setEditItem] = useState<ItemDraft | null>(null)
  const [editCat, setEditCat] = useState<Partial<Category> | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [c, i] = await Promise.all([api.faq.getCategories(), api.faq.getItems()])
    setCategories(c?.categories || [])
    setItems(i?.items || [])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const saveItem = async () => {
    if (!editItem?.question.trim()) { alert("Введите вопрос"); return }
    setSaving(true)
    await api.faq.saveItem({
      id: editItem.id, category_id: editItem.category_id, question: editItem.question.trim(),
      answer: editItem.answer, sort_order: editItem.sort_order, is_published: editItem.is_published,
    })
    setSaving(false)
    setEditItem(null)
    await load()
  }

  const deleteItem = async (id: number) => {
    if (!confirm("Удалить вопрос?")) return
    await api.faq.deleteItem(id)
    await load()
  }

  const saveCat = async () => {
    if (!editCat?.name?.trim()) { alert("Введите название"); return }
    await api.faq.saveCategory({ id: editCat.id, name: editCat.name.trim(), icon: editCat.icon || "HelpCircle", sort_order: editCat.sort_order || 0 })
    setEditCat(null)
    await load()
  }

  const archiveCat = async (id: number) => {
    if (!confirm("Скрыть категорию? Вопросы останутся, но не будут показаны в этой группе.")) return
    await api.faq.archiveCategory(id)
    await load()
  }

  if (loading) return <div style={{ padding: "32px 50px" }} className="text-foreground/40">Загрузка…</div>

  // Группируем вопросы по категориям для наглядности
  const itemsByCat = new Map<number | null, Item[]>()
  for (const it of items) {
    const key = it.category_id
    if (!itemsByCat.has(key)) itemsByCat.set(key, [])
    itemsByCat.get(key)!.push(it)
  }

  return (
    <div style={{ padding: "24px 40px 48px" }}>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Icon name="MessagesSquare" size={24} /> Вопросы и ответы
        </h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setEditCat({ icon: "HelpCircle" })}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:border-primary" style={{ cursor: "pointer" }}>
            <Icon name="Plus" size={14} /> Категория
          </button>
          <button onClick={() => setEditItem({ category_id: categories[0]?.id ?? null, question: "", answer: "", sort_order: 0, is_published: true })}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground" style={{ cursor: "pointer" }}>
            <Icon name="Plus" size={14} /> Вопрос
          </button>
        </div>
      </div>

      {/* Категории */}
      <div className="mb-6 flex flex-wrap gap-2">
        {categories.map(c => (
          <div key={c.id} className="group flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm">
            <Icon name={c.icon} fallback="HelpCircle" size={14} className="text-foreground/50" />
            {c.name}
            <span className="text-foreground/30">({(itemsByCat.get(c.id) || []).length})</span>
            <button onClick={() => setEditCat(c)} className="text-foreground/30 hover:text-foreground" style={{ cursor: "pointer" }}>
              <Icon name="Pencil" size={12} />
            </button>
            <button onClick={() => archiveCat(c.id)} className="text-foreground/30 hover:text-red-400" style={{ cursor: "pointer" }}>
              <Icon name="EyeOff" size={12} />
            </button>
          </div>
        ))}
      </div>

      {/* Вопросы по категориям */}
      <div className="space-y-6">
        {categories.map(cat => {
          const catItems = itemsByCat.get(cat.id) || []
          if (!catItems.length) return null
          return (
            <div key={cat.id}>
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground/70">
                <Icon name={cat.icon} fallback="HelpCircle" size={15} /> {cat.name}
              </p>
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                {catItems.map(it => (
                  <div key={it.id} className="flex items-center justify-between gap-3 border-b border-border/50 last:border-0 px-4 py-3">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{it.question}</p>
                      <p className="text-xs text-foreground/40 truncate" dangerouslySetInnerHTML={{ __html: (it.answer || "").replace(/<[^>]+>/g, " ").slice(0, 120) || "— нет ответа —" }} />
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {!it.is_published && <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground/50">Скрыт</span>}
                      <button onClick={() => setEditItem({ id: it.id, category_id: it.category_id, question: it.question, answer: it.answer, sort_order: it.sort_order, is_published: it.is_published })}
                        className="text-foreground/40 hover:text-foreground" style={{ cursor: "pointer" }}>
                        <Icon name="Pencil" size={15} />
                      </button>
                      <button onClick={() => deleteItem(it.id)} className="text-foreground/40 hover:text-red-400" style={{ cursor: "pointer" }}>
                        <Icon name="Trash2" size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
        {/* Вопросы без категории */}
        {(itemsByCat.get(null) || []).length > 0 && (
          <div>
            <p className="mb-2 text-sm font-semibold text-foreground/50">Без категории</p>
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              {(itemsByCat.get(null) || []).map(it => (
                <div key={it.id} className="flex items-center justify-between gap-3 border-b border-border/50 last:border-0 px-4 py-3">
                  <p className="font-medium truncate">{it.question}</p>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => setEditItem({ id: it.id, category_id: it.category_id, question: it.question, answer: it.answer, sort_order: it.sort_order, is_published: it.is_published })}
                      className="text-foreground/40 hover:text-foreground" style={{ cursor: "pointer" }}>
                      <Icon name="Pencil" size={15} />
                    </button>
                    <button onClick={() => deleteItem(it.id)} className="text-foreground/40 hover:text-red-400" style={{ cursor: "pointer" }}>
                      <Icon name="Trash2" size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {!items.length && <p className="text-foreground/30 text-center py-12">Вопросов пока нет. Добавьте первый.</p>}
      </div>

      {/* Модалка вопроса с rich-text редактором */}
      {editItem && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 py-10" onClick={() => setEditItem(null)}>
          <div className="w-full max-w-2xl rounded-xl border border-border bg-card p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">{editItem.id ? "Редактировать вопрос" : "Новый вопрос"}</h3>
              <button onClick={() => setEditItem(null)} className="text-foreground/40 hover:text-foreground" style={{ cursor: "pointer" }}>
                <Icon name="X" size={18} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-foreground/50 mb-1">Вопрос</label>
                <input value={editItem.question} onChange={e => setEditItem({ ...editItem, question: e.target.value })}
                  className={INPUT_CLS} style={{ cursor: "text" }} placeholder="Например: Как оплатить заказ?" />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs text-foreground/50 mb-1">Категория</label>
                  <select value={editItem.category_id ?? ""} onChange={e => setEditItem({ ...editItem, category_id: e.target.value ? Number(e.target.value) : null })}
                    className={INPUT_CLS} style={{ cursor: "pointer" }}>
                    <option value="">— без категории —</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="w-28">
                  <label className="block text-xs text-foreground/50 mb-1">Порядок</label>
                  <input type="number" value={editItem.sort_order} onChange={e => setEditItem({ ...editItem, sort_order: Number(e.target.value) })}
                    className={INPUT_CLS} style={{ cursor: "text" }} />
                </div>
              </div>
              <div>
                <label className="block text-xs text-foreground/50 mb-1">Ответ</label>
                <Suspense fallback={<div className="text-foreground/40 text-sm py-8 text-center">Загрузка редактора…</div>}>
                  <RichTextEditor value={editItem.answer} onChange={v => setEditItem({ ...editItem, answer: v })}
                    placeholder="Введите ответ…" folder="faq" className="min-h-[200px]" />
                </Suspense>
              </div>
              <label className="flex items-center gap-2 text-sm" style={{ cursor: "pointer" }}>
                <input type="checkbox" checked={editItem.is_published} onChange={e => setEditItem({ ...editItem, is_published: e.target.checked })} />
                Опубликован (показывать на сайте)
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setEditItem(null)} className="rounded border border-border px-3 py-1.5 text-sm text-foreground/60" style={{ cursor: "pointer" }}>Отмена</button>
              <button onClick={saveItem} disabled={saving} className="rounded bg-primary px-4 py-1.5 text-sm text-primary-foreground disabled:opacity-50" style={{ cursor: "pointer" }}>
                {saving ? "Сохранение…" : "Сохранить"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модалка категории */}
      {editCat && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditCat(null)}>
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">{editCat.id ? "Категория" : "Новая категория"}</h3>
              <button onClick={() => setEditCat(null)} className="text-foreground/40 hover:text-foreground" style={{ cursor: "pointer" }}>
                <Icon name="X" size={18} />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-foreground/50 mb-1">Название</label>
                <input value={editCat.name || ""} onChange={e => setEditCat({ ...editCat, name: e.target.value })} className={INPUT_CLS} style={{ cursor: "text" }} />
              </div>
              <div>
                <label className="block text-xs text-foreground/50 mb-1">Иконка</label>
                <div className="flex flex-wrap gap-1.5">
                  {ICON_OPTIONS.map(ic => (
                    <button key={ic} onClick={() => setEditCat({ ...editCat, icon: ic })}
                      className={`flex h-9 w-9 items-center justify-center rounded border ${editCat.icon === ic ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/50"}`}
                      style={{ cursor: "pointer" }}>
                      <Icon name={ic} fallback="HelpCircle" size={16} />
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs text-foreground/50 mb-1">Порядок</label>
                <input type="number" value={editCat.sort_order || 0} onChange={e => setEditCat({ ...editCat, sort_order: Number(e.target.value) })} className={INPUT_CLS} style={{ cursor: "text" }} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setEditCat(null)} className="rounded border border-border px-3 py-1.5 text-sm text-foreground/60" style={{ cursor: "pointer" }}>Отмена</button>
              <button onClick={saveCat} className="rounded bg-primary px-4 py-1.5 text-sm text-primary-foreground" style={{ cursor: "pointer" }}>Сохранить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
