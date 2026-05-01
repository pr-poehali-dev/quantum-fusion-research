import { useState, useEffect } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { useNavigate } from "react-router-dom"
import { ImageUploader } from "@/components/image-uploader"

const ADMIN_PASSWORD = "begraphics2024"

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  new: { label: "Новый", color: "text-primary bg-primary/10" },
  processing: { label: "В работе", color: "text-accent bg-accent/10" },
  done: { label: "Выполнен", color: "text-green-400 bg-green-400/10" },
  cancelled: { label: "Отменён", color: "text-foreground/50 bg-muted" },
}

const BUILD_STATUS: Record<string, string> = {
  catalog: "На сайте",
  client: "Для клиента",
  archive: "Архив",
  draft: "Черновик",
}

const SLOT_LABELS: Record<string, string> = {
  cpu: "Процессор", gpu: "Видеокарта", ram: "ОЗУ",
  storage: "Накопитель", psu: "БП", case: "Корпус", motherboard: "Материнская плата",
}

interface Order {
  id: number
  customer_name: string
  customer_phone: string
  customer_email: string
  order_type: string
  items: Array<{ name: string; price: number; quantity: number }>
  total: number
  comment: string
  status: string
  created_at: string
}

interface Product {
  id: number
  name: string
  price: number
  old_price: number | null
  in_stock: boolean
  category: { name: string } | null
  description: string
  specs: Record<string, string>
  sort_order: number
  is_featured: boolean
}

interface Category {
  id: number
  name: string
  slug: string
}

interface ConfigComponent {
  id: number
  slot: string
  name: string
  brand?: string
  price: number
}

interface PCBuild {
  id: number
  name: string
  description: string
  image_urls: string[]
  components: Array<{ slot: string; name: string; price: number; source: string; source_id?: number; current_price?: number; qty?: number }>
  parts_total: number
  assembly_type: string
  assembly_fee: number
  total_price: number
  status: string
  is_featured: boolean
  client_token: string | null
  client_user_id: number | null
}

interface Article {
  id: number
  title: string
  slug: string
  excerpt: string | null
  image_url: string | null
  category: string
  is_published: boolean
  views: number
  created_at: string
}

