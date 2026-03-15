import { create } from 'zustand'

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
  devLogin: () => void
}

const DEV_ADMIN: AdminUser = {
  id: '00000000-0000-7000-8000-000000000001',
  email: 'admin@bytz.id',
  name: 'Rizky Administrator',
  role: 'admin',
  locale: 'id',
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: false,
  setUser: (user) => set({ user, isAuthenticated: !!user, isLoading: false }),
  setLoading: (isLoading) => set({ isLoading }),
  logout: () => set({ user: null, isAuthenticated: false, isLoading: false }),
  devLogin: () => set({ user: DEV_ADMIN, isAuthenticated: true, isLoading: false }),
}))
