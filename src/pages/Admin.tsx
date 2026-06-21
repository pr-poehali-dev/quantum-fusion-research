import { useState, useEffect } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { useNavigate, useParams } from "react-router-dom"
import WarehouseTab from "@/components/admin/WarehouseTab"
import SnArchiveTab from "@/components/admin/SnArchiveTab"
import ScheduleTab from "@/components/admin/ScheduleTab"
import CalendarTab from "@/components/admin/CalendarTab"
import FinanceTab from "@/components/admin/FinanceTab"
import { AdminOrdersTab } from "@/components/admin/AdminOrdersTab"
import { AdminWipTab } from "@/components/admin/AdminWipTab"
import { AdminCatalogTab } from "@/components/admin/AdminCatalogTab"
import { AdminUsersTab } from "@/components/admin/AdminUsersTab"
import RmaTab from "@/components/admin/RmaTab"
import QuizRequestsTab from "@/components/admin/QuizRequestsTab"
import {
  ADMIN_PASSWORD, VALID_TABS, AdminTab,
  Order, Product, Category, ConfigComponent, Tag, PCBuild, Article, WipBuild, AdminUser,
} from "./admin/types"

export default function Admin() {
  const navigate = useNavigate()
  const { tab: tabParam } = useParams<{ tab: string }>()
  const [authed, setAuthed] = useState(() => sessionStorage.getItem("begraphics_admin") === "1")
  const [password, setPassword] = useState("")

  const currentTab = (VALID_TABS.includes(tabParam as AdminTab) ? tabParam : "orders") as AdminTab
  const [tab, setTabState] = useState<AdminTab>(currentTab)

  useEffect(() => {
    const t = (VALID_TABS.includes(tabParam as AdminTab) ? tabParam : "orders") as AdminTab
    setTabState(t)
  }, [tabParam])

  const setTab = (t: AdminTab) => {
    setTabState(t)
    navigate(`/admin/${t}`, { replace: true })
  }

  // ── Shared state ──────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false)
  const [orders, setOrders] = useState<Order[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [configSlots, setConfigSlots] = useState<Record<string, ConfigComponent[]>>({})
  const [builds, setBuilds] = useState<PCBuild[]>([])
  const [articles, setArticles] = useState<Article[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [wipBuilds, setWipBuilds] = useState<WipBuild[]>([])
  const [wipStages, setWipStages] = useState<string[]>([])
  // id сборки, которую надо открыть в редакторе каталога после перехода на add_build
  const [autoEditBuildId, setAutoEditBuildId] = useState<number | null>(null)
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([])

  // ── Data loading ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authed) return
    setLoading(true)
    if (tab === "orders" || tab === "orders_archive") {
      api.orders.getAll().then(d => { setOrders(d.orders || []); setLoading(false) })
    } else if (tab === "products" || tab === "add_product") {
      api.products.getAll().then(d => {
        setProducts(d.products || [])
        setCategories(d.categories || [])
        setLoading(false)
      })
    } else if (tab === "builds" || tab === "archive" || tab === "add_build") {
      api.tags.getAll().then(d => setTags(d.tags || []))
      Promise.all([
        api.builds.getAll().then(d => Array.isArray(d) ? d : (d.builds || [])),
        api.products.getAll().then(d => {
          const prods = d.products || []
          setProducts(prods)
          setCategories(d.categories || [])
          const slots: Record<string, ConfigComponent[]> = {}
          for (const p of prods) {
            const slot = p.category?.slug || "other"
            if (!slots[slot]) slots[slot] = []
            slots[slot].push({ id: p.id, slot, name: p.name, brand: p.category?.name, price: p.price })
          }
          setConfigSlots(slots)
          return d
        }),
      ]).then(([b]) => { setBuilds(b); setLoading(false) }).catch(() => setLoading(false))
    } else if (tab === "wip_builds" || tab === "wip_archive") {
      api.wipBuilds.getAll().then(d => {
        setWipBuilds(d.wip_builds || [])
        setWipStages(d.stages || [])
        setLoading(false)
      })
    } else if (tab === "tags") {
      api.tags.getAll().then(d => { setTags(d.tags || []); setLoading(false) })
    } else if (tab === "articles" || tab === "add_article") {
      api.articles.getAll().then(d => { setArticles(d.articles || []); setLoading(false) })
    } else if (tab === "users") {
      api.auth.adminGetUsers(ADMIN_PASSWORD).then(d => { setAdminUsers(d.users || []); setLoading(false) })
    } else {
      setLoading(false)
    }
  }, [authed, tab])

  const login = () => {
    if (password === ADMIN_PASSWORD) { sessionStorage.setItem("begraphics_admin", "1"); setAuthed(true) }
    else alert("Неверный пароль")
  }
  const logout = () => { sessionStorage.removeItem("begraphics_admin"); setAuthed(false) }

  // ── Auth screen ───────────────────────────────────────────────────────────
  if (!authed) return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold text-lg">B</div>
          <div>
            <p className="font-semibold text-foreground">BeGraphics Admin</p>
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

  // ── Tab config ────────────────────────────────────────────────────────────
  // Группа 1 — Продукция и сборки
  const topTabs = [
    { key: "builds", label: "Наши ПК", icon: "Monitor" },
    { key: "cables", label: "Кабели", icon: "Cable" },
    { key: "wip_builds", label: "Сборки в процессе", icon: "Hammer" },
    { key: "tags", label: "Теги", icon: "Tag" },
  ]
  // Группа 2 — Операции
  const bottomTabs = [
    { key: "quiz_requests", label: "Входящие заявки", icon: "Inbox" },
    { key: "orders", label: "Заказы", icon: "ClipboardList" },
    { key: "warehouse", label: "Склад", icon: "Warehouse" },
    { key: "sn_archive", label: "Архив SN", icon: "ScanBarcode" },
    { key: "products", label: "Товары", icon: "Package" },
    { key: "rma", label: "Гарантия (RMA)", icon: "ShieldAlert" },
  ]
  // Группа 3 — Прочее
  const extraTabs = [
    { key: "users", label: "Пользователи", icon: "Users" },
    { key: "schedule", label: "Расписание", icon: "CalendarDays" },
    { key: "calendar", label: "Календарь", icon: "CalendarCheck" },
    { key: "finance", label: "Финансы", icon: "Wallet" },
    { key: "articles", label: "Статьи", icon: "BookOpen" },
  ]

  const CATALOG_TABS: AdminTab[] = ["products", "add_product", "builds", "archive", "add_build", "tags", "articles", "add_article", "cables"]
  const isCatalogTab = CATALOG_TABS.includes(tab)

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
        <div className="mb-6 border-b border-border">
          {[topTabs, bottomTabs, extraTabs].map((row, ri) => (
            <div key={ri} className="flex items-center justify-center gap-0 overflow-x-auto">
              {row.map(t => t.key.startsWith("DIVIDER") ? (
                <div key={t.key} className="mx-2 h-5 w-px shrink-0 bg-border" />
              ) : (
                <button key={t.key} onClick={() => setTab(t.key as AdminTab)}
                  className={`flex shrink-0 items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 ${tab === t.key ? "border-primary text-primary" : "border-transparent text-foreground/60 hover:text-foreground"}`}
                  style={{ cursor: "pointer" }}>
                  <Icon name={(t.icon || "Package") as "Package"} size={15} />
                  {t.label}
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* ORDERS */}
        {(tab === "orders" || tab === "orders_archive") && (
          <AdminOrdersTab tab={tab} orders={orders} loading={loading} setOrders={setOrders} setTab={setTab} />
        )}

        {/* WIP BUILDS / ARCHIVE */}
        {(tab === "wip_builds" || tab === "wip_archive") && (
          <AdminWipTab
            tab={tab} wipBuilds={wipBuilds} wipStages={wipStages} loading={loading}
            setWipBuilds={setWipBuilds}
            builds={builds} setBuilds={setBuilds}
            products={products} setProducts={setProducts}
            setCategories={setCategories} setConfigSlots={setConfigSlots}
            editBuild={(id?: number) => { if (id) setAutoEditBuildId(id); setTab("add_build") }}
            setTab={setTab}
          />
        )}

        {/* CATALOG: products, builds, tags, articles, cables */}
        {isCatalogTab && (
          <AdminCatalogTab
            tab={tab} setTab={setTab} loading={loading}
            products={products} categories={categories}
            setProducts={setProducts} setCategories={setCategories}
            builds={builds} setBuilds={setBuilds}
            configSlots={configSlots} setConfigSlots={setConfigSlots}
            tags={tags} setTags={setTags}
            articles={articles} setArticles={setArticles}
            autoEditBuildId={autoEditBuildId} clearAutoEditBuildId={() => setAutoEditBuildId(null)}
          />
        )}

        {/* SCHEDULE */}
        {tab === "schedule" && <ScheduleTab />}

        {/* CALENDAR */}
        {tab === "calendar" && <CalendarTab />}

        {/* FINANCE */}
        {tab === "finance" && <FinanceTab />}

        {/* USERS */}
        {tab === "users" && (
          <AdminUsersTab adminUsers={adminUsers} loading={loading} setAdminUsers={setAdminUsers} />
        )}

        {/* RMA */}
        {tab === "rma" && <RmaTab />}

        {/* QUIZ REQUESTS */}
        {tab === "quiz_requests" && <QuizRequestsTab />}
      </div>

      {/* WAREHOUSE — на всю ширину браузера с отступами 50px */}
      {tab === "warehouse" && (
        <div style={{ padding: "32px 50px 48px" }}>
          <WarehouseTab />
        </div>
      )}

      {/* SN ARCHIVE — реестр серийников */}
      {tab === "sn_archive" && (
        <div style={{ padding: "32px 50px 48px" }}>
          <SnArchiveTab />
        </div>
      )}
    </div>
  )
}