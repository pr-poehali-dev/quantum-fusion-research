import { useEffect, useMemo, useState } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { getAdminKey } from "@/pages/admin/constants"

// Границы, на которые смотрят поисковики. Держим их же и на бэкенде.
const TITLE_MAX = 60
const DESC_MIN = 70
const DESC_MAX = 160

type Kind = "all" | "product" | "build" | "article"

interface SeoItem {
  kind: "product" | "build" | "article"
  id: number
  name: string
  url: string
  slug: string
  meta_title: string
  meta_description: string
  suggest_title: string
  suggest_description: string
  suggest_slug: string
  context: string
  problems: string[]
  ok: boolean
  published?: boolean
}

const KIND_LABEL: Record<string, string> = {
  product: "Товар", build: "Сборка", article: "Статья",
}
const KIND_ICON: Record<string, string> = {
  product: "Package", build: "Monitor", article: "BookOpen",
}

export default function SeoTab() {
  const [items, setItems] = useState<SeoItem[]>([])
  const [loading, setLoading] = useState(true)
  const [kind, setKind] = useState<Kind>("all")
  const [onlyProblems, setOnlyProblems] = useState(true)
  const [search, setSearch] = useState("")
  const [busy, setBusy] = useState("")
  const [note, setNote] = useState("")
  const [editId, setEditId] = useState<string | null>(null)
  const [draft, setDraft] = useState({ meta_title: "", meta_description: "", slug: "" })
  const [copied, setCopied] = useState(false)

  const load = () => {
    const ak = getAdminKey()
    if (!ak) { setLoading(false); return }
    setLoading(true)
    api.seo.list(ak).then(d => setItems(d.items || [])).catch(() => setItems([]))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const flash = (msg: string) => { setNote(msg); setTimeout(() => setNote(""), 4000) }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter(i =>
      (kind === "all" || i.kind === kind) &&
      (!onlyProblems || !i.ok) &&
      (!q || i.name.toLowerCase().includes(q))
    )
  }, [items, kind, onlyProblems, search])

  const stats = useMemo(() => {
    const by = (k: string) => items.filter(i => i.kind === k)
    return (["product", "build", "article"] as const).map(k => {
      const sub = by(k)
      return { kind: k, total: sub.length, ok: sub.filter(i => i.ok).length }
    })
  }, [items])

  const totalOk = items.filter(i => i.ok).length

  // ── Действия ────────────────────────────────────────────────────────────
  const autofill = async (target: Kind) => {
    const ak = getAdminKey()
    if (!ak) return
    if (!confirm(`Заполнить пустые SEO-поля по шаблону? Уже заполненные тексты останутся нетронутыми.`)) return
    setBusy("autofill")
    const r = await api.seo.autofill(target, ak).catch(() => null)
    setBusy("")
    if (r?.ok) { flash(`Заполнено страниц: ${r.saved}`); load() }
    else flash("Не удалось заполнить")
  }

  const exportCsv = async () => {
    const ak = getAdminKey()
    if (!ak) return
    setBusy("export")
    const r = await api.seo.exportCsv(kind, ak).catch(() => null)
    setBusy("")
    if (!r?.csv) { flash("Не удалось выгрузить"); return }
    const blob = new Blob([r.csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = r.filename || "seo.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  const importCsv = async (file: File) => {
    const ak = getAdminKey()
    if (!ak) return
    setBusy("import")
    const text = await file.text()
    const r = await api.seo.importCsv(text, ak).catch(() => null)
    setBusy("")
    if (r?.ok) { flash(`Загружено строк: ${r.saved} из ${r.found}`); load() }
    else flash("Файл не подошёл — проверьте, что это выгруженный отсюда CSV")
  }

  // Промпт для нейросети: отдаём ей контекст и жёсткий формат ответа,
  // чтобы результат можно было вернуть обратно тем же CSV без правок.
  const buildPrompt = () => {
    const rows = visible.slice(0, 60)
    const lines = rows.map(r =>
      `${r.kind};${r.id};${r.name};${r.context}`).join("\n")
    return `Ты SEO-специалист интернет-магазина компьютерной техники BeGraphics (Москва, сборка ПК, комплектующие, ремонт).

Для каждой строки ниже составь мета-заголовок и мета-описание на русском языке.

Требования:
- meta_title: до ${TITLE_MAX} символов, содержит название и ключевой запрос, без воды и КАПСА;
- meta_description: ${DESC_MIN}-${DESC_MAX} символов, живой человеческий текст с выгодой и призывом, без перечисления ключей подряд;
- slug: латиницей, слова через дефис, только маленькие буквы;
- не выдумывай характеристики, цены и сроки, которых нет в контексте.

Входные данные (формат: kind;id;название;контекст):
${lines}

Ответ верни СТРОГО в формате CSV с разделителем «;» и такими колонками, без пояснений и без markdown:
kind;id;meta_title;meta_description;slug`
  }

  const copyPrompt = async () => {
    const text = buildPrompt()
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Буфер недоступен (нет https или отказ) — показываем текст,
      // чтобы человек мог скопировать вручную и не остался ни с чем.
      window.prompt("Скопируйте промпт вручную:", text)
      return
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  const startEdit = (i: SeoItem) => {
    setEditId(`${i.kind}-${i.id}`)
    setDraft({
      meta_title: i.meta_title || i.suggest_title,
      meta_description: i.meta_description || i.suggest_description,
      slug: i.slug || i.suggest_slug,
    })
  }

  const saveEdit = async (i: SeoItem) => {
    const ak = getAdminKey()
    if (!ak) return
    setBusy(`save-${i.id}`)
    const r = await api.seo.save({ kind: i.kind, id: i.id, ...draft }, ak).catch(() => null)
    setBusy("")
    if (!r?.ok) { flash("Не удалось сохранить"); return }
    setItems(list => list.map(x => (x.kind === i.kind && x.id === i.id)
      ? { ...x, ...draft, problems: [], ok: true } : x))
    setEditId(null)
  }

  const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"

  const lenColor = (n: number, min: number, max: number) =>
    n === 0 ? "text-foreground/30" : n > max ? "text-red-400" : n < min ? "text-amber-400" : "text-green-400"

  if (loading) return <p className="text-sm text-foreground/40">Загрузка…</p>

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">SEO-центр</h2>
          <p className="text-xs text-foreground/50">
            Заголовки и описания страниц для поисковиков. Зелёное — готово, жёлтое — нужно поправить.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={copyPrompt} disabled={!visible.length} style={{ cursor: "pointer" }}
            title="Скопировать готовый промпт и вставить в ChatGPT — он вернёт CSV, который загружаем обратно"
            className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-xs font-medium text-primary hover:bg-primary/15 transition-colors disabled:opacity-40">
            <Icon name={copied ? "Check" : "Sparkles"} size={14} />
            {copied ? "Промпт скопирован" : `Промпт для ИИ (${Math.min(visible.length, 60)})`}
          </button>
          <button onClick={exportCsv} disabled={busy === "export"} style={{ cursor: "pointer" }}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-foreground/70 hover:border-primary hover:text-foreground transition-colors disabled:opacity-40">
            <Icon name={busy === "export" ? "Loader2" : "Download"} size={14} className={busy === "export" ? "animate-spin" : ""} />
            Выгрузить CSV
          </button>
          <label className={`flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-foreground/70 hover:border-primary hover:text-foreground transition-colors ${busy === "import" ? "pointer-events-none opacity-40" : ""}`}
            style={{ cursor: "pointer" }}>
            <Icon name={busy === "import" ? "Loader2" : "Upload"} size={14} className={busy === "import" ? "animate-spin" : ""} />
            Загрузить CSV
            <input type="file" accept=".csv,text/csv" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) importCsv(f); e.target.value = "" }} />
          </label>
          <button onClick={() => autofill(kind)} disabled={busy === "autofill"} style={{ cursor: "pointer" }}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40">
            <Icon name={busy === "autofill" ? "Loader2" : "Wand2"} size={14} className={busy === "autofill" ? "animate-spin" : ""} />
            Заполнить пустые
          </button>
        </div>
      </div>

      {note && (
        <div className="mb-4 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">{note}</div>
      )}

      {/* Светофор по разделам */}
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {stats.map(s => {
          const pct = s.total ? Math.round((s.ok / s.total) * 100) : 100
          return (
            <button key={s.kind} onClick={() => setKind(kind === s.kind ? "all" : s.kind as Kind)}
              style={{ cursor: "pointer" }}
              className={`rounded-xl border p-3 text-left transition-colors ${kind === s.kind ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"}`}>
              <div className="mb-1.5 flex items-center gap-2">
                <Icon name={KIND_ICON[s.kind] as "Package"} size={14} className="text-foreground/50" />
                <span className="text-sm font-medium text-foreground">{KIND_LABEL[s.kind]}</span>
                <span className="ml-auto text-xs text-foreground/40">{s.ok} из {s.total}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className={`h-full rounded-full transition-all ${pct === 100 ? "bg-green-400" : pct > 50 ? "bg-amber-400" : "bg-red-400"}`}
                  style={{ width: `${pct}%` }} />
              </div>
            </button>
          )
        })}
      </div>

      {/* Фильтры */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
          <Icon name="Search" size={14} className="text-foreground/40" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск по названию…"
            className="w-48 bg-transparent text-sm text-foreground placeholder:text-foreground/40 focus:outline-none"
            style={{ cursor: "text" }} />
        </div>
        <button onClick={() => setOnlyProblems(o => !o)} style={{ cursor: "pointer" }}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-colors ${onlyProblems ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60 hover:border-primary/50"}`}>
          <Icon name={onlyProblems ? "CheckSquare" : "Square"} size={13} />
          Только требующие внимания
        </button>
        <span className="ml-auto text-xs text-foreground/40">
          Готово {totalOk} из {items.length} страниц
        </span>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-12 text-center">
          <Icon name="CircleCheck" size={32} className="mx-auto mb-3 text-green-400/60" />
          <p className="text-sm text-foreground/50">
            {onlyProblems ? "Всё оптимизировано — проблемных страниц нет." : "Ничего не найдено."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map(i => {
            const key = `${i.kind}-${i.id}`
            const isEdit = editId === key
            return (
              <div key={key} className={`rounded-xl border bg-card p-3 transition-colors ${i.ok ? "border-border" : "border-amber-400/40"}`}>
                <div className="flex items-start gap-3">
                  <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${i.ok ? "bg-green-400/10 text-green-400" : "bg-amber-400/10 text-amber-400"}`}>
                    <Icon name={i.ok ? "Check" : "AlertTriangle"} size={13} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="mb-0.5 flex flex-wrap items-center gap-2">
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-foreground/50">{KIND_LABEL[i.kind]}</span>
                      <p className="truncate text-sm font-medium text-foreground">{i.name}</p>
                      {i.published === false && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-foreground/40">черновик</span>
                      )}
                    </div>
                    {!isEdit && (
                      <>
                        <p className="truncate text-xs text-foreground/50">
                          {i.meta_title || <span className="text-foreground/30">заголовок не задан</span>}
                        </p>
                        {i.problems.length > 0 && (
                          <p className="mt-0.5 text-xs text-amber-400/80">{i.problems.join(", ")}</p>
                        )}
                      </>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <a href={i.url} target="_blank" rel="noreferrer" title="Открыть страницу"
                      className="rounded-lg border border-border px-2 py-1.5 text-foreground/40 hover:border-primary hover:text-foreground transition-colors">
                      <Icon name="ExternalLink" size={13} />
                    </a>
                    <button onClick={() => isEdit ? setEditId(null) : startEdit(i)} style={{ cursor: "pointer" }}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/70 hover:border-primary hover:text-foreground transition-colors">
                      {isEdit ? "Свернуть" : "Изменить"}
                    </button>
                  </div>
                </div>

                {isEdit && (
                  <div className="mt-3 space-y-2 border-t border-border pt-3">
                    <div>
                      <div className="mb-1 flex items-center justify-between">
                        <label className="text-xs text-foreground/60">Заголовок в поиске</label>
                        <span className={`text-[10px] ${lenColor(draft.meta_title.length, 1, TITLE_MAX)}`}>
                          {draft.meta_title.length} / {TITLE_MAX}
                        </span>
                      </div>
                      <input value={draft.meta_title} className={inputCls}
                        onChange={e => setDraft(d => ({ ...d, meta_title: e.target.value }))} style={{ cursor: "text" }} />
                    </div>
                    <div>
                      <div className="mb-1 flex items-center justify-between">
                        <label className="text-xs text-foreground/60">Описание в поиске</label>
                        <span className={`text-[10px] ${lenColor(draft.meta_description.length, DESC_MIN, DESC_MAX)}`}>
                          {draft.meta_description.length} / {DESC_MAX}
                        </span>
                      </div>
                      <textarea rows={2} value={draft.meta_description} className={`${inputCls} resize-y`}
                        onChange={e => setDraft(d => ({ ...d, meta_description: e.target.value }))} style={{ cursor: "text" }} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-foreground/60">Адрес страницы</label>
                      <div className="flex items-center gap-2">
                        <span className="shrink-0 text-xs text-foreground/30">/{i.kind === "article" ? "articles" : i.kind === "build" ? "build-preview" : "product"}/</span>
                        <input value={draft.slug} className={inputCls}
                          onChange={e => setDraft(d => ({ ...d, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") }))}
                          style={{ cursor: "text" }} />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button onClick={() => saveEdit(i)} disabled={busy === `save-${i.id}`} style={{ cursor: "pointer" }}
                        className="rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40">
                        {busy === `save-${i.id}` ? "Сохраняем…" : "Сохранить"}
                      </button>
                      <button onClick={() => setDraft({ meta_title: i.suggest_title, meta_description: i.suggest_description, slug: i.suggest_slug })}
                        style={{ cursor: "pointer" }}
                        className="rounded-lg border border-border px-4 py-2 text-xs text-foreground/70 hover:border-primary hover:text-foreground transition-colors">
                        Подставить по шаблону
                      </button>
                    </div>
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