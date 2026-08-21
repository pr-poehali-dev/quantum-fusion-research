import { useState, useEffect, useMemo } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { useNavigate, useParams } from "react-router-dom"
import { lazy, Suspense } from "react"
import ErrorBoundary from "@/components/ErrorBoundary"
// Тяжёлые вкладки грузятся лениво — каждая своим чанком, только при открытии.
// Это резко уменьшает первичный бандл админки (открыта всегда одна вкладка).
const WarehouseTab = lazy(() => import("@/components/admin/WarehouseTab"))
const SnArchiveTab = lazy(() => import("@/components/admin/SnArchiveTab"))
const CompatibilityTab = lazy(() => import("@/components/admin/CompatibilityTab"))
const ScheduleTab = lazy(() => import("@/components/admin/ScheduleTab"))
const CalendarTab = lazy(() => import("@/components/admin/CalendarTab"))
const FinanceTab = lazy(() => import("@/components/admin/FinanceTab"))
const AnalyticsTab = lazy(() => import("@/components/admin/AnalyticsTab"))
const FaqTab = lazy(() => import("@/components/admin/FaqTab"))
const PromoTab = lazy(() => import("@/components/admin/PromoTab"))
const RmaTab = lazy(() => import("@/components/admin/RmaTab"))
const QuizRequestsTab = lazy(() => import("@/components/admin/QuizRequestsTab"))
const PriceMonitorTab = lazy(() => import("@/components/admin/PriceMonitorTab"))
const StressTestsTab = lazy(() => import("@/components/admin/StressTestsTab"))
const UserBuildsTab = lazy(() => import("@/components/admin/UserBuildsTab"))
const CompanySettings = lazy(() => import("@/components/admin/CompanySettings"))
const TelegramBotTab = lazy(() => import("@/components/admin/TelegramBotTab"))
const AdminCatalogTab = lazy(() => import("@/components/admin/AdminCatalogTab").then(m => ({ default: m.AdminCatalogTab })))
const AdminUsersTab = lazy(() => import("@/components/admin/AdminUsersTab").then(m => ({ default: m.AdminUsersTab })))
import { AdminOrdersTab } from "@/components/admin/AdminOrdersTab"
import { AdminWipTab } from "@/components/admin/AdminWipTab"
import AdminTabsNav from "@/components/admin/AdminTabsNav"
import { ThemeSwitcher } from "@/components/theme-switcher"
import UiScaleSwitcher from "@/components/admin/UiScaleSwitcher"
import { useUiScale } from "@/store/uiScale"
import {
  AdminTab,
  Order, Product, Category, ConfigComponent, Tag, PCBuild, Article, WipBuild, AdminUser,
} from "./admin/types"
import {
  ADMIN_KEY_STORAGE, getAdminKey, VALID_TABS,
} from "./admin/constants"

