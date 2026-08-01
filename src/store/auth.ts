import { create } from "zustand"
import { persist } from "zustand/middleware"

interface User {
  id: number
  email: string
  username: string
  bio?: string
  phone?: string
  vk_url?: string
  telegram_id?: number | null
  telegram_username?: string
  telegram_photo?: string
  email_verified?: boolean
  role?: string
  is_premium?: boolean
  status?: string
  user_tag?: string
  avatar_url?: string
  partner_company_id?: number | null
  partner_company?: {
    id: number
    name: string
    tier: string
    status: string
    trial_ends_at: string | null
    trial_active: boolean
    stress_ingest_token: string
    social_links?: string
  }
  partner_access?: { b2b: boolean; lk: boolean; reason: string }
}

interface AuthStore {
  user: User | null
  sessionId: string | null
  setAuth: (user: User, sessionId: string) => void
  updateUser: (user: User) => void
  logout: () => void
  isAuthed: () => boolean
}

export const useAuth = create<AuthStore>()(
  persist(
    (set, get) => ({
      user: null,
      sessionId: null,
      setAuth: (user, sessionId) => set({ user, sessionId }),
      updateUser: (user) => set({ user }),
      logout: () => set({ user: null, sessionId: null }),
      isAuthed: () => !!get().sessionId && !!get().user,
    }),
    { name: "begraphics-auth" }
  )
)