import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type AdminUser = {
  id: string
  email: string
  name: string
  role: 'admin'
  avatarUrl?: string | null
  locale: 'id' | 'en'
}

type AuthState = {
  user: AdminUser | null
  isAuthenticated: boolean
  isLoading: boolean
  setUser: (user: AdminUser | null) => void
  setLoading: (loading: boolean) => void
  logout: () => void
  hydrate: () => Promise<void>
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      isLoading: true,
      setUser: (user) => set({ user, isAuthenticated: !!user, isLoading: false }),
      setLoading: (isLoading) => set({ isLoading }),
      logout: async () => {
        try {
          await fetch('/api/v1/auth/sign-out', {
            method: 'POST',
            credentials: 'include',
          })
        } catch {
          // Ignore
        }
        set({ user: null, isAuthenticated: false, isLoading: false })
      },
      hydrate: async () => {
        try {
          const res = await fetch('/api/v1/auth/get-session', { credentials: 'include' })
          if (res.ok) {
            const json = await res.json()
            const user = json?.user ?? null
            if (user?.role === 'admin') {
              set({ user, isAuthenticated: true, isLoading: false })
            } else {
              set({ user: null, isAuthenticated: false, isLoading: false })
            }
          } else {
            set({ user: null, isAuthenticated: false, isLoading: false })
          }
        } catch {
          set({ user: null, isAuthenticated: false, isLoading: false })
        }
      },
    }),
    {
      name: 'kerjacus-admin-auth',
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
)
