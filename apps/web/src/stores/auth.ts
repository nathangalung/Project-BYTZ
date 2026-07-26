import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { apiUrl } from '@/lib/api'
import { disconnectCentrifugo } from '@/lib/centrifugo'
import { queryClient } from '@/lib/query-client'

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
  // Async: it awaits sign-out before tearing down the local session. Typed as
  // void it could not be awaited, so callers could not sequence anything after it.
  logout: () => Promise<void>
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
        /*
         * Tear down everything keyed to the old identity.
         *
         * Clearing state alone left two things behind on a shared browser. The
         * query cache still held the previous account's projects, messages and
         * payments, readable by whoever signed in next. And the Centrifugo
         * singleton stayed connected on the old user's token, so the next
         * user's own notification channel subscribe was rejected and they got
         * no realtime until a full page reload.
         */
        disconnectCentrifugo()
        queryClient.clear()
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
