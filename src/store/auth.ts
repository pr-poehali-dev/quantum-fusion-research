import { create } from "zustand"
import { persist } from "zustand/middleware"

interface User {
  id: number
  email: string
  username: string
}

interface AuthStore {
  user: User | null
  sessionId: string | null
  setAuth: (user: User, sessionId: string) => void
  logout: () => void
  isAuthed: () => boolean
}

export const useAuth = create<AuthStore>()(
  persist(
    (set, get) => ({
      user: null,
      sessionId: null,
      setAuth: (user, sessionId) => set({ user, sessionId }),
      logout: () => set({ user: null, sessionId: null }),
      isAuthed: () => !!get().sessionId && !!get().user,
    }),
    { name: "pcpro-auth" }
  )
)
