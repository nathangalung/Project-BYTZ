import { create } from 'zustand'
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
  hydrate: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => ({
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
  hydrate: async () => {
    if (get().isAuthenticated) return
    set({ isLoading: true })
    try {
      const res = await fetch(apiUrl('/api/v1/me'), { credentials: 'include' })
      if (res.ok) {
        const json = await res.json()
        const user = json?.data ?? json?.user ?? null
        set({ user, isAuthenticated: !!user, isLoading: false })
      } else {
        set({ user: null, isAuthenticated: false, isLoading: false })
      }
    } catch {
      set({ user: null, isAuthenticated: false, isLoading: false })
    }
  },
}))