export default function Admin() {
  const navigate = useNavigate()
  const [authed, setAuthed] = useState(() => sessionStorage.getItem("begraphics_admin") === "1")
  const [password, setPassword] = useState("")
  const [tab, setTab] = useState<"orders" | "products" | "add_product" | "builds" | "archive" | "add_build" | "articles" | "add_article">("orders")

  const [orders, setOrders] = useState<Order[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [configSlots, setConfigSlots] = useState<Record<string, ConfigComponent[]>>({})
  const [builds, setBuilds] = useState<PCBuild[]>([])
  const [articles, setArticles] = useState<Article[]>([])
  const [loading, setLoading] = useState(false)
  const [articleForm, setArticleForm] = useState({
    id: null as number | null,
    title: "", slug: "", excerpt: "", content: "",
    image_url: "", category: "article", is_published: false,
    html_attachment: "",
  })

  const [productForm, setProductForm] = useState({
    id: null as number | null,
    category_id: "", name: "", description: "", price: "", old_price: "",
    image_url: "", specs: "", in_stock: true, is_featured: false, sort_order: "0",
  })

  // Build constructor state
  const [buildForm, setBuildForm] = useState({
    id: null as number | null,
    name: "", description: "", status: "catalog", is_featured: false,
    assembly_type: "percent" as "percent" | "manual",
    assembly_fee_manual: "",
    image_urls: [] as string[],
  })
  const [buildComponents, setBuildComponents] = useState<Array<{
    slot: string; source: "catalog" | "custom"; source_id?: number; name: string; price: number; qty: number
  }>>([])
  const [addingSlot, setAddingSlot] = useState<string | null>(null)
  const [copiedBuildId, setCopiedBuildId] = useState<number | null>(null)
  const [dupeLoading, setDupeLoading] = useState<number | null>(null)
  const [expandedVariants, setExpandedVariants] = useState<number | null>(null)

  const generateClientLink = async (b: PCBuild) => {
    const token = b.client_token || (await api.builds.generateClientLink(b.id)).client_token
    if (!token) return
    setBuilds(bs => bs.map(bb => bb.id === b.id ? { ...bb, client_token: token } : bb))
    const url = `${window.location.origin}/build?token=${token}`
    navigator.clipboard.writeText(url)
    setCopiedBuildId(b.id)
    setTimeout(() => setCopiedBuildId(null), 2500)
  }

  const fmt = (n: number) => n.toLocaleString("ru-RU") + " ₽"
  const partsTotal = buildComponents.reduce((s, c) => s + c.price * (c.qty || 1), 0)
  const assemblyFee = buildForm.assembly_type === "percent"
    ? Math.round(partsTotal * 0.07)
    : (parseFloat(buildForm.assembly_fee_manual) || 0)
  const buildTotal = partsTotal + assemblyFee

  useEffect(() => {
    if (!authed) return
    setLoading(true)
    if (tab === "orders") {
      api.orders.getAll().then(d => { setOrders(d.orders || []); setLoading(false) })
    } else if (tab === "products" || tab === "add_product") {
      api.products.getAll().then(d => {
        setProducts(d.products || [])
        setCategories(d.categories || [])
        setLoading(false)
      })
    } else if (tab === "builds" || tab === "archive" || tab === "add_build") {
      Promise.all([
        api.builds.getAll().then(d => d.builds || []),
        // Берём ВСЕ товары из каталога и группируем по slug категории как слот
        api.products.getAll().then(d => {
          const prods = d.products || []
          setProducts(prods)
          setCategories(d.categories || [])
          // Формируем configSlots из products — slug категории = slot
          const slots: Record<string, ConfigComponent[]> = {}
          for (const p of prods) {
            const slot = p.category?.slug || "other"
            if (!slots[slot]) slots[slot] = []
            slots[slot].push({ id: p.id, slot, name: p.name, brand: p.category?.name, price: p.price })
          }
          setConfigSlots(slots)
          return d
        }),
      ]).then(([b]) => {
        setBuilds(b)
        setLoading(false)
      }).catch(() => setLoading(false))
    } else if (tab === "articles" || tab === "add_article") {
      api.articles.getAll().then(d => { setArticles(d.articles || []); setLoading(false) })
    }
  }, [authed, tab])

  const login = () => {
    if (password === ADMIN_PASSWORD) { sessionStorage.setItem("begraphics_admin", "1"); setAuthed(true) }
    else alert("Неверный пароль")
  }
  const logout = () => { sessionStorage.removeItem("begraphics_admin"); setAuthed(false) }

  const updateStatus = async (id: number, status: string) => {
    await api.orders.updateStatus({ id, status })
    setOrders(o => o.map(ord => ord.id === id ? { ...ord, status } : ord))
  }

  const toggleStock = async (p: Product) => {
    await api.products.patch({ id: p.id, in_stock: !p.in_stock })
    setProducts(ps => ps.map(pp => pp.id === p.id ? { ...pp, in_stock: !pp.in_stock } : pp))
  }

  const submitProduct = async (e: React.FormEvent) => {
    e.preventDefault()
    let specs = {}
    try { specs = JSON.parse(productForm.specs || "{}") } catch { specs = {} }
    const payload = {
      id: productForm.id,
      category_id: productForm.category_id ? Number(productForm.category_id) : null,
      name: productForm.name, description: productForm.description,
      price: Number(productForm.price), old_price: productForm.old_price ? Number(productForm.old_price) : null,
      image_url: productForm.image_url || null, specs,
      in_stock: productForm.in_stock, is_featured: productForm.is_featured,
      sort_order: Number(productForm.sort_order),
    }
    if (productForm.id) await api.products.update(payload)
    else await api.products.create(payload)
    setTab("products")
    setProductForm({ id: null, category_id: "", name: "", description: "", price: "", old_price: "", image_url: "", specs: "", in_stock: true, is_featured: false, sort_order: "0" })
  }

  const editProduct = (p: Product) => {
    setProductForm({
      id: p.id,
      category_id: p.category ? String(categories.find(c => c.name === p.category?.name)?.id || "") : "",
      name: p.name, description: p.description || "",
      price: String(p.price), old_price: p.old_price ? String(p.old_price) : "",
      image_url: "", specs: JSON.stringify(p.specs || {}),
      in_stock: p.in_stock, is_featured: p.is_featured, sort_order: String(p.sort_order || 0),
    })
    setTab("add_product")
  }

  const submitBuild = async (e: React.FormEvent) => {
    e.preventDefault()
    const payload = {
      id: buildForm.id,
      name: buildForm.name, description: buildForm.description,
      image_urls: buildForm.image_urls,
      components: buildComponents,
      assembly_type: buildForm.assembly_type,
      assembly_fee: buildForm.assembly_type === "manual" ? parseFloat(buildForm.assembly_fee_manual) || 0 : 0,
      status: buildForm.status,
      is_featured: buildForm.is_featured,
      sort_order: 0,
    }
    if (buildForm.id) await api.builds.update(payload)
    else await api.builds.create(payload)
    setBuildForm({ id: null, name: "", description: "", status: "catalog", is_featured: false, assembly_type: "percent", assembly_fee_manual: "", image_urls: [] })
    setBuildComponents([])
    setTab("builds")
  }

  const editBuild = (b: PCBuild) => {
    setBuildForm({
      id: b.id, name: b.name, description: b.description || "",
      status: b.status, is_featured: b.is_featured,
      assembly_type: b.assembly_type as "percent" | "manual",
      assembly_fee_manual: b.assembly_type === "manual" ? String(b.assembly_fee) : "",
      image_urls: b.image_urls || [],
    })
    setBuildComponents(b.components.map((c: { slot: string; source: string; source_id?: number; name: string; price: number; current_price?: number; qty?: number }) => ({
      slot: c.slot, source: c.source as "catalog" | "custom",
      source_id: c.source_id, name: c.name, price: c.current_price ?? c.price, qty: c.qty || 1,
    })))
    setTab("add_build")
  }

  const addCatalogComponent = (slot: string, comp: ConfigComponent) => {
    setBuildComponents(cs => {
      if (cs.some(c => c.source_id === comp.id)) return cs
      return [...cs, { slot, source: "catalog", source_id: comp.id, name: comp.name, price: comp.price, qty: 1 }]
    })
  }

  const removeComponent = (sourceId: number) => {
    setBuildComponents(cs => cs.filter(c => c.source_id !== sourceId))
  }

  const setComponentQty = (sourceId: number, delta: number) => {
    setBuildComponents(cs => cs.map(c => {
      if (c.source_id !== sourceId) return c
      const next = Math.max(1, (c.qty || 1) + delta)
      return { ...c, qty: next }
    }))
  }

  const duplicateBuild = async (b: PCBuild) => {
    setDupeLoading(b.id)
    // Убедимся что токен есть — генерируем если нет
    let token = b.client_token
    if (!token) {
      const res = await api.builds.generateClientLink(b.id)
      token = res.client_token
      if (token) setBuilds(bs => bs.map(bb => bb.id === b.id ? { ...bb, client_token: token } : bb))
    }
    const payload = {
      name: b.name + " (вариант)",
      description: b.description,
      image_urls: b.image_urls || [],
      components: b.components,
      assembly_type: b.assembly_type,
      assembly_fee: b.assembly_fee,
      status: "draft",
      is_featured: false,
      sort_order: 0,
      client_token: token,
    }
    const created = await api.builds.create(payload)
    if (created?.id) {
      const newBuild: PCBuild = { ...b, id: created.id, name: payload.name, status: "draft", is_featured: false, client_token: token }
      setBuilds(bs => [...bs, newBuild])
      setExpandedVariants(b.id) // раскрыть варианты родительской сборки
    }
    setDupeLoading(null)
  }

  const deleteBuild = async (id: number) => {
    if (!confirm("Удалить сборку? Это действие нельзя отменить.")) return
    await api.builds.delete(id)
    setBuilds(bs => bs.filter(b => b.id !== id))
  }

  if (!authed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6" style={{ cursor: "auto" }}>
        <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold">B</div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">BeGraphics Admin</h1>
              <p className="text-xs text-foreground/40">Панель управления</p>
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs text-foreground/60">Пароль</label>
              <input
                type="password" value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === "Enter" && login()}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none"
                placeholder="Введите пароль" style={{ cursor: "text" }}
              />
            </div>
            <button onClick={login} className="w-full rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>
              Войти
            </button>
            <button onClick={() => navigate("/")} className="w-full text-center text-xs text-foreground/40 hover:text-foreground/60 transition-colors" style={{ cursor: "pointer" }}>
              ← На сайт
            </button>
          </div>
        </div>
      </div>
    )
  }

  const submitArticle = async (e: React.FormEvent) => {
    e.preventDefault()
    const payload = {
      id: articleForm.id,
      title: articleForm.title,
      slug: articleForm.slug,
      excerpt: articleForm.excerpt || null,
      content: articleForm.content,
      image_url: articleForm.image_url || null,
      category: articleForm.category,
      is_published: articleForm.is_published,
      html_attachment: articleForm.html_attachment || null,
    }
    if (articleForm.id) await api.articles.update(payload)
    else await api.articles.create(payload)
    setArticleForm({ id: null, title: "", slug: "", excerpt: "", content: "", image_url: "", category: "article", is_published: false, html_attachment: "" })
    setTab("articles")
  }

  const editArticle = (a: Article) => {
    setArticleForm({
      id: a.id, title: a.title, slug: a.slug,
      excerpt: a.excerpt || "", content: "",
      image_url: a.image_url || "", category: a.category, is_published: a.is_published,
      html_attachment: "",
    })
    api.articles.getById(a.id).then(full => {
      setArticleForm(f => ({ ...f, content: full.content || "", html_attachment: full.html_attachment || "" }))
    })
    setTab("add_article")
  }

  const deleteArticle = async (id: number) => {
    if (!confirm("Удалить статью?")) return
    await api.articles.delete(id)
    setArticles(as => as.filter(a => a.id !== id))
  }

  const tabs = [
    { key: "orders", label: "Заказы", icon: "ClipboardList" },
    { key: "products", label: "Товары", icon: "Package" },
    { key: "add_product", label: productForm.id ? "Ред. товар" : "Добавить товар", icon: "PlusCircle" },
    { key: "builds", label: "Наши ПК", icon: "Monitor" },
    { key: "archive", label: "Архив ПК", icon: "Archive" },
    { key: "add_build", label: buildForm.id ? "Ред. сборку" : "Новая сборка", icon: "Wrench" },
    { key: "articles", label: "Статьи", icon: "BookOpen" },
    { key: "add_article", label: articleForm.id ? "Ред. статью" : "Новая статья", icon: "FilePlus" },
  ]

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ cursor: "auto" }}>
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold">B</div>
            <span className="font-semibold text-foreground">BeGraphics Admin</span>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/shop")} className="text-xs text-foreground/40 hover:text-foreground/70 transition-colors" style={{ cursor: "pointer" }}>На сайт</button>
            <button onClick={logout} className="flex items-center gap-1.5 text-xs text-foreground/40 hover:text-foreground/70 transition-colors" style={{ cursor: "pointer" }}>
              <Icon name="LogOut" size={14} />Выйти
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key as typeof tab)}
              className={`flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${tab === t.key ? "border-primary text-primary" : "border-transparent text-foreground/60 hover:text-foreground"}`}
              style={{ cursor: "pointer" }}
            >
              <Icon name={t.icon as "Package"} size={15} />
              {t.label}
            </button>
          ))}
        </div>

        {/* ORDERS */}
        {tab === "orders" && (
          <div>
            <h2 className="mb-4 text-xl font-light text-foreground">Заказы ({orders.length})</h2>
            {loading ? <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-24 rounded-xl bg-card animate-pulse" />)}</div>
              : orders.length === 0 ? (
                <div className="py-16 text-center text-foreground/40">
                  <Icon name="ClipboardList" size={40} className="mx-auto mb-3 opacity-30" />
                  <p>Заказов пока нет</p>
                </div>
              ) : orders.map(order => (
                <div key={order.id} className="mb-3 rounded-xl border border-border bg-card p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-3 mb-1">
                        <span className="font-mono text-xs text-foreground/40">#{order.id}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${(STATUS_LABELS[order.status] || STATUS_LABELS.new).color}`}>{(STATUS_LABELS[order.status] || STATUS_LABELS.new).label}</span>
                        <span className="text-xs text-foreground/40">{new Date(order.created_at).toLocaleDateString("ru-RU")}</span>
                      </div>
                      <p className="text-sm font-medium text-foreground">{order.customer_name}</p>
                      <p className="text-xs text-foreground/60">{order.customer_phone}{order.customer_email && ` · ${order.customer_email}`}</p>
                      {order.comment && <p className="mt-1 text-xs text-foreground/40 italic">"{order.comment}"</p>}
                      <div className="mt-2 space-y-0.5">
                        {(order.items || []).map((item, i) => (
                          <p key={i} className="text-xs text-foreground/50">· {item.name} × {item.quantity} — {fmt(item.price * item.quantity)}</p>
                        ))}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="mb-2 text-lg font-bold text-foreground">{fmt(order.total)}</p>
                      <select
                        value={order.status}
                        onChange={e => updateStatus(order.id, e.target.value)}
                        className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                        style={{ cursor: "pointer" }}
                      >
                        {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        )}

        {/* PRODUCTS LIST */}
        {tab === "products" && (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-light text-foreground">Товары ({products.length})</h2>
              <button onClick={() => setTab("add_product")} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>
                <Icon name="Plus" size={16} />Добавить
              </button>
            </div>
            {loading ? <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-14 rounded-lg bg-card animate-pulse" />)}</div>
              : (
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        {["Товар", "Категория", "Цена", "В наличии", ""].map(h => (
                          <th key={h} className="px-4 py-3 text-left text-xs font-medium text-foreground/60">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {products.map((p, i) => (
                        <tr key={p.id} className={`border-b border-border/50 hover:bg-muted/30 transition-colors ${i % 2 === 0 ? "" : "bg-muted/10"}`}>
                          <td className="px-4 py-3">
                            <p className="font-medium text-foreground">{p.name}</p>
                            {p.is_featured && <span className="text-xs text-accent">★ Рекомендуем</span>}
                          </td>
                          <td className="px-4 py-3 text-foreground/60 text-xs">{p.category?.name || "—"}</td>
                          <td className="px-4 py-3 text-right">
                            <p className="font-bold text-foreground">{fmt(p.price)}</p>
                            {p.old_price && <p className="text-xs text-foreground/40 line-through">{fmt(p.old_price)}</p>}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={() => toggleStock(p)}
                              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${p.in_stock ? "bg-green-400/10 text-green-400 hover:bg-red-400/10 hover:text-red-400" : "bg-red-400/10 text-red-400 hover:bg-green-400/10 hover:text-green-400"}`}
                              style={{ cursor: "pointer" }}
                            >
                              {p.in_stock ? "Есть" : "Нет"}
                            </button>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button onClick={() => editProduct(p)} className="text-foreground/40 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
                              <Icon name="Pencil" size={15} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </div>
        )}

        {/* ADD/EDIT PRODUCT */}
        {tab === "add_product" && (
          <div className="max-w-2xl">
            <h2 className="mb-6 text-xl font-light text-foreground">{productForm.id ? "Редактировать товар" : "Добавить товар"}</h2>
            <form onSubmit={submitProduct} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-foreground/60">Название *</label>
                  <input required value={productForm.name} onChange={e => setProductForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none" placeholder="NVIDIA RTX 4090" style={{ cursor: "text" }} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-foreground/60">Категория</label>
                  <select value={productForm.category_id} onChange={e => setProductForm(f => ({ ...f, category_id: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "pointer" }}>
                    <option value="">Без категории</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-foreground/60">Описание</label>
                <textarea rows={3} value={productForm.description} onChange={e => setProductForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none resize-none" placeholder="Описание..." style={{ cursor: "text" }} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-foreground/60">Цена * (₽)</label>
                  <input required type="number" value={productForm.price} onChange={e => setProductForm(f => ({ ...f, price: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none" placeholder="89990" style={{ cursor: "text" }} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-foreground/60">Старая цена (₽)</label>
                  <input type="number" value={productForm.old_price} onChange={e => setProductForm(f => ({ ...f, old_price: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none" placeholder="99990" style={{ cursor: "text" }} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-foreground/60">URL изображения</label>
                <input type="url" value={productForm.image_url} onChange={e => setProductForm(f => ({ ...f, image_url: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none" placeholder="https://..." style={{ cursor: "text" }} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-foreground/60">Характеристики (JSON)</label>
                <textarea rows={2} value={productForm.specs} onChange={e => setProductForm(f => ({ ...f, specs: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2.5 font-mono text-xs text-foreground focus:border-primary focus:outline-none resize-none" placeholder='{"vram":"16GB"}' style={{ cursor: "text" }} />
              </div>
              <div className="flex flex-wrap gap-6">
                <label className="flex items-center gap-2 text-sm text-foreground/70" style={{ cursor: "pointer" }}>
                  <input type="checkbox" checked={productForm.in_stock} onChange={e => setProductForm(f => ({ ...f, in_stock: e.target.checked }))} className="rounded" />В наличии
                </label>
                <label className="flex items-center gap-2 text-sm text-foreground/70" style={{ cursor: "pointer" }}>
                  <input type="checkbox" checked={productForm.is_featured} onChange={e => setProductForm(f => ({ ...f, is_featured: e.target.checked }))} className="rounded" />Рекомендуем
                </label>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" className="rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>
                  {productForm.id ? "Сохранить" : "Добавить"}
                </button>
                <button type="button" onClick={() => { setTab("products"); setProductForm({ id: null, category_id: "", name: "", description: "", price: "", old_price: "", image_url: "", specs: "", in_stock: true, is_featured: false, sort_order: "0" }) }}
                  className="rounded-lg border border-border px-6 py-2.5 text-sm text-foreground/70 hover:border-primary hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
                  Отмена
                </button>
              </div>
            </form>
          </div>
        )}

        {/* BUILDS LIST + ARCHIVE */}
        {(tab === "builds" || tab === "archive") && (() => {
          const isArchive = tab === "archive"
          const filtered = builds.filter(b => isArchive ? b.status === "archive" : b.status !== "archive")

          // Группируем: главные (без токена или уникальный токен) + их варианты
          const tokenMap = new Map<string, PCBuild[]>()
          const standalone: PCBuild[] = []
          for (const b of filtered) {
            if (b.client_token) {
              if (!tokenMap.has(b.client_token)) tokenMap.set(b.client_token, [])
              tokenMap.get(b.client_token)!.push(b)
            } else {
              standalone.push(b)
            }
          }
          // Группы по токену — первый в группе считается «главным»
          const groups: { main: PCBuild; variants: PCBuild[] }[] = []
          tokenMap.forEach(list => {
            const sorted = [...list].sort((a, b) => a.id - b.id)
            groups.push({ main: sorted[0], variants: sorted.slice(1) })
          })
          standalone.forEach(b => groups.push({ main: b, variants: [] }))
          groups.sort((a, b) => b.main.id - a.main.id)

          const renderBuildRow = (b: PCBuild, isVariant = false) => (
            <div key={b.id} className={`rounded-xl border bg-card p-4 ${isVariant ? "ml-6 border-dashed border-border/50 bg-card/50" : "border-border"}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {isVariant && <Icon name="CornerDownRight" size={13} className="text-muted-foreground shrink-0" />}
                    <p className="font-medium text-foreground text-sm">{b.name}</p>
                    <span className={`rounded-full px-2 py-0.5 text-xs shrink-0 ${b.status === "catalog" ? "bg-green-400/10 text-green-400" : b.status === "archive" ? "bg-muted text-foreground/30" : "bg-muted text-foreground/50"}`}>
                      {BUILD_STATUS[b.status] || b.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-foreground/50">
                    <span>{b.components?.length || 0} комп.</span>
                    <span>Итого: <span className="font-semibold text-foreground/80">{fmt(b.total_price)}</span></span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 shrink-0">
                  <button onClick={() => editBuild(b)} className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground/60 hover:border-primary hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
                    <Icon name="Pencil" size={12} />Ред.
                  </button>
                  {!isVariant && !isArchive && (
                    <button onClick={() => duplicateBuild(b)} disabled={dupeLoading === b.id}
                      className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground/60 hover:border-primary hover:text-foreground transition-colors disabled:opacity-50"
                      style={{ cursor: "pointer" }}>
                      <Icon name={dupeLoading === b.id ? "Loader2" : "GitBranch"} size={12} />Вариант
                    </button>
                  )}
                  {!isArchive && (
                    <button onClick={() => generateClientLink(b)}
                      className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${b.client_token ? "border-primary/30 bg-primary/5 text-primary hover:bg-primary/10" : "border-border text-foreground/60 hover:border-primary hover:text-foreground"}`}
                      style={{ cursor: "pointer" }}>
                      <Icon name={copiedBuildId === b.id ? "Check" : "Link"} size={12} />
                      {copiedBuildId === b.id ? "Скопировано!" : b.client_token ? "Ссылка" : "Создать ссылку"}
                    </button>
                  )}
                  <select value={b.status}
                    onChange={async e => { await api.builds.patch({ id: b.id, status: e.target.value }); setBuilds(bs => bs.map(bb => bb.id === b.id ? { ...bb, status: e.target.value } : bb)) }}
                    className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none" style={{ cursor: "pointer" }}>
                    {Object.entries(BUILD_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <button onClick={() => deleteBuild(b.id)}
                    className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground/40 hover:border-red-400 hover:text-red-400 transition-colors"
                    style={{ cursor: "pointer" }}>
                    <Icon name="Trash2" size={12} />
                  </button>
                </div>
              </div>
            </div>
          )

          return (
            <div>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-light text-foreground">
                  {isArchive ? "Архив ПК" : "Наши ПК"} <span className="text-sm text-foreground/40 ml-1">({filtered.length})</span>
                </h2>
                {!isArchive && (
                  <button onClick={() => { setBuildForm({ id: null, name: "", description: "", status: "catalog", is_featured: false, assembly_type: "percent", assembly_fee_manual: "", image_urls: [] }); setBuildComponents([]); setTab("add_build") }}
                    className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>
                    <Icon name="Plus" size={16} />Новая сборка
                  </button>
                )}
              </div>
              {loading
                ? <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-20 rounded-xl bg-card animate-pulse" />)}</div>
                : groups.length === 0
                  ? <div className="py-16 text-center text-foreground/40"><Icon name="Monitor" size={40} className="mx-auto mb-3 opacity-30" /><p>{isArchive ? "Архив пуст" : "Сборок нет. Создайте первую!"}</p></div>
                  : <div className="space-y-3">
                    {groups.map(({ main, variants }) => (
                      <div key={main.id}>
                        {renderBuildRow(main)}
                        {/* Варианты — выпадающий список */}
                        {variants.length > 0 && (
                          <div className="mt-1 ml-6">
                            <button
                              onClick={() => setExpandedVariants(expandedVariants === main.id ? null : main.id)}
                              className="flex items-center gap-1.5 text-xs text-foreground/40 hover:text-foreground/70 transition-colors mb-1.5"
                              style={{ cursor: "pointer" }}>
                              <Icon name={expandedVariants === main.id ? "ChevronUp" : "ChevronDown"} size={12} />
                              {variants.length} {variants.length === 1 ? "вариант" : "варианта"}
                            </button>
                            {expandedVariants === main.id && (
                              <div className="space-y-1.5">
                                {variants.map(v => renderBuildRow(v, true))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
              }
            </div>
          )
        })()}

        {/* ADD/EDIT BUILD */}
        {tab === "add_build" && (
          <div className="max-w-3xl">
            <h2 className="mb-6 text-xl font-light text-foreground">{buildForm.id ? "Редактировать сборку" : "Новая сборка"}</h2>
            <form onSubmit={submitBuild} className="space-y-6">
              {/* Basic info */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-foreground/60">Название сборки *</label>
                  <input required value={buildForm.name} onChange={e => setBuildForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none" placeholder="UltraGame Pro" style={{ cursor: "text" }} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-foreground/60">Статус</label>
                  <select value={buildForm.status} onChange={e => setBuildForm(f => ({ ...f, status: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "pointer" }}>
                    {Object.entries(BUILD_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-foreground/60">Описание</label>
                <textarea rows={2} value={buildForm.description} onChange={e => setBuildForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none resize-none" style={{ cursor: "text" }} />
              </div>
              <div>
                <label className="mb-2 block text-xs text-foreground/60">Фотографии сборки</label>
                <ImageUploader
                  images={buildForm.image_urls}
                  onChange={urls => setBuildForm(f => ({ ...f, image_urls: urls }))}
                  folder="builds"
                />
              </div>

              {/* Components constructor */}
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-medium text-foreground">Состав сборки</h3>
                  <p className="text-xs text-foreground/40">Выбирайте товары из каталога по категориям</p>
                </div>

                {/* Уже добавленные компоненты */}
                {buildComponents.length > 0 && (
                  <div className="mb-3 space-y-1.5 rounded-xl border border-primary/20 bg-primary/5 p-4">
                    <p className="mb-2 text-xs font-medium text-foreground/60">Позиций: {buildComponents.length} · Итого железо: {fmt(partsTotal)}</p>
                    {buildComponents.map((c, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <span className="w-28 shrink-0 text-xs text-foreground/50 font-mono truncate">{c.slot}</span>
                        <span className="flex-1 text-foreground font-medium truncate">{c.name}</span>
                        {/* qty controls */}
                        <div className="flex items-center gap-1 shrink-0">
                          <button type="button" onClick={() => setComponentQty(c.source_id ?? 0, -1)}
                            className="h-5 w-5 rounded border border-border text-foreground/50 hover:border-primary hover:text-primary transition-colors flex items-center justify-center"
                            style={{ cursor: "pointer" }}>
                            <Icon name="Minus" size={10} />
                          </button>
                          <span className="w-5 text-center text-xs font-bold text-foreground">{c.qty || 1}</span>
                          <button type="button" onClick={() => setComponentQty(c.source_id ?? 0, 1)}
                            className="h-5 w-5 rounded border border-border text-foreground/50 hover:border-primary hover:text-primary transition-colors flex items-center justify-center"
                            style={{ cursor: "pointer" }}>
                            <Icon name="Plus" size={10} />
                          </button>
                        </div>
                        <span className="shrink-0 font-bold text-primary text-xs w-20 text-right">{fmt(c.price * (c.qty || 1))}</span>
                        <button type="button" onClick={() => removeComponent(c.source_id ?? 0)} className="text-foreground/30 hover:text-red-400 transition-colors" style={{ cursor: "pointer" }}>
                          <Icon name="X" size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Выбор из каталога по категориям */}
                <div className="space-y-2">
                  {categories.length === 0 ? (
                    <p className="text-xs text-foreground/40 text-center py-4">Загрузка категорий...</p>
                  ) : categories.map(cat => {
                    const slotOptions = configSlots[cat.slug] || []
                    const isOpen = addingSlot === cat.slug
                    const addedFromCat = buildComponents.filter(c => c.slot === cat.slug || slotOptions.some(o => o.id === c.source_id))
                    return (
                      <div key={cat.slug} className={`rounded-xl border bg-card transition-all ${addedFromCat.length > 0 ? "border-primary/30" : "border-border"}`}>
                        <button
                          type="button"
                          onClick={() => setAddingSlot(isOpen ? null : cat.slug)}
                          className="flex w-full items-center gap-3 p-4 text-left"
                          style={{ cursor: "pointer" }}
                        >
                          <span className="flex-1 text-sm font-medium text-foreground">{cat.name}</span>
                          {addedFromCat.length > 0 && (
                            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{addedFromCat.length} выбрано</span>
                          )}
                          {slotOptions.length === 0
                            ? <span className="text-xs text-foreground/30">Нет товаров</span>
                            : <Icon name={isOpen ? "ChevronUp" : "ChevronDown"} size={15} className="text-foreground/40" />
                          }
                        </button>
                        {isOpen && slotOptions.length > 0 && (
                          <div className="grid gap-1.5 grid-cols-1 sm:grid-cols-2 border-t border-border p-3">
                            {slotOptions.map(opt => {
                              const isAdded = buildComponents.some(c => c.source_id === opt.id)
                              return (
                                <button
                                  key={opt.id}
                                  type="button"
                                  onClick={() => isAdded ? removeComponent(opt.id) : addCatalogComponent(cat.slug, opt)}
                                  className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors ${isAdded ? "border-primary bg-primary/10" : "border-border hover:border-primary"}`}
                                  style={{ cursor: "pointer" }}
                                >
                                  <div className="min-w-0 mr-2">
                                    <p className="text-xs font-medium text-foreground truncate">{opt.name}</p>
                                  </div>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <p className="text-xs font-bold text-accent">{fmt(opt.price)}</p>
                                    {isAdded && <Icon name="Check" size={12} className="text-primary" />}
                                  </div>
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Pricing */}
              <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="mb-4 text-sm font-medium text-foreground">Стоимость сборки</h3>
                <div className="mb-4 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-foreground/60">Железо:</span>
                    <span className="font-bold text-foreground">{fmt(partsTotal)}</span>
                  </div>
                </div>
                <div className="mb-4">
                  <label className="mb-2 block text-xs text-foreground/60">Стоимость сборки</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setBuildForm(f => ({ ...f, assembly_type: "percent" }))}
                      className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-colors ${buildForm.assembly_type === "percent" ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60 hover:border-primary"}`}
                      style={{ cursor: "pointer" }}
                    >
                      7% автоматически ({fmt(Math.round(partsTotal * 0.07))})
                    </button>
                    <button
                      type="button"
                      onClick={() => setBuildForm(f => ({ ...f, assembly_type: "manual" }))}
                      className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-colors ${buildForm.assembly_type === "manual" ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60 hover:border-primary"}`}
                      style={{ cursor: "pointer" }}
                    >
                      Ввести вручную
                    </button>
                  </div>
                  {buildForm.assembly_type === "manual" && (
                    <input
                      type="number"
                      value={buildForm.assembly_fee_manual}
                      onChange={e => setBuildForm(f => ({ ...f, assembly_fee_manual: e.target.value }))}
                      className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                      placeholder="Сумма за сборку (₽)"
                      style={{ cursor: "text" }}
                    />
                  )}
                </div>
                <div className="flex items-center justify-between border-t border-border pt-3">
                  <span className="text-sm font-medium text-foreground">Итого:</span>
                  <span className="text-2xl font-bold text-foreground">{fmt(buildTotal)}</span>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-foreground/70" style={{ cursor: "pointer" }}>
                  <input type="checkbox" checked={buildForm.is_featured} onChange={e => setBuildForm(f => ({ ...f, is_featured: e.target.checked }))} className="rounded" />
                  Рекомендуемая сборка
                </label>
              </div>

              <div className="flex gap-3">
                <button type="submit" className="rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>
                  {buildForm.id ? "Сохранить" : "Опубликовать сборку"}
                </button>
                <button type="button" onClick={() => setTab("builds")}
                  className="rounded-lg border border-border px-6 py-2.5 text-sm text-foreground/70 hover:border-primary hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
                  Отмена
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ── ARTICLES LIST ── */}
        {tab === "articles" && (
          <div>
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">Статьи и тесты</h2>
              <button onClick={() => { setArticleForm({ id: null, title: "", slug: "", excerpt: "", content: "", image_url: "", category: "article", is_published: false, html_attachment: "" }); setTab("add_article") }}
                className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>
                <Icon name="Plus" size={15} />Новая статья
              </button>
            </div>
            {loading ? (
              <p className="text-sm text-foreground/40">Загрузка...</p>
            ) : articles.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border py-12 text-center">
                <Icon name="BookOpen" size={32} className="mx-auto mb-3 text-foreground/20" />
                <p className="text-sm text-foreground/40">Статей пока нет. Создайте первую!</p>
              </div>
            ) : (
              <div className="space-y-2">
                {articles.map(a => (
                  <div key={a.id} className="flex items-center gap-4 rounded-xl border border-border bg-card p-4 hover:border-primary/40 transition-colors">
                    {a.image_url && (
                      <img src={a.image_url} alt={a.title} className="h-14 w-20 rounded-lg object-cover shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${a.is_published ? "bg-green-400/10 text-green-400" : "bg-muted text-foreground/40"}`}>
                          {a.is_published ? "Опубликована" : "Черновик"}
                        </span>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground/50">
                          {a.category === "review" ? "Обзор" : a.category === "test" ? "Тест" : "Статья"}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-foreground truncate">{a.title}</p>
                      <p className="text-xs text-foreground/40">{new Date(a.created_at).toLocaleDateString("ru-RU")} · {a.views} просмотров</p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => editArticle(a)} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:border-primary transition-colors" style={{ cursor: "pointer" }}>
                        Редакт.
                      </button>
                      <button onClick={() => deleteArticle(a.id)} className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/50 hover:border-red-400 hover:text-red-400 transition-colors" style={{ cursor: "pointer" }}>
                        <Icon name="Trash2" size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── ADD / EDIT ARTICLE ── */}
        {tab === "add_article" && (
          <div>
            <h2 className="mb-5 text-lg font-semibold text-foreground">{articleForm.id ? "Редактировать статью" : "Новая статья"}</h2>
            <form onSubmit={submitArticle} className="space-y-4 max-w-3xl">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-foreground/60">Заголовок *</label>
                  <input required value={articleForm.title}
                    onChange={e => setArticleForm(f => ({ ...f, title: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "text" }} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-foreground/60">Slug (URL)</label>
                  <input value={articleForm.slug}
                    onChange={e => setArticleForm(f => ({ ...f, slug: e.target.value }))}
                    placeholder="auto-generated"
                    className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "text" }} />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-foreground/60">Категория</label>
                  <select value={articleForm.category}
                    onChange={e => setArticleForm(f => ({ ...f, category: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "pointer" }}>
                    <option value="article">Статья</option>
                    <option value="review">Обзор</option>
                    <option value="test">Тест / Бенчмарк</option>
                    <option value="guide">Гайд</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-foreground/60">URL изображения</label>
                  <input value={articleForm.image_url}
                    onChange={e => setArticleForm(f => ({ ...f, image_url: e.target.value }))}
                    placeholder="https://..."
                    className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "text" }} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-foreground/60">Краткое описание (превью)</label>
                <textarea rows={2} value={articleForm.excerpt}
                  onChange={e => setArticleForm(f => ({ ...f, excerpt: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none resize-none" style={{ cursor: "text" }} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-foreground/60">Текст статьи *</label>
                <textarea required rows={16} value={articleForm.content}
                  onChange={e => setArticleForm(f => ({ ...f, content: e.target.value }))}
                  placeholder="Поддерживается Markdown: **жирный**, *курсив*, ## Заголовок, - список"
                  className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none resize-y font-mono" style={{ cursor: "text" }} />
              </div>

              {/* HTML-вложение */}
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-xs text-foreground/60">HTML-вложение <span className="text-foreground/30">(опционально — для результатов тестов, бенчмарков)</span></label>
                  {articleForm.html_attachment && (
                    <button type="button" onClick={() => setArticleForm(f => ({ ...f, html_attachment: "" }))}
                      className="text-xs text-foreground/40 hover:text-red-400 transition-colors flex items-center gap-1" style={{ cursor: "pointer" }}>
                      <Icon name="X" size={11} /> Очистить
                    </button>
                  )}
                </div>
                <div className="relative">
                  <textarea rows={8} value={articleForm.html_attachment}
                    onChange={e => setArticleForm(f => ({ ...f, html_attachment: e.target.value }))}
                    placeholder="<!DOCTYPE html>&#10;<html>&#10;  <body>&#10;    <!-- Вставьте HTML-код результатов теста -->&#10;  </body>&#10;</html>"
                    className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-xs text-foreground focus:border-primary focus:outline-none resize-y font-mono" style={{ cursor: "text" }} />
                  <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
                    {articleForm.html_attachment && (
                      <span className="rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">
                        {articleForm.html_attachment.length.toLocaleString()} симв.
                      </span>
                    )}
                    <label className="flex cursor-pointer items-center gap-1 rounded border border-border bg-card px-2 py-1 text-xs text-foreground/50 hover:border-primary hover:text-foreground transition-colors">
                      <Icon name="Upload" size={11} />
                      .html
                      <input type="file" accept=".html,.htm" className="hidden"
                        onChange={e => {
                          const file = e.target.files?.[0]
                          if (!file) return
                          const reader = new FileReader()
                          reader.onload = ev => setArticleForm(f => ({ ...f, html_attachment: ev.target?.result as string || "" }))
                          reader.readAsText(file)
                          e.target.value = ""
                        }} />
                    </label>
                  </div>
                </div>
                {articleForm.html_attachment && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-foreground/40 hover:text-foreground/60 select-none">Предпросмотр</summary>
                    <div className="mt-2 rounded-lg border border-border overflow-hidden" style={{ height: 320 }}>
                      <iframe
                        srcDoc={articleForm.html_attachment}
                        sandbox="allow-scripts"
                        className="w-full h-full border-0 bg-white"
                        title="HTML preview"
                      />
                    </div>
                  </details>
                )}
              </div>

              <div className="flex items-center gap-3">
                <input type="checkbox" id="is_published" checked={articleForm.is_published}
                  onChange={e => setArticleForm(f => ({ ...f, is_published: e.target.checked }))}
                  className="h-4 w-4 rounded border-border accent-primary" style={{ cursor: "pointer" }} />
                <label htmlFor="is_published" className="text-sm text-foreground/70" style={{ cursor: "pointer" }}>
                  Опубликовать (показывать на сайте)
                </label>
              </div>
              <div className="flex gap-3">
                <button type="submit" className="rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>
                  {articleForm.id ? "Сохранить" : "Создать статью"}
                </button>
                <button type="button" onClick={() => setTab("articles")}
                  className="rounded-lg border border-border px-6 py-2.5 text-sm text-foreground/70 hover:border-primary hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
                  Отмена
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}