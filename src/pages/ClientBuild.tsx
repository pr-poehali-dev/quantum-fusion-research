import { useEffect, useState } from "react"
import { useSearchParams, useNavigate } from "react-router-dom"
import { api } from "@/lib/api"
import { useAuth } from "@/store/auth"
import { useCart } from "@/store/cart"
import Icon from "@/components/ui/icon"

const SLOT_NAMES: Record<string, string> = {
  cpu: "Процессор", gpu: "Видеокарта", ram: "Оперативная память",
  storage: "Накопитель", psu: "Блок питания", case: "Корпус", motherboard: "Материнская плата",
}

interface Build {
  id: number
  name: string
  description: string
  components: Array<{ slot: string; name: string; price: number; current_price: number }>
  parts_total: number
  assembly_fee: number
  total_price: number
  assembly_type: string
  client_token: string | null
  client_user_id: number | null
  image_urls: string[]
}

export default function ClientBuild() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { isAuthed, sessionId, user } = useAuth()
  const { addItem } = useCart()

  const token = searchParams.get("token")
  const [build, setBuild] = useState<Build | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [claiming, setClaiming] = useState(false)
  const [claimed, setClaimed] = useState(false)
  const [imgIdx, setImgIdx] = useState(0)

  const fmt = (n: number) => n.toLocaleString("ru-RU") + " ₽"

  useEffect(() => {
    if (!token) { setError("Ссылка недействительна"); setLoading(false); return }
    api.builds.getByClientToken(token).then(data => {
      if (data.error) { setError(data.error); setLoading(false); return }
      setBuild(data)
      // Проверяем — уже привязана к этому пользователю?
      if (data.client_user_id && user && data.client_user_id === user.id) {
        setClaimed(true)
      }
      setLoading(false)
    }).catch(() => { setError("Не удалось загрузить сборку"); setLoading(false) })
  }, [token, user])

  const claimBuild = async () => {
    if (!isAuthed() || !sessionId) { navigate(`/auth?redirect=/build?token=${token}`); return }
    setClaiming(true)
    await api.builds.claimBuild(token!, sessionId)
    setClaimed(true)
    setClaiming(false)
  }

  const orderBuild = () => {
    if (!build) return
    addItem({ id: build.id, name: build.name, price: build.total_price, type: "config" })
    navigate("/cart")
  }

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-background" style={{ cursor: "auto" }}>
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  )

  if (error) return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center" style={{ cursor: "auto" }}>
      <Icon name="LinkOff" size={48} className="mb-4 text-foreground/20" />
      <h1 className="mb-2 text-xl font-medium text-foreground">{error}</h1>
      <p className="mb-6 text-sm text-foreground/50">Возможно ссылка устарела или была деактивирована</p>
      <button onClick={() => navigate("/")} className="rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground" style={{ cursor: "pointer" }}>
        На главную
      </button>
    </div>
  )

  if (!build) return null

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ cursor: "auto" }}>
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <button onClick={() => navigate("/")} className="flex items-center gap-2" style={{ cursor: "pointer" }}>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold">B</div>
            <span className="font-semibold text-foreground">BeGraphics</span>
          </button>
          {isAuthed() ? (
            <button onClick={() => navigate("/profile")} className="flex items-center gap-1.5 rounded-full border border-border px-3 py-2 text-sm text-foreground/70 hover:border-primary transition-colors" style={{ cursor: "pointer" }}>
              <Icon name="User" size={15} />
              <span>{user?.username}</span>
            </button>
          ) : (
            <button onClick={() => navigate(`/auth?redirect=/build?token=${token}`)} className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" style={{ cursor: "pointer" }}>
              Войти
            </button>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-6 py-10">
        {/* Баннер — персональная сборка */}
        <div className="mb-6 flex items-center gap-3 rounded-2xl border border-primary/20 bg-primary/5 px-5 py-4">
          <Icon name="Sparkles" size={20} className="text-primary shrink-0" />
          <div>
            <p className="text-sm font-medium text-foreground">Персональная сборка от BeGraphics</p>
            <p className="text-xs text-foreground/60">Эта конфигурация подготовлена специально для вас. Состав и стоимость актуальны.</p>
          </div>
        </div>

        <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
          {/* Левая часть — фото + состав */}
          <div>
            {/* Фото */}
            {build.image_urls?.length > 0 && (
              <div className="mb-6 overflow-hidden rounded-2xl border border-border">
                <div className="relative aspect-video">
                  <img src={build.image_urls[imgIdx]} alt={build.name} className="h-full w-full object-cover" />
                  {build.image_urls.length > 1 && (
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                      {build.image_urls.map((_, i) => (
                        <button key={i} onClick={() => setImgIdx(i)}
                          className={`h-1.5 rounded-full transition-all ${i === imgIdx ? "w-6 bg-primary" : "w-1.5 bg-foreground/30"}`}
                          style={{ cursor: "pointer" }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            <h1 className="mb-2 text-2xl font-light text-foreground">{build.name}</h1>
            {build.description && <p className="mb-6 text-sm text-foreground/60 leading-relaxed">{build.description}</p>}

            {/* Состав */}
            <h2 className="mb-3 font-mono text-xs uppercase tracking-widest text-foreground/40">Состав сборки</h2>
            <div className="space-y-2 rounded-xl border border-border p-4">
              {build.components.map((c, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-28 shrink-0 text-xs font-mono text-foreground/40">{SLOT_NAMES[c.slot] || c.slot}</span>
                    <span className="text-foreground/80 truncate">{c.name}</span>
                  </div>
                  <span className="ml-4 shrink-0 font-medium text-foreground">{fmt(c.current_price ?? c.price)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Правая часть — итого и действия */}
          <div className="lg:sticky lg:top-24 h-fit space-y-4">
            {/* Цены */}
            <div className="rounded-xl border border-border bg-card p-5">
              <h2 className="mb-4 text-base font-medium text-foreground">Стоимость</h2>
              <div className="mb-4 space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-foreground/60">Комплектующие</span>
                  <span className="font-medium text-foreground">{fmt(build.parts_total)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-foreground/60">Сборка (7%)</span>
                  <span className="font-medium text-foreground">{fmt(build.assembly_fee)}</span>
                </div>
              </div>
              <div className="mb-5 flex items-center justify-between border-t border-border pt-4">
                <span className="text-foreground/70">Итого:</span>
                <span className="text-2xl font-bold text-foreground">{fmt(build.total_price)}</span>
              </div>

              {/* Кнопка заказа */}
              <button
                onClick={orderBuild}
                className="w-full rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                style={{ cursor: "pointer" }}
              >
                Оформить заказ
              </button>
              <p className="mt-2 text-center text-xs text-foreground/40">Менеджер свяжется для подтверждения</p>
            </div>

            {/* Привязать к профилю */}
            <div className="rounded-xl border border-border bg-card p-5">
              {claimed ? (
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-500/10">
                    <Icon name="CheckCircle" size={18} className="text-green-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">Сборка в вашем профиле</p>
                    <button onClick={() => navigate("/profile")} className="text-xs text-primary hover:underline" style={{ cursor: "pointer" }}>
                      Открыть профиль →
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="mb-1 text-sm font-medium text-foreground">Сохранить в профиль</p>
                  <p className="mb-3 text-xs text-foreground/50">Сборка появится в вашем личном кабинете, вы сможете следить за статусом заказа</p>
                  <button
                    onClick={claimBuild}
                    disabled={claiming}
                    className="w-full rounded-xl border border-border py-2.5 text-sm font-medium text-foreground/70 hover:border-primary hover:text-foreground disabled:opacity-50 transition-colors"
                    style={{ cursor: "pointer" }}
                  >
                    {claiming ? "Сохранение..." : isAuthed() ? "Добавить в мой профиль" : "Войти и добавить"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
