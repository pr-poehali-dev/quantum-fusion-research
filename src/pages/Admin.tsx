import { useState, useEffect } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { useNavigate } from "react-router-dom"

const ADMIN_PASSWORD = "pcpro2024"

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  new: { label: "Новый", color: "text-primary bg-primary/10" },
  processing: { label: "В работе", color: "text-accent bg-accent/10" },
  done: { label: "Выполнен", color: "text-green-400 bg-green-400/10" },
  cancelled: { label: "Отменён", color: "text-foreground/50 bg-muted" },
}

const BUILD_STATUS: Record<string, string> = {
  catalog: "На сайте",
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
  components: Array<{ slot: string; name: string; price: number; source: string; source_id?: number; current_price?: number }>
  parts_total: number
  assembly_type: string
  assembly_fee: number
  total_price: number
  status: string
  is_featured: boolean
}

export default function Admin() {
  const navigate = useNavigate()
  const [authed, setAuthed] = useState(() => sessionStorage.getItem("pcpro_admin") === "1")
  const [password, setPassword] = useState("")
  const [tab, setTab] = useState<"orders" | "products" | "add_product" | "builds" | "add_build">("orders")

  const [orders, setOrders] = useState<Order[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [configSlots, setConfigSlots] = useState<Record<string, ConfigComponent[]>>({})
  const [builds, setBuilds] = useState<PCBuild[]>([])
  const [loading, setLoading] = useState(false)

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
    image_urls: "",
  })
  const [buildComponents, setBuildComponents] = useState<Array<{
    slot: string; source: "catalog" | "custom"; source_id?: number; name: string; price: number
  }>>([])
  const [addingSlot, setAddingSlot] = useState<string | null>(null)

  const fmt = (n: number) => n.toLocaleString("ru-RU") + " ₽"
  const partsTotal = buildComponents.reduce((s, c) => s + c.price, 0)
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
    } else if (tab === "builds" || tab === "add_build") {
      Promise.all([
        api.builds.getAll().then(d => d.builds || []),
        api.products.getAll().then(d => { setProducts(d.products || []); return d }),
        api.configurator.getSlots().then(d => d.slots || {}),
      ]).then(([b, , cs]) => {
        setBuilds(b)
        setConfigSlots(cs)
        setLoading(false)
      })
    }
  }, [authed, tab])

  const login = () => {
    if (password === ADMIN_PASSWORD) { sessionStorage.setItem("pcpro_admin", "1"); setAuthed(true) }
    else alert("Неверный пароль")
  }
  const logout = () => { sessionStorage.removeItem("pcpro_admin"); setAuthed(false) }

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
      image_urls: buildForm.image_urls ? buildForm.image_urls.split("\n").filter(Boolean) : [],
      components: buildComponents,
      assembly_type: buildForm.assembly_type,
      assembly_fee: buildForm.assembly_type === "manual" ? parseFloat(buildForm.assembly_fee_manual) || 0 : 0,
      status: buildForm.status,
      is_featured: buildForm.is_featured,
      sort_order: 0,
    }
    if (buildForm.id) await api.builds.update(payload)
    else await api.builds.create(payload)
    setBuildForm({ id: null, name: "", description: "", status: "catalog", is_featured: false, assembly_type: "percent", assembly_fee_manual: "", image_urls: "" })
    setBuildComponents([])
    setTab("builds")
  }

  const editBuild = (b: PCBuild) => {
    setBuildForm({
      id: b.id, name: b.name, description: b.description || "",
      status: b.status, is_featured: b.is_featured,
      assembly_type: b.assembly_type as "percent" | "manual",
      assembly_fee_manual: b.assembly_type === "manual" ? String(b.assembly_fee) : "",
      image_urls: "",
    })
    setBuildComponents(b.components.map(c => ({
      slot: c.slot, source: c.source as "catalog" | "custom",
      source_id: c.source_id, name: c.name, price: c.current_price ?? c.price,
    })))
    setTab("add_build")
  }

  const addCatalogComponent = (slot: string, comp: ConfigComponent) => {
    setBuildComponents(cs => {
      const filtered = cs.filter(c => c.slot !== slot)
      return [...filtered, { slot, source: "catalog", source_id: comp.id, name: comp.name, price: comp.price }]
    })
    setAddingSlot(null)
  }

  const removeComponent = (slot: string) => {
    setBuildComponents(cs => cs.filter(c => c.slot !== slot))
  }

  if (!authed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6" style={{ cursor: "auto" }}>
        <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold">P</div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">PCPRO Admin</h1>
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

  const tabs = [
    { key: "orders", label: "Заказы", icon: "ClipboardList" },
    { key: "products", label: "Товары", icon: "Package" },
    { key: "add_product", label: productForm.id ? "Ред. товар" : "Добавить товар", icon: "PlusCircle" },
    { key: "builds", label: "Наши ПК", icon: "Monitor" },
    { key: "add_build", label: buildForm.id ? "Ред. сборку" : "Новая сборка", icon: "Wrench" },
  ]

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ cursor: "auto" }}>
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold">P</div>
            <span className="font-semibold text-foreground">Админ панель</span>
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

        {/* BUILDS LIST */}
        {tab === "builds" && (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-light text-foreground">Наши ПК ({builds.length})</h2>
              <button onClick={() => { setBuildForm({ id: null, name: "", description: "", status: "catalog", is_featured: false, assembly_type: "percent", assembly_fee_manual: "", image_urls: "" }); setBuildComponents([]); setTab("add_build") }}
                className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>
                <Icon name="Plus" size={16} />Новая сборка
              </button>
            </div>
            {loading ? <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-24 rounded-xl bg-card animate-pulse" />)}</div>
              : builds.length === 0 ? (
                <div className="py-16 text-center text-foreground/40">
                  <Icon name="Monitor" size={40} className="mx-auto mb-3 opacity-30" />
                  <p>Сборок нет. Создайте первую!</p>
                </div>
              ) : builds.map(b => (
                <div key={b.id} className="mb-3 rounded-xl border border-border bg-card p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-medium text-foreground">{b.name}</p>
                        <span className={`rounded-full px-2 py-0.5 text-xs ${b.status === "catalog" ? "bg-green-400/10 text-green-400" : "bg-muted text-foreground/50"}`}>
                          {BUILD_STATUS[b.status] || b.status}
                        </span>
                      </div>
                      <p className="text-xs text-foreground/50 mb-2">{b.components?.length || 0} компонентов</p>
                      <div className="flex items-center gap-4 text-xs text-foreground/60">
                        <span>Железо: {fmt(b.parts_total)}</span>
                        <span>Сборка: {fmt(b.assembly_fee)}</span>
                        <span className="font-bold text-foreground">Итого: {fmt(b.total_price)}</span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => editBuild(b)} className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/60 hover:border-primary hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
                        <Icon name="Pencil" size={13} />Изменить
                      </button>
                      <select
                        value={b.status}
                        onChange={async e => { await api.builds.patch({ id: b.id, status: e.target.value }); setBuilds(bs => bs.map(bb => bb.id === b.id ? { ...bb, status: e.target.value } : bb)) }}
                        className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none" style={{ cursor: "pointer" }}
                      >
                        {Object.entries(BUILD_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        )}

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
                <label className="mb-1 block text-xs text-foreground/60">URL фотографий (по одной на строку)</label>
                <textarea rows={2} value={buildForm.image_urls} onChange={e => setBuildForm(f => ({ ...f, image_urls: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none resize-none" placeholder="https://..." style={{ cursor: "text" }} />
              </div>

              {/* Components constructor */}
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-medium text-foreground">Состав сборки</h3>
                  <p className="text-xs text-foreground/40">Выбирайте из каталога — цены будут обновляться автоматически</p>
                </div>
                <div className="space-y-2">
                  {Object.entries(SLOT_LABELS).map(([slot, label]) => {
                    const existing = buildComponents.find(c => c.slot === slot)
                    const slotOptions = configSlots[slot] || []
                    const isOpen = addingSlot === slot
                    return (
                      <div key={slot} className={`rounded-xl border bg-card p-4 transition-all ${existing ? "border-primary/30" : "border-border"}`}>
                        <div className="flex items-center gap-3">
                          <span className="w-28 shrink-0 text-xs text-foreground/50 font-mono">{label}</span>
                          {existing ? (
                            <>
                              <span className="flex-1 text-sm text-foreground font-medium truncate">{existing.name}</span>
                              <span className="shrink-0 text-sm font-bold text-primary">{fmt(existing.price)}</span>
                              <button onClick={() => removeComponent(slot)} className="ml-2 text-foreground/30 hover:text-foreground/60" style={{ cursor: "pointer" }}>
                                <Icon name="X" size={14} />
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setAddingSlot(isOpen ? null : slot)}
                              className="flex items-center gap-1.5 text-xs text-foreground/50 hover:text-primary transition-colors"
                              style={{ cursor: "pointer" }}
                            >
                              <Icon name="Plus" size={13} />Выбрать из каталога
                            </button>
                          )}
                        </div>
                        {isOpen && slotOptions.length > 0 && (
                          <div className="mt-3 grid gap-1.5 grid-cols-1 sm:grid-cols-2 border-t border-border pt-3">
                            {slotOptions.map(opt => (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => addCatalogComponent(slot, opt)}
                                className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-left hover:border-primary transition-colors"
                                style={{ cursor: "pointer" }}
                              >
                                <div className="min-w-0 mr-2">
                                  <p className="text-xs font-medium text-foreground truncate">{opt.name}</p>
                                  {opt.brand && <p className="text-xs text-foreground/40">{opt.brand}</p>}
                                </div>
                                <p className="shrink-0 text-xs font-bold text-accent">{fmt(opt.price)}</p>
                              </button>
                            ))}
                          </div>
                        )}
                        {isOpen && slotOptions.length === 0 && (
                          <p className="mt-2 text-xs text-foreground/40">Нет компонентов в этом слоте. Добавьте их в разделе "Товары".</p>
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
      </div>
    </div>
  )
}
