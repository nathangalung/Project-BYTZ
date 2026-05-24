import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { apiUrl } from '@/lib/api'

type User = {
  id: string
  email: string
  name: string
  role: 'owner' | 'talent'
  phone?: string | null
  phoneVerified?: boolean
  avatarUrl?: string | null
  locale: 'id' | 'en'
}

type AuthState = {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  setUser: (user: User | null) => void
  setLoading: (loading: boolean) => void
  logout: () => void
  hydrate: (signal?: AbortSignal) => Promise<void>
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
          await fetch(apiUrl('/api/v1/auth/sign-out'), {
            method: 'POST',
            credentials: 'include',
          })
        } catch {
          // Ignore logout errors
        }
        set({ user: null, isAuthenticated: false, isLoading: false })
      },
      hydrate: async (signal?: AbortSignal) => {
        try {
          const res = await fetch(apiUrl('/api/v1/me'), { credentials: 'include', signal })
          if (signal?.aborted) return
          if (res.ok) {
            const json = await res.json()
            const user = json?.data ?? json?.user ?? null
            set({ user, isAuthenticated: !!user, isLoading: false })
          } else {
            // Only clear auth if setUser() hasn't been called concurrently
            // (isLoading stays true until setUser or hydrate completes)
            set((state) =>
              state.isLoading
                ? { user: null, isAuthenticated: false, isLoading: false }
                : { isLoading: false },
            )
          }
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') return
          set((state) =>
            state.isLoading
              ? { user: null, isAuthenticated: false, isLoading: false }
              : { isLoading: false },
          )
        }
      },
    }),
    {
      name: 'kerjacus-auth',
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
)
