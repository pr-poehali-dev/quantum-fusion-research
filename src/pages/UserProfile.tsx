import { useEffect, useState } from "react"
import { useParams, Link, useNavigate } from "react-router-dom"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"

interface Build {
  id: number
  name: string
  components: Array<{ slot: string; name: string; price: number }>
  parts_total: number
  assembly_fee: number
  total_price: number
  share_token: string
  created_at: string
}

interface PublicUser {
  id: number
  username: string
  bio: string
  vk_url: string
  avatar_url: string
  user_tag: string
  telegram_tag: string
  builds: Build[]
}

const SLOT_NAMES: Record<string, string> = {
  cpu: "Процессор", gpu: "Видеокарта", ram: "ОЗУ",
  storage: "Накопитель", psu: "БП", case: "Корпус", motherboard: "Материнка",
}

const fmt = (n: number) => n.toLocaleString("ru-RU") + " ₽"

export default function UserProfile() {
  const { tag } = useParams<{ tag: string }>()
  const navigate = useNavigate()
  const [profile, setProfile] = useState<PublicUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!tag) return
    setLoading(true)
    api.auth.viewProfile(tag).then(res => {
      if (res.error) setError(res.error)
      else setProfile(res)
      setLoading(false)
    })
  }, [tag])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    )
  }

  if (error || !profile) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
        <Icon name="UserX" size={48} className="text-foreground/20" />
        <p className="text-foreground/50">{error === "Профиль закрыт" ? "Этот профиль закрыт" : "Пользователь не найден"}</p>
        <Link to="/" className="text-sm text-primary hover:underline">На главную</Link>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-4 py-12">
        <Link to="/" className="mb-8 flex items-center gap-2 text-sm text-foreground/40 hover:text-foreground transition-colors">
          <Icon name="ArrowLeft" size={14} />
          На главную
        </Link>

        {/* Карточка профиля */}
        <div className="rounded-2xl border border-border bg-card p-8 mb-6">
          <div className="flex items-center gap-6 mb-6">
            <div className="h-40 w-40 rounded-full overflow-hidden border-2 border-border bg-muted flex items-center justify-center flex-shrink-0">
              {profile.avatar_url
                ? <img src={profile.avatar_url} alt={profile.username} className="h-full w-full object-cover" />
                : <Icon name="User" size={56} className="text-foreground/30" />}
            </div>
            <div className="space-y-1.5">
              <h1 className="text-2xl font-semibold text-foreground">{profile.username}</h1>
              {profile.user_tag && <p className="text-sm text-foreground/40">@{profile.user_tag}</p>}
              <div className="flex items-center gap-2 pt-1">
                {profile.vk_url && (
                  <a
                    href={profile.vk_url.startsWith("http") ? profile.vk_url : `https://${profile.vk_url}`}
                    target="_blank" rel="noreferrer"
                    className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground/60 hover:text-foreground transition-colors"
                  >
                    <Icon name="Globe" size={13} className="text-[#0077FF]" />ВКонтакте
                  </a>
                )}
                {profile.telegram_tag && (
                  <a
                    href={`https://t.me/${profile.telegram_tag.replace("@", "")}`}
                    target="_blank" rel="noreferrer"
                    className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground/60 hover:text-foreground transition-colors"
                  >
                    <Icon name="Send" size={13} className="text-[#229ED9]" />Telegram
                  </a>
                )}
              </div>
            </div>
          </div>

          {profile.bio && (
            <div className="prose prose-sm max-w-none text-foreground/70 prose-headings:text-foreground prose-a:text-primary prose-strong:text-foreground" dangerouslySetInnerHTML={{ __html: profile.bio }} />
          )}
        </div>

        {/* Конфигурации */}
        {profile.builds && profile.builds.length > 0 && (
          <div>
            <h2 className="mb-4 text-sm font-semibold text-foreground/60 uppercase tracking-wide">
              Конфигурации · {profile.builds.length}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {profile.builds.map(b => (
                <div
                  key={b.id}
                  onClick={() => navigate(`/configurator?build=${b.share_token}`)}
                  className="rounded-xl border border-border bg-card p-5 hover:border-primary/40 hover:shadow-sm transition-all cursor-pointer group"
                >
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <h3 className="font-medium text-foreground group-hover:text-primary transition-colors">{b.name}</h3>
                    <Icon name="ExternalLink" size={14} className="text-foreground/30 group-hover:text-primary transition-colors flex-shrink-0 mt-0.5" />
                  </div>

                  <div className="mb-3 space-y-1">
                    {b.components.slice(0, 4).map((c, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="w-20 shrink-0 text-foreground/40">{SLOT_NAMES[c.slot] || c.slot}</span>
                        <span className="flex-1 truncate text-foreground/60">{c.name}</span>
                      </div>
                    ))}
                    {b.components.length > 4 && (
                      <p className="text-xs text-foreground/30">+{b.components.length - 4} компонентов</p>
                    )}
                  </div>

                  <div className="flex items-center justify-between border-t border-border pt-3">
                    <span className="text-xs text-foreground/40">
                      {new Date(b.created_at).toLocaleDateString("ru-RU")}
                    </span>
                    <span className="text-sm font-semibold text-foreground">{fmt(b.components?.reduce((s: number, c: {price: number}) => s + (c.price || 0), 0) + (b.assembly_fee || 0))}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}