export default function Admin() {
  const navigate = useNavigate()
  const uiScale = useUiScale(s => s.scale)
  const { tab: tabParam } = useParams<{ tab: string }>()
  const [authed, setAuthed] = useState(() => sessionStorage.getItem("begraphics_admin") === "1")
  const [password, setPassword] = useState("")
  const [loginLoading, setLoginLoading] = useState(false)

  const currentTab = (VALID_TABS.includes(tabParam as AdminTab) ? tabParam : "orders") as AdminTab
  const [tab, setTabState] = useState<AdminTab>(currentTab)

  useEffect(() => {
    const t = (VALID_TABS.includes(tabParam as AdminTab) ? tabParam : "orders") as AdminTab
    setTabState(t)
  }, [tabParam])

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const setTab = (t: AdminTab) => {
    setTabState(t)
    navigate(`/admin/${t}`, { replace: true })
    setMobileMenuOpen(false)
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
  // Какую статью открыть на редактирование. Живёт в Admin (переживает remount
  // поддерева по key={main-${tab}}), передаётся в ArticlesSection.
  const [autoEditArticleId, setAutoEditArticleId] = useState<number | null>(null)
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([])
  // Счётчик необработанных предложений парсера цен (бейдж на вкладке «Цены»)
  const [parserPending, setParserPending] = useState(0)

  useEffect(() => {
    if (!authed) return
    api.priceMonitor.list(getAdminKey())
      .then(d => {
        const c = d.counts || {}
        setParserPending((c.price_change || 0) + (c.new_product || 0))
      })
      .catch(() => {})
  }, [authed, tab])

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
      api.auth.adminGetUsers(getAdminKey()).then(d => { setAdminUsers(d.users || []); setLoading(false) })
    } else {
      setLoading(false)
    }
  }, [authed, tab])

  // Вход проверяется на бэкенде по секрету ADMIN_KEY; пароль сохраняем для запросов.
  const login = async () => {
    if (!password || loginLoading) return
    setLoginLoading(true)
    try {
      const res = await api.auth.adminLogin(password)
      if (res.ok) {
        sessionStorage.setItem("begraphics_admin", "1")
        sessionStorage.setItem(ADMIN_KEY_STORAGE, password)
        setAuthed(true)
      } else alert("Неверный пароль")
    } catch { alert("Ошибка соединения") }
    setLoginLoading(false)
  }
  const logout = () => {
    sessionStorage.removeItem("begraphics_admin")
    sessionStorage.removeItem(ADMIN_KEY_STORAGE)
    setAuthed(false)
  }

  // ── Tab config ────────────────────────────────────────────────────────────
  // ВАЖНО: объявлено ДО раннего return `if (!authed)`, иначе хуки useMemo ниже
  // вызывались бы только после входа → «Rendered more hooks than during the
  // previous render» (нарушение правил хуков) и краш админки после логина.
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
    { key: "rma", label: "Гарантия (RMA)", icon: "ShieldAlert" },
  ]
  // Группа 3 — Операции
  const extraTabs = [
    { key: "schedule", label: "Расписание", icon: "CalendarDays" },
    { key: "calendar", label: "Календарь", icon: "CalendarCheck" },
    { key: "price_monitor", label: "Цены", icon: "TrendingUp" },
  ]
  // Группа 6 — Обвязка (сервисные инструменты)
  const toolsTabs = [
    { key: "stress", label: "Стресс-тесты", icon: "Activity" },
    { key: "telegram_bot", label: "Telegram-бот", icon: "Send" },
  ]
  // Группа 4 — Финансы и настройки
  const financeTabs = [
    { key: "finance", label: "Финансы", icon: "Wallet" },
    { key: "analytics", label: "Аналитика", icon: "ChartColumnBig" },
    { key: "faq", label: "Вопросы (FAQ)", icon: "MessagesSquare" },
    { key: "promos", label: "Промокоды", icon: "BadgePercent" },
    { key: "company_settings", label: "Реквизиты", icon: "Building2" },
  ]
  // Группа 4 — Быстрый доступ
  const quickTabs = [
    { key: "products", label: "Товары", icon: "Package" },
    { key: "compatibility", label: "Совместимость", icon: "Puzzle" },
    { key: "users", label: "Пользователи", icon: "Users" },
    { key: "user_builds", label: "Сборки клиентов", icon: "Wrench" },
    { key: "articles", label: "Статьи", icon: "BookOpen" },
  ]

  // Группы для мобильного выпадающего меню
  const menuGroups = [
    { title: "Сборки", items: topTabs },
    { title: "Заявки и склад", items: bottomTabs },
    { title: "Операции", items: extraTabs },
    { title: "Финансы и настройки", items: financeTabs },
    { title: "Сайт", items: quickTabs },
    { title: "Обвязка", items: toolsTabs },
  ]
  const allTabs = [...topTabs, ...bottomTabs, ...extraTabs, ...financeTabs, ...quickTabs, ...toolsTabs]
  // Стабильная ссылка для AdminTabsNav (иначе реконсиляция раскладки на каждый рендер)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const allTabsMemo = useMemo(() => allTabs, [])
  const tabBadges = useMemo(() => ({ price_monitor: parserPending }), [parserPending])
  const currentTabMeta = allTabs.find(t => t.key === tab)

  const CATALOG_TABS: AdminTab[] = ["products", "add_product", "builds", "archive", "add_build", "tags", "articles", "add_article", "cables"]
  const isCatalogTab = CATALOG_TABS.includes(tab)

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
          <button onClick={login} disabled={loginLoading} className="w-full rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50" style={{ cursor: "pointer" }}>
            {loginLoading ? "Проверка..." : "Войти"}
          </button>
          <button onClick={() => navigate("/")} className="w-full text-center text-xs text-foreground/40 hover:text-foreground/60 transition-colors" style={{ cursor: "pointer" }}>
            ← На сайт
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ cursor: "auto" }}>
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold">B</div>
            <span className="font-semibold text-foreground">BeGraphics Admin</span>
          </div>
          <div className="flex items-center gap-3">
            <UiScaleSwitcher />
            <ThemeSwitcher />
            <button onClick={() => navigate("/shop")} className="text-xs text-foreground/40 hover:text-foreground/70 transition-colors" style={{ cursor: "pointer" }}>На сайт</button>
            <button onClick={logout} className="flex items-center gap-1.5 text-xs text-foreground/40 hover:text-foreground/70 transition-colors" style={{ cursor: "pointer" }}>
              <Icon name="LogOut" size={14} />Выйти
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8" style={{ zoom: uiScale }}>
        {/* Десктоп: настраиваемые строки табов (drag&drop, архив, персонально per admin) */}
        <AdminTabsNav
          allTabs={allTabsMemo}
          activeTab={tab}
          onSelect={k => setTab(k as AdminTab)}
          badges={tabBadges}
        />

        {/* Мобильный: выпадающее меню с группировкой */}
        <div className="relative mb-6 md:hidden">
          <button onClick={() => setMobileMenuOpen(v => !v)}
            className="flex w-full items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium"
            style={{ cursor: "pointer" }}>
            <span className="flex items-center gap-2 text-foreground">
              <Icon name={(currentTabMeta?.icon || "LayoutGrid") as "Package"} size={16} className="text-primary" />
              {currentTabMeta?.label || "Меню"}
            </span>
            <Icon name={mobileMenuOpen ? "ChevronUp" : "ChevronDown"} size={16} className="text-foreground/40" />
          </button>
          {mobileMenuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMobileMenuOpen(false)} />
              <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-[70vh] overflow-y-auto rounded-xl border border-border bg-card p-2 shadow-2xl">
                {menuGroups.map(group => (
                  <div key={group.title} className="mb-2 last:mb-0">
                    <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/40">{group.title}</p>
                    {group.items.map(t => (
                      <button key={t.key} onClick={() => setTab(t.key as AdminTab)}
                        className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${tab === t.key ? "bg-primary/10 font-medium text-primary" : "text-foreground/70 hover:bg-muted"}`}
                        style={{ cursor: "pointer" }}>
                        <Icon name={(t.icon || "Package") as "Package"} size={16} className="shrink-0" />
                        {t.label}
                        {t.key === "price_monitor" && parserPending > 0 && (
                          <span className="ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-semibold leading-none text-white">
                            {parserPending > 99 ? "99+" : parserPending}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <ErrorBoundary key={`main-${tab}`}>
        <Suspense fallback={<div className="py-16 text-center text-foreground/40">Загрузка…</div>}>
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
            setAutoEditBuildId={setAutoEditBuildId}
            autoEditArticleId={autoEditArticleId} setAutoEditArticleId={setAutoEditArticleId}
          />
        )}

        {/* SCHEDULE */}
        {tab === "schedule" && <ScheduleTab />}

        {/* CALENDAR */}
        {tab === "calendar" && <CalendarTab />}

        {/* FINANCE */}
        {tab === "finance" && <FinanceTab />}

        {/* ANALYTICS — источники, бюджеты, дашборд */}
        {tab === "analytics" && <AnalyticsTab />}

        {/* FAQ — вопросы и ответы */}
        {tab === "faq" && <FaqTab />}

        {/* PROMOS — промокоды и акции */}
        {tab === "promos" && <PromoTab />}

        {/* COMPANY SETTINGS (реквизиты для договора) */}
        {tab === "company_settings" && (
          <div style={{ padding: "32px 50px 48px" }}>
            <CompanySettings />
          </div>
        )}

        {/* TELEGRAM BOT — чаты, уведомления, журнал */}
        {tab === "telegram_bot" && (
          <div style={{ padding: "32px 50px 48px" }}>
            <TelegramBotTab />
          </div>
        )}

        {/* USERS */}
        {tab === "users" && (
          <AdminUsersTab adminUsers={adminUsers} loading={loading} setAdminUsers={setAdminUsers} />
        )}

        {/* USER BUILDS — конфигурации, собранные клиентами */}
        {tab === "user_builds" && <UserBuildsTab />}

        {/* RMA */}
        {tab === "rma" && <RmaTab />}

        {/* QUIZ REQUESTS */}
        {tab === "quiz_requests" && <QuizRequestsTab />}

        {/* PRICE MONITOR — цены от парсера */}
        {tab === "price_monitor" && <PriceMonitorTab />}

        {/* STRESS — результаты стресс-тестов от desktop-приложения */}
        {tab === "stress" && <StressTestsTab />}

        {/* STRESS RELEASES — версии EXE для скачивания клиентами */}
        </Suspense>
        </ErrorBoundary>
      </div>

      <ErrorBoundary key={`wide-${tab}`}>
      <Suspense fallback={<div className="py-16 text-center text-foreground/40">Загрузка…</div>}>
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

      {/* COMPATIBILITY — характеристики совместимости для конфигуратора */}
      {tab === "compatibility" && (
        <div style={{ padding: "32px 50px 48px" }}>
          <CompatibilityTab />
        </div>
      )}
      </Suspense>
      </ErrorBoundary>
    </div>
  )
}