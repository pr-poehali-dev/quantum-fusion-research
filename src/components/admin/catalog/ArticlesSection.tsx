import React, { useState, useEffect } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { ImageUploader } from "@/components/image-uploader"
import RichTextEditor from "@/components/ui/rich-text-editor"
import { Product, Article, AdminTab } from "@/pages/admin/types"

// Зарезервированный якорь оглавления для блока тир-листа статьи
const TIER_ANCHOR = "__tierlist__"

export function ArticlesSection({ tab, setTab, loading, articles, setArticles, autoEditArticleId, setAutoEditArticleId }: {
  tab: AdminTab
  setTab: (t: AdminTab) => void
  loading: boolean
  articles: Article[]
  setArticles: React.Dispatch<React.SetStateAction<Article[]>>
  // id статьи для авто-открытия на редактирование. Хранится в Admin, поэтому
  // переживает remount поддерева (key={main-${tab}}) при переходе на add_article.
  autoEditArticleId?: number | null
  setAutoEditArticleId?: (id: number | null) => void
}) {
  const [articleForm, setArticleForm] = useState({
    id: null as number | null,
    title: "", slug: "", excerpt: "", content: "",
    image_url: "", image_urls: [] as string[], categories: ["article"] as string[], is_published: false,
    html_attachment: "",
    toc: [] as { title: string; anchor: string }[],
    tier_cards: [] as { title: string; image_url: string; rank: string | null; product_id?: number; anchor?: string }[],
  })
  const [copiedAnchor, setCopiedAnchor] = useState<string | null>(null)
  const [tierProductSearch, setTierProductSearch] = useState("")  // поиск товара для карточки тир-листа
  // Полный список товаров для поиска карточек тир-листа (грузим отдельно — на
  // вкладке статей общий products может быть пуст). Только не архивные.
  const [tierAllProducts, setTierAllProducts] = useState<Product[]>([])
  useEffect(() => {
    api.products.getAll().then(d => setTierAllProducts((d.products || []).filter((p: Product & { is_archived?: boolean }) => !p.is_archived)))
  }, [])

  // Доступные типы статей (можно выбрать несколько)
  const ARTICLE_CATEGORIES: { value: string; label: string }[] = [
    { value: "article", label: "Статья" },
    { value: "review", label: "Обзор" },
    { value: "test", label: "Тест / Бенчмарк" },
    { value: "guide", label: "Гайд" },
    { value: "repair", label: "Ремонты" },
    { value: "tier_detail", label: "Подробный тир-лист" },
  ]
  const toggleArticleCategory = (val: string) => setArticleForm(f => {
    const has = f.categories.includes(val)
    let next = has ? f.categories.filter(c => c !== val) : [...f.categories, val]
    if (next.length === 0) next = ["article"]  // хотя бы один тип
    return { ...f, categories: next }
  })
  const [tocDragIdx, setTocDragIdx] = useState<number | null>(null)  // перетаскивание пункта оглавления
  const [tierTocOpen, setTierTocOpen] = useState(false)  // раскрытие списка карточек тир-листа в оглавлении

  const addTierCard = () => setArticleForm(f => ({ ...f, tier_cards: [...f.tier_cards, { title: "", image_url: "", rank: null }] }))
  const updateTierCard = (i: number, patch: Partial<{ title: string; image_url: string; rank: string | null; product_id?: number; anchor?: string }>) =>
    setArticleForm(f => ({ ...f, tier_cards: f.tier_cards.map((c, idx) => idx === i ? { ...c, ...patch } : c) }))
  const removeTierCard = (i: number) =>
    setArticleForm(f => ({ ...f, tier_cards: f.tier_cards.filter((_, idx) => idx !== i) }))
  // Добавить карточку из существующего товара (фото + название подтянутся)
  const addTierCardFromProduct = (p: Product) => {
    const img = p.image_urls?.[0] || p.image_url || ""
    setArticleForm(f => ({ ...f, tier_cards: [...f.tier_cards, { title: p.name, image_url: img, rank: null, product_id: p.id }] }))
    setTierProductSearch("")
  }

  // Превратить заголовок пункта в slug-якорь (латиницей)
  const anchorSlug = (s: string) => s.toLowerCase()
    .replace(/[а-яё]/g, m => ({ 'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'j','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'c','ч':'ch','ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya' } as Record<string, string>)[m] || m)
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

  const addTocItem = () => setArticleForm(f => ({ ...f, toc: [...f.toc, { title: "", anchor: `p${f.toc.length + 1}` }] }))
  // Пункт-ссылка на блок тир-листа статьи (особый зарезервированный якорь)
  const addTocTierItem = () => setArticleForm(f => ({ ...f, toc: [...f.toc, { title: "Тир-лист", anchor: TIER_ANCHOR }] }))
  const updateTocItem = (i: number, patch: Partial<{ title: string; anchor: string }>) =>
    setArticleForm(f => ({ ...f, toc: f.toc.map((t, idx) => idx === i ? { ...t, ...patch } : t) }))
  const removeTocItem = (i: number) =>
    setArticleForm(f => ({ ...f, toc: f.toc.filter((_, idx) => idx !== i) }))
  // Перемещение пункта оглавления с позиции from на to (drag&drop)
  const moveTocItem = (from: number, to: number) => setArticleForm(f => {
    if (from === to || to < 0 || to >= f.toc.length) return f
    const arr = [...f.toc]
    const [m] = arr.splice(from, 1)
    arr.splice(to, 0, m)
    return { ...f, toc: arr }
  })
  const copyAnchorTag = (anchor: string) => {
    navigator.clipboard.writeText(`[[#${anchor}]]`)
    setCopiedAnchor(anchor)
    setTimeout(() => setCopiedAnchor(null), 1800)
  }

  const submitArticle = async (e: React.FormEvent) => {
    e.preventDefault()
    const payload = {
      id: articleForm.id,
      title: articleForm.title, slug: articleForm.slug,
      excerpt: articleForm.excerpt || null, content: articleForm.content,
      image_url: articleForm.image_urls[0] || articleForm.image_url || null,
      image_urls: articleForm.image_urls,
      categories: articleForm.categories, is_published: articleForm.is_published,
      html_attachment: articleForm.html_attachment || null,
      toc: articleForm.toc.filter(t => t.title.trim() && t.anchor.trim()),
      tier_cards: articleForm.tier_cards.filter(c => c.title.trim() || c.image_url),
    }
    if (articleForm.id) await api.articles.update(payload)
    else await api.articles.create(payload)
    setAutoEditArticleId?.(null)
    setArticleForm({ id: null, title: "", slug: "", excerpt: "", content: "", image_url: "", image_urls: [], categories: ["article"], is_published: false, html_attachment: "", toc: [], tier_cards: [] })
    setTab("articles")
  }

  // Наполнить форму по данным статьи из списка + догрузить полный контент.
  const fillArticleForm = (a: Article) => {
    setArticleForm({
      id: a.id, title: a.title, slug: a.slug,
      excerpt: a.excerpt || "", content: "",
      image_url: a.image_url || "", image_urls: a.image_urls || (a.image_url ? [a.image_url] : []),
      categories: (a.categories && a.categories.length ? a.categories : [a.category || "article"]),
      is_published: a.is_published, html_attachment: "", toc: [], tier_cards: [],
    })
    api.articles.getById(a.id, true).then(full => {
      setArticleForm(f => f.id === a.id ? { ...f, content: full.content || "", html_attachment: full.html_attachment || "", image_urls: full.image_urls || f.image_urls || [], toc: full.toc || [], tier_cards: full.tier_cards || [], categories: (full.categories && full.categories.length ? full.categories : f.categories) } : f)
    })
  }

  const editArticle = (a: Article) => {
    // id храним в Admin (autoEditArticleId) — он переживает remount поддерева
    // при переходе articles → add_article (key={main-${tab}} в Admin.tsx),
    // иначе локальный стейт формы сбрасывался и открывалась «новая статья».
    setAutoEditArticleId?.(a.id)
    fillArticleForm(a)
    setTab("add_article")
  }

  // После remount на вкладке add_article наполняем форму по autoEditArticleId,
  // как только статья появилась в списке. one-shot: затем сбрасываем id.
  useEffect(() => {
    if (!autoEditArticleId) return
    const a = articles.find(x => x.id === autoEditArticleId)
    if (a && articleForm.id !== autoEditArticleId) {
      fillArticleForm(a)
      setTab("add_article")
    }
    // сбрасываем только когда форма уже наполнена нужной статьёй
    if (a && articleForm.id === autoEditArticleId) setAutoEditArticleId?.(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoEditArticleId, articles, articleForm.id])

  const deleteArticle = async (id: number) => {
    if (!confirm("Удалить статью?")) return
    await api.articles.delete(id)
    setArticles(as => as.filter(a => a.id !== id))
  }

  // ARTICLES LIST
  if (tab === "articles") return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Статьи и тесты</h2>
        <button onClick={() => { setAutoEditArticleId?.(null); setArticleForm({ id: null, title: "", slug: "", excerpt: "", content: "", image_url: "", image_urls: [], categories: ["article"], is_published: false, html_attachment: "", toc: [], tier_cards: [] }); setTab("add_article") }}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>
          <Icon name="Plus" size={15} />Новая статья
        </button>
      </div>
      {loading ? <p className="text-sm text-foreground/40">Загрузка...</p> : articles.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-12 text-center">
          <Icon name="BookOpen" size={32} className="mx-auto mb-3 text-foreground/20" />
          <p className="text-sm text-foreground/40">Статей пока нет. Создайте первую!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {articles.map(a => (
            <div key={a.id} className="flex items-center gap-4 rounded-xl border border-border bg-card p-4 hover:border-primary/40 transition-colors">
              {a.image_url && <img src={a.image_url} alt={a.title} className="h-14 w-20 rounded-lg object-cover shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${a.is_published ? "bg-green-400/10 text-green-400" : "bg-muted text-foreground/40"}`}>
                    {a.is_published ? "Опубликована" : "Черновик"}
                  </span>
                  {((a.categories && a.categories.length ? a.categories : [a.category]).map(cat =>
                    <span key={cat} className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground/50">
                      {{ review: "Обзор", test: "Тест", guide: "Гайд", repair: "Ремонты", tier_detail: "Тир-лист", article: "Статья" }[cat || "article"] || "Статья"}
                    </span>
                  ))}
                </div>
                <p className="text-sm font-medium text-foreground truncate">{a.title}</p>
                <p className="text-xs text-foreground/40">{new Date(a.created_at).toLocaleDateString("ru-RU")} · {a.views} просмотров</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => editArticle(a)} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:border-primary transition-colors" style={{ cursor: "pointer" }}>Редакт.</button>
                <button onClick={() => deleteArticle(a.id)} className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/50 hover:border-red-400 hover:text-red-400 transition-colors" style={{ cursor: "pointer" }}><Icon name="Trash2" size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  // ADD/EDIT ARTICLE
  if (tab === "add_article") return (
    <div>
      <h2 className="mb-5 text-lg font-semibold text-foreground">{articleForm.id ? "Редактировать статью" : "Новая статья"}</h2>
      <form onSubmit={submitArticle} className="space-y-4 max-w-3xl">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-foreground/60">Заголовок *</label>
            <input required value={articleForm.title} onChange={e => setArticleForm(f => ({ ...f, title: e.target.value }))}
              className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "text" }} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-foreground/60">Slug (URL)</label>
            <input value={articleForm.slug} onChange={e => setArticleForm(f => ({ ...f, slug: e.target.value }))} placeholder="auto-generated"
              className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "text" }} />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-foreground/60">Типы (можно несколько)</label>
            <div className="flex flex-wrap gap-2">
              {ARTICLE_CATEGORIES.map(c => {
                const on = articleForm.categories.includes(c.value)
                return (
                  <button key={c.value} type="button" onClick={() => toggleArticleCategory(c.value)}
                    className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors ${on ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60 hover:border-primary/50"}`}
                    style={{ cursor: "pointer" }}>
                    <Icon name={on ? "CheckSquare" : "Square"} size={14} />
                    {c.label}
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <label className="mb-2 block text-xs text-foreground/60">Изображения статьи</label>
            <ImageUploader images={articleForm.image_urls} onChange={urls => setArticleForm(f => ({ ...f, image_urls: urls }))} folder="articles" />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs text-foreground/60">Краткое описание (превью)</label>
          <RichTextEditor value={articleForm.excerpt} onChange={v => setArticleForm(f => ({ ...f, excerpt: v }))} placeholder="Краткое описание для карточки статьи..." />
        </div>
        <div>
          <label className="mb-1 block text-xs text-foreground/60">Текст статьи *</label>
          <RichTextEditor value={articleForm.content} onChange={v => setArticleForm(f => ({ ...f, content: v }))} placeholder="Начните писать статью..." className="min-h-[400px]" />
        </div>

        {/* ── Оглавление статьи ── */}
        <div className="rounded-xl border border-border bg-card/40 p-4">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <label className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <Icon name="List" size={15} className="text-primary" /> Оглавление статьи
              </label>
              <p className="mt-0.5 text-xs text-foreground/50">
                Добавьте пункты, скопируйте метку и вставьте её в нужное место текста.
                По клику в статье будет плавная прокрутка к этому месту.
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              {articleForm.categories.includes("tier_detail") && !articleForm.toc.some(t => t.anchor === TIER_ANCHOR) && (
                <button type="button" onClick={addTocTierItem}
                  className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/15 transition-colors" style={{ cursor: "pointer" }}>
                  <Icon name="Trophy" size={13} /> Пункт на тир-лист
                </button>
              )}
              <button type="button" onClick={addTocItem}
                className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors" style={{ cursor: "pointer" }}>
                <Icon name="Plus" size={13} /> Пункт
              </button>
            </div>
          </div>

          {articleForm.toc.length === 0 ? (
            <p className="py-3 text-center text-xs text-foreground/40">Пунктов пока нет</p>
          ) : (
            <div className="space-y-2">
              {articleForm.toc.map((t, i) => {
                const isTier = t.anchor === TIER_ANCHOR
                return (
                <React.Fragment key={i}>
                <div
                  draggable
                  onDragStart={() => setTocDragIdx(i)}
                  onDragOver={e => { if (tocDragIdx !== null && tocDragIdx !== i) e.preventDefault() }}
                  onDrop={() => { if (tocDragIdx !== null) moveTocItem(tocDragIdx, i); setTocDragIdx(null) }}
                  onDragEnd={() => setTocDragIdx(null)}
                  className={`flex flex-wrap items-center gap-2 rounded-lg border bg-background/40 p-2 transition-colors ${tocDragIdx === i ? "border-primary opacity-60" : "border-border"}`}>
                  <span className="flex h-6 w-6 shrink-0 cursor-grab items-center justify-center rounded bg-muted text-foreground/40 active:cursor-grabbing" title="Перетащите для изменения порядка">
                    <Icon name="GripVertical" size={13} />
                  </span>
                  <input
                    value={t.title}
                    onChange={e => updateTocItem(i, isTier ? { title: e.target.value } : { title: e.target.value, anchor: t.anchor || anchorSlug(e.target.value) || `p${i + 1}` })}
                    placeholder="Название пункта (напр. «Итоги»)"
                    className="min-w-[140px] flex-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "text" }} />
                  {isTier ? (
                    <button type="button" onClick={() => setTierTocOpen(o => !o)}
                      className="flex items-center gap-1 rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/15 transition-colors" style={{ cursor: "pointer" }}>
                      <Icon name="Trophy" size={12} /> карточки ({articleForm.tier_cards.length})
                      <Icon name={tierTocOpen ? "ChevronUp" : "ChevronDown"} size={12} />
                    </button>
                  ) : (
                    <>
                      <input
                        value={t.anchor}
                        onChange={e => updateTocItem(i, { anchor: anchorSlug(e.target.value) })}
                        placeholder="метка"
                        className="w-28 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-mono text-foreground/70 focus:border-primary focus:outline-none" style={{ cursor: "text" }} />
                      <button type="button" onClick={() => copyAnchorTag(t.anchor)} title="Скопировать метку для вставки в текст"
                        className="flex items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-xs text-foreground/60 hover:border-primary hover:text-primary transition-colors" style={{ cursor: "pointer" }}>
                        <Icon name={copiedAnchor === t.anchor ? "Check" : "Copy"} size={12} />
                        {copiedAnchor === t.anchor ? "Скопировано" : `[[#${t.anchor}]]`}
                      </button>
                    </>
                  )}
                  <button type="button" onClick={() => removeTocItem(i)}
                    className="rounded-lg border border-border px-2 py-1.5 text-foreground/40 hover:border-red-400 hover:text-red-400 transition-colors" style={{ cursor: "pointer" }}>
                    <Icon name="Trash2" size={12} />
                  </button>
                </div>

                {/* Раскрытый список карточек тир-листа: метка-якорь на каждую */}
                {isTier && tierTocOpen && (
                  <div className="ml-8 space-y-1.5 rounded-lg border border-dashed border-border bg-background/30 p-2">
                    {articleForm.tier_cards.length === 0 ? (
                      <p className="py-1 text-center text-xs text-foreground/40">Сначала добавьте карточки в блок «Тир-лист статьи»</p>
                    ) : articleForm.tier_cards.map((card, ci) => {
                      const cardAnchor = `tier-card-${ci}`
                      return (
                        <div key={ci} className="flex items-center gap-2 rounded-lg border border-border bg-card px-2 py-1.5">
                          <div className="h-7 w-10 shrink-0 overflow-hidden rounded bg-muted">
                            {card.image_url ? <img src={card.image_url} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center"><Icon name="Image" size={12} className="text-foreground/30" /></div>}
                          </div>
                          <span className="flex-1 truncate text-sm text-foreground">{card.title || `Карточка ${ci + 1}`}{card.rank ? ` · ${card.rank}` : ""}</span>
                          <button type="button" onClick={() => copyAnchorTag(cardAnchor)} title="Скопировать метку и вставить в текст"
                            className="flex shrink-0 items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-foreground/60 hover:border-primary hover:text-primary transition-colors" style={{ cursor: "pointer" }}>
                            <Icon name={copiedAnchor === cardAnchor ? "Check" : "Copy"} size={12} />
                            {copiedAnchor === cardAnchor ? "Скопировано" : `[[#${cardAnchor}]]`}
                          </button>
                        </div>
                      )
                    })}
                    <p className="px-1 text-xs text-foreground/40">Скопируйте метку карточки и вставьте в текст — клик по ней прокрутит к этой карточке в тир-листе.</p>
                  </div>
                )}
                </React.Fragment>
                )
              })}
              <p className="text-xs text-foreground/40">
                Перетаскивайте пункты за <Icon name="GripVertical" size={11} className="inline" /> для изменения порядка.
                Метку <span className="font-mono text-foreground/60">[[#метка]]</span> вставьте в текст там, куда должна вести прокрутка.
                Пункт «тир-лист» ведёт к блоку тир-листа автоматически.
              </p>
            </div>
          )}
        </div>

        {/* ── Карточки тир-листа (только для типа «Подробный тир-лист») ── */}
        {articleForm.categories.includes("tier_detail") && (
          <div className="rounded-xl border border-border bg-card/40 p-4">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <label className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <Icon name="Trophy" size={15} className="text-primary" /> Тир-лист статьи
                </label>
                <p className="mt-0.5 text-xs text-foreground/50">
                  Добавьте карточки (фото + название) и присвойте каждой ряд S/A/B/C/D/F.
                  Они покажутся таблицей в статье.
                </p>
                {articleForm.content.includes("[[#tierlist]]") ? (
                  <span className="mt-2 flex w-fit items-center gap-1 rounded-lg border border-green-500/40 bg-green-500/10 px-2 py-1 text-xs font-medium text-green-500">
                    <Icon name="Check" size={12} /> Блок уже в тексте
                  </span>
                ) : (
                  <button type="button" onClick={() => copyAnchorTag("tierlist")}
                    className="mt-2 flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-foreground/60 hover:border-primary hover:text-primary transition-colors" style={{ cursor: "pointer" }}>
                    <Icon name={copiedAnchor === "tierlist" ? "Check" : "Copy"} size={12} />
                    {copiedAnchor === "tierlist" ? "Скопировано" : "Вставить блок в текст: [[#tierlist]]"}
                  </button>
                )}
              </div>
              <button type="button" onClick={addTierCard}
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors" style={{ cursor: "pointer" }}>
                <Icon name="Plus" size={13} /> Пустая карточка
              </button>
            </div>

            {/* Добавление из каталога: поиск товара → карточка с его фото и названием */}
            <div className="relative mb-3">
              <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 focus-within:border-primary transition-colors">
                <Icon name="Search" size={15} className="shrink-0 text-foreground/40" />
                <input value={tierProductSearch} onChange={e => setTierProductSearch(e.target.value)}
                  placeholder="Добавить из каталога — начните вводить название товара..."
                  className="flex-1 bg-transparent text-sm text-foreground placeholder:text-foreground/40 focus:outline-none" style={{ cursor: "text" }} />
                {tierProductSearch && (
                  <button type="button" onClick={() => setTierProductSearch("")} className="text-foreground/30 hover:text-foreground" style={{ cursor: "pointer" }}>
                    <Icon name="X" size={14} />
                  </button>
                )}
              </div>
              {tierProductSearch.trim().length >= 1 && (() => {
                const q = tierProductSearch.trim().toLowerCase()
                const found = tierAllProducts.filter(p => p.name.toLowerCase().includes(q)).slice(0, 8)
                if (found.length === 0) return (
                  <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-xl border border-border bg-card px-4 py-3 text-xs text-foreground/40 shadow-xl">Ничего не найдено</div>
                )
                return (
                  <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-xl border border-border bg-card shadow-xl">
                    {found.map(p => {
                      const img = p.image_urls?.[0] || p.image_url || ""
                      return (
                        <button key={p.id} type="button" onClick={() => addTierCardFromProduct(p)}
                          className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted transition-colors" style={{ cursor: "pointer" }}>
                          <div className="h-9 w-9 shrink-0 overflow-hidden rounded bg-muted">
                            {img ? <img src={img} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center"><Icon name="Package" size={14} className="text-foreground/30" /></div>}
                          </div>
                          <span className="flex-1 truncate text-sm font-medium text-foreground">{p.name}</span>
                          {p.category?.name && <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-foreground/50">{p.category.name}</span>}
                        </button>
                      )
                    })}
                  </div>
                )
              })()}
            </div>

            {articleForm.tier_cards.length === 0 ? (
              <p className="py-3 text-center text-xs text-foreground/40">Карточек пока нет</p>
            ) : (
              <div className="space-y-2">
                {articleForm.tier_cards.map((c, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background/40 p-2">
                    <div className="w-28 shrink-0">
                      <ImageUploader images={c.image_url ? [c.image_url] : []} onChange={urls => updateTierCard(i, { image_url: urls[0] || "" })} folder="articles" maxImages={1} />
                    </div>
                    <div className="flex min-w-[140px] flex-1 flex-col gap-1">
                      {c.product_id && (
                        <span className="inline-flex w-fit items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                          <Icon name="Link2" size={10} /> из каталога
                        </span>
                      )}
                      <input
                        value={c.title}
                        onChange={e => updateTierCard(i, { title: e.target.value })}
                        placeholder="Название (напр. «RTX 4090»)"
                        className="w-full rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "text" }} />
                    </div>
                    <select value={c.rank || ""} onChange={e => updateTierCard(i, { rank: e.target.value || null })}
                      className="w-24 rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "pointer" }}>
                      <option value="">Без ряда</option>
                      {["S", "A", "B", "C", "D", "F"].map(r => <option key={r} value={r}>Ряд {r}</option>)}
                    </select>
                    {/* Якорь карточки — куда вести по клику; метку вставляешь в текст */}
                    <input
                      value={c.anchor || ""}
                      onChange={e => updateTierCard(i, { anchor: anchorSlug(e.target.value) })}
                      placeholder="якорь"
                      title="Метка карточки — вставь её в текст; клик по карточке прокрутит сюда"
                      className="w-24 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-mono text-foreground/70 focus:border-primary focus:outline-none" style={{ cursor: "text" }} />
                    {c.anchor && (
                      <button type="button" onClick={() => copyAnchorTag(c.anchor!)} title="Скопировать метку для вставки в текст"
                        className="flex items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-xs text-foreground/60 hover:border-primary hover:text-primary transition-colors" style={{ cursor: "pointer" }}>
                        <Icon name={copiedAnchor === c.anchor ? "Check" : "Copy"} size={12} />
                        {copiedAnchor === c.anchor ? "Скопировано" : `[[#${c.anchor}]]`}
                      </button>
                    )}
                    <button type="button" onClick={() => removeTierCard(i)}
                      className="rounded-lg border border-border px-2 py-1.5 text-foreground/40 hover:border-red-400 hover:text-red-400 transition-colors" style={{ cursor: "pointer" }}>
                      <Icon name="Trash2" size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs text-foreground/60">HTML-вложение <span className="text-foreground/30">(опционально)</span></label>
            {articleForm.html_attachment && (
              <button type="button" onClick={() => setArticleForm(f => ({ ...f, html_attachment: "" }))}
                className="text-xs text-foreground/40 hover:text-red-400 transition-colors flex items-center gap-1" style={{ cursor: "pointer" }}>
                <Icon name="X" size={11} /> Очистить
              </button>
            )}
          </div>
          <div className="relative">
            <textarea rows={8} value={articleForm.html_attachment} onChange={e => setArticleForm(f => ({ ...f, html_attachment: e.target.value }))}
              placeholder={"<!DOCTYPE html>\n<html>\n  <body>\n    <!-- HTML-код результатов теста -->\n  </body>\n</html>"}
              className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-xs text-foreground focus:border-primary focus:outline-none resize-y font-mono" style={{ cursor: "text" }} />
            <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
              {articleForm.html_attachment && <span className="rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">{articleForm.html_attachment.length.toLocaleString()} симв.</span>}
              <label className="flex cursor-pointer items-center gap-1 rounded border border-border bg-card px-2 py-1 text-xs text-foreground/50 hover:border-primary hover:text-foreground transition-colors">
                <Icon name="Upload" size={11} />.html
                <input type="file" accept=".html,.htm" className="hidden" onChange={e => { const file = e.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = ev => setArticleForm(f => ({ ...f, html_attachment: ev.target?.result as string || "" })); reader.readAsText(file); e.target.value = "" }} />
              </label>
            </div>
          </div>
          {articleForm.html_attachment && (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-foreground/40 hover:text-foreground/60 select-none">Предпросмотр</summary>
              <div className="mt-2 rounded-lg border border-border overflow-hidden" style={{ height: 320 }}>
                <iframe srcDoc={articleForm.html_attachment} sandbox="allow-scripts" className="w-full h-full border-0 bg-white" title="HTML preview" />
              </div>
            </details>
          )}
        </div>
        <div className="flex items-center gap-3">
          <input type="checkbox" id="is_published" checked={articleForm.is_published} onChange={e => setArticleForm(f => ({ ...f, is_published: e.target.checked }))} className="h-4 w-4 rounded border-border accent-primary" style={{ cursor: "pointer" }} />
          <label htmlFor="is_published" className="text-sm text-foreground/70" style={{ cursor: "pointer" }}>Опубликовать (показывать на сайте)</label>
        </div>
        <div className="flex gap-3">
          <button type="submit" className="rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>
            {articleForm.id ? "Сохранить" : "Создать статью"}
          </button>
          <button type="button" onClick={() => { setAutoEditArticleId?.(null); setTab("articles") }} className="rounded-lg border border-border px-6 py-2.5 text-sm text-foreground/70 hover:border-primary hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
            Отмена
          </button>
        </div>
      </form>
    </div>
  )

  return null
}