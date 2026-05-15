import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@/store/auth"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { ThemeSwitcher } from "@/components/theme-switcher"

interface UserBuild {
  id: number
  name: string
  components: Array<{ slot: string; name: string; price: number; qty: number }>
  parts_total: number
  assembly_fee: number
  total_price: number
  share_token: string
  is_public: boolean
  created_at: string
}

interface AdminBuild {
  id: number
  name: string
  description: string
  components: Array<{ slot: string; name: string; price: number; current_price: number }>
  parts_total: number
  assembly_fee: number
  total_price: number
  client_token: string | null
  status: string
  created_at: string
}

interface Order {
  id: number
  customer_name: string
  order_type: string
  items: Array<{ name: string; price: number; quantity: number }>
  total: number
  status: string
  created_at: string
  wip_stage?: string
}

const WIP_STAGE_COLORS: Record<string, string> = {
  "Согласование":           "bg-muted/60 text-foreground/50",
  "Заказ":                  "bg-blue-500/15 text-blue-400",
  "Ожидание железа":        "bg-yellow-500/15 text-yellow-400",
  "Ожидание сборки":        "bg-orange-500/15 text-orange-400",
  "Сборка":                 "bg-blue-600/15 text-blue-300",
  "Настройка":              "bg-blue-700/15 text-blue-300",
  "Тесты":                  "bg-purple-500/15 text-purple-400",
  "Досборать":              "bg-red-500/15 text-red-400",
  "Проверка перед выдачей": "bg-teal-500/15 text-teal-400",
  "Ожидание упаковки":      "bg-cyan-500/15 text-cyan-400",
  "Готов, можно забрать":   "bg-green-600/20 text-green-400",
  "Отнести в сдэк":         "bg-green-700/15 text-green-300",
  "Забрали":                "bg-muted/40 text-foreground/30",
}

const ORDER_STATUS: Record<string, { label: string; color: string }> = {
  new:        { label: "Новый",    color: "text-primary bg-primary/10" },
  processing: { label: "В работе", color: "text-accent bg-accent/10" },
  done:       { label: "Выполнен", color: "text-green-400 bg-green-400/10" },
  cancelled:  { label: "Отменён",  color: "text-foreground/50 bg-muted" },
}

const SLOT_NAMES: Record<string, string> = {
  cpu: "Процессор", gpu: "Видеокарта", ram: "ОЗУ",
  storage: "Накопитель", psu: "БП", case: "Корпус",
}

