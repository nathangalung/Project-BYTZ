import { create } from 'zustand'

type ToastItem = {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  message: string
}

type ToastStore = {
  toasts: ToastItem[]
  addToast: (type: ToastItem['type'], message: string) => void
  removeToast: (id: string) => void
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  addToast: (type, message) => {
    // Timestamps collide within a millisecond, and removeToast filters by id.
    const id = crypto.randomUUID()
    set((state) => ({ toasts: [...state.toasts, { id, type, message }] }))
  },
  removeToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}))
