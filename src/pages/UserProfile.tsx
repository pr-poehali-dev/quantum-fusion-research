import { useEffect, useState } from "react"
import { useParams, Link } from "react-router-dom"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"

interface PublicUser {
  id: number
  username: string
  bio: string
  vk_url: string
  avatar_url: string
  user_tag: string
  telegram_tag: string
}

export default function UserProfile() {
  const { tag } = useParams<{ tag: string }>()
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
      <div className="mx-auto max-w-lg px-4 py-12">
        <Link to="/" className="mb-8 flex items-center gap-2 text-sm text-foreground/40 hover:text-foreground transition-colors">
          <Icon name="ArrowLeft" size={14} />
          На главную
        </Link>

        <div className="rounded-2xl border border-border bg-card p-8">
          {/* Аватар + имя */}
          <div className="flex items-center gap-5 mb-6">
            <div className="h-20 w-20 rounded-full overflow-hidden border-2 border-border bg-muted flex items-center justify-center flex-shrink-0">
              {profile.avatar_url
                ? <img src={profile.avatar_url} alt={profile.username} className="h-full w-full object-cover" />
                : <Icon name="User" size={34} className="text-foreground/30" />}
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground">{profile.username}</h1>
              {profile.user_tag && <p className="text-sm text-foreground/40">@{profile.user_tag}</p>}
            </div>
          </div>

          {/* Био */}
          {profile.bio && (
            <p className="mb-6 text-sm text-foreground/70 leading-relaxed">{profile.bio}</p>
          )}

          {/* Соцсети */}
          {(profile.vk_url || profile.telegram_tag) && (
            <div className="space-y-2">
              {profile.vk_url && (
                <a
                  href={profile.vk_url.startsWith("http") ? profile.vk_url : `https://${profile.vk_url}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground/70 hover:text-foreground transition-colors"
                >
                  <Icon name="Globe" size={16} className="text-[#0077FF]" />
                  ВКонтакте
                </a>
              )}
              {profile.telegram_tag && (
                <a
                  href={`https://t.me/${profile.telegram_tag.replace("@", "")}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground/70 hover:text-foreground transition-colors"
                >
                  <Icon name="Send" size={16} className="text-[#229ED9]" />
                  Telegram
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