export default function Profile() {
  const { user, sessionId, isAuthed, logout, updateUser } = useAuth()
  const navigate = useNavigate()

  const [activeTab, setActiveTab] = useState<"profile" | "orders" | "my_builds" | "admin_builds">("profile")
  const [userBuilds, setUserBuilds] = useState<UserBuild[]>([])
  const [adminBuilds, setAdminBuilds] = useState<AdminBuild[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState<number | null>(null)

  // Profile edit state
  const [profileForm, setProfileForm] = useState({
    username: "", email: "", bio: "", phone: "", vk_url: ""
  })
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileMsg, setProfileMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null)
  const [showTgWidget, setShowTgWidget] = useState(false)

  const fmt = (n: number) => n.toLocaleString("ru-RU") + " ₽"

  useEffect(() => {
    if (!isAuthed() || !sessionId) { navigate("/auth"); return }
    setLoading(true)

    // Подгружаем свежие данные профиля
    api.auth.me(sessionId).then(d => {
      if (d.user) {
        updateUser(d.user)
        setProfileForm({
          username: d.user.username || "",
          email: d.user.email || "",
          bio: d.user.bio || "",
          phone: d.user.phone || "",
          vk_url: d.user.vk_url || "",
        })
      }
    })

    Promise.all([
      api.auth.getBuilds(sessionId).then(d => setUserBuilds(d.builds || [])),
      api.orders.getMyOrders(sessionId).then(async d => {
        const ords: Order[] = d.orders || []
        await Promise.all(ords.filter(o => o.order_type === "pc_build").map(async o => {
          const wip = await api.wipBuilds.getByOrderId(o.id).catch(() => null)
          if (wip?.stage) o.wip_stage = wip.stage
        }))
        setOrders(ords)
      }),
      user ? api.builds.getByUserId(user.id).then(d => setAdminBuilds(d.builds || [])) : Promise.resolve(),
    ]).finally(() => setLoading(false))
  }, [])

  const copyLink = (token: string, id: number) => {
    navigator.clipboard.writeText(`${window.location.origin}/configurator?build=${token}`)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  const handleLogout = async () => {
    if (sessionId) await api.auth.logout(sessionId)
    logout()
    navigate("/")
  }

  const tgCallbackRef = (node: HTMLDivElement | null) => {
    if (!node) return
    node.innerHTML = ""

    window.onTelegramAuth = async (tgUser) => {
      const res = await api.telegramAuth.login(tgUser)
      if (!res.error && res.user) {
        updateUser(res.user)
        setProfileMsg({ type: "ok", text: "Telegram успешно привязан!" })
        setShowTgWidget(false)
        setTimeout(() => setProfileMsg(null), 3000)
      } else {
        setProfileMsg({ type: "err", text: res.error || "Ошибка привязки" })
      }
    }

    const script = document.createElement("script")
    script.src = "https://telegram.org/js/telegram-widget.js?22"
    script.setAttribute("data-telegram-login", "BeGraphicsPC_Bot")
    script.setAttribute("data-size", "large")
    script.setAttribute("data-onauth", "onTelegramAuth(user)")
    script.setAttribute("data-request-access", "write")
    script.async = true
    node.appendChild(script)
  }

  const saveProfile = async () => {
    if (!sessionId) return
    setProfileSaving(true)
    setProfileMsg(null)
    const res = await api.auth.updateProfile(profileForm, sessionId)
    if (res.error) {
      setProfileMsg({ type: "err", text: res.error })
    } else {
      updateUser(res.user)
      setProfileMsg({ type: "ok", text: "Профиль сохранён" })
      setTimeout(() => setProfileMsg(null), 3000)
    }
    setProfileSaving(false)
  }

  const avatarSrc = user?.telegram_photo

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ cursor: "auto" }}>
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <button onClick={() => navigate("/")} className="flex items-center gap-2" style={{ cursor: "pointer" }}>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-lg">B</div>
            <span className="font-semibold text-lg text-foreground">BeGraphics</span>
          </button>
          <nav className="hidden items-center gap-6 md:flex">
            <button onClick={() => navigate("/shop")} className="text-sm text-foreground/70 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>Каталог</button>
            <button onClick={() => navigate("/configurator")} className="text-sm text-foreground/70 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>Конфигуратор</button>
            <button className="text-sm font-medium text-primary">Профиль</button>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeSwitcher />
            <button onClick={handleLogout} className="flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm text-foreground/70 hover:border-primary hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
              <Icon name="LogOut" size={15} />
              Выйти
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-10">
        {/* User card */}
        <div className="mb-8 flex items-center gap-5">
          <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20 overflow-hidden">
            {avatarSrc
              ? <img src={avatarSrc} alt="avatar" className="h-full w-full object-cover" />
              : <Icon name="User" size={28} className="text-primary" />}
          </div>
          <div>
            <h1 className="text-2xl font-light text-foreground">{user?.username}</h1>
            <div className="flex items-center gap-2 mt-0.5">
              {user?.email && <p className="text-sm text-foreground/50">{user.email}</p>}
              {user?.telegram_username && (
                <span className="flex items-center gap-1 text-xs text-foreground/40">
                  <Icon name="Send" size={11} />@{user.telegram_username}
                </span>
              )}
            </div>
          </div>
          <div className="ml-auto flex gap-3">
            <button onClick={() => navigate("/configurator")} className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>
              <Icon name="Plus" size={16} />Новая сборка
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-6 flex border-b border-border overflow-x-auto">
          {[
            { key: "profile", label: "Мой профиль", icon: "UserCog" },
            { key: "orders", label: "Мои заказы", icon: "ShoppingBag", count: orders.length },
            { key: "admin_builds", label: "Сборки от BeGraphics", icon: "Sparkles", count: adminBuilds.length },
            { key: "my_builds", label: "Мои конфиги", icon: "Cpu", count: userBuilds.length },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key as typeof activeTab)}
              className={`flex shrink-0 items-center gap-2 border-b-2 px-5 py-3 text-sm font-medium transition-colors ${activeTab === t.key ? "border-primary text-primary" : "border-transparent text-foreground/60 hover:text-foreground"}`}
              style={{ cursor: "pointer" }}
            >
              <Icon name={t.icon as "Cpu"} size={15} />
              {t.label}
              {"count" in t && t.count! > 0 && (
                <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-xs text-primary">{t.count}</span>
              )}
            </button>
          ))}
        </div>

        {loading && activeTab !== "profile" ? (
          <div className="grid gap-4 md:grid-cols-2">
            {[...Array(3)].map((_, i) => <div key={i} className="h-32 rounded-xl bg-card animate-pulse" />)}
          </div>
        ) : (
          <>
            {/* PROFILE EDIT */}
            {activeTab === "profile" && (
              <div className="grid gap-6 md:grid-cols-2">
                {/* Основные данные */}
                <div className="rounded-2xl border border-border bg-card p-6">
                  <h2 className="mb-5 text-sm font-semibold text-foreground">Основные данные</h2>
                  <div className="space-y-4">
                    <div>
                      <label className="mb-1 block text-xs text-foreground/60">Имя пользователя</label>
                      <input
                        value={profileForm.username}
                        onChange={e => setProfileForm(f => ({ ...f, username: e.target.value }))}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none"
                        placeholder="username"
                        style={{ cursor: "text" }}
                      />
                    </div>
                    <div>
                      <label className="mb-1 flex items-center gap-1.5 text-xs text-foreground/60">
                        Email
                        {user?.email_verified
                          ? <span className="flex items-center gap-1 text-green-400"><Icon name="CheckCircle" size={11} />подтверждён</span>
                          : user?.email
                            ? <span className="flex items-center gap-1 text-yellow-400"><Icon name="AlertCircle" size={11} />не подтверждён</span>
                            : null}
                      </label>
                      <input
                        type="email"
                        value={profileForm.email}
                        onChange={e => setProfileForm(f => ({ ...f, email: e.target.value }))}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none"
                        placeholder="you@email.com"
                        style={{ cursor: "text" }}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-foreground/60">Телефон</label>
                      <input
                        type="tel"
                        value={profileForm.phone}
                        onChange={e => setProfileForm(f => ({ ...f, phone: e.target.value }))}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none"
                        placeholder="+7 (___) ___-__-__"
                        style={{ cursor: "text" }}
                      />
                      <p className="mt-1 text-xs text-foreground/30">Виден только администраторам</p>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-foreground/60">О себе</label>
                      <textarea
                        rows={3}
                        value={profileForm.bio}
                        onChange={e => setProfileForm(f => ({ ...f, bio: e.target.value }))}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none resize-none"
                        placeholder="Расскажи немного о себе..."
                        style={{ cursor: "text" }}
                      />
                    </div>
                  </div>
                </div>

                {/* Соцсети */}
                <div className="space-y-6">
                  <div className="rounded-2xl border border-border bg-card p-6">
                    <h2 className="mb-5 text-sm font-semibold text-foreground">Привязанные аккаунты</h2>
                    <div className="space-y-3">
                      {/* Telegram */}
                      <div className="rounded-xl border border-border bg-background px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#229ED9]/10">
                            <Icon name="Send" size={16} className="text-[#229ED9]" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground">Telegram</p>
                            {user?.telegram_username
                              ? <p className="text-xs text-foreground/50 truncate">@{user.telegram_username}</p>
                              : <p className="text-xs text-foreground/30">Не привязан</p>}
                          </div>
                          {user?.telegram_id
                            ? <span className="flex items-center gap-1 text-xs text-green-400"><Icon name="Check" size={12} />Привязан</span>
                            : <button onClick={() => setShowTgWidget(v => !v)} className="text-xs text-primary hover:underline" style={{ cursor: "pointer" }}>
                                {showTgWidget ? "Отмена" : "Привязать"}
                              </button>}
                        </div>
                        {showTgWidget && !user?.telegram_id && (
                          <div className="mt-3 flex justify-center" ref={tgCallbackRef} />
                        )}
                      </div>

                      {/* ВКонтакте */}
                      <div className="flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0077FF]/10">
                          <Icon name="Globe" size={16} className="text-[#0077FF]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground">ВКонтакте</p>
                          <input
                            value={profileForm.vk_url}
                            onChange={e => setProfileForm(f => ({ ...f, vk_url: e.target.value }))}
                            className="w-full bg-transparent text-xs text-foreground/50 focus:outline-none focus:text-foreground placeholder:text-foreground/30"
                            placeholder="https://vk.com/username"
                            style={{ cursor: "text" }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Сохранить */}
                  <div>
                    {profileMsg && (
                      <div className={`mb-3 rounded-lg px-3 py-2 text-xs ${profileMsg.type === "ok" ? "bg-green-500/10 text-green-400" : "bg-primary/10 text-primary"}`}>
                        {profileMsg.text}
                      </div>
                    )}
                    <button
                      onClick={saveProfile}
                      disabled={profileSaving}
                      className="w-full rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                      style={{ cursor: "pointer" }}
                    >
                      {profileSaving ? "Сохранение..." : "Сохранить изменения"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ORDERS */}
            {activeTab === "orders" && (
              orders.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border py-20 text-center">
                  <Icon name="ShoppingBag" size={40} className="mx-auto mb-4 text-foreground/20" />
                  <p className="mb-2 text-foreground/50">Заказов пока нет</p>
                  <button onClick={() => navigate("/shop")} className="mt-2 text-sm text-primary hover:underline" style={{ cursor: "pointer" }}>Перейти в каталог →</button>
                </div>
              ) : (
                <div className="space-y-3">
                  {orders.map(order => {
                    const st = ORDER_STATUS[order.status] || ORDER_STATUS.new
                    return (
                      <div key={order.id} className="rounded-xl border border-border bg-card p-5">
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-mono text-xs text-foreground/40">#{order.id}</span>
                              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${st.color}`}>{st.label}</span>
                              {order.wip_stage && (
                                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${WIP_STAGE_COLORS[order.wip_stage] || "bg-muted text-foreground/50"}`}>
                                  {order.wip_stage}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-foreground/50">{new Date(order.created_at).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}</p>
                          </div>
                          <p className="text-lg font-bold text-foreground">{fmt(order.total)}</p>
                        </div>
                        <div className="space-y-1">
                          {(order.items || []).slice(0, 3).map((item, i) => (
                            <p key={i} className="text-xs text-foreground/50">· {item.name} × {item.quantity} — {fmt(item.price * item.quantity)}</p>
                          ))}
                          {(order.items || []).length > 3 && <p className="text-xs text-foreground/30">+ ещё {order.items.length - 3}</p>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            )}

            {/* ADMIN BUILDS */}
            {activeTab === "admin_builds" && (
              adminBuilds.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border py-20 text-center">
                  <Icon name="Sparkles" size={40} className="mx-auto mb-4 text-foreground/20" />
                  <p className="mb-2 text-foreground/50">Персональных сборок нет</p>
                  <p className="text-xs text-foreground/40">Когда менеджер подготовит для вас сборку, она появится здесь</p>
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {adminBuilds.map(b => (
                    <div key={b.id} className="rounded-xl border border-border bg-card p-5 hover:border-primary/30 transition-all">
                      <div className="mb-3 flex items-start justify-between gap-2">
                        <div>
                          <h3 className="font-medium text-foreground">{b.name}</h3>
                          {b.description && <p className="text-xs text-foreground/50 mt-0.5">{b.description}</p>}
                        </div>
                        <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">От BeGraphics</span>
                      </div>
                      <div className="mb-4 space-y-1">
                        {b.components.slice(0, 4).map((c, i) => (
                          <div key={i} className="flex items-center justify-between text-xs">
                            <span className="text-foreground/40 w-20 shrink-0">{SLOT_NAMES[c.slot] || c.slot}</span>
                            <span className="flex-1 truncate mx-2 text-foreground/70">{c.name}</span>
                            <span className="text-foreground/60 shrink-0">{fmt(c.current_price ?? c.price)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="mb-4 rounded-lg bg-muted/50 px-3 py-2 text-xs space-y-1">
                        <div className="flex justify-between">
                          <span className="text-foreground/50">Железо</span>
                          <span className="text-foreground">{fmt(b.parts_total)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-foreground/50">Сборка (7%)</span>
                          <span className="text-foreground">{fmt(b.assembly_fee)}</span>
                        </div>
                        <div className="flex justify-between border-t border-border/50 pt-1 font-medium">
                          <span className="text-foreground/70">Итого</span>
                          <span className="text-foreground">{fmt(b.total_price)}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => navigate(`/build?token=${b.client_token}`)}
                        className="w-full rounded-xl bg-primary py-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                        style={{ cursor: "pointer" }}
                      >
                        Просмотреть и заказать
                      </button>
                    </div>
                  ))}
                </div>
              )
            )}

            {/* MY BUILDS */}
            {activeTab === "my_builds" && (
              userBuilds.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border py-20 text-center">
                  <Icon name="Cpu" size={40} className="mx-auto mb-4 text-foreground/20" />
                  <p className="mb-2 text-foreground/50">Сохранённых сборок пока нет</p>
                  <button onClick={() => navigate("/configurator")} className="mt-2 text-sm text-primary hover:underline" style={{ cursor: "pointer" }}>Открыть конфигуратор →</button>
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {userBuilds.map(b => (
                    <div key={b.id} className="rounded-xl border border-border bg-card p-5 hover:border-primary/30 transition-all">
                      <div className="mb-3 flex items-start justify-between gap-2">
                        <div>
                          <h3 className="font-medium text-foreground">{b.name}</h3>
                          <p className="text-xs text-foreground/40">{new Date(b.created_at).toLocaleDateString("ru-RU")}</p>
                        </div>
                        {b.is_public && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">Публичная</span>}
                      </div>
                      <div className="mb-4 space-y-1">
                        {b.components.slice(0, 4).map((c, i) => (
                          <div key={i} className="flex items-center justify-between text-xs">
                            <span className="text-foreground/40 w-20 shrink-0">{SLOT_NAMES[c.slot] || c.slot}</span>
                            <span className="flex-1 truncate mx-2 text-foreground/70">{c.name}</span>
                            <span className="text-foreground/60 shrink-0">{fmt(c.price * (c.qty || 1))}</span>
                          </div>
                        ))}
                      </div>
                      <div className="mb-4 rounded-lg bg-muted/50 px-3 py-2 text-xs">
                        <div className="flex justify-between font-medium">
                          <span className="text-foreground/70">Итого</span>
                          <span className="text-foreground">{fmt(b.total_price)}</span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => navigate(`/configurator?build=${b.share_token}`)} className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-xs text-foreground/60 hover:border-primary hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
                          <Icon name="Edit2" size={13} />Открыть
                        </button>
                        <button onClick={() => copyLink(b.share_token, b.id)} className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-xs text-foreground/60 hover:border-primary hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
                          <Icon name={copied === b.id ? "Check" : "Share2"} size={13} />
                          {copied === b.id ? "Скопировано!" : "Поделиться"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}
          </>
        )}
      </div>
    </div>
  )
}